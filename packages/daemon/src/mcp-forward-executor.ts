// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * mcp-forward-executor.ts — ADR-028 D4-b / v5 Spur 3 (Modell B) **T3.3**: der Live-
 * Executor fuer den MCP-Proxy-Ingress. Konsumiert einen `McpForwardDispatch`
 * (via `buildMcpExecSpec`) und fuehrt ihn **remote-forward-only** aus:
 *
 *  - **mtls-forward**: echter undici-mTLS-`fetch` an `/api/mcp/<server>` des Owner-Peers,
 *    mit **persistentem Agent pro Owner** (Connection-Reuse), **D2-Server-Pin**
 *    (`verifyMeshServerIdentity` mit der erwarteten Owner-SPIFFE-Identitaet),
 *    **Timeout + Cancel** (`AbortSignal.timeout`), **1-Hop-Guard** (kein Re-Forward)
 *    und **Self-Loop-Guard** (Forward an sich selbst).
 *  - **mcporter-local**: der eigene Node serviert lokal. Ausfuehrung ueber eine
 *    **injizierbare** `localExec`-Primitive (TL07): fehlt sie, bleibt local-exec
 *    zurueckgestellt (**501**, Q1-Default remote-forward-only); ist sie gesetzt, wird
 *    lokal serviert (Owner-Haelfte des beidseitigen Kap.-7.7-Audits, `MCP_EXEC_LOCAL`).
 *    Die reale mcporter-`spawn`-Primitive ist ein eigener, gegateter Folge-Slice.
 *  - **reject**: die fail-closed-Stati aus `buildMcpExecSpec` (403/500/503) durchgereicht.
 *
 * Die Netzwerk-Primitive (`httpForward`) ist **injizierbar** → die Guard-/Audit-/
 * Routing-Logik ist ohne echten Net-Egress unit-testbar. `createUndiciMcpForward`
 * liefert die reale undici-mTLS-Implementierung (mit per-Owner-Agent-Cache).
 */
import type { Logger } from 'pino';
import { Agent as UndiciAgent, fetch as undiciFetch } from 'undici';
import type { McpForwardDispatch } from './mcp-forward-dispatch.js';
import type { McpIngressResponse } from './mcp-ingress.js';
import { buildMcpExecSpec, DEFAULT_MCP_EXEC_TIMEOUT_MS } from './mcp-forward-exec.js';
import type { McpExecutionTier } from './mcp-service-registry.js';
import {
  buildMeshConnector,
  type MeshTlsMaterial,
  type OutboundConnectPolicy,
} from './mesh-connect.js';
import { verifyMeshServerIdentity, type PeerCertLike } from './mesh-server-identity.js';

/** HTTP-Header, der die Forward-Hop-Zahl traegt (1-Hop-Guard). */
export const MCP_HOP_HEADER = 'x-tlmcp-mcp-hop';
/** Maximal erlaubte Forward-Hops: 1 (Client → Owner). Ein Re-Forward ist verboten. */
export const MAX_MCP_FORWARD_HOPS = 1;

export type McpAuditEvent = 'MCP_FORWARD_TX' | 'MCP_EXEC_LOCAL' | 'MCP_FORWARD_REJECT';
export type McpAuditFn = (event: McpAuditEvent, peerId: string, details: string) => void;

/** Beschreibung eines LOKAL auszuführenden MCP-Calls (Owner-Seite, kein Net-Egress).
 *  Die Felder stammen aus der `mcporter-local`-Spec (`buildMcpExecSpec`) + dem Ingress-Payload. */
export interface McpLocalExecRequest {
  /** Servername (z.B. "unifi") — für Logging/Audit + mcporter-Zielwahl. */
  server: string;
  /** Aufruf-Vektor aus der Spec (z.B. `['mcporter','run','unifi']`). */
  argv: readonly string[];
  /** Optionaler mcporter-Config-Pfad. */
  configPath?: string;
  /** MCP-JSON-RPC-Payload (tools/list | tools/call), das lokal ausgeführt wird. */
  payload: unknown;
  /** Timeout (ms). */
  timeoutMs: number;
  /** Ausführungsstufe (self); gate/consensus werden schon am Ingress abgefangen. */
  execution_tier: McpExecutionTier;
}
/** Injizierbare local-exec-Primitive (real: mcporter-`spawn`). Fehlt sie am Executor,
 *  bleibt local-exec zurückgestellt (501, Q1-Default). */
export type McpLocalExec = (req: McpLocalExecRequest) => Promise<McpIngressResponse>;

/** Kontext des eingehenden Ingress-Calls (vom Handler durchgereicht). */
export interface McpForwardContext {
  /** Hop-Zahl des EINGEHENDEN Calls (0 = direkter Client-Call, >=1 = bereits geforwardet). */
  incomingHop: number;
  /** MCP-JSON-RPC-Payload, das an den Owner weitergereicht wird. */
  payload?: unknown;
  /** Servername (fuer Audit/Logging). */
  server: string;
}

/** Ausfuehrbarer Dispatch (kein `none` — das faengt `handleMcpIngress` als 503 ab). */
export type McpDispatchExecutor = (
  dispatch: Exclude<McpForwardDispatch, { kind: 'none' }>,
  ctx: McpForwardContext,
) => Promise<McpIngressResponse>;

/** Beschreibung eines auszufuehrenden Remote-Forwards (an die Netzwerk-Primitive). */
export interface McpHttpForwardRequest {
  url: string;
  /** Hop-Wert, der AUSGEHEND gesetzt wird (= incomingHop + 1). */
  hop: number;
  senderUri: string;
  payload: unknown;
  targetAgentId: string;
  requireServerIdentity: boolean;
  expectedServerSpiffeId?: string;
  timeoutMs: number;
}
export type McpHttpForward = (req: McpHttpForwardRequest) => Promise<McpIngressResponse>;

export interface McpForwardExecutorDeps {
  /** Eigene (kanonische) SPIFFE-Identitaet — Self-Loop-Guard. */
  selfAgentId: string;
  /** Netzwerk-Primitive (injizierbar; real: `createUndiciMcpForward`). */
  httpForward: McpHttpForward;
  audit?: McpAuditFn;
  log?: Logger;
  /** Timeout-Override; Default `DEFAULT_MCP_EXEC_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** Injizierbare local-exec-Primitive (Owner-Seite). FEHLT sie → local-exec bleibt 501
   *  zurückgestellt (Q1-Default, rückwärtskompatibel). VORHANDEN → der eigene Node serviert
   *  den MCP lokal statt zu forwarden. Real: mcporter-`spawn` (eigener, gegateter Slice). */
  localExec?: McpLocalExec;
}

/**
 * Baut den Live-Executor. remote-forward-only:
 *  - `mcporter-local` → 501 (Q1 zurueckgestellt),
 *  - `mtls-forward` → Guards (Self-Loop, 1-Hop) → Audit-TX → `httpForward`,
 *  - `reject` → Status aus `buildMcpExecSpec` durchgereicht.
 */
export function createMcpForwardExecutor(deps: McpForwardExecutorDeps): McpDispatchExecutor {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_MCP_EXEC_TIMEOUT_MS;
  return async function execute(dispatch, ctx): Promise<McpIngressResponse> {
    const spec = buildMcpExecSpec(dispatch, { authorized: true, timeoutMs });

    // Ziel-Peer fuer Audit (bei reject/local kein Remote-Ziel → self).
    const auditPeer = dispatch.kind === 'remote' ? dispatch.request.targetAgentId : deps.selfAgentId;

    if (spec.kind === 'reject') {
      // CR-M4: reject-Pfade (403/500/503 aus buildMcpExecSpec) ebenfalls auditieren.
      deps.audit?.('MCP_FORWARD_REJECT', auditPeer, `${ctx.server} reject ${spec.status}`);
      return { status: spec.status, body: { error: spec.reason, server: ctx.server } };
    }

    if (spec.kind === 'mcporter-local') {
      // Ohne injizierte local-exec-Primitive bleibt local-exec zurueckgestellt (Q1-Default,
      // remote-forward-only) → 501, unveraendertes Verhalten.
      if (!deps.localExec) {
        deps.audit?.('MCP_FORWARD_REJECT', auditPeer, `${spec.server} local-exec deferred`);
        return {
          status: 501,
          body: { error: 'local-exec deferred (Q1: remote-forward-only)', server: spec.server },
        };
      }
      // Owner-Seite serviert lokal: die Owner-Haelfte des beidseitigen Kap.-7.7-Audits.
      deps.audit?.('MCP_EXEC_LOCAL', auditPeer, `${spec.server} tier=${spec.execution_tier}`);
      // Defense-in-depth: eine werfende localExec-Primitive darf den {status,body}-Vertrag
      // NICHT brechen (handleMcpIngress ruft execute() ausserhalb seines try/catch). Analog
      // zum Self-Catch in createUndiciMcpForward → ein Throw wird zu 502 gemappt + auditiert.
      let res: McpIngressResponse;
      try {
        res = await deps.localExec({
          server: spec.server,
          argv: spec.argv,
          configPath: spec.configPath,
          payload: ctx.payload,
          timeoutMs: spec.timeoutMs,
          execution_tier: spec.execution_tier,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        deps.log?.warn({ server: spec.server, err: msg }, '[mcp-local-exec] Primitive warf');
        deps.audit?.('MCP_FORWARD_REJECT', auditPeer, `${spec.server} local-exec-threw`);
        return { status: 502, body: { error: 'local-exec failed', server: spec.server, detail: msg.slice(0, 300) } };
      }
      // Analog zum Forward-Pfad: ein fehlgeschlagener local-exec (>=500) wird zusaetzlich als
      // REJECT auditiert, damit ein Owner-seitiger Exec-Fehler attribuierbar ist.
      if (res.status >= 500) {
        deps.audit?.('MCP_FORWARD_REJECT', auditPeer, `${spec.server} local-exec-failed ${res.status}`);
      }
      return res;
    }

    // --- mtls-forward ---
    // Self-Loop-Guard: nie ueber mTLS an sich selbst zurueck-dialen (CR-L2 aus T3.2).
    if (spec.targetAgentId === deps.selfAgentId) {
      deps.audit?.('MCP_FORWARD_REJECT', spec.targetAgentId, `${ctx.server} self-forward loop`);
      return { status: 508, body: { error: 'self-forward loop blocked (1-hop-guard)', server: ctx.server } };
    }
    // 1-Hop-Guard: ein bereits geforwardeter Call (hop>=1) darf NICHT erneut geforwardet
    // werden — nur der Owner serviert. Verhindert Loops/Amplifikation.
    if (ctx.incomingHop >= MAX_MCP_FORWARD_HOPS) {
      deps.audit?.('MCP_FORWARD_REJECT', spec.targetAgentId, `${ctx.server} hop-limit ${ctx.incomingHop}`);
      return {
        status: 502,
        body: { error: 'mcp 1-hop-guard: non-owner re-forward blocked', server: ctx.server, hop: ctx.incomingHop },
      };
    }

    deps.audit?.('MCP_FORWARD_TX', spec.targetAgentId, `${ctx.server} tier=${spec.execution_tier}`);
    const res = await deps.httpForward({
      url: spec.url,
      hop: ctx.incomingHop + 1,
      senderUri: spec.senderUri,
      payload: ctx.payload,
      targetAgentId: spec.targetAgentId,
      requireServerIdentity: spec.requireServerIdentity,
      expectedServerSpiffeId: spec.expectedServerSpiffeId,
      timeoutMs: spec.timeoutMs,
    });
    // CR-M4: ein fehlgeschlagener Forward (Pin-/Connect-/Timeout-Fehler → 5xx) wird
    // zusaetzlich als REJECT auditiert (nicht nur der TX-Versuch), damit ein Wire-Pin-
    // Verstoss attribuierbar ist.
    if (res.status >= 500) {
      deps.audit?.('MCP_FORWARD_REJECT', spec.targetAgentId, `${ctx.server} forward-failed ${res.status}`);
    }
    return res;
  };
}

export interface UndiciMcpForwardDeps {
  /** mTLS-Material (cert/key/ca). `undefined` → Forward nicht moeglich (503). */
  tls?: MeshTlsMaterial;
  /** Globale Outbound-Policy (Pin/Debug/DisablePinning); Pin-Wert kommt per Request. */
  outboundPolicy: OutboundConnectPolicy;
  log?: Logger;
  /** Fetch-Injektion fuer Tests; Default undici-`fetch`. */
  fetchImpl?: typeof undiciFetch;
}

/**
 * Reale undici-mTLS-Forward-Primitive mit **persistentem Agent pro Owner-Peer**
 * (Connection-Reuse) und **D2-Server-Pin**. Der Agent wird pro `targetAgentId`
 * gecacht; die `checkServerIdentity`-Closure pinnt auf die erwartete Owner-SPIFFE-
 * Identitaet (nur bei aktivem Pin, sonst TOFU). `close()` raeumt alle Agents ab.
 */
export function createUndiciMcpForward(deps: UndiciMcpForwardDeps): { forward: McpHttpForward; close: () => void } {
  const agents = new Map<string, UndiciAgent>();
  const doFetch = deps.fetchImpl ?? undiciFetch;

  function agentFor(req: McpHttpForwardRequest, tls: MeshTlsMaterial): UndiciAgent {
    // CR-H1: Cache-Key = target + Pin-Zustand + erwartete Identitaet. Nur `targetAgentId`
    // wuerde bei kuenftig per-Request variierendem Pin/expectedSpiffeId einen STALE Pin
    // wiederverwenden. Heute invariant pro Owner, aber fail-safe explizit gemacht.
    const key = `${req.targetAgentId}|${req.requireServerIdentity ? '1' : '0'}|${req.expectedServerSpiffeId ?? ''}`;
    const cached = agents.get(key);
    if (cached) return cached;
    // Per-Target-Pin: nur bei aktivem Server-Identity-Pin eine checkServerIdentity-
    // Closure setzen, die exakt auf die erwartete Owner-SPIFFE-Identitaet prueft.
    const check = req.requireServerIdentity
      ? (host: string, cert: PeerCertLike): Error | undefined =>
          verifyMeshServerIdentity(host, cert, { expectedSpiffeId: req.expectedServerSpiffeId })
      : undefined;
    // CR-H2: die Connector-Policy MUSS aus dem Request kommen (nicht der globalen
    // outboundPolicy) — sonst koennte `spiffeServerIdentity=false` (global) mit
    // `requireServerIdentity=true` (Request) einen STILLEN TOFU-Downgrade erzeugen
    // (buildConnectorOptions ignoriert `check`, wenn policy.spiffeServerIdentity aus ist).
    // So sind `spiffeServerIdentity` und die Anwesenheit von `check` strukturell konsistent;
    // die fail-fast-Invariante in buildConnectorOptions greift.
    const policy: OutboundConnectPolicy = {
      ...deps.outboundPolicy,
      spiffeServerIdentity: req.requireServerIdentity,
    };
    const agent = new UndiciAgent({
      connect: buildMeshConnector(tls, policy, deps.log, check),
    });
    agents.set(key, agent);
    return agent;
  }

  const forward: McpHttpForward = async (req) => {
    if (!deps.tls) {
      return { status: 503, body: { error: 'mcp forward unavailable: no TLS material' } };
    }
    try {
      const res = await doFetch(req.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [MCP_HOP_HEADER]: String(req.hop) },
        body: JSON.stringify(req.payload ?? {}),
        signal: AbortSignal.timeout(req.timeoutMs),
        dispatcher: agentFor(req, deps.tls),
      });
      const text = await res.text().catch(() => '');
      let body: unknown = text;
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          /* Non-JSON-Upstream durchreichen (z.B. Fehlertext). */
        }
      } else {
        body = {};
      }
      return { status: res.status, body };
    } catch (e) {
      // Timeout/Abort ODER Connect-/Pin-Fehler → 502 (Bad Gateway zum Owner).
      const msg = e instanceof Error ? e.message : String(e);
      deps.log?.warn({ url: req.url, target: req.targetAgentId, err: msg }, '[mcp-forward] failed');
      return { status: 502, body: { error: 'mcp forward failed', detail: msg.slice(0, 300) } };
    }
  };

  return {
    forward,
    close: (): void => {
      // CR-L4: close() ist async → Rejection abfangen (Shutdown-Pfad, kein unhandled).
      for (const a of agents.values()) void a.close().catch(() => undefined);
      agents.clear();
    },
  };
}
