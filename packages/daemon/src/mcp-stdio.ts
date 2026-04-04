#!/usr/bin/env node
/**
 * mcp-stdio.ts — Standalone MCP-Server-Einstiegspunkt fuer stdio-Transport
 *
 * Wird von AI-Agents (Claude Code, Codex) als MCP-Server gestartet:
 *
 *   npx tsx packages/daemon/src/mcp-stdio.ts
 *
 * Verbindet sich mit dem laufenden Daemon ueber die REST-API
 * und stellt Mesh-Funktionen als MCP-Tools bereit.
 *
 * Konfiguration via Env:
 *   TLMCP_DAEMON_URL=http://localhost:9440 (Default)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { systemHealth, systemProcesses, systemNetwork, systemDisk } from './builtin-skills/system-monitor.js';

const DAEMON_URL = process.env['TLMCP_DAEMON_URL'] ?? 'http://localhost:9440';

async function fetchDaemon(path: string): Promise<unknown> {
  const res = await fetch(`${DAEMON_URL}${path}`);
  if (!res.ok) throw new Error(`Daemon API error: ${res.status} ${res.statusText}`);
  return res.json();
}

async function postDaemon(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${DAEMON_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Daemon API error: ${res.status} ${res.statusText}`);
  return res.json();
}

const server = new McpServer({
  name: 'thinklocal-mcp',
  version: '0.15.0',
});

// --- Tools ---

server.tool('discover_peers', 'Listet alle verbundenen Peers im lokalen Mesh auf', {}, async () => {
  const data = await fetchDaemon('/api/peers');
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
});

server.tool(
  'query_capabilities',
  'Sucht nach Faehigkeiten (Skills) im Mesh',
  { skill_id: z.string().optional(), category: z.string().optional() },
  async ({ skill_id, category }) => {
    let path = '/api/capabilities';
    const params: string[] = [];
    if (skill_id) params.push(`skill_id=${encodeURIComponent(skill_id)}`);
    if (category) params.push(`category=${encodeURIComponent(category)}`);
    if (params.length) path += `?${params.join('&')}`;
    const data = await fetchDaemon(path);
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  },
);

server.tool('mesh_status', 'Zeigt den Gesamtstatus des Mesh-Daemons', {}, async () => {
  const data = await fetchDaemon('/api/status');
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
});

server.tool('list_tasks', 'Listet alle Tasks im Mesh', { state: z.string().optional() }, async ({ state }) => {
  const path = state ? `/api/tasks?state=${encodeURIComponent(state)}` : '/api/tasks';
  const data = await fetchDaemon(path);
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
});

server.tool(
  'list_credentials',
  'Listet Vault-Credentials (ohne Werte)',
  { category: z.string().optional() },
  async ({ category }) => {
    const path = category ? `/api/vault/credentials?category=${encodeURIComponent(category)}` : '/api/vault/credentials';
    const data = await fetchDaemon(path);
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  },
);

server.tool(
  'store_credential',
  'Speichert ein Credential im Vault (verschluesselt)',
  {
    name: z.string().describe('Name des Credentials'),
    value: z.string().describe('Wert (wird verschluesselt gespeichert)'),
    category: z.string().optional(),
    ttl_hours: z.number().optional().describe('Gueltigkeitsdauer in Stunden'),
  },
  async ({ name, value, category, ttl_hours }) => {
    const data = await postDaemon('/api/vault/credentials', { name, value, category, ttl_hours });
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  },
);

server.tool('get_audit_log', 'Zeigt die letzten Audit-Events', { limit: z.number().optional() }, async ({ limit }) => {
  const data = await fetchDaemon(`/api/audit?limit=${limit ?? 20}`);
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
});

server.tool('start_pairing', 'Startet Peer-Pairing und generiert eine PIN', {}, async () => {
  const data = await postDaemon('/pairing/start', {});
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
});

// --- Cross-Machine Skill Execution ---

server.tool(
  'execute_remote_skill',
  'Fuehrt einen Skill auf einem Remote-Peer im Mesh aus. Findet automatisch den besten Peer fuer den Skill.',
  {
    skill_id: z.string().describe('Skill-ID (z.B. "system.health", "influxdb.read")'),
    input: z.record(z.string(), z.unknown()).optional().describe('Eingabedaten fuer den Skill'),
    target_agent: z.string().optional().describe('Optional: bestimmter Agent (SPIFFE-URI). Wenn leer, wird automatisch ein Peer gewaehlt.'),
  },
  async ({ skill_id, input, target_agent }) => {
    // 1. Passenden Peer finden — suche nach exaktem Match oder Skill-Manifest das den Sub-Skill enthaelt
    // z.B. "system.health" ist ein Sub-Skill von "system-monitor"
    const capsData = await fetchDaemon('/api/capabilities') as { capabilities: Array<{ skill_id: string; agent_id: string; health: string }> };

    // Erst exakter Match, dann Prefix-Match (system.health → system-monitor weil system-monitor Tools system.* hat)
    let candidates = capsData.capabilities.filter(
      (c) => c.skill_id === skill_id && c.health === 'healthy',
    );

    // Fallback: Suche nach Manifest das den Sub-Skill enthalten koennte
    // z.B. skill_id "system.health" → suche "system-monitor" (gleicher Prefix "system")
    if (candidates.length === 0) {
      const prefix = skill_id.split('.')[0];
      candidates = capsData.capabilities.filter(
        (c) => c.skill_id.startsWith(prefix) && c.health === 'healthy',
      );
    }

    if (candidates.length === 0) {
      return { content: [{ type: 'text' as const, text: JSON.stringify({ error: `Kein Peer mit Skill '${skill_id}' gefunden. Verfuegbar: ${capsData.capabilities.map(c => c.skill_id).join(', ')}` }) }] };
    }

    // Ziel waehlen (explizit oder erster gesunder Peer)
    const target = target_agent
      ? candidates.find((c) => c.agent_id === target_agent)
      : candidates[0];

    if (!target) {
      return { content: [{ type: 'text' as const, text: JSON.stringify({ error: `Agent '${target_agent}' hat Skill '${skill_id}' nicht` }) }] };
    }

    // 2. Peer-Endpoint ermitteln
    const peersData = await fetchDaemon('/api/peers') as { peers: Array<{ agent_id: string; host: string; port: number }> };
    const peer = peersData.peers.find((p) => p.agent_id === target.agent_id);

    if (!peer) {
      // Lokaler Skill — direkt ausfuehren via Daemon-API
      const taskData = await postDaemon('/api/tasks/execute', { skill_id, input: input ?? {} });
      return { content: [{ type: 'text' as const, text: JSON.stringify(taskData, null, 2) }] };
    }

    // 3. Remote-Skill ausfuehren via Peer-API
    try {
      const peerUrl = `http://${peer.host}:${peer.port}`;
      const result = await fetch(`${peerUrl}/api/tasks/execute`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ skill_id, input: input ?? {} }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!result.ok) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: `Remote-Ausfuehrung fehlgeschlagen: ${result.status}` }) }] };
      }

      const data = await result.json();
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            executed_on: { agent_id: target.agent_id, host: peer.host, port: peer.port },
            skill_id,
            result: data,
          }, null, 2),
        }],
      };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: JSON.stringify({ error: `Verbindung zu ${peer.host}:${peer.port} fehlgeschlagen: ${err}` }) }] };
    }
  },
);

// --- Builtin Skills ---

server.tool('system_health', 'System-Monitoring: CPU, RAM, Disk, OS-Info und Uptime', {}, async () => {
  const data = await systemHealth();
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
});

server.tool(
  'system_processes',
  'Top-Prozesse sortiert nach CPU-Nutzung',
  { limit: z.number().optional().describe('Anzahl Prozesse (Default: 10)') },
  async ({ limit }) => {
    const data = await systemProcesses(limit ?? 10);
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  },
);

server.tool('system_network', 'Netzwerk-Interfaces und Traffic-Statistiken', {}, async () => {
  const data = await systemNetwork();
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
});

server.tool('system_disk', 'Dateisystem-Nutzung und Disk-I/O', {}, async () => {
  const data = await systemDisk();
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
});

// --- Start ---

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`MCP-Server Fehler: ${err}\n`);
  process.exit(1);
});
