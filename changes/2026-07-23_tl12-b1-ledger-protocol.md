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

**Die Grundform folgt aus at-most-once**, das oberhalb dieses Slices gepinnt ist (§4 + §8 Invariante 3):
der Claim muss vor der Wirkung sichtbar sein (`reserved`), danach ist der Dispatch terminal.
**Ehrliche Einordnung (CR-Korrektur):** der Kollaps auf **genau einen** `failed`-Zustand folgt daraus
**nicht zwingend** — er ist eine bewusst konservative **Wahl**. Ein pre-effect-Ausgang („Dispatch nie
ausgelöst") oder ein dritter in-doubt-Ausgang erhielten at-most-once ebenso und hielten fest, ob die
Wirkung erwiesen ausblieb oder unbestimmt ist. Der Preis der gewählten Variante steht jetzt im Scoping.

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
bereits eingetreten ist; ein Retry darauf wäre at-**least**-once. **Crash-nach-Claim** bleibt `reserved`
und wird nie ausgeführt — dazu §4 wörtlich: „das ist die Semantik, niemand ‚fixt' das zu at-least-once".

`mayDispatch` ist der **einzige** erlaubte Auswertungspfad (analog `isApproved` in TL-09 und `isRoutable`
in TL-10) und nur beim erfolgreichen `reserve` wahr. **Notwendig, nicht hinreichend (CR-Korrektur):** das
Modul ist zustandslos — zwei Prozesse mit demselben veralteten Lesestand bekommen **beide** `true`.
Hinreichend ist erst `mayDispatch(t)` **und** ein erfolgreich committeter Claim-`INSERT`; die Race
entscheidet die `UNIQUE`-Verletzung, nicht diese Funktion.

## Doku: `TL-12-slice-b-execution-scoping.md` §4.1 (neu)
Übergangstabelle + die beiden Seiten, die §4 zusammen sehen will:
- **was B1 (Persistenz) umsetzen muss** — `UNIQUE (signer_keyid, order_nonce)` als *technischer* Zwilling
  der `duplicate-claim`-Prüfung (fängt die Race zweier Prozesse; die Zustandsprüfung ersetzt sie **nicht**);
  Claim-`INSERT` committet **vor** dem Dispatch; `signer_keyid` **muss** der kanonische DER-SPKI-Keyid sein
  (`canonicalOrderKeyId`, #323) — mit dem format-malleablen `orderKeyId` wäre die `UNIQUE`-Spalte durch
  bloßes PEM-Umformatieren umgehbar; **aus `signer_pubkey` neu berechnen, nie die vorhandene
  `messages.signer_keyid`-Spalte kopieren** (dort steht heute genau der malleable Wert), und
  `null` ⇒ kein Claim ⇒ kein Dispatch; die `messages`-Zeile ist **nicht** die Idempotenz-Einheit (ihr
  `idx_messages_order` ist bewusst **nicht** UNIQUE), `replayGuard` bleibt ungeeignet (In-Memory-`Map`,
  hartkodiertes 120-s-Cleanup unabhängig von `ttlMs`).
- **was B3 (Dispatch) einhalten muss** — Reihenfolge **prüfen → claimen → dispatchen**; danach **genau
  ein** `commit`/`fail`; ein `mayDispatch === false` ist **kein Fehler**, sondern der Normalfall bei
  Duplikaten und nach Crash-Wiederanlauf und darf **nicht** in einen Retry auf **derselben** Nonce
  umgedeutet werden — der legitime Wiederanlauf ist eine **neue** Nonce. Zusätzlich: **verwaiste
  `reserved`-Zeilen müssen sichtbar sein** (Audit/Read-Surface), sonst ist ein owner-signierter Auftrag
  ein stiller, dauerhafter No-op.

## Tests (+27; Suite **2027 grün**, 142 Files)
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
- **TS ✅:** +27 Tests, Suite **2027 grün** (142 Files), `tsc --noEmit` (strict) 0, neue Dateien eslint
  0/0, prettier clean.
- **CR ✅:** adversariales Claude-Subagent (`agy`/`codex` nicht im PATH) mit dem Auftrag, einen **zweiten
  Dispatch** zu konstruieren. **Kein HIGH** — BFS über alle Ereignisfolgen bis Tiefe 7, 27 feindliche
  Zustands- × 29 Event-Werte (inkl. `Object.create(null)`, Proxy, `valueOf`/`toString`/`Symbol.toPrimitive`,
  Prototype-Pollution): max. **1** Dispatch pro Lauf, nie aus einem Nicht-`null`-Zustand, kein Wurf.
  **3 MEDIUM + 4 LOW, alle an der Wurzel behoben:**
  - **M1 (echter Defekt):** der `malformed`-Zweig setzte `state: null` — und `null` ist genau das Sentinel
    für „Zeile existiert nicht ⇒ `reserve` erlaubt". Ein Aufrufer, der dem dokumentierten
    `state = t.ok ? t.next : t.state` folgt, konnte damit eine **bereits beanspruchte Nonce wieder
    claimbar waschen** (vom Reviewer demonstriert). Fix: das Feld heißt `observed`, ist rein diagnostisch,
    wird **nur** bei gültigem Zustand gesetzt und trägt nie einen Ersatzwert — es gibt kein Feld mehr, aus
    dem ein `null` zurückgelesen werden könnte. +9 Regressionstests, davon einer exakt der Angriffspfad.
  - **M2:** „kann strukturell nicht zweimal freigegeben werden" gilt **nicht** für zwei Prozesse — das
    Modul ist zustandslos. `mayDispatch` ist **notwendig, nicht hinreichend**; Autorität ist der
    committete Claim-`INSERT`. In Modul-Doc und §4.1-B3-Regel 1 klargestellt (prüfen → claimen → dispatchen).
  - **M3:** §4.1 verlangte den kanonischen Keyid, warnte aber nicht, dass `messages.signer_keyid` **heute
    schon** den malleablen `orderKeyId`-Wert hält (`index.ts:875`) — ein `INSERT … SELECT` aus dieser
    Spalte hätte die #323-Umgehung wiederhergestellt. Jetzt: **aus `signer_pubkey` neu berechnen, nie
    kopieren**, plus die fehlende `null`-Regel (kein Keyid ⇒ kein Claim ⇒ kein Dispatch).
  - **LOW:** „erzwungen" auf das ehrliche Maß zurückgenommen (at-most-once ist gepinnt, der Kollaps auf
    **einen** `failed`-Zustand ist eine bewusst konservative **Wahl** — pre-effect- bzw. in-doubt-Ausgang
    wären gleichwertig; Preis: „nie versucht" ist nicht von „möglicherweise gelaufen" unterscheidbar);
    §4-Zitat auf den Crash-nach-Claim-Fall zurückgeführt; **legitimer Wiederanlauf über eine NEUE Nonce**
    benannt; **Audit-/Read-Surface-Pflicht für verwaiste `reserved`-Zeilen** ergänzt; Ergebnisse
    `Object.freeze`d und `mayDispatch` prüft zusätzlich `next` (Schranke statt Konvention).
- **PC:** Secret-Scan clean (kein I/O, keine Credentials).
- **DO ✅:** dieser Eintrag, `TL-12-slice-b-execution-scoping.md` §4.1, `TODO.md`, `CHANGES.md`,
  `COMPLIANCE-TABLE.md`.

**Unverändert gated:** B1-**Persistenz**, B2a/B2b, B3-Ausführung und alle vier §9-Entscheidungen;
Slice C (V1–V3), ADR-046-Producer (CO), TL-11 Slice B (Host-Hop), TL-10-Verdrahtung (D1-Loader/D3).
