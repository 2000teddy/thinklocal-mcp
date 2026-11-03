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
 *   1. Persistierten libp2p-Ed25519-Key aus `<dataDir>/keys/libp2p-ed25519.key` laden → PeerID
 *      (Wurzel der Identität). **Fail-closed:** fehlt die Datei, bricht der Lauf ab, statt eine
 *      neue PeerID zu erzeugen (s. „IDENTITÄT" unten).
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
 * IDENTITÄT (fail-closed, Review-Fund 3):
 *   `loadOrCreateLibp2pPrivateKey()` ist load-**or-create**. Ohne Vorprüfung würde dieses Skript auf
 *   einem Node ohne persistierten Key still eine NEUE PeerID erzeugen und ein Cert für eine Identität
 *   holen, die der Mesh nicht kennt. Deshalb wird die Key-Datei vorab wie Cert/Key/CA als
 *   Voraussetzung geprüft — dieses Skript erzeugt nie eine Identität, es kanonisiert eine bestehende.
 *
 * TLS-HOSTNAME (Review-Fund 5):
 *   Der SNI/Hostname für die Admin-Verbindung ist per Default `localhost`, weil JEDES von `tls.ts`
 *   ausgestellte Node-Cert `DNS:localhost` im SAN führt — das ist mesh-weit der portabelste Name und
 *   unabhängig davon, ob `--admin-url` eine IP oder einen Hostnamen nennt. Für einen Admin, dessen
 *   Cert diesen SAN nicht hat, gibt es `--servername <name>`.
 *
 * SICHERHEIT:
 *   - Der private TLS-Key verlässt den Node NIE (nur der CSR geht zum Admin).
 *   - Der libp2p-Ed25519-Key wird nur zum SIGNIEREN des PoP-Scopes benutzt, nie ausgegeben.
 *   - Kein Token, kein Secret wird geloggt.
 *   - Bestehende Certs werden vor dem Überschreiben nach `tls/pre-pop-<timestamp>/` gesichert —
 *     das Verzeichnis mit `0700`, weil ein privater Key darin liegt (Review-Fund 4).
 */
import {
  readFileSync, existsSync, mkdirSync, copyFileSync, writeFileSync, chmodSync, realpathSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { homedir, hostname } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Agent, type Dispatcher } from 'undici';
import { requestNodeCert } from '../src/cert-request.js';
import { loadOrCreateLibp2pPrivateKey, LIBP2P_KEY_FILENAME } from '../src/libp2p-identity.js';

/** Default-SNI: jedes von `tls.ts` ausgestellte Node-Cert führt `DNS:localhost` im SAN. */
export const DEFAULT_SERVERNAME = 'localhost';
/** Backup-Verzeichnis enthält einen privaten Key ⇒ nicht welt-lesbar. */
export const BACKUP_DIR_MODE = 0o700;

export interface Args {
  adminUrl: string;
  dataDir: string;
  dryRun: boolean;
  servername: string;
}

/** Wert eines Flags — ein folgendes `--flag` ist KEIN Wert, sondern das naechste Flag. */
function optionValue(raw: string[], i: number): string | undefined {
  const next = raw[i + 1];
  return next !== undefined && !next.startsWith('--') ? next : undefined;
}

export function parseArgs(raw: string[]): Args {
  let adminUrl = 'https://10.10.10.80:9440';
  let dataDir = resolve(homedir(), '.thinklocal');
  let dryRun = false;
  let servername = DEFAULT_SERVERNAME;
  for (let i = 0; i < raw.length; i++) {
    const value = optionValue(raw, i);
    if (raw[i] === '--admin-url' && value !== undefined) { adminUrl = value; i++; }
    else if (raw[i] === '--data-dir' && value !== undefined) { dataDir = resolve(value); i++; }
    else if (raw[i] === '--servername' && value !== undefined) { servername = value; i++; }
    else if (raw[i] === '--dry-run') dryRun = true;
  }
  return { adminUrl, dataDir, dryRun, servername };
}

/**
 * Prüft ALLE Voraussetzungen fail-closed, bevor irgendetwas erzeugt wird — inklusive der
 * libp2p-Key-Datei, damit `loadOrCreateLibp2pPrivateKey()` nicht in den Create-Pfad läuft.
 */
export function assertOnboarded(dataDir: string): void {
  const tlsDir = resolve(dataDir, 'tls');
  const required = [
    resolve(tlsDir, 'node.crt.pem'),
    resolve(tlsDir, 'node.key.pem'),
    resolve(tlsDir, 'ca.crt.pem'),
  ];
  for (const p of required) {
    if (!existsSync(p)) {
      throw new Error(`Voraussetzung fehlt: ${p} — Peer ist nicht (vollständig) onboarded.`);
    }
  }
  const keyPath = resolve(dataDir, 'keys', LIBP2P_KEY_FILENAME);
  if (!existsSync(keyPath)) {
    throw new Error(
      `Voraussetzung fehlt: ${keyPath} — ohne persistierten libp2p-Key würde eine NEUE PeerID ` +
        'entstehen. Dieses Skript kanonisiert eine bestehende Identität, es erzeugt keine.',
    );
  }
}

type FetchInit = {
  method: string;
  headers: Record<string, string>;
  body?: string;
  dispatcher?: unknown;
  signal?: AbortSignal;
};
type FetchResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
};

/**
 * undici-Adapter für `requestNodeCert`. Leitet `signal` durch (sonst ist `timeoutMs` wirkungslos
 * und ein hängender Admin blockiert unbegrenzt — Review-Fund 2) und benutzt den von
 * `requestNodeCert` übergebenen `dispatcher`, statt ihn zu ignorieren (Review-Fund 6).
 */
export function createMtlsFetch(fallback: Dispatcher) {
  return async (url: string, init: FetchInit): Promise<FetchResponse> => {
    const u = new URL(url);
    const dispatcher = (init.dispatcher as Dispatcher | undefined) ?? fallback;
    const res = await dispatcher.request({
      method: init.method as Dispatcher.HttpMethod,
      origin: u.origin,
      path: u.pathname + u.search,
      headers: init.headers,
      body: init.body,
      signal: init.signal,
    });
    const text = await res.body.text();
    return {
      ok: res.statusCode >= 200 && res.statusCode < 300,
      status: res.statusCode,
      json: async () => JSON.parse(text),
      text: async () => text,
    };
  };
}

/**
 * Baut die mTLS-`connect`-Optionen für den Admin-Agent. Ausgelagert, damit die Durchreichung von
 * `args.servername` an die Senke testbar ist und nicht nur in `parseArgs` (CR-LOW 1).
 */
export function buildConnectOptions(
  args: Pick<Args, 'servername'>,
  pems: { ca: string; cert: string; key: string },
): { ca: string[]; cert: string; key: string; rejectUnauthorized: true; servername: string } {
  return {
    ca: [pems.ca],
    cert: pems.cert,
    key: pems.key,
    rejectUnauthorized: true,
    servername: args.servername,
  };
}

/** Sichert Cert/Key/CA nach `tls/pre-pop-<stamp>/` (Verzeichnis `0700`) und liefert den Pfad. */
export function backupExistingTls(tlsDir: string, stamp: string): string {
  const backupDir = resolve(tlsDir, `pre-pop-${stamp}`);
  mkdirSync(backupDir, { recursive: true, mode: BACKUP_DIR_MODE });
  for (const name of ['node.crt.pem', 'node.key.pem', 'ca.crt.pem']) {
    const src = resolve(tlsDir, name);
    if (existsSync(src)) copyFileSync(src, resolve(backupDir, name));
  }
  return backupDir;
}

export async function main(args: Args): Promise<void> {
  const tlsDir = resolve(args.dataDir, 'tls');
  const certPath = resolve(tlsDir, 'node.crt.pem');
  const keyPath = resolve(tlsDir, 'node.key.pem');
  const caPath = resolve(tlsDir, 'ca.crt.pem');

  console.log('=== PoP-Kanonisierung (node/<PeerID>) ===');
  console.log(`data-dir:   ${args.dataDir}`);
  console.log(`admin-url:  ${args.adminUrl}`);
  console.log(`servername: ${args.servername}`);

  // --- Voraussetzungen prüfen (fail-closed, kein Blind-Trust, keine Identitäts-Neuerzeugung) ---
  assertOnboarded(args.dataDir);

  // --- libp2p-Key laden → PeerID (Existenz ist oben geprüft) ---
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
    connect: buildConnectOptions(args, {
      ca: readFileSync(caPath, 'utf-8'),
      cert: readFileSync(certPath, 'utf-8'),
      key: readFileSync(keyPath, 'utf-8'),
    }),
  });

  try {
    const result = await requestNodeCert({
      adminUrl: args.adminUrl,
      privateKey,
      peerId,
      hostname: hostname(),
      fetchImpl: createMtlsFetch(agent as unknown as Dispatcher),
      dispatcher: agent as unknown as Dispatcher,
      timeoutMs: 15_000,
    });

    console.log('\n=== Cert erhalten ===');
    console.log(`spiffeUri: ${result.spiffeUri}`);

    // --- Bestehende Certs sichern (fail-safe vor Überschreiben) ---
    console.log(`Backup:    ${backupExistingTls(tlsDir, new Date().toISOString().replace(/[:.]/g, '-'))}`);

    // --- Neues Cert schreiben (0600 für den Key) ---
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

// Nur beim direkten Aufruf ausführen — sonst würde schon der Import im Test den Lauf starten.
// `realpathSync` auf beiden Seiten, weil Node `import.meta.url` aufgelöst liefert, `process.argv[1]`
// aber den Symlink behalten kann (CR-NIT 1).
function resolvedRealPath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

const entry = process.argv[1];
const invokedDirectly =
  entry !== undefined && resolvedRealPath(entry) === resolvedRealPath(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  main(parseArgs(process.argv.slice(2))).catch((err) => {
    console.error(`\nFEHLER: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
