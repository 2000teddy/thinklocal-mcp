/**
 * cert-issuer.ts — ADR-022 Schritt 3 / WS-3: Admin-/.94-Seite der PoP-Cert-Ausstellung.
 *
 * Stellt nach erfolgreicher Proof-of-Possession-Prüfung ein X.509-Cert mit SAN
 * `spiffe://thinklocal/node/<PeerID>` aus, signiert mit dem Mesh-CA-Key (.94).
 *
 * Bausteine:
 *  - `NonceStore`        — In-Memory, single-use, kurze TTL (Replay-Schutz für PoP).
 *  - `csrPublicKeyHash`  — SHA-256 des SubjectPublicKeyInfo (DER) aus dem CSR.
 *  - `signNodeCertFromCsr` — signiert den CSR-Public-Key mit dem CA-Key, SAN node/<PeerID>.
 *  - `CertIssuer.verifyAndIssue` — orchestriert Nonce-Consume + PoP-Verify + Signing.
 *
 * Bewusst KEIN HTTP hier (das macht cert-issuance-api.ts) → testbar ohne Server.
 */

import { createHash, randomBytes } from 'node:crypto';
import forge from 'node-forge';
import type { Logger } from 'pino';
import type { CaBundle } from './tls.js';
import { sha256Hex, verifyCertPop, type CertPopFields } from './cert-pop.js';

const NODE_CERT_VALIDITY_DAYS = 90;

/** Default-TTL einer Nonce: kurz (Join ist interaktiv, kein Langläufer). */
const DEFAULT_NONCE_TTL_MS = 2 * 60_000; // 2 min

interface NonceEntry {
  expiresAt: number;
}

/**
 * In-Memory Single-Use-Nonce-Store. Nonces sind ephemer (überleben einen Admin-
 * Neustart bewusst NICHT — der Client fordert dann einfach eine neue an). Single-use:
 * eine konsumierte oder abgelaufene Nonce wird entfernt.
 */
export class NonceStore {
  private nonces = new Map<string, NonceEntry>();

  constructor(
    private ttlMs: number = DEFAULT_NONCE_TTL_MS,
    private now: () => number = () => Date.now(),
    private maxEntries: number = 4_096,
  ) {}

  /**
   * Erzeugt eine frische, kryptografisch zufällige Nonce (base64url, 32 Byte).
   * CR gpt-5.5 WS-3 MEDIUM: hartes Kapazitätslimit gegen Memory-/CPU-Erschöpfung auf
   * einer cert-ausstellenden API. Bei Erschöpfung (nach GC) fail-closed → der Aufrufer
   * antwortet 503. Der Rate-Limiter bleibt die erste Verteidigungslinie.
   */
  issue(): string {
    this.gc();
    if (this.nonces.size >= this.maxEntries) {
      throw new Error('Nonce-Kapazität erschöpft');
    }
    const nonce = randomBytes(32).toString('base64url');
    this.nonces.set(nonce, { expiresAt: this.now() + this.ttlMs });
    return nonce;
  }

  /**
   * Konsumiert eine Nonce: liefert true GENAU EINMAL für eine gültige, nicht
   * abgelaufene Nonce und entfernt sie (single-use). Danach / bei Ablauf / bei
   * Unbekannt → false.
   */
  consume(nonce: string): boolean {
    const entry = this.nonces.get(nonce);
    if (!entry) return false;
    this.nonces.delete(nonce); // single-use: in jedem Fall entfernen
    return this.now() <= entry.expiresAt;
  }

  /** Entfernt abgelaufene Nonces (Aufruf bei issue(); hält die Map klein). */
  private gc(): void {
    const t = this.now();
    for (const [nonce, entry] of this.nonces) {
      if (t > entry.expiresAt) this.nonces.delete(nonce);
    }
  }

  get size(): number {
    return this.nonces.size;
  }
}

/** SHA-256 (hex) des SubjectPublicKeyInfo (DER) eines node-forge Public-Keys. */
export function publicKeyDerHash(publicKey: forge.pki.PublicKey): string {
  const derBinary = forge.asn1.toDer(forge.pki.publicKeyToAsn1(publicKey)).getBytes();
  return sha256Hex(Buffer.from(derBinary, 'binary'));
}

/** SHA-256-Fingerprint (hex) eines CA-Cert-PEM (über das DER des Certs). */
export function certFingerprint(certPem: string): string {
  const cert = forge.pki.certificateFromPem(certPem);
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  return createHash('sha256').update(Buffer.from(der, 'binary')).digest('hex');
}

/** Strenge RFC-1123-Hostname-Prüfung (Buchstaben/Ziffern/Bindestrich/Punkt). */
const HOSTNAME_RE = /^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

/**
 * Signiert den im CSR enthaltenen Public-Key mit dem CA-Key und setzt die SAN exakt
 * auf `spiffeUri` (kanonisch node/<PeerID>). Im Unterschied zu `createNodeCert` wird
 * KEIN neuer Schlüssel erzeugt — der Node behält seinen privaten Key, die CA sieht ihn nie.
 *
 * SECURITY (CR gpt-5.5 WS-3 HIGH): Das Cert trägt AUSSCHLIESSLICH die Identität des
 * ANTRAGSTELLERS — die kanonische URI-SAN (autorisierend) plus optional dessen EIGENEN
 * Hostnamen (aus dem CSR-Subject-CN) und dessen EIGENE IP. NIEMALS den Admin-Hostnamen
 * oder ein pauschales `localhost` (sonst könnte jedes PoP-Cert den Admin/localhost-
 * Dienst impersonieren — TLS autorisiert DNS-SANs automatisch). CSR-`extensionRequest`
 * wird ignoriert (nur `csr.publicKey` wird übernommen) → keine SAN-Injektion via CSR.
 */
export function signNodeCertFromCsr(
  ca: CaBundle,
  csrPem: string,
  spiffeUri: string,
  ipAddresses: string[] = [],
): string {
  const csr = forge.pki.certificationRequestFromPem(csrPem);
  if (!csr.verify()) {
    throw new Error('CSR-Selbstsignatur ungültig');
  }
  if (!csr.publicKey) {
    throw new Error('CSR ohne Public-Key');
  }

  const caCert = forge.pki.certificateFromPem(ca.caCertPem);
  const caKey = forge.pki.privateKeyFromPem(ca.caKeyPem);

  const cert = forge.pki.createCertificate();
  cert.publicKey = csr.publicKey;
  cert.serialNumber = '01' + randomBytes(19).toString('hex');
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setDate(cert.validity.notAfter.getDate() + NODE_CERT_VALIDITY_DAYS);

  // CN = kanonische SPIFFE-URI (identitätszentriert, nicht autorisierend).
  cert.setSubject([
    { name: 'commonName', value: spiffeUri },
    { name: 'organizationName', value: 'thinklocal-mcp' },
  ]);
  cert.setIssuer(caCert.subject.attributes);

  // SANs: kanonische URI (immer) + nur die EIGENEN Namen des Antragstellers.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const altNames: any[] = [{ type: 6, value: spiffeUri }]; // URI (kanonische SPIFFE node/<PeerID>)
  // Eigener Hostname NUR aus dem CSR-Subject-CN (der Node hat ihn selbst gesetzt) und nur
  // wenn er ein valider Hostname ist (kein Wildcard, keine Admin-Übernahme).
  const csrCn = csr.subject.getField('CN')?.value as string | undefined;
  if (csrCn && csrCn !== spiffeUri && HOSTNAME_RE.test(csrCn)) {
    altNames.push({ type: 2, value: csrCn }); // DNS (eigener Hostname)
  }
  for (const ip of ipAddresses) {
    altNames.push({ type: 7, ip }); // IP (eigene Adresse des Antragstellers)
  }

  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
    { name: 'extKeyUsage', serverAuth: true, clientAuth: true },
    { name: 'subjectAltName', altNames },
  ]);

  cert.sign(caKey, forge.md.sha256.create());
  return forge.pki.certificateToPem(cert);
}

/** Eingehende Cert-Signing-Anfrage (über die HTTP-API). */
export interface CertSignRequest {
  peerId: string;
  /** Ed25519-Public-Key (raw 32 Byte) als base64. */
  ed25519PublicKeyB64: string;
  spiffeUri: string;
  nonce: string;
  csrPem: string;
  popSignatureB64: string;
}

export type CertIssueResult =
  | { ok: true; certPem: string }
  | { ok: false; reason: string };

export interface CertIssuerDeps {
  ca: CaBundle;
  nonceStore: NonceStore;
  log?: Logger;
}

/**
 * Orchestriert die Ausstellung: Nonce konsumieren → CSR parsen + Key-Hash bilden →
 * PoP über den vollständigen Scope verifizieren → Cert signieren. Fail-closed an
 * jeder Stelle. Der Aufrufer (HTTP-API) gated zusätzlich über mTLS (Mesh-Mitgliedschaft).
 */
export class CertIssuer {
  private readonly caFingerprint: string;

  constructor(private deps: CertIssuerDeps) {
    this.caFingerprint = certFingerprint(deps.ca.caCertPem);
  }

  /** Fingerprint der eigenen (Admin-)CA — vom Nonce-Endpoint an den Client gegeben. */
  get fingerprint(): string {
    return this.caFingerprint;
  }

  async verifyAndIssue(req: CertSignRequest, ipAddresses: string[] = []): Promise<CertIssueResult> {
    // 1. Nonce single-use konsumieren (jeder Versuch verbraucht sie → kein Grinding).
    if (!this.deps.nonceStore.consume(req.nonce)) {
      return { ok: false, reason: 'Nonce unbekannt, abgelaufen oder bereits verwendet' };
    }

    // 2. CSR parsen + Public-Key-Hash bilden.
    let csrPublicKeyHash: string;
    try {
      const csr = forge.pki.certificationRequestFromPem(req.csrPem);
      if (!csr.verify() || !csr.publicKey) {
        return { ok: false, reason: 'CSR-Selbstsignatur ungültig oder kein Public-Key' };
      }
      csrPublicKeyHash = publicKeyDerHash(csr.publicKey);
    } catch (err) {
      return { ok: false, reason: `CSR-Parsing fehlgeschlagen: ${(err as Error).message}` };
    }

    // 3. PoP über den vollständigen, an DIESE CA + Nonce + CSR-Key gebundenen Scope prüfen.
    const fields: CertPopFields = {
      caFingerprint: this.caFingerprint,
      nonce: req.nonce,
      peerId: req.peerId,
      spiffeUri: req.spiffeUri,
      csrPublicKeyHash,
    };
    let ed25519Raw: Uint8Array;
    try {
      ed25519Raw = new Uint8Array(Buffer.from(req.ed25519PublicKeyB64, 'base64'));
    } catch {
      return { ok: false, reason: 'Ed25519-Public-Key nicht base64-dekodierbar' };
    }
    // CR gpt-5.5 WS-3 LOW: Raw-Ed25519-Pubkey ist exakt 32 Byte — explizit fail-closed.
    if (ed25519Raw.length !== 32) {
      return { ok: false, reason: 'Ed25519-Public-Key muss raw 32 Byte lang sein' };
    }
    const pop = await verifyCertPop(ed25519Raw, fields, req.popSignatureB64, this.caFingerprint);
    if (!pop.ok) {
      this.deps.log?.warn({ peerId: req.peerId, reason: pop.reason }, 'PoP-Verifikation abgelehnt');
      return { ok: false, reason: `PoP ungültig: ${pop.reason}` };
    }

    // 4. Cert signieren (SAN node/<PeerID>).
    try {
      const certPem = signNodeCertFromCsr(this.deps.ca, req.csrPem, req.spiffeUri, ipAddresses);
      this.deps.log?.info({ peerId: req.peerId, spiffeUri: req.spiffeUri }, 'node/<PeerID>-Cert ausgestellt');
      return { ok: true, certPem };
    } catch (err) {
      return { ok: false, reason: `Cert-Signing fehlgeschlagen: ${(err as Error).message}` };
    }
  }
}
