/**
 * coordinator.ts — Einfache Coordinator-Node-Wahl
 *
 * Der aelteste Node im Mesh (basierend auf joined_at) wird automatisch
 * zum Coordinator. Kein Raft/Paxos noetig fuer unser Szenario.
 *
 * Der Coordinator hat keine speziellen Privilegien — er dient nur als
 * Referenzpunkt fuer koordinierte Aktionen (z.B. Skill-Verbreitung).
 */

import type { Logger } from 'pino';

export interface CoordinatorCandidate {
  agentId: string;
  joinedAt: string; // ISO 8601
  isLocal: boolean;
}

export interface CoordinatorState {
  /** Aktueller Coordinator (null wenn allein im Mesh) */
  coordinatorId: string | null;
  /** Bin ich der Coordinator? */
  isCoordinator: boolean;
  /** Seit wann (ISO 8601) */
  since: string;
}

/**
 * Bestimmt den Coordinator basierend auf dem aeltesten joined_at.
 * Bei Gleichstand gewinnt die lexikographisch kleinste agentId.
 */
export class CoordinatorElection {
  private currentCoordinator: string | null = null;
  private localAgentId: string;
  private localJoinedAt: string;

  constructor(
    localAgentId: string,
    localJoinedAt: string,
    private log?: Logger,
  ) {
    this.localAgentId = localAgentId;
    this.localJoinedAt = localJoinedAt;
    this.currentCoordinator = localAgentId; // Allein = selbst Coordinator
  }

  /**
   * Aktualisiert die Coordinator-Wahl basierend auf allen bekannten Peers.
   */
  elect(candidates: CoordinatorCandidate[]): CoordinatorState {
    const all: CoordinatorCandidate[] = [
      { agentId: this.localAgentId, joinedAt: this.localJoinedAt, isLocal: true },
      ...candidates,
    ];

    // Sortiere nach joinedAt (aeltester zuerst), bei Gleichstand nach agentId
    all.sort((a, b) => {
      const timeCompare = a.joinedAt.localeCompare(b.joinedAt);
      if (timeCompare !== 0) return timeCompare;
      return a.agentId.localeCompare(b.agentId);
    });

    const newCoordinator = all[0].agentId;

    if (newCoordinator !== this.currentCoordinator) {
      this.log?.info(
        { previous: this.currentCoordinator, new: newCoordinator },
        'Coordinator gewechselt',
      );
      this.currentCoordinator = newCoordinator;
    }

    return {
      coordinatorId: this.currentCoordinator,
      isCoordinator: this.currentCoordinator === this.localAgentId,
      since: all[0].joinedAt,
    };
  }

  /** Gibt den aktuellen Coordinator zurueck */
  getState(): CoordinatorState {
    return {
      coordinatorId: this.currentCoordinator,
      isCoordinator: this.currentCoordinator === this.localAgentId,
      since: this.localJoinedAt,
    };
  }
}
