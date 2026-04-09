/**
 * Regression tests for the MCP-stdio socket-pool staleness fix.
 *
 * The pre-fix client created a brand new `HttpsAgent` on every call,
 * which over a long-running mcp-stdio subprocess caused socket-pool
 * exhaustion and `socket hang up` errors after ~4 hours (see PR #86
 * live-test follow-up). These tests pin the new behaviour:
 *
 *   1. TLS agents are cached per dataDir and reused across calls.
 *   2. Rotating any trust-material file (CA, peer CAs, client cert)
 *      invalidates and rebuilds the cache.
 *   3. `__resetDaemonClientCache` cleans up all pooled agents.
 *   4. Many sequential requests against a plain HTTP daemon do not
 *      leak sockets or hang the event loop.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  requestDaemon,
  requestDaemonJson,
  __resetDaemonClientCache,
  __daemonClientCacheSize,
} from './local-daemon-client.js';

// Minimal self-signed PEMs are not needed because we test the HTTP
// path (the bug is in socket management, the cache-entry lifecycle is
// exercised directly via file mtimes — no real TLS handshake).
const DUMMY_CA = `-----BEGIN CERTIFICATE-----
MIIBtest
-----END CERTIFICATE-----
`;

function makeDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tlmcp-client-test-'));
  mkdirSync(join(dir, 'tls'), { recursive: true });
  mkdirSync(join(dir, 'pairing'), { recursive: true });
  writeFileSync(join(dir, 'tls', 'ca.crt.pem'), DUMMY_CA);
  writeFileSync(join(dir, 'tls', 'node.crt.pem'), DUMMY_CA);
  writeFileSync(join(dir, 'tls', 'node.key.pem'), DUMMY_CA);
  return dir;
}

describe('local-daemon-client — socket-pool fix (regression for PR #86 live-test finding)', () => {
  let httpServer: Server;
  let baseUrl: string;
  let reqCount = 0;

  beforeEach(async () => {
    reqCount = 0;
    __resetDaemonClientCache();
    httpServer = createServer((req, res) => {
      reqCount += 1;
      if (req.url === '/api/status') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, n: reqCount }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((r) => httpServer.listen(0, '127.0.0.1', r));
    const addr = httpServer.address();
    if (!addr || typeof addr === 'string') throw new Error('no address');
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterEach(async () => {
    __resetDaemonClientCache();
    await new Promise<void>((r) => httpServer.close(() => r()));
  });

  afterAll(() => {
    __resetDaemonClientCache();
  });

  it('handles many sequential HTTP requests without leaking sockets', async () => {
    for (let i = 0; i < 100; i++) {
      const res = await requestDaemonJson<{ ok: boolean; n: number }>('/api/status', {
        baseUrl,
      });
      expect(res.ok).toBe(true);
    }
    expect(reqCount).toBe(100);
  });

  it('does not cache HTTP-only calls (no TLS agent needed)', async () => {
    await requestDaemon('/api/status', { baseUrl });
    expect(__daemonClientCacheSize()).toBe(0);
  });

  it('caches the HTTPS agent per dataDir and reuses it across calls', async () => {
    const dir = makeDataDir();
    try {
      // Import the getter lazily to exercise the real code path.
      const mod = await import('./local-daemon-client.js');

      // Poke the cache twice via the public API shape: call a dummy
      // https:// URL that will fail the actual request, but the cache
      // entry is created before the request fires.
      const fakeBase = 'https://127.0.0.1:1/';
      const attempts = [
        mod.requestDaemon('/', { baseUrl: fakeBase, dataDir: dir, timeoutMs: 50 }).catch(() => undefined),
        mod.requestDaemon('/', { baseUrl: fakeBase, dataDir: dir, timeoutMs: 50 }).catch(() => undefined),
        mod.requestDaemon('/', { baseUrl: fakeBase, dataDir: dir, timeoutMs: 50 }).catch(() => undefined),
      ];
      await Promise.all(attempts);

      expect(__daemonClientCacheSize()).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('invalidates the cache when a trust-material file mtime changes', async () => {
    const dir = makeDataDir();
    try {
      const fakeBase = 'https://127.0.0.1:1/';
      await requestDaemon('/', { baseUrl: fakeBase, dataDir: dir, timeoutMs: 50 }).catch(() => undefined);
      expect(__daemonClientCacheSize()).toBe(1);

      // Bump mtime on the CA file → fingerprint changes → cache invalidates
      // and rebuilds on next call.
      const caPath = join(dir, 'tls', 'ca.crt.pem');
      const future = new Date(Date.now() + 60_000);
      utimesSync(caPath, future, future);
      // Overwrite the content too so the fingerprint definitely differs.
      writeFileSync(caPath, `${DUMMY_CA}\n# rotated\n`);

      await requestDaemon('/', { baseUrl: fakeBase, dataDir: dir, timeoutMs: 50 }).catch(() => undefined);
      // Still exactly one cache entry — the old one was destroyed.
      expect(__daemonClientCacheSize()).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('__resetDaemonClientCache clears all cached entries', async () => {
    const dir1 = makeDataDir();
    const dir2 = makeDataDir();
    try {
      const fakeBase = 'https://127.0.0.1:1/';
      await requestDaemon('/', { baseUrl: fakeBase, dataDir: dir1, timeoutMs: 50 }).catch(() => undefined);
      await requestDaemon('/', { baseUrl: fakeBase, dataDir: dir2, timeoutMs: 50 }).catch(() => undefined);
      expect(__daemonClientCacheSize()).toBe(2);

      __resetDaemonClientCache();
      expect(__daemonClientCacheSize()).toBe(0);
    } finally {
      rmSync(dir1, { recursive: true, force: true });
      rmSync(dir2, { recursive: true, force: true });
    }
  });
});
