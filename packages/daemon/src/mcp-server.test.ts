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
import type { Capability } from './registry.js';

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
  handler: (args: unknown, extra: unknown) => Promise<{ content: Array<{ type: string; text: string }> }>;
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
      cap({ skill_id: 'net.scan', agent_id: 'a1', description: 'Scannt das Netz. Mehr Details hier.', category: 'network' }),
      cap({ skill_id: 'net.scan', agent_id: 'a2', description: 'Duplikat anderer Provider.', health: 'degraded' }),
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
      cap({ skill_id: '' as unknown as string, agent_id: 'a3', description: 'Leerer Key wird übersprungen.' }),
    ];
    const payload = await callOverview(caps);
    expect(payload).toEqual(buildCapabilityOverview(caps));
  });
});
