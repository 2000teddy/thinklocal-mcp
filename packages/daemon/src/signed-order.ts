// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * signed-order.ts — ADR-038 (TL-12 Slice A): signierter, re-verifizierbarer Postfach-Auftrag.
 *
 * Ein „Auftrag" ist ein `messages.ts`-`MessageEnvelope` mit `type='ORDER'`, `sender`=Issuer-SPIFFE und
 * `idempotency_key`=Order-Nonce, signiert und als **verbatim** `serializeSignedMessage`-Bytes im Body
 * einer normalen AGENT_MESSAGE unter dem Marker `__tlorder__` (base64) transportiert.
 *
 * Reines Modul: kein I/O, keine Uhr außer der TTL-Prüfung (in `decodeAndVerify`). **Wirft nie** — jeder
 * Decode-/Format-Fehler wird zu `verdict:'INVALID'` (fail-closed). Die verbatim Bytes werden NIE
 * re-serialisiert (ECDSA-Signatur gilt über exakt diese Bytes; ein Re-Encode bräche die Verifikation).
 *
 * Fail-closed-Invarianten (CO 2026-07-15 opus+sonnet):
 *  - `is_order` nur bei VALID; `issuer`/`orderId` sind Outputs des Verify (aus den signierten Bytes),
 *    nie aus dem Body gelesen.
 *  - VALID verlangt zusätzlich `envelope.sender === expectedIssuer` (Relay-Schutz: Peer X darf keinen
 *    von Peer Y signierten Auftrag weiterreichen).
 *  - Marker-Extraktion ist strikt (Objekt mit String-Feld, base64, ≤ MAX_ORDER_BYTES) und wirft nie.
 */
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import {
  MessageType,
  createEnvelope,
  encodeAndSign,
  serializeSignedMessage,
  deserializeSignedMessage,
  decodeAndVerify,
  type MessageEnvelope,
  type OrderPayload,
} from './messages.js';

/** Body-Feld, unter dem die verbatim Auftrags-Bytes (base64) reisen. */
export const ORDER_MARKER = '__tlorder__';
/**
 * Obergrenze für die serialisierten Auftrags-Bytes (Ingest-seitig, DoS-Schutz beim späteren Decode).
 * Bewusst < 48 KiB (CR-Codex #TL12a LOW-1): der Auftrag reist base64-verpackt (~4/3) im
 * Nachrichten-Body, der auf 64 KiB (`MAX_MESSAGE_BYTES`) begrenzt ist. Bei 47 KiB rohen Bytes bleibt
 * die base64-Form (~62,7 KiB) + JSON-Wrapper sicher unter 64 KiB — ein VALIDer Auftrag wird also nie
 * erst verifiziert und dann von der Body-Größe verworfen (die zwei Limits sind konsistent).
 */
export const MAX_ORDER_BYTES = 47 * 1024;

export type OrderVerdict = 'VALID' | 'INVALID';

export interface VerifyOrderResult {
  verdict: OrderVerdict;
  /** Issuer-SPIFFE = `envelope.sender` (nur bei VALID). Output des Verify. */
  issuer?: string;
  /** Order-Nonce = `envelope.idempotency_key` (nur bei VALID). */
  orderId?: string;
  /** Diagnose bei INVALID. */
  reason?: string;
}

/** Baut einen (unsignierten) Auftrags-Envelope. `orderId` wird zur Nonce (`idempotency_key`). */
export function buildOrderEnvelope(
  issuer: string,
  orderId: string,
  payload: OrderPayload,
  ttlMs = 0,
): MessageEnvelope {
  const env = createEnvelope(MessageType.ORDER, issuer, payload, { ttl_ms: ttlMs });
  // Nonce deterministisch setzen (createEnvelope defaultet idempotency_key=id).
  return { ...env, idempotency_key: orderId };
}

/** Signiert einen Auftrags-Envelope und liefert die **verbatim** Transport-Bytes (base64-fähig). */
export function signOrder(envelope: MessageEnvelope, privateKeyPem: string): Uint8Array {
  return serializeSignedMessage(encodeAndSign(envelope, privateKeyPem));
}

/** Verpackt verbatim Auftrags-Bytes als Body-Marker. */
export function wrapOrderInBody(orderBytes: Uint8Array): Record<string, string> {
  return { [ORDER_MARKER]: Buffer.from(orderBytes).toString('base64') };
}

/**
 * Fingerprint des Verify-Keys (sha256hex der PEM-Textdarstellung — identisch zu `identity.ts`'
 * internem `computeFingerprint`). **PEM-encoding-abhängig** (nicht DER-SPKI) — Revocation-Join-Key
 * für Slice B/C, NICHT die kryptografische Verifikation (die läuft über die verbatim Bytes).
 */
export function orderKeyId(publicKeyPem: string): string {
  return createHash('sha256').update(publicKeyPem).digest('hex');
}

/**
 * Extrahiert die verbatim Auftrags-Bytes aus einem Nachrichten-Body. **Strikt** und wirft nie:
 *  - Body muss ein Objekt mit einem STRING-Feld `__tlorder__` sein.
 *  - base64 muss dekodierbar und ≤ MAX_ORDER_BYTES sein.
 * Alles andere (kein Marker, falscher Typ, zu groß, ungültiges base64) → `null` (Plain-Pfad).
 */
export function extractOrderMarker(body: unknown): Uint8Array | null {
  if (typeof body !== 'object' || body === null) return null;
  const raw = (body as Record<string, unknown>)[ORDER_MARKER];
  if (typeof raw !== 'string' || raw.length === 0) return null;
  // Grobes base64-Längenlimit VOR dem Dekodieren (base64 ~ 4/3 der Bytes).
  if (raw.length > Math.ceil((MAX_ORDER_BYTES * 4) / 3) + 4) return null;
  let bytes: Buffer;
  try {
    bytes = Buffer.from(raw, 'base64');
  } catch {
    return null;
  }
  // Buffer.from('base64') ist tolerant — leeres/degeneriertes Ergebnis verwerfen.
  if (bytes.length === 0 || bytes.length > MAX_ORDER_BYTES) return null;
  return new Uint8Array(bytes);
}

/**
 * Verifiziert verbatim Auftrags-Bytes. **Rein, wirft nie.** VALID nur wenn:
 *  1. deserialisierbar (SignedMessage-Form),
 *  2. `decodeAndVerify` ok (Signatur gegen `publicKeyPem` + TTL),
 *  3. `envelope.type === 'ORDER'`,
 *  4. `envelope.sender === expectedIssuer` (Relay-Schutz),
 *  5. `idempotency_key` (Nonce) nicht leer.
 * `issuer`/`orderId` werden aus den signierten Bytes abgeleitet, nie aus dem Body.
 */
export function verifyOrderBytes(
  bytes: Uint8Array,
  expectedIssuer: string,
  publicKeyPem: string,
): VerifyOrderResult {
  try {
    const signed = deserializeSignedMessage(bytes);
    const env = decodeAndVerify(signed, publicKeyPem);
    if (!env) return { verdict: 'INVALID', reason: 'signature invalid or expired' };
    if (env.type !== MessageType.ORDER) return { verdict: 'INVALID', reason: 'not an ORDER envelope' };
    if (typeof env.sender !== 'string' || env.sender !== expectedIssuer) {
      return { verdict: 'INVALID', reason: 'issuer does not match transport sender' };
    }
    const orderId = env.idempotency_key;
    if (typeof orderId !== 'string' || orderId.trim() === '') {
      return { verdict: 'INVALID', reason: 'missing order nonce' };
    }
    return { verdict: 'VALID', issuer: env.sender, orderId };
  } catch (err) {
    return { verdict: 'INVALID', reason: err instanceof Error ? err.message : 'decode error' };
  }
}
