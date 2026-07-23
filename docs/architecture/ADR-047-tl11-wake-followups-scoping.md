# ADR-047 — TL-11 Wake-Nachlauf: Scoping der drei „Optional/danach"-Punkte

**Status:** Proposed (Scoping/Discovery — benennt die offenen Entscheidungen; **entscheidet keine davon**.
Revision 2 nach externem Review: zwei Aussagen der ersten Fassung korrigiert, §3-Kern gebaut — siehe §5.)
**Datum:** 2026-07-23
**Kontext:** Nachlauf zu #320 (Emitter-Ende-zu-Ende-Conformance). Bezug: ADR-043,
`TL-11-wake-consumer-contract.md`, `RUNBOOK-TL-11-wake-supervisor.md`.

## 0. Warum diese Note

`TODO.md` führt unter TL-11 Slice B drei Punkte als „Optional/danach": **WS-Instanz-Bindung**,
**Opt-in-Broadcast-Wake**, **Reconciliation-Sweep**. Sie stehen dort als Stichworte — ohne Grounding im
Code, ohne benannte Entscheidungen, ohne Slice-Zerlegung. Diese Note holt das nach, damit der jeweils
nächste Schritt **belegbar** statt geraten ist.

**Ergebnis (Revision 2, nach externem Review):** Die **Verdrahtung** ist bei allen drei Punkten
entscheidungsgebunden — sie ändert je eine gemergte, bewusst konservative Invariante. Der **reine Kern**
des Reconciliation-Sweeps ist es dagegen **nicht**: er nimmt keine der offenen Fragen vorweg und liegt
mit diesem PR als `sweep-targets.ts` vor (0 Aufrufer). Die erste Fassung dieser Note hatte ihn falsch als
blockiert eingestuft — die Begründung ist in §3/§5 zurückgezogen. Für §1 ist der reine Kern benannt und
baubar, sobald die Bedrohungs-/Credential-Vorfrage geklärt ist; §2 bleibt ohne Anwendungsfall liegen.

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

### Drei Befunde, die das Stichwort nicht hergibt

**(a) `agentFilter` hat Doppelfunktion.** Er steuert **nicht nur** das gerichtete Routing
(`matchesSubscription` `:87-91`), sondern **auch** die Filterung **nicht-gerichteter** Events über
`from`/`to`/`agentId`/`peer_id` (`:94-100`). Eine Bindung „Filter darf nur die eigene Identität sein"
würde damit auch diesen zweiten Pfad verengen. **Ehrliche Einordnung (Review-Korrektur):** einen solchen
Beobachter-Konsumenten gibt es im Repo heute **nicht** — das Dashboard verbindet sich ohne Query
(`packages/dashboard-ui/src/hooks/useWebSocket.tsx`), in `packages/cli` gibt es keinen WS-Client, und
jede dokumentierte `agent=`-Nutzung ist die gerichtete Wake-Form. Der zweite Pfad ist heute nur
unit-getestet. Das Risiko ist also **latent, nicht beobachtet** — es begründet keine Vorentscheidung,
gehört aber in die Abwägung zu Entscheidung 2.

**(b) Die Client-Identität ist im WS-Handler nicht verdrahtet — aber der Baustein existiert.** In
`websocket.ts` gibt es **keinen** Zugriff auf das Peer-Zertifikat; `ClientState` kennt nur `isLoopback`
(aus `req.ip`). Die mTLS-Pflicht liegt im cardServer (`agent-card.ts:229-230`), nicht in
`registerWebSocket`. **Ehrliche Kostenschätzung (Review-Korrektur):** das ist **keine** neue Maschinerie —
`extractCanonicalSender(socket)` (`mcp-ingress-api.ts:57`, fail-closed über `authorized === true`, SAN→SPIFFE)
ist exportiert und getestet, und das Fastify-Aufrufmuster (`request.raw.socket as PeerCertSocket`) steht
dort bereits (`:163-164`), ebenso in `agent-card.ts` und `cert-issuance-api.ts`. Der `/ws`-Handler hat den
`FastifyRequest` (er liest schon `req.ip`) und hängt am mTLS-cardServer. Die Identität in `ClientState` zu
stempeln sind also **~3 Zeilen Wiederverwendung**, nicht ein eigener Verdrahtungs-Slice.

**(c) Der naheliegende Identitäts-Kandidat trifft die Bedrohung gar nicht.** Das Runbook schreibt vor,
dass der Supervisor das **vorhandene Mesh-Client-Cert des Hosts** (`node.crt.pem`) präsentiert — und als
Filterwert genau dieselbe `spiffe://thinklocal/node/<PeerID>`. Auf dem heutigen Deployment teilen sich
also **alle Instanzen eines Hosts eine Identität**: eine cert-abgeleitete Bindung wäre dort
**tautologisch** (`filter === cert-SPIFFE` gilt ohnehin) und schützte **nicht** gegen die oben
beschriebene Nachbar-Instanz. Ein echter Schutz bräuchte ein **per-Instanz**-Credential — womit
Entscheidung 1 keine offene Auswahl mehr ist, sondern nahezu erzwungen.

### Offene Entscheidungen (VOR Code)
1. **Identitätsquelle:** Client-Cert-SPIFFE (SAN) — oder ein separates, **per-Instanz** ausgestelltes
   Supervisor-Credential? Siehe Befund (c): nur Letzteres adressiert die Bedrohung überhaupt.
2. **Geltungsbereich:** nur gerichtete Events (`DIRECTED_EVENT_TYPES`) — oder jeder `agentFilter`?
   (Befund (a): der zweite Pfad hat heute keinen Konsumenten, die Frage bleibt trotzdem zu beantworten.)
3. **Relation Identität ↔ Instanz:** ein Supervisor betreut ggf. **mehrere** Instanzen auf dem Host.
   Ist die erlaubte Menge „genau die eigene SPIFFE" oder „alle unter dieser Node-Identität registrierten
   Instanzen" (`agentRegistry`)?
4. **Migrationsverhalten:** Ablehnen mit `4003` (wie §8.1) oder still auf den erlaubten Filter reduzieren?
   Fail-closed spricht für Ablehnen — bricht aber jeden heute laufenden Konsumenten hart.

### Was hier ungegatet baubar wäre — und warum es hier trotzdem nicht gebaut wird
Ein reines Prädikat `allowsAgentFilter(requested, allowedIdentities: readonly string[], { directedOnly })`
**parametrisiert** die Entscheidungen 2 und 3, statt sie vorwegzunehmen (Entscheidung 1 bestimmt der
Aufrufer über die übergebene Menge, Entscheidung 4 folgt aus dem Umgang mit dem `false`-Ergebnis) — es
wäre also, anders als bei §3 zunächst behauptet, **technisch ungegatet**.

Es wird hier dennoch **nicht** gebaut, und zwar aus einem inhaltlichen Grund statt einem
Prozess-Vorwand: nach Befund (c) ist unklar, **gegen welche Identität** überhaupt geprüft werden soll. Ein
Prädikat, das auf der Host-SPIFFE arbeitet, wäre tautologisch grün und würde eine Schutzwirkung
suggerieren, die es nicht hat. Erst die Antwort auf Entscheidung 1 (per-Instanz-Credential ja/nein) macht
den Slice **sinnvoll** — nicht erst **möglich**. Die Verdrahtung (Identität in `ClientState`) ist laut
Befund (b) danach klein.

---

## 2. Opt-in-Broadcast-Wake

### Ist-Zustand (code-gegroundet)
`agent:wake` ist in `DIRECTED_EVENT_TYPES` (`websocket.ts:72`); `matchesSubscription` liefert es **nie** an
einen ungefilterten Client (`:88`, deny-by-default) und sonst nur bei Match auf `instance_id` **oder**
`spiffe_uri` (`:89-90`). Emitterseitig ist es symmetrisch: ohne SPIFFE **kein** Wake
(`wake-contract.ts:129-135`, „un-routbar = Leak-Kandidat"), unadressiert **kein** Wake
(`resolveWakeTargets` `:32`). Das ist genau der in **#277** geschlossene Leak **D1**.

### Der eigentliche Blocker steht in ADR-043 — und es ist nicht das Routing
**Korrektur der ersten Fassung** (externes Review, HIGH): dort stand, ein Broadcast-Wake sei
„strukturell nicht zustellbar", weil ihm `instance_id`/`spiffe_uri` zum Matchen fehlten. Das trifft nur
auf ein *einzelnes, unadressiertes* Broadcast-Event zu — **nicht** auf den Punkt, wie er beschlossen
wurde. `ADR-043` (CO-B) meint die **Emitter**-Seite:

> **Kein Broadcast-Fallback** (CO-B): `null → alle wecken` wäre **Amplifikation** (ein Remote-Absender
> weckt jede Instanz; der Coalescer begrenzt Rate **pro Instanz**, nicht den 1→N-Fanout) + Metadaten-Leak.

In dieser Lesart wäre ein Opt-in-Broadcast `resolveWakeTargets(null, live) → live`, also **N gerichtete**
Wakes — jedes mit eigener `instance_id` + `spiffe_uri`, jedes vom heutigen `matchesSubscription`
zustellbar, **ohne** eine Zeile Routing-Änderung, und jedes nur an den auf seine eigene Identität
gefilterten Client. **D1 bliebe dabei geschlossen.** Der reale Blocker ist also nicht die Zustellbarkeit,
sondern die in CO-B benannte **1→N-Amplifikation**: der Coalescer begrenzt die Rate **pro Instanz**, nicht
den Fanout — ein einzelner Remote-Absender könnte die ganze Flotte wecken. Dazu kommt der
Metadaten-Leak-Aspekt. Die Richtung ist außerdem eine Einbahnstraße: `ADR-043` hält fest, Opt-in sei
**additiv nachrüstbar, die Rücknahme wäre breaking**.

### Offene Entscheidungen (VOR Code)
1. **Amplifikations-Schranke:** Was begrenzt den 1→N-Fanout? (Rate pro *Absender*? Obergrenze für die
   Flottengröße? Nur lokal ausgelöste Broadcasts?) **Das ist die Kernfrage** — ohne Antwort darauf ist der
   Punkt nicht baubar, unabhängig von der Form.
2. **Wer optiert ein:** der **Konsument** (Subscribe-Frame) oder der **Emitter** (Nachricht als
   broadcast-würdig markiert)? Beide Wege sind mit D1 vereinbar — der Emitter-Weg über N gerichtete Wakes,
   der Konsumenten-Weg über eine explizite Ausnahme vom deny-by-default.
3. **Berechtigung:** loopback-only (wie der `agent`-Filter) — oder an eine Identität gebunden (→ §1)?
   Insbesondere: darf ein **Remote**-Absender einen Broadcast auslösen (genau der CO-B-Fall)?
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

Der Slice wäre also klein. Was **entschieden** werden muss, ist nicht die Auswahl-Logik, sondern **ob,
wann und mit welcher Rate-Semantik** der Daemon sweept.

### Offene Entscheidungen (VOR der Verdrahtung)
1. **Verschiebt oder ergänzt** der Daemon-Sweep die Konsumenten-Pflicht? Zur Diskussion:
   **ergänzen** (Gürtel *und* Hosenträger) — die Konsumenten-Pflicht ist billig und deckt Fälle ab, die der
   Daemon nicht sieht (z.B. Supervisor-Neustart ohne Daemon-Ereignis).
2. **Auslöser.** Drei reale Optionen, mit unterschiedlichen Kosten:
   - **periodisch** (Intervall) — braucht nur einen Timer, erzeugt aber Dauerlast;
   - **`agentRegistry.on('register'|'unregister'|'stale')`** (`agent-registry.ts:240-242`) — dieser Hook
     **existiert bereits**, kostet **keine** neue Verdrahtung und trifft den Instanz-(Neu-)Start;
   - **WS-(Re-)Connect eines gefilterten Clients** — träfe die Reconnect-Lücke am präzisesten, **aber**:
     dieser Hook existiert **nicht**. `registerWebSocket` liefert nichts zurück, die `clients`-Map ist
     modulprivat, bei Connect/Close wird nichts emittiert — diese Variante bedeutet also einen Eingriff in
     die sicherheitsgehärtete WS-Datei und ist damit die **teuerste**, nicht die billigste.
3. **Rate-Semantik.** Der naive Rahmen wäre „Coalescer schluckt (Sweep verpufft im Fenster) **oder**
   Coalescer wird umgangen (§5-Zusage nicht mehr wörtlich wahr)". Das ist ein **falsches Entweder-oder** —
   es gibt mindestens zwei auflösende Optionen:
   - **eigener `WakeCoalescer` für den Sweep-Pfad** (`wake-contract.ts`: eigene Map, injizierbares Fenster)
     ⇒ der Sweep ist rate-begrenzt **und** wird nicht vom Inbox-Verkehr geschluckt; §5 liest sich dann als
     „≤ 1 Wake pro Instanz pro Fenster **je Quelle**" — weiterhin eine harte Schranke;
   - **eigener `WakeReason`** (`WakeReason` ist ausdrücklich „erweiterbar", und Spec/Runbook verlangen von
     Konsumenten bereits Toleranz gegenüber unbekannten `reason`-Werten) ⇒ separat gekeyt, ohne die
     bestehende Zusage anzufassen.
   Zusätzlich relativiert die Spec selbst die Schwere: die **Idempotent**-Zeile hält fest „zwei Wakes ==
   ein Wake … mehrfaches Wecken ist **harmlos**". Ein zusätzlicher Wake verletzt also **keine**
   konsumentensichtbare Anforderung — betroffen wäre nur die Formulierung der Rate-Zusage.
4. **Opt-in oder immer?** Ein Env-Flag-Regime wie TL-09b (Default aus) wäre konsistent — bedeutet aber
   einen Flag-Flip als Aktivierung (owner-gated).
5. **Legacy-Zeilen.** `unreadCount({ forInstance })` zählt per Default **keine** Zeilen mit
   `to_agent_instance IS NULL` (`includeLegacy` default `false`, `agent-inbox.ts:481-489`) — ausgerechnet
   die Klasse, die am ehesten liegenbleibt. Ob ein Sweep sie sehen soll, ist eine Vertragsfrage.

### Umsetzungsstand (Nachtrag 2026-07-23) — die Verdrahtung ist gebaut

Der reine Kern lag mit #322 vor; die **Verdrahtung** liegt jetzt als `sweep-wiring.ts` vor
(`registerReconciliationSweep` / `runReconciliationSweep`). Die vier offenen Punkte wurden **innerhalb der
oben aufgeführten Optionen** entschieden — keine davon ist neu erfunden:

| Offener Punkt | Entscheidung | Warum diese Option |
|---|---|---|
| 1. verschiebt oder **ergänzt** | **ergänzt** — die Konsumenten-Pflicht (Cold-Start-Sweep, Spec §5) bleibt unverändert bestehen | Gürtel *und* Hosenträger; der Daemon sieht nicht jeden Supervisor-Neustart |
| 2. Auslöser | **`agentRegistry.on('register')`**, und zwar **zielgerichtet auf die registrierende Instanz** | Der Hook **existiert bereits**; er feuert genau dann, wenn eine Instanz (neu oder nach Neustart) da ist. Kein neuer Timer, **kein** Eingriff in die sicherheitsgehärtete WS-Datei. **CR-Fund (`agy`, HIGH):** die erste Fassung fegte bei jedem `register` die **ganze** Registry — semantisch über-breit (das Ereignis sagt „dieser Supervisor ist wieder da“) und ein Performance-Hazard: der Listener läuft **synchron** und `unreadFor` ist eine synchrone SQLite-Abfrage, also **M × N** Abfragen bei M gleichzeitigen Reconnects. Jetzt genau **eine** Abfrage pro Registrierung |
| 3. Rate-Semantik | **eigener `WakeCoalescer`** für den Sweep-Pfad (Option 1 aus §3) | Der Sweep ist rate-begrenzt **und** wird nicht vom laufenden Inbox-Verkehr geschluckt — sonst verpuffte er genau im Reconnect-Fenster, das er beheben soll. §5 liest sich damit als „≤ 1 Wake pro Instanz pro Fenster **je Quelle**" |
| 4. Opt-in | **Env-Flag `TLMCP_WAKE_SWEEP_ENABLED`, Default AUS** (Regime wie TL-09b) | Ohne Flag wird die Verdrahtung gar nicht erst aufgerufen ⇒ **kein** Verhaltens-Delta |
| 5. Legacy-Zeilen | **unverändert `includeLegacy: false`** (der `unreadCount`-Default) | Eine Änderung hier wäre eine Vertragsfrage über `to_agent_instance IS NULL`-Zeilen; der Sweep erbt bewusst den bestehenden Default, statt ihn still zu verschieben. **Bleibt offen** und ist im Modul-Doc benannt |

**Nur `register` löst aus** — `unregister`/`stale` bedeuten, dass die Instanz gerade weg ist; sie zu wecken
wäre sinnlos und im `stale`-Fall ein Wake an einen toten Konsumenten.

**Fail-safe:** werfende Registry ⇒ Sweep übersprungen; werfender Bus ⇒ die übrigen Instanzen bekommen ihr
Wake trotzdem; werfender Zähler ⇒ diese Instanz entfällt (#322). Der Listener läuft **synchron** im
Registry-Pfad, deshalb darf dort nichts nach oben durchschlagen — doppelt abgesichert.
**Owner-gated bleibt** allein der Flag-Flip in einer laufenden Instanz.

### Was zuvor **gebaut** wurde (Korrektur der ersten Fassung)
Die erste Fassung dieser Note behauptete, schon die **Signatur** von `computeSweepTargets` wäre eine
verdeckte Vertragsentscheidung, und stufte den Punkt als nicht baubar ein. **Das war falsch** — und das
externe Review hat es zu Recht als HIGH beanstandet: die vorgeschlagene Signatur enthält **keinen**
Coalescer, **keine** Uhr, **keinen** Trigger und **kein** Flag; alle vier offenen Punkte liegen beim
**Aufrufer**. Genau wie der Emitter das Coalescing **erst nach** der Ziel-Auflösung anwendet
(`wake-contract.ts` `computeWakes`), ist die Auswahl von der Rate-Frage sauber trennbar.

Deshalb liegt der Slice jetzt vor — `packages/daemon/src/sweep-targets.ts`:

```ts
computeSweepTargets(live: readonly LiveInstance[], unreadFor: (id: string) => number): SweepTarget[]
```

rein, deterministisch (stabil sortiert, keine Uhr/kein Zufall), **fail-closed** wie der Emitter (ohne
routbare `spiffeUri` kein Ziel; unbrauchbarer oder **werfender** Zähler ⇒ kein Ziel; wirft nie),
**0 Aufrufer** ⇒ kein Runtime-Change. Er nimmt keine der Entscheidungen 1–5 vorweg: „ob" und „wann" sind
Aufrufer-Fragen, Coalescing passiert (wie beim Emitter) erst danach, und die `includeLegacy`-Frage bleibt
bewusst in der Hand dessen, der `unreadFor` übergibt. Präzedenz für genau diese Form: `wire-feature.ts`
`supportsFeature` (#314) und `MeldekanalRegistry.requestApprovalOn` (#317) — beide reine Kerne unterhalb
einer weiterhin gateten Entscheidung.

**Weiterhin gated:** die Verdrahtung selbst (Trigger, Coalescer-Wahl, Flag, Legacy-Politik).

---

## 4. Zusammenfassung / Empfehlung

| Punkt | Offen | Reiner Kern | Priorität (Vorschlag) |
|---|---|---|---|
| **Reconciliation-Sweep** | ✅ **erledigt** — Kern (#322) **und** Verdrahtung (`sweep-wiring.ts`); offen nur noch die Legacy-Politik und der owner-gatete Flag-Flip | `computeSweepTargets` + `registerReconciliationSweep`, Default AUS | **erledigt** |
| WS-Instanz-Bindung | 4 Entscheidungen; Cert-Identität ist ~3 Zeilen Wiederverwendung, **aber** die Host-Identität trifft die Bedrohung nicht (Befund c) | `allowsAgentFilter(requested, allowedIdentities, {directedOnly})` — parametrisiert die offenen Punkte, statt sie vorwegzunehmen; **baubar**, sobald die Bedrohungs-/Credential-Frage geklärt ist | mittel |
| Opt-in-Broadcast-Wake | **Amplifikations-Schranke** (CO-B) ungeklärt; **kein benannter Anwendungsfall** | — (die Form folgt aus 1) | **niedrig** — ohne Bedarf bleibt „kein Broadcast" die bessere Invariante |

**Empfehlung:** §3 als Nächstes **entscheiden** (der reine Kern liegt jetzt vor, offen ist nur die
Verdrahtung), §1 bewusst budgetieren — mit der Vorfrage, ob ein per-Instanz-Credential überhaupt gewollt
ist —, §2 bis zu einem konkreten Anwendungsfall **liegen lassen**.

## 5. Was diese Note entscheidet — und was nicht

Sie **entscheidet keine** der offenen Fragen aus §1–§3; die bleiben CO-/owner-Sache. Sie **korrigiert**
allerdings zwei Aussagen ihrer eigenen ersten Fassung, die das externe Review als HIGH beanstandet hat:

1. **„Alle drei sind entscheidungsgebunden, also kein ungegateter Code-Slice" war für §3 falsch.** Die
   dort selbst vorgeschlagene Signatur enthält weder Coalescer noch Uhr, Trigger oder Flag — sie nimmt
   also keine der offenen Entscheidungen vorweg. Der Slice ist gebaut (`sweep-targets.ts`), und die
   Blocker-Behauptung ist zurückgezogen.
2. **§2s Begründung widersprach dem Beschluss, den sie schützen sollte.** „Strukturell nicht zustellbar"
   gilt nicht für den in ADR-043 CO-B beschlossenen Emitter-seitigen Broadcast (N gerichtete Wakes sind
   heute problemlos routbar); der echte Blocker ist die **1→N-Amplifikation** — die in der ersten Fassung
   gar nicht vorkam. Ebenso zurückgenommen: die Aussage „nur das Konsumenten-Opt-in hält D1 geschlossen".

Ergänzend zurückgenommen wurden zwei Formulierungen, die als Vorentscheidung lasen: dass eine Bindung
„auf gerichtete Events beschränkt werden **müsste**" (der dafür angeführte Beobachter-Konsument existiert
im Repo nicht), und die Darstellung der Coalescer-Frage als Entweder-oder (es gibt mindestens zwei
auflösende Optionen, und die Spec nennt mehrfaches Wecken ausdrücklich „harmlos").
