# TL-11 — Wake-Routing für registrierte Agenten + Mailbox-Check-Flow (Scoping/Design)

**Status:** SCOPING/DESIGN (doc-first, **kein Code** in diesem Slice) · KW30 · 2026-07-16
**Baut auf:** ADR-043 (TL-11 Slice A, merged) · ADR-004 (Cron-Heartbeat für Inbox-Polling) · löst ADR-043s
benannte **offene Abhängigkeit „WS-Instanz-Bindung"**. **Berührt PR #274 nicht.**

## 1. Problem: der gemergte Wake-Kontrakt ist noch NICHT konsumierbar
Slice A (ADR-043) verdrahtet `inbox:new` → **`agent:wake`**-Event über Registry-Fanout, fail-closed, ohne
neuen Transport (WS-`inbox:new`-Reuse). Der letzte Hop = ein registrierter Agent, der auf sein Wake
reagiert und sein Postfach prüft. **Heute kann kein registrierter Agent dieses Wake empfangen** — zwei
verifizierte Defekte (Stand main 2026-07-16):

- **(D1) Leak.** `agent:wake` trägt nur `{ instance_id, reason }` (`wake-contract.ts:118`). `matchesSubscription`
  (`websocket.ts:45-59`) keyt den Agent-Filter auf `from/to/agentId/peer_id` — keins davon ist gesetzt. Ein
  **ungefilterter** Dashboard-Client (kein `agentFilter`) bekommt via `eventBus.onAny` (`websocket.ts:210`)
  **jedes** `agent:wake` inkl. Ziel-`instance_id` → breite Metadaten-Sichtbarkeit, wer gerade Post hat.
- **(D2) Mis-Routing.** Ein Loopback-Konsument (der geplante Agent-Home-Supervisor), der mit
  `agent=<spiffe_uri>` filtert, matcht `agent:wake` **NIE** (die vier gekeyten Felder fehlen) → der eigentliche
  Empfänger kann sein eigenes Wake gar nicht abonnieren.

Folge: der Kontrakt ist gebaut, aber **unroutbar**. Diese Slice legt das Routing fest, damit ein registrierter
Agent sein Wake gezielt empfängt (und niemand sonst).

## 2. Design-Entscheidung: `agent:wake` als **gerichtetes (directed)** Event
> **D-DIRECTED:** `agent:wake` wird an der WS-Grenze als *directed* behandelt: **nur** an einen Client, dessen
> `agentFilter` das Ziel matcht — **nie** an einen ungefilterten Client. Deny-by-default. Das schließt D1
> (kein Leak an Dashboards) **und** D2 (der gefilterte Supervisor matcht) in einem Zug.

Damit der Filter greifen kann, trägt das Event eine **adressierbare Identität**:
> **D-PAYLOAD:** `agent:wake` trägt zusätzlich `spiffe_uri` (die 4-komponentige `AgentRegistryEntry.spiffeUri`)
> **und** behält `instance_id`. Der Emitter liest die `spiffeUri` aus der Registry (nicht aus dem WS).

`matchesSubscription` wird erweitert:
1. Eine Menge `DIRECTED_EVENT_TYPES = { 'agent:wake' }`.
2. Für ein directed Event: Ohne `agentFilter` → **drop** (nie an Ungefilterte). Mit `agentFilter` → match, wenn
   `agentFilter` gleich `instance_id` **oder** `spiffe_uri` ist (zusätzlich zu den bestehenden
   `from/to/agentId/peer_id`, die für andere Events unverändert bleiben).
3. Nicht-directed Events: Verhalten **unverändert** (Regressionsschutz).

Der bestehende **Loopback-Zwang** für agent-gefilterte Subscriptions (`websocket.ts:119-127`, nur
`127.0.0.1`/`::1`) bleibt und ist genau richtig: ein directed Wake darf nur an einen lokalen Prozess auf
demselben Host gehen — kein Remote-Snooping.

## 3. Mailbox-Check-Flow für einen registrierten Agenten (Ziel-End-to-End)
Ersetzt/ergänzt das blinde Cron-Poll aus ADR-004 durch einen edge-getriebenen Pfad:
1. **Register:** Agent registriert sich (`instanceId` + `spiffeUri`) in der AgentRegistry (bereits vorhanden).
2. **Subscribe:** Agent (oder sein lokaler Supervisor) öffnet WS auf `127.0.0.1` mit
   `?subscribe=agent:wake&agent=<eigene spiffe_uri>` — loopback-only erzwungen.
3. **Wake:** `inbox:new` für seine Instanz → Daemon emittiert `agent:wake` (coalesced, fail-closed) → **nur**
   dieser Client erhält es.
4. **Check:** auf Wake ruft der Agent `read_inbox` (bzw. `/api/inbox`) → verarbeitet neue Nachrichten/Orders
   (idempotent; Order-Ausführung ist TL-12, nicht hier).
5. **Fallback:** bleibt das Cron-Poll (ADR-004) als Sicherheitsnetz — Wake ist best-effort/lossy (ADR-043), das
   Poll fängt verpasste Wakes. Edge-driven senkt Latenz + Poll-Frequenz, ersetzt das Poll nicht hart.

## 4. Nächster Code-Slice (eigener PR nach diesem Doc) — exakte Änderungen + Testplan
- **`wake-contract.ts`:** `WakeSignal`/Emitter um `spiffeUri` erweitern; `WakeEmitterDeps.listInstances` →
  liefert `{ instanceId, spiffeUri }` (oder ein `resolveSpiffe(instanceId)`); Emit = `{ instance_id, spiffe_uri,
  reason }`. Fail-closed bleibt (kein spiffe → Instanz nicht wecken, nicht raten).
- **`websocket.ts`:** `DIRECTED_EVENT_TYPES` + directed-Zweig in `matchesSubscription` (drop-für-ungefiltert,
  match auf `instance_id`/`spiffe_uri`).
- **Tests:** (a) directed Event ohne agentFilter → **kein** Delivery (Leak zu); (b) mit passendem
  `agent=<spiffe_uri>` → Delivery; (c) mit `agent=<instance_id>` → Delivery; (d) nicht-passender Filter → drop;
  (e) **nicht-directed** Event an ungefilterten Client → unverändert Delivery (Regressionsschutz); (f) Emitter
  trägt `spiffe_uri` und weckt fail-closed nicht ohne spiffe.
- **CR/PC/DO** wie üblich; **CO** empfohlen vor dem Code-Slice, falls der directed-Mechanismus kontrovers ist
  (Alternative: separater directed-Bus statt `onAny`-Filter — hier bewusst der minimale Filter-Weg).

## 5. Sicherheits-Invarianten (im Code-Slice zu testen)
1. **Kein Leak:** `agent:wake` erreicht **nie** einen ungefilterten Client. (D1)
2. **Routbar:** ein `agent=<spiffe_uri|instance_id>`-Filter matcht das Ziel-Wake. (D2)
3. **Deny-by-default:** unbekanntes/nicht-passendes Ziel → drop, nicht broadcast.
4. **Loopback-only** für agent-gefilterte Subscriptions bleibt erzwungen (kein Remote-Snoop).
5. **Fail-closed-Fanout** aus ADR-043 unberührt (kein Broadcast bei null/nicht-live).
6. Nicht-directed Events unverändert (keine Regression an bestehenden Dashboard-Subscriptions).

## 6. Bewusste Grenze / extern-blocked
Der **CLI-letzte-Hop** (der Supervisor, der das Wake in den laufenden CLI-Prozess trägt) und der **Zwei-Peer-
Live-Proof** (CLI-Reaktion ohne dazwischenliegenden Poll) bleiben **extern-blocked** (Out-of-Repo Agent-Home-
Supervisor), wie in ADR-043. Diese Slice macht den Kontrakt *repo-seitig konsumierbar*; sie beweist ihn nicht
live. Opt-in-Broadcast-Wake + Reconciliation-Sweep bleiben spätere additive Slices.

## 7. Empfehlung
Kleiner, klar begrenzter Code-Slice (§4) als Folge-PR: schließt den verifizierten Leak, macht den gemergten
Wake-Kontrakt für registrierte Agenten routbar, und schaltet den Mailbox-Check-Flow (§3) frei — ohne neuen
Transport und ohne den extern-blockierten CLI-Hop. Dieses Doc ist die Design-Grundlage dafür.
