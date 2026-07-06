// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * mtls-issuer-fingerprint.test.ts — TODO 127(c): dedizierter mTLS-Integrationstest.
 *
 * Sichert die zentrale ADR-022-Invariante mit einem **echten** TLS-Handshake ab (nicht
 * mit synthetischen Fingerprints): der auf der Leitung beobachtete
 * `issuerCertificate.fingerprint256` des präsentierten Node-Certs ist derselbe Wert wie
 * `certFingerprint(ca.crt.pem)` — der Fingerprint, aus dem `resolveAttestingCaFingerprints`
 * den PeerID-Attesting-Pin ableitet (`source: 'derived'`).
 *
 * Warum das nicht trivial ist: Node liefert `fingerprint256` als **Uppercase-Colon-Hex**
 * (`AB:CD:…`), `certFingerprint` als **lowercase-no-colon-hex**. Die Produktionslogik
 * (`normalizeFingerprint` in `peer-identity.ts`/`cert-pop.ts`) rekonziliert beide Formate.
 * Bricht diese Rekonziliation oder die „Single-Mesh-CA + direkte Issuance ⇒ derived == wire"-
 * Annahme, würde die gesamte PeerID-Attestierung (ADR-022 Phase 0) still fehlschlagen —
 * dieser Test macht genau das rot.
 *
 * Der Test exerziert den **Produktionspfad** (`resolveAttestingCaFingerprints` → `isAttestingIssuer`
 * → `attestedPeerIdFromCert`) gegen die Wire-Werte, statt die Gleichheit nur nachzurechnen.
 * Pure-Test, keine Runtime-Änderung.
 */
import { describe, it, expect, afterEach } from 'vitest';
import tls from 'node:tls';
import type { AddressInfo } from 'node:net';
import { createMeshCA, createNodeCert } from './tls.js';
import { certFingerprint, resolveAttestingCaFingerprints } from './cert-issuer.js';
import {
  attestedPeerIdFromCert,
  isAttestingIssuer,
  spiffeUrisFromSubjectAltName,
} from './peer-identity.js';

interface SideResult {
  authorized: boolean;
  cert: tls.DetailedPeerCertificate;
}

const norm = (fp: string): string => fp.replace(/:/g, '').toUpperCase();

describe('127c — mTLS Issuer-Fingerprint-Invariante (realer Handshake)', () => {
  // Eine Mesh-CA (= der invariante Single-CA-Fall) + eine unabhängige CA für die Negativkontrolle.
  const ca = createMeshCA('thinklocal', 'mtls127c');
  const otherCa = createMeshCA('thinklocal', 'other127c');

  const CLIENT_PEERID = '12D3KooWmTLSIntegTest';
  const CLIENT_SPIFFE = `spiffe://thinklocal/node/${CLIENT_PEERID}`; // kanonisch (node/<PeerID>)
  const SERVER_SPIFFE = 'spiffe://thinklocal/host/testserver/agent/claude-code'; // Legacy-Host

  const server = createNodeCert(ca, 'localhost', SERVER_SPIFFE, ['127.0.0.1']);
  const client = createNodeCert(ca, 'localhost', CLIENT_SPIFFE, ['127.0.0.1']);

  // Abgeleiteter Attesting-Pin — GENAU wie index.ts ihn beim Boot bildet (Env ungesetzt → derive).
  const derived = resolveAttestingCaFingerprints(undefined, ca.caCertPem);

  let srv: tls.Server | undefined;
  afterEach(() => {
    srv?.close();
    srv = undefined;
  });

  // Echter mTLS-Handshake: Server verlangt + validiert ein Client-Cert, Client validiert die
  // Server-Chain (rejectUnauthorized bleibt scharf; nur der Hostname-Check ist hier irrelevant,
  // da SPIFFE-SANs). Liefert die von BEIDEN Seiten via getPeerCertificate(true) beobachteten Certs.
  async function handshake(): Promise<{ client: SideResult; server: SideResult }> {
    return new Promise((resolveAll, reject) => {
      let resolveServer!: (r: SideResult) => void;
      let resolveClient!: (r: SideResult) => void;
      const serverSide = new Promise<SideResult>((r) => (resolveServer = r));
      const clientSide = new Promise<SideResult>((r) => (resolveClient = r));

      const s = tls.createServer(
        {
          key: server.keyPem,
          cert: server.certPem,
          ca: ca.caCertPem,
          requestCert: true,
          rejectUnauthorized: true,
        },
        (sock) => {
          resolveServer({ authorized: sock.authorized, cert: sock.getPeerCertificate(true) });
          sock.end();
        },
      );
      srv = s;
      s.on('error', reject);
      s.listen(0, '127.0.0.1', () => {
        const { port } = s.address() as AddressInfo;
        const c = tls.connect(
          {
            host: '127.0.0.1',
            port,
            ca: ca.caCertPem,
            cert: client.certPem,
            key: client.keyPem,
            checkServerIdentity: () => undefined, // Hostname nicht Testgegenstand; Chain bleibt scharf
          },
          () => {
            resolveClient({ authorized: c.authorized, cert: c.getPeerCertificate(true) });
            c.end();
          },
        );
        c.on('error', reject);
      });

      Promise.all([clientSide, serverSide])
        .then(([cl, sv]) => resolveAll({ client: cl, server: sv }))
        .catch(reject);
    });
  }

  it('beide Seiten authorized — reale mTLS-Chain gegen die Mesh-CA validiert', async () => {
    const { client: cl, server: sv } = await handshake();
    expect(cl.authorized).toBe(true);
    expect(sv.authorized).toBe(true);
  });

  it('abgeleiteter Pin ist der certFingerprint(ca.crt.pem) (source=derived)', () => {
    expect(derived.source).toBe('derived');
    expect(derived.fingerprints).toEqual([certFingerprint(ca.caCertPem)]);
  });

  it('Wire-issuerCertificate.fingerprint256 == certFingerprint(ca.crt.pem) (normalisiert)', async () => {
    const { client: cl, server: sv } = await handshake();
    const clientWireIssuer = cl.cert.issuerCertificate?.fingerprint256;
    const serverWireIssuer = sv.cert.issuerCertificate?.fingerprint256;
    expect(clientWireIssuer).toBeTruthy();
    expect(serverWireIssuer).toBeTruthy();
    if (!clientWireIssuer || !serverWireIssuer) throw new Error('kein Wire-Issuer-Fingerprint');
    // Selbst-dokumentierend: die Formate DIVERGIEREN real (Node: Uppercase-Colon-Hex,
    // certFingerprint: lowercase-no-colon) → dieser Test beweist die REKONZILIATION,
    // nicht zufällige Format-Gleichheit. Bricht das, wird die Kern-Assertion unten trivial.
    expect(clientWireIssuer).toContain(':');
    expect(clientWireIssuer).toBe(clientWireIssuer.toUpperCase());
    expect(certFingerprint(ca.caCertPem)).not.toContain(':');
    // Die Kern-Invariante — beide Wire-Werte normalisieren auf den abgeleiteten Pin.
    expect(norm(clientWireIssuer)).toBe(norm(certFingerprint(ca.caCertPem)));
    expect(norm(serverWireIssuer)).toBe(norm(certFingerprint(ca.caCertPem)));
  });

  it('Produktions-Vergleich: isAttestingIssuer(Wire-Issuer, derived-Pin) === true (beide Seiten)', async () => {
    const { client: cl, server: sv } = await handshake();
    // isAttestingIssuer ist der EXAKTE Produktionsvergleich (normalizeFingerprint beidseitig).
    expect(isAttestingIssuer(cl.cert.issuerCertificate?.fingerprint256, derived.fingerprints)).toBe(true);
    expect(isAttestingIssuer(sv.cert.issuerCertificate?.fingerprint256, derived.fingerprints)).toBe(true);
  });

  it('End-to-End: attestedPeerIdFromCert(Wire-SAN, Wire-Issuer, derived-Pin) === Client-PeerID', async () => {
    const { server: sv } = await handshake(); // der Server SIEHT das kanonische Client-Cert
    const certSans = spiffeUrisFromSubjectAltName(sv.cert.subjectaltname); // Produktions-Parser
    const attested = attestedPeerIdFromCert(
      certSans,
      sv.cert.issuerCertificate?.fingerprint256,
      derived.fingerprints,
    );
    expect(attested).toBe(CLIENT_PEERID);
  });

  it('Negativkontrolle: eine FREMDE CA attestiert den Wire-Issuer NICHT (Pin diskriminiert)', async () => {
    const { client: cl } = await handshake();
    const otherPin = resolveAttestingCaFingerprints(undefined, otherCa.caCertPem).fingerprints;
    expect(isAttestingIssuer(cl.cert.issuerCertificate?.fingerprint256, otherPin)).toBe(false);
    // …und ohne attestierenden Issuer gibt es auch keine PeerID (fail-closed).
    const certSans = spiffeUrisFromSubjectAltName(cl.cert.subjectaltname);
    expect(attestedPeerIdFromCert(certSans, cl.cert.issuerCertificate?.fingerprint256, otherPin)).toBe(null);
  });
});
