import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir, hostname as osHostname } from 'node:os';
import TOML from '@iarna/toml';
import { resolveRuntimeSettings, type RuntimeMode } from './runtime-mode.js';
import { resolveLibp2pEnabled, resolveLibp2pListenPort } from './libp2p-runtime.js';

export interface StaticPeer {
  host: string;
  port?: number;
  name?: string;
}

export interface DaemonConfig {
  daemon: {
    port: number;
    bind_host: string;
    hostname: string;
    runtime_mode: RuntimeMode;
    tls_enabled: boolean;
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
  libp2p: {
    enabled: boolean;
    listen_port: number;
    mdns_service_tag: string;
    nat_traversal_enabled: boolean;
    relay_transport_enabled: boolean;
    relay_service_enabled: boolean;
    announce_multiaddrs: string[];
  };
  logging: {
    level: string;
  };
}

const DEFAULTS: DaemonConfig = {
  daemon: {
    port: 9440,
    bind_host: '0.0.0.0',
    hostname: osHostname(),
    runtime_mode: 'lan',
    tls_enabled: true,
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
  libp2p: {
    enabled: true,
    listen_port: 9540,
    mdns_service_tag: 'thinklocal-mcp',
    nat_traversal_enabled: true,
    relay_transport_enabled: true,
    relay_service_enabled: false,
    announce_multiaddrs: [],
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
  let tomlHasExplicitLibp2pPort = false;

  // 1. TOML-Datei laden (falls vorhanden)
  const tomlPath = configPath ?? resolve(process.cwd(), 'config', 'daemon.toml');
  if (existsSync(tomlPath)) {
    const raw = readFileSync(tomlPath, 'utf-8');
    const parsed = TOML.parse(raw);
    tomlHasExplicitLibp2pPort = typeof (parsed as { libp2p?: { listen_port?: unknown } }).libp2p?.listen_port === 'number';
    deepMerge(cfg as unknown as JsonObject, parsed as unknown as JsonObject);
  }

  // 2. Umgebungsvariablen überschreiben (TLMCP_-Präfix)
  const env = process.env;
  if (env['TLMCP_PORT']) cfg.daemon.port = readPositiveInt('TLMCP_PORT', cfg.daemon.port);
  if (env['TLMCP_BIND_HOST']) cfg.daemon.bind_host = env['TLMCP_BIND_HOST'];
  if (env['TLMCP_HOSTNAME']) cfg.daemon.hostname = env['TLMCP_HOSTNAME'];
  if (env['TLMCP_RUNTIME_MODE']) cfg.daemon.runtime_mode = env['TLMCP_RUNTIME_MODE'] === 'local' ? 'local' : 'lan';
  if (env['TLMCP_AGENT_TYPE']) cfg.daemon.agent_type = env['TLMCP_AGENT_TYPE'];
  if (env['TLMCP_DATA_DIR']) cfg.daemon.data_dir = env['TLMCP_DATA_DIR'];
  if (env['TLMCP_LIBP2P_ENABLED']) cfg.libp2p.enabled = env['TLMCP_LIBP2P_ENABLED'] === '1';
  if (env['TLMCP_LIBP2P_PORT']) cfg.libp2p.listen_port = readPositiveInt('TLMCP_LIBP2P_PORT', cfg.libp2p.listen_port);
  if (env['TLMCP_LIBP2P_MDNS_TAG']) cfg.libp2p.mdns_service_tag = env['TLMCP_LIBP2P_MDNS_TAG'];
  if (env['TLMCP_NAT_TRAVERSAL']) cfg.libp2p.nat_traversal_enabled = env['TLMCP_NAT_TRAVERSAL'] === '1';
  if (env['TLMCP_LIBP2P_RELAY_TRANSPORT']) cfg.libp2p.relay_transport_enabled = env['TLMCP_LIBP2P_RELAY_TRANSPORT'] === '1';
  if (env['TLMCP_LIBP2P_RELAY_SERVICE']) cfg.libp2p.relay_service_enabled = env['TLMCP_LIBP2P_RELAY_SERVICE'] === '1';
  if (env['TLMCP_LIBP2P_ANNOUNCE_ADDRS']) {
    cfg.libp2p.announce_multiaddrs = env['TLMCP_LIBP2P_ANNOUNCE_ADDRS']
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
  }
  if (env['TLMCP_LOG_LEVEL']) cfg.logging.level = env['TLMCP_LOG_LEVEL'];
  if (env['TLMCP_HEARTBEAT_MS'])
    cfg.mesh.heartbeat_interval_ms = readPositiveInt('TLMCP_HEARTBEAT_MS', cfg.mesh.heartbeat_interval_ms);
  if (env['TLMCP_NO_TLS']) cfg.daemon.tls_enabled = env['TLMCP_NO_TLS'] !== '1';

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
  const runtime = resolveRuntimeSettings({
    mode: cfg.daemon.runtime_mode,
    bindHost: cfg.daemon.bind_host,
    port: cfg.daemon.port,
    tlsEnabled: cfg.daemon.tls_enabled,
  });
  cfg.daemon.runtime_mode = runtime.mode;
  cfg.daemon.bind_host = runtime.bindHost;
  cfg.daemon.tls_enabled = runtime.tlsEnabled;
  cfg.libp2p.enabled = resolveLibp2pEnabled({
    runtimeMode: cfg.daemon.runtime_mode,
    explicitEnvOverride: env['TLMCP_LIBP2P_ENABLED'],
  });
  if (!cfg.libp2p.enabled) {
    cfg.libp2p.nat_traversal_enabled = false;
    cfg.libp2p.relay_transport_enabled = false;
    cfg.libp2p.relay_service_enabled = false;
  }
  cfg.libp2p.listen_port = resolveLibp2pListenPort({
    daemonPort: cfg.daemon.port,
    configuredPort: cfg.libp2p.listen_port,
    explicitPortConfigured: Boolean(env['TLMCP_LIBP2P_PORT']) || tomlHasExplicitLibp2pPort,
  });

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
