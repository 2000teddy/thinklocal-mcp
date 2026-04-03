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
- [ ] 🟠 Zertifikat-Widerrufsliste (CRL) oder OCSP-Stapling

### 1.2 Trust Bootstrap
- [x] 🔴 SPAKE2 PIN-Zeremonie für Erstverbindung zweier Agents — `pairing.ts` + `pairing-handler.ts` (2026-04-03)
- [x] 🔴 PIN-Anzeige im Terminal (CLI) — POST /pairing/start generiert 6-stellige PIN (2026-04-03)
- [ ] 🟠 QR-Code-Alternative für mobile/Desktop-Geräte
- [ ] 🟠 Fallback: Statische Peer-Liste in Konfigurationsdatei
- [x] 🟡 Device-Pairing-Persistenz (einmal gepairt → automatisch vertraut) — `PairingStore` in JSON-Datei (2026-04-03)

### 1.3 Mesh-Networking
- [ ] 🔴 libp2p Node.js/TypeScript Integration
- [ ] 🔴 Noise Protocol für verschlüsselte Kanäle
- [x] 🔴 mTLS über alle Verbindungen — Fastify HTTPS + undici Dispatcher mit CA (2026-04-03)
- [x] 🔴 mDNS Service Discovery (`_thinklocal._tcp.local`) — `discovery.ts` (2026-04-03)
- [x] 🔴 TXT-Records: Agent-ID, Capability-Hash, Control-Endpoint, Cert-Fingerprint — `discovery.ts` (2026-04-03)
- [ ] 🟠 Connection Multiplexing über libp2p
- [ ] 🟠 Unix-Socket-Optimierung für Same-Host-Agents
- [ ] 🟡 NAT Traversal (für VPN/Tailscale-übergreifende Mesh-Erweiterung)

### 1.4 Capability Registry
- [x] 🔴 CRDT-basierte verteilte Registry (Automerge) — `registry.ts` (2026-04-03)
- [x] 🔴 Capability-Dokument-Schema — `registry.ts` Capability-Interface (2026-04-03)
- [x] 🔴 Gossip-Synchronisation (Serf-Pattern) — `gossip.ts` Pull-Push mit Fanout (2026-04-03)
- [ ] 🟠 Vector Clocks für Konfliktauflösung — Automerge CRDT handhabt das intern
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
- [ ] 🟠 Scoped Multicast (nach Capability/Topic, kein Blind Flood)

---

## Phase 2 — Kommunikation & Dashboard (Wochen 4-5)

### 2.1 Vollständiges Nachrichtenprotokoll
- [x] 🔴 TASK_REQUEST / TASK_ACCEPT / TASK_REJECT / TASK_RESULT — `tasks.ts` + `messages.ts` (2026-04-03)
- [x] 🔴 SKILL_ANNOUNCE / SKILL_TRANSFER — `skills.ts` + Message-Handler (2026-04-03)
- [x] 🔴 SECRET_REQUEST (mit Human-Gate-Flag) — `index.ts` + `vault.ts` + Dashboard-Vault-View (2026-04-03)
- [ ] 🔴 AUDIT_EVENT (Mesh-weite Synchronisation)
- [x] 🟠 Korrelierte Request/Response-Verfolgung — `tasks.ts` correlationIndex (2026-04-03)
- [x] 🟠 Deadline-Propagation und Timeout-Handling — `tasks.ts` checkTimeouts() (2026-04-03)
- [ ] 🟡 Streaming-Responses für langdauernde Tasks

### 2.2 Health Monitoring
- [ ] 🔴 Heartbeat alle 10-30 Sekunden mit exponentieller Backoff
- [ ] 🔴 Peer als offline markieren nach 3 verpassten Heartbeats
- [ ] 🔴 Gossip-Propagation von Agent-Down-Events
- [ ] 🟠 Systemmetriken sammeln (CPU, RAM, Disk, Netzwerk)
- [ ] 🟠 Worker-Auslastung tracken
- [ ] 🟡 Zertifikat-Ablauf-Warnung
- [ ] 🟡 Capability-Freshness-Tracking

### 2.3 Dashboard API
- [ ] 🔴 Fastify HTTP-Server mit GraphQL
- [ ] 🔴 GraphQL Subscriptions für Echtzeit-Updates
- [x] 🔴 REST-Endpunkte für einfache Abfragen — `dashboard-api.ts` /api/status, peers, capabilities, tasks, audit (2026-04-03)
- [ ] 🟠 Coordinator-Node-Wahl (Raft oder First-Node-Simple)
- [ ] 🟠 API-Authentifizierung (JWT/Session aus PIN-Zeremonie)
- [ ] 🟡 OpenAPI/Swagger-Dokumentation

### 2.4 Dashboard UI (MVP)
- [x] 🔴 React + Vite Projekt-Setup — `packages/dashboard-ui/` mit Tailwind (2026-04-03)
- [x] 🔴 **Topologie-Ansicht** — React Flow Netzwerkgraph mit animierten Kanten (2026-04-03)
- [x] 🔴 **Skill-Matrix** — Tabelle: Agent x Capability mit Status-Badges (2026-04-03)
- [x] 🔴 **Health-Gauges** — CPU/RAM/Disk mit Farbbalken + Uptime/Peers/Tasks (2026-04-03)
- [x] 🟠 **Agent-Detail-Ansicht** — Skills, Health-Gauges, Audit-Events pro Agent + klickbare Topologie-Nodes (2026-04-03)
- [ ] 🟠 Dunkler/Heller Modus
- [ ] 🟡 Responsive Design (Mobile/Tablet)
- [ ] 🟡 Notifications (Agent-Down, Skill-Transfer-Anfrage, etc.)

---

## Phase 3 — Vault & Skill-Transfer (Wochen 6-10)

### 3.1 Credential Vault
- [x] 🔴 NaCl Sealed Boxes fuer Verschluesselung — `vault.ts` sealForPeer/unsealFromPeer (2026-04-03)
- [x] 🔴 Lokaler Vault-Speicher (AES-256-GCM + PBKDF2) — `vault.ts` (2026-04-03)
- [ ] 🔴 OS-Keychain-Integration (macOS Keychain, GNOME Keyring)
- [x] 🔴 **Human Approval Gate** — `vault.ts` ApprovalRequest System (2026-04-03)
- [ ] 🟠 Shamir's Secret Sharing fuer hochwertige Credentials
- [x] 🟠 Credential-TTL und Auto-Expiry — `vault.ts` ttlHours + cleanExpired() (2026-04-03)
- [ ] 🟠 Brokered Access — Credential-Halter proxied Anfragen statt Secrets zu teilen
- [x] 🟡 Credential-Scope (Tags/Kategorien) — `vault.ts` tags + category Filter (2026-04-03)
- [ ] 🟡 Revocation-Mechanismus

### 3.2 Skill-Paket-Format
- [ ] 🔴 Manifest-Schema (JSON):
  ```json
  {
    "id": "system-health-monitor",
    "version": "1.0.0",
    "description": "Monitors CPU, RAM, disk usage",
    "author_agent": "spiffe://thinklocal/host/alpha/agent/claude-code",
    "signature": "ed25519:...",
    "hash": "sha256:...",
    "runtime": "wasm|python|docker",
    "input_schema": { ... },
    "output_schema": { ... },
    "permissions": ["system.read"],
    "dependencies": [],
    "tests": ["test_health_check.py"]
  }
  ```
- [x] 🔴 Signierte Skill-Pakete (.tlskill) — `skill-package.ts` (2026-04-03)
- [x] 🔴 Signatur-Verifizierung (ECDSA) vor Installation — `verifySkillPackage()` (2026-04-03)
- [ ] 🟠 SemVer-Versionierung mit Kompatibilitätsprüfung
- [ ] 🟠 Rollback-Mechanismus bei fehlgeschlagener Installation

### 3.3 Skill-Sandboxing
- [ ] 🔴 WASM-Sandbox (Wazero oder wasmtime)
- [ ] 🔴 Docker-Container-Fallback für komplexe Skills
- [ ] 🔴 I/O-Schema-Validierung (JSON Schema) vor Ausführung
- [ ] 🟠 Ressourcen-Limits (CPU-Zeit, Speicher, Netzwerk)
- [ ] 🟠 Kein Dateisystem-Zugriff außerhalb des Skill-Verzeichnisses
- [ ] 🟡 Deno-Isolate als dritte Sandbox-Option

### 3.4 Policy Engine
- [ ] 🔴 OPA/Rego-Integration in Mesh Daemon
- [ ] 🔴 Standard-Policies: Wer darf was abfragen, installieren, teilen
- [ ] 🟠 Policy-Verteilung über Mesh (signiert)
- [ ] 🟠 Policy-Versionierung
- [ ] 🟡 Cedar als Alternative evaluieren

---

## Phase 4 — Agent-Adapter & Wachstum (Wochen 11+)

### 4.1 Agent-Adapter
- [ ] 🔴 **Adapter-Abstraktionsschicht** — stabile API gegen CLI-Tool-Änderungen
- [ ] 🔴 Claude Code Adapter (stdio MCP Proxy)
- [ ] 🟠 Codex CLI Adapter
- [ ] 🟠 Gemini CLI Adapter
- [ ] 🟠 Claude Desktop Adapter (MCP Server Registration)
- [ ] 🟡 PAL MCP Adapter
- [ ] 🟡 LangChain/LangGraph Integration
- [ ] 💡 Ollama/lokale LLM-Adapter
- [ ] 💡 VS Code Extension als Agent

### 4.2 Autonome Delegation
- [ ] 🟠 Task-Routing basierend auf Capability-Matching
- [ ] 🟠 Approval-Gate-Konfiguration (pro Task-Typ)
- [ ] 🟡 Multi-Step-Task-Chains (Agent A → Agent B → Agent C)
- [ ] 🟡 Task-Priorisierung und Queue-Management
- [ ] 💡 Lernende Delegation (basierend auf Erfolgshistorie)

### 4.3 Fortgeschrittene Features
- [ ] 🟡 QUIC-Transport-Upgrade
- [ ] 🟡 Multi-Subnet-Unterstützung
- [ ] 🟡 Supernode-Architektur für >100 Agents
- [ ] 🟡 Skill-Dependency-Resolution (wie npm/pip)
- [ ] 💡 Skill-Marketplace (lokales Registry mit Bewertungen)
- [ ] 💡 Agent-Reputation-System
- [ ] 💡 Föderierte Meshes (mehrere LANs verbinden via WireGuard/Tailscale)

---

## Übergreifende Aufgaben (alle Phasen)

### Dokumentation
- [x] 🔴 ADR-Template erstellen und ersten ADR schreiben — `docs/architecture/ADR-001-daemon-architecture.md` (2026-04-03)
- [ ] 🔴 Wire-Protokoll-Spezifikation (vollständig)
- [ ] 🟠 Threat Model & Sicherheitsdesign-Dokument
- [ ] 🟠 API-Dokumentation (OpenAPI + GraphQL Schema)
- [ ] 🟡 Benutzerhandbuch (Installation, Konfiguration, Troubleshooting)
- [ ] 🟡 Entwicklerhandbuch (eigene Adapter/Skills schreiben)

### Testing
- [x] 🔴 Unit-Test-Framework (Vitest für TS) — konfiguriert in `packages/daemon/` und Root (2026-04-03)
- [ ] 🔴 Protokoll-Contract-Tests (müssen vor Merge bestehen)
- [ ] 🟠 Integration-Tests (Multi-Node im Docker Compose)
- [ ] 🟠 Security-Tests (Fuzzing, Penetration-Szenarien)
- [ ] 🟡 Performance-Tests (Latenz, Durchsatz, Skalierung)
- [ ] 🟡 Chaos-Tests (Network Partition, Node-Ausfall)

### CI/CD & Build
- [x] 🔴 GitHub Actions Pipeline — `.github/workflows/ci.yml` (2026-04-03)
- [ ] 🔴 Linting (ESLint, Ruff, Prettier)
- [ ] 🟠 Docker-Image-Build und -Push
- [ ] 🟠 Automatische Release-Erstellung
- [ ] 🟡 Cross-Plattform-Tests (macOS, Linux, Windows via WSL)

### Konfiguration & Deployment
- [x] 🔴 Konfigurationsdatei-Format (TOML) — `config/daemon.toml` + `config.ts` (2026-04-03)
- [x] 🔴 Umgebungsvariablen-Unterstützung — `TLMCP_*`-Prefix mit Validierung (2026-04-03)
- [ ] 🟠 Homebrew-Formel (macOS)
- [x] 🟠 Systemd-Service-Dateien (Linux) — `scripts/service/thinklocal-daemon.service` (2026-04-03)
- [x] 🟡 launchd-Plist (macOS) — `scripts/service/com.thinklocal.daemon.plist` (2026-04-03)
- [x] 🟡 Windows-Service — `scripts/service/thinklocal-daemon.ps1` Scheduled Task (2026-04-03)
- [ ] 💡 Nix-Flake fuer reproduzierbare Builds

---

## Identifizierte Lücken & Risiken

### Von allen Modellen identifiziert (höchste Priorität)
- [ ] 🔴 **Prompt Injection Cascades** — Wenn ein Agent kompromittiert wird, könnte er über delegierte Tasks bösartige Prompts an andere Agents weiterleiten. Maßnahmen: Task-Content-Validierung, sandboxed Ausführung, Human Gates.
- [ ] 🔴 **Bootstrap-Trust-Problem** — Das gesamte Sicherheitsmodell bricht zusammen, wenn die initiale Peer-Authentifizierung schwach ist. SPAKE2 vor allem anderen implementieren.
- [ ] 🔴 **Root-Compromise-Limitation** — Explizit dokumentieren, dass der Mesh gegen Netzwerk-Observer und unautorisierte Peers schützt, aber NICHT gegen Root-Kompromittierung eines Endpoints.

### Von mehreren Modellen identifiziert
- [ ] 🟠 **Skill Lifecycle Management** — Ohne Garbage Collection sammeln sich veraltete Skills an. Expiry-Policies, Usage-Tracking, Deprecation-Workflow nötig.
- [ ] 🟠 **Network Partition (Split-Brain)** — CRDTs handhaben Eventual Consistency, aber aktive Tasks können timeout oder dupliziert werden. Idempotency-Keys, Partition-Erkennung, graceful Reconnection.
- [ ] 🟠 **O(n²) Registry-Wachstum** — Bei vielen Agents und Skills wächst die Gossip-Bandbreite quadratisch. Capability-Hashing, Pagination, Supernodes.
- [ ] 🟠 **Agent-Adapter-Fragilität** — CLI-Tools entwickeln sich schnell. Adapter-Abstraktionsschicht als Puffer gegen Upstream-API-Änderungen.

### Von einzelnen Modellen identifiziert
- [ ] 🟡 **Skill Sprawl** — Unkontrollierte Skill-Verbreitung wie WormGPT-Exploits vermeiden
- [ ] 🟡 **Skill-Versioning als komplexestes Subsystem** — GLM warnt, dass dies zum schwierigsten Teil werden könnte
- [ ] 🟡 **Rust für sicherheitskritische Komponenten** — DeepSeek empfiehlt Rust für Sandboxing und Vault
- [ ] 🟡 **Hardware-backed Enclaves** — Intel SGX / Apple Secure Enclave für Credential-Speicher evaluieren
- [ ] 💡 **Signal Double-Ratchet** für Key-Rotation — Kimi K2 Vorschlag
- [ ] 💡 **Protobuf statt JSON** für Capability-Schema — Kimi K2 Vorschlag (effizienter, aber weniger flexibel)

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
