# ADR-008: Dynamic Capabilities

**Status:** Implemented (Phase B, 2026-04-10)
**Datum:** 2026-04-10
**Autoren:** Claude Code, Multi-Modell-Konsensus
**Verwandt:** ADR-007 (Governance Foundation), BORG.md, ADR-012 (Codex, Leitplanke)

## Kontext

Das Mesh muss den "ioBroker-Moment" liefern: Peers entdecken sich, tauschen
Faehigkeiten aus, und der Agent weiss automatisch was er kann. Dafuer braucht
es ein agent-neutrales Skill-Format, einen Capability-Lifecycle und
Live-Events.

## Entscheidungen

### 1. Neutrales Skill-Manifest (PR #98)

Skills leben in `~/.thinklocal/skills/<name>/manifest.json + SKILL.md`.
Das Manifest ist JSON, agent-neutral (kein Vendor-Lock). Agent-spezifische
Adapter transformieren es in native Formate.

**SECURITY:** Skill-Name wird via `basename()` + Regex-Validation sanitisiert.
Path-Traversal-Luecke wurde im retroaktiven CR als CRITICAL gefunden und
sofort gefixt (PR #104).

### 2. Claude Code Skill Adapter (PR #99)

Erster Adapter: generiert Claude Code `.md`-Dateien mit YAML-Frontmatter
aus dem neutralen Manifest. Weitere Adapter (Codex, Gemini) folgen dem
gleichen Interface.

### 3. Capability Activation State (PR #100)

4-State-Modell: `discovered → active → suspended → revoked`.

| State | Bedeutung |
|---|---|
| discovered | Peer hat diese Faehigkeit, noch nicht lokal aktiviert |
| active | Lokal freigeschaltet, darf benutzt werden |
| suspended | Admin hat temporaer abgeschaltet |
| revoked | Permanent entfernt (Security-Incident) |

**Default:** `discovered → active` AUTOMATISCH fuer signierte Skills von
gepaarten Peers. Approval-Gates (ADR-007 PR #97) nur fuer sensitive Ops.

**Konsensus:** GPT-5.1 + Claude Opus fuer 4 States, Gemini-Pro wollte 5.
Kompromiss: 4 jetzt, `metadata_json` fuer Erweiterbarkeit.

### 4. WebSocket Event Types (PR #101)

8 neue Event-Typen: `inbox:new`, `approval:created/decided`, `config:changed`,
`capability:discovered/activated/suspended/revoked`. Dashboard + CLI sehen
live neue Skills und Nachrichten.

## Retroaktiver CR-Befund

**2× CRITICAL:** Path-Traversal in skill-manifest.ts + skill-adapter-claude.ts.
Der `manifest.name` wurde unkontrolliert als Pfad verwendet — ein manipulierter
Name wie `../../etc/passwd` haette beliebige Dateien ueberschreiben koennen.
Gefixt via `sanitizeSkillName()` mit `basename()` + Regex-Guard + 5 Regression-Tests.

**1× MEDIUM:** metadata_json in capability-activation.ts wurde ueberschrieben
statt gemerged. Gefixt: bestehende Metadaten werden gelesen und erweitert.
