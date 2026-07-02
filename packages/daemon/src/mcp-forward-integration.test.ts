/**
 * mcp-forward-integration.test.ts — Naht-Integrationstest für den MCP-Proxy-Forward-Pfad
 * (v5 Spur 3, Modell B; T3.2+T3.3). Schließt die Lücke zwischen den bestehenden Unit-Tests,
 * die den Ingress-Handler mit einem **gemockten** Executor bzw. den Executor mit gemocktem
 * `httpForward`/`fetch` je isoliert prüfen.
 *
 * Hier wird die ECHTE Naht verdrahtet:
 *   makeMcpIngressHandler ─(execute)→ createMcpForwardExecutor ─(httpForward)→ createUndiciMcpForward
 * und nur die äußerste Primitive (`fetch`) gegen einen Stub-Owner ersetzt. Damit wird
 * bewiesen, dass die Teile zusammen den Contract halten:
 *   - D3-Sender aus dem Client-Cert erreicht den Executor,
 *   - der ausgehende Hop = incomingHop+1 wird von createUndiciMcpForward real gesetzt,
 *   - Payload/Servername/Owner-URL werden korrekt an den Owner-Call durchgereicht,
 *   - die Owner-Antwort (JSON/Non-JSON/5xx) fließt unverändert zum Client zurück,
 *   - beidseitiges Audit (Executor MCP_FORWARD_TX + Ingress MCP_PROXY_RX) feuert,
 *   - 1-Hop-Guard (502) und local-exec-deferred (501) greifen ohne Net-Egress.
 *
 * KEIN echter Net-Egress (fetch gestubbt), KEIN TLS-Handshake (requireServerIdentity=false,
 * synthetisches TLS-Material; der gestubbte fetch ignoriert den Dispatcher).
 */
import { describe, it, expect, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { fetch as undiciFetch } from 'undici';
import type { Capability } from './registry.js';
import type { McpForwardPeer } from './mcp-forward.js';
import {
  makeMcpIngressHandler,
  type McpIngressApiDeps,
  type McpIngressAuditFn,
  type PeerCertSocket,
} from './mcp-ingress-api.js';
import {
  createMcpForwardExecutor,
  createUndiciMcpForward,
  MCP_HOP_HEADER,
  type McpAuditFn,
} from './mcp-forward-executor.js';
import type { MeshTlsMaterial, OutboundConnectPolicy } from './mesh-connect.js';

const SELF = 'spiffe://thinklocal/node/12D3KooWSELF';
const OWNER = 'spiffe://thinklocal/node/12D3KooWOWNER';
const CALLER = 'spiffe://thinklocal/node/12D3KooWCALLER';
const OWNER_ENDPOINT = 'https://10.10.10.82:9440';

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

// --- gefakte Fastify request/reply (wie im Unit-Test) ---------------------
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
  return { params: { server }, body, headers, raw: { socket } } as unknown as FastifyRequest;
}
const authorizedSocket = (uri: string): PeerCertSocket => ({
  authorized: true,
  getPeerCertificate: () => ({ subjectaltname: san(uri) }),
});
const peerMap =
  (...peers: McpForwardPeer[]) =>
  (id: string): McpForwardPeer | undefined =>
    peers.find((p) => p.agentId === id);

// --- echte Naht: Ingress → Executor → Undici-Forward (nur fetch gestubbt) ---
const SYNTH_TLS: MeshTlsMaterial = { ca: 'ca', cert: 'cert', key: 'key' };
const OUTBOUND_POLICY: OutboundConnectPolicy = {
  debug: false,
  disablePinning: false,
  spiffeServerIdentity: false,
};

interface Wiring {
  handler: (req: FastifyRequest, rep: FastifyReply) => Promise<void>;
  fetchStub: ReturnType<typeof vi.fn>;
  txAudit: Array<{ event: string; peer: string; details: string }>;
  rxAudit: Array<{ event: string; peer: string; details: string }>;
}

/** Verdrahtet die echten Module; `fetchStub` spielt den Owner. */
function wire(
  fetchStub: ReturnType<typeof vi.fn>,
  capOverride: Partial<Capability> = {},
  ownerAgentId = OWNER,
): Wiring {
  const txAudit: Wiring['txAudit'] = [];
  const rxAudit: Wiring['rxAudit'] = [];
  const execAudit: McpAuditFn = (event, peer, details) => txAudit.push({ event, peer, details });
  const ingressAudit: McpIngressAuditFn = (event, peer, details) => rxAudit.push({ event, peer, details });

  const { forward } = createUndiciMcpForward({
    tls: SYNTH_TLS,
    outboundPolicy: OUTBOUND_POLICY,
    fetchImpl: fetchStub as unknown as typeof undiciFetch,
  });
  const execute = createMcpForwardExecutor({ selfAgentId: SELF, httpForward: forward, audit: execAudit });

  const deps: McpIngressApiDeps = {
    selfAgentId: SELF,
    resolvePeer: peerMap({ agentId: ownerAgentId, endpoint: OWNER_ENDPOINT }),
    getCapabilities: () => [cap({ agent_id: ownerAgentId, ...capOverride })],
    requireServerIdentity: false,
    execute,
    audit: ingressAudit,
  };
  return { handler: makeMcpIngressHandler(deps), fetchStub, txAudit, rxAudit };
}

/** Owner-Antwort als undici-Response-artiges Objekt (nur was createUndiciMcpForward liest). */
const ownerResponse = (status: number, text: string): { status: number; text: () => Promise<string> } => ({
  status,
  text: () => Promise.resolve(text),
});

describe('MCP-Forward-Naht: Ingress → Executor → Undici-Forward (nur fetch gestubbt)', () => {
  it('Happy-Path: forwardet an den Owner mit hop=1, reicht Payload+URL durch und gibt die 200-Antwort zurück', async () => {
    const fetchStub = vi.fn().mockResolvedValue(ownerResponse(200, JSON.stringify({ ok: true, tool: 'list_clients' })));
    const w = wire(fetchStub);
    const payload = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_clients' } };
    const rep = makeReply();
    await w.handler(makeRequest('unifi', authorizedSocket(CALLER), payload), rep.reply);

    // Client-Antwort = Owner-Antwort, unverändert durchgereicht.
    expect(rep.status).toBe(200);
    expect(rep.body).toEqual({ ok: true, tool: 'list_clients' });

    // Der reale Undici-Forward wurde genau einmal aufgerufen — mit korrekter URL, Hop=1, Payload.
    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchStub.mock.calls[0] as [string, { headers: Record<string, string>; body: string; method: string }];
    expect(url).toBe(`${OWNER_ENDPOINT}/api/mcp/unifi`);
    expect(opts.method).toBe('POST');
    expect(opts.headers[MCP_HOP_HEADER]).toBe('1'); // incomingHop 0 → +1
    expect(JSON.parse(opts.body)).toEqual(payload);

    // Beidseitiges Audit: Executor-TX + Ingress-RX, kein Reject.
    expect(w.txAudit).toEqual([{ event: 'MCP_FORWARD_TX', peer: OWNER, details: expect.stringContaining('unifi') }]);
    expect(w.rxAudit).toHaveLength(1);
    expect(w.rxAudit[0]).toMatchObject({ event: 'MCP_PROXY_RX', peer: CALLER });
    expect(w.rxAudit[0].details).toContain('hop=0');
  });

  it('1-Hop-Guard: ein bereits geforwardeter Call (hop=1) wird mit 502 abgelehnt, OHNE Owner-Fetch', async () => {
    const fetchStub = vi.fn();
    const w = wire(fetchStub);
    const rep = makeReply();
    await w.handler(
      makeRequest('unifi', authorizedSocket(CALLER), { jsonrpc: '2.0' }, { [MCP_HOP_HEADER]: '1' }),
      rep.reply,
    );

    expect(rep.status).toBe(502);
    expect(fetchStub).not.toHaveBeenCalled();
    // Executor auditiert Hop-Limit-Reject; Ingress auditiert 5xx als REJECT.
    expect(w.txAudit).toEqual([{ event: 'MCP_FORWARD_REJECT', peer: OWNER, details: expect.stringContaining('hop-limit') }]);
    expect(w.rxAudit[0]).toMatchObject({ event: 'MCP_FORWARD_REJECT', peer: CALLER });
  });

  it('local-exec deferred (Q1): Provider == self → 501, OHNE Owner-Fetch', async () => {
    const fetchStub = vi.fn();
    // Provider ist der eigene Node → dispatch=local → Executor 501 (remote-forward-only).
    const w = wire(fetchStub, { agent_id: SELF }, SELF);
    const rep = makeReply();
    await w.handler(makeRequest('unifi', authorizedSocket(CALLER), { jsonrpc: '2.0' }), rep.reply);

    expect(rep.status).toBe(501);
    expect(fetchStub).not.toHaveBeenCalled();
    expect(w.txAudit[0]).toMatchObject({ event: 'MCP_FORWARD_REJECT' });
    expect(w.txAudit[0].details).toContain('local-exec deferred');
  });

  it('Owner-5xx: eine 503 vom Owner wird durchgereicht und beidseitig als REJECT auditiert', async () => {
    const fetchStub = vi.fn().mockResolvedValue(ownerResponse(503, JSON.stringify({ error: 'owner busy' })));
    const w = wire(fetchStub);
    const rep = makeReply();
    await w.handler(makeRequest('unifi', authorizedSocket(CALLER), { jsonrpc: '2.0' }), rep.reply);

    expect(rep.status).toBe(503);
    expect(rep.body).toEqual({ error: 'owner busy' });
    expect(fetchStub).toHaveBeenCalledTimes(1);
    // Executor: TX-Versuch + forward-failed-REJECT (CR-M4); Ingress: 5xx → REJECT.
    expect(w.txAudit.map((a) => a.event)).toEqual(['MCP_FORWARD_TX', 'MCP_FORWARD_REJECT']);
    expect(w.rxAudit[0]).toMatchObject({ event: 'MCP_FORWARD_REJECT' });
  });

  it('Non-JSON-Owner-Antwort wird als Text unverändert durchgereicht (200)', async () => {
    const fetchStub = vi.fn().mockResolvedValue(ownerResponse(200, 'plain-text-not-json'));
    const w = wire(fetchStub);
    const rep = makeReply();
    await w.handler(makeRequest('unifi', authorizedSocket(CALLER), { jsonrpc: '2.0' }), rep.reply);

    expect(rep.status).toBe(200);
    expect(rep.body).toBe('plain-text-not-json');
    expect(w.txAudit[0]).toMatchObject({ event: 'MCP_FORWARD_TX' });
    expect(w.rxAudit[0]).toMatchObject({ event: 'MCP_PROXY_RX' });
  });
});
