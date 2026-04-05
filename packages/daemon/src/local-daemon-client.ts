import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { request as httpRequest, type RequestOptions } from 'node:http';
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https';
import { isLoopbackHost, type RuntimeMode } from './runtime-mode.js';

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

function loadClientCert(dataDir: string): { cert: string; key: string } | undefined {
  const certPath = resolve(dataDir, 'tls', 'client.crt.pem');
  const keyPath = resolve(dataDir, 'tls', 'client.key.pem');
  if (!existsSync(certPath) || !existsSync(keyPath)) return undefined;
  return {
    cert: readFileSync(certPath, 'utf-8'),
    key: readFileSync(keyPath, 'utf-8'),
  };
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

    if (url.protocol === 'https:' && isLoopbackHost(url.hostname)) {
      const ca = loadLocalCa(dataDir);
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
