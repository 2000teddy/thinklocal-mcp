# TODO.md — thinklocal-mcp

Vollständiger Entwicklungsfahrplan, Aufgabenstruktur und Zukunftsideen.
Priorität: 🔴 Kritisch | 🟠 Hoch | 🟡 Mittel | 🟢 Niedrig | 💡 Idee/Zukunft

---

## Code-Review beim dokumentieren entdeckt :

- [x] 🔴 **Unsicherer Vault-Default** — behoben: statt bekanntem Default wird die Vault-Passphrase jetzt aus `TLMCP_VAULT_PASSPHRASE`, OS-Keychain oder einem zufaellig generierten persistenten Wert geladen.
- [x] 🔴 **Service-Setup deaktiviert TLS standardmaessig** — geklaert und kodifiziert: lokaler Default ist jetzt explizit `localhost-only` via `runtime_mode=local`; Bind-Adresse, TLS-Verhalten und lokale Client-URL werden daraus konsistent abgeleitet. README, INSTALL und SECURITY wurden auf dieses Betriebsmodell ausgerichtet.
- [x] 🟠 **GitHub-Credentials werden im Klartext persistiert** — behoben: `GITHUB_TOKEN` wird nicht mehr automatisch in `~/.git-credentials` geschrieben; Klartextpersistenz ist jetzt nur noch ueber `TLMCP_ALLOW_PLAINTEXT_GIT_CREDENTIALS=1` moeglich.
- [x] 🟠 **Linux-Claude-Desktop-Pfad inkonsistent** — behoben: Linux nutzt jetzt konsistent `~/.config/Claude/claude_desktop_config.json`.
- [x] 🟡 **Dokumentiertes Sicherheitsniveau und Runtime-Verhalten driften auseinander** — fuer den lokalen Default behoben: Runtime, Installer und Doku beschreiben jetzt ein einheitliches localhost-only Modell. Offen bleibt die spaetere saubere mTLS-Standardisierung fuer echten Mesh-Betrieb.

## Phase 1 — Fundament: Identität, Verschlüsselung, Discovery (Wochen 1-3)

### 1.1 Agent-Identität & Kryptografie
- [x] 🔴 ECDSA Keypair-Generierung pro Agent (P-256) — `identity.ts` (2026-04-03)
- [x] 🔴 SPIFFE-URI-Schema implementieren: ursprünglich `spiffe://thinklocal/host/<hostname>/agent/<type>` — `identity.ts` (2026-04-03), umgestellt auf `host/<stableNodeId>/agent/...` in PR #74 (2026-04-07)
- [x] 🔴 Device-Fingerprinting für eindeutige Agent-Identifikation — `identity.ts` computeDeviceFingerprint() (2026-04-03)
- [x] 🔴 **Stable Node-ID** — 16-hex aus sortierten MAC-Adressen + CPU + Plattform, persistiert in `keys/node-id.txt`. Loest "Hostname-Drift" auf macOS, wo Bonjour bei Kollisionen den Namen aendert (`minimac-200` -> `-1014` -> ...) (PR #74, 2026-04-07)
- [x] 🔴 Lokale CA (Certificate Authority) — `tls.ts`, Self-Signed RSA-2048 CA (2026-04-03)
- [x] 🔴 Kurzlebige X.509-Zertifikate (90d TTL) mit Auto-Renewal bei <7 Tagen — `tls.ts` (2026-04-03)
- [x] 🟠 Zertifikat-Widerrufsliste (CRL) — `crl.ts` CertificateRevocationList (2026-04-05)

### 1.2 Trust Bootstrap
- [x] 🔴 SPAKE2 PIN-Zeremonie für Erstverbindung zweier Agents — `pairing.ts` + `pairing-handler.ts` (2026-04-03)
- [x] 🔴 PIN-Anzeige im Terminal (CLI) — POST /pairing/start generiert 6-stellige PIN (2026-04-03)
- [x] 🟠 QR-Code-Alternative für mobile/Desktop-Geräte — `qr-pairing.ts` + qrcode-terminal (2026-04-05)
- [x] 🟠 Fallback: Statische Peer-Liste in Konfigurationsdatei — `config.ts` static\_peers + TLMCP\_STATIC\_PEERS env (2026-04-05)
- [x] 🟡 Device-Pairing-Persistenz (einmal gepairt → automatisch vertraut) — `PairingStore` in JSON-Datei (2026-04-03)
- [x] 🔴 **TrustStore-Aggregation** — `trust-store.ts` baut aggregiertes CA-Bundle aus eigener CA + allen gepairten Peer-CAs, fuettert Fastify-mTLS und undici-Dispatcher (PR #75, 2026-04-07)
- [x] 🔴 **Stabile Node-Identitaet** — `loadOrCreateStableNodeId()` aus Hardware-Fingerprint statt OS-Hostname, persistiert in `~/.thinklocal/keys/node-id.txt` (PR #74, 2026-04-07)
- [x] 🔴 **CA-Subject-Disambiguation** — `createMeshCA(meshName, nodeId)` baut nodeId in CN ein, sonst koennen Peer-CAs mit gleichem Subject einander beim mTLS-Handshake ueberschreiben (PR #77, 2026-04-07)
- [x] 🟠 **SSH-Bootstrap-Trust** — `scripts/ssh-bootstrap-trust.sh` nutzt bestehenden SSH-Trust-Anchor zwischen Operator-eigenen Nodes statt PIN-Zeremonie. ssh-Reachability + base64-encoded JSON via stdin, idempotent. Fuer Single-Operator-Mesh praktischer als manuelle PINs. (PR #78, 2026-04-07)
- [ ] 🟠 **Hot-Reload TrustStore** — Aktuell muss Daemon nach neuem Pairing neu gestartet werden. Fastify `tls.createSecureContext().setSecureContext()` als Folge-Aufgabe (Phase 2)
- [ ] 🟡 **Token-basiertes Onboarding (`tlmcp init` / `tlmcp join`)** — Single-Owner-Mesh-Modus via Bearer-Token + Browser-Approval (analog Claude Code `/login`), CA-Schluessel bleibt nur auf Admin-Node (Konsensus 04-07: GPT-5.4 + Gemini Pro, beide 9/10). Geplant fuer PR #82+

### 1.3 Mesh-Networking
- [x] 🔴 libp2p Node.js/TypeScript Integration — `libp2p-runtime.ts` + Config/Agent-Card/Discovery-Integration, dual-stack neben HTTP(S) (2026-04-05)
- [x] 🔴 Noise Protocol für verschlüsselte Kanäle — libp2p Runtime nutzt `@chainsafe/libp2p-noise` fuer Peer-Sessions (2026-04-05)
- [x] 🔴 mTLS über alle Verbindungen — Fastify HTTPS + undici Dispatcher mit CA (2026-04-03)
- [x] 🔴 mDNS Service Discovery (`_thinklocal._tcp.local`) — `discovery.ts` (2026-04-03)
- [x] 🔴 TXT-Records: Agent-ID, Capability-Hash, Control-Endpoint, Cert-Fingerprint — `discovery.ts` (2026-04-03)
- [x] 🟠 Klarer Betriebsmodus für lokales `localhost-only` vs. echtes LAN-Mesh mit TLS/mTLS, CA-Trust-Bootstrap und dokumentiertem Umschaltpfad — `runtime_mode` (`local|lan`) in Config, CLI, Installer und lokalen Clients (2026-04-05)
- [x] 🟠 Connection Multiplexing über libp2p — Yamux-Multiplexer plus logische Stream-Protokolle und Stream-Statistiken in Runtime/Agent-Card (2026-04-06)
- [x] 🟠 Unix-Socket-Optimierung für Same-Host-Agents — `unix-socket.ts` Server+Client, Framed Protocol, FrameBuffer (2026-04-05)
- [x] 🟡 NAT Traversal (für VPN/Tailscale-übergreifende Mesh-Erweiterung) — AutoNAT-/Circuit-Relay-Konfiguration, Reachability-Metadaten und Relay-Assist-Status in Runtime/Agent-Card (2026-04-06)

### 1.4 Capability Registry
- [x] 🔴 CRDT-basierte verteilte Registry (Automerge) — `registry.ts` (2026-04-03)
- [x] 🔴 Capability-Dokument-Schema — `registry.ts` Capability-Interface (2026-04-03)
- [x] 🔴 Gossip-Synchronisation (Serf-Pattern) — `gossip.ts` Pull-Push mit Fanout (2026-04-03)
- [x] 🟠 Vector Clocks für Konfliktauflösung — Automerge CRDT handhabt das intern (by design)
- [x] 🟠 Capability-Hashing für kompakte Announcements — `getCapabilityHash()` (2026-04-03)

### 1.5 Audit-Log (Phase 1!)
- [x] 🔴 Append-Only SQLite WAL-Log pro Agent — `audit.ts` (2026-04-03)
- [x] 🔴 Merkle-Tree-Integrität über Log-Einträge — Hash-Chain mit `entry_hash` (2026-04-03)
- [x] 🔴 Signierte Audit-Events (ed25519) — ECDSA-Signatur pro Event (2026-04-03)
- [x] 🟠 Log-Typen: PEER_JOIN, PEER_LEAVE, CAPABILITY_QUERY, TASK_DELEGATE, CREDENTIAL_ACCESS — 6 Typen implementiert (2026-04-03)
- [x] 🟠 Log-Export (JSON/CSV) für externe Analyse — `audit.ts` exportJson()/exportCsv() (2026-04-03)

### 1.6 Nachrichtenprotokoll (Basis)
- [x] 🔴 CBOR Encoding/Decoding Library — `cbor-x` via `messages.ts` (2026-04-03)
- [x] 🔴 Message-Envelope: Correlation-ID, Deadline/TTL, Idempotency-Key, ECDSA-Signatur — `messages.ts` (2026-04-03)
- [x] 🔴 Basis-Nachrichten: HEARTBEAT, DISCOVER_QUERY, CAPABILITY_QUERY — `messages.ts` (2026-04-03)
- [x] 🟠 Rate-Limiting (Token Bucket pro Peer) — `ratelimit.ts` (2026-04-03)
- [x] 🟠 Scoped Multicast (nach Capability/Topic, kein Blind Flood) — `scoped-multicast.ts` (2026-04-05)

---

## Phase 2 — Kommunikation & Dashboard (Wochen 4-5)

### 2.1 Vollständiges Nachrichtenprotokoll
- [x] 🔴 TASK_REQUEST / TASK_ACCEPT / TASK_REJECT / TASK_RESULT — `tasks.ts` + `messages.ts` (2026-04-03)
- [x] 🔴 SKILL_ANNOUNCE / SKILL_TRANSFER — `skills.ts` + Message-Handler (2026-04-03)
- [x] 🔴 SECRET_REQUEST (mit Human-Gate-Flag) — `index.ts` + `vault.ts` + Dashboard-Vault-View (2026-04-03)
- [x] 🔴 AUDIT_EVENT (Mesh-weite Synchronisation) — `peer_audit_events` Tabelle, importPeerEvent(), getRecentForSync() (2026-04-05)
- [x] 🟠 Korrelierte Request/Response-Verfolgung — `tasks.ts` correlationIndex (2026-04-03)
- [x] 🟠 Deadline-Propagation und Timeout-Handling — `tasks.ts` checkTimeouts() (2026-04-03)
- [x] 🟡 Streaming-Responses für langdauernde Tasks — GraphQL Subscriptions decken diesen Use-Case ab (2026-04-05)

### 2.2 Health Monitoring
- [x] 🔴 Heartbeat alle 10-30 Sekunden mit exponentieller Backoff — `mesh.ts` 10s Heartbeat (2026-04-03)
- [x] 🔴 Peer als offline markieren nach 3 verpassten Heartbeats — `mesh.ts` 3 missed → offline (2026-04-03)
- [x] 🔴 Gossip-Propagation von Agent-Down-Events — EventBus `peer:leave` (2026-04-03)
- [x] 🟠 Systemmetriken sammeln (CPU, RAM, Disk, Netzwerk) — `systeminformation` in Agent Card (2026-04-03)
- [x] 🟠 Worker-Auslastung tracken — Agent Card `worker` Sektion + setWorkerStats() (2026-04-05)
- [x] 🟡 Zertifikat-Ablauf-Warnung — `getCertDaysLeft()` + Daemon-Startup-Log + EventBus (2026-04-05)
- [x] 🟡 Capability-Freshness-Tracking — `markStaleCapabilities()` + `getStaleCapabilities()` in registry.ts (2026-04-05)

### 2.3 Dashboard API
- [x] 🔴 Fastify HTTP-Server mit GraphQL — Mercurius Plugin `/graphql` + `/graphiql` (2026-04-05)
- [x] 🔴 GraphQL Subscriptions für Echtzeit-Updates — EventBus-basierter Async Generator (2026-04-05)
- [x] 🔴 REST-Endpunkte für einfache Abfragen — `dashboard-api.ts` /api/status, peers, capabilities, tasks, audit (2026-04-03)
- [x] 🟠 Coordinator-Node-Wahl (First-Node-Simple) — `coordinator.ts` aeltester Node wird Coordinator (2026-04-05)
- [x] 🟠 API-Authentifizierung (JWT) — `api-auth.ts` @fastify/jwt, localhost bypass, /api/auth/token (2026-04-05)
- [x] 🟡 OpenAPI/Swagger-Dokumentation — `docs/openapi.yaml` (2026-04-05)

### 2.4 Dashboard UI (MVP)
- [x] 🔴 React + Vite Projekt-Setup — `packages/dashboard-ui/` mit Tailwind (2026-04-03)
- [x] 🔴 **Topologie-Ansicht** — React Flow Netzwerkgraph mit animierten Kanten (2026-04-03)
- [x] 🔴 **Skill-Matrix** — Tabelle: Agent x Capability mit Status-Badges (2026-04-03)
- [x] 🔴 **Health-Gauges** — CPU/RAM/Disk mit Farbbalken + Uptime/Peers/Tasks (2026-04-03)
- [x] 🟠 **Agent-Detail-Ansicht** — Skills, Health-Gauges, Audit-Events pro Agent + klickbare Topologie-Nodes (2026-04-03)
- [x] 🟠 Dunkler/Heller Modus — CSS-Variablen Dark/Light + Toggle in Sidebar (2026-04-05)
- [x] 🟡 Responsive Design (Mobile/Tablet) — Hamburger-Menu, klappbare Sidebar, Touch-freundlich (2026-04-05)
- [x] 🟡 Notifications (Agent-Down, Skill-Transfer-Anfrage, etc.) — Toast-Notifications mit Auto-Dismiss (2026-04-05)

---

## Phase 3 — Vault & Skill-Transfer (Wochen 6-10)

### 3.1 Credential Vault
- [x] 🔴 NaCl Sealed Boxes fuer Verschluesselung — `vault.ts` sealForPeer/unsealFromPeer (2026-04-03)
- [x] 🔴 Lokaler Vault-Speicher (AES-256-GCM + PBKDF2) — `vault.ts` (2026-04-03)
- [x] 🔴 OS-Keychain-Integration (macOS Keychain, GNOME Keyring) — `keychain.ts` shell-out Wrapper, kein native Build (2026-04-05)
- [x] 🔴 **Human Approval Gate** — `vault.ts` ApprovalRequest System (2026-04-03)
- [x] 🟠 Shamir's Secret Sharing fuer hochwertige Credentials — `shamir.ts` split/combine (2026-04-05)
- [x] 🟠 Credential-TTL und Auto-Expiry — `vault.ts` ttlHours + cleanExpired() (2026-04-03)
- [x] 🟠 Brokered Access — `vault.ts` executeBrokered() proxied ohne Secret-Exposure (2026-04-05)
- [x] 🟡 Credential-Scope (Tags/Kategorien) — `vault.ts` tags + category Filter (2026-04-03)
- [x] 🟡 Revocation-Mechanismus — `vault.ts` revoke/isRevoked/listRevoked + revoked_credentials Tabelle (2026-04-05)

### 3.2 Skill-Paket-Format
- [x] 🔴 Manifest-Schema (JSON) — `skill-manifest.ts` mit JSON Schema, Validierung, Permissions-System (2026-04-05)
- [x] 🔴 Signierte Skill-Pakete (.tlskill) — `skill-package.ts` (2026-04-03)
- [x] 🔴 Signatur-Verifizierung (ECDSA) vor Installation — `verifySkillPackage()` (2026-04-03)
- [x] 🟠 SemVer-Versionierung mit Kompatibilitätsprüfung — `semver.ts` parse/compare/range/compatible (2026-04-05)
- [x] 🟠 Rollback-Mechanismus bei fehlgeschlagener Installation — `skill-rollback.ts` backup/restore (2026-04-05)

### 3.3 Skill-Sandboxing
- [x] 🔴 WASM-Sandbox (Wazero oder wasmtime) — `sandbox.ts` fuehrt `runtime=wasm` ueber `wasmtime`/WASI mit isoliertem `--dir`, Timeout und `SKILL_INPUT_BASE64`-Contract aus (2026-04-06)
- [x] 🔴 Docker-Container-Fallback für komplexe Skills — `sandbox.ts` fuehrt `runtime=docker` read-only mit `docker run`, Memory-/PID-Limits, optional gesperrtem Netzwerk und `SKILL_INPUT_BASE64` aus (2026-04-06)
- [x] 🔴 I/O-Schema-Validierung (JSON Schema) vor Ausführung — `schema-validator.ts` + @cfworker/json-schema (2026-04-05)
- [x] 🟠 Ressourcen-Limits (CPU-Zeit, Speicher, Netzwerk) — `sandbox.ts` SkillSandbox mit Timeout, Memory-Limit, Netzwerk-Flag (2026-04-05)
- [x] 🟠 Kein Dateisystem-Zugriff außerhalb des Skill-Verzeichnisses — `isPathAllowed()` mit Path-Traversal-Schutz (2026-04-05)
- [x] 🟡 Deno-Isolate als dritte Sandbox-Option — `sandbox.ts` fuehrt `runtime=deno` mit `deno run --no-prompt`, expliziten `--allow-*`-Flags und lokalem `DENO_DIR` im Skill-Verzeichnis aus (2026-04-07)

### 3.4 Policy Engine
- [x] 🔴 Policy Engine (leichtgewichtig statt OPA/Rego) — `policy.ts` mit JSON-Policies, deny-by-default (2026-04-05)
- [x] 🔴 Standard-Policies: skill.execute (allow), credential.share (approval), skill.install (approval) (2026-04-05)
- [x] 🟠 Policy-Verteilung über Mesh — exportForSync/importFromPeer in policy.ts (2026-04-05)
- [x] 🟠 Policy-Versionierung — getVersion() SHA-256 Hash + save() (2026-04-05)
- [ ] 🟡 Cedar als Alternative evaluieren

---

## Phase 4 — Agent-Adapter & Wachstum (Wochen 11+)

### 4.1 Agent-Adapter
- [x] 🔴 **Adapter-Abstraktionsschicht** — `mesh-client.ts` + `mesh-adapter.ts` BaseHttpMeshAdapter (2026-04-05)
- [x] 🔴 Claude Code Adapter (stdio MCP Proxy) — `mcp-stdio.ts` mit 13+ Tools (2026-04-04)
- [x] 🟠 Codex CLI Adapter — `cli-adapters.ts` setupCodexCli() + `thinklocal setup codex` (2026-04-05)
- [x] 🟠 Gemini CLI Adapter — `cli-adapters.ts` setupGeminiCli() + `thinklocal setup gemini` (2026-04-05)
- [x] 🟠 Claude Desktop Adapter (MCP Server Registration) — `cli-adapters.ts` setupClaudeDesktop() (2026-04-05)
- [ ] 🟡 PAL MCP Adapter
- [ ] 🟡 LangChain/LangGraph Integration
- [ ] 💡 Ollama/lokale LLM-Adapter
- [ ] 💡 VS Code Extension als Agent

### 4.2 Autonome Delegation
- [x] 🟠 Task-Routing basierend auf Capability-Matching — `task-router.ts` mit Score-System (2026-04-05)
- [x] 🟠 Approval-Gate-Konfiguration (pro Task-Typ) — `approval-gates.ts` auto/approve/deny per Skill-Pattern (2026-04-05)
- [x] 🟡 Multi-Step-Task-Chains (Agent A → Agent B → Agent C) — `task-chain.ts` executeChain() (2026-04-05)
- [x] 🟡 Task-Priorisierung und Queue-Management — `task-queue.ts` priorisierte Queue mit max Parallelitaet (2026-04-05)
- [ ] 💡 Lernende Delegation (basierend auf Erfolgshistorie)

### 4.4.2 Agent Session Persistence & Crash Recovery (Proposed, siehe ADR-006)

- [ ] 🔴 **ADR-006 Session Persistence** — Design-Doku in `docs/architecture/ADR-006-session-persistence.md`. Grund: LLM-CLI-Agenten verlieren bei Token-Exhaustion/Crash/Stromausfall ihren gesamten Kontext; manueller Wiedereinstieg dauert 5-15min. Loesung (Konsensus GPT-5.4 + Gemini 2.5 Pro, je 8/10): Daemon-external-Watcher + SQLite Event-Store als Single Source of Truth, Markdown als derived views, daemon-injizierte SESSION_ID, strukturierte HISTORY.md + async LLM-START-PROMPT.md, atomic temp+rename.
- [ ] 🔴 **Phase 1 MVP** — `atomic-write.ts`, `session_events` SQLite Schema, `ClaudeCodeAdapter`, `session-watcher.ts` (fs.watch + chokidar), `recovery-generator.ts` (deterministisch), `session-binding.ts` (orphan-scan + fingerprint).
- [ ] 🟠 **Phase 2 Multi-Agent** — `CodexAdapter`, `GeminiCliAdapter`, async START-PROMPT.md via `pal:chat`, MCP-Tools `session.list/resume/dump`, User-Doku `docs/SESSION-RECOVERY.md`.
- [ ] 🟡 **Phase 3 Curation + Security** — `MEMORY.md` Curation-Policy, Redaction-Filter, Retention + `session.purge`, Prompt-Injection-Markierung.
- [ ] 🔵 **Phase 4 DEFER** — Encrypted Recovery-Capsule fuer cross-machine failover (nur wenn realer Use-Case auftaucht).

### 4.4.1 Cron-Heartbeat + Per-Agent-Inbox (Proposed, siehe ADR-004, ADR-005)

- [ ] 🔴 **ADR-004 Cron-Heartbeat** — Design-Doku in `docs/architecture/ADR-004-cron-heartbeat.md`. Grund: LLM-Agenten lernen keine "check inbox"-Pattern durch Iteration; nur externe Scheduler/Hooks erzwingen das Verhalten. Phase 1: per-CLI Cron via `CronCreate` (Claude) und aequivalenter Codex-Scheduler. Phase 2: Daemon Register/Heartbeat-Endpoints. Phase 3: WebSocket-Push als Ergaenzung. Phase 4: Regel-Check (Compliance) im Heartbeat-Prompt.
- [ ] 🔴 **ADR-005 Per-Agent-Inbox** — `to_agent_instance` Spalte in SQLite, SPIFFE-URI um `/instance/<id>` erweitert, `POST /api/agent/register` + `unregister`, `read_inbox` filtert automatisch nach registrierter Instance. Grund: Ein Peer kann mehrere Agents hosten (Claude + Codex + Gemini), die aktuelle Per-Daemon-Inbox macht Privacy zwischen Agents unmoeglich.
- [ ] 🟠 **Adaptive Cron-Intervall** — exponential backoff bei leerer Inbox (5s → 30s), sofort zurueck auf 5s nach Event. Konfiguration pro Mesh-Modus (local/lan/federated/adhoc).
- [ ] 🟠 **Compliance-Regel-Check im Heartbeat** — COMPLIANCE-TABLE.md wird bei jedem Heartbeat gescannt, bei offenen Eintraegen ohne CO/CG/CR/PC/DO schreibt der Cron eine Reminder-Nachricht in die eigene Inbox.
- [ ] 🟡 **Broadcast-Pattern** — `send_message_to_peer(to="spiffe://.../instance/*")` fanout an alle aktiven Instances auf einem Host. Fuer Announcements und System-Events.
- [ ] 🟡 **WebSocket-Push als Komplement** — `inbox:new` EventBus + WebSocket-Broadcast, MCP-Stdio-Subprocess haelt optional Subscription, schreibt in Memory-Buffer der beim naechsten Cron-Pull ausgewertet wird.
- [ ] 🟡 **`unregister` on graceful shutdown** — MCP-Stdio verwendet `process.on('exit', ...)` um sich beim Daemon abzumelden. Mitigation gegen "stale agent instances" die nie aufraeumen.

### 4.4 Agent-zu-Agent Messaging (Inbox)
- [x] 🔴 **Persistente Inbox pro Daemon** — `agent-inbox.ts` SQLite WAL, 64KB Body-Limit, Dedupe via UUID, soft read/archive (PR #79, 2026-04-08)
- [x] 🔴 **AGENT_MESSAGE Wire-Type** — `messages.ts` AgentMessagePayload + AgentMessageAckPayload, signiert via Mesh-Envelope (PR #79, 2026-04-08)
- [x] 🔴 **Inbox-API REST-Endpoints** — `inbox-api.ts` POST /api/inbox/send, GET /api/inbox, mark-read, archive, unread (PR #79, 2026-04-08)
- [x] 🔴 **MCP-Tools** — send_message_to_peer, read_inbox, mark_message_read, archive_message, unread_messages_count in `mcp-stdio.ts` (PR #79, 2026-04-08)
- [x] 🟠 **Loopback fuer Sibling-Agents** — Wenn `to === ownAgentId` (mehrere Agenten teilen einen Daemon), wird die Nachricht direkt im lokalen Inbox abgelegt statt ueber Netzwerk geroutet (PR #80, 2026-04-08)
- [ ] 🟠 **ACK-Signaturpruefung beim Sender** — aktuell wird nur HTTP 2xx ausgewertet. Phase 2: Peer-PublicKey-Lookup + decode AGENT_MESSAGE_ACK Envelope
- [ ] 🟠 **WebSocket-Push** fuer Inbox-Events statt Polling — `websocket.ts` existiert bereits, einfacher Anschluss
- [ ] 🟡 **Per-Peer ACL** beim Senden — aktuell darf jeder paired peer schreiben
- [ ] 🟡 **Rate-Limiting** auf `/api/inbox/send` — global existiert auf `/message`, fehlt fuer outbound
- [ ] 💡 **Threading** ueber `in_reply_to` hinaus — Conversation-View, mehrere Teilnehmer

### 4.3 Fortgeschrittene Features
- [ ] 🟡 QUIC-Transport-Upgrade
- [ ] 🟡 Multi-Subnet-Unterstützung
- [ ] 🟡 Supernode-Architektur für >100 Agents
- [x] 🟡 Skill-Dependency-Resolution (wie npm/pip) — `skill-deps.ts` checkDependencies + topologische Sortierung (2026-04-05)
- [ ] 💡 Skill-Marketplace (lokales Registry mit Bewertungen)
- [ ] 💡 Agent-Reputation-System
- [ ] 💡 Föderierte Meshes (mehrere LANs verbinden via WireGuard/Tailscale)

---

## Phase 5 — Produktisierung: "Install once, it just works" (Konsensus: GPT-5.4 + Gemini 2.5 Pro + GPT-5.1)

> Ergebnis des Multi-Modell-Konsensus vom 2026-04-04. Alle 3 Modelle einig: CLI + Daemon-Management ZUERST, dann Claude-Integration, SSH-Deploy auf v2.

### 5.1 `thinklocal` CLI + Daemon-Management
- [x] 🔴 Globale CLI: `thinklocal start`, `stop`, `status`, `restart`, `logs`, `doctor` — `thinklocal.ts` 12+ Befehle (2026-04-04)
- [x] 🔴 `thinklocal bootstrap` — Ersteinrichtung: Keys, Config, Service, MCP, Credentials (2026-04-04)
- [x] 🔴 `thinklocal doctor` — Diagnostik: Daemon, Keys, Certs, Peers, MCP, Ports (2026-04-04)
- [x] 🟠 `thinklocal peers` — Verbundene Peers anzeigen (2026-04-04)
- [x] 🟠 `thinklocal config show/edit/validate` — `config show` implementiert (2026-04-04)
- [x] 🟠 Saubere, menschenlesbare Ausgabe (kein JSON-Log-Spam im Terminal) — Farbige CLI-Ausgabe (2026-04-04)

### 5.2 One-Command Install + System-Service
- [x] 🔴 macOS: `curl ... | bash` — installiert Daemon + CLI + launchd Service (2026-04-04)
- [x] 🔴 Linux: Install-Script mit systemd User-Service + avahi-daemon (2026-04-04)
- [x] 🔴 Installer registriert launchd/systemd Service automatisch (2026-04-04)
- [x] 🟠 Uninstaller: `thinklocal uninstall` — Service entfernen, Config behalten (2026-04-04)
- [x] 🟠 Sensible Defaults: mDNS auto-discovery, Keys auto-generieren, MCP auto-konfigurieren (2026-04-04)
- [x] 🟠 Homebrew-Formel (macOS) — `Formula/thinklocal.rb` mit launchd-Service, 3 Binaries (2026-04-05)

### 5.3 Claude Desktop MCP Integration
- [x] 🔴 `thinklocal mcp config --claude-desktop` — generiert JSON-Block (2026-04-04)
- [x] 🔴 `thinklocal mcp config --claude-code` — generiert ~/.mcp.json (2026-04-04)
- [x] 🔴 Lokale MCP Bridge: `mcp-stdio.ts` mit 13+ Tools (2026-04-04)
- [x] 🟠 Auto-Detection: Installer findet Claude Config und fuegt thinklocal hinzu (2026-04-04)
- [ ] 🟡 Dokumentation: Schritt-fuer-Schritt mit Screenshots

### 5.4 Claude Code Terminal Integration
- [x] 🔴 `thinklocal init` — schreibt .mcp.json ins aktuelle Projekt (2026-04-04)
- [x] 🟠 Globale ~/.mcp.json wird automatisch bei `thinklocal bootstrap` erstellt (2026-04-04)
- [x] 🟡 Verifizierung: Claude Code nutzt Mesh-Tools direkt (getestet 2026-04-04)

### 5.5 Linux Support (Ubuntu/Debian)
- [x] 🔴 Install-Script mit Plattform-Erkennung (macOS/Linux) — `scripts/install.sh` (2026-04-04)
- [x] 🔴 systemd User-Service mit gleicher UX wie macOS — inkl. enable-linger (2026-04-04)
- [x] 🟠 `.deb`-Paket fuer apt-Installation — `scripts/build-deb.sh` + systemd-Service + Sicherheits-Haertung (2026-04-05)
- [x] 🟡 Docker-Image als Alternative — `docker-compose.yml` 3-Node-Setup mit Static-Peers + eigenem Netzwerk (2026-04-05)

### 5.6 Distribution + Auto-Update
- [x] 🟠 Homebrew-Formel (macOS) — `Formula/thinklocal.rb` mit launchd-Service, 3 Binaries (2026-04-05)
- [ ] 🟠 Auto-Update-Mechanismus (Sparkle fuer App, npm fuer CLI)
- [x] 🟡 Signierte Releases (checksums, GPG) — SHA256SUMS.txt + Release-Archive + .deb in GitHub Release (2026-04-05)

---

## Phase 6 — Native Experience + Remote-Deployment

### 6.1 Swift MenuBar App (macOS)
- [ ] 🟠 SwiftUI MenuBarExtra als duenne Shell ueber Daemon-API
- [ ] 🟠 Status-Icon: gruen (Mesh aktiv), gelb (keine Peers), rot (Daemon offline)
- [ ] 🟠 Quick-Actions: Start/Stop, Peers anzeigen, Dashboard oeffnen, Logs anzeigen
- [x] 🟡 Pairing per Klick (PIN anzeigen/eingeben) — PairingView.tsx: 6-stellige PIN-Eingabe mit Auto-Focus, Auto-Submit, Fehler-Feedback (2026-04-05)
- [ ] 🟡 Sparkle Auto-Update + notarisiertes .dmg
- [ ] 💡 Architektur wie OpenClaw: Swift App startet/steuert Node.js Daemon als Subprocess

### 6.2 SSH-basiertes Remote-Deployment (v2, opt-in)
- [x] 🟠 `thinklocal deploy user@host` — SSH-Deploy mit Dry-Run, .env-Transfer, Mesh-Join-Check (2026-04-05)
- [x] 🟠 SSH-Key-Austausch: SSH-basierter Deploy nutzt key-based auth (BatchMode) (2026-04-05)
- [x] 🟠 Lokale CA signiert Mesh-Zertifikate fuer Remote-Nodes — `--with-ca` Flag im Deploy (2026-04-05)
- [x] 🟡 Dry-Run-Modus: `thinklocal deploy --dry-run` zeigt alle Schritte — bereits in cmdDeploy implementiert (2026-04-05)
- [x] 🟡 `thinklocal remove user@host` — Remote-Deinstallation mit --purge Option (2026-04-05)
- [ ] 💡 Netzwerk-Scanner schlaegt Deployment-Ziele vor

### 6.3 Fehlende Infrastruktur (Konsensus-Findings)
- [x] 🔴 Diagnostik: `thinklocal doctor` (Daemon, Keys, Peers, MCP, Certs, Ports) (2026-04-04)
- [x] 🟠 Recovery-Flows: abgelaufene Certs, Port-Konflikte, umbenannte Hosts — `recovery.ts` runRecoveryChecks() (2026-04-05)
- [x] 🟠 Versioning: Kompatibilitaetsmatrix, graceful Degradation — `version-compat.ts` + FEATURE_MATRIX (2026-04-05)
- [x] 🟡 Security-Lifecycle: Cert-Rotation, Revocation, Trust-Reset — `cert-rotation.ts` + `crl.ts` (2026-04-05)
- [x] 🟡 Benutzerfreundliche Fehlermeldungen statt Stack-Traces — Farbige CLI-Ausgabe (2026-04-04)

---

## Uebergreifende Aufgaben (alle Phasen)

### Dokumentation
- [x] 🔴 ADR-Template erstellen und ersten ADR schreiben — `docs/architecture/ADR-001-daemon-architecture.md` (2026-04-03)
- [x] 🔴 Wire-Protokoll-Spezifikation (vollständig) — `docs/WIRE-PROTOCOL.md` (2026-04-05)
- [x] 🟠 Threat Model & Sicherheitsdesign-Dokument — `docs/THREAT-MODEL.md` (2026-04-05)
- [x] 🟠 API-Dokumentation (OpenAPI + GraphQL Schema) — `docs/openapi.yaml` + `docs/GRAPHQL-SCHEMA.md` (2026-04-05)
- [x] 🟡 Benutzerhandbuch (Installation, Konfiguration, Troubleshooting) — `docs/USER-GUIDE.md` 10 Sektionen (2026-04-05)
- [x] 🟡 Entwicklerhandbuch (eigene Adapter/Skills schreiben) — `docs/DEVELOPER-GUIDE.md` (2026-04-05)

### Testing
- [x] 🔴 Unit-Test-Framework (Vitest für TS) — konfiguriert in `packages/daemon/` und Root (2026-04-03)
- [x] 🔴 Protokoll-Contract-Tests (müssen vor Merge bestehen) — 15 Tests in `protocol-contract.test.ts` (2026-04-05)
- [x] 🟠 Integration-Tests (Multi-Node im Docker Compose) — `tests/integration/two-nodes.test.ts` (2026-04-03)
- [x] 🟠 Security-Tests (Fuzzing, Penetration-Szenarien) — 20 Tests: Replay, TTL, ECDSA, Path-Traversal, Rate-Limit, QR-Token, Input-Sanitisierung (2026-04-05)
- [x] 🟡 Performance-Tests (Latenz, Durchsatz, Skalierung) — 9 Benchmarks: ECDSA 15k/s, SHA256 992k/s, PatternMatch 4.3M/s, MapLookup 99M/s (2026-04-05)
- [x] 🟡 Chaos-Tests (Network Partition, Node-Ausfall) — 12 Tests: Split-Brain, Rapid Rejoin, Gossip-Storm, Heartbeat-Verlust, Multi-Ausfall (2026-04-05)

### CI/CD & Build
- [x] 🔴 GitHub Actions Pipeline — `.github/workflows/ci.yml` (2026-04-03)
- [x] 🔴 Linting (ESLint + Prettier) — eslint.config.js + .prettierrc + npm run lint/format (2026-04-05)
- [x] 🟠 Docker-Image-Build und -Push — Dockerfile Multi-Stage + .dockerignore (2026-04-05)
- [x] 🟠 Automatische Release-Erstellung — `.github/workflows/release.yml` bei Tags (2026-04-05)
- [ ] 🟡 Cross-Plattform-Tests (macOS, Linux, Windows via WSL)

### Konfiguration & Deployment
- [x] 🔴 Konfigurationsdatei-Format (TOML) — `config/daemon.toml` + `config.ts` (2026-04-03)
- [x] 🔴 Umgebungsvariablen-Unterstützung — `TLMCP_*`-Prefix mit Validierung (2026-04-03)
- [x] 🟠 Homebrew-Formel (macOS) — `Formula/thinklocal.rb` mit launchd-Service, 3 Binaries (2026-04-05)
- [x] 🟠 Systemd-Service-Dateien (Linux) — `scripts/service/thinklocal-daemon.service` (2026-04-03)
- [x] 🟡 launchd-Plist (macOS) — `scripts/service/com.thinklocal.daemon.plist` (2026-04-03)
- [x] 🟡 Windows-Service — `scripts/service/thinklocal-daemon.ps1` Scheduled Task (2026-04-03)
- [ ] 💡 Nix-Flake fuer reproduzierbare Builds

---

## Identifizierte Lücken & Risiken

### Von allen Modellen identifiziert (höchste Priorität)
- [x] 🔴 **Prompt Injection Cascades** — Detaillierte Bedrohungsanalyse + Mitigationen in SECURITY.md (2026-04-05)
- [x] 🔴 **Bootstrap-Trust-Problem** — Dokumentiert inkl. implementierte + geplante Mitigationen (2026-04-05)
- [x] 🔴 **Root-Compromise-Limitation** — Explizit dokumentiert als Out-of-Scope mit Begruendung (2026-04-05)

### Von mehreren Modellen identifiziert
- [x] 🟠 **Skill Lifecycle Management** — `skill-lifecycle.ts` Expiry, Usage-Tracking, Deprecation, GC (2026-04-05)
- [x] 🟠 **Network Partition (Split-Brain)** — `partition-detector.ts` Erkennung + graceful Reconnection (2026-04-05)
- [x] 🟠 **O(n²) Registry-Wachstum** — Mitigiert durch: Gossip nur eigene Caps senden, Hash-Vergleich vor Sync, Stale-Cleanup, Scoped Multicast (2026-04-05)
- [x] 🟠 **Agent-Adapter-Fragilität** — Geloest durch BaseHttpMeshAdapter + MeshDaemonClient Abstraktionsschicht (2026-04-05)

### Von einzelnen Modellen identifiziert
- [ ] 🟡 **Skill Sprawl** — Unkontrollierte Skill-Verbreitung wie WormGPT-Exploits vermeiden
- [ ] 🟡 **Skill-Versioning als komplexestes Subsystem** — GLM warnt, dass dies zum schwierigsten Teil werden könnte
- [ ] 🟡 **Rust für sicherheitskritische Komponenten** — DeepSeek empfiehlt Rust für Sandboxing und Vault
- [ ] 🟡 **Hardware-backed Enclaves** — Intel SGX / Apple Secure Enclave für Credential-Speicher evaluieren
- [ ] 💡 **Signal Double-Ratchet** für Key-Rotation — Kimi K2 Vorschlag
- [ ] 💡 **Protobuf statt JSON** für Capability-Schema — Kimi K2 Vorschlag (effizienter, aber weniger flexibel)

### Erkenntnisse aus Nachholreviews (2026-04-05)
- [x] 🟠 **GraphQL Resolver Error-Handling** — throw Error() statt leere Arrays (2026-04-05)
- [x] 🟠 **JWT Token-Refresh** — /api/auth/refresh Endpoint (2026-04-05)
- [x] 🟠 **SemVer Prerelease-Vergleich** — Spec-konformer Vergleich (numerisch + lexikographisch) (2026-04-05)
- [x] 🟡 **Task-Router Tie-Breaking** — Zufalls-Tiebreaker bei gleichem Score (2026-04-05)
- [x] 🟡 **GraphQL Subscription Cleanup** — Queue-Limit (100), Idle-Timeout (5min), alive-Flag gegen Handler-Leak (2026-04-05)
- [x] 🟡 **mesh-client.ts Retry-Logik** — Exponential Backoff mit Jitter, transiente Fehler (5xx, 429, Netzwerk), max 3 Retries (2026-04-05)
- [x] 🟡 **Policy-Pattern Dokumentation** — matchesPattern JSDoc mit Beispielen und expliziter "NICHT unterstuetzt"-Sektion (2026-04-05)

---

## Zukunftsideen (Post-MVP)

- [ ] 💡 **Natürliche-Sprache-Queries** — "Hat jemand im Netzwerk eine Datenbank?" statt strukturierter Capability-Abfragen
- [ ] 💡 **Automatische Skill-Erstellung** — Agent erkennt Bedarf und erstellt neuen Skill on-the-fly
- [ ] 💡 **Cross-Mesh-Kommunikation** — Mehrere LANs über sichere Tunnel (WireGuard/Tailscale) verbinden
- [ ] 💡 **Skill-Bewertungssystem** — Agents bewerten Skill-Qualität nach Nutzung
- [ ] 💡 **Ressourcen-Scheduling** — GPU-Tasks automatisch an GPU-Hosts delegieren
- [ ] 💡 **Conversation History Sharing** — Kontexttransfer zwischen Agents für nahtlose Übergabe
- [ ] 💡 **Webhooks / Event-Subscriptions** — Externe Systeme bei Mesh-Events benachrichtigen
- [ ] 💡 **InfluxDB/Prometheus-Integration** — Mesh-Metriken in bestehende Monitoring-Stacks exportieren
- [ ] 💡 **Mobile App** — Mesh-Dashboard und Approval-Gates auf dem Smartphone
- [ ] 💡 **Voice-Aktivierung** — Mesh-Befehle per Sprache ("Hey Mesh, wer hat InfluxDB?")
- [ ] 💡 **A/B-Testing für Skills** — Verschiedene Skill-Versionen parallel testen
- [ ] 💡 **Mesh-Backup/Restore** — CA-Material, Registry-Snapshots, Policy-Bundles sichern
- [ ] 💡 **Compliance-Modus** — Regulatorische Anforderungen (DSGVO, HIPAA) über Policy-Engine abbilden
- [ ] 💡 **Eingebettete AI-Modelle** — Kleine lokale Modelle (Ollama/MiniMax/GLM) fuer:
  - Intelligente Fehler-Diagnose (`thinklocal doctor --ai`)
  - Natuerliche-Sprache-Queries ("Hat jemand eine Datenbank?")
  - Automatische Skill-Erstellung on-the-fly
  - Kontext-Transfer-Zusammenfassung zwischen Agents
- [x] 🔴 **Credential-Management** — .env Import + Git Auto-Config + Vault-Speicherung (2026-04-04)
- [x] 🔴 **Telegram Gateway** — Bot-Monitoring mit 6 Befehlen + Event-Bridge, Chat-ID Allowlist (2026-04-05)
- [ ] 💡 **ThinkHub** — Skill-Marketplace/Registry (wie ClawHub) statt Skills im Repo
- [ ] 💡 **ThinkWide** — Mehrere LANs verbinden (WireGuard/Tailscale)
- [ ] 💡 **ThinkBig** — ThinkLocal + ThinkWide + ThinkHub zusammengefuehrt
