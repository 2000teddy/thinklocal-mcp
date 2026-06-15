# RUNBOOK .55 — Pfad A: Tailscale-Bridge (AKTIVER Mesh-Weg) — Konfig-Diff + Apply

**Christian-Entscheidung (2026-06-15 11:31):** Pfad A (Tailscale) ist der **aktive** Mesh-Weg für .55; C2 zusätzlich als Hygiene.
**Tailscale-Peer-Inventur (2026-06-15 12:58, read-only):**

| Node | Tailscale | 100.x |
|------|:---:|------|
| .55 | ✅ | 100.88.169.84 |
| TH01/.80 | ✅ | 100.103.115.126 |
| TH02/.82 | ✅ | 100.72.14.63 |
| .94 | ✅ | 100.109.194.2 |
| .52 | ❌ kein tailscaled | — |
| .56 | ❌ | — |
| .222 | ❌ | — |

→ **.55 erreicht heute 3 Peers über Tailscale (TH01/TH02/.94) → `peers_online=3`.** Für volle 6: `.52/.56/.222` brauchen erst `tailscale up` (Schritt 1, Produktiv-Gate). Funktional ist .55 schon mit 3 im Mesh (Caps propagieren transitiv via CRDT); alle 6 Peers SEHEN .55 ohnehin via LAN-inbound.
**Ziel:** .55s CORE-Mesh (HTTP-Plane :9440 — count/gossip/registry-sync) über **Tailscale 100.x** statt über das defekte LAN. **Reversibel, KEINE .55-Netzstack-Eingriffe.**
**Verifiziert config-only (kein Code):** .55→Peers via `static_peers → 100.x:9440` + `allowed_mesh_cidrs += 100.64.0.0/10`. mTLS/SPIFFE unverändert (Tailscale = nur Transport).

> 🚨 **HARTE LEITPLANKE:** .55-Netz/-Config NIEMALS blind per ssh anfassen (kappt evtl. den eigenen Zugang). **Apply ausschließlich durch Christian via Jump-Desktop-GUI.** Ich (Agent) bereite nur vor + verifiziere read-only.
> ⚠️ **Gates:** Tailscale-Install auf Peers (Vorbed.) + .55-Config-Apply + Peer-Config = **Produktiv-Gate (Christian), pro Schritt.** KEIN Reboot.

---
## A) Konfig-DIFF — `.55` `config/daemon.toml` (Jump-GUI editiert, Christian)

**`[discovery]` — vorher → nachher:**
```diff
  [discovery]
- allowed_mesh_cidrs = ["10.10.10.0/24"]
+ allowed_mesh_cidrs = ["10.10.10.0/24", "100.64.0.0/10"]   # Tailscale CGNAT zulassen

+ # .55→Peers über Tailscale statt über das tote LAN. 100.x aus der Inventur oben.
+ # HEUTE verfügbar (3 Peers mit Tailscale):
+ [[discovery.static_peers]]
+ host = "100.103.115.126"   # TH01/.80
+ port = 9440
+ [[discovery.static_peers]]
+ host = "100.72.14.63"      # TH02/.82
+ port = 9440
+ [[discovery.static_peers]]
+ host = "100.109.194.2"     # .94
+ port = 9440
+ # NACH `tailscale up` auf .52/.56/.222 deren 100.x hier ergänzen → peers_online 3→6.
```

**`[libp2p]` — announce 100.x (optional, libp2p-Plane):**
```diff
  [libp2p]
- announce_multiaddrs = ["/ip4/10.10.10.55/tcp/9540"]
+ announce_multiaddrs = ["/ip4/100.88.169.84/tcp/9540"]   # .55-Tailscale-IP
  # relay_transport_enabled = true (bereits an); relay_service_enabled = false (Relay NICHT nötig für HTTP-Core, s.u.)
```
> Hinweis: announce_multiaddrs wirkt auf die **libp2p-Plane (:9540)**, die aktuell mDNS-only ist (kein Bootstrap) → über Tailscale erst mit ADR-028-Code wirksam. Harmlos jetzt, schadet nicht. Der **CORE läuft über die HTTP-Plane** (static_peers, oben).

**Durability:** `daemon.toml` ist git-getrackt → ein späterer `git pull` auf .55 setzt es zurück (wie das emit-Flag, das #170 committed-seitig löste). **Für dauerhaft: dieselben Werte als plist-Env** (`TLMCP_ALLOWED_MESH_CIDRS`, `TLMCP_STATIC_PEERS`, `TLMCP_LIBP2P_ANNOUNCE_ADDRS`) — überlebt pull. Variante B unten.

## 0. Vorbedingung — Tailscale-IPs der Peers (= Brocken B3, read-only)
Pro Peer den .55 erreichen soll: `tailscale ip -4` (dessen 100.x) bzw. zentral `tailscale status`. **Peer ohne Tailscale → `sudo tailscale up` (Produktiv-Gate).** Tabelle Peer→100.x füllen, in den Diff oben einsetzen.

## 1. Apply (Christian, Jump-GUI) — Variante A: daemon.toml
```bash
# .55-Terminal (Jump-GUI). Backup zuerst:
cp ~/Entwicklung_local/thinklocal-mcp/config/daemon.toml ~/daemon.toml.bak.$(date +%s)
# Diff oben einpflegen (Editor), dann Daemon neu laden:
launchctl kickstart -k gui/$(id -u)/com.thinklocal.daemon
sleep 14
```
## 1-alt. Apply — Variante B: plist-Env (durable, überlebt git pull)
```bash
PL=~/Library/LaunchAgents/com.thinklocal.daemon.plist
/usr/libexec/PlistBuddy -c "Add :EnvironmentVariables:TLMCP_ALLOWED_MESH_CIDRS string 10.10.10.0/24,100.64.0.0/10" "$PL" 2>/dev/null || /usr/libexec/PlistBuddy -c "Set :EnvironmentVariables:TLMCP_ALLOWED_MESH_CIDRS 10.10.10.0/24,100.64.0.0/10" "$PL"
/usr/libexec/PlistBuddy -c "Add :EnvironmentVariables:TLMCP_STATIC_PEERS string 100.103.115.126:9440,100.72.14.63:9440,100.109.194.2:9440" "$PL" 2>/dev/null || /usr/libexec/PlistBuddy -c "Set :EnvironmentVariables:TLMCP_STATIC_PEERS 100.103.115.126:9440,100.72.14.63:9440,100.109.194.2:9440" "$PL"
launchctl bootout gui/$(id -u)/com.thinklocal.daemon 2>/dev/null; launchctl bootstrap gui/$(id -u) "$PL"; sleep 14
```

## 2. Peer-Seite (bidirektional, damit Peers .55 auch über Tailscale erreichen) — Produktiv-Gate
.55 behält Mesh-IP=10.10.10.55/en10 → Peers erreichen .55 weiter **LAN-inbound** (funktioniert, nichts nötig). **Nur falls auch der LAN-inbound zu .55 ausfällt:** je Peer `.55`-Tailscale-IP `100.88.169.84:9440` in dessen `static_peers` + `100.64.0.0/10` in `allowed_mesh_cidrs`. (Auto-Announce von .55s 100.x für die HTTP-Plane bräuchte ADR-028 — utun-Exclude; deferred.)

## 3. Verify (read-only, darf ich)
```bash
# auf .55:
curl -sk --cert ~/.thinklocal/tls/node.crt.pem --key ~/.thinklocal/tls/node.key.pem https://127.0.0.1:9440/api/status | grep -oE '"peers_online":[0-9]+|"agent_id":"[^"]*"'
# Erwartung HEUTE: peers_online → 3 (TH01/TH02/.94), agent_id = ...node/12D3KooWJSg... ; → 6 nach tailscale up auf .52/.56/.222.
# Orchestrator-Gegenprobe je Peer: /api/peers → .55 (node/12D3KooWJSg) online + registry_sync converged.
```

## 4. Rollback (reversibel, kein Reboot)
- Variante A: Backup `daemon.toml.bak.*` zurückkopieren → kickstart.
- Variante B: `PlistBuddy -c "Delete :EnvironmentVariables:TLMCP_STATIC_PEERS"` (+ ALLOWED_MESH_CIDRS) → bootout/bootstrap.

## Relay / Grenzen
- **Relay NICHT nötig:** Circuit-Relay hilft nur der libp2p-Plane, nicht dem HTTP-Core; über Tailscale redundant (CO-Konsens). `relay_service_enabled` bleibt false.
- **libp2p-over-Tailscale = deferred** (ADR-027 §B/§deferred): mDNS-only + getPeerId-Bug; nur als bewusstes Feature.
- Pfad A + C2 kombinierbar: A = aktiver Weg/Resilienz, C2 = LAN-native-Hygiene (separates Runbook).

## Definition of Done
- **Heute (config-only, 3 Tailscale-Peers):** .55 `peers_online=3` (TH01/TH02/.94, canonical node/12D3KooWJSg), diese 3 + LAN-inbound-Peers sehen .55 online + registry_sync converged — ohne Konsole/Reboot, reversibel.
- **Voll (nach `tailscale up` auf .52/.56/.222 + deren 100.x ergänzt):** .55 `peers_online=6`.
