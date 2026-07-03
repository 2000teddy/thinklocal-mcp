/**
 * mcp-ingress.ts — ADR-028 D4-b (D2-Ingress, Prep): die Kern-Logik des Daemon-MCP-Proxy-
 * Ingress `/api/mcp/<server>`. Nimmt einen MCP-Aufruf entgegen, autorisiert den Sender (D3),
 * löst über die replizierte Registry auf (`resolveMcp`), plant das Routing (`planMcpRoute`),
 * baut Forward-Spec (#193) + mTLS-Dispatch-Plan (#195) und **reicht den Plan an einen
 * injizierten Executor weiter** — KEIN echter Net-Egress / mcporter-Exec in diesem Modul.
 *
 * Framework-agnostisch + rein (bis auf den injizierten `execute`): `handleMcpIngress(input, deps)`
 * → `{ status, body }`. Ein dünner Fastify-Adapter (späterer Slice) ruft das aus dem Route-Handler;
 * der echte `execute` (undici-mTLS-Forward / lokaler mcporter) ist der nächste gegatete Slice.
 *
 * Stack: gebaut auf #195 (`mcp-forward-dispatch.ts`). Kein Daemon-Install/Flag/Deploy.
 */
import type { Capability } from './registry.js';
import type { McpForwardPeer } from './mcp-forward.js';
import type { McpForwardDispatch } from './mcp-forward-dispatch.js';
import { resolveMcp, type McpExecutionTier } from './mcp-service-registry.js';
import { planMcpRoute } from './mcp-routing.js';
import { buildMcpForwardSpec } from './mcp-forward.js';
import { buildMcpForwardDispatch } from './mcp-forward-dispatch.js';

export interface McpIngressResponse {
  status: number;
  body: unknown;
}

/**
 * ADR-033: Setzt die Ausführungsstufe am Hub-Ingress durch (fail-closed, Beta).
 * Gate 2 (ENTSCHEIDUNGEN.md, 02.07.): Lese-/Schreib-Stufen je Werkzeug sind Beta-Pflicht.
 *
 *  - `self` (lesend)        → `null` (erlaubt) → weiter an den Executor.
 *  - `gate` (schreibend)    → 403: Freigabe nötig, aber der Meldekanal (Design-Vorgabe 10 /
 *                             7.8 P6a) ist noch nicht gebaut → eiserne Regel „kein Kanal ⇒ verweigert".
 *  - `consensus` (kritisch) → 403: Einzel-Freigabe genügt nicht; in der Beta zentral verweigert.
 *
 * Reine Funktion, wirft nicht. `null` = erlaubt, sonst die 403-Antwort. Exhaustiv über die
 * `McpExecutionTier`-Union (eine neue Stufe → Compile-Fehler statt stillem fail-open).
 */
export function enforceExecutionTier(
  tier: McpExecutionTier,
  server: string,
): McpIngressResponse | null {
  switch (tier) {
    case 'self':
      return null;
    case 'gate':
      return {
        status: 403,
        body: {
          error: 'write-tier tool requires operator approval; approval channel not configured (Beta remote-forward-only)',
          server,
          tier,
        },
      };
    case 'consensus':
      return {
        status: 403,
        body: { error: 'critical-tier tool denied in Beta (requires consensus approval)', server, tier },
      };
    default: {
      // Exhaustiveness-Guard: eine neue Stufe MUSS hier bewusst eingeordnet werden.
      const _exhaustive: never = tier;
      return {
        status: 403,
        body: { error: 'unknown execution tier (fail-closed)', server, tier: String(_exhaustive) },
      };
    }
  }
}

export interface McpIngressInput {
  /** Servername aus der Route (`/api/mcp/<server>`). */
  server: string;
  /** Authentifizierter Principal des EINGEHENDEN Aufrufs (mTLS-Cert-SAN / D3); null = unauth. */
  senderUri: string | null;
  /** Replizierte Registry-Capabilities (für `resolveMcp`). */
  capabilities: readonly Capability[];
  /** Optionaler MCP-JSON-RPC-Payload (für den späteren Executor durchgereicht; hier nicht inspiziert). */
  payload?: unknown;
}

export interface McpIngressDeps {
  /** Eigene (kanonische) SPIFFE-Identität — Provider-Vergleich + Sender beim Forward (D3). */
  selfAgentId: string;
  /** Endpoint-Auflösung für einen Owner-`agent_id` (im Daemon: MeshManager.getPeer). */
  resolvePeer: (agentId: string) => McpForwardPeer | undefined;
  /** Auth-Gate: darf dieser Sender den Proxy nutzen? (real: authorizeHttpsSender-basiert). */
  isAuthorizedSender: (senderUri: string) => boolean;
  /** Wert von `TLMCP_SPIFFE_SERVER_IDENTITY` (Default false = TOFU). */
  requireServerIdentity?: boolean;
  /** Injizierter Executor — führt local-exec / remote-forward AUS. KEIN Net-Egress in diesem Modul.
   *  CR-MEDIUM: `none` ist ausgeschlossen — der Typ erzwingt, dass `execute` nie mit einem
   *  nicht-routbaren Dispatch aufgerufen wird (fällt ein künftiges Refactor aus dem Guard, ist es
   *  ein Compile-Fehler statt eines stillen Bugs). */
  execute: (dispatch: Exclude<McpForwardDispatch, { kind: 'none' }>) => Promise<McpIngressResponse>;
}

/**
 * Behandelt einen MCP-Ingress-Aufruf. Reihenfolge fail-closed:
 *  1. Sender-Auth (D3) — fehlend/abgelehnt → 403, KEIN Dispatch.
 *  2. ungültiger Servername → 400.
 *  3. resolve → plan → spec → dispatch.
 *  4. `none` (kein Provider / nicht nutzbar / fehlkonfiguriert) → 503, KEIN Dispatch.
 *  5. Ausführungsstufe (ADR-033): `gate`/`consensus` → 403 fail-closed, KEIN Dispatch.
 *  6. `self` local/remote → an `execute` weiterreichen (Plan trägt D2-Pin/D3-Sender konsistent zu #195).
 */
export async function handleMcpIngress(
  input: McpIngressInput,
  deps: McpIngressDeps,
): Promise<McpIngressResponse> {
  // 1. D3 Auth-Gate (vor jeder Auflösung).
  if (!input.senderUri || input.senderUri.trim() === '' || !deps.isAuthorizedSender(input.senderUri)) {
    return { status: 403, body: { error: 'sender not authorized', server: input.server } };
  }

  // 2. Servername muss vorhanden sein.
  if (!input.server || input.server.trim() === '') {
    return { status: 400, body: { error: 'missing server' } };
  }

  // 3. Auflösung → Routing → Forward-Spec → mTLS-Dispatch-Plan. CR-MEDIUM: eigene Fehlergrenze —
  //    ein unerwarteter Throw (fehlerhafter Registry-Eintrag, resolvePeer, Exhaustiveness-Guard)
  //    darf NICHT als rejected Promise den `{status,body}`-Vertrag durchbrechen.
  let dispatch: McpForwardDispatch;
  try {
    const resolutions = resolveMcp(input.server, input.capabilities);
    const plan = planMcpRoute(input.server, resolutions, deps.selfAgentId);
    const spec = buildMcpForwardSpec({
      plan,
      selfSenderUri: deps.selfAgentId,
      resolvePeer: deps.resolvePeer,
      requireServerIdentity: deps.requireServerIdentity,
    });
    dispatch = buildMcpForwardDispatch(spec, {});
  } catch {
    return { status: 500, body: { error: 'internal routing error', server: input.server } };
  }

  // 4. Kein nutzbarer Pfad → 503 (kein Provider / offline / kein Endpoint / nicht-HTTPS …).
  if (dispatch.kind === 'none') {
    return { status: 503, body: { error: 'mcp unavailable', server: input.server, reason: dispatch.reason } };
  }

  // 5. ADR-033: Ausführungsstufe durchsetzen (Gate 2) VOR dem Executor. Die Stufe stammt aus
  //    demselben Dispatch, den der Executor auditiert (keine zweite, driftende Ableitung):
  //    local trägt sie direkt, remote im request-Plan. gate/consensus → 403 fail-closed.
  const tier = dispatch.kind === 'local' ? dispatch.execution_tier : dispatch.request.execution_tier;
  const denied = enforceExecutionTier(tier, input.server);
  if (denied) return denied;

  // 6. self (lesend) → an den injizierten Executor weiterreichen (kein Net-Egress hier).
  return deps.execute(dispatch);
}
