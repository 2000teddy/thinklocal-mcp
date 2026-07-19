// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * tls-chain-characterization.test.ts — TL-14a Blocker A (Charakterisierung, KEIN Fix)
 *
 * Groundet die Aussage aus `docs/architecture/TL-14a-blocker-AB-grounding.md` /
 * `ADR-045-ca-two-stage-hierarchy.md`: `verifyPeerCert` (tls.ts) ist ein **flacher
 * Ein-Aussteller-Verify** (`caCert.verify(peerCert)`), der **KEIN Chain-Building**
 * betreibt. In einer zweistufigen Hierarchie (Root → Intermediate → Leaf) verifiziert
 * er ein Leaf daher NUR gegen dessen **direkten** Aussteller (das Intermediate) — und
 * NICHT gegen die Root, obwohl die Root das Intermediate signiert hat.
 *
 * Zweck: die Lücke **regressionsfest** machen, bevor TL-14b (CA-Zweistufen-Umzug) sie
 * berührt. Schlägt dieser Test eines Tages um (Root verifiziert das Leaf → true), ist
 * `verifyPeerCert` chain-fähig geworden (Vorbedingung A erfüllt) — dann ist dieser
 * Test bewusst zu aktualisieren.
 *
 * Bewusst KEIN Fix: dieser Slice ändert `verifyPeerCert` NICHT. Er dokumentiert nur.
 */
import { describe, it, expect } from 'vitest';
import forge from 'node-forge';
import { createMeshCA, createNodeCert, verifyPeerCert, type CaBundle } from './tls.js';

/**
 * Baut ein Intermediate-CA-Cert (`cA:true`), signiert vom übergebenen Aussteller
 * (Root). Gibt es in `CaBundle`-Form zurück, sodass `createNodeCert` es als Aussteller
 * eines Leafs benutzen kann (Reuse des echten Leaf-Signierpfads). Spiegelt die
 * Extensions von `createMeshCA` (basicConstraints cA:true, keyUsage keyCertSign/cRLSign).
 */
function mintIntermediateCA(issuer: CaBundle, commonName: string): CaBundle {
  const issuerCert = forge.pki.certificateFromPem(issuer.caCertPem);
  const issuerKey = forge.pki.privateKeyFromPem(issuer.caKeyPem);

  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01' + forge.util.bytesToHex(forge.random.getBytesSync(15));
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + 1);

  const subjectAttrs = [
    { name: 'commonName', value: commonName },
    { name: 'organizationName', value: 'thinklocal-mcp' },
  ];
  cert.setSubject(subjectAttrs);
  // Aussteller = Subject der Root (damit die Kette namens-konsistent ist).
  cert.setIssuer(issuerCert.subject.attributes);
  cert.setExtensions([
    { name: 'basicConstraints', cA: true, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    { name: 'subjectKeyIdentifier' },
  ]);
  // Signiert mit dem ROOT-Key → die Root ist der direkte Aussteller des Intermediate.
  cert.sign(issuerKey, forge.md.sha256.create());

  return {
    caCertPem: forge.pki.certificateToPem(cert),
    caKeyPem: forge.pki.privateKeyToPem(keys.privateKey),
  };
}

describe('TL-14a Blocker A — verifyPeerCert ist ein flacher Ein-Aussteller-Verify (kein Chain-Building)', () => {
  // Root → Intermediate → Leaf (echter zweistufiger Aufbau).
  const root = createMeshCA('thinklocal', 'root-char');
  const intermediate = mintIntermediateCA(root, 'thinklocal Intermediate CA char');
  const leaf = createNodeCert(
    intermediate,
    'node',
    'spiffe://thinklocal/node/CHAR-TEST-PEERID',
    ['10.10.10.99'],
  );

  it('Root verifiziert ihr DIREKTES Kind (das Intermediate) → true', () => {
    // Direkter Aussteller-Verify: die Root hat das Intermediate signiert.
    expect(verifyPeerCert(root.caCertPem, intermediate.caCertPem)).toBe(true);
  });

  it('Intermediate verifiziert sein DIREKTES Kind (das Leaf) → true', () => {
    // Direkter Aussteller-Verify: das Intermediate hat das Leaf signiert.
    expect(verifyPeerCert(intermediate.caCertPem, leaf.certPem)).toBe(true);
  });

  it('CHARAKTERISIERUNG: Root verifiziert das Leaf NICHT (zwei Hops, kein Chain-Building) → false', () => {
    // Genau die dokumentierte Lücke (Blocker A): verifyPeerCert baut keine Kette
    // Root→Intermediate→Leaf. Das Leaf ist vom Intermediate-Key signiert, nicht vom
    // Root-Key → der flache caCert.verify(peerCert) der Root schlägt fehl.
    expect(verifyPeerCert(root.caCertPem, leaf.certPem)).toBe(false);
  });

  it('Konsequenz für D2: der Root-Trust-Anchor allein reicht NICHT, um ein Intermediate-Leaf zu akzeptieren', () => {
    // Zusammenfassung der beiden obigen Fakten als eine Invariante: nur der direkte
    // Aussteller (Intermediate), nicht die Root, macht ein Leaf über verifyPeerCert gültig.
    const rootAcceptsLeaf = verifyPeerCert(root.caCertPem, leaf.certPem);
    const intermediateAcceptsLeaf = verifyPeerCert(intermediate.caCertPem, leaf.certPem);
    expect(rootAcceptsLeaf).toBe(false);
    expect(intermediateAcceptsLeaf).toBe(true);
  });
});
