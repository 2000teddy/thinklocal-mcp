/**
 * task-router.ts — Intelligentes Task-Routing basierend auf Capability-Matching
 *
 * Routet Task-Requests automatisch zum besten verfuegbaren Peer:
 * 1. Exakter Skill-Match: Suche Peer der den angeforderten Skill hat
 * 2. Prefix-Match: "influxdb" matcht "influxdb.query", "influxdb.write" etc.
 * 3. Health-basiert: Bevorzuge gesunde Peers (healthy > degraded > offline)
 * 4. Load-basiert: Bevorzuge Peers mit niedrigerer CPU-Last
 * 5. Lokal-bevorzugt: Lokaler Skill hat Vorrang vor Remote
 */

import type { Capability } from './registry.js';
import type { Logger } from 'pino';

export interface RoutableAgent {
  agentId: string;
  host: string;
  port: number;
  endpoint: string;
  cpuPercent?: number;
  isLocal: boolean;
}

export interface RouteResult {
  /** Gewaehlter Agent */
  agent: RoutableAgent;
  /** Gematchte Capability */
  capability: Capability;
  /** Routing-Grund */
  reason: string;
  /** Alle Kandidaten (sortiert nach Score) */
  candidates: Array<{ agent: RoutableAgent; capability: Capability; score: number }>;
}

/**
 * Routet einen Task-Request zum besten verfuegbaren Peer.
 */
export class TaskRouter {
  constructor(private log?: Logger) {}

  /**
   * Findet den besten Peer fuer einen Skill.
   * Gibt null zurueck wenn kein Peer den Skill hat.
   */
  route(
    skillId: string,
    capabilities: Capability[],
    agents: Map<string, RoutableAgent>,
    localAgentId: string,
  ): RouteResult | null {
    // 1. Alle Capabilities finden die matchen
    const matches = capabilities.filter(
      (c) => c.skill_id === skillId || c.skill_id.startsWith(`${skillId}.`) || skillId.startsWith(`${c.skill_id}.`),
    );

    if (matches.length === 0) {
      this.log?.debug({ skillId }, 'Task-Routing: Kein Peer mit passendem Skill gefunden');
      return null;
    }

    // 2. Score berechnen fuer jeden Kandidaten
    const scored = matches
      .map((cap) => {
        const agent = agents.get(cap.agent_id);
        if (!agent) return null;

        let score = 0;

        // Exakter Match bevorzugt
        if (cap.skill_id === skillId) score += 100;
        // Prefix-Match
        else score += 50;

        // Health-Score
        if (cap.health === 'healthy') score += 30;
        else if (cap.health === 'degraded') score += 10;
        // offline = 0

        // Lokal bevorzugt
        if (cap.agent_id === localAgentId) score += 20;

        // CPU-Last (niedrig = besser, max 10 Punkte)
        if (agent.cpuPercent !== undefined) {
          score += Math.max(0, 10 - Math.floor(agent.cpuPercent / 10));
        }

        return { agent, capability: cap, score };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) return null;

    // Tiebreak: Bei gleichem Score zufaellig waehlen (bessere Lastverteilung)
    const topScore = scored[0].score;
    const topCandidates = scored.filter((c) => c.score === topScore);
    const best = topCandidates[Math.floor(Math.random() * topCandidates.length)];
    const reason = best.agent.isLocal
      ? `Lokal (${best.capability.skill_id}, Score: ${best.score})`
      : `Remote ${best.agent.host}:${best.agent.port} (${best.capability.skill_id}, Score: ${best.score})`;

    this.log?.info(
      { skillId, chosen: best.agent.agentId, score: best.score, candidates: scored.length },
      'Task-Routing: Bester Peer gewaehlt',
    );

    return {
      agent: best.agent,
      capability: best.capability,
      reason,
      candidates: scored,
    };
  }
}
