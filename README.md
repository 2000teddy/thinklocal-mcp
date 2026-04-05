# thinklocal-mcp

**Verschlüsselte Peer-to-Peer-Kommunikation zwischen AI CLI Agenten im lokalen Netzwerk**

> *"Think local, act together"* — Ein Mesh-Netzwerk, in dem AI-Agenten ihre Fähigkeiten entdecken, teilen und gemeinsam wachsen.

---

## Übersicht

`thinklocal-mcp` ist eine Open-Source-Infrastruktur, die es AI CLI-Agenten (Claude Code, Codex, Gemini CLI, u.a.) ermöglicht, sich im lokalen Netzwerk gegenseitig zu finden, verschlüsselt zu kommunizieren und Fähigkeiten auszutauschen. Das System kombiniert das [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) für Tool-/Ressourcen-Integration mit [A2A](https://a2a-protocol.org/)-inspirierten Agent Cards für die Capability Discovery.

### Was thinklocal-mcp löst

Aktuell arbeiten AI-Agenten auf verschiedenen Rechnern isoliert voneinander. Wenn Claude Code auf Rechner A wissen will, ob auf Rechner B eine InfluxDB läuft oder ob ein Agent dort einen bestimmten Skill hat, gibt es keinen standardisierten Weg dies zu erfragen. **thinklocal-mcp** schließt diese Lücke:

- **Automatische Erkennung** — Agenten finden sich per mDNS/Bonjour im LAN
- **Verschlüsselte Kommunikation** — mTLS mit lokaler CA, kein externer Dienst nötig
- **Capability Queries** — „Wer hat InfluxDB?" / „Wer beherrscht den Skill X?"
- **Skill-Austausch** — Fähigkeiten können zwischen Agenten repliziert werden
- **Credential Sharing** — Verschlüsselte Weitergabe von Anmeldedaten mit PKI
- **Wachstum** — Agenten können anderen Agenten neue Skills beibringen
- **Dashboard** — Chronograf-ähnliche Visualisierung aller Nodes und Fähigkeiten

---

## Architektur

```
┌─────────────────────────────────────────────────────────┐
│                    thinklocal-mcp Mesh                   │
│                                                         │
│  ┌──────────┐    mTLS     ┌──────────┐    mTLS         │
│  │  Node A  │◄───────────►│  Node B  │◄──────────┐     │
│  │ (Daemon) │             │ (Daemon) │           │     │
│  │          │             │          │           │     │
│  │ • Claude │   Agent     │ • Codex  │     ┌─────┴──┐  │
│  │   Code   │   Cards     │ • Gemini │     │ Node C │  │
│  │ • Skills │◄───────────►│ • Skills │     │(Daemon)│  │
│  │ • Creds  │   (A2A)     │ • Creds  │     │        │  │
│  └────┬─────┘             └────┬─────┘     │• Claude│  │
│       │                        │           │  Desk. │  │
│       │  mDNS                  │  mDNS     │• Skills│  │
│       ▼                        ▼           └────────┘  │
│  ┌──────────────────────────────────────────────────┐  │
│  │              Discovery Layer                      │  │
│  │   mDNS/Bonjour (_thinklocal._tcp)                │  │
│  │   + Fallback Registry (für VPN/Cross-Subnet)     │  │
│  └──────────────────────────────────────────────────┘  │
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │              Dashboard (Web UI)                   │  │
│  │   • Netzwerk-Topologie (Graph-Visualisierung)    │  │
│  │   • Node Health (CPU, RAM, Disk, Netzwerk)       │  │
│  │   • Capability Matrix (wer kann was)             │  │
│  │   • Skill Marketplace (installieren/teilen)      │  │
│  │   • Audit Log (wer hat was wann gemacht)         │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### Schichten

| Schicht | Technologie | Zweck |
|---------|------------|-------|
| **Transport** | mTLS über HTTPS / JSON-RPC 2.0 | Verschlüsselte Kommunikation |
| **Discovery** | mDNS/Bonjour + Fallback Registry | Zero-Config Erkennung |
| **Protocol** | MCP (Tools/Resources) + A2A Agent Cards | Standardisierte Interaktion |
| **Identity** | Lokale CA (step-ca / cfssl) + TOFU | Zertifikatsverwaltung |
| **Skill Mesh** | Portable MCP Server Manifeste | Fähigkeiten-Austausch |
| **Secrets** | PKI Envelope Encryption (NaCl Box) | Credential Sharing |
| **Dashboard** | React + WebSocket + D3.js / React Flow | Visualisierung |

---

## Protokoll-Design

### Warum MCP + A2A?

- **MCP** (Model Context Protocol, Nov 2025 Spec) ist der De-facto-Standard für die Integration von AI-Modellen mit Tools und Datenquellen. Es bietet Tools, Resources, Prompts und seit November 2025 auch Tasks für asynchrone Workflows.
- **A2A** (Agent-to-Agent Protocol, Google, unter Linux Foundation) standardisiert die Kommunikation zwischen Agenten mit Agent Cards, Task Management und Capability Discovery.
- **thinklocal-mcp** nutzt MCP für die Tool-Ebene (was kann ein Agent *tun*) und A2A-Muster für die Agenten-Ebene (wer *ist* ein Agent und was *bietet* er an).

### Agent Card (erweitert)

Jeder Node veröffentlicht eine Agent Card unter `/.well-known/agent-card.json`:

```json
{
  "name": "node-alpha",
  "version": "1.0.0",
  "hostname": "macbook-christian.local",
  "endpoint": "https://10.10.10.55:9440",
  "publicKey": "-----BEGIN PUBLIC KEY-----...",
  "capabilities": {
    "agents": ["claude-code", "gemini-cli"],
    "skills": ["influxdb-query", "system-monitor", "docker-manage"],
    "services": [
      {"name": "influxdb", "version": "2.7", "port": 8086},
      {"name": "grafana", "version": "10.2", "port": 3000}
    ],
    "connectors": ["github", "slack", "jira"]
  },
  "health": {
    "cpu_percent": 23.5,
    "memory_percent": 67.2,
    "disk_percent": 45.0,
    "uptime_seconds": 86400
  },
  "mesh": {
    "joined_at": "2026-04-03T10:00:00Z",
    "trust_level": "verified",
    "skills_shared": 3,
    "skills_received": 1
  }
}
```

---

## Sicherheitsmodell

### Verschlüsselung

- **Transport**: mTLS (gegenseitige TLS-Authentifizierung)
- **Lokale CA**: Auto-bootstrapped beim ersten Mesh-Start
- **Zertifikate**: Ed25519-basiert, 90-Tage-Rotation, Auto-Renewal
- **Enrollment**: Trust-on-First-Use (TOFU) mit Dashboard-Bestätigung

### Bedrohungsmodell

| Bedrohung | Gegenmaßnahme |
|-----------|--------------|
| Unautorisierter Node-Beitritt | TOFU + Dashboard-Bestätigung |
| Man-in-the-Middle | mTLS mit Certificate Pinning |
| Credential Theft | Envelope Encryption, nie Klartext |
| Skill Tampering | SHA-256 Integrity + Code-Signierung |
| Replay Attacks | Nonces + Timestamps |
| Denial of Service | Rate Limiting + Circuit Breaker |
| Tool Poisoning (MCP) | Skill-Signierung + Sandbox |

---

## Skill-System

Ein Skill ist ein portables MCP-Server-Paket mit Manifest:

```json
{
  "name": "influxdb-query",
  "version": "1.0.0",
  "description": "InfluxDB Flux Query Executor",
  "author": "node-alpha",
  "integrity": "sha256:a1b2c3d4e5f6...",
  "signature": "ed25519:...",
  "runtime": "node",
  "entrypoint": "index.js",
  "dependencies": ["influxdb-client@2.0"],
  "capabilities": {
    "tools": ["execute_flux_query", "list_buckets", "write_point"],
    "resources": ["influxdb://measurements"]
  },
  "requirements": {
    "services": ["influxdb>=2.0"],
    "os": ["darwin", "linux"],
    "minMemoryMB": 128
  }
}
```

**Austausch-Modelle**: Pull (Agent fragt nach Skill), Push (Node bietet an), Marketplace (Dashboard-UI).

---

## Tech Stack

| Komponente | Technologie | Begründung |
|-----------|------------|-----------|
| **Node Daemon** | TypeScript / Node.js (Bun) | Native MCP SDK, async I/O |
| **mDNS** | `bonjour-service` (npm) | Zero-Config Discovery |
| **mTLS/CA** | `node-forge` + `step-ca` | Leichtgewichtige lokale CA |
| **Protocol** | JSON-RPC 2.0 über HTTPS | MCP/A2A-kompatibel |
| **Dashboard** | React 19 + Next.js 15 + Tailwind | Modernes Frontend |
| **Realtime** | WebSocket (Socket.io) | Live-Updates |
| **Topologie** | D3.js / React Flow | Netzwerk-Graph |
| **Health** | `systeminformation` (npm) | Cross-Platform Metriken |
| **Secrets** | `tweetnacl-js` (NaCl Box) | Envelope Encryption |
| **Tests** | Vitest + Playwright | Unit + E2E |

---

## Quick Start

### Automatisch (empfohlen)

```bash
curl -fsSL https://raw.githubusercontent.com/2000teddy/thinklocal-mcp/main/scripts/install.sh | bash
```

### Manuell (3 Befehle)

```bash
git clone https://github.com/2000teddy/thinklocal-mcp.git
cd thinklocal-mcp
npm install        # Installiert ALLES (Root + Daemon + Dashboard)
npm start          # Daemon starten (mit mTLS)
npm run start:dev  # Daemon starten (ohne mTLS, fuer Entwicklung)
```

### Pruefen ob es laeuft

```bash
npm run health                # Health-Check
npm run tlmcp -- status       # Ausfuehrlicher Status
npm run tlmcp -- peers        # Verbundene Peers
```

### Dashboard

```bash
npm run dashboard             # http://localhost:3000
```

### Zweiten Rechner hinzufuegen

```bash
npm run scan                  # Netzwerk nach geeigneten Rechnern scannen
npm run deploy -- user@10.10.10.55 --agent-type gemini-cli
```

### Claude Code nutzen

Die MCP-Tools werden automatisch geladen (via `~/.mcp.json`):

```
> Welche Peers sind im Mesh? (nutze discover_peers)
> Wie ist der Systemstatus? (nutze system_health)
```

> **Ausfuehrliche Anleitung**: [INSTALL.md](./INSTALL.md) — Installation, Service-Setup, Claude Desktop, Fehlerbehebung, Deinstallation

### Aktuelles Standard-Betriebsmodell

Der aktuelle Default ist absichtlich konservativ und lokal:

- `thinklocal bootstrap` und der Installer richten einen `localhost-only` Daemon auf `127.0.0.1:9440` ein
- dieser lokale Service laeuft standardmaessig mit `TLMCP_NO_TLS=1`
- dadurch funktionieren Dashboard, CLI und MCP-Bridge lokal ohne CA-Verteilung
- fuer echten netzwerkweiten Mesh-Betrieb muss der Daemon bewusst auf eine Netzadresse gebunden und TLS/mTLS explizit aktiviert werden

Das ist wichtig, weil die Dokumentation an manchen Stellen noch das Zielbild eines vollstaendig mTLS-basierten Default-Mesh beschreibt, waehrend der aktuelle Runtime-Default bewusst ein lokaler Sicherheitsmodus ist.

---

## Branch-Strategie für Multi-Agenten-Entwicklung

> **Wichtig für AI-Agenten und menschliche Entwickler:**

1. **`main`** ist geschützt — nur Merges über Pull Requests
2. **Eigener Branch für größere Änderungen**:
   ```
   feature/<beschreibung>       # Neue Features
   fix/<beschreibung>           # Bugfixes
   agent/<agent-name>/<task>    # Agent-spezifische Branches
   ```
3. **Commit Messages**: Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`)
4. **Vor dem Merge**: Rebase auf `main`, Tests müssen grün sein
5. **Konflikte**: `main` als Basis nehmen

Siehe [CONTRIBUTING.md](./CONTRIBUTING.md) für Details.

---

## Verwandte Standards

- [MCP](https://modelcontextprotocol.io/) — Anthropic, Linux Foundation/AAIF
- [A2A](https://a2a-protocol.org/) — Google, Linux Foundation
- [ACP](https://docs.beeai.dev/acp/) — IBM BeeAI
- [ANP](https://agent-network-protocol.com/) — Community

## Lizenz

MIT License — siehe [LICENSE](./LICENSE)

---

🚧 **In aktiver Entwicklung** — siehe [TODO.md](./TODO.md) und [CHANGES.md](./CHANGES.md)
