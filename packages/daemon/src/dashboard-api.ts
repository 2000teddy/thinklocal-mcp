/**
 * dashboard-api.ts — REST-API-Endpoints für das Dashboard
 *
 * Stellt Mesh-Zustandsdaten über REST bereit:
 * - GET /api/peers         — Alle bekannten Peers mit Status
 * - GET /api/capabilities  — Alle registrierten Capabilities
 * - GET /api/tasks         — Alle Tasks mit Status
 * - GET /api/audit         — Audit-Log (paginiert)
 * - GET /api/status        — Gesamtstatus des Daemon
 *
 * Wird als Fastify-Plugin in den Agent Card Server eingehängt.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { MeshManager } from './mesh.js';
import type { CapabilityRegistry } from './registry.js';
import type { TaskManager } from './tasks.js';
import type { AuditLog } from './audit.js';
import type { AgentIdentity } from './identity.js';
import type { DaemonConfig } from './config.js';
import type { RateLimiter } from './ratelimit.js';
import type { CredentialVault } from './vault.js';
import type { TaskExecutor } from './task-executor.js';

export interface DashboardApiDeps {
  mesh: MeshManager;
  registry: CapabilityRegistry;
  tasks: TaskManager;
  audit: AuditLog;
  identity: AgentIdentity;
  config: DaemonConfig;
  rateLimiter?: RateLimiter;
  vault?: CredentialVault;
  executor?: TaskExecutor;
}

/**
 * Registriert Dashboard-REST-Endpoints auf einer Fastify-Instanz.
 */
export function registerDashboardApi(server: FastifyInstance, deps: DashboardApiDeps): void {
  const { mesh, registry, tasks, audit, identity, config, rateLimiter } = deps;

  // Rate-Limiting Middleware für alle /api/* Routen
  const checkRateLimit = (request: FastifyRequest, reply: FastifyReply): boolean => {
    if (rateLimiter && !rateLimiter.allow(request.ip)) {
      void reply.code(429).send({ error: 'Too Many Requests' });
      return false;
    }
    return true;
  };

  // GET /api/status — Gesamtstatus
  server.get('/api/status', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!checkRateLimit(request, reply)) return;
    return {
      agent_id: identity.spiffeUri,
      hostname: config.daemon.hostname,
      port: config.daemon.port,
      bind_host: config.daemon.bind_host,
      runtime_mode: config.daemon.runtime_mode,
      tls_enabled: config.daemon.tls_enabled,
      agent_type: config.daemon.agent_type,
      libp2p_enabled: config.libp2p.enabled,
      libp2p_port: config.libp2p.listen_port,
      uptime_seconds: Math.floor(process.uptime()),
      peers_online: mesh.getOnlinePeers().length,
      capabilities_count: registry.getAllCapabilities().length,
      active_tasks: tasks.getActiveTasks().length,
      audit_events: audit.count(),
    };
  });

  // GET /api/peers — Alle Peers
  server.get('/api/peers', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!checkRateLimit(request, reply)) return;
    const peers = mesh.getOnlinePeers().map((p) => ({
      agent_id: p.agentId,
      name: p.name,
      host: p.host,
      port: p.port,
      status: p.status,
      last_seen: new Date(p.lastSeen).toISOString(),
      agent_card: p.agentCard
        ? {
            name: p.agentCard.name,
            version: p.agentCard.version,
            capabilities: p.agentCard.capabilities,
            health: p.agentCard.health,
          }
        : null,
    }));
    return { peers, count: peers.length };
  });

  // GET /api/capabilities — Alle Capabilities
  server.get('/api/capabilities', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!checkRateLimit(request, reply)) return;
    const query = request.query as { skill_id?: string; category?: string; agent_id?: string };
    let capabilities = registry.getAllCapabilities();

    if (query.skill_id) {
      capabilities = capabilities.filter((c) => c.skill_id === query.skill_id);
    }
    if (query.category) {
      capabilities = capabilities.filter((c) => c.category === query.category);
    }
    if (query.agent_id) {
      capabilities = capabilities.filter((c) => c.agent_id === query.agent_id);
    }

    return {
      capabilities,
      count: capabilities.length,
      hash: registry.getCapabilityHash(),
    };
  });

  // GET /api/tasks — Alle Tasks
  server.get('/api/tasks', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!checkRateLimit(request, reply)) return;
    const query = request.query as { state?: string };
    let allTasks = tasks.getAllTasks();

    if (query.state) {
      allTasks = allTasks.filter((t) => t.state === query.state);
    }

    return {
      tasks: allTasks.map((t) => ({
        id: t.id,
        state: t.state,
        skill_id: t.skillId,
        requester: t.requester,
        executor: t.executor,
        created_at: t.createdAt,
        deadline: t.deadline,
        updated_at: t.updatedAt,
        error: t.error,
      })),
      count: allTasks.length,
    };
  });

  // GET /api/audit — Audit-Log (paginiert)
  server.get('/api/audit', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!checkRateLimit(request, reply)) return;
    const query = request.query as { limit?: string; format?: string };
    const limit = Math.min(Number(query.limit) || 50, 500);

    if (query.format === 'csv') {
      const csv = audit.exportCsv(limit);
      return reply
        .header('content-type', 'text/csv')
        .header('content-disposition', 'attachment; filename="audit.csv"')
        .send(csv);
    }

    const events = audit.getEvents(limit);
    return {
      events,
      count: events.length,
      total: audit.count(),
    };
  });

  // --- Task-Execution-Endpoint ---

  if (deps.executor) {
    const executorRef = deps.executor;

    // POST /api/tasks/execute — Fuehrt einen lokalen Skill aus und gibt das Ergebnis zurueck
    server.post('/api/tasks/execute', async (request: FastifyRequest, reply: FastifyReply) => {
      if (!checkRateLimit(request, reply)) return;
      const body = request.body as { skill_id: string; input?: Record<string, unknown> };
      if (!body.skill_id) {
        return reply.code(400).send({ error: 'skill_id required' });
      }

      // Task erstellen und sofort ausfuehren
      const task = tasks.createRequest('remote', body.skill_id, body.input ?? {});
      const result = await executorRef.handleTaskRequest(
        task.id,
        body.skill_id,
        body.input ?? {},
        'remote',
      );

      if (!result.accepted) {
        return reply.code(404).send({ error: result.error ?? 'Skill nicht verfuegbar' });
      }

      if (result.error) {
        return reply.code(500).send({ error: result.error, task_id: task.id });
      }

      return { task_id: task.id, skill_id: body.skill_id, result: result.result };
    });
  }

  // --- Vault-Endpoints ---

  if (!deps.vault) return;
  const vaultRef = deps.vault;

  // GET /api/vault/credentials — Alle Credentials (ohne Werte)
  server.get('/api/vault/credentials', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!checkRateLimit(request, reply)) return;
    const query = request.query as { category?: string };
    const credentials = vaultRef.list(query.category);
    return { credentials, count: credentials.length };
  });

  // POST /api/vault/credentials — Neues Credential speichern
  server.post('/api/vault/credentials', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!checkRateLimit(request, reply)) return;
    const body = request.body as {
      name: string;
      value: string;
      category?: string;
      tags?: string[];
      ttl_hours?: number;
    };
    if (!body.name || !body.value) {
      return reply.code(400).send({ error: 'name and value required' });
    }
    const cred = vaultRef.store(body.name, body.value, {
      category: body.category,
      tags: body.tags,
      ttlHours: body.ttl_hours,
    });
    return { credential: cred };
  });

  // DELETE /api/vault/credentials/:name — Credential entfernen
  server.delete('/api/vault/credentials/:name', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!checkRateLimit(request, reply)) return;
    const { name } = request.params as { name: string };
    const removed = vaultRef.remove(name);
    if (!removed) return reply.code(404).send({ error: 'Credential not found' });
    return { status: 'removed', name };
  });

  // GET /api/vault/approvals — Ausstehende Approval-Anfragen
  server.get('/api/vault/approvals', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!checkRateLimit(request, reply)) return;
    const pending = vaultRef.getPendingRequests();
    return { approvals: pending, count: pending.length };
  });

  // POST /api/vault/approvals/:id/approve — Anfrage genehmigen
  server.post('/api/vault/approvals/:id/approve', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!checkRateLimit(request, reply)) return;
    const { id } = request.params as { id: string };
    const approved = vaultRef.approveRequest(id);
    if (!approved) return reply.code(404).send({ error: 'Approval not found or already decided' });
    return { status: 'approved', id };
  });

  // POST /api/vault/approvals/:id/deny — Anfrage ablehnen
  server.post('/api/vault/approvals/:id/deny', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!checkRateLimit(request, reply)) return;
    const { id } = request.params as { id: string };
    const denied = vaultRef.denyRequest(id);
    if (!denied) return reply.code(404).send({ error: 'Approval not found or already decided' });
    return { status: 'denied', id };
  });
}
