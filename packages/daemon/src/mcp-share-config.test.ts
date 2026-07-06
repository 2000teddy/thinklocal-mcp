// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * Unit tests for ADR-028 D4-a (Teil 2) shared-MCP config contract.
 */
import { describe, it, expect } from 'vitest';
import {
  parseSharedMcpConfig,
  enabledSharedMcps,
  DEFAULT_MCP_TRUST_LEVEL,
} from './mcp-share-config.js';

describe('parseSharedMcpConfig', () => {
  it('undefined / null → empty (no shared MCPs)', () => {
    expect(parseSharedMcpConfig(undefined)).toEqual([]);
    expect(parseSharedMcpConfig(null)).toEqual([]);
  });

  it('default-open: missing share → share=true; applies sensible defaults', () => {
    const [d] = parseSharedMcpConfig([{ server: 'unifi', description: 'UniFi controller' }]);
    expect(d.share).toBe(true);
    expect(d.server).toBe('unifi');
    expect(d.description).toBe('UniFi controller');
    expect(d.tools).toEqual([]);
    expect(d.version).toBe('0.0.0');
    expect(d.permissions).toEqual([]);
    expect(d.trust_level).toBe(DEFAULT_MCP_TRUST_LEVEL);
  });

  it('opt-out via explicit share=false is preserved (and only false opts out)', () => {
    const decls = parseSharedMcpConfig([
      { server: 'a', description: 'A', share: false },
      { server: 'b', description: 'B', share: true },
      { server: 'c', description: 'C' }, // default-open
    ]);
    expect(decls.map((d) => [d.server, d.share])).toEqual([
      ['a', false],
      ['b', true],
      ['c', true],
    ]);
  });

  it('preserves provided fields', () => {
    const [d] = parseSharedMcpConfig([{
      server: 'markitdown', description: 'Markdown conversion', tools: ['convert', 'render'],
      version: '2.1.0', permissions: ['convert'], trust_level: 5,
    }]);
    expect(d.tools).toEqual(['convert', 'render']);
    expect(d.version).toBe('2.1.0');
    expect(d.permissions).toEqual(['convert']);
    expect(d.trust_level).toBe(5);
  });

  it('throws on non-array config', () => {
    expect(() => parseSharedMcpConfig({ server: 'x' })).toThrow();
    expect(() => parseSharedMcpConfig('nope')).toThrow();
  });

  it('throws on missing/empty server', () => {
    expect(() => parseSharedMcpConfig([{ description: 'd' }])).toThrow(/server/);
    expect(() => parseSharedMcpConfig([{ server: '   ', description: 'd' }])).toThrow(/server/);
  });

  it('throws on missing/empty description (meaningful description is required)', () => {
    expect(() => parseSharedMcpConfig([{ server: 'x' }])).toThrow(/description/);
    expect(() => parseSharedMcpConfig([{ server: 'x', description: '' }])).toThrow(/description/);
  });

  it('throws on out-of-range / non-numeric trust_level', () => {
    expect(() => parseSharedMcpConfig([{ server: 'x', description: 'd', trust_level: 9 }])).toThrow(/trust_level/);
    expect(() => parseSharedMcpConfig([{ server: 'x', description: 'd', trust_level: -1 }])).toThrow(/trust_level/);
    expect(() => parseSharedMcpConfig([{ server: 'x', description: 'd', trust_level: 'high' }])).toThrow(/trust_level/);
    expect(() => parseSharedMcpConfig([{ server: 'x', description: 'd', trust_level: Number.NaN }])).toThrow(/trust_level/);
  });

  it('throws on malformed tools / permissions / version / share types', () => {
    expect(() => parseSharedMcpConfig([{ server: 'x', description: 'd', tools: 'a' }])).toThrow(/tools/);
    expect(() => parseSharedMcpConfig([{ server: 'x', description: 'd', permissions: [1, 2] }])).toThrow(/permissions/);
    expect(() => parseSharedMcpConfig([{ server: 'x', description: 'd', version: 1 }])).toThrow(/version/);
    expect(() => parseSharedMcpConfig([{ server: 'x', description: 'd', share: 'yes' }])).toThrow(/share/);
  });

  it('no falsy coercion on share: a non-boolean falsy value (0/null) is rejected, never silently opts out', () => {
    expect(() => parseSharedMcpConfig([{ server: 'x', description: 'd', share: 0 }])).toThrow(/share/);
    expect(() => parseSharedMcpConfig([{ server: 'x', description: 'd', share: null }])).toThrow(/share/);
  });

  it('throws on a non-table entry', () => {
    expect(() => parseSharedMcpConfig(['nope'])).toThrow(/Tabelle/);
  });
});

describe('enabledSharedMcps (default-open filter)', () => {
  it('returns all declared except opted-out (share=false); no allowlist logic', () => {
    const decls = parseSharedMcpConfig([
      { server: 'a', description: 'A' },
      { server: 'b', description: 'B', share: false },
      { server: 'c', description: 'C' },
    ]);
    expect(enabledSharedMcps(decls).map((d) => d.server)).toEqual(['a', 'c']);
  });

  it('empty in → empty out', () => {
    expect(enabledSharedMcps([])).toEqual([]);
  });
});
