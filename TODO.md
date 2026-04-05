# TODO.md — thinklocal-mcp

Vollständiger Entwicklungsfahrplan, Aufgabenstruktur und Zukunftsideen.
Priorität: 🔴 Kritisch | 🟠 Hoch | 🟡 Mittel | 🟢 Niedrig | 💡 Idee/Zukunft

---

## Phase 1 — Fundament: Identität, Verschlüsselung, Discovery (Wochen 1-3)

### 1.1 Agent-Identität & Kryptografie
- [x] 🔴 ECDSA Keypair-Generierung pro Agent (P-256) — `identity.ts` (2026-04-03)
- [x] 🔴 SPIFFE-URI-Schema implementieren: `spiffe://thinklocal/host/<hostname>/agent/<type>` — `identity.ts` (2026-04-03)
- [x] 🔴 Device-Fingerprinting für eindeutige Agent-Identifikation — `identity.ts` computeDeviceFingerprint() (2026-04-03)
- [x] 🔴 Lokale CA (Certificate Authority) — `tls.ts`, Self-Signed RSA-2048 CA (2026-04-03)
- [x] 🔴 Kurzlebige X.509-Zertifikate (90d TTL) mit Auto-Renewal bei <7 Tagen — `tls.ts` (2026-04-03)
- [x] 🟠 Zertifikat-Widerrufsliste (CRL) — `crl.ts` CertificateRevocationList (2026-04-05)

### 1.2 Trust Bootstrap
- [x] 🔴 SPAKE2 PIN-Zeremonie für Erstverbindung zweier Agents — `pairing.ts` + `pairing-handler.ts` (2026-04-03)
- [x] 🔴 PIN-Anzeige im Terminal (CLI) — POST /pairing/start generiert 6-stellige PIN (2026-04-03)
- [x] 🟠 QR-Code-Alternative für mobile/Desktop-Geräte — `qr-pairing.ts` + qrcode-terminal (2026-04-05)
- [x] 🟠 Fallback: Statische Peer-Liste in Konfigurationsdatei — `config.ts` static\_peers + TLMCP\_STATIC\_PEERS env (2026-04-05)
- [x] 🟡 Device-Pairing-Persistenz (einmal gepairt → automatisch vertraut) — `PairingStore` in JSON-Datei (2026-04-03)

### 1.3 Mesh-Networking
- [ ] 🔴 libp2p Node.js/TypeScript Integration
- [ ] 🔴 Noise Protocol für verschlüsselte Kanäle
- [x] 🔴 mTLS über alle Verbindungen — Fastify HTTPS + undici Dispatcher mit CA (2026-04-03)
- [x] 🔴 mDNS Service Discovery (`_thinklocal._tcp.local`) — `discovery.ts` (2026-04-03)
- [x] 🔴 TXT-Records: Agent-ID, Capability-Hash, Control-Endpoint, Cert-Fingerprint — `discovery.ts` (2026-04-03)
- [ ] 🟠 Connection Multiplexing über libp2p
- [x] 🟠 Unix-Socket-Optimierung für Same-Host-Agents — `unix-socket.ts` Server+Client, Framed Protocol, FrameBuffer (2026-04-05)
- [ ] 🟡 NAT Traversal (für VPN/Tailscale-übergreifende Mesh-Erweiterung)

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
- [ ] 🔴 WASM-Sandbox (Wazero oder wasmtime)
- [ ] 🔴 Docker-Container-Fallback für komplexe Skills
- [x] 🔴 I/O-Schema-Validierung (JSON Schema) vor Ausführung — `schema-validator.ts` + @cfworker/json-schema (2026-04-05)
- [x] 🟠 Ressourcen-Limits (CPU-Zeit, Speicher, Netzwerk) — `sandbox.ts` SkillSandbox mit Timeout, Memory-Limit, Netzwerk-Flag (2026-04-05)
- [x] 🟠 Kein Dateisystem-Zugriff außerhalb des Skill-Verzeichnisses — `isPathAllowed()` mit Path-Traversal-Schutz (2026-04-05)
- [ ] 🟡 Deno-Isolate als dritte Sandbox-Option

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
- [ ] 🟡 Performance-Tests (Latenz, Durchsatz, Skalierung)
- [ ] 🟡 Chaos-Tests (Network Partition, Node-Ausfall)

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
