/**
 * Unit-Tests für ADR-028 D4-b D2-Forward Exec-Spec-Generator (rein; kein I/O/Net/mcporter).
 * Deckt: Happy-Path (local/remote), Plan-Mismatch, Pin-Violation, Timeout-Stub, Auth-Reject.
 */
import { describe, it, expect } from 'vitest';
import type { McpForwardDispatch } from './mcp-forward-dispatch.js';
import {
  buildMcpExecSpec,
  DEFAULT_MCP_EXEC_TIMEOUT_MS,
  MCPORTER_ARGV_STUB,
  type BuildMcpExecSpecOptions,
} from './mcp-forward-exec.js';

const OWNER = 'spiffe://thinklocal/node/12D3KooWOWNER';
const SELF = 'spiffe://thinklocal/node/12D3KooWSELF';

const localDispatch = (server = 'unifi'): McpForwardDispatch => ({
  kind: 'local',
  server,
  execution_tier: 'self',
});

const remoteDispatch = (over: { pin?: boolean; expected?: string | undefined } = {}): McpForwardDispatch => {
  const pin = over.pin ?? false;
  return {
    kind: 'remote',
    request: {
      url: 'https://10.10.10.82:9440/api/mcp/unifi',
      method: 'POST',
      targetAgentId: OWNER,
      senderUri: SELF,
      execution_tier: 'gate',
      outboundPolicy: { debug: false, disablePinning: false, spiffeServerIdentity: pin },
      serverIdentityPolicy: { expectedSpiffeId: 'expected' in over ? over.expected : pin ? OWNER : undefined },
    },
  };
};

describe('buildMcpExecSpec', () => {
  it('Happy-Path local → mcporter-local-Stub (argv mit eingesetztem Server, Tier, Default-Timeout)', () => {
    const spec = buildMcpExecSpec(localDispatch('unifi'));
    expect(spec.kind).toBe('mcporter-local');
    if (spec.kind !== 'mcporter-local') throw new Error('x');
    expect(spec.server).toBe('unifi');
    expect(spec.execution_tier).toBe('self');
    expect(spec.argv).toEqual(['mcporter', 'run', 'unifi']);
    expect(spec.argv).not.toContain('<server>'); // Platzhalter ersetzt
    expect(spec.timeoutMs).toBe(DEFAULT_MCP_EXEC_TIMEOUT_MS);
  });

  it('Happy-Path remote → mtls-forward (url/sender/target/tier + Pin)', () => {
    const spec = buildMcpExecSpec(remoteDispatch({ pin: true }));
    expect(spec.kind).toBe('mtls-forward');
    if (spec.kind !== 'mtls-forward') throw new Error('x');
    expect(spec.url).toBe('https://10.10.10.82:9440/api/mcp/unifi');
    expect(spec.method).toBe('POST');
    expect(spec.senderUri).toBe(SELF);
    expect(spec.targetAgentId).toBe(OWNER);
    expect(spec.execution_tier).toBe('gate');
    expect(spec.requireServerIdentity).toBe(true);
    expect(spec.expectedServerSpiffeId).toBe(OWNER);
  });

  it('remote TOFU (kein Pin): mtls-forward ohne expectedSpiffeId', () => {
    const spec = buildMcpExecSpec(remoteDispatch({ pin: false }));
    if (spec.kind !== 'mtls-forward') throw new Error('x');
    expect(spec.requireServerIdentity).toBe(false);
    expect(spec.expectedServerSpiffeId).toBeUndefined();
  });

  it('Plan-Mismatch: none-Dispatch → reject 503 mit Grund', () => {
    const spec = buildMcpExecSpec({ kind: 'none', server: 'unifi', reason: 'kein Provider' });
    expect(spec.kind).toBe('reject');
    if (spec.kind !== 'reject') throw new Error('x');
    expect(spec.status).toBe(503);
    expect(spec.reason).toBe('kein Provider');
  });

  it('Pin-Violation: Verifier AN, aber kein expectedSpiffeId → reject 500 (kein ungepinnter Forward)', () => {
    const spec = buildMcpExecSpec(remoteDispatch({ pin: true, expected: undefined }));
    expect(spec.kind).toBe('reject');
    if (spec.kind !== 'reject') throw new Error('x');
    expect(spec.status).toBe(500);
    expect(spec.reason).toMatch(/pin violation/i);
  });

  it('Pin-Violation (umgekehrt): Verifier AUS, aber expectedSpiffeId gesetzt → reject 500', () => {
    const spec = buildMcpExecSpec(remoteDispatch({ pin: false, expected: OWNER }));
    expect(spec.kind).toBe('reject');
    if (spec.kind !== 'reject') throw new Error('x');
    expect(spec.status).toBe(500);
  });

  // CR-MEDIUM M2: leerer expectedSpiffeId zählt NICHT als gesetzt → Pin-Violation.
  it('Pin-Violation: Verifier AN, aber LEERER expectedSpiffeId → reject 500', () => {
    const spec = buildMcpExecSpec(remoteDispatch({ pin: true, expected: '' }));
    expect(spec.kind).toBe('reject');
    if (spec.kind !== 'reject') throw new Error('x');
    expect(spec.status).toBe(500);
  });

  // CR-MEDIUM M1: unbekannte dispatch.kind → fail-fast (kein stiller Remote-Pfad).
  it('fail-fast bei unbekanntem dispatch.kind', () => {
    const bogus = { kind: 'queued', server: 'x' } as unknown as McpForwardDispatch;
    expect(() => buildMcpExecSpec(bogus)).toThrow(/unerwartete dispatch\.kind/);
  });

  it('Timeout-Stub: Default + Override durchgereicht (local & remote)', () => {
    const def = buildMcpExecSpec(localDispatch());
    expect(def.kind === 'mcporter-local' && def.timeoutMs).toBe(DEFAULT_MCP_EXEC_TIMEOUT_MS);
    const over: BuildMcpExecSpecOptions = { timeoutMs: 5000 };
    const local = buildMcpExecSpec(localDispatch(), over);
    const remote = buildMcpExecSpec(remoteDispatch({ pin: true }), over);
    expect(local.kind === 'mcporter-local' && local.timeoutMs).toBe(5000);
    expect(remote.kind === 'mtls-forward' && remote.timeoutMs).toBe(5000);
  });

  it('Auth-Reject: authorized=false → reject 403, KEIN Exec (auch bei gültigem local-Plan)', () => {
    const spec = buildMcpExecSpec(localDispatch(), { authorized: false });
    expect(spec.kind).toBe('reject');
    if (spec.kind !== 'reject') throw new Error('x');
    expect(spec.status).toBe(403);
  });

  it('argv-Stub-Konstante bleibt ein Platzhalter-Vertrag (Regressionsschutz)', () => {
    expect(MCPORTER_ARGV_STUB).toContain('<server>');
  });

  it('reicht mcporterConfigPath in den local-Spec durch', () => {
    const spec = buildMcpExecSpec(localDispatch(), { mcporterConfigPath: '/home/svc/.mcporter/config.json' });
    if (spec.kind !== 'mcporter-local') throw new Error('x');
    expect(spec.configPath).toBe('/home/svc/.mcporter/config.json');
  });
});
