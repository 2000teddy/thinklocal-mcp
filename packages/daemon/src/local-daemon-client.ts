import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { request as httpRequest, type RequestOptions } from 'node:http';
import { Agent as HttpsAgent, request as httpsRequest, type AgentOptions } from 'node:https';
import { type RuntimeMode } from './runtime-mode.js';

export interface DaemonRequestOptions {
  baseUrl?: string;
  body?: unknown;
  dataDir?: string;
  method?: 'GET' | 'POST' | 'DELETE';
  timeoutMs?: number;
}

export function getDefaultDataDir(): string {
  return process.env['TLMCP_DATA_DIR'] ?? resolve(homedir(), '.thinklocal');
}

export function getDefaultLocalDaemonUrl(port = 9440, runtimeMode: RuntimeMode = 'local'): string {
  const proto = runtimeMode === 'lan' ? 'https' : 'http';
  return `${proto}://localhost:${port}`;
}

function getLocalCaPath(dataDir: string): string {
  return resolve(dataDir, 'tls', 'ca.crt.pem');
}

function loadLocalCa(dataDir: string): string | undefined {
  const caPath = getLocalCaPath(dataDir);
  if (!existsSync(caPath)) return undefined;
  return readFileSync(caPath, 'utf-8');
}

/**
 * Laedt den vollen Mesh Trust-Store fuer mTLS Outbound-Verbindungen:
 * - eigene Mesh-CA (tls/ca.crt.pem)
 * - CAs aller via SPAKE2/ssh-bootstrap gepairten Peers (aus pairing/paired-peers.json)
 *
 * Rueckgabe ist ein string[] mit PEM-Bloecken oder undefined wenn nichts
 * geladen werden konnte. Node's https.Agent akzeptiert ca als Array.
 *
 * Das ist der gleiche Pattern wie im Daemon selbst (siehe trust-store.ts),
 * nur fuer den Out-of-Process MCP-Stdio-Server, der seinen eigenen
 * https-Agent bauen muss.
 */
function loadMeshTrustBundle(dataDir: string): string[] | undefined {
  const bundle: string[] = [];

  const ownCa = loadLocalCa(dataDir);
  if (ownCa) {
    bundle.push(ownCa);
  }

  // Peer-CAs aus paired-peers.json
  const pairingFile = resolve(dataDir, 'pairing', 'paired-peers.json');
  if (existsSync(pairingFile)) {
    try {
      const raw = readFileSync(pairingFile, 'utf-8');
      const peers = JSON.parse(raw) as Array<{ caCertPem?: string }>;
      for (const peer of peers) {
        if (peer.caCertPem && peer.caCertPem.includes('BEGIN CERTIFICATE')) {
          bundle.push(peer.caCertPem);
        }
      }
    } catch (err) {
      // Best effort — if paired-peers.json is corrupt we keep working with
      // just the own CA, but surface the reason on stderr so it shows up in
      // the mcp-stdio log and the user can debug a mangled pairing file.
      // (Gemini-Pro CR finding 2026-04-09, MEDIUM)
      process.stderr.write(
        `[local-daemon-client] failed to parse paired-peers.json: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }

  return bundle.length > 0 ? bundle : undefined;
}

/**
 * Cached HTTPS agent + TLS material.
 *
 * Motivation: before this cache the client created a fresh `HttpsAgent`
 * on every `requestDaemon` call and re-read `ca.crt.pem`, all peer CAs
 * and the client cert from disk. Over a long-running session (e.g. the
 * mcp-stdio subprocess that lives for the whole Claude Code session)
 * this caused:
 *
 *   1. Socket-pool exhaustion — every call performed a full TLS handshake
 *      and dropped the socket, so TIME_WAIT piled up and the subprocess
 *      eventually hit its fd limit or a hung-socket state. Symptom:
 *      `socket hang up` after a few hours of use (see PR #86 live-test).
 *
 *   2. Unnecessary fs I/O — `paired-peers.json` + up to a dozen PEM reads
 *      on every call.
 *
 *   3. Unbounded `HttpsAgent` instances — GC had to clean them up, which
 *      in practice happened irregularly.
 *
 * The cache below reuses a single keepAlive-enabled agent per unique
 * (dataDir, relevant file mtimes) combination. Trust-bundle rotations
 * (90-day cert lifetime, ssh-bootstrap-trust adding new peers) are
 * detected by comparing mtimes of the relevant files; on change the
 * agent is destroyed and rebuilt.
 */
interface TlsCacheEntry {
  agent: HttpsAgent;
  ca: string[];
  clientCert?: { cert: string; key: string };
  /** mtime (epoch ms) of each source file we hash into the cache key. */
  fingerprint: string;
}

const tlsAgentCache = new Map<string, TlsCacheEntry>();

function mtimeMs(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Build a cheap fingerprint of everything that affects the trust store
 * and the client cert. Used as the cache-invalidation key.
 */
function computeTlsFingerprint(dataDir: string): string {
  const parts = [
    mtimeMs(resolve(dataDir, 'tls', 'ca.crt.pem')),
    mtimeMs(resolve(dataDir, 'pairing', 'paired-peers.json')),
    mtimeMs(resolve(dataDir, 'tls', 'client.crt.pem')),
    mtimeMs(resolve(dataDir, 'tls', 'node.crt.pem')),
  ];
  return parts.join(':');
}

/**
 * Retrieve (or create on first use / after rotation) the cached HTTPS
 * agent for the given dataDir. Returns `undefined` if no CA bundle is
 * available — in that case the caller falls back to a plain request
 * without a custom agent (which is fine for `http://` URLs).
 *
 * IMPORTANT — atomicity contract: this function MUST remain fully
 * synchronous. It is called from inside the `new Promise(executor)`
 * body of `requestDaemon` and relies on Node's single-threaded event
 * loop to run to completion without yielding. Only synchronous I/O
 * (`statSync`, `readFileSync`) is allowed here. If a future change
 * introduces an `await`, an async fs call, or any microtask boundary,
 * the cache-miss path becomes racy: two concurrent `requestDaemon`
 * calls could both create a fresh `HttpsAgent`, the last write would
 * orphan the earlier one, and the socket leak that motivated this fix
 * would silently come back. If async I/O becomes necessary, gate it
 * behind a per-dataDir `Map<string, Promise<TlsCacheEntry>>` lock.
 * (Gemini-Pro pre-commit 2026-04-09 flagged this as a CRITICAL race;
 * after `pal:challenge` it was confirmed a false positive for the
 * current synchronous implementation, but the risk is real for any
 * future refactor — hence this comment.)
 */
function getCachedHttpsAgent(dataDir: string): TlsCacheEntry | undefined {
  const fingerprint = computeTlsFingerprint(dataDir);
  const cached = tlsAgentCache.get(dataDir);
  if (cached && cached.fingerprint === fingerprint) {
    return cached;
  }
  if (cached) {
    // Trust material rotated — tear down the old pool cleanly.
    cached.agent.destroy();
    tlsAgentCache.delete(dataDir);
  }

  const ca = loadMeshTrustBundle(dataDir);
  if (!ca) return undefined;
  const clientCert = loadClientCert(dataDir);

  const agentOpts: AgentOptions = {
    ca,
    rejectUnauthorized: true,
    keepAlive: true,
    keepAliveMsecs: 15_000,
    maxSockets: 50,
    maxFreeSockets: 10,
    // Node's LIFO scheduling keeps a small set of sockets hot, which is
    // what a long-running mcp-stdio polling workload wants.
    scheduling: 'lifo',
  };
  if (clientCert) {
    agentOpts.cert = clientCert.cert;
    agentOpts.key = clientCert.key;
  }
  const agent = new HttpsAgent(agentOpts);

  const entry: TlsCacheEntry = { agent, ca, clientCert, fingerprint };
  tlsAgentCache.set(dataDir, entry);
  return entry;
}

/**
 * Test-only: drop all cached agents. Safe to call from production code
 * too — the next request will rebuild lazily. Primarily used so unit
 * tests can assert "exactly N new agents were created after M requests".
 */
export function __resetDaemonClientCache(): void {
  for (const entry of tlsAgentCache.values()) {
    entry.agent.destroy();
  }
  tlsAgentCache.clear();
}

/**
 * Test-only: report how many live cache entries are currently held.
 */
export function __daemonClientCacheSize(): number {
  return tlsAgentCache.size;
}

function loadClientCert(dataDir: string): { cert: string; key: string } | undefined {
  // Try dedicated client cert first, then fall back to node cert (used for mTLS)
  const candidates = [
    { cert: resolve(dataDir, 'tls', 'client.crt.pem'), key: resolve(dataDir, 'tls', 'client.key.pem') },
    { cert: resolve(dataDir, 'tls', 'node.crt.pem'), key: resolve(dataDir, 'tls', 'node.key.pem') },
  ];
  for (const paths of candidates) {
    if (existsSync(paths.cert) && existsSync(paths.key)) {
      return {
        cert: readFileSync(paths.cert, 'utf-8'),
        key: readFileSync(paths.key, 'utf-8'),
      };
    }
  }
  return undefined;
}

export async function requestDaemon(
  path: string,
  options: DaemonRequestOptions = {},
): Promise<{ status: number; body: string }> {
  const method = options.method ?? 'GET';
  const dataDir = options.dataDir ?? getDefaultDataDir();
  const timeoutMs = options.timeoutMs ?? 5_000;
  const baseUrl = options.baseUrl ?? getDefaultLocalDaemonUrl();
  const url = new URL(path, baseUrl);
  const payload = options.body === undefined ? undefined : JSON.stringify(options.body);

  const headers: Record<string, string> = {};
  if (payload !== undefined) {
    headers['content-type'] = 'application/json';
    headers['content-length'] = Buffer.byteLength(payload).toString();
  }

  return new Promise((resolvePromise, reject) => {
    const reqFactory = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const requestOptions: RequestOptions = {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method,
      headers,
    };

    // mTLS-Agent fuer HTTPS. Frueher nur fuer loopback aktiviert — aber dann
    // scheitert execute_remote_skill gegen LAN-Peers (siehe Codex-Bugreport
    // vom 2026-04-08). Jetzt immer: wenn HTTPS-URL und lokale Certs vorhanden,
    // wird der Mesh-Trust-Store geladen. Das ist semantisch korrekt, denn der
    // Trust-Store enthaelt die CAs ALLER gepairten Peers (PR #75) — nicht nur
    // localhost. Wenn der Peer nicht gepairt ist, scheitert der TLS-Handshake
    // sauber mit "certificate signature failure" statt mit dem kryptischen
    // "Empty reply from server" aus dem Codex-Befund.
    //
    // Fuer Remote-Peers lesen wir zusaetzlich die paired-peers.json und
    // aggregieren die Peer-CAs ins Agent-CA-Bundle, damit mTLS gegen fremde
    // Subjects funktioniert.
    if (url.protocol === 'https:') {
      const cached = getCachedHttpsAgent(dataDir);
      if (cached) {
        requestOptions.agent = cached.agent;
      }
    }

    const req = reqFactory(requestOptions, (res) => {
      const chunks: Buffer[] = [];
      // Node streams without setEncoding always emit Buffers — the
      // previous defensive branch was dead code (Gemini-Pro CR LOW).
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        resolvePromise({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf-8'),
        });
      });
    });

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Daemon request timeout after ${timeoutMs}ms`)));

    if (payload !== undefined) {
      req.write(payload);
    }
    req.end();
  });
}

export async function requestDaemonJson<T>(
  path: string,
  options: DaemonRequestOptions = {},
): Promise<T> {
  const res = await requestDaemon(path, options);
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Daemon API error: ${res.status}`);
  }
  return JSON.parse(res.body) as T;
}
