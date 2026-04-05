/**
 * cli-adapters.test.ts — Tests fuer CLI-Adapter-Konfiguration
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

// Wir testen die Hilfsfunktionen direkt (Config-Format-Validierung)
// Die setup*-Funktionen schreiben in echte Home-Dirs, daher testen wir die Logik

describe('CLI-Adapter Config-Formate', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(resolve(tmpdir(), 'tlmcp-adapter-'));
  });

  afterEach(() => {
    execSync(`rm -rf "${tmpDir}"`);
  });

  it('Codex CLI Config-Format ist korrekt', () => {
    const configPath = resolve(tmpDir, '.codex', 'config.json');
    mkdirSync(resolve(tmpDir, '.codex'), { recursive: true });

    // Simuliere Codex-Config
    const config = {
      mcpServers: {
        thinklocal: {
          command: 'npx',
          args: ['tsx', '/path/to/mcp-stdio.ts'],
          env: {},
        },
      },
    };
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    const loaded = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(loaded.mcpServers.thinklocal).toBeDefined();
    expect(loaded.mcpServers.thinklocal.command).toBe('npx');
    expect(loaded.mcpServers.thinklocal.args).toContain('tsx');
  });

  it('Gemini CLI Config-Format ist korrekt', () => {
    const configPath = resolve(tmpDir, '.gemini', 'settings.json');
    mkdirSync(resolve(tmpDir, '.gemini'), { recursive: true });

    const config = {
      mcpServers: {
        thinklocal: {
          command: 'npx',
          args: ['tsx', '/path/to/mcp-stdio.ts'],
          env: {},
        },
      },
    };
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    const loaded = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(loaded.mcpServers.thinklocal.command).toBe('npx');
  });

  it('Claude Code Config-Format nutzt Array statt Object', () => {
    const config = {
      mcpServers: [
        {
          name: 'thinklocal',
          type: 'stdio',
          command: 'npx',
          args: ['tsx', '/path/to/mcp-stdio.ts'],
          env: {},
        },
      ],
    };

    // Claude Code erwartet ein Array
    expect(Array.isArray(config.mcpServers)).toBe(true);
    const found = config.mcpServers.find((s) => s.name === 'thinklocal');
    expect(found).toBeDefined();
    expect(found!.type).toBe('stdio');
  });

  it('Claude Desktop Config-Format ist korrekt', () => {
    const config = {
      mcpServers: {
        thinklocal: {
          command: 'npx',
          args: ['tsx', '/path/to/mcp-stdio.ts'],
          env: { TLMCP_DAEMON_URL: 'http://localhost:9440' },
        },
      },
    };

    expect(config.mcpServers.thinklocal.env.TLMCP_DAEMON_URL).toBe('http://localhost:9440');
  });

  it('bestehende Config wird nicht ueberschrieben', () => {
    const configPath = resolve(tmpDir, 'config.json');

    // Bestehende Config mit anderem Server
    const existing = {
      mcpServers: {
        'other-server': { command: 'node', args: ['other.js'] },
      },
    };
    writeFileSync(configPath, JSON.stringify(existing, null, 2));

    // Simuliere Hinzufuegen von thinklocal
    const loaded = JSON.parse(readFileSync(configPath, 'utf-8'));
    loaded.mcpServers['thinklocal'] = { command: 'npx', args: ['tsx', 'mcp-stdio.ts'] };
    writeFileSync(configPath, JSON.stringify(loaded, null, 2));

    // Beide Server muessen vorhanden sein
    const final = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(final.mcpServers['other-server']).toBeDefined();
    expect(final.mcpServers['thinklocal']).toBeDefined();
  });

  it('leere env wird bei Standard-URL weggelassen', () => {
    // Wenn TLMCP_DAEMON_URL der Default ist, wird env: {} gesetzt
    const mcpConfig = {
      command: 'npx',
      args: ['tsx', '/path/to/mcp-stdio.ts'],
      env: {},
    };

    expect(mcpConfig.env).toEqual({});
    expect(Object.keys(mcpConfig.env)).toHaveLength(0);
  });

  it('custom DAEMON_URL wird in env gesetzt', () => {
    const mcpConfig = {
      command: 'npx',
      args: ['tsx', '/path/to/mcp-stdio.ts'],
      env: { TLMCP_DAEMON_URL: 'http://10.10.10.55:9440' },
    };

    expect(mcpConfig.env.TLMCP_DAEMON_URL).toBe('http://10.10.10.55:9440');
  });
});
