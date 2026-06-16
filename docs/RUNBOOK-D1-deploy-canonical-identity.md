# RUNBOOK — D1-Deploy (kanonische Identität) + #175 getPeerId, mesh-weit

**Zweck:** Die in `main` gemergten Fixes **#178 (ADR-028 D1 — kanonische `node/<PeerID>`-Adressierung)** + **#175 (getPeerId/dialProtocol — Registry-Sync-Konvergenz)** auf allen Mesh-Nodes live schalten — per **Daemon-RESTART**, **NICHT Maschinen-Reboot**, reversibel.

> 🚨 **AUSFÜHRUNG = Christians ausdrückliches Wort.** Dieser Runbook ist **trockengeprüft, read-only vorbereitet**. Der Restart ist mesh-weit; Christian soll erreichbar sein (FileVault auf macOS-Nodes .55/.94). Agent führt **nichts** davon ohne explizites Go aus.

**Stand (Trockenprüfung 2026-06-16 22:09):**
- `origin/main` enthält beide Fixes: `91f6bea` (#178 D1) und `4b55f69` (#175 getPeerId). Inhalt verifiziert (`spiffe-uri.ts` trägt `kind:'node'` + `PEERID_REGEX`).
- TH01 läuft Daemon **via `tsx` direkt auf `src/index.ts`** (systemd --user `thinklocal-daemon.service`, WorkingDir `/opt/thinklocal-mcp`) → **kein `npm run build` nötig**, `git pull` + restart genügt. Laufender Build vor Deploy: `0.34.10` (`a804f2f`).
- Andere Nodes können von dist laufen → dort zusätzlich `npm run build`. **Pro Node beim Apply verifizieren** (Schritt 0).

---
## 0. Pro-Node-Inventur (read-only, VOR dem Apply auszufüllen)
| Node | IP | OS | Daemon-Start | Build-Quelle |
|------|----|----|--------------|--------------|
| TH01 | 10.10.10.80 | Linux | systemd --user `thinklocal-daemon.service` | tsx/src (kein build) |
| TH02 | 10.10.10.82 | Linux | systemd --user (verifizieren) | tsx/src o. dist — prüfen |
| .94 (Orchestrator) | 10.10.10.94 | macOS | launchctl (verifizieren) | prüfen |
| .55 | 10.10.10.55 | macOS | launchctl `com.thinklocal.daemon` | tsx/src (build 0.34.9) |
| .52 / .56 / .222 | … | prüfen | prüfen | prüfen |

Pro Node feststellen (read-only):
```bash
# Linux:  systemctl --user cat thinklocal-daemon.service | grep -E 'ExecStart|WorkingDirectory'
# macOS:  /usr/libexec/PlistBuddy -c 'Print :ProgramArguments' ~/Library/LaunchAgents/com.thinklocal.daemon.plist
# laufender Build je Node:
curl -sk --cert ~/.thinklocal/tls/node.crt.pem --key ~/.thinklocal/tls/node.key.pem https://127.0.0.1:9440/api/status | grep -oE '"build_(version|number)":"[^"]*"'
# AKTUELLEN main-SHA des Node-Checkouts NOTIEREN (für Rollback):
git -C <repo> rev-parse HEAD
```

## 1. Reihenfolge (empfohlen)
1. **TH01 zuerst** (Sender meiner .94-Reports; Verifikation .94-Inbox hängt an TH01s D1).
2. **.94 (Orchestrator)** — danach, damit Registry-Konvergenz (#175) am Anker greift.
3. **TH02**, dann **.52/.56/.222**.
4. **.55 zuletzt** (kennt offenes Transport-Problem, s. §4 Grenzen).

> Rolling, ein Node nach dem anderen, mit Verifikation (§3) je Node. Kein Parallel-Big-Bang.

## 2. Apply pro Node (Christian) — RESTART, KEIN Reboot
```bash
# a) Backup-Anker: aktuellen SHA notieren (Rollback-Punkt)
OLD=$(git -C <repo> rev-parse HEAD); echo "ROLLBACK_SHA=$OLD"
# b) main holen
git -C <repo> fetch origin && git -C <repo> checkout main && git -C <repo> pull --ff-only
# c) NUR falls Node von dist läuft:
( cd <repo>/packages/daemon && npm run build )
# d) Daemon-RESTART (KEIN Maschinen-Reboot):
#   Linux:  systemctl --user restart thinklocal-daemon.service
#   macOS:  launchctl kickstart -k gui/$(id -u)/com.thinklocal.daemon
# e) ~15s warten, dann §3 verifizieren
```

## 3. Verifikation pro Node (read-only)
```bash
# (i) Build aktualisiert? build_number == kurzer main-SHA?
curl -sk --cert ~/.thinklocal/tls/node.crt.pem --key ~/.thinklocal/tls/node.key.pem https://127.0.0.1:9440/api/status | grep -oE '"build_(version|number)":"[^"]*"|"peers_online":[0-9]+'
```
**Mesh-weite Verifikation (nach TH01 + .94 Restart):**
- **(A) .94-Inbox wieder adressierbar (= D1-Kernbeleg, Fall B):** von TH01 eine Test-Nachricht an .94s **kanonische** `node/<PeerID>`-URI senden:
  ```bash
  curl -sk --cert ~/.thinklocal/tls/node.crt.pem --key ~/.thinklocal/tls/node.key.pem \
    -X POST https://127.0.0.1:9440/api/inbox/send -H 'Content-Type: application/json' \
    -d '{"to":"spiffe://thinklocal/node/12D3KooWJcpi2JgLp32w1SYpkixVQDRScBumirEVcu1taTBDBgTN","subject":"D1-deploy-verify","body":"D1 live - canonical addressing OK"}'
  ```
  **Erwartung VORHER (heute):** `{"error":"invalid target SPIFFE-URI ... got 2"}`. **NACHHER:** akzeptiert/zugestellt (kein normalize-Fehler). Gegenprobe auf .94: `read_inbox`/`/api/inbox?unread=true` zeigt die Nachricht.
- **(B) Registry-Konvergenz (#175):** `capabilities_count` über alle Nodes vergleichen (vor #175 drifteten sie 5/18/19/24/24/26):
  ```bash
  # je Node:
  curl -sk --cert … https://127.0.0.1:9440/api/status | grep -oE '"capabilities_count":[0-9]+'
  ```
  **Erwartung:** Counts konvergieren fleet-weit (gleich), kein `getPeerId is not a function` mehr in den Logs.

## 4. Rollback (reversibel, KEIN Reboot)
Pro Node, falls etwas hakt:
```bash
git -C <repo> checkout "$ROLLBACK_SHA"      # der in §0/§2a notierte SHA
( cd <repo>/packages/daemon && npm run build )   # nur falls dist-basiert
# Restart wie §2d
```
- Identitäts-/Adressierungs-Fix ist **additiv** (Legacy-Pfad byte-identisch) → Rollback risikoarm, kein Daten-/Schema-Migrationsschritt.
- macOS: falls `launchctl bootout`→`bootstrap` mit `5: I/O error` → bootstrap einmal wiederholen (Teardown-Race), dann hochkommt.

## 5. Grenzen / was D1 NICHT fixt (ehrlich)
- **.55-OUTBOUND-Reporting bleibt blockiert** bis **D2** (Transport): .55→Peers scheitert weiter an `EHOSTUNREACH` (en10) **und** `ERR_TLS_CERT_ALTNAME_INVALID` (Peer-Cert ohne 100.x-SAN, s. RUNBOOK-55-A / ADR-028 §L2). D1 macht nur die **Adressierung** kanonisch — nicht .55s Transport. .55s `peers_online` outbound bleibt daher 0; .55 wird von anderen Nodes weiter via LAN-inbound gesehen.
- **Anti-Spoofing-Bindung** (Cert-Principal ↔ `envelope.sender`) ist **D2b/D3**, nicht in diesem Deploy.
- Dieser Deploy stellt her: (1) kanonische `node/<PeerID>`-Adressierung fleet-weit (.94 erreichbar von gesunden Nodes), (2) Registry-Sync-Konvergenz (#175).

## Definition of Done (nach Christians Go + Apply)
- Alle Ziel-Nodes auf `main`-Build (build_number == main-SHA), per Restart, kein Reboot.
- (A) TH01→.94 kanonische Inbox-Nachricht zugestellt (Fall B behoben).
- (B) `capabilities_count` fleet-weit konvergiert, keine getPeerId-Fehler.
- Rollback-SHA je Node dokumentiert; bei Bedarf reversibel.
