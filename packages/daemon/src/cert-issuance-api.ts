/**
 * cert-issuance-api.ts — ADR-022 Schritt 3 / WS-3: HTTP-API der Admin-CA (.94) für
 * die PoP-basierte `node/<PeerID>`-Cert-Ausstellung.
 *
 * Endpoints (auf dem HAUPT-mTLS-Server, Port 9440):
 *   POST /api/cert/nonce  → { nonce, caFingerprint }
 *       Liefert eine frische single-use Nonce + den Admin-CA-Fingerprint, den der
 *       Client in den PoP-Scope aufnimmt.
 *   POST /api/cert/sign   → { certPem }
 *       Verifiziert den PoP (Nonce, PeerID-Ableitung, CSR-Key-Bindung, Ed25519-Sig)
 *       und stellt das Cert mit SAN node/<PeerID> aus.
 *
 * AuthZ: Beide Endpoints liegen auf dem mTLS-Server (`requestCert + rejectUnauthorized`)
 * → nur ein Node mit einem CA-signierten Mesh-Cert (Legacy host/ ODER node/) erreicht
 * den Handler. Das ist der Anti-Abuse-Gate; die kryptografische Identität liefert der
 * PoP selbst. NUR auf Admin-Nodes registrieren (die einen CA-Key besitzen).
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Logger } from 'pino';
import type { RateLimiter } from './ratelimit.js';
import type { CertIssuer, CertSignRequest } from './cert-issuer.js';
import type { NonceStore } from './cert-issuer.js';

export interface CertIssuanceApiDeps {
  issuer: CertIssuer;
  nonceStore: NonceStore;
  log?: Logger;
  rateLimiter?: RateLimiter;
}

/** Verifiziert, dass die Verbindung mTLS-validiert ist (defense-in-depth zum Server-rejectUnauthorized). */
function isMutualTlsAuthorized(req: FastifyRequest): boolean {
  const sock = req.raw.socket as { authorized?: boolean };
  return sock.authorized === true;
}

export function registerCertIssuanceApi(server: FastifyInstance, deps: CertIssuanceApiDeps): void {
  const { issuer, nonceStore, log, rateLimiter } = deps;

  server.post('/api/cert/nonce', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!isMutualTlsAuthorized(req)) {
      return reply.code(401).send({ error: 'mTLS client certificate required' });
    }
    if (rateLimiter && !rateLimiter.allow(req.ip)) {
      return reply.code(429).send({ error: 'Too Many Requests' });
    }
    let nonce: string;
    try {
      nonce = nonceStore.issue();
    } catch {
      return reply.code(503).send({ error: 'Nonce capacity exhausted, retry shortly' });
    }
    return { nonce, caFingerprint: issuer.fingerprint };
  });

  server.post('/api/cert/sign', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!isMutualTlsAuthorized(req)) {
      return reply.code(401).send({ error: 'mTLS client certificate required' });
    }
    if (rateLimiter && !rateLimiter.allow(req.ip)) {
      return reply.code(429).send({ error: 'Too Many Requests' });
    }
    const body = req.body as Partial<CertSignRequest> | null;
    if (
      !body ||
      typeof body.peerId !== 'string' ||
      typeof body.ed25519PublicKeyB64 !== 'string' ||
      typeof body.spiffeUri !== 'string' ||
      typeof body.nonce !== 'string' ||
      typeof body.csrPem !== 'string' ||
      typeof body.popSignatureB64 !== 'string'
    ) {
      return reply.code(400).send({ error: 'peerId, ed25519PublicKeyB64, spiffeUri, nonce, csrPem, popSignatureB64 required' });
    }

    // Eigene IP des Antragstellers (nicht loopback) als IP-SAN ins Cert (für TLS-Hostname-
    // Prüfung). Identität bleibt die kanonische URI; der Admin-Hostname kommt NIE ins Cert.
    const requesterIps = [req.ip].filter((ip) => ip && ip !== '127.0.0.1' && ip !== '::1' && ip !== '::ffff:127.0.0.1');
    const result = await issuer.verifyAndIssue(body as CertSignRequest, requesterIps);
    if (!result.ok) {
      log?.warn({ peerId: body.peerId, reason: result.reason }, 'Cert-Ausstellung abgelehnt');
      return reply.code(403).send({ error: 'Cert issuance rejected', reason: result.reason });
    }
    return { certPem: result.certPem };
  });
}
