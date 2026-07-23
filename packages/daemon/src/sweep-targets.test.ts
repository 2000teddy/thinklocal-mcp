// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * sweep-targets.test.ts — TL-11 Reconciliation-Sweep, reine Ziel-Auswahl.
 *
 * Kern: `computeSweepTargets` wählt **nur** live registrierte, **routbare** Instanzen mit **positiver**
 * ungelesener Post — und wirft nie. Alles andere (ob/wann gesweept wird, Coalescer, Opt-in) ist bewusst
 * Aufrufer-Sache und wird hier NICHT festgeschrieben.
 */
import { describe, it, expect } from 'vitest';
import { computeSweepTargets, type LiveInstance } from './sweep-targets.js';

const A: LiveInstance = { instanceId: 'a', spiffeUri: 'spiffe://thinklocal/node/AAA' };
const B: LiveInstance = { instanceId: 'b', spiffeUri: 'spiffe://thinklocal/node/BBB' };

/** Zähler aus einer Tabelle; unbekannte Instanz ⇒ 0. */
function counts(map: Record<string, number>): (id: string) => number {
  return (id) => map[id] ?? 0;
}

describe('computeSweepTargets — Auswahl', () => {
  it('wählt nur Instanzen mit positiver ungelesener Post', () => {
    const res = computeSweepTargets([A, B], counts({ a: 3, b: 0 }));

    expect(res).toEqual([{ instanceId: 'a', spiffeUri: A.spiffeUri, unread: 3 }]);
  });

  it('leere Live-Liste ⇒ keine Ziele, Zähler wird nie gefragt', () => {
    let asked = 0;
    const res = computeSweepTargets([], () => {
      asked += 1;
      return 5;
    });

    expect(res).toEqual([]);
    expect(asked).toBe(0);
  });

  it('niemand hat Post ⇒ keine Ziele', () => {
    expect(computeSweepTargets([A, B], counts({}))).toEqual([]);
  });

  it('mehrere Ziele kommen stabil nach instanceId sortiert (unabhängig von der Eingabereihenfolge)', () => {
    const forward = computeSweepTargets([A, B], counts({ a: 1, b: 2 }));
    const reversed = computeSweepTargets([B, A], counts({ a: 1, b: 2 }));

    expect(forward.map((t) => t.instanceId)).toEqual(['a', 'b']);
    expect(reversed).toEqual(forward);
  });

  it('doppelte Registry-Einträge ⇒ genau ein Ziel (erster gewinnt, deterministisch)', () => {
    const dup = { instanceId: 'a', spiffeUri: 'spiffe://thinklocal/node/OTHER' };
    const res = computeSweepTargets([A, dup], counts({ a: 2 }));

    expect(res).toHaveLength(1);
    expect(res[0]?.spiffeUri).toBe(A.spiffeUri);
  });
});

describe('computeSweepTargets — fail-closed: nicht routbar ⇒ kein Ziel', () => {
  it('Instanz ohne SPIFFE-URI wird übersprungen (un-routbares Wake wäre ein Leak-Kandidat)', () => {
    const noSpiffe = { instanceId: 'x', spiffeUri: '' };
    const res = computeSweepTargets([noSpiffe, A], counts({ x: 9, a: 1 }));

    expect(res.map((t) => t.instanceId)).toEqual(['a']);
  });

  it('malformte Einträge werden übersprungen statt zu werfen', () => {
    const malformed = [
      null,
      undefined,
      42,
      'a',
      {},
      { instanceId: 'ok-but-no-spiffe' },
      { spiffeUri: 'spiffe://thinklocal/node/NOID' },
      { instanceId: '', spiffeUri: 'spiffe://thinklocal/node/EMPTY' },
      { instanceId: 'n', spiffeUri: 123 },
    ] as unknown as LiveInstance[];

    const res = computeSweepTargets(
      [...malformed, A],
      counts({ a: 1, n: 5, 'ok-but-no-spiffe': 5 }),
    );

    expect(res).toEqual([{ instanceId: 'a', spiffeUri: A.spiffeUri, unread: 1 }]);
  });

  it('nicht-Array als Live-Liste ⇒ leeres Ergebnis (wirft nicht)', () => {
    for (const bogus of [null, undefined, 42, 'nope', {}]) {
      expect(computeSweepTargets(bogus as unknown as LiveInstance[], counts({ a: 1 }))).toEqual([]);
    }
  });
});

describe('computeSweepTargets — fail-closed: unbekannter Zählerstand weckt nicht', () => {
  it('werfender Zähler ⇒ diese Instanz entfällt, die übrigen bleiben (wirft nie)', () => {
    const res = computeSweepTargets([A, B], (id) => {
      if (id === 'a') throw new Error('db kaputt');
      return 4;
    });

    expect(res).toEqual([{ instanceId: 'b', spiffeUri: B.spiffeUri, unread: 4 }]);
  });

  it('unbrauchbare Zählerwerte ⇒ kein Ziel', () => {
    for (const bogus of [NaN, Infinity, -Infinity, -1, 0, '3', null, undefined, {}]) {
      const res = computeSweepTargets([A], () => bogus as unknown as number);
      expect(res).toEqual([]);
    }
  });

  it('Bruchteile > 0 werden unverändert durchgereicht (das Modul rundet keine Semantik zurecht)', () => {
    expect(computeSweepTargets([A], () => 0.5)[0]?.unread).toBe(0.5);
  });
});

describe('computeSweepTargets — nimmt bewusst KEINE offene Entscheidung vorweg', () => {
  it('kennt weder Uhr noch Coalescer: derselbe Input liefert wiederholt dasselbe Ergebnis', () => {
    const first = computeSweepTargets([A, B], counts({ a: 1, b: 1 }));
    const second = computeSweepTargets([A, B], counts({ a: 1, b: 1 }));

    // Kein verstecktes „schon geweckt"-Gedächtnis — Unterdrückung ist Sache des Aufrufers.
    expect(second).toEqual(first);
    expect(first).toHaveLength(2);
  });

  it('fragt den Zähler genau einmal pro routbarer Instanz (kein verstecktes Fan-out)', () => {
    const asked: string[] = [];
    computeSweepTargets([A, B, { instanceId: 'c', spiffeUri: '' }], (id) => {
      asked.push(id);
      return 1;
    });

    expect(asked).toEqual(['a', 'b']); // 'c' ist nicht routbar → wird gar nicht erst gefragt
  });
});
