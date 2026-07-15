// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * signed-order.test.ts — ADR-038 (TL-12 Slice A). Deckt die Fail-closed-Invarianten des reinen
 * Auftrags-Moduls (CO opus+sonnet 2026-07-15): VALID nur bei echter Sig + type=ORDER + issuer==sender
 * + Nonce; tampered/expired/wrong-key/wrong-type/relay ⇒ INVALID; Marker-Extraktion strikt + wirft nie.
 */
import { describe, it, expect } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { Buffer } from 'node:buffer';
import {
  buildOrderEnvelope,
  signOrder,
  verifyOrderBytes,
  extractOrderMarker,
  wrapOrderInBody,
  orderKeyId,
  ORDER_MARKER,
  MAX_ORDER_BYTES,
} from './signed-order.js';
import { createEnvelope, encodeAndSign, serializeSignedMessage, MessageType } from './messages.js';

function keypair(): { priv: string; pub: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { priv: privateKey as string, pub: publicKey as string };
}

const ISSUER = 'spiffe://thinklocal/node/12D3KooWISSUER';

describe('signed-order — sign/verify roundtrip', () => {
  it('gültiger Auftrag → VALID mit issuer + orderId (Outputs aus den Bytes)', () => {
    const { priv, pub } = keypair();
    const env = buildOrderEnvelope(ISSUER, 'nonce-1', { action: 'restart', args: { x: 1 } });
    const bytes = signOrder(env, priv);
    const r = verifyOrderBytes(bytes, ISSUER, pub);
    expect(r.verdict).toBe('VALID');
    expect(r.issuer).toBe(ISSUER);
    expect(r.orderId).toBe('nonce-1');
  });

  it('falscher Verify-Key → INVALID', () => {
    const a = keypair();
    const b = keypair();
    const bytes = signOrder(buildOrderEnvelope(ISSUER, 'n', { action: 'x' }), a.priv);
    expect(verifyOrderBytes(bytes, ISSUER, b.pub).verdict).toBe('INVALID');
  });

  it('manipulierte Bytes → INVALID (wirft nicht)', () => {
    const { priv, pub } = keypair();
    const bytes = signOrder(buildOrderEnvelope(ISSUER, 'n', { action: 'x' }), priv);
    const tampered = Uint8Array.from(bytes);
    tampered[tampered.length - 2] ^= 0xff;
    expect(verifyOrderBytes(tampered, ISSUER, pub).verdict).toBe('INVALID');
  });

  it('Relay-Schutz: issuer !== expectedIssuer → INVALID', () => {
    const { priv, pub } = keypair();
    const bytes = signOrder(buildOrderEnvelope(ISSUER, 'n', { action: 'x' }), priv);
    const r = verifyOrderBytes(bytes, 'spiffe://thinklocal/node/12D3KooWOTHER', pub);
    expect(r.verdict).toBe('INVALID');
    expect(r.reason).toContain('issuer');
  });

  it('falscher Envelope-Typ (AGENT_MESSAGE, korrekt signiert) → INVALID', () => {
    const { priv, pub } = keypair();
    const notOrder = createEnvelope(MessageType.AGENT_MESSAGE, ISSUER, {
      message_id: 'm', to: ISSUER, body: 'hi', sent_at: new Date().toISOString(),
    });
    const bytes = serializeSignedMessage(encodeAndSign(notOrder, priv));
    const r = verifyOrderBytes(bytes, ISSUER, pub);
    expect(r.verdict).toBe('INVALID');
    expect(r.reason).toContain('ORDER');
  });

  it('leere Nonce → INVALID', () => {
    const { priv, pub } = keypair();
    const bytes = signOrder(buildOrderEnvelope(ISSUER, '', { action: 'x' }), priv);
    const r = verifyOrderBytes(bytes, ISSUER, pub);
    expect(r.verdict).toBe('INVALID');
    expect(r.reason).toContain('nonce');
  });

  it('buildOrderEnvelope defaultet ttl_ms=0 (nicht-ablaufender Auftrag, CR-LOW-2-Mitigation)', () => {
    const env = buildOrderEnvelope(ISSUER, 'n', { action: 'x' });
    expect(env.ttl_ms).toBe(0);
    expect(env.idempotency_key).toBe('n');
    expect(env.type).toBe(MessageType.ORDER);
  });

  it('abgelaufene TTL → INVALID', () => {
    const { priv, pub } = keypair();
    const env = buildOrderEnvelope(ISSUER, 'n', { action: 'x' }, 1000);
    const old = { ...env, timestamp: new Date(Date.now() - 10_000).toISOString() };
    const bytes = signOrder(old, priv);
    expect(verifyOrderBytes(bytes, ISSUER, pub).verdict).toBe('INVALID');
  });

  it('Garbage-Bytes → INVALID (wirft nie)', () => {
    const { pub } = keypair();
    expect(verifyOrderBytes(new Uint8Array([1, 2, 3, 4, 5]), ISSUER, pub).verdict).toBe('INVALID');
    expect(verifyOrderBytes(new Uint8Array(0), ISSUER, pub).verdict).toBe('INVALID');
  });
});

describe('signed-order — Marker-Extraktion (strikt, wirft nie)', () => {
  it('gültiger Marker → Bytes; roundtrip via wrapOrderInBody', () => {
    const { priv } = keypair();
    const bytes = signOrder(buildOrderEnvelope(ISSUER, 'n', { action: 'x' }), priv);
    const body = wrapOrderInBody(bytes);
    const extracted = extractOrderMarker(body);
    expect(extracted).not.toBeNull();
    expect(Buffer.compare(Buffer.from(extracted as Uint8Array), Buffer.from(bytes))).toBe(0);
  });

  it('kein Marker / Nicht-Objekt / falscher Feldtyp → null', () => {
    expect(extractOrderMarker('plain string')).toBeNull();
    expect(extractOrderMarker(null)).toBeNull();
    expect(extractOrderMarker(42)).toBeNull();
    expect(extractOrderMarker({ hello: 'world' })).toBeNull();
    expect(extractOrderMarker({ [ORDER_MARKER]: 123 })).toBeNull();
    expect(extractOrderMarker({ [ORDER_MARKER]: { nested: true } })).toBeNull();
    expect(extractOrderMarker({ [ORDER_MARKER]: '' })).toBeNull();
  });

  it('übergroßer Marker → null (DoS-Schutz vor dem Decode)', () => {
    const huge = 'A'.repeat(Math.ceil((MAX_ORDER_BYTES * 4) / 3) + 100);
    expect(extractOrderMarker({ [ORDER_MARKER]: huge })).toBeNull();
  });
});

describe('signed-order — orderKeyId', () => {
  it('stabil je Key, verschieden zwischen Keys', () => {
    const a = keypair();
    const b = keypair();
    expect(orderKeyId(a.pub)).toBe(orderKeyId(a.pub));
    expect(orderKeyId(a.pub)).not.toBe(orderKeyId(b.pub));
    expect(orderKeyId(a.pub)).toMatch(/^[0-9a-f]{64}$/);
  });
});
