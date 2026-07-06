// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import type { Server as HttpsServer } from 'node:https';
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
import { authorizeHttpsSender, spiffeUrisFromSubjectAltName, attestedPeerIdFromCert } from './peer-identity.js';
import type { BuildInfo } from './build-info.js';
import type { NodeResourceRecord } from './registry.js';

export interface AgentCard {
  name: string;
  version: string;
  /** Build-/Versions-Stempel (welcher Build laeuft auf diesem Node) — siehe build-info.ts. */
  build?: {
    version: string;
    number: string;
    node: string;
    date: string | null;
  };
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
  /**
   * T2.4-Folge: place-or-refuse-relevante Auslastung (cache-bewusst), gespiegelt aus der
   * Registry-Side-Map des eigenen Knotens — single source of truth mit dem place-or-refuse-Gate
   * (`ram_used_percent` rechnet cache-bereinigt, anders als `health.memory_percent`).
   * So sehen Peers über die Agent-Card dieselbe Kapazität, nach der der Knoten ablehnt.
   * Optional — fehlt, solange noch kein Resource-Snapshot vorliegt.
   */
  resources?: {
    free_ram_bytes: number;
    ram_used_percent: number;
    cpu_load: number;
    agent_count: number;
    updated_at: string;
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
      registry_sync?: Record<string, {
        rounds: number;
        converged: boolean;
        last_round_at: string | null;
        consecutive_timeouts: number;
        last_error: string | null;
        in_flight: boolean;
      }>;
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
  /**
   * ADR-022 Phase 3: die TATSÄCHLICH emittierte Self-Identität (`node/<PeerID>`
   * nach dem Flip, sonst Legacy). Die Agent-Card MUSS diese ausgeben — sonst
   * weicht `card.spiffeUri` von der per mDNS annoncierten `agentId` ab, Peers
   * verwerfen die Card und können den Public-Key des kanonischen Senders nicht
   * auflösen (→ 403/Unknown sender). Fällt auf `identity.spiffeUri` zurück.
   */
  selfIdentityUri?: string;
  config: DaemonConfig;
  /** Build-/Versions-Stempel dieses Daemons (für agent_card.build + /api/status). */
  buildInfo?: BuildInfo;
  tls?: NodeCertBundle;
  /**
   * Aggregierte CA-Bundle-Liste fuer den Fastify-HTTPS-`ca`-Parameter.
   * Enthaelt die eigene Mesh-CA UND optional die CAs gepairter Peers
   * (aus dem SPAKE2 Trust-Bootstrap). Wenn nicht gesetzt, fallback auf
   * `tls.caCertPem` als einzelner String — das ist das alte Verhalten
   * und fuehrt dazu, dass nur die eigene CA akzeptiert wird.
   */
  trustedCaBundle?: string[];
  log?: Logger;
  /**
   * T2.4-Folge: liefert die place-or-refuse-Resource-Attribute des eigenen Knotens
   * (aus der Registry-Side-Map) für die Mesh-Exposition in der Agent-Card. Optional.
   */
  getNodeResources?: () => NodeResourceRecord | undefined;
  /** Map von bekannten Peer-Public-Keys (agentId → PEM) für Signaturprüfung */
  getPeerPublicKey?: (agentId: string) => string | undefined;
  /**
   * ADR-022 §3 (channel-bound): wird gerufen, wenn der präsentierte (CA-validierte)
   * mTLS-Cert-SAN eine kanonische `node/<PeerID>` kryptografisch bestätigt — der
   * Aufrufer markiert die PeerID dann als verifiziert (mesh.markPeerIdVerified).
   */
  onPeerCertVerified?: (
    peerId: string,
    senderUri: string,
    remoteAddress?: string,
  ) => { ok: boolean; rollback: () => void } | void;
  /**
   * ADR-022 (CR gpt-5.5 WS-2 HIGH): SHA-256-Fingerprints der CAs, die berechtigt sind,
   * eine `node/<PeerID>`-PoP-Attestierung auszustellen (die Admin-/Mesh-CA auf .94).
   * NUR von diesen Ausstellern signierte kanonische Cert-SANs lösen `onPeerCertVerified`
   * aus bzw. autorisieren einen kanonischen Sender. Leer/ungesetzt → kein Aussteller
   * gilt als attestierend → kanonischer Pfad inert (Phase-0-Default; WS-3 setzt den Pin
   * auf .94s Admin-CA). Schützt gegen eine bösartige gepairte Peer-CA im Trust-Bundle.
   */
  peerIdAttestingCaFingerprints?: string[];
  /**
   * ADR-026 symmetrische Discovery: wird gerufen, wenn ein authentifizierter, issuer-gepinnt
   * attestierter Inbound-Sender NICHT auflösbar ist (kein Discovery-Eintrag). Der Aufrufer
   * lernt den Peer asynchron (Card-Fetch + Validierung) → resolvePeerPublicKey beim Retry.
   * Non-blocking, AUTHN-only (führt NIE zu Autorisierung).
   */
  onAuthenticatedInbound?: (info: {
    peerId: string;
    senderUri: string;
    remoteAddress: string;
    certFingerprint: string;
  }) => void;
  /** Handler für eingehende Mesh-Nachrichten */
  onMessage?: MessageHandler;
  /** Rate-Limiter für alle Endpoints */
  rateLimiter?: RateLimiter;
  getLibp2pState?: () => Libp2pRuntimeState;
  /**
   * Liefert Per-Peer Registry-Sync-Status (ADR-020 v1). Wird in
   * /api/status unter `libp2p.registry_sync` ausgegeben.
   */
  getRegistrySyncStatus?: () => Record<string, {
    rounds: number;
    converged: boolean;
    last_round_at: string | null;
    consecutive_timeouts: number;
    last_error: string | null;
    in_flight: boolean;
  }>;
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

    // mTLS konfigurieren wenn TLS-Bundle vorhanden.
    // `ca` bevorzugt das aggregierte Bundle (eigene CA + gepairte Peer-CAs),
    // faellt zurueck auf die eigene CA allein wenn kein Bundle uebergeben wurde.
    if (opts.tls) {
      const trustedCa: string | string[] =
        opts.trustedCaBundle && opts.trustedCaBundle.length > 0
          ? opts.trustedCaBundle
          : opts.tls.caCertPem;
      serverOpts['https'] = {
        key: opts.tls.keyPem,
        cert: opts.tls.certPem,
        ca: trustedCa,
        requestCert: true, // Client-Zertifikat anfordern (mTLS)
        rejectUnauthorized: true, // Client-Certs gegen vertraute CAs validieren
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

        // ADR-022 §3: channel-gebundene HTTPS-Authz. Bei kanonischem
        // node/<PeerID>-Sender MUSS der präsentierte (per rejectUnauthorized bereits
        // CA-validierte) mTLS-Client-Cert-SAN exakt dem Sender entsprechen — dann ist
        // die PeerID kryptografisch an diese Verbindung gebunden. Legacy host/<id>:
        // kein Cert-Gate (Migrations-Kompat). NIE aus mDNS/Card autorisieren.
        // CR gpt-5.5 LOW (defense-in-depth): nur den SAN eines TLS-validierten Sockets
        // (`authorized===true`) verwenden — schützt gegen künftige TLS-Konfig-Drift.
        // `getPeerCertificate(true)` → Detail-Cert inkl. issuerCertificate (für den CA-Pin).
        const tlsSock = request.raw.socket as {
          authorized?: boolean;
          remoteAddress?: string;
          getPeerCertificate?: (detailed?: boolean) => {
            subjectaltname?: string;
            fingerprint256?: string;
            issuerCertificate?: { fingerprint256?: string };
          };
        };
        const peerCert = tlsSock.authorized === true ? tlsSock.getPeerCertificate?.(true) : undefined;
        const certSans = spiffeUrisFromSubjectAltName(peerCert?.subjectaltname);
        // Kanonische node/<PeerID>-SAN für den Sender-Abgleich (Migration: Cert kann
        // Legacy+Canonical-SAN tragen — spiffeUrisFromSubjectAltName liefert beide).
        const canonicalCertSan = certSans.find((u) => /^spiffe:\/\/thinklocal\/node\//.test(u)) ?? null;
        const authz = authorizeHttpsSender(rawEnvelope.sender, canonicalCertSan);
        if (!authz.ok) {
          return reply.code(403).send({ error: 'Sender not authorized for this channel', reason: authz.reason });
        }
        // ADR-022 Phase 0 (Accept-both, CR gpt-5.5 WS-2 HIGH): Eine kanonische node/<PeerID>-
        // Attestierung zählt NUR, wenn das Cert von einer GEPINNTEN PeerID-attestierenden CA
        // (.94 Admin-CA) ausgestellt wurde — nicht von irgendeiner transport-vertrauten (z.B.
        // gepairten Peer-)CA im mTLS-Bundle. Sonst könnte eine bösartige CA ein node/<victim>-
        // Cert minten und eine fremde PeerID „verifizieren". Default (kein Pin) → null → inert.
        const issuerFp = peerCert?.issuerCertificate?.fingerprint256 ?? null;
        const attestedPeerId = attestedPeerIdFromCert(
          certSans,
          issuerFp,
          opts.peerIdAttestingCaFingerprints ?? [],
        );
        // Kanonischer Sender, dessen Cert NICHT von der attestierenden CA stammt → ablehnen
        // (Cert-Substitution-Schutz): die SAN-Übereinstimmung allein genügt nicht.
        if (authz.verifiedPeerId && attestedPeerId === null) {
          return reply
            .code(403)
            .send({ error: 'Canonical sender requires a PeerID-attesting certificate issuer' });
        }
        // Krypto-attestierte PeerID → Auflösung für diesen Peer freischalten (auch wenn der
        // Sender noch Legacy ist: Phase-1-Fall, Cert reissued vor Sender-Flip).
        // CR gpt-5.5 HIGH (transaktional): Die Attestierung darf den Trust-State (PeerID-Bindung
        // + verified-Flag) NICHT dauerhaft mutieren, BEVOR die Envelope-Signatur geprüft ist —
        // sonst hinterließe eine fehlschlagende Nachricht eine persistente Fehlbindung, die der
        // No-Rebind-Guard später blockiert. Daher: tentativ binden, bei Sig-Fehler rollbacken.
        let certVerification: { ok: boolean; rollback: () => void } | undefined;
        if (attestedPeerId) {
          // remoteAddress = die TLS-authentifizierte Source-IP DIESER Verbindung → bindet die
          // attestierte PeerID an den richtigen Host-Eintrag, auch wenn dessen mDNS-/Card-PeerID
          // (noch) fehlt (Bug #2: .56/.222).
          const r = opts.onPeerCertVerified?.(attestedPeerId, rawEnvelope.sender, tlsSock.remoteAddress);
          certVerification = r && typeof r === 'object' ? r : undefined;
        }

        // Public Key des Senders nachschlagen
        const senderKey = opts.getPeerPublicKey?.(rawEnvelope.sender);
        if (!senderKey) {
          certVerification?.rollback();
          // ADR-026 symmetrische Discovery: Sender ist nicht auflösbar (kein eigener
          // Discovery-Eintrag), ABER die Verbindung ist authentifiziert + issuer-gepinnt
          // attestiert (attestedPeerId). Lerne den Peer ASYNCHRON (Card von der TLS-Source-IP
          // holen, gegen die attestierte PeerID validieren) → der Retry des Senders löst auf.
          // Non-blocking: dieser Request 403t noch. Nur AUTHN; keine Autorisierung.
          if (attestedPeerId) {
            opts.onAuthenticatedInbound?.({
              peerId: attestedPeerId,
              senderUri: rawEnvelope.sender,
              remoteAddress: tlsSock.remoteAddress ?? '',
              certFingerprint: peerCert?.fingerprint256 ?? '',
            });
          }
          return reply.code(403).send({ error: 'Unknown sender' });
        }

        // Signatur verifizieren + TTL prüfen
        const verified = decodeAndVerify(signed, senderKey);
        if (!verified) {
          certVerification?.rollback();
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

  /**
   * Hot-reload TLS trust bundle without restarting the server.
   * Called by TrustStoreNotifier.onChange() after a new peer is paired.
   * Uses Node.js tls.createSecureContext() + server.setSecureContext().
   */
  reloadTlsContext(newCaBundle: string[]): boolean {
    if (!this.useTls || !this.opts.tls) {
      this.opts.log?.warn('reloadTlsContext called but TLS is not active');
      return false;
    }

    try {
      // Fastify's underlying server is a Node.js https.Server
      // CR Gemini Pro: removed redundant createSecureContext() — setSecureContext
      // handles context creation internally.
      const httpsServer = this.server.server as HttpsServer;
      if (typeof httpsServer.setSecureContext === 'function') {
        httpsServer.setSecureContext({
          key: this.opts.tls.keyPem,
          cert: this.opts.tls.certPem,
          ca: newCaBundle,
        });
        this.opts.log?.info(
          { caCount: newCaBundle.length },
          'TLS context hot-reloaded (new peer CAs active without restart)',
        );
        return true;
      }

      // Fallback: setSecureContext not available (e.g. HTTP mode in tests)
      this.opts.log?.warn('setSecureContext not available on server — restart needed');
      return false;
    } catch (err) {
      this.opts.log?.error(
        { err: err instanceof Error ? err.message : String(err) },
        'TLS context reload failed',
      );
      return false;
    }
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
      version: this.opts.buildInfo?.build_version ?? 'unknown',
      build: this.opts.buildInfo
        ? {
            version: this.opts.buildInfo.build_version,
            number: this.opts.buildInfo.build_number,
            node: this.opts.buildInfo.build_node,
            date: this.opts.buildInfo.build_date,
          }
        : undefined,
      hostname: this.opts.config.daemon.hostname,
      endpoint: `${this.protocol}://${this.opts.config.daemon.hostname}:${this.opts.config.daemon.port}`,
      publicKey: this.opts.identity.publicKeyPem,
      spiffeUri: this.opts.selfIdentityUri ?? this.opts.identity.spiffeUri,
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
      // T2.4-Folge: Self-Resource-Snapshot aus der Side-Map (undefined, falls noch keiner vorliegt).
      resources: this.opts.getNodeResources?.(),
      mesh: {
        joined_at: this.joinedAt,
        trust_level: this.useTls ? 'mtls-self-signed' : 'none',
        peers_connected: this.peerCount,
        libp2p: libp2p.enabled && 'multiplexer' in libp2p && 'nat' in libp2p ? {
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
          registry_sync: this.opts.getRegistrySyncStatus?.() ?? {},
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
        } : {
          enabled: libp2p.enabled,
          status: libp2p.status,
          peer_id: libp2p.peerId,
          listen_multiaddrs: [...libp2p.listenMultiaddrs],
          connected_peers: libp2p.connectedPeers,
          noise: libp2p.noise,
          mdns: libp2p.mdns,
          multiplexer: {
            enabled: false,
            name: null,
            protocols: [],
            open_streams: 0,
            streams_by_protocol: {},
          },
          nat: {
            enabled: false,
            reachability: 'unknown' as const,
            strategy: 'disabled' as const,
            auto_nat: false,
            relay_transport: false,
            relay_service: false,
            hole_punching: false,
            observed_multiaddrs: [],
            announce_multiaddrs: [],
            relay_reservations: 0,
            reason: libp2p.reason,
          },
          reason: libp2p.reason,
        },
      },
    };
  }
}
