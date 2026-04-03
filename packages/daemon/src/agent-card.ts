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
import type { Logger } from 'pino';

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
  mesh: {
    joined_at: string;
    trust_level: string;
    peers_connected: number;
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
}

export class AgentCardServer {
  private server: FastifyInstance;
  private joinedAt: string;
  private peerCount = 0;
  private useTls: boolean;

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

    this.server.get('/.well-known/agent-card.json', async () => {
      return this.buildCard();
    });

    this.server.get('/health', async () => {
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

  async start(): Promise<void> {
    await this.server.listen({
      port: this.opts.config.daemon.port,
      host: '0.0.0.0',
    });
    const proto = this.useTls ? 'HTTPS (mTLS)' : 'HTTP';
    this.opts.log?.info({ port: this.opts.config.daemon.port, proto }, 'Agent Card Server gestartet');
  }

  async stop(): Promise<void> {
    await this.server.close();
    this.opts.log?.info('Agent Card Server gestoppt');
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
      mesh: {
        joined_at: this.joinedAt,
        trust_level: this.useTls ? 'mtls-self-signed' : 'none',
        peers_connected: this.peerCount,
      },
    };
  }
}
