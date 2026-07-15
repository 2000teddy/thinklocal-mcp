# changes/2026-07-15 — feat(security): ADR-042 Live-Drift-Check + Gate-Flip-Blocker (TL-08 Slice 2c, partiell)

**Typ:** Daemon-Code (`tool-class-drift.ts` neu) + Tests + Design-/Blocker-Doku (ADR-042).
**Slice:** TL-08 Slice 2c — **Gate-Flip BLOCKED** (belegt); geliefert: secret-sicherer Live-Drift-Check.

## Warum / Befund
Der TL-08-Gate-Flip (sensitive → allow-with-redaction) braucht eine kuratierte Safe-Field-Allowlist aus
**echten Output-Schemata**. Subagent-Analyse: **keines** der 10 sensitiven unifi-Tools hat ein
`outputSchema` (nur opake Mutations-Schemata); die Feldnamen sind nur per **Tool-Aufruf** erfahrbar =
Secret-Exposition. **⇒ Gate-Flip in dieser Lane autonom nicht sicher lieferbar** (Christian-Input / externe
Doku-Transkription nötig — ADR-042).

## Was geliefert (secret-sicher, repo-safe, null Gate-Verhaltensänderung)
- `tool-class-drift.ts` (neu): `checkToolClassDrift(server, fetchTools, log)` — live Drift-Check-Seam gegen
  `tools/list` (nur Tool-Namen, kein Secret). Delegiert an `computeToolClassDrift` (ADR-040), warn-loggt
  Drift (stale/unclassified = Kurations-Signal). Ungoverned → null; Fetch-Fehler → null + warn (fail-safe).
  Verdrahtungs-Plan (periodischer index.ts-Hook gegen Mesh) = Folge (Laufzeit-abhängig).
- ADR-042: dokumentiert den Gate-Flip-**Blocker** + Unblock-Pfade (doc/source-derived / Christian-Liste /
  Sampling-Harness) + den Drift-Check.

## Compliance
- **CO:** n/a-neu (Drift-Check bereits ADR-040-CO-blessed [Folge-Item b]; Gate-Flip-Blocker = Befund, kein
  Design). ⚠️ Cross-Vendor (codex/agy) nicht im PATH. Beleg: `~/hermes/reports/2026-07-15_1735_TL08-slice2c-gateflip-blocker.md`.
- **CG:** n/a. **TS:** +6 Tests (konsistent/stale/unclassified/ungoverned-no-fetch/Kanonisierung/Fetch-Fehler);
  volle Suite **1678 grün**, tsc/ESLint 0.
- **CR:** adversarialer Claude-Subagent — **CLEAN** (secret-sicher, fail-safe, zero-gate-change); Blocker-
  Reasoning sound; ergänzte den doc/source-derived Unblock-Pfad (c).
- **PC:** `git diff`; Secret-Scan clean.
- **DO:** ADR-042, `TODO.md` (2c: Drift-Check ✅ / Gate-Flip BLOCKED), `CHANGES.md`, `COMPLIANCE-TABLE.md`, dieser Eintrag.
