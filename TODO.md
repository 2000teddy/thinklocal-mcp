# TODO.md — thinklocal-mcp

Vollständiger Entwicklungsfahrplan, Aufgabenstruktur und Zukunftsideen.
Priorität: 🔴 Kritisch | 🟠 Hoch | 🟡 Mittel | 🟢 Niedrig | 💡 Idee/Zukunft

---

## Phase 1 — Fundament: Identität, Verschlüsselung, Discovery (Wochen 1-3)

### 1.1 Agent-Identität & Kryptografie
- [x] 🔴 ECDSA Keypair-Generierung pro Agent (P-256) — `identity.ts` (2026-04-03)
- [x] 🔴 SPIFFE-URI-Schema implementieren: `spiffe://thinklocal/host/<hostname>/agent/<type>` — `identity.ts` (2026-04-03)
- [ ] 🔴 Device-Fingerprinting für eindeutige Agent-Identifikation
- [x] 🔴 Lokale CA (Certificate Authority) — `tls.ts`, Self-Signed RSA-2048 CA (2026-04-03)
- [x] 🔴 Kurzlebige X.509-Zertifikate (90d TTL) mit Auto-Renewal bei <7 Tagen — `tls.ts` (2026-04-03)
- [ ] 🟠 Zertifikat-Widerrufsliste (CRL) oder OCSP-Stapling

### 1.2 Trust Bootstrap
- [ ] 🔴 SPAKE2 PIN-Zeremonie für Erstverbindung zweier Agents
- [ ] 🔴 PIN-Anzeige im Terminal (CLI) und Dashboard (Web)
- [ ] 🟠 QR-Code-Alternative für mobile/Desktop-Geräte
- [ ] 🟠 Fallback: Statische Peer-Liste in Konfigurationsdatei
- [ ] 🟡 Device-Pairing-Persistenz (einmal gepairt → automatisch vertraut)

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
- [ ] 🔴 CRDT-basierte verteilte Registry (Automerge)
- [ ] 🔴 Capability-Dokument-Schema (JSON Schema):
  ```json
  {
    "agent_id": "...",
    "skill_id": "influxdb.read",
    "version": "1.2.0",
    "input_schema": { ... },
    "output_schema": { ... },
    "permissions_required": ["network.local", "db.influx"],
    "health": "healthy",
    "trust_level": 3,
    "signature": "ed25519:..."
  }
  ```
- [ ] 🔴 Gossip-Synchronisation (Serf-Pattern)
- [ ] 🟠 Vector Clocks für Konfliktauflösung
- [ ] 🟠 Capability-Hashing für kompakte Announcements

### 1.5 Audit-Log (Phase 1!)
- [x] 🔴 Append-Only SQLite WAL-Log pro Agent — `audit.ts` (2026-04-03)
- [x] 🔴 Merkle-Tree-Integrität über Log-Einträge — Hash-Chain mit `entry_hash` (2026-04-03)
- [x] 🔴 Signierte Audit-Events (ed25519) — ECDSA-Signatur pro Event (2026-04-03)
- [x] 🟠 Log-Typen: PEER_JOIN, PEER_LEAVE, CAPABILITY_QUERY, TASK_DELEGATE, CREDENTIAL_ACCESS — 6 Typen implementiert (2026-04-03)
- [ ] 🟠 Log-Export (JSON/CSV) für externe Analyse

### 1.6 Nachrichtenprotokoll (Basis)
- [x] 🔴 CBOR Encoding/Decoding Library — `cbor-x` via `messages.ts` (2026-04-03)
- [x] 🔴 Message-Envelope: Correlation-ID, Deadline/TTL, Idempotency-Key, ECDSA-Signatur — `messages.ts` (2026-04-03)
- [x] 🔴 Basis-Nachrichten: HEARTBEAT, DISCOVER_QUERY, CAPABILITY_QUERY — `messages.ts` (2026-04-03)
- [ ] 🟠 Rate-Limiting (Token Bucket pro Peer)
- [ ] 🟠 Scoped Multicast (nach Capability/Topic, kein Blind Flood)

---

## Phase 2 — Kommunikation & Dashboard (Wochen 4-5)

### 2.1 Vollständiges Nachrichtenprotokoll
- [ ] 🔴 TASK_REQUEST / TASK_ACCEPT / TASK_REJECT / TASK_RESULT
- [ ] 🔴 SKILL_ANNOUNCE / SKILL_TRANSFER
- [ ] 🔴 SECRET_REQUEST (mit Human-Gate-Flag)
- [ ] 🔴 AUDIT_EVENT (Mesh-weite Synchronisation)
- [ ] 🟠 Korrelierte Request/Response-Verfolgung
- [ ] 🟠 Deadline-Propagation und Timeout-Handling
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
- [ ] 🔴 REST-Endpunkte für einfache Abfragen
- [ ] 🟠 Coordinator-Node-Wahl (Raft oder First-Node-Simple)
- [ ] 🟠 API-Authentifizierung (JWT/Session aus PIN-Zeremonie)
- [ ] 🟡 OpenAPI/Swagger-Dokumentation

### 2.4 Dashboard UI (MVP)
- [ ] 🔴 React + Vite Projekt-Setup
- [ ] 🔴 **Topologie-Ansicht** — Netzwerkgraph aller verbundenen Agents
- [ ] 🔴 **Skill-Matrix** — Tabelle: Agent × Capability mit Status
- [ ] 🔴 **Health-Gauges** — Host-Gesundheit (CPU, RAM, Disk)
- [ ] 🟠 **Agent-Detail-Ansicht** — Skills, Logs, Verbindungen pro Agent
- [ ] 🟠 Dunkler/Heller Modus
- [ ] 🟡 Responsive Design (Mobile/Tablet)
- [ ] 🟡 Notifications (Agent-Down, Skill-Transfer-Anfrage, etc.)

---

## Phase 3 — Vault & Skill-Transfer (Wochen 6-10)

### 3.1 Credential Vault
- [ ] 🔴 LibSodium Sealed Boxes für Verschlüsselung
- [ ] 🔴 Lokaler Vault-Speicher (SQLCipher)
- [ ] 🔴 OS-Keychain-Integration (macOS Keychain, GNOME Keyring)
- [ ] 🔴 **Human Approval Gate** — Dashboard-Benachrichtigung + CLI-Prompt
- [ ] 🟠 Shamir's Secret Sharing für hochwertige Credentials
- [ ] 🟠 Credential-TTL und Auto-Expiry (Standard: 24h)
- [ ] 🟠 Brokered Access — Credential-Halter proxied Anfragen statt Secrets zu teilen
- [ ] 🟡 Credential-Scope (z.B. nur lesend, nur bestimmte Tabellen)
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
- [ ] 🔴 Signierte ZIP-Pakete (.tlskill)
- [ ] 🔴 Signatur-Verifizierung (ed25519) vor Installation
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
- [ ] 🔴 ADR-Template erstellen und ersten ADR schreiben
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
- [ ] 🔴 GitHub Actions Pipeline
- [ ] 🔴 Linting (ESLint, Ruff, Prettier)
- [ ] 🟠 Docker-Image-Build und -Push
- [ ] 🟠 Automatische Release-Erstellung
- [ ] 🟡 Cross-Plattform-Tests (macOS, Linux, Windows via WSL)

### Konfiguration & Deployment
- [x] 🔴 Konfigurationsdatei-Format (TOML) — `config/daemon.toml` + `config.ts` (2026-04-03)
- [x] 🔴 Umgebungsvariablen-Unterstützung — `TLMCP_*`-Prefix mit Validierung (2026-04-03)
- [ ] 🟠 Homebrew-Formel (macOS)
- [ ] 🟠 Systemd-Service-Dateien (Linux)
- [ ] 🟡 launchd-Plist (macOS)
- [ ] 🟡 Windows-Service (optional)
- [ ] 💡 Nix-Flake für reproduzierbare Builds

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
