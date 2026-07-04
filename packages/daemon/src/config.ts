import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir, hostname as osHostname } from 'node:os';
import TOML from '@iarna/toml';
import { resolveRuntimeSettings, type RuntimeMode } from './runtime-mode.js';
import { resolveLibp2pEnabled, resolveLibp2pListenPort } from './libp2p-runtime.js';
import { NODE_CERT_VALIDITY_DAYS } from './tls.js';

/** Strikte CIDR-Validierung (ADR-019). Akzeptiert nur IPv4 a.b.c.d/n mit n in 0..32. */
function isValidCidr(s: string): boolean {
  const [base, prefix] = s.split('/');
  if (!base || !prefix) return false;
  if (!/^\d{1,2}$/.test(prefix)) return false;
  const p = Number(prefix);
  if (p < 0 || p > 32) return false;
  const parts = base.split('.');
  if (parts.length !== 4) return false;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return false;
    const n = Number(part);
    if (n < 0 || n > 255) return false;
  }
  return true;
}

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
    /**
     * ADR-022 Phase 3: Wenn true, emittiert der Daemon seine kanonische
     * `spiffe://thinklocal/node/<PeerID>`-Identität als `envelope.sender` /
     * agent_id (statt Legacy `host/<id>`). Greift NUR, wenn libp2p aktiv ist
     * UND der laufende mTLS-Cert-SAN bereits kanonisch ist UND der Cert-Issuer
     * die attestierende CA ist (Cert-SAN VOR Sender-URI, ADR-022). Andernfalls
     * Fail-safe → Legacy. Default: true (sicher dank Fail-safe; ein Node ohne
     * node/<PeerID>-Attesting-Cert emittiert weiterhin Legacy).
     */
    emit_canonical_sender: boolean;
  };
  mesh: {
    heartbeat_interval_ms: number;
    heartbeat_timeout_missed: number;
  };
  discovery: {
    mdns_service_type: string;
    static_peers: StaticPeer[];
    /**
     * ADR-019: Erlaubte Mesh-CIDRs. Wenn gesetzt, werden nur Interfaces
     * verwendet deren IP in einem dieser CIDRs liegt. Empfangene Peer-IPs
     * werden ebenfalls gegen diese Liste validiert. Leer = auto-detect.
     */
    allowed_mesh_cidrs: string[];
    /**
     * ADR-019: Glob-Patterns fuer Interface-Namen die ausgeschlossen werden.
     * Default deckt typische virtuelle Interfaces ab (Docker, VPN, Bridges).
     */
    exclude_interface_patterns: string[];
    /**
     * Dual-homed-macOS-Workaround (.55): mDNS-Socket-Interface-Pin abschalten
     * (vergiftet sonst macOS connectx-scoped-routing → EHOSTUNREACH). Default false.
     */
    disable_mdns_interface_pin: boolean;
    /**
     * ADR-025: mDNS (bonjour-service) komplett abschalten. Wenn false, wird KEINE
     * Bonjour-Instanz erzeugt (publish/browse no-op) — Discovery läuft rein über
     * static_peers. Für static-only Nodes (z.B. dual-homed macOS .55), wo der
     * mDNS-Stack die connectx-Route vergiftet. Default true (mDNS aktiv wie bisher).
     */
    mdns_enabled: boolean;
    /**
     * ADR-025: Geordnete Interface-Namen-Präferenz für die Mesh-IP-Wahl. Wenn
     * mehrere Interfaces ein allowed_mesh_cidr matchen (z.B. /16 mit en10 wired +
     * en0 WiFi), gewinnen die hier zuerst gelisteten. Leer = bisheriges Verhalten
     * (deterministisch nach Interface-Name). Beispiel: ["en10", "en0"].
     */
    preferred_interfaces: string[];
    /**
     * ADR-026: symmetrische Discovery. Wenn true, lernt der Daemon einen authentifizierten,
     * issuer-gepinnt attestierten Inbound-Sender automatisch (Card-Fetch → AUTHN-only seen-Map),
     * sodass mDNS-lose / mobile / NAT-Nodes ohne manuellen static_peer am Hub auflösbar werden.
     * AUTHN-only (keine Autorisierung). Default true. Env TLMCP_AUTO_REGISTER_AUTH_PEERS=0 → aus.
     */
    auto_register_authenticated_peers: boolean;
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
  /**
   * ADR-028 D4-a: geteilte MCP-Server (Discovery default-open). Rohe `[[mcp.share]]`-
   * Einträge; validiert + default-open aufgelöst durch `parseSharedMcpConfig`
   * (mcp-share-config.ts). Typ bewusst lose (`unknown[]`) — die Validierung gehört
   * dorthin, nicht in den Config-Loader.
   */
  mcp: {
    share: unknown[];
    /**
     * Phantom-Announce-Guard (ADR-032): dieser Node announced seine deklarierten
     * `[[mcp.share]]`-MCPs NUR, wenn er als Provider designiert ist. Default `false`
     * (fail-safe) — das fleet-weite Config-Template deklariert MCPs (default-open),
     * aber nur der Hub setzt `serve_shared=true` (bzw. Env `TLMCP_MCP_SERVE_SHARED=1`)
     * und announced sie tatsächlich. Verhindert Phantom-Provider im CRDT.
     */
    serve_shared: boolean;
  };
  /**
   * ADR-030 (T1.3): SQLite-Wartung. `checkpoint_interval_ms` steuert den
   * periodischen `wal_checkpoint(TRUNCATE)` für `audit.db` + `activation.db`.
   * Die `*_max_age_days`-Felder steuern Retention; `0` = unbegrenzt (nur Checkpoint).
   */
  retention: {
    checkpoint_interval_ms: number;
    peer_audit_max_age_days: number;
    revoked_capability_max_age_days: number;
  };
  /**
   * T2.1: Live-Cert-Ablauf-Monitor. Der Daemon prüft das TLS-Node-Cert
   * periodisch (nicht nur beim Start) und alarmiert bei Unterschreiten der
   * Schwellen. Reissue selbst passiert weiterhin erst beim (Neu-)Start
   * (`loadOrCreateTlsBundle`, `daysLeft <= 7`) — siehe RE-CHECK-Verdikt.
   */
  cert: {
    expiry_warn_days: number;
    expiry_critical_days: number;
    expiry_check_interval_ms: number;
    /** Restlaufzeit-Schwelle (Tage): beim Start wird ein Node-Cert mit `daysLeft <= renew_before_days`
     *  neu ausgestellt (Behalten nur bei `> renew_before_days`). Default 30 (Wochen-Neustart-Rhythmus). */
    renew_before_days: number;
  };
  /**
   * T2.4: place-or-refuse. Übersteigt die (cache-bewusste) RAM-Auslastung diese
   * Schwelle (%), lehnt der Knoten neue Task-Platzierung ab. `resource_refresh_interval_ms`
   * steuert, wie oft die Resource-Attribute (free_ram/cpu_load/agent_count) in die
   * Registry geschrieben werden.
   */
  placement: {
    refuse_ram_percent: number;
    /**
     * T2.4-Folge: CPU-Last-Schwelle (%, 0..100). `0` = deaktiviert. Übersteigt die
     * (geglättete) CPU-Last diese Schwelle, lehnt der Knoten neue Platzierung ab.
     */
    refuse_cpu_percent: number;
    /**
     * T2.4-Folge: max. lokale Agenten-Anzahl. `0` = deaktiviert. Übersteigt
     * `agent_count` diese Schwelle, lehnt der Knoten neue Platzierung ab.
     */
    refuse_agent_count: number;
    resource_refresh_interval_ms: number;
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
    // ADR-022 Phase 3: Default-Sender ist kanonisch (node/<PeerID>). SICHER als Default,
    // weil resolveSelfIdentity fail-closed gatet — kanonisch wird NUR emittiert, wenn
    // (flag) UND der laufende mTLS-Cert-SAN bereits kanonisch ist UND der Cert-Issuer die
    // attestierende CA ist; sonst automatischer Fallback auf Legacy host/<id>. Ein Node ohne
    // node/<PeerID>-Cert emittiert also weiterhin Legacy. Committed-false ließ jeden Node beim
    // `git pull` auf Legacy zurückfallen (TH01/.55-Regression) — Default true behebt das durable.
    emit_canonical_sender: true,
  },
  mesh: {
    heartbeat_interval_ms: 10_000,
    heartbeat_timeout_missed: 3,
  },
  discovery: {
    mdns_service_type: '_thinklocal._tcp',
    static_peers: [],
    allowed_mesh_cidrs: [],
    exclude_interface_patterns: [],
    disable_mdns_interface_pin: false,
    mdns_enabled: true,
    preferred_interfaces: [],
    auto_register_authenticated_peers: true,
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
  mcp: {
    share: [],
    serve_shared: false,
  },
  retention: {
    checkpoint_interval_ms: 3_600_000, // 1 h
    peer_audit_max_age_days: 90,
    revoked_capability_max_age_days: 90,
  },
  cert: {
    expiry_warn_days: 30,
    expiry_critical_days: 7,
    expiry_check_interval_ms: 43_200_000, // 12 h
    renew_before_days: 30, // Reissue beim Start bei <= 30 d Restlaufzeit (Wochen-Neustart-Rhythmus)
  },
  placement: {
    refuse_ram_percent: 90,
    refuse_cpu_percent: 0, // deaktiviert per Default (opt-in) — CPU-Last ist spiky
    refuse_agent_count: 0, // deaktiviert per Default (opt-in) — deployment-spezifisch
    resource_refresh_interval_ms: 15_000, // 15 s
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
  // ADR-022 Phase 3: kanonischen node/<PeerID>-Sender emittieren (Per-Node-Flip).
  if (env['TLMCP_EMIT_CANONICAL_SENDER']) cfg.daemon.emit_canonical_sender = env['TLMCP_EMIT_CANONICAL_SENDER'] === '1';

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

  // 2c. ADR-019: Mesh-CIDRs und Interface-Excludes
  if (env['TLMCP_ALLOWED_MESH_CIDRS']) {
    cfg.discovery.allowed_mesh_cidrs = env['TLMCP_ALLOWED_MESH_CIDRS']
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);
  }
  if (env['TLMCP_EXCLUDE_INTERFACE_PATTERNS']) {
    cfg.discovery.exclude_interface_patterns = env['TLMCP_EXCLUDE_INTERFACE_PATTERNS']
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
  }
  // Dual-homed-macOS-Workaround (.55): mDNS-Interface-Pin abschalten.
  if (env['TLMCP_DISABLE_MDNS_INTERFACE_PIN']) {
    cfg.discovery.disable_mdns_interface_pin = env['TLMCP_DISABLE_MDNS_INTERFACE_PIN'] === '1';
  }
  // ADR-025: mDNS komplett abschalten (static-only). '0' → aus, alles andere gesetzte → an.
  if (env['TLMCP_MDNS_ENABLED']) {
    cfg.discovery.mdns_enabled = env['TLMCP_MDNS_ENABLED'] !== '0';
  }
  // ADR-025: geordnete Interface-Präferenz (komma-separiert, z.B. "en10,en0").
  if (env['TLMCP_PREFERRED_INTERFACES']) {
    cfg.discovery.preferred_interfaces = env['TLMCP_PREFERRED_INTERFACES']
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  // ADR-026: symmetrische Auth-Peer-Registrierung abschaltbar ('0' → aus).
  if (env['TLMCP_AUTO_REGISTER_AUTH_PEERS']) {
    cfg.discovery.auto_register_authenticated_peers = env['TLMCP_AUTO_REGISTER_AUTH_PEERS'] !== '0';
  }

  // ADR-032: Phantom-Announce-Guard. Nur ein designierter Provider (Hub) announced
  // seine deklarierten Shared-MCPs. Default false; Hub setzt TLMCP_MCP_SERVE_SHARED=1.
  if (env['TLMCP_MCP_SERVE_SHARED']) {
    cfg.mcp.serve_shared = env['TLMCP_MCP_SERVE_SHARED'] === '1';
  }
  // CR-L1 (fail-safe Coercion): ein non-boolean TOML-Wert (z.B. `serve_shared = "true"`)
  // darf den Security-Guard NICHT truthy umgehen — nur echtes boolean `true` aktiviert.
  cfg.mcp.serve_shared = cfg.mcp.serve_shared === true;

  // ADR-030 (T1.3): SQLite-Checkpoint/Retention.
  if (env['TLMCP_RETENTION_CHECKPOINT_MS']) {
    cfg.retention.checkpoint_interval_ms = readPositiveInt(
      'TLMCP_RETENTION_CHECKPOINT_MS',
      cfg.retention.checkpoint_interval_ms,
    );
  }
  if (env['TLMCP_PEER_AUDIT_MAX_AGE_DAYS']) {
    cfg.retention.peer_audit_max_age_days = readNonNegativeInt(
      'TLMCP_PEER_AUDIT_MAX_AGE_DAYS',
      cfg.retention.peer_audit_max_age_days,
    );
  }
  if (env['TLMCP_REVOKED_CAP_MAX_AGE_DAYS']) {
    cfg.retention.revoked_capability_max_age_days = readNonNegativeInt(
      'TLMCP_REVOKED_CAP_MAX_AGE_DAYS',
      cfg.retention.revoked_capability_max_age_days,
    );
  }

  // T2.1: Live-Cert-Ablauf-Monitor.
  if (env['TLMCP_CERT_EXPIRY_WARN_DAYS']) {
    cfg.cert.expiry_warn_days = readPositiveInt('TLMCP_CERT_EXPIRY_WARN_DAYS', cfg.cert.expiry_warn_days);
  }
  if (env['TLMCP_CERT_EXPIRY_CRITICAL_DAYS']) {
    cfg.cert.expiry_critical_days = readPositiveInt(
      'TLMCP_CERT_EXPIRY_CRITICAL_DAYS',
      cfg.cert.expiry_critical_days,
    );
  }
  if (env['TLMCP_CERT_EXPIRY_CHECK_INTERVAL_MS']) {
    cfg.cert.expiry_check_interval_ms = readPositiveInt(
      'TLMCP_CERT_EXPIRY_CHECK_INTERVAL_MS',
      cfg.cert.expiry_check_interval_ms,
    );
  }
  // Wochen-Neustart-Rhythmus (Kap. 13.4): Reissue-Schwelle beim Start, konfigurierbar.
  if (env['TLMCP_CERT_RENEW_BEFORE_DAYS']) {
    cfg.cert.renew_before_days = readPositiveInt('TLMCP_CERT_RENEW_BEFORE_DAYS', cfg.cert.renew_before_days);
  }

  // T2.4: place-or-refuse.
  if (env['TLMCP_PLACE_REFUSE_RAM_PERCENT']) {
    cfg.placement.refuse_ram_percent = readPositiveInt(
      'TLMCP_PLACE_REFUSE_RAM_PERCENT',
      cfg.placement.refuse_ram_percent,
    );
  }
  if (env['TLMCP_RESOURCE_REFRESH_INTERVAL_MS']) {
    cfg.placement.resource_refresh_interval_ms = readPositiveInt(
      'TLMCP_RESOURCE_REFRESH_INTERVAL_MS',
      cfg.placement.resource_refresh_interval_ms,
    );
  }
  // T2.4-Folge: CPU-/agent_count-Schwellen (0 = deaktiviert → readNonNegativeInt).
  if (env['TLMCP_PLACE_REFUSE_CPU_PERCENT']) {
    cfg.placement.refuse_cpu_percent = readNonNegativeInt(
      'TLMCP_PLACE_REFUSE_CPU_PERCENT',
      cfg.placement.refuse_cpu_percent,
    );
  }
  if (env['TLMCP_PLACE_REFUSE_AGENT_COUNT']) {
    cfg.placement.refuse_agent_count = readNonNegativeInt(
      'TLMCP_PLACE_REFUSE_AGENT_COUNT',
      cfg.placement.refuse_agent_count,
    );
  }

  // LOW-FIX (CR-Review): CIDRs validieren — fail fast statt silent.
  // Typos wie "10.10.10.0/33" oder "10.10.10.0/24foo" muessen sofort
  // sichtbar sein, sonst publish/browse-Verhalten ist stillschweigend kaputt.
  const invalidCidrs = cfg.discovery.allowed_mesh_cidrs.filter((c) => !isValidCidr(c));
  if (invalidCidrs.length > 0) {
    throw new Error(
      `Ungueltige CIDRs in discovery.allowed_mesh_cidrs: ${JSON.stringify(invalidCidrs)}. ` +
        `Erwartet: IPv4 a.b.c.d/n mit n in 0..32.`,
    );
  }

  // T2.1 (CR-LOW): warn-Schwelle MUSS > critical-Schwelle sein — fail fast statt
  // still. Bei warn <= critical wäre der warn-Tier unerreichbar (classifyCertExpiry
  // prüft critical zuerst) → alles unterhalb würde fälschlich als critical gewertet.
  if (cfg.cert.expiry_warn_days <= cfg.cert.expiry_critical_days) {
    throw new Error(
      `Ungueltige Cert-Schwellen: expiry_warn_days (${cfg.cert.expiry_warn_days}) ` +
        `muss > expiry_critical_days (${cfg.cert.expiry_critical_days}) sein.`,
    );
  }

  // CR-MEDIUM: `renew_before_days` post-merge validieren (auch der TOML-Pfad, den der
  // Env-`readPositiveInt` NICHT abdeckt). Ein 0/negativer Wert wäre fail-open (Cert würde
  // selbst bei Ablauf behalten); ein Wert ≥ Cert-Laufzeit erzwänge Reissue bei JEDEM Start
  // (frisches Cert sofort unter der Schwelle). Zulässig: Ganzzahl in [1, NODE_CERT_VALIDITY_DAYS-1].
  if (
    !Number.isInteger(cfg.cert.renew_before_days) ||
    cfg.cert.renew_before_days <= 0 ||
    cfg.cert.renew_before_days >= NODE_CERT_VALIDITY_DAYS
  ) {
    throw new Error(
      `Ungueltige cert.renew_before_days (${cfg.cert.renew_before_days}): muss eine Ganzzahl in ` +
        `[1, ${NODE_CERT_VALIDITY_DAYS - 1}] sein (0/negativ = fail-open bei Ablauf; ` +
        `>= ${NODE_CERT_VALIDITY_DAYS} = Reissue-Schleife bei jedem Start).`,
    );
  }

  // T2.4 (CR-Stil): RAM-Schwelle muss in (0, 100] liegen — sonst lehnt der Knoten
  // entweder nie (>100) oder immer (<=0) ab, beides stillschweigend falsch.
  if (cfg.placement.refuse_ram_percent <= 0 || cfg.placement.refuse_ram_percent > 100) {
    throw new Error(
      `Ungueltige placement.refuse_ram_percent (${cfg.placement.refuse_ram_percent}): erwartet 1..100.`,
    );
  }
  // T2.4-Folge: CPU-Schwelle in 0..100 (0 = deaktiviert). >100 = nie, <0 = sinnlos.
  if (cfg.placement.refuse_cpu_percent < 0 || cfg.placement.refuse_cpu_percent > 100) {
    throw new Error(
      `Ungueltige placement.refuse_cpu_percent (${cfg.placement.refuse_cpu_percent}): erwartet 0..100 (0 = aus).`,
    );
  }
  // T2.4-Folge: agent_count-Schwelle >= 0 (0 = deaktiviert).
  if (cfg.placement.refuse_agent_count < 0) {
    throw new Error(
      `Ungueltige placement.refuse_agent_count (${cfg.placement.refuse_agent_count}): erwartet >= 0 (0 = aus).`,
    );
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

/**
 * ADR-030 (T1.3): wie readPositiveInt, erlaubt aber `0` (= Retention deaktiviert).
 */
function readNonNegativeInt(envName: string, fallback: number): number {
  const raw = process.env[envName];
  if (raw == null) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(
      `Ungültige Konfiguration ${envName}: "${raw}" (erwartet: Ganzzahl ≥ 0)`,
    );
  }
  return value;
}

type JsonObject = { [key: string]: unknown };

function deepMerge(target: JsonObject, source: JsonObject): void {
  for (const key of Object.keys(source)) {
    const sv = source[key];
    const tv = target[key];
    // CR-MEDIUM (gpt-5.3-codex): auch das TARGET-Array vom rekursiven Merge ausschließen.
    // Sonst würde ein falsches TOML-Shape (Objekt) in ein Array-Default (z.B. `[mcp.share]`
    // statt `[[mcp.share]]`) hineingemerged statt sauber als Nicht-Array weitergereicht zu
    // werden — die nachgelagerte Validierung (parseSharedMcpConfig) erkennt es dann korrekt.
    if (sv && typeof sv === 'object' && !Array.isArray(sv) && tv && typeof tv === 'object' && !Array.isArray(tv)) {
      deepMerge(tv as JsonObject, sv as JsonObject);
    } else if (sv !== undefined && sv !== '') {
      target[key] = sv;
    }
  }
}
