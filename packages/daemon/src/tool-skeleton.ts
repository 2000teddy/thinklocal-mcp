// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * tool-skeleton.ts — TL-21 Skelett-Auskunft für die MCP-Tool-Fläche (Kap. 06, Kontext-Ökonomie), Slice 6.
 *
 * Reine, kompakte Projektion der im Mesh geteilten **MCP-Server** (die „Tool-Fläche") in eine
 * „ein Eintrag pro Server"-Übersicht: Name + ein Satz + **Ausführungsstufe** + Zähler. Kein State,
 * kein I/O, deterministisch (kein Date/Random). Analog zu `capability-skeleton.ts` (Slice 1/2),
 * `peer-skeleton.ts` (Slice 3/4) und `task-skeleton.ts` (Slice 5).
 *
 * Quelle: die geteilten MCP-Server sind bereits als CRDT-`Capability` mit `category='mcp'` /
 * `skill_id='mcp:<server>'` modelliert (`mcp-service-registry.ts`, `buildMcpCapability`). Diese Sicht
 * filtert `registry.getAllCapabilities()` auf genau diese Einträge und dedupliziert pro Server über
 * Provider — dasselbe Muster/dieselbe Quelle wie `list_capabilities_overview`, nur auf die MCP-Teilmenge
 * spezialisiert und um die für Werkzeuge entscheidende **execution_tier** (self/gate/consensus) ergänzt.
 * Details bleiben auf Abruf über das unveränderte `GET /api/capabilities?category=mcp` bzw.
 * `query_capabilities`.
 *
 * Siehe docs/architecture/TL-21-skeleton-disclosure.md §4 (Slice 6).
 */

import type { Capability, CapabilityHealth } from './registry.js';
import { firstSentence } from './capability-skeleton.js';
import {
  MCP_CATEGORY,
  MCP_SKILL_PREFIX,
  canonicalizeServerName,
  deriveExecutionTier,
  maxTier,
  type McpExecutionTier,
} from './mcp-service-registry.js';

/** Ein Skelett-Eintrag: das Minimum für die Erst-Orientierung „welche MCP-Server kann ich rufen?". */
export interface ToolSkeletonEntry {
  /** Kanonischer MCP-Servername (`skill_id` ohne `mcp:`-Präfix), z.B. `unifi`. */
  server: string;
  /** Erster Satz der `description` des gesund-bevorzugten Providers (kompakt). */
  summary: string;
  /**
   * Konservative Ausführungsstufe: die **restriktivste** Stufe (`self`<`gate`<`consensus`) über ALLE
   * Provider dieses Servers. Konservativ, damit die Übersicht eine Stufe nie **unter**-behauptet
   * (ein Agent hält sie nie fälschlich für billiger/sicherer als der tatsächlich geroutete Provider).
   */
  execution_tier: McpExecutionTier;
  /** Anzahl der diesen Server anbietenden Agenten. */
  providers: number;
  /** Aggregiert: `healthy`, wenn ≥1 Provider healthy; sonst `degraded`, wenn ≥1 degraded; sonst `offline`. */
  health: CapabilityHealth;
}

/**
 * Total-fail-safe String-Sicht auf runtime-untypisierte CRDT-Felder (analog `capability-skeleton.asStr`):
 * `Capability` ist typisiert `string`, aber die Wire-/Registry-Herkunft ist untyped. Ein geschmiedeter
 * Nicht-String würde `.startsWith`/`.slice`/Comparator/Map-Key sprengen → deterministisch auf `''`.
 */
const asStr = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Rangfolge für die „gesund-bevorzugte" Provider-Wahl (kleiner = bevorzugt). */
const HEALTH_RANK: Record<CapabilityHealth, number> = { healthy: 0, degraded: 1, offline: 2 };
/** Defensiv: unbekannter (malformed/forged) Health-Wert rankt hinter `offline` — kein NaN-Comparator. */
const healthRank = (h: CapabilityHealth): number => HEALTH_RANK[h] ?? 3;
/** Fixe, locale-unabhängige String-Ordnung (Cross-Host-Determinismus, analog Geschwister-Skelette). */
const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Ausführungsstufe **eines** Providers — total gegen malformed CRDT-`permissions` UND **fail-closed**
 * (CR-MEDIUM): `deriveExecutionTier` iteriert `permissions` und ruft `.toLowerCase()` je Token — ein
 * non-array/non-string-Element würde werfen. Naiv auf `[]` zu normalisieren wäre **fail-open**: ein
 * geforgtes/legacy `permissions: 'delete'` (String statt Array, trust≥Schwelle) ergäbe fälschlich `self`,
 * während der reale Routing-Pfad `resolveMcp` denselben String Zeichen-für-Zeichen iteriert (alles
 * unbekannte Tokens) → `gate`. Damit die Übersicht die Stufe **nie unter-behauptet** (und nicht von
 * `resolveMcp` abweicht), wird bei malformed `permissions` auf mindestens `gate` gebodet:
 * - kein Array → `gate` (mirror `resolveMcp`).
 * - Array mit verworfenen non-string-Elementen → `gate` geboden (ein verworfenes Element hätte ein
 *   höher-stufiges Token sein können).
 * - sauberes `string[]` → exakt `deriveExecutionTier` (selbst fail-closed: unbekanntes Token /
 *   non-finite trust → `gate`).
 */
function providerTier(cap: Capability): McpExecutionTier {
  const raw = (cap as { permissions?: unknown }).permissions;
  const trust = (cap as { trust_level?: unknown }).trust_level as number;
  if (!Array.isArray(raw)) return maxTier('gate', deriveExecutionTier([], trust));
  const strings = raw.filter((x): x is string => typeof x === 'string');
  const base = deriveExecutionTier(strings, trust);
  return strings.length === raw.length ? base : maxTier('gate', base);
}

/**
 * Erkennt einen MCP-Service-Eintrag **total** (spiegelt `isMcpCapability`, aber fail-safe gegen non-string
 * CRDT-`skill_id`/`category`): `category==='mcp'` UND `skill_id` mit `mcp:`-Präfix. `isMcpCapability`
 * selbst ruft `skill_id.startsWith` auf dem rohen Feld → würde bei geschmiedetem non-string werfen; diese
 * additive Read-View darf das nicht.
 */
function isMcpCap(skillId: string, category: string): boolean {
  return category === MCP_CATEGORY && skillId.startsWith(MCP_SKILL_PREFIX);
}

/**
 * Baut die deduplizierte MCP-Server-Skelett-Übersicht: ein Eintrag pro kanonischem Server, sortiert nach
 * `server`. `summary` stammt vom gesund-bevorzugten Provider (Health-Rang, dann lexikografisch `agent_id`);
 * `execution_tier` ist die restriktivste Stufe über alle Provider (`maxTier`); `health` ist aggregiert.
 * Rein, deterministisch (kein Date/Random).
 *
 * **Total gegen malformed CRDT-Daten:** non-string `skill_id`/`category`/`agent_id`/`description`/
 * `permissions` werden normalisiert; ein Eintrag ohne verwertbaren Servernamen (Grouping-Key) wird
 * übersprungen — die additive Read-View bleibt bounded, kein 500er (Härtungs-Klasse wie #281/#303).
 */
export function buildToolSkeleton(capabilities: Capability[]): ToolSkeletonEntry[] {
  const byServer = new Map<string, Capability[]>();
  for (const c of capabilities) {
    const skillId = asStr((c as { skill_id?: unknown }).skill_id);
    const category = asStr((c as { category?: unknown }).category);
    if (!isMcpCap(skillId, category)) continue;
    // Servername = skill_id ohne `mcp:`-Präfix, kanonisiert (idempotent; Build/Resolve nutzen dasselbe).
    const server = canonicalizeServerName(skillId.slice(MCP_SKILL_PREFIX.length));
    if (server === '') continue; // `mcp:` ohne Server → kein Grouping-Key → skip (bounded)
    const list = byServer.get(server);
    if (list) list.push(c);
    else byServer.set(server, [c]);
  }

  const entries: ToolSkeletonEntry[] = [];
  for (const [server, providers] of byServer) {
    const preferred = [...providers].sort(
      (a, b) =>
        healthRank(a.health) - healthRank(b.health) ||
        cmpStr(
          asStr((a as { agent_id?: unknown }).agent_id),
          asStr((b as { agent_id?: unknown }).agent_id),
        ),
    )[0];
    const health: CapabilityHealth = providers.some((p) => p.health === 'healthy')
      ? 'healthy'
      : providers.some((p) => p.health === 'degraded')
        ? 'degraded'
        : 'offline';
    // Konservativ: die restriktivste Stufe über ALLE Provider (kein Under-claim). `providerTier` ist
    // total UND fail-closed (malformed `permissions` → mind. `gate`, spiegelt `resolveMcp`).
    const execution_tier = providers.reduce<McpExecutionTier>(
      (acc, p) => maxTier(acc, providerTier(p)),
      'self',
    );
    entries.push({
      server,
      summary: firstSentence(preferred.description),
      execution_tier,
      providers: providers.length,
      health,
    });
  }

  return entries.sort((a, b) => cmpStr(a.server, b.server));
}

/** Envelope der MCP-Tool-Skelett-Übersicht (`{ tools, count }`). Kein I/O, deterministisch. */
export interface ToolOverview {
  tools: ToolSkeletonEntry[];
  count: number;
}

/**
 * EINE Quelle der Wahrheit für die TL-21-Tool-Übersicht-Nutzlast — analog `buildCapabilityOverview`.
 * Von REST `GET /api/tools/overview` UND MCP-Tool `list_tools_overview` benutzt (same-source
 * `registry.getAllCapabilities()`) → strukturelle Parität statt Drift. `count` ist immer `tools.length`.
 */
export function buildToolOverview(capabilities: Capability[]): ToolOverview {
  const tools = buildToolSkeleton(capabilities);
  return { tools, count: tools.length };
}
