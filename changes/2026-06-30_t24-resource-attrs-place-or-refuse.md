# T2.4 — Resource-Attribute in der Registry + place-or-refuse (V5 Spur 2)

**Datum:** 2026-06-30
**Branch:** `claude/t24-resource-attrs-place-or-refuse`
**Owner:** Claude (ThinkLocal-Lane)
**Typ:** Feature (Kapazitäts-Schutz + Observability) — kein Deploy
**V5-Bezug:** T2.4 (Spur 2, M)

## Problem / Ziel

Knoten kannten ihre eigene Auslastung nicht routing-wirksam, und es gab keinen
Schutz davor, einem überlasteten Knoten weitere Arbeit zuzuschieben. T2.4:
1. **Resource-Attribute** (`free_ram`, `cpu_load`, `agent_count`) pro Knoten in der Registry.
2. **place-or-refuse**: bei RAM-Auslastung **> 90 %** lehnt der Knoten neue Task-Platzierung ab.

## Umsetzung

### Resource-Attribute (Registry-Side-Map)
- **`registry.ts`**: neue **non-replizierte** Side-Map `nodeResources` (`NodeResourceRecord`:
  free_ram_bytes, ram_used_percent, cpu_load, agent_count, updated_at) + `setNodeResources` /
  `getNodeResources` / `getAllNodeResources`. **Bewusst NICHT im Automerge-CRDT** — wie
  `availability` (ADR-021): owner-authoritativ, schnell veränderlich → sonst „relay-witness-wins".
- **`index.ts`**: periodischer Updater (`resource_refresh_interval_ms`, Default 15 s, `unref` +
  Shutdown-`clearInterval`, try/catch) schreibt die eigenen Attribute; `agent_count = agentRegistry.size()`.

### place-or-refuse-Gate
- **`resource-metrics.ts`** (neu): `computeRamUsedPercent` (**cache-bewusst**: `(total−available)/total` —
  sonst zählt Linux-Page-Cache als belegt → gesunder Knoten lehnt alles ab), `readRamUsedPercent`
  (Hot-Path), `readResourceMetrics` (voll), `evaluatePlacement` (strikte `>`-Schwelle).
- **`task-executor.ts`**: Gate als **erste** Aktion in `handleTaskRequest` (der reale Chokepoint;
  `PolicyEngine` ist ungenutztes totes Modul). Inert ohne Reader+Schwelle (back-compat).
  **Fail-OPEN**: schlägt die RAM-Messung fehl, wird der Task angenommen (ein Mess-Fehler
  darf den Knoten nie lahmlegen). Refusal trägt `reason:'capacity'`.
- **`dashboard-api.ts`**: `reason==='capacity'` → **HTTP 503** (statt 404); „Skill fehlt" bleibt 404.
- **`events.ts`**: `task:refused`. **`config.ts`**: `[placement]` (`refuse_ram_percent`=90,
  `resource_refresh_interval_ms`=15000) + Env + Range-Check (1..100).

## Tests

`place-or-refuse.test.ts` (neu, **14 Tests**): computeRamUsedPercent (cache-bewusst, robust),
evaluatePlacement (`>`-Grenzen inkl. ==90→accept), **Executor-Gate als echte Integration**
(real TaskExecutor: RAM>90 → reason=capacity VOR Skill-Check; <90 → normaler Pfad;
**Mess-Fehler → fail-open**), Registry-Side-Map set/get, config Defaults/Env/Range.
`dashboard-api.test.ts` (+2): capacity→503, Skill-fehlt→404.
Volle Suite **103 Files / 1238 grün**, tsc 0, eslint 0 (neue Dateien). Empirisch
guard-bewiesen: Gate `>`→`>=` mutiert ⇒ ==90-Test rot, restauriert ⇒ grün.

## Review

Unabhängiger **Claude**-Subagent: **APPROVE-WITH-NITS**, Gate + Side-Map **CORRECT**.
CR-MEDIUM (Gate-Metrik ohne try/catch) **gefixt**: fail-open + Test. LOW/INFO
(Interval-Untergrenze, degraded-si-Edge) als bewusste, codebase-konsistente Trade-offs notiert.
(`pal`-externes `agy`-Backend im Env nicht installiert → Claude-Subagent als echtes Review.)

## Out of scope / Folge

- Resource-Attribute auch über die Agent-Card/Mesh-Query exponieren (derzeit lokale Side-Map).
- CPU-/agent_count-basierte Platzierungs-Heuristik (T2.4 gatet nur RAM, wie spezifiziert).
- Totes `policy.ts`/`PolicyEngine` anschließen oder deprecaten.
