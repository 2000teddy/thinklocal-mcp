/**
 * agent-card.test.ts — T2.4-Folge: Mesh-Exposition der place-or-refuse-Resource-Attribute.
 *
 * Prüft, dass `/.well-known/agent-card.json` die (cache-bewussten) Self-Resource-Attribute
 * aus der Registry-Side-Map als `resources`-Block ausgibt — damit Peers über die Card
 * dieselbe Kapazität sehen, nach der der Knoten ablehnt. Verwendet Fastify `inject()`
 * (In-Process, kein Port, kein TLS).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentCardServer } from './agent-card.js';
import type { AgentCardServerOptions } from './agent-card.js';
import type { NodeResourceRecord } from './registry.js';
import { loadOrCreateIdentity } from './identity.js';
import { loadConfig } from './config.js';
import type { AgentIdentity } from './identity.js';
import type { DaemonConfig } from './config.js';

const NO_TOML = '/nonexistent/thinklocal-t24-card.toml';

const SAMPLE: NodeResourceRecord = {
  free_ram_bytes: 4_000_000_000,
  ram_used_percent: 42.5,
  cpu_load: 12.3,
  agent_count: 3,
  updated_at: '2026-06-30T12:00:00.000Z',
};

async function fetchCard(server: AgentCardServer): Promise<Record<string, unknown>> {
  const res = await server.getServer().inject({ method: 'GET', url: '/.well-known/agent-card.json' });
  expect(res.statusCode).toBe(200);
  return res.json();
}

describe('AgentCard — T2.4-Folge resources-Exposition', () => {
  let dir: string;
  let identity: AgentIdentity;
  let config: DaemonConfig;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'tl-card-'));
    identity = await loadOrCreateIdentity(dir, 'claude-code', 'test-host');
    config = loadConfig(NO_TOML);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function makeServer(getNodeResources?: () => NodeResourceRecord | undefined): AgentCardServer {
    const opts: AgentCardServerOptions = { identity, config, getNodeResources };
    return new AgentCardServer(opts);
  }

  it('exponiert die Side-Map-Resource-Attribute als resources-Block', async () => {
    const server = makeServer(() => SAMPLE);
    try {
      const card = await fetchCard(server);
      expect(card.resources).toEqual(SAMPLE);
      // cache-bewusste ram_used_percent ist NICHT identisch mit health.memory_percent
      // (verschiedene Berechnungen) — beide sind vorhanden.
      expect((card.health as Record<string, unknown>)?.memory_percent).toBeTypeOf('number');
    } finally {
      await server.stop();
    }
  });

  it('ohne Snapshot (Callback liefert undefined) → resources fehlt im Card', async () => {
    const server = makeServer(() => undefined);
    try {
      const card = await fetchCard(server);
      expect(card.resources).toBeUndefined();
    } finally {
      await server.stop();
    }
  });

  it('ohne getNodeResources-Option → resources fehlt (back-compat)', async () => {
    const server = makeServer(undefined);
    try {
      const card = await fetchCard(server);
      expect(card.resources).toBeUndefined();
    } finally {
      await server.stop();
    }
  });
});
