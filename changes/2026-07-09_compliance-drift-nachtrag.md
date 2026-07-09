# changes/2026-07-09 — docs(compliance): Compliance-Drift nachgezogen (#249/#250/#251)

**Typ:** Doc-only (`COMPLIANCE-TABLE.md`, `CHANGES.md`, dieser `changes/`-Eintrag). Kein Daemon-Code,
keine Test-/Build-Logik, keine CI-YAML.
**Auftrag:** Orchestrator-Steer 2026-07-09 07:13 — im Worktree lagen unversionierte Doku-Drift-Änderungen
an `COMPLIANCE-TABLE.md` + `CHANGES.md`; sauber als eigener Nachtrags-PR verpacken.

## Warum
Drei bereits gemergte PRs waren in der Doku nicht nachgezogen:
- `COMPLIANCE-TABLE.md` führte #249 (doc-roles), #250 (doc-gate) und #251 (runbook .52-readiness) noch als
  „(offen, base=main)" bzw. ohne PR-Nummer.
- Der `CHANGES.md`-Historieneintrag für #251 (docs(runbook): .52-Readiness) fehlte ganz.
Ohne Nachzug driftet die Compliance-Historie von der tatsächlichen Merge-Realität ab — genau das, was das
Ebene-1-Doku-Gate künftig verhindern soll.

## Was
1. `COMPLIANCE-TABLE.md`: #249 → „#249 (merged)", #250 → „#250 (merged)", #251 → „#251 (merged)";
   Footer-Zeitstempel aktualisiert; neuer Sweep-Abschnitt + Selbst-Compliance-Zeile für DIESEN Nachtrag.
2. `CHANGES.md` ([Unreleased]): #251-Historieneintrag ergänzt + Meta-Eintrag für diesen Nachtrag.
3. Dieser `changes/`-Eintrag.

Der Nachtrags-PR erfüllt sein eigenes Gate (berührt `changes/` + `COMPLIANCE-TABLE.md`) und trägt eine
eigene COMPLIANCE-Zeile — er stolpert nicht an seiner eigenen Existenz.

## Tests / Verifikation
Kein Code → keine Unit-/Integrationstests. Verifikation: `git diff` zeigt ausschließlich `.md` + `changes/`;
keine Datei außerhalb des Doku-Nachtrags berührt (kein Daemon-Code, keine Restarts, keine CI-YAML).

## Abgrenzung
Nicht Teil dieses PRs: die `.52`-MCP-Beweis-Lane (auf HOLD bis Christians Q1/DoD-Antwort) und jede
Live-Daemon-Aktion.

## Status
Offen (PR gegen main). Review nur via claude/codex/agy.
