/**
 * config-mcp-share.test.ts — ADR-028 D4-a Boot-Verdrahtung: loadConfig liest die
 * `[[mcp.share]]`-Sektion in `config.mcp.share` (roh; Validierung in parseSharedMcpConfig).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeFileSync, rmSync } from 'node:fs';
import { loadConfig } from './config.js';

const NO_TOML = join(tmpdir(), 'thinklocal-nonexistent-mcp-xyz.toml');

describe('loadConfig: mcp.share (ADR-028 D4-a)', () => {
  const written: string[] = [];
  afterEach(() => {
    for (const p of written.splice(0)) rmSync(p, { force: true });
  });

  const writeToml = (body: string): string => {
    const p = join(tmpdir(), `thinklocal-mcp-share-${Math.abs(hashStr(body))}.toml`);
    writeFileSync(p, body, 'utf-8');
    written.push(p);
    return p;
  };

  it('Default ist leeres Array (kein TOML)', () => {
    const cfg = loadConfig(NO_TOML);
    expect(cfg.mcp.share).toEqual([]);
  });

  it('liest [[mcp.share]]-Einträge roh in config.mcp.share', () => {
    const toml = [
      '[[mcp.share]]',
      'server = "markitdown"',
      'description = "Markdown conversion"',
      'permissions = ["convert"]',
      'trust_level = 5',
      '',
      '[[mcp.share]]',
      'server = "unifi"',
      'description = "UniFi controller"',
      'share = false',
    ].join('\n');
    const cfg = loadConfig(writeToml(toml));
    const share = cfg.mcp.share as Array<Record<string, unknown>>;
    expect(share).toHaveLength(2);
    expect(share[0].server).toBe('markitdown');
    expect(share[0].trust_level).toBe(5);
    expect(share[1].server).toBe('unifi');
    expect(share[1].share).toBe(false);
  });

  it('mis-shaped [mcp.share] (single table, not array-of-tables) is passed through as a non-array (deepMerge CR-MEDIUM)', () => {
    // `[mcp.share]` (single table) statt `[[mcp.share]]` → darf NICHT ins Array-Default
    // gemerged werden; muss als Nicht-Array durchgereicht werden, damit der Boot-Pfad
    // (parseSharedMcpConfig im try/catch) es als Strukturfehler erkennt statt still zu mergen.
    const cfg = loadConfig(writeToml('[mcp.share]\nserver = "x"\ndescription = "y"\n'));
    expect(Array.isArray(cfg.mcp.share)).toBe(false);
  });
});

// kleiner deterministischer String-Hash für eindeutige Temp-Dateinamen (kein Math.random im Pfad).
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return h;
}
