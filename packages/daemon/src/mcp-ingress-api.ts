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
import type { McpForwardDispatch } from './mcp-forward-dispatch.js';
import { handleMcpIngress, type McpIngressResponse } from './mcp-ingress.js';
import {
  spiffeUrisFromSubjectAltName,
  authorizeHttpsSender,
  isCanonicalNodeUri,
} from './peer-identity.js';

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

export interface McpIngressApiDeps {
  /** Eigene (kanonische) SPIFFE-Identitaet — Provider-Vergleich + Forward-Sender (D3). */
  selfAgentId: string;
  /** Endpoint-Aufloesung fuer einen Owner-`agent_id` (im Daemon: MeshManager.getPeer). */
  resolvePeer: (agentId: string) => McpForwardPeer | undefined;
  /** Snapshot der replizierten Registry-Capabilities (im Daemon: registry.getAllCapabilities). */
  getCapabilities: () => readonly Capability[];
  /** Wert von `TLMCP_SPIFFE_SERVER_IDENTITY` (Default false = TOFU) — reicht zu T3.3 durch. */
  requireServerIdentity?: boolean;
  log?: Logger;
}

/**
 * remote-forward-only Executor-Platzhalter (Christian-Gate Q1 = JA). T3.2 verdrahtet
 * Route + D3-Auth; der echte Executor ist T3.3. Bis dahin fail-closed 501:
 * - `remote` → Live-undici-mTLS-Forward noch nicht verdrahtet (T3.3),
 * - `local`  → local-exec ist per Q1 zurueckgestellt (remote-forward-only).
 * `none` ist typseitig ausgeschlossen (handleMcpIngress faengt es als 503 ab).
 */
async function deferredExecutor(
  dispatch: Exclude<McpForwardDispatch, { kind: 'none' }>,
): Promise<McpIngressResponse> {
  if (dispatch.kind === 'local') {
    return {
      status: 501,
      body: { error: 'local-exec deferred (Q1: remote-forward-only)', server: dispatch.server },
    };
  }
  // CR-L2 (T3.3): Wenn selfAgentId (Migration: evtl. Legacy-Form) NICHT dem
  // Registry-`agent_id` entspricht, kann ein eigener Eintrag als `remote` statt
  // `local` geplant werden → Forward an sich selbst. Der T3.3-Live-Executor MUSS
  // einen 1-Hop-Guard tragen, der self==target erkennt und nicht ueber mTLS
  // zurueck-dialt (Loop-Schutz). Hier (501) noch inert.
  return {
    status: 501,
    body: {
      error: 'mcp remote-forward executor not yet wired (T3.3)',
      target: dispatch.request.targetAgentId,
    },
  };
}

/** Baut den Fastify-Handler fuer `POST /api/mcp/:server` (exportiert fuer Unit-Tests). */
export function makeMcpIngressHandler(
  deps: McpIngressApiDeps,
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async function mcpIngressHandler(request, reply): Promise<void> {
    const server = (request.params as { server?: string } | undefined)?.server ?? '';
    // D3: Sender-Principal ausschliesslich aus dem mTLS-Client-Cert (nicht aus dem Body).
    const socket = request.raw.socket as unknown as PeerCertSocket;
    const senderUri = extractCanonicalSender(socket);

    const result = await handleMcpIngress(
      { server, senderUri, capabilities: deps.getCapabilities(), payload: request.body },
      {
        selfAgentId: deps.selfAgentId,
        resolvePeer: deps.resolvePeer,
        // Bindet den Aufrufer kryptografisch an die Verbindung: senderUri IST der
        // Cert-SAN, authorizeHttpsSender vergleicht dessen PeerID mit dem Cert → ok.
        isAuthorizedSender: (u) => (senderUri ? authorizeHttpsSender(u, senderUri).ok : false),
        requireServerIdentity: deps.requireServerIdentity,
        execute: deferredExecutor,
      },
    );

    deps.log?.info(
      { server, sender: senderUri, status: result.status },
      '[mcp-ingress] request',
    );
    await reply.code(result.status).send(result.body);
  };
}

/** Registriert `POST /api/mcp/:server` auf dem (mTLS-)cardServer. */
export function registerMcpIngressApi(server: FastifyInstance, deps: McpIngressApiDeps): void {
  server.post('/api/mcp/:server', makeMcpIngressHandler(deps));
}
