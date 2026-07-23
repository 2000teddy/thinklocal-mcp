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
import { createHash, createPublicKey } from 'node:crypto';
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
 * Fingerprint des Verify-Keys (sha256hex der PEM-**Textdarstellung** — identisch zu `identity.ts`'
 * internem `computeFingerprint`). Revocation-Join-Key für Slice B/C, NICHT die kryptografische
 * Verifikation (die läuft über die verbatim Bytes).
 *
 * ⚠️ **Format-malleabel — für Ledger-/Denylist-Schlüssel ungeeignet.** Dasselbe Schlüsselmaterial
 * liefert bei anderem Zeilenumbruch/Whitespace/Trailing-Newline einen **anderen** Keyid. Solange der
 * Keyid nur Anzeige/Audit ist, ist das folgenlos; als **Uniqueness-Schlüssel** eines Idempotenz-Ledgers
 * (B1) oder als **Join-Key** einer Revocation-Denylist (B2b) wäre es ein Umgehungspfad. Für diese Rolle
 * ist {@link canonicalOrderKeyId} gedacht (TL-12 Slice-B-Scoping §3 „Kanonischer Keyid = DER-SPKI").
 * Diese Funktion bleibt **unverändert** — sie stempelt bereits gespeicherte Zeilen, ein Wechsel wäre
 * eine Datenmigration und gehört in den gateten B0-Slice.
 */
export function orderKeyId(publicKeyPem: string): string {
  return createHash('sha256').update(publicKeyPem).digest('hex');
}

/**
 * **Kanonischer** Keyid: sha256hex über die **DER-SPKI-Bytes** des öffentlichen Schlüssels statt über
 * seinen PEM-Text. Damit ist der Keyid eine Eigenschaft des **Schlüsselmaterials**, nicht seiner
 * Serialisierung: verschiedene, aber gleichwertige PEM-Kodierungen desselben Schlüssels (CRLF vs. LF,
 * andere Zeilenlänge, zusätzliche Leerzeilen) ergeben **denselben** Keyid.
 *
 * **Warum das vor B1/B2b stehen muss** (Slice-B-Scoping §3): würde ein format-malleabler Keyid die
 * `UNIQUE(signer_keyid, order_nonce)`-Spalte des Ledgers oder den Denylist-Join-Key bilden, könnte ein
 * Relay denselben Auftrag durch bloßes **Umformatieren** des mitgelieferten PEM ein zweites Mal
 * ausführbar machen (neue Ledger-Zeile) bzw. eine Sperre umgehen (andere Denylist-Zeile) — ohne die
 * Signatur zu berühren, die über die verbatim Bytes läuft.
 *
 * **Fail-closed:** nicht parsebar ⇒ `null` (**kein** Ersatz-Keyid und kein Fallback auf den PEM-Hash —
 * ein geratener Keyid wäre genau die Kollision/Umgehung, die diese Funktion verhindern soll). Wirft nie.
 *
 * **Privates Schlüsselmaterial wird ausdrücklich abgelehnt.** `createPublicKey()` leitet aus einem
 * privaten PEM klaglos den zugehörigen öffentlichen Schlüssel ab — ein Aufrufer, der versehentlich den
 * Signier- statt den Verify-Schlüssel übergibt, bekäme also einen *gültig aussehenden* Keyid, und
 * Geheimmaterial liefe durch diese Funktion. Beides wird hier zu `null`.
 *
 * **0 Aufrufer** — die Verwendung als Ledger-/Denylist-Schlüssel gehört in B1/B2b und bleibt gated.
 */
export function canonicalOrderKeyId(publicKeyPem: string): string | null {
  if (typeof publicKeyPem !== 'string' || publicKeyPem.trim() === '') return null;
  // Siehe Doc-Kommentar: privates Material darf hier nicht durchlaufen, auch nicht „hilfsweise".
  if (publicKeyPem.includes('PRIVATE KEY')) return null;
  try {
    const der = createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
    return createHash('sha256').update(der).digest('hex');
  } catch {
    return null;
  }
}

/**
 * Ergebnis der Marker-Extraktion (**Tri-State**, CR-Codex #266): unterscheidet „kein Marker" von
 * „Marker vorhanden, aber unbrauchbar". Ohne diese Trennung würde ein vorhandener-aber-kaputter Marker
 * still zu einer Plain-Nachricht degradieren (kein INVALID, kein Audit) — Audit-Umgehung für
 * auftrags-förmige Eingaben.
 */
export type MarkerExtraction =
  | { kind: 'absent' } // kein `__tlorder__`-Feld → Plain-Pfad
  | { kind: 'invalid'; reason: string } // Feld vorhanden, aber unbrauchbar → INVALID + Audit
  | { kind: 'bytes'; bytes: Uint8Array }; // Feld vorhanden, Bytes extrahiert → verifizieren

/**
 * Extrahiert die verbatim Auftrags-Bytes aus einem Nachrichten-Body. **Strikt**, wirft nie, tri-state:
 *  - Body ist kein Objekt oder ohne `__tlorder__`-Feld → `absent` (Plain).
 *  - `__tlorder__` vorhanden, aber kein nicht-leerer String / zu lang / dekodiert leer/zu groß →
 *    `invalid(reason)` (der Aufrufer routet das über INVALID + `ORDER_VERIFY_FAILED`).
 *  - sonst → `bytes`.
 */
export function extractOrderMarker(body: unknown): MarkerExtraction {
  if (typeof body !== 'object' || body === null || !(ORDER_MARKER in body)) {
    return { kind: 'absent' };
  }
  const raw = (body as Record<string, unknown>)[ORDER_MARKER];
  if (typeof raw !== 'string' || raw.length === 0) {
    return { kind: 'invalid', reason: 'marker is not a non-empty string' };
  }
  // Grobes base64-Längenlimit VOR dem Dekodieren (base64 ~ 4/3 der Bytes).
  if (raw.length > Math.ceil((MAX_ORDER_BYTES * 4) / 3) + 4) {
    return { kind: 'invalid', reason: 'marker exceeds size limit' };
  }
  let bytes: Buffer;
  try {
    bytes = Buffer.from(raw, 'base64');
  } catch {
    return { kind: 'invalid', reason: 'marker is not valid base64' };
  }
  // Buffer.from('base64') ist tolerant — leeres/degeneriertes/zu großes Ergebnis verwerfen.
  if (bytes.length === 0 || bytes.length > MAX_ORDER_BYTES) {
    return { kind: 'invalid', reason: 'decoded marker empty or oversize' };
  }
  return { kind: 'bytes', bytes: new Uint8Array(bytes) };
}

/**
 * Entscheidungs-Seam für den Ingest (`index.ts` AGENT_MESSAGE): klassifiziert einen Nachrichten-Body
 * als Plain / ungültigen Auftrag / gültigen Auftrag. **Rein, wirft nie.** Testbar ohne Netz/Handler.
 *  - kein Marker → `plain` (unverändertes Verhalten).
 *  - Marker vorhanden aber unbrauchbar ODER Verify fehlgeschlagen → `invalid(reason)` (Aufrufer: INVALID
 *    + `ORDER_VERIFY_FAILED`-Audit) — **niemals stiller Downgrade zu Plain**.
 *  - gültiger, gegen `publicKeyPem`+`expectedIssuer` verifizierter Auftrag → `order`.
 */
export type InboundOrderDecision =
  | { kind: 'plain' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'order'; bytes: Uint8Array; orderId: string };

export function classifyInboundOrder(
  body: unknown,
  expectedIssuer: string,
  publicKeyPem: string,
): InboundOrderDecision {
  const marker = extractOrderMarker(body);
  if (marker.kind === 'absent') return { kind: 'plain' };
  if (marker.kind === 'invalid')
    return { kind: 'invalid', reason: `malformed-marker: ${marker.reason}` };
  const vr = verifyOrderBytes(marker.bytes, expectedIssuer, publicKeyPem);
  if (vr.verdict === 'VALID' && typeof vr.orderId === 'string' && vr.orderId !== '') {
    return { kind: 'order', bytes: marker.bytes, orderId: vr.orderId };
  }
  return { kind: 'invalid', reason: vr.reason ?? 'verify failed' };
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
    if (env.type !== MessageType.ORDER)
      return { verdict: 'INVALID', reason: 'not an ORDER envelope' };
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
