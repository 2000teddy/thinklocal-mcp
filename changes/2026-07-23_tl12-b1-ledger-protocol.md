# changes/2026-07-23 — feat(tl12): B1-Prep — Reserve-vor-Dispatch/Commit-Vertrag als reine Zustandsmaschine

**Typ:** additive, **ungegatete** reine Primitive (Code + Tests, **0 Aufrufer**) + die von §4 ausdrücklich
verlangte Protokoll-Spezifikation. Kein Runtime-Change, kein Deploy/Secret/Host, **kein** Gate-Flip.
Enthält den eingefalteten Post-Merge-Reconcile für **#323**.

## Beleg: §4 verlangt genau das, und zwar jetzt
`TL-12-slice-b-execution-scoping.md` §4, wörtlich:

> **Reserve/Commit-Protokoll jetzt gemeinsam mit B3s Dispatch-Kontrakt spezifizieren** (auch wenn Code
> sequentiell landet) — sonst wird B1 blind gegen B3 gebaut und muss neu geschrieben werden.

Das ist kein Vorziehen von B1, sondern die dort benannte **Vorbedingung** von B1. Umgesetzt wird genau
sie — und nichts darüber hinaus.

## Abgrenzung: was hier NICHT entsteht
**Keine** Persistenz (keine Tabelle, kein `UNIQUE`-Index, keine Transaktions-Klammer), **kein**
Execute-Pfad, **kein** Dispatch, **keine** TTL-Prüfung, **keine** Denylist, **kein** Rate-Fence. Und
**keine** der vier §9-Christian-Entscheidungen wird berührt: `[orders] execute`-Opt-in (D-OWNER),
Epoch-Grenze `T` (D-EPOCH), ausführbare Startmenge, Revocation-Autorität. Das Protokoll sagt **nicht**,
*ob* ausgeführt werden darf — nur, dass eine erlaubte Ausführung **höchstens einmal** stattfindet.

## Was
**Neu `order-ledger-protocol.ts`:** `nextLedgerState(current, event) → LedgerTransition`, rein und total
(kein I/O, keine Uhr, kein Zufall), plus die Guards `mayDispatch(transition)` und `isFinal(state)`.

**Die Zustandsmenge ist erzwungen, nicht gewählt.** Aus „Reserve **vor** Dispatch" + „at-most-once:
Crash-nach-Claim = wird **nie** ausgeführt" folgt zwingend: der Claim muss vor der Wirkung sichtbar sein
(`reserved`), nach der Wirkung gibt es genau zwei Ausgänge (`committed`/`failed`), und beide sind
**terminal**.

| Zustand vorher | Ereignis | Ergebnis | Dispatch frei? |
|---|---|---|---|
| — (Zeile fehlt) | `reserve` | `reserved` | **ja — der einzige Fall** |
| `reserved` | `commit` / `fail` | `committed` / `failed` | nein |
| `reserved` | `reserve` | `duplicate-claim` | nein |
| `committed` / `failed` | `reserve` | `duplicate-claim` | nein |
| — | `commit` / `fail` | `not-reserved` | nein |
| `committed` / `failed` | `commit` / `fail` | `already-final` | nein |
| unbekannter Zustand/Event | — | `malformed` | nein |

**Warum `failed` terminal ist:** ein gemeldeter Fehlschlag kann ein **Timeout** sein, dessen Nebenwirkung
bereits eingetreten ist. Ein Retry machte aus at-most-once ein at-**least**-once — genau das schließt §4
aus („niemand ‚fixt' das zu at-least-once"). **Crash-nach-Claim** bleibt `reserved` und wird nie
ausgeführt; das ist die Semantik, kein zu behebender Zustand.

`mayDispatch` ist der **einzige** erlaubte Auswertungspfad (analog `isApproved` in TL-09 und `isRoutable`
in TL-10) und nur beim erfolgreichen `reserve` wahr — der Dispatch hängt damit an genau **einem** Übergang
und kann strukturell nicht zweimal freigegeben werden.

## Doku: `TL-12-slice-b-execution-scoping.md` §4.1 (neu)
Übergangstabelle + die beiden Seiten, die §4 zusammen sehen will:
- **was B1 (Persistenz) umsetzen muss** — `UNIQUE (signer_keyid, order_nonce)` als *technischer* Zwilling
  der `duplicate-claim`-Prüfung (fängt die Race zweier Prozesse; die Zustandsprüfung ersetzt sie **nicht**);
  Claim-`INSERT` committet **vor** dem Dispatch; `signer_keyid` **muss** der kanonische DER-SPKI-Keyid sein
  (`canonicalOrderKeyId`, #323) — mit dem format-malleablen `orderKeyId` wäre die `UNIQUE`-Spalte durch
  bloßes PEM-Umformatieren umgehbar; die `messages`-Zeile ist **nicht** die Idempotenz-Einheit (ihr
  `idx_messages_order` ist bewusst **nicht** UNIQUE), `replayGuard` bleibt ungeeignet (In-Memory-`Map`,
  hartkodiertes 120-s-Cleanup unabhängig von `ttlMs`).
- **was B3 (Dispatch) einhalten muss** — nur bei `mayDispatch` dispatchen, danach **genau ein**
  `commit`/`fail`, und ein `mayDispatch === false` ist **kein Fehler**, sondern der Normalfall bei
  Duplikaten und nach Crash-Wiederanlauf; er darf **nicht** in einen Retry umgedeutet werden.

## Tests (+17; Suite **2017 grün**, 142 Files)
Happy Path (genau ein Dispatch) · `duplicate-claim` auf `reserved`/`committed`/**`failed`** (kein Retry) ·
**Crash-nach-Claim bleibt undispatched** · eine ganze Ereignisfolge gibt `mayDispatch` **genau einmal**
frei · `commit`/`fail` ohne Claim ⇒ `not-reserved` · doppeltes bzw. gekreuztes `commit`/`fail` ⇒
`already-final` (der Ausgang wird nicht umgeschrieben) · 7 unbekannte Events + 5 unbekannte Zustände ⇒
`malformed`, nie ein Dispatch · wirft nie · **vollständige 12-Kombinationen-Matrix**: exakt **eine**
Kombination gibt einen Dispatch frei.

## Eingefaltet: #323-Reconcile
`#323` ist seit `mergedAt=2026-07-23T12:45:51Z` gemergt (mergeCommit `95cc6fe`, `reviewDecision=APPROVED`).
COMPLIANCE-Erst-Spalte → `#323` + `(base=main, gemergt)`, CHANGES-Überschrift `, #323)`, TODO-Eintrag
annotiert — `gh`-verifiziert, Timestamp-Anker eindeutig, 1:1 in-place.

## Compliance
- **CO/CG:** entfallen — die Spezifikation ist in §4 bereits **beauftragt**, die Zustandsmenge folgt
  zwingend aus der dort festgelegten at-most-once-Semantik; keine neue Architektur-Frage und keine der
  §9-Entscheidungen berührt (Prep-Form wie #314/#317/#322/#323). `clink`/`gemini` nicht im PATH.
- **TS ✅:** +17 Tests, Suite **2017 grün** (142 Files), `tsc --noEmit` (strict) 0, neue Dateien eslint
  0/0, prettier clean.
- **CR:** externes Review am PR (`agy`/`codex` nicht im PATH → adversariales Claude-Subagent,
  `[[pal-review-backend-agy-missing]]`).
- **PC:** Secret-Scan clean (kein I/O, keine Credentials).
- **DO ✅:** dieser Eintrag, `TL-12-slice-b-execution-scoping.md` §4.1, `TODO.md`, `CHANGES.md`,
  `COMPLIANCE-TABLE.md`.

**Unverändert gated:** B1-**Persistenz**, B2a/B2b, B3-Ausführung und alle vier §9-Entscheidungen;
Slice C (V1–V3), ADR-046-Producer (CO), TL-11 Slice B (Host-Hop), TL-10-Verdrahtung (D1-Loader/D3).
