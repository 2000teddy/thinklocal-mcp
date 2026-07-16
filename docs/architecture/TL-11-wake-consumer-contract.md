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
Nur dieser Pfad durchläuft den Loopback-Gate (`websocket.ts:138-145`, §2) — er ist der **einzige
kontrakt-konforme** Weg, den `agent`-Filter zu setzen.

**Frame-Form — für den `agent`-Filter NICHT unterstützt (unsicher, bis Härtung landet):**
```jsonc
// { "type": "subscribe", "events": ["agent:wake"], "agent": "…" }
//   ^ Das Setzen von `agent` per Frame UMGEHT derzeit den Loopback-Gate (websocket.ts:187-189, s. §8.1).
//     Ein konformer Konsument setzt den agent-Filter deshalb AUSSCHLIESSLICH über die Query-Form oben.
//     Der Frame-`subscribe` ist NUR zum Ändern der Event-Typ-Liste (`events`) gedacht; `agent` per Frame
//     ist bis zum Härtungs-Slice (§8.1) unsupported/unsafe und darf im Kontrakt nicht angenommen werden.
```

- `agent` matcht gegen **`spiffe_uri` ODER `instance_id`** des Payloads (`websocket.ts:66`). Beide sind
  zulässige Filterwerte; die SPIFFE-URI ist die stabile Wahl.
- Ohne `agent`-Filter → **kein** `agent:wake` (deny-by-default, `websocket.ts:64`). Ein reiner
  `subscribe=agent:wake` ohne `agent=` empfängt nie etwas.
- Der Event-Typ-Filter greift **zuerst**: wer nur `inbox:new` abonniert, bekommt **kein** `agent:wake`
  (`websocket.test.ts:112`). Darum **explizit** `agent:wake` abonnieren.

## 4. Payload-Schema (`agent:wake`)

```jsonc
{
  "instance_id": "<lokale Agent-Instanz-ID>",   // string, nicht-leer
  "spiffe_uri":  "spiffe://thinklocal/node/<PeerID>", // 4-Komponenten-SPIFFE der Instanz, nicht-leer
  "reason":      "inbox"                          // WakeReason — aktuell einziger Wert
}
```

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
    if (ev.type === 'agent:wake') pokeCli(ev.reason);        // Zero-Content → nur Trigger
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

## 8. Was bleibt extern-blocked (präzise, mit Beleg)

- **TL-11 Slice B** = der **Out-of-Repo Agent-Home-Supervisor** (`pokeCli`) + der **Zwei-Peer-Live-Proof**
  (CLI reagiert auf ein reales Wake **ohne** dazwischenliegenden Poll). Beleg: `ADR-043 §48-51`
  („`agent:wake` → laufender CLI = Out-of-Repo … blocked auf die Supervisor-Änderung"). Diese Spec
  **entfernt** den Blocker nicht — sie **de-riskt** ihn, indem der Supervisor jetzt gegen einen fixen,
  testgebundenen Kontrakt gebaut werden kann.
- **Kein neuer Beschluss nötig für den Konsumenten:** alle Werte oben stammen aus gemergtem Code
  (#271/#277). Sollte ein zukünftiger `reason`-Typ oder ein Opt-in-Broadcast gewünscht werden, ist das ein
  **separater** Beschluss (nicht Teil dieser Spec).

### 8.1 OFFENER Sicherheits-Befund (beim Schreiben dieser Spec entdeckt, mit Beleg)

Die **Loopback-Pflicht** (§2) wird **nur auf dem Query-Param-Pfad** durchgesetzt: der `4003`-Gate prüft
`query.agent` **beim Connect** (`websocket.ts:138-145`). Der **Frame-Pfad** `{type:'subscribe',
agent:'…'}` setzt `state.agentFilter` jedoch **ohne** jede Loopback-Prüfung (`websocket.ts:187-189`).
**Folge:** ein Nicht-Loopback-Client kann **ohne** `?agent=` verbinden (Gate nicht ausgelöst), danach per
Frame einen `agent`-Filter setzen und so `agent:wake`-Events einer fremden Instanz abonnieren — der
Loopback-Schutz gegen Event-Snooping ist umgehbar (mTLS-Peer vorausgesetzt, aber nicht Loopback).

- **Status:** dokumentiert, **nicht** eigenmächtig gefixt — die *korrekte* Invariante ist eine
  **Design-Entscheidung** (strikt loopback-only **vs.** „jeder mTLS-authentifizierte Mesh-Peer darf
  filtern"). Der Query-Gate-Kommentar sagt „prevent event snooping" → Intent = loopback-only; dann ist der
  Frame-Pfad ein **Enforcement-Loch**, das gestopft gehört (Loopback-Check auch im Frame-Handler,
  z.B. `isLoopback` in `ClientState` am Connect stempeln + im `subscribe`-Frame prüfen, `4003` bei Verstoß).
- **Für den Konsumenten dieser Spec irrelevant** (er ist ohnehin loopback, §2) — der Befund betrifft die
  **Härtung** des Daemons, nicht das Consumer-Verhalten. Eigener Slice (TS+CR); kein Live-Exploit-Druck.

## 9. Verweise
- `docs/architecture/ADR-043-heartbeat-wake-contract.md` — daemon-seitige Entscheidung (Slice A).
- `docs/architecture/TL-11-12-wake-postbox-discovery.md` — Reihenfolge/Discovery (TL-12 vor TL-11).
- Code: `packages/daemon/src/wake-contract.ts` (Emitter/Coalescer), `packages/daemon/src/websocket.ts`
  (directed Routing, `matchesSubscription`), Mount `packages/daemon/src/index.ts:1398`.
- `docs/DIAGNOSE-api-status-phantom-rot.md` — warum die mTLS-Pflicht (§2) auch für den WS-Konsumenten gilt.
