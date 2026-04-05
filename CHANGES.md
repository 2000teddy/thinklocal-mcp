# Changelog

Alle relevanten Änderungen an diesem Projekt werden hier dokumentiert.
Format: [Keep a Changelog](https://keepachangelog.com/de/1.0.0/).

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
