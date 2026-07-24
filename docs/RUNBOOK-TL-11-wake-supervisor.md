# RUNBOOK — TL-11 Slice B: Agent-Home-Supervisor + Zwei-Peer-Wake-Proof

**KW30 · Integrations-Runbook (Prep) · Erstellt 2026-07-19 · repo-lokal, doc-only.**
Operative Anleitung, um den **Out-of-Repo Agent-Home-Supervisor** (TL-11 Slice B) gegen den bereits fixen,
testgebundenen **Wake-Consumer-Contract** aufzustellen und den **Zwei-Peer-Live-Proof** zu fahren — **ohne**
Deploy-/Fenster-Arbeit, **ohne** Secrets, **ohne** Supervisor-Code in diesem Repo. Companion zur Protokoll-
Spec `docs/architecture/TL-11-wake-consumer-contract.md` (dort die Draht-Details; **hier** die Schritte).

> **Grenze zuerst (damit nichts falsch gelesen wird):** Dieses Runbook **entfernt den Blocker nicht.** Der
> letzte Hop — Supervisor weckt den lokalen CLI-Prozess (`pokeCli`) — ist **bewusst out-of-repo** und der
> eigentliche Proof ist **Host-/Deploy-gated** (`[[dod-two-peer-mcp-proof]]`, `[[week1-remote-restart-rollout]]`).
> Das Runbook **de-riskt** die externe Arbeit: wenn ein Host-Fenster geöffnet wird (separat, Christian-/
> Operator-gated), folgt der Operator diesen Schritten, statt den Kontrakt neu zu erarbeiten. `pokeCli` ist
> **kein** Repo-Symbol — es ist die vom Supervisor selbst zu treffende Weck-Aktion (Consumer-Contract §6/§8).

---

## 0. Voraussetzungen (repo-seitig bereits erfüllt — nur prüfen)
- **Daemon läuft** auf dem Ziel-Host mit gemountetem WS (`registerWebSocket(cardServer.getServer(), …)`,
  `index.ts:1398`); WS-Route `wss://127.0.0.1:9440/ws` liegt am selben `cardServer` wie `/api/status`/`/health`.
- **Wake-Emitter aktiv:** `wake-contract.ts` abonniert `inbox:new`, emittiert das gerichtete, inhaltsfreie
  `agent:wake` (verifiziert, `wake-contract.test.ts`, `tl11-wake-wire.conformance.test.ts`).
- **Kanonische Instanz-Identität** des Ziel-Agenten steht (`spiffe://thinklocal/node/<PeerID>`) — TL-13-Vorlauf.

## 1. Verortung des Supervisors (nicht verhandelbar: **derselbe Host, Loopback**)
Der Contract erzwingt für die agent-gefilterte Subscription **mTLS UND Loopback** (Spec §2). Ein `?agent=`
von einer Nicht-Loopback-IP → Daemon schließt sofort mit Close-Code **`4003`**. **Konsequenz:** Der
Agent-Home-Supervisor **MUSS auf dem Daemon-Host laufen** und über `127.0.0.1` verbinden. Ein Supervisor auf
einem anderen Host kann **kein** Wake empfangen — auch mit gültigem Cert. (Passt zu „Home **des** Agenten".)

## 2. Client-Cert (kein Secret in diesem Runbook)
Der Supervisor präsentiert das **vorhandene** Mesh-Client-Cert des Hosts (`node.crt.pem`/`node.key.pem` gegen
`ca.crt.pem`) — **dieselben** Dateien, die der Daemon schon nutzt. **Kein** neues Cert, **kein** Key-Material
in diesem Repo/Runbook. Cert-los oder `ws://` → TLS-Reset (Spec §2), für ein naives Board ununterscheidbar
von „Daemon down" (Phantom-ROT, `DIAGNOSE-api-status-phantom-rot.md`).

## 3. Verbindung + Subscription (genau eine vorgeschriebene Form)
```
wss://127.0.0.1:9440/ws?subscribe=agent:wake&agent=spiffe://thinklocal/node/<PeerID>
```
- **Beides** setzen: Event-Typ `agent:wake` **und** `agent`-Filter (deny-by-default; ohne Filter nie ein
  Wake — Spec §3). `agent` matcht `spiffe_uri` **oder** `instance_id`; die SPIFFE-URI ist die stabile Wahl.
- Query-Form bevorzugen (deterministisch am Connect). Frame-`subscribe` ist jetzt **ebenfalls** loopback-
  gated (§8.1-Härtung) — kein Bypass.

## 4. Reaktion auf `agent:wake` (Payload liegt **unter `.data`**)
- Der Wire-Frame ist der ganze `MeshEvent`-Umschlag; Payload unter **`ev.data`** (`{ instance_id, spiffe_uri,
  reason:'inbox' }`), **nicht** flach. `ev.data.reason` lesen, nicht `ev.reason` (Spec §4).
- **Zero-Content:** das Wake trägt **keinen** Nachrichteninhalt (nicht mal `message_id`). Bedeutung
  ausschließlich „**prüfe dein Postfach**". Unbekannte künftige `reason`-Werte **tolerant** behandeln.
- **Aktion:** `pokeCli()` (out-of-repo) weckt den lokalen CLI-Agenten → der liest sein Postfach via
  **`GET /api/inbox`** (re-verifiziert Orders live). Das Wake selbst transportiert nie Inhalt.

## 5. Robustheit — Pflicht, weil die Zustellung bewusst schwach ist (Spec §5)
| Eigenschaft | Was der Supervisor tun MUSS |
|---|---|
| best-effort/lossy | beim **(Re-)Connect immer** einmal `GET /api/inbox` pollen (**Cold-Start-Sweep**) — nie allein auf Wakes verlassen |
| coalesced (`≤1/2000 ms`) | nach dem Wecken **alle** neuen Nachrichten lesen, nicht „eine pro Wake" |
| idempotent | mehrfaches Wecken ist harmlos (Zero-Content-Trigger) |
| fail-closed | ausbleibendes Wake ≠ „keine Post" — der Cold-Start-Sweep deckt es ab |

**Merksatz:** Das Wake ist eine **Optimierung gegen Poll-Latenz**, kein Transport mit Zustellgarantie. Ein
korrekter Supervisor ist auch **ohne** jedes Wake funktional (nur langsamer). → Referenz-Loop-Shape: Spec §6.

### 5.1 Optionaler daemon-seitiger Reconciliation-Sweep (Default AUS)

Seit #326 gibt es eine **zweite** Wake-Quelle im Daemon: bei gesetztem Env-Flag `TLMCP_WAKE_SWEEP_ENABLED=1`
weckt der Daemon eine Instanz **nachträglich**, wenn sie sich (neu) registriert und dann ungelesene Post hat.
Das adressiert genau die Reconnect-Lücke aus §5 — der Supervisor war beim Eintreffen der Nachricht kurz weg,
das reguläre Wake ging verloren.

| Aspekt | Verhalten |
|---|---|
| **Default** | **AUS.** Ohne `TLMCP_WAKE_SWEEP_ENABLED=1` wird die Verdrahtung gar nicht erst aufgerufen ⇒ kein Verhaltens-Delta gegenüber heute |
| **Auslöser** | die **(Neu-)Registrierung** einer Agent-Instanz beim Daemon (`agentRegistry.on('register')`) — der Moment, in dem der Supervisor gerade wieder da ist |
| **Zielgenauigkeit** | nur die **registrierende** Instanz wird geprüft/geweckt, nicht die ganze Flotte |
| **Wake-Form** | **identisch** zum regulären Wake: `agent:wake`, Zero-Content, `reason:'inbox'`, dieselbe gerichtete Zustellung — ein Sweep-Wake ist von einem Inbox-Wake **nicht unterscheidbar** (und muss es nicht sein) |

> ⚠️ **Ändert für den Supervisor NICHTS an seiner Pflicht.** Der Cold-Start-Sweep aus §5 (beim (Re-)Connect
> immer einmal `GET /api/inbox` pollen) bleibt **verbindlich** — der Daemon-Sweep *ergänzt* ihn, er ersetzt
> ihn nicht (der Daemon sieht z.B. keinen Supervisor-Neustart **ohne** Re-Registrierung der Instanz). Wer
> §5 korrekt umsetzt, ist mit **und** ohne dieses Flag funktional.

**Das Flag zu setzen ist ein bewusster Owner-Schritt** (Daemon-Neustart mit `TLMCP_WAKE_SWEEP_ENABLED=1`),
kein Teil dieses Supervisor-Runbooks — es steht hier nur, damit ein Betreiber den zusätzlichen Wake-Auslöser
kennt und **nicht** fälschlich für einen Bug hält. Design/Contract: `TL-11-wake-consumer-contract.md` §7.3,
`ADR-047` §3.

## 6. Zwei-Peer-Live-Proof (die eigentliche DoD — Host-/Fenster-gated, hier nur die Prozedur)
Ziel: **CLI reagiert auf ein reales Wake OHNE dazwischenliegenden Poll** (`[[dod-two-peer-mcp-proof]]`).
1. Supervisor auf Host A verbunden (§1–§3), Cold-Start-Sweep gelaufen, **Poll deaktiviert/Intervall hoch**,
   damit die Reaktion beweisbar vom Wake kommt (nicht vom Poll).
2. Von **Peer B** eine an die Instanz von A **adressierte** Postfach-Nachricht senden
   (`to_agent_instance` = SPIFFE/Instanz von A).
3. Erwartet: Daemon A emittiert **genau ein** `agent:wake` (gerichtet) → Supervisor `pokeCli` → CLI liest
   `GET /api/inbox` → verarbeitet die Nachricht. **Beleg festhalten:** Timestamp Wake ↔ CLI-Reaktion, kein
   Poll dazwischen; Ergebnis-Auszug (die verarbeitete Nachricht/Order).
4. **Negativ-Kontrolle:** Nachricht an eine **andere** Instanz → **kein** Wake bei A (directed/deny-by-default).

## 7. Verifikations-Checkliste (repo-seitig prüfbar, ohne Deploy)
- [ ] WS erreichbar: `wss://127.0.0.1:9440/ws` am `cardServer` (Daemon läuft, `/health` grün).
- [ ] mTLS greift: cert-lose Verbindung → TLS-Reset (Spec §2).
- [ ] Loopback-Gate: `?agent=` von Nicht-Loopback → Close **`4003`** (Spec §2, `websocket.ts`).
- [ ] Directed: ungefilterter Client bekommt **nie** `agent:wake` (Spec §3, `websocket.test.ts`).
- [ ] Payload unter `.data`, Zero-Content, `reason:'inbox'` (Spec §4, Wire-Conformance-Test).
- [ ] Cold-Start-Sweep implementiert (Reconnect-Lücke abgedeckt, Spec §5) — **unabhängig** vom optionalen
  daemon-seitigen `TLMCP_WAKE_SWEEP_ENABLED` (§5.1), das ihn nur ergänzt.
> Diese Garantien sind bereits **testgebunden** (Consumer-Contract §7/§7.1) — die Checkliste ist die
> Operator-Sicht auf dieselben Invarianten, kein neuer Test.

## 8. Rückfall / Sicherheit
- **No-op-sicher:** startet/fehlt der Supervisor nicht, bleibt der Agent **funktional** (pollt langsamer via
  `GET /api/inbox`). Kein Wake ⇒ kein Datenverlust, nur höhere Latenz.
- **Kein Repo-Change nötig** für den Betrieb: der Kontrakt steht; der Supervisor lebt out-of-repo.
- **Fenster-Disziplin:** der End-to-End-Proof (§6) ist Host-/Deploy-gated — **separat** öffnen (nicht Teil
  dieses Doc-Slices).

## 9. Lane-Kontext (warum TL-11 jetzt — TL-08/09/10-Wahrheit sichtbar)
Dieses Runbook ist der **ready** repo-only Prep-Schritt. Die strengeren Nachbar-Follow-ups waren **nicht**
ready und bleiben in `TODO.md` unverändert offen:
- **TL-08 Slice 2c** — Kern **BLOCKED** (nicht baubar).
- **TL-09c** — realer `TelegramMeldekanal` braucht Adapter-Code **+ Secret/Bot-Token** (nicht repo-only-doc).
- **TL-10 Slice A** — reines `freigabe-matrix.ts` erst **nach TL-10s eigenem §5-CO** (5 offene Entscheidungen).

## 10. Verweise
- `docs/architecture/TL-11-wake-consumer-contract.md` — **die** Protokoll-Spec (§2 Auth, §3 Subscribe, §4
  Payload, §5 Semantik, §6 Referenz-Loop, §7 Tests, §8 extern-blocked).
- `docs/architecture/ADR-043-heartbeat-wake-contract.md` — daemon-seitige Entscheidung (Slice A).
- `docs/architecture/TL-11-12-wake-postbox-discovery.md` — Reihenfolge (TL-12 vor TL-11).
- Code: `wake-contract.ts` (Emitter/Coalescer), `websocket.ts` (directed Routing, `4003`-Gate), Mount
  `index.ts:1398`.
