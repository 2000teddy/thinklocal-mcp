/**
 * token-api.ts — REST-Endpoints fuer Token-basiertes Onboarding (ADR-016 Phase 2)
 *
 * Stellt Endpoints bereit fuer:
 *
 *   POST /api/token/create    — Admin erstellt ein Onboarding-Token (loopback-only)
 *   GET  /api/token/list       — Alle Tokens auflisten (loopback-only)
 *   POST /api/token/revoke     — Token widerrufen (loopback-only)
 *   POST /onboarding/join      — Neuer Node joined mit Bearer-Token (remote, kein mTLS)
 *
 * Der /onboarding/join Endpoint ist der einzige der von aussen erreichbar ist.
 * Er validiert den Bearer-Token, generiert ein Node-Zertifikat signiert mit
 * der CA des Admin-Nodes, und gibt CA-Cert + Node-Cert + Key zurueck.
 *
 * SECURITY: Der CA-Key verlässt nie den Admin-Node. Nur signierte Zertifikate
 * werden an den neuen Node uebertragen.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { TokenStore } from './token-store.js';
import type { PairingStore, PairedPeer } from './pairing.js';
import type { TrustStoreNotifier } from './trust-store.js';
import type { AuditLog } from './audit.js';
import { createNodeCert, type CaBundle } from './tls.js';
import type { Logger } from 'pino';
import type { RateLimiter } from './ratelimit.js';

export interface TokenApiDeps {
  tokenStore: TokenStore;
  pairingStore: PairingStore;
  trustStoreNotifier?: TrustStoreNotifier;
  audit: AuditLog;
  /** CA bundle for signing new node certs. Only available on admin nodes. */
  caBundle?: CaBundle;
  ownAgentId: string;
  log?: Logger;
  /** Rate-limiter for /onboarding/join (CR: defense-in-depth) */
  rateLimiter?: RateLimiter;
}

/**
 * Loopback guard — rejects non-localhost requests.
 */
function requireLocal(req: FastifyRequest, reply: FastifyReply): boolean {
  const ip = req.ip;
  if (ip !== '127.0.0.1' && ip !== '::1' && ip !== '::ffff:127.0.0.1') {
    void reply.code(403).send({ error: 'this endpoint is loopback-only' });
    return false;
  }
  return true;
}

export function registerTokenApi(server: FastifyInstance, deps: TokenApiDeps): void {
  const { tokenStore, pairingStore, trustStoreNotifier, audit, caBundle, ownAgentId, log } = deps;

  // ---- Admin Endpoints (loopback-only) ----

  /**
   * POST /api/token/create
   * Creates a new onboarding token. Admin-only (loopback).
   *
   * Body: { name: string, ttl_hours?: number }
   * Response: { token: string, id: string, name: string, expires_at: string }
   */
  server.post('/api/token/create', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireLocal(req, reply)) return;

    const body = req.body as { name?: string; ttl_hours?: number } | null;
    if (!body?.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
      return reply.code(400).send({ error: 'name is required (non-empty string)' });
    }

    const name = body.name.trim();
    if (name.length > 64) {
      return reply.code(400).send({ error: 'name must be <= 64 characters' });
    }

    // TTL: default 24h, max 168h (7 days), min 5 minutes
    const ttlHours = body.ttl_hours ?? 24;
    if (typeof ttlHours !== 'number' || ttlHours < 0.083 || ttlHours > 168) {
      return reply.code(400).send({ error: 'ttl_hours must be between 0.083 (5min) and 168 (7d)' });
    }
    const ttlMs = Math.round(ttlHours * 60 * 60 * 1000);

    const result = tokenStore.createToken(name, ownAgentId, ttlMs);
    audit.append('TOKEN_CREATE', ownAgentId, result.id, 'token', result.id);

    log?.info({ tokenId: result.id, name, ttlHours, expiresAt: result.expiresAt }, 'Onboarding-Token erstellt');

    return {
      token: result.token,
      id: result.id,
      name,
      expires_at: result.expiresAt,
      message: `Token erstellt. Einmal verwendbar, gueltig bis ${result.expiresAt}.`,
    };
  });

  /**
   * GET /api/token/list
   * Lists all tokens (without plaintext). Admin-only (loopback).
   */
  server.get('/api/token/list', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireLocal(req, reply)) return;

    const tokens = tokenStore.listAllTokens();
    return { tokens, count: tokens.length };
  });

  /**
   * POST /api/token/revoke
   * Revokes a token by ID. Admin-only (loopback).
   *
   * Body: { id: string }
   */
  server.post('/api/token/revoke', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireLocal(req, reply)) return;

    const body = req.body as { id?: string } | null;
    if (!body?.id || typeof body.id !== 'string') {
      return reply.code(400).send({ error: 'id is required' });
    }

    const revoked = tokenStore.revokeToken(body.id);
    if (!revoked) {
      return reply.code(404).send({ error: 'Token not found or already revoked' });
    }

    audit.append('TOKEN_REVOKE', ownAgentId, body.id, 'token', body.id);
    log?.info({ tokenId: body.id }, 'Onboarding-Token widerrufen');

    return { status: 'revoked', id: body.id };
  });

  // ---- Public Endpoint (remote-accessible) ----

  /**
   * POST /onboarding/join
   * A new node joins the mesh using a Bearer token.
   *
   * Headers: Authorization: Bearer tlmcp_...
   * Body: { hostname: string, agent_id: string, public_key_pem: string }
   * Response: { signed_cert_pem, key_pem, ca_cert_pem, admin_agent_id, mesh_name }
   *
   * SECURITY: This endpoint does NOT require mTLS (the new node doesn't have
   * a cert yet). It validates the Bearer token instead.
   */
  server.post('/onboarding/join', async (req: FastifyRequest, reply: FastifyReply) => {
    // 1. Extract Bearer token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'Missing Authorization: Bearer <token>' });
    }
    const rawToken = authHeader.slice(7).trim();

    // 2. Rate-limiting on join endpoint (CR Gemini Pro HIGH: defense-in-depth)
    // Max 5 join attempts per IP per minute
    const joinKey = `onboarding:${req.ip}`;
    if (deps.rateLimiter && !deps.rateLimiter.allow(joinKey)) {
      log?.warn({ ip: req.ip }, 'Onboarding-Join rate-limited');
      return reply.code(429).send({ error: 'Too many join attempts. Try again later.' });
    }

    // 3. Validate token
    const validation = tokenStore.validateToken(rawToken);
    if (!validation.valid) {
      log?.warn({ reason: validation.reason, ip: req.ip }, 'Onboarding-Join abgelehnt');
      audit.append('TOKEN_JOIN_REJECTED', req.ip, validation.reason ?? 'unknown');
      return reply.code(403).send({ error: `Token rejected: ${validation.reason}` });
    }

    // 4. Parse + validate body (CR Gemini Pro MEDIUM: input validation)
    const body = req.body as {
      hostname?: string;
      agent_id?: string;
      public_key_pem?: string;
    } | null;

    if (!body?.hostname || !body?.agent_id) {
      return reply.code(400).send({ error: 'hostname and agent_id are required' });
    }

    // Strict hostname validation (RFC 1123 subset: letters, digits, hyphens, dots)
    const HOSTNAME_REGEX = /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]{0,61}[a-zA-Z0-9])?$/;
    if (!HOSTNAME_REGEX.test(body.hostname)) {
      return reply.code(400).send({ error: 'Invalid hostname format' });
    }

    // SPIFFE-URI validation
    const SPIFFE_REGEX = /^spiffe:\/\/[a-zA-Z0-9.-]+\/host\/[a-zA-Z0-9._-]+\/agent\/[a-zA-Z0-9._-]+$/;
    if (!SPIFFE_REGEX.test(body.agent_id)) {
      return reply.code(400).send({ error: 'Invalid agent_id (must be a valid SPIFFE URI)' });
    }

    // 4. Check if CA bundle is available (only admin nodes can sign certs)
    if (!caBundle) {
      log?.error('Onboarding-Join: CA-Bundle nicht verfuegbar — dieser Node ist kein Admin-Node');
      return reply.code(500).send({ error: 'This node cannot sign certificates (not an admin node)' });
    }

    const newNodeSpiffeUri = body.agent_id;

    // 5. Mark token as used BEFORE cert generation (CR Gemini Pro CRITICAL:
    //    TOCTOU race fix — consume token first so concurrent requests fail)
    tokenStore.markUsed(validation.tokenId, newNodeSpiffeUri);

    // 6. Generate signed cert for the new node
    const ipAddresses = [req.ip].filter(ip => ip !== '127.0.0.1' && ip !== '::1');

    try {
      const nodeCert = createNodeCert(
        caBundle,
        body.hostname,
        newNodeSpiffeUri,
        ipAddresses,
      );

      // 7. Register as paired peer (so mTLS works after join)
      const newPeer: PairedPeer = {
        agentId: newNodeSpiffeUri,
        publicKeyPem: body.public_key_pem ?? '',
        caCertPem: caBundle.caCertPem, // They share our CA
        fingerprint: '',
        pairedAt: new Date().toISOString(),
        hostname: body.hostname,
      };
      pairingStore.addPeer(newPeer);

      // 8. Hot-reload trust store
      trustStoreNotifier?.rebuild();

      // 9. Audit
      audit.append('TOKEN_JOIN_SUCCESS', newNodeSpiffeUri, validation.tokenId, 'token', validation.tokenId);

      log?.info(
        { peer: newNodeSpiffeUri, hostname: body.hostname, tokenId: validation.tokenId },
        'Neuer Node via Token-Onboarding gejoined',
      );

      // Collect ALL trusted CAs (own + all paired peers) so the new node
      // can communicate with the entire mesh, not just the admin.
      const allCAs = trustStoreNotifier?.current() ?? [caBundle.caCertPem];

      // Also pass the list of paired peers so the new node can add them
      // to its PairingStore for bidirectional trust.
      const existingPeers = pairingStore.getAllPeers()
        .filter(p => p.agentId !== newNodeSpiffeUri) // don't include self
        .map(p => ({
          agentId: p.agentId,
          caCertPem: p.caCertPem,
          hostname: p.hostname,
        }));

      return {
        signed_cert_pem: nodeCert.certPem,
        key_pem: nodeCert.keyPem,
        ca_cert_pem: caBundle.caCertPem,
        trusted_ca_bundle: allCAs,
        peers: existingPeers,
        admin_agent_id: ownAgentId,
        mesh_name: 'thinklocal',
        message: `Willkommen im Mesh! Zertifikat fuer ${body.hostname} ausgestellt (90 Tage gueltig). ${allCAs.length} CA(s), ${existingPeers.length} Peer(s) uebertragen.`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log?.error({ err: msg, hostname: body.hostname }, 'Onboarding-Join: Cert-Erstellung fehlgeschlagen');
      return reply.code(500).send({ error: `Certificate generation failed: ${msg}` });
    }
  });
}
