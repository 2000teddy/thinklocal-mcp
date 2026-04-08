# CLAUDE.md — Eingangsprompt für Claude Code

## UNVERHANDELBARE REIHENFOLGE (ab 2026-04-08)

**Vor jedem PR zwingend in dieser Reihenfolge:**

1. **CO** — `pal:consensus` (bei Design-Fragen/Architektur, 2-3 Modelle)
2. **CG** — `clink gemini` (Test-Skizzen, Type-Ableitung, Boilerplate)
3. **Design-Doku** — `docs/architecture/ADR-NNN-*.md` oder SECURITY.md-Update **VOR dem Code**
4. **Code** — Implementierung + Unit-Tests
5. **CR** — `pal:codereview` mit GPT-5.4 oder Gemini Pro
6. **HIGH-Findings fixen** — sofort, niemals als TODO verschieben
7. **PC** — `pal:precommit`
8. **git commit** — signed
9. **DO** — Documentation: README / USER-GUIDE / API-REFERENCE / CHANGES.md / TODO.md
10. **PR** — `gh pr create`, COMPLIANCE-TABLE.md Zeile hinzufuegen
11. **Merge** — nur nach vollstaendigem Compliance-Check
12. **Peer-Deploy + Live-Test**

**Spalten in COMPLIANCE-TABLE.md:** CO, CG, CR, PC, DO. Jede Spalte muss ✅ sein bevor der PR merged wird.

**Eine reine Bug-Fix-PR darf CO + CG auslassen — aber DO NIE.**

**Wenn du dich beim Coden dabei ertappst, dass du diese Reihenfolge umgehen willst, hast du PR #83 nicht verinnerlicht.** Am 2026-04-07/08 wurden 5+ Stunden Re-Work produziert weil Reviews uebersprungen wurden. Reviews kosten 5 Minuten pro PR.

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

## Deine Rolle: Lead Developer & Orchestrator

Du bist der Hauptentwickler dieses Projekts. Du schreibst den Code, triffst Implementierungsentscheidungen und steuerst den Entwicklungsprozess. Zusätzlich hast du über PAL und clink Zugriff auf andere AI-Modelle, die du als spezialisierte Berater und Reviewer einsetzen sollst:

### Sub-Agenten-Strategie (PAL/clink)

**Code Review nach jedem abgeschlossenen Modul:**
```
pal:codereview  →  Lass GPT-5.4 oder Gemini Pro den fertigen Code reviewen
                   Andere Modelle finden andere Bugs — nutze das.
```

**Architektur-Entscheidungen während der Implementierung:**
```
pal:consensus   →  Wenn eine Design-Frage auftaucht (z.B. "bonjour-service vs @libp2p/mdns?"),
                   konsultiere 2-3 Modelle und nimm den Konsensus.
```

**Isolierte Teilaufgaben delegieren:**
```
clink gemini    →  Testfälle generieren, TypeScript-Typen aus JSON-Schema ableiten
clink codex     →  Dockerfile, CI/CD-Pipeline, Performance-Optimierung
pal:chat        →  Schnelle Rückfragen zu Bibliotheken, API-Design, Best Practices
```

**Nicht tun:**
- Nicht zwei Agenten gleichzeitig im selben Modul arbeiten lassen
- Nicht Code von Sub-Agenten übernehmen ohne eigenes Review
- Sub-Agenten haben keinen Repo-Kontext — gib immer die relevanten Dateipfade mit

### Wann welchen Sub-Agenten nutzen

| Situation | Tool | Modell |
|-----------|------|--------|
| Code fertig → Review | `pal:codereview` | GPT-5.4 oder Gemini Pro |
| Architektur-Frage | `pal:consensus` | 2-3 Modelle |
| Tests generieren | `clink gemini` | Gemini CLI |
| Schnelle API-Frage | `pal:chat` | auto |
| Sicherheitsreview | `pal:codereview` (focus: security) | GPT-5.4 |
| Vor dem Commit | `pal:precommit` | auto |

## Aufgabe: Phase 1 — Schritte 1 bis 3

### Schritt 1: Arbeitsbranch erstellen

Das Repo ist bereits auf GitHub (privat, `main` Branch). Erstelle deinen Arbeitsbranch:
```bash
git checkout -b agent/claude-code/phase1-daemon
```

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

4. **Nach jedem fertigen Modul**: `pal:codereview` mit GPT-5.4 oder Gemini Pro laufen lassen.

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
Lass den Test anschließend von `clink gemini` reviewen.

### Schritt 4: Vor dem Push

```
pal:precommit   →  Validierung aller Änderungen vor dem Commit
git push origin agent/claude-code/phase1-daemon
```

Dann PR gegen `main` erstellen und Christian zur Genehmigung bitten.

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
- **Nutze Sub-Agenten aktiv** — Code Review nach jedem Modul, Konsensus bei Architektur-Fragen
