# changes/2026-07-22 — feat(gate): TL-10 D2-Prep — `MeldekanalRegistry.requestApprovalOn(channelId, req)`

**Typ:** additive, **ungegatete** Security-Primitive (Code + Tests). Der kleinste D2-Vorbereitungs-Slice für
TL-10 Slice B (Freigabe-Matrix-Verdrahtung): die **Kanal-Bindungs**-Primitive, mit der eine spätere Matrix
„Werkzeug-Klasse → **Kanal**" auflöst — **ohne** Matrix-Wiring, **ohne** Env-Flag-Flip, **ohne** Ingress,
**ohne** Christian-gatete Aktivierung. `requestApproval()` bleibt unverändert; die Methode hat heute **keinen
Aufrufer** (kein Runtime-Change).

## Beleg (warum genau dieser Slice)
- `TODO.md` TL-10 Slice B: braucht **D2** — „Registry-`requestApprovalOn(channelId)`" + D3-Sign-off.
- `SECURITY.md` „Freigabe-Matrix (TL-10)": nennt genau diese Registry-Bindung als **Aktivierungs-Vorbedingung**.
Dieser Slice liefert **nur** die D2-Primitive (die einzige ungegatete Vorbedingung), nicht die gatete
Verdrahtung/Aktivierung.

## Was
- **`meldekanal.ts`:** neue Methode `MeldekanalRegistry.requestApprovalOn(channelId, req)` → `ApprovalDecision`.
  Fragt **gezielt** den Kanal mit `channelId` (statt „erster gesunder"). **Fail-closed & verhaltensgleich zu
  `requestApproval`, nur ohne Fallback** (ein adressierter Kanal, kein „nächster"):
  - unbekannte `channelId` ⇒ `denied-no-channel` (niemand gefragt, `note` nennt die id);
  - Kanal unhealthy / Health-Timeout / Health-Fehler ⇒ `denied-no-channel` (kein erreichbarer Kanal, **kein**
    Fallback auf einen anderen);
  - Kanal gesund, aber Approval-Timeout ⇒ `timeout`; Wurf/Fehler ⇒ `error`; unbekanntes Shape ⇒ `error`;
  - nur ein gesund-adressierter Kanal, der **aktiv** zustimmt ⇒ `approved`.
  Reuse der bestehenden `withTimeout`/`normalizeDecision`/`errNote`-Helfer (dieselbe Fail-closed-Mechanik an
  EINER Stelle). `isApproved()` bleibt der EINZIGE Auswertungspfad.

## Tests (+10; Suite **1932 grün**, 139 Files)
- `meldekanal.test.ts`: gezielte Auswahl (adressiert `b`, obwohl `a` gesund → `a` **nie** gefragt),
  unknown id → denied (nicht gefragt), unhealthy target → denied (**kein** Fallback auf gesunden Nachbarn,
  target nie gefragt), Health-Timeout → denied, Approval-Timeout → timeout, Wurf → error, unbekanntes Shape →
  error, leere Registry (`deny-all`/unknown → denied), sowie **`requestApproval` bleibt unverändert**
  (erster gesunder Kanal terminal, unabhängig von `requestApprovalOn`).

## Abgrenzung (bewusst außer Scope — bleibt gated / Slice B proper)
- `mcp-ingress-api`-Wiring, Matrix-Konsultation, Env-Flag-Flip, D3-Christian-Sign-off, Aktivierung.

## Compliance
- **CO/CG:** entfällt — additive Primitive einer bereits konsentierten Design-Linie (TL-10 §5-CO D2:
  „`channelId`-Ref + Registry-`requestApprovalOn`"); keine neue Architektur-Frage; `clink`/`gemini` nicht im PATH.
- **TS ✅:** +10 Tests, Suite **1932 grün**, `tsc --noEmit` (strict) 0, geänderte Dateien eslint 0 / prettier clean.
- **CR ✅:** adversariales Claude-Subagent — **GREEN, keine Findings**: fail-closed bestätigt (kein Input ⇒
  `approved` ohne gesund-adressierten, aktiv zustimmenden Kanal), kein Fallback-Leak, `requestApproval`
  unverändert, ungegatet/additiv (0 Aufrufer), Determinismus/Resource ok.
- **PC ✅:** Secret-Scan clean.
- **DO ✅:** dieser Eintrag, `CHANGES.md`, `COMPLIANCE-TABLE.md`, `TODO.md`.
