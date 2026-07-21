// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
import { describe, it, expect } from 'vitest';
import { buildToolSkeleton, buildToolOverview } from './tool-skeleton.js';
import { resolveMcp } from './mcp-service-registry.js';
import type { Capability } from './registry.js';

/**
 * Minimal-Capability für einen geteilten MCP-Server (`category='mcp'`, `skill_id='mcp:<server>'`);
 * genau die Felder, die das Tool-Skelett liest. `mcp(server, {...})` baut den Eintrag.
 */
function mcp(
  server: string,
  p: Partial<Capability> & { agent_id: string } = { agent_id: 'a1' },
): Capability {
  return {
    skill_id: `mcp:${server}`,
    category: 'mcp',
    version: '1.0.0',
    description: p.description ?? 'Ein MCP-Server.',
    agent_id: p.agent_id,
    health: p.health ?? 'healthy',
    trust_level: p.trust_level ?? 3,
    permissions: p.permissions ?? [],
    updated_at: '2026-07-21T09:00:00.000Z',
    ...p,
  } as Capability;
}

/** Nicht-MCP-Capability (normaler Skill) — muss vom Tool-Skelett ignoriert werden. */
function skill(p: Partial<Capability> & { skill_id: string; agent_id: string }): Capability {
  return {
    category: 'network',
    version: '1.0.0',
    description: 'Ein normaler Skill.',
    health: 'healthy',
    trust_level: 3,
    permissions: [],
    updated_at: '2026-07-21T09:00:00.000Z',
    ...p,
  } as Capability;
}

describe('buildToolSkeleton — MCP-Tool-Fläche (TL-21 Slice 6)', () => {
  it('projiziert einen MCP-Server auf die kompakten Felder (server ohne mcp:-Präfix)', () => {
    const out = buildToolSkeleton([
      mcp('unifi', {
        agent_id: 'a1',
        description: 'Steuert das UniFi-Netz. Mehr Details hier.',
        permissions: ['read'],
        trust_level: 3,
      }),
    ]);
    expect(out).toEqual([
      {
        server: 'unifi',
        summary: 'Steuert das UniFi-Netz.',
        execution_tier: 'self',
        providers: 1,
        health: 'healthy',
      },
    ]);
  });

  it('ignoriert Nicht-MCP-Capabilities (nur category=mcp / skill_id=mcp: zählt)', () => {
    const out = buildToolSkeleton([
      mcp('markitdown', { agent_id: 'a1' }),
      skill({ skill_id: 'net.scan', agent_id: 'a1' }),
      skill({ skill_id: 'mcp-lookalike', agent_id: 'a2', category: 'network' }), // kein category=mcp
    ]);
    expect(out.map((e) => e.server)).toEqual(['markitdown']);
  });

  it('dedupliziert pro Server über Provider; providers zählt die Anbieter', () => {
    const out = buildToolSkeleton([
      mcp('unifi', { agent_id: 'a1' }),
      mcp('unifi', { agent_id: 'a2' }),
      mcp('unifi', { agent_id: 'a3' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ server: 'unifi', providers: 3 });
  });

  it('kanonisiert den Servernamen: mcp:Unifi und mcp:unifi mergen zu EINEM Server (kein Split-Brain)', () => {
    const out = buildToolSkeleton([
      mcp('Unifi', { agent_id: 'a1' }),
      mcp('unifi', { agent_id: 'a2' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ server: 'unifi', providers: 2 });
  });

  it('summary stammt vom gesund-bevorzugten Provider (healthy vor degraded)', () => {
    const out = buildToolSkeleton([
      mcp('svc', { agent_id: 'b', description: 'Degraded-Beschreibung.', health: 'degraded' }),
      mcp('svc', { agent_id: 'a', description: 'Healthy-Beschreibung.', health: 'healthy' }),
    ]);
    expect(out[0].summary).toBe('Healthy-Beschreibung.');
  });

  it('health aggregiert: healthy wenn ≥1 Provider healthy', () => {
    const out = buildToolSkeleton([
      mcp('svc', { agent_id: 'a', health: 'offline' }),
      mcp('svc', { agent_id: 'b', health: 'healthy' }),
    ]);
    expect(out[0].health).toBe('healthy');
  });

  it('sortiert deterministisch nach server (locale-unabhängig)', () => {
    const out = buildToolSkeleton([
      mcp('charlie', { agent_id: 'a' }),
      mcp('alpha', { agent_id: 'a' }),
      mcp('bravo', { agent_id: 'a' }),
    ]);
    expect(out.map((e) => e.server)).toEqual(['alpha', 'bravo', 'charlie']);
  });

  it('leere/keine MCP-Eingabe → leeres Ergebnis', () => {
    expect(buildToolSkeleton([])).toEqual([]);
    expect(buildToolSkeleton([skill({ skill_id: 'x', agent_id: 'a' })])).toEqual([]);
  });
});

describe('buildToolSkeleton — execution_tier (self/gate/consensus)', () => {
  it('read-only permission + Trust ≥ Schwelle → self', () => {
    const out = buildToolSkeleton([
      mcp('svc', { agent_id: 'a', permissions: ['read'], trust_level: 3 }),
    ]);
    expect(out[0].execution_tier).toBe('self');
  });

  it('schreibende permission → gate', () => {
    const out = buildToolSkeleton([
      mcp('svc', { agent_id: 'a', permissions: ['write'], trust_level: 5 }),
    ]);
    expect(out[0].execution_tier).toBe('gate');
  });

  it('destruktive permission → consensus', () => {
    const out = buildToolSkeleton([
      mcp('svc', { agent_id: 'a', permissions: ['delete'], trust_level: 5 }),
    ]);
    expect(out[0].execution_tier).toBe('consensus');
  });

  it('KONSERVATIV: die restriktivste Stufe über alle Provider gewinnt (self + consensus → consensus)', () => {
    const out = buildToolSkeleton([
      mcp('svc', { agent_id: 'a', permissions: ['read'], trust_level: 3 }), // self
      mcp('svc', { agent_id: 'b', permissions: ['delete'], trust_level: 5 }), // consensus
    ]);
    expect(out[0].execution_tier).toBe('consensus');
  });

  it('niedriges Trust hebt self auf gate (fail-closed)', () => {
    const out = buildToolSkeleton([
      mcp('svc', { agent_id: 'a', permissions: ['read'], trust_level: 0 }),
    ]);
    expect(out[0].execution_tier).toBe('gate');
  });

  it('ein OFFLINE-Provider trägt weiter zur Stufen-Aggregation bei (konservativ, kein Under-claim)', () => {
    // Anders als resolveMcp (das offline-Provider fürs Routing überspringt) zählt das Skelett sie fürs
    // execution_tier-Maximum mit — over-claim ist die sichere Richtung für eine Erst-Orientierung.
    const out = buildToolSkeleton([
      mcp('svc', { agent_id: 'a', permissions: ['read'], trust_level: 5, health: 'healthy' }),
      mcp('svc', { agent_id: 'b', permissions: ['delete'], trust_level: 5, health: 'offline' }),
    ]);
    expect(out[0].execution_tier).toBe('consensus');
  });
});

describe('buildToolSkeleton — total gegen malformed Daten (kein 500er)', () => {
  it('non-string skill_id/category werfen nicht (isMcpCap total via asStr)', () => {
    const bad = {
      skill_id: 123,
      category: {},
      agent_id: 'a',
      description: 'x',
      health: 'healthy',
      trust_level: 3,
      permissions: [],
      version: '1',
      updated_at: '',
    } as unknown as Capability;
    expect(buildToolSkeleton([bad])).toEqual([]);
  });

  it('CR-MEDIUM: non-array permissions (geforgt) → FAIL-CLOSED gate, NICHT self (kein Under-claim)', () => {
    // Ein geforgtes/legacy `permissions: 'delete'` (String statt Array, trust≥Schwelle) darf NICHT als
    // `self` erscheinen — sonst weicht die Übersicht vom realen Routing-Pfad ab und behauptet die Stufe zu
    // niedrig. `providerTier` bodet malformed permissions auf mind. `gate`.
    for (const forged of ['not-an-array', 'delete', ''] as unknown as string[][]) {
      const out = buildToolSkeleton([
        mcp('svc', { agent_id: 'a', permissions: forged, trust_level: 5 }),
      ]);
      expect(out[0].execution_tier).toBe('gate');
    }
  });

  it('CR-MEDIUM: Array mit verworfenem non-string-Element → auf gate gebodet (Element hätte höher sein können)', () => {
    // ['read', 123]: 123 wird verworfen; base=self, aber ein verworfenes Element könnte ein höher-stufiges
    // Token gewesen sein → konservativ auf gate.
    const out = buildToolSkeleton([
      mcp('svc', {
        agent_id: 'a',
        permissions: ['read', 123] as unknown as string[],
        trust_level: 5,
      }),
    ]);
    expect(out[0].execution_tier).toBe('gate');
    // Sauberes Array mit demselben lesenden Token bleibt self (kein pauschales Hochstufen).
    const clean = buildToolSkeleton([
      mcp('svc2', { agent_id: 'a', permissions: ['read'], trust_level: 5 }),
    ]);
    expect(clean[0].execution_tier).toBe('self');
  });

  it('CR-MEDIUM: Übersichts-Stufe unter-behauptet resolveMcps abgeleitete Stufe NIE (Parität)', () => {
    // Parität mit dem realen Routing-Pfad: für jeden gesunden Provider muss die Übersichts-Stufe ≥ der von
    // resolveMcp abgeleiteten Stufe sein (maxTier == overview-Stufe bei Einzel-Provider).
    const rank = { self: 0, gate: 1, consensus: 2 } as const;
    const cases: Array<Partial<Capability>> = [
      { permissions: ['delete'], trust_level: 5 },
      { permissions: 'delete' as unknown as string[], trust_level: 5 },
      { permissions: ['write'], trust_level: 5 },
      { permissions: [], trust_level: 0 },
    ];
    for (const c of cases) {
      const cap = mcp('svc', { agent_id: 'a', ...c });
      const overview = buildToolSkeleton([cap])[0].execution_tier;
      const resolved = resolveMcp('svc', [cap])[0]?.execution_tier ?? 'self';
      expect(rank[overview]).toBeGreaterThanOrEqual(rank[resolved]);
    }
  });

  it('non-finite trust_level → fail-closed gate (kein fail-open)', () => {
    const out = buildToolSkeleton([
      mcp('svc', { agent_id: 'a', permissions: ['read'], trust_level: NaN as unknown as number }),
    ]);
    expect(out[0].execution_tier).toBe('gate');
  });

  it('non-string description → leerer summary, kein throw', () => {
    const out = buildToolSkeleton([
      mcp('svc', { agent_id: 'a', description: 123 as unknown as string }),
    ]);
    expect(out[0].summary).toBe('');
  });

  it('leerer Servername (skill_id exakt "mcp:") wird übersprungen', () => {
    const out = buildToolSkeleton([mcp('', { agent_id: 'a' })]);
    expect(out).toEqual([]);
  });
});

describe('buildToolOverview', () => {
  it('Envelope { tools, count } mit count === tools.length', () => {
    const out = buildToolOverview([
      mcp('unifi', { agent_id: 'a' }),
      mcp('markitdown', { agent_id: 'a' }),
    ]);
    expect(out.count).toBe(2);
    expect(out.tools).toHaveLength(2);
    expect(out.count).toBe(out.tools.length);
  });

  it('leere Eingabe → { tools: [], count: 0 }', () => {
    expect(buildToolOverview([])).toEqual({ tools: [], count: 0 });
  });
});
