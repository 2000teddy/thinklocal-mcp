// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * freigabe-matrix.test.ts — TL-10 Slice A (reine Funktionen)
 * Deckt Parser (jeder Parse-Reject), Resolver (Spezifität) und den `isRoutable`-Guard ab.
 */
import { describe, it, expect } from 'vitest';
import {
  parseFreigabeMatrix,
  resolveEntry,
  isRoutable,
  FreigabeMatrixError,
  type FreigabeMatrix,
} from './freigabe-matrix.js';

const KNOWN = ['unifi', 'influx'] as const;

function entry(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { tier: 'gate', server: 'unifi', tool: 'block_client', channel: 'tg-main', decider: 'human:christian', ...over };
}

describe('parseFreigabeMatrix — Erfolg', () => {
  it('parst gültige Einträge (human + consensus, exakt + Wildcard)', () => {
    const m = parseFreigabeMatrix(
      {
        entries: [
          entry(),
          entry({ tool: '*', decider: 'consensus:quorum=3', channel: 'tg-quorum' }),
          entry({ server: 'influx', tool: 'write', decider: 'human:ops' }),
        ],
      },
      KNOWN,
    );
    expect(m.entries).toHaveLength(3);
    expect(m.entries[0]).toMatchObject({ tier: 'gate', server: 'unifi', tool: 'block_client', channel: 'tg-main' });
    expect(m.entries[0]?.decider).toEqual({ kind: 'human', id: 'christian' });
    expect(m.entries[1]?.decider).toEqual({ kind: 'consensus', quorum: 3 });
  });

  it('leere/fehlende entries ⇒ gültige LEERE Matrix (D5)', () => {
    expect(parseFreigabeMatrix({}, KNOWN).entries).toHaveLength(0);
    expect(parseFreigabeMatrix({ entries: [] }, KNOWN).entries).toHaveLength(0);
  });

  it('fehlendes `tool` ⇒ Default Wildcard `*`', () => {
    const m = parseFreigabeMatrix({ entries: [entry({ tool: undefined })] }, KNOWN);
    expect(m.entries[0]?.tool).toBe('*');
  });
});

describe('parseFreigabeMatrix — Parse-Rejects (fail-closed)', () => {
  const reject = (raw: unknown, known: readonly string[] = KNOWN): void => {
    expect(() => parseFreigabeMatrix(raw, known)).toThrow(FreigabeMatrixError);
  };

  it('Wurzel kein Objekt / unbekannte Wurzel-Keys', () => {
    reject(null);
    reject([]);
    reject({ entries: [], extra: 1 });
  });
  it('entries kein Array', () => reject({ entries: {} }));
  it('unbekannte Eintrags-Keys', () => reject({ entries: [entry({ foo: 1 })] }));
  it('ungültige tier', () => reject({ entries: [entry({ tier: 'schreibend' })] }));
  it('fehlender server (tool-ohne-server)', () => reject({ entries: [entry({ server: undefined })] }));
  it('non-kanonischer Server (D4)', () => reject({ entries: [entry({ server: 'rogue' })] }));
  it('leerer channel', () => reject({ entries: [entry({ channel: '' })] }));
  it('leerer tool-String', () => reject({ entries: [entry({ tool: '' })] }));
  it('unbekannte decider-Grammatik', () => reject({ entries: [entry({ decider: 'root:x' })] }));
  it('human ohne id', () => reject({ entries: [entry({ decider: 'human:' })] }));
  it('consensus ohne quorum', () => reject({ entries: [entry({ decider: 'consensus:all' })] }));
  it('consensus quorum < 2', () => reject({ entries: [entry({ decider: 'consensus:quorum=1' })] }));
  it('Duplikat-Spezifität (gleiche tier|server|tool)', () =>
    reject({ entries: [entry(), entry({ channel: 'tg-other' })] }));
});

describe('resolveEntry — Spezifität', () => {
  const m: FreigabeMatrix = parseFreigabeMatrix(
    {
      entries: [
        entry({ tool: '*', channel: 'tg-wide', decider: 'human:ops' }),
        entry({ tool: 'block_client', channel: 'tg-exact', decider: 'human:christian' }),
      ],
    },
    KNOWN,
  );

  it('exakter tool schlägt Wildcard', () => {
    expect(resolveEntry(m, { tier: 'gate', server: 'unifi', tool: 'block_client' })?.channel).toBe('tg-exact');
  });
  it('Wildcard greift für andere Tools desselben Servers', () => {
    expect(resolveEntry(m, { tier: 'gate', server: 'unifi', tool: 'reboot' })?.channel).toBe('tg-wide');
  });
  it('kein Match bei tier-Mismatch ⇒ null (D5)', () => {
    expect(resolveEntry(m, { tier: 'self', server: 'unifi', tool: 'block_client' })).toBeNull();
  });
  it('kein Match bei server-Mismatch ⇒ null (D5)', () => {
    expect(resolveEntry(m, { tier: 'gate', server: 'influx', tool: 'block_client' })).toBeNull();
  });
  it('leere Matrix ⇒ immer null (D5 Default-Deny)', () => {
    const empty = parseFreigabeMatrix({ entries: [] }, KNOWN);
    expect(resolveEntry(empty, { tier: 'gate', server: 'unifi', tool: 'x' })).toBeNull();
  });
});

describe('isRoutable — der einzige Guard', () => {
  it('null ⇒ false (Default-Deny)', () => expect(isRoutable(null)).toBe(false));
  it('gültiges human-Ziel ⇒ true', () =>
    expect(isRoutable({ channel: 'tg-main', decider: { kind: 'human', id: 'christian' } })).toBe(true));
  it('gültiges consensus-Ziel (quorum≥2) ⇒ true', () =>
    expect(isRoutable({ channel: 'tg-q', decider: { kind: 'consensus', quorum: 2 } })).toBe(true));
  it('leerer channel ⇒ false', () =>
    expect(isRoutable({ channel: '', decider: { kind: 'human', id: 'x' } })).toBe(false));
  it('human ohne id ⇒ false', () =>
    expect(isRoutable({ channel: 'c', decider: { kind: 'human', id: '' } })).toBe(false));
  it('consensus quorum<2 ⇒ false', () =>
    expect(isRoutable({ channel: 'c', decider: { kind: 'consensus', quorum: 1 } })).toBe(false));

  it('End-to-End: resolve → isRoutable (routable und Default-Deny)', () => {
    const m = parseFreigabeMatrix({ entries: [entry()] }, KNOWN);
    expect(isRoutable(resolveEntry(m, { tier: 'gate', server: 'unifi', tool: 'block_client' }))).toBe(true);
    expect(isRoutable(resolveEntry(m, { tier: 'gate', server: 'unifi', tool: 'unbekannt' }))).toBe(false);
  });
});
