import Fastify, { type FastifyInstance } from 'fastify';
import * as si from 'systeminformation';
import type { AgentIdentity } from './identity.js';
import type { DaemonConfig } from './config.js';
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

export class AgentCardServer {
  private server: FastifyInstance;
  private joinedAt: string;
  private peerCount = 0;

  constructor(
    private identity: AgentIdentity,
    private config: DaemonConfig,
    private log?: Logger,
  ) {
    this.joinedAt = new Date().toISOString();

    this.server = Fastify({
      logger: false,
    });

    this.server.get('/.well-known/agent-card.json', async () => {
      return this.buildCard();
    });

    this.server.get('/health', async () => {
      return { status: 'ok', timestamp: new Date().toISOString() };
    });
  }

  setPeerCount(count: number): void {
    this.peerCount = count;
  }

  async start(): Promise<void> {
    await this.server.listen({
      port: this.config.daemon.port,
      host: '0.0.0.0',
    });
    this.log?.info({ port: this.config.daemon.port }, 'Agent Card Server gestartet');
  }

  async stop(): Promise<void> {
    await this.server.close();
    this.log?.info('Agent Card Server gestoppt');
  }

  getAddress(): string {
    const addr = this.server.addresses();
    if (addr.length > 0) {
      return `http://${this.config.daemon.hostname}:${addr[0].port}`;
    }
    return `http://${this.config.daemon.hostname}:${this.config.daemon.port}`;
  }

  private async buildCard(): Promise<AgentCard> {
    const [cpuLoad, mem, disk] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.fsSize(),
    ]);

    const diskUsed = disk.length > 0 ? (disk[0].use ?? 0) : 0;

    return {
      name: `${this.config.daemon.hostname}-${this.config.daemon.agent_type}`,
      version: '0.1.0',
      hostname: this.config.daemon.hostname,
      endpoint: `http://${this.config.daemon.hostname}:${this.config.daemon.port}`,
      publicKey: this.identity.publicKeyPem,
      spiffeUri: this.identity.spiffeUri,
      capabilities: {
        agents: [this.config.daemon.agent_type],
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
        trust_level: 'self-signed',
        peers_connected: this.peerCount,
      },
    };
  }
}
