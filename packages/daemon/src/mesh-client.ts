/**
 * mesh-client.ts — HTTP-Client fuer den lokalen Mesh-Daemon
 *
 * Abstrahiert alle HTTP-Aufrufe zum Daemon.
 * Wird von Adaptern (MCP, REST, CLI) als einheitliche Schnittstelle genutzt.
 */

export interface PeerInfo {
  name: string;
  host: string;
  port: number;
  agentId: string;
  status: string;
  agentCard?: Record<string, unknown>;
}

export interface SkillExecutionResult {
  success: boolean;
  result?: Record<string, unknown>;
  error?: string;
}

export interface CredentialInfo {
  name: string;
  category: string;
  created_at: string;
  expires_at?: string;
}

export interface CapabilityInfo {
  skill_id: string;
  version: string;
  agent_id: string;
  health: string;
  description: string;
}

export interface MeshStatus {
  agent_id: string;
  hostname: string;
  port: number;
  uptime_seconds: number;
  peers_online: number;
  capabilities_count: number;
  active_tasks: number;
}

export interface MeshClientConfig {
  baseUrl: string;
  timeoutMs?: number;
}

/**
 * HTTP-Client fuer den Mesh-Daemon.
 * Single Source of Truth fuer alle Daemon-API-Aufrufe.
 */
export class MeshDaemonClient {
  private baseUrl: string;
  private timeoutMs: number;

  constructor(config: MeshClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.timeoutMs = config.timeoutMs ?? 10_000;
  }

  async getStatus(): Promise<MeshStatus> {
    return this.get<MeshStatus>('/api/status');
  }

  async listPeers(): Promise<PeerInfo[]> {
    const data = await this.get<{ peers: PeerInfo[] }>('/api/peers');
    return data.peers;
  }

  async executeSkill(skillId: string, input?: Record<string, unknown>): Promise<SkillExecutionResult> {
    return this.post<SkillExecutionResult>('/api/tasks/execute', {
      skill_id: skillId,
      input: input ?? {},
    });
  }

  async listCapabilities(): Promise<CapabilityInfo[]> {
    const data = await this.get<{ capabilities: CapabilityInfo[] }>('/api/capabilities');
    return data.capabilities;
  }

  async listCredentials(): Promise<CredentialInfo[]> {
    const data = await this.get<{ credentials: CredentialInfo[] }>('/api/vault');
    return data.credentials;
  }

  async storeCredential(name: string, value: string, category?: string): Promise<void> {
    await this.post('/api/vault', { name, value, category });
  }

  async getAuditEvents(limit = 20): Promise<Array<Record<string, unknown>>> {
    const data = await this.get<{ events: Array<Record<string, unknown>> }>(`/api/audit?limit=${limit}`);
    return data.events;
  }

  // --- Interne HTTP-Methoden ---

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`GET ${path}: ${res.status} ${res.statusText}`);
    return (await res.json()) as T;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`POST ${path}: ${res.status} ${res.statusText}`);
    return (await res.json()) as T;
  }
}
