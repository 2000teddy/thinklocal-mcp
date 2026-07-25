# changes/2026-07-25 — feat(tl10): reiner TOML-Text→Matrix-Loader `parseFreigabeMatrixToml` (D1-Prep, 0 Aufrufer)

**Typ:** **Code+Test** (reiner Kern, **0 Aufrufer**, kein Runtime-Delta). Gate-neutral: nimmt **keinen**
D1/D3-Gate-Entscheid vorweg. Form wie die übrigen Slice-B-Prep-Primitive (`requestApprovalOn` #317,
`requestApprovalViaMatrix` #319): reiner Kern unterhalb eines weiterhin gateten Aktivierungs-Schritts.

## Kontext
D1 (§5-CO 2026-07-20) legt die Matrix-**Quelle** auf `config/freigabe-matrix.toml` fest. Der **reine**
Format-Schritt (TOML-Text → validierte Matrix) war noch nicht gebaut; er war im TODO unter dem gegateten
Slice B als „TOML-Loader" mitgeführt. Er ist aber — wie #317/#319 — als reine, aufruferlose Prep baubar,
ohne den gegateten Rest anzufassen.

## Was
Neu `packages/daemon/src/freigabe-matrix-loader.ts`:
`parseFreigabeMatrixToml(tomlText: string, knownServers): FreigabeMatrix` — parst **TOML-Text** (liest
**keine** Datei) via `@iarna/toml`, wrappt einen TOML-Syntaxfehler **fail-closed** in `FreigabeMatrixError`
(damit der Aufrufer nur EINEN Fehlertyp fangen muss) und delegiert die volle §2.2-Validierung an
`parseFreigabeMatrix` (Slice A). Leerer/tabellenloser Text ⇒ leere Matrix (D5 Default-Deny).

**Bewusst NICHT hier** (der weiterhin gegatete Rest von Slice B):
- **fs-Lesen** der Datei von der Platte (verdrahteter Teil),
- die **kuratierte Policy-Datei** selbst (D1 Policy-Inhalt, owner — wird hier NICHT mitgeliefert),
- **Ingress-Verdrahtung + Env-Flag** (Aktivierung) und **D3-Enforcement** (Christian-Sign-off).

## Tests
`freigabe-matrix-loader.test.ts` **+7**: gültiges TOML → Matrix (exakt + Wildcard-Default); leer/Kommentar
→ leere Matrix (D5); malformed TOML → `FreigabeMatrixError` (nicht der rohe TOML-Fehler); Delegation der
§2.2-Validierung (non-kanonischer Server, **whitespace-only Kanal** = erbt die #337-Regel, unbekannte
decider-Grammatik) → reject; Nicht-String-Eingabe → `FreigabeMatrixError`. `tsc --noEmit` grün, `eslint`
grün. Full Suite **2087 grün** (147 Files; +7 ggü. 2080).

## Compliance
- **CO/CG:** entfallen — keine Design-Entscheidung (D1-Quelle ist bereits per §5-CO entschieden; dies ist
  der mechanische Format-Schritt). `clink`/`gemini` nicht im PATH.
- **TS ✅:** +7 Tests, `tsc`/`eslint` grün, Suite 2087 grün.
- **CR:** Self-Review — 0 Aufrufer (kein Regress-Risiko), delegiert die Sicherheits-Validierung unverändert
  an `parseFreigabeMatrix`, wirft nur `FreigabeMatrixError`; externes `agy`-Review am PR.
- **PC:** Secret-Scan clean (reine Logik, keine Secrets, keine Policy-Datei mitgeliefert).
- **DO ✅:** dieser Eintrag, `TODO.md`, `TL-10-freigabe-matrix-scoping.md`, `CHANGES.md`, `COMPLIANCE-TABLE.md`.

**Unverändert gated:** TL-10 **Slice B** (kuratierte Datei + Ingress-Verdrahtung + Env-Flag + D3-Sign-off),
ADR-046 §9, msg 1453, TL-12 S6 — **nicht** berührt.
