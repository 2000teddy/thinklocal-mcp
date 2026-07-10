# changes/2026-07-10 — docs(runbook): MCP-Provider aktivieren (serve_shared + mcporter-PATH)

**Typ:** Doc-only (`docs/RUNBOOK-mcp-provider-serve-shared.md` neu, `CHANGES.md`,
`COMPLIANCE-TABLE.md`, dieser Eintrag). Kein Daemon-Code, keine Test-/Build-/CI-Logik.
**Auftrag:** Weekly-plan — Betriebswissen aus dem verifizierten TL07/Kap.-7.7-tools/call-Beweis
ins Deploy-Runbook festschreiben.

## Warum
Der grüne tools/call-Beweis (Report `2026-07-10_0805_TL07-toolscall-GREEN-proof.md`) förderte
zwei nicht-offensichtliche Betriebsfakten zutage, die bisher nirgends dokumentiert waren:
1. **PATH-Pflicht:** Der Daemon startet unter restriktiver systemd-Unit-PATH ohne
   `~/.npm-global/bin` → `execFile('mcporter')` scheitert mit ENOENT → `tools/call` = 502
   „mcporter exec failed" mit **leerem `detail`** (die Signatur genau dieses Problems). Der
   erste Live-Call schlug daran fehl; PATH ergänzt → 200.
2. **Secret-Hygiene:** `~/.mcporter/mcporter.json` kann Credentials im Klartext führen
   (verifiziert: `UNIFI_API_KEY` auf TH01) → Rotation/`chmod 600` empfohlen.

## Was
Neues Runbook `docs/RUNBOOK-mcp-provider-serve-shared.md`: Voraussetzungen, `serve_shared=true`
+ **PATH-Zusatz** per systemd-Drop-in, Registrierungs-/tools/call-Verifikation (Owner-lokal +
Cross-Host mit erwarteten beidseitigen Audit-Events), Rollback und der Secret-Rotations-Hinweis.

## Tests / Verifikation
Kein Code → keine Unit-/Integrationstests. Die dokumentierten Schritte sind 1:1 die am
2026-07-10 08:05 live durchgeführten (200 + beidseitiger signierter Audit). `git diff` zeigt
ausschließlich `.md` + `changes/`.

## Status
Offen (PR gegen main). Review via claude/codex/agy.
