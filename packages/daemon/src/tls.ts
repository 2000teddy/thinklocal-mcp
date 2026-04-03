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
export function createMeshCA(meshName = 'thinklocal'): CaBundle {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();

  cert.publicKey = keys.publicKey;
  cert.serialNumber = generateSerialNumber();
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setDate(cert.validity.notAfter.getDate() + CA_VALIDITY_DAYS);

  const attrs = [
    { name: 'commonName', value: `${meshName} Mesh CA` },
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
): NodeCertBundle {
  const tlsDir = resolve(dataDir, 'tls');
  mkdirSync(tlsDir, { recursive: true });

  const caCertPath = resolve(tlsDir, 'ca.crt.pem');
  const caKeyPath = resolve(tlsDir, 'ca.key.pem');
  const nodeCertPath = resolve(tlsDir, 'node.crt.pem');
  const nodeKeyPath = resolve(tlsDir, 'node.key.pem');

  // 1. CA laden oder erstellen
  let ca: CaBundle;
  if (existsSync(caCertPath) && existsSync(caKeyPath)) {
    log?.info('Vorhandene Mesh-CA geladen');
    ca = {
      caCertPem: readFileSync(caCertPath, 'utf-8'),
      caKeyPem: readFileSync(caKeyPath, 'utf-8'),
    };
  } else {
    log?.info('Generiere neue Mesh-CA...');
    ca = createMeshCA();
    writeFileSync(caCertPath, ca.caCertPem, { mode: 0o644 });
    writeFileSync(caKeyPath, ca.caKeyPem, { mode: 0o600 });
    log?.info({ caCertPath }, 'Mesh-CA gespeichert');
  }

  // 2. Node-Zertifikat laden oder erstellen
  if (existsSync(nodeCertPath) && existsSync(nodeKeyPath)) {
    // Prüfe ob das Zertifikat noch gültig ist
    const certPem = readFileSync(nodeCertPath, 'utf-8');
    const cert = forge.pki.certificateFromPem(certPem);
    const now = new Date();
    const daysLeft = Math.floor(
      (cert.validity.notAfter.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (daysLeft > 7) {
      log?.info({ daysLeft }, 'Vorhandenes Node-Zertifikat geladen');
      return {
        certPem,
        keyPem: readFileSync(nodeKeyPath, 'utf-8'),
        caCertPem: ca.caCertPem,
      };
    }
    log?.warn({ daysLeft }, 'Node-Zertifikat läuft bald ab, erstelle neues...');
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
