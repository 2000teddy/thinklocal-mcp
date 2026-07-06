// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * ADR-005 — SPIFFE URI helpers for per-agent-instance routing.
 *
 * A thinklocal SPIFFE URI has one of three shapes:
 *
 *   canonical node form (ADR-022 Phase 3, cert-attested — PREFERRED):
 *     spiffe://thinklocal/node/<PeerID>
 *
 *   legacy 3-component (daemon-level, cert-attested):
 *     spiffe://thinklocal/host/<stableNodeId>/agent/<agentType>
 *
 *   legacy 4-component (agent-instance, application-layer routing):
 *     spiffe://thinklocal/host/<stableNodeId>/agent/<agentType>/instance/<instanceId>
 *
 * ADR-028 D1: the canonical `node/<PeerID>` form is now a FIRST-CLASS
 * identity. Before this, `parseSpiffeUri`/`normalizeAgentId` only accepted
 * the legacy `host/agent` grammar, which made canonical-only nodes (e.g.
 * orchestrator .94, whose agent-card carries no legacy alias) UNADDRESSABLE
 * — inbox send failed with "must have 3 or 4 components". See ADR-028 §L1.
 *
 * IMPORTANT — cert attestation:
 *   Only the 3-component form is carried in the TLS certificate SAN.
 *   The `/instance/<id>` tail is **not** cryptographically verified.
 *   It is a logical routing key used by the inbox (ADR-005) and the
 *   cron-heartbeat (ADR-004 Phase 2). Code that performs trust decisions
 *   (cert validation, peer lookup, gossip) MUST strip the instance part
 *   before comparing — use `normalizeAgentId()` for this.
 *
 * GPT-5.4 + Gemini-Pro consensus 2026-04-08 21:30 explicitly separated
 * the two concerns: SPIFFE-URI for identity, instance-tail for routing.
 *
 * See: docs/architecture/ADR-005-per-agent-inbox.md
 */

/** Error thrown for malformed SPIFFE URIs. */
export class SpiffeUriError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpiffeUriError';
  }
}

/**
 * Canonical parsed identity. A discriminated union over `kind` keeps the
 * canonical `node/<PeerID>` identity and the legacy `host/agent` identity
 * cleanly separated — we never collapse a PeerID into the agentType slot
 * (CO 2026-06-16: gpt-5.3-codex flagged that as a routing/authz hazard).
 */
export type ParsedSpiffeUri = ParsedNodeUri | ParsedHostUri;

/** Canonical ADR-022 identity: `spiffe://thinklocal/node/<PeerID>`. */
export interface ParsedNodeUri {
  readonly kind: 'node';
  /** libp2p PeerID (base58btc), the stable canonical node identity. */
  readonly nodePeerId: string;
  /** Original input, for logging/debugging. */
  readonly raw: string;
}

/** Legacy identity: `spiffe://thinklocal/host/<stableNodeId>/agent/<agentType>[/instance/<id>]`. */
export interface ParsedHostUri {
  readonly kind: 'host';
  /**
   * Node identifier — historisch eine stabile 16-hex-ID (nicht der mDNS-Hostname).
   * HINWEIS (A1): bei Instanz-URIs, die aus einer kanonischen `node/<PeerID>`-Daemon-
   * Identität abgeleitet wurden (`buildInstanceSpiffe`, agent-api.ts), steht hier die
   * **base58btc-PeerID** im Node-Slot. Dieses Feld ist ein opaker String —
   * keine Hex-/Längen-Annahme treffen. Nur `SPIFFE_COMPONENT_REGEX`-validiert.
   */
  readonly stableNodeId: string;
  /** Agent family: `claude-code`, `codex`, `gemini-cli`, … */
  readonly agentType: string;
  /** Optional 4th component — present only for per-instance URIs. */
  readonly instanceId?: string;
  /** Original input, for logging/debugging. */
  readonly raw: string;
}

const SPIFFE_PREFIX = 'spiffe://thinklocal';

/**
 * libp2p PeerID charset (base58btc) + length sanity. Real PeerIDs are
 * ~46–52 chars (CIDv0 `Qm…` / `12D3Koo…`). Strict charset — no `0OIl` —
 * and a length band reject obvious garbage without rejecting valid IDs.
 */
export const PEERID_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,128}$/;

/**
 * Canonical character set allowed in every SPIFFE-URI component
 * that this codebase produces or accepts.
 *
 * Centralising the regex here keeps the parse layer and the REST
 * query-parameter validators (inbox-api.ts, agent-api.ts) in sync
 * — otherwise a 4-component URI could be written to the inbox
 * with characters that the `for_instance` query filter later
 * rejects, creating an asymmetric write/read hole.
 * (Gemini-Pro CR finding 2026-04-09, MEDIUM.)
 */
export const SPIFFE_COMPONENT_REGEX = /^[A-Za-z0-9._-]+$/;

/**
 * Parse a thinklocal SPIFFE URI into its components. Throws
 * `SpiffeUriError` on malformed input. Accepts both 3- and
 * 4-component forms.
 */
export function parseSpiffeUri(uri: string): ParsedSpiffeUri {
  if (typeof uri !== 'string' || uri.length === 0) {
    throw new SpiffeUriError('SPIFFE URI must be a non-empty string');
  }
  if (!uri.startsWith(`${SPIFFE_PREFIX}/`)) {
    throw new SpiffeUriError(`SPIFFE URI must start with "${SPIFFE_PREFIX}/", got: ${uri}`);
  }
  const rest = uri.slice(`${SPIFFE_PREFIX}/`.length);
  const parts = rest.split('/');
  // Canonical ADR-022 form: node/<PeerID> (2 tokens). Checked FIRST so the
  // legacy grammar below stays untouched. Strict: exactly 2 tokens, valid
  // base58btc PeerID — anything else (e.g. node/x/agent/y) falls through to
  // the host-grammar error, preserving existing reject behaviour.
  if (parts[0] === 'node') {
    if (parts.length !== 2) {
      throw new SpiffeUriError(
        `canonical node URI must be "node/<PeerID>" (2 path tokens), got ${parts.length}: ${uri}`,
      );
    }
    const nodePeerId = parts[1];
    if (!nodePeerId) {
      throw new SpiffeUriError(`canonical node URI has empty PeerID: ${uri}`);
    }
    if (!PEERID_REGEX.test(nodePeerId)) {
      throw new SpiffeUriError(
        `canonical node URI has invalid PeerID (must match ${PEERID_REGEX}): ${uri}`,
      );
    }
    return { kind: 'node', nodePeerId, raw: uri };
  }
  // Accept: host/<id>/agent/<type>           (4 tokens → 3-comp)
  //         host/<id>/agent/<type>/instance/<id> (6 tokens → 4-comp)
  if (parts.length !== 4 && parts.length !== 6) {
    throw new SpiffeUriError(
      `SPIFFE URI must have 3 or 4 components (4 or 6 path tokens), got ${parts.length}: ${uri}`,
    );
  }
  if (parts[0] !== 'host' || parts[2] !== 'agent') {
    throw new SpiffeUriError(
      `SPIFFE URI must match "host/<id>/agent/<type>[/instance/<id>]": ${uri}`,
    );
  }
  const stableNodeId = parts[1];
  const agentType = parts[3];
  if (!stableNodeId || !agentType) {
    throw new SpiffeUriError(`SPIFFE URI has empty stableNodeId or agentType: ${uri}`);
  }
  if (!SPIFFE_COMPONENT_REGEX.test(stableNodeId)) {
    throw new SpiffeUriError(
      `SPIFFE URI has invalid characters in stableNodeId (must match ${SPIFFE_COMPONENT_REGEX}): ${uri}`,
    );
  }
  if (!SPIFFE_COMPONENT_REGEX.test(agentType)) {
    throw new SpiffeUriError(
      `SPIFFE URI has invalid characters in agentType (must match ${SPIFFE_COMPONENT_REGEX}): ${uri}`,
    );
  }
  if (parts.length === 6) {
    if (parts[4] !== 'instance') {
      throw new SpiffeUriError(`SPIFFE URI 4-component form must use "/instance/": ${uri}`);
    }
    const instanceId = parts[5];
    if (!instanceId) {
      throw new SpiffeUriError(`SPIFFE URI has empty instanceId: ${uri}`);
    }
    if (!SPIFFE_COMPONENT_REGEX.test(instanceId)) {
      throw new SpiffeUriError(
        `SPIFFE URI has invalid characters in instanceId (must match ${SPIFFE_COMPONENT_REGEX}): ${uri}`,
      );
    }
    return { kind: 'host', stableNodeId, agentType, instanceId, raw: uri };
  }
  return { kind: 'host', stableNodeId, agentType, raw: uri };
}

/**
 * Reduce a URI to its canonical daemon-level identity for comparison.
 * Cert-validation, peer lookups, gossip and inbox routing **must** use
 * this form. Behaviour by kind:
 *   - canonical `node/<PeerID>` → returned unchanged (already daemon-level).
 *   - legacy `host/agent[/instance]` → `/instance/<id>` tail stripped.
 *
 * Throws `SpiffeUriError` on malformed input.
 */
export function normalizeAgentId(uri: string): string {
  const parsed = parseSpiffeUri(uri);
  if (parsed.kind === 'node') {
    return `${SPIFFE_PREFIX}/node/${parsed.nodePeerId}`;
  }
  return `${SPIFFE_PREFIX}/host/${parsed.stableNodeId}/agent/${parsed.agentType}`;
}

/**
 * Extract the instance id, or `undefined` if the URI is daemon-level
 * (canonical node form, or legacy 3-component). Throws on malformed input.
 */
export function getAgentInstance(uri: string): string | undefined {
  const parsed = parseSpiffeUri(uri);
  return parsed.kind === 'host' ? parsed.instanceId : undefined;
}

/**
 * Build a 4-component instance URI from its parts. Does not
 * validate the `stableNodeId` format — callers are expected to
 * pass values they already trust.
 */
export function buildInstanceUri(
  stableNodeId: string,
  agentType: string,
  instanceId: string,
): string {
  if (!stableNodeId || !agentType || !instanceId) {
    throw new SpiffeUriError('buildInstanceUri: all three parts must be non-empty');
  }
  for (const [label, value] of [
    ['stableNodeId', stableNodeId],
    ['agentType', agentType],
    ['instanceId', instanceId],
  ] as const) {
    if (!SPIFFE_COMPONENT_REGEX.test(value)) {
      throw new SpiffeUriError(
        `buildInstanceUri: ${label} contains invalid characters (must match ${SPIFFE_COMPONENT_REGEX}): ${value}`,
      );
    }
  }
  return `${SPIFFE_PREFIX}/host/${stableNodeId}/agent/${agentType}/instance/${instanceId}`;
}

/**
 * Return `true` if the URI includes an `/instance/<id>` tail.
 */
export function hasInstance(uri: string): boolean {
  try {
    return getAgentInstance(uri) !== undefined;
  } catch {
    return false;
  }
}
