/**
 * Unit tests for ADR-028 D4-b routing decision (pure self/remote/none planner).
 */
import { describe, it, expect } from 'vitest';
import type { McpResolution } from './mcp-service-registry.js';
import { planMcpRoute } from './mcp-routing.js';

const SELF = 'spiffe://thinklocal/node/12D3KooWSELF00000000000000000000000000000000000000';
const PEER1 = 'spiffe://thinklocal/node/12D3KooWPEER1000000000000000000000000000000000000';
const PEER2 = 'spiffe://thinklocal/node/12D3KooWPEER2000000000000000000000000000000000000';

const res = (
  agent_id: string,
  health: McpResolution['health'],
  tier: McpResolution['execution_tier'] = 'self',
  skill_id = 'mcp:unifi',
): McpResolution => ({
  agent_id,
  skill_id,
  description: 'UniFi',
  version: '1.0.0',
  trust_level: 4,
  health,
  execution_tier: tier,
});

describe('planMcpRoute', () => {
  it('local when own node is a (non-offline) provider, even if peers also serve it', () => {
    const plan = planMcpRoute('unifi', [res(PEER1, 'healthy'), res(SELF, 'degraded', 'gate')], SELF);
    expect(plan.mode).toBe('local');
    if (plan.mode !== 'local') throw new Error('expected local');
    expect(plan.execution_tier).toBe('gate');
    expect(plan.server).toBe('unifi');
  });

  it('remote to a peer when self does not serve it', () => {
    const plan = planMcpRoute('unifi', [res(PEER1, 'healthy')], SELF);
    expect(plan.mode).toBe('remote');
    if (plan.mode !== 'remote') throw new Error('expected remote');
    expect(plan.target.agent_id).toBe(PEER1);
  });

  it('prefers a healthy peer over a degraded one (deterministic)', () => {
    const plan = planMcpRoute('unifi', [res(PEER1, 'degraded'), res(PEER2, 'healthy')], SELF);
    expect(plan.mode).toBe('remote');
    if (plan.mode !== 'remote') throw new Error('expected remote');
    expect(plan.target.agent_id).toBe(PEER2);
  });

  it('falls back to a degraded peer when none are healthy', () => {
    const plan = planMcpRoute('unifi', [res(PEER1, 'degraded')], SELF);
    expect(plan.mode).toBe('remote');
    if (plan.mode !== 'remote') throw new Error('expected remote');
    expect(plan.target.agent_id).toBe(PEER1);
    expect(plan.target.health).toBe('degraded');
  });

  it('none when no providers at all', () => {
    const plan = planMcpRoute('unifi', [], SELF);
    expect(plan.mode).toBe('none');
    if (plan.mode !== 'none') throw new Error('expected none');
    expect(plan.reason).toMatch(/kein Provider/);
  });

  it('none when every provider is offline (defensive — resolveMcp already skips offline)', () => {
    const plan = planMcpRoute('unifi', [res(PEER1, 'offline'), res(PEER2, 'offline')], SELF);
    expect(plan.mode).toBe('none');
    if (plan.mode !== 'none') throw new Error('expected none');
    expect(plan.reason).toMatch(/offline/);
  });

  it('skips an offline self and routes to a live peer instead', () => {
    const plan = planMcpRoute('unifi', [res(SELF, 'offline'), res(PEER1, 'healthy')], SELF);
    expect(plan.mode).toBe('remote');
    if (plan.mode !== 'remote') throw new Error('expected remote');
    expect(plan.target.agent_id).toBe(PEER1);
  });

  it('tie-break among two healthy peers is deterministic (first)', () => {
    const plan = planMcpRoute('unifi', [res(PEER1, 'healthy'), res(PEER2, 'healthy')], SELF);
    expect(plan.mode).toBe('remote');
    if (plan.mode !== 'remote') throw new Error('expected remote');
    expect(plan.target.agent_id).toBe(PEER1);
  });

  it('fail-closed: a resolution for a DIFFERENT server (mis-wired caller) is not routed (CR-MEDIUM)', () => {
    // skill_id mcp:other != requested unifi → must NOT route to it.
    const plan = planMcpRoute('unifi', [res(PEER1, 'healthy', 'self', 'mcp:other')], SELF);
    expect(plan.mode).toBe('none');
    if (plan.mode !== 'none') throw new Error('expected none');
    expect(plan.reason).toMatch(/kein Provider/);
  });

  it('canonicalizes the server name when matching (case-insensitive)', () => {
    const plan = planMcpRoute('UniFi', [res(PEER1, 'healthy')], SELF); // resolutions are skill_id mcp:unifi
    expect(plan.mode).toBe('remote');
  });

  it('is pure — does not mutate the input resolutions (frozen input)', () => {
    const input = Object.freeze([Object.freeze(res(PEER1, 'healthy')), Object.freeze(res(PEER2, 'degraded'))]);
    expect(() => planMcpRoute('unifi', input as unknown as McpResolution[], SELF)).not.toThrow();
    expect(input).toHaveLength(2); // unchanged
  });
});
