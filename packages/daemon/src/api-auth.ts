/**
 * api-auth.ts — JWT-basierte API-Authentifizierung
 *
 * Schuetzt die Dashboard-API und WebSocket-Verbindungen.
 * Token wird beim Pairing oder per CLI generiert.
 *
 * Architektur:
 * - JWT Secret wird beim ersten Start generiert und gespeichert
 * - Token-Lebensdauer: 24h (konfigurierbar)
 * - Oeffentliche Endpoints: /health, /.well-known/agent-card.json
 * - Geschuetzte Endpoints: /api/*, /graphql, /ws
 * - /api/auth/token: Generiert neuen Token (nur lokal)
 */

import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import type { Logger } from 'pino';

// Oeffentliche Pfade die KEINEN Token brauchen
const PUBLIC_PATHS = new Set([
  '/health',
  '/.well-known/agent-card.json',
  '/message',           // Peer-zu-Peer (eigene ECDSA-Signatur)
  '/pairing/start',
  '/pairing/init',
  '/pairing/confirm',
  '/pairing/status',
  '/api/auth/token',    // Token-Generierung (nur localhost)
]);

/**
 * Laedt oder generiert das JWT-Secret.
 */
function loadOrCreateSecret(dataDir: string, log?: Logger): string {
  const secretPath = resolve(dataDir, 'jwt-secret');
  if (existsSync(secretPath)) {
    return readFileSync(secretPath, 'utf-8').trim();
  }

  const secret = randomBytes(32).toString('hex');
  mkdirSync(dirname(secretPath), { recursive: true });
  writeFileSync(secretPath, secret, { mode: 0o600 });
  log?.info('JWT-Secret generiert');
  return secret;
}

export interface ApiAuthConfig {
  /** Aktiviert JWT-Auth (default: false fuer Entwicklung) */
  enabled: boolean;
  /** Token-Lebensdauer in Stunden (default: 24) */
  tokenTtlHours?: number;
  /** Data-Verzeichnis fuer JWT-Secret */
  dataDir: string;
}

/**
 * Registriert JWT-Authentifizierung auf einer Fastify-Instanz.
 */
export async function registerApiAuth(
  app: FastifyInstance,
  config: ApiAuthConfig,
  log?: Logger,
): Promise<void> {
  if (!config.enabled) {
    log?.debug('API-Auth deaktiviert (Entwicklungsmodus)');
    return;
  }

  const secret = loadOrCreateSecret(config.dataDir, log);
  const tokenTtl = `${config.tokenTtlHours ?? 24}h`;

  // JWT Plugin registrieren
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await app.register(fastifyJwt as any, { secret });

  // Auth-Hook fuer alle Requests (ausser oeffentliche Pfade)
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const path = request.url.split('?')[0]; // Query-Parameter entfernen

    // Oeffentliche Pfade durchlassen
    if (PUBLIC_PATHS.has(path)) return;

    // Localhost-Requests ohne Auth erlauben (fuer CLI + MCP)
    const remoteAddr = request.ip;
    if (remoteAddr === '127.0.0.1' || remoteAddr === '::1' || remoteAddr === '::ffff:127.0.0.1') {
      return;
    }

    // Token pruefen
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ error: 'Unauthorized', message: 'Gueltiger JWT-Token erforderlich' });
    }
  });

  // Token-Generierungs-Endpoint (nur localhost)
  app.post('/api/auth/token', async (request: FastifyRequest, reply: FastifyReply) => {
    const remoteAddr = request.ip;
    if (remoteAddr !== '127.0.0.1' && remoteAddr !== '::1' && remoteAddr !== '::ffff:127.0.0.1') {
      reply.code(403).send({ error: 'Forbidden', message: 'Token-Generierung nur von localhost' });
      return;
    }

    const token = app.jwt.sign(
      { scope: 'dashboard', iat: Math.floor(Date.now() / 1000) },
      { expiresIn: tokenTtl },
    );

    return { token, expires_in: tokenTtl };
  });

  log?.info({ tokenTtl }, 'API-Auth aktiviert (JWT)');
}
