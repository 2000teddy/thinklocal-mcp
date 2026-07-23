// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * order-ledger-protocol.ts — TL-12 B1-Prep: das **Reserve-vor-Dispatch/Commit-Protokoll** als reine
 * Zustandsmaschine (KEIN Ledger, KEINE Datenbank, KEIN Execute-Pfad).
 *
 * `TL-12-slice-b-execution-scoping.md` §4 verlangt ausdrücklich, dieses Protokoll **jetzt** zu
 * spezifizieren — „auch wenn Code sequentiell landet", sonst werde B1 blind gegen B3 gebaut und müsse neu
 * geschrieben werden. Dieses Modul erdet genau diesen Vertrag: es beantwortet **eine** Frage —
 * *ist dieser Übergang erlaubt, und darf danach dispatcht werden?* — und **nichts** darüber hinaus.
 *
 * **Die Zustandsmenge ist nicht gewählt, sondern erzwungen.** Aus „Reserve **vor** Dispatch" +
 * „**at-most-once**: Crash-nach-Claim = wird **nie** ausgeführt" folgt zwingend:
 *  - ein Claim muss **vor** der Wirkung sichtbar sein ⇒ Zustand `reserved`;
 *  - nach der Wirkung gibt es genau zwei Ausgänge ⇒ `committed` / `failed`;
 *  - beide sind **terminal**: ein `failed` erneut zu beanspruchen wäre at-**least**-once, denn ein
 *    gemeldeter Fehlschlag kann ein Timeout sein, dessen Nebenwirkung bereits eingetreten ist. Genau das
 *    schließt §4 aus („niemand ‚fixt' das zu at-least-once");
 *  - ein zweiter `reserve` auf eine bekannte `(signer_keyid, order_nonce)` ist die **semantische Zwillings-
 *    prüfung** zum `UNIQUE`-Constraint und muss abgelehnt werden.
 *
 * **Bewusst NICHT hier** (bleibt an §9 gegated bzw. Sache von B1/B3):
 *  - die **Persistenz** selbst (Tabelle, `UNIQUE (signer_keyid, order_nonce)`, Transaktions-Klammer) —
 *    dieses Modul führt keinen State und schreibt nichts;
 *  - **ob** überhaupt ausgeführt werden darf (`[orders] execute`-Opt-in, D-OWNER), **ab wann**
 *    (Epoch-Grenze, D-EPOCH), **welche** Order-Typen, **wer** widerrufen darf;
 *  - der Dispatch selbst, TTL-Prüfung, Denylist, Rate-Fence.
 *
 * **0 Aufrufer** ⇒ kein Runtime-Change.
 */

/** Zustand einer `(signer_keyid, order_nonce)`-Zeile. `null` ⇔ Zeile existiert nicht. */
export type LedgerState = 'reserved' | 'committed' | 'failed';

/** Protokoll-Ereignisse. `reserve` **vor** dem Dispatch, `commit`/`fail` **danach**. */
export type LedgerEvent = 'reserve' | 'commit' | 'fail';

/**
 * Ergebnis eines Übergangs.
 * - `ok: true` ⇒ der Übergang ist erlaubt; `next` ist der Folgezustand.
 *   `mayDispatch` ist **nur** beim erfolgreichen `reserve` `true` — der Dispatch ist damit an genau
 *   **einen** Übergang gebunden und kann strukturell nicht zweimal freigegeben werden.
 * - `ok: false` ⇒ abgelehnt; `reason` benennt den Grund, `state` bleibt unverändert.
 */
export type LedgerTransition =
  | { readonly ok: true; readonly next: LedgerState; readonly mayDispatch: boolean }
  | { readonly ok: false; readonly reason: LedgerRejection; readonly state: LedgerState | null };

/** Warum ein Übergang abgelehnt wurde (diskriminiert, damit Aufrufer nicht auf Strings raten). */
export type LedgerRejection =
  | 'duplicate-claim' // `reserve` auf eine bereits bekannte Nonce (UNIQUE-Zwilling)
  | 'not-reserved' // `commit`/`fail` ohne vorangegangenen Claim
  | 'already-final' // `commit`/`fail` auf einen bereits terminalen Zustand
  | 'malformed'; // unbekannter Zustand/Event (fail-closed, statt zu raten)

const STATES: ReadonlySet<string> = new Set<LedgerState>(['reserved', 'committed', 'failed']);
const EVENTS: ReadonlySet<string> = new Set<LedgerEvent>(['reserve', 'commit', 'fail']);

/** Terminal ⇒ keine weitere Entscheidung mehr möglich. */
export function isFinal(state: LedgerState | null): boolean {
  return state === 'committed' || state === 'failed';
}

/**
 * Der **einzige** erlaubte Auswertungspfad für „darf jetzt dispatcht werden?" — analog zu `isApproved`
 * (TL-09) und `isRoutable` (TL-10). Aufrufer prüfen **nie** selbst Teilbedingungen.
 */
export function mayDispatch(transition: LedgerTransition): boolean {
  return transition.ok === true && transition.mayDispatch === true;
}

/**
 * Berechnet den Folgezustand. **Rein und total:** kein I/O, keine Uhr, kein Zufall; unbekannte Eingaben
 * ⇒ `malformed` statt Wurf oder Rateversuch.
 *
 * @param current bisheriger Zustand der Zeile, `null` wenn sie nicht existiert.
 * @param event   `reserve` (vor Dispatch) bzw. `commit`/`fail` (nach Dispatch).
 */
export function nextLedgerState(current: LedgerState | null, event: LedgerEvent): LedgerTransition {
  if (!EVENTS.has(event as string))
    return { ok: false, reason: 'malformed', state: current ?? null };
  if (current !== null && !STATES.has(current as string)) {
    return { ok: false, reason: 'malformed', state: null };
  }

  if (event === 'reserve') {
    // Der Claim ist nur auf einer NICHT existierenden Zeile erlaubt — die semantische Entsprechung
    // zu `UNIQUE (signer_keyid, order_nonce)`. Jede bekannte Nonce (auch eine `failed`!) wird
    // abgelehnt: erneutes Beanspruchen wäre at-least-once.
    if (current !== null) return { ok: false, reason: 'duplicate-claim', state: current };
    return { ok: true, next: 'reserved', mayDispatch: true };
  }

  // commit/fail: nur direkt nach einem Claim, und nur einmal.
  if (current === null) return { ok: false, reason: 'not-reserved', state: null };
  if (isFinal(current)) return { ok: false, reason: 'already-final', state: current };

  return { ok: true, next: event === 'commit' ? 'committed' : 'failed', mayDispatch: false };
}
