import { fetch, type Dispatcher } from 'undici';
import type { Logger } from 'pino';
import type { DiscoveredPeer } from './discovery.js';
import type { AgentCard } from './agent-card.js';

export type PeerStatus = 'online' | 'offline' | 'unknown';

export interface MeshPeer {
  name: string;
  host: string;
  port: number;
  agentId: string;
  endpoint: string;
  status: PeerStatus;
  lastSeen: number;
  missedBeats: number;
  agentCard: AgentCard | null;
  libp2p: {
    peerId: string | null;
    listenMultiaddrs: string[];
    connected: boolean;
    status: 'unavailable' | 'discovered' | 'connected';
  };
}

export interface MeshEvents {
  onPeerOnline: (peer: MeshPeer) => void;
  onPeerOffline: (peer: MeshPeer) => void;
}

export class MeshManager {
  private peers = new Map<string, MeshPeer>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private heartbeatIntervalMs: number,
    private missedBeatsThreshold: number,
    private events: MeshEvents,
    private log?: Logger,
    private dispatcher?: Dispatcher,
  ) {}

  addPeer(discovered: DiscoveredPeer): MeshPeer {
    const existing = this.peers.get(discovered.agentId);
    if (existing) {
      existing.lastSeen = Date.now();
      existing.missedBeats = 0;
      existing.status = 'online';
      return existing;
    }

    const peer: MeshPeer = {
      name: discovered.name,
      host: discovered.host,
      port: discovered.port,
      agentId: discovered.agentId,
      endpoint: discovered.endpoint,
      status: 'online',
      lastSeen: Date.now(),
      missedBeats: 0,
      agentCard: null,
      libp2p: {
        peerId: discovered.p2pPeerId ?? null,
        listenMultiaddrs: [],
        connected: false,
        status: discovered.p2pPeerId ? 'discovered' : 'unavailable',
      },
    };

    this.peers.set(discovered.agentId, peer);
    this.log?.info({ agentId: peer.agentId, host: peer.host }, 'Peer hinzugefügt');
    this.events.onPeerOnline(peer);
    return peer;
  }

  removePeer(agentId: string): void {
    const peer = this.peers.get(agentId);
    if (peer) {
      peer.status = 'offline';
      this.events.onPeerOffline(peer);
      this.peers.delete(agentId);
      this.log?.info({ agentId }, 'Peer entfernt');
    }
  }

  recordHeartbeat(agentId: string): void {
    const peer = this.peers.get(agentId);
    if (peer) {
      peer.lastSeen = Date.now();
      peer.missedBeats = 0;
      if (peer.status !== 'online') {
        peer.status = 'online';
        this.events.onPeerOnline(peer);
      }
    }
  }

  updateAgentCard(agentId: string, card: AgentCard): void {
    const peer = this.peers.get(agentId);
    if (peer) {
      peer.agentCard = card;
      peer.libp2p.peerId = card.mesh.libp2p?.peer_id ?? peer.libp2p.peerId;
      peer.libp2p.listenMultiaddrs = [...(card.mesh.libp2p?.listen_multiaddrs ?? peer.libp2p.listenMultiaddrs)];
      peer.libp2p.connected = card.mesh.libp2p?.connected_peers ? card.mesh.libp2p.connected_peers > 0 : peer.libp2p.connected;
      peer.libp2p.status = card.mesh.libp2p?.status === 'ready'
        ? (
            peer.libp2p.connected
            || (card.mesh.libp2p.multiplexer?.open_streams ?? 0) > 0
              ? 'connected'
              : 'discovered'
          )
        : peer.libp2p.status;
    }
  }

  private heartbeatInFlight = false;

  startHeartbeatLoop(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.heartbeatInFlight) return;
      this.heartbeatInFlight = true;
      void this.checkPeers()
        .catch((err) => this.log?.error({ err }, 'Heartbeat-Check fehlgeschlagen'))
        .finally(() => { this.heartbeatInFlight = false; });
    }, this.heartbeatIntervalMs);
    this.log?.info({ intervalMs: this.heartbeatIntervalMs }, 'Heartbeat-Loop gestartet');
  }

  stopHeartbeatLoop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
      this.log?.info('Heartbeat-Loop gestoppt');
    }
  }

  getOnlinePeers(): MeshPeer[] {
    return [...this.peers.values()].filter((p) => p.status === 'online');
  }

  getPeer(agentId: string): MeshPeer | undefined {
    return this.peers.get(agentId);
  }

  get peerCount(): number {
    return this.peers.size;
  }

  private async checkPeers(): Promise<void> {
    const activePeers = [...this.peers.entries()].filter(([, p]) => p.status !== 'offline');
    await Promise.allSettled(
      activePeers.map(async ([agentId, peer]) => {
        try {
          const response = await fetch(`${peer.endpoint}/health`, {
            signal: AbortSignal.timeout(5_000),
            dispatcher: this.dispatcher,
          });

          if (response.ok) {
            this.recordHeartbeat(agentId);
          } else {
            this.handleMissedBeat(agentId, peer);
          }
        } catch {
          this.handleMissedBeat(agentId, peer);
        }
      }),
    );
  }

  private handleMissedBeat(agentId: string, peer: MeshPeer): void {
    peer.missedBeats++;
    this.log?.debug({ agentId, missedBeats: peer.missedBeats }, 'Heartbeat verpasst');

    if (peer.missedBeats >= this.missedBeatsThreshold) {
      this.log?.warn({ agentId }, 'Peer als offline markiert');
      peer.status = 'offline';
      this.events.onPeerOffline(peer);
    }
  }
}
