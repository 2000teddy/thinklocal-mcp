/**
 * pairing-handler.ts — HTTP-Endpoints für den SPAKE2 Pairing-Flow
 *
 * Registriert Fastify-Routen für die PIN-basierte Trust-Zeremonie:
 *
 * POST /pairing/init     — Startet Pairing (Initiator sendet SPAKE2 Message)
 * POST /pairing/respond  — Responder antwortet mit eigener SPAKE2 Message
 * POST /pairing/confirm  — Austausch der verschlüsselten CA/Key-Daten
 * GET  /pairing/status   — Aktueller Pairing-Status
 * POST /pairing/start    — Generiert PIN und wartet auf Pairing-Anfrage
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { spake2 } from '@niomon/spake2';
import {
  generatePin,
  deriveKey,
  encryptWithKey,
  decryptWithKey,
  type PairingStore,
  type PairedPeer,
  type PairingPayload,
} from './pairing.js';
import { createHash } from 'node:crypto';
import type { Logger } from 'pino';

export interface PairingHandlerDeps {
  store: PairingStore;
  agentId: string;
  hostname: string;
  publicKeyPem: string;
  caCertPem: string;
  fingerprint: string;
  log?: Logger;
}

interface PairingSession {
  pin: string;
  state: 'waiting' | 'handshake' | 'completed' | 'failed';
  createdAt: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  spakeInstance: any;
  sharedKey: Buffer | null;
  peerAgentId: string | null;
}

export function registerPairingRoutes(server: FastifyInstance, deps: PairingHandlerDeps): void {
  const { store, log } = deps;

  // Aktive Pairing-Session (nur eine gleichzeitig)
  let activeSession: PairingSession | null = null;
  let failedAttempts = 0;

  // Session-Timeout: 5 Minuten
  const SESSION_TIMEOUT_MS = 5 * 60_000;

  function cleanExpiredSession(): void {
    if (activeSession && Date.now() - activeSession.createdAt > SESSION_TIMEOUT_MS) {
      log?.info('Pairing-Session abgelaufen');
      activeSession = null;
    }
  }

  /**
   * POST /pairing/start — Generiert eine PIN und wartet auf Pairing-Anfrage
   * Body: {} (leer)
   * Response: { pin: "123456", expires_in_seconds: 300 }
   */
  server.post('/pairing/start', async (_request: FastifyRequest, reply: FastifyReply) => {
    cleanExpiredSession();

    if (activeSession && activeSession.state === 'waiting') {
      return reply.code(409).send({ error: 'Pairing already in progress' });
    }

    const pin = generatePin();
    const suite = spake2.SPAKE2_ED25519_SHA256_HKDF_HMAC;
    const instance = new suite.Verifier(
      Buffer.from(pin),
      Buffer.from('thinklocal-mesh'),
      Buffer.from(deps.agentId),
    );

    activeSession = {
      pin,
      state: 'waiting',
      createdAt: Date.now(),
      spakeInstance: instance,
      sharedKey: null,
      peerAgentId: null,
    };

    // SECURITY: PIN wird NUR im Return-Value angezeigt, NICHT geloggt
    log?.info('Pairing-PIN generiert (nicht geloggt aus Sicherheitsgruenden)');

    return {
      pin,
      expires_in_seconds: Math.floor(SESSION_TIMEOUT_MS / 1000),
      message: 'PIN dem Benutzer des anderen Nodes mitteilen',
    };
  });

  /**
   * POST /pairing/init — Initiator startet Handshake
   * Body: { agent_id, hostname, pin, spake_message (base64) }
   * Response: { spake_message (base64) }
   */
  server.post('/pairing/init', async (request: FastifyRequest, reply: FastifyReply) => {
    cleanExpiredSession();

    const body = request.body as {
      agent_id: string;
      hostname: string;
      pin: string;
      spake_message: string;
    };

    if (!body.agent_id || !body.pin || !body.spake_message) {
      return reply.code(400).send({ error: 'Missing required fields' });
    }

    // SECURITY: /pairing/init erfordert eine lokal gestartete Session
    if (!activeSession || activeSession.state !== 'waiting') {
      return reply.code(409).send({ error: 'No local pairing session active. Call /pairing/start first.' });
    }

    // SECURITY: PIN muss mit der lokal generierten PIN uebereinstimmen
    if (body.pin !== activeSession.pin) {
      // Fehlversuch zaehlen — nach 3 Versuchen Session invalidieren
      failedAttempts++;
      if (failedAttempts >= 3) {
        log?.warn({ attempts: failedAttempts }, 'Pairing: 3 falsche PIN-Versuche — Session invalidiert');
        activeSession = null;
        failedAttempts = 0;
        return reply.code(403).send({ error: 'Too many failed attempts. Session invalidated.' });
      }
      return reply.code(403).send({ error: 'Wrong PIN' });
    }

    // Bereits gepaart?
    if (store.isPaired(body.agent_id)) {
      return reply.code(200).send({ status: 'already_paired' });
    }

    // SECURITY: Nutze den Verifier aus der lokalen Session (nicht vom Angreifer-Input)
    const verifier = activeSession.spakeInstance;
    failedAttempts = 0;

    try {
      // Generiere eigene SPAKE2 Message
      const outMessage = verifier.generate();

      // Verarbeite die Message des Initiators
      const peerMessage = Buffer.from(body.spake_message, 'base64');
      const sharedSecret = verifier.finish(peerMessage);

      // Schlüssel ableiten
      const sharedKey = deriveKey(Buffer.from(sharedSecret), 'thinklocal-pairing-v1');

      // Eigene Daten verschlüsseln und senden
      const payload: PairingPayload = {
        agentId: deps.agentId,
        publicKeyPem: deps.publicKeyPem,
        caCertPem: deps.caCertPem,
        hostname: deps.hostname,
        fingerprint: deps.fingerprint,
      };

      const encrypted = encryptWithKey(sharedKey, JSON.stringify(payload));

      activeSession = {
        pin: body.pin,
        state: 'handshake',
        createdAt: Date.now(),
        spakeInstance: verifier,
        sharedKey,
        peerAgentId: body.agent_id,
      };

      return {
        spake_message: outMessage.toString('base64'),
        encrypted_payload: encrypted,
      };
    } catch (err) {
      log?.warn({ err, peer: body.agent_id }, 'SPAKE2 Handshake fehlgeschlagen — falsche PIN?');
      return reply.code(403).send({ error: 'Handshake failed — wrong PIN?' });
    }
  });

  /**
   * POST /pairing/confirm — Initiator sendet verschlüsselte Daten zurück
   * Body: { encrypted_payload: { ciphertext, iv, tag } }
   */
  server.post('/pairing/confirm', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!activeSession || activeSession.state !== 'handshake' || !activeSession.sharedKey) {
      return reply.code(400).send({ error: 'No active pairing session' });
    }

    const body = request.body as {
      encrypted_payload: { ciphertext: string; iv: string; tag: string };
    };

    try {
      // Entschlüssele Peer-Daten
      const decrypted = decryptWithKey(
        activeSession.sharedKey,
        body.encrypted_payload.ciphertext,
        body.encrypted_payload.iv,
        body.encrypted_payload.tag,
      );

      const peerData = JSON.parse(decrypted) as PairingPayload;

      // Fingerprint verifizieren
      const computedFingerprint = createHash('sha256').update(peerData.publicKeyPem).digest('hex');
      if (computedFingerprint !== peerData.fingerprint) {
        return reply.code(403).send({ error: 'Fingerprint mismatch' });
      }

      // Peer als vertrauenswürdig speichern
      const pairedPeer: PairedPeer = {
        agentId: peerData.agentId,
        publicKeyPem: peerData.publicKeyPem,
        caCertPem: peerData.caCertPem,
        fingerprint: peerData.fingerprint,
        pairedAt: new Date().toISOString(),
        hostname: peerData.hostname,
      };

      store.addPeer(pairedPeer);
      activeSession.state = 'completed';

      log?.info({ peer: peerData.agentId }, '✅ Pairing erfolgreich abgeschlossen');

      return { status: 'paired', peer_agent_id: peerData.agentId };
    } catch (err) {
      activeSession.state = 'failed';
      log?.warn({ err }, 'Pairing-Bestätigung fehlgeschlagen');
      return reply.code(403).send({ error: 'Confirmation failed — decryption error' });
    }
  });

  /**
   * GET /pairing/status — Aktueller Pairing-Status
   */
  server.get('/pairing/status', async () => {
    cleanExpiredSession();
    return {
      active_session: activeSession
        ? {
            state: activeSession.state,
            peer: activeSession.peerAgentId,
            age_seconds: Math.floor((Date.now() - activeSession.createdAt) / 1000),
          }
        : null,
      paired_peers: store.getAllPeers().map((p) => ({
        agent_id: p.agentId,
        hostname: p.hostname,
        paired_at: p.pairedAt,
      })),
    };
  });
}
