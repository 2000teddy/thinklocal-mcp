import { fetch, type Dispatcher } from 'undici';
import type { Logger } from 'pino';
import type { DiscoveredPeer } from './discovery.js';
import type { AgentCard } from './agent-card.js';
import { spiffeUriToPeerId } from './peer-identity.js';

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

  /**
   * ADR-022: tolerante Auflösung des Signatur-Public-Keys eines Absenders.
   * Behebt Root-Cause (a) des SKILL_ANNOUNCE-403 „Unknown sender": der Sender
   * wird über die KANONISCHE PeerID aufgelöst, nicht nur über die exakte
   * (evtl. driftende) SPIFFE-URI. Reihenfolge (von stark → schwach gebunden):
   *   1. exakter Map-Treffer (Discovery-`agentId`), card-backed,
   *   2. exakter Card-`spiffeUri`-Treffer (falls Discovery-Key ≠ Card-URI),
   *   3. kanonische PeerID (`spiffe://thinklocal/node/<PeerID>`) gegen `libp2p.peerId`
   *      — FAIL-CLOSED: nur bei GENAU EINEM Treffer, sonst `undefined`.
   *
   * Speist sich ausschließlich aus VERIFIZIERTEN Agent-Cards (publicKey gesetzt),
   * nie aus OS-/Hostname-Quellen. Die Signaturprüfung des Envelopes erfolgt
   * downstream gegen den zurückgegebenen Key → ein Fehlgriff degradiert zu 403,
   * nicht zu einer akzeptierten Fälschung.
   *
   * SICHERHEITS-NOTE (CR gpt-5.3-codex, HIGH): `libp2p.peerId` stammt derzeit aus
   * dem mDNS-TXT (`discovered.p2pPeerId`) und ist NICHT kryptografisch an die Card
   * gebunden. Der PeerID-Fallback (3) ist deshalb bewusst fail-closed und nur eine
   * Übergangsbrücke, bis cert-SAN=PeerID (ADR-022 Item 0/3) die echte Bindung über
   * den mTLS-/Noise-Pfad liefert. Bis dahin sind die exakten Card-Treffer (1/2) die
   * stark gebundenen Pfade.
   */
  resolvePeerPublicKey(senderUri: string): string | undefined {
    // 1. exakter Discovery-Key
    const direct = this.peers.get(senderUri);
    if (direct?.agentCard?.publicKey) return direct.agentCard.publicKey;

    // 2. exakter Card-spiffeUri-Treffer
    for (const peer of this.peers.values()) {
      if (peer.agentCard?.publicKey && peer.agentCard.spiffeUri === senderUri) {
        return peer.agentCard.publicKey;
      }
    }

    // 3. kanonischer PeerID-Fallback — fail-closed bei 0 oder >1 Treffern
    const wantPeerId = spiffeUriToPeerId(senderUri);
    if (!wantPeerId) return undefined;
    const matches: string[] = [];
    for (const peer of this.peers.values()) {
      if (peer.agentCard?.publicKey && peer.libp2p.peerId === wantPeerId) {
        matches.push(peer.agentCard.publicKey);
      }
    }
    return matches.length === 1 ? matches[0] : undefined;
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
