// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * mcp-routing.ts — ADR-028 D4-b (Routing-Entscheidung): bestimmt rein, WIE ein
 * MCP-Aufruf bedient wird — lokal (eigener Node serviert via mcporter), remote
 * (Forward an einen Peer über mTLS) oder gar nicht (kein Provider).
 *
 * Reine Funktion (kein I/O, kein Netz/mTLS/mcporter, kein Endpoint) → unit-testbar.
 * Der spätere Daemon-MCP-Proxy-Ingress (`/api/mcp/<server>`) ruft `resolveMcp`
 * (mcp-service-registry) → `planMcpRoute` → und führt den Plan dann aus (lokaler
 * mcporter-Call ODER mTLS-Forward mit D2-Server-Identity + D3-Sender-Binding).
 * Diese Datei trifft NUR die Entscheidung, sie führt NICHTS aus.
 *
 * Auswahl-Politik (Discovery default-open, Multi-Provider):
 *  - **self bevorzugt:** ist der eigene Node ein (nicht-offline) Provider → lokal.
 *  - sonst der „beste" Remote-Provider: `healthy` vor `degraded` (deterministisch
 *    der erste passende); `offline` wird defensiv übersprungen (resolveMcp filtert
 *    es zwar schon, aber der Planner bleibt robust).
 *  - kein nutzbarer Provider → `none` (kein Fehler; der Aufrufer entscheidet).
 */
import type { McpResolution, McpExecutionTier } from './mcp-service-registry.js';
import { MCP_SKILL_PREFIX, canonicalizeServerName } from './mcp-service-registry.js';

export type McpRoutePlan =
  | { mode: 'local'; server: string; execution_tier: McpExecutionTier }
  | { mode: 'remote'; server: string; target: McpResolution }
  | { mode: 'none'; server: string; reason: string };

/**
 * Entscheidet den Routing-Plan für `server` aus den (bereits server-gefilterten)
 * `resolutions` (Output von `resolveMcp`) + der eigenen SPIFFE-Identität. Rein.
 */
export function planMcpRoute(
  server: string,
  resolutions: readonly McpResolution[],
  selfAgentId: string,
): McpRoutePlan {
  // CR-MEDIUM (gpt-5.3-codex): defensiv NUR Resolutions für genau diesen Server
  // (kanonisiert wie resolveMcp) berücksichtigen — eine fehlverdrahtete Aufrufer-
  // Liste darf nicht versehentlich auf einen FALSCHEN MCP routen (fail-closed).
  const expectedSkillId = `${MCP_SKILL_PREFIX}${canonicalizeServerName(server)}`;
  const usable = resolutions.filter((r) => r.skill_id === expectedSkillId && r.health !== 'offline');

  // self bevorzugt (eigener MCP-Prozess, kein Forward nötig).
  const own = usable.find((r) => r.agent_id === selfAgentId);
  if (own) {
    return { mode: 'local', server, execution_tier: own.execution_tier };
  }

  if (usable.length === 0) {
    const forServer = resolutions.some((r) => r.skill_id === expectedSkillId);
    return {
      mode: 'none',
      server,
      reason: forServer ? 'kein nutzbarer Provider (alle offline)' : 'kein Provider registriert',
    };
  }

  // Bester Remote-Provider: healthy vor degraded, sonst der erste nutzbare.
  const target = usable.find((r) => r.health === 'healthy') ?? usable[0];
  if (!target) {
    // Unerreichbar (usable.length>0 oben geprüft); fail-closed, ohne non-null-Assertion.
    return { mode: 'none', server, reason: 'kein nutzbarer Provider' };
  }
  return { mode: 'remote', server, target };
}
