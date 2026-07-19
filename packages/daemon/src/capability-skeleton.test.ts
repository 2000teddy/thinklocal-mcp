// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
import { describe, it, expect } from 'vitest';
import { firstSentence, buildCapabilitySkeleton, buildCapabilityOverview } from './capability-skeleton.js';
import type { Capability, CapabilityHealth } from './registry.js';

function cap(p: Partial<Capability> & { skill_id: string; agent_id: string }): Capability {
  return {
    version: '1.0.0',
    description: '',
    health: 'healthy',
    trust_level: 3,
    updated_at: '2026-07-16T00:00:00.000Z',
    category: 'misc',
    permissions: [],
    ...p,
  } as Capability;
}

describe('firstSentence', () => {
  it('schneidet am ersten Satz-Terminator (inkl.)', () => {
    expect(firstSentence('Liest Zeitreihen aus InfluxDB. Weitere Details folgen.')).toBe(
      'Liest Zeitreihen aus InfluxDB.',
    );
    expect(firstSentence('Wirklich? Ja.')).toBe('Wirklich?');
    expect(firstSentence('Achtung! Mehr.')).toBe('Achtung!');
  });
  it('ohne Terminator → ganzer getrimmter Text (unter Limit)', () => {
    expect(firstSentence('  Kurzbeschreibung ohne Punkt  ')).toBe('Kurzbeschreibung ohne Punkt');
  });
  it('ohne Terminator + über Limit → gekürzt mit …', () => {
    const long = 'x'.repeat(200);
    const out = firstSentence(long);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(161); // 160 + „…"
  });
  it('CR-MEDIUM Regression: langer erster Satz MIT Terminator wird ebenfalls gekappt (Kompaktheit)', () => {
    const hugeSentence = 'a'.repeat(8000) + '.'; // untrusted CRDT-„Ein-Satz"
    const out = firstSentence(hugeSentence);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(161);
  });
  it('CR-LOW: Dezimalzahl/Version zerschneidet den Satz NICHT (Lookahead)', () => {
    expect(firstSentence('Liefert Werte mit 3.14 Genauigkeit. Mehr.')).toBe('Liefert Werte mit 3.14 Genauigkeit.');
    expect(firstSentence('Liest InfluxDB v3.14 Daten.')).toBe('Liest InfluxDB v3.14 Daten.');
  });
  it('leere/whitespace-only Eingabe → leerer String', () => {
    expect(firstSentence('')).toBe('');
    expect(firstSentence('   ')).toBe('');
  });
  it('CR-MEDIUM Regression: non-string / null / undefined Eingabe → leerer String (kein throw)', () => {
    // `description` ist runtime-untyped (CRDT-Wire, nicht schema-validiert). Ein geschmiedeter
    // Nicht-String darf `.trim()` nicht sprengen — total statt „trim is not a function"-500.
    for (const bad of [123, 0, {}, [], true, false, null, undefined] as unknown[]) {
      expect(() => firstSentence(bad)).not.toThrow();
      expect(firstSentence(bad)).toBe('');
    }
  });
});

describe('buildCapabilitySkeleton', () => {
  it('dedupliziert pro skill_id und zählt Provider', () => {
    const out = buildCapabilitySkeleton([
      cap({ skill_id: 'db.read', agent_id: 'a', description: 'Liest DB. x' }),
      cap({ skill_id: 'db.read', agent_id: 'b', description: 'Liest DB. y' }),
      cap({ skill_id: 'ai.chat', agent_id: 'a', description: 'Chattet.' }),
    ]);
    expect(out.map((e) => e.skill_id)).toEqual(['ai.chat', 'db.read']); // sortiert
    const providersBySkill = Object.fromEntries(out.map((e) => [e.skill_id, e.providers]));
    expect(providersBySkill['db.read']).toBe(2);
    expect(providersBySkill['ai.chat']).toBe(1);
  });

  it('summary = erster Satz vom gesund-bevorzugten Provider', () => {
    const out = buildCapabilitySkeleton([
      cap({ skill_id: 's', agent_id: 'z', description: 'OFFLINE-Text.', health: 'offline' }),
      cap({ skill_id: 's', agent_id: 'a', description: 'HEALTHY-Text. mehr', health: 'healthy' }),
    ]);
    expect(out[0].summary).toBe('HEALTHY-Text.');
  });

  it('gesund-bevorzugt: bei Gleichstand lexikografisch nach agent_id', () => {
    const out = buildCapabilitySkeleton([
      cap({ skill_id: 's', agent_id: 'b', description: 'Von B.', health: 'healthy', category: 'catB' }),
      cap({ skill_id: 's', agent_id: 'a', description: 'Von A.', health: 'healthy', category: 'catA' }),
    ]);
    expect(out[0].summary).toBe('Von A.');
    expect(out[0].category).toBe('catA');
  });

  it('health-Aggregation: ein healthy Provider ⇒ healthy', () => {
    const h = buildCapabilitySkeleton([
      cap({ skill_id: 's', agent_id: 'a', health: 'offline' }),
      cap({ skill_id: 's', agent_id: 'b', health: 'healthy' }),
    ]);
    expect(h[0].health).toBe('healthy');
  });
  it('health-Aggregation: kein healthy, aber degraded ⇒ degraded', () => {
    const d = buildCapabilitySkeleton([
      cap({ skill_id: 's', agent_id: 'a', health: 'offline' }),
      cap({ skill_id: 's', agent_id: 'b', health: 'degraded' }),
    ]);
    expect(d[0].health).toBe('degraded');
  });
  it('health-Aggregation: nur offline ⇒ offline', () => {
    const o = buildCapabilitySkeleton([
      cap({ skill_id: 's', agent_id: 'a', health: 'offline' as CapabilityHealth }),
    ]);
    expect(o[0].health).toBe('offline');
  });

  it('leere Eingabe → []', () => {
    expect(buildCapabilitySkeleton([])).toEqual([]);
  });

  // ── CR-MEDIUM #281: total gegen malformed CRDT-Capabilities (authentifizierter/buggy Peer) ──
  // importPeerCapabilities schema-validiert weder description noch skill_id/agent_id/category. Eine
  // einzelne geschmiedete Capability darf die additive Read-View nicht in einen 500er kippen.
  const bad = (o: Record<string, unknown>): Capability =>
    ({
      version: '1.0.0', description: '', health: 'healthy', trust_level: 3,
      updated_at: '2026-07-16T00:00:00.000Z', category: 'misc', permissions: [], ...o,
    }) as unknown as Capability;

  it('non-string description → summary "" (kein throw), Eintrag bleibt bounded', () => {
    for (const badDesc of [123, {}, [], true, null] as unknown[]) {
      const out = buildCapabilitySkeleton([bad({ skill_id: 's', agent_id: 'a', description: badDesc })]);
      expect(out).toHaveLength(1);
      expect(out[0].summary).toBe('');
      expect(out[0].skill_id).toBe('s');
    }
  });

  it('non-string/leerer skill_id (unprojektierbarer Grouping-Key) → übersprungen, valide Einträge bleiben', () => {
    const out = buildCapabilitySkeleton([
      bad({ skill_id: 123, agent_id: 'a', description: 'Geschmiedet.' }),
      bad({ skill_id: {}, agent_id: 'b', description: 'Auch geschmiedet.' }),
      bad({ skill_id: '', agent_id: 'c', description: 'Leerer Key.' }),
      bad({ skill_id: 'ok', agent_id: 'd', description: 'Valide.' }),
    ]);
    expect(out.map((e) => e.skill_id)).toEqual(['ok']); // nur der valide Eintrag, deterministisch
    expect(out[0].summary).toBe('Valide.');
  });

  it('non-string category/agent_id → normalisiert auf "", Sort/Tie-Break deterministisch (kein throw)', () => {
    const out = buildCapabilitySkeleton([
      bad({ skill_id: 's', agent_id: {}, description: 'Von obj-id.', category: 456, health: 'healthy' }),
      bad({ skill_id: 's', agent_id: 'a', description: 'Von a.', category: 'catA', health: 'healthy' }),
    ]);
    expect(out).toHaveLength(1);
    // agent_id 'a' > asStr({})='' → '' bevorzugt (lexikografisch kleiner); category dieses Providers = 456→''.
    expect(out[0].category).toBe('');
    expect(out[0].summary).toBe('Von obj-id.');
    expect(typeof out[0].category).toBe('string');
  });

  it('gemischte malformed + valide Eingabe → wirft nie, Ergebnis bounded/total', () => {
    expect(() =>
      buildCapabilitySkeleton([
        bad({ skill_id: null, agent_id: 42, description: [], category: {} }),
        bad({ skill_id: 'real', agent_id: 'x', description: 'Echt. mehr', health: 'degraded' }),
      ]),
    ).not.toThrow();
  });
});

describe('buildCapabilityOverview (gemeinsamer Envelope, REST + MCP)', () => {
  it('wraps buildCapabilitySkeleton als { skills, count } mit count === skills.length', () => {
    const caps = [
      cap({ skill_id: 'b.two', agent_id: 'a1', description: 'Zwei.' }),
      cap({ skill_id: 'a.one', agent_id: 'a1', description: 'Eins.' }),
    ];
    const ov = buildCapabilityOverview(caps);
    expect(ov.skills).toEqual(buildCapabilitySkeleton(caps));
    expect(ov.count).toBe(ov.skills.length);
    expect(ov.count).toBe(2);
  });

  it('leere Eingabe → { skills: [], count: 0 }', () => {
    expect(buildCapabilityOverview([])).toEqual({ skills: [], count: 0 });
  });
});
