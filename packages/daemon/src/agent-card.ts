import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import * as si from 'systeminformation';
import type { AgentIdentity } from './identity.js';
import type { DaemonConfig } from './config.js';
import type { NodeCertBundle } from './tls.js';
import type { MessageEnvelope, SignedMessage } from './messages.js';
import {
  deserializeSignedMessage,
  decodeAndVerify,
  serializeSignedMessage,
} from './messages.js';
import { ReplayGuard } from './replay.js';
import { RateLimiter } from './ratelimit.js';
import type { Logger } from 'pino';
import type { Libp2pRuntimeState } from './libp2p-runtime.js';

export interface AgentCard {
  name: string;
  version: string;
  hostname: string;
  endpoint: string;
  publicKey: string;
  spiffeUri: string;
  capabilities: {
    agents: string[];
    skills: string[];
    services: unknown[];
    connectors: string[];
  };
  health: {
    cpu_percent: number;
    memory_percent: number;
    disk_percent: number;
    uptime_seconds: number;
  };
  worker: {
    active_tasks: number;
    completed_tasks: number;
    failed_tasks: number;
    load_percent: number; // 0-100, basierend auf aktiven Tasks vs. Kapazitaet
  };
  mesh: {
    joined_at: string;
    trust_level: string;
    peers_connected: number;
    libp2p: {
      enabled: boolean;
      status: 'disabled' | 'ready' | 'degraded';
      peer_id: string | null;
      listen_multiaddrs: string[];
      connected_peers: number;
      noise: boolean;
      mdns: boolean;
      multiplexer: {
        enabled: boolean;
        name: string | null;
        protocols: string[];
        open_streams: number;
        streams_by_protocol: Record<string, number>;
      };
      nat: {
        enabled: boolean;
        reachability: 'unknown' | 'private' | 'public' | 'relay';
        strategy: 'disabled' | 'direct' | 'relay' | 'hybrid';
        auto_nat: boolean;
        relay_transport: boolean;
        relay_service: boolean;
        hole_punching: boolean;
        observed_multiaddrs: string[];
        announce_multiaddrs: string[];
        relay_reservations: number;
        reason: string | null;
      };
      reason: string | null;
    };
  };
}

/** Callback für eingehende Mesh-Nachrichten */
export type MessageHandler = (
  envelope: MessageEnvelope,
  senderPublicKey: string,
) => Promise<SignedMessage | null>;

export interface AgentCardServerOptions {
  identity: AgentIdentity;
  config: DaemonConfig;
  tls?: NodeCertBundle;
  log?: Logger;
  /** Map von bekannten Peer-Public-Keys (agentId → PEM) für Signaturprüfung */
  getPeerPublicKey?: (agentId: string) => string | undefined;
  /** Handler für eingehende Mesh-Nachrichten */
  onMessage?: MessageHandler;
  /** Rate-Limiter für alle Endpoints */
  rateLimiter?: RateLimiter;
  getLibp2pState?: () => Libp2pRuntimeState;
}

export class AgentCardServer {
  private server: FastifyInstance;
  private joinedAt: string;
  private peerCount = 0;
  private useTls: boolean;
  private workerStats = { active: 0, completed: 0, failed: 0, capacity: 10 };
  private replayGuard = new ReplayGuard();

  constructor(private opts: AgentCardServerOptions) {
    this.joinedAt = new Date().toISOString();
    this.useTls = !!opts.tls;

    const serverOpts: Record<string, unknown> = {
      logger: false,
      // Raw body für CBOR-Message-Endpoint
      bodyLimit: 1_048_576, // 1 MB max
    };

    // mTLS konfigurieren wenn TLS-Bundle vorhanden
    if (opts.tls) {
      serverOpts['https'] = {
        key: opts.tls.keyPem,
        cert: opts.tls.certPem,
        ca: opts.tls.caCertPem,
        requestCert: true, // Client-Zertifikat anfordern (mTLS)
        rejectUnauthorized: true, // Client-Certs gegen Mesh-CA validieren
      };
    }

    this.server = Fastify(serverOpts);

    // CBOR Content-Type-Parser registrieren
    this.server.addContentTypeParser(
      'application/cbor',
      { parseAs: 'buffer' },
      (_req: FastifyRequest, body: Buffer, done: (err: Error | null, result?: Buffer) => void) => {
        done(null, body);
      },
    );

    this.server.get('/.well-known/agent-card.json', async (request: FastifyRequest, reply: FastifyReply) => {
      if (opts.rateLimiter && !opts.rateLimiter.allow(request.ip)) {
        return reply.code(429).send({ error: 'Too Many Requests' });
      }
      return this.buildCard();
    });

    this.server.get('/health', async (request: FastifyRequest, reply: FastifyReply) => {
      if (opts.rateLimiter && !opts.rateLimiter.allow(request.ip)) {
        return reply.code(429).send({ error: 'Too Many Requests' });
      }
      return { status: 'ok', timestamp: new Date().toISOString() };
    });

    // Message-Endpoint: empfängt CBOR-kodierte SignedMessages
    this.server.post('/message', {
      config: { rawBody: true },
    }, async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as Buffer;
      if (!body || body.length === 0) {
        return reply.code(400).send({ error: 'Empty body' });
      }
      // CBOR-spezifisches Size-Limit (256 KB)
      if (body.length > 256 * 1024) {
        return reply.code(413).send({ error: 'Message too large' });
      }

      try {
        const signed = deserializeSignedMessage(new Uint8Array(body));

        // Envelope dekodieren um Sender zu extrahieren (ohne Signaturprüfung)
        const { Decoder } = await import('cbor-x');
        const decoder = new Decoder({ structuredClone: true });
        const rawEnvelope = decoder.decode(Buffer.from(signed.envelope)) as MessageEnvelope;

        // Public Key des Senders nachschlagen
        const senderKey = opts.getPeerPublicKey?.(rawEnvelope.sender);
        if (!senderKey) {
          return reply.code(403).send({ error: 'Unknown sender' });
        }

        // Signatur verifizieren + TTL prüfen
        const verified = decodeAndVerify(signed, senderKey);
        if (!verified) {
          return reply.code(403).send({ error: 'Invalid signature or expired' });
        }

        // Replay-Schutz: Prüfe ob Nachricht bereits verarbeitet
        if (this.replayGuard.isReplay(verified.sender, verified.idempotency_key, verified.ttl_ms)) {
          return reply.code(409).send({ error: 'Duplicate message' });
        }

        // An den Message-Handler delegieren
        const response = await opts.onMessage?.(verified, senderKey);
        if (response) {
          const responseBytes = serializeSignedMessage(response);
          return reply
            .code(200)
            .header('content-type', 'application/cbor')
            .send(Buffer.from(responseBytes));
        }

        return reply.code(204).send();
      } catch (err) {
        opts.log?.warn({ err }, 'Fehler beim Verarbeiten einer Nachricht');
        return reply.code(400).send({ error: 'Invalid message format' });
      }
    });
  }

  get identity(): AgentIdentity {
    return this.opts.identity;
  }

  get config(): DaemonConfig {
    return this.opts.config;
  }

  setPeerCount(count: number): void {
    this.peerCount = count;
  }

  /** Worker-Statistiken aktualisieren (wird vom Task-Manager aufgerufen) */
  setWorkerStats(stats: { active: number; completed: number; failed: number }): void {
    this.workerStats = { ...this.workerStats, ...stats };
  }

  async start(): Promise<void> {
    await this.server.listen({
      port: this.opts.config.daemon.port,
      host: this.opts.config.daemon.bind_host,
    });
    const proto = this.useTls ? 'HTTPS (mTLS)' : 'HTTP';
    this.opts.log?.info(
      { port: this.opts.config.daemon.port, bindHost: this.opts.config.daemon.bind_host, proto },
      'Agent Card Server gestartet',
    );
  }

  async stop(): Promise<void> {
    this.replayGuard.stop();
    await this.server.close();
    this.opts.log?.info('Agent Card Server gestoppt');
  }

  /** Zugriff auf die Fastify-Instanz fuer Plugin-Registrierung (Dashboard, Pairing) */
  getServer(): FastifyInstance {
    return this.server;
  }

  get protocol(): string {
    return this.useTls ? 'https' : 'http';
  }

  getAddress(): string {
    const addr = this.server.addresses();
    const port = addr.length > 0 ? addr[0].port : this.opts.config.daemon.port;
    return `${this.protocol}://${this.opts.config.daemon.hostname}:${port}`;
  }

  private async buildCard(): Promise<AgentCard> {
    const [cpuLoad, mem, disk] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.fsSize(),
    ]);

    const diskUsed = disk.length > 0 ? (disk[0].use ?? 0) : 0;

    const libp2p = this.opts.getLibp2pState?.() ?? {
      enabled: false,
      status: 'disabled' as const,
      peerId: null,
      listenMultiaddrs: [],
      connectedPeers: 0,
      noise: false,
      mdns: false,
      reason: 'libp2p not configured',
      available: false,
    };

    return {
      name: `${this.opts.config.daemon.hostname}-${this.opts.config.daemon.agent_type}`,
      version: '0.2.0',
      hostname: this.opts.config.daemon.hostname,
      endpoint: `${this.protocol}://${this.opts.config.daemon.hostname}:${this.opts.config.daemon.port}`,
      publicKey: this.opts.identity.publicKeyPem,
      spiffeUri: this.opts.identity.spiffeUri,
      capabilities: {
        agents: [this.opts.config.daemon.agent_type],
        skills: [],
        services: [],
        connectors: [],
      },
      health: {
        cpu_percent: Math.round(cpuLoad.currentLoad * 10) / 10,
        memory_percent: Math.round((mem.used / mem.total) * 1000) / 10,
        disk_percent: Math.round(diskUsed * 10) / 10,
        uptime_seconds: Math.floor(process.uptime()),
      },
      worker: {
        active_tasks: this.workerStats.active,
        completed_tasks: this.workerStats.completed,
        failed_tasks: this.workerStats.failed,
        load_percent: Math.min(100, Math.round((this.workerStats.active / Math.max(1, this.workerStats.capacity)) * 100)),
      },
      mesh: {
        joined_at: this.joinedAt,
        trust_level: this.useTls ? 'mtls-self-signed' : 'none',
        peers_connected: this.peerCount,
        libp2p: {
          enabled: libp2p.enabled,
          status: libp2p.status,
          peer_id: libp2p.peerId,
          listen_multiaddrs: [...libp2p.listenMultiaddrs],
          connected_peers: libp2p.connectedPeers,
          noise: libp2p.noise,
          mdns: libp2p.mdns,
          multiplexer: {
            enabled: libp2p.multiplexer.enabled,
            name: libp2p.multiplexer.name,
            protocols: [...libp2p.multiplexer.protocols],
            open_streams: libp2p.multiplexer.openStreams,
            streams_by_protocol: { ...libp2p.multiplexer.streamsByProtocol },
          },
          nat: {
            enabled: libp2p.nat.enabled,
            reachability: libp2p.nat.reachability,
            strategy: libp2p.nat.strategy,
            auto_nat: libp2p.nat.autoNAT,
            relay_transport: libp2p.nat.relayTransport,
            relay_service: libp2p.nat.relayService,
            hole_punching: libp2p.nat.holePunching,
            observed_multiaddrs: [...libp2p.nat.observedMultiaddrs],
            announce_multiaddrs: [...libp2p.nat.announceMultiaddrs],
            relay_reservations: libp2p.nat.relayReservations,
            reason: libp2p.nat.reason,
          },
          reason: libp2p.reason,
        },
      },
    };
  }
}
