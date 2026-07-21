# changes/2026-07-20 — docs(todo): TL-00d verifiziert erledigt (cert-renew-Knobs dokumentiert)

**Typ:** **doc-only** Backlog-Cleanup (Verifikation + Statusabschluss). **Kein** Code-, **kein** Test-, **kein**
Produktions-Change; kein Christian-/Deploy-/Secret-Gate.

## Warum
TL-00d („#242-Konfig-Keys `cert.renew_before_days` + `TLMCP_CERT_RENEW_BEFORE_DAYS` dokumentieren") stand mit
dem Vermerk **„evtl. bereits erledigt, verifizieren"** offen (↔ #243, KW28 §2 B, USER-GUIDE). KW30-Auftrag:
wahrheitsgetreu gegen HEAD prüfen und den Backlog-Stand konsolidieren, statt die Aufgabe unbelegt offen/vergessen
liegen zu lassen.

## Verifikation gegen HEAD (Ergebnis: **JA, vollständig dokumentiert**)
`docs/USER-GUIDE.md` deckt **beide** Knobs vollständig und **akkurat** ab:
- **TOML `[cert] renew_before_days`** — Beispiel + Semantik-Kommentar (`daysLeft <= N` → Reissue beim Start),
  Default `30` (USER-GUIDE l.79-82).
- **Env `TLMCP_CERT_RENEW_BEFORE_DAYS`** — Umgebungsvariablen-Tabelle mit Bedeutung, Wertebereich `[1, 89]`,
  Default `30` (l.105).
- **Dedizierter Abschnitt „Zertifikats-Erneuerung (`[cert]`)"** (l.109+) — Mapping-Tabelle
  TOML-Key ↔ Env ↔ Default ↔ Wertebereich ↔ Bedeutung (l.115-117), #242-Attribution, plus Begründung, warum
  der Wertebereich streng validiert ist.

**Doku-Aussagen stimmen mit dem Code bei HEAD überein:**
- Wertebereich `[1, 89]` ⇐ `NODE_CERT_VALIDITY_DAYS = 90` (`tls.ts:43`) und Post-Merge-Validator
  `renew_before_days ∈ [1, NODE_CERT_VALIDITY_DAYS-1]` (`config.ts:465-476`).
- Default `30` ⇐ `config.ts:251`. Env-Override-Wiring ⇐ `config.ts:406-407` (`readPositiveInt`).

→ Keine fehlende oder falsche Abdeckung. Kein zusätzlicher Doc-Change nötig.

## Was
- `TODO.md`: TL-00d von `[ ]` auf **`[x]`** mit belegter Verifikationsnotiz (Fundstellen in USER-GUIDE +
  Code-Anker bei HEAD).
- `CHANGES.md`, `COMPLIANCE-TABLE.md`, dieser Eintrag.

## Compliance
- **CO/CG:** entfallen — doc-only Backlog-Cleanup, keine Architektur-/Design-Frage, kein Boilerplate.
- **TS:** n/a — keine Code-/Testfläche berührt (reine Verifikation bestehender, bereits getesteter Keys;
  die Validierung der Keys ist in `config.test.ts`/`cert-*`-Tests abgedeckt, Full-Suite bei HEAD grün).
- **CR:** n/a (doc-only, kein Code-Diff zu reviewen).
- **PC ✅:** Secret-Scan clean.
- **DO ✅:** `TODO.md`, `CHANGES.md`, `COMPLIANCE-TABLE.md`, dieser Eintrag.
