/**
 * Unit-Tests für ADR-028 D4-b D2-Forward-Dispatch-Builder (rein, kein I/O/Netz/mTLS).
 */
import { describe, it, expect } from 'vitest';
import type { McpForwardSpec } from './mcp-forward.js';
import { buildMcpForwardDispatch } from './mcp-forward-dispatch.js';

const OWNER = 'spiffe://thinklocal/node/12D3KooWOWNER';
const SELF = 'spiffe://thinklocal/node/12D3KooWSELF';

const remote = (overrides: Partial<Extract<McpForwardSpec, { kind: 'remote-forward' }>> = {}): McpForwardSpec => ({
  kind: 'remote-forward',
  server: 'unifi',
  targetAgentId: OWNER,
  url: 'https://10.10.10.82:9440/api/mcp/unifi',
  senderUri: SELF,
  execution_tier: 'gate',
  requireServerIdentity: false,
  expectedServerSpiffeId: OWNER,
  ...overrides,
});

describe('buildMcpForwardDispatch', () => {
  it('unavailable-Spec → none mit übernommenem Grund', () => {
    const d = buildMcpForwardDispatch({ kind: 'unavailable', server: 'unifi', reason: 'kein Provider' });
    expect(d.kind).toBe('none');
    if (d.kind !== 'none') throw new Error('x');
    expect(d.reason).toBe('kein Provider');
  });

  it('local-exec-Spec → local Passthrough mit execution_tier', () => {
    const d = buildMcpForwardDispatch({ kind: 'local-exec', server: 'unifi', execution_tier: 'self' });
    expect(d.kind).toBe('local');
    if (d.kind !== 'local') throw new Error('x');
    expect(d.execution_tier).toBe('self');
    expect(d.server).toBe('unifi');
  });

  it('remote-forward → remote-Request-Plan mit url/sender/tier/targetAgentId', () => {
    const d = buildMcpForwardDispatch(remote());
    expect(d.kind).toBe('remote');
    if (d.kind !== 'remote') throw new Error('x');
    expect(d.request.url).toBe('https://10.10.10.82:9440/api/mcp/unifi');
    expect(d.request.method).toBe('POST');
    expect(d.request.senderUri).toBe(SELF);
    expect(d.request.targetAgentId).toBe(OWNER);
    expect(d.request.execution_tier).toBe('gate');
  });

  it('D2-Pin AKTIV (requireServerIdentity=true): Verifier an + expectedSpiffeId = Owner', () => {
    const d = buildMcpForwardDispatch(remote({ requireServerIdentity: true }));
    if (d.kind !== 'remote') throw new Error('x');
    expect(d.request.outboundPolicy.spiffeServerIdentity).toBe(true);
    expect(d.request.serverIdentityPolicy.expectedSpiffeId).toBe(OWNER);
  });

  it('D2-Pin AUS (requireServerIdentity=false): Verifier aus + KEIN expectedSpiffeId (TOFU)', () => {
    const d = buildMcpForwardDispatch(remote({ requireServerIdentity: false }));
    if (d.kind !== 'remote') throw new Error('x');
    expect(d.request.outboundPolicy.spiffeServerIdentity).toBe(false);
    expect(d.request.serverIdentityPolicy.expectedSpiffeId).toBeUndefined();
  });

  it('Invariante: expectedSpiffeId gesetzt GENAU dann wenn spiffeServerIdentity true', () => {
    for (const req of [true, false]) {
      const d = buildMcpForwardDispatch(remote({ requireServerIdentity: req }));
      if (d.kind !== 'remote') throw new Error('x');
      const pinned = d.request.serverIdentityPolicy.expectedSpiffeId !== undefined;
      expect(pinned).toBe(d.request.outboundPolicy.spiffeServerIdentity);
    }
  });

  it('reicht debug/disablePinning aus opts in die OutboundConnectPolicy', () => {
    const d = buildMcpForwardDispatch(remote(), { debug: true, disablePinning: true });
    if (d.kind !== 'remote') throw new Error('x');
    expect(d.request.outboundPolicy.debug).toBe(true);
    expect(d.request.outboundPolicy.disablePinning).toBe(true);
  });

  it('default opts: debug/disablePinning false', () => {
    const d = buildMcpForwardDispatch(remote());
    if (d.kind !== 'remote') throw new Error('x');
    expect(d.request.outboundPolicy.debug).toBe(false);
    expect(d.request.outboundPolicy.disablePinning).toBe(false);
  });

  it('ist rein — mutiert die (frozen) Eingabe-Spec nicht', () => {
    const spec = Object.freeze(remote({ requireServerIdentity: true }));
    expect(() => buildMcpForwardDispatch(spec)).not.toThrow();
    expect(spec.kind).toBe('remote-forward');
  });

  // CR-MEDIUM: Runtime-Exhaustiveness-Guard — eine unbekannte kind fällt NICHT still in remote.
  it('fail-fast bei unbekanntem spec.kind (kein stiller remote-Dispatch)', () => {
    const bogus = { kind: 'retry-forward', server: 'unifi' } as unknown as McpForwardSpec;
    expect(() => buildMcpForwardDispatch(bogus)).toThrow(/unerwartete spec\.kind/);
  });
});
