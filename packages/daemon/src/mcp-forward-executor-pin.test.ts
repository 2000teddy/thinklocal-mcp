// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * Regressionstests fuer die CR-HIGH-Findings aus dem T3.3-Review:
 *  - **CR-H2**: die Connector-Pin-Policy MUSS aus dem Request kommen (nicht der globalen
 *    outboundPolicy) → kein stiller TOFU-Downgrade, wenn global `spiffeServerIdentity=false`
 *    aber der Request `requireServerIdentity=true` verlangt.
 *  - **CR-H1**: der per-Owner-Agent-Cache-Key umfasst Pin-Zustand + expectedSpiffeId →
 *    kein STALE-Pin-Reuse bei unterschiedlichem expectedServerSpiffeId fuer denselben Target.
 *
 * `buildMeshConnector` wird gespäht, um die uebergebene Policy/check-Closure zu pruefen.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OutboundConnectPolicy } from './mesh-connect.js';

const buildMeshConnectorSpy = vi.fn((): (() => undefined) => () => undefined);
vi.mock('./mesh-connect.js', async (orig) => {
  const actual = await orig<typeof import('./mesh-connect.js')>();
  return { ...actual, buildMeshConnector: buildMeshConnectorSpy };
});

const { createUndiciMcpForward } = await import('./mcp-forward-executor.js');
type Fwd = import('./mcp-forward-executor.js').McpHttpForwardRequest;

const OWNER = 'spiffe://thinklocal/node/12D3KooWOWNER';
const tls = { ca: 'ca', cert: 'cert', key: 'key' };
const GLOBAL_TOFU: OutboundConnectPolicy = { debug: false, disablePinning: false, spiffeServerIdentity: false };

type FakeRes = { status: number; text: () => Promise<string> };
function fakeFetch(): typeof import('undici').fetch {
  return (async (): Promise<FakeRes> => ({ status: 200, text: async (): Promise<string> => '{}' })) as unknown as typeof import('undici').fetch;
}
const req = (over: Partial<Fwd> = {}): Fwd => ({
  url: 'https://10.10.10.82:9440/api/mcp/unifi',
  hop: 1,
  senderUri: 'spiffe://thinklocal/node/12D3KooWSELF',
  payload: {},
  targetAgentId: OWNER,
  requireServerIdentity: false,
  timeoutMs: 5000,
  ...over,
});

describe('createUndiciMcpForward — Pin-Policy (CR-H2/H1)', () => {
  beforeEach(() => buildMeshConnectorSpy.mockClear());

  it('CR-H2: requireServerIdentity=true → Connector-Policy.spiffeServerIdentity=true + check gesetzt (kein TOFU-Downgrade trotz globalem TOFU)', async () => {
    const { forward, close } = createUndiciMcpForward({ tls, outboundPolicy: GLOBAL_TOFU, fetchImpl: fakeFetch() });
    await forward(req({ requireServerIdentity: true, expectedServerSpiffeId: OWNER }));
    close();
    expect(buildMeshConnectorSpy).toHaveBeenCalledTimes(1);
    const [, policy, , check] = buildMeshConnectorSpy.mock.calls[0] as unknown as [unknown, OutboundConnectPolicy, unknown, unknown];
    expect(policy.spiffeServerIdentity).toBe(true); // aus dem Request, NICHT global (false)
    expect(check).toBeTypeOf('function'); // Pin-Verifier vorhanden
  });

  it('CR-H2: requireServerIdentity=false → policy.spiffeServerIdentity=false + kein check (TOFU)', async () => {
    const { forward, close } = createUndiciMcpForward({ tls, outboundPolicy: GLOBAL_TOFU, fetchImpl: fakeFetch() });
    await forward(req({ requireServerIdentity: false }));
    close();
    const [, policy, , check] = buildMeshConnectorSpy.mock.calls[0] as unknown as [unknown, OutboundConnectPolicy, unknown, unknown];
    expect(policy.spiffeServerIdentity).toBe(false);
    expect(check).toBeUndefined();
  });

  it('CR-H1: gleicher Target, UNTERSCHIEDLICHER expectedSpiffeId → zwei Agents (kein Stale-Pin-Reuse)', async () => {
    const { forward, close } = createUndiciMcpForward({ tls, outboundPolicy: GLOBAL_TOFU, fetchImpl: fakeFetch() });
    await forward(req({ requireServerIdentity: true, expectedServerSpiffeId: OWNER }));
    await forward(req({ requireServerIdentity: true, expectedServerSpiffeId: 'spiffe://thinklocal/node/12D3KooWOTHER' }));
    close();
    expect(buildMeshConnectorSpy).toHaveBeenCalledTimes(2); // distinkte Cache-Keys → Rebuild
  });

  it('CR-H1: gleicher Target + gleicher Pin → EIN Agent (Reuse)', async () => {
    const { forward, close } = createUndiciMcpForward({ tls, outboundPolicy: GLOBAL_TOFU, fetchImpl: fakeFetch() });
    await forward(req({ requireServerIdentity: true, expectedServerSpiffeId: OWNER }));
    await forward(req({ requireServerIdentity: true, expectedServerSpiffeId: OWNER }));
    close();
    expect(buildMeshConnectorSpy).toHaveBeenCalledTimes(1);
  });
});
