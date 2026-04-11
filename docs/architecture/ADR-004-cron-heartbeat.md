# ADR-004: Cron-Heartbeat fuer Agent-Inbox-Polling

**Status:** Accepted, Phase 1–4 Implemented (Phase 1+2: 2026-04-09, Phase 3+4: 2026-04-11)
**Datum:** 2026-04-08
**Autor:** Claude Code (basierend auf Christians Kernanalyse)
**Verwandt:** ADR-005 (Per-Agent-Inbox), PR #79 (Messaging), PR #80 (Loopback)

## Kontext

Seit PR #79 (Agent-to-Agent Messaging Inbox) und PR #80 (Loopback fuer Same-Daemon Sibling-Agents) koennen AI-Agenten (Claude Code, Codex, Gemini CLI) direkt ueber das ThinkLocal-Mesh miteinander kommunizieren. Der Kern-Mechanismus ist:

1. Agent A ruft `send_message_to_peer(to=<spiffe>, body=...)` auf
2. Daemon persistiert die Nachricht in SQLite (`~/.thinklocal/inbox/inbox.db`)
3. Agent B muss **aktiv** `read_inbox()` aufrufen um die Nachricht zu sehen

Das Problem: **Agents machen das nicht von alleine.** Im praktischen Test am 2026-04-08 mussten wir (Christian) Codex und Claude jeweils explizit anweisen `read_inbox` aufzurufen. Das ist genau der "menschliche Vermittler"-Fall, den ThinkLocal eigentlich abschaffen sollte.

### Die falsche Annahme

> "Agents werden sich nach 2-3 Iterationen das Pattern 'check inbox on session start' angewohnen."

**Das ist Wunschdenken.** LLM-Agenten haben kein persistentes Lernen zwischen Sessions. Jede neue Session startet mit einem leeren Kontext und liest die Regeln aus CLAUDE.md/Memory frisch. Es gibt keine evolutionaere Selektion — Agents die Nachrichten ignorieren werden nicht "bestraft", sie werden einfach nicht wieder aufgerufen. Das klassische Tier-Lernen-durch-Konsequenz Modell greift hier nicht.

**Nur drei Mechanismen funktionieren zuverlaessig:**

1. **Regeln im System-Prompt/CLAUDE.md** — funktioniert nur wenn der Agent sie *liest* UND *befolgt* (beides nicht garantiert)
2. **Externe Erzwingung durch Scheduler/Hooks** — funktioniert immer, weil es nicht vom Agent abhaengt
3. **Architektur die das Fehlverhalten unmoeglich macht** — funktioniert immer, weil es keinen Pfad dafuer gibt

Diese ADR addressiert **Mechanismus #2**.

## Entscheidung

**Wir fuehren einen Cron-Heartbeat-Mechanismus ein, der auf zwei Ebenen arbeitet:**

### Ebene 1 — Daemon-intern (Push via WebSocket)

Der Daemon hat bereits `eventBus.emit('audit:new', { type: 'AGENT_MESSAGE', ... })` im AGENT_MESSAGE-Handler. Wir erweitern:

- Neuer Event-Typ `inbox:new` auf dem EventBus
- WebSocket-Server (`websocket.ts`) broadcastet `inbox:new` Events an subscribed Clients
- Subscriber: Dashboard, Telegram-Gateway, und zukuenftig der MCP-Stdio-Subprocess

Das ist die *strukturelle Loesung* (#3 oben) — sie wird aber erst nutzbar wenn das MCP-Protokoll Server-Initiated Notifications unterstuetzt oder der MCP-Stdio-Server selbst die WebSocket-Verbindung halten kann und beim CLI-Host "aufwecken" kann. Stand Protokoll-Spec: **nicht verfuegbar**. Deshalb braucht es Ebene 2.

### Ebene 2 — CLI-Host Cron-Pull (Pull + Scheduler)

Jeder aktive Agent auf einem Host laeuft einen **eigenen** Cron/Timer, der alle N Sekunden:

1. `thinklocal.unread_messages_count()` aufruft
2. Wenn `> 0`: `thinklocal.read_inbox(unread_only: true)` aufruft und die neuen Nachrichten verarbeitet
3. Antwort per `thinklocal.send_message_to_peer` wenn noetig
4. Nachrichten als gelesen markieren mit `thinklocal.mark_message_read`

**Wichtig — "pro Agent" nicht "pro Peer":**

Ein Peer (= Host = IP-Adresse) kann mehrere Agenten hosten:
- MacMini: Claude Code + Codex + Gemini CLI auf demselben Daemon
- Alle teilen sich den gleichen Daemon-Prozess, aber jeder ist ein **separater Agent-Instance** aus User-Sicht

Der Cron-Heartbeat muss **pro Agent-Instance** laufen, nicht pro Daemon. Das bedeutet:
- Jedes CLI (Claude Code, Codex, Gemini CLI) hat seinen eigenen Scheduler
- Der Scheduler wird beim CLI-Start registriert und beim CLI-Stop abgeraeumt
- Wenn zwei Claude-Code-Fenster parallel laufen, haben beide **ihren eigenen** Heartbeat

**Konsequenz fuer ADR-005 (Per-Agent-Inbox):** Die Inbox muss nach `to_agent_instance` filtern koennen, sonst bekommen beide Claude-Fenster dieselben Nachrichten.

### Adaptive Intervall-Strategie

Ein fixes 5s-Intervall ist zu aggressiv bei leerer Inbox und zu langsam bei schneller Kommunikation:

```
initialInterval = 5s
maxInterval = 30s
emptyPollCount = 0

on each poll:
  if unread_count > 0:
    process messages
    emptyPollCount = 0
    nextInterval = initialInterval
  else:
    emptyPollCount++
    nextInterval = min(initialInterval * 2^emptyPollCount, maxInterval)
```

Bei aktivem Austausch: 5s. Bei Leerlauf: bis zu 30s. Nach Event ("Nachricht kommt an"): sofort zurueck auf 5s.

**Parameter pro Mesh-Modus:**

| Mesh-Modus  | initial | max  | Hinweis                            |
|-------------|---------|------|------------------------------------|
| local       | 2s      | 10s  | Single-Host, kein Netzwerk-Overhead |
| lan         | 5s      | 30s  | Typisches ThinkLocal-Szenario      |
| federated   | 30s     | 5m   | ThinkWide, WAN-Latenz              |
| adhoc       | 60s     | 10m  | Selten kommuniziert                |

## Alternativen die verworfen wurden

### A) "Agents lernen das Pattern"
Wunschdenken. Keine Selektion, kein persistentes Lernen. Verworfen.

### B) "Regel in CLAUDE.md reicht"
Funktioniert nur wenn der Agent sie liest und befolgt. Bis 2026-04-08 haben sowohl Claude als auch Codex die Regel "check COMPLIANCE-TABLE.md vor jedem PR" systematisch ignoriert. Verworfen.

### C) "WebSocket-Push allein"
Funktioniert nicht, solange MCP-Protokoll keine Server-Initiated Notifications hat. Wird **ergaenzend** gebaut (Ebene 1).

### D) "Daemon pollt selbststaendig und ruft MCP-Client aktiv an"
Unmoeglich — Daemon hat keinen Kanal zum CLI-Host. MCP ist Client-initiated. Verworfen.

## Implementation — Phasen

### Phase 1: Minimal-Cron pro CLI (diese PR)

**Claude Code (ich):**
- Nutze `CronCreate` Tool der Claude-Harness mit Prompt: *"Ruf thinklocal.unread_messages_count() auf. Wenn > 0, verarbeite die unread messages per read_inbox und antworte ggf."*
- Intervall: 5s (fuer aktiven Austausch)
- Auto-Expire: 7 Tage (Harness-Default)

**Codex CLI:**
- Analog ueber Codex' eigenen Scheduler
- Claude schickt Codex eine Setup-Anleitung per `send_message_to_peer`

**Gemini CLI:** Spaeter.

### Phase 2: Neue Daemon-Endpunkte (naechste PR)

- `POST /api/agent/register` — Agent registriert sich beim Daemon
- `POST /api/agent/heartbeat` — Agent signalisiert "ich bin noch da"
- Daemon trackt aktive Agenten, markiert nach `3 * heartbeatInterval` als stale
- `read_inbox` filtert automatisch nach `to_agent_instance` des Callers (siehe ADR-005)

### Phase 3: WebSocket-Push-Complement (naechste PR nach Phase 2)

- Neuer Event-Typ `inbox:new` im EventBus
- WebSocket-Server broadcastet an subscribed agents
- MCP-Stdio-Subprocess haelt optional eine WebSocket-Verbindung zum Daemon
- Bei Push: MCP-Stdio schreibt in ein Memory-Buffer "pending inbox notifications"
- Der naechste Cron-Pull liest diese Buffer-Eintraege und verarbeitet sie sofort

### Phase 4: Automatischer Regel-Check im Cron (Teil Phase 1)

Der Cron-Heartbeat-Prompt prueft nicht nur die Inbox, sondern auch:

- **COMPLIANCE-TABLE.md Status:** Gibt es einen offenen PR ohne CO/CG/CR/PC/DO? Wenn ja → Reminder-Message im lokalen Inbox
- **PR-Checklist fuer aktuellen Working-Branch:** Sind alle Schritte vor dem naechsten Commit eingehalten?
- **Pending Reviews:** Wartet eine Nachricht von Codex auf Antwort?

Statt hoffen dass der Agent die Regeln liest, prueft sie der Cron fuer ihn und zeigt den Status bei jedem Heartbeat.

## Konsequenzen

### Positiv
- **Automatischer Inbox-Check ohne "daran denken"**
- **Compliance-Regeln werden beim Heartbeat mit-geprueft** — kein "vergessen" mehr moeglich
- **Real-Time Feeling** (5s Latenz) bei aktivem Austausch
- **Adaptiv** — keine Ressourcen-Verschwendung bei Leerlauf

### Negativ
- **Cron ist per-Session** — muss beim CLI-Restart neu gesetzt werden
- **Pro-Agent-Tracking** braucht Per-Agent-Inbox aus ADR-005
- **5s Polling** ist nicht echt-time. WebSocket-Push in Phase 3 hilft.
- **Ressourcenkosten:** Bei 10 aktiven Agents ~120 HTTPS-Calls/Minute auf dem Daemon

### Risiko: Cron-Loop frisst Context-Budget

Jeder Cron-Pull startet einen neuen Claude-Code-Turn, der Context verbraucht. Mitigation:
- Cron-Prompt ist **kurz** und **strukturiert**
- Wenn nichts zu tun → Early-Return
- Adaptive Intervalle reduzieren Kosten stark
- Long-running Cron wird nach 7 Tagen auto-gecancelt

## Referenzen

- **Christians Kernanalyse (2026-04-08 20:57):** Agents lernen nicht durch Iteration. Nur proaktiver Impuls loest das Problem.
- **Claude-Harness `CronCreate`:** cron-expression basierter Timer im Claude-Code-Host
- **MCP-Protocol Specification:** [modelcontextprotocol.io](https://modelcontextprotocol.io/)
- **PR #79 (Agent Messaging)**
- **PR #80 (Loopback Fix)**
- **PR #83 (Batch-Review Findings)**

## Status

**Accepted (mit Anpassungen aus Konsensus 2026-04-08)**

### Konsensus-Ergebnis (pal:consensus am 2026-04-08 21:30)

**GPT-5.4 (8/10 neutral)** und **Gemini 2.5 Pro (9/10 neutral)** endorsen den Entwurf grundsaetzlich. Anpassungen die ins Design aufgenommen wurden:

1. **Polling-Jitter (+-10-20%)** — GPT-5.4 Vorschlag: bei vielen Agents die synchron starten, verhindert der Jitter Last-Bursts auf dem Daemon. Wird in Phase 1 implementiert: `jitterMs = currentInterval * (0.8 + random() * 0.4)`.

2. **Phase 4 Separation of Concerns** — GPT-5.4 Einwand: Compliance-Check soll NICHT im selben Prompt wie Inbox-Polling laufen. Gemini Pro ist weniger streng ("brilliant reuse"). **Entscheidung:** Wir nutzen denselben Scheduler (CronCreate), aber **separate Jobs** mit verschiedenen Intervallen:
   - `inbox-heartbeat` alle 5s (adaptiv)
   - `compliance-heartbeat` alle 5 Minuten (konstant, keine Adaptivitaet noetig)
   Das behaelt die Vorteile der Reuse des Mechanismus, vermeidet aber Context-Burn bei jedem einzelnen Inbox-Poll.

3. **Client-initiated Long-Poll bevorzugt spaeter** — GPT-5.4 Vorschlag: sobald Harness unterstuetzt, auf Long-Poll/SSE wechseln statt Cron. Wird in Phase 3 als Alternative zum WebSocket-Push dokumentiert.

### Phase 1 Implementation (2026-04-09, dieser PR)

- ✅ `packages/daemon/src/heartbeat/interval.ts` — adaptive Backoff + ±20% Jitter (pure functions, 11 Unit-Tests)
- ✅ `packages/cli/src/thinklocal-heartbeat.ts` — `thinklocal heartbeat show|status|help` Subcommand (6 Unit-Tests)
- ✅ `docs/agents/inbox-heartbeat.md` — Inbox-Cron-Prompt (5s, adaptiv, Early-Return)
- ✅ `docs/agents/compliance-heartbeat.md` — Compliance-Cron-Prompt (5min, fix, separate Concerns)
- ✅ `tests/integration/heartbeat-loop.test.ts` — Loop-Simulation gegen Mock-Inbox
- ✅ CG erbracht durch `clink gemini` (Test-Skizzen), Code via Claude (Codex-Timeout)
- ✅ DO durch ADR-Update + USER-GUIDE-Section + COMPLIANCE-TABLE.md

### Phase 2 Implementation (2026-04-09, PR #88)

- ✅ `packages/daemon/src/agent-registry.ts` — in-memory `Map<instanceId, entry>` mit register / heartbeat / unregister / sweep / listener-subscription. Staleness = `3 × heartbeatIntervalMs`. Background-`setInterval` via injectierbarem Clock + Timer-Shim (testbar ohne echten Timer). 16 Unit-Tests.
- ✅ `packages/daemon/src/agent-api.ts` — Fastify-Plugin mit loopback-only REST-Endpoints:
  - `POST /api/agent/register` → `{ instance_spiffe_uri, heartbeat_interval_ms, inbox_schema_version }`, baut die 4-Komponenten-SPIFFE-URI (`/agent/<type>/instance/<id>`) aus der Daemon-3-Komponenten-URI + `agent_type` + `instance_id`, 409 bei Re-Register mit anderem `agent_type`, 400 bei unzulaessigem `instance_id` (Regex `[A-Za-z0-9._-]+`)
  - `POST /api/agent/heartbeat` → 404 wenn unbekannt (Client re-registriert)
  - `POST /api/agent/unregister` → idempotent (200 mit `existed: bool`)
  - `GET /api/agent/instances` → read-only Liste fuer Dashboard/Debug
  12 Integration-Tests via `fastify.inject()`.
- ✅ Neue Audit-Event-Types in `audit.ts`: `AGENT_REGISTER`, `AGENT_HEARTBEAT`, `AGENT_UNREGISTER`, `AGENT_STALE`.
- ✅ Wire-up in `index.ts`: Registry-Instanz erzeugt, `start()` beim Daemon-Start, Routes registriert, `stop()` im graceful shutdown vor `libp2pRuntime.stop()` und `cardServer.stop()`.
- ✅ Loopback-Schutz via `requireLocal()` wie in `inbox-api.ts` (PR #83 Pattern).

### Noch offen fuer Phase 3

- WebSocket-Push-Complement (Event-Bus `inbox:new` → Dashboard + MCP-Stdio-Listener)
- Client-initiated Long-Poll sobald MCP-Harness das unterstuetzt

### Nicht angenommen

- **Kein Abwarten auf "strukturelle Loesung" Phase 3** — beide Reviewer sagen Phase 1 (Cron) ist als Interim korrekt, wir sollen nicht auf die perfekte Loesung warten.
