# INSTALL.md — thinklocal-mcp Installationsanleitung

## Voraussetzungen

- **Node.js 22+** ([nodejs.org](https://nodejs.org))
- **Git** ([git-scm.com](https://git-scm.com))
- Betriebssystem: macOS, Linux (Ubuntu/Debian), oder Windows 10+

---

## Schnell-Installation (empfohlen)

### macOS / Linux

```bash
curl -fsSL https://raw.githubusercontent.com/2000teddy/thinklocal-mcp/main/scripts/install.sh | bash
```

Das Skript:
1. Klont das Repository nach `~/thinklocal-mcp`
2. Installiert alle Dependencies
3. Richtet den System-Service ein (launchd/systemd)
4. Konfiguriert den MCP-Server fuer Claude Code + Claude Desktop
5. Startet den Daemon
6. Verifiziert die Installation

### Windows

```powershell
# 1. Repository klonen
git clone https://github.com/2000teddy/thinklocal-mcp.git $env:USERPROFILE\thinklocal-mcp
cd $env:USERPROFILE\thinklocal-mcp

# 2. Dependencies installieren
cd packages\daemon; npm ci; cd ..\dashboard-ui; npm ci; cd ..\..

# 3. Als Task installieren
.\scripts\service\thinklocal-daemon.ps1 install

# 4. Starten
.\scripts\service\thinklocal-daemon.ps1 start
```

---

## Manuelle Installation

### 1. Repository klonen

```bash
git clone https://github.com/2000teddy/thinklocal-mcp.git ~/thinklocal-mcp
cd ~/thinklocal-mcp
```

### 2. Dependencies installieren

```bash
npm install
```

> Das installiert automatisch alle Dependencies (Root + Daemon + Dashboard) in einem Schritt.

### 3. Daemon starten

```bash
npm start              # Mit mTLS (Produktion)
npm run start:dev      # Ohne mTLS (Entwicklung)
```

Wichtige Unterscheidung:

- `npm start` startet den Daemon entsprechend deiner Konfiguration und kann netzwerkexponiert sein.
- `thinklocal bootstrap` und der Installer richten standardmaessig einen `localhost-only` Service mit `TLMCP_BIND_HOST=127.0.0.1` und `TLMCP_NO_TLS=1` ein.
- Dieser Default ist fuer lokalen Betrieb gedacht, nicht fuer LAN-Exposure.

Konfiguration via Umgebungsvariablen:

| Variable | Default | Beschreibung |
|----------|---------|-------------|
| `TLMCP_PORT` | `9440` | HTTP(S)-Port |
| `TLMCP_BIND_HOST` | `0.0.0.0` | Bind-Adresse; fuer lokalen Service typischerweise `127.0.0.1` |
| `TLMCP_AGENT_TYPE` | `claude-code` | Agent-Typ |
| `TLMCP_DATA_DIR` | `~/.thinklocal` | Datenverzeichnis |
| `TLMCP_NO_TLS` | `0` | `1` = TLS deaktivieren (nur Entwicklung!) |
| `TLMCP_CONFIG` | `config/daemon.toml` | Pfad zur TOML-Konfiguration |
| `TLMCP_VAULT_PASSPHRASE` | auto-generiert | Vault-Verschluesselungspasswort; ohne Env wird ein zufaelliger Wert erzeugt und persistent gespeichert |
| `TLMCP_LOG_LEVEL` | `info` | Log-Level: trace, debug, info, warn, error |
| `TLMCP_ALLOW_PLAINTEXT_GIT_CREDENTIALS` | `0` | Nur wenn `1`, darf `bootstrap` `GITHUB_TOKEN` in `~/.git-credentials` hinterlegen |

---

## System-Service einrichten

### macOS (launchd)

```bash
# Installieren und starten
./scripts/install.sh

# Oder manuell:
cp scripts/service/com.thinklocal.daemon.plist ~/Library/LaunchAgents/
# Platzhalter __NODE_PATH__, __INSTALL_DIR__, __HOME__ ersetzen!
launchctl load ~/Library/LaunchAgents/com.thinklocal.daemon.plist
```

**Steuern:**

```bash
launchctl start com.thinklocal.daemon    # Starten
launchctl stop com.thinklocal.daemon     # Stoppen
launchctl list | grep thinklocal         # Status pruefen
```

### Linux (systemd)

```bash
# Installieren und starten
./scripts/install.sh

# Oder manuell:
mkdir -p ~/.config/systemd/user
cp scripts/service/thinklocal-daemon.service ~/.config/systemd/user/
# Platzhalter ersetzen!
systemctl --user daemon-reload
systemctl --user enable --now thinklocal-daemon
```

**Steuern:**

```bash
systemctl --user start thinklocal-daemon    # Starten
systemctl --user stop thinklocal-daemon     # Stoppen
systemctl --user status thinklocal-daemon   # Status
journalctl --user -u thinklocal-daemon -f   # Live-Logs
```

### Windows (Scheduled Task)

```powershell
.\scripts\service\thinklocal-daemon.ps1 install   # Installieren
.\scripts\service\thinklocal-daemon.ps1 start     # Starten
.\scripts\service\thinklocal-daemon.ps1 status    # Status
.\scripts\service\thinklocal-daemon.ps1 stop      # Stoppen
.\scripts\service\thinklocal-daemon.ps1 uninstall # Entfernen
```

---

## Pruefen ob der Daemon laeuft

### Health-Check

```bash
curl http://localhost:9440/health
# Antwort: {"status":"ok","timestamp":"..."}
```

Der Installer- und Bootstrap-Pfad nutzt bewusst diese lokale HTTP-URL, weil der Standard-Service auf `127.0.0.1` gebunden wird.

### Status-Abfrage

```bash
npm run tlmcp -- status
# Oder direkt:
curl http://localhost:9440/api/status | jq
```

### Logs pruefen

```bash
# macOS / Linux
tail -f ~/.thinklocal/logs/daemon.log
tail -f ~/.thinklocal/logs/daemon.error.log

# Mit dem CLI
npm run tlmcp -- audit
```

### Prozess pruefen

```bash
# macOS
launchctl list | grep thinklocal

# Linux
systemctl --user status thinklocal-daemon

# Alle Plattformen
lsof -i :9440  # Welcher Prozess hoert auf Port 9440?
```

---

## Claude Code (Terminal/CLI) Integration

### Automatisch (empfohlen)

Der Installer erstellt `~/.mcp.json`:

```json
{
  "mcpServers": {
    "thinklocal": {
      "command": "npx",
      "args": ["tsx", "/pfad/zu/thinklocal-mcp/packages/daemon/src/mcp-stdio.ts"],
      "env": { "TLMCP_DAEMON_URL": "http://localhost:9440" }
    }
  }
}
```

**Verfuegbare Tools in Claude Code:**

| Tool | Beschreibung |
|------|-------------|
| `discover_peers` | Peers im Mesh auflisten |
| `query_capabilities` | Skills/Faehigkeiten suchen |
| `mesh_status` | Daemon-Gesamtstatus |
| `delegate_task` | Task an anderen Agent delegieren |
| `list_credentials` | Vault-Credentials anzeigen |
| `store_credential` | Credential verschluesselt speichern |
| `system_health` | System-Monitoring (CPU, RAM, Disk) |
| `system_processes` | Top-Prozesse |
| `system_network` | Netzwerk-Interfaces |
| `system_disk` | Dateisystem-Nutzung |
| `get_audit_log` | Audit-Log abfragen |
| `start_pairing` | Peer-Pairing starten |

### Manuell einrichten

```bash
# ~/.mcp.json erstellen (oder bestehende ergaenzen):
cat > ~/.mcp.json << 'EOF'
{
  "mcpServers": {
    "thinklocal": {
      "command": "npx",
      "args": ["tsx", "$HOME/thinklocal-mcp/packages/daemon/src/mcp-stdio.ts"],
      "env": { "TLMCP_DAEMON_URL": "http://localhost:9440" }
    }
  }
}
EOF
```

### Verifizieren

Starte eine neue Claude Code Session und frage:

```
> Welche Peers sind im Mesh? Nutze discover_peers.
```

---

## Claude Desktop Integration

### macOS

Die Konfigurationsdatei befindet sich unter:
```
~/Library/Application Support/Claude/claude_desktop_config.json
```

Fuege den thinklocal-Server hinzu:

```json
{
  "mcpServers": {
    "thinklocal": {
      "command": "/pfad/zu/thinklocal-mcp/packages/daemon/node_modules/.bin/tsx",
      "args": ["/pfad/zu/thinklocal-mcp/packages/daemon/src/mcp-stdio.ts"],
      "env": { "TLMCP_DAEMON_URL": "http://localhost:9440" }
    }
  }
}
```

### Linux

```
~/.config/Claude/claude_desktop_config.json
```

### Windows

```
%APPDATA%\Claude\claude_desktop_config.json
```

### Verifizieren

Nach dem Neustart von Claude Desktop:
1. Klicke auf das MCP-Icon (Stecker-Symbol) in der Sidebar
2. "thinklocal" sollte als verbundener Server erscheinen
3. Frage: "Zeige mir den Mesh-Status" — Claude nutzt `mesh_status`

---

## Deployment auf andere Rechner

### Automatisch via SSH

```bash
# Einzelner Rechner
./scripts/deploy-remote.sh user@10.10.10.55

# Mit Optionen
./scripts/deploy-remote.sh user@server2 --agent-type gemini-cli --port 9441
```

### Netzwerk scannen

Finde geeignete Rechner im LAN:

```bash
npm run scan

# Nur laufende Daemons
npm run scan -- --mdns

# Nur SSH-erreichbare Hosts
npm run scan -- --ssh
```

Output:

```
  Laufende thinklocal-Daemons (2):
    minimac-4.local           10.10.10.55:9440  [claude-code]
    minimac-5.local           10.10.10.56:9441  [gemini-cli]

  Geeignete Hosts fuer Deployment (1):
    server-3.local            10.10.10.57       Node v22.5.1
      Deploy: ./scripts/deploy-remote.sh 10.10.10.57

  Hosts ohne Node.js (1):
    raspi-4.local             10.10.10.60       (Node.js fehlt)
```

### Manuell via SSH

```bash
ssh user@andere-maschine 'curl -fsSL https://raw.githubusercontent.com/2000teddy/thinklocal-mcp/main/scripts/install.sh | bash'
```

---

## Dashboard

```bash
# Entwicklungsmodus (Hot-Reload)
npm run dashboard:dev
# Oeffne http://localhost:3000

# Produktions-Build
npm run dashboard:build
```

**Views:**
- **Topologie** — Netzwerkgraph aller Peers (klickbar)
- **Skill-Matrix** — Agent x Capability Tabelle
- **Health** — CPU/RAM/Disk Gauges pro Node
- **Live-Events** — Echtzeit-Event-Stream via WebSocket
- **Vault** — Credentials verwalten + Approval-Gate
- **Pairing** — PIN-basiertes Peer-Pairing
- **Audit-Log** — Alle Events mit CSV-Export

---

## CLI (tlmcp)

```bash
npm run tlmcp -- status        # Daemon-Status
npm run tlmcp -- peers         # Verbundene Peers
npm run tlmcp -- caps          # Capabilities
npm run tlmcp -- tasks         # Tasks
npm run tlmcp -- vault list    # Vault-Credentials
npm run tlmcp -- pairing start # PIN generieren
npm run tlmcp -- audit         # Audit-Log
```

---

## Fehlerbehebung

### Daemon startet nicht

```bash
# Logs pruefen
tail -50 ~/.thinklocal/logs/daemon.error.log

# Port belegt?
lsof -i :9440

# Manuell starten (mehr Output)
TLMCP_LOG_LEVEL=debug TLMCP_NO_TLS=1 npx tsx packages/daemon/src/index.ts
```

### Peers finden sich nicht

1. Sind beide Rechner im gleichen Subnetz?
   ```bash
   # Auf beiden Rechnern:
   hostname -I   # Linux
   ifconfig | grep "inet "  # macOS
   ```

2. Ist mDNS erlaubt? (Firewall Port 5353 UDP)

3. Pruefen ob der andere Daemon antwortet:
   ```bash
   curl http://IP_DES_ANDEREN:9440/health
   ```

### MCP-Server nicht in Claude Code

1. Pruefe `~/.mcp.json`:
   ```bash
   cat ~/.mcp.json
   ```

2. Pruefe ob der Daemon laeuft:
   ```bash
   curl http://localhost:9440/health
   ```

3. Starte Claude Code neu (neue Session)

### TLS-Fehler

Fuer Entwicklung TLS deaktivieren:
```bash
TLMCP_NO_TLS=1 npx tsx packages/daemon/src/index.ts
```

---

## Deinstallation

### macOS

```bash
launchctl unload ~/Library/LaunchAgents/com.thinklocal.daemon.plist
rm ~/Library/LaunchAgents/com.thinklocal.daemon.plist
rm -rf ~/thinklocal-mcp ~/.thinklocal
# Optional: ~/.mcp.json anpassen (thinklocal-Eintrag entfernen)
```

### Linux

```bash
systemctl --user disable --now thinklocal-daemon
rm ~/.config/systemd/user/thinklocal-daemon.service
systemctl --user daemon-reload
rm -rf ~/thinklocal-mcp ~/.thinklocal
```

### Windows

```powershell
.\scripts\service\thinklocal-daemon.ps1 uninstall
Remove-Item -Recurse $env:USERPROFILE\thinklocal-mcp
Remove-Item -Recurse $env:USERPROFILE\.thinklocal
```
