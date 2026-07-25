// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * freigabe-matrix-loader.test.ts — TL-10 D1: reiner TOML-Text→Matrix-Loader.
 *
 * Deckt: gültiges TOML → Matrix, leer → leere Matrix (D5), malformed TOML → FreigabeMatrixError,
 * Delegation der §2.2-Validierung an `parseFreigabeMatrix` (inkl. der #337-whitespace-Kanal-Regel),
 * Nicht-String-Eingabe. Kein fs, keine Verdrahtung.
 */
import { describe, it, expect } from 'vitest';
import { parseFreigabeMatrixToml } from './freigabe-matrix-loader.js';
import { FreigabeMatrixError } from './freigabe-matrix.js';

const KNOWN = ['unifi', 'influx'] as const;

const VALID_TOML = `
[[entries]]
tier = "gate"
server = "unifi"
tool = "block_client"
channel = "tg-main"
decider = "human:christian"

[[entries]]
tier = "gate"
server = "influx"
channel = "tg-quorum"
decider = "consensus:quorum=3"
`;

describe('parseFreigabeMatrixToml — Erfolg', () => {
  it('parst gültiges TOML in eine validierte Matrix (exakt + Wildcard-Default)', () => {
    const m = parseFreigabeMatrixToml(VALID_TOML, KNOWN);
    expect(m.entries).toHaveLength(2);
    expect(m.entries[0]).toMatchObject({
      tier: 'gate',
      server: 'unifi',
      tool: 'block_client',
      channel: 'tg-main',
    });
    expect(m.entries[0]?.decider).toEqual({ kind: 'human', id: 'christian' });
    // zweiter Eintrag ohne `tool` ⇒ Wildcard-Default '*'
    expect(m.entries[1]?.tool).toBe('*');
    expect(m.entries[1]?.decider).toEqual({ kind: 'consensus', quorum: 3 });
  });

  it('leerer / tabellenloser Text ⇒ leere Matrix (D5 Default-Deny)', () => {
    expect(parseFreigabeMatrixToml('', KNOWN).entries).toHaveLength(0);
    expect(parseFreigabeMatrixToml('# nur ein Kommentar\n', KNOWN).entries).toHaveLength(0);
  });
});

describe('parseFreigabeMatrixToml — fail-closed', () => {
  it('malformed TOML ⇒ FreigabeMatrixError (nicht der rohe TOML-Fehler)', () => {
    expect(() => parseFreigabeMatrixToml('das = = ist ][ kein toml', KNOWN)).toThrow(FreigabeMatrixError);
    expect(() => parseFreigabeMatrixToml('[unclosed', KNOWN)).toThrow(FreigabeMatrixError);
  });

  it('delegiert die §2.2-Validierung an parseFreigabeMatrix (non-kanonischer Server ⇒ reject)', () => {
    const toml = `
[[entries]]
tier = "gate"
server = "rogue"
channel = "tg"
decider = "human:x"
`;
    expect(() => parseFreigabeMatrixToml(toml, KNOWN)).toThrow(FreigabeMatrixError);
  });

  it('whitespace-only Kanalname im TOML ⇒ reject (erbt die #337-Parser-Regel)', () => {
    const toml = `
[[entries]]
tier = "gate"
server = "unifi"
channel = "   "
decider = "human:x"
`;
    expect(() => parseFreigabeMatrixToml(toml, KNOWN)).toThrow(FreigabeMatrixError);
  });

  it('unbekannte decider-Grammatik im TOML ⇒ reject', () => {
    const toml = `
[[entries]]
tier = "gate"
server = "unifi"
channel = "tg"
decider = "root:x"
`;
    expect(() => parseFreigabeMatrixToml(toml, KNOWN)).toThrow(FreigabeMatrixError);
  });

  it('Nicht-String-Eingabe ⇒ FreigabeMatrixError (wirft nie etwas anderes)', () => {
    // @ts-expect-error absichtliche Falscheingabe zum Härten des Guards
    expect(() => parseFreigabeMatrixToml(null, KNOWN)).toThrow(FreigabeMatrixError);
    // @ts-expect-error absichtliche Falscheingabe
    expect(() => parseFreigabeMatrixToml(42, KNOWN)).toThrow(FreigabeMatrixError);
  });
});
