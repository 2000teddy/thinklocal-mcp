// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * Unit-Tests für ADR-028 D4-b / v5 Spur 3 T3.2 — Fastify-Live-Wiring des MCP-Ingress
 * (`mcp-ingress-api.ts`). Deckt:
 *  - `extractCanonicalSender`: D3-Sender-Ableitung aus dem mTLS-Client-Cert (fail-closed).
 *  - Handler: 403 bei ungültigem/fehlendem Cert, 400 leerer Server, 503 kein Provider,
 *    501 (remote-forward-only Executor deferred → T3.3) für einen routbaren Dispatch,
 *    501 für local-exec (Q1 zurückgestellt).
 * KEIN echter TLS-Server / kein Net-Egress — Socket + Reply werden gefaked.
 */
import { describe, it, expect } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Capability } from './registry.js';
import type { McpForwardPeer } from './mcp-forward.js';
import {
  extractCanonicalSender,
  makeMcpIngressHandler,
  type McpIngressApiDeps,
  type PeerCertSocket,
} from './mcp-ingress-api.js';
import { MCP_HOP_HEADER, type McpDispatchExecutor, type McpForwardContext } from './mcp-forward-executor.js';

const SELF = 'spiffe://thinklocal/node/12D3KooWSELF';
const OWNER = 'spiffe://thinklocal/node/12D3KooWOWNER';
const CALLER = 'spiffe://thinklocal/node/12D3KooWCALLER';

const san = (uri: string): string => `URI:${uri}`;

const cap = (overrides: Partial<Capability> = {}): Capability => ({
  skill_id: 'mcp:unifi',
  version: '1.0.0',
  description: 'UniFi',
  agent_id: OWNER,
  health: 'healthy',
  trust_level: 4,
  updated_at: '2026-06-23T00:00:00.000Z',
  category: 'mcp',
  permissions: [],
  ...overrides,
});

// --- extractCanonicalSender (rein) ---------------------------------------

describe('extractCanonicalSender', () => {
  it('null bei nicht-vorhandenem Socket', () => {
    expect(extractCanonicalSender(undefined)).toBeNull();
    expect(extractCanonicalSender(null)).toBeNull();
  });

  it('null wenn der Socket nicht TLS-authorized ist (auch mit Cert)', () => {
    const sock: PeerCertSocket = {
      authorized: false,
      getPeerCertificate: () => ({ subjectaltname: san(CALLER) }),
    };
    expect(extractCanonicalSender(sock)).toBeNull();
  });

  it('null wenn getPeerCertificate fehlt', () => {
    expect(extractCanonicalSender({ authorized: true })).toBeNull();
  });

  it('null bei nur Legacy-SAN (canonical-only Endpoint)', () => {
    const sock: PeerCertSocket = {
      authorized: true,
      getPeerCertificate: () => ({ subjectaltname: san('spiffe://thinklocal/host/th01/agent/claude') }),
    };
    expect(extractCanonicalSender(sock)).toBeNull();
  });

  it('CR-M1: verwirft malformte canonical-artige SANs (kein loser Prefix-Match)', () => {
    const bad = (uri: string): PeerCertSocket => ({
      authorized: true,
      getPeerCertificate: () => ({ subjectaltname: san(uri) }),
    });
    // leerer PeerID, Sub-Pfad, unerlaubte Zeichen → alle null (strikte Validierung).
    expect(extractCanonicalSender(bad('spiffe://thinklocal/node/'))).toBeNull();
    expect(extractCanonicalSender(bad('spiffe://thinklocal/node/evil/extra'))).toBeNull();
    expect(extractCanonicalSender(bad('spiffe://thinklocal/node/x?y#z'))).toBeNull();
  });

  it('liefert die kanonische node/<PeerID>-SAN', () => {
    const sock: PeerCertSocket = {
      authorized: true,
      getPeerCertificate: () => ({
        // Migrations-Cert kann Legacy + Canonical tragen — canonical gewinnt.
        subjectaltname: `${san('spiffe://thinklocal/host/th01/agent/claude')}, ${san(CALLER)}`,
      }),
    };
    expect(extractCanonicalSender(sock)).toBe(CALLER);
  });
});

// --- Handler (gefakte Fastify request/reply) ------------------------------

interface CapturedReply {
  status?: number;
  body?: unknown;
  reply: FastifyReply;
}
function makeReply(): CapturedReply {
  const captured: CapturedReply = { reply: undefined as unknown as FastifyReply };
  const reply = {
    code(status: number): FastifyReply {
      captured.status = status;
      return this as unknown as FastifyReply;
    },
    async send(body: unknown): Promise<FastifyReply> {
      captured.body = body;
      return this as unknown as FastifyReply;
    },
  };
  captured.reply = reply as unknown as FastifyReply;
  return captured;
}

function makeRequest(
  server: string,
  socket: PeerCertSocket,
  body?: unknown,
  headers: Record<string, string> = {},
): FastifyRequest {
  return {
    params: { server },
    body,
    headers,
    raw: { socket },
  } as unknown as FastifyRequest;
}

const authorizedSocket = (uri: string): PeerCertSocket => ({
  authorized: true,
  getPeerCertificate: () => ({ subjectaltname: san(uri) }),
});

const peerMap =
  (...peers: McpForwardPeer[]) =>
  (id: string): McpForwardPeer | undefined =>
    peers.find((p) => p.agentId === id);

const baseDeps = (over: Partial<McpIngressApiDeps> = {}): McpIngressApiDeps => ({
  selfAgentId: SELF,
  resolvePeer: peerMap({ agentId: OWNER, endpoint: 'https://10.10.10.82:9440' }),
  getCapabilities: () => [cap()],
  requireServerIdentity: false,
  ...over,
});

async function run(req: FastifyRequest, deps: McpIngressApiDeps): Promise<CapturedReply> {
  const rep = makeReply();
  await makeMcpIngressHandler(deps)(req, rep.reply);
  return rep;
}

describe('makeMcpIngressHandler', () => {
  it('403 bei fehlendem Client-Cert (unauthorized Socket)', async () => {
    const rep = await run(makeRequest('unifi', { authorized: false }), baseDeps());
    expect(rep.status).toBe(403);
  });

  it('403 bei nur Legacy-Cert (kein canonical node/<PeerID>)', async () => {
    const sock = authorizedSocket('spiffe://thinklocal/host/th01/agent/claude');
    const rep = await run(makeRequest('unifi', sock), baseDeps());
    expect(rep.status).toBe(403);
  });

  it('CR-M1: 403 bei malformter canonical-artiger SAN (node/evil/extra)', async () => {
    const sock = authorizedSocket('spiffe://thinklocal/node/evil/extra');
    const rep = await run(makeRequest('unifi', sock), baseDeps());
    expect(rep.status).toBe(403);
  });

  it('400 bei leerem Servernamen (nach erfolgreicher Auth)', async () => {
    const rep = await run(makeRequest('   ', authorizedSocket(CALLER)), baseDeps());
    expect(rep.status).toBe(400);
  });

  it('503 wenn kein Provider den Server serviert', async () => {
    const rep = await run(
      makeRequest('unifi', authorizedSocket(CALLER)),
      baseDeps({ getCapabilities: () => [] }),
    );
    expect(rep.status).toBe(503);
  });

  it('ohne injizierten Executor: routbarer Owner → 501 (Stub)', async () => {
    const rep = await run(makeRequest('unifi', authorizedSocket(CALLER)), baseDeps());
    expect(rep.status).toBe(501);
    expect((rep.body as { error?: string }).error).toMatch(/not wired/);
  });

  it('ohne Executor, eigener Node serviert → 501 local deferred (Q1)', async () => {
    const rep = await run(
      makeRequest('unifi', authorizedSocket(CALLER)),
      baseDeps({ getCapabilities: () => [cap({ agent_id: SELF })] }),
    );
    expect(rep.status).toBe(501);
    expect((rep.body as { error?: string }).error).toMatch(/local-exec deferred/);
  });
});

describe('makeMcpIngressHandler — T3.3 Executor-Wiring (Hop, Payload, Audit)', () => {
  function captureExec(): { ctxs: McpForwardContext[]; exec: McpDispatchExecutor } {
    const ctxs: McpForwardContext[] = [];
    const exec: McpDispatchExecutor = async (_dispatch, ctx) => {
      ctxs.push(ctx);
      return { status: 200, body: { ok: true } };
    };
    return {
      ctxs,
      exec,
    };
  }
  function captureAudit(): { events: Array<[string, string, string]>; fn: McpIngressApiDeps['audit'] } {
    const events: Array<[string, string, string]> = [];
    return { events, fn: (e, p, d) => events.push([e, p, d]) };
  }

  it('reicht incomingHop (aus Header), Payload und Servername an den Executor durch', async () => {
    const cap0 = captureExec();
    // Read-Tool (self), damit der Call den Executor erreicht (das Tier-Gate ist separat getestet);
    // ein tools/call OHNE params.name ist jetzt fail-closed gegatet (TL07 Werkzeug-Stufe).
    const payload = { jsonrpc: '2.0', method: 'tools/call', params: { name: 'list_clients' } };
    const rep = await run(
      makeRequest('unifi', authorizedSocket(CALLER), payload, { [MCP_HOP_HEADER]: '1' }),
      baseDeps({ execute: cap0.exec }),
    );
    expect(rep.status).toBe(200);
    expect(cap0.ctxs[0]?.incomingHop).toBe(1);
    expect(cap0.ctxs[0]?.payload).toEqual(payload);
    expect(cap0.ctxs[0]?.server).toBe('unifi');
  });

  it('fehlender/ungültiger Hop-Header → incomingHop 0', async () => {
    const cap0 = captureExec();
    await run(makeRequest('unifi', authorizedSocket(CALLER), {}, { [MCP_HOP_HEADER]: 'garbage' }), baseDeps({ execute: cap0.exec }));
    expect(cap0.ctxs[0]?.incomingHop).toBe(0);
  });

  it('Audit RX bei akzeptiertem Call, REJECT bei 403', async () => {
    const okAudit = captureAudit();
    await run(makeRequest('unifi', authorizedSocket(CALLER)), baseDeps({ execute: captureExec().exec, audit: okAudit.fn }));
    expect(okAudit.events.some(([e]) => e === 'MCP_PROXY_RX')).toBe(true);

    const rejAudit = captureAudit();
    await run(makeRequest('unifi', { authorized: false }), baseDeps({ execute: captureExec().exec, audit: rejAudit.fn }));
    expect(rejAudit.events.some(([e]) => e === 'MCP_FORWARD_REJECT')).toBe(true);
  });

  // ADR-033 CR-MEDIUM: Tier-Verweigerung im REJECT-Audit-Detail von einer Sender-Auth-Ablehnung
  // unterscheidbar (beide 403). Die gate-Cap erzwingt eine Tier-403 im Handler (VOR dem Executor).
  it('Tier-403 wird als REJECT mit `tier=` auditiert (unterscheidbar von Auth-403)', async () => {
    const tierAudit = captureAudit();
    const rep = await run(
      makeRequest('unifi', authorizedSocket(CALLER)),
      baseDeps({ getCapabilities: () => [cap({ permissions: ['write'] })], execute: captureExec().exec, audit: tierAudit.fn }),
    );
    expect(rep.status).toBe(403);
    const rej = tierAudit.events.find(([e]) => e === 'MCP_FORWARD_REJECT');
    expect(rej).toBeDefined();
    expect(rej?.[2]).toContain('tier=gate');

    // Gegenprobe: Auth-403 trägt KEIN tier= (klar unterscheidbar).
    const authAudit = captureAudit();
    await run(makeRequest('unifi', { authorized: false }), baseDeps({ execute: captureExec().exec, audit: authAudit.fn }));
    const authRej = authAudit.events.find(([e]) => e === 'MCP_FORWARD_REJECT');
    expect(authRej?.[2]).not.toContain('tier=');
  });
});
