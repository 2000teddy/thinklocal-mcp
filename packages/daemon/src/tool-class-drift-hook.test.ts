// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * tool-class-drift-hook.test.ts — ADR-042 (TL-08 Slice 2c) Verdrahtungs-Hook.
 *
 * Deckt (1) `buildGovernedToolListFetcher` (resolve→forward→extract, fail-safe Würfe) und
 * (2) `runGovernedToolClassDriftChecks` (Drift→Audit, kein-Drift/ungoverned/Fetch-Fehler→kein Audit,
 * Per-Server-Isolation) mit Fakes ab. Kein Netzwerk, kein echtes Mesh.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  buildGovernedToolListFetcher,
  runGovernedToolClassDriftChecks,
} from './tool-class-drift-hook.js';
import { SERVER_TOOL_CLASSES } from './mcp-service-registry.js';
import type { Capability } from './registry.js';
import type { McpHttpForward } from './mcp-forward-executor.js';

const UNIFI_ALL = [
  ...SERVER_TOOL_CLASSES.unifi.readOnly,
  ...(SERVER_TOOL_CLASSES.unifi.sensitive ?? []),
];

const PROVIDER = 'spiffe://thinklocal/node/unifi-provider';

/** Eine mcp:unifi-Provider-Capability, damit `resolveMcp` einen Online-Provider findet. */
function unifiCap(agent_id = PROVIDER): Capability {
  return {
    skill_id: 'mcp:unifi',
    category: 'mcp',
    version: '1.0.0',
    description: 'UniFi.',
    agent_id,
    health: 'healthy',
    trust_level: 3,
    permissions: [],
    updated_at: '2026-07-22T00:00:00.000Z',
  } as Capability;
}

/** tools/list-JSON-RPC-Body aus Tool-Namen. */
function toolsListBody(names: string[]): unknown {
  return { jsonrpc: '2.0', id: 1, result: { tools: names.map((name) => ({ name })) } };
}

describe('buildGovernedToolListFetcher', () => {
  it('resolved den Provider, forwardet tools/list an dessen /api/mcp/<server> und extrahiert die Namen', async () => {
    const forward = vi.fn<McpHttpForward>().mockResolvedValue({
      status: 200,
      body: toolsListBody(['list_sites', 'get_device']),
    });
    const fetchTools = buildGovernedToolListFetcher({
      selfAgentId: 'spiffe://thinklocal/node/self',
      getCapabilities: () => [unifiCap()],
      resolveEndpoint: (id) => (id === PROVIDER ? 'https://10.10.10.80:9440' : undefined),
      httpForward: forward,
      requireServerIdentity: true,
    });
    const names = await fetchTools('unifi');
    expect(names).toEqual(['list_sites', 'get_device']);
    // korrekt adressiert + secret-sicher (nur tools/list, kein tools/call)
    const req = forward.mock.calls[0][0];
    expect(req.url).toBe('https://10.10.10.80:9440/api/mcp/unifi');
    expect(req.targetAgentId).toBe(PROVIDER);
    expect(req.senderUri).toBe('spiffe://thinklocal/node/self');
    expect(req.expectedServerSpiffeId).toBe(PROVIDER);
    expect(req.requireServerIdentity).toBe(true);
    expect((req.payload as { method: string }).method).toBe('tools/list');
  });

  it('wirft (→ Seam fängt zu null) wenn kein Online-Provider existiert', async () => {
    const fetchTools = buildGovernedToolListFetcher({
      selfAgentId: 'self',
      getCapabilities: () => [], // kein mcp:unifi
      resolveEndpoint: () => 'https://x:9440',
      httpForward: vi.fn(),
      requireServerIdentity: false,
    });
    await expect(fetchTools('unifi')).rejects.toThrow(/kein Online-Provider/);
  });

  it('wirft wenn der Provider keinen Endpoint hat', async () => {
    const fetchTools = buildGovernedToolListFetcher({
      selfAgentId: 'self',
      getCapabilities: () => [unifiCap()],
      resolveEndpoint: () => undefined, // Peer nicht (mehr) bekannt
      httpForward: vi.fn(),
      requireServerIdentity: false,
    });
    await expect(fetchTools('unifi')).rejects.toThrow(/kein Endpoint/);
  });

  it('wirft bei Non-200 (Forward-Fehler 502 etc.) → kein falscher Drift', async () => {
    const fetchTools = buildGovernedToolListFetcher({
      selfAgentId: 'self',
      getCapabilities: () => [unifiCap()],
      resolveEndpoint: () => 'https://10.10.10.80:9440',
      httpForward: vi.fn<McpHttpForward>().mockResolvedValue({ status: 502, body: { error: 'x' } }),
      requireServerIdentity: false,
    });
    await expect(fetchTools('unifi')).rejects.toThrow(/HTTP 502/);
  });

  it('trailing-slash im Endpoint wird nicht verdoppelt', async () => {
    const forward = vi
      .fn<McpHttpForward>()
      .mockResolvedValue({ status: 200, body: toolsListBody([]) });
    const fetchTools = buildGovernedToolListFetcher({
      selfAgentId: 'self',
      getCapabilities: () => [unifiCap()],
      resolveEndpoint: () => 'https://10.10.10.80:9440/',
      httpForward: forward,
      requireServerIdentity: false,
    });
    await fetchTools('unifi');
    expect(forward.mock.calls[0][0].url).toBe('https://10.10.10.80:9440/api/mcp/unifi');
  });

  it('CR-MEDIUM M1: 200 OHNE result.tools-Array (leeres result / JSON-RPC-error@200) → wirft, KEIN []', async () => {
    for (const badBody of [
      { jsonrpc: '2.0', id: 1, result: {} }, // leeres result (z.B. leerer mcporter-stdout)
      { jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'x' } }, // JSON-RPC-Fehler bei HTTP 200
      { jsonrpc: '2.0', id: 1, result: { tools: 'not-an-array' } }, // malformed
      'plain text',
    ]) {
      const fetchTools = buildGovernedToolListFetcher({
        selfAgentId: 'self',
        getCapabilities: () => [unifiCap()],
        resolveEndpoint: () => 'https://10.10.10.80:9440',
        httpForward: vi.fn<McpHttpForward>().mockResolvedValue({ status: 200, body: badBody }),
        requireServerIdentity: false,
      });
      await expect(fetchTools('unifi')).rejects.toThrow(/ohne result\.tools-Array/);
    }
  });

  it('legitim leeres Inventar (result.tools: []) → resolved zu [] (kein Wurf)', async () => {
    const fetchTools = buildGovernedToolListFetcher({
      selfAgentId: 'self',
      getCapabilities: () => [unifiCap()],
      resolveEndpoint: () => 'https://10.10.10.80:9440',
      httpForward: vi
        .fn<McpHttpForward>()
        .mockResolvedValue({ status: 200, body: toolsListBody([]) }),
      requireServerIdentity: false,
    });
    await expect(fetchTools('unifi')).resolves.toEqual([]);
  });
});

describe('runGovernedToolClassDriftChecks', () => {
  it('Drift (neues unclassified read-Tool) → genau EIN TOOL_CLASS_DRIFT-Audit für den Server', async () => {
    const audit = vi.fn();
    await runGovernedToolClassDriftChecks({
      servers: ['unifi'],
      fetchTools: async () => [...UNIFI_ALL, 'get_brand_new_read_tool'],
      audit,
    });
    expect(audit).toHaveBeenCalledTimes(1);
    const [event, server, details] = audit.mock.calls[0];
    expect(event).toBe('TOOL_CLASS_DRIFT');
    expect(server).toBe('unifi');
    expect(details).toContain('get_brand_new_read_tool'); // unclassified im details
  });

  it('Drift (fehlendes readOnly-Tool → stale) → Audit', async () => {
    const audit = vi.fn();
    await runGovernedToolClassDriftChecks({
      servers: ['unifi'],
      fetchTools: async () => UNIFI_ALL.filter((t) => t !== 'list_sites'),
      audit,
    });
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit.mock.calls[0][2]).toMatch(/staleReadOnly=[1-9]/);
  });

  it('kein Drift (Live == kuratierte Klassen-Map) → KEIN Audit', async () => {
    const audit = vi.fn();
    await runGovernedToolClassDriftChecks({
      servers: ['unifi'],
      fetchTools: async () => [...UNIFI_ALL],
      audit,
    });
    expect(audit).not.toHaveBeenCalled();
  });

  it('ungoverned Server → checkToolClassDrift null → KEIN Audit', async () => {
    const audit = vi.fn();
    await runGovernedToolClassDriftChecks({
      servers: ['not-a-governed-server'],
      fetchTools: async () => ['whatever'],
      audit,
    });
    expect(audit).not.toHaveBeenCalled();
  });

  it('Fetch-Fehler (fetcher wirft) → fail-safe: KEIN Audit, KEIN Crash', async () => {
    const audit = vi.fn();
    await expect(
      runGovernedToolClassDriftChecks({
        servers: ['unifi'],
        fetchTools: async () => {
          throw new Error('peer offline');
        },
        audit,
      }),
    ).resolves.toBeUndefined();
    expect(audit).not.toHaveBeenCalled();
  });

  it('Per-Server-Isolation: ein fehlschlagender Server stoppt die übrigen nicht', async () => {
    const audit = vi.fn();
    await runGovernedToolClassDriftChecks({
      servers: ['unifi', 'unifi'], // zweimal: erster wirft, zweiter driftet
      fetchTools: (() => {
        let n = 0;
        return async () => {
          n += 1;
          if (n === 1) throw new Error('transient');
          return [...UNIFI_ALL, 'get_brand_new_read_tool'];
        };
      })(),
      audit,
    });
    expect(audit).toHaveBeenCalledTimes(1); // nur der zweite (driftende) Lauf auditiert
  });

  it('Default-Serverliste = governed Server (SERVER_TOOL_CLASSES) — unifi wird geprüft', async () => {
    const seen: string[] = [];
    await runGovernedToolClassDriftChecks({
      fetchTools: async (server) => {
        seen.push(server);
        return [...UNIFI_ALL];
      },
      audit: vi.fn(),
    });
    expect(seen).toEqual(Object.keys(SERVER_TOOL_CLASSES));
    expect(seen).toContain('unifi');
  });

  it('CR-MEDIUM M1 end-to-end: echter Fetcher + 200-ohne-tools → KEIN false-positive „alles stale"-Audit', async () => {
    const audit = vi.fn();
    const fetchTools = buildGovernedToolListFetcher({
      selfAgentId: 'self',
      getCapabilities: () => [unifiCap()],
      resolveEndpoint: () => 'https://10.10.10.80:9440',
      // 200, aber leeres result (z.B. degradierter Provider) — DARF nicht als leeres Inventar zählen.
      httpForward: vi.fn<McpHttpForward>().mockResolvedValue({
        status: 200,
        body: { jsonrpc: '2.0', id: 1, result: {} },
      }),
      requireServerIdentity: false,
    });
    await runGovernedToolClassDriftChecks({ servers: ['unifi'], fetchTools, audit });
    expect(audit).not.toHaveBeenCalled();
  });
});
