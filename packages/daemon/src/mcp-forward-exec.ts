/**
 * mcp-forward-exec.ts — ADR-028 D4-b (D2-Forward Exec-Schicht, **Skelett/Prep**): übersetzt einen
 * `McpForwardDispatch` (#195) in eine ausführungs-freie **Exec-Spezifikation** — entweder einen
 * **mcporter-Local-Exec-Stub** (eigener Node serviert) oder einen **mTLS-Forward-Deskriptor**
 * (Forward an den Owner). Re-prüft die D2-Pin-Invariante fail-closed.
 *
 * ⚠️ SKELETT: Es gibt im Repo **keinen stabilen mcporter-CLI-Vertrag** (ADR-028 D4 nennt mcporter
 * als lokalen Serve-Pfad; ADR-023 will mcporter+stunnel langfristig ersetzen). Das `argv` des
 * `mcporter-local`-Specs ist daher ein **provisorischer Platzhalter-Vertrag** (`MCPORTER_ARGV_STUB`),
 * der finalisiert wird, sobald die mcporter-Integration landet. Diese Datei führt **NICHTS aus**:
 * kein Net-Egress, kein `child_process`/mcporter-Call, kein Live-Wiring.
 *
 * Reine Funktion → vollständig unit-testbar. Der spätere echte Executor (undici-mTLS-Forward bzw.
 * mcporter-`spawn`) konsumiert diese Spec; das ist ein eigener gegateter Slice (Christians Gate).
 */
import type { McpForwardDispatch } from './mcp-forward-dispatch.js';
import type { McpExecutionTier } from './mcp-service-registry.js';

/** Default-Timeout für einen MCP-Exec/Forward (Stub-Wert; der echte Executor reicht ihn durch). */
export const DEFAULT_MCP_EXEC_TIMEOUT_MS = 30_000;

/**
 * Provisorischer mcporter-Aufruf-Vertrag (SKELETT). `<server>` wird durch den Servernamen ersetzt.
 * NICHT als finale CLI verstehen — Platzhalter bis zur mcporter-Integration.
 */
export const MCPORTER_ARGV_STUB = ['mcporter', 'run', '<server>'] as const;

export interface BuildMcpExecSpecOptions {
  /** Defense-in-depth: der Aufrufer wurde am Ingress (D3) bereits autorisiert. `false` → Auth-Reject. */
  authorized?: boolean;
  /** Timeout (ms); Default `DEFAULT_MCP_EXEC_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** mcporter-Config-Pfad (Stub) für den lokalen Exec. */
  mcporterConfigPath?: string;
}

export type McpExecSpec =
  | {
      kind: 'mcporter-local';
      server: string;
      execution_tier: McpExecutionTier;
      /** Provisorischer Aufruf-Vektor (SKELETT, s. MCPORTER_ARGV_STUB) — `<server>` ersetzt. */
      argv: readonly string[];
      configPath?: string;
      timeoutMs: number;
    }
  | {
      kind: 'mtls-forward';
      url: string;
      method: 'POST';
      targetAgentId: string;
      senderUri: string;
      execution_tier: McpExecutionTier;
      /** Spiegelt `outboundPolicy.spiffeServerIdentity` (#195). */
      requireServerIdentity: boolean;
      /** Erwartete Server-SPIFFE-Identität (nur bei aktivem Pin). */
      expectedServerSpiffeId?: string;
      timeoutMs: number;
    }
  | { kind: 'reject'; status: number; reason: string };

/**
 * Übersetzt einen Dispatch in die Exec-Spec. Rein + fail-closed:
 *  - `authorized === false` → 403 (Defense-in-depth zum Ingress-Auth-Gate).
 *  - `none` → 503 (kein nutzbarer Plan / Mismatch).
 *  - `remote` mit Pin-Inkonsistenz (Verifier an, aber kein `expectedSpiffeId`) → 500 (Pin-Violation).
 *  - sonst `mcporter-local` (Stub) bzw. `mtls-forward`.
 */
export function buildMcpExecSpec(dispatch: McpForwardDispatch, opts: BuildMcpExecSpecOptions = {}): McpExecSpec {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_MCP_EXEC_TIMEOUT_MS;

  // Defense-in-depth: explizit nicht autorisiert → kein Exec.
  if (opts.authorized === false) {
    return { kind: 'reject', status: 403, reason: 'sender not authorized' };
  }

  if (dispatch.kind === 'none') {
    return { kind: 'reject', status: 503, reason: dispatch.reason };
  }

  if (dispatch.kind === 'local') {
    return {
      kind: 'mcporter-local',
      server: dispatch.server,
      execution_tier: dispatch.execution_tier,
      argv: MCPORTER_ARGV_STUB.map((a) => (a === '<server>' ? dispatch.server : a)),
      configPath: opts.mcporterConfigPath,
      timeoutMs,
    };
  }

  // CR-MEDIUM M1: expliziter Exhaustiveness-Guard (wie buildMcpForwardDispatch) — eine künftige
  // request-tragende Variante darf nicht still in den Remote-Pfad fallen.
  if (dispatch.kind !== 'remote') {
    const _exhaustive: never = dispatch;
    throw new Error(`buildMcpExecSpec: unerwartete dispatch.kind ${(_exhaustive as { kind: string }).kind}`);
  }

  const req = dispatch.request;
  const pinActive = req.outboundPolicy.spiffeServerIdentity;
  const expected = req.serverIdentityPolicy.expectedSpiffeId;
  // CR-MEDIUM M2: ein LEERER expectedSpiffeId zählt NICHT als gesetzt — sonst entstünde ein
  // aktiver Pin ohne gültige SPIFFE-URI. Pin-Violation: aktiver Verifier ⊻ vorhandene Identität.
  const expectedPresent = expected !== undefined && expected !== '';
  if (pinActive !== expectedPresent) {
    return { kind: 'reject', status: 500, reason: 'pin violation: spiffeServerIdentity/expectedSpiffeId inkonsistent' };
  }

  return {
    kind: 'mtls-forward',
    url: req.url,
    method: req.method,
    targetAgentId: req.targetAgentId,
    senderUri: req.senderUri,
    execution_tier: req.execution_tier,
    requireServerIdentity: pinActive,
    // Nur bei aktivem Pin tragen wir die (garantiert nicht-leere) erwartete Identität.
    expectedServerSpiffeId: pinActive ? expected : undefined,
    timeoutMs,
  };
}
