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
  /** SPIFFE URI: spiffe://thinklocal/host/<stableNodeId>/agent/<type> */
  spiffeUri: string;
  /** Hex-encoded SHA-256 fingerprint of the public key */
  fingerprint: string;
  /** Stable node identifier (16 hex chars), unaffected by OS hostname drift */
  stableNodeId: string;
}

/**
 * Berechnet eine stabile Node-ID, die sich NICHT mit dem OS-Hostname aendert.
 * Quelle: sortierte MAC-Adressen + CPU-Modell + Plattform/Architektur.
 *
 * Bewusste Auslassung: os.hostname(). Auf macOS aendert sich der Hostname
 * dynamisch (minimac-200, minimac-795, minimac-1014, ...) wenn die Maschine
 * im Netz mit anderen Bonjour-Geraeten kollidiert. Eine SPIFFE-URI darf
 * davon nicht abhaengen, sonst werden Peers nach jedem Reboot neu identifiziert.
 *
 * Rueckgabe: 16 Hex-Zeichen aus dem SHA-256 ueber die Hardware-Merkmale.
 */
export function computeStableNodeId(): string {
  const parts: string[] = [];

  // MAC-Adressen — stabil ueber Reboots, OS-Updates, Hostname-Wechsel.
  const macs: string[] = [];
  for (const ifaceList of Object.values(networkInterfaces())) {
    if (!ifaceList) continue;
    for (const iface of ifaceList) {
      if (iface.mac && iface.mac !== '00:00:00:00:00:00' && !iface.internal) {
        macs.push(iface.mac.toLowerCase());
      }
    }
  }
  macs.sort();
  parts.push('mac:' + macs.join(','));

  // CPU-Modell + Anzahl Kerne
  const cpuList = cpus();
  if (cpuList.length > 0) {
    parts.push('cpu:' + cpuList[0].model + ':' + cpuList.length);
  }

  // Plattform + Architektur
  parts.push('plat:' + platform() + ':' + arch());

  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16);
}

/**
 * Laedt die persistierte Node-ID aus dataDir/keys/node-id.txt.
 * Falls noch nicht vorhanden, wird sie aus computeStableNodeId() abgeleitet
 * und atomar geschrieben.
 *
 * Diese Indirektion erlaubt zukuenftige manuelle Ueberschreibung (z.B. wenn
 * die Hardware ausgetauscht wird, der Operator aber dieselbe logische Identitaet
 * behalten will). Solange die Datei existiert, ist ihr Inhalt die Wahrheit.
 */
export function loadOrCreateStableNodeId(dataDir: string, log?: Logger): string {
  const keyDir = resolve(dataDir, 'keys');
  const idPath = resolve(keyDir, 'node-id.txt');

  if (existsSync(idPath)) {
    const id = readFileSync(idPath, 'utf-8').trim();
    if (/^[0-9a-f]{16}$/.test(id)) {
      return id;
    }
    log?.warn({ idPath, id }, 'node-id.txt enthaelt ungueltigen Wert, regeneriere');
  }

  mkdirSync(keyDir, { recursive: true });
  const newId = computeStableNodeId();
  writeFileSync(idPath, newId + '\n', { mode: 0o644 });
  log?.info({ idPath, stableNodeId: newId }, 'Neue stabile Node-ID generiert');
  return newId;
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

  // Stabile Node-ID — unabhaengig vom OS-Hostname.
  // Ueberschreibung via Parameter `hostname` weiterhin moeglich (Tests, Migration).
  const stableNodeId = hostname ?? loadOrCreateStableNodeId(dataDir, log);

  if (existsSync(pubPath) && existsSync(privPath)) {
    log?.info('Vorhandenes Keypair geladen');
    const publicKeyPem = readFileSync(pubPath, 'utf-8');
    const privateKeyPem = readFileSync(privPath, 'utf-8');
    return {
      publicKeyPem,
      privateKeyPem,
      spiffeUri: `spiffe://thinklocal/host/${stableNodeId}/agent/${agentType}`,
      fingerprint: computeFingerprint(publicKeyPem),
      stableNodeId,
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

  return {
    publicKeyPem: publicKey,
    privateKeyPem: privateKey,
    spiffeUri: `spiffe://thinklocal/host/${stableNodeId}/agent/${agentType}`,
    fingerprint: computeFingerprint(publicKey),
    stableNodeId,
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
