/**
 * registry-sync-coordinator.ts — Per-Peer Anti-Entropy Sync fuer die
 * Automerge-Capability-Registry. Adressiert den Hauptbug aus ADR-020.
 *
 * Verantwortlichkeiten:
 * - SyncState pro Peer halten (Map<peerId, Automerge.SyncState>)
 * - Auf peer:connect → frischer SyncState + initialer push (bidirektional)
 * - Periodischer Timer (45 s ± 20 % Jitter) → Sync-Round-Trip pro Peer
 * - Per-Peer Singleflight: pro Peer max. ein laufender Sync
 * - 3-Strike Timeout-Cleanup: bei drei Timeouts in Folge → SyncState
 *   verwerfen + hangUp(peerId)
 * - Inbound Frames vom Protocol-Handler entgegennehmen
 *
 * Transport-agnostisch: bekommt nur ein SyncTransport-Interface, das die
 * libp2p-Spezifika kapselt. Damit unit-testbar ohne libp2p.
 *
 * Referenz: ADR-020 v1.3 + v1.4 + v1.5.
 */

import * as Automerge from '@automerge/automerge';
import type { Logger } from 'pino';
import type { CapabilityRegistry } from './registry.js';

export interface SyncTransport {
  /**
   * Sendet eine Sync-Message an einen Peer. Wirft bei Stream-Fehler.
   * Implementierung kann frische Streams oeffnen oder pro Peer multiplexen.
   */
  send(peerId: string, message: Uint8Array, signal: AbortSignal): Promise<void>;

  /**
   * Beendet die libp2p-Connection zu einem Peer (3-Strike-Cleanup).
   * Wird vom Coordinator aufgerufen, wenn ein Peer wiederholt nicht
   * antwortet. Konkrete libp2p-Impl ruft `node.hangUp(peerId)` auf.
   */
  hangUp(peerId: string): Promise<void>;
}

export interface RegistrySyncCoordinatorOptions {
  registry: CapabilityRegistry;
  transport: SyncTransport;
  /** Tick-Intervall im healthy-Pfad. Default 45_000. */
  intervalMs?: number;
  /** Jitter-Bandbreite in % (±). Default 20. */
  jitterPercent?: number;
  /** Hartes Timeout pro Sync-Round. Default 10_000. */
  roundTimeoutMs?: number;
  /** Anzahl Timeouts in Folge bis hangUp. Default 3. */
  hangUpThreshold?: number;
  /** Injizierbarer RNG (fuer Jitter-Tests). Default Math.random. */
  random?: () => number;
  log?: Logger;
}

interface PeerSyncEntry {
  state: Automerge.SyncState;
  inflight: Promise<void> | null;
  /**
   * Buffer fuer Inbound-Messages, die waehrend einer laufenden Round
   * ankommen. Wuerden wir sie sofort via receiveSyncMessage auf entry.state
   * anwenden, raceten generateSyncMessage und receiveSyncMessage auf
   * demselben SyncState. Stattdessen: bufferen und im finally-Block der
   * Round drain + neue Round triggern. Das ist der mehrstufige
   * Bloom-Filter-Austausch des Automerge-Sync-Protokolls.
   */
  inboundBuffer: Uint8Array[];
  consecutiveTimeouts: number;
  lastRoundAt: string | null;
  lastError: string | null;
  rounds: number;
  converged: boolean;
}

export class RegistrySyncCoordinator {
  private readonly registry: CapabilityRegistry;
  private readonly transport: SyncTransport;
  private readonly intervalMs: number;
  private readonly jitterPercent: number;
  private readonly roundTimeoutMs: number;
  private readonly hangUpThreshold: number;
  private readonly random: () => number;
  private readonly log?: Logger;

  private peers = new Map<string, PeerSyncEntry>();
  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(opts: RegistrySyncCoordinatorOptions) {
    this.registry = opts.registry;
    this.transport = opts.transport;
    this.intervalMs = opts.intervalMs ?? 45_000;
    this.jitterPercent = opts.jitterPercent ?? 20;
    this.roundTimeoutMs = opts.roundTimeoutMs ?? 10_000;
    this.hangUpThreshold = opts.hangUpThreshold ?? 3;
    this.random = opts.random ?? Math.random;
    this.log = opts.log;
  }

  /** Startet den periodischen Sync-Loop. */
  start(): void {
    if (this.stopped) {
      throw new Error('RegistrySyncCoordinator already stopped');
    }
    this.scheduleNextTick();
  }

  /** Stoppt alle Timer + cancel laufende Rounds. Idempotent. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.tickTimer !== null) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
    // Warte auf laufende Rounds, ignoriere Fehler beim Shutdown
    const inflight = Array.from(this.peers.values())
      .map((entry) => entry.inflight)
      .filter((p): p is Promise<void> => p !== null);
    await Promise.allSettled(inflight);
  }

  /**
   * Event: Peer verbunden. Frischer SyncState + initialer bidirektionaler
   * Push. „Bidirektional" heisst: ich rufe generateSyncMessage auf MEINEM
   * Doc auf und sende. Der Empfaenger antwortet mit seinem
   * generateSyncMessage. Beide Seiten triggern das beim connect → Garantie,
   * dass auch ein Peer ohne lokale Aenderungen Sync initiiert.
   */
  onPeerConnect(peerId: string): void {
    if (this.stopped) return;
    this.peers.set(peerId, {
      state: this.registry.initSyncState(),
      inflight: null,
      inboundBuffer: [],
      consecutiveTimeouts: 0,
      lastRoundAt: null,
      lastError: null,
      rounds: 0,
      converged: false,
    });
    void this.runRound(peerId, 'connect');
  }

  /** Event: Peer disconnected. SyncState verwerfen. */
  onPeerDisconnect(peerId: string): void {
    this.peers.delete(peerId);
  }

  /**
   * Inbound Frame vom Protocol-Handler. Verarbeitet die Sync-Message und
   * sendet ggf. eine Antwort. Triggert eine neue Round wenn das Frame
   * ausserhalb einer laufenden Round eingeht.
   */
  async onMessageFromPeer(peerId: string, message: Uint8Array): Promise<void> {
    if (this.stopped) return;
    let entry = this.peers.get(peerId);
    if (!entry) {
      // Nachricht von unbekanntem Peer → frischer SyncState, danach Reply
      entry = {
        state: this.registry.initSyncState(),
        inflight: null,
        inboundBuffer: [],
        consecutiveTimeouts: 0,
        lastRoundAt: null,
        lastError: null,
        rounds: 0,
        converged: false,
      };
      this.peers.set(peerId, entry);
    }

    if (entry.inflight !== null) {
      // Round laeuft → buffern, im finally-Block drainen.
      entry.inboundBuffer.push(message);
      return;
    }

    const [nextState] = this.registry.receiveSyncMessage(entry.state, message);
    entry.state = nextState;
    void this.runRound(peerId, 'inbound');
  }

  /** Safety Valve: erzwingt sofortige Sync-Round pro Peer. */
  async republish(): Promise<void> {
    const peerIds = Array.from(this.peers.keys());
    await Promise.all(peerIds.map((peerId) => this.runRound(peerId, 'republish')));
  }

  /** Beobachtbarer Status fuer /api/status. */
  getStatus(): Record<string, {
    rounds: number;
    converged: boolean;
    last_round_at: string | null;
    consecutive_timeouts: number;
    last_error: string | null;
    in_flight: boolean;
  }> {
    const out: Record<string, ReturnType<RegistrySyncCoordinator['getStatus']>[string]> = {};
    for (const [peerId, entry] of this.peers.entries()) {
      out[peerId] = {
        rounds: entry.rounds,
        converged: entry.converged,
        last_round_at: entry.lastRoundAt,
        consecutive_timeouts: entry.consecutiveTimeouts,
        last_error: entry.lastError,
        in_flight: entry.inflight !== null,
      };
    }
    return out;
  }

  /** Fuer Tests: gibt SyncState-Identitaet pro Peer zurueck. */
  getSyncStateRef(peerId: string): Automerge.SyncState | undefined {
    return this.peers.get(peerId)?.state;
  }

  // --- Internas ---

  private scheduleNextTick(): void {
    if (this.stopped) return;
    const delay = this.computeTickDelay();
    this.tickTimer = setTimeout(() => {
      this.tickTimer = null;
      void this.tick();
    }, delay);
  }

  private computeTickDelay(): number {
    const jitter = (this.random() * 2 - 1) * (this.jitterPercent / 100);
    return Math.round(this.intervalMs * (1 + jitter));
  }

  private async tick(): Promise<void> {
    const peerIds = Array.from(this.peers.keys());
    await Promise.all(peerIds.map((peerId) => this.runRound(peerId, 'tick')));
    this.scheduleNextTick();
  }

  /**
   * Fuehrt eine Sync-Round fuer einen Peer aus. Singleflight: wenn schon
   * eine Round laeuft, return ohne neue zu starten.
   */
  private async runRound(peerId: string, _trigger: 'connect' | 'tick' | 'inbound' | 'republish'): Promise<void> {
    if (this.stopped) return;
    const entry = this.peers.get(peerId);
    if (!entry) return;
    if (entry.inflight) return;

    const promise = (async () => {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(new Error('round timeout')), this.roundTimeoutMs);
      try {
        const [nextState, message] = this.registry.generateSyncMessage(entry.state);
        entry.state = nextState;
        if (message === null) {
          // Nichts zu senden. Das beweist NICHT, dass der Peer erreichbar
          // ist — wir wissen nur, dass unser lokaler SyncState sagt „kein
          // Diff". Nicht consecutiveTimeouts zuruecksetzen, sonst werden
          // tote Peers nie ge-hangUp-ed (siehe ADR-020 v1.5).
          entry.converged = true;
          entry.lastRoundAt = new Date().toISOString();
          entry.rounds += 1;
          return;
        }
        entry.converged = false;
        await this.transport.send(peerId, message, ac.signal);
        entry.consecutiveTimeouts = 0;
        entry.lastError = null;
        entry.lastRoundAt = new Date().toISOString();
        entry.rounds += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        entry.lastError = msg;
        if (msg.includes('timeout') || msg.includes('aborted')) {
          entry.consecutiveTimeouts += 1;
          if (entry.consecutiveTimeouts >= this.hangUpThreshold) {
            this.log?.warn(
              { peerId, consecutiveTimeouts: entry.consecutiveTimeouts },
              'registry sync timeout threshold reached, hanging up peer',
            );
            await this.transport.hangUp(peerId).catch(() => undefined);
            this.peers.delete(peerId);
            return;
          }
        }
        this.log?.debug({ peerId, err: msg }, 'registry sync round failed');
      } finally {
        clearTimeout(timer);
        const current = this.peers.get(peerId);
        if (current) current.inflight = null;
      }
    })();

    entry.inflight = promise;
    try {
      await promise;
    } finally {
      const current = this.peers.get(peerId);
      if (current && current.inboundBuffer.length > 0 && !this.stopped) {
        // Buffered messages auf state anwenden, dann nachgelagerte Round.
        const messages = current.inboundBuffer.splice(0);
        for (const msg of messages) {
          const [nextState] = this.registry.receiveSyncMessage(current.state, msg);
          current.state = nextState;
        }
        queueMicrotask(() => {
          if (!this.stopped && this.peers.has(peerId)) {
            void this.runRound(peerId, 'inbound');
          }
        });
      }
    }
  }
}
