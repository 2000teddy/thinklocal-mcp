# ADR-043 — Heartbeat-Weckruf-Kontrakt (TL-11 Slice A)

**Status:** Accepted
**Datum:** 2026-07-15
**Kontext-Task:** TODO TL-11 (Entsch. 16). Folge auf ADR-004 (Cron-Heartbeat/Inbox-Poll) + die KW30-Discovery
(`TL-11-12-wake-postbox-discovery.md`). Baut den **Wake-Kontrakt** + das edge-driven Instanz-Fanout —
**kein** neuer Transport, **kein** Out-of-Repo-Supervisor-Hop.
**CO:** `pal:consensus` 2026-07-15, `cli-claude-opus` (neutral) + `cli-claude-sonnet` (against) — Design
gehärtet: fail-closed Fanout, WS-Reuse-Begründung, Slice verdrahten (nicht inert). Beleg:
`~/hermes/reports/2026-07-15_1833_TL11-wake-consensus.md`.

## Problem
`inbox:new` wird bei Zustellung emittiert und an Dashboard/Telegram/WebSocket gepusht (ADR-004 Phase 3) —
aber **nicht** an einen laufenden CLI-Agenten. Der letzte Hop (Wecken des CLI-Prozesses) lebt in einem
**Out-of-Repo Agent-Home-Supervisor**. TL-11 formalisiert daemon-seitig den **Wake-Kontrakt** + das
per-Instanz-Fanout, sodass der Supervisor ein wohldefiniertes Signal konsumieren kann.

## Entscheidung

### 1. Wake-Kontrakt (`wake-contract.ts`, rein)
- `WakeSignal = { instanceId; reason: 'inbox' }` — **kein Inhalt** (nicht mal `message_id`/Count): nur
  „prüfe dein Postfach". Das macht das Signal **idempotent** (zwei Wakes = ein Wake → Coalescing funktioniert)
  und uninteressant für Exfiltration; der Agent liest seine eigene Inbox, um zu erfahren, was da ist.
- `resolveWakeTargets(targetInstance, liveInstanceIds) → string[]` — **fail-closed**: adressierte, live
  Instanz → `[it]`; `null`/leer (unadressiert/daemon-level) → `[]`; adressiert-aber-nicht-live → `[]`.
  **Kein Broadcast-Fallback** (CO-B): `null → alle wecken` wäre Amplifikation (ein Remote-Absender weckt
  jede Instanz; der Coalescer begrenzt Rate **pro Instanz**, nicht den 1→N-Fanout) + Metadaten-Leak.
  Opt-in-Broadcast ist später **additiv** nachrüstbar; Rücknahme wäre ein Breaking Change.
- `WakeCoalescer.shouldWake(instanceId, nowMs)` — per-Instanz-Dedup im Fenster (Default 2 s, `nowMs`
  injiziert → testbar): N rasche Nachrichten → 1 Wake pro Instanz pro Fenster.
- `computeWakes(...)` = resolve + coalesce → `WakeSignal[]` (≤ 1, da resolve ≤ 1 Ziel liefert).

### 2. Verdrahtung (nicht inert, CO-C) — ohne neuen Transport
- `inbox:new`-Payload um `to_agent_instance` erweitert (additiv, rückwärtskompatibel; bestehende
  Subscriber ignorieren es) — im **Loopback**-Send (`inbox-api.ts`, wo die Ziel-Instanz real ist).
- `registerWakeEmitter` abonniert `inbox:new`, liest `to_agent_instance`, `computeWakes` über die
  `AgentRegistry`-Live-Instanzen, emittiert `agent:wake` (neuer `MeshEventType`). Unadressiert → kein
  Wake + **WARN-Log** (operator-sichtbar statt still).

### 3. Transport-Entscheidung (erzwungen, CO-A)
**Reuse des bestehenden WebSocket-`inbox:new`-Push** (ADR-004 Phase 3) — **nicht** weil „der Kanal eh da
ist", sondern weil ein **Wake best-effort/lossy/idempotent** sein DARF (ein verlorener Wake kostet Latenz,
keine Daten — die Inbox ist durabel). Ein neuer mTLS-Push-Endpoint brächte einen zweiten Auth-/Liveness-/
Retry-Pfad für ein verlustfreies Signal; Poll-Reset ist strikt schlechter (Agent pollt nur schneller).
**Akzeptierte Risiken (Slice A):** keine Zustellgarantie / kein Replay (Supervisor-WS mid-reconnect → Wake
verloren); Liveness-Divergenz (Registry-live ≠ WS-Socket-offen).

## Bewusste Grenze / extern-blocked
- **`agent:wake` → laufender CLI = Out-of-Repo Agent-Home-Supervisor** (dieser Repo emittiert nur das
  Event). **Zwei-Peer-Live-Proof-DoD** (Nachricht raus auf Peer 1 → CLI-Reaktion auf Peer 2 **ohne**
  dazwischenliegenden Poll) ist **blocked auf die Supervisor-Änderung** — ein angekommener WS-Frame beweist
  den Kanal, nicht den Wake.
- **Offene Abhängigkeit:** der WS-Kanal broadcastet heute an alle Subscriber (keine Instanz-Bindung) → die
  `instanceId` im Wake ist ein Kanal-Metadaten-Leak, bis der WS-Kanal per-Instanz gebunden wird (Folge-Slice).
- **Remote-Pfad (index.ts):** `msg.to` muss exakt die 3-Komponenten-URI sein → `to_agent_instance` dort
  immer null → kein Wake (fail-closed); instanz-adressierte Zustellung läuft über den lokalen Send-Pfad.

## Konsequenzen
- **+** Wohldefinierter, fail-closed, idempotenter Wake-Kontrakt + verdrahtetes, live-beobachtbares
  `agent:wake`-Event (Integration: Loopback-Nachricht an live Instanz → `agent:wake`; zwei rasche → ein Wake).
- **0** Kein neuer Transport, kein Gate-/Redaction-Bezug. `inbox:new`-Erweiterung additiv.
- **−** Der End-to-End-Wake (CLI reagiert) bleibt bis zur Supervisor-Änderung extern-blocked (dokumentiert).
