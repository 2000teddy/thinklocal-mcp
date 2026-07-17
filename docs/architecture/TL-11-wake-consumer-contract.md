# TL-11 — Wake-Consumer-Contract (Agent-Home-Supervisor ↔ Daemon)

**Status:** aktiv · **Erstellt:** 2026-07-16 · **Typ:** Consumer-facing Implementer-Spec (kein neuer
Design-Beschluss — leitet den bereits gemergten Kontrakt aus Code ab). **Companion zu:**
`ADR-043-heartbeat-wake-contract.md` (daemon-seitige Entscheidung, TL-11 Slice A, #271) +
directed-Wake-Routing (#277).

> **Zweck.** ADR-043 dokumentiert die **daemon-seitige** Entscheidung. Was fehlte: die **implementierbare
> Schnittstelle**, gegen die der (Out-of-Repo) **Agent-Home-Supervisor** aus TL-11 Slice B gebaut wird —
> WS-Endpunkt, Auth, Subscribe-Frame, Payload-Schema, Zustell-Semantik, Referenz-Loop. Diese Spec pinnt
> genau das aus dem gemergten Code (`wake-contract.ts`, `websocket.ts`), damit Slice B (extern-blocked)
> gegen einen **stabilen Kontrakt** entwickelt werden kann. **Jede Garantie unten ist testgebunden** (§7).

---

## 1. Rolle & Grenze

- **Daemon (dieser Repo):** erkennt eine an eine **konkrete, live** lokale Agent-Instanz adressierte
  Postfach-Nachricht und **emittiert genau ein gerichtetes, inhaltsfreies `agent:wake`-Event** über die
  WS-Route `/ws`. Mehr nicht — **kein neuer Transport**, kein Prozess-Signal, kein CLI-Hop.
- **Agent-Home-Supervisor (Out-of-Repo, TL-11 Slice B):** ein Prozess im Home des Agenten, der `/ws`
  abonniert, das `agent:wake` seiner Instanz empfängt und daraufhin **den lokalen CLI-Agenten weckt**
  („prüfe dein Postfach"). Der letzte Hop (Supervisor → CLI) ist **bewusst out-of-repo** und der einzige
  echte Blocker für den End-to-End-Zwei-Peer-Proof (§8).

Diese Spec definiert die Linie **dazwischen**.

## 2. Endpunkt & Auth (mTLS **und** Loopback — beide Pflicht)

- **URL:** `wss://127.0.0.1:9440/ws` — die WS-Route hängt am **`cardServer`** (`index.ts:1398`,
  `registerWebSocket(cardServer.getServer(), …)`), demselben Server wie `/api/status` und `/health`.
- **mTLS-Pflicht:** der `cardServer` erzwingt `requestCert: true` + `rejectUnauthorized: true` ohne
  Public-Path-Allowlist (`agent-card.ts:225-231`). Der Supervisor **MUSS** ein gültiges Mesh-Client-Cert
  präsentieren (`node.crt.pem`/`node.key.pem` gegen die Mesh-`ca.crt.pem`). Eine cert-lose oder
  `http://`/`ws://`-Verbindung wird auf TLS-Ebene resettet — **kein** Wake, und für ein naives Board
  ununterscheidbar von „Daemon down" (→ Phantom-ROT, s. `DIAGNOSE-api-status-phantom-rot.md`).
- **Loopback-Pflicht (HART):** Eine agent-gefilterte Subscription (die ein Wake-Konsument **zwingend**
  braucht, §3) ist **nur von Loopback** erlaubt. Setzt der Client `?agent=` von einer Nicht-Loopback-IP
  (≠ `127.0.0.1`/`::1`/`::ffff:127.0.0.1`), schließt der Daemon die Verbindung sofort mit **Close-Code
  `4003`** („Agent-filtered subscriptions are loopback-only", `websocket.ts:138-145`, gegen Event-Snooping).
  **Konsequenz:** Der Agent-Home-Supervisor **MUSS auf dem Daemon-Host laufen** und über `127.0.0.1`
  verbinden. Ein Supervisor auf einem anderen Host kann keine Wakes empfangen — selbst mit gültigem
  mTLS-Cert. (Das ist konsistent mit „Agent-Home-Supervisor" = im Home **des** Agenten, also lokal.)

## 3. Subscription (der Konsument MUSS filtern)

`agent:wake` ist ein **gerichtetes** Event (`DIRECTED_EVENT_TYPES`, `websocket.ts:48`): es wird **niemals**
an einen ungefilterten Client geliefert (deny-by-default, schließt den Metadaten-Leak D1). Der Supervisor
MUSS daher **beides** setzen: den Event-Typ `agent:wake` **und** einen `agent`-Filter auf die Ziel-Identität.

**Vorgeschriebene Form — Query-Param beim Connect (der `agent`-Filter MUSS hier gesetzt werden):**
```
wss://127.0.0.1:9440/ws?subscribe=agent:wake&agent=spiffe://thinklocal/node/<PeerID>
```
Dieser Pfad durchläuft den Loopback-Gate (`websocket.ts`, §2) und ist der **empfohlene** Weg, den
`agent`-Filter zu setzen (einmalig, deterministisch am Connect).

**Frame-Form — `agent`-Filter jetzt ebenfalls loopback-gated (seit §8.1-Härtung):**
```jsonc
// { "type": "subscribe", "events": ["agent:wake"], "agent": "…" }
//   ^ Das Setzen von `agent` per Frame durchläuft jetzt DIESELBE Loopback-Schranke wie die Query-Form
//     (rejectsAgentFilter, §8.1): von Nicht-Loopback → Close 4003; von Loopback → erlaubt. Der frühere
//     Bypass ist geschlossen. Empfehlung bleibt Query-Form (§6-Referenz-Loop); der Frame-`subscribe`
//     dient primär dem Ändern der Event-Typ-Liste (`events`).
```

- `agent` matcht gegen **`spiffe_uri` ODER `instance_id`** des Payloads (`websocket.ts:66`). Beide sind
  zulässige Filterwerte; die SPIFFE-URI ist die stabile Wahl.
- Ohne `agent`-Filter → **kein** `agent:wake` (deny-by-default, `websocket.ts:64`). Ein reiner
  `subscribe=agent:wake` ohne `agent=` empfängt nie etwas.
- Der Event-Typ-Filter greift **zuerst**: wer nur `inbox:new` abonniert, bekommt **kein** `agent:wake`
  (`websocket.test.ts:112`). Darum **explizit** `agent:wake` abonnieren.

## 4. Payload-Schema (`agent:wake`)

**Wire-Form (verifiziert, `tl11-wake-wire.conformance.test.ts`):** der Fanout sendet das GANZE `MeshEvent`
(`websocket.ts:266`, `JSON.stringify(event)`). Auf dem Draht ist der Wake also ein Umschlag mit dem Payload
**unter `.data`** — nicht flach:
```jsonc
{
  "type": "agent:wake",                 // Event-Typ (der Konsument prüft ev.type)
  "timestamp": "2026-07-17T06:00:00.000Z", // ISO-8601 (MeshEvent-Metadatum)
  "data": {                             // ← der eigentliche Payload liegt HIER
    "instance_id": "<lokale Agent-Instanz-ID>",         // string, nicht-leer
    "spiffe_uri":  "spiffe://thinklocal/node/<PeerID>", // 4-Komponenten-SPIFFE der Instanz, nicht-leer
    "reason":      "inbox"                              // WakeReason — aktuell einziger Wert
  }
}
```
> **Achtung Konsument:** `reason`/`instance_id`/`spiffe_uri` unter **`ev.data`** lesen, nicht `ev.reason`.

- **Zero-Content (invariant):** der Payload trägt **keinen** Nachrichteninhalt — nicht einmal
  `message_id` oder einen Count (`WakeSignal`, `wake-contract.ts:18`). Bedeutung ist ausschließlich
  „**prüfe dein Postfach**". Keine Exfiltration über das Wake.
- `reason` ist heute konstant `'inbox'` (`WakeReason = 'inbox'`). Weitere Gründe sind additiv möglich —
  ein Konsument sollte unbekannte `reason`-Werte **tolerant** als „prüfe dein Postfach" behandeln.
- **Reaktion des Supervisors:** auf `agent:wake` → CLI wecken → der geweckte Agent liest sein Postfach
  via `GET /api/inbox` (re-verifiziert live, surfaced `is_order`/`order` — TL-12 Slice A). Das Wake
  selbst transportiert nie den Nachrichteninhalt.

## 5. Zustell-Semantik (bewusst schwach — der Konsument MUSS robust sein)

| Eigenschaft | Garantie | Konsequenz für den Supervisor |
|---|---|---|
| **Best-effort / lossy** | keine Zustellgarantie; WS-Reconnect-Lücke verliert Wakes (ADR-043 §3) | beim (Re-)Connect **immer** einmal das Postfach pollen (Cold-Start-Sweep), nicht allein auf Wakes verlassen |
| **Idempotent** | zwei Wakes == ein Wake (Zero-Content) | Wake ist nur ein Trigger; mehrfaches Wecken ist harmlos |
| **Coalesced** | ≤ 1 Wake pro Instanz pro Fenster (`DEFAULT_WAKE_COALESCE_MS = 2000`) | N rasche Nachrichten → 1 Wake; nach dem Wecken **alle** neuen Nachrichten lesen, nicht „eine pro Wake" |
| **Directed** | nur an passenden `agentFilter`-Client, nie Broadcast | ein Supervisor sieht **nur** die Wakes **seiner** Instanz(en) |
| **Fail-closed** | keine SPIFFE / Ziel nicht live / unadressiert → **kein** Wake | ausbleibendes Wake ≠ „keine Post"; der Cold-Start-Sweep deckt diese Fälle ab |

**Merksatz:** Das Wake ist eine **Optimierung gegen Poll-Latenz**, kein Transport mit Zustellgarantie.
Ein korrekter Supervisor ist auch **ohne** jedes Wake funktional (nur langsamer) — Wakes machen ihn schnell.

## 6. Referenz-Konsument (MVP-Shape, Pseudocode)

```ts
// Out-of-Repo (Agent-Home-Supervisor). Repo-ready SHAPE, keine Zustellgarantie-Annahme.
const SELF = 'spiffe://thinklocal/node/<PeerID>';            // eigene Instanz-SPIFFE
const url  = `wss://127.0.0.1:9440/ws?subscribe=agent:wake&agent=${encodeURIComponent(SELF)}`;

function connect() {
  const ws = new WebSocket(url, { cert, key, ca });          // mTLS-Pflicht (§2)
  ws.on('open',  () => pokeCli('cold-start sweep'));         // §5: beim Connect IMMER einmal pollen
  ws.on('message', (raw) => {
    const ev = JSON.parse(raw);
    if (ev.type === 'agent:wake') pokeCli(ev.data?.reason);  // Zero-Content → nur Trigger (Payload unter .data, §4)
  });
  ws.on('close', () => setTimeout(connect, backoff()));      // Reconnect; die Lücke deckt der Sweep
}
// pokeCli(): weckt den lokalen CLI-Agenten → dieser liest GET /api/inbox (verifiziert Orders live).
```

Der einzige nicht-triviale Teil — `pokeCli()` (wie genau wird der CLI-Prozess geweckt) — ist die
**Out-of-Repo-Supervisor-Entscheidung** und der Gegenstand von TL-11 Slice B (§8).

## 7. Test-Verankerung (jede Garantie ist im Repo bewacht)

| Garantie (§) | Test |
|---|---|
| adressiert+live → genau 1 inhaltsfreies Wake **mit** `spiffe_uri` (§4) | `wake-contract.test.ts:95` |
| unadressiert/null/leer → **0** Wakes (kein Broadcast) (§5 fail-closed) | `wake-contract.test.ts:29,66` |
| Ziel nicht live → **kein** Wake + WARN (§5) | `wake-contract.test.ts:34,131` |
| live Instanz **ohne** SPIFFE → **kein** Wake (nicht routbar) (§3/§5) | `wake-contract.test.ts:104` |
| zwei rasche Nachrichten → **1** Wake (coalesced) (§5) | `wake-contract.test.ts:61,140` |
| directed: **nie** an ungefilterten Client (Leak zu, D1) (§3) | `websocket.test.ts:92` |
| directed: matcht `agentFilter=spiffe_uri` **und** `=instance_id` (§3) | `websocket.test.ts:97,102` |
| directed: nicht-passender Filter → drop (deny-by-default) (§3) | `websocket.test.ts:107` |
| Event-Typ-Filter greift zuerst (nur `inbox:new` abonniert → kein Wake) (§3) | `websocket.test.ts:112` |
| Regression: nicht-directed Event an Ungefilterten → unverändert Delivery | `websocket.test.ts:117` |

### 7.1 Draht-Ebene (echter `/ws`-Socket, nicht nur reine Funktionen) — `tl11-wake-wire.conformance.test.ts`

Die Tabelle oben bewacht die **Routing-Logik** (reine Funktionen). Zusätzlich treibt ein Conformance-Test
den **realen Loopback-Socket** so, wie der Supervisor ihn trifft (connect → subscribe → Frame empfangen):

| Wire-Garantie (§) | Beleg |
|---|---|
| §3 Query-Subscribe → `system:connected` spiegelt `agentFilter` | `tl11-wake-wire.conformance.test.ts` |
| §4 adressiert+gefiltert → genau 1 Zero-Content-Frame, Payload **unter `.data`** | ″ |
| §3 directed Match per `instance_id` (nicht nur SPIFFE) | ″ |
| §3/§5 deny-by-default: **ungefilterter** Client bekommt NIE `agent:wake` (Same-Socket-Barrier) | ″ |
| §3/§5 directed drop: falscher Filter → kein Wake | ″ |
| §8.1 Frame-Pfad von Loopback: `agent` per Frame gesetzt → Wake zugestellt | ″ |
| §2 Loopback-Positivpfad: agent-gefilterter Connect von 127.0.0.1 nicht geschlossen | ″ |

**Deckungsgrenze (als `it.todo` markiert, eigener schwererer Slice):** §2 mTLS-Pflicht (cert-lose/`ws://` →
TLS-Reset) braucht cardServer-TLS + Client-Cert-Fixtures; der Nicht-Loopback-`4003`-Reject braucht eine
Bindung an ein Nicht-Loopback-Interface (auf einem 127.0.0.1-Harness ist `req.ip` ohne `trustProxy` immer
Loopback). Diese bleiben unit-bewacht (`rejectsAgentFilter`/`isLoopbackIp`), bis die Fixtures stehen.

## 8. Was bleibt extern-blocked (präzise, mit Beleg)

- **TL-11 Slice B** = der **Out-of-Repo Agent-Home-Supervisor** (`pokeCli`) + der **Zwei-Peer-Live-Proof**
  (CLI reagiert auf ein reales Wake **ohne** dazwischenliegenden Poll). Beleg: `ADR-043 §48-51`
  („`agent:wake` → laufender CLI = Out-of-Repo … blocked auf die Supervisor-Änderung"). Diese Spec
  **entfernt** den Blocker nicht — sie **de-riskt** ihn, indem der Supervisor jetzt gegen einen fixen,
  testgebundenen Kontrakt gebaut werden kann.
- **Kein neuer Beschluss nötig für den Konsumenten:** alle Werte oben stammen aus gemergtem Code
  (#271/#277). Sollte ein zukünftiger `reason`-Typ oder ein Opt-in-Broadcast gewünscht werden, ist das ein
  **separater** Beschluss (nicht Teil dieser Spec).

### 8.1 Sicherheits-Härtung — Frame-Pfad-Loopback-Loch (GESCHLOSSEN)

**Befund (bei Erstellung dieser Spec entdeckt):** Die **Loopback-Pflicht** (§2) wurde **nur auf dem
Query-Param-Pfad** durchgesetzt — der `4003`-Gate prüfte `query.agent` beim Connect. Der **Frame-Pfad**
`{type:'subscribe', agent:'…'}` setzte `state.agentFilter` **ohne** Loopback-Prüfung. Ein Nicht-Loopback-
mTLS-Peer konnte **ohne** `?agent=` verbinden (Gate nicht ausgelöst) und danach per Frame einen `agent`-
Filter setzen → `agent:wake`-Events einer fremden Instanz abonnieren (Snooping-Schutz umgehbar).

**Auflösung:** Der Frame-Pfad setzt jetzt **dieselbe** Loopback-Schranke durch. Die Regel ist in die reine
Funktion `rejectsAgentFilter(agent, isLoopback)` extrahiert und wird von **beiden** Pfaden benutzt; die
Connection-Loopback-Herkunft wird am Connect aus `req.ip` in `ClientState.isLoopback` gestempelt; ein
verstoßender Frame wird **vor** jeder State-Mutation mit `4003` geschlossen. Entschieden wurde die
**konservative, bereits gemergte** Invariante (**strikt loopback-only**, fail-closed) — nicht die
Alternative „jeder mTLS-Peer darf filtern" (die einen deliberaten Snooping-Schutz geschwächt hätte und
einen positiven Beschluss gebraucht hätte). `req.ip` ist nicht header-spoofbar: der `cardServer` setzt
**kein** `trustProxy` (Default false) → `req.ip` = Socket-Peer-Adresse.

**Beleg / Tests:** `websocket.ts` `rejectsAgentFilter` + `isLoopbackIp` + Frame-Gate; Regeltabelle in
`websocket.test.ts` (`rejectsAgentFilter`: remote+nicht-leer → reject, loopback → allow, leer/absent →
allow; `isLoopbackIp`: v4/v6/v4-mapped). Geschlossen in PR (KW30 TL-11-Härtungs-Slice).

## 9. Verweise
- `docs/architecture/ADR-043-heartbeat-wake-contract.md` — daemon-seitige Entscheidung (Slice A).
- `docs/architecture/TL-11-12-wake-postbox-discovery.md` — Reihenfolge/Discovery (TL-12 vor TL-11).
- Code: `packages/daemon/src/wake-contract.ts` (Emitter/Coalescer), `packages/daemon/src/websocket.ts`
  (directed Routing, `matchesSubscription`), Mount `packages/daemon/src/index.ts:1398`.
- `docs/DIAGNOSE-api-status-phantom-rot.md` — warum die mTLS-Pflicht (§2) auch für den WS-Konsumenten gilt.
