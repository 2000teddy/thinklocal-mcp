# ADR-021: Skill Health & Lifecycle Monitoring

- **Status:** Proposed
- **Datum:** 2026-05-18
- **Autor:** claude-code (Opus 4.7, 1M context)
- **Konsens:** `pal:consensus` mit `gpt-5.2` (8/10) + `gemini-3-pro-preview`
  (9/10), zwei produktive Streitpunkte (Backoff-Strategie, Registry-Semantik)
- **Verwandt:** ADR-004 (Heartbeat), ADR-020 (Registry Replication Recovery),
  TODO.md → "Generisches Skill-Health-Monitoring" (2026-05-17)

## Kontext

Am 2026-05-17 hatten wir folgenden Incident auf dem `influxdb`-Host:

```
15:55:36  thinklocal-daemon startet
15:55:37  builtin-skills/influxdb.ts ruft healthCheck() → connection refused
15:55:37  influxdb-skill wird NICHT in Registry registriert
15:56:12  influxdb.service ist ready (35 s zu spaet)
… 70 Min ohne weitere Health-Pruefung …
17:06:xx  manueller Daemon-Restart, Skill kommt zurueck
```

Der Daemon prueft Skill-Requirements (z.B. `services: ["influxdb"]`) **genau
einmal** beim Start. Faellt der Service spaeter aus oder kommt erst nach dem
Daemon hoch, wird der Skill nie re-evaluiert.

Lokal auf dem influxdb-Host symptomatisch geloest durch
`After=influxdb.service` in der systemd-Unit. Aber das **Pattern** trifft
**alle** Skills mit externer Abhaengigkeit auf **allen** Daemons: InfluxDB,
Telegram, Ollama, kuenftige Skills. Cross-Platform (macOS LaunchDaemon hat
kein `After=`-Equivalent) brauchen wir eine generische Loesung im Daemon
selbst.

## Entscheidung

Wir fuehren einen zentralen `SkillHealthMonitor` ein, dem jeder Skill nur
seinen `healthcheck.fn()` mitgibt. Scheduling, State-Machine, Hysterese,
Audit und Registry-Update orchestriert der Monitor zentral.

### 1. Skill-Manifest erweitern

```ts
healthcheck?: {
  intervalHealthyMs: number;   // default 30_000
  intervalUnhealthyMs: number; // default 60_000
  timeoutMs: number;           // default 5_000
  debounceUp: number;          // # Erfolge in Folge bis HEALTHY, default 2
  debounceDown: number;        // # Fehlschlaege in Folge bis UNHEALTHY, default 3
  fn: (signal: AbortSignal) => Promise<boolean>;
};
```

Skills liefern **nur** die Funktion + Thresholds. Kein eigenes Scheduling,
kein eigener Timer.

### 2. Zentrale Komponente `SkillHealthMonitor`

- Pro Skill ein Timer-getriebener Loop. **Jitter ±20 %** pro Tick, um
  Thundering Herd bei vielen Skills × vielen Nodes zu vermeiden.
- Pro Skill genau **ein Inflight-Check** (Mutex). Vermeidet ueberlappende
  Pruefungen wenn ein Check laenger braucht als `intervalMs`.
- Hartes Timeout via `AbortController` (nicht nur `Promise.race`) — sonst
  haengen Checks im fd-Leak fest, und der Monitor driftet.
- Graceful Shutdown: `stop()` cancelt alle laufenden Checks und Timer.

### 3. State-Machine — binaer, nicht ternaer

```
UNKNOWN → CHECKING → HEALTHY ↔ UNHEALTHY → (Skill-Unload entfernt aus Map)
```

**`DEGRADED` wurde aus der internen State-Machine entfernt.** Beide
Konsens-Modelle einig: ein dritter Zustand bringt mehr Komplexitaet als
Nutzen. Capability ist entweder verwendbar oder nicht. „Degraded" kann die
UI **dynamisch** ableiten (z.B. „gelb" wenn `consecutive_failures > 0` aber
Threshold noch nicht erreicht).

Hysterese: 2 Erfolge in Folge → `HEALTHY`, 3 Fehlschlaege in Folge →
`UNHEALTHY`. Flap-Damping passiert **im Monitor**, nicht im CRDT.

### 4. Registry-Integration — `availability`-Attribut, nicht Remove

**Entschieden gegen die Gemini-Position (Remove), zugunsten der GPT-Position
(Health als Attribut):**

```ts
RegistryCapability {
  ...
  availability: 'healthy' | 'unhealthy';
  last_checked_at: string;       // ISO timestamp
  consecutive_failures: number;
}
```

Beim State-Flip:
- Owner-Daemon (und nur er) updated das `availability`-Feld seiner eigenen
  Capability im CRDT.
- Capability bleibt registriert.
- Routing/UI filtert standardmaessig auf `availability === 'healthy'`.

**Begruendung (entgegen Geminis Anti-Argument):**

| Aspekt | Remove | Health-Attribut |
|---|---|---|
| Semantik | „verschwunden" = nicht installiert oder down? | klar: installed-but-down |
| Debug-Sicht | weg | bleibt — Ops sieht warum es nicht routet |
| CRDT-Churn bei Flap | Capability-Doc + Schema-Heavy | nur kleines Attribut, keine Add/Remove-Race |
| Industrie-Standard | nicht ueblich | k8s, Consul, etcd — alle so |
| Schema-Migration spaeter | hart | trivial, nur Feld dazu |

Geminis Sorge „mehr Logik beim Routing" akzeptieren wir — der Filter ist
trivial (`caps.filter(c => c.availability === 'healthy')`) und wandert in
eine Zentralfunktion.

### 5. Backoff — Linear mit getrennten Intervallen, kein Exponential

**Entschieden gegen die GPT-Position (Exponential Backoff), zugunsten der
Gemini-Position (Linear):**

- Healthy: alle 30 s pruefen
- Unhealthy: alle 60 s pruefen (2× langsamer als healthy)
- Kein exponentielles Backoff

**Begruendung (entgegen GPTs Anti-Argument):**

| Aspekt | Exponential | Linear (gewaehlt) |
|---|---|---|
| Recovery-Detection | wird verschleppt (bis 5 min Delay) | konstant binnen 60 s |
| Last bei toten Services | minimal | minimal (local TCP, kein Roundtrip) |
| Komplexitaet | Backoff-State pro Skill | nur 2 Konstanten |
| Vorhersagbarkeit | „wann pruefe ich naechstes Mal?" unklar | klar |

Bei v1 sind Health-Checks lokale TCP-Connects oder Datei-Reads — der
Performance-Vorteil von Exponential ist marginal. Wenn sich das bei
externen Skills aendert (z.B. Telegram-API mit Rate-Limit), kann v2 das
nachziehen.

### 6. Audit

Jeder State-Flip wird ins SQLite-Audit-Log geschrieben:

```
SKILL_HEALTH_TRANSITION
  agent_id, skill_id, from_state, to_state, consecutive_failures, last_error
```

Volumen begrenzt durch Hysterese — ein „flappender" Skill flippt maximal
alle 30 s, in der Praxis bei intakter Hysterese viel seltener.

### 7. Observability — `/api/status`

Health-State pro Skill:

```json
{
  "skills": [{
    "id": "influxdb",
    "state": "healthy",
    "last_check_at": "2026-05-18T...",
    "next_check_at": "2026-05-18T...",
    "consecutive_failures": 0,
    "last_error": null,
    "state_changes_24h": 2
  }]
}
```

### 8. Mesh-Konflikt: Owner-wins

Wenn Peer A meine eigene Capability als healthy meldet, ich aber als
unhealthy: **meine Sicht ueber meine eigenen Skills gewinnt.** Per
CRDT-Schema: jeder Peer schreibt nur seine eigene Capability-Liste.

Voraussetzung dafuer: Owner-wins muss im CRDT-Layer durchgesetzt sein.
Aktueller Code (`markAgentOffline`, `removePeerCapabilities`) mutiert fremde
Namespaces — siehe **ADR-020 v2.2**. Dieses ADR setzt also voraus, dass
ADR-020 v2.2 implementiert ist (oder gleichzeitig nachgezogen wird).

### 9. Hot-Reload — nein

Skills bleiben **geladen** im Daemon. `availability=unhealthy` toggelt nur
das Routing. Kein Reload des TS-Modules. Wenn ein Skill Ressourcen
reserviert (Subprocess, Port), bekommt er optional einen `onHealthDown`-Hook.

## Beziehung zu ADR-004 (Heartbeat)

- **Heartbeat** = Peer-zu-Peer-Liveness (HTTPS via `mesh.ts`).
- **Skill Health** = intra-Daemon, Daemon-zu-Service-Liveness.

Trennen, aber `/api/status` exponiert beides nebeneinander.

## Tests

### Unit (`packages/daemon/tests/skill-health-monitor.test.ts`)

Alle Tests via **Fake-Clock + Test-Doubles** auf `fn()`. Kein realer
HTTP-Server, kein realer TCP-Connect.

- Hysterese 2-up: `[false, true, true]` → `UNKNOWN → HEALTHY` erst nach
  zweitem `true`
- Hysterese 3-down: `[true, true, false, false, false]` → `HEALTHY →
  UNHEALTHY` erst nach drittem `false`
- Inflight-Singleflight: Check braucht 40 s, Timer-Tick nach 30 s startet
  **keinen** zweiten Check
- Timeout: Check haengt → AbortSignal feuert nach `timeoutMs`, Check zaehlt
  als Fehlschlag
- Intervall-Switch: `HEALTHY → UNHEALTHY` schaltet von 30 s auf 60 s
- Jitter: ueber 100 Ticks liegt mean(intervall) in [0.95, 1.05] × Soll, max
  in [1.18, 1.22] × Soll
- `stop()`: keine offenen Timer / AbortController / fd
- State-Flip schreibt Audit-Event mit korrektem `from_state`/`to_state`

### Property (fast-check, in-memory)

Random-Sequenz von `true`/`false`-Health-Responses, beliebige
Debounce-Schwellen. Invariant: zwischen `HEALTHY` und `UNHEALTHY` liegen
mindestens `min(debounceUp, debounceDown)` Checks.

### Integration

Ein Daemon mit zwei Skills (eines stabil, eines flappend). Beobachten ueber
5 simulierte Minuten:
- State-History matcht erwartete Transitions
- Audit-Log hat erwartete Anzahl Events
- `/api/status` reflektiert State korrekt
- CRDT-Capability hat `availability` aktualisiert (Hash aendert sich nur bei
  State-Flip, nicht bei jedem Check)

## Konsequenzen

**Positiv:**
- Boot-Race wie 2026-05-17 (InfluxDB) wird automatisch geheilt
- „Installed but down" ist im Mesh sichtbar (Ops-Wert)
- Cross-Platform (macOS LaunchDaemon, systemd, Windows) ohne Abhaengigkeit
  von OS-Service-Manager

**Negativ / Risiken:**
- Grundlast pro Daemon: 1 Timer × N Skills × 30 s. Bei 10 Skills sind das
  ~20 Checks/Min — vernachlaessigbar bei lokalen Checks.
- CRDT-Hash flippt bei jedem State-Change. Bei flappenden Skills entsteht
  Sync-Traffic im Mesh. Hysterese (3-down) daempft das, ist aber kein
  Garant. Wenn das in Production zum Problem wird → ADR-NNN-flap-damping
  als Folge.
- Setzt **ADR-020 v2.2 (Owner-wins)** voraus. Solange v2.2 nicht
  implementiert ist, kann ein anderer Peer theoretisch meine
  `availability` ueberschreiben — in der Praxis macht das aktuell niemand,
  aber das ist eine offene Flanke.

## Streitpunkte / Disagreements im Konsens

### Backoff: Linear (Gemini) vs Exponential (GPT)

Gemini argumentiert: predictable time-to-recovery, Backoff verzoegert nur die
Erkennung dass ein Service wieder up ist. GPT argumentiert: industrie-
ueblich, vermeidet dauerhafte Last bei toten Services.

Entscheidung: Linear (Geminis Argument zaehlt bei lokalen Checks mehr). Falls
sich das fuer Skills mit externer API-Quote als Problem zeigt, kann v2
Backoff fuer einzelne Skills erlauben — als Skill-Manifest-Option, nicht als
Default.

### Registry: Health-Attribut (GPT) vs Remove (Gemini)

Gemini argumentiert: einfacheres Routing, kleinerer State, binaere CRDT-
Semantik. GPT argumentiert: weniger Hash-Churn, Debug-Sicht bleibt, k8s/
Consul-Standard.

Entscheidung: Health-Attribut (GPTs Argument zaehlt wegen Debug-Sicht und
Schema-Migration mehr). Geminis Sorge „mehr Routing-Logik" ist trivial
abgefangen durch einen zentralen Filter.

## Naechste Schritte

1. **Voraussetzung pruefen:** ADR-020 v2.2 (Owner-wins) muss eingeplant sein,
   ideal vor oder zeitgleich mit ADR-021.
2. PR `agent/<host>/skill-health-lifecycle` aufmachen
3. CO ✅ (dieser ADR), CG fuer Test-Skizzen via `pal:chat` gemini-3-pro
4. Implementierung: `SkillHealthMonitor` + Manifest-Erweiterung +
   `/api/status`-Erweiterung + Audit-Event-Typ
5. Vorhandene Skills migrieren: `builtin-skills/influxdb.ts`,
   `builtin-skills/ollama.ts`, `builtin-skills/telegram.ts` etc. — neuer
   `healthcheck.fn()` statt einmaligem Check beim Start
6. CR via `pal:codereview`
7. Live-Deploy auf alle 5 Mesh-Nodes, 24-h-Beobachtung mit Fokus auf
   Hash-Churn-Frequenz
