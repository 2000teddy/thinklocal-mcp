# changes/2026-07-17 — test(tl11): Draht-Ebenen-Conformance für den Wake-Kontrakt (Scaffold)

**Typ:** Test-Infrastruktur (neuer Conformance-Test) + Doku-Korrektur. **Kein** Runtime-Source-Change,
**kein** Deploy/Secret/Christian-Gate, **kein** neuer Endpoint/State.

## Warum
Die §2–§5-Garantien der `TL-11-wake-consumer-contract.md` (gegen die der Out-of-Repo Agent-Home-Supervisor,
TL-11 Slice B, gebaut wird) waren bislang **nur auf Pure-Function-/Routing-Ebene** bewacht
(`wake-contract.test.ts`, `websocket.test.ts`: `matchesSubscription`/`rejectsAgentFilter`/`isLoopbackIp` —
reine Funktionen, kein Socket). Es fehlte ein Test, der den **realen `/ws`-Socket** so treibt, wie der
Supervisor ihn trifft: connect → subscribe → `agent:wake`-Frame empfangen. Diese Datei schließt die Lücke
und de-riskt Slice B über die Unit-Ebene hinaus — **strictly in-repo, ohne den externen Supervisor→CLI-Hop**.

## Was
- **Neu `packages/daemon/src/tl11-wake-wire.conformance.test.ts`**: echter Fastify-Server + `registerWebSocket`,
  lauschend auf `127.0.0.1:<ephemeral>`; ein echter WS-Client (Node-22-global `WebSocket`/undici, **kein**
  neuer Dependency) treibt den Pfad. **7 grün + 2 `it.todo`** (Deckungsgrenze, s.u.). Negativ-Tests nutzen
  einen **Same-Socket-Barrier** (`subscribe`→`system:subscribed`) statt eines willkürlichen `sleep` →
  deterministisch, nicht flaky.
- **Doku-Korrektur `TL-11-wake-consumer-contract.md`**: der Fanout (`websocket.ts:266`) sendet das GANZE
  `MeshEvent` → auf dem Draht liegt der Payload **unter `.data`** (`{type, timestamp, data:{…}}`), nicht flach.
  §4 um die verifizierte Wire-Form + Warnung ergänzt; §6-Referenz `ev.reason` → `ev.data.reason` korrigiert;
  §7.1 mit den Wire-Bindungen ergänzt.

## Grün vs. Deckungsgrenze (ehrlich)
- **Grün (über echten Loopback-Socket):** §3 Subscribe-Form (`system:connected` spiegelt `agentFilter`),
  §4 genau 1 Zero-Content-Frame (Payload unter `.data`, kein `message_id`/`count`/`body`), §3 directed Match
  per `instance_id`, §3/§5 deny-by-default (ungefilterter Client bekommt NIE `agent:wake`), §3/§5 directed
  drop (falscher Filter), §8.1 Frame-Pfad von Loopback, §2 Loopback-Positivpfad (kein `4003`).
- **`it.todo` (eigener schwererer Slice, braucht Fixtures):** §2 mTLS-Pflicht (cert-lose/`ws://` → TLS-Reset)
  braucht cardServer-TLS + Client-Cert-Fixtures; Nicht-Loopback-`4003`-Reject braucht Bindung an ein
  Nicht-Loopback-Interface (auf 127.0.0.1 ist `req.ip` ohne `trustProxy` immer Loopback). Beide bleiben
  unit-bewacht (`rejectsAgentFilter`/`isLoopbackIp`), bis die Fixtures stehen.

## Abgrenzung
Kein Runtime-Verhalten geändert; TL-11 Slice B (Out-of-Repo Supervisor + Zwei-Peer-Live-Proof) bleibt
extern-blockiert — dieser Slice **de-riskt**, entfernt den Blocker nicht.

## Compliance
- **CO/CG:** entfallen — Test-Infra + Doku-Korrektur, keine Design-Frage, kein Runtime-Change (leitet die
  Wire-Form aus gemergtem Code #271/#277/#280 ab).
- **TS:** neue Datei **7 grün + 2 todo**; volle Suite **1721 grün + 2 todo** (126 Files), tsc(strict) 0,
  neue-Datei-Lint 0. Deterministisch (Same-Socket-Barrier, ephemerer Port, `afterEach`-Cleanup).
- **CR:** Self-CR (adversarial): Race-Freiheit (Listener vor `emit` attached), kein `sleep`, Dead-Code
  (`waitForClose`) entfernt, Cleanup schließt Sockets+Server. `agy`-Backend fehlt im Env (s. Memory).
- **PC:** `git diff` gesichtet, Secret-Scan clean.
- **DO:** dieser Eintrag, `CHANGES.md`, `COMPLIANCE-TABLE.md`, `TODO.md`, Consumer-Contract-Doc.
