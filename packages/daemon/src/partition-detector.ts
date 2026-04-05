/**
 * partition-detector.ts — Netzwerk-Partition-Erkennung
 *
 * Erkennt Split-Brain-Situationen im Mesh:
 * - Wenn ein Node ploetzlich viele Peers verliert → moeglicherweise Partition
 * - Wenn ein Node keine Peers mehr hat → isoliert
 * - Bei Reconnection nach Partition → graceful Rejoin mit Registry-Merge
 *
 * CRDTs (Automerge) handeln Eventual Consistency automatisch,
 * aber aktive Tasks koennen bei Partitions dupliziert oder timeout werden.
 */

import type { Logger } from 'pino';

export type PartitionState = 'healthy' | 'degraded' | 'partitioned' | 'isolated';

export interface PartitionStatus {
  state: PartitionState;
  connectedPeers: number;
  expectedPeers: number;
  lostPeers: string[];
  partitionDetectedAt?: string;
  reconnectedAt?: string;
}

export class PartitionDetector {
  private expectedPeers = new Set<string>();
  private currentPeers = new Set<string>();
  private lostPeers = new Set<string>();
  private state: PartitionState = 'healthy';
  private partitionDetectedAt?: string;
  private reconnectedAt?: string;

  constructor(
    private partitionThreshold = 0.5, // >50% Peers verloren = Partition
    private log?: Logger,
  ) {}

  /** Registriert einen bekannten Peer (beim Join) */
  addKnownPeer(agentId: string): void {
    this.expectedPeers.add(agentId);
    this.currentPeers.add(agentId);
    this.lostPeers.delete(agentId);
    this.evaluateState();
  }

  /** Markiert einen Peer als verloren (bei Heartbeat-Timeout) */
  peerLost(agentId: string): void {
    this.currentPeers.delete(agentId);
    this.lostPeers.add(agentId);
    this.evaluateState();
  }

  /** Markiert einen Peer als wiederverbunden */
  peerReconnected(agentId: string): void {
    this.currentPeers.add(agentId);
    this.lostPeers.delete(agentId);

    if (this.state === 'partitioned' || this.state === 'isolated') {
      this.reconnectedAt = new Date().toISOString();
      this.log?.info({ agentId, state: this.state }, 'Partition-Recovery: Peer reconnected');
    }

    this.evaluateState();
  }

  /** Gibt den aktuellen Partition-Status zurueck */
  getStatus(): PartitionStatus {
    return {
      state: this.state,
      connectedPeers: this.currentPeers.size,
      expectedPeers: this.expectedPeers.size,
      lostPeers: [...this.lostPeers],
      partitionDetectedAt: this.partitionDetectedAt,
      reconnectedAt: this.reconnectedAt,
    };
  }

  /** Evaluiert den Zustand basierend auf Peer-Verlusten */
  private evaluateState(): void {
    const expected = this.expectedPeers.size;
    const connected = this.currentPeers.size;
    const previousState = this.state;

    if (expected === 0 || connected === expected) {
      this.state = 'healthy';
    } else if (connected === 0) {
      this.state = 'isolated';
    } else {
      const lostRatio = (expected - connected) / expected;
      this.state = lostRatio >= this.partitionThreshold ? 'partitioned' : 'degraded';
    }

    // State-Wechsel loggen
    if (previousState !== this.state) {
      if (this.state === 'partitioned' || this.state === 'isolated') {
        this.partitionDetectedAt = new Date().toISOString();
        this.log?.warn(
          { state: this.state, connected, expected, lost: this.lostPeers.size },
          'Netzwerk-Partition erkannt!',
        );
      } else if (previousState === 'partitioned' || previousState === 'isolated') {
        this.log?.info(
          { state: this.state, connected, expected },
          'Netzwerk-Partition aufgeloest',
        );
      }
    }
  }
}
