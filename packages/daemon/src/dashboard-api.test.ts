// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { registerDashboardApi, type DashboardApiDeps } from './dashboard-api.js';

// Minimal-Deps: registerDashboardApi registriert alle Routen, ruft die Felder aber
// erst im Handler. Für POST /api/registry/republish zählen nur audit, identity,
// rateLimiter und registrySyncRepublish — der Rest bleibt unangetastet.
function buildApp(overrides: Partial<DashboardApiDeps> = {}): { app: ReturnType<typeof Fastify>; append: ReturnType<typeof vi.fn> } {
  const append = vi.fn();
  const deps = {
    audit: { append, count: () => 0 },
    identity: { spiffeUri: 'spiffe://thinklocal/host/test/agent/claude-code' },
    config: { daemon: { hostname: 'test', port: 9440 } },
    ...overrides,
  } as unknown as DashboardApiDeps;
  const app = Fastify({ logger: false });
  registerDashboardApi(app, deps);
  return { app, append };
}

describe('POST /api/tasks/execute — T2.4 place-or-refuse → 503', () => {
  it('Kapazitäts-Ablehnung (reason=capacity) → 503, nicht 404', async () => {
    const handleTaskRequest = vi.fn().mockResolvedValue({
      accepted: false,
      reason: 'capacity',
      error: 'Knoten überlastet: RAM 95.0% > 90%',
    });
    const { app } = buildApp({
      executor: { handleTaskRequest } as never,
      tasks: { createRequest: () => ({ id: 't1' }) } as never,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/tasks/execute',
      payload: { skill_id: 'demo.skill' },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ reason: 'capacity' });
    await app.close();
  });

  it('Skill fehlt (kein reason) → weiterhin 404', async () => {
    const handleTaskRequest = vi.fn().mockResolvedValue({
      accepted: false,
      error: "Skill 'x' nicht verfuegbar",
    });
    const { app } = buildApp({
      executor: { handleTaskRequest } as never,
      tasks: { createRequest: () => ({ id: 't2' }) } as never,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/tasks/execute',
      payload: { skill_id: 'x' },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe('GET /api/peers — T2.4-Folge: resources-Exposition für least-loaded-Routing', () => {
  it('liefert agent_card.resources aus der gespeicherten Peer-Card', async () => {
    const resources = {
      free_ram_bytes: 4e9,
      ram_used_percent: 42.5,
      cpu_load: 12.3,
      agent_count: 3,
      updated_at: '2026-06-30T12:00:00.000Z',
    };
    const mesh = {
      getOnlinePeers: () => [
        {
          agentId: 'spiffe://thinklocal/node/peerA',
          name: 'peerA',
          host: '10.10.10.80',
          port: 9440,
          status: 'online',
          lastSeen: 0,
          agentCard: {
            name: 'peerA',
            version: '1',
            capabilities: { agents: [], skills: [], services: [], connectors: [] },
            health: { cpu_percent: 5, memory_percent: 40, disk_percent: 10, uptime_seconds: 100 },
            resources,
          },
        },
      ],
    };
    const { app } = buildApp({ mesh: mesh as never });
    const res = await app.inject({ method: 'GET', url: '/api/peers' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.peers[0].agent_card.resources).toEqual(resources);
    await app.close();
  });

  it('Peer ohne resources im Card → resources: null (kein Fehler)', async () => {
    const mesh = {
      getOnlinePeers: () => [
        {
          agentId: 'spiffe://thinklocal/node/peerB',
          name: 'peerB',
          host: '10.10.10.81',
          port: 9440,
          status: 'online',
          lastSeen: 0,
          agentCard: {
            name: 'peerB',
            version: '1',
            capabilities: { agents: [], skills: [], services: [], connectors: [] },
            health: { cpu_percent: 5, memory_percent: 40, disk_percent: 10, uptime_seconds: 100 },
            // kein resources-Block
          },
        },
      ],
    };
    const { app } = buildApp({ mesh: mesh as never });
    const res = await app.inject({ method: 'GET', url: '/api/peers' });
    expect(res.json().peers[0].agent_card.resources).toBeNull();
    await app.close();
  });
});

describe('GET /api/status — T2.4-Folge: Self-Resources für least-loaded-Routing', () => {
  function statusDeps(getNodeResources: (id: string) => unknown) {
    return {
      identity: { spiffeUri: 'spiffe://thinklocal/node/self' },
      selfIdentityUri: 'spiffe://thinklocal/node/self',
      config: {
        daemon: { hostname: 'self', port: 9440, bind_host: '0.0.0.0', runtime_mode: 'lan', tls_enabled: true, agent_type: 'claude-code' },
        libp2p: { enabled: false, listen_port: 0 },
      },
      mesh: { getOnlinePeers: () => [], getPeerCounts: () => ({ known: 0, online: 0, offline: 0 }) },
      registry: { getAllCapabilities: () => [], getNodeResources },
      tasks: { getActiveTasks: () => [] },
      audit: { append: vi.fn(), count: () => 0 },
    } as never;
  }

  it('liefert die eigenen resources (Side-Map des selfIdentityUri)', async () => {
    const resources = { free_ram_bytes: 8e9, ram_used_percent: 33.3, cpu_load: 7, agent_count: 2, updated_at: '2026-06-30T12:00:00.000Z' };
    const getNodeResources = vi.fn().mockReturnValue(resources);
    const { app } = buildApp(statusDeps(getNodeResources));
    const res = await app.inject({ method: 'GET', url: '/api/status' });
    expect(res.statusCode).toBe(200);
    expect(res.json().resources).toEqual(resources);
    // mit dem self-Key abgefragt (matcht setNodeResources(selfIdentityUri))
    expect(getNodeResources).toHaveBeenCalledWith('spiffe://thinklocal/node/self');
    await app.close();
  });

  it('ohne Snapshot → resources: null', async () => {
    const { app } = buildApp(statusDeps(() => undefined));
    const res = await app.inject({ method: 'GET', url: '/api/status' });
    expect(res.json().resources).toBeNull();
    await app.close();
  });

  it('exponiert peers_known/peers_offline aus getPeerCounts (Phantom-ROT-Observability, §9)', async () => {
    // known>0 && online==0 ⇒ „Phantom-ROT von unten": bekannte, aber Heartbeat-offline Peers.
    const deps = statusDeps(() => undefined);
    (deps as { mesh: { getPeerCounts: () => unknown } }).mesh.getPeerCounts = () => ({ known: 6, online: 0, offline: 6 });
    const { app } = buildApp(deps);
    const res = await app.inject({ method: 'GET', url: '/api/status' });
    const body = res.json();
    expect(body.peers_online).toBe(0);
    expect(body.peers_known).toBe(6);
    expect(body.peers_offline).toBe(6);
    await app.close();
  });
});

describe('POST /api/registry/republish (ADR-020 v1 safety valve)', () => {
  it('triggers registrySyncRepublish, audits REGISTRY_REPUBLISH, returns ok', async () => {
    const republish = vi.fn().mockResolvedValue(undefined);
    const { app, append } = buildApp({ registrySyncRepublish: republish });
    const res = await app.inject({ method: 'POST', url: '/api/registry/republish' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', message: 'Registry republish triggered' });
    expect(republish).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledWith('REGISTRY_REPUBLISH', expect.any(String), expect.anything());
    await app.close();
  });

  it('returns 503 when registry sync is not wired (no audit side effect)', async () => {
    const { app, append } = buildApp({ registrySyncRepublish: undefined });
    const res = await app.inject({ method: 'POST', url: '/api/registry/republish' });
    expect(res.statusCode).toBe(503);
    expect(append).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns 500 when the republish call throws', async () => {
    const republish = vi.fn().mockRejectedValue(new Error('boom'));
    const { app } = buildApp({ registrySyncRepublish: republish });
    const res = await app.inject({ method: 'POST', url: '/api/registry/republish' });
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toMatch(/boom/);
    await app.close();
  });

  it('is rate-limited → 429 (republish not invoked)', async () => {
    const republish = vi.fn().mockResolvedValue(undefined);
    const { app } = buildApp({
      registrySyncRepublish: republish,
      rateLimiter: { allow: () => false } as unknown as DashboardApiDeps['rateLimiter'],
    });
    const res = await app.inject({ method: 'POST', url: '/api/registry/republish' });
    expect(res.statusCode).toBe(429);
    expect(republish).not.toHaveBeenCalled();
    await app.close();
  });
});

describe('GET /api/capabilities/overview — TL-21 Skelett-Auskunft', () => {
  const cap = (o: Record<string, unknown>) => ({
    version: '1.0.0', description: '', health: 'healthy', trust_level: 3,
    updated_at: '2026-07-16T00:00:00.000Z', category: 'misc', permissions: [], ...o,
  });

  it('liefert deduplizierte „Name + ein Satz"-Übersicht', async () => {
    const caps = [
      cap({ skill_id: 'db.read', agent_id: 'a', description: 'Liest DB. Details egal.', category: 'database' }),
      cap({ skill_id: 'db.read', agent_id: 'b', description: 'Liest DB. y', health: 'offline' }),
      cap({ skill_id: 'ai.chat', agent_id: 'a', description: 'Chattet.' }),
    ];
    const { app } = buildApp({ registry: { getAllCapabilities: () => caps } } as never);
    const res = await app.inject({ method: 'GET', url: '/api/capabilities/overview' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.count).toBe(2);
    expect(body.skills.map((s: { skill_id: string }) => s.skill_id)).toEqual(['ai.chat', 'db.read']);
    const dbread = body.skills.find((s: { skill_id: string }) => s.skill_id === 'db.read');
    expect(dbread).toMatchObject({ summary: 'Liest DB.', category: 'database', providers: 2, health: 'healthy' });
    await app.close();
  });

  it('leere Registry → count 0', async () => {
    const { app } = buildApp({ registry: { getAllCapabilities: () => [] } } as never);
    const res = await app.inject({ method: 'GET', url: '/api/capabilities/overview' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ skills: [], count: 0 });
    await app.close();
  });
});
