# ADR-047 — TL-11 Wake-Nachlauf: Scoping der drei „Optional/danach"-Punkte

**Status:** Proposed (Scoping/Discovery — **entscheidet nichts**, benennt die Entscheidungen)
**Datum:** 2026-07-23
**Kontext:** Nachlauf zu #320 (Emitter-Ende-zu-Ende-Conformance). Bezug: ADR-043,
`TL-11-wake-consumer-contract.md`, `RUNBOOK-TL-11-wake-supervisor.md`.

## 0. Warum diese Note

`TODO.md` führt unter TL-11 Slice B drei Punkte als „Optional/danach": **WS-Instanz-Bindung**,
**Opt-in-Broadcast-Wake**, **Reconciliation-Sweep**. Sie stehen dort als Stichworte — ohne Grounding im
Code, ohne benannte Entscheidungen, ohne Slice-Zerlegung. Diese Note holt das nach, damit der jeweils
nächste Schritt **belegbar** statt geraten ist.

**Ergebnis vorweg (die ehrliche Antwort):** **Alle drei sind entscheidungsgebunden.** Keiner ist heute
ein ungegateter Code-Slice — nicht wegen fehlender Mechanik, sondern weil jeder eine **gemergte,
bewusst konservative Invariante ändert**. Der kleinste wirklich ungegatete Post-#320-Slice ist deshalb
**diese Note selbst**. Was nach der jeweiligen Entscheidung ungegatet baubar wäre, steht je Abschnitt.

**Unverändert extern/owner-gated und hier ausdrücklich NICHT angefasst:** TL-11 **Slice B** (letzter Hop
Supervisor → CLI, out-of-repo + Deploy-/Host-/Fenster-gated), TL-12 **B/C** (owner/CO), TL-10-Verdrahtung
(D1-Loader + kuratierte Policy-Datei, D3-Sign-off).

---

## 1. WS-Instanz-Bindung

### Ist-Zustand (code-gegroundet)
`websocket.ts` `rejectsAgentFilter` (`:59-64`): ein nicht-leerer `agent`-Filter ist **loopback-only** —
durchgesetzt auf **beiden** Pfaden (Query am Connect + `subscribe`-Frame, §8.1-Härtung). Innerhalb von
Loopback darf ein Client aber **jeden beliebigen** `agent`-Wert setzen. Es gibt **keine** Bindung an die
Identität des Clients selbst.

### Warum das eine echte Frage ist (kein Kosmetik-Punkt)
Auf einem Mehr-Agenten-Host laufen mehrere Agent-Instanzen **auf demselben Loopback**. Heute kann der
Supervisor von Instanz A den `agentFilter` auf die SPIFFE/Instanz-ID von Instanz B setzen und deren
`agent:wake`-Signale mitlesen. Das Wake ist zwar **inhaltsfrei** (§4) — es leckt also keine
Nachrichteninhalte —, verrät aber **Aktivitäts-Metadaten** („B bekommt gerade Post").

### Zwei Befunde, die die Umsetzung teurer machen als das Stichwort suggeriert

**(a) `agentFilter` hat Doppelfunktion.** Er steuert **nicht nur** das gerichtete Routing
(`matchesSubscription` `:87-91`), sondern **auch** die Filterung **nicht-gerichteter** Events über
`from`/`to`/`agentId`/`peer_id` (`:94-101`). Eine Bindung „Filter darf nur die eigene Identität sein"
würde damit **auch** Dashboard-/CLI-Konsumenten treffen, die den Filter legitim benutzen, um fremden
Mesh-Verkehr zu **beobachten**. Eine Bindung müsste also mindestens **auf gerichtete Events beschränkt**
werden — sonst ist sie eine unbeabsichtigte Feature-Rücknahme.

**(b) Die Client-Identität steht im WS-Handler heute gar nicht zur Verfügung.** In `websocket.ts` gibt es
**keinen** Zugriff auf das Peer-Zertifikat (kein `getPeerCertificate`, keine SPIFFE-Extraktion); `ClientState`
kennt nur `isLoopback` (aus `req.ip`). Die mTLS-Pflicht ist eine Schicht des cardServers
(`agent-card.ts:229-230`), nicht von `registerWebSocket`. Eine Bindung braucht also **neue Verdrahtung**
(Peer-Cert → SPIFFE → `ClientState`), nicht nur eine schärfere Bedingung.

### Offene Entscheidungen (VOR Code)
1. **Identitätsquelle:** Client-Cert-SPIFFE (SAN) — oder ein separates, lokal ausgestelltes Supervisor-Token?
   Welche Identität trägt der Supervisor heute überhaupt (Runbook: „vorhandenes Client-Cert")?
2. **Geltungsbereich:** nur gerichtete Events (`DIRECTED_EVENT_TYPES`) — oder jeder `agentFilter`?
   (Siehe Befund (a): „jeder" bricht Beobachter-Konsumenten.)
3. **Relation Cert-Identität ↔ Instanz:** ein Supervisor betreut ggf. **mehrere** Instanzen auf dem Host.
   Ist die erlaubte Menge „genau die eigene SPIFFE" oder „alle Instanzen, die unter dieser Node-Identität
   registriert sind" (`agentRegistry`)?
4. **Migrationsverhalten:** Ablehnen mit `4003` (wie §8.1) oder still auf den erlaubten Filter reduzieren?
   Fail-closed spricht für Ablehnen — bricht aber jeden heute laufenden Konsumenten hart.

### Was NACH der Entscheidung ungegatet wäre
Eine **reine** Prädikatfunktion `allowsAgentFilter(requested, clientIdentity, directedOnly)` +
Tests (0 Aufrufer), analog zur bereits bewährten `rejectsAgentFilter`-Extraktion — die Verdrahtung
(Peer-Cert in `ClientState`) bleibt ein eigener, größerer Slice.

---

## 2. Opt-in-Broadcast-Wake

### Ist-Zustand (code-gegroundet)
`agent:wake` ist in `DIRECTED_EVENT_TYPES` (`websocket.ts:72`); `matchesSubscription` liefert es **nie** an
einen ungefilterten Client (`:88`, deny-by-default) und sonst nur bei Match auf `instance_id` **oder**
`spiffe_uri` (`:89-90`). Emitterseitig ist es symmetrisch: ohne SPIFFE **kein** Wake
(`wake-contract.ts:129-135`, „un-routbar = Leak-Kandidat"), unadressiert **kein** Wake
(`resolveWakeTargets` `:33`). Das ist genau der in **#277** geschlossene Leak **D1**.

### Warum das nicht „nur ein Flag" ist
Ein Broadcast-Wake hat **kein** eindeutiges Ziel — es gibt also weder `instance_id` noch `spiffe_uri`, auf
die `matchesSubscription` matchen könnte. Der heutige Routing-Pfad kann ihn **strukturell nicht**
zustellen; er bräuchte eine eigene Form (eigener Event-Typ oder ein explizites Broadcast-Kennzeichen) **und**
eine Regel, die verhindert, dass damit D1 wieder aufgeht. Die Consumer-Spec hält bereits fest: Opt-in wäre
**additiv nachrüstbar, die Rücknahme wäre breaking** — die Richtung ist also eine Einbahnstraße.

### Offene Entscheidungen (VOR Code)
1. **Wer optiert ein:** der **Konsument** (Subscribe-Frame „ich will auch Broadcast-Wakes") oder der
   **Emitter** (eine Nachricht wird als broadcast-würdig markiert)? Nur Ersteres hält D1 geschlossen.
2. **Berechtigung:** loopback-only (wie der `agent`-Filter) — oder an eine Identität gebunden (→ §1)?
3. **Form:** eigener Event-Typ (`agent:wake:broadcast`) oder `agent:wake` mit `broadcast: true`?
   Ein eigener Typ hält `DIRECTED_EVENT_TYPES` sauber und ist rückwärtskompatibel.
4. **Anwendungsfall zuerst benennen:** Wofür genau? Ohne konkreten Bedarf ist die konservative Invariante
   („kein Broadcast") die bessere Vorgabe — und dieser Punkt bleibt zu Recht liegen.

### Was NACH der Entscheidung ungegatet wäre
Ein reiner Routing-Prädikat-Zusatz + Tests. **Nicht** vorher: jede Vorwegnahme würde die D1-Invariante
antasten, die #277 bewusst hergestellt hat.

---

## 3. Reconciliation-Sweep

### Ist-Zustand (code-gegroundet)
Der Sweep ist heute eine **Konsumenten-Pflicht**: Consumer-Spec §5 („beim (Re-)Connect **immer** einmal
das Postfach pollen — Cold-Start-Sweep") und Runbook-Checkliste („Cold-Start-Sweep implementiert
(Reconnect-Lücke abgedeckt)"). Der Daemon macht **nichts** in diese Richtung — Wakes sind erklärtermaßen
best-effort/lossy (ADR-043 §3).

### Mechanik ist da, die Entscheidung fehlt
Ein daemon-seitiger Sweep bräuchte **keine** neue Speicherarbeit:
- `AgentInbox.unreadCount({ forInstance })` (`agent-inbox.ts:468`) zählt ungelesene Nachrichten **pro
  Instanz**, gestützt auf den vorhandenen Index `idx_messages_instance` (`:187`).
- `agentRegistry.list()` liefert die live Instanzen samt `spiffeUri` — dieselbe Quelle, die der Emitter
  schon benutzt (`index.ts:1110-1112`).

Der Slice wäre also klein. **Aber** er verschiebt eine **Vertragspflicht** vom Konsumenten zum Daemon, und
genau das ist die Entscheidung.

### Offene Entscheidungen (VOR Code)
1. **Verschiebt oder ergänzt** der Daemon-Sweep die Konsumenten-Pflicht? Empfehlung zur Diskussion:
   **ergänzen** (Gürtel *und* Hosenträger) — die Konsumenten-Pflicht ist billig und deckt Fälle ab, die der
   Daemon nicht sieht (z.B. Supervisor-Neustart ohne Daemon-Ereignis).
2. **Auslöser:** periodisch (Intervall?) — oder ereignisgetrieben beim WS-(Re-)Connect eines gefilterten
   Clients? Letzteres trifft die eigentliche Lücke (Reconnect) präziser und erzeugt keine Dauerlast.
3. **Coalescer-Interaktion:** Ein Sweep-Wake **darf** vom Coalescer geschluckt werden (dann verpufft der
   Sweep genau im Reconnect-Fenster, das er beheben soll) — oder er **umgeht** ihn (dann ist die §5-Zusage
   „≤ 1 Wake pro Instanz pro Fenster" nicht mehr wörtlich wahr und die Spec müsste nachgezogen werden).
   **Das ist die eigentliche Vertragsfrage dieses Punktes.**
4. **Opt-in oder immer?** Ein Env-Flag-Regime wie TL-09b (Default aus) wäre konsistent — bedeutet aber
   einen Flag-Flip als Aktivierung (owner-gated).

### Was NACH der Entscheidung ungegatet wäre
Eine **reine** Funktion `computeSweepTargets(unreadByInstance, liveInstances)` + Tests (0 Aufrufer) —
mechanisch trivial, sobald 1–3 beantwortet sind. **Vorher nicht:** ohne Antwort auf (3) wäre schon die
Signatur eine verdeckte Vertragsentscheidung.

---

## 4. Zusammenfassung / Empfehlung

| Punkt | Blockiert durch | Kleinster Folge-Slice **nach** der Entscheidung | Priorität (Vorschlag) |
|---|---|---|---|
| WS-Instanz-Bindung | 4 Entscheidungen + **neue** Cert-Identitäts-Verdrahtung | reines `allowsAgentFilter`-Prädikat + Tests | mittel — echter Metadaten-Schutz auf Mehr-Agenten-Hosts, aber teuer |
| Opt-in-Broadcast-Wake | 4 Entscheidungen; **kein benannter Anwendungsfall** | Routing-Prädikat-Zusatz + Tests | **niedrig** — ohne Bedarf bleibt „kein Broadcast" die bessere Invariante |
| Reconciliation-Sweep | 4 Entscheidungen (Kern: Coalescer-Interaktion) | reines `computeSweepTargets` + Tests | **hoch** — kleinster Aufwand, adressiert die real erlebte Reconnect-Lücke |

**Empfehlung:** zuerst §3 entscheiden (billigster Nutzen, Mechanik liegt bereit), §1 danach bewusst
budgetieren, §2 bis zu einem konkreten Anwendungsfall **liegen lassen**.

**Diese Note entscheidet nichts** — sie groundet die drei Stichworte im Code, benennt je Punkt die exakt
offenen Fragen und macht sichtbar, welcher Slice danach ungegatet baubar ist. Kein Code, kein Test,
kein Deploy, kein Secret, kein Runtime-Change.
