/**
 * tls.ts — Lokale CA und mTLS-Zertifikatsverwaltung
 *
 * Implementiert eine einfache Self-Signed CA für das thinklocal-mcp Mesh.
 * Jeder Node generiert beim ersten Start eine CA (wenn keine existiert)
 * und stellt sich ein kurzlebiges Server-/Client-Zertifikat aus.
 *
 * Phase 1: Self-Signed CA, ein Zertifikat pro Node
 * Phase 2+: step-ca Integration, Auto-Rotation, CRL/OCSP
 */

import forge from 'node-forge';
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  openSync,
  writeSync,
  fsyncSync,
  closeSync,
  renameSync,
  unlinkSync,
  statSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { networkInterfaces } from 'node:os';
import type { Logger } from 'pino';

export interface CaBundle {
  caCertPem: string;
  caKeyPem: string;
}

export interface NodeCertBundle {
  certPem: string;
  keyPem: string;
  caCertPem: string;
}

const CA_VALIDITY_DAYS = 365;
export const NODE_CERT_VALIDITY_DAYS = 90;

/**
 * Restlaufzeit-Schwelle (Tage), unter/bei der ein vorhandenes Node-Cert beim Daemon-Start
 * NICHT behalten, sondern **neu ausgestellt** wird (Behalten-Gate: `daysLeft > renewBeforeDays`).
 * Angehoben von 7 → 30 (Wochen-Neustart-Rhythmus, Kap. 13.4 / 3.8-Punkt 7): so erneuern sich
 * Certs beim ohnehin wöchentlichen Neustart rechtzeitig, statt erst im 7-Tage-Sonderfenster.
 * Kein hartkodierter Wert im Gate mehr — der Daemon reicht den konfigurierten Wert
 * (`config.cert.renew_before_days`) herein; dieser Default gilt nur für direkte Aufrufer/Tests.
 */
export const DEFAULT_CERT_RENEW_BEFORE_DAYS = 30;

/**
 * Erstellt eine neue Self-Signed CA für das Mesh.
 * Wird nur beim allerersten Node-Start aufgerufen.
 */
export function createMeshCA(meshName = 'thinklocal', nodeId?: string): CaBundle {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();

  cert.publicKey = keys.publicKey;
  cert.serialNumber = generateSerialNumber();
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setDate(cert.validity.notAfter.getDate() + CA_VALIDITY_DAYS);

  // SECURITY-CRITICAL: Each node MUST have a unique CA Subject DN, otherwise
  // OpenSSL/Node.js issuer-name lookup picks the wrong CA when multiple peer
  // CAs are loaded into the trust store, causing "certificate signature
  // failure" during cross-node mTLS handshakes. The nodeId disambiguates.
  // Without nodeId (legacy callers, tests): falls back to a random suffix
  // so collisions are still avoided.
  const caSuffix = nodeId ?? generateSerialNumber().slice(0, 16);
  const attrs = [
    { name: 'commonName', value: `${meshName} Mesh CA ${caSuffix}` },
    { name: 'organizationName', value: 'thinklocal-mcp' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);

  cert.setExtensions([
    { name: 'basicConstraints', cA: true, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    {
      name: 'subjectKeyIdentifier',
    },
  ]);

  cert.sign(keys.privateKey, forge.md.sha256.create());

  return {
    caCertPem: forge.pki.certificateToPem(cert),
    caKeyPem: forge.pki.privateKeyToPem(keys.privateKey),
  };
}

/**
 * Erstellt ein Node-Zertifikat, signiert von der Mesh-CA.
 * Enthält den SPIFFE-URI als SAN (SubjectAlternativeName).
 *
 * ADR-034: `existingKeyPem` (optional) reutilisiert ein VORHANDENES Node-Keypair
 * statt ein neues zu generieren — genutzt von der Re-Pair-Migrationsstufe, damit
 * nur `node.crt.pem` (nicht `node.key.pem`) getauscht wird → atomarer Einzeldatei-
 * Swap ohne Torn-Pair-Risiko. Ohne den Parameter: unverändertes Frisch-Gen-Verhalten.
 */
export function createNodeCert(
  ca: CaBundle,
  hostname: string,
  spiffeUri: string,
  ipAddresses: string[] = [],
  existingKeyPem?: string,
): NodeCertBundle {
  const caCert = forge.pki.certificateFromPem(ca.caCertPem);
  const caKey = forge.pki.privateKeyFromPem(ca.caKeyPem);

  let publicKey: forge.pki.rsa.PublicKey;
  let keyPemOut: string;
  if (existingKeyPem) {
    // Key-Reuse (ADR-034): öffentlichen Schlüssel aus dem vorhandenen privaten ableiten.
    const priv = forge.pki.privateKeyFromPem(existingKeyPem) as forge.pki.rsa.PrivateKey;
    publicKey = forge.pki.setRsaPublicKey(priv.n, priv.e);
    keyPemOut = existingKeyPem;
  } else {
    const keys = forge.pki.rsa.generateKeyPair(2048);
    publicKey = keys.publicKey;
    keyPemOut = forge.pki.privateKeyToPem(keys.privateKey);
  }
  const cert = forge.pki.createCertificate();

  cert.publicKey = publicKey;
  cert.serialNumber = generateSerialNumber();
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setDate(cert.validity.notAfter.getDate() + NODE_CERT_VALIDITY_DAYS);

  cert.setSubject([
    { name: 'commonName', value: hostname },
    { name: 'organizationName', value: 'thinklocal-mcp' },
  ]);
  cert.setIssuer(caCert.subject.attributes);

  // SANs: DNS, IPs und SPIFFE-URI
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const altNames: any[] = [
    { type: 2, value: hostname }, // DNS
    { type: 2, value: 'localhost' }, // DNS
    { type: 6, value: spiffeUri }, // URI (SPIFFE)
  ];
  for (const ip of ipAddresses) {
    altNames.push({ type: 7, ip }); // IP
  }

  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    {
      name: 'keyUsage',
      digitalSignature: true,
      keyEncipherment: true,
      critical: true,
    },
    {
      name: 'extKeyUsage',
      serverAuth: true,
      clientAuth: true, // Wichtig für mTLS!
    },
    {
      name: 'subjectAltName',
      altNames,
    },
  ]);

  cert.sign(caKey, forge.md.sha256.create());

  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem: keyPemOut,
    caCertPem: ca.caCertPem,
  };
}

/**
 * Lädt oder erstellt CA + Node-Zertifikat.
 * Persistiert alles im dataDir/tls/ Verzeichnis.
 */
/**
 * ADR-024: Optionale Canonical-Retention. Wird in index.ts VOR dem Bundle-Call
 * aufgelöst. `trustedAttestingCaPems` ist bereits auf gepinnte Attesting-CA-
 * Fingerprints gefiltert (die Filterung passiert beim Aufrufer).
 */
export interface CanonicalRetentionOpts {
  /** Eigene kanonische `node/<PeerID>`-URI (aus dem lokalen libp2p-Key). */
  canonicalSpiffeUri?: string;
  /** CA-PEMs (eigene + gepairte), GEFILTERT auf gepinnte Attesting-CA-Fingerprints. */
  trustedAttestingCaPems?: readonly string[];
  /**
   * ADR-034: Opt-in Re-Pair-Migrationsstufe. Default (undefined/false) = AUS → Migrationszweig
   * wird NIE betreten → Verhalten bitidentisch. An: ein gültiges Legacy-`host/`-Cert eines
   * Own-CA-Nodes wird beim Start EINMAL kanonisch (`node/<PeerID>`) neu signiert (Key-Reuse,
   * atomarer Einzeldatei-Swap, Lock, fail-closed).
   */
  migrateLegacyIdentity?: boolean;
  /** ADR-034 (testbar): Alter (ms), ab dem ein Migrations-Lockfile als verwaist gilt (Steal). Default 60000. */
  migrateLockStaleMs?: number;
  /** ADR-034 (testbar): max. Wartezeit (ms) auf ein gehaltenes Lock, dann skip (fail-closed). Default 10000. */
  migrateLockTimeoutMs?: number;
}

/** ADR-034: kooperativer Sync-Sleep ohne Busy-Loop (für das Migrations-Lock-Warten). */
function sleepSync(ms: number): void {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * ADR-034: advisory O_EXCL-Lock für die Migrationsstufe. Serialisiert gleichzeitige Startversuche
 * (Korrektheit hängt NICHT davon ab — die Migration ist idempotent). Verwaiste Locks (mtime älter
 * als `staleMs`, Halter vermutlich gecrasht) werden gestohlen. Gibt den fd zurück oder `null`
 * (Lock nicht erlangbar innerhalb `timeoutMs` → Aufrufer bleibt fail-closed beim Legacy-Cert).
 */
function acquireMigrationLock(
  lockPath: string,
  opts: { staleMs: number; timeoutMs: number; pollMs?: number },
): number | null {
  const deadline = Date.now() + opts.timeoutMs;
  for (;;) {
    try {
      const fd = openSync(lockPath, 'wx', 0o600);
      try {
        writeSync(fd, `${process.pid}\n`);
      } catch {
        /* PID-Notiz ist rein diagnostisch */
      }
      return fd;
    } catch (err) {
      // CR-LOW-2: JEDER nicht-EEXIST-Fehler (EACCES/ENOSPC/ENOTDIR …) → `null` = Lock nicht
      // erlangbar → fail-closed (Aufrufer behält das Legacy-Cert). NICHT werfen: ein Throw würde
      // sonst in den äußeren „unlesbar → reissue"-Pfad laufen und fälschlich re-keyen statt behalten.
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') return null;
      // Gehalten → Verwaisung prüfen.
      try {
        const st = statSync(lockPath);
        if (Date.now() - st.mtimeMs > opts.staleMs) {
          unlinkSync(lockPath); // verwaist → stehlen, dann erneut versuchen
          continue;
        }
      } catch {
        continue; // Lock verschwand zwischen open und stat → erneut versuchen
      }
      if (Date.now() >= deadline) return null; // aufgeben (fail-closed)
      sleepSync(Math.min(opts.pollMs ?? 50, opts.timeoutMs));
    }
  }
}

function releaseMigrationLock(fd: number, lockPath: string): void {
  try {
    closeSync(fd);
  } catch {
    /* best effort */
  }
  try {
    unlinkSync(lockPath);
  } catch {
    /* best effort */
  }
}

interface MigrateArgs {
  tlsDir: string;
  ca: CaBundle;
  hostname: string;
  canonicalSpiffeUri: string;
  localIps: string[];
  /** Vorhandener Node-Key (wird WIEDERverwendet — nur das Cert wird getauscht). */
  existingKeyPem: string;
  spiffeBefore: string | null;
  log?: Logger;
  staleMs: number;
  timeoutMs: number;
}

/**
 * ADR-034: Migriert ein gültiges Legacy-`host/`-Node-Cert auf die kanonische `node/<PeerID>`-Identität.
 * Unter Lock, atomar (nur `node.crt.pem` via tmp+fsync+rename; `node.key.pem` unberührt → Paar stets
 * konsistent). Idempotent: unter dem Lock wird erneut geprüft, ob bereits kanonisch (Race-Gewinner).
 * Gibt das kanonische Bundle zurück oder `null` (Skip/Fehler → Aufrufer behält fail-closed das Legacy-Cert).
 */
function migrateLegacyCertToCanonical(args: MigrateArgs): NodeCertBundle | null {
  const nodeCertPath = resolve(args.tlsDir, 'node.crt.pem');
  const nodeKeyPath = resolve(args.tlsDir, 'node.key.pem');
  const lockPath = resolve(args.tlsDir, '.migrate.lock');
  const fd = acquireMigrationLock(lockPath, { staleMs: args.staleMs, timeoutMs: args.timeoutMs });
  if (fd === null) {
    args.log?.warn(
      { lockPath },
      '[migrate] Migrations-Lock nicht erlangbar (belegt/Timeout/FS-Fehler) — übersprungen (fail-closed: Legacy-Cert bleibt)',
    );
    return null;
  }
  try {
    args.log?.info({ lockPath }, '[migrate] Lock erworben');
    // Unter dem Lock erneut lesen: ein paralleler Start könnte bereits migriert haben.
    const curCertPem = readFileSync(nodeCertPath, 'utf-8');
    const curSans = extractSpiffeUris(curCertPem);
    if (curSans.includes(args.canonicalSpiffeUri)) {
      args.log?.info(
        { canonicalSpiffeUri: args.canonicalSpiffeUri },
        '[migrate] bereits kanonisch (paralleler Start hat migriert) — behalten, kein zweiter Re-Sign',
      );
      return { certPem: curCertPem, keyPem: readFileSync(nodeKeyPath, 'utf-8'), caCertPem: args.ca.caCertPem };
    }
    // Kanonisches Cert mit WIEDERverwendetem Key signieren (nur das Cert ändert sich).
    const canonical = createNodeCert(args.ca, args.hostname, args.canonicalSpiffeUri, args.localIps, args.existingKeyPem);
    // Legacy-Cert archivieren (KEIN live nutzbares Cert — liegt nicht unter node.crt.pem).
    writeFileSync(resolve(args.tlsDir, 'node.crt.legacy-premigrate.pem'), curCertPem, { mode: 0o644 });
    // Atomarer Install: tmp + fsync + rename (node.key.pem bleibt unberührt).
    const tmp = resolve(args.tlsDir, 'node.crt.pem.tmp');
    try {
      const wfd = openSync(tmp, 'w', 0o644);
      try {
        writeSync(wfd, canonical.certPem);
        fsyncSync(wfd);
      } finally {
        closeSync(wfd);
      }
      renameSync(tmp, nodeCertPath);
      // CR-LOW-1: Verzeichnis-Eintrag durabel machen (rename ist atomar für Leser, aber der
      // Dir-Entry-Update kann bei Power-Loss verloren gehen → dann liegt wieder das Legacy-Cert
      // vor, das zum unveränderten Key passt: fail-safe, aber wir wollen den Rename halten).
      try {
        const dfd = openSync(args.tlsDir, 'r');
        try {
          fsyncSync(dfd);
        } finally {
          closeSync(dfd);
        }
      } catch {
        /* Dir-fsync best effort (z.B. auf FS, die es nicht unterstützen) */
      }
    } catch (writeErr) {
      // CR-NIT-1: Halb geschriebenes tmp bei Fehler aufräumen (kein Litter; node.crt.pem unberührt).
      try {
        unlinkSync(tmp);
      } catch {
        /* best effort */
      }
      throw writeErr;
    }
    args.log?.info(
      { spiffeBefore: args.spiffeBefore, spiffeAfter: args.canonicalSpiffeUri },
      '[migrate] kanonisches Node-Cert installiert (atomarer Rename); Legacy archiviert',
    );
    return { certPem: canonical.certPem, keyPem: args.existingKeyPem, caCertPem: args.ca.caCertPem };
  } catch (err) {
    args.log?.error(
      { err: err instanceof Error ? err.message : String(err) },
      '[migrate] Migration fehlgeschlagen — Legacy-Cert unangetastet (fail-closed)',
    );
    return null;
  } finally {
    releaseMigrationLock(fd, lockPath);
  }
}

/**
 * ADR-024: Darf ein vorhandenes Node-Cert als kanonisch BEHALTEN werden?
 * Rein/testbar. True NUR wenn: (a) eine Cert-SAN exakt die eigene kanonische URI
 * ist (matcht die libp2p-PeerID), UND (b) das Leaf kryptografisch unter EINER
 * gepinnten Attesting-CA verifiziert (`verifyPeerCert` prüft Signatur + Gültigkeit).
 * KEINE Issuer-DN/Fingerprint-Ableitung aus dem Leaf (Confused-Deputy-Schutz, CO gpt-5.5).
 */
export function isRetainableCanonicalCert(args: {
  certPem: string;
  canonicalSpiffeUri: string | undefined;
  trustedAttestingCaPems: readonly string[];
}): boolean {
  const { certPem, canonicalSpiffeUri, trustedAttestingCaPems } = args;
  if (!canonicalSpiffeUri || trustedAttestingCaPems.length === 0) return false;
  const sans = extractSpiffeUris(certPem);
  // Die eigene kanonische URI MUSS enthalten sein …
  if (!sans.includes(canonicalSpiffeUri)) return false;
  // … und CR-MEDIUM (ADR-024): KEINE FREMDE kanonische node/<PeerID>-SAN. Legacy-`host/`-SANs
  // (Migrations-Cert) sind erlaubt, aber jede `node/`-SAN muss die eigene sein — sonst würde
  // ein überbreites Cert eine zweite Identität mit-attestieren.
  if (sans.some((u) => u.startsWith('spiffe://thinklocal/node/') && u !== canonicalSpiffeUri)) return false;
  return trustedAttestingCaPems.some((caPem) => verifyPeerCert(caPem, certPem));
}

export function loadOrCreateTlsBundle(
  dataDir: string,
  hostname: string,
  spiffeUri: string,
  log?: Logger,
  nodeId?: string,
  retention?: CanonicalRetentionOpts,
  renewBeforeDays: number = DEFAULT_CERT_RENEW_BEFORE_DAYS,
): NodeCertBundle {
  const tlsDir = resolve(dataDir, 'tls');
  mkdirSync(tlsDir, { recursive: true });

  const caCertPath = resolve(tlsDir, 'ca.crt.pem');
  const caKeyPath = resolve(tlsDir, 'ca.key.pem');
  const nodeCertPath = resolve(tlsDir, 'node.crt.pem');
  const nodeKeyPath = resolve(tlsDir, 'node.key.pem');

  // 1. CA laden oder erstellen.
  // Migration: Wenn eine bestehende CA das alte (kollidierende) Subject hat,
  // wird sie durch eine neue mit nodeId-Suffix ersetzt. Alte Files werden
  // als .legacy.pem gesichert, falls jemand sie noch braucht.
  let ca: CaBundle;
  let needsCaReissue = false;

  if (existsSync(caCertPath) && existsSync(caKeyPath)) {
    const existingCertPem = readFileSync(caCertPath, 'utf-8');
    try {
      const existingCert = forge.pki.certificateFromPem(existingCertPem);
      const subjectCn = existingCert.subject.getField('CN')?.value as string | undefined;

      // Detect old colliding subject: "thinklocal Mesh CA" without any suffix
      const isLegacyColliding = subjectCn === 'thinklocal Mesh CA';

      // SECURITY (PR #77 GPT-5.4 review): Check CA validity window. An expired
      // CA must not be silently reused — peers will reject the chain anyway.
      const now = new Date();
      const caValid =
        now >= existingCert.validity.notBefore &&
        now <= existingCert.validity.notAfter;

      if (isLegacyColliding) {
        log?.warn(
          { subjectCn },
          'CA-Subject kollidiert mit anderen Nodes (Legacy-Format) — generiere neue CA mit nodeId-Suffix',
        );
        // Backup old files
        const legacyCertPath = resolve(tlsDir, 'ca.crt.legacy.pem');
        const legacyKeyPath = resolve(tlsDir, 'ca.key.legacy.pem');
        writeFileSync(legacyCertPath, existingCertPem, { mode: 0o644 });
        writeFileSync(legacyKeyPath, readFileSync(caKeyPath, 'utf-8'), { mode: 0o600 });
        log?.info({ legacyCertPath }, 'Legacy-CA gesichert');
        needsCaReissue = true;
      } else if (!caValid) {
        log?.warn(
          {
            notBefore: existingCert.validity.notBefore,
            notAfter: existingCert.validity.notAfter,
          },
          'Vorhandene Mesh-CA ist abgelaufen oder noch nicht gueltig — reissue',
        );
        needsCaReissue = true;
      } else {
        // SECURITY (GPT-5.4 retro HIGH 2nd pass): cert/key pair match check.
        // Ein partial-migration-crash oder manuelle Recovery koennte eine
        // ca.crt.pem und ca.key.pem aus verschiedenen Generationen zurueck-
        // lassen. Wir pruefen, dass sie wirklich zueinander passen bevor
        // wir sie als "unser Mesh-CA" weiterverwenden.
        const existingCaKeyPem = readFileSync(caKeyPath, 'utf-8');
        let caPairMatches = false;
        try {
          const caPrivKey = forge.pki.privateKeyFromPem(existingCaKeyPem) as forge.pki.rsa.PrivateKey;
          const caPubKey = existingCert.publicKey as forge.pki.rsa.PublicKey;
          caPairMatches = caPrivKey.n.equals(caPubKey.n) && caPrivKey.e.equals(caPubKey.e);
        } catch {
          caPairMatches = false;
        }

        if (!caPairMatches) {
          log?.warn(
            { subjectCn },
            'Mesh-CA Cert und Key passen nicht zusammen (partial migration state?) — reissue',
          );
          needsCaReissue = true;
        } else {
          log?.info({ subjectCn }, 'Vorhandene Mesh-CA geladen');
          ca = {
            caCertPem: existingCertPem,
            caKeyPem: existingCaKeyPem,
          };
        }
      }
    } catch (err) {
      log?.warn({ err }, 'Konnte vorhandene CA nicht parsen — generiere neu');
      needsCaReissue = true;
    }
  } else if (existsSync(caCertPath) && !existsSync(caKeyPath) && existsSync(nodeCertPath) && existsSync(nodeKeyPath)) {
    // Token-onboarded node: has CA cert + node cert from admin, but no CA key.
    // This is correct — the CA key stays on the admin node. We use the
    // existing certs directly without generating anything new.
    const certPem = readFileSync(nodeCertPath, 'utf-8');
    const keyPem = readFileSync(nodeKeyPath, 'utf-8');
    const caCertPem = readFileSync(caCertPath, 'utf-8');

    // SECURITY (127b, CR-MEDIUM pre-existing): Ein token-onboarded Node hat KEINEN
    // CA-Key und kann sein Node-Cert deshalb NICHT selbst neu ausstellen. Das
    // gelieferte Bundle wird darum beim Laden fail-closed validiert, statt ein
    // ungeprüftes Cert durchzureichen, das Peers ohnehin ablehnen (stiller
    // Mesh-Ausfall). Die gelieferte `ca.crt.pem` IST der Trust-Anchor dieses
    // Nodes — analog zum Frisch-Gen-Primärpfad prüfen wir:
    //   (1) Node-Cert von genau dieser CA signiert + Leaf/CA zeitlich gültig
    //       (verifyPeerCert, fail-closed auch auf CA-Gültigkeit, ADR-024 MEDIUM-1);
    //   (2) Cert<->Key-Paar konsistent (kein gemischter node.crt/node.key-Stand).
    // Ein kanonisch (von einer Attesting-CA) signiertes Cert wird korrekt token-
    // onboarded, indem der Admin ebendiese Attesting-CA als `ca.crt.pem` mitliefert
    // → (1) greift. Eine `ca.crt.pem`, die das Node-Cert NICHT verifiziert, ist ein
    // inkonsistentes Bundle und wird abgewiesen (kein still gemischter Anchor).
    let certKeyMatches = false;
    try {
      const privKey = forge.pki.privateKeyFromPem(keyPem) as forge.pki.rsa.PrivateKey;
      const certPubKey = forge.pki.certificateFromPem(certPem).publicKey as forge.pki.rsa.PublicKey;
      certKeyMatches = privKey.n.equals(certPubKey.n) && privKey.e.equals(certPubKey.e);
    } catch {
      certKeyMatches = false;
    }

    const signedByShippedCa = verifyPeerCert(caCertPem, certPem);

    if (certKeyMatches && signedByShippedCa) {
      // Hinweis (CR): `renewBeforeDays` gilt hier NICHT — ein token-onboardeter Node hat keinen
      // CA-Key und kann sich nicht selbst neu ausstellen. Er behält sein Cert bis zum tatsächlichen
      // Ablauf (fail-closed via verifyPeerCert-Zeitfenster) und erneuert sich per Re-Onboarding.
      // Die proaktive 30-Tage-Erneuerung (Wochen-Neustart-Rhythmus) betrifft nur CA-owner-Nodes.
      log?.info(
        'Token-onboarded Node erkannt (CA-Cert ohne CA-Key) — Bundle validiert, verwende vorhandene Zertifikate',
      );
      return { certPem, keyPem, caCertPem };
    }

    // Fail-closed: ohne CA-Key keine Selbst-Reissue möglich. Ein invalides Bundle
    // (falsche/abgelaufene CA, fremder Key, Signatur-Mismatch) darf nicht als
    // gültig durchgereicht werden — der Node muss per Admin-Token neu onboarden.
    log?.error(
      { signedByShippedCa, certKeyMatches },
      'Token-onboarded Bundle ungültig: node.crt.pem verifiziert nicht gegen ca.crt.pem (Signatur/Gültigkeit/Key-Mismatch) — Re-Onboarding nötig',
    );
    throw new Error(
      'Token-onboarded TLS-Bundle ungültig: node.crt.pem verifiziert nicht gegen ca.crt.pem ' +
        '(Signatur, Gültigkeitsfenster oder Cert-Key-Mismatch). Ohne CA-Key ist keine Selbst-Reissue ' +
        'möglich — bitte den Node per Admin-Token neu onboarden.',
    );
  } else {
    needsCaReissue = true;
  }

  if (needsCaReissue) {
    log?.info('Generiere neue Mesh-CA...');
    ca = createMeshCA('thinklocal', nodeId);
    writeFileSync(caCertPath, ca.caCertPem, { mode: 0o644 });
    writeFileSync(caKeyPath, ca.caKeyPem, { mode: 0o600 });
    log?.info({ caCertPath, nodeId }, 'Mesh-CA gespeichert');
    // Force node cert reissue too, since it must be signed by the new CA
    if (existsSync(nodeCertPath)) {
      const legacyNodeCert = resolve(tlsDir, 'node.crt.legacy.pem');
      const legacyNodeKey = resolve(tlsDir, 'node.key.legacy.pem');
      writeFileSync(legacyNodeCert, readFileSync(nodeCertPath, 'utf-8'), { mode: 0o644 });
      if (existsSync(nodeKeyPath)) {
        writeFileSync(legacyNodeKey, readFileSync(nodeKeyPath, 'utf-8'), { mode: 0o600 });
      }
      log?.info({ legacyNodeCert }, 'Legacy Node-Cert gesichert, wird neu ausgestellt');
    }
  }
  // After this point, `ca` is guaranteed to be set.
  ca = ca!;

  // 2. Node-Zertifikat laden oder erstellen.
  // Wenn die CA gerade neu ausgestellt wurde, MUSS das Node-Cert auch neu —
  // ein altes Node-Cert das von der alten CA signiert ist, wuerde sonst
  // gegenueber der neuen CA ungueltig sein.
  //
  // SECURITY (PR #77 GPT-5.4 review HIGH finding): Reuse-Pfad muss VOLL
  // validieren, sonst kann ein partial-migration-crash einen Node-Cert
  // hinterlassen, das nicht mehr von der aktuellen CA signiert ist und
  // die SPIFFE-URI dennoch zufaellig matcht. Wir pruefen jetzt:
  //   1. Cert parst (try/catch)
  //   2. Cert ist zeitlich gueltig (>7 Tage Restlaufzeit)
  //   3. SPIFFE-URI matcht aktuelle Identitaet
  //   4. Cert-Signatur verifiziert gegen aktuelle CA (issuer match)
  if (!needsCaReissue && existsSync(nodeCertPath) && existsSync(nodeKeyPath)) {
    try {
      const certPem = readFileSync(nodeCertPath, 'utf-8');
      const keyPem = readFileSync(nodeKeyPath, 'utf-8');
      const cert = forge.pki.certificateFromPem(certPem);
      const caCert = forge.pki.certificateFromPem(ca.caCertPem);

      const now = new Date();
      const daysLeft = Math.floor(
        (cert.validity.notAfter.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );
      const certSpiffeUri = extractSpiffeUri(certPem);

      // Full validity window check (GPT-5.4 2nd retro: "not yet valid" possible with clock skew)
      const fullyValid = now >= cert.validity.notBefore && now <= cert.validity.notAfter;

      // Signatur-Verifikation: ist das Cert von der aktuellen CA signiert?
      let signedByCurrentCa = false;
      try {
        signedByCurrentCa = caCert.verify(cert);
      } catch {
        signedByCurrentCa = false;
      }

      // SECURITY (GPT-5.4 retro HIGH 2nd pass): cert<->key pair consistency.
      // Ein partial-migration-crash koennte node.crt und node.key aus
      // verschiedenen Generationen mischen. Verifizieren dass die Public-
      // Keys wirklich zueinander passen.
      let certKeyMatches = false;
      try {
        const privKey = forge.pki.privateKeyFromPem(keyPem) as forge.pki.rsa.PrivateKey;
        const certPubKey = cert.publicKey as forge.pki.rsa.PublicKey;
        certKeyMatches = privKey.n.equals(certPubKey.n) && privKey.e.equals(certPubKey.e);
      } catch {
        certKeyMatches = false;
      }

      // ADR-034: Re-Pair-Migrationsstufe (opt-in, Default AUS → Zweig nie betreten). Ein GÜLTIGES
      // Legacy-`host/`-Cert eines Own-CA-Nodes wird EINMAL kanonisch (`node/<PeerID>`) neu signiert.
      // Vor den Retain-Gates, damit ein Legacy-Cert nicht still behalten wird. Key-Reuse + atomarer
      // Einzeldatei-Swap unter Lock → keine zwei parallelen Identitäten, kein halbes File. Fehler/Skip
      // → fall-through (das Legacy-Cert wird unten fail-closed vom legacy-current-ca-Gate behalten).
      const canonUri = retention?.canonicalSpiffeUri;
      if (
        retention?.migrateLegacyIdentity === true &&
        canonUri &&
        fullyValid &&
        signedByCurrentCa &&
        certKeyMatches &&
        certSpiffeUri !== null &&
        certSpiffeUri.startsWith('spiffe://thinklocal/host/') &&
        !extractSpiffeUris(certPem).includes(canonUri)
      ) {
        log?.info(
          { spiffeBefore: certSpiffeUri, canonicalSpiffeUri: canonUri },
          '[migrate] Legacy-Cert erkannt — Migrationsmodus aktiv',
        );
        const migrated = migrateLegacyCertToCanonical({
          tlsDir,
          ca,
          hostname,
          canonicalSpiffeUri: canonUri,
          localIps: getLocalIpAddresses(),
          existingKeyPem: keyPem,
          spiffeBefore: certSpiffeUri,
          log,
          staleMs: retention?.migrateLockStaleMs ?? 60_000,
          timeoutMs: retention?.migrateLockTimeoutMs ?? 10_000,
        });
        if (migrated) return migrated;
        // else: fall-through → Legacy-Cert bleibt (fail-closed).
      }

      if (fullyValid && daysLeft > renewBeforeDays && certSpiffeUri === spiffeUri && signedByCurrentCa && certKeyMatches) {
        log?.info({ daysLeft, renewBeforeDays, retainPath: 'legacy-current-ca' }, 'Vorhandenes Node-Zertifikat geladen');
        return {
          certPem,
          keyPem,
          caCertPem: ca.caCertPem,
        };
      }

      // ADR-024: Canonical-Retention. Ein frisch re-enrolltes node/<PeerID>-Cert
      // (z.B. von der .94-Attesting-CA) würde sonst hier verworfen werden — auf
      // CA-owner-Nodes wegen certSpiffeUri!==spiffeUri (Legacy), auf own-CA-Nodes
      // wegen signedByCurrentCa===false. Behalte es, wenn es DIESE Node-eigene
      // kanonische Identität trägt UND krypto unter einer gepinnten Attesting-CA
      // verifiziert (additiv; ohne retention-Opts inert → Default unverändert).
      if (
        fullyValid &&
        daysLeft > renewBeforeDays &&
        certKeyMatches &&
        isRetainableCanonicalCert({
          certPem,
          canonicalSpiffeUri: retention?.canonicalSpiffeUri,
          trustedAttestingCaPems: retention?.trustedAttestingCaPems ?? [],
        })
      ) {
        log?.info(
          { daysLeft, canonicalSpiffeUri: retention?.canonicalSpiffeUri, retainPath: 'canonical-attested' },
          'ADR-024: Kanonisches Node-Zertifikat behalten (attestiert von gepinnter CA)',
        );
        return { certPem, keyPem, caCertPem: ca.caCertPem };
      }

      log?.warn(
        { daysLeft, certSpiffeUri, currentSpiffeUri: spiffeUri, fullyValid, signedByCurrentCa, certKeyMatches },
        'Vorhandenes Node-Zertifikat ungueltig fuer aktuelle CA/Identitaet — reissue',
      );
    } catch (err) {
      log?.warn({ err }, 'Vorhandenes Node-Zertifikat unlesbar — reissue');
    }
  }

  // Lokale IPs sammeln für SANs
  const localIps = getLocalIpAddresses();
  log?.info({ hostname, ips: localIps }, 'Generiere neues Node-Zertifikat...');

  const bundle = createNodeCert(ca, hostname, spiffeUri, localIps);
  writeFileSync(nodeCertPath, bundle.certPem, { mode: 0o644 });
  writeFileSync(nodeKeyPath, bundle.keyPem, { mode: 0o600 });
  log?.info({ nodeCertPath }, 'Node-Zertifikat gespeichert');

  return bundle;
}

/**
 * Gibt die verbleibenden Tage bis zum Ablauf des Node-Zertifikats zurueck.
 * Nützlich fuer proaktive Warnungen im Dashboard und Telegram.
 */
export function getCertDaysLeft(dataDir: string): number | null {
  // SECURITY (PR #77 GPT-5.4 review LOW finding): The path was wrong —
  // pointed at dataDir/certs/node.crt but loadOrCreateTlsBundle writes to
  // dataDir/tls/node.crt.pem. As a result startup warnings for soon-to-expire
  // certs never fired.
  const certPath = resolve(dataDir, 'tls', 'node.crt.pem');
  if (!existsSync(certPath)) return null;
  try {
    const certPem = readFileSync(certPath, 'utf-8');
    const cert = forge.pki.certificateFromPem(certPem);
    const now = new Date();
    return Math.floor((cert.validity.notAfter.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  } catch {
    return null;
  }
}

/**
 * Verifiziert ein Peer-Zertifikat gegen die CA.
 * Gibt true zurück wenn das Zertifikat gültig und von unserer CA signiert ist.
 */
export function verifyPeerCert(caCertPem: string, peerCertPem: string): boolean {
  try {
    const caCert = forge.pki.certificateFromPem(caCertPem);
    const peerCert = forge.pki.certificateFromPem(peerCertPem);

    // Prüfe ob von unserer CA signiert
    const verified = caCert.verify(peerCert);

    const now = new Date();
    // Leaf-Gültigkeit
    const leafValid = now >= peerCert.validity.notBefore && now <= peerCert.validity.notAfter;
    // ADR-024 MEDIUM-1 (CR/PC gpt-5.x): auch das Gültigkeitsfenster der AUSSTELLENDEN CA
    // fail-closed prüfen. `caCert.verify` validiert nur die Signatur, nicht ob die CA selbst
    // noch (oder schon) gültig ist. Eine abgelaufene/noch-nicht-gültige Issuer-CA darf weder
    // im Retention- noch im Flip-/Trust-Distribution-Pfad als Vertrauensanker akzeptiert werden.
    const caValid = now >= caCert.validity.notBefore && now <= caCert.validity.notAfter;

    return verified && leafValid && caValid;
  } catch {
    return false;
  }
}

/**
 * ADR-024 MEDIUM-2 (Trust-Distribution-Lifecycle, fail-closed): Wählt die CA, die an
 * gepairte Peers verteilt wird. Die verteilte CA MUSS das eigene Serving-Cert kryptografisch
 * verifizieren — sonst könnten neu gepairte Peers unseren Server nicht validieren (CR-HIGH-2).
 * Hält ein own-CA-Node ein von der Attesting-CA (z.B. .94) BEHALTENES kanonisches Cert, ist
 * der korrekte Trust-Anchor die Issuer-CA, NICHT die eigene Mesh-CA. Kandidaten werden in
 * Reihenfolge geprüft; der erste, der das Serving-Cert verifiziert, gewinnt. Verifiziert KEINE
 * Kandidaten-CA (fehlende/abgelaufene Issuer-CA) → `null` (Aufrufer verweigert die Distribution,
 * statt einen nicht-validierenden/leeren Anker zu verteilen).
 */
export function selectTrustDistributionCa(args: {
  servingCertPem: string | undefined;
  candidateCaPems: Array<string | undefined>;
}): string | null {
  const { servingCertPem, candidateCaPems } = args;
  if (!servingCertPem) return null;
  for (const caPem of candidateCaPems) {
    if (caPem && verifyPeerCert(caPem, servingCertPem)) return caPem;
  }
  return null;
}

/**
 * Extrahiert den SPIFFE-URI aus einem Zertifikat (SAN Extension).
 */
export function extractSpiffeUri(certPem: string): string | null {
  return extractSpiffeUris(certPem)[0] ?? null;
}

/**
 * ALLE SPIFFE-URI-SANs eines Cert-PEM (z.B. ein Migrations-Cert mit Legacy- UND
 * kanonischer SAN). Reihenfolge wie im Cert. Leeres Array bei Fehler/kein SAN.
 * ADR-022 Phase 3: die Self-Flip-Entscheidung muss prüfen, ob die EIGENE kanonische
 * URI unter den Cert-SANs ist (nicht nur „die erste SAN ist kanonisch").
 */
export function extractSpiffeUris(certPem: string): string[] {
  try {
    const cert = forge.pki.certificateFromPem(certPem);
    const san = cert.getExtension('subjectAltName') as
      | { altNames: Array<{ type: number; value: string }> }
      | undefined;
    if (!san) return [];
    return san.altNames
      .filter((an) => an.type === 6 && an.value.startsWith('spiffe://thinklocal/'))
      .map((an) => an.value);
  } catch {
    return [];
  }
}

function generateSerialNumber(): string {
  // 16 Bytes zufällig, als Hex-String
  const bytes = forge.random.getBytesSync(16);
  return forge.util.bytesToHex(bytes);
}

function getLocalIpAddresses(): string[] {
  const interfaces = networkInterfaces();
  const ips: string[] = [];

  for (const iface of Object.values(interfaces)) {
    if (!iface) continue;
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) {
        ips.push(addr.address);
      }
    }
  }

  // Immer 127.0.0.1 für localhost-Verbindungen
  if (!ips.includes('127.0.0.1')) {
    ips.push('127.0.0.1');
  }

  return ips;
}
