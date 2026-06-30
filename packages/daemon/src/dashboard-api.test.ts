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
