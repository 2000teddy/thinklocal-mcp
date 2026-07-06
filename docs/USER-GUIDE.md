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

[cert]
# Restlaufzeit-Schwelle (Tage): beim Daemon-Start wird ein Node-Cert mit
# daysLeft <= renew_before_days neu ausgestellt (Behalten nur bei > N).
renew_before_days = 30

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
| `TLMCP_ALLOWED_MESH_CIDRS` | Mesh-CIDRs (ADR-019, komma-separiert) | - |
| `TLMCP_EXCLUDE_INTERFACE_PATTERNS` | Interface-Excludes (ADR-019) | Defaults |
| `TLMCP_CERT_RENEW_BEFORE_DAYS` | Cert-Reissue-Schwelle beim Start (Tage), `[1, 89]` | 30 |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot Token | - |
| `TELEGRAM_ALLOWED_CHATS` | Erlaubte Chat-IDs | - |

### Zertifikats-Erneuerung (`[cert]`)

Das Node-Zertifikat wird **beim Daemon-Start** erneuert, wenn seine Restlaufzeit die Schwelle
erreicht (es gibt keine In-Process-Rotation — siehe `docs/RECHECK-cert-rotation-2026-07-03.md`).
Seit v0.34.68 (PR #242) ist die Schwelle konfigurierbar:

| Key (TOML `[cert]`) | Env | Default | Wertebereich | Bedeutung |
|---|---|---|---|---|
| `renew_before_days` | `TLMCP_CERT_RENEW_BEFORE_DAYS` | `30` | `[1, 89]` | Reissue beim Start, sobald `daysLeft <= N`. `≤ 30` passt zum **Wochen-Neustart-Rhythmus** (Kap. 13.4): das Cert erneuert sich beim ohnehin wöchentlichen Neustart rechtzeitig. |

**Warum der Wertebereich streng validiert ist** (Post-Merge-Validator in `config.ts`, wirft bei
Verletzung beim Start): `0`/negativ wäre **fail-open** — ein abgelaufenes Cert würde behalten statt
erneuert; `≥ 90` (≥ Node-Cert-Laufzeit) würde eine **Reissue-Schleife bei jedem Start** erzeugen, weil
ein frisch ausgestelltes Cert sofort wieder unter der Schwelle läge. Zulässig ist daher genau
`[1, 89]`. Hintergrund: `docs/architecture/ADR-024-*` (Canonical-Cert-Retention) und `CHANGES.md`
(v0.34.68). Token-onboardete Nodes (ohne eigenen CA-Key) sind ausgenommen — sie erneuern sich per
Re-Onboarding, nicht über diese Schwelle.

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

## 7. Token-basiertes Onboarding

Seit ADR-016 koennen neue Nodes per Bearer-Token dem Mesh beitreten — ohne
die SPAKE2-PIN-Zeremonie. Ideal fuer Single-Owner-Setups bei denen derselbe
Admin alle Nodes kontrolliert.

### Schritt-fuer-Schritt

**1. Token auf dem Admin-Node erstellen (Port 9440, loopback)**

```bash
thinklocal token create --name influxdb-server --ttl 24
# Ausgabe: Token: tlmcp_AbCdEf...  (einmalig verwendbar, 24h gueltig)
```

Alternativ via MCP-Tool `token_create` aus Claude Code heraus.

**2. Token an den neuen Node uebermitteln**

Per SSH, Messenger, oder sicheren Kanal — der Token ist Single-Use und
zeitlich begrenzt. Nach einmaliger Verwendung ist er verbraucht.

**3. Auf dem neuen Node dem Mesh beitreten (Port 9441, kein mTLS)**

```bash
thinklocal join --token tlmcp_AbCdEf... --admin-url https://10.10.10.55:9441
```

> **WICHTIG:** Der Join-Endpoint laeuft auf **Port 9441** (nicht 9440).
> Port 9441 ist der oeffentliche HTTPS-Port fuer Onboarding und Mesh-Kommunikation.
> Port 9440 ist ausschliesslich fuer loopback-APIs (Token-Management, Inbox, etc.).

Der Join-Flow:
1. Bearer-Token wird an den Admin-Node gesendet
2. Admin validiert Token (SHA-256 Hash, Single-Use, TTL)
3. Admin signiert das Node-Zertifikat mit der Mesh-CA
4. Zertifikate werden zurueckgegeben und in `~/.thinklocal/tls/` gespeichert
5. TrustStore wird hot-reloaded — der neue Peer ist sofort im Mesh sichtbar

**4. Tokens verwalten**

```bash
thinklocal token list     # Alle Tokens anzeigen (Status, Ablauf)
thinklocal token revoke <id>  # Token widerrufen
```

### 5-Node Mesh Beispiel

| Node | IP | Agent-Typ | Onboarding |
|------|-----|-----------|------------|
| MacMini (Admin) | 10.10.10.55 | claude-code | Bootstrap (CA) |
| influxdb | 10.10.10.56 | influxdb | `thinklocal join --token ... --admin-url https://10.10.10.55:9441` |
| ai-n8n | 10.10.10.57 | ai-n8n | `thinklocal join --token ... --admin-url https://10.10.10.55:9441` |
| MacBook Pro | 10.10.10.58 | claude-code | `thinklocal join --token ... --admin-url https://10.10.10.55:9441` |
| ioBroker | 10.10.10.59 | iobroker | `thinklocal join --token ... --admin-url https://10.10.10.55:9441` |

Ablauf: Auf dem MacMini je einen Token pro Node erstellen (`thinklocal token create --name <name>`),
dann auf jedem Ziel-Node `thinklocal join` ausfuehren.

### Troubleshooting Token-Onboarding

| Fehlermeldung | Ursache | Loesung |
|---------------|---------|---------|
| `self-signed certificate` | Falscher Port (9440 statt 9441) | `--admin-url` muss Port **9441** verwenden |
| `fetch failed` / `UNABLE_TO_VERIFY_LEAF_SIGNATURE` | Node.js < 22 oder fehlende TLS-Unterstuetzung | Node.js 22+ installieren (`nvm install 22`) |
| `401 Unauthorized` | Token ungueltig, abgelaufen oder bereits verwendet | Neuen Token erstellen (`thinklocal token create`) |
| `403 Forbidden` | Nicht vom Admin-Node aufgerufen | Token-Management nur auf dem Admin-Node moeglich |
| `Connection refused` | Daemon laeuft nicht | `thinklocal start` auf dem Admin-Node |

---

## 8. Peer-Discovery (mDNS + Statisch)

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

## 9. Troubleshooting

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
5. TLS-Mismatch pruefen — siehe "Peer ohne TLS ignoriert" weiter unten
6. Multi-Interface-Problem — siehe "Mesh nicht gefunden trotz aktivem Daemon"

### Mesh nicht gefunden trotz aktivem Daemon (Multi-Interface, ADR-019)

Bei Hosts mit **mehreren aktiven Netzwerk-Interfaces** (z.B. MacBook mit
USB-Ethernet im LAN + WLAN + DMZ direkt an der Fritzbox) findet der Daemon
moeglicherweise keine Peers oder wird mit der falschen IP entdeckt.

**Symptom:** `mesh_status` zeigt `peers_online: 0` oder Peers werden mit IPs
aus dem falschen Subnet entdeckt (z.B. `host: "10.0.0.20"` statt `"10.10.10.55"`).

**Ursache:** `bonjour-service` published ohne explizite CIDR-Policy auf einem
beliebigen Interface und enthaelt ALLE lokalen IPs in den A-Records — Peers
versuchen sich dann ueber DMZ/WLAN-IPs zu verbinden, die nicht routbar sind
oder von der Mesh-CA nicht gedeckt werden.

**Fix:** Im `config/daemon.toml` die `allowed_mesh_cidrs` auf das Mesh-Subnet
beschraenken:

```toml
[discovery]
mdns_service_type = "_thinklocal._tcp"
allowed_mesh_cidrs = ["10.10.10.0/24"]
```

Oder via Env:
```bash
TLMCP_ALLOWED_MESH_CIDRS="10.10.10.0/24,192.168.1.0/24"
```

Mit dieser Policy:
- Daemon published mDNS nur auf Interfaces in den erlaubten CIDRs
- A-Records werden auf die Mesh-IP beschraenkt (Anti-Leakage)
- Empfangene Peers ausserhalb der CIDRs werden ignoriert (Anti-Reflector)
- Daemon-Restart noetig: `thinklocal restart`

Default-Excludes (immer aktiv): `docker*`, `tailscale*`, `utun*`, `veth*`,
`bridge*`, `br-*`, `tun*`, `tap*`, `awdl*`, `llw*`, `anpi*`, `ap*`, `gif*`,
`stf*`, `lo*`. Weitere via `exclude_interface_patterns` in der Config.

Siehe `docs/architecture/ADR-019-multi-interface-discovery.md` fuer Details.

### Peer ohne TLS ignoriert (requireTls)

Im LAN-Modus lehnt der Daemon Peers ab, die kein TLS sprechen.
Log-Meldung: `"Peer ohne TLS ignoriert (requireTls aktiv)"`

**Ursache:** Der Peer-Daemon laeuft mit `TLMCP_NO_TLS=1` (reines HTTP),
waehrend alle anderen Nodes mTLS erwarten.

**Fix auf dem betroffenen Peer:**

```bash
# Linux (systemd)
vi ~/.config/systemd/user/thinklocal-daemon.service
# Zeile "Environment=TLMCP_NO_TLS=1" entfernen
systemctl --user daemon-reload
systemctl --user restart thinklocal-daemon

# macOS (launchd — ADR-029 System-Domain-LaunchDaemon)
# TLMCP_NO_TLS Key aus /Library/LaunchDaemons/com.thinklocal.daemon.plist entfernen (sudo),
# danach den System-Domain-Service neu starten:
sudo launchctl kickstart -k system/com.thinklocal.daemon
# (Alt-Installation als per-User-LaunchAgent: Key aus ~/Library/LaunchAgents/com.thinklocal.daemon.plist
#  entfernen + launchctl kickstart -k gui/$(id -u)/com.thinklocal.daemon)
```

**Voraussetzung:** TLS-Zertifikate muessen existieren (`~/.thinklocal/tls/ca.crt.pem`,
`node.crt.pem`, `node.key.pem`). Falls nicht: `thinklocal bootstrap` oder
`ssh-bootstrap-trust.sh` ausfuehren.

**Wichtig:** `TLMCP_NO_TLS=1` ist nur fuer lokale Entwicklung gedacht —
niemals auf Nodes setzen, die am LAN-Mesh teilnehmen sollen.

### MCP-Tools funktionieren nicht (socket hang up)

Das MCP-stdio-Subprocess verbindet sich zum lokalen Daemon. Wenn der
Daemon mTLS spricht, muss die URL in der MCP-Config auf `https://` stehen.

**Symptom:** Alle `mcp__thinklocal__*` Tools liefern "socket hang up".

**Fix — `~/.mcp.json` pruefen:**

```json
{
  "mcpServers": {
    "thinklocal": {
      "env": {
        "TLMCP_DAEMON_URL": "https://localhost:9440"
      }
    }
  }
}
```

Falsch: `http://localhost:9440` (wenn Daemon mit TLS laeuft)
Richtig: `https://localhost:9440`

**Nach der Aenderung:** Claude Code (CLI oder Desktop) **neu starten** —
der MCP-Subprocess liest die Config nur beim Start.

### Nach Daemon-Neustart: Claude Code neu starten

Der MCP-Subprocess (`mcp-stdio.ts`) haelt eine persistente Verbindung
zum Daemon. Nach einem Daemon-Neustart (Service-Restart, Reboot, Crash)
muss Claude Code neu gestartet werden, damit sich der MCP-Subprocess
neu verbindet. Ohne Neustart liefern alle MCP-Tools "socket hang up".

```bash
# macOS: Daemon-Status pruefen (unabhaengig von Claude Code)
scripts/service.sh status

# Linux: Daemon-Status pruefen
systemctl --user status thinklocal-daemon

# Direkt testen (mTLS curl):
curl --insecure \
  --cert ~/.thinklocal/tls/node.crt.pem \
  --key ~/.thinklocal/tls/node.key.pem \
  --cacert ~/.thinklocal/tls/ca.crt.pem \
  https://localhost:9440/api/status
```

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

## 9a. Cron-Heartbeat aktivieren (ADR-004 Phase 1)

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

## 10. Claude Code Integration

Nach `thinklocal bootstrap` sind die MCP-Tools automatisch verfuegbar.

Teste in Claude Code:

```
"Welche Peers sind im Mesh?"
"Zeige mir die System-Health aller Nodes"
"Fuehre influxdb.query auf dem influxdb-Server aus"
```

---

## 11. Sicherheit

- **mTLS**: Verschluesselte Kommunikation zwischen allen Peers
- **SPAKE2 Pairing**: PIN-basierte Trust-Etablierung
- **Signierte Nachrichten**: ECDSA-Signatur pro Message
- **Credential Vault**: AES-256-GCM verschluesselt, OS-Keychain wenn verfuegbar
- **Audit-Log**: Signierte, append-only Ereignisprotokollierung

Mehr Details: [SECURITY.md](../SECURITY.md)
