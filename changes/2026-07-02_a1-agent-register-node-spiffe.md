# A1 — Agent-Registrierung node/-fähig + präzise Registrierungs-Diagnose

**Datum:** 2026-07-02
**Branch:** `claude/mesh-a1-instance-spiffe-node` (eigenständig gegen `origin/main`)
**Owner:** Claude (ThinkLocal-Lane)
**Typ:** Bug-Fix (Agent-Registry / MCP-Adapter) — kein Deploy
**Bezug:** Mesh-Messaging-Auftrag `hermes-task-mesh-messaging-20260702.md`, Slice **A1**

## Problem (live verifiziert im Auftrag)

1. `POST /api/agent/register` wirft **auf main** HTTP **500** „daemon misconfiguration: cannot
   derive instance SPIFFE URI": `buildInstanceSpiffe()` (agent-api.ts) parste nur `host/<id>/agent/…`
   (`parts.lastIndexOf('host')`) — mit der kanonischen `node/<PeerID>`-Daemon-Identität (nach dem
   ADR-022-Flip) → `null` → 500. Folge fleet-weit: `/api/agent/instances` count=0, kein
   AGENT_REGISTER im Audit, inbox.db leer.
2. `registerWithDaemon()` in `mcp-stdio.ts` verschluckte **jeden** Fehler (auch den 500) als
   „registration skipped (daemon unreachable)" → der eigentliche Fehler war unsichtbar.

## Lösung

**a) `buildInstanceSpiffe()` node/-fähig (agent-api.ts):** nutzt jetzt `parseSpiffeUri` + `buildInstanceUri`
(spiffe-uri.ts, ADR-028 D1) und akzeptiert **beide** Daemon-Grammatiken.
- **Instanz-URI-Schema (bewusste Entscheidung, konsistent zu ADR-005/ADR-028):** Instanzen leben
  ausschließlich in der **host-Grammatik** — `parseSpiffeUri` erlaubt für `node/` strikt nur 2 Tokens
  (`node/<PeerID>`), eine `node/<PeerID>/agent/…`-Form ist absichtlich nicht parsebar. Der
  Node-Identifier (PeerID bzw. legacy stableNodeId) wird daher in den Node-Slot der host-Grammatik
  gesetzt: `host/<nodeIdentifier>/agent/<type>/instance/<id>`. Voll parsebar (`getAgentInstance`,
  `normalizeAgentId`, Inbox-`for_instance`) und **kollisionsfrei** zur Daemon-Identität `node/<PeerID>`
  (verschiedene Grammatik-Präfixe). `null` nur noch bei wirklich malformter Daemon-URI (echter
  Misconfig → 500); bad `agent_type`/`instance_id` werden am Handler bereits als 400 abgefangen.

**b) Präzise Diagnose (mcp-stdio.ts + neues reines `agent-register-format.ts`):** `registerWithDaemon`/
`unregisterFromDaemon` nutzen jetzt Low-Level `requestDaemon` (Status+Body) und unterscheiden sauber:
`ok` → „registered as …"; `http` (non-2xx) → „registration failed: HTTP <status> — <body>"
(NICHT „unreachable"); `error` (Transport) → „…unreachable: <ursache>". Body auf eine Zeile
normalisiert + auf 300 Zeichen gekürzt. `dataDir` wird jetzt korrekt durchgereicht (vorher ignoriert).

## Tests

- **`agent-api.test.ts`** (+): Integrationstest **node/<PeerID>-Daemon → register 200** (Regression zum
  500), **register→heartbeat→unregister-Round-Trip** unter node-URI, `buildInstanceSpiffe`-Unit (host,
  node, malformed→null, bad-chars→null, **Zwei-Grammatik-Split** normalizeAgentId ≠ node-Identität).
- **`agent-register-format.test.ts`** (neu, 7): register ok/http-500-nicht-unreachable/transport-error,
  Body-Kürzung/Einzeilung; unregister ok→null/http/error.
- **Live (dist):** kompiliertes `buildInstanceSpiffe` (node→host-instance, host→instance, malformed→null)
  + `formatRegisterOutcome` (500 sichtbar). Volle Suite **1320 grün**, tsc 0, authored-eslint 0, build 0.

## Review

Unabhängiger **Claude**-Subagent (adversarial Security+Correctness; nur claude/codex/agy — `agy` fehlt
im Env): **APPROVE-WITH-NITS**, 0× CRITICAL/HIGH. Bestätigt: Schema sicher (Instanz-URI kollidiert nicht
mit der node-Identität; `normalizeAgentId` wird nur auf echte Cert-SANs angewandt, nie auf die
synthetisierte URI), null-Vertrag tight, Fehler-Surfacing korrekt, unregister async-safe.
- **CR-M1 (MEDIUM, verify):** Cross-Grammatik-Adressierbarkeit — der Ende-zu-Ende-„send-to-instance"-
  Beweis ist **A2/A3-Scope** (Deploy + Receive-Loop, DoD). A1 zurrt die Annahme mit dem
  Zwei-Grammatik-Split-Test + Round-Trip-Test fest.
- **CR-L1** (Doc: `stableNodeId` kann base58-PeerID halten) → Kommentar in `spiffe-uri.ts` ergänzt.
- **CR-L2** (repräsentative PeerID) → 51-Zeichen-Fixture. **CR-L3** (dataDir-Verhalten) → bewusste
  Korrektur, kein Regress.

## Folge / offen

- **A2** Flotten-Rollout (Daemon von main bauen + ausrollen, Neustart/Verifikation pro Node) — Deploy,
  Christian/Ops-Gate; Mac (.55) rollt der Mac-Orchestrator selbst aus („main ready"-Report an ihn).
- **A3** Empfangs-Loop (Inbox-Polling ADR-004) pro Agent; **A4** Runbook + Probelauf.
- **DoD** (2-Peers): Linux- UND macOS-Peer kommunizieren erwiesen übers Mesh + Loopback TH01. **Kein
  Deploy in diesem Slice.**
