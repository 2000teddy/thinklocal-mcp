/**
 * Unit-Tests für ADR-028 D4-b / v5 Spur 3 T3.3 — Live-Forward-Executor
 * (`mcp-forward-executor.ts`). Deckt:
 *  - createMcpForwardExecutor: remote-forward (hop+1, Payload, Audit-TX), Self-Loop-Guard,
 *    1-Hop-Guard, local→501 (Q1), reject-Durchreichung (Pin-Violation 500).
 *  - createUndiciMcpForward (fetch injiziert): Success (Hop-Header/Body/URL), Non-JSON,
 *    Fehler→502, kein-TLS→503.
 * KEIN echter Net-Egress — die Netzwerk-Primitive bzw. `fetch` wird gefaked.
 */
import { describe, it, expect } from 'vitest';
import type { McpForwardDispatch } from './mcp-forward-dispatch.js';
import type { OutboundConnectPolicy } from './mesh-connect.js';
import {
  createMcpForwardExecutor,
  createUndiciMcpForward,
  MCP_HOP_HEADER,
  type McpForwardContext,
  type McpHttpForward,
  type McpHttpForwardRequest,
} from './mcp-forward-executor.js';

const SELF = 'spiffe://thinklocal/node/12D3KooWSELF';
const OWNER = 'spiffe://thinklocal/node/12D3KooWOWNER';
const TOFU_POLICY: OutboundConnectPolicy = { debug: false, disablePinning: false, spiffeServerIdentity: false };
const PIN_POLICY: OutboundConnectPolicy = { debug: false, disablePinning: false, spiffeServerIdentity: true };

const remote = (over: Partial<{ target: string; pin: boolean; expected?: string }> = {}): McpForwardDispatch => ({
  kind: 'remote',
  request: {
    url: `https://10.10.10.82:9440/api/mcp/unifi`,
    method: 'POST',
    targetAgentId: over.target ?? OWNER,
    senderUri: SELF,
    execution_tier: 'self',
    outboundPolicy: over.pin ? PIN_POLICY : TOFU_POLICY,
    serverIdentityPolicy: over.pin ? { expectedSpiffeId: over.expected ?? OWNER } : {},
  },
});
const local: McpForwardDispatch = { kind: 'local', server: 'unifi', execution_tier: 'self' };
const ctx = (over: Partial<McpForwardContext> = {}): McpForwardContext => ({
  incomingHop: 0,
  payload: { jsonrpc: '2.0', method: 'tools/list' },
  server: 'unifi',
  ...over,
});

function captureForward(): { calls: McpHttpForwardRequest[]; fn: McpHttpForward } {
  const calls: McpHttpForwardRequest[] = [];
  const fn: McpHttpForward = async (req) => {
    calls.push(req);
    return { status: 200, body: { ok: true } };
  };
  return { calls, fn };
}
function captureAudit(): { events: Array<[string, string, string]>; fn: (e: string, p: string, d: string) => void } {
  const events: Array<[string, string, string]> = [];
  return { events, fn: (e, p, d) => events.push([e, p, d]) };
}

describe('createMcpForwardExecutor', () => {
  it('remote: forwardet mit hop+1, Payload, Audit-TX', async () => {
    const fwd = captureForward();
    const aud = captureAudit();
    const exec = createMcpForwardExecutor({ selfAgentId: SELF, httpForward: fwd.fn, audit: aud.fn });
    const res = await exec(remote(), ctx({ incomingHop: 0 }));
    expect(res.status).toBe(200);
    expect(fwd.calls).toHaveLength(1);
    expect(fwd.calls[0]?.hop).toBe(1);
    expect(fwd.calls[0]?.url).toContain('/api/mcp/unifi');
    expect(fwd.calls[0]?.senderUri).toBe(SELF);
    expect(fwd.calls[0]?.payload).toEqual({ jsonrpc: '2.0', method: 'tools/list' });
    expect(aud.events.some(([e]) => e === 'MCP_FORWARD_TX')).toBe(true);
  });

  it('remote mit Pin: reicht expectedServerSpiffeId + requireServerIdentity durch', async () => {
    const fwd = captureForward();
    const exec = createMcpForwardExecutor({ selfAgentId: SELF, httpForward: fwd.fn });
    await exec(remote({ pin: true, expected: OWNER }), ctx());
    expect(fwd.calls[0]?.requireServerIdentity).toBe(true);
    expect(fwd.calls[0]?.expectedServerSpiffeId).toBe(OWNER);
  });

  it('Self-Loop-Guard: target==self → 508, KEIN Forward, Audit-REJECT', async () => {
    const fwd = captureForward();
    const aud = captureAudit();
    const exec = createMcpForwardExecutor({ selfAgentId: SELF, httpForward: fwd.fn, audit: aud.fn });
    const res = await exec(remote({ target: SELF }), ctx());
    expect(res.status).toBe(508);
    expect(fwd.calls).toHaveLength(0);
    expect(aud.events.some(([e]) => e === 'MCP_FORWARD_REJECT')).toBe(true);
  });

  it('1-Hop-Guard: incomingHop>=1 → 502, KEIN Re-Forward, Audit-REJECT', async () => {
    const fwd = captureForward();
    const aud = captureAudit();
    const exec = createMcpForwardExecutor({ selfAgentId: SELF, httpForward: fwd.fn, audit: aud.fn });
    const res = await exec(remote(), ctx({ incomingHop: 1 }));
    expect(res.status).toBe(502);
    expect(fwd.calls).toHaveLength(0);
    expect(aud.events.some(([e]) => e === 'MCP_FORWARD_REJECT')).toBe(true);
  });

  it('local → 501 (Q1 remote-forward-only), KEIN Forward', async () => {
    const fwd = captureForward();
    const exec = createMcpForwardExecutor({ selfAgentId: SELF, httpForward: fwd.fn });
    const res = await exec(local, ctx());
    expect(res.status).toBe(501);
    expect((res.body as { error?: string }).error).toMatch(/local-exec deferred/);
    expect(fwd.calls).toHaveLength(0);
  });

  it('CR-M4: local-Pfad (501) wird auditiert (MCP_FORWARD_REJECT)', async () => {
    const aud = captureAudit();
    const exec = createMcpForwardExecutor({ selfAgentId: SELF, httpForward: captureForward().fn, audit: aud.fn });
    await exec(local, ctx());
    expect(aud.events.some(([e]) => e === 'MCP_FORWARD_REJECT')).toBe(true);
  });

  it('CR-M4: fehlgeschlagener Forward (httpForward→502) → zusaetzlich REJECT auditiert', async () => {
    const aud = captureAudit();
    const failing: McpHttpForward = async () => ({ status: 502, body: { error: 'boom' } });
    const exec = createMcpForwardExecutor({ selfAgentId: SELF, httpForward: failing, audit: aud.fn });
    const res = await exec(remote(), ctx());
    expect(res.status).toBe(502);
    expect(aud.events.filter(([e]) => e === 'MCP_FORWARD_TX')).toHaveLength(1);
    expect(aud.events.some(([e, , d]) => e === 'MCP_FORWARD_REJECT' && d.includes('forward-failed'))).toBe(true);
  });

  it('Pin-Violation (Verifier an, kein expectedSpiffeId) → reject 500 durchgereicht + REJECT-Audit', async () => {
    const aud = captureAudit();
    const fwd = captureForward();
    const exec = createMcpForwardExecutor({ selfAgentId: SELF, httpForward: fwd.fn, audit: aud.fn });
    // outboundPolicy pin=on, aber serverIdentityPolicy leer → buildMcpExecSpec → 500.
    const bad: McpForwardDispatch = {
      kind: 'remote',
      request: {
        url: 'https://10.10.10.82:9440/api/mcp/unifi',
        method: 'POST',
        targetAgentId: OWNER,
        senderUri: SELF,
        execution_tier: 'self',
        outboundPolicy: PIN_POLICY,
        serverIdentityPolicy: {},
      },
    };
    const res = await exec(bad, ctx());
    expect(res.status).toBe(500);
    expect(fwd.calls).toHaveLength(0);
    expect(aud.events.some(([e]) => e === 'MCP_FORWARD_REJECT')).toBe(true);
  });
});

// Typisierter fetch-Mock-Helper: zentrale (einzige) Cast-Stelle → keine Return-Type-
// Warnungen in den einzelnen Tests, der übergebene Impl hat getypten Param-Kontext.
type FakeRes = { status: number; text: () => Promise<string> };
type FakeFetchImpl = (url: string, init: { headers: Record<string, string>; body: string }) => Promise<FakeRes>;
function fakeFetch(impl: FakeFetchImpl): typeof import('undici').fetch {
  return impl as unknown as typeof import('undici').fetch;
}

describe('createUndiciMcpForward (fetch injiziert)', () => {
  const tls = { ca: 'ca-pem', cert: 'cert-pem', key: 'key-pem' };
  const baseReq = (): McpHttpForwardRequest => ({
    url: 'https://10.10.10.82:9440/api/mcp/unifi',
    hop: 1,
    senderUri: SELF,
    payload: { jsonrpc: '2.0', method: 'tools/list' },
    targetAgentId: OWNER,
    requireServerIdentity: false,
    timeoutMs: 5000,
  });

  it('Success: setzt Hop-Header + content-type, sendet Payload, parst JSON-Antwort', async () => {
    let seenUrl = '';
    let seenHeaders: Record<string, string> = {};
    let seenBody = '';
    const fetchImpl = fakeFetch(async (url, init) => {
      seenUrl = String(url);
      seenHeaders = init.headers;
      seenBody = init.body;
      return { status: 200, text: async (): Promise<string> => JSON.stringify({ result: ['clientA'] }) };
    });
    const { forward, close } = createUndiciMcpForward({ tls, outboundPolicy: TOFU_POLICY, fetchImpl });
    const res = await forward(baseReq());
    close();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: ['clientA'] });
    expect(seenUrl).toContain('/api/mcp/unifi');
    expect(seenHeaders[MCP_HOP_HEADER]).toBe('1');
    expect(seenHeaders['content-type']).toBe('application/json');
    expect(JSON.parse(seenBody)).toEqual({ jsonrpc: '2.0', method: 'tools/list' });
  });

  it('Non-JSON-Antwort → Body als Text durchgereicht', async () => {
    const fetchImpl = fakeFetch(async () => ({ status: 200, text: async (): Promise<string> => 'plain-error' }));
    const { forward, close } = createUndiciMcpForward({ tls, outboundPolicy: TOFU_POLICY, fetchImpl });
    const res = await forward(baseReq());
    close();
    expect(res.body).toBe('plain-error');
  });

  it('fetch wirft (Timeout/Connect/Pin) → 502', async () => {
    const fetchImpl = fakeFetch(async () => {
      throw new Error('TimeoutError');
    });
    const { forward, close } = createUndiciMcpForward({ tls, outboundPolicy: TOFU_POLICY, fetchImpl });
    const res = await forward(baseReq());
    close();
    expect(res.status).toBe(502);
    expect((res.body as { error?: string }).error).toMatch(/forward failed/);
  });

  it('kein TLS-Material → 503', async () => {
    const { forward } = createUndiciMcpForward({ tls: undefined, outboundPolicy: TOFU_POLICY });
    const res = await forward(baseReq());
    expect(res.status).toBe(503);
  });

  it('per-Owner-Agent-Cache: zwei Calls an denselben Owner nutzen einen Agent (kein Rebuild-Throw)', async () => {
    let n = 0;
    const fetchImpl = fakeFetch(async () => {
      n++;
      return { status: 200, text: async (): Promise<string> => '{}' };
    });
    const { forward, close } = createUndiciMcpForward({ tls, outboundPolicy: TOFU_POLICY, fetchImpl });
    await forward(baseReq());
    await forward(baseReq());
    close();
    expect(n).toBe(2);
  });
});
