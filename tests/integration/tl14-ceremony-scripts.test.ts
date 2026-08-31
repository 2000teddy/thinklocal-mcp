// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * tl14-ceremony-scripts.test.ts — die ECHTEN TL-14-Zeremonie-Skripte, end-to-end.
 *
 * WARUM DIESER TEST EXISTIERT
 * `tl14-ceremony-cert-profile.test.ts` (#354) beweist, dass ein OpenSSL-erzeugtes D2-Profil vom
 * Daemon akzeptiert wird — aber es baut die Kette mit **eigenen, im Test formulierten**
 * OpenSSL-Aufrufen. Ob die tatsaechlich ausgelieferten Skripte in `scripts/tl14-ca/` dasselbe
 * Profil erzeugen, war damit weiterhin ungetestet: eine Abweichung zwischen Testprosa und
 * Zeremonie-Skript waere erst im Wartungsfenster aufgefallen.
 *
 * Dieser Test schliesst die Luecke: er ruft die **echten Skripte** auf (Root-Zeremonie ->
 * Intermediate-CSR -> Signatur -> Verifikation) und prueft das Ergebnis mit der **echten**
 * Daemon-Funktion `verifyPeerCertChain`.
 *
 * Zusaetzlich nagelt er die beiden Befunde fest, an denen der Umzug operativ haengt
 * (RUNBOOK-TL-14-ca-ceremony.md §1):
 *   F2/F4 — gepinnt werden muss das **Intermediate**, nicht die Root. Mit dem Intermediate als
 *           Anker verifiziert die einelementige Kette aus `tls.ts:392` OHNE Codeaenderung;
 *           mit der Root als Anker scheitert sie.
 *   F3   — der vom Skript ausgegebene Fingerprint ist bitgleich mit `certFingerprint()` und
 *           damit direkt als `TLMCP_PEERID_ATTESTING_CA_FP` verwendbar.
 *
 * Der Test ist read-only gegenueber Repo und Daemon-State: er arbeitet ausschliesslich in einem
 * temporaeren Verzeichnis und fasst keine echten CA-Dateien an.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyPeerCertChain } from '../../packages/daemon/src/tls.js';
import { certFingerprint } from '../../packages/daemon/src/cert-issuer.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SCRIPTS = resolve(HERE, '../../scripts/tl14-ca');
const LEAF_SPIFFE = 'spiffe://thinklocal/node/12D3KooWTestPeerIdForCeremonyScripts';

function hasOpenssl(): boolean {
  try {
    execFileSync('openssl', ['version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}
const OPENSSL = hasOpenssl();

/** Fuehrt ein Zeremonie-Skript aus und liefert Exit-Code + kombinierte Ausgabe. */
function runScript(script: string, args: string[]): { code: number; out: string } {
  const r = spawnSync('bash', [join(SCRIPTS, script), ...args], { encoding: 'utf-8' });
  return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** basicConstraints-Zeile eines Certs, Leerzeichen entfernt (z.B. "CA:TRUE,pathlen:1"). */
function basicConstraints(certPath: string): string {
  const text = execFileSync('openssl', ['x509', '-in', certPath, '-noout', '-text'], {
    encoding: 'utf-8',
  });
  const lines = text.split('\n');
  const idx = lines.findIndex((l) => l.includes('X509v3 Basic Constraints'));
  return idx >= 0 ? (lines[idx + 1] ?? '').replace(/\s/g, '') : '';
}

describe.skipIf(!OPENSSL)('TL-14 Zeremonie-Skripte (scripts/tl14-ca) end-to-end', () => {
  let dir: string;
  let rootDir: string;
  let intDir: string;
  let rootCrt: string;
  let interCrt: string;
  let leafCrt: string;
  let signOut: string;
  let passFile: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'tl14-scripts-'));
    rootDir = join(dir, 'root');
    intDir = join(dir, 'th01');
    rootCrt = join(rootDir, 'root.crt.pem');
    interCrt = join(intDir, 'intermediate.crt.pem');
    leafCrt = join(dir, 'leaf.crt.pem');
    // Nur fuer den automatisierten Lauf — in der echten Zeremonie fragt openssl interaktiv.
    passFile = join(dir, 'pass.txt');
    writeFileSync(passFile, 'tl14-test-passphrase-not-a-secret\n');

    // Schritt 2 — Offline-Wurzel.
    const r1 = runScript('tl14-ceremony-root.sh', ['--out', rootDir, '--passphrase-file', passFile]);
    expect(r1.code, r1.out).toBe(0);

    // Schritt 3a — Intermediate-Keypair + CSR auf dem Zielhost.
    const r2 = runScript('tl14-ceremony-intermediate-csr.sh', [
      '--out', intDir, '--cn', 'ThinkLocal Intermediate CA TH01',
    ]);
    expect(r2.code, r2.out).toBe(0);

    // Schritt 3b — Signatur auf dem Air-Gap-Rechner.
    const r3 = runScript('tl14-ceremony-sign-intermediate.sh', [
      '--root-dir', rootDir,
      '--csr', join(intDir, 'intermediate.csr.pem'),
      '--out', interCrt,
      '--passphrase-file', passFile,
    ]);
    expect(r3.code, r3.out).toBe(0);
    signOut = r3.out;

    // Ein Node-Leaf, wie cert-issuer es ausstellen wuerde: vom Intermediate signiert,
    // kanonische node/<PeerID>-SAN.
    execFileSync('openssl', [
      'req', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', join(dir, 'leaf.key.pem'), '-out', join(dir, 'leaf.csr.pem'),
      '-subj', '/CN=tl14-script-node/O=thinklocal-mcp',
    ], { cwd: dir, stdio: 'pipe' });
    writeFileSync(
      join(dir, 'leaf.ext'),
      `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nsubjectAltName=URI:${LEAF_SPIFFE}\n`,
    );
    execFileSync('openssl', [
      'x509', '-req', '-in', join(dir, 'leaf.csr.pem'),
      '-CA', interCrt, '-CAkey', join(intDir, 'intermediate.key.pem'), '-CAcreateserial',
      '-out', leafCrt, '-days', '90', '-extfile', join(dir, 'leaf.ext'),
    ], { cwd: dir, stdio: 'pipe' });
  }, 180_000);

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('erzeugt eine Kette, die der echte Daemon-Verify (verifyPeerCertChain) AKZEPTIERT', () => {
    const rootPem = readFileSync(rootCrt, 'utf-8');
    const interPem = readFileSync(interCrt, 'utf-8');
    const leafPem = readFileSync(leafCrt, 'utf-8');
    // Kette leaf-first, Anker separat — wie im Produktivpfad.
    expect(verifyPeerCertChain([rootPem], [leafPem, interPem])).toBe(true);
  });

  it('schreibt das ADR-045-D2-Profil: Root pathlen:1, Intermediate pathlen:0', () => {
    expect(basicConstraints(rootCrt)).toContain('CA:TRUE');
    expect(basicConstraints(rootCrt)).toContain('pathlen:1');
    expect(basicConstraints(interCrt)).toContain('CA:TRUE');
    expect(basicConstraints(interCrt)).toContain('pathlen:0');
  });

  it('F4: mit dem INTERMEDIATE als Anker verifiziert die einelementige Kette aus tls.ts:392', () => {
    // Genau die Form, die verifyCanonicalNodeCert benutzt: verifyPeerCertChain(pins, [certPem]).
    // Das ist der Grund, warum der Intermediate-Pin ohne Codeaenderung funktioniert.
    const interPem = readFileSync(interCrt, 'utf-8');
    const leafPem = readFileSync(leafCrt, 'utf-8');
    expect(verifyPeerCertChain([interPem], [leafPem])).toBe(true);
  });

  it('F2: mit der ROOT als Anker scheitert dieselbe einelementige Kette (Root-Pin waere falsch)', () => {
    // Belegt den Runbook-Befund F2: ein reiner Root-Pin laesst jeden kanonischen Sender
    // durchfallen, weil das Intermediate in der einelementigen Kette fehlt.
    const rootPem = readFileSync(rootCrt, 'utf-8');
    const leafPem = readFileSync(leafCrt, 'utf-8');
    expect(verifyPeerCertChain([rootPem], [leafPem])).toBe(false);
  });

  it('F3: der vom Skript ausgegebene Fingerprint ist als Pin-Wert verwendbar (== certFingerprint)', () => {
    const interPem = readFileSync(interCrt, 'utf-8');
    const expected = certFingerprint(interPem);
    expect(expected).toMatch(/^[0-9a-f]{64}$/);
    // Das Signier-Skript druckt genau diesen Wert als TLMCP_PEERID_ATTESTING_CA_FP.
    expect(signOut).toContain(expected);
  });

  it('tl14-verify-chain.sh besteht alle vier Pruefungen (Exit 0)', () => {
    const r = runScript('tl14-verify-chain.sh', [
      '--root', rootCrt, '--intermediate', interCrt, '--leaf', leafCrt,
    ]);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain('alle Prüfungen bestanden');
    expect(r.out).not.toContain('[FEHLER]');
  });

  it('tl14-verify-chain.sh schlaegt fehl, wenn das Leaf nicht zur Kette gehoert', () => {
    // Negativ-Kontrolle: ohne sie wuerde ein Skript, das immer Exit 0 liefert, gruen aussehen.
    const r = runScript('tl14-verify-chain.sh', [
      '--root', rootCrt, '--intermediate', interCrt, '--leaf', rootCrt,
    ]);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('[FEHLER]');
  });

  it('GUARD: die Root-Zeremonie ueberschreibt vorhandenes Schluesselmaterial NIEMALS', () => {
    const before = readFileSync(join(rootDir, 'root.key.pem'), 'utf-8');
    const r = runScript('tl14-ceremony-root.sh', ['--out', rootDir]);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('existiert bereits');
    // Der entscheidende Teil: der Key ist unveraendert. Ein neu erzeugter Root-Key haette die
    // gesamte Hierarchie darunter entwertet.
    expect(readFileSync(join(rootDir, 'root.key.pem'), 'utf-8')).toBe(before);
  });

  it('GUARD: eine Root-Laufzeit ausserhalb des ADR-045-Korridors wird abgelehnt', () => {
    const out = join(dir, 'root-bad');
    const r = runScript('tl14-ceremony-root.sh', ['--out', out, '--days', '100']);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('Korridor');
    expect(existsSync(join(out, 'root.key.pem'))).toBe(false);
  });

  it('GUARD: eine Intermediate-Laufzeit ausserhalb des D3-Korridors wird abgelehnt', () => {
    const r = runScript('tl14-ceremony-sign-intermediate.sh', [
      '--root-dir', rootDir,
      '--csr', join(intDir, 'intermediate.csr.pem'),
      '--out', join(dir, 'inter-bad.crt.pem'),
      '--days', '3650',
      '--passphrase-file', passFile,
    ]);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('Korridor');
    expect(existsSync(join(dir, 'inter-bad.crt.pem'))).toBe(false);
  });

  // ————— Regressionen zu den CR-Findings vom 2026-08-31 (agy/Gemini) —————

  it('CR-CRITICAL: der Offline-Root-Key ist passphrase-verschluesselt, nicht Klartext', () => {
    // Dateirechte schuetzen gegen den Nachbar-Account, nicht gegen Medienverlust. Ein
    // entwendeter Air-Gap-Stick mit Klartext-Root-Key kompromittiert die gesamte PKI.
    const key = readFileSync(join(rootDir, 'root.key.pem'), 'utf-8');
    expect(key).toContain('ENCRYPTED');
    expect(key).not.toContain('BEGIN PRIVATE KEY');
  });

  it('CR-CRITICAL: das Profil-Pattern akzeptiert pathlen:10 NICHT (kein Wildcard-Suffix)', () => {
    // '*pathlen:1*' haette 'pathlen:10' durchgewinkt — ein fundamentaler Profil-Fehler waere
    // stillschweigend als gruen gemeldet worden.
    const bad = join(dir, 'root-p10.crt.pem');
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', join(dir, 'root-p10.key.pem'), '-out', bad,
      '-days', '30', '-subj', '/CN=TL14 p10/O=thinklocal-mcp',
      '-addext', 'basicConstraints=critical,CA:TRUE,pathlen:10',
      '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
    ], { cwd: dir, stdio: 'pipe' });

    const r = runScript('tl14-verify-chain.sh', [
      '--root', bad, '--intermediate', interCrt, '--leaf', leafCrt,
    ]);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('pathlen:10');
  });

  it('CR-HIGH: ein Cert ohne basicConstraints wird GEMELDET, nicht stumm abgebrochen', () => {
    // `grep` liefert bei fehlender Extension Exit 1; unter pipefail+set -e starb das Skript
    // frueher kommentarlos — ausgerechnet in dem Fall, den der Guard sichtbar machen soll.
    // Ein Cert OHNE basicConstraints entsteht ueber den x509-req-Pfad mit einer extfile, die
    // die Extension schlicht nicht enthaelt (`req -x509` wuerde sie in OpenSSL 3 selbst setzen).
    const noBc = join(dir, 'no-bc.crt.pem');
    execFileSync('openssl', [
      'req', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', join(dir, 'no-bc.key.pem'), '-out', join(dir, 'no-bc.csr.pem'),
      '-subj', '/CN=TL14 nobc/O=thinklocal-mcp',
    ], { cwd: dir, stdio: 'pipe' });
    writeFileSync(join(dir, 'no-bc.ext'), 'keyUsage=critical,keyCertSign,cRLSign\n');
    execFileSync('openssl', [
      'x509', '-req', '-in', join(dir, 'no-bc.csr.pem'),
      '-CA', interCrt, '-CAkey', join(intDir, 'intermediate.key.pem'), '-CAcreateserial',
      '-out', noBc, '-days', '30', '-extfile', join(dir, 'no-bc.ext'),
    ], { cwd: dir, stdio: 'pipe' });
    // Vorbedingung des Tests: die Extension fehlt wirklich.
    const noBcText = execFileSync('openssl', ['x509', '-in', noBc, '-noout', '-text'], {
      encoding: 'utf-8',
    });
    expect(noBcText).not.toContain('X509v3 Basic Constraints');

    const r = runScript('tl14-verify-chain.sh', [
      '--root', noBc, '--intermediate', interCrt, '--leaf', leafCrt,
    ]);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('[FEHLER]');
    expect(r.out).toContain('2a. Root-Profil'); // der Guard lief, statt vorher zu sterben
  });

  it('CR-MEDIUM: ein Intermediate, das die Root ueberleben wuerde, wird fail-closed abgelehnt', () => {
    // Portabel via `openssl x509 -checkend` statt GNU-`date`; die frueher Variante haette auf
    // macOS nur gewarnt und trotzdem signiert.
    const shortRoot = join(dir, 'shortroot');
    execFileSync('mkdir', ['-p', shortRoot]);
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', join(shortRoot, 'root.key.pem'), '-out', join(shortRoot, 'root.crt.pem'),
      '-days', '30', '-subj', '/CN=TL14 Kurz-Root/O=thinklocal-mcp',
      '-addext', 'basicConstraints=critical,CA:TRUE,pathlen:1',
      '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
    ], { cwd: dir, stdio: 'pipe' });

    const r = runScript('tl14-ceremony-sign-intermediate.sh', [
      '--root-dir', shortRoot,
      '--csr', join(intDir, 'intermediate.csr.pem'),
      '--out', join(dir, 'inter-outlives.crt.pem'),
    ]);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('überleben');
    expect(existsSync(join(dir, 'inter-outlives.crt.pem'))).toBe(false);
  });

  it('CR-LOW: ein CN mit Schraegstrich wird abgelehnt (OpenSSL-DN-Feldtrenner)', () => {
    const r = runScript('tl14-ceremony-intermediate-csr.sh', [
      '--out', join(dir, 'cn-slash'), '--cn', 'ThinkLocal / Intermediate',
    ]);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('Schrägstrich');
    expect(existsSync(join(dir, 'cn-slash', 'intermediate.key.pem'))).toBe(false);
  });

  it('CR-NIT: eine Tagesangabe mit fuehrender Null wird sauber abgelehnt (keine Oktal-Falle)', () => {
    const r = runScript('tl14-ceremony-root.sh', [
      '--out', join(dir, 'root-octal'), '--days', '0800', '--passphrase-file', passFile,
    ]);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('führende Null');
    expect(r.out).not.toContain('value too great for base');
  });

  it('TH02-Variante: --encrypt-key erzeugt einen verschluesselten Reserve-Key', () => {
    // Fuer die kalte Reserve (D6) ist die Passphrase der eigentliche Schutz — der Key wird nie
    // von einem Daemon geladen. Fuer TH01 gilt bewusst das Gegenteil (siehe Skript-Kommentar).
    const th02 = join(dir, 'th02');
    const r = runScript('tl14-ceremony-intermediate-csr.sh', [
      '--out', th02, '--cn', 'ThinkLocal Intermediate CA TH02',
      '--encrypt-key', '--passphrase-file', passFile,
    ]);
    expect(r.code, r.out).toBe(0);
    expect(readFileSync(join(th02, 'intermediate.key.pem'), 'utf-8')).toContain('ENCRYPTED');
  });

  it('GUARD: eine CSR mit gebrochener Selbstsignatur wird NICHT signiert', () => {
    // Eine CSR ohne gueltige Selbstsignatur belegt keinen Schluesselbesitz — die Root wuerde
    // einen fremden Public-Key beglaubigen.
    //
    // Die Korruption passiert auf BYTE-Ebene im DER (ein Byte mitten in der Signatur), nicht
    // auf Base64-Textebene: ein einzelnes gekipptes Base64-Zeichen laesst `openssl req -verify`
    // erwiesenermassen noch passieren, und ein Guard, der an einem zu schwachen Angriff
    // getestet wird, ist kein Guard.
    const good = readFileSync(join(intDir, 'intermediate.csr.pem'), 'utf-8');
    const lines = good.trim().split('\n');
    const der = Buffer.from(lines.slice(1, -1).join(''), 'base64');
    der[der.length - 20] ^= 0xff; // Signatur-Bytes liegen am Ende des DER
    const b64 = der.toString('base64').replace(/(.{64})/g, '$1\n');
    const badCsr = join(dir, 'bad.csr.pem');
    writeFileSync(badCsr, `${lines[0]}\n${b64}\n${lines[lines.length - 1]}\n`);

    // Vorbedingung des Tests: OpenSSL meldet den Fehlschlag NUR im Text und liefert Exit 0
    // (verifiziert an 3.0.13). Der Guard darf sich deshalb nicht auf den Exit-Code stuetzen.
    const verdict = spawnSync('openssl', ['req', '-in', badCsr, '-noout', '-verify'], {
      encoding: 'utf-8',
    });
    expect(`${verdict.stdout}${verdict.stderr}`).not.toContain('verify OK');

    const r = runScript('tl14-ceremony-sign-intermediate.sh', [
      '--root-dir', rootDir, '--csr', badCsr, '--out', join(dir, 'inter-badcsr.crt.pem'),
    ]);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('CSR-Selbstsignatur ungültig');
    expect(existsSync(join(dir, 'inter-badcsr.crt.pem'))).toBe(false);
  });

  it('GUARD: ein Fehlschlag beim Signieren bricht MIT Fehlertext ab, nicht stumm', () => {
    // Regression zum Befund aus diesem Slice: `openssl ... 2>/dev/null` liess das Skript unter
    // `set -e` mit Exit 1 und OHNE jede Ausgabe enden — in einer Zeremonie die schlechteste
    // Fehlerform, weil der Operator nur sieht, dass nichts passiert ist.
    const brokenRoot = join(dir, 'broken-root');
    execFileSync('mkdir', ['-p', brokenRoot]);
    writeFileSync(join(brokenRoot, 'root.crt.pem'), 'kein zertifikat\n');
    writeFileSync(join(brokenRoot, 'root.key.pem'), 'kein schluessel\n');

    const r = runScript('tl14-ceremony-sign-intermediate.sh', [
      '--root-dir', brokenRoot,
      '--csr', join(intDir, 'intermediate.csr.pem'),
      '--out', join(dir, 'inter-broken.crt.pem'),
    ]);
    expect(r.code).not.toBe(0);
    expect(r.out.trim()).not.toBe('');
    expect(r.out).toContain('FEHLER');
  });
});
