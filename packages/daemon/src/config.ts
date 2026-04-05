import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir, hostname as osHostname } from 'node:os';
import TOML from '@iarna/toml';

export interface StaticPeer {
  host: string;
  port?: number;
  name?: string;
}

export interface DaemonConfig {
  daemon: {
    port: number;
    hostname: string;
    agent_type: string;
    data_dir: string;
  };
  mesh: {
    heartbeat_interval_ms: number;
    heartbeat_timeout_missed: number;
  };
  discovery: {
    mdns_service_type: string;
    static_peers: StaticPeer[];
  };
  logging: {
    level: string;
  };
}

const DEFAULTS: DaemonConfig = {
  daemon: {
    port: 9440,
    hostname: osHostname(),
    agent_type: 'claude-code',
    data_dir: resolve(homedir(), '.thinklocal'),
  },
  mesh: {
    heartbeat_interval_ms: 10_000,
    heartbeat_timeout_missed: 3,
  },
  discovery: {
    mdns_service_type: '_thinklocal._tcp',
    static_peers: [],
  },
  logging: {
    level: 'info',
  },
};

function expandHome(p: string): string {
  return p.startsWith('~') ? resolve(homedir(), p.slice(2)) : p;
}

export function loadConfig(configPath?: string): DaemonConfig {
  const cfg = structuredClone(DEFAULTS);

  // 1. TOML-Datei laden (falls vorhanden)
  const tomlPath = configPath ?? resolve(process.cwd(), 'config', 'daemon.toml');
  if (existsSync(tomlPath)) {
    const raw = readFileSync(tomlPath, 'utf-8');
    const parsed = TOML.parse(raw);
    deepMerge(cfg as unknown as JsonObject, parsed as unknown as JsonObject);
  }

  // 2. Umgebungsvariablen überschreiben (TLMCP_-Präfix)
  const env = process.env;
  if (env['TLMCP_PORT']) cfg.daemon.port = readPositiveInt('TLMCP_PORT', cfg.daemon.port);
  if (env['TLMCP_HOSTNAME']) cfg.daemon.hostname = env['TLMCP_HOSTNAME'];
  if (env['TLMCP_AGENT_TYPE']) cfg.daemon.agent_type = env['TLMCP_AGENT_TYPE'];
  if (env['TLMCP_DATA_DIR']) cfg.daemon.data_dir = env['TLMCP_DATA_DIR'];
  if (env['TLMCP_LOG_LEVEL']) cfg.logging.level = env['TLMCP_LOG_LEVEL'];
  if (env['TLMCP_HEARTBEAT_MS'])
    cfg.mesh.heartbeat_interval_ms = readPositiveInt('TLMCP_HEARTBEAT_MS', cfg.mesh.heartbeat_interval_ms);

  // 2b. Statische Peers aus TLMCP_STATIC_PEERS (komma-separiert: "host:port,host2:port2")
  if (env['TLMCP_STATIC_PEERS']) {
    cfg.discovery.static_peers = env['TLMCP_STATIC_PEERS']
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [host, portStr] = entry.split(':');
        return { host, port: portStr ? Number.parseInt(portStr, 10) : undefined };
      });
  }

  // 3. Hostname auffüllen und Pfad expandieren
  if (!cfg.daemon.hostname) cfg.daemon.hostname = osHostname();
  cfg.daemon.data_dir = expandHome(cfg.daemon.data_dir);

  return cfg;
}

function readPositiveInt(envName: string, fallback: number): number {
  const raw = process.env[envName];
  if (raw == null) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Ungültige Konfiguration ${envName}: "${raw}" (erwartet: positive Ganzzahl)`);
  }
  return value;
}

type JsonObject = { [key: string]: unknown };

function deepMerge(target: JsonObject, source: JsonObject): void {
  for (const key of Object.keys(source)) {
    const sv = source[key];
    const tv = target[key];
    if (sv && typeof sv === 'object' && !Array.isArray(sv) && tv && typeof tv === 'object') {
      deepMerge(tv as JsonObject, sv as JsonObject);
    } else if (sv !== undefined && sv !== '') {
      target[key] = sv;
    }
  }
}
