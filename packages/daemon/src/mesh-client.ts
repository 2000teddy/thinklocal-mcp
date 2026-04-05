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
  /** Maximale Retry-Versuche bei transienten Fehlern (default: 3) */
  maxRetries?: number;
  /** Basis-Wartezeit in ms fuer exponential backoff (default: 500) */
  retryBaseMs?: number;
}

/**
 * HTTP-Client fuer den Mesh-Daemon.
 * Single Source of Truth fuer alle Daemon-API-Aufrufe.
 */
/** Transiente HTTP-Statuscodes die einen Retry rechtfertigen */
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

/** Transiente Fehlertypen (Netzwerk) */
function isTransientError(err: unknown): boolean {
  if (err instanceof TypeError) return true; // fetch network error
  if (err instanceof DOMException && err.name === 'AbortError') return false; // Timeout = kein Retry
  const msg = String(err);
  return msg.includes('ECONNREFUSED') || msg.includes('ECONNRESET') || msg.includes('ETIMEDOUT');
}

export class MeshDaemonClient {
  private baseUrl: string;
  private timeoutMs: number;
  private maxRetries: number;
  private retryBaseMs: number;

  constructor(config: MeshClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.timeoutMs = config.timeoutMs ?? 10_000;
    this.maxRetries = config.maxRetries ?? 3;
    this.retryBaseMs = config.retryBaseMs ?? 500;
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
    return this.withRetry(async () => {
      const res = await fetch(`${this.baseUrl}${path}`, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) {
        if (RETRYABLE_STATUS.has(res.status)) {
          throw Object.assign(new Error(`GET ${path}: ${res.status} ${res.statusText}`), { retryable: true });
        }
        throw new Error(`GET ${path}: ${res.status} ${res.statusText}`);
      }
      return (await res.json()) as T;
    });
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.withRetry(async () => {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) {
        if (RETRYABLE_STATUS.has(res.status)) {
          throw Object.assign(new Error(`POST ${path}: ${res.status} ${res.statusText}`), { retryable: true });
        }
        throw new Error(`POST ${path}: ${res.status} ${res.statusText}`);
      }
      return (await res.json()) as T;
    });
  }

  /**
   * Fuehrt eine Operation mit exponential backoff Retry aus.
   * Nur transiente Fehler (Netzwerk, 5xx, 429) werden wiederholt.
   */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err as Error;
        const shouldRetry = (err as { retryable?: boolean }).retryable || isTransientError(err);
        if (!shouldRetry || attempt >= this.maxRetries) break;

        // Exponential backoff mit Jitter
        const delay = this.retryBaseMs * Math.pow(2, attempt) + Math.random() * 100;
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    throw lastError;
  }
}
