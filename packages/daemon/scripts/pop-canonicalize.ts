// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * pop-canonicalize.ts — ADR-022 Schritt 3 / WS-3: PoP-Cert-Ausstellung für den lokalen Node.
 *
 * PROBLEM (Stand 2026-11-02): Der Token-Join (`/onboarding/join`, `token-api.ts`) ist hart auf
 * Legacy-SPIFFE-URIs verdrahtet:
 *
 *   const SPIFFE_REGEX = /^spiffe:\/\/[a-zA-Z0-9.-]+\/host\/[a-zA-Z0-9._-]+\/agent\/[a-zA-Z0-9._-]+$/;
 *
 * Er kann deshalb **kein** kanonisches `spiffe://thinklocal/node/<PeerID>`-Cert ausstellen. Der
 * MCP-Ingress akzeptiert aber NUR kanonische Sender (`extractCanonicalSender` → `authorizeHttpsSender`,
 * fail-closed bei Legacy). Folge: jeder per Token gejointe Peer liefert `403 sender not authorized`.
 *
 * LÖSUNG: Der Admin-Node hat die PoP-Routen bereits live:
 *   POST /api/cert/nonce   → { nonce, caFingerprint }
 *   POST /api/cert/sign    → { certPem }   (CSR + Ed25519-PoP-Signatur)
 * Der Client-Code existiert ebenfalls (`cert-request.ts`), ist aber nirgends aufrufbar — es fehlte
 * ein aufrufbares Skript. Dieses Skript ist genau das.
 *
 * ABLauf (lokal auf dem Peer auszuführen):
 *   1. libp2p-Ed25519-Key aus `<dataDir>/keys/libp2p-ed25519.key` laden → PeerID (Wurzel der Identität).
 *   2. Über das BESTEHENDE (Legacy-)mTLS-Cert beim Admin-Nonce holen — der Admin erkennt den
 *      Node als Mesh-Mitglied (mTLS-Mitgliedschafts-Gate).
 *   3. Frisches X.509-Keypair + CSR erzeugen (privater TLS-Key bleibt LOKAL).
 *   4. PoP-Scope mit dem Ed25519-Key signieren (bindet PeerID ↔ CSR-Public-Key ↔ CA-Fingerprint).
 *   5. Cert vom Admin signieren lassen und unter `tls/node.crt.pem` + `tls/node.key.pem` ablegen.
 *
 * Das Ergebnis ist ein Cert mit SAN `spiffe://thinklocal/node/<PeerID>` — kanonisch, damit der
 * MCP-Ingress den Node als Sender akzeptiert.
 *
 * AUFRUFBEISPIEL:
 *   npx tsx scripts/pop-canonicalize.ts --admin-url https://10.10.10.80:9440
 *
 * SICHERHEIT:
 *   - Der private TLS-Key verlässt den Node NIE (nur der CSR geht zum Admin).
 *   - Der libp2p-Ed25519-Key wird nur zum SIGNIEREN des PoP-Scopes benutzt, nie ausgegeben.
 *   - Kein Token, kein Secret wird geloggt.
 *   - Bestehende Certs werden vor dem Überschreiben nach `tls/pre-pop-<timestamp>/` gesichert.
 */
import { readFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { privateKeyFromProtobuf } from '@libp2p/crypto/keys';
import { peerIdFromPrivateKey } from '@libp2p/peer-id';
import { Agent, type Dispatcher } from 'undici';
import { requestNodeCert } from '../src/cert-request.js';
import { loadOrCreateLibp2pPrivateKey, libp2pPeerIdString } from '../src/libp2p-identity.js';

interface Args {
  adminUrl: string;
  dataDir: string;
  dryRun: boolean;
}

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let adminUrl = 'https://10.10.10.80:9440';
  let dataDir = resolve(homedir(), '.thinklocal');
  let dryRun = false;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '--admin-url' && raw[i + 1]) adminUrl = raw[++i];
    else if (raw[i] === '--data-dir' && raw[i + 1]) dataDir = resolve(raw[++i]);
    else if (raw[i] === '--dry-run') dryRun = true;
  }
  return { adminUrl, dataDir, dryRun };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const tlsDir = resolve(args.dataDir, 'tls');
  const certPath = resolve(tlsDir, 'node.crt.pem');
  const keyPath = resolve(tlsDir, 'node.key.pem');
  const caPath = resolve(tlsDir, 'ca.crt.pem');

  console.log('=== PoP-Kanonisierung (node/<PeerID>) ===');
  console.log(`data-dir:   ${args.dataDir}`);
  console.log(`admin-url:  ${args.adminUrl}`);

  // --- Voraussetzungen prüfen (fail-closed, kein Blind-Trust) ---
  for (const p of [certPath, keyPath, caPath]) {
    if (!existsSync(p)) {
      throw new Error(`Voraussetzung fehlt: ${p} — Peer ist nicht (vollständig) onboarded.`);
    }
  }

  // --- libp2p-Key laden → PeerID ---
  const { privateKey, peerId } = await loadOrCreateLibp2pPrivateKey(args.dataDir);
  console.log(`peer-id:    ${peerId}`);
  console.log(`kanonische URI: spiffe://thinklocal/node/${peerId}`);

  if (args.dryRun) {
    console.log('\n[dry-run] Keine Cert-Anforderung gesendet.');
    return;
  }

  // --- mTLS-Dispatcher mit dem BESTEHENDEN (Legacy-)Cert ---
  // Der Admin erkennt den Node so als Mesh-Mitglied; der PoP bindet danach die Identität.
  const agent = new Agent({
    connect: {
      ca: [readFileSync(caPath, 'utf-8')],
      cert: readFileSync(certPath, 'utf-8'),
      key: readFileSync(keyPath, 'utf-8'),
      rejectUnauthorized: true,
      servername: 'localhost',
    },
  });

  try {
    const result = await requestNodeCert({
      adminUrl: args.adminUrl,
      privateKey,
      peerId,
      hostname: (await import('node:os')).hostname(),
      fetchImpl: (async (url: string, init: any) => {
        const u = new URL(url);
        const res = await agent.request({
          method: init.method,
          origin: u.origin,
          path: u.pathname + u.search,
          headers: init.headers,
          body: init.body,
        });
        const text = await res.body.text();
        return {
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          json: async () => JSON.parse(text),
          text: async () => text,
        };
      }) as any,
      dispatcher: agent as unknown as Dispatcher,
      timeoutMs: 15_000,
    });

    console.log('\n=== Cert erhalten ===');
    console.log(`spiffeUri: ${result.spiffeUri}`);

    // --- Bestehende Certs sichern (fail-safe vor Überschreiben) ---
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = resolve(tlsDir, `pre-pop-${stamp}`);
    mkdirSync(backupDir, { recursive: true });
    for (const p of [certPath, keyPath, caPath]) {
      if (existsSync(p)) copyFileSync(p, resolve(backupDir, p.split('/').pop()!));
    }
    console.log(`Backup:    ${backupDir}`);

    // --- Neues Cert schreiben (0600 für den Key) ---
    const { writeFileSync, chmodSync } = await import('node:fs');
    writeFileSync(certPath, result.certPem, { mode: 0o644 });
    writeFileSync(keyPath, result.keyPem, { mode: 0o600 });
    chmodSync(keyPath, 0o600);
    console.log(`Cert:      ${certPath}`);
    console.log(`Key:       ${keyPath}`);

    console.log('\n=== Nächster Schritt ===');
    console.log('  Daemon neu starten:  thinklocal restart --lan');
  } finally {
    await agent.close();
  }
}

main().catch((err) => {
  console.error(`\nFEHLER: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
