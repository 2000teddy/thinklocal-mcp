/**
 * Unit tests for ADR-028 D4-a: MCP service registry (pure model + resolution).
 */
import { describe, it, expect } from 'vitest';
import type { Capability } from './registry.js';
import {
  buildMcpCapability,
  deriveExecutionTier,
  resolveMcp,
  isMcpCapability,
  MCP_CATEGORY,
} from './mcp-service-registry.js';

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
