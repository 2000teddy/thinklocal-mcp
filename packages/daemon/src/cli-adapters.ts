/**
 * cli-adapters.ts — Konfigurationsgeneratoren fuer AI CLI Tools
 *
 * Erzeugt die korrekte MCP-Server-Konfiguration fuer:
 * - Codex CLI (OpenAI) — ~/.codex/config.json
 * - Gemini CLI (Google) — ~/.gemini/settings.json
 * - Claude Desktop — ~/Library/Application Support/Claude/claude_desktop_config.json
 * - Claude Code — ~/.claude.json (oder .claude/settings.json)
 *
 * Alle nutzen den gleichen mcp-stdio.ts Einstiegspunkt,
 * aber jedes Tool erwartet ein anderes Config-Format.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import type { Logger } from 'pino';

export interface AdapterSetupResult {
  /** Welches Tool konfiguriert wurde */
  tool: string;
  /** Pfad zur Config-Datei */
  configPath: string;
  /** Ob die Config neu erstellt oder aktualisiert wurde */
  action: 'created' | 'updated' | 'already_configured';
  /** Die geschriebene MCP-Server-Konfiguration */
  mcpConfig: Record<string, unknown>;
}

/**
 * Ermittelt den Pfad zum mcp-stdio.ts Einstiegspunkt.
 */
function getMcpEntryPoint(): string {
  // Relative zum Projekt-Root
  return resolve(dirname(new URL(import.meta.url).pathname), '..', '..', '..', 'packages', 'daemon', 'src', 'mcp-stdio.ts');
}

/**
 * Basis-MCP-Server-Definition fuer alle Tools.
 */
function baseMcpServerConfig(daemonUrl?: string): {
  command: string;
  args: string[];
  env: Record<string, string>;
} {
  const entryPoint = getMcpEntryPoint();
  return {
    command: 'npx',
    args: ['tsx', entryPoint],
    env: {
      ...(daemonUrl ? { TLMCP_DAEMON_URL: daemonUrl } : {}),
    },
  };
}

// ─── Codex CLI ────────────────────────────────────────────────

/**
 * Codex CLI (OpenAI) MCP-Server-Konfiguration.
 * Config: ~/.codex/config.json
 * Format: { "mcpServers": { "name": { "command": "...", "args": [...] } } }
 */
export function setupCodexCli(daemonUrl?: string, log?: Logger): AdapterSetupResult {
  const configPath = resolve(homedir(), '.codex', 'config.json');
  const mcpConfig = baseMcpServerConfig(daemonUrl);

  const existing = loadJsonFile(configPath);
  const config = existing ?? {};

  if (!config.mcpServers) config.mcpServers = {};

  // Pruefen ob schon konfiguriert
  const servers = config.mcpServers as Record<string, unknown>;
  if (servers['thinklocal']) {
    const current = JSON.stringify(servers['thinklocal']);
    const wanted = JSON.stringify(mcpConfig);
    if (current === wanted) {
      log?.info('Codex CLI: thinklocal MCP-Server bereits konfiguriert');
      return { tool: 'codex-cli', configPath, action: 'already_configured', mcpConfig };
    }
  }

  servers['thinklocal'] = mcpConfig;
  writeJsonFile(configPath, config);

  const action = existing ? 'updated' : 'created';
  log?.info({ configPath, action }, 'Codex CLI: thinklocal MCP-Server konfiguriert');
  return { tool: 'codex-cli', configPath, action, mcpConfig };
}

// ─── Gemini CLI ───────────────────────────────────────────────

/**
 * Gemini CLI (Google) MCP-Server-Konfiguration.
 * Config: ~/.gemini/settings.json
 * Format: { "mcpServers": { "name": { "command": "...", "args": [...] } } }
 */
export function setupGeminiCli(daemonUrl?: string, log?: Logger): AdapterSetupResult {
  const configPath = resolve(homedir(), '.gemini', 'settings.json');
  const mcpConfig = baseMcpServerConfig(daemonUrl);

  const existing = loadJsonFile(configPath);
  const config = existing ?? {};

  if (!config.mcpServers) config.mcpServers = {};

  const servers = config.mcpServers as Record<string, unknown>;
  if (servers['thinklocal']) {
    const current = JSON.stringify(servers['thinklocal']);
    const wanted = JSON.stringify(mcpConfig);
    if (current === wanted) {
      log?.info('Gemini CLI: thinklocal MCP-Server bereits konfiguriert');
      return { tool: 'gemini-cli', configPath, action: 'already_configured', mcpConfig };
    }
  }

  servers['thinklocal'] = mcpConfig;
  writeJsonFile(configPath, config);

  const action = existing ? 'updated' : 'created';
  log?.info({ configPath, action }, 'Gemini CLI: thinklocal MCP-Server konfiguriert');
  return { tool: 'gemini-cli', configPath, action, mcpConfig };
}

// ─── Claude Desktop ───────────────────────────────────────────

/**
 * Claude Desktop MCP-Server-Konfiguration.
 * Config: ~/Library/Application Support/Claude/claude_desktop_config.json (macOS)
 *         %APPDATA%/Claude/claude_desktop_config.json (Windows)
 * Format: { "mcpServers": { "name": { "command": "...", "args": [...] } } }
 */
export function setupClaudeDesktop(daemonUrl?: string, log?: Logger): AdapterSetupResult {
  const configPath = process.platform === 'darwin'
    ? resolve(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
    : process.platform === 'win32'
      ? resolve(process.env['APPDATA'] ?? homedir(), 'Claude', 'claude_desktop_config.json')
      : resolve(homedir(), '.config', 'claude', 'claude_desktop_config.json');

  const mcpConfig = baseMcpServerConfig(daemonUrl);

  const existing = loadJsonFile(configPath);
  const config = existing ?? {};

  if (!config.mcpServers) config.mcpServers = {};

  const servers = config.mcpServers as Record<string, unknown>;
  if (servers['thinklocal']) {
    const current = JSON.stringify(servers['thinklocal']);
    const wanted = JSON.stringify(mcpConfig);
    if (current === wanted) {
      log?.info('Claude Desktop: thinklocal MCP-Server bereits konfiguriert');
      return { tool: 'claude-desktop', configPath, action: 'already_configured', mcpConfig };
    }
  }

  servers['thinklocal'] = mcpConfig;
  writeJsonFile(configPath, config);

  const action = existing ? 'updated' : 'created';
  log?.info({ configPath, action }, 'Claude Desktop: thinklocal MCP-Server konfiguriert');
  return { tool: 'claude-desktop', configPath, action, mcpConfig };
}

// ─── Claude Code ──────────────────────────────────────────────

/**
 * Claude Code MCP-Server-Konfiguration.
 * Config: ~/.claude/settings.json (global) oder .claude/settings.json (projekt-lokal)
 * Format: { "mcpServers": [{ "name": "...", "type": "stdio", "command": "...", "args": [...] }] }
 *
 * Hinweis: Claude Code hat ein Array-Format statt Object-Format.
 */
export function setupClaudeCode(daemonUrl?: string, log?: Logger): AdapterSetupResult {
  const configPath = resolve(homedir(), '.claude', 'settings.json');
  const base = baseMcpServerConfig(daemonUrl);

  const mcpConfig = {
    name: 'thinklocal',
    type: 'stdio',
    command: base.command,
    args: base.args,
    env: base.env,
  };

  const existing = loadJsonFile(configPath);
  const config = existing ?? {};

  if (!config.mcpServers) config.mcpServers = [];

  const servers = config.mcpServers as Array<{ name: string; [key: string]: unknown }>;
  const idx = servers.findIndex((s) => s.name === 'thinklocal');

  if (idx >= 0) {
    const current = JSON.stringify(servers[idx]);
    const wanted = JSON.stringify(mcpConfig);
    if (current === wanted) {
      log?.info('Claude Code: thinklocal MCP-Server bereits konfiguriert');
      return { tool: 'claude-code', configPath, action: 'already_configured', mcpConfig };
    }
    servers[idx] = mcpConfig;
  } else {
    servers.push(mcpConfig);
  }

  writeJsonFile(configPath, config);

  const action = existing && idx >= 0 ? 'updated' : 'created';
  log?.info({ configPath, action }, 'Claude Code: thinklocal MCP-Server konfiguriert');
  return { tool: 'claude-code', configPath, action, mcpConfig };
}

// ─── Alle Tools auf einmal ────────────────────────────────────

export type SupportedTool = 'codex' | 'gemini' | 'claude-desktop' | 'claude-code' | 'all';

/**
 * Richtet thinklocal MCP-Server fuer ein oder alle Tools ein.
 */
export function setupAdapter(tool: SupportedTool, daemonUrl?: string, log?: Logger): AdapterSetupResult[] {
  const results: AdapterSetupResult[] = [];

  if (tool === 'codex' || tool === 'all') results.push(setupCodexCli(daemonUrl, log));
  if (tool === 'gemini' || tool === 'all') results.push(setupGeminiCli(daemonUrl, log));
  if (tool === 'claude-desktop' || tool === 'all') results.push(setupClaudeDesktop(daemonUrl, log));
  if (tool === 'claude-code' || tool === 'all') results.push(setupClaudeCode(daemonUrl, log));

  return results;
}

/**
 * Listet alle unterstuetzten Tools und deren Config-Pfade.
 */
export function listSupportedTools(): Array<{ tool: string; configPath: string; installed: boolean }> {
  return [
    {
      tool: 'codex-cli',
      configPath: resolve(homedir(), '.codex', 'config.json'),
      installed: existsSync(resolve(homedir(), '.codex')),
    },
    {
      tool: 'gemini-cli',
      configPath: resolve(homedir(), '.gemini', 'settings.json'),
      installed: existsSync(resolve(homedir(), '.gemini')),
    },
    {
      tool: 'claude-desktop',
      configPath: process.platform === 'darwin'
        ? resolve(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
        : resolve(homedir(), '.config', 'claude', 'claude_desktop_config.json'),
      installed: process.platform === 'darwin'
        ? existsSync(resolve(homedir(), 'Library', 'Application Support', 'Claude'))
        : existsSync(resolve(homedir(), '.config', 'claude')),
    },
    {
      tool: 'claude-code',
      configPath: resolve(homedir(), '.claude', 'settings.json'),
      installed: existsSync(resolve(homedir(), '.claude')),
    },
  ];
}

// ─── Hilfsfunktionen ─────────────────────────────────────────

function loadJsonFile(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function writeJsonFile(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}
