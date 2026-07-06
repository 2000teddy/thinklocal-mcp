// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
import { describe, it, expect } from 'vitest';
import { CapabilityRegistry, type Capability } from './registry.js';

function makeCap(agentId: string, skillId: string, overrides?: Partial<Capability>): Capability {
  return {
    skill_id: skillId,
    version: '1.0.0',
    description: `Test skill ${skillId}`,
    agent_id: agentId,
    health: 'healthy',
    trust_level: 3,
    updated_at: new Date().toISOString(),
    category: 'database',
    permissions: ['network.local'],
    ...overrides,
  };
}

describe('CapabilityRegistry — CRDT-basierte verteilte Registry', () => {
  const agentA = 'spiffe://thinklocal/host/a/agent/claude-code';
  const agentB = 'spiffe://thinklocal/host/b/agent/gemini-cli';

  it('registriert und findet Capabilities nach skill_id', () => {
    const registry = new CapabilityRegistry();
    registry.register(makeCap(agentA, 'influxdb.read'));
    registry.register(makeCap(agentB, 'influxdb.read', { version: '2.0.0' }));

    const results = registry.findBySkill('influxdb.read');
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.agent_id)).toContain(agentA);
    expect(results.map((r) => r.agent_id)).toContain(agentB);
  });

  it('findet Capabilities nach Kategorie', () => {
    const registry = new CapabilityRegistry();
    registry.register(makeCap(agentA, 'influxdb.read', { category: 'database' }));
    registry.register(makeCap(agentA, 'system.monitor', { category: 'monitoring' }));

    expect(registry.findByCategory('database')).toHaveLength(1);
    expect(registry.findByCategory('monitoring')).toHaveLength(1);
    expect(registry.findByCategory('ai')).toHaveLength(0);
  });

  it('gibt alle Capabilities eines Agents zurück', () => {
    const registry = new CapabilityRegistry();
    registry.register(makeCap(agentA, 'skill-1'));
    registry.register(makeCap(agentA, 'skill-2'));
    registry.register(makeCap(agentB, 'skill-3'));

    expect(registry.getAgentCapabilities(agentA)).toHaveLength(2);
    expect(registry.getAgentCapabilities(agentB)).toHaveLength(1);
  });

  it('entfernt eine Capability', () => {
    const registry = new CapabilityRegistry();
    registry.register(makeCap(agentA, 'temp-skill'));
    expect(registry.getAllCapabilities()).toHaveLength(1);

    registry.unregister(agentA, 'temp-skill');
    expect(registry.getAllCapabilities()).toHaveLength(0);
  });

  it('markiert Agent als offline', () => {
    const registry = new CapabilityRegistry();
    registry.register(makeCap(agentA, 'skill-1'));
    registry.register(makeCap(agentA, 'skill-2'));

    registry.markAgentOffline(agentA);

    // findBySkill filtert offline Capabilities
    expect(registry.findBySkill('skill-1')).toHaveLength(0);
    // Aber getAgentCapabilities zeigt sie noch (mit health: offline)
    const caps = registry.getAgentCapabilities(agentA);
    expect(caps).toHaveLength(2);
    expect(caps.every((c) => c.health === 'offline')).toBe(true);
  });

  it('berechnet einen stabilen Capability-Hash', () => {
    const registry = new CapabilityRegistry();
    registry.register(makeCap(agentA, 'skill-1'));
    const hash1 = registry.getCapabilityHash();
    expect(hash1).toHaveLength(16);

    // Gleicher Zustand → gleicher Hash
    const hash2 = registry.getCapabilityHash();
    expect(hash2).toBe(hash1);
  });

  it('synchronisiert zwei Registries via Capability-Import', () => {
    const registryA = new CapabilityRegistry();
    const registryB = new CapabilityRegistry();

    registryA.register(makeCap(agentA, 'skill-from-a'));
    registryB.register(makeCap(agentB, 'skill-from-b'));

    // B importiert A's Capabilities DIREKT von A (writer = agentA, owner-gated).
    const capsFromA = registryA.exportCapabilities();
    const imported = registryB.importPeerCapabilities(capsFromA, agentA);

    expect(imported).toBe(1);
    expect(registryB.getAllCapabilities()).toHaveLength(2);
    expect(registryB.findBySkill('skill-from-a')).toHaveLength(1);
    expect(registryB.findBySkill('skill-from-b')).toHaveLength(1);
  });

  it('importiert nur neuere Capabilities bei Konflikten', () => {
    const registry = new CapabilityRegistry();
    registry.register(makeCap(agentA, 'skill-1', { version: '1.0.0' }));

    // Importiere ältere Version — sollte ignoriert werden
    const olderCap = makeCap(agentA, 'skill-1', {
      version: '0.9.0',
      updated_at: '2020-01-01T00:00:00Z',
    });
    const imported = registry.importPeerCapabilities([olderCap], agentA);
    expect(imported).toBe(0);
    expect(registry.findBySkill('skill-1')[0].version).toBe('1.0.0');
  });

  it('speichert und lädt den Registry-Zustand', () => {
    const registry = new CapabilityRegistry();
    registry.register(makeCap(agentA, 'persistent-skill'));

    const saved = registry.save();
    expect(saved).toBeInstanceOf(Uint8Array);

    const loaded = new CapabilityRegistry();
    loaded.load(saved);
    expect(loaded.findBySkill('persistent-skill')).toHaveLength(1);
  });
});

describe('CapabilityRegistry — ADR-020 v2.2 availability (direct-only, owner-gated)', () => {
  const agentA = 'spiffe://thinklocal/host/a/agent/claude-code';
  const agentB = 'spiffe://thinklocal/host/b/agent/gemini-cli';
  const ts = '2026-06-05T10:00:00Z';

  it('ROUTING: findBySkill/findByCategory filtern availability=unhealthy (aus der Side-Map) heraus', () => {
    const r = new CapabilityRegistry();
    r.register(makeCap(agentA, 'influxdb.read'));
    r.register(makeCap(agentB, 'influxdb.read'));
    r.setAvailability(agentB, 'influxdb.read', 'unhealthy', 3, ts); // B (Owner) markiert sich unhealthy
    const bySkill = r.findBySkill('influxdb.read');
    expect(bySkill.map((c) => c.agent_id)).toEqual([agentA]); // nur B weggefiltert
    expect(r.findByCategory('database').every((c) => r.getAvailability(c.agent_id, c.skill_id) !== 'unhealthy')).toBe(true);
  });

  it('Default: ohne setAvailability gilt eine Capability als verfügbar (healthy)', () => {
    const r = new CapabilityRegistry();
    r.register(makeCap(agentA, 's'));
    expect(r.getAvailability(agentA, 's')).toBe('healthy');
    expect(r.findBySkill('s')).toHaveLength(1);
  });

  it('setAvailability ist owner-gekeyt + idempotent (Side-Map, NICHT im CRDT-Hash)', () => {
    const r = new CapabilityRegistry();
    r.register(makeCap(agentA, 'influxdb'));
    const h0 = r.getCapabilityHash();
    expect(r.setAvailability(agentA, 'influxdb', 'unhealthy', 3, ts)).toBe(true);
    expect(r.getAvailability(agentA, 'influxdb')).toBe('unhealthy');
    // availability ist NICHT im CRDT-Existenz-Hash (direct-only Side-Map, kein Relay)
    expect(r.getCapabilityHash()).toBe(h0);
    // idempotent: gleicher availability-State → kein Change
    expect(r.setAvailability(agentA, 'influxdb', 'unhealthy', 9, ts)).toBe(false);
  });

  it('GUARDRAIL (Pflicht): RELAYTE availability (writer != owner) wird VERWORFEN — owner-wins', () => {
    const r = new CapabilityRegistry();
    // B (writer) versucht, A's Capability MIT availability=unhealthy einzuschleusen (Relay/Spoof).
    const relayed = { ...makeCap(agentA, 'influxdb'), availability: 'unhealthy' as const, last_checked_at: ts, consecutive_failures: 5 };
    const imported = r.importPeerCapabilities([relayed], agentB); // writer=B != owner=A
    expect(imported).toBe(0); // fremde Capability komplett verworfen
    expect(r.getRejectedForeignWrites()).toBe(1); // Metrik erhöht
    expect(r.getAvailability(agentA, 'influxdb')).toBe('healthy'); // KEINE relayte availability übernommen

    // Gegenprobe: derselbe Eintrag DIREKT vom Owner (writer=A) → akzeptiert + availability gesetzt.
    const direct = { ...makeCap(agentA, 'influxdb'), availability: 'unhealthy' as const, last_checked_at: ts, consecutive_failures: 5 };
    expect(r.importPeerCapabilities([direct], agentA)).toBe(1);
    expect(r.getAvailability(agentA, 'influxdb')).toBe('unhealthy');
  });

  it('CR-MEDIUM: ungültiger availability-Wert (z.B. "degraded") wird NICHT übernommen (→ healthy)', () => {
    const r = new CapabilityRegistry();
    const bogus = { ...makeCap(agentA, 's'), availability: 'degraded', last_checked_at: ts, consecutive_failures: 2 };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    r.importPeerCapabilities([bogus as any], agentA);
    expect(r.getAvailability(agentA, 's')).toBe('healthy'); // nur 'healthy'|'unhealthy' erlaubt
  });

  it('CR-MEDIUM: unregister räumt die availability-Side-Map (kein stale bei Re-Register)', () => {
    const r = new CapabilityRegistry();
    r.register(makeCap(agentA, 's'));
    r.setAvailability(agentA, 's', 'unhealthy', 3, ts);
    expect(r.getAvailability(agentA, 's')).toBe('unhealthy');
    r.unregister(agentA, 's');
    r.register(makeCap(agentA, 's')); // Re-Register
    expect(r.getAvailability(agentA, 's')).toBe('healthy'); // kein stale 'unhealthy'
  });
});
