# changes/2026-07-21 — feat(mcp,api): TL-21 Task-Skelett (`GET /api/tasks/overview` + `list_tasks_overview`)

**Typ:** additive, **read-only** Daemon-Auskunft (TL-21 Slice 5, Kap. 06 Kontext-Ökonomie). **Kein**
Christian-/Deploy-/Secret-Gate, **kein** neuer State, `index.ts` unangetastet, **keine** Änderung an
bestehendem Tool-/Endpoint-Verhalten. Setzt das im TL-21-Design (§4) als „dasselbe Muster später
anwendbar" benannte Tasks-Skelett um — genau die REST-+-MCP-Doppelung, mit der schon das Peer-Skelett
(Slice 3/4, #303/#304) und das Capability-Skelett (Slice 1/2, #281/#285) landeten.

## Warum
`GET /api/tasks` (und das Task-Objekt dahinter) trägt je Task die vollen `input`/`result`-Blobs, den
(potenziell großen) `error`-Text sowie `requester`/`executor`-SPIFFE-URIs, `deadline`, `updated_at`. Für
die Erst-Orientierung „was läuft gerade?" ist das zu viel Kontext-Budget für einen Agenten. Bisher gab es
keine kompakte Skelett-Sicht auf die Tasks.

## Was
- **`packages/daemon/src/task-skeleton.ts` (neu, rein):**
  - `buildTaskSkeleton(tasks)` → ein Eintrag pro Task `{ id, skill_id, state, executor, has_result,
    has_error }`, sortiert nach `id` (locale-unabhängig, deterministisch). Volle Blobs → **Signale**.
  - `buildTaskHistogram(tasks)` → `by_state: Record<TaskState, number>` (alle sechs Zustände immer präsent,
    Default 0).
  - `buildTaskOverview(tasks)` → Envelope `{ tasks, count, by_state }` = **eine Quelle der Wahrheit** für
    REST **und** MCP (Invariante `Summe(by_state) === count`).
  - **Total gegen malformed/geforgte Daten:** non-string `id`/`skillId` → `''` (kein Sort-Crash),
    non-string `executor` → `null`, unbekannter `state` → konsistent `'requested'` (im Eintrag **und** im
    Histogramm dort gezählt) — kein 500er (Härtungs-Klasse wie #281/#303).
- **`packages/daemon/src/dashboard-api.ts`:** neuer Endpoint `GET /api/tasks/overview` (rate-limited),
  ruft `buildTaskOverview(tasks.getAllTasks())` — same-source wie `GET /api/tasks`.
- **`packages/daemon/src/mcp-server.ts`:** neues MCP-Tool `list_tasks_overview` (keine Parameter), direkt
  hinter `delegate_task`, ruft **denselben** Builder → strukturelle Parität, kein Drift. Header-Kommentar
  (Tool-Liste) ergänzt.

## Tests (+25, alle grün — Suite **1856 grün**, 136 Files)
- `task-skeleton.test.ts` (**18**): Projektion/Signal-Ersetzung, Sort-Determinismus, Histogramm (Summe===count),
  Envelope, 6 Malformed-Regressionen (geforgter state/id/skillId/executor, undefined statt null), plus die
  CR-MEDIUM-Invariante (malformed `state` erscheint als `requested` im Eintrag **und** im Histogramm).
- `mcp-server.test.ts` (**+4**): echtes registriertes Tool via `_registeredTools['list_tasks_overview'].handler`
  — Registrierung, Envelope-Parität mit REST (`buildTaskOverview`), leere Menge → kein throw, malformed → total.
- `dashboard-api.test.ts` (**+3**): Endpoint-Wiring (Signale+Histogramm, Sort), leer → Null-Histogramm,
  malformed → **200** (kein 500), `Summe(by_state)===count`.

## Abgrenzung (bewusst außer Scope)
- **Tools-Skelett** (die MCP-Tool-Fläche selbst) — dasselbe Muster, eigener Slice.
- Paginierung/Volltext-Suche — die Task-Menge ist heute klein.

## Compliance
- **CO:** entfällt — additive Read-View einer bereits konsentierten Design-Linie (TL-21-Design §4;
  Präzedenz #278/#281/#285/#303/#304). Keine neue Architektur-Frage.
- **CG:** entfällt (`clink`/`gemini` nicht im PATH; Muster aus den Vorgänger-Slices, kein Boilerplate-Delegat nötig).
- **TS ✅:** +25 Tests; Full-Suite **1856 grün** (136 Files), `tsc --noEmit` (strict) 0, eslint (0 errors) /
  prettier auf allen geänderten Dateien clean.
- **CR ✅:** adversariales Claude-Subagent (`agy` fehlt für `pal:codereview`, `[[pal-review-backend-agy-missing]]`).
  **Kein HIGH/CRITICAL.** **1 MEDIUM** (Doc/Code-Drift: Doku sagte „malformed state wird übersprungen", Code
  zählt ihn korrekt als `requested`) → **Doku an den korrekten Code angeglichen** + Semantik-sperrender
  Regressionstest ergänzt. **3 LOW** bewertet (1 Test-Härtung übernommen; helper-Duplikat/O(2n) = bewusste
  Per-Modul-Konvention wie `peer-skeleton.ts`).
- **PC ✅:** Secret-Scan clean (keine Tokens/Keys im Diff), Build (`tsc`) grün.
- **DO ✅:** dieser Eintrag, `CHANGES.md`, `COMPLIANCE-TABLE.md`, `TODO.md`, `docs/architecture/TL-21-skeleton-disclosure.md`
  §4 (Slice 5), `docs/API-REFERENCE.md` (tasks/overview + peers/overview-Nachtrag), die drei Modul-/Testdateien.
