# changes/2026-07-17 — feat(mcp): TL-21 Slice 2 — MCP-Tool `list_capabilities_overview`

**Typ:** Daemon-Feature (read-only, additiv) + Tests (TL-21 Slice 2, Kap. 06 Kontext-Ökonomie).
**Kein** Deploy/Secret/Christian-Gate.

## Warum
TL-21 Slice 1 (#281) lieferte die Skelett-Übersicht als REST `GET /api/capabilities/overview`. Slice 2 macht
**dieselbe** kompakte „Name + ein Satz je Skill"-Projektion als **MCP-Tool** verfügbar — damit ein Agent per
Tool-Aufruf (statt HTTP) kontext-ökonomisch „was kann dieser Knoten?" beantworten kann, Details auf Abruf via
`query_capabilities`. Design gepinnt in `docs/architecture/TL-21-skeleton-disclosure.md`.

## Was
- **`mcp-server.ts`:** neues Tool `list_capabilities_overview` (keine Parameter) → `{ skills, count }` als
  `content[0].text` (JSON). Read-only, strikte Teilmenge dessen, was `query_capabilities` bereits offenlegt.
- **`capability-skeleton.ts`:** neue reine Funktion `buildCapabilityOverview(capabilities)` → `{ skills, count }`
  (`count === skills.length`) als **eine Quelle der Wahrheit** für die Übersicht-Nutzlast.
- **`dashboard-api.ts`:** der REST-Endpoint nutzt jetzt **denselben** `buildCapabilityOverview` → REST und MCP
  können **strukturell nicht driften** (CR-MEDIUM-Fix, s.u.).
- **Tests:** neu `mcp-server.test.ts` (4) — invoked das **echte** registrierte Tool über
  `_registeredTools['list_capabilities_overview'].handler`; asst Envelope-Parität gegen `buildCapabilityOverview`,
  leere Registry, Totalität bei malformed Laufzeitdaten. `capability-skeleton.test.ts` (+2) — Envelope-Invariante.

## Review (CR)
Adversariales **Claude-Review-Subagent** (codex/agy nicht im PATH, Hausregel-bestätigter Pfad,
`[[pal-review-backend-agy-missing]]`) — **kein HIGH**. Rate-Limit-Abwesenheit explizit als **kein** Problem
eingestuft (MCP-Tools laufen über authentifizierten lokalen stdio-Transport; Geschwister-Tools sind ebenfalls
ungeratelimitet; die Übersicht ist strikte Teilmenge von `query_capabilities`). **1 MEDIUM gefixt an der Wurzel:**
der Test behauptete REST-Parität, erzwang sie aber nicht → gemeinsamer `buildCapabilityOverview`-Builder für
BEIDE Oberflächen → Parität strukturell statt nur asserted. LOW (Tautologie-Hinweis) durch die Envelope-Wurzel
entschärft.

## Abgrenzung
Reiner additiver Read-View; kein bestehendes Verhalten geändert (REST-Endpoint-Vertrag unverändert,
`dashboard-api.test.ts` 14 grün). Optionaler Folge: Skelett für Peers/Tools/Tasks.

## Compliance
- **CO/CG:** entfallen — additiver Read-View, Design in `TL-21-skeleton-disclosure.md` gepinnt (Präzedenz #281).
- **TS:** +6 Tests; volle Suite **1752 grün** (128 Files), tsc(strict)/neue-Datei-Lint 0.
- **CR:** Claude-Subagent (s.o.) — kein HIGH; 1 MEDIUM (Envelope-Parität) gefixt.
- **PC:** `git diff` gesichtet, Secret-Scan clean.
- **DO:** dieser Eintrag, `CHANGES.md`, `COMPLIANCE-TABLE.md`, `TODO.md`.
