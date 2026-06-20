/**
 * Unit tests for ADR-028 D4-a registration slice (compose config + model → register).
 */
import { describe, it, expect, vi } from 'vitest';
import type { Capability } from './registry.js';
import { buildSharedMcpCapabilities, registerSharedMcps } from './mcp-registration.js';

const AGENT = 'spiffe://thinklocal/node/12D3KooWA000000000000000000000000000000000000000';
const TS = '2026-06-20T16:00:00.000Z';

describe('buildSharedMcpCapabilities', () => {
  it('composes enabled shared MCPs into base Capabilities (default-open, execution_tier stripped)', () => {
    const raw = [
      { server: 'unifi', description: 'UniFi controller', tools: ['list_clients'], version: '1.0.0', permissions: ['network.read'], trust_level: 4 },
      { server: 'markitdown', description: 'Markdown conversion', permissions: ['convert'], trust_level: 5 },
    ];
    const { capabilities, skipped } = buildSharedMcpCapabilities(raw, AGENT, TS);
    expect(skipped).toEqual([]);
    expect(capabilities.map((c) => c.skill_id).sort()).toEqual(['mcp:markitdown', 'mcp:unifi']);
    const unifi = capabilities.find((c) => c.skill_id === 'mcp:unifi');
    expect(unifi?.category).toBe('mcp');
    expect(unifi?.agent_id).toBe(AGENT);
    expect(unifi?.updated_at).toBe(TS);
    expect(unifi?.description).toContain('list_clients'); // tools folded in
    // execution_tier must NOT be present on the CRDT-bound Capability
    expect('execution_tier' in (unifi as object)).toBe(false);
  });

  it('opt-out via share=false is excluded (default-open)', () => {
    const raw = [
      { server: 'a', description: 'A' },
      { server: 'b', description: 'B', share: false },
    ];
    const { capabilities } = buildSharedMcpCapabilities(raw, AGENT, TS);
    expect(capabilities.map((c) => c.skill_id)).toEqual(['mcp:a']);
  });

  it('per-entry fail-soft: a structurally-valid entry with an invalid server name is skipped, not thrown', () => {
    const raw = [
      { server: 'ok', description: 'fine' },
      { server: 'bad name', description: 'has space → buildMcpCapability rejects' },
    ];
    const { capabilities, skipped } = buildSharedMcpCapabilities(raw, AGENT, TS);
    expect(capabilities.map((c) => c.skill_id)).toEqual(['mcp:ok']);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].server).toBe('bad name');
    expect(skipped[0].reason).toMatch(/server/i);
  });

  it('structurally-invalid config fails fast (parse throws)', () => {
    expect(() => buildSharedMcpCapabilities([{ description: 'no server' }], AGENT, TS)).toThrow();
    expect(() => buildSharedMcpCapabilities('nope', AGENT, TS)).toThrow();
  });

  it('undefined config → empty result', () => {
    expect(buildSharedMcpCapabilities(undefined, AGENT, TS)).toEqual({ capabilities: [], skipped: [] });
  });

  it('owner-gated: a forged agent_id in the raw config is ignored — only the injected agentId is used (CR-MEDIUM)', () => {
    const raw = [{ server: 'unifi', description: 'UniFi', agent_id: 'spiffe://thinklocal/node/evil' }] as unknown;
    const { capabilities } = buildSharedMcpCapabilities(raw, AGENT, TS);
    expect(capabilities).toHaveLength(1);
    expect(capabilities[0].agent_id).toBe(AGENT);
  });
});

describe('registerSharedMcps', () => {
  it('registers every built capability into the registry and returns the count', () => {
    const registry = { register: vi.fn() };
    const result = buildSharedMcpCapabilities(
      [{ server: 'unifi', description: 'UniFi' }, { server: 'e3dc', description: 'E3DC' }],
      AGENT,
      TS,
    );
    const n = registerSharedMcps(registry, result);
    expect(n).toBe(2);
    expect(registry.register).toHaveBeenCalledTimes(2);
    const registered = registry.register.mock.calls.map((c) => (c[0] as Capability).skill_id).sort();
    expect(registered).toEqual(['mcp:e3dc', 'mcp:unifi']);
  });

  it('logs skipped entries but still registers the valid ones', () => {
    const registry = { register: vi.fn() };
    const warn = vi.fn();
    const result = buildSharedMcpCapabilities(
      [{ server: 'ok', description: 'fine' }, { server: 'a/b', description: 'invalid' }],
      AGENT,
      TS,
    );
    const n = registerSharedMcps(registry, result, { warn, info: vi.fn() } as never);
    expect(n).toBe(1);
    expect(registry.register).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('empty result registers nothing, returns 0', () => {
    const registry = { register: vi.fn() };
    expect(registerSharedMcps(registry, { capabilities: [], skipped: [] })).toBe(0);
    expect(registry.register).not.toHaveBeenCalled();
  });
});
