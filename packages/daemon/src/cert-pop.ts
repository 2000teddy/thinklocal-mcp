// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * cert-pop.ts — ADR-022 Schritt 3 / WS-3: Proof-of-Possession für die
 * `node/<PeerID>`-Cert-Ausstellung (Pfad B, Cert-Issuance auf der Admin-CA /.94).
 *
 * Der joinende Node beweist mit seinem libp2p-Ed25519-Key (= Wurzel der PeerID),
 * dass er BERECHTIGT ist, ein Cert mit SAN `spiffe://thinklocal/node/<PeerID>` zu
 * erhalten — UND dass der zu zertifizierende X.509-Key (CSR) ihm gehört.
 *
 * Signatur-Scope (ADR-022 §Schritt-3, Korrektur #2 — NICHT verhandelbar):
 *   Domain-Separator ‖ CA-Fingerprint ‖ Admin-Nonce ‖ PeerID ‖ angeforderte
 *   SPIFFE-URI (node/<PeerID>) ‖ Hash(CSR-Public-Key)
 *
 * Der **CSR-Public-Key-Hash im Scope ist der kritische Teil**: ohne ihn könnte ein
 * Angreifer einen für eine fremde PeerID gültigen PoP mit seinem EIGENEN TLS-Key
 * kombinieren (Cert-Substitution). Mit ihm bindet die Ed25519-Signatur die PeerID
 * fest an genau den X.509-Key, der zertifiziert wird.
 *
 * Reine Helfer (Message-Aufbau + Hashing sind seiteneffektfrei; sign/verify nutzen
 * den libp2p-Key bzw. den rekonstruierten Public-Key) → vollständig unit-testbar.
 */

import { createHash } from 'node:crypto';
import type { PrivateKey } from '@libp2p/interface';
import { publicKeyFromRaw } from '@libp2p/crypto/keys';
import { peerIdFromPublicKey } from '@libp2p/peer-id';

/** Domain-Separator — versioniert, damit dieselbe Ed25519-Signatur nie in einem
 *  anderen Kontext (z.B. Envelope-Signing) wiederverwendbar ist. */
export const CERT_POP_DOMAIN = 'thinklocal-mcp.cert-pop.v1';

/** Die im PoP-Scope gebundenen Felder. Alle Strings, kanonisch length-präfixiert serialisiert. */
export interface CertPopFields {
  /** SHA-256-Fingerprint (hex) des Admin-CA-Certs — bindet den PoP an DIESE Mesh-CA. */
  caFingerprint: string;
  /** Single-use Admin-Nonce (kurze TTL) gegen Replay. */
  nonce: string;
  /** libp2p-PeerID (base58btc), aus dem Ed25519-Key abgeleitet. */
  peerId: string;
  /** Angeforderte SPIFFE-URI; MUSS `spiffe://thinklocal/node/<peerId>` sein. */
  spiffeUri: string;
  /** SHA-256 (hex) des SubjectPublicKeyInfo (DER) aus dem CSR. */
  csrPublicKeyHash: string;
}

/** SHA-256 als Lowercase-Hex. */
export function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Kanonische, eindeutige Serialisierung des PoP-Scopes: Domain-Separator, dann je
 * Feld ein 4-Byte-Big-Endian-Längenpräfix + UTF-8-Bytes. Das Längenpräfix verhindert
 * Feld-Grenzen-Ambiguität (z.B. dass `a‖bc` und `ab‖c` dieselbe Bytefolge ergeben).
 */
export function buildCertPopMessage(fields: CertPopFields): Uint8Array {
  const parts: Uint8Array[] = [];
  const enc = new TextEncoder();
  const pushField = (s: string): void => {
    const bytes = enc.encode(s);
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, bytes.length, false); // big-endian
    parts.push(len, bytes);
  };
  // Domain-Separator zuerst (ebenfalls length-präfixiert → kein Confusion mit Feld 1).
  pushField(CERT_POP_DOMAIN);
  pushField(fields.caFingerprint);
  pushField(fields.nonce);
  pushField(fields.peerId);
  pushField(fields.spiffeUri);
  pushField(fields.csrPublicKeyHash);

  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** Normalisiert einen Fingerprint für Vergleiche (Doppelpunkte raus, Großschreibung). */
function normalizeFingerprint(fp: string): string {
  return fp.replace(/:/g, '').toUpperCase();
}

/**
 * Signiert den PoP-Scope mit dem libp2p-Ed25519-Private-Key (Client-Seite).
 * Liefert die Signatur als base64.
 */
export async function signCertPop(privateKey: PrivateKey, fields: CertPopFields): Promise<string> {
  const msg = buildCertPopMessage(fields);
  const sig = await privateKey.sign(msg);
  return Buffer.from(sig).toString('base64');
}

export interface CertPopVerifyResult {
  ok: boolean;
  reason?: string;
}

/**
 * Verifiziert einen PoP (Admin-/.94-Seite). Prüft ALLE nicht-verhandelbaren Punkte:
 *  1. PeerID leitet sich aus dem präsentierten Ed25519-Public-Key ab (kein Fremd-PeerID).
 *  2. die angeforderte SPIFFE-URI ist exakt `spiffe://thinklocal/node/<peerId>`.
 *  3. der CA-Fingerprint im Scope == der des ausstellenden Admin-Certs.
 *  4. die Ed25519-Signatur ist über genau diesen Scope gültig.
 *
 * Nonce-Frische + CSR-Key-Hash-Abgleich prüft der Aufrufer (Nonce-Store bzw. CSR-Parsing)
 * — sie sind I/O-/Parsing-abhängig und gehören nicht in diese reine Krypto-Prüfung.
 * `expectedCaFingerprint` ist der Fingerprint des eigenen (Admin-)CA-Certs.
 */
export async function verifyCertPop(
  ed25519PublicKeyRaw: Uint8Array,
  fields: CertPopFields,
  signatureB64: string,
  expectedCaFingerprint: string,
): Promise<CertPopVerifyResult> {
  // 1. PeerID-Ableitung aus dem Public-Key.
  let derivedPeerId: string;
  try {
    const pubKey = publicKeyFromRaw(ed25519PublicKeyRaw);
    if (pubKey.type !== 'Ed25519') {
      return { ok: false, reason: `Public-Key-Typ ${pubKey.type} != Ed25519` };
    }
    derivedPeerId = peerIdFromPublicKey(pubKey).toString();
    if (derivedPeerId !== fields.peerId) {
      return { ok: false, reason: `PeerID ${fields.peerId} leitet sich nicht aus dem Public-Key ab (${derivedPeerId})` };
    }
    // 2. SPIFFE-URI exakt node/<peerId>.
    if (fields.spiffeUri !== `spiffe://thinklocal/node/${derivedPeerId}`) {
      return { ok: false, reason: `SPIFFE-URI ${fields.spiffeUri} != erwartet spiffe://thinklocal/node/${derivedPeerId}` };
    }
    // 3. CA-Fingerprint-Bindung.
    if (normalizeFingerprint(fields.caFingerprint) !== normalizeFingerprint(expectedCaFingerprint)) {
      return { ok: false, reason: 'CA-Fingerprint im PoP-Scope passt nicht zur ausstellenden Admin-CA' };
    }
    // 4. Ed25519-Signatur über den Scope.
    const msg = buildCertPopMessage(fields);
    const sig = Buffer.from(signatureB64, 'base64');
    const valid = await pubKey.verify(msg, sig);
    if (!valid) {
      return { ok: false, reason: 'Ed25519-PoP-Signatur ungültig' };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: `PoP-Verifikation fehlgeschlagen: ${(err as Error).message}` };
  }
}
