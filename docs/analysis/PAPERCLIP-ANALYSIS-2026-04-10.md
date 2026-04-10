# Paperclip Source-Code Analyse fuer thinklocal-mcp

**Datum:** 2026-04-10
**Analysiert von:** Claude Code (Chefentwickler thinklocal-mcp) + PAL Explore Agent
**Quelle:** `/Users/chris/Entwicklung/_AI/paperclip`
**Zweck:** Identifiziere Patterns, Code und Architektur-Ideen die wir bei thinklocal-mcp uebernehmen oder davon lernen koennen.

## Was ist Paperclip?

**Orchestration-System fuer AI-Agent-Unternehmen.** Node.js + React Monorepo. Wenn OpenClaw ein einzelner Mitarbeiter ist, ist Paperclip die Firma — zentrale Kontrollebene mit Org-Charts, Budgets, Governance, Task-Management und Kostentracking fuer 20+ Claude-Code-Terminals.

**Tech-Stack:** Express.js + Drizzle ORM + PostgreSQL + React/Vite + WebSocket + MCP SDK v1.29.0 + Vitest + Playwright.

## Architektur-Highlights

Paperclip hat ~50 Drizzle-Tabellen, 40+ Services, 28 Router-Module. Die Kernstruktur:

```
paperclip/
  server/src/services/     # heartbeat, budgets, secrets, approvals, activity-log
  server/src/adapters/     # Claude, Codex, Cursor, Gemini, HTTP-Webhooks
  server/src/realtime/     # WebSocket live-events
  packages/db/schema/      # 50+ Drizzle-Tabellen (Postgres)
  packages/mcp-server/     # MCP Server als First-Class-Integration
  packages/plugins/sdk/    # Plugin-System mit Worker-Sandbox
  ui/                      # React Dashboard (shadcn/ui)
```

## Was wir uebernehmen sollten (priorisiert)

### PRIORITY 1 — Sofort anwendbar

#### 1. Atomarer Session-Checkout

Paperclip hat `agentTaskSessions` mit UNIQUE(company, agent, adapter, taskKey). Nur eine Agent-Instanz pro Task, atomar erzwungen durch DB-Constraint. `lastRunId` fuer Session-Compaction, `sessionParamsJson` fuer Adapter-State.

**Fuer thinklocal-mcp:** Unser ADR-006 Session-Persistence hat bereits `session_events` und `state.json`, aber keinen atomaren Checkout-Mechanismus. Wenn zwei Claude-Code-Instanzen gleichzeitig den gleichen Branch bearbeiten, gibt es kein Race-Prevention. Paperclips Unique-Constraint-Pattern loest das sauber.

**Quelle:** `packages/db/src/schema/agent_task_sessions.ts`

#### 2. Activity-Log Pattern

Paperclip hat ein generisches `activityLog` mit `(actorType, actorId, action, entityType, entityId, runId, details)`. Jede Mutation ist nachvollziehbar.

**Fuer thinklocal-mcp:** Unser `audit.ts` hat bereits signierte Events mit Merkle-Chain, aber das Schema ist weniger flexibel (nur `event_type + peer_id + details` als Freitext). Paperclips `entityType + entityId` Pattern wuerde es ermoeglichen, Audit-Events nach Entity (Message, Session, Skill, Peer) zu filtern und zu aggregieren.

**Quelle:** `server/src/services/activity-log.ts`

#### 3. Config-Versionierung mit Rollback

Paperclip hat `agentConfigRevisions` mit `beforeConfig + afterConfig + changedKeys + source + rolledBackFromRevisionId`. Jede Config-Aenderung ist versioniert, jeder Rollback ein neuer Eintrag der auf den Ursprung zeigt.

**Fuer thinklocal-mcp:** Wir haben keine Config-Versionierung. Wenn ein Skill-Update oder eine Policy-Aenderung den Daemon kaputt macht, gibt es keinen Rollback ausser `git revert`. Paperclips Pattern waere direkt in `config.ts` / `daemon.toml` integrierbar.

**Quelle:** `packages/db/src/schema/agent_config_revisions.ts`

### PRIORITY 2 — Naechste 2-4 Wochen

#### 4. Approval Gates

Paperclip hat formale Approval-Workflows: `(type, status, payload, decidedByUserId, decisionNote, decidedAt)`. Status-Transitions sind strikt (`pending` -> `approved`/`rejected`). Agent-Hire, Config-Changes, Budget-Overrides brauchen Human-Approval.

**Fuer thinklocal-mcp:** ADR-001 hat "Human Approval Gates fuer Credential Sharing und Skill Transfer" als Phase-1-Feature spezifiziert, aber es ist noch nicht implementiert. Paperclips Approval-Schema ist direkt uebernehmbar.

**Quelle:** `server/src/services/approvals.ts`, `packages/db/src/schema/approvals.ts`

#### 5. Versionierte Secrets

Paperclip hat `companySecrets` + `companySecretVersions` mit expliziter Versionierung. Secrets werden per Reference in Configs eingebettet (`{ type: "secret_ref", secretId, version: "latest"|number }`), nicht inline.

**Fuer thinklocal-mcp:** Unser `vault.ts` hat NaCl Sealed Boxes + OS-Keychain, aber keine Versionierung. Secret-Rotation erfordert aktuell manuelles Ueberschreiben. Paperclips Versions-Pattern wuerde "rotate without downtime" ermoeglichen.

**Quelle:** `server/src/services/secrets.ts`, `packages/db/src/schema/company_secrets.ts`

#### 6. WebSocket Live-Events (Company-scoped)

Paperclip hat `publishLiveEvent({ companyId, type, payload })` mit Bearer-Token Auth und Company-Scope. Browser + CLI-Clients subscriben per WebSocket.

**Fuer thinklocal-mcp:** Wir haben bereits `websocket.ts` + `events.ts` im Daemon, aber ADR-004 Phase 3 (WebSocket-Push als Cron-Ergaenzung) ist noch nicht implementiert. Paperclips Pattern (scoped subscriptions + auth) ist das Vorbild dafuer.

**Quelle:** `server/src/realtime/live-events-ws.ts`

### PRIORITY 3 — Mittelfristig

#### 7. MCP Server als eigene Integration

Paperclip exponiert sich selbst als MCP-Server: `createPaperclipMcpServer(config)` mit Tools fuer Issue-Management, Approvals, etc. Config via Env-Vars.

**Fuer thinklocal-mcp:** Unser `mcp-stdio.ts` ist bereits ein MCP-Server, aber ein externer MCP-Server der das _gesamte Mesh_ als Tool-Set exponiert (nicht nur den lokalen Daemon) wuerde es ermoeglichen, ThinkLocal von _beliebigen_ AI-Tools aus zu steuern — nicht nur von Claude Code.

**Quelle:** `packages/mcp-server/src/index.ts`, `packages/mcp-server/src/tools.ts`

#### 8. Plugin-System mit Worker-Sandbox

Paperclip hat `definePlugin({ id, capabilities, tools, events })` mit JSON-RPC Communication in isoliertem Worker-Context.

**Fuer thinklocal-mcp:** Unsere Skills laufen bereits in WASM/Docker/Deno-Sandboxes, aber das Plugin-SDK-Pattern (formales `definePlugin` + Event-Subscription + Hot-Deploy) fehlt. Paperclips Plugin-SDK ist eleganter als unser aktuelles Skill-Manifest.

**Quelle:** `packages/plugins/sdk/src/define-plugin.ts`

#### 9. Cost-Control & Budgets

Paperclip hat monatliche Token-Budgets pro Agent mit Hard-Stop bei Limit-Ueberschreitung.

**Fuer thinklocal-mcp:** Kein Aequivalent vorhanden. Bei 4+ Agents die autonom laufen waere ein Budget-Guard nuetzlich, um Runaway-Token-Verbrauch zu verhindern.

**Quelle:** `server/src/services/budgets.ts`

## Was Paperclip NICHT hat (und wir schon)

| Feature | thinklocal-mcp | Paperclip |
|---------|---------------|-----------|
| **mTLS Peer-Authentifizierung** | SPIFFE-URIs + CA-Chain | Bearer-Tokens |
| **P2P Mesh** | libp2p + Noise + yamux | Centralisierter Express-Server |
| **CRDT Capability Registry** | Automerge | SQL + REST |
| **Signed Audit-Log** | Ed25519 + Merkle-Chain | Unsigned Activity-Log |
| **Zero-Trust Networking** | Jeder Peer verifiziert jeden | Trust via API-Key |
| **Dezentrale Discovery** | mDNS + Gossip | Manual Agent-Config |
| **Offline-First** | SQLite WAL, lokale Inbox | PostgreSQL (braucht Server) |

**Kernerkenntnis:** thinklocal-mcp ist **Security-first und dezentral**, Paperclip ist **Feature-rich und zentralisiert**. Die Staerken ergaenzen sich: wir koennen Paperclips Governance- und Audit-Patterns uebernehmen, ohne die dezentrale Architektur aufzugeben.

## Fehler die wir vermeiden sollten

1. **Zu viele Tabellen zu frueh:** Paperclip hat 50+ Tabellen. Fuer thinklocal-mcp mit SQLite statt Postgres wuerde das zu fragmentiert. Besser: JSON-Spalten fuer flexible Daten (wie Paperclips `stateJson`).

2. **Centralisierter Auth:** Paperclip nutzt BetterAuth mit Bearer-Tokens. In einem dezentralen Mesh ist das nicht tragfaehig — unsere mTLS + SPIFFE-URI Authentifizierung ist korrekt.

3. **Kein Offline-Support:** Paperclip braucht PostgreSQL. Unsere SQLite-WAL-Architektur ist hier ueberlegen fuer den Use-Case "Agent laeuft lokal ohne Netzwerk".

## Naechste Schritte

Die drei wertvollsten Quick-Wins aus Paperclip fuer thinklocal-mcp:

1. **Activity-Log Entity-Model** in `audit.ts` erweitern: `entityType + entityId` Spalten hinzufuegen (Schema v3 Migration). Sofort umsetzbar, ~30 Minuten.

2. **Config-Revisions Table** als neues Modul `config-revisions.ts`. Bei jedem `daemon.toml`-Write einen Snapshot speichern. ~1 Stunde.

3. **Approval-Gate fuer Peer-Join** bei `POST /api/pairing/confirm`. Statt sofort zu pairen, einen Approval-Eintrag erstellen und User-Bestaetigung abwarten. ~2 Stunden.

Alle drei bauen auf bestehender Infra auf (SQLite, Fastify, audit.ts) und brauchen keinen Architektur-Umbau.
