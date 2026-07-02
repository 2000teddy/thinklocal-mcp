/**
 * mcp-proxy-client.ts — ADR-028 D4 / v5 Spur 3 (Modell B) **T3.4**: client-seitige
 * Helfer fuer die MCP-Proxy-Tools in `mcp-stdio.ts`. Ein lokaler Agent (z.B. Claude
 * Code) ruft ueber seinen lokalen Daemon-Proxy (`POST /api/mcp/<server>`) die im Mesh
 * geteilten MCP-Server auf — `tools/list` / `tools/call` werden **transparent
 * durchgereicht** (Passthrough), der Daemon routet remote-forward-only zum Owner.
 *
 * Reine, seiteneffektfreie Funktionen (Netz via injiziertem `McpProxyRequester`) →
 * vollstaendig unit-testbar OHNE die `mcp-stdio`-`main()`/stdio-Verdrahtung.
 */
import { MCP_CATEGORY, MCP_SKILL_PREFIX } from './mcp-service-registry.js';

/** Rohe Daemon-Antwort (Status + Body-Text) — vom Low-Level `requestDaemon`. */
export interface RawDaemonResponse {
  status: number;
  body: string;
}

/** Injizierte Netz-Primitive: POST an einen lokalen Daemon-Pfad. */
export type McpProxyRequester = (path: string, body: unknown) => Promise<RawDaemonResponse>;

/** Ein im Mesh geteilter MCP-Server (aus `/api/capabilities?category=mcp`). */
export interface SharedMcpEntry {
  server: string;
  agent_id: string;
  health: string;
  description: string;
}

/** Ergebnis eines Proxy-Calls: HTTP-Status des Daemon-Ingress + geparster Body. */
export interface McpProxyResult {
  status: number;
  body: unknown;
}

// Monotoner JSON-RPC-`id`-Zaehler (MCP verlangt eindeutige ids pro Session).
let rpcId = 0;
export function nextRpcId(): number {
  rpcId += 1;
  return rpcId;
}

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

/** JSON-RPC `tools/list`-Request. */
export function buildToolsListRpc(): JsonRpcRequest {
  return { jsonrpc: '2.0', id: nextRpcId(), method: 'tools/list' };
}

/** JSON-RPC `tools/call`-Request (`arguments` defaulten auf `{}`). */
export function buildToolsCallRpc(name: string, args?: Record<string, unknown>): JsonRpcRequest {
  return { jsonrpc: '2.0', id: nextRpcId(), method: 'tools/call', params: { name, arguments: args ?? {} } };
}

/** Parst den Body-Text; Non-JSON (z.B. Fehlertext) wird verbatim durchgereicht. */
export function parseMcpResponseBody(bodyText: string): unknown {
  if (!bodyText) return {};
  try {
    return JSON.parse(bodyText);
  } catch {
    return bodyText;
  }
}

/**
 * Extrahiert die geteilten MCP-Server aus einer `/api/capabilities`-Antwort
 * (nur `category==='mcp'` + `skill_id` mit `mcp:`-Praefix). Rein + defensiv.
 */
export function extractSharedMcpServers(capsData: unknown): SharedMcpEntry[] {
  const caps = (capsData as { capabilities?: unknown } | null)?.capabilities;
  if (!Array.isArray(caps)) return [];
  const out: SharedMcpEntry[] = [];
  for (const c of caps) {
    if (typeof c !== 'object' || c === null) continue;
    const cap = c as {
      skill_id?: unknown;
      category?: unknown;
      agent_id?: unknown;
      health?: unknown;
      description?: unknown;
    };
    if (cap.category !== MCP_CATEGORY) continue;
    if (typeof cap.skill_id !== 'string' || !cap.skill_id.startsWith(MCP_SKILL_PREFIX)) continue;
    out.push({
      server: cap.skill_id.slice(MCP_SKILL_PREFIX.length),
      agent_id: typeof cap.agent_id === 'string' ? cap.agent_id : '',
      health: typeof cap.health === 'string' ? cap.health : 'unknown',
      description: typeof cap.description === 'string' ? cap.description : '',
    });
  }
  return out;
}

/**
 * Fuehrt einen MCP-Proxy-Call gegen den lokalen Daemon aus (`POST /api/mcp/<server>`).
 * Nutzt bewusst das Low-Level-Requester (Status durchgereicht) — ein 501/502/503 des
 * Daemon-Ingress ist ein legitimes Ergebnis (MCP nicht verfuegbar / local-exec deferred),
 * kein Exception. Servername wird URL-enkodiert; die Kanonisierung macht der Daemon.
 */
export async function callMcpProxy(
  server: string,
  rpc: JsonRpcRequest,
  request: McpProxyRequester,
): Promise<McpProxyResult> {
  const res = await request(`/api/mcp/${encodeURIComponent(server)}`, rpc);
  return { status: res.status, body: parseMcpResponseBody(res.body) };
}
