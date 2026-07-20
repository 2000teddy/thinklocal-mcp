// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * chain-verify.test.ts — ADR-045 Vorbedingung A (chain-fähiger Verify)
 *
 * Deckt die neue `verifyPeerCertChain` (tls.ts) ab: volle Ketten-Verifikation
 * gegen einen Trust-Anker (Root) inkl. `pathLenConstraint`-Enforcement. Komplement
 * zu `tls-chain-characterization.test.ts`, das die Lücke des FLACHEN `verifyPeerCert`
 * dokumentiert — die hier gefixt/umgangen wird (ohne den flachen Pfad zu ändern).
 */
import { describe, it, expect } from 'vitest';
import forge from 'node-forge';
import { createNodeCert, verifyPeerCert, verifyPeerCertChain, type CaBundle } from './tls.js';

/**
 * Mintet eine CA (`cA:true`) mit explizitem `pathLenConstraint`. `issuer===null` →
 * self-signed Root; sonst vom übergebenen Issuer signiert. `CaBundle`-Form, damit
 * `createNodeCert` sie als Leaf-Aussteller benutzen kann.
 */
function mintCA(issuer: CaBundle | null, cn: string, pathLen: number): CaBundle {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01' + forge.util.bytesToHex(forge.random.getBytesSync(15));
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + 2);
  const subject = [
    { name: 'commonName', value: cn },
    { name: 'organizationName', value: 'thinklocal-mcp' },
  ];
  cert.setSubject(subject);
  const exts = [
    { name: 'basicConstraints', cA: true, critical: true, pathLenConstraint: pathLen },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    { name: 'subjectKeyIdentifier' },
  ];
  cert.setExtensions(exts);
  if (issuer) {
    cert.setIssuer(forge.pki.certificateFromPem(issuer.caCertPem).subject.attributes);
    cert.sign(forge.pki.privateKeyFromPem(issuer.caKeyPem), forge.md.sha256.create());
  } else {
    cert.setIssuer(subject);
    cert.sign(keys.privateKey, forge.md.sha256.create());
  }
  return { caCertPem: forge.pki.certificateToPem(cert), caKeyPem: forge.pki.privateKeyToPem(keys.privateKey) };
}

const LEAF_URI = 'spiffe://thinklocal/node/CHAIN-VERIFY-PEERID';

describe('verifyPeerCertChain — chain-fähiger Verify (ADR-045 Vorbedingung A)', () => {
  it('akzeptiert eine gültige Kette Root → Intermediate → Leaf gegen den Root-Anker', () => {
    const root = mintCA(null, 'thinklocal Root chain-ok', 1); // pathLen 1 → 1 Intermediate erlaubt
    const inter = mintCA(root, 'thinklocal Intermediate chain-ok', 0);
    const leaf = createNodeCert(inter, 'node', LEAF_URI, ['10.10.10.99']);
    expect(verifyPeerCertChain([root.caCertPem], [leaf.certPem, inter.caCertPem])).toBe(true);
  });

  it('ENFORCET pathLen: Root mit pathLen 0 lehnt eine Intermediate-Kette ab', () => {
    const root = mintCA(null, 'thinklocal Root pathlen0', 0); // 0 → KEIN Sub-CA erlaubt
    const inter = mintCA(root, 'thinklocal Intermediate pathlen0', 0);
    const leaf = createNodeCert(inter, 'node', LEAF_URI, []);
    // Die Kette ist kryptografisch korrekt signiert, verletzt aber pathLen → Ablehnung.
    expect(verifyPeerCertChain([root.caCertPem], [leaf.certPem, inter.caCertPem])).toBe(false);
  });

  it('Charakterisierung bleibt erhalten: der FLACHE verifyPeerCert(root, leaf) = false, der chain-Pfad = true', () => {
    const root = mintCA(null, 'thinklocal Root contrast', 1);
    const inter = mintCA(root, 'thinklocal Intermediate contrast', 0);
    const leaf = createNodeCert(inter, 'node', LEAF_URI, []);
    // flacher Ein-Aussteller-Verify: Root verifiziert das Intermediate-Leaf NICHT (unverändert).
    expect(verifyPeerCert(root.caCertPem, leaf.certPem)).toBe(false);
    // chain-fähiger Verify: dieselbe Kette wird korrekt akzeptiert.
    expect(verifyPeerCertChain([root.caCertPem], [leaf.certPem, inter.caCertPem])).toBe(true);
  });

  it('lehnt eine Kette gegen einen FREMDEN Anker ab', () => {
    const root = mintCA(null, 'thinklocal Root real', 1);
    const inter = mintCA(root, 'thinklocal Intermediate real', 0);
    const leaf = createNodeCert(inter, 'node', LEAF_URI, []);
    const otherRoot = mintCA(null, 'thinklocal Root fremd', 1);
    expect(verifyPeerCertChain([otherRoot.caCertPem], [leaf.certPem, inter.caCertPem])).toBe(false);
  });

  it('lehnt eine UNVOLLSTÄNDIGE Kette ab (Intermediate fehlt → kein Pfad zum Anker)', () => {
    const root = mintCA(null, 'thinklocal Root incomplete', 1);
    const inter = mintCA(root, 'thinklocal Intermediate incomplete', 0);
    const leaf = createNodeCert(inter, 'node', LEAF_URI, []);
    // Nur das Leaf, ohne das Intermediate → forge kann nicht zum Root-Anker bauen.
    expect(verifyPeerCertChain([root.caCertPem], [leaf.certPem])).toBe(false);
  });

  it('fail-closed bei leeren Eingaben', () => {
    const root = mintCA(null, 'thinklocal Root empty', 1);
    const leaf = createNodeCert(root, 'node', LEAF_URI, []);
    expect(verifyPeerCertChain([], [leaf.certPem])).toBe(false);
    expect(verifyPeerCertChain([root.caCertPem], [])).toBe(false);
  });

  it('ADR-024 MEDIUM-1: ein ABGELAUFENER Trust-Anker wird abgelehnt (forge prüft das Anker-Fenster nicht)', () => {
    // Anker mit notAfter in der Vergangenheit; das Leaf ist von diesem Anker signiert und selbst gültig.
    const keys = forge.pki.rsa.generateKeyPair(2048);
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = '01' + forge.util.bytesToHex(forge.random.getBytesSync(15));
    cert.validity.notBefore = new Date(Date.now() - 2 * 86400000);
    cert.validity.notAfter = new Date(Date.now() - 86400000); // gestern abgelaufen
    const subject = [
      { name: 'commonName', value: 'thinklocal Root expired' },
      { name: 'organizationName', value: 'thinklocal-mcp' },
    ];
    cert.setSubject(subject);
    cert.setIssuer(subject);
    cert.setExtensions([
      { name: 'basicConstraints', cA: true, critical: true, pathLenConstraint: 1 },
      { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
      { name: 'subjectKeyIdentifier' },
    ]);
    cert.sign(keys.privateKey, forge.md.sha256.create());
    const expiredRoot: CaBundle = {
      caCertPem: forge.pki.certificateToPem(cert),
      caKeyPem: forge.pki.privateKeyToPem(keys.privateKey),
    };
    const leaf = createNodeCert(expiredRoot, 'node', LEAF_URI, []);
    // Ohne die explizite Anker-Fenster-Prüfung gäbe forge hier fälschlich `true` zurück.
    expect(verifyPeerCertChain([expiredRoot.caCertPem], [leaf.certPem])).toBe(false);
  });
});
