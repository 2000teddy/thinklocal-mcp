#!/usr/bin/env node
/**
 * thinklocal — Zentrale CLI fuer thinklocal-mcp Mesh-Verwaltung
 *
 * Befehle:
 *   thinklocal start          Daemon starten (als Vordergrund-Prozess oder Service)
 *   thinklocal stop           Daemon stoppen
 *   thinklocal restart        Daemon neu starten
 *   thinklocal status         Status anzeigen (laeuft?, Peers, Capabilities)
 *   thinklocal doctor         Diagnostik (Keys, Certs, Daemon, Peers, MCP)
 *   thinklocal logs           Live-Logs anzeigen
 *   thinklocal bootstrap      Ersteinrichtung (Keys, Config, Service, MCP)
 *   thinklocal peers          Verbundene Peers anzeigen
 *   thinklocal config show    Aktuelle Konfiguration anzeigen
 *
 * Alle Befehle funktionieren ohne Argumente mit sinnvollen Defaults.
 */

import { resolve } from 'node:path';
import { homedir, platform } from 'node:os';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, statSync } from 'node:fs';
import { execSync, spawn, spawnSync } from 'node:child_process';
import { getDefaultLocalDaemonUrl, requestDaemon, requestDaemonJson } from '../../daemon/src/local-daemon-client.js';
import { resolveRuntimeSettings, parseRuntimeMode, type RuntimeMode } from '../../daemon/src/runtime-mode.js';
import { runHeartbeatCommand } from './thinklocal-heartbeat.js';

const HOME = homedir();
const PLATFORM = platform();
const DATA_DIR = process.env['TLMCP_DATA_DIR'] ?? resolve(HOME, '.thinklocal');
const DAEMON_PORT = Number(process.env['TLMCP_PORT'] ?? '9440');
const INSTALL_DIR = resolve(import.meta.dirname, '..', '..', '..');
const ALLOW_PLAINTEXT_GIT_CREDENTIALS = process.env['TLMCP_ALLOW_PLAINTEXT_GIT_CREDENTIALS'] === '1';
const DEFAULT_RUNTIME_MODE = parseRuntimeMode(process.env['TLMCP_RUNTIME_MODE'] ?? 'local');

// --- Sicherheits-Hilfsfunktionen ---

/** XML-Escaping fuer launchd plist-Werte */
function xmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/** systemd-Escaping fuer Unit-Werte */
function systemdEscape(value: string): string {
  if (/[\r\n]/.test(value)) throw new Error('Ungueltige Zeichen in systemd-Wert');
  return `"${value.replace(/(["\\])/g, '\\$1')}"`;
}

/** Atomisches Schreiben: temp-Datei + rename */
function atomicWrite(filePath: string, content: string, mode = 0o600): void {
  const tmp = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tmp, content, { mode });
  renameSync(tmp, filePath);
}

function getClaudeDesktopConfigPath(): string {
  if (PLATFORM === 'darwin') {
    return resolve(HOME, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  if (PLATFORM === 'linux') {
    return resolve(HOME, '.config', 'Claude', 'claude_desktop_config.json');
  }
  if (PLATFORM === 'win32') {
    return resolve(process.env['APPDATA'] ?? HOME, 'Claude', 'claude_desktop_config.json');
  }
  return '';
}

function resolveCliRuntimeMode(flags: string[], fallback: RuntimeMode = DEFAULT_RUNTIME_MODE): RuntimeMode {
  if (flags.includes('--local')) return 'local';
  if (flags.includes('--lan')) return 'lan';
  return fallback;
}

function getRuntimeSettingsFor(flags: string[], fallback: RuntimeMode = DEFAULT_RUNTIME_MODE) {
  return resolveRuntimeSettings({
    mode: resolveCliRuntimeMode(flags, fallback),
    bindHost: process.env['TLMCP_BIND_HOST'],
    port: DAEMON_PORT,
    tlsEnabled: process.env['TLMCP_NO_TLS'] ? process.env['TLMCP_NO_TLS'] !== '1' : null,
  });
}

/** Laedt .env-Datei und gibt key=value Paare zurueck (nur bekannte Service-Variablen) */
function loadServiceEnvVars(): Record<string, string> {
  const envPath = resolve(INSTALL_DIR, '.env');
  const vars: Record<string, string> = {};
  // Nur diese Variablen werden in den Service uebernommen (keine Secrets wie GITHUB_TOKEN!)
  const allowedKeys = new Set(['TELEGRAM_BOT_TOKEN', 'TELEGRAM_ALLOWED_CHATS', 'INFLUXDB_USERNAME', 'INFLUXDB_PASSWORD']);

  if (!existsSync(envPath)) return vars;
  try {
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex < 1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      if (allowedKeys.has(key) && value) {
        vars[key] = value;
      }
    }
  } catch { /* .env nicht lesbar — ignorieren */ }
  return vars;
}

// --- Farben ---
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  dim: '\x1b[2m',
};

function ok(msg: string): void { console.log(`  ${C.green}✓${C.reset} ${msg}`); }
function fail(msg: string): void { console.log(`  ${C.red}✗${C.reset} ${msg}`); }
function info(msg: string): void { console.log(`  ${C.blue}ℹ${C.reset} ${msg}`); }
function warn(msg: string): void { console.log(`  ${C.yellow}⚠${C.reset} ${msg}`); }
function header(msg: string): void { console.log(`\n  ${C.bold}${msg}${C.reset}\n`); }

// --- Health-Check ---
async function isDaemonRunning(): Promise<boolean> {
  // 1. HTTP Health-Check (schnellster Weg)
  try {
    const localUrl = getDefaultLocalDaemonUrl(DAEMON_PORT, DEFAULT_RUNTIME_MODE);
    const res = await requestDaemon('/health', { baseUrl: localUrl, dataDir: DATA_DIR, timeoutMs: 2_000 });
    if (res.status >= 200 && res.status < 300) return true;
  } catch { /* weiter */ }

  // 2. Port-Check (fuer HTTPS/mTLS wo HTTP fehlschlaegt)
  try {
    const output = execSync(`lsof -ti :${DAEMON_PORT} 2>/dev/null`, { encoding: 'utf-8' }).trim();
    if (output) return true;
  } catch { /* weiter */ }

  // 3. launchd/systemd Status
  if (PLATFORM === 'darwin') {
    try {
      const output = execSync('launchctl list com.thinklocal.daemon 2>/dev/null', { encoding: 'utf-8' });
      if (output.includes('PID') || output.match(/"\d+"/)) return true;
    } catch { /* weiter */ }
  }

  return false;
}

async function fetchStatus(): Promise<Record<string, unknown> | null> {
  for (const mode of ['local', 'lan'] as const) {
    try {
      const baseUrl = getDefaultLocalDaemonUrl(DAEMON_PORT, mode);
      return await requestDaemonJson<Record<string, unknown>>('/api/status', {
        baseUrl,
        dataDir: DATA_DIR,
        timeoutMs: 3_000,
      });
    } catch { /* try next */ }
  }
  return null;
}

async function fetchLocalDaemonJson<T>(path: string, timeoutMs = 3_000): Promise<T> {
  const modes = [DEFAULT_RUNTIME_MODE, DEFAULT_RUNTIME_MODE === 'local' ? 'lan' : 'local'] as const;
  let lastError: unknown;
  for (const mode of modes) {
    try {
      return await requestDaemonJson<T>(path, {
        baseUrl: getDefaultLocalDaemonUrl(DAEMON_PORT, mode),
        dataDir: DATA_DIR,
        timeoutMs,
      });
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Daemon API nicht erreichbar: ${path}`);
}

// --- Befehle ---

async function cmdStatus(): Promise<void> {
  header('thinklocal-mcp Status');

  const running = await isDaemonRunning();
  if (!running) {
    fail('Daemon laeuft nicht');
    info(`Starten mit: ${C.bold}thinklocal start${C.reset}`);
    return;
  }

  ok('Daemon laeuft');
  const status = await fetchStatus();
  if (status) {
    console.log(`  Agent:         ${status['agent_id']}`);
    console.log(`  Hostname:      ${status['hostname']}:${status['port']}`);
    console.log(`  Uptime:        ${formatUptime(status['uptime_seconds'] as number)}`);
    console.log(`  Peers:         ${C.green}${status['peers_online']}${C.reset} online`);
    console.log(`  Capabilities:  ${status['capabilities_count']}`);
    console.log(`  Tasks:         ${status['active_tasks']} aktiv`);
    console.log(`  Audit:         ${status['audit_events']} Events`);
  }
  console.log();
}

async function cmdStart(flags: string[] = []): Promise<void> {
  header('Daemon starten');

  if (await isDaemonRunning()) {
    ok('Daemon laeuft bereits');
    return;
  }

  // Alte Zombie-Prozesse auf dem Port aufraumen
  try {
    const pids = execSync(`lsof -ti :${DAEMON_PORT} 2>/dev/null`, { encoding: 'utf-8' }).trim();
    if (pids) {
      for (const pid of pids.split('\n').filter(Boolean)) {
        try { process.kill(Number(pid), 'SIGTERM'); } catch { /* ok */ }
      }
      await new Promise((r) => setTimeout(r, 1_000));
      info('Alte Daemon-Prozesse bereinigt');
    }
  } catch { /* kein Prozess auf dem Port */ }

  // Service starten (plattformabhaengig)
  if (PLATFORM === 'darwin') {
    const plistPath = resolve(HOME, 'Library', 'LaunchAgents', 'com.thinklocal.daemon.plist');
    if (existsSync(plistPath)) {
      info('Starte via launchd...');
      try {
        execSync(`launchctl load "${plistPath}" 2>/dev/null; launchctl start com.thinklocal.daemon`);
        await waitForDaemon();
        return;
      } catch { /* Fallback */ }
    }
  } else if (PLATFORM === 'linux') {
    try {
      execSync('systemctl --user start thinklocal-daemon 2>/dev/null');
      info('Starte via systemd...');
      await waitForDaemon();
      return;
    } catch { /* Fallback */ }
  }

  // Fallback: Direkt starten (Vordergrund)
  info('Starte Daemon im Vordergrund...');
  info(`Stoppen mit Ctrl+C`);
  console.log();

  const tsxPath = resolve(INSTALL_DIR, 'node_modules', '.bin', 'tsx');
  const indexPath = resolve(INSTALL_DIR, 'packages', 'daemon', 'src', 'index.ts');
  const runtime = getRuntimeSettingsFor(flags, 'local');

  const child = spawn(tsxPath, [indexPath], {
    cwd: INSTALL_DIR,
    stdio: 'inherit',
    env: {
      ...process.env,
      TLMCP_DATA_DIR: DATA_DIR,
      TLMCP_CONFIG: resolve(INSTALL_DIR, 'config', 'daemon.toml'),
      TLMCP_RUNTIME_MODE: runtime.mode,
      TLMCP_BIND_HOST: runtime.bindHost,
      ...(process.env['TLMCP_NO_TLS'] ? { TLMCP_NO_TLS: process.env['TLMCP_NO_TLS'] } : {}),
    },
  });

  child.on('exit', (code) => process.exit(code ?? 1));
  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
}

async function cmdStop(): Promise<void> {
  header('Daemon stoppen');

  if (PLATFORM === 'darwin') {
    try {
      execSync('launchctl stop com.thinklocal.daemon 2>/dev/null');
      ok('Daemon via launchd gestoppt');
      return;
    } catch { /* Fallback */ }
  } else if (PLATFORM === 'linux') {
    try {
      execSync('systemctl --user stop thinklocal-daemon 2>/dev/null');
      ok('Daemon via systemd gestoppt');
      return;
    } catch { /* Fallback */ }
  }

  // Fallback: PID-basiert
  try {
    const pid = execSync(`lsof -ti :${DAEMON_PORT}`, { encoding: 'utf-8' }).trim();
    if (pid) {
      execSync(`kill ${pid}`);
      ok(`Daemon gestoppt (PID ${pid})`);
    } else {
      info('Daemon laeuft nicht');
    }
  } catch {
    info('Daemon laeuft nicht oder konnte nicht gestoppt werden');
  }
}

async function cmdRestart(): Promise<void> {
  await cmdStop();
  await new Promise((r) => setTimeout(r, 2_000));
  await cmdStart();
}

async function cmdDoctor(): Promise<void> {
  header('thinklocal doctor — Systemdiagnose');
  let issues = 0;

  // 1. Node.js
  try {
    const nodeV = execSync('node -v', { encoding: 'utf-8' }).trim();
    const major = Number(nodeV.replace('v', '').split('.')[0]);
    if (major >= 20) ok(`Node.js ${nodeV}`);
    else if (major >= 18) warn(`Node.js ${nodeV} — Version 20+ empfohlen (v18 funktioniert eingeschraenkt)`);
    else { fail(`Node.js ${nodeV} — Version 18+ benoetigt`); issues++; }
  } catch { fail('Node.js nicht gefunden'); issues++; }

  // 2. Datenverzeichnis
  if (existsSync(DATA_DIR)) {
    ok(`Datenverzeichnis: ${DATA_DIR}`);
  } else {
    fail(`Datenverzeichnis fehlt: ${DATA_DIR}`);
    info(`Erstellen mit: thinklocal bootstrap`);
    issues++;
  }

  // 3. Keys
  const keyPath = resolve(DATA_DIR, 'keys', 'agent.pub.pem');
  if (existsSync(keyPath)) {
    ok('Agent-Keypair vorhanden');
  } else {
    fail('Agent-Keypair fehlt');
    info('Wird beim ersten Daemon-Start generiert');
    issues++;
  }

  // 4. TLS-Zertifikate
  const certPath = resolve(DATA_DIR, 'tls', 'ca.crt.pem');
  if (existsSync(certPath)) {
    ok('TLS-CA-Zertifikat vorhanden');
  } else {
    warn('TLS-CA-Zertifikat fehlt (wird beim Start generiert)');
  }

  // 5. Daemon
  const running = await isDaemonRunning();
  if (running) {
    ok(`Daemon laeuft auf Port ${DAEMON_PORT}`);
  } else {
    fail(`Daemon nicht erreichbar (Port ${DAEMON_PORT})`);
    issues++;
  }

  // 6. Peers
  if (running) {
    const status = await fetchStatus();
    const peers = status?.['peers_online'] as number ?? 0;
    if (peers > 0) ok(`${peers} Peer(s) verbunden`);
    else warn('Keine Peers verbunden (allein im Mesh)');
  }

  // 7. MCP-Konfiguration
  const mcpPath = resolve(HOME, '.mcp.json');
  if (existsSync(mcpPath)) {
    const mcp = readFileSync(mcpPath, 'utf-8');
    if (mcp.includes('thinklocal')) {
      ok('MCP-Server konfiguriert (~/.mcp.json)');
    } else {
      warn('~/.mcp.json existiert, aber thinklocal nicht eingetragen');
      info(`Konfigurieren mit: thinklocal bootstrap`);
      issues++;
    }
  } else {
    fail('~/.mcp.json fehlt');
    info(`Erstellen mit: thinklocal bootstrap`);
    issues++;
  }

  // 8. Claude Desktop Config
  const claudeConfigPath = getClaudeDesktopConfigPath();
  if (claudeConfigPath && existsSync(claudeConfigPath)) {
    const cfg = readFileSync(claudeConfigPath, 'utf-8');
    if (cfg.includes('thinklocal')) {
      ok('Claude Desktop konfiguriert');
    } else {
      warn('Claude Desktop Config vorhanden, aber thinklocal fehlt');
    }
  }

  // 9. Service
  if (PLATFORM === 'darwin') {
    const plistPath = resolve(HOME, 'Library', 'LaunchAgents', 'com.thinklocal.daemon.plist');
    if (existsSync(plistPath)) ok('launchd Service installiert');
    else warn('launchd Service nicht installiert');
  } else if (PLATFORM === 'linux') {
    const servicePath = resolve(HOME, '.config', 'systemd', 'user', 'thinklocal-daemon.service');
    if (existsSync(servicePath)) ok('systemd Service installiert');
    else warn('systemd Service nicht installiert');
  }

  console.log();
  if (issues === 0) {
    console.log(`  ${C.green}${C.bold}Alles in Ordnung!${C.reset} Keine Probleme gefunden.\n`);
  } else {
    console.log(`  ${C.yellow}${C.bold}${issues} Problem(e) gefunden.${C.reset} Beheben mit: ${C.bold}thinklocal bootstrap${C.reset}\n`);
  }
}

async function cmdLogs(): Promise<void> {
  header('Daemon-Logs');
  const logPath = resolve(DATA_DIR, 'logs', 'daemon.log');
  if (!existsSync(logPath)) {
    warn(`Log-Datei nicht gefunden: ${logPath}`);
    info('Starte den Daemon zuerst');
    return;
  }
  info(`Zeige: ${logPath}`);
  info('Beenden mit Ctrl+C\n');

  const child = spawn('tail', ['-f', '-n', '50', logPath], { stdio: 'inherit' });
  process.on('SIGINT', () => { child.kill(); process.exit(0); });
}

async function cmdBootstrap(flags: string[] = []): Promise<void> {
  header('thinklocal bootstrap — Ersteinrichtung');
  const runtime = getRuntimeSettingsFor(flags, 'local');

  // 1. Datenverzeichnis
  mkdirSync(resolve(DATA_DIR, 'logs'), { recursive: true });
  mkdirSync(resolve(DATA_DIR, 'keys'), { recursive: true });
  mkdirSync(resolve(DATA_DIR, 'tls'), { recursive: true });
  mkdirSync(resolve(DATA_DIR, 'audit'), { recursive: true });
  mkdirSync(resolve(DATA_DIR, 'vault'), { recursive: true });
  mkdirSync(resolve(DATA_DIR, 'skills'), { recursive: true });
  mkdirSync(resolve(DATA_DIR, 'pairing'), { recursive: true });
  ok(`Datenverzeichnis: ${DATA_DIR}`);

  // 2. MCP-Server-Eintrag vorbereiten
  const tsxPath = resolve(INSTALL_DIR, 'packages', 'daemon', 'node_modules', '.bin', 'tsx');
  const mcpStdioPath = resolve(INSTALL_DIR, 'packages', 'daemon', 'src', 'mcp-stdio.ts');
  const thinklocalMcpEntry = {
    command: tsxPath,
    args: [mcpStdioPath],
    env: {
      TLMCP_DAEMON_URL: runtime.localDaemonUrl,
      TLMCP_DATA_DIR: DATA_DIR,
      TLMCP_RUNTIME_MODE: runtime.mode,
    },
  };

  // 3. ~/.mcp.json (Claude Code global)
  const mcpPath = resolve(HOME, '.mcp.json');
  upsertMcpConfig(mcpPath, thinklocalMcpEntry, '~/.mcp.json (Claude Code)');

  // 4. Claude Desktop Config
  const claudeConfigPath = getClaudeDesktopConfigPath();
  if (claudeConfigPath) {
    upsertMcpConfig(claudeConfigPath, thinklocalMcpEntry, 'Claude Desktop');
  }

  // 4. System-Service installieren (launchd / systemd)
  installService(tsxPath, runtime.mode);

  // 5. Credentials aus .env importieren (wenn vorhanden)
  importEnvCredentials(INSTALL_DIR);

  // 6. Daemon einmal starten (generiert Keys + Certs) — via spawnSync, kein Shell
  info('Starte Daemon kurz um Keys zu generieren...');
  const indexPath2 = resolve(INSTALL_DIR, 'packages', 'daemon', 'src', 'index.ts');
  const keyGenResult = spawnSync(tsxPath, [indexPath2], {
    cwd: INSTALL_DIR,
    env: {
      ...process.env,
      TLMCP_DATA_DIR: DATA_DIR,
      TLMCP_RUNTIME_MODE: runtime.mode,
      TLMCP_BIND_HOST: runtime.bindHost,
      ...(process.env['TLMCP_NO_TLS'] ? { TLMCP_NO_TLS: process.env['TLMCP_NO_TLS'] } : {}),
    },
    timeout: 8_000,
    encoding: 'utf-8',
  });
  const keyGenOutput = (keyGenResult.stdout ?? '') + (keyGenResult.stderr ?? '');
  if (keyGenOutput.includes('Keypair gespeichert') || keyGenOutput.includes('Keypair geladen')
      || existsSync(resolve(DATA_DIR, 'keys', 'agent.pub.pem'))) {
    ok('Agent-Keypair generiert');
  }

  // 6. Service starten
  info('Starte Daemon als Service...');
  if (PLATFORM === 'darwin') {
    try {
      execSync(`launchctl load "${resolve(HOME, 'Library', 'LaunchAgents', 'com.thinklocal.daemon.plist')}" 2>/dev/null; launchctl start com.thinklocal.daemon 2>/dev/null`);
    } catch { /* ok */ }
  } else if (PLATFORM === 'linux') {
    try {
      execSync('systemctl --user daemon-reload && systemctl --user start thinklocal-daemon 2>/dev/null');
    } catch { /* ok */ }
  }

  // Warten und pruefen
  await waitForDaemon(8_000);
  const running = await isDaemonRunning();

  console.log();
  if (running) {
    console.log(`  ${C.green}${C.bold}Bootstrap abgeschlossen — Daemon laeuft!${C.reset}`);
  } else {
    console.log(`  ${C.yellow}${C.bold}Bootstrap abgeschlossen${C.reset} — Daemon muss manuell gestartet werden:`);
    console.log(`  ${C.bold}thinklocal start${C.reset}`);
  }
  console.log();
  console.log(`  Befehle:`);
  console.log(`    thinklocal status     Status pruefen`);
  console.log(`    thinklocal doctor     Diagnose ausfuehren`);
  console.log(`    thinklocal peers      Verbundene Peers anzeigen`);
  console.log(`    thinklocal stop       Daemon stoppen`);
  console.log(`    thinklocal logs       Live-Logs anzeigen`);
  console.log();
  console.log(`  Claude Code: Oeffne ein neues Terminal — die Mesh-Tools sind automatisch da.`);
  console.log(`  Dashboard:   npm run dashboard (http://localhost:3000)`);
  console.log(`  Modus:       ${runtime.mode} (${runtime.tlsEnabled ? 'TLS/mTLS aktiv' : 'localhost-only ohne TLS'})`);
  console.log();
}

async function cmdPeers(): Promise<void> {
  header('Verbundene Peers');
  if (!(await isDaemonRunning())) {
    fail('Daemon laeuft nicht');
    return;
  }

  try {
    const data = await fetchLocalDaemonJson<{ peers: Array<Record<string, unknown>> }>('/api/peers');

    if (data.peers.length === 0) {
      info('Keine Peers verbunden (allein im Mesh)');
      return;
    }

    for (const p of data.peers) {
      const card = p['agent_card'] as Record<string, unknown> | null;
      const health = card?.['health'] as Record<string, number> | null;
      const agents = card ? (card['capabilities'] as Record<string, unknown>)?.['agents'] : null;
      const status = p['status'] === 'online' ? `${C.green}●${C.reset}` : `${C.red}○${C.reset}`;

      console.log(`  ${status} ${C.bold}${p['name']}${C.reset}`);
      console.log(`    ${C.dim}${p['host']}:${p['port']} | ${agents ?? 'unknown'}${C.reset}`);
      if (health) {
        const cpuColor = (health['cpu_percent'] ?? 0) > 80 ? C.red : (health['cpu_percent'] ?? 0) > 50 ? C.yellow : C.green;
        const ramColor = (health['memory_percent'] ?? 0) > 90 ? C.red : (health['memory_percent'] ?? 0) > 70 ? C.yellow : C.green;
        console.log(`    CPU: ${cpuColor}${health['cpu_percent']}%${C.reset}  RAM: ${ramColor}${health['memory_percent']}%${C.reset}  Disk: ${health['disk_percent']}%  Uptime: ${formatUptime(health['uptime_seconds'] ?? 0)}`);
      }
    }
    console.log(`\n  ${data.peers.length} Peer(s) verbunden\n`);
  } catch {
    fail('Konnte Peer-Daten nicht abrufen');
  }
}

async function cmdCheck(host: string): Promise<void> {
  header(`Remote-Check: ${host}`);

  // Port bestimmen (host:port oder nur host)
  let targetHost = host;
  let targetPort = DAEMON_PORT;
  if (host.includes(':')) {
    const parts = host.split(':');
    targetHost = parts[0];
    targetPort = Number(parts[1]);
  }

  // 1. Health-Check
  try {
    const res = await fetch(`http://${targetHost}:${targetPort}/health`, { signal: AbortSignal.timeout(3_000) });
    if (res.ok) {
      ok(`Daemon erreichbar (http://${targetHost}:${targetPort})`);
    } else {
      fail(`Daemon antwortet mit Status ${res.status}`);
      return;
    }
  } catch {
    fail(`Daemon nicht erreichbar auf ${targetHost}:${targetPort}`);
    info('Pruefen: Laeuft der Daemon? Firewall? Richtiger Port?');
    return;
  }

  // 2. Status abrufen
  try {
    const res = await fetch(`http://${targetHost}:${targetPort}/api/status`, { signal: AbortSignal.timeout(3_000) });
    const status = (await res.json()) as Record<string, unknown>;
    console.log(`  Agent:         ${status['agent_id']}`);
    console.log(`  Hostname:      ${status['hostname']}:${status['port']}`);
    console.log(`  Agent-Typ:     ${status['agent_type']}`);
    console.log(`  Uptime:        ${formatUptime(status['uptime_seconds'] as number)}`);
    console.log(`  Peers:         ${status['peers_online']} online`);
    console.log(`  Capabilities:  ${status['capabilities_count']}`);
    console.log(`  Tasks:         ${status['active_tasks']} aktiv`);
  } catch {
    warn('Status konnte nicht abgerufen werden');
  }

  // 3. Agent Card
  try {
    const res = await fetch(`http://${targetHost}:${targetPort}/.well-known/agent-card.json`, { signal: AbortSignal.timeout(3_000) });
    const card = (await res.json()) as Record<string, unknown>;
    ok(`Agent Card: ${card['name']} v${card['version']}`);
  } catch {
    warn('Agent Card nicht erreichbar');
  }

  // 4. Skill-Execute testen
  try {
    const res = await fetch(`http://${targetHost}:${targetPort}/api/tasks/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ skill_id: 'system.health' }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      ok('Skill-Execute funktioniert (system.health)');
    } else {
      warn(`Skill-Execute: ${res.status} ${res.statusText}`);
    }
  } catch {
    warn('Skill-Execute nicht verfuegbar');
  }

  console.log();
}

async function cmdMcpConfig(target?: string): Promise<void> {
  const tsxPath = resolve(INSTALL_DIR, 'packages', 'daemon', 'node_modules', '.bin', 'tsx');
  const mcpStdioPath = resolve(INSTALL_DIR, 'packages', 'daemon', 'src', 'mcp-stdio.ts');

  const snippet = {
    thinklocal: {
      command: tsxPath,
      args: [mcpStdioPath],
      env: {
        TLMCP_DAEMON_URL: getRuntimeSettingsFor([], DEFAULT_RUNTIME_MODE).localDaemonUrl,
        TLMCP_DATA_DIR: DATA_DIR,
        TLMCP_RUNTIME_MODE: DEFAULT_RUNTIME_MODE,
      },
    },
  };

  if (target === 'install') {
    // Automatisch in alle Configs einfuegen
    const mcpPath = resolve(HOME, '.mcp.json');
    upsertMcpConfig(mcpPath, snippet['thinklocal'], '~/.mcp.json (Claude Code)');

    const claudeConfigPath = getClaudeDesktopConfigPath();
    if (claudeConfigPath) {
      upsertMcpConfig(claudeConfigPath, snippet['thinklocal'], 'Claude Desktop');
    }
    return;
  }

  header('MCP-Server-Konfiguration');
  console.log('  Fuer Claude Desktop und Claude Code — kopiere diesen Block');
  console.log('  in den "mcpServers"-Bereich der jeweiligen Config-Datei:\n');
  console.log(`${C.dim}${JSON.stringify(snippet, null, 2)}${C.reset}`);

  console.log(`\n  ${C.bold}Config-Dateien:${C.reset}`);
  console.log(`    Claude Code:    ~/.mcp.json`);
  const claudeDesktopConfigPath = getClaudeDesktopConfigPath();
  if (claudeDesktopConfigPath) {
    console.log(`    Claude Desktop: ${claudeDesktopConfigPath.replace(HOME, '~')}`);
  }

  console.log(`\n  ${C.bold}Oder automatisch:${C.reset}`);
  console.log(`    thinklocal mcp install     Fuegt thinklocal in alle Configs ein`);
  console.log(`    thinklocal bootstrap       Macht alles (inkl. MCP-Config)\n`);
}

async function cmdUninstall(): Promise<void> {
  header('thinklocal deinstallieren');

  // 1. Daemon stoppen
  await cmdStop();

  // 2. Service entfernen
  if (PLATFORM === 'darwin') {
    const plistPath = resolve(HOME, 'Library', 'LaunchAgents', 'com.thinklocal.daemon.plist');
    if (existsSync(plistPath)) {
      try { execSync(`launchctl unload "${plistPath}" 2>/dev/null`); } catch { /* ok */ }
      execSync(`rm -f "${plistPath}"`);
      ok('launchd Service entfernt');
    }
  } else if (PLATFORM === 'linux') {
    const servicePath = resolve(HOME, '.config', 'systemd', 'user', 'thinklocal-daemon.service');
    if (existsSync(servicePath)) {
      try { execSync('systemctl --user disable thinklocal-daemon 2>/dev/null'); } catch { /* ok */ }
      execSync(`rm -f "${servicePath}"`);
      try { execSync('systemctl --user daemon-reload'); } catch { /* ok */ }
      ok('systemd Service entfernt');
    }
  }

  // 3. MCP-Config: thinklocal-Eintrag aus ~/.mcp.json entfernen
  const mcpPath = resolve(HOME, '.mcp.json');
  if (existsSync(mcpPath)) {
    try {
      const mcpConfig = JSON.parse(readFileSync(mcpPath, 'utf-8')) as Record<string, Record<string, unknown>>;
      if (mcpConfig['mcpServers']?.['thinklocal']) {
        delete mcpConfig['mcpServers']['thinklocal'];
        if (Object.keys(mcpConfig['mcpServers']).length === 0) {
          execSync(`rm -f "${mcpPath}"`);
          ok('~/.mcp.json entfernt (war nur thinklocal)');
        } else {
          writeFileSync(mcpPath, JSON.stringify(mcpConfig, null, 2) + '\n');
          ok('thinklocal aus ~/.mcp.json entfernt');
        }
      }
    } catch {
      warn('~/.mcp.json konnte nicht bereinigt werden');
    }
  }

  console.log();
  info(`Datenverzeichnis ${C.bold}nicht${C.reset} geloescht: ${DATA_DIR}`);
  info(`Zum vollstaendigen Entfernen: rm -rf ${DATA_DIR}`);
  console.log();
}

async function cmdConfigShow(): Promise<void> {
  header('Konfiguration');
  const configPath = resolve(INSTALL_DIR, 'config', 'daemon.toml');
  if (existsSync(configPath)) {
    console.log(readFileSync(configPath, 'utf-8'));
  } else {
    warn('Keine daemon.toml gefunden');
  }

  console.log(`  ${C.dim}Datenverzeichnis:  ${DATA_DIR}${C.reset}`);
  console.log(`  ${C.dim}Daemon-Port:       ${DAEMON_PORT}${C.reset}`);
  console.log(`  ${C.dim}Install-Pfad:      ${INSTALL_DIR}${C.reset}`);
  console.log();
}

// --- MCP-Config-Management ---

/**
 * Fuegt thinklocal sicher in eine MCP-Konfigurationsdatei ein.
 * Erstellt die Datei wenn noetig, erweitert bestehende Configs ohne
 * andere Server zu beruehren, und erstellt Backups.
 */
function upsertMcpConfig(
  configPath: string,
  mcpEntry: Record<string, unknown>,
  label: string,
): void {
  if (!existsSync(configPath)) {
    // Neue Config erstellen
    mkdirSync(resolve(configPath, '..'), { recursive: true });
    const config = { mcpServers: { thinklocal: mcpEntry } };
    atomicWrite(configPath, JSON.stringify(config, null, 2) + '\n');
    ok(`${label} konfiguriert (neu erstellt)`);
    return;
  }

  // Bestehende Config lesen
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
  } catch {
    warn(`${label}: Config-Datei ist kein gueltiges JSON — ueberspringe`);
    return;
  }

  // Pruefen ob thinklocal bereits drin ist
  const servers = config['mcpServers'] as Record<string, unknown> | undefined;
  if (servers?.['thinklocal']) {
    ok(`${label} bereits konfiguriert`);
    return;
  }

  // Backup erstellen
  const backupPath = `${configPath}.pre-thinklocal.bak`;
  writeFileSync(backupPath, readFileSync(configPath));
  info(`Backup: ${backupPath}`);

  // thinklocal einfuegen
  if (!config['mcpServers']) {
    config['mcpServers'] = {};
  }
  (config['mcpServers'] as Record<string, unknown>)['thinklocal'] = mcpEntry;

  const mode = existsSync(configPath) ? (statSync(configPath).mode & 0o777) : 0o600;
  atomicWrite(configPath, JSON.stringify(config, null, 2) + '\n', mode);
  ok(`${label} konfiguriert (thinklocal hinzugefuegt)`);
}

// --- Credential-Import aus .env ---

/**
 * Liest Credentials aus .env und:
 * 1. Speichert sie im Daemon-Vault (verschluesselt)
 * 2. Konfiguriert Git mit GitHub-Token (fuer automatischen Push)
 */
function importEnvCredentials(installDir: string): void {
  const envPath = resolve(installDir, '.env');
  if (!existsSync(envPath)) return;

  const envContent = readFileSync(envPath, 'utf-8');
  const envVars: Record<string, string> = {};

  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (key && value) envVars[key] = value;
  }

  if (Object.keys(envVars).length === 0) return;
  info(`${Object.keys(envVars).length} Credentials in .env gefunden`);

  // Git konfigurieren (GitHub Token fuer automatischen Push)
  if (envVars['GITHUB_TOKEN'] && envVars['GITHUB_USER']) {
    try {
      const ghUser = envVars['GITHUB_USER'];
      const ghEmail = envVars['GITHUB_EMAIL'] ?? `${ghUser}@users.noreply.github.com`;

      spawnSync('git', ['config', '--global', 'user.name', ghUser], { encoding: 'utf-8' });
      spawnSync('git', ['config', '--global', 'user.email', ghEmail], { encoding: 'utf-8' });
      ok('Git Benutzername und E-Mail konfiguriert');

      if (ALLOW_PLAINTEXT_GIT_CREDENTIALS) {
        const ghToken = envVars['GITHUB_TOKEN'];
        spawnSync('git', ['config', '--global', 'credential.helper', 'store'], { encoding: 'utf-8' });
        const credPath = resolve(HOME, '.git-credentials');
        const credLine = `https://${ghUser}:${ghToken}@github.com\n`;
        if (!existsSync(credPath) || !readFileSync(credPath, 'utf-8').includes('github.com')) {
          atomicWrite(credPath, credLine);
        }
        ok('GitHub Token im Klartext-Credential-Store hinterlegt (explizites Opt-in)');
      } else {
        warn('GITHUB_TOKEN gefunden, wird aber nicht automatisch in ~/.git-credentials gespeichert');
        info('Opt-in fuer Klartextspeicherung: TLMCP_ALLOW_PLAINTEXT_GIT_CREDENTIALS=1 thinklocal bootstrap');
      }
    } catch {
      warn('Git-Konfiguration fehlgeschlagen');
    }
  }

  // Credentials im Vault speichern (wenn Daemon laeuft)
  const credEntries = Object.entries(envVars).filter(([k]) =>
    k.includes('TOKEN') || k.includes('PASSWORD') || k.includes('SECRET') || k.includes('KEY'),
  );

  if (credEntries.length > 0) {
    // Versuche Credentials ueber die Daemon-API zu speichern
    let vaultOk = false;
    for (const [name, value] of credEntries) {
      try {
        const res = spawnSync('curl', [
          '-sf', '-X', 'POST',
          `http://localhost:${DAEMON_PORT}/api/vault/credentials`,
          '-H', 'Content-Type: application/json',
          '-d', JSON.stringify({ name: name.toLowerCase(), value, category: 'env-import' }),
        ], { encoding: 'utf-8', timeout: 5_000 });
        if (res.status === 0) vaultOk = true;
      } catch { /* Daemon laeuft noch nicht — ok */ }
    }
    if (vaultOk) {
      ok(`${credEntries.length} Credentials im Vault gespeichert (verschluesselt)`);
    } else {
      info(`${credEntries.length} Credentials gefunden — werden nach Daemon-Start im Vault gespeichert`);
    }
  }
}

// --- Service-Installation ---

function installService(tsxPath: string, runtimeMode: RuntimeMode): void {
  const nodePath = process.execPath;
  const indexPath = resolve(INSTALL_DIR, 'packages', 'daemon', 'src', 'index.ts');
  const configPath = resolve(INSTALL_DIR, 'config', 'daemon.toml');

  if (PLATFORM === 'darwin') {
    installLaunchdService(nodePath, tsxPath, indexPath, configPath, runtimeMode);
  } else if (PLATFORM === 'linux') {
    installSystemdService(nodePath, tsxPath, indexPath, configPath, runtimeMode);
  } else {
    warn('Automatische Service-Installation nur auf macOS und Linux');
    info('Windows: scripts/service/thinklocal-daemon.ps1 install');
  }
}

function installLaunchdService(
  nodePath: string,
  tsxPath: string,
  indexPath: string,
  configPath: string,
  runtimeMode: RuntimeMode,
): void {
  const runtime = resolveRuntimeSettings({ mode: runtimeMode, port: DAEMON_PORT });
  const plistDir = resolve(HOME, 'Library', 'LaunchAgents');
  const plistPath = resolve(plistDir, 'com.thinklocal.daemon.plist');

  const isUpdate = existsSync(plistPath);
  if (isUpdate) {
    // Service stoppen bevor plist aktualisiert wird
    try { execSync(`launchctl unload "${plistPath}" 2>/dev/null`); } catch { /* ok */ }
  }

  mkdirSync(plistDir, { recursive: true });

  // XML-Escaping fuer alle interpolierten Werte
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.thinklocal.daemon</string>
    <key>ProgramArguments</key>
    <array>
        <string>${xmlEscape(nodePath)}</string>
        <string>${xmlEscape(tsxPath)}</string>
        <string>${xmlEscape(indexPath)}</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>TLMCP_CONFIG</key>
        <string>${xmlEscape(configPath)}</string>
        <key>TLMCP_DATA_DIR</key>
        <string>${xmlEscape(DATA_DIR)}</string>
        <key>TLMCP_RUNTIME_MODE</key>
        <string>${xmlEscape(runtime.mode)}</string>
        <key>TLMCP_BIND_HOST</key>
        <string>${xmlEscape(runtime.bindHost)}</string>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>${Object.entries(loadServiceEnvVars()).map(([k, v]) => `
        <key>${xmlEscape(k)}</key>
        <string>${xmlEscape(v)}</string>`).join('')}
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>StandardOutPath</key>
    <string>${xmlEscape(DATA_DIR)}/logs/daemon.log</string>
    <key>StandardErrorPath</key>
    <string>${xmlEscape(DATA_DIR)}/logs/daemon.error.log</string>
    <key>WorkingDirectory</key>
    <string>${xmlEscape(INSTALL_DIR)}</string>
    <key>ProcessType</key>
    <string>Background</string>
    <key>ThrottleInterval</key>
    <integer>10</integer>
</dict>
</plist>`;

  writeFileSync(plistPath, plist);
  // Service laden
  try {
    execSync(`launchctl load "${plistPath}" 2>/dev/null`);
  } catch { /* ok */ }
  ok(isUpdate ? 'launchd Service aktualisiert (Env-Vars neu geladen)' : 'launchd Service installiert (startet bei Login)');
}

function installSystemdService(
  nodePath: string,
  tsxPath: string,
  indexPath: string,
  configPath: string,
  runtimeMode: RuntimeMode,
): void {
  const runtime = resolveRuntimeSettings({ mode: runtimeMode, port: DAEMON_PORT });
  const serviceDir = resolve(HOME, '.config', 'systemd', 'user');
  const servicePath = resolve(serviceDir, 'thinklocal-daemon.service');
  const isUpdate = existsSync(servicePath);

  mkdirSync(serviceDir, { recursive: true });

  // systemd-Quoting fuer alle Pfade
  const unit = `[Unit]
Description=thinklocal-mcp Mesh Daemon
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${[nodePath, tsxPath, indexPath].map(systemdEscape).join(' ')}
Environment=${systemdEscape(`TLMCP_CONFIG=${configPath}`)}
Environment=${systemdEscape(`TLMCP_DATA_DIR=${DATA_DIR}`)}
Environment=${systemdEscape(`TLMCP_RUNTIME_MODE=${runtime.mode}`)}
Environment=${systemdEscape(`TLMCP_BIND_HOST=${runtime.bindHost}`)}
Environment="PATH=/usr/local/bin:/usr/bin:/bin"
Environment="NODE_ENV=production"
${Object.entries(loadServiceEnvVars()).map(([k, v]) => `Environment=${systemdEscape(`${k}=${v}`)}`).join('\n')}
WorkingDirectory=${systemdEscape(INSTALL_DIR)}
Restart=on-failure
RestartSec=10
StandardOutput=append:${DATA_DIR}/logs/daemon.log
StandardError=append:${DATA_DIR}/logs/daemon.error.log

[Install]
WantedBy=default.target`;

  writeFileSync(servicePath, unit);
  try {
    execSync('systemctl --user daemon-reload');
    execSync('systemctl --user enable thinklocal-daemon');
    ok('systemd Service installiert und aktiviert (startet bei Login)');

    // enable-linger damit der Service auch ohne Login-Session laeuft
    try {
      execSync('loginctl enable-linger $(whoami) 2>/dev/null');
      ok('User-Linger aktiviert (Service laeuft ohne Login)');
    } catch {
      warn('loginctl enable-linger fehlgeschlagen — Service laeuft nur bei aktiver Session');
      info('Fix: sudo loginctl enable-linger $(whoami)');
    }
  } catch {
    ok('systemd Service-Datei erstellt');
    warn('systemctl daemon-reload fehlgeschlagen — bitte manuell ausfuehren');
    info('Befehle: systemctl --user daemon-reload && systemctl --user enable --now thinklocal-daemon');
  }
}

// --- Hilfsfunktionen ---

async function waitForDaemon(maxWait = 10_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    if (await isDaemonRunning()) {
      ok(`Daemon gestartet (${Math.floor((Date.now() - start) / 1000)}s)`);
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  warn('Daemon antwortet noch nicht — pruefe Logs');
}

function formatUptime(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}

// --- Deploy ---

function sshExec(target: string, command: string, label: string, dryRun = false): boolean {
  if (dryRun) {
    info(`Wuerde ausfuehren: ssh ${target} '${command}'`);
    return true;
  }
  const result = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'LogLevel=ERROR', target, command], {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000,
  });
  if (result.status === 0) {
    ok(label);
    return true;
  }
  const stderr = result.stderr?.toString().trim();
  fail(`${label}: ${stderr || `Exit ${result.status}`}`);
  return false;
}

function sshOutput(target: string, command: string): string | null {
  const result = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'LogLevel=ERROR', target, command], {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30_000,
  });
  if (result.status !== 0) return null;
  return result.stdout?.toString().trim() ?? null;
}

function scpUpload(localPath: string, target: string, remotePath: string, label: string, dryRun = false): boolean {
  if (dryRun) {
    info(`Wuerde hochladen: ${localPath} → ${target}:${remotePath}`);
    return true;
  }
  const result = spawnSync('scp', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'LogLevel=ERROR', localPath, `${target}:${remotePath}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
  });
  if (result.status === 0) {
    ok(label);
    return true;
  }
  fail(`${label}: ${result.stderr?.toString().trim() || `Exit ${result.status}`}`);
  return false;
}

async function cmdDeploy(targetArg: string, flags: string[]): Promise<void> {
  const dryRun = flags.includes('--dry-run');
  const withEnv = flags.includes('--with-env');
  const withCa = flags.includes('--with-ca');
  const target = targetArg; // user@host

  if (!target || !target.includes('@')) {
    console.log(`  Nutzung: thinklocal deploy user@host [--dry-run] [--with-env] [--with-ca]`);
    console.log(`  Beispiel: thinklocal deploy chris@10.10.10.56`);
    console.log(`  Beispiel: thinklocal deploy chris@10.10.10.56 --with-env --with-ca`);
    return;
  }

  header(`Deploy nach ${target}${dryRun ? ' (Dry-Run)' : ''}`);

  // 1. SSH-Verbindung pruefen
  info('Pruefe SSH-Verbindung...');
  const os = sshOutput(target, 'uname -s');
  if (!os) {
    fail('SSH-Verbindung fehlgeschlagen (Key-basierte Authentifizierung noetig)');
    info('Tipp: ssh-copy-id ' + target);
    return;
  }
  if (os !== 'Linux') {
    fail(`Nur Linux wird unterstuetzt (erkannt: ${os})`);
    info('macOS-Deploy kommt in einer zukuenftigen Version');
    return;
  }
  ok(`SSH-Verbindung OK (${os})`);

  // 2. systemd pruefen
  const hasSystemctl = sshOutput(target, 'command -v systemctl');
  if (!hasSystemctl) {
    fail('systemd nicht gefunden — wird fuer den Service benoetigt');
    return;
  }
  ok('systemd verfuegbar');

  // 3. Pruefen ob Update oder Neuinstallation
  const existingInstall = sshOutput(target, 'test -d ~/.local/share/thinklocal-mcp/.git && echo yes || echo no');
  const isUpdate = existingInstall === 'yes';
  info(isUpdate ? 'Bestehende Installation gefunden — Update-Modus' : 'Keine Installation gefunden — Neuinstallation');

  // 4. .env hochladen (wenn --with-env)
  if (withEnv) {
    const envPath = resolve(INSTALL_DIR, '.env');
    if (!existsSync(envPath)) {
      warn('.env-Datei nicht gefunden — ueberspringe');
    } else {
      if (!dryRun) {
        sshExec(target, 'mkdir -p ~/.local/share/thinklocal-mcp', 'Remote-Verzeichnis erstellt', dryRun);
      }
      if (!scpUpload(envPath, target, '~/.local/share/thinklocal-mcp/.env', '.env hochgeladen', dryRun)) return;
      sshExec(target, 'chmod 600 ~/.local/share/thinklocal-mcp/.env', '.env-Rechte gesetzt (600)', dryRun);
    }
  }

  // 4b. CA-Zertifikat uebertragen (wenn --with-ca)
  if (withCa) {
    const caPath = resolve(DATA_DIR, 'certs', 'ca.crt');
    if (!existsSync(caPath)) {
      warn('CA-Zertifikat nicht gefunden (~/.thinklocal/certs/ca.crt) — ueberspringe');
    } else {
      if (!dryRun) {
        sshExec(target, 'mkdir -p ~/.thinklocal/certs', 'Remote-Certs-Verzeichnis erstellt', dryRun);
      }
      if (!scpUpload(caPath, target, '~/.thinklocal/certs/ca.crt', 'CA-Zertifikat hochgeladen', dryRun)) return;
      // Auch CA-Key uebertragen fuer Node-Cert-Signierung
      const caKeyPath = resolve(DATA_DIR, 'certs', 'ca.key');
      if (existsSync(caKeyPath)) {
        if (!scpUpload(caKeyPath, target, '~/.thinklocal/certs/ca.key', 'CA-Key hochgeladen', dryRun)) return;
        sshExec(target, 'chmod 600 ~/.thinklocal/certs/ca.key', 'CA-Key-Rechte gesetzt (600)', dryRun);
      }
      ok('mTLS-Trust etabliert (gemeinsame CA)');
    }
  }

  // 5. install.sh ueber SSH ausfuehren
  info(isUpdate ? 'Starte Update...' : 'Starte Installation...');
  const installScript = resolve(INSTALL_DIR, 'scripts', 'install.sh');
  if (!existsSync(installScript)) {
    fail('scripts/install.sh nicht gefunden');
    return;
  }

  if (dryRun) {
    info(`Wuerde ausfuehren: ssh ${target} 'bash -s -- ${isUpdate ? '--update' : ''}' < scripts/install.sh`);
    ok('Dry-Run abgeschlossen — keine Aenderungen vorgenommen');
    return;
  }

  // install.sh ueber stdin pipen
  const installResult = spawnSync('ssh', ['-o', 'BatchMode=yes', target, `bash -s -- ${isUpdate ? '--update' : ''}`], {
    input: readFileSync(installScript),
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 300_000, // 5 Minuten fuer npm install
  });

  if (installResult.status !== 0) {
    fail('Installation fehlgeschlagen');
    const stderr = installResult.stderr?.toString().trim();
    if (stderr) {
      console.log(`\n  ${C.dim}${stderr.split('\n').slice(-10).join('\n  ')}${C.reset}`);
    }
    info(`Debug: ssh ${target} 'journalctl --user -u thinklocal-daemon -e'`);
    return;
  }
  ok(isUpdate ? 'Update erfolgreich' : 'Installation erfolgreich');

  // 6. Service-Status pruefen
  const serviceStatus = sshOutput(target, 'systemctl --user is-active thinklocal-daemon 2>/dev/null');
  if (serviceStatus === 'active') {
    ok('Daemon laeuft auf Remote');
  } else {
    warn(`Service-Status: ${serviceStatus ?? 'unbekannt'}`);
    info('Starte Service manuell: ssh ' + target + " 'systemctl --user start thinklocal-daemon'");
  }

  // 7. Mesh-Join verifizieren (30s Timeout)
  info('Warte auf Mesh-Beitritt (max 30s)...');
  const host = target.split('@')[1];
  let joined = false;
  for (let i = 0; i < 6; i++) {
    try {
      const data = await fetchLocalDaemonJson<{ peers: Array<{ host: string }> }>('/api/peers');
      if (data.peers.some((p) => p.host === host)) {
        joined = true;
        break;
      }
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 5000));
  }

  if (joined) {
    ok(`Remote-Node ${host} ist dem Mesh beigetreten!`);
  } else {
    warn('Remote-Node noch nicht im Mesh sichtbar (evtl. mDNS dauert laenger)');
    info(`Pruefe: thinklocal check ${host}`);
  }

  console.log(`\n  ${C.green}${C.bold}Deploy abgeschlossen!${C.reset}\n`);
}

// --- Setup CLI Adapters ---

async function cmdSetup(tool?: string): Promise<void> {
  const { setupAdapter, listSupportedTools, type SupportedTool } = await import(
    '../../daemon/src/cli-adapters.js'
  );

  if (!tool) {
    // Zeige verfuegbare Tools
    console.log(`\n  ${C.bold}thinklocal setup${C.reset} — MCP-Server in AI-Tools konfigurieren\n`);
    const tools = listSupportedTools();
    for (const t of tools) {
      const status = t.installed ? `${C.green}installiert${C.reset}` : `${C.dim}nicht gefunden${C.reset}`;
      console.log(`    ${C.bold}${t.tool.padEnd(16)}${C.reset} ${status}  ${C.dim}${t.configPath}${C.reset}`);
    }
    console.log(`\n  ${C.bold}Nutzung:${C.reset}`);
    console.log(`    thinklocal setup codex          # Codex CLI konfigurieren`);
    console.log(`    thinklocal setup gemini          # Gemini CLI konfigurieren`);
    console.log(`    thinklocal setup claude-desktop   # Claude Desktop konfigurieren`);
    console.log(`    thinklocal setup claude-code      # Claude Code konfigurieren`);
    console.log(`    thinklocal setup all              # Alle gefundenen Tools konfigurieren`);
    console.log();
    return;
  }

  const validTools = ['codex', 'gemini', 'claude-desktop', 'claude-code', 'all'];
  if (!validTools.includes(tool)) {
    console.log(`  ${C.red}Unbekanntes Tool: ${tool}${C.reset}`);
    console.log(`  Verfuegbar: ${validTools.join(', ')}`);
    return;
  }

  const daemonUrl = getRuntimeSettingsFor([], DEFAULT_RUNTIME_MODE).localDaemonUrl;
  const results = setupAdapter(tool as SupportedTool, daemonUrl);

  console.log(`\n  ${C.bold}MCP-Server Setup${C.reset}\n`);
  for (const r of results) {
    const icon = r.action === 'already_configured' ? '✓' : r.action === 'created' ? '✚' : '↻';
    const color = r.action === 'already_configured' ? C.dim : C.green;
    console.log(`    ${color}${icon} ${r.tool.padEnd(16)}${C.reset} → ${r.configPath}`);
    if (r.action !== 'already_configured') {
      console.log(`      ${C.dim}Aktion: ${r.action === 'created' ? 'Neu erstellt' : 'Aktualisiert'}${C.reset}`);
    }
  }

  console.log(`\n  ${C.dim}Daemon-URL: ${daemonUrl}${C.reset}`);
  console.log(`  ${C.dim}Starte den Daemon mit: thinklocal start${C.reset}\n`);
}

// --- Remote Remove ---

async function cmdRemove(targetArg: string, flags: string[]): Promise<void> {
  const dryRun = flags.includes('--dry-run');
  const purge = flags.includes('--purge');
  const target = targetArg;

  if (!target || !target.includes('@')) {
    console.log(`  Nutzung: thinklocal remove user@host [--dry-run] [--purge]`);
    console.log(`  Beispiel: thinklocal remove chris@10.10.10.56`);
    console.log(`  --purge: Entfernt auch Daten und Logs`);
    return;
  }

  header(`Remote-Deinstallation von ${target}${dryRun ? ' (Dry-Run)' : ''}`);

  // 1. SSH pruefen
  info('Pruefe SSH-Verbindung...');
  const os = sshOutput(target, 'uname -s');
  if (!os) {
    fail('SSH-Verbindung fehlgeschlagen');
    return;
  }
  ok(`Verbunden (${os})`);

  // 2. Service stoppen
  info('Stoppe Service...');
  await sshExec(target, 'sudo systemctl stop thinklocal-mcp 2>/dev/null; sudo systemctl disable thinklocal-mcp 2>/dev/null; true', 'Service gestoppt', dryRun);

  // 3. launchd stoppen (falls macOS)
  if (os === 'Darwin') {
    await sshExec(target, 'launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.thinklocal.daemon.plist 2>/dev/null; true', 'launchd Service gestoppt', dryRun);
  }

  // 4. Installationsverzeichnis entfernen
  info('Entferne Installation...');
  await sshExec(target, 'sudo rm -rf /opt/thinklocal-mcp', 'Installationsverzeichnis entfernt', dryRun);
  await sshExec(target, 'sudo rm -f /usr/bin/thinklocal /usr/bin/tlmcp-daemon /usr/bin/tlmcp-mcp', 'CLI-Binaries entfernt', dryRun);
  await sshExec(target, 'sudo rm -f /lib/systemd/system/thinklocal-mcp.service', 'Service-Unit entfernt', dryRun);

  if (purge) {
    info('Purge: Entferne Daten und Logs...');
    await sshExec(target, 'sudo rm -rf /var/lib/thinklocal /var/log/thinklocal /etc/thinklocal', 'Daten und Logs entfernt', dryRun);

    // Home-Verzeichnis aufraemen
    const remoteUser = target.split('@')[0];
    await sshExec(target, `rm -rf /home/${remoteUser}/.thinklocal`, 'User-Daten entfernt', dryRun);
  }

  // 5. System-Benutzer entfernen
  if (purge) {
    await sshExec(target, 'sudo userdel thinklocal 2>/dev/null; true', 'System-Benutzer entfernt', dryRun);
  }

  // 6. systemd reload
  await sshExec(target, 'sudo systemctl daemon-reload 2>/dev/null; true', 'systemd neu geladen', dryRun);

  console.log(`\n  ${C.green}${C.bold}Deinstallation abgeschlossen!${C.reset}`);
  if (!purge) {
    console.log(`  ${C.dim}Daten und Logs wurden beibehalten. Nutze --purge um alles zu entfernen.${C.reset}`);
  }
  console.log();
}

// --- Main ---

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = args[0];

  switch (cmd) {
    case 'start': return cmdStart(args.slice(1));
    case 'stop': return cmdStop();
    case 'restart': return cmdRestart();
    case 'status': return cmdStatus();
    case 'doctor': return cmdDoctor();
    case 'logs': return cmdLogs();
    case 'bootstrap': return cmdBootstrap(args.slice(1));
    case 'peers': return cmdPeers();
    case 'uninstall': return cmdUninstall();
    case 'check':
      if (args[1]) return cmdCheck(args[1]);
      console.log('  Nutzung: thinklocal check <host> oder thinklocal check <host>:<port>');
      return;
    case 'mcp':
      return cmdMcpConfig(args[1]);
    case 'remove':
      return cmdRemove(args[1], args.slice(2));
    case 'deploy':
      return cmdDeploy(args[1], args.slice(2));
    case 'setup':
      return cmdSetup(args[1]);
    case 'config':
      if (args[1] === 'show' || !args[1]) return cmdConfigShow();
      break;
    case 'heartbeat': {
      const code = await runHeartbeatCommand(args.slice(1));
      process.exitCode = code;
      return;
    }
    case undefined:
    case '--help':
    case '-h':
    case 'help':
      console.log(`
  ${C.bold}thinklocal${C.reset} — Mesh-Netzwerk fuer AI CLI Agenten

  ${C.bold}Befehle:${C.reset}
    bootstrap      Ersteinrichtung (Keys, Config, Service, MCP) [--local|--lan]
    start          Daemon starten (Service oder Vordergrund) [--local|--lan]
    stop           Daemon stoppen
    restart        Daemon neu starten
    status         Status anzeigen
    doctor         Systemdiagnose (prueft alles)
    logs           Live-Logs anzeigen
    peers          Verbundene Peers mit Health-Daten
    check <host>   Remote-Daemon pruefen (host oder host:port)
    deploy <u@h>   Remote-Deployment via SSH (Linux)
    remove <u@h>   Remote-Deinstallation via SSH [--purge]
    setup <tool>   MCP-Server in AI-Tool konfigurieren
                   Tools: codex, gemini, claude-desktop, claude-code, all
    mcp            MCP-Config-Snippet anzeigen
    mcp install    MCP in Claude Desktop + Code eintragen
    config show    Konfiguration anzeigen
    heartbeat      Cron-Heartbeat-Prompts (ADR-004 Phase 1) anzeigen / status
    uninstall      Service + Config entfernen

  ${C.bold}Beispiele:${C.reset}
    thinklocal bootstrap --local   # Lokaler localhost-only Modus
    thinklocal bootstrap --lan     # LAN-Mesh mit TLS/mTLS
    thinklocal start --lan         # Vordergrundstart im LAN-Modus
    thinklocal doctor        # Probleme finden
    thinklocal peers         # Wer ist im Mesh?
    thinklocal deploy chris@10.10.10.56  # Remote-Deploy
    thinklocal deploy chris@server --dry-run  # Nur zeigen

  ${C.bold}Env:${C.reset}
    TLMCP_PORT=9440          Daemon-Port
    TLMCP_DATA_DIR=~/.thinklocal  Datenverzeichnis
    TLMCP_RUNTIME_MODE=local|lan   Betriebsmodus
    TLMCP_BIND_HOST=127.0.0.1      Optionaler Bind-Override
`);
      return;
  }

  console.log(`  Unbekannter Befehl: ${cmd}`);
  console.log(`  Hilfe: thinklocal --help`);
}

main().catch((err) => {
  console.error(`${C.red}Fehler:${C.reset}`, err.message);
  process.exit(1);
});
