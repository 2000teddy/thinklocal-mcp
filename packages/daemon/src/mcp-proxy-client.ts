// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
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
  return {
    jsonrpc: '2.0',
    id: nextRpcId(),
    method: 'tools/call',
    params: { name, arguments: args ?? {} },
  };
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
 * Extrahiert die Tool-Namen aus einem geparsten `tools/list`-JSON-RPC-Ergebnis
 * (`{ result: { tools: [{ name }, …] } }`). **Secret-sicher** (`tools/list` trägt nur Namen +
 * Schemata, nie Werte) und **total/fail-safe**: fehlendes/malformed `result`/`tools`, non-object-
 * Einträge, non-string/leere `name` → übersprungen; kein throw. Dedupliziert (stabile Erst-Reihenfolge).
 * Für den ADR-042-Drift-Check (`checkToolClassDrift`), der eine `readonly string[]`-Live-Liste erwartet.
 */
export function extractToolNames(body: unknown): string[] {
  const tools = (body as { result?: { tools?: unknown } } | null)?.result?.tools;
  if (!Array.isArray(tools)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tools) {
    if (typeof t !== 'object' || t === null) continue;
    const name = (t as { name?: unknown }).name;
    if (typeof name !== 'string' || name === '' || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/**
 * True **nur**, wenn `result.tools` ein echtes Array ist (auch ein leeres). Unterscheidet ein legitim
 * **leeres Inventar** (`result.tools: []`) von einer **unbrauchbaren** 200-Antwort ohne Tool-Array
 * (`result: {}`, JSON-RPC-`error` bei HTTP 200, doppelt-gewrappter Body, Server mid-init). Ein
 * Drift-Check darf Letzteres NICHT als „Inventar = leer" lesen (sonst wären fälschlich **alle**
 * kuratierten Tools stale). Fail-safe: der Aufrufer wirft dann, statt `[]` durchzureichen (CR-MEDIUM M1).
 */
export function hasToolsArray(body: unknown): boolean {
  return Array.isArray((body as { result?: { tools?: unknown } } | null)?.result?.tools);
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
