import { describe, it, expect, beforeAll } from 'vitest';
import forge from 'node-forge';
import { generateKeyPair } from '@libp2p/crypto/keys';
import type { PrivateKey } from '@libp2p/interface';
import { libp2pPeerIdString } from './libp2p-identity.js';
import { peerIdToSpiffeUri } from './peer-identity.js';
import { extractSpiffeUri, verifyPeerCert, type CaBundle } from './tls.js';
import {
  NonceStore,
  CertIssuer,
  signNodeCertFromCsr,
  publicKeyDerHash,
  certFingerprint,
} from './cert-issuer.js';
import { generateNodeKeypairAndCsr, buildCertSignRequest } from './cert-request.js';

function makeCa(): CaBundle {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 60_000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 864e5);
  const attrs = [{ name: 'commonName', value: 'test mesh ca' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([{ name: 'basicConstraints', cA: true }, { name: 'keyUsage', keyCertSign: true }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return { caCertPem: forge.pki.certificateToPem(cert), caKeyPem: forge.pki.privateKeyToPem(keys.privateKey) };
}

let ca: CaBundle;
let key: PrivateKey;
let peerId: string;

beforeAll(async () => {
  ca = makeCa();
  key = await generateKeyPair('Ed25519');
  peerId = libp2pPeerIdString(key);
});

describe('NonceStore', () => {
  it('issues unique nonces; consume succeeds exactly once (single-use)', () => {
    const s = new NonceStore();
    const n = s.issue();
    expect(typeof n).toBe('string');
    expect(s.consume(n)).toBe(true);
    expect(s.consume(n)).toBe(false); // already used
  });

  it('unknown nonce → false', () => {
    expect(new NonceStore().consume('nope')).toBe(false);
  });

  it('expired nonce → false (injected clock)', () => {
    let t = 1_000;
    const s = new NonceStore(100, () => t);
    const n = s.issue();
    t = 1_000 + 101; // past TTL
    expect(s.consume(n)).toBe(false);
  });
});

describe('signNodeCertFromCsr', () => {
  it('issues a cert with SAN node/<PeerID>, verifiable against the CA, with the CSR public key', () => {
    const csr = generateNodeKeypairAndCsr('th01');
    const spiffe = peerIdToSpiffeUri(peerId);
    const certPem = signNodeCertFromCsr(ca, csr.csrPem, spiffe);
    expect(extractSpiffeUri(certPem)).toBe(spiffe);
    expect(verifyPeerCert(ca.caCertPem, certPem)).toBe(true);
    // the cert's public key must equal the CSR's public key (CA never gets the private key)
    const issued = forge.pki.certificateFromPem(certPem);
    expect(publicKeyDerHash(issued.publicKey)).toBe(csr.csrPublicKeyHash);
  });

  it('SECURITY HIGH: issued cert carries requester identity + own loopback — NO admin/foreign hostname', () => {
    const csr = generateNodeKeypairAndCsr('th01'); // requester CN = th01
    const certPem = signNodeCertFromCsr(ca, csr.csrPem, peerIdToSpiffeUri(peerId), ['10.10.10.80']);
    const issued = forge.pki.certificateFromPem(certPem);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const san = issued.getExtension('subjectAltName') as any;
    const dnsNames = san.altNames.filter((a: { type: number }) => a.type === 2).map((a: { value: string }) => a.value);
    const ips = san.altNames.filter((a: { type: number }) => a.type === 7).map((a: { ip: string }) => a.ip);
    // own loopback (localhost) + own CN (th01) — and NOTHING foreign
    expect(dnsNames.slice().sort()).toEqual(['localhost', 'th01']);
    expect(dnsNames).not.toContain('admin-94'); // never the admin/other host
    expect(ips).toContain('10.10.10.80'); // own routable IP
    expect(ips).toContain('127.0.0.1'); // own loopback
  });

  it('SECURITY: a wildcard / bogus CSR CN is dropped (only own loopback DNS remains)', () => {
    const csr = generateNodeKeypairAndCsr('*.evil.example'); // invalid hostname
    const certPem = signNodeCertFromCsr(ca, csr.csrPem, peerIdToSpiffeUri(peerId));
    const issued = forge.pki.certificateFromPem(certPem);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const san = issued.getExtension('subjectAltName') as any;
    const dnsNames = san.altNames.filter((a: { type: number }) => a.type === 2).map((a: { value: string }) => a.value);
    expect(dnsNames).toEqual(['localhost']); // bogus CN dropped → only own loopback DNS
    expect(dnsNames).not.toContain('*.evil.example');
  });

  it('rejects a CSR with a broken self-signature', () => {
    const csr = generateNodeKeypairAndCsr('th01');
    const broken = csr.csrPem.replace(/A/, 'B'); // corrupt
    expect(() => signNodeCertFromCsr(ca, broken, peerIdToSpiffeUri(peerId))).toThrow();
  });
});

describe('CertIssuer.verifyAndIssue — end-to-end client↔admin interop', () => {
  it('happy path: client builds PoP request → admin issues node/<PeerID> cert', async () => {
    const nonceStore = new NonceStore();
    const issuer = new CertIssuer({ ca, nonceStore });
    expect(issuer.fingerprint).toBe(certFingerprint(ca.caCertPem));

    const nonce = nonceStore.issue();
    const csr = generateNodeKeypairAndCsr('th01');
    const req = await buildCertSignRequest(key, peerId, issuer.fingerprint, nonce, csr);

    const result = await issuer.verifyAndIssue(req);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(extractSpiffeUri(result.certPem)).toBe(peerIdToSpiffeUri(peerId));
      expect(verifyPeerCert(ca.caCertPem, result.certPem)).toBe(true);
    }
  });

  it('rejects a replayed nonce (single-use)', async () => {
    const nonceStore = new NonceStore();
    const issuer = new CertIssuer({ ca, nonceStore });
    const nonce = nonceStore.issue();
    const csr = generateNodeKeypairAndCsr('th01');
    const req = await buildCertSignRequest(key, peerId, issuer.fingerprint, nonce, csr);
    expect((await issuer.verifyAndIssue(req)).ok).toBe(true);
    // same nonce again → consumed
    const r2 = await issuer.verifyAndIssue(req);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toMatch(/Nonce/);
  });

  it('SECURITY: cert-substitution blocked — PoP bound to a DIFFERENT CSR key is rejected', async () => {
    const nonceStore = new NonceStore();
    const issuer = new CertIssuer({ ca, nonceStore });
    const nonce = nonceStore.issue();
    const honestCsr = generateNodeKeypairAndCsr('th01');
    const req = await buildCertSignRequest(key, peerId, issuer.fingerprint, nonce, honestCsr);
    // attacker swaps in their OWN csr (different key) but keeps the victim's PoP signature
    const attackerCsr = generateNodeKeypairAndCsr('th01');
    req.csrPem = attackerCsr.csrPem;
    const r = await issuer.verifyAndIssue(req);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/PoP/);
  });

  it('SECURITY: a foreign PeerID (not derived from the signing key) is rejected', async () => {
    const nonceStore = new NonceStore();
    const issuer = new CertIssuer({ ca, nonceStore });
    const nonce = nonceStore.issue();
    const csr = generateNodeKeypairAndCsr('th01');
    const victim = await generateKeyPair('Ed25519');
    const victimPeerId = libp2pPeerIdString(victim);
    // attacker signs with THEIR key but claims the victim's PeerID + spiffe
    const req = await buildCertSignRequest(key, peerId, issuer.fingerprint, nonce, csr);
    req.peerId = victimPeerId;
    req.spiffeUri = peerIdToSpiffeUri(victimPeerId);
    const r = await issuer.verifyAndIssue(req);
    expect(r.ok).toBe(false);
  });

  it('SECURITY: wrong CA fingerprint in PoP (signed for another mesh CA) → rejected', async () => {
    const nonceStore = new NonceStore();
    const issuer = new CertIssuer({ ca, nonceStore });
    const nonce = nonceStore.issue();
    const csr = generateNodeKeypairAndCsr('th01');
    const req = await buildCertSignRequest(key, peerId, 'some-other-ca-fingerprint', nonce, csr);
    const r = await issuer.verifyAndIssue(req);
    expect(r.ok).toBe(false);
  });
});
