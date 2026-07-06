// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * mcp-forward-dispatch.ts — ADR-028 D4-b (D2-Forward, Prep): übersetzt eine `McpForwardSpec`
 * (Output von `buildMcpForwardSpec`, #193) in den **mTLS-Dispatch-Plan**, den der spätere
 * `/api/mcp/<server>`-Ingress ausführt. Verdrahtet die **D2-Server-Identity** (`expectedSpiffeId`
 * = Owner-`agent_id`) in die bestehende `MeshServerIdentityPolicy` + `OutboundConnectPolicy`
 * (mesh-connect/mesh-server-identity), und reicht die **D3-Sender-Identität** im Request-Plan durch.
 *
 * Reine Funktion: KEIN `fetch`/Dispatch, KEIN Netz/mTLS, KEIN I/O. Sie baut nur den Plan —
 * der eigentliche undici-Dispatch (`buildMeshConnector` + `verifyMeshServerIdentity`-Verifier
 * aus `serverIdentityPolicy.expectedSpiffeId`) ist der spätere Live-Ingress-Slice (Christians Gate).
 *
 * `local-exec` (eigener Node serviert) wird als Passthrough-Deskriptor zurückgegeben: der konkrete
 * lokale Invocation-Primitive (mcporter ist im Repo NICHT als Vertrag vorhanden; ADR-023 will
 * mcporter+stunnel sogar ersetzen) ist bewusst NICHT hier festgelegt — eigener Folge-Slice.
 */
import type { McpForwardSpec } from './mcp-forward.js';
import type { McpExecutionTier } from './mcp-service-registry.js';
import type { OutboundConnectPolicy } from './mesh-connect.js';
import type { MeshServerIdentityPolicy } from './mesh-server-identity.js';

export interface McpForwardRequestPlan {
  url: string;
  method: 'POST';
  targetAgentId: string;
  /** D3: behauptete eigene Sender-Identität (vom Empfänger via `authorizeHttpsSender` an das
   *  mTLS-Client-Cert gebunden). */
  senderUri: string;
  execution_tier: McpExecutionTier;
  /** D2: Outbound-mTLS-Policy — `spiffeServerIdentity` spiegelt `requireServerIdentity` der Spec. */
  outboundPolicy: OutboundConnectPolicy;
  /** D2: erwartete Server-Identität — NUR bei aktivem Pin gesetzt; sonst leer (= TOFU). */
  serverIdentityPolicy: MeshServerIdentityPolicy;
}

export type McpForwardDispatch =
  | { kind: 'remote'; request: McpForwardRequestPlan }
  | { kind: 'local'; server: string; execution_tier: McpExecutionTier }
  | { kind: 'none'; server: string; reason: string };

export interface BuildMcpForwardDispatchOptions {
  /** TLMCP_DEBUG_CONNECT (Default false). */
  debug?: boolean;
  /** TLMCP_DISABLE_OUTBOUND_PINNING (Default false). NUR Netz-Source-IP-Bind (EHOSTUNREACH-
   *  Workaround) — beeinflusst die SPIFFE-Identity-Prüfung NICHT. */
  disablePinning?: boolean;
}

/**
 * Baut den Dispatch-Plan aus der Forward-Spec. Rein.
 *
 * Invariante (D2): `serverIdentityPolicy.expectedSpiffeId` ist GENAU dann gesetzt, wenn
 * `outboundPolicy.spiffeServerIdentity === true` — kein Pin ohne aktiven Verifier und kein
 * aktiver Verifier ohne erwartete Identität (der Executor lehnt sonst fail-fast ab).
 */
export function buildMcpForwardDispatch(
  spec: McpForwardSpec,
  opts: BuildMcpForwardDispatchOptions = {},
): McpForwardDispatch {
  if (spec.kind === 'unavailable') {
    return { kind: 'none', server: spec.server, reason: spec.reason };
  }
  if (spec.kind === 'local-exec') {
    return { kind: 'local', server: spec.server, execution_tier: spec.execution_tier };
  }

  // CR-MEDIUM: expliziter Exhaustiveness-Guard. Ohne ihn würde eine künftige McpForwardSpec-
  // Variante mit denselben Feldnamen still in den remote-Pfad fallen → falscher mTLS-Dispatch.
  // `never`-Zuweisung = Compile-Fehler bei neuer Variante; throw = Runtime-Schutz.
  if (spec.kind !== 'remote-forward') {
    const _exhaustive: never = spec;
    throw new Error(`buildMcpForwardDispatch: unerwartete spec.kind ${(_exhaustive as { kind: string }).kind}`);
  }

  // spec.kind === 'remote-forward' → mTLS-Dispatch-Plan.
  const outboundPolicy: OutboundConnectPolicy = {
    debug: opts.debug ?? false,
    disablePinning: opts.disablePinning ?? false,
    // D2: SPIFFE-Server-Identity-Pin exakt dann aktiv, wenn die Spec ihn verlangt.
    spiffeServerIdentity: spec.requireServerIdentity,
  };
  const serverIdentityPolicy: MeshServerIdentityPolicy = spec.requireServerIdentity
    ? { expectedSpiffeId: spec.expectedServerSpiffeId }
    : {};

  return {
    kind: 'remote',
    request: {
      url: spec.url,
      method: 'POST',
      targetAgentId: spec.targetAgentId,
      senderUri: spec.senderUri,
      execution_tier: spec.execution_tier,
      outboundPolicy,
      serverIdentityPolicy,
    },
  };
}
