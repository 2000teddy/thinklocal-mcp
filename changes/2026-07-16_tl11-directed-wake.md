# changes/2026-07-16 — feat(wake): agent:wake gerichtet + routbar (TL-11 §4)

**Typ:** Daemon-Code (`wake-contract.ts`, `websocket.ts`, `index.ts`) + Tests. Setzt das Design aus
`docs/architecture/TL-11-wake-routing.md` (PR #276) um. **Kein neuer Transport, kein Christian-/Secret-Gate.**

## Warum
Der in ADR-043 (Slice A) gemergte `agent:wake`-Kontrakt war **unroutbar**: Payload `{instance_id,reason}`
trägt keins der Felder, auf die `matchesSubscription` (`websocket.ts`) den Agent-Filter keyt
(`from/to/agentId/peer_id`). Folge: (D1) **Leak** — ein ungefilterter WS-Client bekam via `onAny` jedes Wake
inkl. Ziel-`instance_id`; (D2) **Mis-Routing** — ein `agent=<uri>`-Filter matchte `agent:wake` nie, der
adressierte Agent konnte sein Wake nicht abonnieren.

## Was
- **`wake-contract.ts`:** `WakeEmitterDeps.resolveSpiffe(instanceId) → SPIFFE|null`. Der Emitter trägt jetzt
  `spiffe_uri` (+ `instance_id`, `reason`). **Fail-closed:** keine SPIFFE für eine live Instanz → **kein**
  Wake emittieren (un-routbares Wake wäre Leak-/Broadcast-Kandidat) + WARN.
- **`websocket.ts`:** `DIRECTED_EVENT_TYPES = {agent:wake}`. `matchesSubscription`: directed Events **nie** an
  ungefilterte Clients (deny-by-default → schließt D1), match auf `instance_id` **oder** `spiffe_uri` →
  schließt D2. Nicht-directed Events unverändert. Inline-Hinweis (CR-LOW): Konsument muss `agent:wake`
  abonnieren (oder den Event-Filter weglassen), da der Event-Typ-Filter zuerst greift.
- **`index.ts`:** `resolveSpiffe: (id) => agentRegistry.get(id)?.spiffeUri ?? null` verdrahtet.

## Bewusste Grenze
CLI-letzter-Hop (Supervisor konsumiert das Wake → weckt CLI) + **Zwei-Peer-Live-Proof** bleiben
**extern-blocked** (Out-of-Repo Agent-Home-Supervisor, wie ADR-043). Diese Slice macht den Kontrakt
repo-seitig **konsumierbar**, beweist ihn nicht live. Loopback-Zwang für agent-gefilterte Subscriptions bleibt.

## Compliance
- **CO:** Design in `docs/architecture/TL-11-wake-routing.md` (#276, doc-first); der directed-Mechanismus ist
  low-controversy (deny-by-default) und wurde per CR gegen alle Invarianten bestätigt → separater
  `pal:consensus` für diesen Code-Slice entfiel bewusst.
- **CG:** n/a.
- **TS:** +1 `wake-contract.test.ts` (spiffe_uri im Payload + fail-closed-ohne-SPIFFE), +6 `websocket.test.ts`
  (kein Leak an Ungefilterte, match spiffe_uri/instance_id, drop non-match, event-type-Filter, Regression
  nicht-directed). Volle Suite **1774 grün**, tsc 0; geänderte Dateien lint-clean.
- **CR:** adversarialer Claude-Subagent — **APPROVE, alle 6 Sicherheits-Invarianten PASS** (kein Leak,
  routbar, fail-closed-Emit, keine Regression, directed-Set exakt gekeyt, Wiring korrekt). 1 LOW
  (Doku-Hinweis Event-Filter) **inline gefixt**.
- **PC:** `git diff` + Secret-Scan clean.
- **DO:** `CHANGES.md`, `COMPLIANCE-TABLE.md`, dieser Eintrag. (Design-Doc separat in #276.)
