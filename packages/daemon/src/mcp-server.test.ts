// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * mcp-server.test.ts — TL-21 Slice 2: MCP-Tool `list_capabilities_overview`.
 *
 * Testet das ECHTE registrierte MCP-Tool (über `_registeredTools[name].handler`), nicht nur die reine
 * Funktion (die ist in `capability-skeleton.test.ts` erschöpfend abgedeckt). Ziel: (a) das Tool ist unter
 * dem exakten Namen registriert, (b) sein content ist EXAKT `buildCapabilityOverview(registry.getAllCapabilities())`
 * — derselbe gemeinsame Envelope-Builder, den auch REST `GET /api/capabilities/overview` benutzt, sodass
 * beide Oberflächen strukturell nicht driften können (CR-MEDIUM-Fix). Nur `registry` wird vom getesteten
 * Tool benutzt; die übrigen Deps sind Stubs (deren Handler laufen in diesem Test nicht).
 */
import { describe, it, expect } from 'vitest';
import { createMcpServer } from './mcp-server.js';
import { buildCapabilityOverview } from './capability-skeleton.js';
import { buildPeerOverview } from './peer-skeleton.js';
import { buildTaskOverview } from './task-skeleton.js';
import type { Capability } from './registry.js';
import type { MeshPeer, PeerStatus } from './mesh.js';
import type { AgentCard } from './agent-card.js';
import type { Task, TaskState } from './tasks.js';

type Deps = Parameters<typeof createMcpServer>[0];

function cap(p: Partial<Capability> & { skill_id: string; agent_id: string }): Capability {
  return {
    version: '1.0.0',
    description: '',
    health: 'healthy',
    trust_level: 3,
    updated_at: '2026-07-16T00:00:00.000Z',
    category: 'misc',
    permissions: [],
    ...p,
  } as Capability;
}

interface RegisteredTool {
  description?: string;
  handler: (
    args: unknown,
    extra: unknown,
  ) => Promise<{ content: Array<{ type: string; text: string }> }>;
}

function getTool(server: unknown, name: string): RegisteredTool {
  const tools = (server as { _registeredTools: Record<string, RegisteredTool> })._registeredTools;
  const tool = tools[name];
  if (!tool) throw new Error(`MCP-Tool ${name} nicht registriert`);
  return tool;
}

function makeServer(caps: Capability[]): ReturnType<typeof createMcpServer> {
  const registry = {
    getAllCapabilities: (): Capability[] => caps,
    getCapabilityHash: (): string => 'testhash',
  };
  const deps = {
    mesh: {},
    registry,
    tasks: {},
    vault: {},
    audit: {},
    skills: {},
    identity: {},
    config: {},
  } as unknown as Deps;
  return createMcpServer(deps);
}

async function callOverview(caps: Capability[]): Promise<{ skills: unknown[]; count: number }> {
  const server = makeServer(caps);
  const res = await getTool(server, 'list_capabilities_overview').handler({}, {});
  expect(res.content[0].type).toBe('text');
  return JSON.parse(res.content[0].text) as { skills: unknown[]; count: number };
}

describe('MCP list_capabilities_overview (TL-21 Slice 2)', () => {
  it('ist unter dem exakten Namen registriert', () => {
    const server = makeServer([]);
    expect(getTool(server, 'list_capabilities_overview')).toBeTruthy();
  });

  it('content ist EXAKT buildCapabilityOverview(registry) — Envelope-Parität mit REST', async () => {
    const caps = [
      cap({
        skill_id: 'net.scan',
        agent_id: 'a1',
        description: 'Scannt das Netz. Mehr Details hier.',
        category: 'network',
      }),
      cap({
        skill_id: 'net.scan',
        agent_id: 'a2',
        description: 'Duplikat anderer Provider.',
        health: 'degraded',
      }),
      cap({ skill_id: 'fs.read', agent_id: 'a1', description: 'Liest Dateien.' }),
    ];
    const payload = await callOverview(caps);
    // Gegen den GEMEINSAMEN Envelope-Builder (den auch der REST-Endpoint aufruft) → deckt Envelope-Drift auf.
    expect(payload).toEqual(buildCapabilityOverview(caps));
    expect(payload.count).toBe(payload.skills.length);
  });

  it('leere Registry → { skills: [], count: 0 } (wirft nicht)', async () => {
    expect(await callOverview([])).toEqual({ skills: [], count: 0 });
  });

  it('malformed Laufzeitdaten kippen das Tool nicht (Totalität wie Slice 1)', async () => {
    // Non-string description/skill_id (runtime-untyped CRDT) — Tool bleibt bounded/total, kein throw.
    const caps = [
      cap({ skill_id: 'ok.skill', agent_id: 'a1', description: 'Sauber.' }),
      cap({ skill_id: 'bad.desc', agent_id: 'a2', description: 123 as unknown as string }),
      cap({
        skill_id: '' as unknown as string,
        agent_id: 'a3',
        description: 'Leerer Key wird übersprungen.',
      }),
    ];
    const payload = await callOverview(caps);
    expect(payload).toEqual(buildCapabilityOverview(caps));
  });
});

// --- list_peers_overview (TL-21 Peer-Slice, MCP-Companion zu REST GET /api/peers/overview) ---

/** Minimal-Agent-Card mit nur den vom Peer-Skelett gelesenen Feldern (analog peer-skeleton.test). */
function peerCard(
  p: { version?: string; skills?: string[]; load_percent?: number } = {},
): AgentCard {
  return {
    name: 'card-name',
    version: p.version ?? '1.0.0',
    capabilities: { agents: [], skills: p.skills ?? [], services: [], connectors: [] },
    worker: {
      active_tasks: 0,
      completed_tasks: 0,
      failed_tasks: 0,
      load_percent: p.load_percent ?? 0,
    },
  } as unknown as AgentCard;
}

function peer(p: Partial<MeshPeer> & { agentId: string }): MeshPeer {
  return {
    name: p.name ?? p.agentId,
    host: '10.10.10.1',
    port: 9440,
    endpoint: 'https://10.10.10.1:9440',
    status: 'online' as PeerStatus,
    lastSeen: 0,
    missedBeats: 0,
    agentCard: null,
    libp2p: {
      peerId: null,
      peerIdVerified: false,
      listenMultiaddrs: [],
      connected: false,
      status: 'unavailable',
    },
    ...p,
  } as MeshPeer;
}

function makePeerServer(peers: MeshPeer[]): ReturnType<typeof createMcpServer> {
  const deps = {
    // Nur mesh.getOnlinePeers() wird vom getesteten Tool benutzt; Rest sind Stubs.
    mesh: { getOnlinePeers: (): MeshPeer[] => peers },
    registry: {},
    tasks: {},
    vault: {},
    audit: {},
    skills: {},
    identity: {},
    config: {},
  } as unknown as Deps;
  return createMcpServer(deps);
}

async function callPeerOverview(peers: MeshPeer[]): Promise<{ peers: unknown[]; count: number }> {
  const server = makePeerServer(peers);
  const res = await getTool(server, 'list_peers_overview').handler({}, {});
  expect(res.content[0].type).toBe('text');
  return JSON.parse(res.content[0].text) as { peers: unknown[]; count: number };
}

describe('MCP list_peers_overview (TL-21 Peer-Slice)', () => {
  it('ist unter dem exakten Namen registriert', () => {
    expect(getTool(makePeerServer([]), 'list_peers_overview')).toBeTruthy();
  });

  it('content ist EXAKT buildPeerOverview(mesh.getOnlinePeers()) — Envelope-Parität mit REST', async () => {
    const peers = [
      peer({
        agentId: 'b',
        name: 'Beta',
        agentCard: peerCard({ version: '2.1.0', skills: ['s1', 's2'], load_percent: 42 }),
      }),
      peer({ agentId: 'a', name: 'Alpha', status: 'offline' as PeerStatus }),
    ];
    const payload = await callPeerOverview(peers);
    // Gegen den GEMEINSAMEN Envelope-Builder (den auch der REST-Endpoint aufruft) → deckt Envelope-Drift auf.
    expect(payload).toEqual(buildPeerOverview(peers));
    expect(payload.count).toBe(payload.peers.length);
  });

  it('leeres Mesh → { peers: [], count: 0 } (wirft nicht)', async () => {
    expect(await callPeerOverview([])).toEqual({ peers: [], count: 0 });
  });

  it('malformed Wire-Card-Daten kippen das Tool nicht (Totalität wie REST)', async () => {
    // Geforgte Card-Felder (non-string version, non-array skills, unbekannter status) — Tool bleibt total, kein throw.
    const forged = {
      version: 123,
      capabilities: { skills: 'nope' },
      worker: { load_percent: 'x' },
    } as unknown as AgentCard;
    const peers = [
      peer({ agentId: 'ok', name: 'Sauber', agentCard: peerCard({ skills: ['s1'] }) }),
      peer({ agentId: 'bad', name: 'Geforgt', status: 'weird' as PeerStatus, agentCard: forged }),
    ];
    const payload = await callPeerOverview(peers);
    expect(payload).toEqual(buildPeerOverview(peers));
  });
});

// --- list_tasks_overview (TL-21 Slice 5, MCP-Companion zu REST GET /api/tasks/overview) ---

function task(p: Partial<Task> & { id: string }): Task {
  return {
    correlationId: p.id,
    requester: 'spiffe://thinklocal/host/h/agent/req',
    executor: null,
    state: 'requested' as TaskState,
    skillId: 'skill.default',
    input: {},
    result: null,
    error: null,
    createdAt: '2026-07-21T09:00:00.000Z',
    deadline: null,
    updatedAt: '2026-07-21T09:00:00.000Z',
    ...p,
  } as Task;
}

function makeTaskServer(tasks: Task[]): ReturnType<typeof createMcpServer> {
  const deps = {
    // Nur tasks.getAllTasks() wird vom getesteten Tool benutzt; Rest sind Stubs.
    mesh: {},
    registry: {},
    tasks: { getAllTasks: (): Task[] => tasks },
    vault: {},
    audit: {},
    skills: {},
    identity: {},
    config: {},
  } as unknown as Deps;
  return createMcpServer(deps);
}

async function callTaskOverview(
  tasks: Task[],
): Promise<{ tasks: unknown[]; count: number; by_state: Record<string, number> }> {
  const server = makeTaskServer(tasks);
  const res = await getTool(server, 'list_tasks_overview').handler({}, {});
  expect(res.content[0].type).toBe('text');
  return JSON.parse(res.content[0].text) as {
    tasks: unknown[];
    count: number;
    by_state: Record<string, number>;
  };
}

describe('MCP list_tasks_overview (TL-21 Slice 5)', () => {
  it('ist unter dem exakten Namen registriert', () => {
    expect(getTool(makeTaskServer([]), 'list_tasks_overview')).toBeTruthy();
  });

  it('content ist EXAKT buildTaskOverview(tasks.getAllTasks()) — Envelope-Parität mit REST', async () => {
    const tasks = [
      task({ id: 'b', skillId: 'net.scan', state: 'completed', result: { rows: 3 } }),
      task({ id: 'a', skillId: 'fs.read', state: 'failed', error: 'boom' }),
    ];
    const payload = await callTaskOverview(tasks);
    // Gegen den GEMEINSAMEN Envelope-Builder (den auch der REST-Endpoint aufruft) → deckt Envelope-Drift auf.
    expect(payload).toEqual(buildTaskOverview(tasks));
    expect(payload.count).toBe(payload.tasks.length);
  });

  it('leere Task-Menge → { tasks: [], count: 0, by_state: Null-Histogramm } (wirft nicht)', async () => {
    const payload = await callTaskOverview([]);
    expect(payload).toEqual(buildTaskOverview([]));
    expect(payload.count).toBe(0);
  });

  it('malformed Laufzeitdaten kippen das Tool nicht (Totalität wie REST)', async () => {
    // Geforgte Felder (non-string id/skillId, unbekannter state, non-string executor) — Tool bleibt total.
    const tasks = [
      task({ id: 'ok', skillId: 'clean.skill', state: 'accepted' }),
      task({
        id: 123 as unknown as string,
        skillId: { evil: true } as unknown as string,
        state: 'PWNED' as unknown as TaskState,
        executor: 42 as unknown as string,
      }),
    ];
    const payload = await callTaskOverview(tasks);
    expect(payload).toEqual(buildTaskOverview(tasks));
  });
});
