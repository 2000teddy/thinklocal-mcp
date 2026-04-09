/**
 * Unit tests for ADR-005 SPIFFE URI helpers.
 */
import { describe, it, expect } from 'vitest';
import {
  parseSpiffeUri,
  normalizeAgentId,
  getAgentInstance,
  buildInstanceUri,
  hasInstance,
  SpiffeUriError,
} from './spiffe-uri.js';

const DAEMON = 'spiffe://thinklocal/host/69bc0bc908229c9f/agent/claude-code';
const INSTANCE = 'spiffe://thinklocal/host/69bc0bc908229c9f/agent/claude-code/instance/abc123';

describe('parseSpiffeUri', () => {
  it('parses a 3-component daemon URI', () => {
    const p = parseSpiffeUri(DAEMON);
    expect(p.stableNodeId).toBe('69bc0bc908229c9f');
    expect(p.agentType).toBe('claude-code');
    expect(p.instanceId).toBeUndefined();
    expect(p.raw).toBe(DAEMON);
  });

  it('parses a 4-component instance URI', () => {
    const p = parseSpiffeUri(INSTANCE);
    expect(p.stableNodeId).toBe('69bc0bc908229c9f');
    expect(p.agentType).toBe('claude-code');
    expect(p.instanceId).toBe('abc123');
  });

  it('rejects non-string input', () => {
    expect(() => parseSpiffeUri('' as string)).toThrow(SpiffeUriError);
    expect(() => parseSpiffeUri(undefined as unknown as string)).toThrow(SpiffeUriError);
  });

  it('rejects wrong scheme', () => {
    expect(() => parseSpiffeUri('http://example.com/foo')).toThrow(SpiffeUriError);
    expect(() => parseSpiffeUri('spiffe://other/host/x/agent/y')).toThrow(SpiffeUriError);
  });

  it('rejects wrong segment count', () => {
    expect(() => parseSpiffeUri('spiffe://thinklocal/host/x')).toThrow(SpiffeUriError);
    expect(() =>
      parseSpiffeUri('spiffe://thinklocal/host/x/agent/y/instance/z/extra'),
    ).toThrow(SpiffeUriError);
  });

  it('rejects wrong keywords at positions 0 and 2', () => {
    expect(() => parseSpiffeUri('spiffe://thinklocal/node/x/agent/y')).toThrow(SpiffeUriError);
    expect(() => parseSpiffeUri('spiffe://thinklocal/host/x/kind/y')).toThrow(SpiffeUriError);
  });

  it('rejects "/instance/" keyword mismatch', () => {
    expect(() =>
      parseSpiffeUri('spiffe://thinklocal/host/x/agent/y/inst/z'),
    ).toThrow(SpiffeUriError);
  });

  it('rejects empty components', () => {
    expect(() =>
      parseSpiffeUri('spiffe://thinklocal/host//agent/y'),
    ).toThrow(SpiffeUriError);
    expect(() =>
      parseSpiffeUri('spiffe://thinklocal/host/x/agent/y/instance/'),
    ).toThrow(SpiffeUriError);
  });
});

describe('normalizeAgentId', () => {
  it('strips the instance tail from a 4-component URI', () => {
    expect(normalizeAgentId(INSTANCE)).toBe(DAEMON);
  });

  it('returns a 3-component URI unchanged', () => {
    expect(normalizeAgentId(DAEMON)).toBe(DAEMON);
  });

  it('throws on malformed input', () => {
    expect(() => normalizeAgentId('not a uri')).toThrow(SpiffeUriError);
  });
});

describe('getAgentInstance', () => {
  it('returns the instance id from a 4-component URI', () => {
    expect(getAgentInstance(INSTANCE)).toBe('abc123');
  });

  it('returns undefined for a 3-component URI', () => {
    expect(getAgentInstance(DAEMON)).toBeUndefined();
  });
});

describe('buildInstanceUri', () => {
  it('builds a canonical 4-component URI', () => {
    expect(buildInstanceUri('69bc0bc908229c9f', 'claude-code', 'abc123')).toBe(INSTANCE);
  });

  it('rejects empty parts', () => {
    expect(() => buildInstanceUri('', 'claude-code', 'abc123')).toThrow(SpiffeUriError);
    expect(() => buildInstanceUri('node', '', 'abc123')).toThrow(SpiffeUriError);
    expect(() => buildInstanceUri('node', 'claude-code', '')).toThrow(SpiffeUriError);
  });
});

describe('SPIFFE_COMPONENT_REGEX (CR MEDIUM regression)', () => {
  // Gemini-Pro CR 2026-04-09: the parser must reject the same
  // invalid characters that the inbox-api query filter rejects,
  // or a 4-component URI could be stored with a tail that
  // `for_instance` later cannot match.
  const invalidCases = [
    'spiffe://thinklocal/host/node/agent/claude-code/instance/bad slash/here',
    'spiffe://thinklocal/host/node/agent/claude-code/instance/has space',
    "spiffe://thinklocal/host/node/agent/claude-code/instance/has'quote",
    'spiffe://thinklocal/host/node/agent/claude-code/instance/has"doublequote',
    'spiffe://thinklocal/host/node/agent/claude-code/instance/has;semi',
    'spiffe://thinklocal/host/node/agent/claude-code/instance/has%percent',
    'spiffe://thinklocal/host/nö/agent/claude-code',
    'spiffe://thinklocal/host/node/agent/claude\u0000code',
  ];

  for (const uri of invalidCases) {
    it(`rejects invalid characters: ${JSON.stringify(uri)}`, () => {
      expect(() => parseSpiffeUri(uri)).toThrow(SpiffeUriError);
    });
  }

  it('accepts canonical node ids and instance ids', () => {
    expect(() =>
      parseSpiffeUri(
        'spiffe://thinklocal/host/69bc0bc908229c9f/agent/claude-code/instance/inst-abc_123',
      ),
    ).not.toThrow();
  });
});

describe('hasInstance', () => {
  it('returns true for 4-component URIs', () => {
    expect(hasInstance(INSTANCE)).toBe(true);
  });

  it('returns false for 3-component URIs', () => {
    expect(hasInstance(DAEMON)).toBe(false);
  });

  it('returns false for malformed input without throwing', () => {
    expect(hasInstance('not a uri')).toBe(false);
    expect(hasInstance('')).toBe(false);
  });
});
