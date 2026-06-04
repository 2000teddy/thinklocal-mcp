---
name: iobroker-mesh-fix-2026-05-17
description: Fix: ioBroker Node war unsichtbar im Mesh wegen TLS + mcp.json URL
metadata:
  type: project
---

# Fix: ioBroker Mesh-Node nicht sichtbar (2026-05-17)

## Problem
ioBroker (10.10.10.52) war im mesh_status nicht sichtbar. `discover_peers` zeigte 0 Peers obwohl andere Nodes im LAN aktiv waren.

## Ursachen

**1. `~/.mcp.json` — falsche URL**
```json
"TLMCP_DAEMON_URL": "http://localhost:9440"  // FALSCH
```
Der MCP-Client versuchte unverschlüsselt zu verbinden, der Daemon (mit mTLS) lehnte ab.

**2. systemd Service — `TLMCP_NO_TLS=1`**
```
~/.config/systemd/user/thinklocal-daemon.service
Environment=TLMCP_NO_TLS=1  // Blockierte TLS komplett
```
TLS-Zertifikate existierten in `~/.thinklocal/tls/` wurden aber nicht benutzt.

## Fixes durchgeführt

### 1. MCP Config korrigiert
```bash
# Datei: ~/.mcp.json
"TLMCP_DAEMON_URL": "https://localhost:9440"  # http:// → https://
```

### 2. systemd Service korrigiert
```bash
# Datei: ~/.config/systemd/user/thinklocal-daemon.service
# Zeile "Environment=TLMCP_NO_TLS=1" entfernt
```

### 3. Zombie-Prozess auf Port 9540
```bash
fuser -k 9540/tcp
systemctl --user daemon-reload
systemctl --user restart thinklocal-daemon
```

## Ergebnis
- `tls_enabled: true`
- `peers_online: 3` (ai-n8n, influxdb, minimac-7)

## Betroffene Nodes im Mesh
| Node | IP | TLS |
|------|----|-----|
| iobroker | 10.10.10.52 | ✅ jetzt aktiv |
| ai-n8n | 10.10.10.222 | ✅ |
| influxdb | 10.10.10.56 | ✅ |
| minimac-7 | 10.10.10.94 | ✅ |