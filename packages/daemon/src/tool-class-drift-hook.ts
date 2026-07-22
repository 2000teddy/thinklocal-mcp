// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * tool-class-drift-hook.ts — ADR-042 (TL-08 Slice 2c): die **ehrliche Verdrahtung** des vorhandenen
 * Live-Drift-Check-Seams (`checkToolClassDrift`, `tool-class-drift.ts`).
 *
 * Zwei injizierbare, testbare Einheiten:
 *  1. `buildGovernedToolListFetcher` — ein konkreter `ToolListFetcher`, der die **live** `tools/list` eines
 *     governed Servers über die **bereits vorhandene** ausgehende mTLS-Forward-Primitive holt
 *     (`createUndiciMcpForward.forward` → Peer-`/api/mcp/<server>`). **Secret-sicher** (`tools/list` liefert
 *     nur Namen/Schemata, nie Werte; **kein** `tools/call`). Kein neuer Transport, kein Self-Loopback.
 *  2. `runGovernedToolClassDriftChecks` — der Orchestrator: prüft je governed Server (Default
 *     `SERVER_TOOL_CLASSES`) die Klassen-Map gegen das Live-Inventar und emittiert bei Drift ein
 *     **`TOOL_CLASS_DRIFT`-Audit** (Kurations-Signal) — **kein Gate-Flip** (der bleibt Christian-gated,
 *     TODO.md TL-08 Slice 2c). Vollständig **fail-safe**: kein Provider / kein Endpoint / Fetch-Fehler /
 *     Non-200 ⇒ übersprungen (checkToolClassDrift → `null`), nie ein Crash, nie ein falsch-positiver Drift.
 *
 * Rein additiv/read-only. Siehe docs/architecture/… ADR-042 · `tool-class-drift.ts` · TODO.md TL-08 Slice 2c.
 */
import type { Capability } from './registry.js';
import type { McpHttpForward } from './mcp-forward-executor.js';
import { resolveMcp, SERVER_TOOL_CLASSES } from './mcp-service-registry.js';
import { buildToolsListRpc, extractToolNames, hasToolsArray } from './mcp-proxy-client.js';
import { checkToolClassDrift, type ToolListFetcher, type DriftLogger } from './tool-class-drift.js';

/** Default-Timeout des Drift-`tools/list` (großzügig, read-only Metadaten). */
const DEFAULT_DRIFT_TOOLS_TIMEOUT_MS = 10_000;

export interface GovernedToolListFetcherDeps {
  /** Eigene kanonische SPIFFE-Identität (Sender des Forwards). */
  selfAgentId: string;
  /** Capability-Snapshot (real: `registry.getAllCapabilities`) zum Auflösen des servierenden Peers. */
  getCapabilities: () => readonly Capability[];
  /** Peer-Endpoint zu einer SPIFFE-Identität (real: `mesh.getPeer(id)?.endpoint`). `undefined` → skip. */
  resolveEndpoint: (agentId: string) => string | undefined;
  /** Ausgehende mTLS-Forward-Primitive (real: `createUndiciMcpForward().forward`). */
  httpForward: McpHttpForward;
  /** Server-Identity-Pin wie im Live-Forward (aus `outboundConnectPolicy.spiffeServerIdentity`). */
  requireServerIdentity: boolean;
  timeoutMs?: number;
}

/**
 * Baut einen `ToolListFetcher(server)`, der die live `tools/list` des governed Servers vom **ersten
 * Online-Provider** (resolveMcp-Reihenfolge; offline wird herausgefiltert) holt. **Wirft** bei
 * kein-Provider / kein-Endpoint / Non-200 / 200-ohne-`result.tools`-Array — bewusst, damit der
 * `checkToolClassDrift`-Seam den Fehler fail-safe zu `null` fängt (kein erfundener Drift). Extrahiert dann
 * secret-sicher die Tool-**Namen** (`extractToolNames`). Kein `tools/call`, keine Werte.
 */
export function buildGovernedToolListFetcher(deps: GovernedToolListFetcherDeps): ToolListFetcher {
  return async (server: string): Promise<readonly string[]> => {
    // resolveMcp filtert offline-Provider heraus; [0] ist der erste in resolveMcp-Reihenfolge.
    const provider = resolveMcp(server, deps.getCapabilities())[0];
    if (!provider) throw new Error(`tool-class-drift: kein Online-Provider für mcp:${server}`);
    const endpoint = deps.resolveEndpoint(provider.agent_id);
    if (!endpoint)
      throw new Error(`tool-class-drift: kein Endpoint für Provider ${provider.agent_id}`);
    const res = await deps.httpForward({
      url: `${endpoint.replace(/\/+$/, '')}/api/mcp/${encodeURIComponent(server)}`,
      hop: 1,
      senderUri: deps.selfAgentId,
      payload: buildToolsListRpc(),
      targetAgentId: provider.agent_id,
      requireServerIdentity: deps.requireServerIdentity,
      expectedServerSpiffeId: provider.agent_id,
      timeoutMs: deps.timeoutMs ?? DEFAULT_DRIFT_TOOLS_TIMEOUT_MS,
    });
    if (res.status !== 200) {
      throw new Error(`tool-class-drift: tools/list ${server} → HTTP ${res.status}`);
    }
    // CR-MEDIUM M1: ein 200 OHNE echtes `result.tools`-Array (leeres `result:{}`, JSON-RPC-error@200,
    // doppelt-gewrappt, Server mid-init) ist UNBRAUCHBAR — NICHT als „Inventar = leer" lesen (das würde
    // fälschlich ALLE kuratierten Tools als stale melden). Werfen → checkToolClassDrift → null → skip.
    if (!hasToolsArray(res.body)) {
      throw new Error(
        `tool-class-drift: tools/list ${server} → 200 ohne result.tools-Array (unbrauchbar)`,
      );
    }
    const names = extractToolNames(res.body);
    // CR-LOW (#315-Review): ein NICHT-leeres tools-Array, das KEINEN verwertbaren Namen liefert (alle
    // Einträge malformed — MCP verlangt eigentlich `name`), ist ebenso unbrauchbar wie ein fehlendes
    // Array: es als „Inventar = leer" zu lesen würde fälschlich ALLE kuratierten Tools als stale melden.
    // Werfen → Seam → null → skip. Ein legitim LEERES Array (`[]`) bleibt gültiges leeres Inventar.
    const rawTools = (res.body as { result?: { tools?: unknown } }).result?.tools;
    if (Array.isArray(rawTools) && rawTools.length > 0 && names.length === 0) {
      throw new Error(
        `tool-class-drift: tools/list ${server} → 200 mit tools-Array ohne verwertbaren Namen (unbrauchbar)`,
      );
    }
    return names;
  };
}

/** Audit-Sink für das Kurations-Signal (real: `(e,id,d) => audit.append(e,id,d)`). */
export type ToolClassDriftAuditFn = (
  event: 'TOOL_CLASS_DRIFT',
  server: string,
  details: string,
) => void;

export interface RunToolClassDriftChecksDeps {
  fetchTools: ToolListFetcher;
  /** Emittiert das `TOOL_CLASS_DRIFT`-Audit; **nur** bei tatsächlichem Drift aufgerufen. */
  audit: ToolClassDriftAuditFn;
  log?: DriftLogger;
  /** Zu prüfende Server; Default = alle governed (`SERVER_TOOL_CLASSES`-Schlüssel). */
  servers?: readonly string[];
}

/** Kompakte, secret-sichere Drift-Zusammenfassung (nur Namen/Zähler) fürs Audit-`details`. */
function driftSummary(d: {
  staleReadOnly: readonly string[];
  staleSensitive: readonly string[];
  unclassified: readonly string[];
}): string {
  return (
    `staleReadOnly=${d.staleReadOnly.length} staleSensitive=${d.staleSensitive.length} ` +
    `unclassified=${d.unclassified.length}` +
    (d.unclassified.length ? ` [${d.unclassified.join(',')}]` : '')
  );
}

/**
 * Prüft alle (bzw. die übergebenen) governed Server gegen ihr Live-`tools/list`-Inventar und emittiert je
 * gedriftetem Server **ein** `TOOL_CLASS_DRIFT`-Audit. **Kein Gate-Flip.** Vollständig fail-safe: jeder
 * Server wird isoliert geprüft; `checkToolClassDrift` fängt Fetch-Fehler → `null` (kein Audit, kein Crash);
 * ein unerwarteter Wurf pro Server wird geloggt und übersprungen (die übrigen laufen weiter).
 */
export async function runGovernedToolClassDriftChecks(
  deps: RunToolClassDriftChecksDeps,
): Promise<void> {
  const servers = deps.servers ?? Object.keys(SERVER_TOOL_CLASSES);
  for (const server of servers) {
    try {
      const drift = await checkToolClassDrift(server, deps.fetchTools, deps.log);
      if (!drift) continue; // ungoverned / Fetch-Fehler (fail-safe) → nichts zu auditieren
      const hasDrift =
        drift.staleReadOnly.length > 0 ||
        drift.staleSensitive.length > 0 ||
        drift.unclassified.length > 0;
      if (hasDrift) deps.audit('TOOL_CLASS_DRIFT', server, driftSummary(drift));
    } catch (err) {
      deps.log?.warn(
        { server, err: err instanceof Error ? err.message : String(err) },
        '[tool-class] Drift-Check übersprungen (unerwarteter Fehler)',
      );
    }
  }
}
