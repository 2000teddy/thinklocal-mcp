# Changelog

Alle relevanten Änderungen an diesem Projekt werden hier dokumentiert.
Mit Versionnummer, Datum und Uhrzeit - sowie einer kurzen Beschreibung / Erläuterung
Format: [Keep a Changelog](https://keepachangelog.com/de/1.0.0/).

---

## [Unreleased] — 2026-04-11

### Compliance Enforcement Infrastructure

- **PR #105** CI repariert: vitest-Pfad gefixt (packages/daemon statt root),
  Compliance-Gate-Job (prueft CHANGES.md + COMPLIANCE-TABLE.md), CI wrap-up
  Job als Required Status Check fuer Branch Protection.
- **PR #108** Workflow-Hardening: CODEOWNERS fuer Security-Pfade (vault, tls,
  identity, audit, pairing → @2000teddy Human Review), Pre-Commit Hook
  (scripts/install-hooks.sh), Bot-Approve Helper (scripts/bot-approve.sh).
- GitHub Branch Protection aktiviert: enforce_admins=true, Required Check CI,
  Required Review 1, CODEOWNERS Review required, no force push.

---

### Post-Paperclip Roadmap (ADR-007/008/009) — 9 PRs in 3 Phasen

Inspiriert durch die Paperclip-Analyse (BORG.md Methodik). Multi-Modell-Konsensus
(GPT-5.1 9/10, Gemini-2.5-Pro 8/10, Claude Opus 4.6 8/10).

#### Phase A — Governance Foundation (ADR-007)

- **PR #95** Activity-Log Entity-Model: `entity_type` + `entity_id` Spalten in audit_events + Peer-Sync-Parity + getEventsByEntity() Query. 12 Tests.
- **PR #96** Config-Revisions: before/after JSON-Snapshots bei jeder Konfigurationsaenderung, diffTopLevelKeys, rollback-ready. 10 Tests.
- **PR #97** Approval Gates: generischer Approval-Service (pending→approved/rejected), erster Use-Case: Peer-Join. 15 Tests.

#### Phase B — Dynamic Capabilities (ADR-008)

- **PR #98** Neutral Skill Manifest: agent-neutrales `~/.thinklocal/skills/<name>/manifest.json + SKILL.md` Format. 14+5 Tests.
- **PR #99** Claude Code Skill Adapter: erster Agent-Adapter, transformiert Manifest in Claude Code .md mit YAML-Frontmatter. 7 Tests.
- **PR #100** Capability Activation State: 4-State-Modell (discovered/active/suspended/revoked), automatische Aktivierung fuer signierte Skills von gepaarten Peers. 14 Tests.
- **PR #101** WebSocket Event Types: 8 neue Event-Typen (inbox:new, approval:*, config:changed, capability:*). 4 Tests.

#### Phase C — Execution Semantics (ADR-009 kondensiert)

- **PR #102** Execution-ID + Lifecycle-State: 5-State-Lifecycle (accepted→running→completed/failed/aborted), atomarer WHERE-Guard. 13 Tests.
- **PR #103** Goal-Context auf Sessions: goal, expectedOutcome, blockingReason, nextAction Felder + HISTORY.md-Sektion. 3 Tests.

#### Compliance-Catchup (PR #104)

Retroaktiver Gemini-Pro Batch-CR ueber alle 8 Module (#96-#103): **2× CRITICAL (Path-Traversal in skill-manifest + skill-adapter), 1× HIGH (TOCTOU Race in execution-state), 2× MEDIUM (metadata-merge, decode-logging)**. Alle CRITICALs und HIGHs sofort gefixt mit 5 Regression-Tests. COMPLIANCE-TABLE, CHANGES, 3 ADR-Dokumente, TODO, USER-GUIDE, SECURITY nachgeholt.

**Lektion gelernt:** 9 PRs in 17 Minuten ohne CR/PC/DO ist **kein Beweis fuer Effizienz, sondern fuer uebersprungene Qualitaets-Gates**. Zwei Security-Luecken (Path-Traversal) waeren ohne den retroaktiven CR unentdeckt geblieben. BORG.md wurde um eine Warnung ergaenzt.

---

#### PR #91 — ADR-005 Per-Agent-Inbox Phase 1 (SPIFFE 4-Komponenten + Schema-Migration)

Implementiert den letzten Baustein im ADR-004/005/006 Triptychon: mehrere
Agent-Instances (Claude Code, Codex, Gemini CLI) koennen sich denselben
Daemon teilen und behalten ihre eigene Inbox, ohne Nachrichten untereinander
zu sehen.

- **`packages/daemon/src/spiffe-uri.ts`** (neu) — strikte 3- vs 4-Komponenten
  SPIFFE-URI-Helper. `parseSpiffeUri`, `normalizeAgentId`, `getAgentInstance`,
  `buildInstanceUri`, `hasInstance`. Zentraler
  `SPIFFE_COMPONENT_REGEX = /^[A-Za-z0-9._-]+$/` fuer alle Parse- und Build-
  Pfade, importiert vom API-Layer fuer kohaerente Validation. 27 Unit-Tests.
- **`packages/daemon/src/agent-inbox.ts`** — Schema-Migration v1 → v2 via
  `PRAGMA user_version`. Neue Spalte `to_agent_instance TEXT NULL` + Index.
  Saubere Trennung: `createSchemaV2` fuer fresh-DBs, `migrateToV2` fuer
  bestehende v1-DBs. Beide idempotent. `store()` normalisiert `to` und
  extrahiert Instance-ID. `list()` / `unreadCount()` mit neuen `forInstance`
  + `includeLegacy` Parametern. Back-compat: `unreadCount(string)` bleibt
  funktional. 12 neue ADR-005-Tests.
- **`packages/daemon/src/inbox-api.ts`** — Loopback-Check gegen
  `normalizeAgentId(body.to) === ownAgentId` (GPT-5.4 Gotcha aus Konsensus
  2026-04-08 — 4-Komponenten-Targets fielen sonst durch auf den
  Remote-Peer-Pfad mit 404). Peer-Lookup nutzt normalisierte URI. Store-Pfad
  persistiert `to_agent_instance`. Neue Query-Parameter `for_instance` +
  `include_legacy` in `GET /api/inbox` und `GET /api/inbox/unread`.
  Zentraler `validateInstanceParam` Helper mit importiertem
  `SPIFFE_COMPONENT_REGEX`. 8 neue Fastify-Inject Tests.
- **`docs/architecture/ADR-005-per-agent-inbox.md`** — Status auf
  `Accepted, Phase 1 Implemented`, Impl-Block + Phase-2-Backlog.
- **`SECURITY.md`** — neuer Abschnitt "SPIFFE-URI 4-Komponenten-Form ist
  Application-Layer-Routing" mit Threat-Model, `normalizeAgentId` Pflicht-
  Pattern fuer alle Trust-Entscheidungen, SQL-Injection-Defense.

**Tests:** 61/61 neue Tests gruen (27 SPIFFE + 12 ADR-005 Inbox + 8 Fastify +
14 back-compat Inbox), 0 Regressionen, `tsc --noEmit` clean.

**Compliance:**
- CO: entfaellt (Konsensus aus PR #84, 2026-04-08)
- CG: entfaellt (Scope in 3 Layer strukturiert)
- TS: 61/61 gruen inkl. 8 SPIFFE-Injection-Regression + 3 CR/PC-Regression
- CR: pal:codereview Gemini Pro (security) — 0 HIGH/CRITICAL, 2× MEDIUM +
  1× LOW alle gefixt:
  - MEDIUM #1 → `SPIFFE_COMPONENT_REGEX` zentral, in `parseSpiffeUri` +
    `buildInstanceUri` durchgesetzt, 8 Injection-Regression-Tests
  - MEDIUM #2 → `init()` split in `createSchemaV2` + `migrateToV2`
  - LOW #3 → `validateInstanceParam` DRY helper
- PC: pal:precommit Gemini Pro — 1× HIGH (duplizierter Regex im DRY-Helper
  statt Import aus `spiffe-uri.ts`) — mid-fix **gefixt**: Helper importiert
  jetzt `SPIFFE_COMPONENT_REGEX`, kein zweiter Regex-Literal mehr im Code.
- DO: ADR-005 Status + SECURITY.md + CHANGES.md + COMPLIANCE-TABLE.md #111

---

#### PR #89 — ADR-006 Phase 1: Agent Session Persistence & Crash Recovery MVP

Supersedes #85 (Design-only). Liefert die 7 Kern-Module fuer Session-
Persistence + einen End-to-End Crash+Resume Integration-Test.

- **`packages/daemon/src/atomic-write.ts`**: write(tmp → fsync → rename)
  Helper. Single-Writer-Garantie fuer `state.json`, `HISTORY.md`,
  `START-PROMPT.md`. Swallows cleanup errors (kommentiert per CR).
- **`packages/daemon/src/session-events.ts`**: SQLite-backed append-only
  event store. WAL + `PRAGMA user_version` fuer Migration. Idempotente
  Inserts via `UNIQUE(instance_uuid, seq)`. Content-Hash pro Event.
- **`packages/daemon/src/session-state.ts`**: `state.json` TypeScript
  interface + `writeSessionState` / `readSessionState` / `isPidAlive`.
  Writes via atomic-write.
- **`packages/daemon/src/session-adapters/claude-code-adapter.ts`**:
  defensive jsonl-Parser fuer `~/.claude/projects/*/sessions/*.jsonl`.
  UTF-8 BOM-Strip, unknown types → silent skip, malformed JSON → silent
  skip. Mappt Claude-Code v2.1.x records auf `SessionEventType`.
- **`packages/daemon/src/recovery-generator.ts`**: DETERMINISTISCHER
  HISTORY.md Generator (kein LLM). Sektionen: Goals, Decisions,
  Files Touched, Commands Run, Errors, Next Actions (letzter
  TodoWrite), Recent Narrative mit UNTRUSTED-Markierung fuer
  Prompt-Injection-Defense.
- **`packages/daemon/src/session-watcher.ts`**: poll-basiertes
  (NICHT fs.watch) tail-ingest. `tick(path, state)` mit in-memory
  Promise-Lock pro `instanceUuid` gegen Race Conditions. Liest
  `state.json` unter dem Lock neu als authoritative source. Returns
  `newState` immutable (keine Input-Mutation). Defers half-written
  tail lines bis newline ankommt.
- **`packages/daemon/src/session-binding.ts`**: Orphan-Scan (kill -0)
  + Fingerprint-Matching auf `(cwd, gitBranch, agentType)`. Liefert
  0/1/N orphans — caller entscheidet. Injectierbarer `isAlive` fuer Tests.
- **`tests/integration/session-recovery.test.ts`**: vollstaendiger E2E-
  Flow: Agent start → jsonl grows → watcher ingests → HISTORY.md
  generated → Agent "crashes" (pid=99999) → Binding findet Orphan →
  neuer Agent nimmt pid ueber → mehr Turns → weiter-Ingest.

#### Tests

53/53 neue Tests gruen, 0 Regressionen, `tsc --noEmit` clean.
- 6 atomic-write (incl. concurrent writers)
- 6 session-events (idempotent inserts, persistence)
- 4 session-state (round-trip, isPidAlive edge cases)
- 13 claude-code-adapter (incl. BOM regression)
- 10 recovery-generator (incl. determinism check)
- 8 session-watcher (incl. concurrent tick lock regression + newState contract)
- 5 session-binding (fingerprint matching, deterministic isAlive)
- 1 integration (crash+resume E2E)

#### Compliance

- CO: entfaellt (Design-Konsensus in ADR-006 aus PR #85, 2026-04-08)
- CG: entfaellt (Scope teilweise per Divide-and-Conquer abgeleitet,
  Layer-basierte Implementation mit Tests parallel zu jedem Modul)
- TS: 53/53 gruen inkl. 3 Regression-Tests fuer CR-Findings
- CR: `pal:codereview` Gemini Pro (security focus) — 0 CRITICAL,
  2× HIGH (watcher race, isPidAlive PID-reuse), 2× MEDIUM (BOM,
  UNTRUSTED marker doc), 2× LOW (state mutation, cleanup errors) —
  alle adressiert:
  - HIGH #1 → Per-instance Promise-Lock im Watcher selbst
  - HIGH #2 → Dokumentiert in ADR-006 §Bekannte Limitierungen
  - MEDIUM #3 → UTF-8 BOM strip im adapter + Regression-Test
  - MEDIUM #4 → Pflicht-Doku fuer resumierende Agents in ADR-006
  - LOW #5 → `newState` im IngestResult + immutable contract
  - LOW #6 → Kommentar an swallowed cleanup errors
- PC: `pal:precommit` Gemini Pro — 1× MEDIUM (State mutation
  anti-pattern) — vollstaendig entfernt: Watcher ist jetzt strict
  immutable. Watcher liest `state.json` unter dem Lock neu als
  authoritative source fuer concurrent callers.
- DO: ADR-006 Phase 1 Impl-Block + `Bekannte Limitierungen` +
  CHANGES.md + COMPLIANCE-TABLE.md Zeile #110

---

#### PR #88 — ADR-004 Phase 2 Agent Registry REST API

- **`packages/daemon/src/agent-registry.ts`**: in-memory Agent-Instance Tracking.
  `register`/`heartbeat`/`unregister`/`sweep`/`listeners` mit deterministisch
  injectierbarem Clock + `setInterval`/`clearInterval`-Shim. Stale-Eviction
  nach `3 × heartbeatIntervalMs`. Hard-Cap `maxEntries = 1000` mit dedizierter
  `AgentRegistryFullError` gegen DoS durch lokale Clients.
- **`packages/daemon/src/agent-api.ts`**: Fastify-Plugin mit vier
  loopback-only Endpoints: `POST /api/agent/register` (4-Komponenten-SPIFFE-URI,
  409 Conflict, 503 wenn voll, 500 bei malformed Daemon-URI), `POST /api/agent/heartbeat`
  (404 → Client re-registriert), `POST /api/agent/unregister` (idempotent),
  `GET /api/agent/instances` (read-only). Strict Regex-Validation `[A-Za-z0-9._-]+`,
  `requireLocal()` Pattern aus PR #83.
- **`packages/daemon/src/audit.ts`**: 4 neue AuditEventType — `AGENT_REGISTER`,
  `AGENT_HEARTBEAT`, `AGENT_UNREGISTER`, `AGENT_STALE`.
- **`packages/daemon/src/index.ts`**: Wire-up mit `start()`/`stop()` im
  Daemon-Lifecycle.
- **ADR-004** Status: "Accepted, Phase 1 + Phase 2 Implemented".

#### Tests

34 neue Tests gruen (19 Registry Unit + 15 API Integration via `fastify.inject()`),
0 Regressionen, `tsc --noEmit` clean.

#### Compliance

- CO: entfaellt (Design-Konsensus aus PR #84)
- CG: entfaellt (kleiner Scope, Code direkt)
- TS: 34/34 gruen inkl. 6 Regression-Tests fuer alle Review-Findings
- CR: `pal:codereview` Gemini Pro — 0 HIGH/CRITICAL, 1× MEDIUM (maxEntries DoS-Cap) + 2× LOW (heartbeat race, SPIFFE-URI silent fallback) — alle gefixt
- PC: `pal:precommit` Gemini Pro — 1× MEDIUM (unregister race analog zum heartbeat-Fix) — gefixt mit Regression-Test
- DO: ADR-004 Status-Update + CHANGES.md + COMPLIANCE-TABLE.md Zeile #109

---

#### PR #86 — ADR-004 Phase 1 Cron-Heartbeat (2026-04-09)
- **`packages/daemon/src/heartbeat/interval.ts`**: pure-function adaptive Backoff
  + ±20 % Jitter Modul. `nextInterval(state, hadMessages, mode)` mit
  exponentiellem Backoff bis zum mode-spezifischen Cap, `applyJitter(intervalMs, rng?)`
  fuer Anti-Thundering-Herd. Mode-Tabelle aus ADR-004 (`local`/`lan`/`federated`/`adhoc`).
  11 Unit-Tests.
- **`packages/cli/src/thinklocal-heartbeat.ts`**: neuer Subcommand
  `thinklocal heartbeat show|status|help`. `show` druckt die zwei Cron-Prompts
  aus `docs/agents/{inbox,compliance}-heartbeat.md` zum Reinpasten in
  `CronCreate` der Agent-Harness. `status` liest und pretty-printed
  `~/.thinklocal/heartbeat.json`. 8 Unit-Tests inkl. Regression fuer JSON-Parse.
- **`tests/integration/heartbeat-loop.test.ts`**: simuliert die Heartbeat-Loop
  gegen eine Mock-Inbox und verifiziert die ADR-konforme Pattern
  `[5s, 10s, 20s, 5s, 5s]`.
- **`docs/agents/inbox-heartbeat.md`** + **`compliance-heartbeat.md`**:
  Cron-Prompt-Bodies fuer Inbox-Polling (5 s, adaptiv) und Compliance-Check
  (5 min, fix). Beide mit Early-Return und Read-Only-Constraints.
- **ADR-004** Status: `Proposed → Accepted, Phase 1 Implemented`.
- **USER-GUIDE.md** Section 8a "Cron-Heartbeat aktivieren" mit Schritt-fuer-Schritt
  Anleitung fuer Claude Code, Codex, Gemini CLI.

### Konsensus-Entscheidungen umgesetzt

- Polling-Jitter ±20 % (GPT-5.4 Anti-Thundering-Herd)
- Inbox- und Compliance-Heartbeat als getrennte Cron-Jobs (GPT-5.4 Separation of Concerns)
- Adaptive Backoff nur fuer Inbox, Compliance fix
- Inbox-Prompt mit Early-Return zur Context-Budget-Schonung

### Code Review (Gemini Pro, 2026-04-09)

0 HIGH/CRITICAL. 2× MEDIUM (REPO_ROOT brittleness, cmdStatus JSON parsing) + 1× LOW
(unnoetiges async) — alle drei adressiert: Kommentar bei REPO_ROOT, JSON pretty-print
mit Fallback fuer cmdStatus (+ 2 Regression-Tests), `async` bewusst beibehalten fuer Phase 2.

### Tests

20/20 neue Tests gruen, 0 Regressionen in der bestehenden Suite (200 Tests bleiben gruen,
12 pre-existing better-sqlite3 Load-Failures unveraendert — separates Infra-Issue).

### Behoben

#### PR #87 — Socket-Pool-Fix fuer langlaufenden MCP-Stdio-Subprocess (Bug-Fix)

- **`packages/daemon/src/local-daemon-client.ts`**: bisher wurde bei **jedem**
  `requestDaemon`-Call ein neuer `HttpsAgent` ohne `keepAlive` erzeugt. In
  einem langlaufenden mcp-stdio-Subprocess (der die ganze Claude-Code-Session
  am Leben bleibt) fuehrte das zu Socket-Pool-Exhaustion: TIME_WAIT-Akkumulation,
  ungepoolte TLS-Handshakes, haengende Sockets ohne Timeout-Trigger. Symptom
  nach ~4 h: **`socket hang up`** auf jeden MCP-Tool-Call, obwohl der Daemon
  einwandfrei laeuft (siehe PR #86 Live-Test-Follow-Up).
- **Fix**: globaler `HttpsAgent`-Cache pro `dataDir` mit `keepAlive: true`,
  `maxSockets: 50`, `maxFreeSockets: 10`, `scheduling: 'lifo'`. Invalidierung
  ueber `mtime`-Fingerprint der Trust-Material-Dateien (`ca.crt.pem`,
  `paired-peers.json`, Client-Certs); bei Rotation wird der alte Agent mit
  `agent.destroy()` sauber abgebaut und ein neuer aufgebaut. Trust-Bundle
  wird nicht mehr bei jedem Call neu gelesen.
- **`packages/daemon/src/mcp-stdio.ts`**: Graceful-Shutdown-Handler fuer
  `SIGTERM`/`SIGINT`/`SIGHUP`/`exit`. Rufen `__resetDaemonClientCache()` und
  exiten mit dem 128+signal-Code (`SIGINT` → 130, `SIGTERM` → 143,
  `SIGHUP` → 129), damit Supervisor (launchd, systemd) das Ende korrekt
  einordnen. Verhindert die Zombie-Subprocesses, die `ps aux | grep mcp-stdio`
  zuletzt als >19 h alte Hangs gezeigt hat.
- **`packages/daemon/src/local-daemon-client.test.ts`** (neu): 5 Regression-Tests:
  100 sequenzielle HTTP-Requests ohne Leak, HTTP-only-Pfad ohne Cache-Entry,
  HTTPS-Cache genau 1 Entry nach mehreren Calls zum selben `dataDir`,
  Cache-Invalidierung bei `mtime`-Aenderung, `__resetDaemonClientCache` leert
  komplett.

#### Konsequenzen

- ADR-004 Phase 1 (PR #86) ist in der Praxis erst mit diesem Fix nutzbar.
- Erkenntnis aus Live-Test: **Memory-Hinweis `mcp_subprocess_staleness.md`
  war halb richtig** — der Fix ist kein Thin-Client-Rewrite, sondern ein
  5-Zeilen-Architektur-Bug (fehlender keepAlive + fehlendes Pooling). Kein
  ADR-007 noetig.

#### Compliance

- CG: entfaellt (Bug-Fix, keine neue API)
- TS: 5/5 Tests gruen, 0 Regressionen
- CR: `pal:codereview` (Gemini Pro) — 0 HIGH/CRITICAL, 1× MEDIUM + 3× LOW, alle gefixt
- PC: `pal:precommit` (Gemini Pro) — 1× CRITICAL (Race) als False-Positive
  via `pal:challenge` bestaetigt (Funktion ist vollstaendig synchron,
  atomisch im Node Event-Loop — defensiver Kommentar eingebaut), 1× HIGH
  (Exit-Code) gefixt
- DO: CHANGES.md + COMPLIANCE-TABLE.md (neue Zeile #108)

---

## [0.31.0] — 2026-04-08 09:50 UTC

**Mesh-Live-Session: 4 Nodes verbunden, Agent-zu-Agent Messaging funktioniert.**

### Hinzugefuegt

#### PR #79 — Agent-to-Agent Messaging (2026-04-08 06:47 UTC)
- **`agent-inbox.ts`**: SQLite-basierter Inbox-Store (`~/.thinklocal/inbox/inbox.db`, WAL), 64 KB Body-Limit, Dedupe via UUID, soft read/archive Flags, Filter (unread/from/limit/include_archived), `unreadCount()`. 14 neue Tests.
- **`messages.ts`**: Neue MessageTypes `AGENT_MESSAGE` + `AGENT_MESSAGE_ACK` mit Payload-Interfaces. Beide signiert via Mesh-Envelope, ueber CBOR transportiert.
- **`inbox-api.ts`**: REST-Endpoints `POST /api/inbox/send`, `GET /api/inbox`, `POST /api/inbox/mark-read`, `POST /api/inbox/archive`, `GET /api/inbox/unread`. Send-Pfad baut signierten Envelope und schickt ihn via mTLS an den Ziel-Peer.
- **MCP-Tools** (in `mcp-stdio.ts`): `send_message_to_peer`, `read_inbox`, `mark_message_read`, `archive_message`, `unread_messages_count` — direkt von Codex/Claude CLI nutzbar.
- **AuditEventTypes**: `AGENT_MESSAGE_RX`, `AGENT_MESSAGE_TX`.

#### PR #80 — Loopback fuer Same-Daemon Sibling-Agents (2026-04-08 07:14 UTC)
- **Loopback-Pfad** in `inbox-api.ts`: Wenn `body.to === ownAgentId` (mehrere Agenten teilen einen Daemon), wird die Nachricht direkt im lokalen Inbox abgelegt statt ueber Netzwerk geroutet. Erlaubt Claude ↔ Codex auf demselben Host.
- **`delivery`-Feld** in der Send-Response: `"loopback"` oder `"remote"`.
- **`onSent`-Hook** fuer `AGENT_MESSAGE_TX`-Audit, beide Pfade.

#### PR #75 — SPAKE2 Trust-Store Integration (2026-04-07 17:13 UTC)
- **`trust-store.ts`**: `buildTrustedCaBundle()` aggregiert eigene CA + alle CAs gepairter Peers. `TrustStoreNotifier` als Observer fuer spaetere Hot-Reload.
- **`agent-card.ts`**: Neue `trustedCaBundle: string[]` Option fuer Fastify-HTTPS `ca`-Parameter. Fallback auf eigene CA fuer backwards-compat.
- **`index.ts`**: PairingStore wird vor Fastify/undici angelegt, das aggregierte Bundle fliesst in beide.
- **10 neue trust-store Tests.**

#### PR #74 — Daemon Usability Bundle (2026-04-07 17:13 UTC)
- **`scripts/health-check.sh`**: mTLS-aware Health-Check mit 3 Fallbacks (mTLS+ClientCert → HTTPS-k → HTTP). 3s-Timeout. Loest "Daemon nicht erreichbar"-Fehlmeldung obwohl HTTPS-Daemon laeuft.
- **`scripts/check-native-modules.cjs`**: postinstall-Hook (root + daemon), erkennt `NODE_MODULE_VERSION`-Mismatch nach Node-Upgrade und macht automatisch `npm rebuild better-sqlite3`. Verhindert ABI-Crash-Loop.
- **Stable Node-Identity** (`identity.ts`): Neue `loadOrCreateStableNodeId()` aus 16-hex Hardware-Fingerprint (sortierte MACs + CPU + Plattform), persistiert in `keys/node-id.txt`. SPIFFE-URI ist jetzt `host/<stableNodeId>/agent/<type>` statt `host/<hostname>`. Loest "Hostname-Drift" auf macOS, wo Bonjour bei Kollisionen den Hostname dynamisch aendert. **11 neue Tests.**
- **`scripts/service/service.sh`**: launchd-Wrapper fuer macOS (bootstrap/bootout, Logs nach `~/Library/Logs/thinklocal-mcp/`, Subcommands install/start/stop/restart/status/logs/errors).

#### PR #73 — Codex Sandbox (Cherry-Pick) (2026-04-06 18:23 UTC)
- **`sandbox.ts`**: WASM-Pfad via `wasmtime --dir`, Docker-Fallback via `docker run --read-only --network none --memory --cpus 1 --pids-limit 64`. SKILL_INPUT_BASE64-Contract.
- **Security-Fix**: `isPathAllowed()` nutzt `path.relative()` statt `startsWith()` (loest `/skills-evil/`-Bypass).
- **TypeScript-Folgefix**: `as ChildProcessWithoutNullStreams` → `ChildProcessByStdio<null, Readable, Readable>` (TS2352).

#### PR #76 — Codex Deno Sandbox (Cherry-Pick) (2026-04-07 18:30 UTC)
- **`sandbox.ts`**: `runtime=deno` ueber `deno run --no-prompt` mit expliziten `--allow-*`-Flags und lokalem `DENO_DIR` im Skill-Verzeichnis. Drittes Sandbox-Backend nach Node und WASM.

#### PR #78 — SSH-Bootstrap-Trust-Script (2026-04-07 19:05 UTC)
- **`scripts/ssh-bootstrap-trust.sh`**: Nutzt bestehenden SSH-Trust zwischen Operator-eigenen Nodes statt manuelle PIN-Zeremonie. ssh-Reachability + base64-encoded JSON via stdin (vermeidet Newline/Quoting-Issues mit mehrzeiligen PEM-Strings). Idempotent (jq upsert by agentId). Backwards-kompatibel: Legacy-Hostname-Fallback wenn Peer noch keine `node-id.txt` hat.

### Sicherheits-Fixes (kritisch)

#### PR #77 — CA Subject DN Collision Fix (2026-04-07 19:03 UTC)
**Cross-Node mTLS Blocker.** Jede ThinkLocal-Node generierte ihre CA mit dem **identischen** Subject DN `CN=thinklocal Mesh CA, O=thinklocal-mcp`. Wenn der Trust-Store mehrere CAs mit gleichem Subject enthielt (eigene + gepairte Peer-CAs), pickte OpenSSL/Node.js beim Issuer-Name-Lookup die ERSTE passende CA — nicht die mit dem richtigen Public-Key. Resultat: `certificate signature failure` selbst wenn die richtige CA im Bundle lag.

PR #75 (TrustStore-Aggregation) war damit zwar **strukturell korrekt** aber funktional **wirkungslos**, bis dieser Fix kam.

- **`createMeshCA(meshName, nodeId?)`**: nodeId fliesst in CN ein → `CN=thinklocal Mesh CA <nodeId>`. Ohne nodeId: 16-hex Random-Suffix als Fallback fuer Tests.
- **`loadOrCreateTlsBundle(..., nodeId?)`**: Migration detektiert Legacy-CAs (`CN === "thinklocal Mesh CA"`), sichert sie als `*.legacy.pem` und reissued CA + Node-Cert.
- **`index.ts`**: uebergibt `identity.stableNodeId` an `loadOrCreateTlsBundle`.
- **Live-verifiziert**: `certificate signature failure` → `other side closed` (TLS-Verify funktioniert) → voller bidirektionaler Handshake nach Peer-Deploy.

#### PR #103 (GitHub #81) — Compliance Catchup + Retro-Review-Findings (2026-04-08 09:50 UTC)
**GPT-5.4 retroaktiver Security-Review von PR #77 fand 1 HIGH + 4 MEDIUM/LOW.** Alle gefixt:
- **HIGH**: Node-Cert Reuse-Pfad ohne Signatur-Verifikation gegen aktuelle CA. Ein partial-migration-crash konnte ein Cert hinterlassen, das nicht mehr von der aktuellen CA signiert war aber zufaellig die SPIFFE-URI matchte. Jetzt: try/catch + caCert.verify(cert) check.
- **MEDIUM**: Keine CA-Validity-Window-Pruefung beim Laden. Jetzt: `notBefore <= now <= notAfter` Check, sonst reissue.
- **LOW**: `getCertDaysLeft()` zeigte auf falschen Pfad (`certs/node.crt` statt `tls/node.crt.pem`). Startup-Warnings fuer ablaufende Certs feuerten nie.

### Live-Mesh-Status

| Node                   | IP             | Plattform     | Stable Node-ID     | Rolle                       |
|------------------------|----------------|---------------|--------------------|------------------------------|
| MacMini (mein)         | 10.10.10.94    | macOS arm64   | `69bc0bc908229c9f` | Daemon + Claude Code + Codex |
| influxdb               | 10.10.10.56    | Ubuntu x64    | `68f7cd8e330acfe3` | Daemon + InfluxDB-Skill      |
| ai-n8n-local           | 10.10.10.222   | Linux x64     | `e7aeb01312e25b42` | Daemon + n8n                 |
| MacBook Pro            | 10.10.10.55    | macOS arm64   | `813bdd161fea12ab` | Daemon                       |

**Erste echte Mesh-Nachricht** am 2026-04-08 06:59:31 UTC: MacMini → influxdb → Reply zurueck mit korrektem Threading via `in_reply_to`.

### Compliance-Bruch und Aufarbeitung

PRs #95-#102 (GitHub #73-#80) wurden ohne `pal:codereview` und ohne `pal:precommit` gemerged — die in COMPLIANCE-TABLE.md am 2026-04-06 verbindlich gemachten Regeln wurden nicht eingehalten. Aufarbeitung:
- Retroaktiver Review fuer den sicherheitskritischsten PR (#77) durch GPT-5.4 — siehe Findings oben
- Findings sofort gefixt in PR #103 (HIGH und 2 MEDIUM)
- 3 verbleibende Eintraege (#100, #101, #102) sind funktional unkritisch (Bash-Script, isolierter Code-Pfad, Bug-Fix-Patch) — in Folge-Batch-Review
- COMPLIANCE-TABLE.md aktualisiert mit neuer Gesamtstatistik (92% statt 100%)

---

## [0.30.0] — 2026-04-05 22:22 UTC

### Hinzugefuegt
- **Unix-Socket-Optimierung**: `unix-socket.ts` — Server+Client fuer Same-Host-Agents, Framed Protocol (4-Byte Length + JSON), FrameBuffer mit Max-Message-Size-Schutz, ~30% weniger Latenz als TCP
- **CLI-Adapter-Konfiguration**: `cli-adapters.ts` — Setup-Generatoren fuer Codex CLI, Gemini CLI, Claude Desktop, Claude Code
- **`thinklocal setup`-Kommando**: Konfiguriert AI-Tools (`thinklocal setup codex|gemini|claude-desktop|claude-code|all`)
- **`thinklocal remove user@host`**: Remote-Deinstallation via SSH mit `--purge` Option
- **Homebrew-Formel**: `Formula/thinklocal.rb` mit launchd-Service, 3 Binaries (thinklocal, tlmcp-daemon, tlmcp-mcp)
- **`.deb`-Paket**: `scripts/build-deb.sh` mit systemd-Service und Sicherheitshaertung
- **Docker Compose**: `docker-compose.yml` 3-Node Test-Umgebung mit eigenem Bridge-Netzwerk
- **GraphQL-Schema-Doku**: `docs/GRAPHQL-SCHEMA.md` mit Beispiel-Queries und Subscriptions
- **Release-Checksums**: SHA256SUMS.txt + Archive + .deb in GitHub Release
- **Security-Tests**: 20 Tests (Replay, TTL, ECDSA, Path-Traversal, Rate-Limit, QR-Token)
- **QR-Code Pairing**: `qr-pairing.ts` — 32-Byte Token als Alternative zur 6-stelligen PIN
- **JWT Token-Refresh**: `api-auth.ts` — `/api/auth/refresh` Endpoint

### Verbessert
- **mesh-client.ts**: Exponential Backoff (Jitter) fuer transiente HTTP-Fehler (5xx, 429)
- **graphql-api.ts**: Subscription Queue-Limit (100), Idle-Timeout (5min), Handler-Leak-Fix
- **policy.ts**: matchesPattern-Dokumentation mit Beispielen und Limitierungen
- **release.yml**: Security-Tests + .deb-Build + Archive-Checksums im CI
- **Task-Router**: Zufaelliger Tiebreak bei gleichem Score

### Tests (Neu)
- 20 Security-Tests, 13 Unix-Socket-Tests, 7 CLI-Adapter-Tests
- Gesamt: 300+ Tests

---

## [0.29.0] — 2026-04-05 20:50 UTC

### Hinzugefuegt
- **CRL (Zertifikat-Widerrufsliste)**: `crl.ts` — revoke/isRevoked/list + JSON-Persistenz
- **Deploy --with-ca**: CA-Zertifikat-Transfer fuer mTLS-Trust ueber SSH
- **Multi-Step-Task-Chains**: `task-chain.ts` — sequenzielle Ausfuehrung mit Result-Forwarding
- **Version-Kompatibilitaet**: `version-compat.ts` — Feature-Matrix + Graceful Degradation
- **Recovery-Flows**: `recovery.ts` — Auto-Recovery (Cert, Port, Hostname, DB-Integrity)
- **Threat Model**: `docs/THREAT-MODEL.md` — Angreifer-Profile, Angriffsvektoren, Trust-Grenzen
- **Entwicklerhandbuch**: `docs/DEVELOPER-GUIDE.md` — Skills, Adapter, API, Events, Policies
- **Benutzerhandbuch**: `docs/USER-GUIDE.md` — 10 Sektionen
- **Dockerfile**: Multi-Stage Build + Release-Workflow

### PRs #58-#64 (7 PRs)
- Phase 4: Task-Chains (#62), Approval-Gates + Task-Queue (#56), Skill-Dependencies (#57)
- Phase 6: Deploy CA-Transfer (#63), Recovery-Flows (#60), Version-Compat (#61)
- Docs: User-Guide + Dev-Guide + Threat-Model + Dockerfile (#58, #59)
- CRL + Vector Clocks (#64)

---

## [0.28.0] — 2026-04-05

### Hinzugefuegt
- **Benutzerhandbuch**: `docs/USER-GUIDE.md` (10 Sektionen)
- **Entwicklerhandbuch**: `docs/DEVELOPER-GUIDE.md` (Skills, Adapter, API, Events)
- **Threat Model**: `docs/THREAT-MODEL.md` (Assets, Angreifer, Vektoren, Trust-Grenzen)
- **Dockerfile**: Multi-Stage Build (node:22-slim + avahi)
- **Release-Workflow**: Automatischer GitHub Release bei v* Tags
- **Approval-Gates**: Konfigurierbare auto/approve/deny pro Skill-Pattern
- **Task-Queue**: Priorisierte Warteschlange (5 Levels, max Parallelitaet)
- **Skill-Dependencies**: checkDependencies + topologische Sortierung
- **Recovery-Flows**: Auto-Recovery fuer Cert-Expiry, Port-Konflikte, Hostname, DB-Corruption

### Statistik Tag 2 (2026-04-05)
- 23 PRs (#38-#60)
- Phase 2: KOMPLETT abgeschlossen
- Phase 3: 67% erledigt (WASM/Docker offen)
- Phase 4: 30% erledigt
- 3 Nachholreviews durchgefuehrt (1 CRITICAL Shell-Injection gefixt!)
- 5 neue Dokumentations-Dateien
- ~120 neue Tests

---

## [0.27.0] — 2026-04-05

### Phase 2 abgeschlossen
- Worker-Auslastung in Agent Card (active/completed/failed/load_percent)
- Capability-Freshness-Tracking (markStaleCapabilities)
- Coordinator-Node-Wahl (aeltester Node)
- OpenAPI 3.0.3 Spec (docs/openapi.yaml)

### Phase 3 Fortschritt (8/12 Items)
- **Credential Revocation**: revoke/isRevoked/listRevoked + revoked_credentials Tabelle
- **Brokered Access**: executeBrokered() — Proxy ohne Secret-Exposure
- **Shamir's Secret Sharing**: splitSecret/combineShares (K-von-N Threshold)
- **Skill Rollback**: Backup/Restore bei fehlgeschlagener Installation
- **Policy Verteilung + Versionierung**: exportForSync/importFromPeer/getVersion/save
- **Skill-Sandbox**: fork()-basierte Isolation mit Timeout, Memory-Limit, Netzwerk-Flag, Path-Traversal-Schutz

---

## [0.26.0] — 2026-04-05

### Hinzugefuegt
- **SemVer-Versionierung**: Leichtgewichtiges SemVer-Modul (parse, compare, range, compatible) ohne npm-Dependency
- **Task-Router**: Score-basiertes Capability-Matching (exakt +100, health +30, lokal +20, CPU +10)
- **SSH Remote-Deploy**: `thinklocal deploy user@host` mit --dry-run und --with-env

### Behoben (Nachholreviews PR #39-#51)
Retroaktive Code Reviews fuer 13 PRs die ohne Review gemergt wurden:
- **CRITICAL: Shell-Injection in keychain.ts** (GPT-5.1) — `execSync("cmd ${var}")` → `execFileSync('cmd', [args])`. Unsanitierte Parameter konnten beliebige Shell-Befehle ausfuehren!
- **HIGH: Toast Timer-Leak** (Gemini 2.5 Pro) — useEffect cleanup loeschte nur den letzten Timer. Bei schnellen Events blieben Timer aktiv. Fix: useRef Map fuer alle Timer-IDs
- **MEDIUM: JWT-Secret in Plaintext-Datei** (Gemini 2.5 Pro) — Secret wird jetzt bevorzugt im OS-Keychain gespeichert (macOS Keychain / Linux libsecret), Datei nur als Fallback
- **MEDIUM: CSS !important Overrides** (Gemini 2.5 Pro) — Desktop-first CSS Pattern, keine !important mehr
- **LOW: Schema-Cache-Hash** — SHA-256 statt truncated JSON (verhindert Cache-Kollision)
- **LOW: Audit-Dedup** — INSERT OR IGNORE changes statt separatem SELECT
- **LOW: Accessibility** — aria-label + aria-expanded auf Hamburger-Button

### Code Reviews (5 Reviews heute)
- Gemini 2.5 Pro: Dashboard UI (PR #39+#40)
- GPT-5.1: Security Review Daemon Core (PR #42-#47) — Shell-Injection gefunden!
- Gemini 2.5 Pro: GraphQL, JWT, Router, SemVer (PR #48-#51)

### Sonstiges
- **install.sh**: Node-Mindestversion auf v22 angehoben (undici braucht >=22.19)
- **PR-Checkliste**: Neue Pflicht-Checkliste in Memory-Files (Review, Precommit, Tests vor jedem Merge)

---

## [0.25.0] — 2026-04-05

### Hinzugefuegt
- **Security Docs**: Detaillierte Bedrohungsanalyse fuer Root-Compromise, Bootstrap-Trust, Prompt Injection (SECURITY.md)
- **Protocol Contract Tests**: 15 Tests fuer Wire Protocol (Envelope, Signatur, TTL, CBOR, Cross-Agent)
- **I/O Schema Validation**: @cfworker/json-schema fuer Task-Input/Output Validierung
- **AUDIT_EVENT Mesh-Sync**: peer_audit_events Tabelle fuer Mesh-weite Audit-Synchronisation
- **Adapter-Abstraktionsschicht**: MeshDaemonClient + BaseHttpMeshAdapter fuer AI-CLI-Adapter
- **Skill-Manifest-Schema**: JSON Schema mit 9 Pflichtfeldern, Permissions, Kategorien, Runtimes
- **OS-Keychain-Integration**: macOS Keychain + Linux libsecret (Shell-Out, kein native Build)
- **ESLint + Prettier**: Linting-Setup mit Flat Config

### Code Reviews (6 heute)
- GPT-5.1: Telegram Gateway, Architektur-Konsensus Deploy, Adapter-Design, Keychain-Empfehlung, Schema-Lib-Empfehlung
- Gemini 2.5 Pro: Static Peers + Gossip, Deploy Command

---

## [0.24.0] — 2026-04-05

### Hinzugefuegt
- **Dashboard Toast-Notifications**: Peer join/leave, Task complete/fail, System start/stop — auto-dismiss, max 5, slide-in Animation
- **Wire Protocol Specification v1.0**: Vollstaendige Dokumentation in `docs/WIRE-PROTOCOL.md` (Envelope, Gossip, Heartbeat, Pairing, 16 Nachrichtentypen)

---

## [0.23.0] — 2026-04-05

### Hinzugefuegt
- **SSH Remote-Deploy**: `thinklocal deploy user@host` — Deployment auf Linux-Server mit --dry-run und --with-env (Architektur-Konsensus GPT-5.1 + Gemini 2.5 Pro)
- **Dashboard Responsive**: Hamburger-Menu auf Mobile (<768px), Slide-Sidebar, Touch-Overlay

### Code Reviews
- Gemini 2.5 Pro: Deploy Command (host-match fix, ssh LogLevel, gossip response filter)
- Gemini 2.5 Pro: Static Peers + chatId + Gossip

---

## [0.22.0] — 2026-04-05

### Hinzugefuegt
- **Dashboard Dark/Light Mode**: Toggle in Sidebar, CSS-Variablen fuer beide Themes, Badge-Farben angepasst, Praeferenz in localStorage persistiert
- **Statische Peer-Liste**: Konfigurierbar in `daemon.toml` oder via `TLMCP_STATIC_PEERS` Env-Variable — ermoeglicht Mesh ueber VPN/Subnetz-Grenzen ohne mDNS
- **Telegram chatId-Persistenz**: Gespeichert in `~/.thinklocal/telegram-chat-id` — kein `/start` mehr noetig nach Daemon-Restart

### Behoben
- **Gossip Hash-Mismatch** (Code Review Gemini 2.5 Pro): Hash wird jetzt nur ueber eigene Capabilities berechnet — verhindert unnoetige Sync-Zyklen
- **Gossip Stale-Capability-Relay**: Offline-Peers werden aus Registry entfernt, Gossip sendet nur eigene Capabilities
- **Telegram Markdown V1**: Hyphens nicht mehr escaped (nur V2 braucht das)
- **Bootstrap Service-Update**: Aktualisiert bestehende launchd/systemd Services statt zu skippen
- **Static Peers**: Parallele Verbindung via Promise.allSettled + dynamisches Protokoll

### Code Reviews
- GPT-5.1: Telegram Gateway Hardening (PR #38)
- Gemini 2.5 Pro: Statische Peers + chatId + Gossip Fix

---

## [0.21.0] — 2026-04-04

### Behoben (Code Review GPT-5.1)
- **Telegram Gateway Hardening**: Markdown-Escaping, Chat-ID Allowlist (`TELEGRAM_ALLOWED_CHATS`), Rate-Limiting pro Befehl, Anchored Regex, Error-Logging, res.ok-Check, EventBus Listener Cleanup, 429 Rate-Limit Handling
- **mDNS IP-Aufloesung**: Discovery bevorzugt IPv4-Adresse aus mDNS addresses[] statt Hostname (fixt `ENOTFOUND influxdb` — bare Hostnames ohne `.local` nicht aufloesbar)
- **Service-Umgebungsvariablen**: CLI liest `.env` und fuegt TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_CHATS, INFLUXDB_* automatisch in launchd-plist und systemd-Unit ein

---

## [0.1.0] — 2026-04-03 14:30 UTC

### Hinzugefügt
- **Projektinitialisierung**: Repository-Struktur, README.md, CHANGES.md, TODO.md, CONTRIBUTING.md, SECURITY.md
- **Architektur-Entwurf**: Kombination aus MCP (Nov 2025 Spec) + A2A Agent Cards für lokale Mesh-Kommunikation
- **Sicherheitskonzept**: mTLS mit lokaler CA, TOFU-Enrollment, PKI Envelope Encryption für Credential Sharing
- **Skill-System-Spezifikation**: Portables MCP-Server-Manifest-Format für Skill-Austausch zwischen Nodes
- **Agent Card Schema**: Erweiterte A2A-kompatible Agent Card mit Health, Mesh-Status und Capability-Listen
- **Dashboard-Konzept**: Chronograf-inspirierte Visualisierung mit Topologie-Graph, Health-Panels, Skill-Marketplace
- **Bedrohungsmodell**: Dokumentation von 7 Bedrohungsszenarien mit Gegenmaßnahmen
- **Branch-Strategie**: Multi-Agenten-Workflow mit `agent/<n>/<task>` Branch-Konvention
- **Tech-Stack**: TypeScript/Node.js, React/Next.js, JSON-RPC 2.0, tweetnacl-js
- **TODO**: 6-Phasen-Implementierungsplan mit ~120 Aufgaben

### Architektur-Entscheidungen
- MCP + A2A statt Custom-Protokoll (Ökosystem-Kompatibilität, Nov 2025 Spec hat Tasks + Sampling)
- TypeScript statt Python als Hauptsprache (MCP SDK-Unterstützung, Node.js native mDNS)
- Ed25519 statt RSA (schneller, kleinere Schlüssel, moderne Kryptografie)
- TOFU statt Pre-Shared Keys (bessere UX, akzeptables Risiko im LAN)
- JSON-RPC 2.0 über HTTPS statt gRPC (MCP/A2A-kompatibel, einfacher zu debuggen)

### Multi-Modell-Konsensus (6 Modelle, Ø Confidence 7.8/10)

Einstimmig: mTLS + Zero-Trust, libp2p/mDNS Mesh, CRDT Registry, signierte Skills, Audit ab Phase 1, Human Approval Gates.

| Modell | Fokus | Confidence | Kernbeitrag |
|--------|-------|-----------|-------------|
| GPT-5.4 | Security | 8/10 | SPIFFE-Identitäten, OPA/Cedar Policy Engine, 4-Phasen-Rollout |
| Gemini 3 Pro | MCP Integration | 8/10 | Daemon als transparenter MCP-Proxy, libp2p statt Custom-Mesh |
| Claude Sonnet 4.6 | Kritische Bewertung | 7/10 | SPAKE2 Bootstrap, Shamir Secret Sharing, Human Approval Gates |
| DeepSeek R1 | Skill Exchange | 8/10 | Rust für Sandboxing, Merkle-Tree Audit, Skill-Ownership-Tokens |
| Kimi K2 | Daemon-Architektur | 8/10 | GossipSub, Protobuf-Schemas, LibSodium Sealed Boxes, ECDSA |
| GLM 4.5 | Gap-Analyse | 6/10 | MVP-first mit 3-5 Agents, Warnung vor O(n²) Registry-Wachstum |

### Recherche
- Web-Recherche zu MCP Nov 2025 Spec, A2A v0.3, ACP (IBM), ANP
- Analyse der Agent Card / Agent Discovery Muster
- Sicherheitsanalyse: MCP Tool Poisoning, Cross-Server Shadowing

---

## [0.2.0] — 2026-04-03

### Phase 1, Schritt 2+3: Node Daemon Grundgerüst + PoC

**Branch:** `agent/claude-code/phase1-daemon` | **PR:** #1

#### Hinzugefügt — Neue Module (`packages/daemon/src/`)

| Modul | Beschreibung |
|-------|-------------|
| `config.ts` | TOML-Config (`config/daemon.toml`) + Env-Override (`TLMCP_*`) mit Input-Validierung |
| `identity.ts` | ECDSA P-256 Keypair-Generierung, SPIFFE-URI, Sign/Verify |
| `audit.ts` | Append-only SQLite WAL-Log mit signierter Hash-Chain (`entry_hash` persistiert) |
| `discovery.ts` | mDNS Discovery via `bonjour-service` (`_thinklocal._tcp`) |
| `agent-card.ts` | Fastify HTTP-Server auf `/.well-known/agent-card.json` + `/health` |
| `mesh.ts` | Peer-Tracking, paralleler Heartbeat mit Overlap-Schutz |
| `index.ts` | Orchestrierung, Graceful Shutdown, Agent Card Identitäts-Verifizierung |
| `logger.ts` | Pino-basiertes strukturiertes JSON-Logging |

#### Sicherheit (nach GPT-5.4 Code Review)

- Agent Card wird nur akzeptiert wenn SPIFFE-URI + Public-Key-Fingerprint zur mDNS-Ankündigung passen
- mDNS TXT-`endpoint` wird ignoriert — Endpoint immer aus `host:port` abgeleitet
- Audit-Hash-Chain hasht alle Felder inkl. Signatur, `entry_hash` wird für Restart-Sicherheit persistiert
- Numerische Umgebungsvariablen werden als positive Ganzzahl validiert

#### Tests

- 4 Integration-Tests: Identität, Agent Cards, Peer-Discovery + Audit, Heartbeat Health-Check

#### PoC-Ergebnis

Zwei Daemon-Instanzen auf `minimac-3.local` (Ports 9440/9441) finden sich via mDNS, tauschen Agent Cards aus und halten Heartbeats aufrecht. PoC bestanden am 2026-04-03.

---

## [0.3.0] — 2026-04-03

### mTLS — Gegenseitige TLS-Authentifizierung

**Branch:** `agent/claude-code/phase1-daemon`

#### Hinzugefügt

| Modul | Beschreibung |
|-------|-------------|
| `tls.ts` | Lokale Self-Signed CA (RSA-2048, node-forge), Node-Zertifikate mit SPIFFE-URI in SAN, 90-Tage-Gültigkeit, Auto-Renewal bei <7 Tagen, Peer-Cert-Verifizierung |

#### Geändert

- `agent-card.ts`: Unterstützt jetzt HTTP und HTTPS mit `requestCert: true, rejectUnauthorized: true` für echte mTLS-Validierung
- `mesh.ts`: Heartbeat-Requests über `undici` mit custom TLS-Dispatcher für Self-Signed CA
- `index.ts`: TLS-Bundle wird automatisch erstellt, alle Peer-Kommunikation über mTLS. Abschaltbar via `TLMCP_NO_TLS=1`
- `discovery.ts`: Publiziert `proto`-Feld im mDNS TXT-Record (`http`/`https`)

#### Sicherheit (nach Gemini 2.5 Pro Code Review)

- `rejectUnauthorized: true` auf dem Server (war `false` — Client-Certs werden jetzt validiert)
- `undici` statt `node:https` für ausgehende Requests (native fetch unterstützt keine custom CA)
- Zertifikats-Private-Keys mit Dateiberechtigung `0o600`

#### Tests

- 7 neue Unit-Tests für TLS-Modul (CA-Erstellung, Cert-Validierung, SPIFFE-Extraktion, Fremd-CA-Ablehnung)
- 4 bestehende Integration-Tests weiterhin grün

---

## [0.4.0] — 2026-04-03

### CBOR Message Envelope — Signiertes Nachrichtenprotokoll

**Branch:** `agent/claude-code/phase1-daemon`

#### Hinzugefügt

| Modul | Beschreibung |
|-------|-------------|
| `messages.ts` | CBOR-basiertes Nachrichtenprotokoll mit signierten Envelopes: Correlation-ID, TTL, Idempotency-Key, ECDSA-Signatur |

#### Nachrichtentypen (Phase 1)

- `HEARTBEAT` — Lebenszeichen mit Uptime, Peer-Count, CPU-Load (TTL: 15s)
- `DISCOVER_QUERY` / `DISCOVER_RESPONSE` — Peer-Suche mit optionalem Agent-Typ-Filter
- `CAPABILITY_QUERY` / `CAPABILITY_RESPONSE` — Fähigkeiten abfragen (skill_id oder category)

#### Geändert

- `agent-card.ts`: Neuer `/message`-Endpoint für CBOR-Nachrichten mit Signaturprüfung und Content-Type-Parser für `application/cbor`

#### Tests

- 8 neue Unit-Tests: Envelope-Erstellung, CBOR Encode/Decode, Signaturverifizierung, TTL-Ablauf, Serialisierung/Deserialisierung

---

## [0.5.0] — 2026-04-03

### CRDT Capability Registry — Verteilte Fähigkeiten-Datenbank

**Branch:** `agent/claude-code/phase1-daemon`

#### Hinzugefügt

| Modul | Beschreibung |
|-------|-------------|
| `registry.ts` | Automerge-basierte CRDT-Registry für Capabilities. Register, Unregister, Suche nach skill_id/category/agent. Import/Export für Peer-Sync, Capability-Hashing, Save/Load-Persistenz |

#### Features

- `register()` / `unregister()` — Capabilities anmelden/abmelden
- `findBySkill()` / `findByCategory()` / `getAgentCapabilities()` — Suche
- `markAgentOffline()` — Alle Capabilities eines Agents als offline markieren
- `importPeerCapabilities()` / `exportCapabilities()` — Peer-Synchronisation mit Timestamp-basierter Konfliktauflösung
- `getCapabilityHash()` — SHA-256-Hash für kompakte Announcements
- `save()` / `load()` — Persistenz via Automerge Binary

#### Tests

- 9 neue Unit-Tests: Register, Unregister, Suche, Offline-Markierung, Hash-Berechnung, Peer-Import, Konflikauflösung, Save/Load

---

## [0.6.0] — 2026-04-03

### Gossip-Sync + Rate-Limiting

**Branch:** `agent/claude-code/phase1-daemon`

#### Hinzugefügt

| Modul | Beschreibung |
|-------|-------------|
| `gossip.ts` | Gossip-basierte Registry-Synchronisation: Pull-Push-Pattern, konfigurierbarer Fanout (Default: 3 Peers), 30s-Intervall, Hash-Vergleich vor Import |
| `ratelimit.ts` | Token Bucket Rate-Limiter pro Peer: 20 Tokens Burst, 2 Tokens/s Refill, automatisches Cleanup inaktiver Buckets |

#### Geändert

- `index.ts`: Registry, Gossip-Sync und Rate-Limiter vollständig integriert. Message-Handler verarbeitet REGISTRY_SYNC. Peers werden bei Offline-Markierung aus Rate-Limiter entfernt, Capabilities als offline markiert
- `messages.ts`: Neue Typen REGISTRY_SYNC / REGISTRY_SYNC_RESPONSE mit Capability-Payload

#### Tests

- 2 Gossip-Tests: Import von Peer-Capabilities, Hash-Vergleich bei Sync
- 6 Rate-Limiter-Tests: Burst-Limit, Refill, Separate Buckets, Remove, Overflow-Schutz

---

## [0.7.0] — 2026-04-03

### Security-Hardening (nach GPT-5.1 Review)

**Branch:** `agent/claude-code/phase1-daemon`

#### Hinzugefügt

| Modul | Beschreibung |
|-------|-------------|
| `replay.ts` | In-Memory Replay-Guard: Idempotency-Key pro Sender, TTL-basierte Duplikatserkennung, Auto-Cleanup |

#### Security-Fixes

- **Gossip agent_id Validation** (HIGH): `handleSyncMessage` filtert Capabilities mit fremder `agent_id` — nur Capabilities des tatsächlichen Senders werden importiert
- **Replay-Schutz** (MEDIUM): Idempotency-Key wird jetzt im `/message`-Handler geprüft, Duplikate mit HTTP 409 abgelehnt
- **Rate-Limiter auf allen Endpoints** (MEDIUM): `/.well-known/agent-card.json` und `/health` sind jetzt IP-basiert rate-limited (HTTP 429)
- **CBOR Size-Limit** (LOW): Zusätzliches 256 KB Limit für `/message` Body vor CBOR-Parsing

#### Tests

- 4 Replay-Guard-Tests + 1 Gossip-agent_id-Validierungstest

---

## [0.8.0] — 2026-04-03

### Phase 2: Task-Delegation + Dashboard REST-API

**Branch:** `agent/claude-code/phase2-tasks`

#### Hinzugefügt

| Modul | Beschreibung |
|-------|-------------|
| `tasks.ts` | Task-Manager: Lifecycle (requested→accepted→completed/failed/timeout), Correlation-ID-Tracking, Deadline mit Auto-Timeout |
| `dashboard-api.ts` | REST-API für Dashboard: GET /api/status, /api/peers, /api/capabilities, /api/tasks, /api/audit (mit CSV-Export, Filtern, Paginierung) |

#### Geändert

- `messages.ts`: Neue Typen TASK_REQUEST, TASK_ACCEPT, TASK_REJECT, TASK_RESULT

#### Tests

- 8 neue Task-Manager-Tests (Lifecycle, State-Übergänge, Correlation, Timeout)

---

## [0.9.0] — 2026-04-03

### SPAKE2 Trust-Bootstrap — PIN-basierte Peer-Authentifizierung

**Branch:** `agent/claude-code/phase1-spake2`

#### Hinzugefügt

| Modul | Beschreibung |
|-------|-------------|
| `pairing.ts` | PIN-Generierung (6-stellig), AES-256-GCM Verschlüsselung für CA-Zertifikat-Austausch, PairingStore (JSON-Persistenz mit 0o600), Key-Derivation via SHA-256 |
| `pairing-handler.ts` | Fastify-Routen: POST /pairing/start (PIN generieren), POST /pairing/init (SPAKE2 Handshake), POST /pairing/confirm (verschlüsselter CA-Austausch), GET /pairing/status |
| `types/niomon-spake2.d.ts` | TypeScript-Deklarationen für @niomon/spake2 |

#### Pairing-Flow

1. Node A: `POST /pairing/start` → generiert PIN `123456`, zeigt sie im Terminal
2. Benutzer teilt PIN an Benutzer von Node B
3. Node B: `POST /pairing/init` mit PIN + SPAKE2 Message
4. Bei gleicher PIN: Shared Secret → AES-256-GCM → CA-Zertifikate tauschen
5. Node B: `POST /pairing/confirm` mit eigenen verschlüsselten Daten
6. Beide Nodes speichern sich gegenseitig als vertrauenswürdig (PairingStore)
7. Bei falschem PIN: SPAKE2 Handshake schlägt fehl, kein Informationsleck

#### Tests

- 9 neue Tests: PIN-Generierung, Key-Derivation, AES-256-GCM Encrypt/Decrypt, falscher Schlüssel, PairingStore (Persistenz, Remove, Liste)

---

## [0.10.0] — 2026-04-03

### Dashboard UI + vollstaendige API-Integration

**Branch:** `agent/claude-code/phase2-dashboard`

#### Hinzugefuegt — Dashboard UI (`packages/dashboard-ui/`)

| View | Beschreibung |
|------|-------------|
| **Topologie** | React Flow Netzwerkgraph — eigener Node (blau) + Peers (gruen/rot), animierte Kanten fuer Online-Peers |
| **Skill-Matrix** | Tabelle Agent x Capability mit Health-Badges und Version |
| **Health** | CPU/RAM/Disk Gauges mit Farbbalken, Uptime, Peer-Count, Task-Count |
| **Pairing** | PIN-Generierung, Session-Status, Liste gepaarter Peers |
| **Audit-Log** | Event-Tabelle mit farbcodierten Typen, CSV-Export-Button |

#### Technologie

- React 19 + Vite 6 + TypeScript strict
- @xyflow/react (React Flow) fuer Topologie-Graph
- Tailwind CSS 4 fuer Styling
- Auto-Polling-Hook (5-10s Intervall)
- Vite-Proxy zu Daemon API (localhost:9440)

#### Geaendert — Daemon

- `index.ts`: TaskManager, PairingStore, Dashboard-API und Pairing-Routen vollstaendig integriert
- `agent-card.ts`: getServer() Methode fuer Plugin-Registrierung

---

## [0.11.0] — 2026-04-03

### Skill-System — Skill-Announce + Transfer zwischen Peers

**Branch:** `agent/claude-code/phase2-skills`

#### Hinzugefuegt

| Modul | Beschreibung |
|-------|-------------|
| `skills.ts` | SkillManager: Manifest-Format, lokale Skill-Registrierung, SKILL_ANNOUNCE-Handling, Transfer-Request/Response, Persistenz in JSON |

#### Features

- **Skill-Manifest**: ID, Version, Runtime (node/python/wasm/docker), Tools, Resources, Permissions, Integrity-Hash
- **SKILL_ANNOUNCE**: Peers kuendigen ihre Skills an, Remote-Skills mit Trust-Level 2 in Registry
- **SKILL_REQUEST / TRANSFER**: Transfer-Lifecycle (requested→transferring→installed/failed)
- **Lokale Persistenz**: Installierte Skills in `installed.json`
- **Registry-Integration**: Lokale Skills als Capabilities mit Trust-Level 3

#### Geaendert

- `messages.ts`: SKILL_ANNOUNCE, SKILL_REQUEST, SKILL_TRANSFER Typen
- `index.ts`: SkillManager initialisiert, SKILL_ANNOUNCE im Message-Handler

#### Tests

- 6 neue Skill-Tests: Register, Unregister, Announce, Announce-Dedup, Transfer-Request, Persistenz

---

## [0.12.0] — 2026-04-03

### WebSocket Echtzeit-Events + Live-Dashboard

**Branch:** `agent/claude-code/phase2-websocket`

#### Hinzugefuegt — Daemon

| Modul | Beschreibung |
|-------|-------------|
| `events.ts` | Zentraler MeshEventBus (EventEmitter): 16 Event-Typen (peer, task, capability, skill, audit, system) |
| `websocket.ts` | @fastify/websocket Server auf /ws: Broadcast an alle Clients, Ping/Pong (30s), Graceful Disconnect |

#### Hinzugefuegt — Dashboard

| View | Beschreibung |
|------|-------------|
| **Live-Events** | Echtzeit-Event-Feed via WebSocket mit Emoji-Icons, Auto-Reconnect, max 200 Events |
| **useWebSocket** | React-Hook: WebSocket-Verbindung mit Auto-Reconnect (3s), Event-Buffer |

#### Geaendert

- `index.ts`: EventBus initialisiert, Events bei Peer-Join/Leave emittiert
- `App.tsx`: Live-Indikator (gruen/rot) in Sidebar, neue "Live-Events"-Route
- `vite.config.ts`: WebSocket-Proxy (/ws → ws://localhost:9440)

---

## [0.13.0] — 2026-04-03

### Phase 3: Credential Vault — Verschluesselter Credential-Speicher

**Branch:** `agent/claude-code/phase3-vault`

#### Hinzugefuegt

| Modul | Beschreibung |
|-------|-------------|
| `vault.ts` | Verschluesselter Credential-Speicher: AES-256-GCM at-rest (PBKDF2 Key-Derivation), NaCl Sealed Boxes fuer Peer-Sharing, Credential-TTL mit Auto-Expiry, Tags/Kategorien, Human Approval Gate (pending/approved/denied) |

#### Features

- **Store/Retrieve**: Credentials verschluesselt speichern und abrufen
- **NaCl Sealed Boxes**: `sealForPeer()` / `unsealFromPeer()` fuer sicheren Peer-zu-Peer-Austausch
- **TTL + Auto-Expiry**: Credentials laufen nach konfigurierbarer Zeit ab
- **Approval Gate**: Anfragen fuer Credential-Zugriff mit pending/approved/denied-Workflow
- **Scoping**: Kategorien + Tags fuer feingranulaere Zugriffskontrolle
- **Zugriffs-Tracking**: Access-Count + Last-Accessed-At pro Credential

#### Tests

- 10 neue Vault-Tests: Store/Retrieve, TTL, NaCl Seal/Unseal, falscher Schluessel, Approval-Workflow

---

## [0.14.0] — 2026-04-03

### Vault-Integration — SECRET_REQUEST + Dashboard Vault-UI

**Branch:** `agent/claude-code/phase3-vault-integration`

#### Hinzugefuegt

- `SECRET_REQUEST` / `SECRET_RESPONSE` Message-Typen mit NaCl-verschluesseltem Credential-Transport
- Dashboard Vault-View: Credentials anzeigen/hinzufuegen/entfernen, Approval-Gate (genehmigen/ablehnen)
- REST-Endpoints: GET/POST/DELETE /api/vault/credentials, GET /api/vault/approvals, POST approve/deny

#### SECRET_REQUEST Flow

1. Peer sendet SECRET_REQUEST mit NaCl Public Key + Begruendung
2. Daemon erstellt Approval-Request (Human Gate)
3. Wenn Peer gepaart: Auto-Approve, Credential wird mit NaCl Sealed Box verschluesselt zurueckgegeben
4. Wenn nicht gepaart: Status "pending", Human muss im Dashboard genehmigen
5. Audit-Event bei jedem Credential-Zugriff

---

## [0.15.0] — 2026-04-03

### Agent-Detail-Ansicht + klickbare Topologie

**Branch:** `agent/claude-code/phase2-agent-detail`

- **AgentDetailView.tsx**: Drill-down-Ansicht pro Agent mit Health-Gauges (CPU/RAM/Disk), Capabilities-Liste, Audit-Events, Verbindungsdetails
- **TopologyView**: Nodes sind jetzt klickbar — Klick auf Peer navigiert zu `/agent/:agentId`
- Route: `/agent/:agentId`

---

## [0.16.0] — 2026-04-03

### MCP-Server — AI-Agent-Integration

**Branch:** `agent/claude-code/phase4-mcp-proxy`

#### Hinzugefuegt

| Modul | Beschreibung |
|-------|-------------|
| `mcp-server.ts` | In-Process MCP-Server mit 7 Tools: discover_peers, query_capabilities, get_agent_card, delegate_task, list_credentials, mesh_status, list_skills |
| `mcp-stdio.ts` | Standalone MCP-Server fuer stdio-Transport — verbindet sich mit laufendem Daemon ueber REST-API. 8 Tools inkl. store_credential, get_audit_log, start_pairing |

#### Integration in Claude Code

```json
{
  "mcpServers": {
    "thinklocal": {
      "command": "npx",
      "args": ["tsx", "packages/daemon/src/mcp-stdio.ts"],
      "env": { "TLMCP_DAEMON_URL": "http://localhost:9440" }
    }
  }
}
```

Damit kann Claude Code direkt Mesh-Funktionen nutzen: Peers entdecken, Capabilities abfragen, Tasks delegieren, Credentials verwalten.

---

## [0.17.0] — 2026-04-03

### Signierte Skill-Pakete (.tlskill)

**Branch:** `agent/claude-code/phase3-skill-packages`

- `skill-package.ts`: Erstellung, Speicherung, Verifizierung und Installation von .tlskill-Paketen
- Format: JSON-Container mit Manifest, Base64-Code, SHA-256 Integrity, ECDSA-Signatur
- Verifizierung: Format-Check, Integrity-Hash, Signatur-Pruefung, Manifest-Validierung
- Installation nur nach erfolgreicher Verifizierung
- 7 Tests: Create, Verify, Tamper Detection, Wrong Key, Save/Load, Install, Reject Tampered

---

## [0.18.0] — 2026-04-03

### CI Pipeline + CLI Tool

- `.github/workflows/ci.yml`: GitHub Actions fuer Daemon (TypeScript + Tests) und Dashboard (TypeScript + Vite Build)
- `packages/cli/src/tlmcp.ts`: CLI fuer Mesh-Verwaltung: status, peers, caps, tasks, vault, pairing, audit
- Root package.json: Neue Scripts `dashboard:dev`, `dashboard:build`, `tlmcp`

---

## [0.19.0] — 2026-04-03

### Installation, Distribution + Netzwerk-Scanner

- `scripts/install.sh`: One-Line-Installer fuer macOS/Linux — klont, installiert, richtet Service ein, konfiguriert MCP
- `scripts/deploy-remote.sh`: SSH-Deployment auf entfernte Rechner mit Node-Check
- `scripts/service/com.thinklocal.daemon.plist`: macOS launchd Service
- `scripts/service/thinklocal-daemon.service`: Linux systemd User-Service
- `scripts/service/thinklocal-daemon.ps1`: Windows Scheduled Task
- `packages/cli/src/scan-network.ts`: Netzwerk-Scanner — findet laufende Daemons, SSH-Hosts, prueft Node.js, schlaegt Deployment vor
- `INSTALL.md`: Umfassende Installationsanleitung (alle Plattformen, Claude Code, Claude Desktop, Fehlerbehebung, Deinstallation)
- `README.md`: Quick Start aktualisiert

---

## [0.20.0] — 2026-04-04

### Produktisierung + Multi-Agent-Meilenstein

**34 PRs gemergt** | 3 Code Reviews | Cross-Machine Live-getestet (macOS + macOS + Ubuntu)

#### Phase 5 — Produktisierung (PR #22-#33)

- `thinklocal` CLI: 11 Befehle (start/stop/status/doctor/bootstrap/peers/check/mcp/logs/uninstall/config)
- Automatische Service-Installation: launchd (macOS) + systemd (Linux)
- Claude Desktop + Code MCP Auto-Config (sicheres Einfuegen mit Backup)
- One-Command-Installer: `curl ... | bash` mit vollstaendiger Dependency-Pruefung
- Auto-Install: curl, git, Node.js (via nvm), npm, avahi-daemon, build-essential
- nvm-aware Node-Pfad (System-Node bleibt unangetastet)
- Dashboard als systemd Background-Service (Port 3000)
- Update/Reinstall-Modus: `curl ... | bash -s -- update`
- Security-Haertung: XML-Escaping, systemd-Quoting, atomicWrite, spawnSync
- Remote-Check: `thinklocal check host:port` prueft entfernte Daemons
- Peers mit Health-Daten (CPU/RAM/Disk/Uptime mit Farbcodes)

#### Multi-Agent-Meilenstein (PR #34)

- **Erster Remote-Agent-PR**: Claude Code auf dem Linux-Server hat eigenstaendig einen InfluxDB-Skill gebaut, getestet, committet und PR erstellt
- InfluxDB 1.x Skill: 4 Tools (query, databases, measurements, write)
- Cross-Machine Skill-Execute: Mac fragt InfluxDB auf Linux-Server ab — ueber das Mesh
- Destruktive Queries blockiert (DROP, DELETE, ALTER)

#### Drei-Node-Mesh Live-getestet

| Node | Plattform | Rolle |
|------|-----------|-------|
| minimac | macOS (ARM64) | Daemon + Dashboard + Claude Code |
| MacBook-Pro | macOS (ARM64) | Daemon + Claude Code |
| influxdb | Ubuntu 24.04 (x64) | Daemon + Dashboard + Claude Code + InfluxDB-Skill |

---

## [Unreleased]

### Geplant
- Credential-Management: GitHub Token im Vault fuer automatischen Agent-Push
- Telegram-Skill: Agent-zu-Agent-Kommunikation (User muss nicht mehr Mittelsmann sein)
- ThinkHub: Skill-Marketplace (Skills nicht im Repo, sondern in eigener Registry)
- WASM/Docker Sandbox fuer Skill-Ausfuehrung
- Vision: ThinkLocal → ThinkWide → ThinkHub → ThinkBig
- OS-Keychain-Integration
- Homebrew-Formel
