# CLAUDE.md — Eingangsprompt für Claude Code

## Projekt: thinklocal-mcp

Verschlüsselte Peer-to-Peer-Kommunikation zwischen AI CLI Agenten im lokalen Netzwerk.

## Arbeitsverzeichnis

```
~/Entwicklung_local/thinklocal-mcp
```

Dieses Verzeichnis ist bereits angelegt mit vollständiger Projektstruktur, Dokumentation und Architektur-Spezifikation. Lies zuerst README.md, TODO.md und SECURITY.md komplett durch, bevor du mit der Implementierung beginnst.

## Kontext

Die Architektur wurde durch einen Multi-Modell-Konsensus (GPT-5.4, Gemini 3 Pro, Claude Sonnet 4.6, DeepSeek R1, Kimi K2, GLM 4.5) entworfen. Details in CHANGES.md. Der Konsensus war einstimmig bei den Kernentscheidungen:
- mTLS + Zero-Trust (dem LAN nicht vertrauen)
- libp2p für Mesh-Networking
- MCP als Proxy-Interface (Daemon als transparenter MCP-Proxy)
- CRDT-basierte Capability Registry (Automerge)
- Signierte + sandboxed Skills (WASM/Docker)
- Audit-Log ab Phase 1 (nicht nachrüsten!)
- Human Approval Gates für Credential Sharing und Skill Transfer

## Aufgabe: Phase 1 — Schritte 1 bis 3

### Schritt 1: Git-Repository initialisieren und auf GitHub pushen

```bash
cd ~/Entwicklung_local/thinklocal-mcp
chmod +x init-repo.sh
./init-repo.sh
```

Das Skript erstellt ein privates GitHub-Repo via `gh` CLI, commitet und pusht. Danach:
- Branch Protection für `main` einrichten (Settings → Branches → Add rule)
- Eigenen Arbeitsbranch erstellen: `git checkout -b agent/claude-code/phase1-daemon`

### Schritt 2: Node Daemon Grundgerüst (`packages/daemon/`)

Initialisiere `packages/daemon/` als TypeScript-Projekt:

1. **Projekt-Setup**:
   - `package.json` mit `"type": "module"`, TypeScript strict mode
   - `tsconfig.json` mit ES2022 target, strict: true
   - ESLint + Prettier Konfiguration
   - Vitest für Tests

2. **Kern-Module implementieren** (in `packages/daemon/src/`):

   a. **`identity.ts`** — Agent-Identität
   - ECDSA Keypair-Generierung (P-256 via Node.js crypto)
   - SPIFFE-URI Ableitung: `spiffe://thinklocal/host/<hostname>/agent/<type>`
   - Persistenz des Keypairs in OS Keychain oder Datei (verschlüsselt)

   b. **`discovery.ts`** — mDNS Service Discovery
   - `bonjour-service` (npm) zum Publizieren von `_thinklocal._tcp`
   - TXT-Records: agent-id, capability-hash, endpoint, cert-fingerprint
   - Listener für neue Peers

   c. **`agent-card.ts`** — Agent Card Server
   - HTTPS-Endpoint `/.well-known/agent-card.json`
   - Agent Card Schema aus README.md (capabilities, health, mesh)
   - Systemmetriken via `systeminformation` (npm)

   d. **`mesh.ts`** — Mesh-Networking Grundgerüst
   - Grundstruktur für Peer-Verbindungen
   - Heartbeat-Mechanismus (alle 10s)
   - Peer-Status-Tracking (online/offline nach 3 Missed Beats)

   e. **`audit.ts`** — Audit-Log
   - Append-only SQLite WAL-Log via `better-sqlite3`
   - Event-Typen: PEER_JOIN, PEER_LEAVE, HEARTBEAT
   - Signierte Einträge (Ed25519)

   f. **`config.ts`** — Konfiguration
   - TOML-Config aus `config/daemon.toml`
   - Umgebungsvariablen-Override
   - Defaults für Port (9440), Hostname, Agent-Typ

3. **Einstiegspunkt** `packages/daemon/src/index.ts`:
   - Keypair laden oder generieren
   - mDNS Service publizieren
   - Agent Card Server starten
   - Heartbeat-Loop starten
   - Graceful Shutdown (SIGTERM/SIGINT)

### Schritt 3: Proof-of-Concept — Zwei Nodes auf einem Rechner

Ziel: Zwei Daemon-Instanzen auf localhost (verschiedene Ports) finden sich per mDNS, tauschen Agent Cards aus und halten einen Heartbeat aufrecht.

```bash
# Terminal 1
TLMCP_PORT=9440 TLMCP_AGENT_TYPE=claude-code npm run daemon:start

# Terminal 2
TLMCP_PORT=9441 TLMCP_AGENT_TYPE=gemini-cli npm run daemon:start
```

Erwartetes Verhalten:
- Node A entdeckt Node B via mDNS
- Beide rufen `/.well-known/agent-card.json` des anderen ab
- Audit-Log zeigt PEER_JOIN Events
- Heartbeats laufen, bei Ctrl+C in einem Terminal: PEER_LEAVE im anderen

Schreibe dafür auch einen Integration-Test in `tests/integration/two-nodes.test.ts`.

## Tech-Entscheidungen (bindend)

| Was | Entscheidung | Begründung |
|-----|-------------|------------|
| Sprache | TypeScript (strict) | MCP SDK, async I/O |
| Runtime | Node.js (nicht Bun für v1) | Stabiler, breitere npm-Kompatibilität |
| mDNS | `bonjour-service` | Aktiv gewartet, macOS/Linux |
| Systeminfo | `systeminformation` | Cross-Platform |
| SQLite | `better-sqlite3` | Synchron, schnell, kein ORM |
| Crypto | Node.js crypto + `@noble/ed25519` | Kein natives Addon nötig |
| Config | TOML via `@iarna/toml` | Menschenlesbar, einfach |
| Tests | Vitest | Schnell, ESM-native |
| HTTP | Fastify | Schnell, Plugin-System |

## Branch-Konvention

Arbeite in `agent/claude-code/phase1-daemon`. Commits im Format:
```
[claude-code] scope: beschreibung
```

Siehe CONTRIBUTING.md für Scopes und Regeln. Pushe nicht auf `main` direkt.

## Wichtige Hinweise

- **Audit-Log von Anfang an** — nicht "später nachrüsten", das ist Architektur-Konsensus
- **Keine Secrets im Code** — auch nicht temporär, auch nicht für Tests
- **mTLS ist Phase 1, aber der PoC darf mit Self-Signed starten** — die CA kommt danach
- **Lies TODO.md Phase 1** vollständig durch — dort stehen die genauen Aufgaben mit Prioritäten
- **Das Netzwerk ist 10.10.10.0/24** — der Mac (minimac-2) hat IP 10.10.10.55 auf USB LAN
