# changes/2026-07-22 — fix(mcp): TL-08 Slice 2c Drift-Hook — Härtung gegen all-malformed tools-Array (CR-LOW)

**Typ:** additive **Fail-safe-Härtung** (Code + Tests) — schließt die eine LOW-Sibling-Lücke, die das
unabhängige externe Review von **PR #315** (TL-08 Slice 2c Drift-Hook) benannt hat. **Read-only, kein
Gate-Flip**, kein Deploy/Secret. Rein additiver Guard, kein Verhaltenswechsel im Normalfall.

## Befund (aus dem #315-Review)
Der M1-Fix (`hasToolsArray`) fängt ein 200 **ohne** `result.tools`-Array. Sibling-Lücke: ein 200 mit einem
**nicht-leeren** `tools`-Array, dessen Einträge **alle** malformed sind (kein gültiger `name`), passiert
`hasToolsArray` (es IST ein Array), `extractToolNames` liefert dann `[]` → `computeToolClassDrift` meldet
fälschlich **alle** kuratierten unifi-Tools (27 readOnly + 10 sensitive) als stale → **ein** spurioses
`TOOL_CLASS_DRIFT`-Audit. Bounded (nur Kurations-Signal, kein Gate-Flip/Crash/Secret) und unwahrscheinlich
(MCP verlangt `name`), aber es widerspricht der erklärten Invariante „nie ein false-positive".

## Fix
`buildGovernedToolListFetcher` (`tool-class-drift-hook.ts`): nach `hasToolsArray` + `extractToolNames` wirft
der Fetcher, wenn das rohe `tools`-Array **nicht leer** war, `extractToolNames` aber **0** Namen lieferte
(alle Einträge malformed) → Seam fängt zu `null` → skip, kein Audit. Ein legitim **leeres** `[]` bleibt ein
gültiges leeres Inventar (`resolves []`). Ein Array mit **mindestens einem** gültigen Namen liefert die
gültigen Namen (Teil-Malformed toleriert — namenlose Einträge sind ohnehin nicht klassifizierbar; die
inhärent mehrdeutige Teil-Stale-Nuance bleibt eine bewusste, dokumentierte Grenze).

## Tests (+3; Suite **1922 grün**, 139 Files)
- `tool-class-drift-hook.test.ts`: all-malformed non-empty Array → Wurf; ≥1 gültiger Name (Rest malformed)
  → resolved die gültigen; **E2E** echter Fetcher + all-malformed 200 → **kein** false-positive-Audit.

## Compliance
- **CO/CG:** entfällt — Fail-safe-Härtung eines gemergten, konsentierten Slices (ADR-042); keine Design-Frage.
- **TS ✅:** +3 Tests, Suite **1922 grün**, `tsc --noEmit` (strict) 0, geänderte Dateien eslint 0 / prettier clean.
- **CR:** Self-CR — direkte Umsetzung des externen #315-Review-LOW; dieselbe fail-safe-Klasse wie M1, an EINER
  Stelle (Fetcher-Guard).
- **PC ✅:** Secret-Scan clean (nur Namen/Zähler, keine Werte).
- **DO ✅:** dieser Eintrag, `CHANGES.md`, `COMPLIANCE-TABLE.md`, `TODO.md`.
