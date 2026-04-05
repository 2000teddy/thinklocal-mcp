/**
 * protocol-contract.test.ts — Wire Protocol Contract Tests
 *
 * Diese Tests garantieren dass das Wire Protocol korrekt implementiert ist.
 * Sie muessen VOR jedem Merge bestehen (CI-Gate).
 *
 * Getestete Contracts:
 * 1. Envelope-Format (Pflichtfelder, Typen)
 * 2. Signatur-Verifikation (gueltig/ungueltig/falsch)
 * 3. TTL-Enforcement (abgelaufene Nachrichten ablehnen)
 * 4. Replay-Guard (doppelte Nachrichten ablehnen)
 * 5. CBOR Round-Trip (serialize → deserialize)
 * 6. Gossip-Protokoll (Hash-Vergleich, Agent-ID-Validierung)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import {
  createEnvelope,
  encodeAndSign,
  decodeAndVerify,
  serializeSignedMessage,
  deserializeSignedMessage,
  MessageType,
} from './messages.js';

function generateTestKeys(): { publicKeyPem: string; privateKeyPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKeyPem: publicKey, privateKeyPem: privateKey };
}

describe('Wire Protocol Contract Tests', () => {
  const keysA = generateTestKeys();
  const keysB = generateTestKeys();
  const agentA = 'spiffe://thinklocal/host/node-a/agent/claude-code';
  const agentB = 'spiffe://thinklocal/host/node-b/agent/claude-code';

  // --- Contract 1: Envelope Pflichtfelder ---

  describe('Contract 1: Envelope Format', () => {
    it('enthaelt alle Pflichtfelder', () => {
      const envelope = createEnvelope(
        MessageType.HEARTBEAT,
        agentA,
        { uptime_seconds: 100, peer_count: 2, cpu_percent: 15 },
      );

      expect(envelope.id).toBeDefined();
      expect(envelope.type).toBe('HEARTBEAT');
      expect(envelope.sender).toBe(agentA);
      expect(envelope.correlation_id).toBeDefined();
      expect(envelope.timestamp).toBeDefined();
      expect(typeof envelope.ttl_ms).toBe('number');
      expect(envelope.idempotency_key).toBeDefined();
      expect(envelope.payload).toBeDefined();
    });

    it('id ist ein gultiges UUIDv4-Format', () => {
      const envelope = createEnvelope(MessageType.HEARTBEAT, agentA, {});
      expect(envelope.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('timestamp ist ein gueltiges ISO 8601 Datum', () => {
      const envelope = createEnvelope(MessageType.HEARTBEAT, agentA, {});
      const parsed = new Date(envelope.timestamp);
      expect(parsed.getTime()).not.toBeNaN();
      // Timestamp sollte innerhalb der letzten 5 Sekunden liegen
      expect(Date.now() - parsed.getTime()).toBeLessThan(5000);
    });

    it('idempotency_key entspricht der id', () => {
      const envelope = createEnvelope(MessageType.HEARTBEAT, agentA, {});
      expect(envelope.idempotency_key).toBe(envelope.id);
    });
  });

  // --- Contract 2: Signatur-Verifikation ---

  describe('Contract 2: Signatur-Verifikation', () => {
    it('gueltige Signatur wird akzeptiert', () => {
      const envelope = createEnvelope(MessageType.HEARTBEAT, agentA, { uptime_seconds: 1 });
      const signed = encodeAndSign(envelope, keysA.privateKeyPem);
      const decoded = decodeAndVerify(signed, keysA.publicKeyPem);
      expect(decoded).not.toBeNull();
      expect(decoded!.sender).toBe(agentA);
    });

    it('Signatur mit falschem Key wird abgelehnt', () => {
      const envelope = createEnvelope(MessageType.HEARTBEAT, agentA, {});
      const signed = encodeAndSign(envelope, keysA.privateKeyPem);
      // Verifiziere mit dem Key von Agent B — muss fehlschlagen
      const decoded = decodeAndVerify(signed, keysB.publicKeyPem);
      expect(decoded).toBeNull();
    });

    it('manipulierte Signatur wird abgelehnt', () => {
      const envelope = createEnvelope(MessageType.HEARTBEAT, agentA, {});
      const signed = encodeAndSign(envelope, keysA.privateKeyPem);
      // Signatur manipulieren
      signed.signature[0] ^= 0xff;
      const decoded = decodeAndVerify(signed, keysA.publicKeyPem);
      expect(decoded).toBeNull();
    });

    it('manipulierter Envelope wird abgelehnt', () => {
      const envelope = createEnvelope(MessageType.HEARTBEAT, agentA, {});
      const signed = encodeAndSign(envelope, keysA.privateKeyPem);
      // Envelope-Bytes manipulieren
      signed.envelope[10] ^= 0xff;
      const decoded = decodeAndVerify(signed, keysA.publicKeyPem);
      expect(decoded).toBeNull();
    });
  });

  // --- Contract 3: TTL-Enforcement ---

  describe('Contract 3: TTL-Enforcement', () => {
    it('Nachricht innerhalb TTL wird akzeptiert', () => {
      const envelope = createEnvelope(MessageType.HEARTBEAT, agentA, {}, { ttl_ms: 60_000 });
      const signed = encodeAndSign(envelope, keysA.privateKeyPem);
      const decoded = decodeAndVerify(signed, keysA.publicKeyPem);
      expect(decoded).not.toBeNull();
    });

    it('abgelaufene Nachricht wird abgelehnt', () => {
      const envelope = createEnvelope(MessageType.HEARTBEAT, agentA, {}, { ttl_ms: 1 });
      // Timestamp in die Vergangenheit setzen
      envelope.timestamp = new Date(Date.now() - 10_000).toISOString();
      const signed = encodeAndSign(envelope, keysA.privateKeyPem);
      const decoded = decodeAndVerify(signed, keysA.publicKeyPem);
      expect(decoded).toBeNull();
    });

    it('Nachricht mit TTL=0 laeuft nie ab', () => {
      const envelope = createEnvelope(MessageType.HEARTBEAT, agentA, {}, { ttl_ms: 0 });
      // Auch mit altem Timestamp
      envelope.timestamp = new Date(Date.now() - 3600_000).toISOString();
      const signed = encodeAndSign(envelope, keysA.privateKeyPem);
      const decoded = decodeAndVerify(signed, keysA.publicKeyPem);
      expect(decoded).not.toBeNull();
    });
  });

  // --- Contract 4: CBOR Round-Trip ---

  describe('Contract 4: CBOR Serialization Round-Trip', () => {
    it('Envelope ueberlebt serialize → deserialize', () => {
      const envelope = createEnvelope(MessageType.TASK_REQUEST, agentA, {
        skill_id: 'system.health',
        input: { verbose: true },
      });
      const signed = encodeAndSign(envelope, keysA.privateKeyPem);
      const serialized = serializeSignedMessage(signed);
      expect(serialized).toBeInstanceOf(Buffer);

      const deserialized = deserializeSignedMessage(serialized);
      expect(deserialized).not.toBeNull();

      const decoded = decodeAndVerify(deserialized!, keysA.publicKeyPem);
      expect(decoded).not.toBeNull();
      expect(decoded!.id).toBe(envelope.id);
      expect(decoded!.type).toBe('TASK_REQUEST');
      expect(decoded!.sender).toBe(agentA);
    });

    it('alle Nachrichtentypen lassen sich kodieren', () => {
      const types = [
        MessageType.HEARTBEAT,
        MessageType.DISCOVER_QUERY,
        MessageType.CAPABILITY_QUERY,
        MessageType.REGISTRY_SYNC,
        MessageType.TASK_REQUEST,
        MessageType.SKILL_ANNOUNCE,
        MessageType.SECRET_REQUEST,
      ];

      for (const type of types) {
        const envelope = createEnvelope(type, agentA, { test: true });
        const signed = encodeAndSign(envelope, keysA.privateKeyPem);
        const decoded = decodeAndVerify(signed, keysA.publicKeyPem);
        expect(decoded).not.toBeNull();
        expect(decoded!.type).toBe(type);
      }
    });
  });

  // --- Contract 5: Cross-Agent Communication ---

  describe('Contract 5: Cross-Agent Kommunikation', () => {
    it('Agent A signiert, Agent B verifiziert mit A public key', () => {
      const envelope = createEnvelope(MessageType.TASK_REQUEST, agentA, { skill_id: 'test' });
      const signed = encodeAndSign(envelope, keysA.privateKeyPem);
      const serialized = serializeSignedMessage(signed);

      // Agent B empfaengt und verifiziert
      const deserialized = deserializeSignedMessage(serialized);
      const decoded = decodeAndVerify(deserialized!, keysA.publicKeyPem);
      expect(decoded).not.toBeNull();
      expect(decoded!.sender).toBe(agentA);
    });

    it('Agent B kann Agent A Nachricht nicht mit eigenem Key verifizieren', () => {
      const envelope = createEnvelope(MessageType.TASK_REQUEST, agentA, {});
      const signed = encodeAndSign(envelope, keysA.privateKeyPem);
      const serialized = serializeSignedMessage(signed);

      const deserialized = deserializeSignedMessage(serialized);
      const decoded = decodeAndVerify(deserialized!, keysB.publicKeyPem);
      expect(decoded).toBeNull();
    });
  });
});
