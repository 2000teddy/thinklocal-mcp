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
    /**
     * SECURITY (ADR-022, CR gpt-5.5 HIGH 1): true NUR wenn `peerId` über einen
     * KRYPTOGRAFISCHEN Pfad bestätigt wurde (mTLS cert-SAN=node/<PeerID> oder
     * libp2p-Noise-RemotePeer) — NIE aus mDNS-TXT oder einem Agent-Card-Feld.
     * Nur dann darf `peerId` in resolvePeerPublicKey als Identitätsschlüssel zählen.
     * Aktuell existiert noch kein solcher Krypto-Pfad → bleibt false (Fallback faktisch aus).
     */
    peerIdVerified: boolean;
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
        peerIdVerified: false, // mDNS-Quelle ist NICHT kryptografisch bestätigt (HIGH 1)
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
      const newPeerId = card.mesh.libp2p?.peer_id ?? peer.libp2p.peerId;
      if (newPeerId !== peer.libp2p.peerId) {
        // SECURITY (CR gpt-5.5 MEDIUM): Ein PeerID-Wechsel aus (unauthentifizierten)
        // Card-Daten invalidiert eine evtl. frühere Krypto-Verifikation — sonst bliebe
        // peerIdVerified stale und gälte für einen anderen PeerID-Wert.
        peer.libp2p.peerIdVerified = false;
      }
      peer.libp2p.peerId = newPeerId;
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
   * ADR-022: Auflösung des Signatur-Public-Keys eines Absenders, mit harter
   * Trennung zwischen kanonischen und Legacy-Identitäten (CR gpt-5.5 HIGH 1).
   *
   * Reihenfolge (PeerID ZUERST — die Trennung ist sicherheitskritisch):
   *   1. Kanonische `spiffe://thinklocal/node/<PeerID>`-URI → NUR über eine
   *      KRYPTOGRAFISCH VERIFIZIERTE PeerID-Bindung (`peer.libp2p.peerIdVerified`
   *      === true UND eindeutiger `peerId`-Match). NIEMALS über die exakten Treffer.
   *   2./3. Nur für NICHT-kanonische (Legacy `host/<id>`) URIs: exakter Discovery-
   *      `agentId`-Treffer, dann exakter Card-`spiffeUri`-Treffer.
   *
   * Speist sich ausschließlich aus VERIFIZIERTEN Agent-Cards (publicKey gesetzt),
   * nie aus OS-/Hostname-Quellen. Die Signaturprüfung des Envelopes erfolgt zudem
   * downstream gegen den zurückgegebenen Key.
   *
   * WARUM PeerID-first + verified-only: `libp2p.peerId` stammt aus unauthentifiziertem
   * mDNS-TXT / Card-Feld. Ließe man kanonische node/<PeerID>-URIs über die exakten
   * Treffer (1/2) zu, könnte ein Angreifer via mDNS `agent-id = node/<victimPeerId>`
   * (+ eigene verifizierte Card/Key) eine fremde Identität bedienen. `peerIdVerified`
   * wird nur aus einem echten Krypto-Pfad gesetzt (mTLS cert-SAN=node/<PeerID> /
   * Noise-RemotePeer) — der existiert vor dem Cert-Cutover noch nicht, daher löst aktuell
   * KEINE kanonische node/<PeerID>-URI auf (forward-compatible, fail-closed).
   */
  resolvePeerPublicKey(senderUri: string): string | undefined {
    // SECURITY (CR gpt-5.5 HIGH 1, vollständig): Kanonische node/<PeerID>-Sender-URIs
    // dürfen AUSSCHLIESSLICH über eine KRYPTOGRAFISCH VERIFIZIERTE PeerID-Bindung
    // auflösen — NIEMALS über die exakten Treffer (agentId / card.spiffeUri). Deren Werte
    // stammen aus unauthentifiziertem mDNS-TXT / Card-Feld: ein Angreifer könnte via mDNS
    // `agent-id = node/<victimPeerId>` (+ eigene verifizierte Card/Key) eine fremde
    // Identität bedienen (Signaturprüfung bestätigt nur SEINEN Key). `peerIdVerified` wird
    // nur aus einem echten Krypto-Pfad (mTLS cert-SAN=node/<PeerID> / Noise-RemotePeer)
    // gesetzt — solange der nicht existiert (vor dem Cert-Cutover) ist dieser Pfad AUS.
    const wantPeerId = spiffeUriToPeerId(senderUri);
    if (wantPeerId) {
      const matches: string[] = [];
      for (const peer of this.peers.values()) {
        if (
          peer.agentCard?.publicKey &&
          peer.libp2p.peerIdVerified &&
          peer.libp2p.peerId === wantPeerId
        ) {
          matches.push(peer.agentCard.publicKey);
        }
      }
      return matches.length === 1 ? matches[0] : undefined;
    }

    // Nicht-kanonische (Legacy host/<id>) Sender-URIs: card-backed exakte Treffer.
    // 1. exakter Discovery-Key (agentId).
    const direct = this.peers.get(senderUri);
    if (direct?.agentCard?.publicKey) return direct.agentCard.publicKey;
    // 2. exakter Card-spiffeUri-Treffer (falls Discovery-Key ≠ Card-URI).
    for (const peer of this.peers.values()) {
      if (peer.agentCard?.publicKey && peer.agentCard.spiffeUri === senderUri) {
        return peer.agentCard.publicKey;
      }
    }
    return undefined;
  }

  /**
   * ADR-022 Schritt 3 (channel-bound): markiert die PeerID als kryptografisch
   * VERIFIZIERT — NUR aus einem echten Krypto-Pfad aufrufen (CA-validierter
   * mTLS-Cert-SAN `node/<PeerID>` oder libp2p-Noise-RemotePeer), NIE aus mDNS/Card.
   * Schaltet damit die kanonische PeerID-Auflösung für diesen Peer frei.
   * Liefert true, wenn ein passender Peer gefunden+markiert wurde.
   */
  markPeerIdVerified(peerId: string): boolean {
    // CR gpt-5.5 MEDIUM: nur bei EINDEUTIGEM Treffer markieren. Mehrere Peers mit
    // derselben PeerID (z.B. via mDNS-Spoofing) sind ambig → nicht markieren (sonst
    // Ambiguitäts-/Availability-Risiko), warnen.
    const matches = [...this.peers.values()].filter((p) => p.libp2p.peerId === peerId);
    if (matches.length !== 1) {
      if (matches.length > 1) {
        // CR gpt-5.5 WS-2 MEDIUM: Ein LAN-Angreifer kann per mDNS denselben p2pPeerId wie
        // ein legitimer Peer annoncieren → matches>1 → die echte Attestierung wird (fail-closed)
        // nicht markiert. Kein Sicherheits-, aber ein Availability-Risiko für den Cutover.
        // Detail-Logging, damit der Konflikt operativ sichtbar + bereinigbar ist.
        this.log?.warn(
          { peerId, matches: matches.map((p) => ({ agentId: p.agentId, host: p.host, endpoint: p.endpoint })) },
          'PeerID-Verifikation nicht eindeutig (mDNS-Duplikat?) — nicht markiert',
        );
      }
      return false;
    }
    matches[0].libp2p.peerIdVerified = true;
    return true;
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
