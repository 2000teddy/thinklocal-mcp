// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * tls-transport-pathlen.conformance.test.ts — ADR-045 Vorbedingung A, **Transport-Ebene** (echter mTLS-Handshake).
 *
 * WELCHE LÜCKE DIESE DATEI SCHLIESST
 * ----------------------------------
 * ADR-045 §77 (Vorbedingung A) verlangt einen Test des `pathLen`-Verhaltens **auf der Transport-Ebene** —
 * die App-Ebene ist über `verifyPeerCertChain` bereits abgedeckt (`chain-verify.test.ts`), aber ADR-045 hält
 * fest: die Transport-mTLS (`agent-card.ts:225-231`) „würde via Node-TLS prüfen, ist aber … für zwei Stufen
 * **ungetestet**", und „D2 auf App-Pfad **kosmetisch**". Diese Datei testet das mit einem **echten
 * Node-TLS-Handshake** (`requestCert`+`rejectUnauthorized`, dieselben Flags wie der cardServer).
 *
 * BEFUND (empirisch, reproduzierbar): **Node-TLS erzwingt `pathLenConstraint` in dieser mTLS-Konfiguration
 * NICHT.** Eine Client-Kette, die eine `pathLen 0`-Root über ein Intermediate verlängert (und sogar der Fall
 * Intermediate-`pathLen 0` → Sub-CA), wird beim Handshake **akzeptiert**. Die Positiv-Kontrolle (`pathLen 1`,
 * gleiche zweistufige Form) beweist, dass die Kette real durchs Intermediate gebaut wird — die Akzeptanz oben
 * ist also **kein** Harness-Fehler, sondern fehlendes pathLen-Enforcement am Transport.
 *
 * KONSEQUENZ (das ist der Punkt von Vorbedingung A): Zwei-Stufen-Trust-Entscheidungen dürfen sich **nicht**
 * auf die Transport-mTLS verlassen — die `pathLen`-Wirksamkeit (D2/D4) hängt an der **App-Ebene**
 * `verifyPeerCertChain` (forge, enforced — siehe Kontrast-Assertion unten + `chain-verify.test.ts`). Dieser
 * Test macht die Lücke **regressionsfest** und begründet, warum A ein blockierender Vorlauf ist. Test-only,
 * keine Verdrahtung, keine Produktionsänderung. Nimmt D3/ADR-Status/TL-14b NICHT vorweg.
 */
import { describe, it, expect, afterEach } from 'vitest';
import tls from 'node:tls';
import type { AddressInfo } from 'node:net';
import forge from 'node-forge';
import { createNodeCert, verifyPeerCertChain, type CaBundle } from './tls.js';

/** Mintet eine CA (`cA:true`) mit explizitem `pathLenConstraint`. `issuer===null` ⇒ self-signed Root. */
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
  cert.setExtensions([
    { name: 'basicConstraints', cA: true, critical: true, pathLenConstraint: pathLen },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    { name: 'subjectKeyIdentifier' },
  ]);
  if (issuer) {
    cert.setIssuer(forge.pki.certificateFromPem(issuer.caCertPem).subject.attributes);
    cert.sign(forge.pki.privateKeyFromPem(issuer.caKeyPem), forge.md.sha256.create());
  } else {
    cert.setIssuer(subject);
    cert.sign(keys.privateKey, forge.md.sha256.create());
  }
  return { caCertPem: forge.pki.certificateToPem(cert), caKeyPem: forge.pki.privateKeyToPem(keys.privateKey) };
}

const SRV_SPIFFE = 'spiffe://thinklocal/host/pathlen-srv/agent/claude-code';
const CLI_SPIFFE = 'spiffe://thinklocal/node/12D3KooPathLenClient';

let srv: tls.Server | undefined;
afterEach(() => {
  srv?.close();
  srv = undefined;
});

/**
 * Echter mTLS-Handshake mit `requestCert`+`rejectUnauthorized` (wie der cardServer). Server vertraut
 * `rootPem`; Client präsentiert `clientChainPem` (Leaf [+Intermediate…] konkateniert).
 * ⇒ `'authorized'` (Server akzeptiert die Client-Kette) oder `'rejected'` (Handshake-/Client-Cert-Reject).
 */
function attempt(
  rootPem: string,
  serverBundle: { certPem: string; keyPem: string },
  clientChainPem: string,
  clientKeyPem: string,
): Promise<'authorized' | 'rejected'> {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (r: 'authorized' | 'rejected'): void => {
      if (done) return;
      done = true;
      resolve(r);
    };
    const s = tls.createServer(
      {
        key: serverBundle.keyPem,
        cert: serverBundle.certPem,
        ca: rootPem,
        requestCert: true,
        rejectUnauthorized: true,
      },
      (sock) => {
        finish(sock.authorized ? 'authorized' : 'rejected');
        sock.end();
      },
    );
    srv = s;
    s.on('tlsClientError', () => finish('rejected'));
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as AddressInfo;
      const c = tls.connect(
        {
          host: '127.0.0.1',
          port,
          ca: rootPem,
          cert: clientChainPem,
          key: clientKeyPem,
          checkServerIdentity: () => undefined, // Hostname nicht Testgegenstand; Chain bleibt scharf
        },
        () => {
          finish('authorized');
          c.end();
        },
      );
      c.on('error', () => finish('rejected'));
    });
  });
}

describe('ADR-045 Vorbedingung A — pathLen am Transport (echter mTLS-Handshake)', () => {
  it('BEFUND: Root(pathLen 0) → Intermediate → Leaf wird am Transport AKZEPTIERT (kein pathLen-Enforcement)', async () => {
    const root = mintCA(null, 'thinklocal Root pathlen0 transport', 0); // 0 ⇒ dürfte KEIN Intermediate erlauben
    const inter = mintCA(root, 'thinklocal Intermediate transport', 0);
    const serverLeaf = createNodeCert(root, 'localhost', SRV_SPIFFE, ['127.0.0.1']);
    const clientLeaf = createNodeCert(inter, 'localhost', CLI_SPIFFE, ['127.0.0.1']);
    const clientChain = clientLeaf.certPem + '\n' + inter.caCertPem;

    // Der Transport erzwingt pathLen NICHT → die pathLen-verletzende Kette wird akzeptiert.
    expect(await attempt(root.caCertPem, serverLeaf, clientChain, clientLeaf.keyPem)).toBe('authorized');
  });

  it('BEFUND: sogar Root(pathLen 2) → Intermediate(pathLen 0) → Sub-CA → Leaf wird AKZEPTIERT', async () => {
    const root = mintCA(null, 'thinklocal Root p2', 2);
    const inter = mintCA(root, 'thinklocal Intermediate p0', 0); // pathLen 0 ⇒ dürfte KEINE Sub-CA erlauben
    const sub = mintCA(inter, 'thinklocal Sub-CA', 0);
    const serverLeaf = createNodeCert(root, 'localhost', SRV_SPIFFE, ['127.0.0.1']);
    const clientLeaf = createNodeCert(sub, 'localhost', CLI_SPIFFE, ['127.0.0.1']);
    const clientChain = clientLeaf.certPem + '\n' + sub.caCertPem + '\n' + inter.caCertPem;

    expect(await attempt(root.caCertPem, serverLeaf, clientChain, clientLeaf.keyPem)).toBe('authorized');
  });

  it('KONTROLLE: Root(pathLen 1) → Intermediate → Leaf wird AKZEPTIERT (die zweistufige Kette baut real durch)', async () => {
    // Beweist, dass die Akzeptanz oben NICHT ein Kettenbau-Fehler ist: dieselbe Form mit pathLen 1 ist legitim.
    const root = mintCA(null, 'thinklocal Root p1', 1);
    const inter = mintCA(root, 'thinklocal Intermediate p1ok', 0);
    const serverLeaf = createNodeCert(root, 'localhost', SRV_SPIFFE, ['127.0.0.1']);
    const clientLeaf = createNodeCert(inter, 'localhost', CLI_SPIFFE, ['127.0.0.1']);
    const clientChain = clientLeaf.certPem + '\n' + inter.caCertPem;

    expect(await attempt(root.caCertPem, serverLeaf, clientChain, clientLeaf.keyPem)).toBe('authorized');
  });

  it('KONTRAST: dieselbe pathLen-0-Verletzung wird von der App-Ebene `verifyPeerCertChain` ABGELEHNT', () => {
    // Das ist der Kern von Vorbedingung A: die pathLen-Wirksamkeit (D2/D4) ruht auf der App-Ebene, NICHT
    // auf der Transport-mTLS. forge enforced pathLen — Node-TLS (oben) nicht.
    const root = mintCA(null, 'thinklocal Root contrast p0', 0);
    const inter = mintCA(root, 'thinklocal Intermediate contrast', 0);
    const clientLeaf = createNodeCert(inter, 'localhost', CLI_SPIFFE, ['127.0.0.1']);

    expect(verifyPeerCertChain([root.caCertPem], [clientLeaf.certPem, inter.caCertPem])).toBe(false);
    // Positiv-Gegenprobe: unter pathLen 1 akzeptiert auch die App-Ebene dieselbe Kettenform.
    const root1 = mintCA(null, 'thinklocal Root contrast p1', 1);
    const inter1 = mintCA(root1, 'thinklocal Intermediate contrast1', 0);
    const leaf1 = createNodeCert(inter1, 'localhost', CLI_SPIFFE, ['127.0.0.1']);
    expect(verifyPeerCertChain([root1.caCertPem], [leaf1.certPem, inter1.caCertPem])).toBe(true);
  });
});
