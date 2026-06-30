# T2.4-Folge — CPU/agent_count-Heuristik im place-or-refuse-Gate + Mesh-Exposition

**Datum:** 2026-06-30
**Branch:** `claude/t24-cpu-agentcount-mesh-resource`
**Owner:** Claude (ThinkLocal-Lane)
**Typ:** Feature (Kapazitäts-Schutz + Observability) — kein Deploy, repo-intern
**V5-Bezug:** T2.4-Folge-Slices (aus `changes/2026-06-30_t24-resource-attrs-place-or-refuse.md` „Out of scope / Folge")

## Kontext

Basis-T2.4 (#215) gatet Platzierung nur über **RAM** (`> Schwelle → refuse reason=capacity`)
und pflegt eine non-replizierte Registry-Side-Map der Resource-Attribute
(`free_ram`, `ram_used_percent`, `cpu_load`, `agent_count`). Die dort benannten Folge-Slices:
**(1)** CPU/agent_count auch als Platzierungs-Dimension, **(2)** die Attribute über die
Agent-Card/Mesh exponieren. Beides liefert dieser Slice.

## Teil 1 — CPU/agent_count im Gate

- **`resource-metrics.ts`**: neue `evaluatePlacementMetrics(metrics, limits)` — Multi-Dimension-
  Entscheidung mit Priorität **RAM → CPU → agent_count**, strikt `>`, liefert
  `reason:'capacity'` + `limit:'ram'|'cpu'|'agents'`. Eine Dimension wird übersprungen, wenn
  ihr Wert `null/undefined/NaN` ist (fail-open pro Dimension) **oder** ihre Schwelle `0`/undefined
  ist (deaktiviert). Die alte `evaluatePlacement(ram, thr)` bleibt als **Back-Compat-Wrapper**
  (delegiert; identisch für gültige 1..100-Schwellen — bewusste Abweichung nur bei `<=0`,
  dokumentiert).
- **`task-executor.ts`**: Gate liest **RAM frisch pro Request** (await, fail-open bei throw),
  **CPU aus der 15s-Side-Map** (`getCpuLoad`, kein teures `si.currentLoad()` im Hot-Path),
  **agent_count instant** (`getAgentCount`). CPU/agent_count-Reader sind via `safeReadDimension`
  try/catch-gekapselt (CR-MEDIUM: per-Dimension fail-open als Garantie, nicht Annahme).
  Refusal trägt weiterhin `reason:'capacity'` → Dashboard-503-Mapping bleibt gültig; `limit` +
  Werte gehen in Log/Audit/`task:refused`-Event.
- **`config.ts`**: `placement.refuse_cpu_percent` (0..100, **Default 0 = aus**),
  `placement.refuse_agent_count` (>=0, **Default 0 = aus**) + Env
  (`TLMCP_PLACE_REFUSE_CPU_PERCENT`, `TLMCP_PLACE_REFUSE_AGENT_COUNT`, via `readNonNegativeInt`) +
  Range-Checks. **Opt-in**, damit RAM-Verhalten bestehender Deployments unverändert bleibt
  (CPU-Last ist spiky, agent_count-Limits deployment-spezifisch).

## Teil 2 — Mesh-Exposition

- **`agent-card.ts`**: neuer optionaler `resources`-Block in `/.well-known/agent-card.json`,
  gespiegelt aus der Self-`NodeResourceRecord` (Option `getNodeResources`). So sehen Peers über
  die Card **dieselbe cache-bewusste Kapazität**, nach der der Knoten ablehnt — `ram_used_percent`
  rechnet cache-bereinigt, anders als das bestehende `health.memory_percent`. Fehlt, solange kein
  Snapshot vorliegt (back-compat: ohne Callback kein Feld).
- **`index.ts`**: verdrahtet `getCpuLoad`/`getAgentCount`/Schwellen in den Executor und
  `getNodeResources` in den AgentCardServer (Quelle = Registry-Side-Map des eigenen Knotens).

## Tests

- **`place-or-refuse.test.ts`** (+11, jetzt 25): `evaluatePlacementMetrics` (CPU/agents-Grenzen
  inkl. `==`→accept, 0=deaktiviert, null-skip, RAM→CPU→agents-Priorität); Executor-Integration
  (CPU/agent_count refuse mit Fehlertext; deaktiviert→inert; **RAM-throw+CPU→CPU greift**;
  **CPU-Reader-throw→übersprungen, kein Crash**); config Defaults/Env/Range für CPU/agent_count.
- **`agent-card.test.ts`** (neu, 3): `resources`-Block via Fastify-`inject()` (In-Process):
  vorhanden bei Snapshot, fehlt bei undefined-Snapshot/ohne Option.

Volle Suite **105 Files / 1270 grün**, tsc 0, authored-files eslint 0 Errors. Empirisch
guard-bewiesen: `exceeds` `>`→`>=` mutiert ⇒ 3 Grenz-Tests (RAM/CPU/agents) rot, restauriert ⇒ grün.

## Review

Unabhängiger **Claude**-Subagent: **APPROVE**, 0× HIGH/CRITICAL. CR-MEDIUM (asymmetrisches
fail-open der CPU/agent-Reader) **gefixt** (`safeReadDimension` + Regression-Test). CR-LOW
(Wrapper-Divergenz `<=0`) dokumentiert; CR-LOW (Test RAM-throw+CPU) **ergänzt**; NIT
(Funktion zwischen Imports) bereinigt. (`agy`-Backend im Env nicht installiert → Claude-Subagent
als echtes Review, gemäß Hausregel — kein MiniMax/pal:chat.)

## Out of scope / Folge

- Place-or-refuse-Heuristik über die **Peer**-Resources (Routing-Seite wählt den am wenigsten
  belasteten Knoten) — dieser Slice exponiert die Attribute, nutzt sie aber noch nicht für die
  Auswahl beim Anfragenden.
- Totes `policy.ts`/`PolicyEngine` anschließen oder deprecaten (unverändert offen).
- Kein Deploy.
