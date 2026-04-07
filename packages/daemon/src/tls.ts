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
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
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
const NODE_CERT_VALIDITY_DAYS = 90;

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
 */
export function createNodeCert(
  ca: CaBundle,
  hostname: string,
  spiffeUri: string,
  ipAddresses: string[] = [],
): NodeCertBundle {
  const caCert = forge.pki.certificateFromPem(ca.caCertPem);
  const caKey = forge.pki.privateKeyFromPem(ca.caKeyPem);

  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();

  cert.publicKey = keys.publicKey;
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
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
    caCertPem: ca.caCertPem,
  };
}

/**
 * Lädt oder erstellt CA + Node-Zertifikat.
 * Persistiert alles im dataDir/tls/ Verzeichnis.
 */
export function loadOrCreateTlsBundle(
  dataDir: string,
  hostname: string,
  spiffeUri: string,
  log?: Logger,
  nodeId?: string,
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
      } else {
        log?.info({ subjectCn }, 'Vorhandene Mesh-CA geladen');
        ca = {
          caCertPem: existingCertPem,
          caKeyPem: readFileSync(caKeyPath, 'utf-8'),
        };
      }
    } catch (err) {
      log?.warn({ err }, 'Konnte vorhandene CA nicht parsen — generiere neu');
      needsCaReissue = true;
    }
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
  if (!needsCaReissue && existsSync(nodeCertPath) && existsSync(nodeKeyPath)) {
    const certPem = readFileSync(nodeCertPath, 'utf-8');
    const cert = forge.pki.certificateFromPem(certPem);
    const now = new Date();
    const daysLeft = Math.floor(
      (cert.validity.notAfter.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );

    // Pruefe Ablauf
    if (daysLeft <= 7) {
      log?.warn({ daysLeft }, 'Node-Zertifikat läuft bald ab, erstelle neues...');
    } else {
      // Pruefe ob die SPIFFE-URI im Cert noch zur aktuellen Identitaet passt.
      // Notwendig nach der stableNodeId-Migration: wenn identity.spiffeUri sich
      // geaendert hat (z.B. von host/<oldHostname> zu host/<stableNodeId>), muessen
      // wir das Cert reissuen — sonst lehnen Peers den mTLS-Handshake ab oder wir
      // praesentieren eine veraltete Identitaet.
      const certSpiffeUri = extractSpiffeUri(certPem);
      if (certSpiffeUri === spiffeUri) {
        log?.info({ daysLeft }, 'Vorhandenes Node-Zertifikat geladen');
        return {
          certPem,
          keyPem: readFileSync(nodeKeyPath, 'utf-8'),
          caCertPem: ca.caCertPem,
        };
      }
      log?.warn(
        { certSpiffeUri, currentSpiffeUri: spiffeUri },
        'SPIFFE-URI im Cert weicht von aktueller Identitaet ab — reissue (stableNodeId-Migration?)',
      );
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
  const certPath = resolve(dataDir, 'certs', 'node.crt');
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

    // Prüfe Gültigkeit
    const now = new Date();
    const valid = now >= peerCert.validity.notBefore && now <= peerCert.validity.notAfter;

    return verified && valid;
  } catch {
    return false;
  }
}

/**
 * Extrahiert den SPIFFE-URI aus einem Zertifikat (SAN Extension).
 */
export function extractSpiffeUri(certPem: string): string | null {
  try {
    const cert = forge.pki.certificateFromPem(certPem);
    const san = cert.getExtension('subjectAltName') as
      | { altNames: Array<{ type: number; value: string }> }
      | undefined;
    if (!san) return null;

    const uriEntry = san.altNames.find(
      (an) => an.type === 6 && an.value.startsWith('spiffe://thinklocal/'),
    );
    return uriEntry?.value ?? null;
  } catch {
    return null;
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
