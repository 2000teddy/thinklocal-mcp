# RUNBOOK .55 — Pfad C2: Netzkonfig-Reset + Reboot (Hygiene)

**Status:** VORBEREITET (final, 2026-06-15 14:42) — Ausführung nur auf Christians Wort, **pro Schritt**.
**Rolle:** C2 ist **Hygiene/LAN-native-Heilung**; der **aktive Mesh-Weg ist Pfad A** (Tailscale, `RUNBOOK-55-A-tailscale-bridge.md`) — Christian-Entscheidung 2026-06-15 11:31.
**Ziel:** .55s wedged macOS-Netzstack bereinigen → LAN-native Outbound zu Mesh-Peers OK → `peers_online=6` ohne Tailscale-Abhängigkeit. Siehe ADR-027 (Option C2).
**Interface-Audit (2026-06-14 20:15, Orchestrator):** 6 Geister-USB-LAN en1-en6 (inactive), Surfshark-WireGuard (eingetragen, läuft NICHT), 7 utun (aktiv nur en10 + utun4/Tailscale). Aktive Routing-Schicht = NUR en10 + utun4 → Geister/Surfshark sind **nicht die bewiesene aktive Ursache**, aber Cruft, den das saubere .94 nicht hat.

---
> 🚨 **HARTE LEITPLANKE — KEIN BLIND-SSH AUF .55-NETZ.** Netzwerk-Services/Routen/Interfaces auf .55 werden **NIEMALS per ssh** verändert — ein falscher Schritt kann die Netz-/SSH-Verbindung kappen und .55 unerreichbar machen. **Alle ändernden Schritte (1–3, 6) führt ausschließlich Christian via Jump-Desktop-GUI (lokales Terminal am .55-Desktop) aus.** Der Agent: nur Vorbereitung + read-only Verify (Schritt 0/4/5 read-only Teile).
>
> ⚠️ **Gates:**
> - Schritte 1–3 (Geister + Surfshark entfernen) = **Jump-GUI, sudo, OHNE Reboot/FileVault** — Christian.
> - Schritt 6 (Reboot/Dock-Power-Cycle) = **FileVault-Gate** — Christian, physisch/Jump, **separat freigeben**.

---
## 0. Bestandsaufnahme (read-only — zuerst, Jump-GUI oder read-only-ssh erlaubt)
```bash
networksetup -listallnetworkservices
networksetup -listnetworkserviceorder
ifconfig -a | grep -E '^[a-z]|status|inet '
netstat -rn -f inet | grep -E '10.10.10|UHLWIi|!'      # REJECT(!) / IFSCOPE'd host-routes?
scutil --nwi
systemextensionsctl list 2>/dev/null | grep -i surfshark
```
→ **Notieren:** exakte Service-Namen der Geister-USB-LAN (en1-en6) + ob Surfshark als Service/Extension gelistet ist.
> **NICHT anfassen:** en10 (aktives Dock-LAN), Wi-Fi, utun4 (Tailscale = aktiver Mesh-Weg Pfad A!).

## 1. Geister-USB-LAN-Services entfernen — Jump-GUI, KEIN Reboot (Christian)
Pro Geister-Service (NUR inaktive en1-en6-zugehörige):
```bash
sudo networksetup -removenetworkservice "<exakter Name aus Schritt 0>"
```
> Entfernt nur den Service-Eintrag (keine HW), reversibel via Systemeinstellungen / `networksetup -createnetworkservice`.

## 2. Surfshark entfernen — Jump-GUI, KEIN Reboot (Christian)
- Surfshark-App via deren Uninstaller deinstallieren (entfernt App + Network-/System-Extension + WireGuard-Profil).
- Falls als Netzwerk-Service gelistet: `sudo networksetup -removenetworkservice "Surfshark"`.
- Verify (read): `systemextensionsctl list | grep -i surfshark` → leer.

## 3. Stale utun-Tunnel — KEIN manuelles Eingreifen
utuns entstehen durch VPN-Apps; nach Surfshark-Uninstall (Schritt 2) verschwinden dessen utuns. **utun4 (Tailscale) NICHT antasten** (Pfad A!). Reboot regeneriert nur benötigte.

## 4. Zwischen-Verify OHNE Reboot — entscheidet, ob Schritt 6 nötig ist (read-only)
```bash
netstat -rn -f inet | grep -E '10.10.10|!'             # REJECT/IFSCOPE weg?
cd ~/Entwicklung_local/thinklocal-mcp/packages/daemon
/Users/chris/.nvm/versions/node/v22.22.3/bin/node -e "import('node:net').then(n=>{for(const ip of['94','80','52']){const s=n.connect({host:'10.10.10.'+ip,port:9440},()=>{console.log('.'+ip+' OUTBOUND OK');s.end()});s.on('error',e=>console.log('.'+ip+' '+e.code));s.setTimeout(5000,()=>{console.log('.'+ip+' TIMEOUT');s.destroy()})}})"
```
- **Alle OUTBOUND OK ohne Reboot →** Schritt 6 entfällt, weiter zu 5.
- **Noch EHOSTUNREACH →** Schritt 6 (Reboot) nötig.

## 5. Daemon-Verify (read-only)
```bash
T=~/.thinklocal/tls
curl -sk --cert $T/node.crt.pem --key $T/node.key.pem https://127.0.0.1:9440/api/status | grep -oE '"peers_online":[0-9]+|"agent_id":"[^"]*"'
# Erwartung: peers_online steigt; agent_id = ...node/12D3KooWJSg...
# Daemon nicht geladen? (per-user launchd):  launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.thinklocal.daemon.plist
```

## 6. Reboot — **NUR mit Christian (FileVault-Gate), separat freigeben**
```bash
sudo reboot
# nach Boot + FileVault-Unlock: Schritt 4 (net.connect) + Schritt 5 (peers_online) erneut.
```

## 7. Rollback / Eskalation
- Versehentlich falschen Service entfernt → Systemeinstellungen / `networksetup -createnetworkservice` wiederherstellen.
- **C2 hält nicht** (EHOSTUNREACH rekurriert nach Stunden) → Wurzel = Dock-HW → **Eskalation C1** (WD-D50 ersetzen / .55 auf stabile NIC). ADR-027.
- **Unabhängig davon bleibt Pfad A (Tailscale) der aktive Mesh-Weg** — C2 verbessert nur den LAN-nativen Pfad; A ist nicht betroffen (utun4 unangetastet).

## Definition of Done
.55 LAN-native Outbound zu Peers OK (`node net.connect` + `peers_online`), hält ≥ mehrere Stunden ohne Re-Vergiftung. (Hält's nicht → C1.) Pfad A bleibt parallel als Resilienz/Fallback aktiv.
