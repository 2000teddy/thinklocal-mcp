// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
import { describe, it, expect } from 'vitest';
import { firstSentence, buildCapabilitySkeleton } from './capability-skeleton.js';
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
});
