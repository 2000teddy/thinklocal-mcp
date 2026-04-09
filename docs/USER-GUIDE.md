# thinklocal-mcp Benutzerhandbuch

Verschluesseltes Peer-to-Peer Mesh-Netzwerk fuer AI CLI Agenten.

---

## 1. Installation

### macOS (Ein-Befehl-Installation)

```bash
curl -fsSL https://raw.githubusercontent.com/2000teddy/thinklocal-mcp/main/scripts/install.sh | bash
```

### Linux (Ubuntu/Debian)

```bash
curl -fsSL https://raw.githubusercontent.com/2000teddy/thinklocal-mcp/main/scripts/install.sh | bash
```

Voraussetzungen: curl, git, Node.js 22+ (wird automatisch via nvm installiert).

### Remote-Installation auf einem Server

```bash
cd ~/Entwicklung_local/thinklocal-mcp && npx tsx packages/cli/src/thinklocal.ts deploy user@server-ip --with-env
```

---

## 2. Ersteinrichtung

```bash
cd ~/Entwicklung_local/thinklocal-mcp && npx tsx packages/cli/src/thinklocal.ts bootstrap
```

Bootstrap erledigt automatisch:
- Agent-Keypair generieren
- Konfiguration erstellen
- System-Service installieren (launchd/systemd)
- MCP-Config fuer Claude Code/Desktop eintragen
- Credentials aus `.env` importieren

---

## 3. CLI-Befehle

| Befehl | Beschreibung |
|--------|-------------|
| `thinklocal start` | Daemon starten |
| `thinklocal stop` | Daemon stoppen |
| `thinklocal restart` | Daemon neu starten |
| `thinklocal status` | Status anzeigen |
| `thinklocal doctor` | Systemdiagnose |
| `thinklocal peers` | Verbundene Peers anzeigen |
| `thinklocal logs` | Live-Logs anzeigen |
| `thinklocal deploy user@host` | Remote-Deployment |
| `thinklocal check host:port` | Remote-Daemon pruefen |
| `thinklocal mcp install` | MCP in Claude eintragen |
| `thinklocal config show` | Konfiguration anzeigen |
| `thinklocal uninstall` | Service entfernen |

---

## 4. Konfiguration

### Hauptkonfiguration: `config/daemon.toml`

```toml
[daemon]
port = 9440
hostname = ""           # Leer = Auto-Detect
agent_type = "claude-code"

[mesh]
heartbeat_interval_ms = 10000
heartbeat_timeout_missed = 3

[discovery]
mdns_service_type = "_thinklocal._tcp"

# Statische Peers (fuer VPN/Cross-Subnet)
# [[discovery.static_peers]]
# host = "10.10.10.56"
# port = 9440
```

### Umgebungsvariablen

| Variable | Beschreibung | Default |
|----------|-------------|---------|
| `TLMCP_PORT` | Daemon-Port | 9440 |
| `TLMCP_DATA_DIR` | Datenverzeichnis | ~/.thinklocal |
| `TLMCP_HOSTNAME` | Hostname | auto |
| `TLMCP_AGENT_TYPE` | Agent-Typ | claude-code |
| `TLMCP_NO_TLS` | TLS deaktivieren (Dev) | - |
| `TLMCP_STATIC_PEERS` | Statische Peers (komma-separiert) | - |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot Token | - |
| `TELEGRAM_ALLOWED_CHATS` | Erlaubte Chat-IDs | - |

### Credentials (.env)

```bash
# .env im Projektverzeichnis
GITHUB_TOKEN=ghp_xxx
TELEGRAM_BOT_TOKEN=123456:ABC
INFLUXDB_USERNAME=admin
INFLUXDB_PASSWORD=secret
```

---

## 5. Dashboard

Starten:

```bash
cd ~/Entwicklung_local/thinklocal-mcp && npm run dashboard
```

Oeffnen: http://localhost:3000

Features:
- **Topologie**: Netzwerkgraph aller Peers
- **Skill-Matrix**: Welcher Agent hat welche Skills
- **Health**: CPU/RAM/Disk aller Nodes
- **Live-Events**: Echtzeit-Event-Stream
- **Vault**: Credential-Verwaltung
- **Pairing**: Trust-Etablierung per PIN
- **Audit-Log**: Alle Mesh-Aktivitaeten

Dark/Light Mode: Toggle unten in der Sidebar.

---

## 6. Telegram Bot

### Einrichtung

1. Bot bei @BotFather erstellen (`/newbot`)
2. Token in `.env` eintragen: `TELEGRAM_BOT_TOKEN=...`
3. Daemon neu starten
4. `/start` an den Bot senden

### Befehle

| Befehl | Beschreibung |
|--------|-------------|
| `/status` | Daemon-Status |
| `/peers` | Verbundene Peers |
| `/health` | System-Health (CPU/RAM/Disk) |
| `/skills` | Verfuegbare Skills |
| `/audit` | Letzte Audit-Events |
| `/help` | Befehlsuebersicht |

---

## 7. Peer-Discovery

### Automatisch (mDNS)

Peers im selben Netzwerk finden sich automatisch ueber mDNS.
Linux: `avahi-daemon` muss installiert sein.

### Statische Peers

Fuer Peers ueber VPN oder verschiedene Subnetze:

```toml
# In config/daemon.toml
[[discovery.static_peers]]
host = "10.10.10.56"
port = 9440
name = "influxdb-server"
```

Oder per Umgebungsvariable:

```bash
TLMCP_STATIC_PEERS="10.10.10.56:9440,192.168.1.100:9440"
```

---

## 8. Troubleshooting

### Daemon startet nicht

```bash
thinklocal doctor    # Zeigt alle Probleme
thinklocal logs      # Live-Logs anzeigen
```

### Peer nicht sichtbar

1. Pruefen ob beide Daemons laufen: `thinklocal status`
2. Netzwerk pruefen: `thinklocal check 10.10.10.56:9440`
3. Firewall: Port 9440 muss offen sein
4. mDNS: avahi-daemon auf Linux installiert?

### Hostname aendert sich staendig

macOS vergibt bei jedem Daemon-Start einen neuen Hostname (z.B. minimac-123).
Das ist normales macOS-Verhalten. Die Agent-ID bleibt stabil (SPIFFE-URI).

### Deploy fehlgeschlagen

```bash
# SSH-Key einrichten
ssh-copy-id user@server

# Dry-Run zuerst
cd ~/Entwicklung_local/thinklocal-mcp && npx tsx packages/cli/src/thinklocal.ts deploy user@server --dry-run

# Dann echt
cd ~/Entwicklung_local/thinklocal-mcp && npx tsx packages/cli/src/thinklocal.ts deploy user@server --with-env
```

---

## 8a. Cron-Heartbeat aktivieren (ADR-004 Phase 1)

Damit Agenten ihre Inbox automatisch checken (statt zu vergessen): jeder Agent
registriert in seiner Harness zwei wiederkehrende Cron-Jobs.

```bash
# Prompts auf stdout ausgeben (zum Reinpasten in CronCreate)
thinklocal heartbeat show

# Aktuelle Heartbeat-Konfiguration ansehen
thinklocal heartbeat status
```

**Schritte fuer Claude Code:**

1. `thinklocal heartbeat show` ausfuehren — gibt zwei Sektionen aus
   (`Inbox Heartbeat` mit Cron `*/5 * * * * *` und `Compliance Heartbeat` mit
   Cron `0 */5 * * * *`).
2. In Claude Code je einen `CronCreate`-Job pro Sektion anlegen, der den
   Prompt-Body als Task-Beschreibung uebernimmt.
3. Adaptive Backoff: das `interval.ts`-Modul (`packages/daemon/src/heartbeat/interval.ts`)
   liefert die Polling-Intervalle. Im LAN-Modus startet der Inbox-Heartbeat
   bei 5 s und backoff't bei leerer Inbox bis 30 s, mit ±20 % Jitter um
   Thundering-Herd zu vermeiden. Compliance-Heartbeat ist fix bei 5 min.
4. Verifizieren mit `thinklocal heartbeat status`.

**Schritte fuer Codex/Gemini CLI:** analoges Setup ueber den jeweiligen
Scheduler, oder ein einmaliger `send_message_to_peer` von Claude an den
Sibling-Agent mit dem inbox-heartbeat Prompt-Body als Setup-Anweisung.

Siehe `docs/architecture/ADR-004-cron-heartbeat.md` und
`docs/agents/{inbox,compliance}-heartbeat.md` fuer Details.

---

## 9. Claude Code Integration

Nach `thinklocal bootstrap` sind die MCP-Tools automatisch verfuegbar.

Teste in Claude Code:

```
"Welche Peers sind im Mesh?"
"Zeige mir die System-Health aller Nodes"
"Fuehre influxdb.query auf dem influxdb-Server aus"
```

---

## 10. Sicherheit

- **mTLS**: Verschluesselte Kommunikation zwischen allen Peers
- **SPAKE2 Pairing**: PIN-basierte Trust-Etablierung
- **Signierte Nachrichten**: ECDSA-Signatur pro Message
- **Credential Vault**: AES-256-GCM verschluesselt, OS-Keychain wenn verfuegbar
- **Audit-Log**: Signierte, append-only Ereignisprotokollierung

Mehr Details: [SECURITY.md](../SECURITY.md)
