/**
 * peer-selection.test.ts — T2.4-Folge: least-loaded-Auswahllogik.
 */
import { describe, it, expect } from 'vitest';
import { compareLoad, pickLeastLoaded, buildLoadMap, type PeerLoad } from './peer-selection.js';

const load = (ram: number, cpu: number, agents: number): PeerLoad => ({
  ram_used_percent: ram,
  cpu_load: cpu,
  agent_count: agents,
});

describe('compareLoad (lexikografisch RAM → CPU → agents)', () => {
  it('RAM dominiert', () => {
    expect(compareLoad(load(10, 99, 99), load(20, 0, 0))).toBeLessThan(0);
  });
  it('bei gleichem RAM entscheidet CPU', () => {
    expect(compareLoad(load(50, 10, 99), load(50, 20, 0))).toBeLessThan(0);
  });
  it('bei gleichem RAM+CPU entscheidet agent_count', () => {
    expect(compareLoad(load(50, 50, 2), load(50, 50, 5))).toBeLessThan(0);
    expect(compareLoad(load(50, 50, 5), load(50, 50, 5))).toBe(0);
  });
});

describe('pickLeastLoaded', () => {
  it('wählt den am wenigsten ausgelasteten Peer (byLoad=true)', () => {
    const r = pickLeastLoaded(['a', 'b', 'c'], {
      a: load(80, 50, 4),
      b: load(20, 10, 1), // least loaded
      c: load(60, 30, 2),
    });
    expect(r.agentId).toBe('b');
    expect(r.byLoad).toBe(true);
    expect(r.reason).toMatch(/least-loaded/);
  });

  it('FAIL-OPEN: keine Resource-Daten → erster Kandidat (byLoad=false)', () => {
    const r = pickLeastLoaded(['a', 'b', 'c'], {});
    expect(r.agentId).toBe('a');
    expect(r.byLoad).toBe(false);
    expect(r.reason).toMatch(/fail-open/);
  });

  it('partielle Daten: wählt unter den Kandidaten MIT Daten (ignoriert datenlose)', () => {
    const r = pickLeastLoaded(['a', 'b', 'c'], {
      // a: keine Daten
      b: load(70, 40, 3),
      c: load(30, 20, 1), // least unter denen mit Daten
    });
    expect(r.agentId).toBe('c');
    expect(r.byLoad).toBe(true);
  });

  it('Gleichstand → früherer Kandidat bleibt (deterministisch, back-compat)', () => {
    const r = pickLeastLoaded(['a', 'b'], {
      a: load(50, 50, 2),
      b: load(50, 50, 2),
    });
    expect(r.agentId).toBe('a');
  });

  it('genau ein Kandidat mit Daten → dieser', () => {
    expect(pickLeastLoaded(['solo'], { solo: load(95, 90, 9) }).agentId).toBe('solo');
  });

  it('leere Kandidatenliste → wirft', () => {
    expect(() => pickLeastLoaded([], {})).toThrow(/keine Kandidaten/);
  });
});

describe('buildLoadMap (defensiv gegen fehlerhafte Peer-Resources — Zero-Trust)', () => {
  it('valider resources-Block → übernommen (3 Felder)', () => {
    const m = buildLoadMap([
      { agent_id: 'a', agent_card: { resources: { ram_used_percent: 40, cpu_load: 10, agent_count: 2 } } },
    ]);
    expect(m.a).toEqual({ ram_used_percent: 40, cpu_load: 10, agent_count: 2 });
  });

  it('fehlender/null resources-Block → Peer ausgelassen', () => {
    const m = buildLoadMap([
      { agent_id: 'a', agent_card: { resources: null } },
      { agent_id: 'b', agent_card: {} },
      { agent_id: 'c' },
    ]);
    expect(m).toEqual({});
  });

  it('NaN / nicht-numerische / fehlende Felder → Peer ausgelassen (kein Vergleichs-Gift)', () => {
    const m = buildLoadMap([
      { agent_id: 'nan', agent_card: { resources: { ram_used_percent: NaN, cpu_load: 10, agent_count: 1 } } },
      // string als Zahl getarnt (Netz-Input)
      { agent_id: 'str', agent_card: { resources: { ram_used_percent: 50, cpu_load: '7' as unknown as number, agent_count: 1 } } },
      { agent_id: 'missing', agent_card: { resources: { ram_used_percent: 50, cpu_load: 7 } } }, // agent_count fehlt
      { agent_id: 'ok', agent_card: { resources: { ram_used_percent: 30, cpu_load: 5, agent_count: 1 } } },
    ]);
    expect(Object.keys(m)).toEqual(['ok']);
  });

  it('integriert mit pickLeastLoaded: garbage-Peer wird übersprungen, valider gewinnt', () => {
    const m = buildLoadMap([
      { agent_id: 'garbage', agent_card: { resources: { ram_used_percent: NaN, cpu_load: 0, agent_count: 0 } } },
      { agent_id: 'good', agent_card: { resources: { ram_used_percent: 99, cpu_load: 99, agent_count: 9 } } },
    ]);
    // 'garbage' hat scheinbar 0-Last, ist aber NaN → nicht in der Map → 'good' gewinnt
    expect(pickLeastLoaded(['garbage', 'good'], m).agentId).toBe('good');
  });
});
