# ADR-020 Phase 1.1 — Bug Report (Live-Befund 2026-05-19)

**Status:** Teil-implementiert — Bug #1 gefixt in [PR #135](https://github.com/2000teddy/thinklocal-mcp/pull/135) (2026-05-19 22:07 Berlin, MacBook-Pro-Claude). Bugs #2, #3, #4 offen.
**Autor:** Mac mini Claude Code Session (host 69bc0bc908229c9f), in Koordination mit influxdb-Claude (68f7cd8e) und ioBroker-Claude (b4768fe0)
**Datum:** 2026-05-19 21:54 Berlin (Erstaufnahme), 22:22 Berlin (Update mit PR-#135-Hinweis)
**Verwandt:** [ADR-020 Registry Replication Recovery](./ADR-020-registry-replication-recovery.md), [ADR-019 Phase 1.1 Bind-Hotfix](./ADR-019-multi-interface-discovery.md#phase-11-hotfix--bind-regression-2026-05-18), [ADR-020-Phase-1.1-autodial](./ADR-020-Phase-1.1-autodial.md)
**Adressat:** naechster Implementierungs-Claude

---

## TL;DR fuer den Implementierungs-Claude

PR #134 (ADR-020 v1+v2) ist auf allen 5 Mesh-Nodes deployed. Beim Live-Test gegen 5-Node-Mesh
(Mac mini, MacBook Pro, ioBroker, ai-n8n-local, influxdb) wurden **vier separate Bugs** beobachtet.

| # | Schicht | Schweregrad | Status |
|---|---|---|---|
| 1 | libp2p `/registry/1.0.0` — RegistrySyncCoordinator startet, faehrt aber keine Sync-Rounds | **HIGH** (SLO verletzt) | ✅ **GEFIXT in [PR #135](https://github.com/2000teddy/thinklocal-mcp/pull/135)** (Autodial nach peer:discovery). Live-Verifikation auf den Linux-Nodes nach Round-Robin-Pull pending. |
| 2 | `execute_remote_skill` — Noise-Bytes gehen an HTTPS-Port 9440 statt libp2p-Port 9540 | **HIGH** (Funktion tot) | offen — Aufgabe naechster PR |
| 3 | Asymmetrisches Sync-Hole zwischen Nodes — manche sehen sich, andere nicht | MEDIUM | offen — sollte sich teilweise mit PR #135 entspannen (Autodial koennte Sync-Hole verkleinern) |
| 4 | **Inbox-API lehnt AGENT_MESSAGE ab** wegen veralteter hostname-basierter SPIFFE-URIs in `paired-peers.json` | MEDIUM (systemisch, alle Nodes betroffen) | Mac mini lokal gepatcht — Migrationsscript fuer alle Nodes offen |

---

## Bug #1: RegistrySyncCoordinator faehrt keine Sync-Rounds — ✅ GEFIXT (PR #135)

**Update 2026-05-19 22:07 Berlin:** MacBook-Pro-Claude hat den Bug analysiert und in
[PR #135](https://github.com/2000teddy/thinklocal-mcp/pull/135) gefixt. Der Fix entspricht
exakt der Hypothese in diesem Bug-Report (fehlende mDNS→libp2p-Bridge). Details siehe
[ADR-020-Phase-1.1-autodial.md](./ADR-020-Phase-1.1-autodial.md).

Geänderte Dateien:
- `packages/daemon/src/libp2p-runtime.ts` (Auto-Dial-Logik)
- `packages/daemon/src/registry-sync-coordinator.ts`
- Neue Tests: `libp2p-autodial.test.ts`, `registry-sync-coordinator.test.ts`

**Verbleibende Arbeit:** Code muss auf den 3 Linux-Nodes (iobroker, ai-n8n-local, influxdb)
ausgerollt werden (Round-Robin `git pull` + `systemctl --user restart thinklocal-daemon`).
Mac mini und MacBook können bereits nachgezogen werden.

Der urspruengliche Befund (zur Doku-Vollstaendigkeit):

### Symptom

`mesh_status.registry_sync = {}` auf **allen** Nodes. `/api/capabilities` liefert auf den
5 Nodes je einen **eigenen Hash**, divergent seit Minuten — keine Konvergenz, obwohl
ADR-020 v1 SLO garantiert: divergent + connected darf nicht laenger als **120 s** sein.

Snapshot 2026-05-19 21:30 Berlin (180 s nach Coordinator-Start auf allen Nodes):

| Node | Hash | Count |
|---|---|---|
| Mac mini | `fbf7555a39997e5e` | 12 |
| MacBook | `2ceb7861fcc4edef` | 12 |
| iobroker | `351f090a09c75bbb` | 10 |
| ai-n8n | `af642f37cb77c811` | 9 |
| influxdb | `cbf2877d…`         | 6  |

Beide Macs sehen 12 Capabilities mit unterschiedlichen Hashes (= unterschiedliche Sets).
Linux-Nodes sehen 6–10. Auch nach 5+ Minuten und nach Trigger von
`POST /api/registry/republish` (HTTP 200 ueberall) bewegt sich nichts.

### Diagnose

- In `~/Library/Logs/thinklocal-mcp/daemon.log` (Mac mini) bzw.
  `~/.thinklocal/logs/daemon.log` (Linux) gibt es **genau eine** Sync-bezogene Logzeile pro
  Daemon-Lifetime:

  ```
  "msg":"RegistrySyncCoordinator gestartet (ADR-020 v1)"
  ```

- **Danach: nichts.** Kein `peer:connect` auf libp2p-Ebene, kein Stream-Open auf
  `/thinklocal/mesh/registry/1.0.0`, kein Genesis-Push, kein Owner-wins-Event, kein
  Sync-Tick, keine Fehler.
- Der **alte Gossip-Sync** (HTTPS-Polling alle 30 s, vor ADR-020) laeuft parallel und
  importiert Capabilities (`imported: N Gossip: Capabilities von Peer importiert`). Deshalb
  sehen einige Nodes ueberhaupt etwas — sonst waeren sie komplett blind.

### Hypothese (vom influxdb-Claude)

> Wahrscheinlich fehlende **mDNS→libp2p-Bridge**: Peers werden via mDNS+HTTPS entdeckt
> (`Peer entdeckt`), aber **nichts dialed sie auf libp2p:9540 an**. Der
> `RegistrySyncCoordinator` wartet vermutlich auf `libp2p.addEventListener('peer:connect', …)`
> Events, die nie feuern, weil kein Code aktiv `libp2p.dial(multiaddr)` aufruft.

### Erstes Debug-Mittel fuer den Implementierungs-Claude

1. In `packages/daemon/src/registry-sync-coordinator.ts` nach `start()` einen **expliziten
   Log-Eintrag pro Sync-Tick** einbauen (`Sync-Tick #N startet, Peer-Liste: [...]`) — damit
   verifizierbar, ob der Timer ueberhaupt feuert.
2. Pruefen ob `libp2p.dial(peerMultiaddr)` ueberhaupt aufgerufen wird — pro entdecktem
   Peer aus der mDNS-Discovery sollte ein expliziter Dial passieren.
3. Falls der Dial-Loop fehlt: Implementierung des **mDNS→libp2p-Bridge** als zentraler
   Service in `libp2p-runtime.ts` (siehe ADR-020 v1 Spec).

---

## Bug #2: execute_remote_skill Port-Mix (Noise an HTTPS-Port)

### Symptom (vom influxdb-Claude live reproduziert)

```
mcp__thinklocal__execute_remote_skill(influxdb, target=iobroker)
→ "Verbindung zu 10.10.10.52:9440 fehlgeschlagen:
   Parse Error: Expected HTTP/, RTSP/ or ICE/"
```

`curl -k https://10.10.10.52:9440/.well-known/agent-card.json` von der gleichen Maschine
funktioniert einwandfrei. Heisst: HTTPS auf 9440 ist gesund, der **Daemon-Client schickt
aber keine HTTP-Bytes, sondern etwas anderes** (vermutlich libp2p/Noise-Handshake-Bytes,
die der HTTPS-Parser dann als "kein HTTP/RTSP/ICE" zurueckweist).

### Diagnose

ADR-020 v1 hat den Skill-Execution-Pfad auf libp2p umgeschwenkt (siehe ADR-020 v1.4
"echte Handler"), aber der Client baut die Verbindung weiterhin gegen Port 9440 statt 9540
auf. Mutmasslich:

- `local-daemon-client.ts` (oder `mcp-stdio.ts`) konstruiert die Target-URL aus
  `agent.endpoint` (= `https://10.10.10.52:9440`) und benutzt libp2p-Codec drauf.
- Korrektur: Skill-Execute muss **libp2p-Multiaddr** des Peers nutzen
  (`/ip4/10.10.10.52/tcp/9540/p2p/<peerId>`), nicht HTTPS-Endpoint.

### Verdacht

Regression aus PR #134 — vor dem Merge funktionierte `execute_remote_skill` (siehe Inbox
`message_id: e812217a-69c8-473f` vom 2026-04-08: "execute_remote_skill FUNKTIONIERT").

### Erstes Debug-Mittel

`grep -rn "9440" packages/daemon/src/` — alle Stellen wo der Skill-Client den HTTPS-Port
hartcodiert oder aus `agent.endpoint` ableitet, muessten auf den libp2p-Pfad umgestellt
werden (oder ein separater MultiaddrResolver erweitert werden).

---

## Bug #3: Asymmetrisches Sync-Hole

### Symptom (vom influxdb-Claude, Sichtbarkeits-Matrix)

| Node | Sieht eigenen | iobroker | ai-n8n | MacBook | minimac (Mac mini) |
|---|---|---|---|---|---|
| influxdb | ✅ | ✅ inkl. influxdb | ❌ kein skill | ❌ kein skill | **❌ gar nicht** |
| iobroker | ✅ inkl. influxdb | ✅ | ✅ + ollama | ❌ kein skill | ✅ inkl. influxdb |
| MacBook  | ✅ inkl. influxdb | ✅ | ✅ | ✅ | ✅ inkl. influxdb |
| Mac mini | ✅ inkl. influxdb | ✅ inkl. influxdb | ✅ inkl. ollama | ✅ | ✅ |

Der influxdb-Daemon sieht **drei andere Nodes nicht** (oder nur ohne Skills). Mac mini
und MacBook sehen das gesamte Mesh.

### Hypothese

ADR-019 Phase 1.1 hat die Discovery auf influxdb evtl. noch nicht vollstaendig konfiguriert
— moeglicherweise fehlt dort `TLMCP_ALLOWED_MESH_CIDRS=10.10.10.0/24` als Env-Var (analog
zu MacBook-Pro-Setup), oder der bonjour-Browser hat ein anderes Receive-Problem.

### Erstes Debug-Mittel

Auf influxdb (`ssh chris@10.10.10.56`):

```bash
# Pruefen ob bonjour-Browser Multicast empfaengt:
sudo tcpdump -i any -n 'host 224.0.0.251 and port 5353' -c 20

# Pruefen welche Interfaces aktiv sind:
ip -4 addr show

# Pruefen ob mDNS-Reflector / NetworkManager mDNS abschaltet:
systemctl status systemd-resolved
```

Falls Multi-Interface: `TLMCP_ALLOWED_MESH_CIDRS="10.10.10.0/24"` in der systemd-Unit
ergaenzen und Daemon-Restart.

---

## Bug #4: Inbox-Reject wegen veralteter Pairing-URIs (LOKAL GEPATCHT)

### Symptom

ioBroker-Claude sendet via `mcp__thinklocal__send_message_to_peer` eine Nachricht an Mac
mini, bekommt `ack_status: "rejected"` zurueck. Bei Mac mini taucht aber **kein Audit-Event,
keine Inbox-Zeile** auf. In `daemon.log` einzig diese Warnung:

```
{"level":40,"from":"spiffe://thinklocal/host/b4768fe0e2dfd41f/agent/claude-code",
 "message_id":"65bc988b-…",
 "msg":"AGENT_MESSAGE von nicht-gepairtem Sender abgelehnt"}
```

### Root Cause

`~/.thinklocal/pairing/paired-peers.json` auf Mac mini enthielt **zwei verschiedene URI-Schemata
gemischt**:

| Eintrag | SPIFFE-URI | Paired-At | Bewertung |
|---|---|---|---|
| influxdb | `host/68f7cd8e330acfe3/...` (Host-ID) | 2026-04-07 | ✅ |
| ai-n8n   | `host/e7aeb01312e25b42/...` (Host-ID) | 2026-04-07 | ✅ |
| Mac (MacBook neu) | `host/813bdd161fea12ab/...` (Host-ID) | 2026-04-10 | ✅ |
| **iobroker** (alt) | `host/iobroker/...` (**Hostname**) | 2026-04-13 | ❌ |
| **MacBook-Pro-314.local** (alt) | `host/MacBook-Pro-314.local/...` (**Hostname**) | 2026-04-13 | ❌ (redundant) |

Pairings vom **7.–10.4.2026** wurden mit Host-Fingerprint-URIs angelegt. Pairings vom
**13.4.2026** mit Hostname-URIs. Dazwischen lag offenbar ein Code-Change zur
SPIFFE-URI-Generierung (vermutlich Teil der **ADR-005-Migration** zu Per-Agent-Inbox), aber
die alten Pairing-Eintraege wurden **nie automatisch migriert**.

Wenn ioBroker mit seiner aktuellen Host-ID-URI `b4768fe0e2dfd41f` eine AGENT_MESSAGE
schickt, sucht Mac mini diese URI in der Liste, findet aber nur den Hostname-Eintrag
`host/iobroker/...` → "nicht gepairt" → reject am Edge, vor der Inbox-Persistierung.

### Lokaler Hotfix (auf Mac mini bereits ausgefuehrt 2026-05-19 21:54)

```bash
# 1. Backup
cp ~/.thinklocal/pairing/paired-peers.json \
   ~/.thinklocal/pairing/paired-peers.json.bak-20260519-215428

# 2. Public Key von ioBroker holen (via SSH)
ssh chris@10.10.10.52 cat ~/.thinklocal/keys/agent.pub.pem

# 3. Edit paired-peers.json: alten iobroker (hostname-basiert) +
#    redundanten MacBook-Pro-314.local Eintrag loeschen, neuen iobroker mit
#    host-id-basierter URI b4768fe0e2dfd41f + frischem PublicKey einfuegen.

# 4. Daemon-Restart damit Pairing-Liste neu eingelesen wird
launchctl unload ~/Library/LaunchAgents/com.thinklocal.daemon.plist
launchctl load   ~/Library/LaunchAgents/com.thinklocal.daemon.plist
```

Verifikation: nach Restart logged Daemon `Peer hinzugefuegt agentId:
spiffe://thinklocal/host/b4768fe0e2dfd41f/...` (vorher fehlend) und importiert
unmittelbar 2 Capabilities von ioBroker.

### Systemische Auspraegung — andere Nodes

**Achtung: Bug #4 ist NICHT lokal auf Mac mini begrenzt.** Direkt nach dem Restart loggt
Mac mini drei 403er beim ausgehenden SKILL_ANNOUNCE:

```
peer=spiffe://thinklocal/host/68f7cd8e330acfe3/... status=403 SKILL_ANNOUNCE send failed
peer=spiffe://thinklocal/host/e7aeb01312e25b42/... status=403 SKILL_ANNOUNCE send failed
peer=spiffe://thinklocal/host/813bdd161fea12ab/... status=403 SKILL_ANNOUNCE send failed
```

→ ioBroker, influxdb, ai-n8n und MacBook haben in ihren **eigenen `paired-peers.json`
hoechstwahrscheinlich ebenfalls hostname-basierte Eintraege fuer Mac mini** (`host/Minimac/…`
o.ae.) und lehnen meine HTTPS-mTLS-Calls deshalb mit 403 ab.

### Empfohlene Loesung im Hotfix-PR

1. **One-Shot-Migrationsskript** `packages/daemon/scripts/migrate-pairings.mjs`:
   - Liest `paired-peers.json`
   - Fuer jeden Eintrag mit Hostname-URI: SSH/HTTPS-Abfrage des Peers, holt
     `.well-known/agent-card.json`, vergleicht echte Host-ID-URI, ersetzt Eintrag
     (oder loescht, wenn schon ein Host-ID-Eintrag existiert)
   - Schreibt atomar zurueck
   - Daemon-Restart-Hinweis ausgeben
2. **Beim Daemon-Start**: Warnung wenn ein hostname-basierter Pairing-Eintrag erkannt
   wird (`"agentId":"spiffe://thinklocal/host/<NICHT-HEX>/..."`), z.B.:

   ```
   WARN: paired-peers.json enthaelt 1 Eintrag mit hostname-basierter SPIFFE-URI —
   bitte `npm run migrate-pairings` ausfuehren.
   ```
3. **Optional Phase 2**: `paired-peers.json` Schema-Versionierung (analog zu Inbox
   user_version aus PR #83 Task) — `pairings_version: 2` mit dem Host-ID-Schema, alte
   Files automatisch migrieren beim Daemon-Start.

---

## Co-Diagnose mit influxdb-Claude

Die Diagnose oben ist das **konsolidierte Ergebnis** aus zwei parallelen Sessions:

- **influxdb-Claude** (host 68f7cd8e) hat Bugs #1, #2, #3 live reproduziert und
  identifiziert (siehe seine Bug-Tabelle in der User-Konversation am 2026-05-19 21:43).
- **Mac mini-Claude** (host 69bc0bc9) hat Bug #4 entdeckt und gepatcht (diese Datei).

Beide Sessions sind sich einig: Bugs #1+#2 sind ADR-020-v1-Regressionen und sollten
in einem dedizierten **ADR-020 Phase 1.1 Hotfix-PR** zusammen behoben werden (analog zum
[ADR-019 Phase 1.1 Pattern](./ADR-019-multi-interface-discovery.md#phase-11-hotfix--bind-regression-2026-05-18)).

## Compliance-Pflicht fuer den Hotfix-PR

Per `CLAUDE.md`-Reihenfolge:

1. **CO** Multi-Modell-Konsensus zur Diagnose-Plausibilitaet + Fix-Auswahl (mind. 2 Modelle, idealerweise GPT-5.4 + Gemini-3-Pro)
2. **CG** Test-Skizzen via `clink gemini`
3. **Design-Doku** Update dieser Datei (Status → "Implementiert"), plus Phase-1.1-Section in `ADR-020-registry-replication-recovery.md`
4. **Code** Fix in `registry-sync-coordinator.ts` + `libp2p-runtime.ts` + `local-daemon-client.ts` + `scripts/migrate-pairings.mjs`
5. **TS** Unit-Tests fuer SyncTick-Trigger, Multiaddr-Resolver, Pairing-Migration; Integration-Test 3-Node-Konvergenz; Live-Test auf dem realen 5-Node-Mesh
6. **CR** `pal:codereview` mit GPT-5.4 (security focus auf Pairing-Migration!)
7. **HIGH-Findings** sofort fixen + Regression-Tests
8. **PC** `pal:precommit`
9. Signed commit
10. **DO** README/USER-GUIDE/CHANGES.md/TODO.md/TESTING.md
11. PR mit COMPLIANCE-TABLE.md Zeile (CO/CG/TS/CR/PC/DO)
12. PR-Bot Approval: `bash scripts/bot-approve.sh <PR>` nach gruenem CI
13. Merge + Peer-Deploy (Round-Robin per SSH) + Live-Verifikation

## Anhang: Diagnose-Befehle (vom Mac mini aus, kann jeder Implementierungs-Claude nachvollziehen)

```bash
# Hash-Vergleich ueber alle 5 Nodes (zeigt Divergenz)
for ip in 10.10.10.52 10.10.10.222 10.10.10.56 10.10.10.55; do
  echo -n "$ip: "
  ssh chris@$ip "curl -sk --cert ~/.thinklocal/tls/node.crt.pem \
    --key ~/.thinklocal/tls/node.key.pem --cacert ~/.thinklocal/tls/ca.crt.pem \
    https://localhost:9440/api/capabilities" | \
    python3 -c 'import sys,json; d=json.load(sys.stdin); print(\"hash=\"+d[\"hash\"], \"count=\"+str(d[\"count\"]))'
done
echo -n "10.10.10.94 (Mac mini): "
curl -sk --cert ~/.thinklocal/tls/node.crt.pem --key ~/.thinklocal/tls/node.key.pem \
  --cacert ~/.thinklocal/tls/ca.crt.pem https://localhost:9440/api/capabilities | \
  python3 -c 'import sys,json; d=json.load(sys.stdin); print("hash="+d["hash"], "count="+str(d["count"]))'

# Republish-Trigger ueber alle Nodes
for ip in 10.10.10.52 10.10.10.222 10.10.10.56 10.10.10.55 localhost; do
  echo "=== $ip ==="
  if [ "$ip" = "localhost" ]; then
    curl -sk -X POST --cert ~/.thinklocal/tls/node.crt.pem --key ~/.thinklocal/tls/node.key.pem \
      --cacert ~/.thinklocal/tls/ca.crt.pem https://localhost:9440/api/registry/republish
  else
    ssh chris@$ip "curl -sk -X POST --cert ~/.thinklocal/tls/node.crt.pem \
      --key ~/.thinklocal/tls/node.key.pem --cacert ~/.thinklocal/tls/ca.crt.pem \
      https://localhost:9440/api/registry/republish"
  fi
done

# Log-Search nach RegistrySync-Aktivitaet
# Mac:   ~/Library/Logs/thinklocal-mcp/daemon.log
# Linux: ~/.thinklocal/logs/daemon.log
grep -iE 'RegistrySync|registry-sync|Genesis|owner-wins|/registry/1\.0\.0' \
  ~/Library/Logs/thinklocal-mcp/daemon.log | tail -20

# AGENT_MESSAGE Reject-Pattern (Bug #4 systemisch)
grep '"AGENT_MESSAGE von nicht-gepairtem Sender abgelehnt"' \
  ~/Library/Logs/thinklocal-mcp/daemon.log

# SKILL_ANNOUNCE 403 (Bug #4 in der Gegenrichtung)
grep '"status":403' ~/Library/Logs/thinklocal-mcp/daemon.log | tail -10
```
