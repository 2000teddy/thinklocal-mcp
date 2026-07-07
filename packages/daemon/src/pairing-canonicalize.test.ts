// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * Tests für pairing-canonicalize.ts (KW28 TL-00): CA-verankerter + identitäts-gebundener
 * host/→node/-Re-Key. Deckt: Happy-Re-Key, fail-closed bei fremder CA (Anker-Gate), fail-closed
 * bei Identitäts-Substitution (CR-CRITICAL: A-serviert-B-Cert), already-canonical, kein Trust-Anker,
 * kein node/-SAN, überbreites Cert, ungültige expected-URI.
 */
import { describe, it, expect } from 'vitest';
import forge from 'node-forge';
import { createMeshCA, createNodeCert } from './tls.js';
import { canonicalizePairedPeer } from './pairing-canonicalize.js';
import type { PairedPeer } from './pairing.js';

const CANON = 'spiffe://thinklocal/node/12D3KooWFgnDgukhD5AxSHs3uNQC9kBVq9xHrY85kxYXD5EX6J5d';
const CANON_B = 'spiffe://thinklocal/node/12D3KooWMu7EkUK2XNB1jaWr7JGKDueNgTiVcCHG78VU23DdkrJV';
const LEGACY_URI = 'spiffe://thinklocal/host/b4768fe0e2dfd41f/agent/claude-code';

// GETEILTE Mesh-CA (wie .94): signiert MEHRERE Node-Certs → CA-verify allein reicht NICHT.
const sharedCa = createMeshCA('thinklocal', 'shared94');
const foreignCa = createMeshCA('thinklocal', 'foreign99');

function legacyEntry(over: Partial<PairedPeer> = {}): PairedPeer {
  return {
    agentId: LEGACY_URI,
    publicKeyPem: '',
    caCertPem: sharedCa.caCertPem,
    fingerprint: '',
    pairedAt: '2026-06-03T10:57:45.132Z',
    hostname: 'iobroker',
    ...over,
  };
}

function mintCertWithSans(ca: ReturnType<typeof createMeshCA>, uriSans: string[]): string {
  const caCert = forge.pki.certificateFromPem(ca.caCertPem);
  const caKey = forge.pki.privateKeyFromPem(ca.caKeyPem);
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '0' + Math.abs(uriSans.join('').length * 7 + 5).toString(16);
  cert.validity.notBefore = new Date(Date.now() - 3600_000);
  cert.validity.notAfter = new Date(Date.now() + 90 * 24 * 3600_000);
  cert.setSubject([{ name: 'commonName', value: 'node' }]);
  cert.setIssuer(caCert.subject.attributes);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { name: 'subjectAltName', altNames: uriSans.map((u) => ({ type: 6, value: u })) as any },
  ]);
  cert.sign(caKey, forge.md.sha256.create());
  return forge.pki.certificateToPem(cert);
}

describe('canonicalizePairedPeer (CA-verankert + identitäts-gebunden)', () => {
  it('Happy: Legacy host/ + Cert der erwarteten Identität unter geteiltem CA → Re-Key auf node/', () => {
    const nodeCert = createNodeCert(sharedCa, 'iobroker', CANON, ['10.10.10.52']);
    const res = canonicalizePairedPeer(legacyEntry(), nodeCert.certPem, CANON);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.migrated.agentId).toBe(CANON); // re-gekeyt auf die asserted Identität
    expect(res.migrated.caCertPem).toBe(sharedCa.caCertPem); // Trust-Anker unverändert
    expect(res.migrated.hostname).toBe('iobroker'); // Metadaten erhalten
    expect(res.migrated.pairedAt).toBe('2026-06-03T10:57:45.132Z');
    // pubkey/fingerprint bewusst NICHT aus dem Cert befüllt (RSA-TLS ≠ ECDSA-Signing-Key).
    expect(res.migrated.publicKeyPem).toBe('');
    expect(res.migrated.fingerprint).toBe('');
  });

  it('CR-CRITICAL Anti-Substitution: A-Eintrag + B-Cert (beide unter geteiltem CA gültig) → canon-uri-mismatch', () => {
    // B's Cert ist VALIDE von derselben geteilten CA signiert (verifyPeerCert=true), trägt aber B's
    // node/-Identität. Ohne die expected-URI-Bindung würde A's Eintrag zu B re-gekeyt. → MUSS skippen.
    const bCert = createNodeCert(sharedCa, 'thinkhub02', CANON_B, ['10.10.10.82']);
    const res = canonicalizePairedPeer(legacyEntry(), bCert.certPem, CANON);
    expect(res).toEqual({ ok: false, skip: 'canon-uri-mismatch' });
  });

  it('Anker-Gate fail-closed: Cert unter FREMDER CA → cert-not-under-stored-ca', () => {
    const foreignCert = createNodeCert(foreignCa, 'iobroker', CANON, ['10.10.10.52']);
    const res = canonicalizePairedPeer(legacyEntry(), foreignCert.certPem, CANON);
    expect(res).toEqual({ ok: false, skip: 'cert-not-under-stored-ca' });
  });

  it('skip invalid-expected-uri: erwartete URI ist keine kanonische node/-URI', () => {
    const nodeCert = createNodeCert(sharedCa, 'iobroker', CANON, ['10.10.10.52']);
    const res = canonicalizePairedPeer(legacyEntry(), nodeCert.certPem, LEGACY_URI);
    expect(res).toEqual({ ok: false, skip: 'invalid-expected-uri' });
  });

  it('skip already-canonical: Eintrag ist schon node/', () => {
    const nodeCert = createNodeCert(sharedCa, 'iobroker', CANON, ['10.10.10.52']);
    const res = canonicalizePairedPeer(legacyEntry({ agentId: CANON }), nodeCert.certPem, CANON);
    expect(res).toEqual({ ok: false, skip: 'already-canonical' });
  });

  it('skip no-trust-anchor: leeres caCertPem', () => {
    const nodeCert = createNodeCert(sharedCa, 'iobroker', CANON, ['10.10.10.52']);
    const res = canonicalizePairedPeer(legacyEntry({ caCertPem: '' }), nodeCert.certPem, CANON);
    expect(res).toEqual({ ok: false, skip: 'no-trust-anchor' });
  });

  it('skip no-canonical-san: Cert (unter storedCa) trägt nur eine host/-SAN', () => {
    const hostOnly = mintCertWithSans(sharedCa, ['spiffe://thinklocal/host/b4768fe0e2dfd41f/agent/claude-code']);
    const res = canonicalizePairedPeer(legacyEntry(), hostOnly, CANON);
    expect(res).toEqual({ ok: false, skip: 'no-canonical-san' });
  });

  it('skip multiple-node-sans: überbreites Cert mit CANON UND fremder node/-SAN', () => {
    const overbroad = mintCertWithSans(sharedCa, [CANON, CANON_B]);
    const res = canonicalizePairedPeer(legacyEntry(), overbroad, CANON);
    expect(res).toEqual({ ok: false, skip: 'multiple-node-sans' });
  });

  it('cert-not-under-stored-ca präzise: unlesbares Cert-PEM (verifyPeerCert=false vor Parse)', () => {
    const res = canonicalizePairedPeer(legacyEntry(), 'not a cert', CANON);
    expect(res).toEqual({ ok: false, skip: 'cert-not-under-stored-ca' });
  });
});
