/**
 * mcp-ingress-api.ts — ADR-028 D4-b / v5 Spur 3 (Modell B), **T3.2**: das Fastify-
 * Live-Wiring des Daemon-MCP-Proxy-Ingress `POST /api/mcp/<server>`.
 *
 * Verbindet die reine Kern-Logik `handleMcpIngress` (#199, mcp-ingress.ts) mit dem
 * mTLS-`cardServer`. Zwei Aufgaben:
 *   1. **D3-Sender-Auth aus dem mTLS-Client-Cert** — der eingehende Aufrufer wird
 *      NICHT aus dem Body, sondern aus dem bereits CA-validierten Client-Zertifikat
 *      abgeleitet (`extractCanonicalSender`). Kein/ungueltiger/nur-Legacy-Cert →
 *      403 (fail-closed).
 *   2. **Executor bewusst deferred (T3.3):** remote-forward-only (Christian-Gate
 *      Q1 = JA). Der injizierte Executor quittiert einen routbaren Dispatch
 *      fail-closed mit 501 — KEIN Net-Egress, KEIN local-exec. Der echte
 *      persistente undici-mTLS-Forward (Streaming/Cancel/Timeout/1-Hop-Guard) ist
 *      T3.3, der Zwei-Peer-`tools/call`-Beweis ist T3.5.
 *
 * `extractCanonicalSender` + der Handler sind rein bzw. framework-nah und ohne
 * echten Net-/mcporter-Egress → unit-testbar ohne laufenden TLS-Server.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Logger } from 'pino';
import type { Capability } from './registry.js';
import type { McpForwardPeer } from './mcp-forward.js';
import { handleMcpIngress } from './mcp-ingress.js';
import {
  spiffeUrisFromSubjectAltName,
  authorizeHttpsSender,
  isCanonicalNodeUri,
} from './peer-identity.js';
import { MCP_HOP_HEADER, type McpDispatchExecutor } from './mcp-forward-executor.js';

/** Minimaler TLS-Socket-Ausschnitt fuer die Cert-Extraktion (testbar ohne echtes TLS). */
export interface PeerCertSocket {
  authorized?: boolean;
  getPeerCertificate?: (detailed?: boolean) => { subjectaltname?: string } | undefined;
}

/**
 * Leitet den D3-Sender-Principal aus dem mTLS-Client-Cert des Sockets ab.
 * Fail-closed: nur ein TLS-validierter Socket (`authorized===true`, schuetzt gegen
 * kuenftige TLS-Konfig-Drift) mit einer kanonischen `spiffe://thinklocal/node/<PeerID>`-
 * SAN liefert einen Principal; sonst `null` (→ 403 im Handler). Neuer Endpoint =
 * canonical-only, kein Legacy-`host/<id>`-Kompat. Reine Funktion, wirft nicht.
 *
 * CR-MEDIUM (M1): STRIKTE Validierung via `isCanonicalNodeUri` (exakt
 * `node/<PeerID>` mit PeerID-Zeichensatz `[A-Za-z0-9]+`, end-anchored) statt einem
 * losen Prefix-Match — sonst gaelten `node/` (leer) oder `node/evil/extra` als
 * gueltige Sender. Da der nachgelagerte `authorizeHttpsSender(u, u)`-Abgleich mit
 * identischem Sender==Cert tautologisch `ok` ist, ist DIESE Extraktion das
 * eigentliche canonical-only-Gate. (Bei mehreren kanonischen SANs — nicht erwartet,
 * alle CA-signiert und derselben PeerID zugehoerig — gewinnt die erste.)
 */
export function extractCanonicalSender(socket: PeerCertSocket | undefined | null): string | null {
  if (!socket || socket.authorized !== true || typeof socket.getPeerCertificate !== 'function') {
    return null;
  }
  const cert = socket.getPeerCertificate(true);
  const sans = spiffeUrisFromSubjectAltName(cert?.subjectaltname);
  return sans.find((u) => isCanonicalNodeUri(u)) ?? null;
}

/** Audit-Hook fuer den Ingress (RX / Reject) — im Daemon `audit.append`-basiert. */
export type McpIngressAuditFn = (
  event: 'MCP_PROXY_RX' | 'MCP_FORWARD_REJECT',
  peerId: string,
  details: string,
) => void;

export interface McpIngressApiDeps {
  /** Eigene (kanonische) SPIFFE-Identitaet — Provider-Vergleich + Forward-Sender (D3). */
  selfAgentId: string;
  /** Endpoint-Aufloesung fuer einen Owner-`agent_id` (im Daemon: MeshManager.getPeer). */
  resolvePeer: (agentId: string) => McpForwardPeer | undefined;
  /** Snapshot der replizierten Registry-Capabilities (im Daemon: registry.getAllCapabilities). */
  getCapabilities: () => readonly Capability[];
  /** Wert von `TLMCP_SPIFFE_SERVER_IDENTITY` (Default false = TOFU) — D2-Pin-Schalter. */
  requireServerIdentity?: boolean;
  /** Live-Executor (T3.3, `createMcpForwardExecutor`). Fehlt er, greift der 501-Stub. */
  execute?: McpDispatchExecutor;
  /** Ingress-seitiges (RX/Reject) Audit — bildet mit dem Executor-TX-Audit das beidseitige Audit. */
  audit?: McpIngressAuditFn;
  log?: Logger;
}

/**
 * 501-Stub-Executor (falls kein Live-Executor injiziert ist — z.B. reine
 * Route/Auth-Tests). Beide Zweige fail-closed 501: `local` = local-exec per Q1
 * zurueckgestellt; `remote` = kein Live-Executor verdrahtet.
 */
const deferredExecutor: McpDispatchExecutor = async (dispatch) => {
  if (dispatch.kind === 'local') {
    return {
      status: 501,
      body: { error: 'local-exec deferred (Q1: remote-forward-only)', server: dispatch.server },
    };
  }
  return {
    status: 501,
    body: { error: 'mcp remote-forward executor not wired', target: dispatch.request.targetAgentId },
  };
};

/** Liest die eingehende Hop-Zahl aus dem Header (fehlt/ungueltig → 0 = direkter Client-Call). */
function readIncomingHop(request: FastifyRequest): number {
  const raw = request.headers[MCP_HOP_HEADER];
  const val = Array.isArray(raw) ? raw[0] : raw;
  const n = val !== undefined ? Number.parseInt(val, 10) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Baut den Fastify-Handler fuer `POST /api/mcp/:server` (exportiert fuer Unit-Tests). */
export function makeMcpIngressHandler(
  deps: McpIngressApiDeps,
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  const executor = deps.execute ?? deferredExecutor;
  return async function mcpIngressHandler(request, reply): Promise<void> {
    const server = (request.params as { server?: string } | undefined)?.server ?? '';
    // D3: Sender-Principal ausschliesslich aus dem mTLS-Client-Cert (nicht aus dem Body).
    const socket = request.raw.socket as unknown as PeerCertSocket;
    const senderUri = extractCanonicalSender(socket);
    const incomingHop = readIncomingHop(request);

    const result = await handleMcpIngress(
      { server, senderUri, capabilities: deps.getCapabilities(), payload: request.body },
      {
        selfAgentId: deps.selfAgentId,
        resolvePeer: deps.resolvePeer,
        // Bindet den Aufrufer kryptografisch an die Verbindung: senderUri IST der
        // Cert-SAN, authorizeHttpsSender vergleicht dessen PeerID mit dem Cert → ok.
        isAuthorizedSender: (u) => (senderUri ? authorizeHttpsSender(u, senderUri).ok : false),
        requireServerIdentity: deps.requireServerIdentity,
        // Der Executor bekommt den Hop + das Payload + den Servernamen via Closure.
        execute: (dispatch) => executor(dispatch, { incomingHop, payload: request.body, server }),
      },
    );

    // Beidseitiges Audit (RX-Seite): 403 (Sender) bzw. 5xx (Guard/Exec-Reject: 500/501/
    // 502/503/508) → REJECT; ein akzeptierter Proxy-Call → RX. (CR-L1: Reject-Stati nicht
    // als „RX" verschleiern, damit Audit-Queries Loop-/Auth-Fehlversuche finden.)
    if (result.status === 403 || result.status >= 500) {
      // ADR-033 (CR-MEDIUM): eine Tier-Verweigerung (Body trägt `tier`) im Audit-Detail von einer
      // Sender-Auth-Ablehnung unterscheidbar machen — sonst sind beide „status=403" ununterscheidbar.
      const tier = (result.body as { tier?: unknown } | undefined)?.tier;
      const tierSuffix = typeof tier === 'string' ? ` tier=${tier}` : '';
      deps.audit?.('MCP_FORWARD_REJECT', senderUri ?? 'unknown', `${server} status=${result.status}${tierSuffix}`);
    } else {
      deps.audit?.('MCP_PROXY_RX', senderUri ?? 'unknown', `${server} status=${result.status} hop=${incomingHop}`);
    }

    deps.log?.info({ server, sender: senderUri, hop: incomingHop, status: result.status }, '[mcp-ingress] request');
    await reply.code(result.status).send(result.body);
  };
}

/** Registriert `POST /api/mcp/:server` auf dem (mTLS-)cardServer. */
export function registerMcpIngressApi(server: FastifyInstance, deps: McpIngressApiDeps): void {
  server.post('/api/mcp/:server', makeMcpIngressHandler(deps));
}
