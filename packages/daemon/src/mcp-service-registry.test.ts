// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * Unit tests for ADR-028 D4-a: MCP service registry (pure model + resolution).
 */
import { describe, it, expect } from 'vitest';
import type { Capability } from './registry.js';
import {
  buildMcpCapability,
  deriveExecutionTier,
  deriveToolTier,
  deriveToolTierForServer,
  classifyGateReason,
  computeToolClassDrift,
  SERVER_TOOL_CLASSES,
  maxTier,
  resolveMcp,
  isMcpCapability,
  MCP_CATEGORY,
} from './mcp-service-registry.js';
import unifiFixture from './fixtures/unifi-tools-2026-07-15.json' with { type: 'json' };

const NODE_A = 'spiffe://thinklocal/node/12D3KooWA000000000000000000000000000000000000000';
const NODE_B = 'spiffe://thinklocal/node/12D3KooWB000000000000000000000000000000000000000';
const TS = '2026-06-19T12:00:00.000Z';

describe('deriveExecutionTier', () => {
  it('no permissions → self (read-only), with adequate trust', () => {
    expect(deriveExecutionTier([], 5)).toBe('self');
    expect(deriveExecutionTier(['read', 'query', 'list'], 5)).toBe('self');
    expect(deriveExecutionTier(['convert'], 4)).toBe('self'); // markitdown-style
  });
  it('write/credential permission → gate', () => {
    expect(deriveExecutionTier(['read', 'write'], 5)).toBe('gate');
    expect(deriveExecutionTier(['credential.use'], 5)).toBe('gate');
    expect(deriveExecutionTier(['network.configure'], 5)).toBe('gate'); // unifi-style
  });
  it('destructive permission → consensus (highest wins)', () => {
    expect(deriveExecutionTier(['read', 'write', 'admin.delete'], 5)).toBe('consensus');
    expect(deriveExecutionTier(['factory.reset'], 5)).toBe('consensus');
  });
  it('unknown/unclassifiable permission → fail-closed to at least gate', () => {
    expect(deriveExecutionTier(['frobnicate'], 5)).toBe('gate');
  });
  it('low trust raises self → gate but never lowers a higher tier', () => {
    expect(deriveExecutionTier(['read'], 1)).toBe('gate'); // low-trust read gated
    expect(deriveExecutionTier(['read'], 0)).toBe('gate');
    expect(deriveExecutionTier([], 1)).toBe('gate');
    expect(deriveExecutionTier(['admin.delete'], 0)).toBe('consensus'); // not lowered
  });
  it('invalid trustLevel (NaN/Infinity) fails closed to gate, not open (CR-MEDIUM)', () => {
    expect(deriveExecutionTier(['read'], Number.NaN)).toBe('gate');
    expect(deriveExecutionTier([], Number.NaN)).toBe('gate');
    expect(deriveExecutionTier([], Number.POSITIVE_INFINITY)).toBe('gate');
  });
});

describe('buildMcpCapability', () => {
  it('builds a namespaced mcp capability with derived tier (default-open)', () => {
    const cap = buildMcpCapability({
      server: 'unifi',
      description: 'UniFi network controller',
      tools: ['list_clients', 'get_health'],
      version: '1.2.0',
      permissions: ['network.read'],
      trust_level: 4,
      agent_id: NODE_A,
      updated_at: TS,
    });
    expect(cap.skill_id).toBe('mcp:unifi');
    expect(cap.category).toBe(MCP_CATEGORY);
    expect(cap.version).toBe('1.2.0');
    expect(cap.agent_id).toBe(NODE_A);
    expect(cap.health).toBe('healthy'); // default
    expect(cap.updated_at).toBe(TS);
    expect(cap.execution_tier).toBe('self'); // read-only + adequate trust
    // tools folded into the description (no dedicated tools field in CRDT Capability yet)
    expect(cap.description).toContain('list_clients');
    expect(cap.description).toContain('get_health');
  });

  it('write-permission MCP derives gate', () => {
    const cap = buildMcpCapability({
      server: 'e3dc', description: 'E3DC battery control', version: '0.1.0',
      permissions: ['battery.write'], trust_level: 4, agent_id: NODE_A, updated_at: TS,
    });
    expect(cap.execution_tier).toBe('gate');
  });

  it('no tools → description unchanged; result is a valid Capability shape', () => {
    const cap = buildMcpCapability({
      server: 'markitdown', description: 'Markdown conversion', version: '2.0.0',
      permissions: ['convert'], trust_level: 5, agent_id: NODE_A, updated_at: TS,
    });
    expect(cap.description).toBe('Markdown conversion');
    expect(cap.execution_tier).toBe('self');
    // structurally assignable to Capability
    const asCap: Capability = cap;
    expect(asCap.permissions).toEqual(['convert']);
  });

  it('rejects empty / malformed server names', () => {
    const base = { description: 'x', version: '1', trust_level: 5, agent_id: NODE_A, updated_at: TS };
    expect(() => buildMcpCapability({ ...base, server: '' })).toThrow();
    expect(() => buildMcpCapability({ ...base, server: 'a/b' })).toThrow();
    expect(() => buildMcpCapability({ ...base, server: 'a::b' })).toThrow();
    expect(() => buildMcpCapability({ ...base, server: 'has space' })).toThrow();
  });

  it('canonicalizes server name (case-insensitive) so build + resolve agree — no split-brain (CR-MEDIUM)', () => {
    const base = { description: 'UniFi', version: '1', permissions: ['network.read'], trust_level: 4, agent_id: NODE_A, updated_at: TS };
    const cap = buildMcpCapability({ ...base, server: 'UniFi' });
    expect(cap.skill_id).toBe('mcp:unifi'); // lower-cased
    // resolve with a differently-cased query still finds it
    expect(resolveMcp('UNIFI', [cap])).toHaveLength(1);
    expect(resolveMcp('unifi', [cap])).toHaveLength(1);
  });
});

describe('isMcpCapability', () => {
  it('true only for mcp-namespaced + category mcp', () => {
    expect(isMcpCapability({ category: 'mcp', skill_id: 'mcp:unifi' })).toBe(true);
    expect(isMcpCapability({ category: 'database', skill_id: 'influxdb.read' })).toBe(false);
    expect(isMcpCapability({ category: 'mcp', skill_id: 'not-prefixed' })).toBe(false);
  });
});

describe('resolveMcp', () => {
  const mk = (server: string, agent: string, health: Capability['health'], perms: string[], trust: number): Capability =>
    buildMcpCapability({ server, description: server, version: '1', permissions: perms, trust_level: trust, agent_id: agent, updated_at: TS, health });

  const caps: Capability[] = [
    mk('unifi', NODE_A, 'healthy', ['network.read'], 4),
    mk('unifi', NODE_B, 'degraded', ['network.write'], 4), // second provider, write → gate
    mk('markitdown', NODE_A, 'healthy', ['convert'], 5),
    mk('unifi', NODE_B, 'offline', ['network.read'], 4), // offline → skipped
    // a non-mcp capability must be ignored
    { skill_id: 'influxdb.read', category: 'database', version: '1', description: 'db', agent_id: NODE_A, health: 'healthy', trust_level: 5, permissions: ['read'], updated_at: TS },
  ];

  it('multi-provider resolution, default-open, no allowlist filter', () => {
    const r = resolveMcp('unifi', caps);
    expect(r.map((x) => x.agent_id).sort()).toEqual([NODE_A, NODE_B].sort());
    expect(r).toHaveLength(2); // both healthy+degraded providers; offline skipped
    const a = r.find((x) => x.agent_id === NODE_A);
    const b = r.find((x) => x.agent_id === NODE_B);
    expect(a?.execution_tier).toBe('self'); // read
    expect(b?.execution_tier).toBe('gate'); // write
  });

  it('skips offline providers (routing hygiene, not a trust gate)', () => {
    const r = resolveMcp('unifi', caps);
    expect(r.every((x) => x.health !== 'offline')).toBe(true);
  });

  it('ignores non-mcp categories', () => {
    const r = resolveMcp('influxdb.read', caps);
    expect(r).toHaveLength(0);
  });

  it('unknown server → empty array (not an error)', () => {
    expect(resolveMcp('does-not-exist', caps)).toEqual([]);
  });

  it('resolves a single provider', () => {
    const r = resolveMcp('markitdown', caps);
    expect(r).toHaveLength(1);
    expect(r[0].agent_id).toBe(NODE_A);
    expect(r[0].execution_tier).toBe('self');
  });
});

describe('deriveToolTier (TL07 pro-Tool-Stufe)', () => {
  const callFor = (name: string): unknown => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name } });

  it('lesende Verben (list/get/describe/search) → self', () => {
    for (const n of ['list_clients', 'get_device', 'describe_thing', 'search_x', 'get_switch_stack', 'list_firewall_policies']) {
      expect(deriveToolTier(callFor(n))).toBe('self');
    }
  });

  it('schreibende Verben (create/update/block/enable/disable/authorize) → gate', () => {
    for (const n of ['create_network', 'update_wlan', 'block_client', 'enable_firewall_policy', 'disable_firewall_policy', 'authorize_guest', 'set_x']) {
      expect(deriveToolTier(callFor(n))).toBe('gate');
    }
  });

  it('destruktive Verben (delete/remove/reset/revoke) → consensus', () => {
    for (const n of ['delete_network', 'remove_acl_rule', 'reset_device', 'revoke_voucher']) {
      expect(deriveToolTier(callFor(n))).toBe('consensus');
    }
  });

  it('tools/list & andere Metadaten-Methoden → self', () => {
    expect(deriveToolTier({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).toBe('self');
    expect(deriveToolTier({ method: 'ping' })).toBe('self');
  });

  it('unbekanntes Verb / ungültiger Call → gate (fail-closed)', () => {
    expect(deriveToolTier(callFor('frobnicate_thing'))).toBe('gate');
    expect(deriveToolTier({ method: 'tools/call', params: {} })).toBe('gate'); // kein name
    expect(deriveToolTier({ method: 'tools/call', params: { name: '' } })).toBe('gate');
    expect(deriveToolTier(null)).toBe('self'); // kein tools/call
    expect(deriveToolTier('garbage')).toBe('self');
  });

  it('Groß-/Kleinschreibung egal (führendes Verb)', () => {
    expect(deriveToolTier(callFor('DELETE_network'))).toBe('consensus');
    expect(deriveToolTier(callFor('Block_Client'))).toBe('gate');
  });
});

describe('maxTier', () => {
  it('höhere Stufe gewinnt (self<gate<consensus)', () => {
    expect(maxTier('self', 'gate')).toBe('gate');
    expect(maxTier('gate', 'self')).toBe('gate');
    expect(maxTier('gate', 'consensus')).toBe('consensus');
    expect(maxTier('self', 'self')).toBe('self');
  });
});

describe('deriveToolTierForServer (ADR-039, TL-08 Slice 1 — gepflegte Server-Klassen-Map)', () => {
  const callFor = (name: string): unknown => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name } });

  it('governed unifi: readOnly-Allowlist-Tools → self', () => {
    for (const n of ['list_clients', 'get_device', 'list_sites', 'get_client', 'list_firewall_policies']) {
      expect(deriveToolTierForServer('unifi', callFor(n))).toBe('self');
    }
  });

  it('governed unifi: block_client (schreibend) → gate', () => {
    expect(deriveToolTierForServer('unifi', callFor('block_client'))).toBe('gate');
  });

  it('governed unifi: delete_network (destruktiv) → consensus (kein Downgrade)', () => {
    expect(deriveToolTierForServer('unifi', callFor('delete_network'))).toBe('consensus');
  });

  it('governed unifi: unlisted Tools (locate_device/reorder_acl_rules) → gate, nicht self', () => {
    expect(deriveToolTierForServer('unifi', callFor('locate_device'))).toBe('gate');
    expect(deriveToolTierForServer('unifi', callFor('reorder_acl_rules'))).toBe('gate');
  });

  it('SECURITY: credential-/secret-nahe Reads → gate trotz get_/list_-Präfix (CR-MEDIUM)', () => {
    // Die Verb-Heuristik gäbe self; die Allowlist schließt sie aus → maxTier(gate, self) = gate.
    // Inkl. list_wans (PPPoE-Passwort) + get_network/list_networks (IPsec-PSK), CR-Codex-Befund.
    for (const n of [
      'get_wlan', 'list_wlans', 'get_voucher', 'list_vouchers', 'list_radius_profiles',
      'list_vpn_servers', 'list_vpn_tunnels', 'list_wans', 'get_network', 'list_networks',
    ]) {
      expect(deriveToolTierForServer('unifi', callFor(n))).toBe('gate');
    }
  });

  it('CR-MEDIUM: whitespace-umschlossener destruktiver Name bleibt consensus (getrimmte Verb-Klassifikation)', () => {
    expect(deriveToolTierForServer('unifi', callFor(' delete_network '))).toBe('consensus');
    expect(deriveToolTierForServer('unifi', callFor('  block_client'))).toBe('gate');
  });

  it('BLOCKER-Regression: tools/list auf governed unifi → self (Discovery bricht NICHT)', () => {
    expect(deriveToolTierForServer('unifi', { jsonrpc: '2.0', id: 1, method: 'tools/list' })).toBe('self');
  });

  it('Kanonisierung: /api/mcp/UNIFI (uppercase) bleibt governed (kein Bypass)', () => {
    expect(deriveToolTierForServer('UNIFI', callFor('list_clients'))).toBe('self');
    expect(deriveToolTierForServer('  Unifi ', callFor('block_client'))).toBe('gate');
  });

  it('Toolname exakt (fail-closed): falsche Groß-/Kleinschreibung → unlisted → gate', () => {
    expect(deriveToolTierForServer('unifi', callFor('Get_Device'))).toBe('gate');
    expect(deriveToolTierForServer('unifi', callFor('LIST_CLIENTS'))).toBe('gate');
  });

  it('ungoverned Server (pal): Verb-Heuristik unverändert', () => {
    expect(deriveToolTierForServer('pal', callFor('list_models'))).toBe('self');
    expect(deriveToolTierForServer('pal', callFor('delete_thing'))).toBe('consensus');
    expect(deriveToolTierForServer('pal', callFor('create_thing'))).toBe('gate');
  });

  it('Drift-Schutz: jede readOnly-Allowlist-Entry ist im echten 67-Tool-Inventar (readOnly ⊆ Fixture)', () => {
    const inventory = new Set(unifiFixture as string[]);
    expect((unifiFixture as string[]).length).toBe(67);
    const unifiClasses = SERVER_TOOL_CLASSES['unifi'];
    expect(unifiClasses).toBeDefined();
    for (const tool of unifiClasses?.readOnly ?? []) {
      expect(inventory.has(tool)).toBe(true); // Tippfehler in der Allowlist ⇒ Test rot statt stiller Read-Gate
    }
  });
});

describe('classifyGateReason (ADR-040, TL-08 Slice 2a — Audit-Gate-Grund)', () => {
  const callFor = (name: string): unknown => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name } });

  it('nicht gegatet (self) → null', () => {
    expect(classifyGateReason('unifi', callFor('list_clients'))).toBeNull();
    expect(classifyGateReason('unifi', { jsonrpc: '2.0', id: 1, method: 'tools/list' })).toBeNull();
    expect(classifyGateReason('pal', callFor('list_models'))).toBeNull();
  });

  it('diskriminierte Gründe: write / destructive / sensitive / invalid', () => {
    expect(classifyGateReason('unifi', callFor('block_client'))).toBe('write-verb');
    expect(classifyGateReason('unifi', callFor('delete_network'))).toBe('destructive-verb');
    expect(classifyGateReason('unifi', callFor('get_wlan'))).toBe('sensitive-governed');
    expect(classifyGateReason('unifi', callFor('list_wans'))).toBe('sensitive-governed');
    expect(classifyGateReason('unifi', callFor(''))).toBe('invalid-call');
  });

  it('KURATIONS-Signal: governed + read-ish Tool nicht allowlisted → unlisted-governed', () => {
    // Synthetisches neues unifi-Read (nicht in readOnly/sensitive) — der „go curate this tool"-Trigger.
    expect(classifyGateReason('unifi', callFor('list_futuretool'))).toBe('unlisted-governed');
  });

  it('SINGLE SOURCE OF TRUTH: über die volle 67-Tool-Fixture gilt (reason===null) ⟺ (tier===self)', () => {
    for (const tool of unifiFixture as string[]) {
      const gated = deriveToolTierForServer('unifi', callFor(tool)) !== 'self';
      const reason = classifyGateReason('unifi', callFor(tool));
      expect(reason !== null).toBe(gated); // Signal kann nie vom echten Gate abweichen
    }
  });
});

describe('computeToolClassDrift (ADR-040 — Snapshot-Lint) + sensitive-Invariante', () => {
  it('readOnly ∩ sensitive = ∅ (Invariante)', () => {
    const c = SERVER_TOOL_CLASSES['unifi'];
    expect(c).toBeDefined();
    for (const t of c?.sensitive ?? []) expect(c?.readOnly.has(t)).toBe(false);
  });

  it('gegen die committete Fixture: keine stale-Einträge, unclassified leer (Selbstkonsistenz)', () => {
    const c = SERVER_TOOL_CLASSES['unifi'];
    expect(c).toBeDefined();
    const drift = computeToolClassDrift(c as NonNullable<typeof c>, unifiFixture as string[]);
    expect(drift.staleReadOnly).toEqual([]);
    expect(drift.staleSensitive).toEqual([]);
    expect(drift.unclassified).toEqual([]); // 34 read-Verb-Tools = 24 readOnly + 10 sensitive
  });

  it('fängt Drift: entferntes readOnly-Tool → staleReadOnly; neues Read → unclassified', () => {
    const c = SERVER_TOOL_CLASSES['unifi'];
    const full = unifiFixture as string[];
    // (a) Live-Inventar OHNE list_clients → staleReadOnly meldet es.
    const withoutRead = full.filter((t) => t !== 'list_clients');
    expect(computeToolClassDrift(c as NonNullable<typeof c>, withoutRead).staleReadOnly).toContain('list_clients');
    // (b) Live-Inventar MIT einem neuen Read → unclassified meldet es.
    const withNew = [...full, 'list_brandnew'];
    expect(computeToolClassDrift(c as NonNullable<typeof c>, withNew).unclassified).toEqual(['list_brandnew']);
  });
});
