# changes/2026-07-17 — test(tl11): §2 mTLS-Pflicht + Nicht-Loopback-4003 Draht-Conformance (cert-fixture Slice)

**Typ:** Test-Infrastruktur (zwei ex-`it.todo` → echte Tests). **Kein** Runtime-Source-Change,
**kein** Deploy/Secret/Christian-Gate, **kein** neuer Endpoint/State.

## Warum
Das Wire-Conformance-Scaffold (`tl11-wake-wire.conformance.test.ts`, KW30) ließ zwei §2-Garantien der
`TL-11-wake-consumer-contract.md` als `it.todo` offen, weil sie über den Loopback-Plain-HTTP-Harness nicht
erreichbar waren: (1) die **mTLS-Pflicht** (der `/ws`-Pfad ist nur über den mTLS-Transport des cardServers
erreichbar) und (2) der **Nicht-Loopback-`4003`-Reject** (agent-gefilterte Subscriptions sind loopback-only;
`req.ip` ist auf einem 127.0.0.1-Harness immer Loopback). Dieser Slice zieht beide an — **strictly in-repo**.

## Was
- **`tl11-wake-wire.conformance.test.ts`** (7 grün → **11 grün**, keine `todo` mehr):
  - **§2 mTLS (3 Fälle):** neuer `startMtlsWakeWireHarness` — In-Memory-CA + Server-Leaf (SAN `localhost` +
    `127.0.0.1`) + Client-Leaf via `node-forge`; Fastify `https` mit **demselben Vertrag wie der cardServer**
    (`requestCert`+`rejectUnauthorized`, agent-card.ts:229-230); undici-`WebSocket` mit `Agent`-Dispatcher als
    Client-Cert-Träger. **Positiv:** gültiges Client-Cert → `/ws` erreichbar (`system:connected`). **Negativ:**
    cert-lose `wss://`- und Plaintext-`ws://`-Verbindung werden auf **TLS-Ebene resettet**.
  - **§2 Nicht-Loopback → `4003`:** neuer `startNonLoopbackHarness` bindet an eine echte **Nicht-Loopback-IPv4**
    der Maschine (kein `trustProxy` → `req.ip` = Socket-Peer, nicht spoofbar) → agent-gefilterter Connect wird
    mit Close-Code **`4003`** geschlossen. `it.skipIf` auf reinen Loopback-Hosts (ehrliche Deckungsgrenze statt
    falsch grün); das `isLoopbackIp`-Prädikat bleibt zusätzlich unit-bewacht.
  - Cleanup: `openAgents` schließt undici-Keep-Alive-Agents in `afterEach` (sonst Event-Loop-Hang/Vitest).

## Review (CR) — Backend-Hinweis
Die per CLAUDE.md/Hausregel genannten externen Reviewer **`codex` und `agy` sind nicht im PATH** (bekannt,
`[[pal-review-backend-agy-missing]]`) — beide Aufrufe schlugen fehl. Review daher über das repo-sanktionierte
**adversariale Claude-Review-Subagent** (NICHT MiniMax/pal:chat). Befund: **kein HIGH**; adressiert:
- **M1** `connectOutcome` verwischte Reset vs. Timeout → **`'timeout'`-Sentinel** getrennt; Negatives asserten
  `.toBe('error')` (ein bloßes Hängen fällt jetzt laut durch statt falsch-grün).
- **M2** Harness repliziert die Prod-TLS-Flags statt sie zu importieren → **Abgrenzung dokumentiert** (beweist
  mTLS-Semantik des `/ws`-Handlers, nicht die agent-card.ts-Verdrahtung; cardServer-Wiring-Test = Follow-up).
- **L2** Listener-Race im Positiv-Test → `system:connected`-Wait **vor** dem open-await angehängt.
- **L3** IPv4-Auswahl schließt Link-Local (`169.254.x`) aus (Flake-Vermeidung).

## Abgrenzung / offen
Kein Runtime-Verhalten geändert. **CR-M2-Follow-up:** ein Test, der die *Produktions*-Verdrahtung
(`agent-card.ts` `requestCert`) gegen Regress pinnt, ist NICHT Teil dieses Slices. TL-11 Slice B
(Out-of-Repo Supervisor→CLI) bleibt extern-blockiert — dieser Slice **de-riskt**, entfernt den Blocker nicht.

## Compliance
- **CO/CG:** entfallen — Test-Infra, keine Design-Frage, kein Runtime-Change (leitet die mTLS-/Loopback-
  Semantik aus gemergtem Code + agent-card.ts ab).
- **TS:** Datei **11 grün** (0 todo); volle Suite **1746 grün** (127 Files), tsc(strict) 0, neue-Datei-Lint 0.
  Deterministisch (Same-Socket-Barrier, ephemere Ports, `afterEach` schließt Sockets+Agents+Server).
- **CR:** adversariales Claude-Subagent (codex/agy nicht verfügbar, s.o.) — kein HIGH; M1/M2/L2/L3 adressiert.
- **PC:** `git diff` gesichtet, Secret-Scan clean (nur Test-Fixtures, In-Memory-Certs, keine Persistenz).
- **DO:** dieser Eintrag, `CHANGES.md`, `COMPLIANCE-TABLE.md`, `TODO.md`, Header-Doc der Testdatei.
