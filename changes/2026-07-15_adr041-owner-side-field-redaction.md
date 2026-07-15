# changes/2026-07-15 — feat(security): ADR-041 owner-seitige Feld-Redaction (TL-08 Slice 2b)

**Typ:** Daemon-Code (`redact-mcp-response.ts` neu, `mcp-mcporter-exec.ts`) + Tests + Design-Doku (ADR-041).
**Slice:** TL-08 Slice 2b (Folge auf ADR-040). **Kein Gate-Flip** (= Slice 2c).

## Warum
ADR-039/040 markierten 10 unifi credential-/PII-Reads als `sensitive` (gegatet). Slice 2b baut die
**fail-closed Redaction-Mechanik**, damit Secrets den Owner-Daemon nie unredigiert verlassen — als
correct-by-construction-Fundament für den späteren Gate-Flip.

## Was
- `redact-mcp-response.ts` (neu, rein): **deny-by-default Feld-Allowlist** (`redactByAllowlist` — nur
  safe-gelistete Keys überleben rekursiv, alles andere → `[REDACTED]`; skalare Array-Elemente nur im
  erlaubten Kontext, CR-HIGH). `redactSensitiveResult(server, tool, result) → {outcome, result}`:
  passthrough (nicht-sensitiv) / redacted / fail-closed (Skalar/null/Rahmen-Überschreitung → secret-freie
  Notiz, 200). Bounded (Tiefe 32 / Node-Cap). `SERVER_SAFE_FIELDS['unifi']` **leer** (maximale Redaction;
  Feld-Kuratierung = 2c). `isSensitiveTool` exportiert.
- `mcp-mcporter-exec.ts`: **Policy R** — Owner-Local-Exec redigiert sensitive Ergebnisse **unconditional**
  vor der Rückgabe; auch die Fehler-Pfade (`detail`) redigieren bei sensitivem Tool (CR-MEDIUM).

## Bewusste Grenze
Kein Gate-Flip (sensitive Tools bleiben am Ingress gegatet; Gate-still-blocks-Regressionstest). Redaction
im Live-Pfad tot, am Exec-Seam getestet. Feld-Kuratierung (Safe-Liste aus Output-Schemata) + nested-JSON-
Strings + Gate-Flip = **Slice 2c, eigener Security-CR**. `redacted` ≠ „vollständig geprüft".

## Compliance
- **CO:** `pal:consensus` 2026-07-15 (opus+sonnet) — Policy R (unconditional owner-Redaction), deny-by-
  default statt Denylist, fail-closed=200+Notiz, kein Gate-Flip + Gate-still-blocks, 2b-Grenze. ⚠️ Cross-
  Vendor (codex/agy) nicht im PATH. Beleg: `~/hermes/reports/2026-07-15_1705_TL08-slice2b-consensus.md`.
- **CG:** n/a. **TS:** +21 Tests (deny-by-default/Arrays/leere-Liste/purity/bounds; redactSensitiveResult
  passthrough/redacted/fail-closed/Kanonisierung/idempotent; **CR-HIGH Array-Skalar-Leak**; Exec-Seam fake
  Runner get_wlan→redigiert/list_clients→passthrough; **CR-MEDIUM Error-Pfad detail redigiert**;
  Gate-still-blocks alle 10). Volle Suite **1672 grün**, tsc/ESLint 0.
- **CR:** adversarialer Claude-Subagent — **1 HIGH** (skalare Array-Elemente leaken) + **1 MEDIUM**
  (Error-Pfad-detail) **in-slice gefixt + Regression**; LOW (Tool-Casing) für 2c notiert. Alle 6
  Invarianten sonst verifiziert.
- **PC:** `git diff`; Secret-Scan clean.
- **DO:** ADR-041, `TODO.md` (TL-08 Slice 2b ✅ / 2c offen), `CHANGES.md`, `COMPLIANCE-TABLE.md`, dieser Eintrag.
