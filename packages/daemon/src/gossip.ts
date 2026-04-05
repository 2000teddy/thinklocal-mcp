/**
 * gossip.ts — Gossip-basierte Registry-Synchronisation
 *
 * Synchronisiert die Capability Registry periodisch mit allen bekannten Peers.
 * Nutzt ein Pull-Push-Muster:
 * 1. Node sendet REGISTRY_SYNC mit eigenem Hash + Capabilities
 * 2. Peer vergleicht Hash, importiert neue Capabilities
 * 3. Peer antwortet mit REGISTRY_SYNC_RESPONSE + eigenen Capabilities
 * 4. Node importiert die Capabilities des Peers
 *
 * Gossip-Intervall: Alle 30 Sekunden (konfigurierbar)
 * Anti-Entropy: Bei jedem Sync wird die komplette Registry verglichen
 */

import { fetch, type Dispatcher } from 'undici';
import type { Logger } from 'pino';
import type { MeshManager, MeshPeer } from './mesh.js';
import type { CapabilityRegistry, Capability } from './registry.js';
import type { SkillManager } from './skills.js';
import {
  createEnvelope,
  encodeAndSign,
  serializeSignedMessage,
  MessageType,
  type RegistrySyncPayload,
  type RegistrySyncResponsePayload,
  type MessageEnvelope,
} from './messages.js';

export interface GossipConfig {
  /** Gossip-Intervall in Millisekunden (Default: 30s) */
  intervalMs: number;
  /** Maximale Anzahl Peers pro Gossip-Runde (Default: 3) */
  fanout: number;
}

const DEFAULT_CONFIG: GossipConfig = {
  intervalMs: 30_000,
  fanout: 3,
};

export class GossipSync {
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;
  private config: GossipConfig;

  constructor(
    private registry: CapabilityRegistry,
    private mesh: MeshManager,
    private senderSpiffeUri: string,
    private privateKeyPem: string,
    private log?: Logger,
    private dispatcher?: Dispatcher,
    config?: Partial<GossipConfig>,
    _skillManager?: SkillManager,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Startet den periodischen Gossip-Sync.
   */
  start(): void {
    this.timer = setInterval(() => {
      if (this.inFlight) return;
      this.inFlight = true;
      void this.syncRound()
        .catch((err) => this.log?.error({ err }, 'Gossip-Sync-Runde fehlgeschlagen'))
        .finally(() => { this.inFlight = false; });
    }, this.config.intervalMs);
    this.log?.info({ intervalMs: this.config.intervalMs, fanout: this.config.fanout }, 'Gossip-Sync gestartet');
  }

  /**
   * Stoppt den Gossip-Sync.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.log?.info('Gossip-Sync gestoppt');
    }
  }

  /**
   * Führt eine einzelne Sync-Runde durch.
   * Wählt zufällig bis zu `fanout` Online-Peers und synchronisiert.
   */
  async syncRound(): Promise<void> {
    const peers = this.mesh.getOnlinePeers();
    if (peers.length === 0) return;

    // Zufällig bis zu `fanout` Peers auswählen
    const selected = this.selectRandomPeers(peers, this.config.fanout);

    await Promise.allSettled(
      selected.map((peer) => this.syncWithPeer(peer)),
    );
  }

  /**
   * Synchronisiert die Registry mit einem einzelnen Peer.
   */
  async syncWithPeer(peer: MeshPeer): Promise<void> {
    // Nur eigene Capabilities senden — keine Relay von Peer-Capabilities
    // Das verhindert "fremde agent_id"-Warnungen beim Empfaenger
    const capabilities = this.registry.exportCapabilities()
      .filter((c) => c.agent_id === this.senderSpiffeUri);
    const hash = this.registry.getCapabilityHash();

    // REGISTRY_SYNC-Nachricht erstellen
    const payload: RegistrySyncPayload = {
      capability_hash: hash,
      capabilities: capabilities.map((c) => ({
        skill_id: c.skill_id,
        version: c.version,
        description: c.description,
        agent_id: c.agent_id,
        health: c.health,
        trust_level: c.trust_level,
        updated_at: c.updated_at,
        category: c.category,
        permissions: c.permissions,
      })),
    };

    const envelope = createEnvelope(
      MessageType.REGISTRY_SYNC,
      this.senderSpiffeUri,
      payload,
      { ttl_ms: 60_000 },
    );

    const signed = encodeAndSign(envelope, this.privateKeyPem);
    const body = serializeSignedMessage(signed);

    try {
      const res = await fetch(`${peer.endpoint}/message`, {
        method: 'POST',
        headers: { 'content-type': 'application/cbor' },
        body: Buffer.from(body),
        signal: AbortSignal.timeout(10_000),
        dispatcher: this.dispatcher,
      });

      if (res.status === 204) {
        // Peer hat keine Antwort (kein Sync nötig)
        this.log?.debug({ peer: peer.agentId }, 'Gossip: Peer in Sync');
        return;
      }

      if (res.ok && res.headers.get('content-type')?.includes('cbor')) {
        // Antwort enthält Peer-Capabilities zum Rück-Import
        // (wird in Phase 2 vollständig implementiert mit Signaturprüfung)
        this.log?.debug({ peer: peer.agentId }, 'Gossip: Sync-Antwort erhalten');
      }
    } catch (err) {
      this.log?.debug({ peer: peer.agentId, err }, 'Gossip: Sync mit Peer fehlgeschlagen');
    }
  }

  /**
   * Verarbeitet eine eingehende REGISTRY_SYNC-Nachricht.
   * Wird vom Message-Handler in agent-card.ts aufgerufen.
   */
  handleSyncMessage(envelope: MessageEnvelope): RegistrySyncResponsePayload {
    const payload = envelope.payload as RegistrySyncPayload;

    // Prüfe ob Sync nötig ist (Hash-Vergleich)
    const localHash = this.registry.getCapabilityHash();
    if (localHash === payload.capability_hash) {
      return {
        capability_hash: localHash,
        imported: 0,
        capabilities: [],
      };
    }

    // Capabilities importieren — NUR Capabilities des tatsächlichen Senders akzeptieren
    // Verhindert dass ein Peer Capabilities für fremde Agents fälschen kann
    const sanitizedCaps = (payload.capabilities as Capability[]).filter((c) => {
      if (c.agent_id !== envelope.sender) {
        this.log?.warn(
          { claimed: c.agent_id, sender: envelope.sender, skill: c.skill_id },
          'Gossip: Capability mit fremder agent_id abgelehnt',
        );
        return false;
      }
      return true;
    });
    const imported = this.registry.importPeerCapabilities(sanitizedCaps);

    this.log?.info(
      { from: envelope.sender, imported, peerHash: payload.capability_hash },
      'Gossip: Capabilities von Peer importiert',
    );

    // Eigene Capabilities für Rück-Sync zurückgeben
    const ownCapabilities = this.registry.exportCapabilities();
    return {
      capability_hash: this.registry.getCapabilityHash(),
      imported,
      capabilities: ownCapabilities.map((c) => ({
        skill_id: c.skill_id,
        version: c.version,
        description: c.description,
        agent_id: c.agent_id,
        health: c.health,
        trust_level: c.trust_level,
        updated_at: c.updated_at,
        category: c.category,
        permissions: c.permissions,
      })),
    };
  }

  private selectRandomPeers(peers: MeshPeer[], count: number): MeshPeer[] {
    if (peers.length <= count) return [...peers];
    const shuffled = [...peers].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  }
}
