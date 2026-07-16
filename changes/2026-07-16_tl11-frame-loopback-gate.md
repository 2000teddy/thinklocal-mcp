# changes/2026-07-16 — fix(ws): Loopback-Gate auch auf dem subscribe-Frame-Pfad (TL-11 §8.1-Härtung)

**Typ:** Security-Bug-Fix (Enforcement-Konsistenz) + Tests + Doc-Update. **Kein** neuer Transport,
**kein** neues Verhalten für konforme (loopback) Konsumenten, **kein** Deploy/Secret/Christian-Gate.
Schließt den in #279 dokumentierten OFFENEN §8.1-Befund.

## Warum
Die Regel „agent-gefilterte WS-Subscriptions sind **loopback-only**" (Snooping-Schutz für gerichtete
Events wie `agent:wake`) wurde **nur** auf dem Query-Param-Pfad durchgesetzt (`?agent=` am Connect →
`4003`). Der **Frame-Pfad** `{type:'subscribe', agent:…}` setzte `state.agentFilter` **ohne** Loopback-
Prüfung. **Exploit:** ein Nicht-Loopback-mTLS-Peer verbindet **ohne** `?agent=` (Gate nicht ausgelöst) und
setzt danach per Frame einen `agent`-Filter → er empfängt `agent:wake`-Events einer **fremden** Instanz.

**Kein neuer Beschluss:** die Invariante (loopback-only) ist bereits gemergt + deliberat (Query-Gate +
Close-Message „…loopback-only", `// prevent event snooping`). Der Frame-Pfad war schlicht ein
Enforcement-Loch. Die *konservative*, fail-closed Auflösung (Loch schließen) hält den bestehenden
Beschluss; die Alternative (loopback-only fallenlassen, nur mTLS) hätte einen deliberaten Schutz
**geschwächt** und einen positiven Beschluss gebraucht → bewusst nicht gewählt.

## Was
- **`websocket.ts`**:
  - Neu reine `rejectsAgentFilter(agent, isLoopback)` — nicht-leerer `agent` ist nur von Loopback erlaubt;
    von **beiden** Gates benutzt (DRY, eine Quelle der Wahrheit).
  - Neu reine `isLoopbackIp(ip)` (v4/v6/v4-mapped).
  - `ClientState.isLoopback` — am Connect aus `req.ip` gestempelt (stabil pro Verbindung).
  - Frame-`subscribe`: Verstoß → `socket.close(4003, …)` **vor** jeder State-Mutation (kein halb-
    umkonfigurierter Client). Query-Gate auf dieselbe reine Regel umgestellt (Verhalten unverändert).
- **`websocket.test.ts`**: +15 Tests (`isLoopbackIp` v4/v6/v4-mapped/undefined; `rejectsAgentFilter`
  remote-nicht-leer→reject, loopback→allow, leer/absent/non-string→allow, Query≡Frame-Regel).

## Sicherheitshinweis (verifiziert)
`req.ip` ist **nicht** header-spoofbar: der `cardServer` setzt **kein** `trustProxy` (Fastify-Default
false, `agent-card.ts:211-234`) → `req.ip` = Socket-Peer-Adresse. Ein Remote-Angreifer kann sich nicht
per `X-Forwarded-For` als Loopback ausgeben.

## Compliance
- **CO:** entfällt — Security-Bug-Fix, der die bereits gemergte Invariante durchsetzt (kein neuer Beschluss;
  die verworfene Alternative ist im Doc §8.1 + hier begründet).
- **CG:** n/a.
- **TS:** +16 Unit-Tests (reine Regel + IP-Prädikat, beide Pfade + L1-Array-Fall); `websocket.test.ts`
  **30 grün**, volle daemon-Suite **1714 grün**, tsc(strict) 0, geänderte Dateien Lint 0.
- **CR:** adversarialer Claude-Subagent — **APPROVE, keine HIGH/MEDIUM**. Unabhängig verifiziert:
  `isLoopback` am Connect gestempelt + lebenslang stabil, Frame-Gate schließt `4003` **vor** jeder Mutation,
  jeder `agentFilter`-Schreibpfad abgedeckt (kein Nicht-Loopback-Pfad setzt einen nicht-leeren Filter),
  leerer/whitespace agent inert (kein Snoop), kein Regress für Loopback-Konsumenten/ungefilterte Dashboards,
  `req.ip` nicht spoofbar (kein `trustProxy`). 2 LOW: **L1 (Query-Array-Asymmetrie) in-slice gefixt**
  (`rejectsAgentFilter` lehnt jetzt jeden präsenten nicht-leeren Wert von Nicht-Loopback ab, +1 Test);
  **L2** (kein Live-Nicht-Loopback-WS-Integrationstest) **bewusst als Grenze akzeptiert** — im Repo nicht
  simulierbar (Verbindungen sind loopback), die Enforcement-Regel ist als geteilte reine Funktion voll
  unit-getestet (s. „Grenze").
- **PC:** `git diff --cached` gesichtet; Secret-Scan clean.
- **DO:** `docs/architecture/TL-11-wake-consumer-contract.md` §8.1 (GESCHLOSSEN) + §3 (Frame jetzt gated),
  `TODO.md` (Posten [x]), `CHANGES.md`, `COMPLIANCE-TABLE.md`, dieser Eintrag.

## Grenze
Die **konsumentenseitige** Empfehlung bleibt die Query-Form (§3/§6). Ein Live-WS-Integrationstest
(echte Nicht-Loopback-Verbindung) ist im Repo nicht etabliert — die Enforcement-Regel ist stattdessen als
reine, von beiden Pfaden geteilte Funktion voll unit-getestet (die eigentliche Fehlerquelle).
