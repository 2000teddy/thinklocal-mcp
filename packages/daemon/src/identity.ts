import { generateKeyPairSync, createSign, createVerify, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { hostname as osHostname, networkInterfaces, cpus, platform, arch } from 'node:os';
import type { Logger } from 'pino';

export interface AgentIdentity {
  /** PEM-encoded ECDSA public key */
  publicKeyPem: string;
  /** PEM-encoded ECDSA private key */
  privateKeyPem: string;
  /** SPIFFE URI: spiffe://thinklocal/host/<hostname>/agent/<type> */
  spiffeUri: string;
  /** Hex-encoded SHA-256 fingerprint of the public key */
  fingerprint: string;
}

function computeFingerprint(publicKeyPem: string): string {
  return createHash('sha256').update(publicKeyPem).digest('hex');
}

export async function loadOrCreateIdentity(
  dataDir: string,
  agentType: string,
  hostname?: string,
  log?: Logger,
): Promise<AgentIdentity> {
  const keyDir = resolve(dataDir, 'keys');
  const pubPath = resolve(keyDir, 'agent.pub.pem');
  const privPath = resolve(keyDir, 'agent.key.pem');

  if (existsSync(pubPath) && existsSync(privPath)) {
    log?.info('Vorhandenes Keypair geladen');
    const publicKeyPem = readFileSync(pubPath, 'utf-8');
    const privateKeyPem = readFileSync(privPath, 'utf-8');
    const host = hostname ?? osHostname();
    return {
      publicKeyPem,
      privateKeyPem,
      spiffeUri: `spiffe://thinklocal/host/${host}/agent/${agentType}`,
      fingerprint: computeFingerprint(publicKeyPem),
    };
  }

  log?.info('Generiere neues ECDSA P-256 Keypair...');
  mkdirSync(keyDir, { recursive: true });

  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  writeFileSync(pubPath, publicKey, { mode: 0o644 });
  writeFileSync(privPath, privateKey, { mode: 0o600 });
  log?.info({ pubPath }, 'Keypair gespeichert');

  const host = hostname ?? osHostname();
  return {
    publicKeyPem: publicKey,
    privateKeyPem: privateKey,
    spiffeUri: `spiffe://thinklocal/host/${host}/agent/${agentType}`,
    fingerprint: computeFingerprint(publicKey),
  };
}

/**
 * Erstellt einen stabilen Device-Fingerprint basierend auf Hardware-Merkmalen.
 * Kombination aus: Hostname, MAC-Adressen, CPU-Modell, Platform, Architektur.
 * Ändert sich nicht über Neustarts hinweg (solange Hardware gleich bleibt).
 */
export function computeDeviceFingerprint(): string {
  const parts: string[] = [];

  // Hostname
  parts.push(osHostname());

  // MAC-Adressen (stabil über Neustarts)
  const ifaces = networkInterfaces();
  for (const ifaceList of Object.values(ifaces)) {
    if (!ifaceList) continue;
    for (const iface of ifaceList) {
      if (iface.mac && iface.mac !== '00:00:00:00:00:00') {
        parts.push(iface.mac);
      }
    }
  }

  // CPU-Modell + Anzahl
  const cpuList = cpus();
  if (cpuList.length > 0) {
    parts.push(cpuList[0].model);
    parts.push(String(cpuList.length));
  }

  // Platform + Architektur
  parts.push(platform());
  parts.push(arch());

  return createHash('sha256').update(parts.sort().join('|')).digest('hex');
}

export function signData(privateKeyPem: string, data: Buffer): Buffer {
  const sign = createSign('SHA256');
  sign.update(data);
  sign.end();
  return sign.sign(privateKeyPem);
}

export function verifySignature(
  publicKeyPem: string,
  data: Buffer,
  signature: Buffer,
): boolean {
  const verify = createVerify('SHA256');
  verify.update(data);
  verify.end();
  return verify.verify(publicKeyPem, signature);
}
