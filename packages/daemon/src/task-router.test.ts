import { describe, it, expect } from 'vitest';
import { TaskRouter, type RoutableAgent } from './task-router.js';
import type { Capability } from './registry.js';

describe('TaskRouter', () => {
  const router = new TaskRouter();
  const localId = 'spiffe://thinklocal/host/local/agent/claude-code';
  const remoteId = 'spiffe://thinklocal/host/remote/agent/claude-code';

  const localAgent: RoutableAgent = {
    agentId: localId,
    host: '127.0.0.1',
    port: 9440,
    endpoint: 'http://127.0.0.1:9440',
    cpuPercent: 20,
    isLocal: true,
  };

  const remoteAgent: RoutableAgent = {
    agentId: remoteId,
    host: '10.10.10.56',
    port: 9440,
    endpoint: 'http://10.10.10.56:9440',
    cpuPercent: 60,
    isLocal: false,
  };

  const agents = new Map<string, RoutableAgent>([
    [localId, localAgent],
    [remoteId, remoteAgent],
  ]);

  const capabilities: Capability[] = [
    { skill_id: 'system.health', version: '1.0.0', description: 'Health check', agent_id: localId, health: 'healthy', trust_level: 1, updated_at: '', category: 'monitoring', permissions: [] },
    { skill_id: 'system.health', version: '1.0.0', description: 'Health check', agent_id: remoteId, health: 'healthy', trust_level: 1, updated_at: '', category: 'monitoring', permissions: [] },
    { skill_id: 'influxdb.query', version: '1.0.0', description: 'InfluxDB query', agent_id: remoteId, health: 'healthy', trust_level: 1, updated_at: '', category: 'database', permissions: [] },
  ];

  it('bevorzugt lokalen Peer bei gleichem Skill', () => {
    const result = router.route('system.health', capabilities, agents, localId);
    expect(result).not.toBeNull();
    expect(result!.agent.isLocal).toBe(true);
  });

  it('routet zu Remote wenn Skill nur dort verfuegbar', () => {
    const result = router.route('influxdb.query', capabilities, agents, localId);
    expect(result).not.toBeNull();
    expect(result!.agent.host).toBe('10.10.10.56');
  });

  it('gibt null zurueck wenn kein Peer den Skill hat', () => {
    const result = router.route('nonexistent.skill', capabilities, agents, localId);
    expect(result).toBeNull();
  });

  it('bevorzugt healthy ueber degraded (gleiche Bedingungen)', () => {
    // Beide Agents gleich (nicht-lokal, gleiche CPU) — nur Health unterscheidet
    const remoteHealthy: RoutableAgent = { ...remoteAgent, agentId: 'healthy-agent', cpuPercent: 50, isLocal: false };
    const remoteDegraded: RoutableAgent = { ...remoteAgent, agentId: 'degraded-agent', cpuPercent: 50, isLocal: false };
    const testAgents = new Map([['healthy-agent', remoteHealthy], ['degraded-agent', remoteDegraded]]);
    const caps: Capability[] = [
      { ...capabilities[0], agent_id: 'degraded-agent', health: 'degraded' },
      { ...capabilities[0], agent_id: 'healthy-agent', health: 'healthy' },
    ];
    const result = router.route('system.health', caps, testAgents, localId);
    expect(result).not.toBeNull();
    expect(result!.agent.agentId).toBe('healthy-agent');
  });

  it('listet alle Kandidaten sortiert nach Score', () => {
    const result = router.route('system.health', capabilities, agents, localId);
    expect(result).not.toBeNull();
    expect(result!.candidates.length).toBe(2);
    expect(result!.candidates[0].score).toBeGreaterThanOrEqual(result!.candidates[1].score);
  });

  it('Prefix-Match funktioniert', () => {
    const result = router.route('influxdb', capabilities, agents, localId);
    expect(result).not.toBeNull();
    expect(result!.capability.skill_id).toBe('influxdb.query');
  });
});
