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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync, spawn } from 'node:child_process';

const HOME = homedir();
const PLATFORM = platform();
const DATA_DIR = process.env['TLMCP_DATA_DIR'] ?? resolve(HOME, '.thinklocal');
const DAEMON_PORT = Number(process.env['TLMCP_PORT'] ?? '9440');
const DAEMON_URL = `http://localhost:${DAEMON_PORT}`;
const INSTALL_DIR = resolve(import.meta.dirname, '..', '..', '..');

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
  try {
    const res = await fetch(`${DAEMON_URL}/health`, { signal: AbortSignal.timeout(2_000) });
    return res.ok;
  } catch { return false; }
}

async function fetchStatus(): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${DAEMON_URL}/api/status`, { signal: AbortSignal.timeout(3_000) });
    return res.ok ? (await res.json()) as Record<string, unknown> : null;
  } catch { return null; }
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

async function cmdStart(): Promise<void> {
  header('Daemon starten');

  if (await isDaemonRunning()) {
    ok('Daemon laeuft bereits');
    return;
  }

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

  const child = spawn(tsxPath, [indexPath], {
    cwd: INSTALL_DIR,
    stdio: 'inherit',
    env: {
      ...process.env,
      TLMCP_DATA_DIR: DATA_DIR,
      TLMCP_CONFIG: resolve(INSTALL_DIR, 'config', 'daemon.toml'),
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
    else { warn(`Node.js ${nodeV} — Version 20+ empfohlen`); issues++; }
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
  let claudeConfigPath = '';
  if (PLATFORM === 'darwin') {
    claudeConfigPath = resolve(HOME, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  } else if (PLATFORM === 'linux') {
    claudeConfigPath = resolve(HOME, '.config', 'Claude', 'claude_desktop_config.json');
  }
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

async function cmdBootstrap(): Promise<void> {
  header('thinklocal bootstrap — Ersteinrichtung');

  // 1. Datenverzeichnis
  mkdirSync(resolve(DATA_DIR, 'logs'), { recursive: true });
  mkdirSync(resolve(DATA_DIR, 'keys'), { recursive: true });
  mkdirSync(resolve(DATA_DIR, 'tls'), { recursive: true });
  mkdirSync(resolve(DATA_DIR, 'audit'), { recursive: true });
  mkdirSync(resolve(DATA_DIR, 'vault'), { recursive: true });
  mkdirSync(resolve(DATA_DIR, 'skills'), { recursive: true });
  mkdirSync(resolve(DATA_DIR, 'pairing'), { recursive: true });
  ok(`Datenverzeichnis: ${DATA_DIR}`);

  // 2. MCP-Konfiguration (~/.mcp.json)
  const mcpPath = resolve(HOME, '.mcp.json');
  const tsxPath = resolve(INSTALL_DIR, 'packages', 'daemon', 'node_modules', '.bin', 'tsx');
  const mcpStdioPath = resolve(INSTALL_DIR, 'packages', 'daemon', 'src', 'mcp-stdio.ts');

  if (!existsSync(mcpPath)) {
    const mcpConfig = {
      mcpServers: {
        thinklocal: {
          command: tsxPath,
          args: [mcpStdioPath],
          env: { TLMCP_DAEMON_URL: DAEMON_URL },
        },
      },
    };
    writeFileSync(mcpPath, JSON.stringify(mcpConfig, null, 2) + '\n', { mode: 0o644 });
    ok('~/.mcp.json erstellt (Claude Code global)');
  } else {
    const existing = readFileSync(mcpPath, 'utf-8');
    if (existing.includes('thinklocal')) {
      ok('~/.mcp.json bereits konfiguriert');
    } else {
      warn('~/.mcp.json existiert — bitte thinklocal manuell hinzufuegen');
      info(`Befehl: thinklocal mcp config --claude-code`);
    }
  }

  // 3. Claude Desktop Config
  let claudeConfigPath = '';
  if (PLATFORM === 'darwin') {
    claudeConfigPath = resolve(HOME, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  } else if (PLATFORM === 'linux') {
    claudeConfigPath = resolve(HOME, '.config', 'Claude', 'claude_desktop_config.json');
  }

  if (claudeConfigPath) {
    if (!existsSync(claudeConfigPath)) {
      mkdirSync(resolve(claudeConfigPath, '..'), { recursive: true });
      const desktopConfig = {
        mcpServers: {
          thinklocal: {
            command: tsxPath,
            args: [mcpStdioPath],
            env: { TLMCP_DAEMON_URL: DAEMON_URL },
          },
        },
      };
      writeFileSync(claudeConfigPath, JSON.stringify(desktopConfig, null, 2) + '\n');
      ok('Claude Desktop konfiguriert');
    } else {
      const existing = readFileSync(claudeConfigPath, 'utf-8');
      if (existing.includes('thinklocal')) {
        ok('Claude Desktop bereits konfiguriert');
      } else {
        warn('Claude Desktop Config existiert — thinklocal muss manuell hinzugefuegt werden');
      }
    }
  }

  // 4. Daemon einmal starten (generiert Keys + Certs)
  info('Starte Daemon kurz um Keys zu generieren...');
  try {
    const result = execSync(
      `TLMCP_DATA_DIR="${DATA_DIR}" TLMCP_NO_TLS=1 timeout 5 ${tsxPath} ${resolve(INSTALL_DIR, 'packages', 'daemon', 'src', 'index.ts')} 2>&1 || true`,
      { encoding: 'utf-8', cwd: INSTALL_DIR, timeout: 10_000 },
    );
    if (result.includes('Keypair gespeichert') || result.includes('Keypair geladen')) {
      ok('Agent-Keypair generiert');
    }
  } catch {
    // Timeout ist erwartet — Keys sollten trotzdem generiert worden sein
    if (existsSync(resolve(DATA_DIR, 'keys', 'agent.pub.pem'))) {
      ok('Agent-Keypair generiert');
    }
  }

  console.log();
  console.log(`  ${C.green}${C.bold}Bootstrap abgeschlossen!${C.reset}`);
  console.log();
  console.log(`  Naechste Schritte:`);
  console.log(`  1. Daemon starten:   ${C.bold}thinklocal start${C.reset}`);
  console.log(`  2. Status pruefen:   ${C.bold}thinklocal status${C.reset}`);
  console.log(`  3. Diagnose:         ${C.bold}thinklocal doctor${C.reset}`);
  console.log(`  4. Claude Code:      Neues Terminal oeffnen — Tools sind automatisch da`);
  console.log();
}

async function cmdPeers(): Promise<void> {
  header('Verbundene Peers');
  if (!(await isDaemonRunning())) {
    fail('Daemon laeuft nicht');
    return;
  }

  try {
    const res = await fetch(`${DAEMON_URL}/api/peers`, { signal: AbortSignal.timeout(3_000) });
    const data = (await res.json()) as { peers: Array<Record<string, unknown>> };

    if (data.peers.length === 0) {
      info('Keine Peers verbunden (allein im Mesh)');
      return;
    }

    for (const p of data.peers) {
      const card = p['agent_card'] as Record<string, unknown> | null;
      const agents = card ? (card['capabilities'] as Record<string, unknown>)?.['agents'] : null;
      console.log(`  ${C.green}●${C.reset} ${p['name']}`);
      console.log(`    ${C.dim}${p['host']}:${p['port']} | ${agents ?? 'unknown'}${C.reset}`);
    }
    console.log(`\n  ${data.peers.length} Peer(s) verbunden\n`);
  } catch {
    fail('Konnte Peer-Daten nicht abrufen');
  }
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

// --- Main ---

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = args[0];

  switch (cmd) {
    case 'start': return cmdStart();
    case 'stop': return cmdStop();
    case 'restart': return cmdRestart();
    case 'status': return cmdStatus();
    case 'doctor': return cmdDoctor();
    case 'logs': return cmdLogs();
    case 'bootstrap': return cmdBootstrap();
    case 'peers': return cmdPeers();
    case 'config':
      if (args[1] === 'show' || !args[1]) return cmdConfigShow();
      break;
    case undefined:
    case '--help':
    case '-h':
    case 'help':
      console.log(`
  ${C.bold}thinklocal${C.reset} — Mesh-Netzwerk fuer AI CLI Agenten

  ${C.bold}Befehle:${C.reset}
    start          Daemon starten
    stop           Daemon stoppen
    restart        Daemon neu starten
    status         Status anzeigen
    doctor         Systemdiagnose (prueft alles)
    logs           Live-Logs anzeigen
    bootstrap      Ersteinrichtung (Keys, Config, MCP)
    peers          Verbundene Peers anzeigen
    config show    Konfiguration anzeigen

  ${C.bold}Beispiele:${C.reset}
    thinklocal bootstrap     # Einmalig: alles einrichten
    thinklocal start         # Daemon starten
    thinklocal doctor        # Probleme finden
    thinklocal peers         # Wer ist im Mesh?

  ${C.bold}Env:${C.reset}
    TLMCP_PORT=9440          Daemon-Port
    TLMCP_DATA_DIR=~/.thinklocal  Datenverzeichnis
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
