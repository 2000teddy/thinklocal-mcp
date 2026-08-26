// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * tl14-ceremony-cert-profile.test.ts — TL-14 Zeremonie-Cert-Profil, end-to-end.
 *
 * WARUM DIESER TEST EXISTIERT
 * Alle bisherigen Ketten-Tests (`chain-verify.test.ts`, `tls-transport-pathlen.conformance.test.ts`)
 * minten ihre Zertifikate mit **node-forge** — also mit demselben Werkzeug, das sie anschliessend
 * prueft. Die Offline-Wurzel-Zeremonie aus ADR-045 laeuft aber auf einem Air-Gap-Rechner mit
 * **OpenSSL**. Ob ein von OpenSSL erzeugtes Cert-Profil vom Daemon akzeptiert wird, war damit
 * **ungetestet** — genau die Luecke, die bei TL-14b erst im Fenster aufgefallen waere.
 *
 * Dieser Test schliesst sie: er erzeugt die Kette so, wie das Zeremonie-Skript es tun wuerde
 * (OpenSSL, echte CSR/Signatur-Schritte), und prueft sie mit der **echten** Daemon-Funktion
 * `verifyPeerCertChain`.
 *
 * WAS ER FESTNAGELT — das **korrigierte** D2 (ADR-045, Stand 2026-08-26):
 * **Root `pathLen 1` + Intermediate `pathLen 0`.** Nach RFC 5280 §4.2.1.9 ist `pathLenConstraint`
 * die maximale Anzahl NICHT-selbst-ausgestellter Zwischen-CAs, die dem Zertifikat im Pfad
 * **folgen** duerfen. `Root pathLen 1` erlaubt damit genau eine Zwischenstufe; `Intermediate
 * pathLen 0` verbietet TH01/TH02 jede Sub-CA — das Schutzziel „exakt zwei Stufen" bleibt intakt.
 *
 * HISTORIE: Die Erstfassung von D2 schrieb **`Root pathLen 0`** vor. Das erlaubt **kein einziges**
 * Intermediate und haette die Zielhierarchie unverifizierbar gemacht (jedes Node-Cert mesh-weit
 * ungueltig). Entdeckt beim Zeremonie-Skript-Slice, korrigiert per Owner-Freigabe (Option A) am
 * 2026-08-26 — Analyse: `docs/architecture/TL-14a-D2-pathlen-blocker.md`. Der zweite Test unten
 * haelt die falsche Variante als **Regressionsschutz** fest: faellt sie je wieder in die Zeremonie
 * zurueck, schlaegt er an.
 *
 * Der Test ist **read-only** gegenueber dem Repo und dem Daemon-State: er arbeitet ausschliesslich
 * in einem temporaeren Verzeichnis und faesst keine echten CA-Dateien an.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { verifyPeerCertChain } from '../../packages/daemon/src/tls.js';
import { certFingerprint } from '../../packages/daemon/src/cert-issuer.js';

const LEAF_SPIFFE = 'spiffe://thinklocal/node/12D3KooWTestPeerIdForCeremonyProfile';

function hasOpenssl(): boolean {
  try {
    execFileSync('openssl', ['version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

const OPENSSL = hasOpenssl();

/** Fuehrt openssl aus; stderr wird verworfen (openssl schreibt Fortschritts-Punkte dorthin). */
function ssl(dir: string, args: string[]): void {
  execFileSync('openssl', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * Baut eine vollstaendige Kette exakt so, wie die Zeremonie es taete:
 * self-signed Root -> CSR fuer das Intermediate -> Root signiert das Intermediate ->
 * CSR fuer das Leaf -> Intermediate signiert das Leaf (mit SPIFFE-SAN).
 * `rootPathLen` ist der einzige Parameter, der zwischen den Varianten variiert.
 */
function buildChain(dir: string, tag: string, rootPathLen: number) {
  ssl(dir, [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', `root-${tag}.key`, '-out', `root-${tag}.crt`,
    '-days', '3650', '-subj', `/CN=TL14 Test Root ${tag}/O=thinklocal-mcp`,
    '-addext', `basicConstraints=critical,CA:TRUE,pathlen:${rootPathLen}`,
    '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
  ]);

  ssl(dir, [
    'req', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', `inter-${tag}.key`, '-out', `inter-${tag}.csr`,
    '-subj', `/CN=TL14 Test Intermediate ${tag}/O=thinklocal-mcp`,
  ]);
  writeFileSync(
    join(dir, `inter-${tag}.ext`),
    'basicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\n',
  );
  ssl(dir, [
    'x509', '-req', '-in', `inter-${tag}.csr`,
    '-CA', `root-${tag}.crt`, '-CAkey', `root-${tag}.key`, '-CAcreateserial',
    '-out', `inter-${tag}.crt`, '-days', '730', // 730 Tage = D3-Beschluss (24 Monate)
    '-extfile', `inter-${tag}.ext`,
  ]);

  ssl(dir, [
    'req', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', `leaf-${tag}.key`, '-out', `leaf-${tag}.csr`,
    '-subj', `/CN=tl14-test-node/O=thinklocal-mcp`,
  ]);
  writeFileSync(
    join(dir, `leaf-${tag}.ext`),
    `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nsubjectAltName=URI:${LEAF_SPIFFE}\n`,
  );
  ssl(dir, [
    'x509', '-req', '-in', `leaf-${tag}.csr`,
    '-CA', `inter-${tag}.crt`, '-CAkey', `inter-${tag}.key`, '-CAcreateserial',
    '-out', `leaf-${tag}.crt`, '-days', '90',
    '-extfile', `leaf-${tag}.ext`,
  ]);

  const read = (f: string) => readFileSync(join(dir, f), 'utf-8');
  return {
    rootPem: read(`root-${tag}.crt`),
    interPem: read(`inter-${tag}.crt`),
    leafPem: read(`leaf-${tag}.crt`),
  };
}

describe.skipIf(!OPENSSL)('TL-14 Zeremonie-Cert-Profil (OpenSSL) gegen den echten Daemon-Verify', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'tl14-ceremony-'));
  });
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('D2-Profil (Root pathLen 1 + Intermediate pathLen 0) wird von verifyPeerCertChain AKZEPTIERT', () => {
    const { rootPem, interPem, leafPem } = buildChain(dir, 'p1', 1);
    // Kette ist leaf-first, der Anker (Root) wird separat uebergeben — wie im Produktivpfad.
    expect(verifyPeerCertChain([rootPem], [leafPem, interPem])).toBe(true);
  });

  it('REGRESSION: Root pathLen 0 (die korrigierte D2-Erstfassung) wird ABGELEHNT', () => {
    const { rootPem, interPem, leafPem } = buildChain(dir, 'p0', 0);
    // Kryptografisch lueckenlos signiert; die EINZIGE Abweichung zum Test darueber ist der
    // pathLen der Root. Ablehnung ⇒ mit `Root pathLen 0` waere kein Node-Cert mesh-weit gueltig.
    // Dieser Test ist der Regressionsschutz gegen einen Rueckfall in die falsche Kodierung.
    expect(verifyPeerCertChain([rootPem], [leafPem, interPem])).toBe(false);
  });

  it('Das Intermediate darf weiterhin KEINE Sub-CA ausstellen (D2-Schutzziel bleibt bei Root pathLen 1 intakt)', () => {
    const { rootPem, interPem } = buildChain(dir, 'subca', 1);
    // Eine vom Intermediate (pathlen:0) signierte Sub-CA + darunter ein Leaf.
    ssl(dir, [
      'req', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', 'subca.key', '-out', 'subca.csr',
      '-subj', '/CN=TL14 FORBIDDEN Sub-CA/O=thinklocal-mcp',
    ]);
    writeFileSync(
      join(dir, 'subca.ext'),
      'basicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\n',
    );
    ssl(dir, [
      'x509', '-req', '-in', 'subca.csr',
      '-CA', 'inter-subca.crt', '-CAkey', 'inter-subca.key', '-CAcreateserial',
      '-out', 'subca.crt', '-days', '365', '-extfile', 'subca.ext',
    ]);
    ssl(dir, [
      'req', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', 'subleaf.key', '-out', 'subleaf.csr', '-subj', '/CN=tl14-subleaf/O=thinklocal-mcp',
    ]);
    writeFileSync(join(dir, 'subleaf.ext'), 'basicConstraints=critical,CA:FALSE\n');
    ssl(dir, [
      'x509', '-req', '-in', 'subleaf.csr',
      '-CA', 'subca.crt', '-CAkey', 'subca.key', '-CAcreateserial',
      '-out', 'subleaf.crt', '-days', '90', '-extfile', 'subleaf.ext',
    ]);
    const subCaPem = readFileSync(join(dir, 'subca.crt'), 'utf-8');
    const subLeafPem = readFileSync(join(dir, 'subleaf.crt'), 'utf-8');
    expect(verifyPeerCertChain([rootPem], [subLeafPem, subCaPem, interPem])).toBe(false);
  });

  it('certFingerprint stimmt mit dem OpenSSL-DER-SHA256 ueberein (Pin-Kompatibilitaet fuer D4)', () => {
    // Der Doppel-Pin-Cutover (D4) vergleicht Fingerprints, die der Zeremonie-Rechner mit OpenSSL
    // erzeugt, gegen die, die der Daemon berechnet. Weichen die Formate ab, pinnt man ins Leere.
    const { rootPem } = buildChain(dir, 'fp', 1);
    const der = execFileSync('openssl', ['x509', '-outform', 'DER'], {
      cwd: dir,
      input: rootPem,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const opensslHex = createHash('sha256').update(der).digest('hex');
    expect(certFingerprint(rootPem)).toBe(opensslHex);
    expect(opensslHex).toMatch(/^[0-9a-f]{64}$/); // lowercase hex, keine Doppelpunkte
  });
});
