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

## 8. Reproduzierbarkeits-Anhang (exakte Artefakte)

- Endpunkte am 9440-`cardServer`: `dashboard-api.ts:79` (`/api/status`), `agent-card.ts:252` (`/health`).
- mTLS-Gate: `agent-card.ts:225-230` (`requestCert/rejectUnauthorized`, keine Public-Path-Allowlist).
- Phantom-ROT im Tooling: `thinklocal.ts:948` (`/health` via `http://`), `:963` (`/api/status` via `http://`).
- Lokale Beobachtungen 2026-07-16: `ss` → `LISTEN 0.0.0.0:9440`; Probe-Matrix → `http/health=000`,
  `https/api-status(kein Cert)=000`, `dashboard 8787=200`; Prozess PID 447415/447429 aktiv.
- Verwandt (Memories): `[[mesh-ca-rotation-repair-all]]`, `[[th55-pathA-cert-san-blocker]]`,
  `[[th55-ehostunreach-host-routing]]`, `[[tl07-55-unknown-sender-blocker]]`.
