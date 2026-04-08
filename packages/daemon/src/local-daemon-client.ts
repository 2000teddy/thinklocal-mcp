import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { request as httpRequest, type RequestOptions } from 'node:http';
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https';
import { type RuntimeMode } from './runtime-mode.js';

export interface DaemonRequestOptions {
  baseUrl?: string;
  body?: unknown;
  dataDir?: string;
  method?: 'GET' | 'POST' | 'DELETE';
  timeoutMs?: number;
}

export function getDefaultDataDir(): string {
  return process.env['TLMCP_DATA_DIR'] ?? resolve(homedir(), '.thinklocal');
}

export function getDefaultLocalDaemonUrl(port = 9440, runtimeMode: RuntimeMode = 'local'): string {
  const proto = runtimeMode === 'lan' ? 'https' : 'http';
  return `${proto}://localhost:${port}`;
}

function getLocalCaPath(dataDir: string): string {
  return resolve(dataDir, 'tls', 'ca.crt.pem');
}

function loadLocalCa(dataDir: string): string | undefined {
  const caPath = getLocalCaPath(dataDir);
  if (!existsSync(caPath)) return undefined;
  return readFileSync(caPath, 'utf-8');
}

/**
 * Laedt den vollen Mesh Trust-Store fuer mTLS Outbound-Verbindungen:
 * - eigene Mesh-CA (tls/ca.crt.pem)
 * - CAs aller via SPAKE2/ssh-bootstrap gepairten Peers (aus pairing/paired-peers.json)
 *
 * Rueckgabe ist ein string[] mit PEM-Bloecken oder undefined wenn nichts
 * geladen werden konnte. Node's https.Agent akzeptiert ca als Array.
 *
 * Das ist der gleiche Pattern wie im Daemon selbst (siehe trust-store.ts),
 * nur fuer den Out-of-Process MCP-Stdio-Server, der seinen eigenen
 * https-Agent bauen muss.
 */
function loadMeshTrustBundle(dataDir: string): string[] | undefined {
  const bundle: string[] = [];

  const ownCa = loadLocalCa(dataDir);
  if (ownCa) {
    bundle.push(ownCa);
  }

  // Peer-CAs aus paired-peers.json
  const pairingFile = resolve(dataDir, 'pairing', 'paired-peers.json');
  if (existsSync(pairingFile)) {
    try {
      const raw = readFileSync(pairingFile, 'utf-8');
      const peers = JSON.parse(raw) as Array<{ caCertPem?: string }>;
      for (const peer of peers) {
        if (peer.caCertPem && peer.caCertPem.includes('BEGIN CERTIFICATE')) {
          bundle.push(peer.caCertPem);
        }
      }
    } catch {
      // Best effort — wenn paired-peers.json kaputt ist, arbeiten wir nur mit der eigenen CA
    }
  }

  return bundle.length > 0 ? bundle : undefined;
}

function loadClientCert(dataDir: string): { cert: string; key: string } | undefined {
  // Try dedicated client cert first, then fall back to node cert (used for mTLS)
  const candidates = [
    { cert: resolve(dataDir, 'tls', 'client.crt.pem'), key: resolve(dataDir, 'tls', 'client.key.pem') },
    { cert: resolve(dataDir, 'tls', 'node.crt.pem'), key: resolve(dataDir, 'tls', 'node.key.pem') },
  ];
  for (const paths of candidates) {
    if (existsSync(paths.cert) && existsSync(paths.key)) {
      return {
        cert: readFileSync(paths.cert, 'utf-8'),
        key: readFileSync(paths.key, 'utf-8'),
      };
    }
  }
  return undefined;
}

export async function requestDaemon(
  path: string,
  options: DaemonRequestOptions = {},
): Promise<{ status: number; body: string }> {
  const method = options.method ?? 'GET';
  const dataDir = options.dataDir ?? getDefaultDataDir();
  const timeoutMs = options.timeoutMs ?? 5_000;
  const baseUrl = options.baseUrl ?? getDefaultLocalDaemonUrl();
  const url = new URL(path, baseUrl);
  const payload = options.body === undefined ? undefined : JSON.stringify(options.body);

  const headers: Record<string, string> = {};
  if (payload !== undefined) {
    headers['content-type'] = 'application/json';
    headers['content-length'] = Buffer.byteLength(payload).toString();
  }

  return new Promise((resolvePromise, reject) => {
    const reqFactory = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const requestOptions: RequestOptions = {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method,
      headers,
    };

    // mTLS-Agent fuer HTTPS. Frueher nur fuer loopback aktiviert — aber dann
    // scheitert execute_remote_skill gegen LAN-Peers (siehe Codex-Bugreport
    // vom 2026-04-08). Jetzt immer: wenn HTTPS-URL und lokale Certs vorhanden,
    // wird der Mesh-Trust-Store geladen. Das ist semantisch korrekt, denn der
    // Trust-Store enthaelt die CAs ALLER gepairten Peers (PR #75) — nicht nur
    // localhost. Wenn der Peer nicht gepairt ist, scheitert der TLS-Handshake
    // sauber mit "certificate signature failure" statt mit dem kryptischen
    // "Empty reply from server" aus dem Codex-Befund.
    //
    // Fuer Remote-Peers lesen wir zusaetzlich die paired-peers.json und
    // aggregieren die Peer-CAs ins Agent-CA-Bundle, damit mTLS gegen fremde
    // Subjects funktioniert.
    if (url.protocol === 'https:') {
      const ca = loadMeshTrustBundle(dataDir);
      const clientCert = loadClientCert(dataDir);
      if (ca) {
        const agentOpts: Record<string, unknown> = { ca, rejectUnauthorized: true };
        if (clientCert) {
          agentOpts.cert = clientCert.cert;
          agentOpts.key = clientCert.key;
        }
        requestOptions.agent = new HttpsAgent(agentOpts);
      }
    }

    const req = reqFactory(requestOptions, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on('end', () => {
        resolvePromise({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf-8'),
        });
      });
    });

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Daemon request timeout after ${timeoutMs}ms`)));

    if (payload !== undefined) {
      req.write(payload);
    }
    req.end();
  });
}

export async function requestDaemonJson<T>(
  path: string,
  options: DaemonRequestOptions = {},
): Promise<T> {
  const res = await requestDaemon(path, options);
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Daemon API error: ${res.status}`);
  }
  return JSON.parse(res.body) as T;
}
