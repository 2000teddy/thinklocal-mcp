// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * Unit-Tests für ADR-028 D4-b MCP-Ingress-Handler (rein bis auf injizierten Executor;
 * KEIN Net-Egress). Deckt: Happy-Path (local/remote), Invalid-Plan, Reject-on-Mismatch,
 * Auth-Gate, mTLS-Pin-Konsistenz zu #195.
 */
import { describe, it, expect } from 'vitest';
import type { Capability } from './registry.js';
import type { McpForwardPeer } from './mcp-forward.js';
import type { McpForwardDispatch } from './mcp-forward-dispatch.js';
import {
  handleMcpIngress,
  enforceExecutionTier,
  type McpIngressDeps,
  type McpIngressResponse,
} from './mcp-ingress.js';
import type { ApprovalDecision, ApprovalOutcome } from './meldekanal.js';

const SELF = 'spiffe://thinklocal/node/12D3KooWSELF';
const OWNER = 'spiffe://thinklocal/node/12D3KooWOWNER';

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

// Executor-Stub: fängt den Dispatch + liefert eine Marker-Response.
function makeExecutor(): { calls: McpForwardDispatch[]; execute: McpIngressDeps['execute'] } {
  const calls: McpForwardDispatch[] = [];
  return {
    calls,
    execute: async (d: McpForwardDispatch): Promise<McpIngressResponse> => {
      calls.push(d);
      return { status: 200, body: { ok: true, kind: d.kind } };
    },
  };
}

const peerMap =
  (...peers: McpForwardPeer[]) =>
  (id: string): McpForwardPeer | undefined =>
    peers.find((p) => p.agentId === id);

const baseDeps = (over: Partial<McpIngressDeps> = {}): McpIngressDeps => ({
  selfAgentId: SELF,
  resolvePeer: peerMap({ agentId: OWNER, endpoint: 'https://10.10.10.82:9440' }),
  isAuthorizedSender: () => true,
  requireServerIdentity: false,
  execute: makeExecutor().execute,
  ...over,
});

describe('handleMcpIngress', () => {
  it('Auth-Gate: fehlender Sender → 403, KEIN Dispatch', async () => {
    const ex = makeExecutor();
    const res = await handleMcpIngress(
      { server: 'unifi', senderUri: null, capabilities: [cap()] },
      baseDeps({ execute: ex.execute }),
    );
    expect(res.status).toBe(403);
    expect(ex.calls).toHaveLength(0);
  });

  it('Auth-Gate: nicht autorisierter Sender → 403, KEIN Dispatch', async () => {
    const ex = makeExecutor();
    const res = await handleMcpIngress(
      { server: 'unifi', senderUri: 'spiffe://thinklocal/node/12D3KooWEVIL', capabilities: [cap()] },
      baseDeps({ isAuthorizedSender: () => false, execute: ex.execute }),
    );
    expect(res.status).toBe(403);
    expect(ex.calls).toHaveLength(0);
  });

  it('Happy-Path remote: autorisiert + Owner-Peer healthy → execute(remote)', async () => {
    const ex = makeExecutor();
    const res = await handleMcpIngress(
      { server: 'unifi', senderUri: SELF, capabilities: [cap()] },
      baseDeps({ execute: ex.execute }),
    );
    expect(res.status).toBe(200);
    expect(ex.calls).toHaveLength(1);
    expect(ex.calls[0]?.kind).toBe('remote');
  });

  it('Happy-Path local: eigener Node serviert → execute(local)', async () => {
    const ex = makeExecutor();
    const res = await handleMcpIngress(
      { server: 'unifi', senderUri: SELF, capabilities: [cap({ agent_id: SELF })] },
      baseDeps({ execute: ex.execute }),
    );
    expect(res.status).toBe(200);
    expect(ex.calls).toHaveLength(1);
    expect(ex.calls[0]?.kind).toBe('local');
  });

  it('Invalid-Plan: kein Provider → 503, KEIN Dispatch', async () => {
    const ex = makeExecutor();
    const res = await handleMcpIngress(
      { server: 'unifi', senderUri: SELF, capabilities: [] },
      baseDeps({ execute: ex.execute }),
    );
    expect(res.status).toBe(503);
    expect(ex.calls).toHaveLength(0);
  });

  it('Reject-on-Mismatch: Capabilities für einen ANDEREN Server → 503, KEIN Dispatch', async () => {
    const ex = makeExecutor();
    const res = await handleMcpIngress(
      // angefragt: unifi; vorhanden: nur mcp:other → resolveMcp liefert [] → none.
      { server: 'unifi', senderUri: SELF, capabilities: [cap({ skill_id: 'mcp:other' })] },
      baseDeps({ execute: ex.execute }),
    );
    expect(res.status).toBe(503);
    expect(ex.calls).toHaveLength(0);
  });

  it('Reject: offline-Provider wird nicht geroutet → 503', async () => {
    const ex = makeExecutor();
    const res = await handleMcpIngress(
      { server: 'unifi', senderUri: SELF, capabilities: [cap({ health: 'offline' })] },
      baseDeps({ execute: ex.execute }),
    );
    expect(res.status).toBe(503);
    expect(ex.calls).toHaveLength(0);
  });

  it('fail-closed: Remote ohne erreichbaren Endpoint → 503 (kein Forward)', async () => {
    const ex = makeExecutor();
    const res = await handleMcpIngress(
      { server: 'unifi', senderUri: SELF, capabilities: [cap()] },
      baseDeps({ resolvePeer: peerMap(), execute: ex.execute }), // kein Endpoint für OWNER
    );
    expect(res.status).toBe(503);
    expect(ex.calls).toHaveLength(0);
  });

  it('400 bei fehlendem Servernamen (nach Auth)', async () => {
    const ex = makeExecutor();
    const res = await handleMcpIngress(
      { server: '   ', senderUri: SELF, capabilities: [cap()] },
      baseDeps({ execute: ex.execute }),
    );
    expect(res.status).toBe(400);
    expect(ex.calls).toHaveLength(0);
  });

  it('mTLS-Pin-Konsistenz zu #195: requireServerIdentity=true → Dispatch trägt expectedSpiffeId=Owner', async () => {
    const ex = makeExecutor();
    await handleMcpIngress(
      { server: 'unifi', senderUri: SELF, capabilities: [cap()] },
      baseDeps({ requireServerIdentity: true, execute: ex.execute }),
    );
    const d = ex.calls[0];
    expect(d?.kind).toBe('remote');
    if (!d || d.kind !== 'remote') throw new Error('expected remote');
    expect(d.request.outboundPolicy.spiffeServerIdentity).toBe(true);
    expect(d.request.serverIdentityPolicy.expectedSpiffeId).toBe(OWNER);
    // D3: der Forward-Sender ist die EIGENE Identität (nicht der eingehende Caller).
    expect(d.request.senderUri).toBe(SELF);
  });

  // CR-MEDIUM: unerwarteter Throw in der Pipeline → 500, nicht rejected Promise (Vertrag halten).
  it('fängt einen Throw in der Pipeline ab → 500, KEIN Dispatch', async () => {
    const ex = makeExecutor();
    const res = await handleMcpIngress(
      { server: 'unifi', senderUri: SELF, capabilities: [cap()] },
      baseDeps({
        resolvePeer: () => {
          throw new Error('boom');
        },
        execute: ex.execute,
      }),
    );
    expect(res.status).toBe(500);
    expect(ex.calls).toHaveLength(0);
  });

  it('TOFU (requireServerIdentity=false): kein Pin im Dispatch', async () => {
    const ex = makeExecutor();
    await handleMcpIngress(
      { server: 'unifi', senderUri: SELF, capabilities: [cap()] },
      baseDeps({ requireServerIdentity: false, execute: ex.execute }),
    );
    const d = ex.calls[0];
    if (!d || d.kind !== 'remote') throw new Error('expected remote');
    expect(d.request.outboundPolicy.spiffeServerIdentity).toBe(false);
    expect(d.request.serverIdentityPolicy.expectedSpiffeId).toBeUndefined();
  });

  // ── ADR-033: Ausführungsstufen-Durchsetzung am Ingress (Gate 2, fail-closed) ──

  it('Tier-Gate: gate-Stufe (schreibend, remote) → 403, KEIN Dispatch', async () => {
    const ex = makeExecutor();
    const res = await handleMcpIngress(
      { server: 'unifi', senderUri: SELF, capabilities: [cap({ permissions: ['write'] })] },
      baseDeps({ execute: ex.execute }),
    );
    expect(res.status).toBe(403);
    expect((res.body as { tier?: string }).tier).toBe('gate');
    expect(ex.calls).toHaveLength(0); // fail-closed VOR dem Executor
  });

  it('Tier-Gate: consensus-Stufe (kritisch, remote) → 403, KEIN Dispatch', async () => {
    const ex = makeExecutor();
    const res = await handleMcpIngress(
      { server: 'unifi', senderUri: SELF, capabilities: [cap({ permissions: ['admin'] })] },
      baseDeps({ execute: ex.execute }),
    );
    expect(res.status).toBe(403);
    expect((res.body as { tier?: string }).tier).toBe('consensus');
    expect(ex.calls).toHaveLength(0);
  });

  it('Tier-Gate: gate-Stufe auch bei local-Dispatch → 403, KEIN Dispatch', async () => {
    const ex = makeExecutor();
    const res = await handleMcpIngress(
      { server: 'unifi', senderUri: SELF, capabilities: [cap({ agent_id: SELF, permissions: ['control'] })] },
      baseDeps({ execute: ex.execute }),
    );
    expect(res.status).toBe(403);
    expect((res.body as { tier?: string }).tier).toBe('gate');
    expect(ex.calls).toHaveLength(0);
  });

  it('Tier-Gate: consensus-Stufe auch bei local-Dispatch → 403, KEIN Dispatch', async () => {
    const ex = makeExecutor();
    const res = await handleMcpIngress(
      { server: 'unifi', senderUri: SELF, capabilities: [cap({ agent_id: SELF, permissions: ['delete'] })] },
      baseDeps({ execute: ex.execute }),
    );
    expect(res.status).toBe(403);
    expect((res.body as { tier?: string }).tier).toBe('consensus');
    expect(ex.calls).toHaveLength(0);
  });

  it('Tier-Gate (Regression): self-Stufe (lesend) läuft durch → execute', async () => {
    const ex = makeExecutor();
    // permissions=["network.read"] wie die reale unifi-Beta-Deklaration → self.
    const res = await handleMcpIngress(
      { server: 'unifi', senderUri: SELF, capabilities: [cap({ permissions: ['network.read'] })] },
      baseDeps({ execute: ex.execute }),
    );
    expect(res.status).toBe(200);
    expect(ex.calls).toHaveLength(1);
  });
});

describe('enforceExecutionTier (ADR-033, reine Funktion)', () => {
  it('self → null (erlaubt)', () => {
    expect(enforceExecutionTier('self', 'unifi')).toBeNull();
  });

  it('gate → 403 mit tier+server im Body', () => {
    const r = enforceExecutionTier('gate', 'unifi');
    expect(r?.status).toBe(403);
    expect((r?.body as { tier?: string; server?: string }).tier).toBe('gate');
    expect((r?.body as { server?: string }).server).toBe('unifi');
  });

  it('consensus → 403 mit tier im Body', () => {
    const r = enforceExecutionTier('consensus', 'pal');
    expect(r?.status).toBe(403);
    expect((r?.body as { tier?: string }).tier).toBe('consensus');
  });

  // CR-N1: der Exhaustiveness-Guard fällt zur LAUFZEIT fail-closed (403), falls je ein Wert
  // an der Compile-Zeit-Union vorbei geschleust wird (Cast). Sperrt das Verhalten gegen Refactors.
  it('unbekannte Stufe (Cast am Typ vorbei) → 403 fail-closed', () => {
    const r = enforceExecutionTier('mystery' as unknown as Parameters<typeof enforceExecutionTier>[0], 'x');
    expect(r?.status).toBe(403);
  });
});

// TL07 / Entscheidung 2: Werkzeug-Stufe (pro Tool) hebt die effektive Stufe an — lesend≠schreibend
// am SELBEN Server. Capability unifi = permissions:[] trust 4 → self; das Tool entscheidet.
describe('handleMcpIngress — Werkzeug-Stufe (Entscheidung 2, pro Tool)', () => {
  const localCap = (): Capability[] => [cap({ agent_id: SELF })]; // eigener Node serviert → local
  const call = (name: string): unknown => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name } });

  it('list_clients (self-Tool) am self-Server → execute (200)', async () => {
    const ex = makeExecutor();
    const res = await handleMcpIngress(
      { server: 'unifi', senderUri: SELF, capabilities: localCap(), payload: call('list_clients') },
      baseDeps({ execute: ex.execute }),
    );
    expect(res.status).toBe(200);
    expect(ex.calls).toHaveLength(1);
  });

  it('block_client (Schreib-Tool) am self-Server → 403 gate, KEIN Dispatch', async () => {
    const ex = makeExecutor();
    const res = await handleMcpIngress(
      { server: 'unifi', senderUri: SELF, capabilities: localCap(), payload: call('block_client') },
      baseDeps({ execute: ex.execute }),
    );
    expect(res.status).toBe(403);
    expect((res.body as { tier?: string }).tier).toBe('gate');
    expect(ex.calls).toHaveLength(0);
  });

  it('delete_network (destruktiv) → 403 consensus, KEIN Dispatch', async () => {
    const ex = makeExecutor();
    const res = await handleMcpIngress(
      { server: 'unifi', senderUri: SELF, capabilities: localCap(), payload: call('delete_network') },
      baseDeps({ execute: ex.execute }),
    );
    expect(res.status).toBe(403);
    expect((res.body as { tier?: string }).tier).toBe('consensus');
    expect(ex.calls).toHaveLength(0);
  });

  it('get_switch_stack (Verb-Präfix get, NICHT „switch") → self → execute', async () => {
    const ex = makeExecutor();
    const res = await handleMcpIngress(
      { server: 'unifi', senderUri: SELF, capabilities: localCap(), payload: call('get_switch_stack') },
      baseDeps({ execute: ex.execute }),
    );
    expect(res.status).toBe(200);
    expect(ex.calls).toHaveLength(1);
  });

  it('tools/list → self → execute', async () => {
    const ex = makeExecutor();
    const res = await handleMcpIngress(
      { server: 'unifi', senderUri: SELF, capabilities: localCap(), payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' } },
      baseDeps({ execute: ex.execute }),
    );
    expect(res.status).toBe(200);
    expect(ex.calls).toHaveLength(1);
  });

  it('unbekanntes Verb → 403 fail-closed (Werkzeug-Stufe hebt an)', async () => {
    const ex = makeExecutor();
    const res = await handleMcpIngress(
      { server: 'unifi', senderUri: SELF, capabilities: localCap(), payload: call('frobnicate_thing') },
      baseDeps({ execute: ex.execute }),
    );
    expect(res.status).toBe(403);
    expect(ex.calls).toHaveLength(0);
  });

  it('ohne payload (Altverhalten) → self, execute — rückwärtskompatibel', async () => {
    const ex = makeExecutor();
    const res = await handleMcpIngress(
      { server: 'unifi', senderUri: SELF, capabilities: localCap() },
      baseDeps({ execute: ex.execute }),
    );
    expect(res.status).toBe(200);
    expect(ex.calls).toHaveLength(1);
  });
});

// ADR-039 (TL-08 Slice 1): governed Server-Klassen-Map am Ingress. unifi ist governed → Read-only-Allowlist.
describe('handleMcpIngress — ADR-039 governed unifi-Klassen-Map', () => {
  const unifiCap = (): Capability[] => [cap({ agent_id: SELF })]; // self-served unifi
  const call = (name: string): unknown => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name } });

  it('unifi list_clients (allowlist-read) → execute (200)', async () => {
    const ex = makeExecutor();
    const res = await handleMcpIngress(
      { server: 'unifi', senderUri: SELF, capabilities: unifiCap(), payload: call('list_clients') },
      baseDeps({ execute: ex.execute }),
    );
    expect(res.status).toBe(200);
    expect(ex.calls).toHaveLength(1);
  });

  it('SECURITY: unifi get_wlan (credential-Read, governed AUSGESCHLOSSEN) → 403 gate, KEIN Dispatch', async () => {
    const ex = makeExecutor();
    // Verb-Heuristik allein gäbe self→200; die Allowlist gatet es (mutation ≠ sensitivity).
    const res = await handleMcpIngress(
      { server: 'unifi', senderUri: SELF, capabilities: unifiCap(), payload: call('get_wlan') },
      baseDeps({ execute: ex.execute }),
    );
    expect(res.status).toBe(403);
    expect((res.body as { tier?: string }).tier).toBe('gate');
    expect(ex.calls).toHaveLength(0);
  });

  it('BLOCKER-Regression: unifi tools/list → execute (Discovery bricht NICHT)', async () => {
    const ex = makeExecutor();
    const res = await handleMcpIngress(
      { server: 'unifi', senderUri: SELF, capabilities: unifiCap(), payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' } },
      baseDeps({ execute: ex.execute }),
    );
    expect(res.status).toBe(200);
    expect(ex.calls).toHaveLength(1);
  });
});

// ── ADR-037 (TL-09b): gate-Freigabe über den injizierten Resolver ──
describe('handleMcpIngress — ADR-037 gate-Freigabe (resolveApproval)', () => {
  const gateCap = (): Capability[] => [cap({ agent_id: SELF, permissions: ['write'] })]; // local gate
  const consensusCap = (): Capability[] => [cap({ agent_id: SELF, permissions: ['delete'] })]; // local consensus

  /** Resolver-Fabrik: liefert fixen outcome, protokolliert den ctx. */
  function approver(outcome: ApprovalOutcome, sink: { ctx?: unknown } = {}): {
    sink: { ctx?: unknown };
    resolve: NonNullable<McpIngressDeps['resolveApproval']>;
  } {
    return {
      sink,
      resolve: async (ctx): Promise<ApprovalDecision> => {
        sink.ctx = ctx;
        return { outcome, channelId: 'test-channel' };
      },
    };
  }

  it('gate + approved → execute (200)', async () => {
    const ex = makeExecutor();
    const a = approver('approved');
    const res = await handleMcpIngress(
      { server: 'unifi', senderUri: SELF, capabilities: gateCap() },
      baseDeps({ execute: ex.execute, resolveApproval: a.resolve }),
    );
    expect(res.status).toBe(200);
    expect(ex.calls).toHaveLength(1);
  });

  it('gate + rejected → 403 mit outcome, KEIN Dispatch', async () => {
    const ex = makeExecutor();
    const res = await handleMcpIngress(
      { server: 'unifi', senderUri: SELF, capabilities: gateCap() },
      baseDeps({ execute: ex.execute, resolveApproval: approver('rejected').resolve }),
    );
    expect(res.status).toBe(403);
    expect((res.body as { outcome?: string }).outcome).toBe('rejected');
    expect(ex.calls).toHaveLength(0);
  });

  it('gate + denied-no-channel → 403, KEIN Dispatch', async () => {
    const ex = makeExecutor();
    const res = await handleMcpIngress(
      { server: 'unifi', senderUri: SELF, capabilities: gateCap() },
      baseDeps({ execute: ex.execute, resolveApproval: approver('denied-no-channel').resolve }),
    );
    expect(res.status).toBe(403);
    expect((res.body as { outcome?: string }).outcome).toBe('denied-no-channel');
    expect(ex.calls).toHaveLength(0);
  });

  it('gate + timeout/error → 403 (nie approve), KEIN Dispatch', async () => {
    for (const outcome of ['timeout', 'error'] as const) {
      const ex = makeExecutor();
      const res = await handleMcpIngress(
        { server: 'unifi', senderUri: SELF, capabilities: gateCap() },
        baseDeps({ execute: ex.execute, resolveApproval: approver(outcome).resolve }),
      );
      expect(res.status).toBe(403);
      expect((res.body as { outcome?: string }).outcome).toBe(outcome);
      expect(ex.calls).toHaveLength(0);
    }
  });

  it('gate + Resolver wirft → 403 fail-closed, KEIN Dispatch (kein 500)', async () => {
    const ex = makeExecutor();
    const res = await handleMcpIngress(
      { server: 'unifi', senderUri: SELF, capabilities: gateCap() },
      baseDeps({
        execute: ex.execute,
        resolveApproval: async () => {
          throw new Error('resolver boom');
        },
      }),
    );
    expect(res.status).toBe(403);
    expect((res.body as { error?: string }).error).toContain('fail-closed');
    expect(ex.calls).toHaveLength(0);
  });

  // CR-LOW: ein Resolver, der ein malformed Ergebnis AUFLÖST (Typvertrag verletzt), muss fail-closed
  // 403 liefern — kein Unhandled-Reject, kein Durchreichen, kein 500.
  it('gate + Resolver löst malformed (undefined) auf → 403 fail-closed, KEIN Dispatch', async () => {
    const ex = makeExecutor();
    const res = await handleMcpIngress(
      { server: 'unifi', senderUri: SELF, capabilities: gateCap() },
      baseDeps({
        execute: ex.execute,
        resolveApproval: async () => undefined as unknown as ApprovalDecision,
      }),
    );
    expect(res.status).toBe(403);
    expect(ex.calls).toHaveLength(0);
  });

  it('gate OHNE Resolver → 403 (ADR-033-Untergrenze, unverändert)', async () => {
    const ex = makeExecutor();
    const res = await handleMcpIngress(
      { server: 'unifi', senderUri: SELF, capabilities: gateCap() },
      baseDeps({ execute: ex.execute }), // kein resolveApproval
    );
    expect(res.status).toBe(403);
    expect((res.body as { tier?: string }).tier).toBe('gate');
    expect(ex.calls).toHaveLength(0);
  });

  it('consensus wird NIE geroutet: consensus + approved → STILL 403, KEIN Dispatch', async () => {
    const ex = makeExecutor();
    const res = await handleMcpIngress(
      { server: 'unifi', senderUri: SELF, capabilities: consensusCap() },
      baseDeps({ execute: ex.execute, resolveApproval: approver('approved').resolve }),
    );
    expect(res.status).toBe(403);
    expect((res.body as { tier?: string }).tier).toBe('consensus');
    expect(ex.calls).toHaveLength(0);
  });

  it('self wird NICHT gegatet: Resolver gesetzt, self-Tool → execute ohne Freigabe', async () => {
    const ex = makeExecutor();
    const a = approver('rejected'); // würde ablehnen, darf aber nie gefragt werden
    const res = await handleMcpIngress(
      { server: 'unifi', senderUri: SELF, capabilities: [cap({ agent_id: SELF, permissions: ['network.read'] })] },
      baseDeps({ execute: ex.execute, resolveApproval: a.resolve }),
    );
    expect(res.status).toBe(200);
    expect(ex.calls).toHaveLength(1);
    expect(a.sink.ctx).toBeUndefined(); // Resolver für self NICHT konsultiert
  });

  it('Resolver bekommt den korrekten Kontext (server/tool/tier) aus dem Payload', async () => {
    const ex = makeExecutor();
    const a = approver('approved');
    const call = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'block_client' } };
    const res = await handleMcpIngress(
      { server: 'unifi', senderUri: SELF, capabilities: [cap({ agent_id: SELF })], payload: call },
      baseDeps({ execute: ex.execute, resolveApproval: a.resolve }),
    );
    expect(a.sink.ctx).toMatchObject({ server: 'unifi', tool: 'block_client', tier: 'gate', senderUri: SELF });
    // CR-LOW: Werkzeug-Stufe hebt self→gate, approved → MUSS den Executor erreichen (Regression-Guard).
    expect(res.status).toBe(200);
    expect(ex.calls).toHaveLength(1);
  });
});
