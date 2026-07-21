# TL-21 — Skelett-Auskunft: zweistufige Capability-Offenlegung (Kap. 06)

**Status:** aktiv (Slice 1) · **Erstellt:** 2026-07-16 · KW30 · **Typ:** additive, read-only Daemon-Auskunft.
**Kein** Christian-/Deploy-/Secret-Gate, **kein** neuer State, **keine** Änderung an bestehendem
Endpoint-Verhalten (rein additiv).

## 1. Problem (Kap. 06 — Kontext-Ökonomie)
Ein Agent, der „was kann dieser Knoten?" fragt, bekommt heute entweder **zu wenig** (`list_skills` →
`{skill_id, agent_id, health}`, **ohne** Beschreibung) oder **zu viel** (`GET /api/capabilities` → volle
`Capability`-Objekte inkl. `version`, `permissions`, `trust_level`, `updated_at`, je **Provider** dupliziert).
Für die Erst-Orientierung soll er eine **kompakte Skelett-Übersicht** sehen — pro Skill **ein** Eintrag:
**Name + ein Satz** — und **Details erst auf Abruf** ziehen. Das spart Kontext-Budget und Latenz.

## 2. Entscheidung (Design, für einen additiven Read-View bewusst ohne formales `pal:consensus` —
Präzedenz #278 „additive Observability"; die Wahl ist eine kompakte Projektion vorhandener Daten,
keine Architektur-Änderung. Offene Punkte unten sind benannt, nicht eigenmächtig erweitert.)

**Skelett-Einheit = distinkter `skill_id`**, **dedupliziert über Provider** (nicht pro `(agent,skill)`-Paar).
Ein Skelett-Eintrag:
```jsonc
{
  "skill_id": "influxdb.read",
  "summary":  "Liest Zeitreihen aus InfluxDB.",   // = erster Satz von Capability.description
  "category": "database",
  "providers": 2,                                   // Anzahl anbietender Agenten
  "health":   "healthy"                             // aggregiert: healthy, wenn ≥1 Provider healthy; sonst degraded; sonst offline
}
```
- **„Ein Satz" = `firstSentence(description)`**: bis zum ersten `.`/`!`/`?`, das von Whitespace/Textende
  gefolgt wird (Lookahead → keine Zerschneidung an Dezimalzahlen wie „v3.14"). Der **Inhalt** wird **immer**
  auf `SUMMARY_MAX_LEN=160` Code-Einheiten gekappt; wird gekürzt, hängt `…` an → das Ergebnis ist ≤ **160
  Inhalts-Zeichen + optionales `…`** (max. 161 Code-Einheiten). Der Cap greift auch bei gefundenem
  Terminator, damit ein untrusted (CRDT-basierter) „8-KB-Ein-Satz" die Übersicht nicht sprengt.
  **Total gegen malformed CRDT-Daten:** ein non-string `description`/`category`/`agent_id` wird auf `''`
  normalisiert, ein Eintrag ohne verwertbaren `skill_id` übersprungen — die additive Read-View bleibt
  bounded/deterministisch statt in einen 500er zu kippen (CR-MEDIUM #281). Abkürzungen (`z.B.`) bleiben
  eine bewusste Heuristik-Grenze. Quelle ist **ausschließlich** das vorhandene `Capability.description`.
- **Deterministisch:** sortiert nach `skill_id`; die `summary`/`category` stammen vom **gesund-bevorzugten**
  Provider (erst healthy, dann degraded, dann offline; bei Gleichstand lexikografisch nach `agent_id`) —
  stabil ohne `Date`/Random.
- **Health-Aggregation:** `healthy` wenn irgendein Provider `healthy`; sonst `degraded` wenn irgendeiner
  `degraded`; sonst `offline`. (Ein Skill ist nutzbar, solange **ein** gesunder Anbieter existiert.)

## 3. Zweistufigkeit
- **Stufe 1 (Übersicht):** `GET /api/capabilities/overview` → `{ skills: SkeletonEntry[], count }`.
  Kompakt, ein Eintrag pro `skill_id`.
- **Stufe 2 (Details auf Abruf):** der **bestehende** `GET /api/capabilities?skill_id=<id>` (bzw.
  `?agent_id=`) liefert unverändert die vollen `Capability`-Objekte je Provider. **Keine Änderung** an
  diesem Pfad — die Skelett-Übersicht verweist nur darauf.

## 4. Abgrenzung / Slices
- **Slice 1 (dieses Doc + Code):** REST-Skelett `GET /api/capabilities/overview` + reine Helfer
  (`firstSentence`, `buildCapabilitySkeleton`), voll unit-getestet. Read-only, additiv.
- **Slice 2 (Folge, optional):** identische Skelett-Projektion als **MCP-Tool**
  (`list_capabilities_overview`) für die Agent-Kontext-Ökonomie — dieselbe reine Funktion, anderer
  Transport. Bewusst getrennt, damit Slice 1 klein/testbar bleibt und die MCP-Tool-Fläche separat
  reviewt wird.
- **Slice 3 (Peers, umgesetzt 2026-07-20):** dasselbe Muster für **Peers** — REST-Skelett
  `GET /api/peers/overview` + reines Modul `peer-skeleton.ts` (`buildPeerSkeleton`/`buildPeerOverview`).
  Ein Eintrag pro Peer (`{ agent_id, name, status, version, skills:count, load_percent }`, sortiert nach
  `agent_id`) ersetzt für „wer ist im Mesh?" die vollen Agent-Card-`capabilities`-Arrays durch **Zähler**;
  Details bleiben auf Abruf über das unveränderte `GET /api/peers`. **Same-source** `mesh.getOnlinePeers()`
  (Verhaltensparität; `status` ist wie bei `/api/peers` faktisch immer `online`). Total gegen malformed/
  geforgte Wire-Card-Daten (kein 500er). Read-only, additiv. Eine All-known-Variante (inkl. offline-Peers)
  bräuchte einen neuen Mesh-Getter → eigener Slice.
- **Slice 4 (Peer-MCP-Tool, umgesetzt 2026-07-20):** identische Peer-Skelett-Projektion als **MCP-Tool**
  `list_peers_overview` für die Agent-Kontext-Ökonomie — derselbe reine Envelope-Builder `buildPeerOverview`
  von REST **und** MCP benutzt (same-source `mesh.getOnlinePeers()`) → strukturelle Parität, kein Drift.
  Genau die Trennung, mit der Slice 1 → Slice 2 bei den Capabilities getrennt wurde (kleine, separat
  reviewbare MCP-Fläche). Read-only, additiv.
- **Slice 5 (Tasks, umgesetzt 2026-07-21):** dasselbe Muster für **Tasks** — REST-Skelett
  `GET /api/tasks/overview` + MCP-Tool `list_tasks_overview`, beide über den **einen** reinen
  Envelope-Builder `buildTaskOverview` (`task-skeleton.ts`) → strukturelle Parität, kein Drift.
  Same-source `TaskManager.getAllTasks()` (Verhaltensparität zu `GET /api/tasks`). Ein Eintrag pro
  Task ersetzt die vollen `input`/`result`/`error`-Blobs durch **Signale**
  (`{ id, skill_id, state, executor, has_result, has_error }`, sortiert nach `id`); zusätzlich ein
  **Status-Histogramm** `by_state` (`Record<TaskState, number>`), das die Erst-Orientierungsfrage
  „was läuft gerade?" ohne Durchblättern beantwortet — der eigentliche Kontext-Ökonomie-Gewinn bei
  Tasks (anders als bei Skills/Peers, wo jeder Eintrag selbst der Punkt ist). Details bleiben auf
  Abruf über das unveränderte `GET /api/tasks` (bzw. `?state=`). `state` wird gegen die sechs
  gültigen `TaskState`-Werte geprüft; ein unbekannter/geforgter Wert wird **konsistent** auf
  `'requested'` normalisiert — im Eintrag **und** im Histogramm dort gezählt (kein frei erfundener
  Union-Wert, kein erfundener Histogramm-Schlüssel). Damit gilt invariant
  `Summe(by_state) === count`. Total gegen malformed Felder (kein 500er). Read-only, additiv.
- **Slice 6 (Tools, umgesetzt 2026-07-21):** dasselbe Muster für die **MCP-Tool-Fläche** — REST-Skelett
  `GET /api/tools/overview` + MCP-Tool `list_tools_overview`, beide über den **einen** reinen
  Envelope-Builder `buildToolOverview` (`tool-skeleton.ts`) → strukturelle Parität, kein Drift.
  **Same-source** `registry.getAllCapabilities()`, gefiltert auf die MCP-Service-Einträge
  (`category='mcp'`, `skill_id='mcp:<server>'`, `mcp-service-registry.ts`) — also eine **Spezialisierung**
  des Capability-Skeletts auf die geteilte Tool-Fläche. Ein Eintrag pro **Server** (dedupliziert über
  Provider): `{ server, summary, execution_tier, providers, health }`, sortiert nach `server`
  (kanonisiert → `mcp:Unifi`/`mcp:unifi` mergen). `summary` = `firstSentence(description)` des
  gesund-bevorzugten Providers (wiederverwendet aus `capability-skeleton.ts`); `health` aggregiert wie
  §2. Der tool-spezifische Kontext-Gewinn ist die **`execution_tier`** (`self`/`gate`/`consensus`): sie
  wird **konservativ** als restriktivste Stufe (`maxTier`) über **alle** Provider geführt — ein Agent
  sieht nie eine zu niedrige Stufe. `execution_tier` ist **fail-closed** (CR-MEDIUM): malformed
  `permissions` (kein Array bzw. Array mit verworfenen non-string-Elementen) werden auf mindestens
  `gate` gebodet — sonst würde die Übersicht die Stufe unter-behaupten und vom realen Routing-Pfad
  `resolveMcp` (der einen non-array-String Zeichen-für-Zeichen zu `gate` ableitet) abweichen. Details
  bleiben auf Abruf über das unveränderte `GET /api/capabilities?category=mcp` bzw. `query_capabilities`.
  Total gegen malformed Felder (kein 500er). Read-only, additiv. **Damit ist TL-21 (Kap. 06) vollständig:**
  Skills, Peers, Tasks, Tools — je REST + MCP über einen gemeinsamen Envelope-Builder.
- **Nicht in Scope:** Paginierung (die Skill-/Peer-/Task-/Server-Menge ist heute klein); Volltext-Suche;
  ein per-**Werkzeug** (statt per-Server) Skelett — die CRDT-`Capability` faltet Tools in die
  `description`, ein strukturiertes per-Tool-Feld wäre ein eigener Slice.

## 5. Invarianten (VOR Code)
1. **Read-only, additiv** — kein neuer State, `/api/capabilities` (Details) unverändert.
2. **Nur vorhandene Daten** — `summary` aus `Capability.description`, kein neues Pflichtfeld.
3. **Deterministisch** — stabile Sortierung + gesund-bevorzugte Provider-Wahl, kein `Date`/Random.
4. **Dedupe pro `skill_id`** — die Übersicht zeigt Skills, nicht `(agent,skill)`-Paare.
5. **Health-Aggregation** wie §2 (ein gesunder Anbieter ⇒ Skill gilt als healthy).

## 6. Verweise
- Datenmodell: `packages/daemon/src/registry.ts` (`Capability`, `getAllCapabilities`).
- Bestehende Fläche: `dashboard-api.ts` (`GET /api/capabilities`), `mcp-server.ts` (`list_skills`).
- Kontext-Ökonomie-Motivation: Projekt-Kapitel 06 (Skelett-Auskunft).
