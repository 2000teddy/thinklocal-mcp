/** API-Client fuer das thinklocal-mcp Dashboard */

export interface DaemonStatus {
  agent_id: string;
  hostname: string;
  port: number;
  agent_type: string;
  uptime_seconds: number;
  peers_online: number;
  capabilities_count: number;
  active_tasks: number;
  audit_events: number;
}

export interface Peer {
  agent_id: string;
  name: string;
  host: string;
  port: number;
  status: string;
  last_seen: string;
  agent_card: {
    name: string;
    version: string;
    capabilities: {
      agents: string[];
      skills: string[];
    };
    health: {
      cpu_percent: number;
      memory_percent: number;
      disk_percent: number;
      uptime_seconds: number;
    };
  } | null;
}

export interface Capability {
  skill_id: string;
  version: string;
  description: string;
  agent_id: string;
  health: string;
  trust_level: number;
  updated_at: string;
  category: string;
}

export interface Task {
  id: string;
  state: string;
  skill_id: string;
  requester: string;
  executor: string | null;
  created_at: string;
  deadline: string | null;
  updated_at: string;
  error: string | null;
}

export interface AuditEvent {
  id: number;
  timestamp: string;
  event_type: string;
  agent_id: string;
  peer_id: string | null;
  details: string | null;
}

export interface PairingStatus {
  active_session: {
    state: string;
    peer: string | null;
    age_seconds: number;
  } | null;
  paired_peers: Array<{
    agent_id: string;
    hostname: string;
    paired_at: string;
  }>;
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  getStatus: () => fetchJson<DaemonStatus>('/api/status'),
  getPeers: () => fetchJson<{ peers: Peer[]; count: number }>('/api/peers'),
  getCapabilities: () => fetchJson<{ capabilities: Capability[]; count: number; hash: string }>('/api/capabilities'),
  getTasks: () => fetchJson<{ tasks: Task[]; count: number }>('/api/tasks'),
  getAudit: (limit = 50) => fetchJson<{ events: AuditEvent[]; count: number; total: number }>(`/api/audit?limit=${limit}`),
  getPairingStatus: () => fetchJson<PairingStatus>('/pairing/status'),
  startPairing: () => fetch('/pairing/start', { method: 'POST' }).then(r => r.json()) as Promise<{ pin: string; expires_in_seconds: number }>,
};
