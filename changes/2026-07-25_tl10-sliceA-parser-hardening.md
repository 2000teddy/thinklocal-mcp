# changes/2026-07-25 — fix(tl10): zwei #300/#319-CR-Altlasten im Slice-A-Parser (whitespace-Kanal, decider-Aliasing)

**Typ:** **Bug-Fix** (reine Parser-/Resolver-Korrektheit in `freigabe-matrix.ts`, TL-10 Slice A). CO/CG
entfallen (reiner Bug-Fix, kein Design). **Kein Gate-Vorgriff:** `freigabe-matrix.ts` hat **0 Runtime-Aufrufer**
(nur `approval-router.ts`, das seinerseits 0 Aufrufer hat) ⇒ **kein Verhaltens-Delta**; die Fixes betreffen
Parser-Korrektheit, nicht die gegateten D1-Loader-Inhalte oder D3-Enforcement.

## Die zwei Altlasten (grounded)
`TL-10-freigabe-matrix-scoping.md` §7.2 (Punkt 6) und `TODO.md` führen zwei aus dem #319-CR mitgenommene,
vorbestehende (#300) Defekte, die dort als „im D1-Loader zu erledigen" geparkt waren. Beide sind aber reine
Slice-A-Korrektheit und **ungegatet** fixbar:

1. **whitespace-only Kanalname parst** (`freigabe-matrix.ts:142`): die Guard prüfte `channel.length === 0`,
   ließ also `'   '` durch. Eine Policy-Zeile, die konfiguriert *aussieht*, aber eine nicht-zustellbare
   channelId trägt → stumm ewig verweigernd (fail-closed in der Wirkung, aber ein Konfig-Footgun).
2. **`resolveEntry` gibt `decider` per Referenz** (`:172`): das aufgelöste Ziel teilte die `decider`-Instanz
   mit dem geparsten Matrix-Eintrag. `readonly` ist nur Compile-Zeit — ein mutierender Konsument (JS/`as any`)
   hätte die geladene Policy für **alle** Folge-Auflösungen verändert (Aliasing).

## Was
- **Fix 1** — Parser wirft jetzt bei `channel.trim().length === 0` (rejectet `''` **und** whitespace-only);
  Fehlermeldung erweitert. **Defense-in-depth:** `isRoutable` prüft ebenfalls `channel.trim().length === 0`.
- **Fix 2** — neue reine Helper-Funktion `cloneDecider(d)`; `resolveEntry` gibt den `decider` als **frische
  Kopie** heraus, nie als Referenz auf den Matrix-Eintrag.

Keine Signatur-/Vertragsänderung; `parseFreigabeMatrix`/`resolveEntry`/`isRoutable` verhalten sich für alle
bisher gültigen Eingaben identisch — nur die zwei Defekt-Klassen sind geschlossen.

## Tests
`freigabe-matrix.test.ts` **+6**: whitespace-only `channel` (`'   '`/`'\t'`/`' \n '`/`' '`) ⇒ reject;
`resolveEntry` liefert `decider` als Kopie (Mutation am Ziel verändert die Matrix nicht, zweite Auflösung
weiterhin unverfälscht); `isRoutable` mit whitespace-Kanal ⇒ false. **Mutations-verifiziert:** `trim()` zurück
auf `length` ⇒ die vier whitespace-Reject-Tests rot; `cloneDecider` zurück auf Referenz ⇒ der Aliasing-Test
rot. `tsc --noEmit` grün, `eslint` grün. Full Suite **2080 grün** (146 Files; +6 ggü. 2074).

## Compliance
- **CO/CG:** entfallen — reiner Bug-Fix, keine Design-Entscheidung.
- **TS ✅:** +6 Regressionstests (jeder Defekt hat einen), mutations-verifiziert.
- **CR:** Self-Review — 0 Runtime-Aufrufer (kein Regress-Risiko), Fixes minimal + typkorrekt, keine
  Vertragsänderung; externes `agy`-Review am PR nachzuziehen.
- **PC:** Secret-Scan clean (reine Logik, keine Secrets).
- **DO ✅:** dieser Eintrag, `TL-10-freigabe-matrix-scoping.md` §7.2, `TODO.md`, `CHANGES.md`,
  `COMPLIANCE-TABLE.md`.

**Unverändert gated:** TL-10 **Slice B** (D1-Loader/D3-Sign-off/Env-Flag), ADR-046 §9, msg 1453, TL-12 S6 —
**nicht** berührt.
