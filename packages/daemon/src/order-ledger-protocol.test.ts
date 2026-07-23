// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * order-ledger-protocol.test.ts — TL-12 B1-Prep: Reserve-vor-Dispatch/Commit-Vertrag.
 *
 * Die entscheidende Invariante: **at-most-once**. Für eine `(signer_keyid, order_nonce)` darf über die
 * gesamte Lebensdauer **höchstens einmal** `mayDispatch` wahr werden — auch nach Crash, auch nach einem
 * gemeldeten Fehlschlag.
 */
import { describe, it, expect } from 'vitest';
import {
  nextLedgerState,
  mayDispatch,
  isFinal,
  type LedgerEvent,
  type LedgerState,
} from './order-ledger-protocol.js';

describe('nextLedgerState — der Happy Path ist genau ein Dispatch', () => {
  it('reserve auf einer unbekannten Nonce erlaubt genau einen Dispatch', () => {
    const t = nextLedgerState(null, 'reserve');

    expect(t).toEqual({ ok: true, next: 'reserved', mayDispatch: true });
    expect(mayDispatch(t)).toBe(true);
  });

  it('commit nach dem Claim schließt ab und erlaubt KEINEN weiteren Dispatch', () => {
    const t = nextLedgerState('reserved', 'commit');

    expect(t).toEqual({ ok: true, next: 'committed', mayDispatch: false });
    expect(mayDispatch(t)).toBe(false);
    expect(isFinal('committed')).toBe(true);
  });

  it('fail nach dem Claim schließt ebenfalls terminal ab', () => {
    const t = nextLedgerState('reserved', 'fail');

    expect(t).toEqual({ ok: true, next: 'failed', mayDispatch: false });
    expect(isFinal('failed')).toBe(true);
  });
});

describe('nextLedgerState — at-most-once: zweimal dispatchen ist unmöglich', () => {
  it('zweiter reserve auf eine reservierte Nonce ⇒ duplicate-claim (UNIQUE-Zwilling)', () => {
    const t = nextLedgerState('reserved', 'reserve');

    expect(t).toEqual({ ok: false, reason: 'duplicate-claim', state: 'reserved' });
    expect(mayDispatch(t)).toBe(false);
  });

  it('reserve auf eine bereits committete Nonce ⇒ duplicate-claim', () => {
    expect(nextLedgerState('committed', 'reserve')).toEqual({
      ok: false,
      reason: 'duplicate-claim',
      state: 'committed',
    });
  });

  it('reserve auf eine FAILED Nonce ⇒ duplicate-claim (kein Retry — das wäre at-least-once)', () => {
    // Ein gemeldeter Fehlschlag kann ein Timeout sein, dessen Nebenwirkung bereits eingetreten ist.
    // Genau deshalb schließt Scoping §4 den Retry aus.
    const t = nextLedgerState('failed', 'reserve');

    expect(t).toEqual({ ok: false, reason: 'duplicate-claim', state: 'failed' });
    expect(mayDispatch(t)).toBe(false);
  });

  it('Crash-nach-Claim: die Zeile bleibt reserved und wird nie ausgeführt', () => {
    // Der Prozess stirbt zwischen reserve und commit/fail. Beim Wiederanlauf sieht der Nachfolger
    // `reserved` — und bekommt KEINEN Dispatch. Das IST die Semantik, kein Bug.
    const afterRestart = nextLedgerState('reserved', 'reserve');

    expect(mayDispatch(afterRestart)).toBe(false);
    expect(afterRestart.ok).toBe(false);
  });

  it('über eine ganze Ereignisfolge wird mayDispatch genau EINMAL wahr', () => {
    const events: LedgerEvent[] = ['reserve', 'reserve', 'commit', 'reserve', 'fail', 'commit'];
    let state: LedgerState | null = null;
    let dispatches = 0;

    for (const ev of events) {
      const t = nextLedgerState(state, ev);
      if (mayDispatch(t)) dispatches += 1;
      if (t.ok) state = t.next;
    }

    expect(dispatches).toBe(1);
    expect(state).toBe('committed');
  });
});

describe('nextLedgerState — commit/fail ohne gültigen Claim werden abgelehnt', () => {
  it('commit auf eine unbekannte Nonce ⇒ not-reserved', () => {
    expect(nextLedgerState(null, 'commit')).toEqual({
      ok: false,
      reason: 'not-reserved',
      state: null,
    });
  });

  it('fail auf eine unbekannte Nonce ⇒ not-reserved', () => {
    expect(nextLedgerState(null, 'fail')).toEqual({
      ok: false,
      reason: 'not-reserved',
      state: null,
    });
  });

  it('doppeltes commit ⇒ already-final (keine zweite Entscheidung)', () => {
    expect(nextLedgerState('committed', 'commit')).toEqual({
      ok: false,
      reason: 'already-final',
      state: 'committed',
    });
  });

  it('commit nach fail (und umgekehrt) ⇒ already-final — der Ausgang wird nicht umgeschrieben', () => {
    expect(nextLedgerState('failed', 'commit')).toMatchObject({ reason: 'already-final' });
    expect(nextLedgerState('committed', 'fail')).toMatchObject({ reason: 'already-final' });
  });
});

describe('nextLedgerState — total & fail-closed gegen unbekannte Eingaben', () => {
  it('unbekanntes Event ⇒ malformed statt Wurf, kein Dispatch', () => {
    for (const bogus of ['execute', '', 'RESERVE', null, undefined, 42, {}]) {
      const t = nextLedgerState(null, bogus as unknown as LedgerEvent);

      expect(t).toMatchObject({ ok: false, reason: 'malformed' });
      expect(mayDispatch(t)).toBe(false);
    }
  });

  it('unbekannter Zustand ⇒ malformed, insbesondere KEIN Dispatch', () => {
    for (const bogus of ['pending', 'RESERVED', '', 42, {}]) {
      const t = nextLedgerState(bogus as unknown as LedgerState, 'reserve');

      expect(t).toMatchObject({ ok: false, reason: 'malformed' });
      expect(mayDispatch(t)).toBe(false);
    }
  });

  it('wirft nie', () => {
    expect(() => nextLedgerState(undefined as unknown as LedgerState, 'reserve')).not.toThrow();
  });
});

describe('mayDispatch / isFinal — der einzige Auswertungspfad', () => {
  it('mayDispatch ist NUR beim erfolgreichen reserve wahr', () => {
    const all: Array<[LedgerState | null, LedgerEvent]> = [
      [null, 'reserve'],
      [null, 'commit'],
      [null, 'fail'],
      ['reserved', 'reserve'],
      ['reserved', 'commit'],
      ['reserved', 'fail'],
      ['committed', 'reserve'],
      ['committed', 'commit'],
      ['committed', 'fail'],
      ['failed', 'reserve'],
      ['failed', 'commit'],
      ['failed', 'fail'],
    ];

    const dispatching = all.filter(([s, e]) => mayDispatch(nextLedgerState(s, e)));

    // Genau eine Kombination der VOLLSTÄNDIGEN Übergangsmatrix gibt einen Dispatch frei.
    expect(dispatching).toEqual([[null, 'reserve']]);
  });

  it('isFinal unterscheidet terminale von offenen Zuständen', () => {
    expect(isFinal(null)).toBe(false);
    expect(isFinal('reserved')).toBe(false);
    expect(isFinal('committed')).toBe(true);
    expect(isFinal('failed')).toBe(true);
  });
});
