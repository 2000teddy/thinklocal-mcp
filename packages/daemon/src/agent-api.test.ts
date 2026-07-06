// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * Fastify integration tests for the ADR-004 Phase 2 agent REST API.
 * Uses Fastify's built-in `inject()` harness so no real socket is
 * opened; the AgentRegistry is exercised end-to-end against the
 * route handlers with a deterministic injected clock.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { AgentRegistry } from './agent-registry.js';
import { AuditLog } from './audit.js';
import { registerAgentApi, buildInstanceSpiffe } from './agent-api.js';
import { getAgentInstance, normalizeAgentId } from './spiffe-uri.js';

const NODE_DAEMON_URI = 'spiffe://thinklocal/node/12D3KooWGrqKHtVfgVkyqBkthFHXvhcYNZVfWPVYdHHefRsTuVw';

function makeTestPrivateKey(): string {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
}

const DAEMON_URI = 'spiffe://thinklocal/host/deadbeefcafe0001/agent/claude-code';

async function buildServer() {
  const tmp = mkdtempSync(join(tmpdir(), 'tlmcp-agent-api-test-'));
  let now = 1_700_000_000_000;
  const registry = new AgentRegistry({
    heartbeatIntervalMs: 5_000,
    now: () => now,
    // Disable the background timer in tests — we drive `sweep()` by hand.
    setIntervalFn: ((_fn: () => void, _ms: number) =>
      ({ unref: () => undefined }) as unknown as ReturnType<typeof setInterval>) as unknown as typeof setInterval,
    clearIntervalFn: (() => undefined) as unknown as typeof clearInterval,
  });
  const audit = new AuditLog(tmp, makeTestPrivateKey(), 'spiffe://test/host/x/agent/y');
  const server: FastifyInstance = Fastify({ logger: false });
  registerAgentApi(server, {
    registry,
    audit,
    daemonSpiffeUri: DAEMON_URI,
    inboxSchemaVersion: 1,
  });
  await server.ready();
  return {
    server,
    registry,
    audit,
    tmp,
    advance: (ms: number) => {
      now += ms;
    },
    cleanup: async () => {
      await server.close();
      audit.close();
      rmSync(tmp, { recursive: true, force: true });
    },
  };
}

describe('agent-api (ADR-004 Phase 2)', () => {
  let ctx: Awaited<ReturnType<typeof buildServer>>;

  beforeEach(async () => {
    ctx = await buildServer();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  describe('POST /api/agent/register', () => {
    it('registers a new instance and returns the 4-component SPIFFE URI', async () => {
      const res = await ctx.server.inject({
        method: 'POST',
        url: '/api/agent/register',
        payload: {
          agent_type: 'claude-code',
          instance_id: 'abc123',
          pid: 4242,
          cli_version: '0.31.0',
        },
        remoteAddress: '127.0.0.1',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        instance_spiffe_uri: string;
        heartbeat_interval_ms: number;
        inbox_schema_version: number;
      };
      expect(body.instance_spiffe_uri).toBe(
        'spiffe://thinklocal/host/deadbeefcafe0001/agent/claude-code/instance/abc123',
      );
      expect(body.heartbeat_interval_ms).toBe(5_000);
      expect(body.inbox_schema_version).toBe(1);
      expect(ctx.registry.size()).toBe(1);
    });

    it('builds a different agent_type suffix when a sibling registers', async () => {
      const res = await ctx.server.inject({
        method: 'POST',
        url: '/api/agent/register',
        payload: { agent_type: 'codex', instance_id: 'xyz789' },
        remoteAddress: '127.0.0.1',
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { instance_spiffe_uri: string }).instance_spiffe_uri).toBe(
        'spiffe://thinklocal/host/deadbeefcafe0001/agent/codex/instance/xyz789',
      );
    });

    it('rejects non-loopback callers with 403', async () => {
      const res = await ctx.server.inject({
        method: 'POST',
        url: '/api/agent/register',
        payload: { agent_type: 'claude-code', instance_id: 'abc' },
        remoteAddress: '10.0.0.5',
      });
      expect(res.statusCode).toBe(403);
    });

    it('rejects missing body with 400', async () => {
      const res = await ctx.server.inject({
        method: 'POST',
        url: '/api/agent/register',
        payload: {},
        remoteAddress: '127.0.0.1',
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects invalid instance_id characters', async () => {
      const res = await ctx.server.inject({
        method: 'POST',
        url: '/api/agent/register',
        payload: { agent_type: 'claude-code', instance_id: 'bad/id' },
        remoteAddress: '127.0.0.1',
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects re-registration with a different agent_type (409)', async () => {
      await ctx.server.inject({
        method: 'POST',
        url: '/api/agent/register',
        payload: { agent_type: 'claude-code', instance_id: 'abc' },
        remoteAddress: '127.0.0.1',
      });
      const res = await ctx.server.inject({
        method: 'POST',
        url: '/api/agent/register',
        payload: { agent_type: 'codex', instance_id: 'abc' },
        remoteAddress: '127.0.0.1',
      });
      expect(res.statusCode).toBe(409);
    });
  });

  describe('POST /api/agent/heartbeat', () => {
    it('refreshes an existing entry and returns 200', async () => {
      await ctx.server.inject({
        method: 'POST',
        url: '/api/agent/register',
        payload: { agent_type: 'claude-code', instance_id: 'abc' },
        remoteAddress: '127.0.0.1',
      });
      ctx.advance(3_000);
      const res = await ctx.server.inject({
        method: 'POST',
        url: '/api/agent/heartbeat',
        payload: { instance_id: 'abc' },
        remoteAddress: '127.0.0.1',
      });
      expect(res.statusCode).toBe(200);
      expect(ctx.registry.get('abc')!.lastHeartbeatAt).toBe(1_700_000_003_000);
    });

    it('returns 404 for an unknown instance_id', async () => {
      const res = await ctx.server.inject({
        method: 'POST',
        url: '/api/agent/heartbeat',
        payload: { instance_id: 'ghost' },
        remoteAddress: '127.0.0.1',
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('POST /api/agent/unregister', () => {
    it('removes the entry and is idempotent', async () => {
      await ctx.server.inject({
        method: 'POST',
        url: '/api/agent/register',
        payload: { agent_type: 'claude-code', instance_id: 'abc' },
        remoteAddress: '127.0.0.1',
      });
      const first = await ctx.server.inject({
        method: 'POST',
        url: '/api/agent/unregister',
        payload: { instance_id: 'abc' },
        remoteAddress: '127.0.0.1',
      });
      expect(first.statusCode).toBe(200);
      expect((first.json() as { existed: boolean }).existed).toBe(true);

      const second = await ctx.server.inject({
        method: 'POST',
        url: '/api/agent/unregister',
        payload: { instance_id: 'abc' },
        remoteAddress: '127.0.0.1',
      });
      expect(second.statusCode).toBe(200);
      expect((second.json() as { existed: boolean }).existed).toBe(false);
      expect(ctx.registry.size()).toBe(0);
    });
  });

  describe('GET /api/agent/instances', () => {
    it('lists currently-live entries', async () => {
      await ctx.server.inject({
        method: 'POST',
        url: '/api/agent/register',
        payload: { agent_type: 'claude-code', instance_id: 'a1' },
        remoteAddress: '127.0.0.1',
      });
      await ctx.server.inject({
        method: 'POST',
        url: '/api/agent/register',
        payload: { agent_type: 'codex', instance_id: 'c1', pid: 99 },
        remoteAddress: '127.0.0.1',
      });
      const res = await ctx.server.inject({
        method: 'GET',
        url: '/api/agent/instances',
        remoteAddress: '127.0.0.1',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        count: number;
        heartbeat_interval_ms: number;
        instances: Array<{ instance_id: string; agent_type: string; pid: number | null }>;
      };
      expect(body.count).toBe(2);
      expect(body.heartbeat_interval_ms).toBe(5_000);
      const ids = body.instances.map((i) => i.instance_id).sort();
      expect(ids).toEqual(['a1', 'c1']);
    });

    it('rejects non-loopback with 403', async () => {
      const res = await ctx.server.inject({
        method: 'GET',
        url: '/api/agent/instances',
        remoteAddress: '203.0.113.5',
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('stale sweep audit forwarding', () => {
    it('appends AGENT_STALE audit events when the registry evicts', async () => {
      await ctx.server.inject({
        method: 'POST',
        url: '/api/agent/register',
        payload: { agent_type: 'claude-code', instance_id: 'abc' },
        remoteAddress: '127.0.0.1',
      });
      ctx.advance(20_000);
      ctx.registry.sweep();
      const tail = ctx.audit.getEvents(10);
      const types = tail.map((e) => e.event_type);
      expect(types).toContain('AGENT_STALE');
    });
  });

  // Regression tests for Gemini-Pro CR findings (2026-04-09).
  describe('CR regressions', () => {
    it('returns 503 when the registry cap is hit (MEDIUM: DoS guard)', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'tlmcp-agent-api-cap-'));
      let now = 1_700_000_000_000;
      const registry = new AgentRegistry({
        heartbeatIntervalMs: 5_000,
        maxEntries: 1,
        now: () => now,
        setIntervalFn: ((_fn: () => void, _ms: number) =>
          ({ unref: () => undefined }) as unknown as ReturnType<typeof setInterval>) as unknown as typeof setInterval,
        clearIntervalFn: (() => undefined) as unknown as typeof clearInterval,
      });
      const audit = new AuditLog(tmp, makeTestPrivateKey(), 'spiffe://test/host/x/agent/y');
      const server = Fastify({ logger: false });
      registerAgentApi(server, {
        registry,
        audit,
        daemonSpiffeUri: DAEMON_URI,
        inboxSchemaVersion: 1,
      });
      await server.ready();
      try {
        const first = await server.inject({
          method: 'POST',
          url: '/api/agent/register',
          payload: { agent_type: 'claude-code', instance_id: 'first' },
          remoteAddress: '127.0.0.1',
        });
        expect(first.statusCode).toBe(200);

        const second = await server.inject({
          method: 'POST',
          url: '/api/agent/register',
          payload: { agent_type: 'codex', instance_id: 'second' },
          remoteAddress: '127.0.0.1',
        });
        expect(second.statusCode).toBe(503);
        expect((second.json() as { max_entries: number }).max_entries).toBe(1);
      } finally {
        await server.close();
        audit.close();
        rmSync(tmp, { recursive: true, force: true });
      }
    });

    it('unregister writes AGENT_UNREGISTER atomically (MEDIUM: race vs. sweep)', async () => {
      await ctx.server.inject({
        method: 'POST',
        url: '/api/agent/register',
        payload: { agent_type: 'claude-code', instance_id: 'race-id' },
        remoteAddress: '127.0.0.1',
      });
      const res = await ctx.server.inject({
        method: 'POST',
        url: '/api/agent/unregister',
        payload: { instance_id: 'race-id' },
        remoteAddress: '127.0.0.1',
      });
      expect(res.statusCode).toBe(200);
      const tail = ctx.audit.getEvents(20);
      const unregs = tail.filter((e) => e.event_type === 'AGENT_UNREGISTER');
      expect(unregs.length).toBe(1);
      expect(unregs[0]!.details).toBe('race-id');
    });

    it('returns 500 when the daemon SPIFFE URI is malformed (LOW: fail loudly)', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'tlmcp-agent-api-bad-uri-'));
      const registry = new AgentRegistry({
        heartbeatIntervalMs: 5_000,
        setIntervalFn: ((_fn: () => void, _ms: number) =>
          ({ unref: () => undefined }) as unknown as ReturnType<typeof setInterval>) as unknown as typeof setInterval,
        clearIntervalFn: (() => undefined) as unknown as typeof clearInterval,
      });
      const audit = new AuditLog(tmp, makeTestPrivateKey(), 'spiffe://test/host/x/agent/y');
      const server = Fastify({ logger: false });
      registerAgentApi(server, {
        registry,
        audit,
        daemonSpiffeUri: 'spiffe://totally/broken',
        inboxSchemaVersion: 1,
      });
      await server.ready();
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/api/agent/register',
          payload: { agent_type: 'claude-code', instance_id: 'abc' },
          remoteAddress: '127.0.0.1',
        });
        expect(res.statusCode).toBe(500);
        expect((res.json() as { error: string }).error).toContain('daemon misconfiguration');
      } finally {
        await server.close();
        audit.close();
        rmSync(tmp, { recursive: true, force: true });
      }
    });

    // A1-Regression: mit kanonischer node/<PeerID>-Daemon-Identität (ADR-022-Flip) MUSS
    // die Registrierung funktionieren (vorher: 500 „cannot derive instance SPIFFE URI").
    it('registers against a canonical node/<PeerID> daemon URI (A1: no more 500)', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'tlmcp-agent-api-node-uri-'));
      const registry = new AgentRegistry({
        heartbeatIntervalMs: 5_000,
        setIntervalFn: ((_fn: () => void, _ms: number) =>
          ({ unref: () => undefined }) as unknown as ReturnType<typeof setInterval>) as unknown as typeof setInterval,
        clearIntervalFn: (() => undefined) as unknown as typeof clearInterval,
      });
      const audit = new AuditLog(tmp, makeTestPrivateKey(), 'spiffe://test/host/x/agent/y');
      const server = Fastify({ logger: false });
      registerAgentApi(server, { registry, audit, daemonSpiffeUri: NODE_DAEMON_URI, inboxSchemaVersion: 1 });
      await server.ready();
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/api/agent/register',
          payload: { agent_type: 'claude-code', instance_id: 'abc123' },
          remoteAddress: '127.0.0.1',
        });
        expect(res.statusCode).toBe(200);
        const uri = (res.json() as { instance_spiffe_uri: string }).instance_spiffe_uri;
        // PeerID im Node-Slot der host-Grammatik → parsebar, Instanz-Teil erhalten.
        expect(uri).toBe(
          'spiffe://thinklocal/host/12D3KooWGrqKHtVfgVkyqBkthFHXvhcYNZVfWPVYdHHefRsTuVw/agent/claude-code/instance/abc123',
        );
        expect(getAgentInstance(uri)).toBe('abc123');
        expect(registry.size()).toBe(1);
      } finally {
        await server.close();
        audit.close();
        rmSync(tmp, { recursive: true, force: true });
      }
    });

    // CR-Test-Gap: register→heartbeat→unregister-Round-Trip unter node/<PeerID>-Daemon
    // (die Registry keyt auf instance_id; die synthetisierte URI muss konsistent bleiben).
    it('register→heartbeat→unregister round-trips under a node/<PeerID> daemon URI', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'tlmcp-agent-api-node-rt-'));
      const registry = new AgentRegistry({
        heartbeatIntervalMs: 5_000,
        setIntervalFn: ((_fn: () => void, _ms: number) =>
          ({ unref: () => undefined }) as unknown as ReturnType<typeof setInterval>) as unknown as typeof setInterval,
        clearIntervalFn: (() => undefined) as unknown as typeof clearInterval,
      });
      const audit = new AuditLog(tmp, makeTestPrivateKey(), 'spiffe://test/host/x/agent/y');
      const server = Fastify({ logger: false });
      registerAgentApi(server, { registry, audit, daemonSpiffeUri: NODE_DAEMON_URI, inboxSchemaVersion: 1 });
      await server.ready();
      const call = (url: string, payload: unknown): ReturnType<typeof server.inject> =>
        server.inject({ method: 'POST', url, payload, remoteAddress: '127.0.0.1' });
      try {
        expect((await call('/api/agent/register', { agent_type: 'codex', instance_id: 'rt1' })).statusCode).toBe(200);
        expect((await call('/api/agent/heartbeat', { instance_id: 'rt1' })).statusCode).toBe(200);
        const unreg = await call('/api/agent/unregister', { instance_id: 'rt1' });
        expect(unreg.statusCode).toBe(200);
        expect((unreg.json() as { existed: boolean }).existed).toBe(true);
        expect(registry.size()).toBe(0);
      } finally {
        await server.close();
        audit.close();
        rmSync(tmp, { recursive: true, force: true });
      }
    });
  });
});

describe('buildInstanceSpiffe (A1 — node/-fähig)', () => {
  it('legacy host/-Daemon-URI → host-Instanz-URI', () => {
    const uri = buildInstanceSpiffe('spiffe://thinklocal/host/deadbeefcafe0001/agent/claude-code', 'codex', 'i1');
    expect(uri).toBe('spiffe://thinklocal/host/deadbeefcafe0001/agent/codex/instance/i1');
  });

  it('kanonische node/<PeerID>-Daemon-URI → host/<PeerID>-Instanz-URI (parsebar)', () => {
    const uri = buildInstanceSpiffe(NODE_DAEMON_URI, 'claude-code', 'i2');
    expect(uri).toBe(
      'spiffe://thinklocal/host/12D3KooWGrqKHtVfgVkyqBkthFHXvhcYNZVfWPVYdHHefRsTuVw/agent/claude-code/instance/i2',
    );
    // Ergebnis ist voll parsebar + kollidiert nicht mit der Daemon-node-Identität.
    expect(getAgentInstance(uri)).toBe('i2');
    expect(normalizeAgentId(uri)).toBe(
      'spiffe://thinklocal/host/12D3KooWGrqKHtVfgVkyqBkthFHXvhcYNZVfWPVYdHHefRsTuVw/agent/claude-code',
    );
  });

  it('malformte Daemon-URI → null (echter Misconfig → 500)', () => {
    expect(buildInstanceSpiffe('spiffe://totally/broken', 'claude-code', 'i3')).toBeNull();
    expect(buildInstanceSpiffe('not-a-spiffe', 'claude-code', 'i3')).toBeNull();
  });

  it('ungültige agentType/instanceId-Zeichen → null (defensiv; Handler validiert vor)', () => {
    expect(buildInstanceSpiffe(NODE_DAEMON_URI, 'bad type', 'i4')).toBeNull();
    expect(buildInstanceSpiffe(NODE_DAEMON_URI, 'codex', 'bad/id')).toBeNull();
  });

  it('Zwei-Grammatik-Split (CR-M1): Instanz-URI kollidiert NICHT mit der Daemon-node-Identität', () => {
    const uri = buildInstanceSpiffe(NODE_DAEMON_URI, 'claude-code', 'i5') as string;
    // normalizeAgentId der Instanz bleibt host-Grammatik — NIE gleich node/<PeerID>.
    expect(normalizeAgentId(uri)).not.toBe(NODE_DAEMON_URI);
    expect(normalizeAgentId(uri).startsWith('spiffe://thinklocal/host/')).toBe(true);
  });
});
