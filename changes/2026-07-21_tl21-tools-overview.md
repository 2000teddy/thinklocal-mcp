# changes/2026-07-21 — feat(mcp,api): TL-21 Slice 6 — Tool-Skelett (`GET /api/tools/overview` + `list_tools_overview`)

**Typ:** additive, **read-only** Daemon-Auskunft (TL-21 Slice 6, Kap. 06 Kontext-Ökonomie) — der letzte
Slice; **schließt TL-21 ab** (Skills/Peers/Tasks/Tools je REST + MCP). **Kein** Christian-/Deploy-/Secret-
Gate, **kein** neuer State, `index.ts` unangetastet, **keine** Änderung an bestehendem Verhalten.

## Warum
Ein Agent, der fragt „welche MCP-Tools/Server kann ich im Mesh rufen — und zu welcher Ausführungsstufe?",
musste bisher die vollen `mcp:`-Capabilities über `query_capabilities`/`GET /api/capabilities` ziehen
(je Provider dupliziert, volle Objekte). Für die Erst-Orientierung ist das zu viel Kontext-Budget.

## Was
- **`packages/daemon/src/tool-skeleton.ts` (neu, rein):** `buildToolSkeleton`/`buildToolOverview`.
  Filtert `registry.getAllCapabilities()` auf die MCP-Service-Einträge (`category='mcp'`,
  `skill_id='mcp:<server>'`, via `mcp-service-registry.ts`) und dedupliziert **pro Server** (kanonisierter
  Name → `mcp:Unifi`/`mcp:unifi` mergen). Ein Eintrag: `{ server, summary, execution_tier, providers, health }`,
  sortiert nach `server`. `summary` = `firstSentence(description)` (wiederverwendet aus
  `capability-skeleton.ts`) des gesund-bevorzugten Providers; `health` aggregiert wie das Capability-Skelett.
  - **`execution_tier`** (`self`/`gate`/`consensus`): **konservativ** = restriktivste Stufe (`maxTier`) über
    **alle** Provider — nie eine zu niedrige Stufe. Fail-closed (`providerTier`): malformed `permissions`
    (kein Array / Array mit verworfenen non-string-Elementen) → mind. `gate`.
- **`dashboard-api.ts`:** `GET /api/tools/overview` → `buildToolOverview(registry.getAllCapabilities())`.
- **`mcp-server.ts`:** MCP-Tool `list_tools_overview` → **derselbe** Builder → strukturelle Parität, kein Drift.
  Details bleiben auf Abruf über das unveränderte `GET /api/capabilities?category=mcp` / `query_capabilities`.

## Tests (+33, Suite **1887 grün**, 137 Files)
- `tool-skeleton.test.ts` (**23**): Projektion, Dedup/Kanonisierung, gesund-bevorzugter Provider,
  Health-Aggregation, Sort-Determinismus, `execution_tier` (self/gate/consensus, konservativ, low-trust→gate,
  offline-Provider zählt mit), 5 Malformed-Regressionen **plus 3 CR-Regressionen** (non-array permissions
  → gate; verworfenes non-string-Element → gate; Parität `overview ≥ resolveMcp`-Stufe).
- `mcp-server.test.ts` (**+4**): echtes registriertes Tool via `_registeredTools['list_tools_overview'].handler`
  — Registrierung, Envelope-Parität mit REST (`buildToolOverview`), leere Registry, malformed → total.
- `dashboard-api.test.ts` (**+3**): Endpoint-Wiring (Dedup/Sort/execution_tier), leer, malformed → **200**.

## CR (adversariales Claude-Subagent; `agy` fehlt für `pal:codereview`, `[[pal-review-backend-agy-missing]]`)
- **Kein HIGH/CRITICAL.** Totalität, Determinismus, REST↔MCP-Parität, Drift-Freiheit zu `isMcpCapability`
  bestätigt.
- **1 MEDIUM gefixt (an der Wurzel):** `asStringArray` normalisierte non-array `permissions` auf `[]` →
  fail-**open** (`self`), was die Stufe unter-behauptet und vom realen Routing-Pfad `resolveMcp` abweicht
  (der einen non-array-String Zeichen-für-Zeichen zu `gate` ableitet). Ersetzt durch `providerTier`
  (fail-**closed**: malformed → mind. `gate`) + 3 Regressionstests; der zuvor die Fail-open-Semantik
  ratifizierende Test wurde umgedreht.

## Abgrenzung (bewusst außer Scope)
- Per-**Werkzeug** (statt per-Server) Skelett — die CRDT-`Capability` faltet Tools in die `description`;
  ein strukturiertes per-Tool-Feld wäre ein eigener Slice.
- Paginierung/Volltext-Suche — die Server-Menge ist heute klein.

## Compliance
- **CO:** entfällt — additive Read-View einer konsentierten Design-Linie (TL-21-Design §4 „dasselbe Muster
  für Tools/Tasks"; Präzedenz #281/#285/#303/#304/#309). Keine neue Architektur-Frage.
- **CG:** entfällt (`clink`/`gemini` nicht im PATH; Muster aus den Vorgänger-Slices).
- **TS ✅:** +33 Tests, Suite **1887 grün**, `tsc --noEmit` (strict) 0, eslint (0 errors)/prettier clean.
- **CR ✅:** s.o. — kein HIGH; 1 MEDIUM gefixt + Regressionstests.
- **PC ✅:** Secret-Scan clean.
- **DO ✅:** dieser Eintrag, `CHANGES.md`, `COMPLIANCE-TABLE.md`, `TODO.md`,
  `docs/architecture/TL-21-skeleton-disclosure.md` §4 (Slice 6), `docs/API-REFERENCE.md`, die Modul-/Testdateien.
