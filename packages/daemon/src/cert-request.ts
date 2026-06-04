/**
 * cert-request.ts — ADR-022 Schritt 3 / WS-3: Client-Seite der PoP-Cert-Ausstellung.
 *
 * Der joinende Node erzeugt ein frisches X.509-Keypair + CSR, holt eine Admin-Nonce,
 * signiert den PoP-Scope mit seinem libp2p-Ed25519-Key und fordert bei der Admin-CA
 * (.94) ein Cert mit SAN `spiffe://thinklocal/node/<PeerID>` an. Der private TLS-Key
 * verlässt den Node NIE — nur der CSR (Public-Key) geht an die CA.
 *
 * Der pure Teil (`generateNodeKeypairAndCsr`, `buildCertSignRequest`) ist ohne HTTP
 * testbar; `requestNodeCert` ist der HTTP-Flow (fetch/dispatcher injizierbar).
 */

import forge from 'node-forge';
import type { PrivateKey } from '@libp2p/interface';
import { peerIdToSpiffeUri } from './peer-identity.js';
import { signCertPop, type CertPopFields } from './cert-pop.js';
import { publicKeyDerHash, type CertSignRequest } from './cert-issuer.js';

export interface GeneratedCsr {
  csrPem: string;
  /** Privater TLS-Key (PEM) — bleibt lokal, NIE an die CA. */
  keyPem: string;
  /** SHA-256 (hex) des CSR-Public-Keys (für den PoP-Scope). */
  csrPublicKeyHash: string;
}

/** Erzeugt RSA-2048-Keypair + CSR (CN=hostname), liefert PEMs + Public-Key-Hash. */
export function generateNodeKeypairAndCsr(hostname: string): GeneratedCsr {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const csr = forge.pki.createCertificationRequest();
  csr.publicKey = keys.publicKey;
  csr.setSubject([
    { name: 'commonName', value: hostname },
    { name: 'organizationName', value: 'thinklocal-mcp' },
  ]);
  csr.sign(keys.privateKey, forge.md.sha256.create());
  return {
    csrPem: forge.pki.certificationRequestToPem(csr),
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
    csrPublicKeyHash: publicKeyDerHash(keys.publicKey),
  };
}

/**
 * Baut die signierte Cert-Signing-Anfrage: berechnet den CSR-Key-Hash, den
 * vollständigen PoP-Scope und die Ed25519-Signatur. Rein (kein I/O) → testbar.
 */
export async function buildCertSignRequest(
  privateKey: PrivateKey,
  peerId: string,
  caFingerprint: string,
  nonce: string,
  csr: GeneratedCsr,
): Promise<CertSignRequest> {
  const spiffeUri = peerIdToSpiffeUri(peerId);
  const fields: CertPopFields = {
    caFingerprint,
    nonce,
    peerId,
    spiffeUri,
    csrPublicKeyHash: csr.csrPublicKeyHash,
  };
  const popSignatureB64 = await signCertPop(privateKey, fields);
  return {
    peerId,
    ed25519PublicKeyB64: Buffer.from(privateKey.publicKey.raw).toString('base64'),
    spiffeUri,
    nonce,
    csrPem: csr.csrPem,
    popSignatureB64,
  };
}

type FetchLike = (url: string, init: {
  method: string;
  headers: Record<string, string>;
  body?: string;
  dispatcher?: unknown;
  signal?: AbortSignal;
}) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; text: () => Promise<string> }>;

export interface RequestNodeCertOptions {
  /** Admin-CA Haupt-mTLS-Endpoint, z.B. https://10.10.10.94:9440 */
  adminUrl: string;
  privateKey: PrivateKey;
  peerId: string;
  hostname: string;
  fetchImpl: FetchLike;
  /**
   * undici-Dispatcher MIT dem eigenen (Legacy-)mTLS-Client-Cert — authentifiziert
   * den Node als Mesh-Mitglied gegenüber dem Admin-Hauptserver (rejectUnauthorized).
   */
  dispatcher?: unknown;
  timeoutMs?: number;
}

export interface RequestNodeCertResult {
  certPem: string;
  keyPem: string;
  spiffeUri: string;
}

/**
 * Vollständiger Client-Flow: Nonce holen → CSR/Keypair erzeugen → PoP bauen →
 * Cert anfordern. Liefert das ausgestellte Cert + den lokal behaltenen Key.
 */
export async function requestNodeCert(opts: RequestNodeCertOptions): Promise<RequestNodeCertResult> {
  // mTLS (Client-Cert im Dispatcher) authentifiziert — kein Bearer nötig.
  const headers = { 'content-type': 'application/json' };
  const timeout = opts.timeoutMs ?? 10_000;

  // 1. Nonce + CA-Fingerprint holen.
  const nonceRes = await opts.fetchImpl(`${opts.adminUrl}/api/cert/nonce`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ peerId: opts.peerId }),
    dispatcher: opts.dispatcher,
    signal: AbortSignal.timeout(timeout),
  });
  if (!nonceRes.ok) {
    throw new Error(`Nonce-Anfrage fehlgeschlagen: HTTP ${nonceRes.status} ${await nonceRes.text()}`);
  }
  const nonceBody = (await nonceRes.json()) as unknown;
  if (
    !nonceBody ||
    typeof nonceBody !== 'object' ||
    typeof (nonceBody as { nonce?: unknown }).nonce !== 'string' ||
    typeof (nonceBody as { caFingerprint?: unknown }).caFingerprint !== 'string'
  ) {
    throw new Error('Nonce-Antwort unvollständig oder ungültig (nonce/caFingerprint)');
  }
  const { nonce, caFingerprint } = nonceBody as { nonce: string; caFingerprint: string };

  // 2. Keypair + CSR.
  const csr = generateNodeKeypairAndCsr(opts.hostname);

  // 3. PoP-Request bauen.
  const signRequest = await buildCertSignRequest(opts.privateKey, opts.peerId, caFingerprint, nonce, csr);

  // 4. Cert anfordern.
  const signRes = await opts.fetchImpl(`${opts.adminUrl}/api/cert/sign`, {
    method: 'POST',
    headers,
    body: JSON.stringify(signRequest),
    dispatcher: opts.dispatcher,
    signal: AbortSignal.timeout(timeout),
  });
  if (!signRes.ok) {
    throw new Error(`Cert-Signing fehlgeschlagen: HTTP ${signRes.status} ${await signRes.text()}`);
  }
  const { certPem } = (await signRes.json()) as { certPem: string };
  if (!certPem) {
    throw new Error('Cert-Antwort ohne certPem');
  }

  return { certPem, keyPem: csr.keyPem, spiffeUri: signRequest.spiffeUri };
}
