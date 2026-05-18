# ADR-020: Registry Replication Recovery (CRDT Sync ueber libp2p)

- **Status:** Proposed
- **Datum:** 2026-05-18
- **Autor:** claude-code (Opus 4.7, 1M context)
- **Konsens:** 4-Modell-Review:
  - `gpt-5.2` (9/10), `gemini-3-pro-preview` (9/10) — Initial-Review 2026-05-18
  - `gpt-5.5` (8/10), `MiniMax-M2.7` (7/10) — Erweiterter Review 2026-05-18, fanden zusaetzliche Luecken (Framing, Bilaterale-Sync-Semantik, Half-open Connections, Pull-Mode, Owner-wins). Confidence sinkt mit jedem Reviewer, weil neue Edge-Cases sichtbar wurden — bewusste Designentscheidung: v1 loest den Bug, v2 schliesst die Edge-Cases.
- **Verwandt:** ADR-004 (Heartbeat), TODO.md → "CRDT-Registry repliziert nicht" (2026-05-17 21:45)

## Kontext

Seit 2026-05-17 beobachten wir im 5-Node-Mesh (`MacBook-Pro`, `ai-n8n-local`,
`iobroker`, `influxdb`, `minimac-60`) folgenden Bruch:

- `mesh_status.peers_online = 4` auf allen Hosts (Heartbeats laufen sauber).
- `/api/capabilities` liefert auf **jedem** Peer eine **andere** Sicht mit
  **anderem** Automerge-Hash — eingefrorene Divergenz ueber Minuten/Stunden,
  ohne Konvergenz-Tendenz.
- Lokaler Daemon publiziert seine eigene Capability nicht ins Mesh: kein Peer
  sieht ihn unter seiner Host-ID, obwohl er als Heartbeat-Peer sichtbar ist.

Das ist **kein** „Sync braucht Zeit" — der Zustand ist tot.

### Root-Cause-Analyse

Direkter Code-Beleg in `packages/daemon/src/libp2p-runtime.ts:335-356`:

```ts
private registerProtocolHandlers(): void {
  for (const protocol of this.state.multiplexer.protocols) {
    const handler = async (evt: any) => {
      this.onStreamOpened(protocol);
      try {
        const stream = evt?.stream ?? evt;
        if (typeof stream?.close === 'function') {
          await stream.close();                          // ← KILLS STREAM
        } else if (typeof stream?.abort === 'function') {
          stream.abort(new Error('thinklocal placeholder protocol handler'));
        }
      } finally {
        this.onStreamClosed(protocol);
      }
    };
    ...
  }
}
```

Fuer **alle vier** Mesh-Protokolle (heartbeat, registry, tasks, audit)
registriert der Daemon einen Handler, der eingehende Streams **sofort
schliesst oder abbricht**. Die libp2p-Streams sind seit jeher tote Briefkaesten.

Heartbeats funktionieren trotzdem, weil sie **ueber HTTPS** abgewickelt werden
(`mesh.ts`), **nicht** ueber libp2p. Capability-Sync laeuft ausschliesslich
ueber libp2p — und damit gar nicht.

Zusaetzlicher zweiter Layer (selbst nach Handler-Fix relevant):
- Es gibt **keinen periodischen Anti-Entropy-Timer**; Push erfolgt nur
  event-driven bei lokaler Capability-Aenderung.
- Auf `peer:connect` wird **kein** `Automerge.initSyncState()` durchgefuehrt.
  Nach Reconnect glaubt der Sync-Layer, mit dem Peer synchron zu sein, obwohl
  beide Seiten in der Zwischenzeit divergiert sind.

## Entscheidung

Die Arbeit wird in **zwei PRs** aufgeteilt:

- **v1** entfriert das Mesh (Hauptbug behoben, Daemon ist wieder ausrollfaehig).
- **v2** schliesst die Edge-Cases, die unter Last, bei groesseren Registries oder
  bei unsauberen Disconnects beissen.

**Faustregel:** Wenn der Punkt das Mesh **eingefroren** laesst → v1.
Wenn er es nur **theoretisch wackelig** macht → v2.

### v1 — MVP (Mesh entfrieren)

Sechs Bausteine, die zwingend zusammen ausgerollt werden:

#### v1.0 Shared Genesis-Doc

**Bei der Implementierung 2026-05-18 entdeckt:** Jeder Daemon ruft im
`CapabilityRegistry`-Constructor `Automerge.init()` separat auf. Das erzeugt
**disjoint history-trees** — Automerge `receiveSyncMessage` zwischen Docs
ohne gemeinsame Genesis kann ihre Changes nicht mergen. Konsequenz im
Debug-Test:

```
Round 2: A=agentA::capA  B=agentA::capA  (B verliert sein eigenes capB)
Direct merge result: agentB::capB         (auch Automerge.merge funktioniert nicht)
```

Mit `Automerge.clone(genesis)` als Konstruktor-Pfad: sofortige Konvergenz
nach 2 Round-Trips, beide Caps auf beiden Seiten.

Fix: `registry.ts` exportiert `REGISTRY_GENESIS_BLOB_BASE64`, alle Daemons
laden im Konstruktor `Automerge.load(decode(GENESIS_BLOB))`. Der Blob wird
einmalig produziert und ist Teil der Code-Base.

**Production-TODO**: Bevor v1 deployed wird, muss der echte
`REGISTRY_GENESIS_BLOB_BASE64` produziert und der Placeholder ersetzt werden.
Aktuell ist Bootstrap-Modus aktiv (on-the-fly Genesis pro Prozess), was fuer
Tests funktioniert, aber **nicht** fuer Mesh-Deployments mit getrennten
Prozessen.

#### v1.1 Echte libp2p-Handler statt Placeholder

`registerProtocolHandlers` akzeptiert pro Protokoll einen vom Aufrufer
injizierten Handler (Constructor-Callback). Der Default-Handler bleibt nur
fuer Protokolle, fuer die noch keine Implementierung existiert.

#### v1.2 Message-Framing (length-prefixed)

libp2p/Yamux liefert einen Byte-Stream, **keine** Message-Grenzen. Ohne Framing
brechen die Handler beim ersten fragmentierten Frame oder lesen unbegrenzt
weiter. Jede Sync-Message wird mit einem 4-Byte Length-Prefix (uint32 LE) +
Max-Frame-Size (z.B. 8 MiB) gesendet. Read-Timeout 5 s, Write-Timeout 5 s,
AbortSignal pro Round.

#### v1.3 RegistrySyncCoordinator mit Per-Peer Inflight-Singleflight

Neue Komponente, die:
- Auf `peer:connect` → `Automerge.initSyncState(peer)` + initialer Sync-Push
- Periodischer Timer (45 s ± Jitter) → fuer jeden connected peer
  `generateSyncMessage` aufrufen, ueber `/thinklocal/mesh/registry/1.0.0`
  schicken, Antwort mit `receiveSyncMessage` verarbeiten, bis `null`
- Auf `peer:disconnect` → SyncState verwerfen
- **Per-Peer Mutex / Queue**: pro Peer darf nur ein Sync-Round gleichzeitig
  laufen. Initial-Push, Timer-Tick und inbound Handler greifen sonst parallel
  auf denselben SyncState zu und produzieren doppelte Bloom-Filter oder
  verlorene Updates.

#### v1.4 Bidirektionaler Sync

Beim `peer:connect` rufen **beide** Seiten `generateSyncMessage` auf, nicht
nur der Owner der lokalen Capability. Sonst bleibt ein frisch verbundener
Peer ohne lokale Aenderungen fuer immer divergent (er hat nichts zu pushen,
und die Gegenseite weiss nicht, dass er hinterher ist).

#### v1.5 Timeout-basiertes SyncState-Cleanup

Half-open TCP-Verbindungen (z.B. nach Remote-Crash ohne FIN-Handshake)
triggern **nicht zuverlaessig** `peer:disconnect`. Zusaetzlich zum Event-Hook:

- Pro Sync-Round Deadline (z.B. 10 s)
- Nach 3 fehlgeschlagenen Rounds in Folge → SyncState verwerfen + Connection
  forcen zu schliessen (libp2p `hangUp(peerId)`)

### v2 — Robustheit & Architektur-Reinheit (Folge-PR)

Optional ausrollbar, **nachdem** v1 in Production stabil laeuft:

#### v2.1 `last_sync` aus dem CRDT-Doc entfernen

In `registry.ts:45-47` existiert `last_sync: Record<string, string>` als Feld
im Automerge-RegistryDoc. Wenn der Coordinator das pro Sync-Runde
aktualisiert, erzeugt **jede** Round neue Divergenz → die Konvergenz-Garantie
ist mathematisch unmoeglich zu erfuellen. Status-Metadaten gehoeren
ausserhalb des CRDT (lokales Memory + `/api/status`).

#### v2.2 Owner-wins-Semantik erzwingen

`markAgentOffline()` (Z. 91-99) und `removePeerCapabilities()` (Z. 223-237)
mutieren fremde Agent-Namespaces im CRDT. Das ist semantisch falsch:
Resurrection durch konkurrente Syncs, false deletions, Last-Writer-Wins-
Konflikte. Umbau auf strikt: **nur Owner schreibt eigene Caps**, Fremdstatus
landet im separaten Observation-Layer.

#### v2.3 Konvergenz-Garantie an libp2p-connected koppeln

`peers_online` aus `mesh.ts` misst HTTPS-Heartbeat-Liveness, nicht libp2p-
Reachability. Half-open libp2p-Connection bei online HTTPS = Garantie nicht
erfuellbar. SLO sollte auf `libp2p.connected[P] && last_sync_round[P]
successful` basieren.

#### v2.4 Hash-Metrik auf Automerge-Heads umstellen

`getCapabilityHash()` (Z. 145-149) hasht nur `agent_id::skill_id:version:
health`. Aenderungen an description, permissions, trust_level, updated_at
oder CRDT-Heads bleiben unsichtbar — Regressions-Tests koennen unbemerkt
gruenen. Konvergenz-Pruefung sollte Automerge `getHeads()` vergleichen,
nicht den Capability-Hash. (v1 darf zur Not beides loggen.)

#### v2.5 Backpressure/Chunking fuer grosse Doc-Payloads

`Automerge.save()` bei 10.000+ Capabilities = mehrere MB. Yamux-Pull-Stream
kann abbrechen, wenn Reader langsamer als Writer. Bei 5 Nodes × ~10 Caps
nicht akut — wird bei 100+ Caps oder mehr Nodes relevant. Loesung:
Chunking + ACK-basiertes Stream-Handshake.

### Erhaltene Bausteine (v1, unabhaengig von obiger Aufteilung)

#### Safety Valve: `/api/registry/republish` (admin-only)

Auch wenn Gemini diesen Punkt als "Bandage" kritisiert: GPT-5.2 und die
Ops-Realitaet sprechen dafuer. Ein manuell triggerbarer Force-Push hilft beim
Triage auf Live-Systemen, ohne das Recovery-Verhalten zu maskieren — er ist
**zusaetzlich** zur automatischen Konvergenz, nicht statt.

- Admin-Token (gleiche `/api/*`-Auth wie restliche Routes)
- Rate-Limit: max. 1× pro Minute pro Peer
- Audit-Log-Event pro Aufruf
- **Kein Daten-Fix**, nur Sync-Reset/Reannounce. Tests duerfen davon nicht
  abhaengen.

#### Status-Endpoint erweitert

`/api/status` `libp2p`-Block bekommt:
- `streams_by_protocol` (Zaehler aktiver Streams pro Protokoll)
- `last_sync_round_per_peer` mit `ts`, `rounds`, `converged`, `last_success`,
  `last_error`, `in_flight`, `consecutive_failures`

Damit wird Live-Divergenz sichtbar, bevor sie ueber Minuten persistiert.

## Eigenschaft: Automerge Sync ist bilateral

Wichtige Konsequenz, die ADR-020 explizit dokumentiert (nicht "fixen", sondern
*verstehen*):

**Automerge `generateSyncMessage` / `receiveSyncMessage` ist strikt zwischen
zwei Peers.** Wenn A einen Change schickt und B empfaengt ihn, leitet B den
Change **nicht automatisch** als Sync-Nachricht an C weiter. B appliziert ihn
nur lokal. Erst der **naechste Timer-Tick auf B → C** transportiert den
Change weiter.

→ Konvergenz im Mesh ist **transitiv ueber mehrere Rounds**, nicht in einer
Round.

**Test-Konsequenz:** Bei Partition A vs {B,C} konvergieren B+C zu Hash H₂,
A bleibt bei H₁. Erwartung "alle drei gleich" ist falsch, solange Partition
besteht. Erst nach Reconnect + ≥ 2 Sync-Intervallen sind alle drei gleich.

## Konvergenz-Garantie

Architektur-Versprechen, das diese Aenderung in den Vertrag aufnimmt:

**v1 (initial):**
> Wenn fuer einen Peer `P` gilt `peers_online[P] > 0` UND
> `registry_hash[local] != registry_hash[P]` laenger als **120 s**
> (= ≥ 2 Sync-Intervalle bei 45 s + Slack), MUSS das System diesen Zustand
> automatisch aufloesen — durch Sync-Versuch, Stream-Recycling oder
> Connection-Reset.

**v2 (verschaerft):**
> Wenn `libp2p.connected[P]` UND `getHeads(local) != getHeads(P)` laenger als
> **60 s**, MUSS das System diesen Zustand automatisch aufloesen.

Verletzung dieser Garantie = Regression.

## Tests

Korrektur gegenueber initialer Skizze nach Test-Review durch Gemini, gpt-5.5
und MiniMax-M2.7. Drei substanzielle Fehler wurden gefunden — Test-Strategie
entsprechend angepasst:

### Unit: `RegistrySyncCoordinator`

Datei: `packages/daemon/tests/registry-sync-coordinator.test.ts`

Wichtig: **SyncState pro Peer wird ueber die gesamte Test-Session persistiert
und mutiert**, nicht pro Iteration neu mit `initSyncState()` erzeugt — sonst
testen wir nicht den echten Automerge-Sync, sondern eine endlose
Bloom-Filter-Wiederholung.

Zu testen:
- Initialer `peer:connect` triggert genau einen Push
- Konvergenz nach Round-Trip — **Wichtig in v1:** Hash-Equality via
  `exportCapabilities()`-Hash (extrahierte Caps-Liste), **nicht** via
  `getHeads()`. Solange `last_sync` im CRDT-Doc steht (Entfernung ist v2.1),
  mutiert jeder Sync-Versuch das Doc und erzeugt neue Heads — `getHeads()`
  wuerde dann nie Equality erreichen. Ab v2.1 darf wieder auf `getHeads()`
  umgestellt werden.
- `peer:disconnect` + `peer:connect` ergibt frischen SyncState (Reset-Garantie)
- Timer-Tick triggert Sync-Push fuer connected peers via Fake-Timers:
  `vi.useFakeTimers({ shouldAdvanceTime: false })` + manuelles
  `await vi.advanceTimersByTimeAsync(...)`. Auto-Advance maskiert
  Race-Conditions.
- Jitter-Bandbreite: kein statistischer n=100-Test (zu langsam, in CI flaky),
  stattdessen **Boundary-Test mit gemocktem RNG**:
  - `vi.spyOn(Math, 'random').mockReturnValue(0)` → Tick bei unterer Grenze
  - `vi.spyOn(Math, 'random').mockReturnValue(0.999)` → Tick bei oberer Grenze
- Per-Peer Singleflight: paralleler Init-Push und Timer-Tick fuehren zu nur
  einer Sync-Round pro Peer
- AbortController-Timeout deterministisch via Fake-Timers: Sync triggern,
  `advanceTimersByTimeAsync(timeoutMs)`, assert dass Promise mit
  `AbortError` rejected und SyncState aufgeraeumt
- 3-Strike-HangUp: drei aufeinanderfolgende Sync-Rounds ins Timeout laufen
  lassen → Coordinator ruft `hangUp(peerId)` auf, SyncState verworfen
- Safety Valve: `republish()` triggert sofortigen Round-Trip
- Cleanup: `stop()` raeumt alle Timer + Event-Listener weg

Mock-Transport: **zwingend asynchron via Promise-Queue**. Ein synchroner Mock
maskiert Race-Conditions und Deadlocks in der Singleflight-Logik.

### Integration (3 Nodes, korrekte Partition)

Datei: `tests/integration/registry-recovery.test.ts`

**Korrektur Topologie:** A↔C blockieren reicht nicht, weil B als Relay
**ueber mehrere Sync-Rounds** transitiv konvergiert. Echte Partition ist
**A vs {B,C}**, also alle Cross-Edges von A blocken.

```
Vorher (falsch):                 Korrigiert:
  A — B                            A    |    B
  ↓       \                                   |
  X — C                                      C
```

Polling statt `sleep`:
```ts
await vi.waitFor(async () => {
  expect(await A.getRegistryHash()).not.toBe(await C.getRegistryHash());
}, { timeout: 5_000, interval: 500 });
```

Erwartung waehrend Partition: A hat H₁, B+C konvergieren zu H₂.
Erwartung nach Reconnect: Alle drei gleich nach ≤ 2 Sync-Intervallen.

Cleanup im `finally`-Block, damit Test-Aborts keine Zombie-Daemons
hinterlassen.

**Bewusste Entscheidung gegen "nackte libp2p-Nodes ohne Daemon":** Der
ursprueliche Bug lag im **Wiring** des Daemons (`libp2p-runtime.ts:342`),
nicht im libp2p selbst. Mit nackten Nodes wuerde genau die Integrationsschicht
weggemockt, in der der Bug passiert ist. `spawnDaemonInProcess` mit
deaktivierten Sub-Systemen (HTTP-Server, Background-Tasks via Config-Flag) ist
der richtige Trade-off zwischen Realismus und Isolation.

### Property (In-Memory, kein Daemon-Spawn)

Datei: `packages/daemon/tests/registry-sync-property.test.ts`

**Korrektur:** fast-check mit echten Daemon-Subprozessen ist eine CI-Bombe
(Zombie-Risiko, Port-Konflikte, Timing-Non-Determinismus). Property-Tests
laufen auf **In-Memory-Ebene** mit Mock-Transport:

```ts
const peers = [createPeer(), createPeer(), createPeer()];
const transport = new MockMeshTransport();   // route, filter, partition
// fc.assert(fc.property(opSeq, partitionSeq, ...), { numRuns: 100 })
```

Invariant: bei beliebiger Op-Sequenz konvergieren nicht-partitionierte Peers
innerhalb von 2 simulierten Sync-Intervallen. `numRuns` darf auf 100+ stehen,
weil pro Run nur Millisekunden vergehen.

### Zusaetzliche Edge-Case-Tests (von MiniMax + gpt-5.5 nachgereicht)

- Stream-EOF nach receive, vor reply
- Multi-Chunk-Frames bei grosser Initial-Payload
- Concurrent local Registry-Mutation waehrend laufender Sync-Round
- Handler-Exception → kein State-Leak
- Protocol-Version-Mismatch (z.B. v1 ↔ v2)
- Persistierter alter Doc nach Daemon-Neustart ohne Schema-Migration

## Konsequenzen

**Positiv:**
- Capability Registry erfuellt das Architektur-Versprechen aus CHANGES.md
  („CRDT-basierte Capability Registry") — bisher war das nur konzeptuell.
- Tote libp2p-Streams werden durch reale Last endlich entdeckt.
- Observability ueber `/api/status` verhindert unbemerktes Auseinanderdriften.

**Negativ / Risiken:**
- Periodischer Sync erzeugt Grundlast (Jitter, kleine Payloads dank
  Hash-Vergleich vor Diff-Sync — pro Peer max. ein paar KB/min).
- Falls Automerge-Doc unerwartet gross wird: Memory-Druck bei initialem
  Sync. Mitigation: schon vorhandener Hash-Vergleich + Lazy-Sync; bei
  identischen Heads kein Diff.
- Bug-Klasse Capability-Flap (siehe `Generisches Skill-Health-Monitoring` in
  TODO.md) wird durch funktionierenden Sync **sichtbarer** — Sync-Sturm
  moeglich. Damping wird in ADR-NNN-skill-health-lifecycle adressiert, nicht
  hier.

## Streitpunkte / Disagreements im Konsens

### Safety Valve `/api/registry/republish`

Gemini-3-Pro-Preview lehnte den `/api/registry/republish`-Endpoint als
Architektur-Bandage ab: ein autonomes Mesh sollte sich nicht durch manuelle
Endpoints reparieren lassen muessen. gpt-5.2, gpt-5.5 und MiniMax-M2.7
stimmen zu, dass der Endpoint nuetzlich ist, **aber nur** unter strikten
Bedingungen: admin-only, rate-limited (max. 1/min/peer), audited, kein
Daten-Schreibeffekt, keine Tests duerfen davon abhaengen.

Entscheidung: Endpoint kommt rein, mit allen genannten Auflagen.

### MiniMax-M2.7 vs Gemini zur Test-2-Topologie

Gemini begruendete den Topologie-Fehler in Test 2 mit "B konvergiert
transitiv". MiniMax korrigiert: Automerge-Sync ist strikt **bilateral**, B
leitet Changes nicht automatisch als Sync-Nachricht weiter, sondern erst im
naechsten eigenen Timer-Tick zu C. Beide Sichten fuehren zum selben Test-Fix
(echte Partition = A vs {B,C}), aber die korrekte Begruendung ist MiniMax'.
Diese Eigenschaft ist jetzt im neuen Abschnitt "Eigenschaft: Automerge Sync
ist bilateral" oben dokumentiert.

## Naechste Schritte

### v1-PR
1. PR `agent/<host>/registry-replication-recovery-v1` aufmachen
2. CO ✅ (dieser ADR), CG fuer Test-Skizzen-Verifikation via `pal:chat`
   gemini-3-pro-preview
3. Implementierung v1.1 – v1.5 + Safety Valve + Status-Endpoint + Tests
4. CR via `pal:codereview` (gpt-5.5 oder gemini-3-pro-preview)
5. Live-Deploy auf alle 5 Mesh-Nodes, Beobachtung ueber 24 h
6. Konvergenz-Garantie v1 (120 s) als Monitoring-Alert

### v2-PR (nachgelagert)
1. PR `agent/<host>/registry-replication-recovery-v2`
2. v2.1 – v2.5 in sinnvollen Sub-PRs (v2.2 Owner-wins braucht ggf. eigenen
   ADR, falls Migration noetig)
3. Konvergenz-Garantie auf v2 (60 s) verschaerfen
