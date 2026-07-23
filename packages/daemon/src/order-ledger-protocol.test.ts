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

    expect(t).toEqual({ ok: false, reason: 'duplicate-claim', observed: 'reserved' });
    expect(mayDispatch(t)).toBe(false);
  });

  it('reserve auf eine bereits committete Nonce ⇒ duplicate-claim', () => {
    expect(nextLedgerState('committed', 'reserve')).toEqual({
      ok: false,
      reason: 'duplicate-claim',
      observed: 'committed',
    });
  });

  it('reserve auf eine FAILED Nonce ⇒ duplicate-claim (kein Retry — das wäre at-least-once)', () => {
    // Ein gemeldeter Fehlschlag kann ein Timeout sein, dessen Nebenwirkung bereits eingetreten ist.
    // Genau deshalb schließt Scoping §4 den Retry aus.
    const t = nextLedgerState('failed', 'reserve');

    expect(t).toEqual({ ok: false, reason: 'duplicate-claim', observed: 'failed' });
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
    expect(nextLedgerState(null, 'commit')).toEqual({ ok: false, reason: 'not-reserved' });
  });

  it('fail auf eine unbekannte Nonce ⇒ not-reserved', () => {
    expect(nextLedgerState(null, 'fail')).toEqual({ ok: false, reason: 'not-reserved' });
  });

  it('doppeltes commit ⇒ already-final (keine zweite Entscheidung)', () => {
    expect(nextLedgerState('committed', 'commit')).toEqual({
      ok: false,
      reason: 'already-final',
      observed: 'committed',
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

describe('nextLedgerState — Ablehnungen sind KEIN Resume-Token (CR-Fund zu #324)', () => {
  const REJECTING: Array<[LedgerState | null, unknown]> = [
    ['COMMITTED', 'reserve'], // Casing-Drift
    ['in-flight', 'reserve'], // dritter Zustand aus einem neueren Build
    ['pending', 'commit'],
    ['reserved', 'execute'], // unbekanntes Event auf gültigem Zustand
    ['in-flight', 'execute'], // unbekannt × unbekannt
    [null, 'execute'],
  ];

  it.each(REJECTING)(
    '(%s, %s): trägt niemals einen als „claimbar" lesbaren Zustand',
    (state, ev) => {
      const t = nextLedgerState(state as LedgerState, ev as LedgerEvent);

      expect(t.ok).toBe(false);
      // Kein `state`-Feld — und `observed` (falls gesetzt) ist NIE null/undefined, sondern ein
      // gültiger Zustand. Damit kann `t` nicht zu „Zeile existiert nicht" umgedeutet werden.
      expect(t).not.toHaveProperty('state');
      if ('observed' in t) expect(['reserved', 'committed', 'failed']).toContain(t.observed);
    },
  );

  it('REGRESSION: ein unbekannter Zustand wäscht eine beanspruchte Nonce NICHT claimbar', () => {
    // Genau der vom Review demonstrierte Pfad: ein Aufrufer, der bei Ablehnung den Zustand aus dem
    // Ergebnis „zurückliest", bekam früher `null` — das Sentinel für „reserve erlaubt".
    const rejected = nextLedgerState('COMMITTED' as unknown as LedgerState, 'reserve');
    expect(rejected.ok).toBe(false);

    const carried = 'observed' in rejected ? (rejected.observed ?? null) : undefined;
    // Es gibt schlicht kein Feld, aus dem ein `null` zurückgelesen werden könnte.
    expect(carried).toBeUndefined();
    expect(mayDispatch(rejected)).toBe(false);
  });

  it('ein ungültiger Zustandswert wird nicht durchgereicht (kein Leak in `observed`)', () => {
    const t = nextLedgerState('RESERVED' as unknown as LedgerState, 'execute' as LedgerEvent);

    expect(t).toEqual({ ok: false, reason: 'malformed' });
  });
});

describe('mayDispatch — Schranke, nicht Konvention', () => {
  it('ein hand-gebautes Ergebnis ohne gültiges `next` bekommt keinen Dispatch', () => {
    const forged = { ok: true, mayDispatch: true } as unknown as ReturnType<typeof nextLedgerState>;

    expect(mayDispatch(forged)).toBe(false);
  });

  it('Ergebnisse sind eingefroren — nachträgliches Aufbohren schlägt fehl', () => {
    const t = nextLedgerState('reserved', 'commit');
    expect(Object.isFrozen(t)).toBe(true);

    expect(() => {
      (t as unknown as { mayDispatch: boolean }).mayDispatch = true;
    }).toThrow();
    expect(mayDispatch(t)).toBe(false);
  });
});
