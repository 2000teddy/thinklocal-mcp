# changes/2026-07-20 — docs(reconcile): PR-Nummern-Nachtrag COMPLIANCE + CHANGES (#288–#295) + fehlender #290-Eintrag

**Typ:** Doc-only (Doku-Hygiene / Reconcile-Cursor). **Kein** Code/Runtime-Change, **kein** Deploy/Secret/Gate.

## Warum
Der Reconcile-Wächter (2026-07-20 03:34) meldete Drift gegen `main`: die gemergten PRs **#288–#295** waren in
`CHANGES.md` **und** `COMPLIANCE-TABLE.md` zwar eingetragen, trugen aber **keine PR-Nummer** — CHANGES-
Überschriften nur mit Timestamp, COMPLIANCE-Zeilen mit Platzhalter-Erstspalte `(offen, base=main)` + Topic-
Label (`(TL-14a)`, `(ADR-045)`, …). Zusätzlich hatte **#290** (docs(ca) Consensus-Brief, ein **Peer-Agent-PR**)
**weder** einen CHANGES- **noch** einen COMPLIANCE-Eintrag. → PR-Nummern-Cursor stale, Historie lückenhaft.

## Was
- **CHANGES.md:** PR-Nummer an die 7 bestehenden Überschriften annotiert — #288 (Scoping), #289 (Checklist),
  #291 (Consensus-Ergebnis), #292 (TL-11-Runbook), #293 (A/B-Grounding), #294 (ADR-045), #295 (A-Char-Test);
  fehlenden **#290**-Eintrag (Consensus-Brief) chronologisch zwischen #289 und #291 ergänzt.
- **COMPLIANCE-TABLE.md:** die 7 Zeilen-Erstspalten von Topic-Label auf die echte PR-Nummer gesetzt; fehlende
  **#290**-Zeile ergänzt (als Peer-Agent-Nachtrag markiert — CR/PC der Fremd-PR **nicht** rückwirkend bewertet).
- **Verifikation:** jede PR↔Eintrag-Zuordnung gegen den echten Merge-Commit geprüft (`gh pr view … mergeCommit`):
  #288 `f630c38` · #289 `1a2557e` · #290 `4c8898d` · #291 `16cc43b` · #292 `80cde74` · #293 `a49325f` ·
  #294 `80e4826` · #295 `41a4603`.

## Abgrenzung
Reine Doku-Hygiene — **kein** Inhalt der bestehenden Einträge geändert (nur PR-Nummer + #290-Nachtrag). Kein
Code/Config/Skript, kein Deploy/Secret/Cross-Host. Die Fremd-PR #290 wird **nur historisch** nachgetragen,
nicht rückwirkend compliance-bewertet.

## Compliance
- **CO/CG/TS:** entfallen — kein Code, keine Design-Frage.
- **CR:** Doc-Accuracy self (PR↔Merge-Commit-Mapping gegengeprüft, kein Mis-Mapping) + externer Claude-Review-
  Subagent vor Merge.
- **PC:** `git diff` gesichtet, Secret-Scan clean (nur Doku).
- **DO:** dieser Eintrag, `CHANGES.md`, `COMPLIANCE-TABLE.md`, dieser Reconcile-Zeile.
