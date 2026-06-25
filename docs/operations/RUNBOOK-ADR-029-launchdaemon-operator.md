# RUNBOOK — ADR-029 macOS LaunchDaemon (Operator-Sequenz)

**Status:** Repo-only. Vor-Ort-Termin (Christian) — KEIN Live-Install ohne Christians Go.
**Bezug:** [ADR-029](../architecture/ADR-029-macos-launchdaemon.md), [INSTALL.md](../../INSTALL.md) (macOS-Abschnitt), PR #196 (Renderer + Install-Plan, deploy-frei).
**Zielgruppe:** Christian (Operator am Mac, Vor-Ort-Termin) · Hermes (Verifikation) · ggf. zweite Hand.
**Geltungsbereich:** macOS-Hosts mit `thinklocal-mcp`-Daemon (Install über `scripts/install.sh`).

> **Was die Doku vorher hatte:** `INSTALL.md` nennt Install-Befehl und Steuer-Kommandos, aber **nicht** die Pre-Flight-Validierungen, die Reihenfolge der Operator-Schritte, die Smoke-Tests gegen den frisch gebootstrappten Daemon, oder den Rollback-Pfad. Dieses Runbook schließt die Lücke. Es ist **rein dokumentarisch** — kein Live-Schritt wird hier ausgeführt.

---

## 0 · Voraussetzungen

| # | Was | Wie prüfen |
|---|-----|------------|
| 0.1 | macOS, getestet auf 14+ Sonoma / 15+ Sequoia | `sw_vers` |
| 0.2 | Node.js 22+ installiert und auf PATH | `node -v` (≥ `v22.0.0`) |
| 0.3 | Repo-Checkout auf `main` (oder gewünschtem Pin) | `git -C ~/thinklocal-mcp rev-parse --abbrev-ref HEAD` |
| 0.4 | Letzter Installer-PR (#196) gemergt | `git -C ~/thinklocal-mcp log --oneline -1` zeigt `f6354dd` oder neuer |
| 0.5 | `~/thinklocal-mcp` vorhanden (geklont) | `ls -d ~/thinklocal-mcp` |
| 0.6 | Admin-Zugang via `sudo` (nicht root-Login) | `id -un` ≠ `root`, `sudo -n true` ohne Passwort-Prompt oder mit bekanntem Passwort |
| 0.7 | **Vorautorisiert** (Gate-Kontext): Operator-Sequenz dieser Doku ist im aktuellen Wochenplan freigegeben | `WOCHENPLAN-KW<nn>.md` §1 / §3 für die betreffende KW prüfen |

**Blocker-Hinweis (0.6):** `scripts/install.sh` bricht mit Exit 1 ab, wenn der Lauf-Nutzer root wäre (`SUDO_USER` muss gesetzt sein, siehe Code `install.sh:295-300`). Bei root-Session: erst `exit`, dann als normaler Nutzer mit `sudo` neu anmelden.

---

## 1 · Pre-Flight (vor dem ersten `sudo`-Schritt)

Diese Checks **vor** dem Install ausführen — sind sie rot, **nicht** installieren, sondern erst fixen.

### 1.1 FileVault-Status

```bash
fdesetup status
```

- **Erwartet:** `FileVault is On.` oder `FileVault is Off.`
- **Wenn `Off` und der Mac headless laufen soll:** FileVault aktivieren (Reboot, Unlock-Recovery-Key notieren!) **vor** dem Install — sonst startet der LaunchDaemon zwar nach Reboot, aber der Nutzer-Keychain-Unlock ist ein harter Blocker.
- **Wenn `On`:** sicherstellen, dass ein Unlock-Verfahren dokumentiert ist (Passwort oder Recovery-Key) — sonst strandet der Mac nach Reboot.

### 1.2 Service-Benutzer vorhanden?

ADR-029 empfiehlt einen **dedizierten Benutzer** (NICHT root). Auf einem frischen Mac existiert dieser in der Regel **noch nicht**.

```bash
# Existiert der dedizierte Benutzer?
dscl . -list /Users | grep -i thinklocal || echo "NO_SERVICE_USER"
# Existiert die dedizierte Gruppe?
dscl . -list /Groups | grep -i thinklocal || echo "NO_SERVICE_GROUP"
```

- **Wenn `NO_SERVICE_USER` / `NO_SERVICE_GROUP`:** vor dem Install anlegen (siehe Anhang A). **Nicht** mit dem eigenen Account arbeiten — der Daemon soll unter dem dedizierten Nutzer laufen.
- **Wenn vorhanden:** Passwort-Status prüfen — der Daemon startet ohne Passwort-Prompt, aber `security unlock-keychain`-Schritte müssen ggf. vorbereitet sein.

### 1.3 Port 9440 frei?

```bash
lsof -nP -iTCP:9440 -sTCP:LISTEN || echo "PORT_FREE"
```

- **Erwartet:** `PORT_FREE` (kein Output von `lsof`).
- **Wenn belegt:** herausfinden wer (`lsof -nP -iTCP:9440`), entscheiden — entweder stoppen oder `TLMCP_PORT` anpassen (siehe INSTALL.md Env-Vars).

### 1.4 Kein alter LaunchAgent aktiv

ADR-029 bringt eine Legacy-Migration mit, aber **vor** dem ersten System-Domain-Install prüfen, ob noch ein alter LaunchAgent läuft — sonst Doppelstart.

```bash
launchctl list | grep -i thinklocal || echo "NO_LEGACY_AGENT"
ls -la ~/Library/LaunchAgents/com.thinklocal.daemon.plist 2>/dev/null || echo "NO_LEGACY_PLIST"
```

- **Wenn `NO_LEGACY_AGENT` + `NO_LEGACY_PLIST`:** sauber, weiter mit §2.
- **Wenn Agent läuft oder Plist existiert:** der Installer in §2 macht die Migration automatisch (siehe Code `install.sh:238-241`). Trotzdem: vor dem Install den alten Agent **manuell unloaden**, damit der Installer ohne Race bootet:

  ```bash
  launchctl unload ~/Library/LaunchAgents/com.thinklocal.daemon.plist 2>/dev/null
  ls ~/Library/LaunchAgents/com.thinklocal.daemon.plist && rm -v ~/Library/LaunchAgents/com.thinklocal.daemon.plist
  ```

### 1.5 Repo sauber, Installer trocken prüfbar

```bash
cd ~/thinklocal-mcp
git status --porcelain | wc -l   # 0 = sauber
bash -n scripts/install.sh && echo "INSTALL_SH_SYNTAX_OK"
```

- **Erwartet:** `0` und `INSTALL_SH_SYNTAX_OK`.
- **Wenn Repo nicht sauber:** erst committen/stashen — der Installer nutzt den Working-Tree.

---

## 2 · Operator-Sequenz (Install / Update / Uninstall)

Die Sequenz ist **idempotent** — sie kann zum Update erneut laufen, ohne dass eine bestehende Installation stört. `install.sh` macht intern `cleanup_existing` + alten LaunchAgent unload + neuen LaunchDaemon bootstrap.

### 2.1 Install (Erstinstallation oder Update)

```bash
cd ~/thinklocal-mcp
./scripts/install.sh
```

Was passiert (siehe Code-Kommentare + `launchd-plist.ts` `buildLaunchDaemonInstallPlan`):

1. `cleanup_existing` — versucht einen vorhandenen System-LaunchDaemon sauber zu stoppen + alte Plist zu entfernen.
2. `install_macos_service` (macOS-Zweig):
   - rendert `scripts/service/com.thinklocal.daemon.plist.template` per `sed` mit den in §0/§1 geprüften Werten,
   - **fail-closed Placeholder-Guard** gegen verbliebene `{{…}}` oder `__…__`,
   - schreibt nach `/Library/LaunchDaemons/com.thinklocal.daemon.plist` mit `root:wheel`/`644`,
   - `sudo launchctl bootstrap system /Library/LaunchDaemons/com.thinklocal.daemon.plist`,
   - integriert die Legacy-Migration (`launchctl unload` alter LaunchAgent).
3. **NICHT ausgeführte** Schritte (bewusst — out of scope dieses PRs): Anlage Service-Benutzer, Reboot, FileVault-Setup.

### 2.2 Steuern nach Install

```bash
sudo launchctl print system/com.thinklocal.daemon          # Status + letzte Exit-Info
sudo launchctl kickstart -k system/com.thinklocal.daemon   # Neustart (graceful)
sudo launchctl bootout system/com.thinklocal.daemon        # Stoppen + Bootstrap aufheben
sudo launchctl bootstrap system /Library/LaunchDaemons/com.thinklocal.daemon.plist   # (Re-)Bootstrap
tail -F ~/.thinklocal/logs/daemon.log                       # Live-Log mitlesen
tail -F ~/.thinklocal/logs/daemon.error.log                 # Fehler-Stream
```

### 2.3 Uninstall

```bash
cd ~/thinklocal-mcp
sudo ./scripts/install.sh --uninstall
# Oder manuell:
sudo launchctl bootout system/com.thinklocal.daemon
sudo rm -f /Library/LaunchDaemons/com.thinklocal.daemon.plist
launchctl unload ~/Library/LaunchAgents/com.thinklocal.daemon.plist 2>/dev/null || true
rm -f ~/Library/LaunchAgents/com.thinklocal.daemon.plist
rm -rf ~/thinklocal-mcp ~/.thinklocal
# Optional: ~/.mcp.json anpassen (thinklocal-Eintrag entfernen)
```

---

## 3 · Smoke-Tests (direkt nach §2.1)

Nach erfolgreichem Bootstrap **muss** der Daemon antworten. Reihenfolge von unten nach oben.

### 3.1 Prozess vorhanden?

```bash
launchctl list | grep com.thinklocal.daemon
```

**Erwartet:** Zeile mit Status `0` (oder positive PID), nicht `255` oder `-`.

### 3.2 Port lauscht?

```bash
lsof -nP -iTCP:9440 -sTCP:LISTEN
```

**Erwartet:** ein Node-Prozess (`tsx` oder `node`) auf Port 9440.

### 3.3 Health-Endpoint antwortet?

```bash
curl -fsS --max-time 5 http://localhost:9440/health | jq .
```

**Erwartet:** JSON mit `"status":"ok"` und `"timestamp":"<ISO-8601>"`.

### 3.4 Status-API detailliert

```bash
curl -fsS --max-time 5 http://localhost:9440/api/status | jq .
```

**Erwartet:** Felder `pid`, `uptimeSeconds`, `runtimeMode`, ggf. `mesh`/`peers` (im `lan`-Modus echte Peers, im `local`-Modus leer).

### 3.5 CLI-Probe (falls Repo noch da)

```bash
cd ~/thinklocal-mcp
npm run tlmcp -- status
```

**Erwartet:** Tabelle mit Daemon-Version, Mode, Peer-Anzahl.

### 3.6 Log-Glitch-Check

```bash
grep -iE 'error|fatal|panic|traceback' ~/.thinklocal/logs/daemon.error.log | tail -20 || echo "NO_ERROR_LOG_ENTRIES"
```

**Erwartet:** entweder `NO_ERROR_LOG_ENTRIES` oder bekannte/akzeptable Warnings (z.B. mDNS-Auflösung in rein-IPv4-LAN). Unbekannte Einträge → eskalieren, nicht stillschweigend weitermachen.

### 3.7 MCP-Verfügbarkeit in Claude Code

In einer frischen Claude-Code-Session:

```
> Welche MCP-Server sind verfügbar? Nutze mesh_status aus thinklocal.
```

**Erwartet:** `thinklocal` taucht in der Server-Liste auf, `mesh_status` liefert denselben Stand wie §3.4.

---

## 4 · Reboot-Test (FileVault-Sicherheit)

**Nur** auf Maschinen, die headless über Reboot laufen sollen (z.B. `.55`).

1. `sudo shutdown -r now`
2. Nach FileVault-Unlock (Passwort-Entry am Bildschirm ODER Remote-Recovery-Key via `fdesetup`/`diskutil`) warten, bis SSH erreichbar ist.
3. `launchctl print system/com.thinklocal.daemon` → **erwartet:** Daemon wurde durch `RunAtLoad=true` gestartet, `last exit code: 0` oder leer.
4. Smoke-Tests aus §3.1–§3.5 wiederholen.

**Wenn nach Reboot der Daemon nicht läuft:** siehe §5 Rollback.

---

## 5 · Rollback-Pfad

Wenn der Install oder ein Update den Mac in einen schlechten Zustand bringt:

### 5.1 Schneller Rollback auf alten LaunchAgent (wenn vorhanden)

```bash
sudo launchctl bootout system/com.thinklocal.daemon
sudo rm -f /Library/LaunchDaemons/com.thinklocal.daemon.plist
# alten LaunchAgent wieder laden
launchctl load ~/Library/LaunchAgents/com.thinklocal.daemon.plist 2>/dev/null || echo "NO_LEGACY_AGENT_TO_RESTORE"
```

### 5.2 Vollständiger Rollback auf Repo-Stand vor #196

```bash
cd ~/thinklocal-mcp
git fetch origin
git checkout <commit-vor-adr-029-merge>   # f6354dd oder den letzten Stand davor
sudo ./scripts/install.sh --uninstall
git checkout main
# Dann v0.34.23 oder früheren Tag installieren (siehe CHANGES.md)
```

### 5.3 Datenverlust-Rollback (letzter Ausweg)

```bash
sudo ./scripts/install.sh --uninstall
rm -rf ~/.thinklocal             # Vorsicht: löscht Vault, Audit-Log, Pairing-Keys!
# Repo und Config bleiben; nur State-Daten weg.
```

> **Achtung:** Schritt 5.3 löscht alle Pairing-Pins, Vault-Credentials und Audit-Logs. Nur nach Rücksprache mit Christian ausführen. Vorher `~/.thinklocal/audit/` und `~/.thinklocal/vault/` sichern.

---

## 6 · Verifikation für Hermes (remote)

Nach Christians Vor-Ort-Bericht kann Hermes von TH01 aus Folgendes tun, **ohne** sich am Mac einzuloggen:

```bash
# Über Tailscale-IP des Ziel-Macs (Beispiel .55):
curl -fsS --max-time 5 http://100.x.y.z:9440/health
curl -fsS --max-time 5 http://100.x.y.z:9440/api/status | jq .
# Im lan-Modus zusätzlich:
curl -fsS --max-time 5 https://100.x.y.z:9440/api/peers | jq .
```

**Erwartet:** dieselben Antworten wie in §3.3/§3.4 lokal. Wenn nicht: §5 Rollback-Pfad vorschlagen, nicht eigenmächtig handeln.

---

## 7 · Bekannte Limitierungen / Out-of-Scope

| # | Was | Wer kümmert sich | Wann |
|---|-----|------------------|------|
| 7.1 | Dedizierter Service-Benutzer (`thinklocal-mcp`) sauber angelegt | Infra / Christian | Vor diesem Runbook-Termin |
| 7.2 | Service-Benutzer in SSH-/Sudo-Whitelist aufnehmen (für Updates ohne Passwort-Prompt) | Infra | KW27-Folge |
| 7.3 | `INSTALL.md` Linux-Pfad hat noch kein äquivalentes Operator-Runbook | ThinkLocal-Agent | KW26-Folge |
| 7.4 | FileVault-Recovery-Key-Doku pro Host | Christian | Eigenständig |

---

## Anhang A · Service-Benutzer anlegen (Beispiel macOS)

```bash
# Als Admin mit sudo:
SERVICE_USER="thinklocal-mcp"
SERVICE_UID="555"          # frei wählbar, 555 ist nur Beispiel
SERVICE_GROUP="thinklocal-mcp"

# Gruppe anlegen
sudo dscl . -create /Groups/$SERVICE_GROUP
sudo dscl . -create /Groups/$SERVICE_GROUP PrimaryGroupID $SERVICE_UID

# Benutzer anlegen
sudo dscl . -create /Users/$SERVICE_USER
sudo dscl . -create /Users/$SERVICE_USER UniqueID $SERVICE_UID
sudo dscl . -create /Users/$SERVICE_USER PrimaryGroupID $SERVICE_UID
sudo dscl . -create /Users/$SERVICE_USER UserShell /usr/bin/false      # kein Login
sudo dscl . -create /Users/$SERVICE_USER NFSHomeDirectory /var/empty/$SERVICE_USER
sudo dscl . -create /Users/$SERVICE_USER IsHidden 1

# Home minimal anlegen (manche macOS-Tools erwarten es)
sudo mkdir -p /var/empty/$SERVICE_USER
sudo chown $SERVICE_USER:$SERVICE_GROUP /var/empty/$SERVICE_USER
sudo chmod 555 /var/empty/$SERVICE_USER

# Datenverzeichnis (Vault, Logs, Audit) vorbereiten
sudo mkdir -p /var/lib/thinklocal-mcp/{logs,audit,vault}
sudo chown -R $SERVICE_USER:$SERVICE_GROUP /var/lib/thinklocal-mcp
sudo chmod 750 /var/lib/thinklocal-mcp
```

> **Nicht** vergessen: in `install.sh` bzw. der Plist-Template den `RUN_USER`/`RUN_GROUP` auf `$SERVICE_USER`/`$SERVICE_GROUP` setzen — siehe [INSTALL.md](../../INSTALL.md) macOS-Abschnitt.

---

## Anhang B · Referenzen

- [ADR-029](../architecture/ADR-029-macos-launchdaemon.md) — Designentscheidung
- [INSTALL.md](../../INSTALL.md) — Endnutzer-Doku (Install + Steuerung)
- PR #196 — Renderer + Install-Plan (deploy-frei)
- PR #192 — Template + Render-Kern (Vorgänger)
- [CHANGES.md](../../CHANGES.md) v0.34.24 — Release-Note zum Installer-Umbau
- [RUNBOOK-55-A-tailscale-bridge.md](../RUNBOOK-55-A-tailscale-bridge.md) — Pfad-A-Tailscale-Bridge (anderer Use-Case, vergleichbare Operator-Disziplin)
- [REENROLL-55-RUNBOOK.md](../REENROLL-55-RUNBOOK.md) — ADR-024-Gate-konformes Re-Enroll-Runbook
