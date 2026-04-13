/**
 * token-api.test.ts — Tests fuer Token-Onboarding REST API (ADR-016 Phase 2)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { registerTokenApi, type TokenApiDeps } from './token-api.js';
import { TokenStore } from './token-store.js';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMeshCA } from './tls.js';

// Minimal PairingStore mock
function mockPairingStore() {
  const peers: Array<{ agentId: string }> = [];
  return {
    addPeer: (p: { agentId: string }) => { peers.push(p); },
    getAllPeers: () => peers,
    isPaired: (id: string) => peers.some(p => p.agentId === id),
    removePeer: () => {},
    getPeer: () => undefined,
    _peers: peers,
  };
}

// Minimal AuditLog mock
function mockAudit() {
  const events: Array<{ type: string; agent: string; detail?: string }> = [];
  return {
    append: (type: string, agent: string, detail?: string) => { events.push({ type, agent, detail }); },
    _events: events,
  };
}

describe('Token API', () => {
  let dataDir: string;
  let tokenStore: TokenStore;
  let app: ReturnType<typeof Fastify>;
  let caBundle: ReturnType<typeof createMeshCA>;
  let pairingStore: ReturnType<typeof mockPairingStore>;
  let audit: ReturnType<typeof mockAudit>;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'token-api-test-'));
    tokenStore = new TokenStore(dataDir);
    caBundle = createMeshCA('test-mesh', 'test-node');
    pairingStore = mockPairingStore();
    audit = mockAudit();

    app = Fastify();
    registerTokenApi(app, {
      tokenStore,
      pairingStore: pairingStore as any,
      audit: audit as any,
      caBundle,
      ownAgentId: 'spiffe://thinklocal/host/admin/agent/claude-code',
      log: undefined,
    });

    await app.listen({ port: 0, host: '127.0.0.1' });
  });

  afterEach(async () => {
    await app.close();
    tokenStore.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  function baseUrl(): string {
    const addr = app.server.address();
    if (typeof addr === 'string') return addr;
    return `http://127.0.0.1:${addr!.port}`;
  }

  // ---- POST /api/token/create ----

  describe('POST /api/token/create', () => {
    it('creates a token with name', async () => {
      const res = await fetch(`${baseUrl()}/api/token/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'test-node' }),
      });
      expect(res.status).toBe(200);
      const data = await res.json() as { token: string; id: string; name: string };
      expect(data.token).toMatch(/^tlmcp_/);
      expect(data.id).toBeTruthy();
      expect(data.name).toBe('test-node');
    });

    it('creates a token with custom TTL', async () => {
      const res = await fetch(`${baseUrl()}/api/token/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'ttl-test', ttl_hours: 1 }),
      });
      expect(res.status).toBe(200);
      const data = await res.json() as { expires_at: string };
      const expiresAt = new Date(data.expires_at).getTime();
      const now = Date.now();
      // Should expire roughly in 1 hour (± 10s)
      expect(expiresAt - now).toBeLessThan(3610_000);
      expect(expiresAt - now).toBeGreaterThan(3590_000);
    });

    it('rejects missing name', async () => {
      const res = await fetch(`${baseUrl()}/api/token/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it('rejects TTL > 7 days', async () => {
      const res = await fetch(`${baseUrl()}/api/token/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'too-long', ttl_hours: 200 }),
      });
      expect(res.status).toBe(400);
    });
  });

  // ---- GET /api/token/list ----

  describe('GET /api/token/list', () => {
    it('returns empty list initially', async () => {
      const res = await fetch(`${baseUrl()}/api/token/list`);
      expect(res.status).toBe(200);
      const data = await res.json() as { tokens: unknown[]; count: number };
      expect(data.count).toBe(0);
      expect(data.tokens).toEqual([]);
    });

    it('returns created tokens', async () => {
      // Create a token first
      await fetch(`${baseUrl()}/api/token/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'list-test' }),
      });

      const res = await fetch(`${baseUrl()}/api/token/list`);
      const data = await res.json() as { count: number };
      expect(data.count).toBe(1);
    });
  });

  // ---- POST /api/token/revoke ----

  describe('POST /api/token/revoke', () => {
    it('revokes an existing token', async () => {
      const createRes = await fetch(`${baseUrl()}/api/token/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'revoke-test' }),
      });
      const { id } = await createRes.json() as { id: string };

      const res = await fetch(`${baseUrl()}/api/token/revoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      expect(res.status).toBe(200);
      const data = await res.json() as { status: string };
      expect(data.status).toBe('revoked');
    });

    it('returns 404 for non-existent token', async () => {
      const res = await fetch(`${baseUrl()}/api/token/revoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'nonexistent' }),
      });
      expect(res.status).toBe(404);
    });
  });

  // ---- POST /onboarding/join ----

  describe('POST /onboarding/join', () => {
    it('joins with a valid token and receives certs', async () => {
      // Create token
      const createRes = await fetch(`${baseUrl()}/api/token/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'join-test' }),
      });
      const { token } = await createRes.json() as { token: string };

      // Join with token
      const res = await fetch(`${baseUrl()}/onboarding/join`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          hostname: 'new-node',
          agent_id: 'spiffe://thinklocal/host/new/agent/claude-code',
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json() as {
        signed_cert_pem: string;
        key_pem: string;
        ca_cert_pem: string;
        admin_agent_id: string;
        mesh_name: string;
      };

      expect(data.signed_cert_pem).toContain('BEGIN CERTIFICATE');
      expect(data.key_pem).toContain('BEGIN RSA PRIVATE KEY');
      expect(data.ca_cert_pem).toContain('BEGIN CERTIFICATE');
      expect(data.admin_agent_id).toContain('spiffe://');
      expect(data.mesh_name).toBe('thinklocal');
    });

    it('registers the new node as a paired peer', async () => {
      const createRes = await fetch(`${baseUrl()}/api/token/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'peer-test' }),
      });
      const { token } = await createRes.json() as { token: string };

      await fetch(`${baseUrl()}/onboarding/join`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          hostname: 'peer-node',
          agent_id: 'spiffe://thinklocal/host/peer/agent/codex',
        }),
      });

      expect(pairingStore._peers.length).toBe(1);
      expect(pairingStore._peers[0].agentId).toBe('spiffe://thinklocal/host/peer/agent/codex');
    });

    it('rejects without Authorization header', async () => {
      const res = await fetch(`${baseUrl()}/onboarding/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hostname: 'x', agent_id: 'x' }),
      });
      expect(res.status).toBe(401);
    });

    it('rejects with invalid token', async () => {
      const res = await fetch(`${baseUrl()}/onboarding/join`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer tlmcp_invalidtoken123',
        },
        body: JSON.stringify({ hostname: 'x', agent_id: 'x' }),
      });
      expect(res.status).toBe(403);
    });

    it('rejects second use of same token (single-use)', async () => {
      const createRes = await fetch(`${baseUrl()}/api/token/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'single-use-test' }),
      });
      const { token } = await createRes.json() as { token: string };

      // First join succeeds
      const res1 = await fetch(`${baseUrl()}/onboarding/join`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          hostname: 'node-1',
          agent_id: 'spiffe://thinklocal/host/1/agent/claude-code',
        }),
      });
      expect(res1.status).toBe(200);

      // Second join with same token fails
      const res2 = await fetch(`${baseUrl()}/onboarding/join`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          hostname: 'node-2',
          agent_id: 'spiffe://thinklocal/host/2/agent/codex',
        }),
      });
      expect(res2.status).toBe(403);
    });

    it('rejects with revoked token', async () => {
      const createRes = await fetch(`${baseUrl()}/api/token/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'revoke-join-test' }),
      });
      const { token, id } = await createRes.json() as { token: string; id: string };

      // Revoke
      await fetch(`${baseUrl()}/api/token/revoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      });

      // Join with revoked token
      const res = await fetch(`${baseUrl()}/onboarding/join`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ hostname: 'x', agent_id: 'x' }),
      });
      expect(res.status).toBe(403);
    });

    it('audits token operations', async () => {
      const createRes = await fetch(`${baseUrl()}/api/token/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'audit-test' }),
      });
      const { token } = await createRes.json() as { token: string };

      await fetch(`${baseUrl()}/onboarding/join`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          hostname: 'audit-node',
          agent_id: 'spiffe://thinklocal/host/audit/agent/claude-code',
        }),
      });

      // Should have TOKEN_CREATE + TOKEN_JOIN_SUCCESS events
      expect(audit._events.some(e => e.type === 'TOKEN_CREATE')).toBe(true);
      expect(audit._events.some(e => e.type === 'TOKEN_JOIN_SUCCESS')).toBe(true);
    });
  });
});
