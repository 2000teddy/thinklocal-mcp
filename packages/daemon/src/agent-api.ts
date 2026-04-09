/**
 * ADR-004 Phase 2 — Agent Registry REST Endpoints
 *
 * Exposes the AgentRegistry over a small set of loopback-only REST
 * endpoints so each locally-running agent-instance (Claude Code,
 * Codex, Gemini CLI, …) can announce itself to the daemon and keep
 * its entry alive via heartbeats:
 *
 *   POST /api/agent/register       — initial handshake, returns the
 *                                    canonical SPIFFE URI + heartbeat
 *                                    interval + inbox schema version
 *   POST /api/agent/heartbeat      — refresh lastHeartbeatAt
 *   POST /api/agent/unregister     — clean shutdown (optional; stale
 *                                    sweep catches agents that crash)
 *   GET  /api/agent/instances      — read-only list for debugging + UI
 *
 * SECURITY: all routes are loopback-only (PR #83 pattern). A remote
 * peer calling any of these would be able to impersonate a local
 * agent-instance, which defeats ADR-005's per-agent-inbox isolation.
 *
 * See: docs/architecture/ADR-004-cron-heartbeat.md §"Phase 2"
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Logger } from 'pino';
import { AgentRegistryFullError, type AgentRegistry, type AgentRegistryEntry } from './agent-registry.js';
import type { AuditLog } from './audit.js';

export interface AgentApiDeps {
  registry: AgentRegistry;
  audit: AuditLog;
  /** 3-component SPIFFE URI of this daemon (without instance part). */
  daemonSpiffeUri: string;
  /** Current inbox schema version echoed to clients at registration. */
  inboxSchemaVersion: number;
  log?: Logger;
}

interface RegisterBody {
  agent_type?: string;
  instance_id?: string;
  pid?: number;
  cli_version?: string;
}

interface HeartbeatBody {
  instance_id?: string;
}

interface UnregisterBody {
  instance_id?: string;
}

function requireLocal(request: FastifyRequest, reply: FastifyReply): boolean {
  const ip = request.ip;
  const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  if (!isLocal) {
    void reply.code(403).send({ error: 'agent API is local-only', remote: ip });
    return false;
  }
  return true;
}

/**
 * Build the 4-component SPIFFE URI from the daemon's 3-component URI
 * and an instance id. We hand this back to the client so it always
 * uses the canonical form as its own identity (forward-compat with
 * ADR-005's per-agent-inbox filter).
 */
/**
 * Build the 4-component SPIFFE URI. Returns `null` on a malformed
 * daemon URI — the REST handler surfaces that as HTTP 500 with a
 * specific error so the operator notices the misconfiguration
 * instead of silently emitting a mangled URI. (Gemini-Pro CR finding
 * 2026-04-09, LOW)
 */
function buildInstanceSpiffe(
  daemonSpiffeUri: string,
  agentType: string,
  instanceId: string,
): string | null {
  // daemonSpiffeUri looks like: spiffe://thinklocal/host/<node>/agent/<type>
  const parts = daemonSpiffeUri.replace(/\/$/, '').split('/');
  const hostIdx = parts.lastIndexOf('host');
  if (hostIdx < 0 || hostIdx + 1 >= parts.length) {
    return null;
  }
  const nodeId = parts[hostIdx + 1];
  if (!nodeId) return null;
  return `spiffe://thinklocal/host/${nodeId}/agent/${agentType}/instance/${instanceId}`;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128;
}

export function registerAgentApi(server: FastifyInstance, deps: AgentApiDeps): void {
  const { registry, audit, daemonSpiffeUri, inboxSchemaVersion, log } = deps;

  // Forward stale evictions to the audit log so the operator can see
  // which agent instances disappeared without a clean unregister.
  registry.on((reason, entry) => {
    if (reason === 'stale') {
      audit.append('AGENT_STALE', entry.spiffeUri, entry.instanceId);
    }
  });

  server.post('/api/agent/register', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireLocal(request, reply)) return;
    const body = request.body as RegisterBody | undefined;
    if (!body || typeof body !== 'object') {
      return reply.code(400).send({ error: 'missing JSON body' });
    }
    if (!isNonEmptyString(body.agent_type)) {
      return reply.code(400).send({ error: 'agent_type required (string, <=128 chars)' });
    }
    if (!isNonEmptyString(body.instance_id)) {
      return reply.code(400).send({ error: 'instance_id required (string, <=128 chars)' });
    }
    // Reject ids that would break SPIFFE-URI formatting.
    if (!/^[A-Za-z0-9._-]+$/.test(body.instance_id)) {
      return reply
        .code(400)
        .send({ error: 'instance_id must match [A-Za-z0-9._-]+' });
    }
    if (!/^[A-Za-z0-9._-]+$/.test(body.agent_type)) {
      return reply
        .code(400)
        .send({ error: 'agent_type must match [A-Za-z0-9._-]+' });
    }

    const spiffeUri = buildInstanceSpiffe(daemonSpiffeUri, body.agent_type, body.instance_id);
    if (!spiffeUri) {
      log?.error(
        { daemonSpiffeUri },
        '[agent-api] cannot build instance SPIFFE URI from malformed daemon URI',
      );
      return reply.code(500).send({
        error: 'daemon misconfiguration: cannot derive instance SPIFFE URI',
      });
    }
    const existing = registry.get(body.instance_id);
    if (existing && existing.agentType !== body.agent_type) {
      return reply.code(409).send({
        error: 'instance_id already registered with a different agent_type',
        existing_agent_type: existing.agentType,
      });
    }

    try {
      const entry = registry.register({
        instanceId: body.instance_id,
        agentType: body.agent_type,
        spiffeUri,
        pid: typeof body.pid === 'number' ? body.pid : undefined,
        cliVersion: isNonEmptyString(body.cli_version) ? body.cli_version : undefined,
      });
      audit.append('AGENT_REGISTER', entry.spiffeUri, entry.instanceId);
      log?.debug({ instanceId: entry.instanceId }, '[agent-api] register');

      return reply.send({
        instance_spiffe_uri: entry.spiffeUri,
        heartbeat_interval_ms: registry.getHeartbeatIntervalMs(),
        inbox_schema_version: inboxSchemaVersion,
      });
    } catch (err) {
      if (err instanceof AgentRegistryFullError) {
        return reply.code(503).send({
          error: 'agent registry is full — retry later',
          max_entries: err.maxEntries,
        });
      }
      throw err;
    }
  });

  server.post('/api/agent/heartbeat', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireLocal(request, reply)) return;
    const body = request.body as HeartbeatBody | undefined;
    if (!body || !isNonEmptyString(body.instance_id)) {
      return reply.code(400).send({ error: 'instance_id required' });
    }
    // `heartbeat()` returns the entry itself so we can append the
    // audit event in the same tick — no risk of a concurrent sweep
    // evicting the row between update and read.
    const entry = registry.heartbeat(body.instance_id);
    if (!entry) {
      // 404 tells the client "you've been evicted, re-register".
      return reply.code(404).send({ error: 'unknown instance_id — re-register required' });
    }
    audit.append('AGENT_HEARTBEAT', entry.spiffeUri, entry.instanceId);
    return reply.send({ status: 'ok' });
  });

  server.post('/api/agent/unregister', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireLocal(request, reply)) return;
    const body = request.body as UnregisterBody | undefined;
    if (!body || !isNonEmptyString(body.instance_id)) {
      return reply.code(400).send({ error: 'instance_id required' });
    }
    // Atomic: `unregister` returns the removed entry in the same tick
    // so a concurrent call cannot steal the audit-event window.
    const removed = registry.unregister(body.instance_id);
    if (removed) {
      audit.append('AGENT_UNREGISTER', removed.spiffeUri, removed.instanceId);
    }
    // 200 either way — idempotent semantics.
    return reply.send({ status: 'ok', existed: removed !== undefined });
  });

  server.get('/api/agent/instances', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireLocal(request, reply)) return;
    const instances = registry.list().map((e: AgentRegistryEntry) => ({
      instance_id: e.instanceId,
      agent_type: e.agentType,
      spiffe_uri: e.spiffeUri,
      pid: e.pid ?? null,
      cli_version: e.cliVersion ?? null,
      registered_at: new Date(e.registeredAt).toISOString(),
      last_heartbeat_at: new Date(e.lastHeartbeatAt).toISOString(),
    }));
    return reply.send({
      count: instances.length,
      heartbeat_interval_ms: registry.getHeartbeatIntervalMs(),
      instances,
    });
  });
}
