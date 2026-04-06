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
import { createKeychainStore } from './keychain.js';
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
  '/api/auth/refresh',  // Token-Refresh (prueft selbst)
]);

/**
 * Laedt oder generiert das JWT-Secret.
 * Bevorzugt OS-Keychain, Fallback auf Datei.
 */
function loadOrCreateSecret(dataDir: string, log?: Logger): string {
  const keychain = createKeychainStore(log);

  // 1. Keychain probieren
  if (keychain) {
    const fromKeychain = keychain.get('jwt-secret');
    if (fromKeychain) return fromKeychain;
  }

  // 2. Datei-Fallback
  const secretPath = resolve(dataDir, 'jwt-secret');
  if (existsSync(secretPath)) {
    const fromFile = readFileSync(secretPath, 'utf-8').trim();
    // In Keychain migrieren wenn verfuegbar
    keychain?.set('jwt-secret', fromFile);
    return fromFile;
  }

  // 3. Neues Secret generieren
  const secret = randomBytes(32).toString('hex');
  if (keychain) {
    keychain.set('jwt-secret', secret);
    log?.info('JWT-Secret generiert (OS-Keychain)');
  } else {
    mkdirSync(dirname(secretPath), { recursive: true });
    writeFileSync(secretPath, secret, { mode: 0o600 });
    log?.info('JWT-Secret generiert (Datei-Fallback)');
  }
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
    // SECURITY: request.socket.remoteAddress statt request.ip verwenden,
    // da request.ip durch X-Forwarded-For gespooft werden kann
    const remoteAddr = request.socket.remoteAddress;
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
    // SECURITY: request.socket.remoteAddress statt request.ip (X-Forwarded-For bypass)
    const remoteAddr = request.socket.remoteAddress;
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

  // Token-Refresh-Endpoint (gueltiger Token noetig)
  app.post('/api/auth/refresh', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Alten Token verifizieren
      await request.jwtVerify();
      // Neuen Token ausstellen
      const newToken = app.jwt.sign(
        { scope: 'dashboard', iat: Math.floor(Date.now() / 1000) },
        { expiresIn: tokenTtl },
      );
      return { token: newToken, expires_in: tokenTtl };
    } catch {
      reply.code(401).send({ error: 'Unauthorized', message: 'Gueltiger Token fuer Refresh erforderlich' });
    }
  });

  log?.info({ tokenTtl }, 'API-Auth aktiviert (JWT + Refresh)');
}
