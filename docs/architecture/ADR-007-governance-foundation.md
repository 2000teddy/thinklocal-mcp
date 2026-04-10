# ADR-007: Governance Foundation

**Status:** Implemented (Phase A, 2026-04-10)
**Datum:** 2026-04-10
**Autoren:** Claude Code, Multi-Modell-Konsensus (GPT-5.1, Gemini-2.5-Pro, Claude Opus 4.6)
**Verwandt:** BORG.md (Assimilations-Methodik), Paperclip-Analyse

## Kontext

Die Paperclip-Analyse (2026-04-10) identifizierte drei Governance-Patterns die
thinklocal-mcp sofort uebernehmen sollte, BEVOR dynamische Capabilities durchs
Mesh wandern (Security-first-Prinzip).

## Entscheidungen

### 1. Activity-Log Entity-Model (PR #95)

Audit-Events bekommen `entity_type` + `entity_id` Spalten (Schema v3 Migration),
damit Events nach "was" (Message, Session, Skill, Capability, Config, Approval)
filterbar sind — nicht nur nach "wer" (peer_id) mit Freitext-Details.

### 2. Config-Revisions (PR #96)

Jede Konfigurationsaenderung wird als before/after JSON-Snapshot in
`config/revisions.db` persistiert. `changedKeys` zeigt welche Top-Level-Sektionen
sich geaendert haben. `source` trackt ob die Aenderung manual, mesh-propagiert,
per env-override oder als rollback kam.

### 3. Approval Gates (PR #97)

Generischer Approval-Service mit `pending → approved | rejected` Flow.
Erster Use-Case: Peer-Join bei SPAKE2/SSH-Bootstrap. Zukuenftig: sensitive
Skill-Aktivierung, Credential-Sharing, Config-Aenderungen.

## Retroaktiver CR-Befund

PRs #96-#97 wurden ohne CR gemerged (Compliance-Verstoss). Der retroaktive
Batch-CR (Gemini Pro, 2026-04-11) fand **keine Findings** in diesen beiden
Modulen — der Code war korrekt, aber der Prozess war falsch.
