/**
 * ADR-005 Fastify integration test for inbox-api per-agent-instance routing.
 * Uses `fastify.inject()` so no real socket is opened. The MeshManager is
 * stubbed; only the loopback path is exercised here because the remote
 * path would require a second daemon + mTLS setup (covered by separate
 * integration tests).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentInbox } from './agent-inbox.js';
import { registerInboxApi } from './inbox-api.js';

const OWN_ID = 'spiffe://thinklocal/host/deadbeefcafe0001/agent/claude-code';
const OWN_INSTANCE_ALPHA = `${OWN_ID}/instance/alpha`;
const OWN_INSTANCE_BETA = `${OWN_ID}/instance/beta`;
const REMOTE_PEER_ID = 'spiffe://thinklocal/host/aabbccddee001122/agent/gemini-cli';

interface BuildOpts {
  /** Stub PairingStore — defaults to undefined (no ACL enforcement) */
  pairingStore?: Parameters<typeof registerInboxApi>[1]['pairingStore'];
  /** Stub mesh.getPeer — defaults to returning undefined */
  getPeer?: (id: string) => unknown;
}

async function buildServer(opts: BuildOpts = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'tlmcp-inbox-api-'));
  const inbox = new AgentInbox(tmp);
  // Minimal MeshManager stub — only the properties the API actually reads.
  const mesh = {
    getPeer: opts.getPeer ?? (() => undefined),
  } as unknown as Parameters<typeof registerInboxApi>[1]['mesh'];
  const server: FastifyInstance = Fastify({ logger: false });
  registerInboxApi(server, {
    inbox,
    mesh,
    ownAgentId: OWN_ID,
    ownPublicKeyPem: '-----dummy-----',
    ownPrivateKeyPem: '-----dummy-----',
    pairingStore: opts.pairingStore,
  });
  await server.ready();
  return {
    server,
    inbox,
    cleanup: async () => {
      await server.close();
      inbox.close();
      rmSync(tmp, { recursive: true, force: true });
    },
  };
}

describe('inbox-api — ADR-005 per-agent-instance routing', () => {
  let ctx: Awaited<ReturnType<typeof buildServer>>;

  beforeEach(async () => {
    ctx = await buildServer();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  describe('POST /api/inbox/send with 4-component target', () => {
    it('takes the loopback path when the normalised URI matches ownAgentId', async () => {
      const res = await ctx.server.inject({
        method: 'POST',
        url: '/api/inbox/send',
        payload: { to: OWN_INSTANCE_ALPHA, body: 'hi' },
        remoteAddress: '127.0.0.1',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { delivery: string; inbox_status: string };
      expect(body.delivery).toBe('loopback');
      expect(body.inbox_status).toBe('delivered');

      const stored = ctx.inbox.list();
      expect(stored).toHaveLength(1);
      expect(stored[0]!.to_agent_instance).toBe('alpha');
      expect(stored[0]!.to_agent).toBe(OWN_ID);
    });

    it('rejects a malformed `to` with 400', async () => {
      const res = await ctx.server.inject({
        method: 'POST',
        url: '/api/inbox/send',
        payload: { to: 'not-a-spiffe-uri', body: 'x' },
        remoteAddress: '127.0.0.1',
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /api/inbox with for_instance filter', () => {
    beforeEach(async () => {
      // Seed the inbox with two instance-targeted messages and one legacy.
      await ctx.server.inject({
        method: 'POST',
        url: '/api/inbox/send',
        payload: { to: OWN_INSTANCE_ALPHA, body: 'for alpha' },
        remoteAddress: '127.0.0.1',
      });
      await ctx.server.inject({
        method: 'POST',
        url: '/api/inbox/send',
        payload: { to: OWN_INSTANCE_BETA, body: 'for beta' },
        remoteAddress: '127.0.0.1',
      });
      await ctx.server.inject({
        method: 'POST',
        url: '/api/inbox/send',
        payload: { to: OWN_ID, body: 'legacy daemon-wide' },
        remoteAddress: '127.0.0.1',
      });
    });

    it('returns all 3 when no filter is set', async () => {
      const res = await ctx.server.inject({
        method: 'GET',
        url: '/api/inbox',
        remoteAddress: '127.0.0.1',
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { count: number }).count).toBe(3);
    });

    it('isolates alpha via for_instance=alpha', async () => {
      const res = await ctx.server.inject({
        method: 'GET',
        url: '/api/inbox?for_instance=alpha',
        remoteAddress: '127.0.0.1',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        count: number;
        for_instance: string;
        messages: Array<{ body: unknown; to_instance: string }>;
      };
      expect(body.count).toBe(1);
      expect(body.for_instance).toBe('alpha');
      expect(body.messages[0]!.to_instance).toBe('alpha');
    });

    it('includes legacy rows when include_legacy=true', async () => {
      const res = await ctx.server.inject({
        method: 'GET',
        url: '/api/inbox?for_instance=alpha&include_legacy=true',
        remoteAddress: '127.0.0.1',
      });
      const body = res.json() as { count: number; include_legacy: boolean };
      expect(body.count).toBe(2);
      expect(body.include_legacy).toBe(true);
    });

    it('rejects a malformed for_instance with 400', async () => {
      const res = await ctx.server.inject({
        method: 'GET',
        url: '/api/inbox?for_instance=bad/slash',
        remoteAddress: '127.0.0.1',
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /api/inbox/unread with for_instance', () => {
    beforeEach(async () => {
      await ctx.server.inject({
        method: 'POST',
        url: '/api/inbox/send',
        payload: { to: OWN_INSTANCE_ALPHA, body: 'a' },
        remoteAddress: '127.0.0.1',
      });
      await ctx.server.inject({
        method: 'POST',
        url: '/api/inbox/send',
        payload: { to: OWN_INSTANCE_BETA, body: 'b' },
        remoteAddress: '127.0.0.1',
      });
    });

    it('counts only the matching instance', async () => {
      const res = await ctx.server.inject({
        method: 'GET',
        url: '/api/inbox/unread?for_instance=alpha',
        remoteAddress: '127.0.0.1',
      });
      expect((res.json() as { unread_count: number }).unread_count).toBe(1);
    });

    it('rejects a malformed for_instance', async () => {
      const res = await ctx.server.inject({
        method: 'GET',
        url: '/api/inbox/unread?for_instance=..%2Fetc%2Fpasswd',
        remoteAddress: '127.0.0.1',
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /api/inbox/send — per-peer ACL (pairingStore)', () => {
    let aclCtx: Awaited<ReturnType<typeof buildServer>>;

    afterEach(async () => {
      await aclCtx?.cleanup();
    });

    it('blocks outbound send to a discovered-but-unpaired peer with 403', async () => {
      const pairingStub = {
        isPaired: (_id: string) => false,
      } as unknown as Parameters<typeof registerInboxApi>[1]['pairingStore'];
      aclCtx = await buildServer({
        pairingStore: pairingStub,
        getPeer: (id: string) =>
          id === REMOTE_PEER_ID ? { agentId: REMOTE_PEER_ID, endpoint: 'https://10.10.10.99:9440' } : undefined,
      });
      const res = await aclCtx.server.inject({
        method: 'POST',
        url: '/api/inbox/send',
        payload: { to: REMOTE_PEER_ID, body: 'should be blocked' },
        remoteAddress: '127.0.0.1',
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: 'peer not paired' });
    });

    it('allows outbound send when peer is paired (reaches sign step)', async () => {
      const pairingStub = {
        isPaired: (id: string) => id === REMOTE_PEER_ID,
      } as unknown as Parameters<typeof registerInboxApi>[1]['pairingStore'];
      aclCtx = await buildServer({
        pairingStore: pairingStub,
        getPeer: (id: string) =>
          id === REMOTE_PEER_ID ? { agentId: REMOTE_PEER_ID, endpoint: 'https://10.10.10.99:9440' } : undefined,
      });
      const res = await aclCtx.server.inject({
        method: 'POST',
        url: '/api/inbox/send',
        payload: { to: REMOTE_PEER_ID, body: 'should pass ACL' },
        remoteAddress: '127.0.0.1',
      });
      // Will fail at sign step (dummy key) — 500 (internal) or 502 (fetch fail).
      // The important thing: it passed the 403 ACL gate.
      expect(res.statusCode).not.toBe(403);
    });

    it('skips ACL check when no pairingStore is provided (backwards compat)', async () => {
      aclCtx = await buildServer({
        getPeer: (id: string) =>
          id === REMOTE_PEER_ID ? { agentId: REMOTE_PEER_ID, endpoint: 'https://10.10.10.99:9440' } : undefined,
      });
      const res = await aclCtx.server.inject({
        method: 'POST',
        url: '/api/inbox/send',
        payload: { to: REMOTE_PEER_ID, body: 'no ACL' },
        remoteAddress: '127.0.0.1',
      });
      // Without pairingStore, ACL is not enforced, reaches sign step → 500/502
      expect(res.statusCode).not.toBe(403);
    });
  });
});
