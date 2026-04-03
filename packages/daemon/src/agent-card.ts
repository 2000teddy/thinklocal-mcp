import Fastify, { type FastifyInstance } from 'fastify';
import * as si from 'systeminformation';
import type { AgentIdentity } from './identity.js';
import type { DaemonConfig } from './config.js';
import type { NodeCertBundle } from './tls.js';
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

export interface AgentCardServerOptions {
  identity: AgentIdentity;
  config: DaemonConfig;
  tls?: NodeCertBundle;
  log?: Logger;
}

export class AgentCardServer {
  private server: FastifyInstance;
  private joinedAt: string;
  private peerCount = 0;
  private useTls: boolean;

  constructor(private opts: AgentCardServerOptions) {
    this.joinedAt = new Date().toISOString();
    this.useTls = !!opts.tls;

    const serverOpts: Record<string, unknown> = { logger: false };

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

    this.server.get('/.well-known/agent-card.json', async () => {
      return this.buildCard();
    });

    this.server.get('/health', async () => {
      return { status: 'ok', timestamp: new Date().toISOString() };
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
