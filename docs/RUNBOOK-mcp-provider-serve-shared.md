# RUNBOOK — MCP-Provider aktivieren (`serve_shared` + local-exec)

Stand: 2026-07-10 · verifiziert am TL07/Kap.-7.7-tools/call-Beweis (Owner TH01, Client .52).
Bezug: ADR-028-D4 (mcp-service-registry), ADR-032 (Phantom-Announce-Guard), PR #253/#254
(local-exec-Naht + reale `mcporter`-Primitive). Beweis-Report:
`hermes/reports/2026-07-10_0805_TL07-toolscall-GREEN-proof.md`.

Dieses Runbook beschreibt, wie ein Node zum **MCP-Provider** wird: er announced seine
`[[mcp.share]]`-Server ins Mesh (`serve_shared=true`) und serviert eingehende `tools/call`/
`tools/list` **lokal via `mcporter`** (Owner-Seite). Ohne diese Schritte antwortet
`/api/mcp/<server>` mit **503** („kein Provider registriert").

## Voraussetzungen (Owner-Node)

1. `mcporter` installiert und die Ziel-Server (z.B. `unifi`) in `~/.mcporter/mcporter.json`
   konfiguriert. Prüfen (read-only):
   ```bash
   which mcporter                 # z.B. /home/chris/.npm-global/bin/mcporter
   mcporter list <server> --json  # exit 0 + Tool-Liste erwartet
   ```
2. Der Server ist im `[mcp]`-Block der `config/daemon.toml` als `[[mcp.share]]` deklariert
   (Name, `description`, `permissions`, `trust_level`).

## Schritt 1 — `serve_shared=true` + PATH setzen (systemd --user Drop-in)

Empfohlen als reversibles Drop-in (keine Änderung an der versionierten `config/daemon.toml`):

```bash
mkdir -p ~/.config/systemd/user/thinklocal-daemon.service.d
cat > ~/.config/systemd/user/thinklocal-daemon.service.d/serve-shared.conf <<'EOF'
[Service]
Environment=TLMCP_MCP_SERVE_SHARED=1
Environment=PATH=/home/chris/.npm-global/bin:/home/chris/.nvm/versions/node/v22.22.3/bin:/usr/local/bin:/usr/bin:/bin
EOF
systemctl --user daemon-reload
systemctl --user restart thinklocal-daemon.service
```

### ⚠️ PFLICHT: `mcporter`-Verzeichnis in der Daemon-PATH

Der Daemon startet unter einer **restriktiven** systemd-Unit-PATH
(`…/nvm/…/bin:/usr/local/bin:/usr/bin:/bin`), die `~/.npm-global/bin` **nicht** enthält.
Der Owner-local-exec ruft `mcporter` per `execFile('mcporter', …)` über die PATH auf. Fehlt
das Verzeichnis, schlägt der Spawn mit **ENOENT** fehl und der `tools/call` liefert:

```json
{"status":502,"body":{"error":"mcporter exec failed","server":"<server>","detail":""}}
```

Das **leere `detail`** ist die Signatur dieses PATH-Problems (kein stderr, weil das Binary
gar nicht startet). Deshalb erweitert das Drop-in oben die PATH um
`/home/chris/.npm-global/bin` (bzw. das Ergebnis von `which mcporter`, Verzeichnis-Teil).
Alternative: absoluter mcporter-Pfad als künftige Config-Option statt PATH-Zusatz.

## Schritt 2 — Registrierung verifizieren

```bash
systemctl --user is-active thinklocal-daemon.service     # active
# via lokalen Daemon-Proxy (eigenes mTLS-Client-Cert):
curl -sk --cert ~/.thinklocal/tls/node.crt.pem --key ~/.thinklocal/tls/node.key.pem \
  "https://localhost:9440/api/capabilities?category=mcp"  # enthält skill_id "mcp:<server>"
```
`mcp_list_servers` (MCP-Tool) zeigt den/die Server mit `health:"healthy"`, Owner = eigene Node-ID.

## Schritt 3 — tools/call verifizieren (Owner-lokal, dann Cross-Host)

Owner-lokal (auf dem Provider selbst — echte Tool-Namen aus `mcporter list <server>`):
```bash
curl -sk --cert ~/.thinklocal/tls/node.crt.pem --key ~/.thinklocal/tls/node.key.pem \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"<tool>","arguments":{}}}' \
  https://localhost:9440/api/mcp/<server>          # HTTP 200 + {jsonrpc,id,result}
```
Cross-Host (von einem anderen Node als Client → Forward an den Owner): identischer curl auf
dem Client-Node nach CRDT-Konvergenz. Erwartete **beidseitige** Audit-Events:
- Client: `MCP_FORWARD_TX` (→ Owner) + `MCP_PROXY_RX status=200 hop=0`
- Owner:  `MCP_EXEC_LOCAL` + `MCP_PROXY_RX status=200 hop=1`

Hinweis: Die Tool-Namen im `[[mcp.share]]`-`description`-Feld sind nur Doku und müssen NICHT
den echten mcporter-Tool-Namen entsprechen — maßgeblich ist `mcporter list <server>`.

## Schritt 4 — Rollback (reversibel)

```bash
rm ~/.config/systemd/user/thinklocal-daemon.service.d/serve-shared.conf
systemctl --user daemon-reload && systemctl --user restart thinklocal-daemon.service
# Danach: /api/mcp/<server> → 503 (kein Provider), Baseline wiederhergestellt.
```

## ⚠️ Sicherheit — Secrets in der mcporter-Config

`~/.mcporter/mcporter.json` kann Server-Credentials im **Klartext** enthalten (verifiziert:
TH01 führt dort `UNIFI_API_KEY` im Klartext). Empfehlung:
- Den betroffenen Key **rotieren**, falls die Datei/Logs/Transcripts je geteilt wurden.
- Datei-Rechte restriktiv halten (`chmod 600 ~/.mcporter/mcporter.json`).
- Keys nie in Code/Tests/PRs/Reports übernehmen.
Dies ist Operator-Hygiene, kein Daemon-Code-Thema.
