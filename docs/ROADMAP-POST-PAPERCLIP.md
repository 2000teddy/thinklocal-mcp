# Roadmap: Post-Paperclip Assimilation

**Stand:** 2026-04-10
**Basis:** Paperclip-Analyse (Claude + Codex + Gemini-3-Pro), ADR-009 bis ADR-014 (Codex),
Multi-Modell-Konsensus (GPT-5.1 9/10, Gemini-2.5-Pro 8/10, Claude Opus 4.6 8/10)
**Leitbild:** Der ioBroker-Moment — "Ich habe diese Peers gefunden. Sie koennen X, Y, Z.
Moechtest du diese Faehigkeiten nutzen?"
**Methodik:** BORG.md (Assimilations-Anleitung)

---

## Ueberblick

```
Phase A — Governance Foundation          (ADR-007, 3 PRs,  ~1 Tag)
Phase B — Dynamic Capabilities           (ADR-008, 4 PRs,  ~3-5 Tage)
Phase C — Execution Semantics            (ADR-009, 2 PRs,  ~2-3 Tage)
Phase D — Resource Governance (deferred) (kein ADR,         nach Bedarf)
```

**Gesamt:** 9 PRs ueber 3 Phasen, plus Phase D als Backlog.
**Aufwand:** ~1-2 Wochen fokussiert, ~3-4 Wochen real mit Reviews + Deploy.

---

## Vorbedingungen (bereits erfuellt)

- [x] ADR-004 Phase 1+2 (Cron-Heartbeat + Agent-Registry) — PR #86, #88
- [x] ADR-005 Phase 1 (Per-Agent-Inbox) — PR #91
- [x] ADR-006 Phase 1 (Session Persistence) — PR #89
- [x] Socket-Pool-Fix — PR #87
- [x] Adapter Schema-Drift Fix — PR #90
- [x] SSH-Bootstrap-Trust Fix — PR #92
- [x] Paperclip-Analyse — PR #93
- [x] 175+ Tests, 0 Regressionen, 3-Node Mesh live

---

## Phase A — Governance Foundation (ADR-007)

**Zweck:** Auditierbarkeit, Konfigurationssicherheit und Vertrauens-Gates verbessern,
BEVOR dynamische Faehigkeiten durchs Mesh wandern.

### PR A1: Activity-Log Entity-Model

**Aufwand:** ~30-45 min
**Dateien:** `packages/daemon/src/audit.ts`
**Schema:** v2 → v3 Migration: `entity_type TEXT, entity_id TEXT` Spalten hinzufuegen
**Motivation:** Audit-Events nach Entity filtern (Message, Session, Skill, Peer),
nicht nur Freitext-Details parsen. Direktes Paperclip-Pattern aus `activity-log.ts`.

### PR A2: Config-Revisions

**Aufwand:** ~1-2 Stunden
**Dateien:** `packages/daemon/src/config-revisions.ts` (neu), `packages/daemon/src/config.ts` (edit)
**Schema:** Neue SQLite-Tabelle `config_revisions` mit `beforeConfig JSON, afterConfig JSON,
changedKeys TEXT, source TEXT ('manual'|'mesh'|'rollback'), created_at TEXT`
**Motivation:** Jede Konfigurationsaenderung versioniert. Rollback-Pfad fuer spaeter.
Direktes Pattern aus Paperclips `agentConfigRevisions`.

### PR A3: Approval-Gate fuer Peer-Join

**Aufwand:** ~2-3 Stunden
**Dateien:** `packages/daemon/src/pairing-handler.ts` (edit), `packages/daemon/src/approvals.ts` (neu)
**Schema:** `approvals(id, type, status, payload_json, decided_at, decision_note)`
**Semantik:** Bei SPAKE2-Pairing und SSH-Bootstrap wird statt sofort zu pairen
ein Approval-Eintrag erstellt. Der User bestaetigt via CLI (`thinklocal pairing approve <id>`)
oder Dashboard. Status: `pending → approved | rejected`.
**Motivation:** ADR-001 fordert Human-Approval fuer Trust-Aenderungen. Bisher nicht implementiert.

---

## Phase B — Dynamic Capabilities (ADR-008)

**Zweck:** Der ioBroker-Moment. Peers entdecken sich, tauschen Faehigkeiten aus,
und der Agent weiss automatisch was er kann.

### PR B1: Neutrales Skill-Manifest + Mesh-Transport

**Aufwand:** ~4-6 Stunden
**Dateien:** `packages/daemon/src/skill-manifest.ts` (neu), `packages/daemon/src/skill-transport.ts` (neu)
**Format:**
```json
{
  "name": "thinklocal-influxdb",
  "version": "1.0.0",
  "description": "Query and write InfluxDB time-series data",
  "origin": "spiffe://thinklocal/host/68f7cd8e330acfe3/agent/claude-code",
  "capabilities": ["influxdb.query", "influxdb.write", "influxdb.databases"],
  "requires": { "mcp_tools": ["influxdb_query", "influxdb_write"] },
  "signature": "<ed25519-sig-of-manifest>",
  "format_version": 1
}
```
**Agent-neutral:** Manifest ist JSON, nicht an Claude Code gebunden.
**Transport:** Via AGENT_MESSAGE auf dem Mesh (bestehende Infra).
**Verzeichnis:** `~/.thinklocal/skills/<name>/manifest.json + SKILL.md`
**Built-ins:** `thinklocal-create-peer`, `thinklocal-create-plugin`, `memory-files`

### PR B2: Agent-Adapter fuer Claude Code Skills

**Aufwand:** ~2-3 Stunden
**Dateien:** `packages/daemon/src/skill-adapter-claude.ts` (neu)
**Was:** Generiert aus dem neutralen `manifest.json + SKILL.md` eine Claude-Code-
kompatible Skill-Datei in `~/.claude/skills/` oder `.claude/skills/` im Projekt.
**Erster Adapter:** Claude Code. Weitere (Codex, Gemini) koennen spaeter folgen,
ohne das Manifest-Format zu aendern.
**Kein Vendor-Lock:** Das Manifest bleibt agent-neutral (Konsensus Claude Opus).

### PR B3: Capability Activation State (4-State-Modell)

**Aufwand:** ~3-4 Stunden
**Dateien:** `packages/daemon/src/capability-activation.ts` (neu)
**Schema:** SQLite-Tabelle `capability_activations`:
```sql
CREATE TABLE capability_activations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  capability_id TEXT NOT NULL,        -- z.B. "influxdb.query"
  version TEXT NOT NULL,
  origin_peer TEXT NOT NULL,          -- SPIFFE-URI des Quell-Peers
  state TEXT NOT NULL CHECK(state IN ('discovered','active','suspended','revoked')),
  manifest_hash TEXT,
  activated_at TEXT,
  suspended_at TEXT,
  revoked_at TEXT,
  metadata_json TEXT,                 -- erweiterbar fuer zukuenftige States
  updated_at TEXT NOT NULL
);
```
**4 States:** `discovered → active → suspended → revoked`
**Default:** `discovered → active` AUTOMATISCH fuer signierte Skills von gepaarten Peers.
**Approval nur fuer:** Skills mit Credential-Zugriff oder von unbekannten Quellen.
**Konsensus:** GPT-5.1 + Claude Opus fuer 4 States, Gemini-Pro wollte 5 —
Kompromiss: 4 jetzt, `metadata_json` ermoeglicht spaetere Erweiterung ohne Migration.
**Execution-Check:** `SELECT ... WHERE state = 'active'` — einziger Gate fuer Nutzung.

### PR B4: WebSocket-Push fuer Inbox + Capability-Events

**Aufwand:** ~4-6 Stunden
**Dateien:** `packages/daemon/src/websocket.ts` (edit), `packages/daemon/src/events.ts` (edit)
**Events:** `inbox:new`, `capability:discovered`, `capability:activated`,
`capability:suspended`, `capability:revoked`, `peer:joined`, `peer:left`
**Subscription:** Lokal-scoped (Dashboard, CLI). Bearer-Token-Auth fuer WebSocket
optional (loopback-only in v1).
**Motivation:** ADR-004 Phase 3. Dashboard + CLI sehen live neue Skills + Nachrichten.

---

## Phase C — Execution Semantics (ADR-009 kondensiert)

**Zweck:** Verteilte Agenten-Aktionen werden nachvollziehbar und debuggbar.

### PR C1: Execution-ID + Lifecycle-State

**Aufwand:** ~3-5 Stunden
**Dateien:** `packages/daemon/src/execution-state.ts` (neu),
`packages/daemon/src/messages.ts` (edit)
**Schema:** SQLite-Tabelle `execution_state`:
```sql
CREATE TABLE execution_state (
  execution_id TEXT PRIMARY KEY,
  instance_uuid TEXT NOT NULL,
  message_id TEXT,
  lifecycle_state TEXT NOT NULL CHECK(
    lifecycle_state IN ('accepted','running','completed','failed','aborted')
  ),
  execution_type TEXT,              -- 'task_request', 'skill_execute', 'message_reply'
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  metadata_json TEXT
);
```
**Wire-Integration:** TASK_REQUEST und TASK_RESULT Messages bekommen optionales
`execution_id`-Feld. Read-Model erlaubt Queries wie "alle running fuer Session X".
**Idempotenz:** Transport-Retries behalten dieselbe execution_id, bewusste
Neuversuche bekommen eine neue.

### PR C2: Goal-Context auf Sessions

**Aufwand:** ~2-3 Stunden
**Dateien:** `packages/daemon/src/session-state.ts` (edit),
`packages/daemon/src/recovery-generator.ts` (edit)
**Neue Felder in SessionState:**
```typescript
goal?: string;              // "Implementiere ADR-007 Phase A"
expectedOutcome?: string;   // "3 PRs gemerged, Tests gruen"
blockingReason?: string;    // "Warte auf CR-Ergebnis"
nextAction?: string;        // "Findings fixen, dann PC"
```
**Impact:** `renderHistoryMarkdown()` generiert eine neue `## Goal & Status`-Sektion.
Recovery-Agents sehen nicht nur "was passiert ist", sondern "wozu und was als naechstes".

---

## Phase D — Resource Governance (deferred)

Erst nach A-C, nur bei Bedarf:

| Item | Aufwand | Trigger |
|------|---------|---------|
| Atomic Session-Checkout | ~3h | Wenn zwei Agents am selben Branch kollidieren |
| Budget-Guard / Cost-Tracking | ~4h | Wenn Token-Kosten unkontrolliert wachsen |
| Config Rollback CLI (`thinklocal config rollback`) | ~2h | Wenn Config-Revisions (PR A2) live sind |
| Circuit Breaker fuer Skill-Execution | ~3h | Wenn ein fehlerhafter Remote-Skill den Daemon lahmlegt |

---

## ADR-Triage: Codex ADR-009 bis ADR-014

| ADR | Titel | Status | Uebernahme |
|-----|-------|--------|------------|
| **ADR-009** | Architecture Principles from Paperclip | **Akzeptiert als Leitplanke** | Nicht als eigene ADR in thinklocal, sondern destilliert in BORG.md + Roadmap. Die 7 Architekturregeln (Zeilen 146-165) werden in README.md uebernommen. |
| **ADR-010** | Distributed Execution Semantics | **Kondensiert in Phase C** | Execution-ID + 5 Lifecycle-States (PR C1). Idempotenz-Klassen A/B/C als Doku, nicht als Code-Enforcement in v1. Kompensation deferred. |
| **ADR-011** | Runtime Capability Lifecycle | **Kondensiert in Phase B** | 4-State-Modell statt 8. Discovery→Validation→Activation als Uebergangsprozess, nicht als persistente States. |
| **ADR-012** | Capability Activation State | **Implementiert in PR B3** | 4 States (discovered/active/suspended/revoked) mit metadata_json fuer Erweiterbarkeit. Kein 2-Ebenen-Modell (ADR-012 hatte Lifecycle + Operative), nur eine Ebene. |
| **ADR-013** | Capability Reconciliation & Drift | **Deferred auf Phase B+** | Drift-Detection als Log-Warnung in v1 (wenn manifest_hash sich aendert), keine automatische Reconciliation-State-Machine. |
| **ADR-014** | Governance & Approval Mapping | **Implementiert in PR A3 (Approval-Gate) + Phase B Default-Activation** | Vereinfacht: Approval nur bei Peer-Join + sensitiven Skills. Normaler Skill-Flow ist auto-activate. |

### Codex ADR-009 Architekturregeln — Uebernahme in README.md

Die folgenden 7 Regeln aus ADR-009 werden als Abschnitt "Architekturprinzipien"
in README.md aufgenommen:

1. **Keine privilegierte verteilte Aktion ohne explizite Ausfuehrungssemantik.**
2. **Recovery ist eine Primaerfunktion, kein Komfort-Feature.**
3. **Capabilities sind dynamisch, aber nie implizit.**
4. **Governance passiert lokal vor der Ausfuehrung.**
5. **Kryptografische Wahrheit zuerst, menschenlesbare Sichten danach.**
6. **Session-State muss Zweck transportieren, nicht nur Verlauf.**
7. **Keine zentrale SaaS-Semantik in den Mesh-Kern importieren.**

---

## Konsensus-Ergebnis (2026-04-10)

| Modell | Rolle | Confidence | Kernaussage |
|--------|-------|------------|-------------|
| **GPT-5.1** | FOR | 9/10 | Fahrplan pragmatisch + gut sequenziert. 3 States reichen mit erweiterbar designtem Enum. Claude-Code-Skill-Format ist v1-pragmatisch. Phase D fuer Checkout + Budget. |
| **Gemini-2.5-Pro** | AGAINST | 8/10 | 3 States zu wenig (braucht revoked + pending_approval). Skill-Sicherheit ungeklaert. Kondensierung erzeugt technische Schulden. |
| **Claude Opus 4.6** | NEUTRAL | 8/10 | Reihenfolge korrekt. PR 4 splitten (neutrales Manifest + Agent-Adapter). 3+suspended=4 States. Heartbeat fehlt (korrigiert: existiert bereits). ADRs formell schreiben. |

**Synthese:** A→B→C korrekt. 4-State-Modell als Kompromiss. PR 4 gesplittet (B1 Manifest + B2 Adapter). Default auto-activate fuer gepaarte Peers (ioBroker-Moment). Approval nur bei sensitivem Zugriff.

---

## Zeitplan (geschaetzt)

| Phase | PRs | Netto-Aufwand | Real (mit CR/PC/Deploy) |
|-------|-----|---------------|-------------------------|
| A | A1, A2, A3 | 0.5-1 Tag | 1-2 Tage |
| B | B1, B2, B3, B4 | 2-4 Tage | 3-6 Tage |
| C | C1, C2 | 2-3 Tage | 2-4 Tage |
| D | variabel | nach Bedarf | nach Bedarf |
| **Gesamt A-C** | **9 PRs** | **~5-8 Tage** | **~2-3 Wochen** |
