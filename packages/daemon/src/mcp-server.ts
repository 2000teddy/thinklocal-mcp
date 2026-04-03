/**
 * mcp-server.ts — MCP Server fuer AI-Agent-Integration
 *
 * Stellt das thinklocal-mcp Mesh als MCP-Server bereit.
 * AI-Agents (Claude Code, Codex, Gemini CLI) koennen ueber
 * stdio-Transport auf Mesh-Funktionen zugreifen.
 *
 * MCP Tools:
 * - discover_peers: Alle verbundenen Peers auflisten
 * - query_capabilities: Faehigkeiten im Mesh suchen
 * - get_agent_card: Agent Card eines Peers abrufen
 * - delegate_task: Task an einen Peer delegieren
 * - list_credentials: Vault-Credentials auflisten
 * - mesh_status: Gesamtstatus des Meshes
 *
 * MCP Resources:
 * - mesh://peers — Live-Peer-Liste
 * - mesh://capabilities — Capability-Registry
 * - mesh://audit — Audit-Log
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { MeshManager } from './mesh.js';
import type { CapabilityRegistry } from './registry.js';
import type { TaskManager } from './tasks.js';
import type { CredentialVault } from './vault.js';
import type { AuditLog } from './audit.js';
import type { SkillManager } from './skills.js';
import type { AgentIdentity } from './identity.js';
import type { DaemonConfig } from './config.js';
import type { Logger } from 'pino';

export interface McpServerDeps {
  mesh: MeshManager;
  registry: CapabilityRegistry;
  tasks: TaskManager;
  vault: CredentialVault;
  audit: AuditLog;
  skills: SkillManager;
  identity: AgentIdentity;
  config: DaemonConfig;
  log?: Logger;
}

/**
 * Erstellt und konfiguriert den MCP-Server mit allen Mesh-Tools.
 */
export function createMcpServer(deps: McpServerDeps): McpServer {
  const { mesh, registry, tasks, vault, audit, skills, identity, config, log } = deps;

  const server = new McpServer({
    name: 'thinklocal-mcp',
    version: '0.15.0',
  });

  // --- Tools ---

  // discover_peers: Alle Peers im Mesh
  server.tool('discover_peers', 'Listet alle verbundenen Peers im lokalen Mesh auf', {}, async () => {
    const peers = mesh.getOnlinePeers().map((p) => ({
      agent_id: p.agentId,
      name: p.name,
      host: p.host,
      port: p.port,
      status: p.status,
      capabilities: p.agentCard?.capabilities?.agents ?? [],
    }));
    return { content: [{ type: 'text' as const, text: JSON.stringify({ peers, count: peers.length }, null, 2) }] };
  });

  // query_capabilities: Faehigkeiten suchen
  server.tool(
    'query_capabilities',
    'Sucht nach Faehigkeiten (Skills) im Mesh. Kann nach skill_id oder category filtern.',
    { skill_id: z.string().optional(), category: z.string().optional() },
    async ({ skill_id, category }) => {
      let caps = registry.getAllCapabilities();
      if (skill_id) caps = caps.filter((c) => c.skill_id.includes(skill_id));
      if (category) caps = caps.filter((c) => c.category === category);

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            capabilities: caps.map((c) => ({
              skill_id: c.skill_id,
              version: c.version,
              agent_id: c.agent_id,
              health: c.health,
              category: c.category,
              description: c.description,
            })),
            count: caps.length,
            hash: registry.getCapabilityHash(),
          }, null, 2),
        }],
      };
    },
  );

  // get_agent_card: Agent Card eines Peers
  server.tool(
    'get_agent_card',
    'Ruft die Agent Card eines bestimmten Peers ab (Health, Capabilities, Endpoint)',
    { agent_id: z.string() },
    async ({ agent_id }) => {
      const peer = mesh.getPeer(agent_id);
      if (!peer?.agentCard) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Peer not found or no agent card' }) }] };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(peer.agentCard, null, 2) }] };
    },
  );

  // delegate_task: Task an Peer delegieren
  server.tool(
    'delegate_task',
    'Delegiert einen Task an einen anderen Agent im Mesh',
    {
      skill_id: z.string().describe('Benoetigter Skill'),
      input: z.record(z.string(), z.unknown()).describe('Eingabedaten fuer den Task'),
      deadline_ms: z.number().optional().describe('Deadline in Millisekunden'),
    },
    async ({ skill_id, input, deadline_ms }) => {
      const task = tasks.createRequest(identity.spiffeUri, skill_id, input, deadline_ms);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            task_id: task.id,
            state: task.state,
            skill_id: task.skillId,
            message: 'Task erstellt. Warte auf Accept von einem Peer mit diesem Skill.',
          }, null, 2),
        }],
      };
    },
  );

  // list_credentials: Vault-Credentials
  server.tool(
    'list_credentials',
    'Listet alle gespeicherten Credentials im Vault (ohne Werte)',
    { category: z.string().optional() },
    async ({ category }) => {
      const creds = vault.list(category);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            credentials: creds.map((c) => ({
              name: c.name,
              category: c.category,
              tags: c.tags,
              access_count: c.accessCount,
              expires_at: c.expiresAt,
            })),
            count: creds.length,
          }, null, 2),
        }],
      };
    },
  );

  // mesh_status: Gesamtstatus
  server.tool('mesh_status', 'Zeigt den Gesamtstatus des Mesh-Daemons', {}, async () => {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          agent_id: identity.spiffeUri,
          hostname: config.daemon.hostname,
          port: config.daemon.port,
          peers_online: mesh.getOnlinePeers().length,
          capabilities: registry.getAllCapabilities().length,
          active_tasks: tasks.getActiveTasks().length,
          local_skills: skills.getLocalSkills().length,
          vault_credentials: vault.list().length,
          audit_events: audit.count(),
          uptime_seconds: Math.floor(process.uptime()),
        }, null, 2),
      }],
    };
  });

  // list_skills: Lokale und Remote-Skills
  server.tool('list_skills', 'Listet alle bekannten Skills (lokal und remote)', {}, async () => {
    const local = skills.getLocalSkills();
    const all = registry.getAllCapabilities();
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          local_skills: local.map((s) => ({ id: s.id, version: s.version, tools: s.tools })),
          all_capabilities: all.map((c) => ({ skill_id: c.skill_id, agent_id: c.agent_id, health: c.health })),
        }, null, 2),
      }],
    };
  });

  log?.info('MCP-Server konfiguriert mit 7 Tools');
  return server;
}

/**
 * Startet den MCP-Server ueber stdio-Transport.
 * Wird als separater Prozess gestartet, z.B.:
 *   node dist/mcp-stdio.js
 */
export async function startMcpStdio(deps: McpServerDeps): Promise<void> {
  const server = createMcpServer(deps);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  deps.log?.info('MCP-Server ueber stdio gestartet');
}
