import { describe, it, expect } from 'vitest';
import forge from 'node-forge';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createMeshCA,
  createNodeCert,
  verifyPeerCert,
  selectTrustDistributionCa,
  extractSpiffeUri,
  isRetainableCanonicalCert,
  loadOrCreateTlsBundle,
} from './tls.js';

const DAY = 24 * 3600_000;

// Mintet eine self-signed CA mit explizitem Gültigkeitsfenster (für Time-Window-Tests, ADR-024
// MEDIUM-1). Leaf-Certs werden separat via createNodeCert (zeitlich gültiges Leaf) signiert, so
// dass nur die CA-Gültigkeit das Verhalten bestimmt.
function mintCaWithValidity(notBefore: Date, notAfter: Date): { caCertPem: string; caKeyPem: string } {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01' + Math.abs(notAfter.getTime() % 9973).toString(16);
  cert.validity.notBefore = notBefore;
  cert.validity.notAfter = notAfter;
  const attrs = [
    { name: 'commonName', value: `thinklocal Mesh CA validity-${notAfter.getTime()}` },
    { name: 'organizationName', value: 'thinklocal-mcp' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: true, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return { caCertPem: forge.pki.certificateToPem(cert), caKeyPem: forge.pki.privateKeyToPem(keys.privateKey) };
}

// ADR-024: Canonical-Cert-Retention.
describe('ADR-024 — Canonical-Cert-Retention', () => {
  // Attesting CA (= .94 admin CA) und eine DAVON UNABHÄNGIGE eigene CA (= own-CA-Node).
  const attestingCa = createMeshCA('thinklocal', 'admin94');
  const ownCa = createMeshCA('thinklocal', 'ownca56');
  const CANON = 'spiffe://thinklocal/node/12D3KooWCanonTEST';
  // Kanonisches Node-Cert, ausgestellt von der Attesting-CA.
  const canonCert = createNodeCert(attestingCa, 'node', CANON, ['10.10.10.50']);

  describe('isRetainableCanonicalCert (rein)', () => {
    it('behält: SAN==eigene kanonische URI UND signiert von gepinnter Attesting-CA', () => {
      expect(isRetainableCanonicalCert({
        certPem: canonCert.certPem,
        canonicalSpiffeUri: CANON,
        trustedAttestingCaPems: [attestingCa.caCertPem],
      })).toBe(true);
    });

    it('behält auch wenn die eigene (andere) CA mit in der Liste steht (Multi-CA)', () => {
      expect(isRetainableCanonicalCert({
        certPem: canonCert.certPem,
        canonicalSpiffeUri: CANON,
        trustedAttestingCaPems: [ownCa.caCertPem, attestingCa.caCertPem],
      })).toBe(true);
    });

    it('verwirft: SAN ist NICHT die eigene kanonische URI (fremde PeerID)', () => {
      expect(isRetainableCanonicalCert({
        certPem: canonCert.certPem,
        canonicalSpiffeUri: 'spiffe://thinklocal/node/12D3KooWOTHER',
        trustedAttestingCaPems: [attestingCa.caCertPem],
      })).toBe(false);
    });

    it('verwirft: Issuer NICHT gepinnt (Confused-Deputy-Schutz — nur ownCa in der Liste)', () => {
      // canonCert ist von attestingCa signiert; ownCa darf es NICHT verifizieren.
      expect(isRetainableCanonicalCert({
        certPem: canonCert.certPem,
        canonicalSpiffeUri: CANON,
        trustedAttestingCaPems: [ownCa.caCertPem],
      })).toBe(false);
    });

    it('verwirft: leere Trusted-Liste oder fehlende canonicalSpiffeUri', () => {
      expect(isRetainableCanonicalCert({ certPem: canonCert.certPem, canonicalSpiffeUri: CANON, trustedAttestingCaPems: [] })).toBe(false);
      expect(isRetainableCanonicalCert({ certPem: canonCert.certPem, canonicalSpiffeUri: undefined, trustedAttestingCaPems: [attestingCa.caCertPem] })).toBe(false);
    });

    // CR-MEDIUM (ADR-024): Multi-SAN-Härtung. Mintet ein Cert mit mehreren URI-SANs.
    function mintMultiSanCert(ca: ReturnType<typeof createMeshCA>, uriSans: string[]): string {
      const caCert = forge.pki.certificateFromPem(ca.caCertPem);
      const caKey = forge.pki.privateKeyFromPem(ca.caKeyPem);
      const keys = forge.pki.rsa.generateKeyPair(2048);
      const cert = forge.pki.createCertificate();
      cert.publicKey = keys.publicKey;
      cert.serialNumber = '0' + Math.abs(uriSans.join('').length * 7 + 13).toString(16);
      cert.validity.notBefore = new Date(Date.now() - 3600_000);
      cert.validity.notAfter = new Date(Date.now() + 90 * 24 * 3600_000);
      cert.setSubject([{ name: 'commonName', value: 'multi' }]);
      cert.setIssuer(caCert.subject.attributes);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cert.setExtensions([{ name: 'basicConstraints', cA: false }, {
        name: 'subjectAltName',
        altNames: uriSans.map((u) => ({ type: 6, value: u })) as any,
      }]);
      cert.sign(caKey, forge.md.sha256.create());
      return forge.pki.certificateToPem(cert);
    }

    it('behält Migrations-Cert: Legacy host/-SAN + eigene kanonische node/-SAN', () => {
      const migration = mintMultiSanCert(attestingCa, ['spiffe://thinklocal/host/admin94/agent/claude-code', CANON]);
      expect(isRetainableCanonicalCert({ certPem: migration, canonicalSpiffeUri: CANON, trustedAttestingCaPems: [attestingCa.caCertPem] })).toBe(true);
    });

    it('verwirft überbreites Cert: eigene UND eine FREMDE kanonische node/-SAN', () => {
      const overbroad = mintMultiSanCert(attestingCa, [CANON, 'spiffe://thinklocal/node/12D3KooWFOREIGN']);
      expect(isRetainableCanonicalCert({ certPem: overbroad, canonicalSpiffeUri: CANON, trustedAttestingCaPems: [attestingCa.caCertPem] })).toBe(false);
    });
  });

  describe('loadOrCreateTlsBundle — Retention vs. Regeneration', () => {
    function setupTls(caForOwnCaFiles: ReturnType<typeof createMeshCA>, nodeCert: ReturnType<typeof createNodeCert>): string {
      const dir = mkdtempSync(join(tmpdir(), 'tlmcp-adr024-'));
      const tls = join(dir, 'tls');
      mkdirSync(tls, { recursive: true });
      // ca.key.pem present → CA-owner branch (wie .94/.56/.222, die alle einen eigenen ca.key haben).
      writeFileSync(join(tls, 'ca.crt.pem'), caForOwnCaFiles.caCertPem);
      writeFileSync(join(tls, 'ca.key.pem'), caForOwnCaFiles.caKeyPem);
      writeFileSync(join(tls, 'node.crt.pem'), nodeCert.certPem);
      writeFileSync(join(tls, 'node.key.pem'), nodeCert.keyPem);
      return dir;
    }
    const LEGACY = 'spiffe://thinklocal/host/admin94/agent/claude-code';

    it('own-CA-Node: behält das von der Attesting-CA signierte kanonische Cert (Retention)', () => {
      // ca.crt.pem = ownCa (eigene CA), node.crt.pem = kanonisch von attestingCa signiert.
      const dir = setupTls(ownCa, canonCert);
      try {
        const bundle = loadOrCreateTlsBundle(dir, 'node', LEGACY, undefined, 'admin94', {
          canonicalSpiffeUri: CANON,
          trustedAttestingCaPems: [attestingCa.caCertPem],
        });
        expect(extractSpiffeUri(bundle.certPem)).toBe(CANON);
        expect(bundle.certPem).toBe(canonCert.certPem); // unverändert behalten
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('CA-owner-Node (.94): behält kanonisches Cert obwohl SPIFFE != Legacy-Identität', () => {
      // ca.crt.pem = attestingCa (Node IST die CA), node.crt.pem kanonisch von derselben CA.
      const dir = setupTls(attestingCa, canonCert);
      try {
        const bundle = loadOrCreateTlsBundle(dir, 'node', LEGACY, undefined, 'admin94', {
          canonicalSpiffeUri: CANON,
          trustedAttestingCaPems: [attestingCa.caCertPem],
        });
        expect(extractSpiffeUri(bundle.certPem)).toBe(CANON);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('OHNE Retention-Opts: Default-Verhalten — kanonisches Cert wird regeneriert (Legacy)', () => {
      const dir = setupTls(attestingCa, canonCert);
      try {
        const bundle = loadOrCreateTlsBundle(dir, 'node', LEGACY, undefined, 'admin94');
        // regeneriert → SAN == die übergebene (Legacy-)Identität, nicht mehr kanonisch.
        expect(extractSpiffeUri(bundle.certPem)).toBe(LEGACY);
        expect(bundle.certPem).not.toBe(canonCert.certPem);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    // SECURITY (PR #77, fail-closed CA-Gültigkeit beim Reuse): eine eigene `ca.crt.pem`, deren
    // Gültigkeitsfenster abgelaufen / noch nicht gültig ist, darf NICHT still wiederverwendet werden
    // → CA-Reissue. Dieser Pfad (`tls.ts` `loadOrCreateTlsBundle`, `caValid`-Check) war bisher
    // ungetestet (Bruch der Bedingung lässt 30/30 grün) — diese zwei Tests nageln ihn fest.
    it('eigene CA ABGELAUFEN → CA-Reissue (nicht still wiederverwenden, PR #77)', () => {
      const expiredOwnCa = mintCaWithValidity(new Date(Date.now() - 400 * DAY), new Date(Date.now() - DAY));
      const nodeUnderExpired = createNodeCert(expiredOwnCa, 'node', LEGACY);
      const dir = setupTls(expiredOwnCa, nodeUnderExpired);
      try {
        const bundle = loadOrCreateTlsBundle(dir, 'node', LEGACY, undefined, 'ownca56');
        // Reissue: die zurückgegebene CA ist NICHT mehr die abgelaufene Eingabe …
        expect(bundle.caCertPem).not.toBe(expiredOwnCa.caCertPem);
        // … und das frische Node-Cert verifiziert gegen die frische, GÜLTIGE CA (verifyPeerCert
        // ist fail-closed auf CA-Gültigkeit, ADR-024 MEDIUM-1 → true nur wenn CA aktuell gültig).
        expect(verifyPeerCert(bundle.caCertPem, bundle.certPem)).toBe(true);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('eigene CA NOCH NICHT GÜLTIG (notBefore in der Zukunft) → CA-Reissue', () => {
      const futureOwnCa = mintCaWithValidity(new Date(Date.now() + 10 * DAY), new Date(Date.now() + 400 * DAY));
      const nodeUnderFuture = createNodeCert(futureOwnCa, 'node', LEGACY);
      const dir = setupTls(futureOwnCa, nodeUnderFuture);
      try {
        const bundle = loadOrCreateTlsBundle(dir, 'node', LEGACY, undefined, 'ownca56');
        expect(bundle.caCertPem).not.toBe(futureOwnCa.caCertPem);
        expect(verifyPeerCert(bundle.caCertPem, bundle.certPem)).toBe(true);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('Retention greift NICHT bei cert<->key-Mismatch → regeneriert (Legacy, Security)', () => {
      // node.crt.pem = kanonisch (von attestingCa), node.key.pem = FREMDER Key (passt nicht).
      const foreign = createNodeCert(ownCa, 'other', 'spiffe://thinklocal/host/other/agent/x');
      const dir = mkdtempSync(join(tmpdir(), 'tlmcp-adr024-km-'));
      const tls = join(dir, 'tls');
      mkdirSync(tls, { recursive: true });
      writeFileSync(join(tls, 'ca.crt.pem'), ownCa.caCertPem);
      writeFileSync(join(tls, 'ca.key.pem'), ownCa.caKeyPem);
      writeFileSync(join(tls, 'node.crt.pem'), canonCert.certPem);
      writeFileSync(join(tls, 'node.key.pem'), foreign.keyPem); // Mismatch!
      try {
        const bundle = loadOrCreateTlsBundle(dir, 'node', LEGACY, undefined, 'ownca56', {
          canonicalSpiffeUri: CANON,
          trustedAttestingCaPems: [attestingCa.caCertPem],
        });
        // certKeyMatches=false → NICHT behalten → regeneriert auf Legacy.
        expect(extractSpiffeUri(bundle.certPem)).toBe(LEGACY);
        expect(bundle.certPem).not.toBe(canonCert.certPem);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('Retention greift NICHT bei unpinned Issuer → regeneriert (Legacy)', () => {
      const dir = setupTls(ownCa, canonCert);
      try {
        const bundle = loadOrCreateTlsBundle(dir, 'node', LEGACY, undefined, 'ownca56', {
          canonicalSpiffeUri: CANON,
          trustedAttestingCaPems: [ownCa.caCertPem], // attestingCa NICHT gepinnt
        });
        expect(extractSpiffeUri(bundle.certPem)).toBe(LEGACY);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    // CR (claude codereviewer) — MEDIUM-1 wirkt auch durch isRetainableCanonicalCert: eine
    // ABGELAUFENE Attesting-CA darf das kanonische Cert NICHT mehr behalten (verifyPeerCert
    // caValid=false) → regeneriert auf Legacy statt eine abgelaufene CA als Anker zu akzeptieren.
    it('Retention greift NICHT bei ABGELAUFENER Attesting-CA → regeneriert (Legacy)', () => {
      const expiredAttesting = mintCaWithValidity(new Date(Date.now() - 400 * DAY), new Date(Date.now() - DAY));
      const expiredSignedCert = createNodeCert(expiredAttesting, 'node', CANON, []);
      const dir = setupTls(ownCa, expiredSignedCert);
      try {
        const bundle = loadOrCreateTlsBundle(dir, 'node', LEGACY, undefined, 'ownca56', {
          canonicalSpiffeUri: CANON,
          trustedAttestingCaPems: [expiredAttesting.caCertPem],
        });
        expect(extractSpiffeUri(bundle.certPem)).toBe(LEGACY);
        expect(bundle.certPem).not.toBe(expiredSignedCert.certPem);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });
  });
});

// 127b (CR-MEDIUM pre-existing): Der token-onboarded Zweig (ca.crt.pem vorhanden, ca.key.pem
// FEHLT — Key bleibt beim Admin) reichte das gelieferte Bundle bisher UNGEPRÜFT durch. Ohne
// CA-Key kann der Node nicht selbst neu ausstellen → ein invalides Bundle muss fail-closed
// abgewiesen werden, statt Peers ein ablehnbares Cert zu servieren (stiller Mesh-Ausfall).
describe('127b — Token-onboarded Bundle: fail-closed Validierung (kein CA-Key)', () => {
  const adminCa = createMeshCA('thinklocal', 'admin94');
  const otherCa = createMeshCA('thinklocal', 'rogue');
  const NODE = 'spiffe://thinklocal/host/th01/agent/claude-code';
  const CANON = 'spiffe://thinklocal/node/12D3KooWTokenTEST';

  // Token-onboard-Layout: ca.crt.pem vorhanden, ca.key.pem FEHLT, node.crt/node.key vom Admin.
  function setupTokenOnboard(caCertPem: string, nodeCertPem: string, nodeKeyPem: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'tlmcp-127b-'));
    const tls = join(dir, 'tls');
    mkdirSync(tls, { recursive: true });
    writeFileSync(join(tls, 'ca.crt.pem'), caCertPem);
    // KEIN ca.key.pem — genau das triggert den token-onboarded Zweig.
    writeFileSync(join(tls, 'node.crt.pem'), nodeCertPem);
    writeFileSync(join(tls, 'node.key.pem'), nodeKeyPem);
    return dir;
  }

  it('gültiges Bundle (node.crt von gelieferter CA signiert) → unverändert übernommen', () => {
    const node = createNodeCert(adminCa, 'th01', NODE, ['10.10.10.80']);
    const dir = setupTokenOnboard(adminCa.caCertPem, node.certPem, node.keyPem);
    try {
      const bundle = loadOrCreateTlsBundle(dir, 'th01', NODE, undefined, 'th01');
      expect(bundle.certPem).toBe(node.certPem); // durchgereicht, NICHT regeneriert
      expect(bundle.caCertPem).toBe(adminCa.caCertPem);
      // Der zurückgegebene Anchor MUSS das servierte Cert verifizieren (kein Mismatch).
      expect(verifyPeerCert(bundle.caCertPem, bundle.certPem)).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('node.crt NICHT von gelieferter CA signiert → fail-closed throw', () => {
    // node.crt von otherCa signiert, ca.crt.pem = adminCa → Signatur-Mismatch.
    const rogueNode = createNodeCert(otherCa, 'th01', NODE, []);
    const dir = setupTokenOnboard(adminCa.caCertPem, rogueNode.certPem, rogueNode.keyPem);
    try {
      expect(() => loadOrCreateTlsBundle(dir, 'th01', NODE, undefined, 'th01')).toThrow(
        /verifiziert nicht gegen ca\.crt\.pem/,
      );
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('cert<->key-Mismatch → fail-closed throw', () => {
    const node = createNodeCert(adminCa, 'th01', NODE, []);
    const foreign = createNodeCert(adminCa, 'other', 'spiffe://thinklocal/host/other/agent/x', []);
    // node.crt korrekt signiert, aber node.key ist FREMD.
    const dir = setupTokenOnboard(adminCa.caCertPem, node.certPem, foreign.keyPem);
    try {
      expect(() => loadOrCreateTlsBundle(dir, 'th01', NODE, undefined, 'th01')).toThrow();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('ABGELAUFENE gelieferte CA → fail-closed throw (nicht still servieren)', () => {
    const expiredCa = mintCaWithValidity(new Date(Date.now() - 400 * DAY), new Date(Date.now() - DAY));
    const node = createNodeCert(expiredCa, 'th01', NODE, []);
    const dir = setupTokenOnboard(expiredCa.caCertPem, node.certPem, node.keyPem);
    try {
      expect(() => loadOrCreateTlsBundle(dir, 'th01', NODE, undefined, 'th01')).toThrow();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('kanonisches Token-Onboard: Admin liefert Attesting-CA als ca.crt.pem → behalten + Anchor verifiziert', () => {
    // Realistischer kanonischer Token-Onboard: der Admin liefert GENAU die Attesting-CA,
    // die das kanonische node/<PeerID>-Cert signiert hat, als ca.crt.pem mit. → signedByShippedCa.
    const canon = createNodeCert(adminCa, 'th01', CANON, ['10.10.10.80']);
    const dir = setupTokenOnboard(adminCa.caCertPem, canon.certPem, canon.keyPem);
    try {
      const bundle = loadOrCreateTlsBundle(dir, 'th01', NODE, undefined, 'th01');
      expect(bundle.certPem).toBe(canon.certPem); // kanonisches Cert unverändert behalten
      expect(extractSpiffeUri(bundle.certPem)).toBe(CANON);
      // Der zurückgegebene Anchor verifiziert das kanonische Cert (index.ts kann den Issuer auflösen).
      expect(verifyPeerCert(bundle.caCertPem, bundle.certPem)).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('inkonsistent: ca.crt.pem verifiziert das kanonische node.crt NICHT → fail-closed throw', () => {
    // ca.crt.pem = otherCa, aber node.crt von adminCa signiert → kein still gemischter Anchor.
    const canon = createNodeCert(adminCa, 'th01', CANON, ['10.10.10.80']);
    const dir = setupTokenOnboard(otherCa.caCertPem, canon.certPem, canon.keyPem);
    try {
      expect(() => loadOrCreateTlsBundle(dir, 'th01', NODE, undefined, 'th01')).toThrow(
        /verifiziert nicht gegen ca\.crt\.pem/,
      );
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('TLS — Lokale CA und Zertifikate', () => {
  const ca = createMeshCA('test-mesh');

  it('erstellt eine gültige CA mit PEM-Zertifikat und Schlüssel', () => {
    expect(ca.caCertPem).toContain('BEGIN CERTIFICATE');
    expect(ca.caKeyPem).toContain('BEGIN RSA PRIVATE KEY');
  });

  it('erstellt ein Node-Zertifikat signiert von der CA', () => {
    const bundle = createNodeCert(ca, 'test-host', 'spiffe://thinklocal/host/test-host/agent/claude-code', [
      '127.0.0.1',
    ]);

    expect(bundle.certPem).toContain('BEGIN CERTIFICATE');
    expect(bundle.keyPem).toContain('BEGIN RSA PRIVATE KEY');
    expect(bundle.caCertPem).toBe(ca.caCertPem);
  });

  it('verifiziert ein gültiges Node-Zertifikat gegen die CA', () => {
    const bundle = createNodeCert(ca, 'node-a', 'spiffe://thinklocal/host/node-a/agent/test');
    expect(verifyPeerCert(ca.caCertPem, bundle.certPem)).toBe(true);
  });

  it('lehnt ein Zertifikat von einer fremden CA ab', () => {
    const foreignCa = createMeshCA('foreign-mesh');
    const bundle = createNodeCert(foreignCa, 'evil-node', 'spiffe://evil/agent');
    expect(verifyPeerCert(ca.caCertPem, bundle.certPem)).toBe(false);
  });

  it('extrahiert den SPIFFE-URI aus dem Zertifikat', () => {
    const spiffeUri = 'spiffe://thinklocal/host/myhost/agent/claude-code';
    const bundle = createNodeCert(ca, 'myhost', spiffeUri);
    expect(extractSpiffeUri(bundle.certPem)).toBe(spiffeUri);
  });

  it('gibt null zurück wenn kein SPIFFE-URI im Zertifikat', () => {
    // CA-Zertifikat hat keinen SPIFFE-URI
    expect(extractSpiffeUri(ca.caCertPem)).toBeNull();
  });

  it('erzeugt unterschiedliche Seriennummern für verschiedene Zertifikate', () => {
    const bundle1 = createNodeCert(ca, 'host-1', 'spiffe://thinklocal/host/host-1/agent/a');
    const bundle2 = createNodeCert(ca, 'host-2', 'spiffe://thinklocal/host/host-2/agent/b');
    // Zertifikate sind unterschiedlich
    expect(bundle1.certPem).not.toBe(bundle2.certPem);
  });
});

// ADR-024 Rollout-Gate — die zwei MERGE-/DEPLOY-blockierenden MEDIUMs aus #165.
describe('ADR-024 MEDIUM-1 — CA-Gültigkeit im Retention-/Verify-Pfad fail-closed', () => {
  it('akzeptiert: CA gültig UND Leaf gültig', () => {
    const ca = mintCaWithValidity(new Date(Date.now() - DAY), new Date(Date.now() + 365 * DAY));
    const leaf = createNodeCert(ca, 'node', 'spiffe://thinklocal/node/12D3KooWValidCA');
    expect(verifyPeerCert(ca.caCertPem, leaf.certPem)).toBe(true);
  });

  it('lehnt ab (fail-closed): ABGELAUFENE CA, obwohl Leaf zeitlich gültig + korrekt signiert', () => {
    const expiredCa = mintCaWithValidity(new Date(Date.now() - 400 * DAY), new Date(Date.now() - DAY));
    const leaf = createNodeCert(expiredCa, 'node', 'spiffe://thinklocal/node/12D3KooWExpiredCA');
    // Signatur stimmt + Leaf-Fenster ist gültig — nur die CA ist abgelaufen.
    expect(verifyPeerCert(expiredCa.caCertPem, leaf.certPem)).toBe(false);
  });

  it('lehnt ab (fail-closed): NOCH-NICHT-GÜLTIGE CA (notBefore in der Zukunft)', () => {
    const futureCa = mintCaWithValidity(new Date(Date.now() + 10 * DAY), new Date(Date.now() + 400 * DAY));
    const leaf = createNodeCert(futureCa, 'node', 'spiffe://thinklocal/node/12D3KooWFutureCA');
    expect(verifyPeerCert(futureCa.caCertPem, leaf.certPem)).toBe(false);
  });
});

describe('ADR-024 MEDIUM-2 — selectTrustDistributionCa (Trust-Distribution fail-closed)', () => {
  const attestingCa = createMeshCA('thinklocal', 'admin94');
  const ownCa = createMeshCA('thinklocal', 'ownca56');
  // Serving-Cert wie bei einem own-CA-Node, der ein .94-signiertes kanonisches Cert BEHALTEN hat.
  const retainedServing = createNodeCert(attestingCa, 'node', 'spiffe://thinklocal/node/12D3KooWRetained');
  // Serving-Cert wie bei einem normalen Node: von der eigenen CA signiert.
  const ownServing = createNodeCert(ownCa, 'node', 'spiffe://thinklocal/node/12D3KooWOwn');

  it('wählt die Issuer-CA (nicht die eigene CA) für ein behaltenes fremd-signiertes Cert', () => {
    const ca = selectTrustDistributionCa({
      servingCertPem: retainedServing.certPem,
      candidateCaPems: [attestingCa.caCertPem, ownCa.caCertPem],
    });
    expect(ca).toBe(attestingCa.caCertPem);
  });

  it('wählt die eigene CA für ein eigen-signiertes Cert (Legacy-/Default-Fall)', () => {
    const ca = selectTrustDistributionCa({
      servingCertPem: ownServing.certPem,
      candidateCaPems: [undefined, ownCa.caCertPem],
    });
    expect(ca).toBe(ownCa.caCertPem);
  });

  it('überspringt eine nicht-verifizierende erste Kandidaten-CA und nimmt die passende', () => {
    // Reihenfolge bewusst „falsch zuerst": ownCa verifiziert das .94-Cert NICHT → attestingCa gewinnt.
    const ca = selectTrustDistributionCa({
      servingCertPem: retainedServing.certPem,
      candidateCaPems: [ownCa.caCertPem, attestingCa.caCertPem],
    });
    expect(ca).toBe(attestingCa.caCertPem);
  });

  // CR (claude codereviewer): die MEDIUM-1-CA-Gültigkeit auch durch den Distribution-Pfad testen —
  // eine ABGELAUFENE erste Kandidaten-CA muss übersprungen werden (caValid=false in verifyPeerCert).
  it('überspringt eine ABGELAUFENE erste Kandidaten-CA und nimmt die zeitlich gültige zweite', () => {
    const expiredCa = mintCaWithValidity(new Date(Date.now() - 400 * DAY), new Date(Date.now() - DAY));
    const ca = selectTrustDistributionCa({
      servingCertPem: ownServing.certPem,
      candidateCaPems: [expiredCa.caCertPem, ownCa.caCertPem],
    });
    expect(ca).toBe(ownCa.caCertPem);
  });

  it('fail-closed: KEINE Kandidaten-CA verifiziert das Serving-Cert → null', () => {
    const foreign = createMeshCA('thinklocal', 'foreign');
    const ca = selectTrustDistributionCa({
      servingCertPem: retainedServing.certPem,
      candidateCaPems: [ownCa.caCertPem, foreign.caCertPem],
    });
    expect(ca).toBeNull();
  });

  it('fail-closed: fehlendes Serving-Cert (kein tlsBundle) → null', () => {
    expect(selectTrustDistributionCa({ servingCertPem: undefined, candidateCaPems: [attestingCa.caCertPem] })).toBeNull();
  });

  it('fail-closed: nur undefined/leere Kandidaten → null (kein leerer Anker verteilt)', () => {
    const ca = selectTrustDistributionCa({
      servingCertPem: ownServing.certPem,
      candidateCaPems: [undefined, undefined],
    });
    expect(ca).toBeNull();
  });
});
