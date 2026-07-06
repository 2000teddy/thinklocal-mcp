// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * mcp-forward.ts — ADR-028 D4-b (Forward-Spec, Prep): übersetzt einen `McpRoutePlan`
 * (Output von `planMcpRoute`) in eine konkrete, AUSFÜHRUNGS-FREIE Spezifikation, WIE der
 * MCP-Aufruf bedient wird:
 *  - `local-exec`   — der eigene Node serviert (späterer lokaler mcporter-Exec),
 *  - `remote-forward` — Forward an den Owner-Peer über mTLS (`/api/mcp/<server>` + D3-Sender-Binding),
 *  - `unavailable`  — kein nutzbarer Pfad (kein Provider / kein Endpoint / Fehlkonfiguration).
 *
 * Reine Funktion: KEIN Netz/mTLS, KEIN `child_process`/mcporter, KEIN I/O. Die Endpoint-Auflösung
 * wird als `resolvePeer`-Callback injiziert (im Daemon = MeshManager.getPeer → MeshPeer.endpoint),
 * damit der Builder unit-testbar bleibt. Der spätere `/api/mcp/<server>`-Ingress ruft
 * `resolveMcp` → `planMcpRoute` → `buildMcpForwardSpec` und FÜHRT die Spec dann aus
 * (undici-mTLS-Dispatcher mit Server-Identity-Pin bzw. lokaler mcporter-Call).
 *
 * Fail-closed: jede Lücke (fehlender Endpoint, nicht-HTTPS-Endpoint, fehlende Sender-Identität)
 * ergibt `unavailable` mit Grund — NIE ein Forward über einen unsicheren/unbekannten Pfad.
 */
import type { McpRoutePlan } from './mcp-routing.js';
import type { McpExecutionTier } from './mcp-service-registry.js';

/**
 * Minimal-Sicht auf einen Peer-Endpoint (entkoppelt von MeshPeer, damit der Builder rein bleibt).
 * `endpoint` ist die Basis-URL des Peers, z.B. `https://10.10.10.82:9440`.
 */
export interface McpForwardPeer {
  agentId: string;
  endpoint: string;
}

export type McpForwardSpec =
  | {
      kind: 'local-exec';
      server: string;
      execution_tier: McpExecutionTier;
    }
  | {
      kind: 'remote-forward';
      server: string;
      targetAgentId: string;
      /** Vollständige Ingress-URL beim Owner: `${endpoint}/api/mcp/<server>`. */
      url: string;
      /** Eigene (kanonische) SPIFFE-Identität für `envelope.sender` (D3-Sender-Binding). */
      senderUri: string;
      execution_tier: McpExecutionTier;
      /** Spiegelt das Flag `TLMCP_SPIFFE_SERVER_IDENTITY` — ob die Server-Identität gepinnt wird. */
      requireServerIdentity: boolean;
      /** Erwartete Server-SPIFFE-Identität (= Owner-agent_id) für `checkServerIdentity`-Pin. */
      expectedServerSpiffeId: string;
    }
  | { kind: 'unavailable'; server: string; reason: string };

export interface BuildMcpForwardSpecArgs {
  plan: McpRoutePlan;
  /** Eigene SPIFFE-Identität (für Remote-Forward zwingend nicht-leer). */
  selfSenderUri: string;
  /** Endpoint-Auflösung für einen Owner-agent_id; `undefined` = unbekannt/offline. */
  resolvePeer: (agentId: string) => McpForwardPeer | undefined;
  /** Wert von `TLMCP_SPIFFE_SERVER_IDENTITY` (Default: false = TOFU). */
  requireServerIdentity?: boolean;
}

/**
 * Baut die Forward-Spec aus dem Routing-Plan. Rein + fail-closed.
 */
export function buildMcpForwardSpec(args: BuildMcpForwardSpecArgs): McpForwardSpec {
  const { plan, selfSenderUri, resolvePeer } = args;
  const requireServerIdentity = args.requireServerIdentity ?? false;

  if (plan.mode === 'none') {
    return { kind: 'unavailable', server: plan.server, reason: plan.reason };
  }

  if (plan.mode === 'local') {
    return { kind: 'local-exec', server: plan.server, execution_tier: plan.execution_tier };
  }

  // plan.mode === 'remote' — Forward an den Owner-Peer.
  const targetAgentId = plan.target.agent_id;

  // Remote-Forward braucht eine eigene Sender-Identität (D3). Fehlt sie → fail-closed.
  if (!selfSenderUri || selfSenderUri.trim() === '') {
    return { kind: 'unavailable', server: plan.server, reason: 'keine eigene Sender-Identität für Forward' };
  }

  const peer = resolvePeer(targetAgentId);
  if (!peer || !peer.endpoint || peer.endpoint.trim() === '') {
    return {
      kind: 'unavailable',
      server: plan.server,
      reason: `kein Endpoint für Provider ${targetAgentId} (nicht verbunden/unbekannt)`,
    };
  }

  // Mesh-Forward MUSS über HTTPS laufen (mTLS) — ein Plaintext-Endpoint würde den Forward
  // ungeschützt leaken. Fail-closed statt Downgrade.
  let parsed: URL;
  try {
    parsed = new URL(peer.endpoint);
  } catch {
    return { kind: 'unavailable', server: plan.server, reason: `ungültiger Endpoint für ${targetAgentId}: '${peer.endpoint}'` };
  }
  if (parsed.protocol !== 'https:') {
    return {
      kind: 'unavailable',
      server: plan.server,
      reason: `nicht-HTTPS-Endpoint für ${targetAgentId} (${parsed.protocol}) — Forward nur über mTLS`,
    };
  }

  // CR-MEDIUM: aus dem GEPARSTEN URL nur die origin (scheme://host:port) nehmen — NICHT den
  // Rohstring. Sonst würden Path/Query/Userinfo/Fragment im Endpoint (z.B.
  // `https://host:9440/x?a=b`) in die Forward-URL durchschlagen und das Ziel verfälschen.
  const url = `${parsed.origin}/api/mcp/${encodeURIComponent(plan.server)}`;

  return {
    kind: 'remote-forward',
    server: plan.server,
    targetAgentId,
    url,
    senderUri: selfSenderUri,
    execution_tier: plan.target.execution_tier,
    requireServerIdentity,
    expectedServerSpiffeId: targetAgentId,
  };
}
