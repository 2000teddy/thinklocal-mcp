/**
 * scoped-multicast.ts — Topic-basiertes Multicast statt Blind-Flood
 *
 * Statt alle Peers mit jeder Nachricht zu fluten, werden Nachrichten
 * nur an Peers gesendet die fuer das Thema relevant sind.
 *
 * Scopes:
 * - capability: Nur Peers die eine bestimmte Capability haben
 * - category: Nur Peers mit Skills einer bestimmten Kategorie
 * - agent-type: Nur Peers eines bestimmten Typs (claude-code, gemini-cli)
 * - all: Alle Peers (Fallback, wie bisher)
 */

import type { Capability } from './registry.js';
import type { Logger } from 'pino';

export type MulticastScope =
  | { type: 'all' }
  | { type: 'capability'; skillId: string }
  | { type: 'category'; category: string }
  | { type: 'agent-type'; agentType: string }
  | { type: 'agents'; agentIds: string[] };

export interface MulticastTarget {
  agentId: string;
  endpoint: string;
}

/**
 * Filtert Peers basierend auf einem Multicast-Scope.
 * Gibt nur die relevanten Ziel-Peers zurueck.
 */
export function resolveMulticastTargets(
  scope: MulticastScope,
  allPeers: Map<string, MulticastTarget>,
  capabilities: Capability[],
  log?: Logger,
): MulticastTarget[] {
  switch (scope.type) {
    case 'all':
      return [...allPeers.values()];

    case 'capability': {
      // Nur Peers die diesen Skill haben
      const matchingAgents = new Set(
        capabilities
          .filter((c) => c.skill_id === scope.skillId && c.health !== 'offline')
          .map((c) => c.agent_id),
      );
      const targets = [...allPeers.values()].filter((p) => matchingAgents.has(p.agentId));
      log?.debug({ scope: scope.skillId, targets: targets.length }, 'Scoped Multicast: capability');
      return targets;
    }

    case 'category': {
      const matchingAgents = new Set(
        capabilities
          .filter((c) => c.category === scope.category && c.health !== 'offline')
          .map((c) => c.agent_id),
      );
      const targets = [...allPeers.values()].filter((p) => matchingAgents.has(p.agentId));
      log?.debug({ scope: scope.category, targets: targets.length }, 'Scoped Multicast: category');
      return targets;
    }

    case 'agent-type': {
      // Agent-Type aus SPIFFE-URI extrahieren: spiffe://thinklocal/host/xxx/agent/<type>
      const targets = [...allPeers.values()].filter((p) =>
        p.agentId.endsWith(`/agent/${scope.agentType}`),
      );
      log?.debug({ scope: scope.agentType, targets: targets.length }, 'Scoped Multicast: agent-type');
      return targets;
    }

    case 'agents': {
      const agentSet = new Set(scope.agentIds);
      return [...allPeers.values()].filter((p) => agentSet.has(p.agentId));
    }

    default:
      return [...allPeers.values()];
  }
}
