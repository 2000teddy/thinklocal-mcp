# DIAGNOSE — externes `/api/status` „Phantom-ROT" vs. lokale Wahrheit

**KW29 · Bug-Pfad 1 · Erstellt 2026-07-16 · Nur Repo-Grounding + lokale Reproduktion (kein Deploy/Secret/Christian).**

## 1. Phänomen

Ein *externer* Status-/Monitoring-Konsument (Status-Board auf .55, Ampel, `tl status`-CLI) färbt
einen Knoten **ROT / „nicht erreichbar"**, obwohl der Daemon lokal nachweislich **gesund** läuft
(Prozess lebt, Socket lauscht, mTLS-authentifizierte Peers bekommen volles Status-JSON).

Kernbefund: **`/api/status` liefert selbst KEINE Ampel** (kein `red/green/rot`-Feld — s. §4). Die
ROT-Bewertung entsteht **ausschließlich beim Konsumenten** aus einem *fehlgeschlagenen HTTP-Abruf*.
Der häufigste Fehlschlag ist kein „Daemon down", sondern ein **Transport-/Auth-Mismatch** am
mTLS-Gate.

## 2. Reproduktion (lokal, 2026-07-16, TH01/10.10.10.80)

Laufender Daemon: `tsx packages/daemon/src/index.ts` (PID 447415, HTTP-Worker 447429).
Env: `TLMCP_BIND_HOST=0.0.0.0`, `TLMCP_RUNTIME_MODE=lan`, `TLMCP_STATIC_PEERS=10.10.10.55:9440`.

```bash
# (a) Lokale Wahrheit: Prozess + Listen-Socket
pgrep -af "packages/daemon/src/index.ts"        # -> PID 447415 lebt
ss -tlnp | grep :9440                            # -> LISTEN 0.0.0.0:9440 (pid=447429)  == UP

# (b) Probe-Matrix gegen denselben, gesunden Daemon
curl -s  --max-time 3 -o /dev/null -w "%{http_code}\n" http://127.0.0.1:9440/health         # -> 000
curl -sk --max-time 3 -o /dev/null -w "%{http_code}\n" https://127.0.0.1:9440/api/status     # -> 000  (ohne Client-Cert)
curl -s  --max-time 3 -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8787/                 # -> 200  (Dashboard-UI, plain http)
```

**Beobachtung:** Derselbe gesunde Daemon liefert `000` (Verbindung scheitert vor jeder HTTP-Antwort)
für **`/health` über `http://`** und für **`/api/status` über `https://` OHNE Client-Zertifikat**.
`000` = kein HTTP-Status → jeder naive Konsument liest „down" → **ROT**. Local truth = **UP**.

## 3. Ursache (code-gegroundet)

`/api/status`, `/api/peers`, `/health` u.a. hängen **alle am selben `cardServer`** (AgentCardServer):

- `packages/daemon/src/index.ts:1405` — `registerDashboardApi(cardServer.getServer(), …)` (→ `/api/status`).
- `packages/daemon/src/index.ts:1422` — `await cardServer.start();` (der einzige 9440-Listener).

Der `cardServer` erzwingt **serverweites mTLS ohne Public-Path-Ausnahme**:

- `packages/daemon/src/agent-card.ts:225-230`
  ```
  serverOpts['https'] = { key, cert, ca: trustedCa,
    requestCert: true,        // Client-Zertifikat anfordern (mTLS)
    rejectUnauthorized: true, // Client-Certs gegen vertraute CAs validieren
  }
  ```
- `packages/daemon/src/agent-card.ts:252` — `/health` liegt **auf demselben mTLS-Server**; es gibt
  **keine** Allowlist unauthentifizierter Pfade. D.h. auch `/health` verlangt ein gültiges Mesh-Client-Cert.

Folgen für jeden externen Abruf:
1. **`http://` gegen den TLS-Port** → TLS erwartet ClientHello, bekommt HTTP → Reset → `000`.
2. **`https://` ohne Client-Cert** → `requestCert+rejectUnauthorized` brechen den Handshake ab → Reset → `000`.
3. **`https://` mit Cert, das nicht gegen die aktuelle Mesh-CA validiert** (CA-Rotation, fehlender
   100.x/IP-SAN — vgl. `[[mesh-ca-rotation-repair-all]]`, `[[th55-pathA-cert-san-blocker]]`) → `000`.

Alle drei sehen für ein naives Board identisch aus: **kein HTTP-Status → ROT**, unabhängig vom
tatsächlichen Gesundheitszustand.

## 4. `/api/status` ist eine reine Rohdaten-Auskunft (keine Ampel)

`packages/daemon/src/dashboard-api.ts:79-107` gibt nur Rohfelder zurück (`peers_online`,
`registry_sync`, `skills`, `uptime_seconds`, …). **Kein** `status`-/Farb-Feld. Ein ROT entsteht
also entweder (a) aus dem *Abruf-Fehlschlag* (§3, dominanter Fall) oder (b) aus einer
*Konsumenten-Heuristik* über diese Rohfelder (z.B. „`peers_online==0` → ROT", „`registry_sync`
stale → ROT"). (b) ist konsumentenseitig (Board auf .55, out-of-repo) und in diesem Repo nicht belegbar.

## 5. Das Tooling erzeugt Phantom-ROT selbst (Beleg im Repo)

`packages/cli/src/thinklocal.ts:948` (Health-Check von `tl doctor`/Remote-Diagnose):
```
const res = await fetch(`http://${targetHost}:${targetPort}/health`, { signal: AbortSignal.timeout(3_000) });
… } catch { fail(`Daemon nicht erreichbar auf ${targetHost}:${targetPort}`); return; }
```
Der Abruf geht über **`http://` gegen den mTLS-`https`-Port 9440** → landet **immer** im `catch` →
gibt **`fail(… nicht erreichbar)`** aus = **fest verdrahtetes Phantom-ROT**, egal ob der Daemon lebt.
Gleiches Muster für `/api/status` bei `thinklocal.ts:963` (dort nur `warn`).
Auch ein Umstellen auf `https://` heilt es nicht, solange kein Client-Cert präsentiert wird.

## 6. Ranking der Root-Cause-Hypothesen (für die Live-Disambiguierung am Zielknoten)

| # | Hypothese | Bestätigungs-Kommando am Zielhost | Erwartung, wenn wahr |
|---|-----------|-----------------------------------|----------------------|
| H1 | **Protokoll-Mismatch** (Board/CLI nutzt `http://` gegen TLS-Port) | `curl -s -o/dev/null -w '%{http_code}' http://<host>:9440/health` | `000` |
| H2 | **mTLS-Gate** (Board hat kein/kein gültiges Client-Cert) | `curl -sk https://<host>:9440/api/status` **vs.** `curl --cert peer.crt --key peer.key --cacert ca.crt https://<host>:9440/api/status` | `000` ohne Cert, `200` mit Cert |
| H3 | **Cert-Vertrauensbruch** (CA-Rotation / fehlender IP-SAN) | mit Cert, aber `--cacert` alte vs. neue CA; `openssl s_client -connect <host>:9440 -cert … -key …` | TLS-`alert`/`unknown ca`/`altname` |
| H4 | **Interface-/Routing-Phantom** (Board trifft falsches Interface; `[[th55-ehostunreach-host-routing]]`) | `curl` von der Board-Quelle vs. lokal auf dem Host | extern `000`/timeout, lokal `200` |
| H5 | **Konsumenten-Heuristik** über Rohfelder (`peers_online==0` → ROT) trotz erreichbarem Endpoint | `curl … /api/status` liefert `200` + `peers_online:0` | HTTP ok, Board trotzdem ROT |

**Lokal reproduziert:** H1 und H2 (§2). H3/H4 sind am konkreten .55-Board mit Cert-Material zu prüfen
(gehört zu den bekannten Blockern in den Memories, s.o.). H5 ist rein konsumentenseitig.

## 7. Fix-Richtungen (Backlog, NICHT in diesem Pack umgesetzt)

- **Diagnose-Tooling ehrlich machen:** `thinklocal.ts:948/963` auf `https://` + Client-Cert umstellen
  **oder** klar zwischen „TLS-Reset (Auth/Transport)" und „echt down" unterscheiden, statt pauschal
  `fail(nicht erreichbar)`. (Kleiner, risikoarmer Hygiene-Fix — eigener Slice.)
- **Optionaler unauth. Liveness-Pfad:** ein mTLS-ausgenommenes, informationsarmes `/livez` (nur
  „Prozess lauscht", keine Mesh-Daten) für externe Boards — bewusst als Design-Entscheidung (Zero-Trust:
  was darf ein nicht-authentifizierter Abruf erfahren?) → braucht CO, kein Schnellschuss.
- **Board-Kontrakt dokumentieren:** externe Konsumenten MÜSSEN Mesh-Client-Cert präsentieren; ein
  Transport-/Auth-Fehler ist **nicht** gleich „Knoten ROT".

## 9. Zweite Klasse — „Phantom-ROT von unten": `peers_online=0` TROTZ bekannter Peers

§2–§7 behandeln den **Konsumenten→Knoten**-Transportfehler (Board erreicht `/api/status` nicht →
`000` → ROT; Fix in #272). Es gibt eine **zweite, davon unabhängige** Klasse, bei der `/api/status`
sauber `200` liefert, der Wert aber inhaltlich irreführend ist: **`peers_online` fällt auf 0 (oder
unter die bekannte Peer-Zahl), obwohl der Knoten sehr wohl Peers kennt** — sie sind nur alle über den
**HTTP-Heartbeat** unerreichbar. Ein naives Board liest `peers_online==0` → ROT, obwohl der Knoten
gesund ist und Peers im Mesh hält.

### 9.1 Mechanismus (code-gegroundet)

- `/api/status.peers_online` = `mesh.getOnlinePeers().length` (`dashboard-api.ts:96`), und
  `getOnlinePeers()` filtert **hart auf `status==='online'`** (`mesh.ts:235-237`).
- Der Online-Status wird **ausschließlich** vom HTTP-Heartbeat gehalten: `checkPeers()` proben jeden
  Peer per `fetch(`${peer.endpoint}/health`, { dispatcher: tlsDispatcher })` (`mesh.ts:585-588`).
  **Dieselbe** mTLS-Gate wie in §3 — nur auf dem **ausgehenden** Bein: `tlsDispatcher` erzwingt
  `rejectUnauthorized:true` + Server-Identitäts-/SAN-Check (`index.ts:230`, `mesh-connect.ts:82`).
- Schlägt der Probe-`fetch` fehl (CA-Rotation, fehlender IP/100.x-SAN, EHOSTUNREACH — genau die
  bekannten Fleet-Blocker `[[mesh-ca-rotation-repair-all]]`, `[[th55-pathA-cert-san-blocker]]`,
  `[[th55-ehostunreach-host-routing]]`), zählt `handleMissedBeat` hoch; nach
  `heartbeat_timeout_missed=3` Runden à `heartbeat_interval_ms=10000` (~30 s) → `status='offline'`
  (`mesh.ts:602-610`). Der Peer bleibt **im `peers`-Map** (nicht gelöscht) → `mesh.peerCount` zählt
  ihn weiter, aber `getOnlinePeers()` schließt ihn aus.
- **Blast-Radius:** Bei einem fleet-weiten Cert-/CA-Ereignis scheitert der Heartbeat zu **allen** Peers
  gleichzeitig → `peers_online=0` auf **jedem** Knoten, obwohl alle Peers bekannt (und ggf. libp2p-
  verbunden) sind. Reales-Daten-ROT, kein Konsumenten-Artefakt.

### 9.2 Live-Beleg (TH01/10.10.10.80, 2026-07-16, Daemon PID 447415, cert-authentifiziert)

```bash
C=~/.thinklocal/tls
# (a) /api/status — Online-Sicht
curl -s --cert $C/node.crt.pem --key $C/node.key.pem --cacert $C/ca.crt.pem \
  https://127.0.0.1:9440/api/status            # -> peers_online: 3
# (b) Agent-Card — rohe Map-Größe (mesh.peerCount, inkl. offline)
curl -s --cert $C/node.crt.pem --key $C/node.key.pem --cacert $C/ca.crt.pem \
  https://127.0.0.1:9440/.well-known/agent-card.json   # -> mesh.peers_connected: 6, libp2p.connected_peers: 4
# (c) Audit-Churn (better-sqlite3, readonly)
#     PEER_JOIN=958  PEER_LEAVE=834   → Dauer-Flapping online<->offline
```

| Quelle | Feld | Wert | Bedeutung |
|--------|------|------|-----------|
| `/api/status` | `peers_online` | **3** | `status==='online'` (HTTP-Heartbeat frisch) |
| agent-card `mesh` | `peers_connected` | **6** | `mesh.peerCount` = rohe Map-Größe (inkl. offline) |
| agent-card `libp2p` | `connected_peers` | **4** | libp2p-Transport (anderer Pfad als HTTP-Heartbeat) |
| audit | `PEER_JOIN` / `PEER_LEAVE` | **958 / 834** | massives Flapping = wiederholte Heartbeat-Fehlschläge |

**Befund:** 6 Peers bekannt, aber nur 3 „online" → **3 bekannte, aber Heartbeat-offline Peers**. Fiele
das auf 0 (fleet-weites Cert-Ereignis), zeigte `/api/status` `peers_online:0`, während 6 Peers bekannt
und 4 libp2p-verbunden bleiben. HTTP-Heartbeat (3) und libp2p (4) widersprechen sich zusätzlich —
zwei Transporte, zwei Wahrheiten.

### 9.3 Observability-Lücke (die eigentliche Root-Cause der Fehldeutung)

`/api/status` exponierte **nur** `peers_online`. Ein externer Konsument kann damit **nicht**
unterscheiden zwischen:
- **„0 bekannt"** (echt allein / discovery tot) → berechtigtes ROT, und
- **„N bekannt, 0 Heartbeat-online"** (Cert/CA/Routing) → Transport-/Auth-Problem, NICHT „Knoten tot".

Beide sehen als `peers_online:0` identisch aus. `mesh.peerCount` existierte, wurde aber nur indirekt in
der Agent-Card (`peers_connected`) sichtbar, nicht in der Status-Auskunft.

**Fix dieses Slice (additiv, nicht-brechend):** `/api/status` und der MCP-`mesh_status` liefern
zusätzlich `peers_known` (rohe Map-Größe) und `peers_offline` (`known − online`) aus einem einzigen
atomaren Snapshot (`mesh.getPeerCounts()`). Damit wird die Klasse aus §9 extern **sichtbar und
diagnostizierbar** — `peers_known>0 && peers_online==0` ⇒ Heartbeat-/Cert-Problem, kein „Knoten ROT".
Das eigentliche Cert-/CA-/SAN-Heilen bleibt die bekannten Christian-gated Fleet-Blocker (out of scope).

## 10. Reproduzierbarkeits-Anhang (exakte Artefakte)

- Endpunkte am 9440-`cardServer`: `dashboard-api.ts:79` (`/api/status`), `agent-card.ts:252` (`/health`).
- mTLS-Gate: `agent-card.ts:225-230` (`requestCert/rejectUnauthorized`, keine Public-Path-Allowlist).
- Phantom-ROT im Tooling: `thinklocal.ts:948` (`/health` via `http://`), `:963` (`/api/status` via `http://`).
- Lokale Beobachtungen 2026-07-16: `ss` → `LISTEN 0.0.0.0:9440`; Probe-Matrix → `http/health=000`,
  `https/api-status(kein Cert)=000`, `dashboard 8787=200`; Prozess PID 447415/447429 aktiv.
- Verwandt (Memories): `[[mesh-ca-rotation-repair-all]]`, `[[th55-pathA-cert-san-blocker]]`,
  `[[th55-ehostunreach-host-routing]]`, `[[tl07-55-unknown-sender-blocker]]`.
