// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * canonicalize-pairings.ts — Operator-Runner für den CA-verankerten + identitäts-gebundenen
 * host/→node/-Re-Key (KW28 TL-00, siehe docs/REENROLL-52-RUNBOOK.md).
 *
 * SAFE-BY-CONSTRUCTION (CR-CRITICAL): re-keyt AUSSCHLIESSLICH GENAU EINEN Eintrag (`--peer`) auf
 * GENAU EINE asserted Identität (`--expect-uri`). Kein Sammel-Apply, keine „lone --address"-Schleife
 * (sonst würde die geteilte Mesh-CA eine Identitäts-Substitution über alle Einträge zulassen). Ablauf:
 *   1. verbindet per TLS zur `--address` (Port 9440) und liest das präsentierte Leaf-Cert,
 *   2. Cross-Check: das Cert MUSS die gewählte Adresse als IP/DNS-SAN tragen (Adress-Bindung),
 *   3. übergibt Cert + `--expect-uri` an die REINE, getestete `canonicalizePairedPeer`
 *      (CA-Anker-Verify gegen den GESPEICHERTEN caCertPem + node/-SAN == expected),
 *   4. re-keyt den Eintrag auf `node/<PeerID>`, sonst behält ihn (fail-closed).
 * Schreibt atomar (tmp+rename) mit Backup. `--dry-run` zeigt nur.
 *
 * Aufruf (alle drei Pflicht):
 *   npx tsx packages/daemon/scripts/canonicalize-pairings.ts \
 *     --peer <hostname> --address <host|ip> --expect-uri spiffe://thinklocal/node/<PeerID> [--dry-run]
 *   --expect-uri stammt aus `discover_peers` (daemon-verifizierte Nachfolge-Identität dieses Peers).
 *   TLMCP_DATA_DIR überschreibt das Default-Datenverzeichnis (~/.thinklocal).
 *
 * rejectUnauthorized:false beim Fetch ist ABSICHT: die Autorisierung passiert NICHT im Handshake,
 * sondern unabhängig (CA-Anker + expected-URI + Adress-SAN). Die TLS-Handshake stellt zusätzlich sicher,
 * dass der Server den privaten Schlüssel des Leaf besitzt (kein passives Cert-Replay).
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { connect as tlsConnect } from 'node:tls';
import forge from 'node-forge';
import { canonicalizePairedPeer } from '../src/pairing-canonicalize.js';
import type { PairedPeer } from '../src/pairing.js';

const PORT = 9440;
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const onlyPeer = argValue('--peer');
const address = argValue('--address');
const expectUri = argValue('--expect-uri');

function argValue(flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}
function dataDir(): string {
  return process.env['TLMCP_DATA_DIR'] ?? resolve(homedir(), '.thinklocal');
}
function loadLocalTls(): { cert: string; key: string } | null {
  const tls = resolve(dataDir(), 'tls');
  const c = resolve(tls, 'node.crt.pem');
  const k = resolve(tls, 'node.key.pem');
  if (!existsSync(c) || !existsSync(k)) return null;
  return { cert: readFileSync(c, 'utf-8'), key: readFileSync(k, 'utf-8') };
}

interface FetchedCert {
  pem: string;
  ipSans: string[];
  dnsSans: string[];
}

/** Holt das Leaf-Cert (PEM) + dessen IP/DNS-SANs per TLS-Handshake (rejectUnauthorized:false). */
function fetchPeerLeafCert(host: string, clientTls: { cert: string; key: string } | null): Promise<FetchedCert> {
  return new Promise((resolvePem, reject) => {
    const socket = tlsConnect(
      { host, port: PORT, rejectUnauthorized: false, servername: host, ...(clientTls ?? {}) },
      () => {
        try {
          const raw = socket.getPeerCertificate(false)?.raw;
          if (!raw || raw.length === 0) return reject(new Error('kein Peer-Cert im Handshake'));
          const cert = forge.pki.certificateFromAsn1(forge.asn1.fromDer(forge.util.createBuffer(raw.toString('binary'))));
          const alt = cert.getExtension('subjectAltName') as { altNames?: Array<{ type: number; value: string; ip?: string }> } | undefined;
          const ipSans = (alt?.altNames ?? []).filter((a) => a.type === 7).map((a) => a.ip ?? a.value);
          const dnsSans = (alt?.altNames ?? []).filter((a) => a.type === 2).map((a) => a.value);
          resolvePem({ pem: forge.pki.certificateToPem(cert), ipSans, dnsSans });
        } catch (e) {
          reject(e as Error);
        } finally {
          socket.end();
        }
      },
    );
    socket.setTimeout(6000, () => { socket.destroy(); reject(new Error('TLS-Timeout')); });
    socket.on('error', reject);
  });
}

async function main(): Promise<void> {
  if (!onlyPeer || !address || !expectUri) {
    console.error('Pflicht: --peer <hostname> --address <host|ip> --expect-uri spiffe://thinklocal/node/<PeerID>');
    console.error('(Sicherheit: genau EIN Eintrag wird auf GENAU EINE asserted Identität re-gekeyt.)');
    process.exit(2);
  }
  const file = resolve(dataDir(), 'pairing', 'paired-peers.json');
  if (!existsSync(file)) { console.error(`Keine paired-peers.json unter ${file}`); process.exit(1); }
  const peers = JSON.parse(readFileSync(file, 'utf-8')) as PairedPeer[];
  console.log(`Gelesen: ${peers.length} Einträge${dryRun ? '  [DRY-RUN]' : ''}`);

  const idx = peers.findIndex((p) => p.hostname === onlyPeer);
  if (idx < 0) { console.error(`Kein Eintrag mit hostname="${onlyPeer}".`); process.exit(1); }

  const clientTls = loadLocalTls();
  let fetched: FetchedCert;
  try {
    fetched = await fetchPeerLeafCert(address, clientTls);
  } catch (e) {
    console.error(`Cert-Fetch von ${address} fehlgeschlagen: ${(e as Error).message} → nichts geändert.`);
    process.exit(1);
  }
  // Adress-Bindung (Defense-in-Depth): das Cert MUSS die gewählte Adresse als SAN tragen.
  if (!fetched.ipSans.includes(address) && !fetched.dnsSans.includes(address)) {
    console.error(`Adress-Bindung verletzt: Cert von ${address} führt weder IP- noch DNS-SAN "${address}" `
      + `(IP-SANs: ${fetched.ipSans.join(',') || '-'}; DNS: ${fetched.dnsSans.join(',') || '-'}) → nichts geändert.`);
    process.exit(1);
  }

  const res = canonicalizePairedPeer(peers[idx], fetched.pem, expectUri);
  if (!res.ok) {
    console.log(`skip (${res.skip}) — Eintrag "${onlyPeer}" bleibt unverändert.`);
    return;
  }
  console.log(`Re-Key: ${peers[idx].agentId}\n     → ${res.migrated.agentId}`);
  if (dryRun) { console.log('[DRY-RUN] Keine Datei geschrieben.'); return; }

  const out = [...peers];
  out[idx] = res.migrated;
  const backup = `${file}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  copyFileSync(file, backup);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(out, null, 2), { mode: 0o600 });
  renameSync(tmp, file);
  console.log(`Geschrieben: ${file}  (Backup: ${backup})`);
  console.log('WICHTIG: Daemon neu starten oder Trust-Reload abwarten, damit der neue Eintrag greift.');
}

void main().catch((e) => { console.error('Fehler:', e); process.exit(1); });
