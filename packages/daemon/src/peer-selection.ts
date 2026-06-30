/**
 * peer-selection.ts — T2.4-Folge: least-loaded-Routing-Auswahl.
 *
 * Wenn mehrere fähige Peers denselben Skill anbieten, wählt der Anfrager den
 * am wenigsten ausgelasteten — anhand der über die Agent-Card exponierten
 * Resource-Attribute (#218: `ram_used_percent`, `cpu_load`, `agent_count`).
 *
 * Reine Funktion (kein I/O), damit die Auswahllogik isoliert testbar ist; das
 * Einsammeln der Resource-Daten (via /api/peers) macht der Aufrufer (mcp-stdio).
 *
 * FAIL-OPEN: liegen für KEINEN Kandidaten Resource-Daten vor, fällt die Auswahl
 * auf den ersten Kandidaten zurück — also exakt das bisherige Verhalten
 * (`candidates[0]`). Ein Kandidat ohne Daten wird nur als Fallback gewählt.
 */

/** Auslastungs-Snapshot eines Peers (Teilmenge des Agent-Card-`resources`-Blocks). */
export interface PeerLoad {
  ram_used_percent: number;
  cpu_load: number;
  agent_count: number;
}

export interface LeastLoadedResult {
  agentId: string;
  /** Menschliche Begründung für Log/Audit. */
  reason: string;
  /** true, wenn anhand echter Resource-Daten gewählt wurde (sonst fail-open-Fallback). */
  byLoad: boolean;
}

/** Peer-Eintrag aus /api/peers, soweit für die Last-Auswahl relevant. */
export interface PeerEntry {
  agent_id: string;
  agent_card?: { resources?: Partial<PeerLoad> | null } | null;
}

/**
 * Baut die Last-Map aus /api/peers — **defensiv** (Zero-Trust-LAN, CR-MEDIUM): ein
 * Peer-Resource-Block zählt nur, wenn ALLE drei Felder endliche Zahlen sind. Fehlende
 * oder fehlerhafte (null/NaN/string) Werte → der Peer gilt als „keine Daten" und wird
 * in der Auswahl übersprungen, statt mit `NaN` den Vergleich zu vergiften.
 */
export function buildLoadMap(peers: PeerEntry[]): Record<string, PeerLoad> {
  const map: Record<string, PeerLoad> = {};
  for (const p of peers) {
    const r = p.agent_card?.resources;
    if (
      r &&
      Number.isFinite(r.ram_used_percent) &&
      Number.isFinite(r.cpu_load) &&
      Number.isFinite(r.agent_count)
    ) {
      map[p.agent_id] = {
        ram_used_percent: r.ram_used_percent as number,
        cpu_load: r.cpu_load as number,
        agent_count: r.agent_count as number,
      };
    }
  }
  return map;
}

/**
 * Lexikografischer Last-Vergleich: zuerst RAM, dann CPU, dann agent_count
 * (jeweils „weniger = besser"). Liefert <0, wenn `a` weniger ausgelastet ist.
 */
export function compareLoad(a: PeerLoad, b: PeerLoad): number {
  if (a.ram_used_percent !== b.ram_used_percent) return a.ram_used_percent - b.ram_used_percent;
  if (a.cpu_load !== b.cpu_load) return a.cpu_load - b.cpu_load;
  return a.agent_count - b.agent_count;
}

/**
 * Vollständige Ziel-Auswahl für `execute_remote_skill` (testbar, ohne I/O):
 * - explizites `target` → dieses, sofern es ein Kandidat ist (sonst null = „hat Skill nicht").
 * - sonst least-loaded unter allen Kandidaten, wobei der lokale Knoten (`self`, aus
 *   /api/status — steht nicht in /api/peers) als zusätzlicher Eintrag fair mitkonkurriert.
 *
 * Fail-open erbt von {@link pickLeastLoaded}: ohne Resource-Daten → erster Kandidat.
 */
export function chooseTargetAgent(
  candidateAgentIds: string[],
  peers: PeerEntry[],
  self: PeerEntry | null,
  explicitTarget?: string,
): LeastLoadedResult | null {
  if (explicitTarget) {
    return candidateAgentIds.includes(explicitTarget)
      ? { agentId: explicitTarget, reason: 'explizit (target_agent)', byLoad: false }
      : null;
  }
  const loadByAgent = buildLoadMap(self ? [...peers, self] : peers);
  return pickLeastLoaded(candidateAgentIds, loadByAgent);
}

/**
 * Wählt unter den fähigen Kandidaten den am wenigsten ausgelasteten Peer.
 *
 * @param candidateAgentIds Reihenfolge wie vom Aufrufer geliefert (bei Gleichstand
 *   gewinnt der frühere → deterministisch + back-compat zu `candidates[0]`).
 * @param loadByAgent agent_id → Last-Snapshot (undefined = keine Daten für diesen Peer).
 */
export function pickLeastLoaded(
  candidateAgentIds: string[],
  loadByAgent: Record<string, PeerLoad | undefined>,
): LeastLoadedResult {
  if (candidateAgentIds.length === 0) {
    throw new Error('pickLeastLoaded: keine Kandidaten');
  }
  const withData = candidateAgentIds.filter((id) => loadByAgent[id] !== undefined);
  if (withData.length === 0) {
    return {
      agentId: candidateAgentIds[0],
      reason: 'keine Resource-Daten — erster Kandidat (fail-open)',
      byLoad: false,
    };
  }
  // Min-Last; bei Gleichstand bleibt der frühere Kandidat (compareLoad <= 0 → behalten).
  const best = withData.reduce((a, b) =>
    compareLoad(loadByAgent[a] as PeerLoad, loadByAgent[b] as PeerLoad) <= 0 ? a : b,
  );
  const l = loadByAgent[best] as PeerLoad;
  return {
    agentId: best,
    reason: `least-loaded (RAM ${l.ram_used_percent}%, CPU ${l.cpu_load}%, agents ${l.agent_count})`,
    byLoad: true,
  };
}
