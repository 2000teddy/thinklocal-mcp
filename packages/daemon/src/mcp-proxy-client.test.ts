/**
 * Unit-Tests fuer ADR-028 D4 / v5 Spur 3 T3.4 — client-seitige MCP-Proxy-Helfer
 * (`mcp-proxy-client.ts`). Deckt: JSON-RPC-Bau (tools/list, tools/call), Body-Parsing
 * (JSON/Non-JSON/leer), Shared-MCP-Extraktion (Filter + defensiv), callMcpProxy
 * (Pfad-Enkodierung, Status-Durchreichung inkl. non-2xx). KEIN echter Daemon/Netz.
 */
import { describe, it, expect } from 'vitest';
import {
  buildToolsListRpc,
  buildToolsCallRpc,
  parseMcpResponseBody,
  extractSharedMcpServers,
  callMcpProxy,
  nextRpcId,
  type McpProxyRequester,
  type RawDaemonResponse,
} from './mcp-proxy-client.js';

describe('JSON-RPC-Bau', () => {
  it('nextRpcId ist monoton steigend', () => {
    const a = nextRpcId();
    const b = nextRpcId();
    expect(b).toBeGreaterThan(a);
  });

  it('buildToolsListRpc → jsonrpc/method korrekt, id gesetzt', () => {
    const rpc = buildToolsListRpc();
    expect(rpc.jsonrpc).toBe('2.0');
    expect(rpc.method).toBe('tools/list');
    expect(typeof rpc.id).toBe('number');
  });

  it('buildToolsCallRpc → params {name, arguments}; args default {}', () => {
    const withArgs = buildToolsCallRpc('list_clients', { site: 'default' });
    expect(withArgs.method).toBe('tools/call');
    expect(withArgs.params).toEqual({ name: 'list_clients', arguments: { site: 'default' } });
    const noArgs = buildToolsCallRpc('get_status');
    expect(noArgs.params).toEqual({ name: 'get_status', arguments: {} });
  });
});

describe('parseMcpResponseBody', () => {
  it('JSON-Text → Objekt', () => {
    expect(parseMcpResponseBody('{"result":[1,2]}')).toEqual({ result: [1, 2] });
  });
  it('Non-JSON → String verbatim', () => {
    expect(parseMcpResponseBody('mcp unavailable')).toBe('mcp unavailable');
  });
  it('leer → {}', () => {
    expect(parseMcpResponseBody('')).toEqual({});
  });
  it('Scalar-JSON korrekt (nicht nur Objekte)', () => {
    expect(parseMcpResponseBody('123')).toBe(123);
    expect(parseMcpResponseBody('"x"')).toBe('x');
  });
});

describe('extractSharedMcpServers', () => {
  it('filtert category=mcp + mcp:-Praefix, strippt Praefix, mappt Felder', () => {
    const caps = {
      capabilities: [
        { skill_id: 'mcp:unifi', category: 'mcp', agent_id: 'spiffe://thinklocal/node/HUB', health: 'healthy', description: 'UniFi' },
        { skill_id: 'mcp:pal', category: 'mcp', agent_id: 'spiffe://thinklocal/node/HUB', health: 'healthy', description: 'PAL' },
        { skill_id: 'system.monitor', category: 'system', agent_id: 'x', health: 'healthy', description: 'skill' }, // kein mcp
      ],
    };
    const out = extractSharedMcpServers(caps);
    expect(out.map((s) => s.server).sort()).toEqual(['pal', 'unifi']);
    const unifi = out.find((s) => s.server === 'unifi');
    expect(unifi?.agent_id).toBe('spiffe://thinklocal/node/HUB');
    expect(unifi?.description).toBe('UniFi');
  });

  it('defensiv: kein capabilities-Array → []; garbage-Eintraege uebersprungen', () => {
    expect(extractSharedMcpServers(null)).toEqual([]);
    expect(extractSharedMcpServers({})).toEqual([]);
    expect(extractSharedMcpServers({ capabilities: 'nope' })).toEqual([]);
    const garbage = { capabilities: [null, 42, { category: 'mcp' }, { skill_id: 'mcp:x', category: 'mcp' }] };
    const out = extractSharedMcpServers(garbage);
    expect(out).toHaveLength(1);
    expect(out[0]?.server).toBe('x');
    expect(out[0]?.health).toBe('unknown'); // fehlend → default
  });

  it('category=mcp aber skill_id OHNE mcp:-Praefix → ausgeschlossen (Praefix-Filter)', () => {
    const caps = { capabilities: [{ skill_id: 'unifi', category: 'mcp', agent_id: 'x', health: 'healthy', description: 'd' }] };
    expect(extractSharedMcpServers(caps)).toEqual([]);
  });
});

describe('callMcpProxy', () => {
  const capture = (res: RawDaemonResponse): { paths: string[]; bodies: unknown[]; req: McpProxyRequester } => {
    const paths: string[] = [];
    const bodies: unknown[] = [];
    const req: McpProxyRequester = async (path, body) => {
      paths.push(path);
      bodies.push(body);
      return res;
    };
    return { paths, bodies, req };
  };

  it('POSTet an /api/mcp/<server> (URL-enkodiert), gibt Status + geparsten Body', async () => {
    const c = capture({ status: 200, body: '{"result":{"tools":[]}}' });
    const rpc = buildToolsListRpc();
    const out = await callMcpProxy('unifi', rpc, c.req);
    expect(c.paths[0]).toBe('/api/mcp/unifi');
    expect(c.bodies[0]).toBe(rpc);
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ result: { tools: [] } });
  });

  it('non-2xx wird durchgereicht (501 local-exec deferred, Body geparst)', async () => {
    const c = capture({ status: 501, body: '{"error":"local-exec deferred (Q1: remote-forward-only)"}' });
    const out = await callMcpProxy('unifi', buildToolsCallRpc('list_clients'), c.req);
    expect(out.status).toBe(501);
    expect((out.body as { error?: string }).error).toMatch(/local-exec deferred/);
  });

  it('Servername wird URL-enkodiert', async () => {
    const c = capture({ status: 200, body: '{}' });
    await callMcpProxy('weird name', buildToolsListRpc(), c.req);
    expect(c.paths[0]).toBe('/api/mcp/weird%20name');
  });

  it('Security: Path-Traversal-Servername wird neutralisiert (kein Escape aus /api/mcp/)', async () => {
    const c = capture({ status: 503, body: '{}' });
    await callMcpProxy('../peers', buildToolsListRpc(), c.req);
    expect(c.paths[0]).toBe('/api/mcp/..%2Fpeers'); // %2F bleibt enkodiert → kein Traversal
  });

  it('502/503-Passthrough (Owner nicht erreichbar) — Status + Body durchgereicht, kein Throw', async () => {
    const c = capture({ status: 503, body: '{"error":"mcp unavailable","server":"unifi"}' });
    const out = await callMcpProxy('unifi', buildToolsListRpc(), c.req);
    expect(out.status).toBe(503);
    expect((out.body as { error?: string }).error).toBe('mcp unavailable');
  });
});
