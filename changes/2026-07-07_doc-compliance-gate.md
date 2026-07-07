# changes/2026-07-07 — ci(gate): Ebene-1 Doku-Compliance-Gate (warnend → blockierend)

**Typ:** CI-Workflow (`.github/workflows/doc-compliance-gate.yml`, neu). Kein Daemon-Code.
**Auftrag:** Christian/Hermes MD-Pflege-Audit, Punkt 2 (Ebene 1 CI-Gate).

## Warum
Ebene 1 des Durchsetzungssystems: eine GitHub-Actions-Prüfung, die den PR rot machen kann, wenn die
Per-PR-Doku fehlt — die belastbare, server-seitige Ebene (kein `--no-verify`-Umgehung wie beim lokalen Hook).

## Was
Neuer Workflow `Doc-Compliance-Gate` auf `pull_request` → `main`. Verlangt je PR:
1. einen Eintrag unter `changes/`, UND
2. eine Änderung an `COMPLIANCE-TABLE.md`.
Ausnahme: Label `no-doc-needed` ODER konventioneller Titel-Typ `docs`/`chore` (auch hinter `[agent] `-Präfix).

**Rollout laut Beschluss:** erst **2 Wochen warnend** (`ENFORCE_BLOCKING="false"` → Verstoß = `::warning::`,
Job bleibt grün), danach **blockierend**. Flip = `ENFORCE_BLOCKING="true"` setzen (Ziel `FLIP_DATE=2026-07-21`)
UND den Check in den Branch-Protection-Rules von `main` als *required status check* markieren (erst dann
blockiert er den Merge server-seitig — das ist eine Repo-Einstellung, kein YAML).

## Tests / Verifikation
- YAML-Parse (`yaml.safe_load`) grün.
- **Logik-Dry-Test** (9 Szenarien, lokal nachgestellt): both-present→PASS; missing→WARN(warn)/FAIL(block);
  `docs(scope)` hinter `[agent]`→EXEMPT; `chore:`→EXEMPT; `no-doc-needed`-Label→EXEMPT; nur-COMPLIANCE-fehlt
  →FAIL(block); Titel „…add documentation" (Substring) → **nicht** fälschlich exempt. Ein Bug in der ersten
  Exemption-Regex (Bracket `[[:space:]\]]` schluckte `]` nicht → `docs(`-Titel nicht erkannt) wurde gefunden
  und gefixt (Präfix-Strip + Anker-Match).
- Dogfood: dieser PR berührt `changes/` + `COMPLIANCE-TABLE.md` → besteht sein eigenes Gate.

## Status
Offen (PR gegen main). Letzter Baustein des KW28/29-Durchsetzungs-Sweeps (nach Altlasten #248/#247 und
Rollen/Phasen-Schalter #249). Warnend bis 2026-07-21, dann Flip auf blockierend (Christian/Hermes:
Branch-Protection required-check setzen).
