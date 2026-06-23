/**
 * Unit-Tests für ADR-028 D4-b Forward-Spec-Builder (rein, kein I/O/Netz/mcporter).
 */
import { describe, it, expect } from 'vitest';
import type { McpResolution } from './mcp-service-registry.js';
import type { McpRoutePlan } from './mcp-routing.js';
import { buildMcpForwardSpec, type McpForwardPeer } from './mcp-forward.js';

const SELF = 'spiffe://thinklocal/node/12D3KooWSELF';
const OWNER = 'spiffe://thinklocal/node/12D3KooWOWNER';

const resolution = (overrides: Partial<McpResolution> = {}): McpResolution => ({
  agent_id: OWNER,
  skill_id: 'mcp:unifi',
  description: 'UniFi',
  version: '1.0.0',
  trust_level: 4,
  health: 'healthy',
  execution_tier: 'gate',
  ...overrides,
});

const peer = (endpoint: string, agentId = OWNER): McpForwardPeer => ({ agentId, endpoint });
const peerMap =
  (...peers: McpForwardPeer[]) =>
  (id: string): McpForwardPeer | undefined =>
    peers.find((p) => p.agentId === id);

describe('buildMcpForwardSpec', () => {
  it('none-Plan → unavailable mit übernommenem Grund', () => {
    const plan: McpRoutePlan = { mode: 'none', server: 'unifi', reason: 'kein Provider registriert' };
    const spec = buildMcpForwardSpec({ plan, selfSenderUri: SELF, resolvePeer: peerMap() });
    expect(spec.kind).toBe('unavailable');
    if (spec.kind !== 'unavailable') throw new Error('x');
    expect(spec.reason).toBe('kein Provider registriert');
  });

  it('local-Plan → local-exec mit execution_tier (kein Peer-Lookup nötig)', () => {
    const plan: McpRoutePlan = { mode: 'local', server: 'unifi', execution_tier: 'self' };
    const spec = buildMcpForwardSpec({ plan, selfSenderUri: SELF, resolvePeer: peerMap() });
    expect(spec.kind).toBe('local-exec');
    if (spec.kind !== 'local-exec') throw new Error('x');
    expect(spec.execution_tier).toBe('self');
    expect(spec.server).toBe('unifi');
  });

  it('remote-Plan + HTTPS-Peer → remote-forward mit korrekter URL/Sender/Tier', () => {
    const plan: McpRoutePlan = { mode: 'remote', server: 'unifi', target: resolution() };
    const spec = buildMcpForwardSpec({
      plan,
      selfSenderUri: SELF,
      resolvePeer: peerMap(peer('https://10.10.10.82:9440')),
    });
    expect(spec.kind).toBe('remote-forward');
    if (spec.kind !== 'remote-forward') throw new Error('x');
    expect(spec.url).toBe('https://10.10.10.82:9440/api/mcp/unifi');
    expect(spec.senderUri).toBe(SELF);
    expect(spec.targetAgentId).toBe(OWNER);
    expect(spec.expectedServerSpiffeId).toBe(OWNER);
    expect(spec.execution_tier).toBe('gate');
    expect(spec.requireServerIdentity).toBe(false); // Default TOFU
  });

  it('übernimmt requireServerIdentity aus dem Flag', () => {
    const plan: McpRoutePlan = { mode: 'remote', server: 'unifi', target: resolution() };
    const spec = buildMcpForwardSpec({
      plan,
      selfSenderUri: SELF,
      resolvePeer: peerMap(peer('https://10.10.10.82:9440')),
      requireServerIdentity: true,
    });
    if (spec.kind !== 'remote-forward') throw new Error('x');
    expect(spec.requireServerIdentity).toBe(true);
  });

  it('strippt einen trailing-Slash am Endpoint (keine Doppel-Slashes)', () => {
    const plan: McpRoutePlan = { mode: 'remote', server: 'unifi', target: resolution() };
    const spec = buildMcpForwardSpec({
      plan,
      selfSenderUri: SELF,
      resolvePeer: peerMap(peer('https://10.10.10.82:9440/')),
    });
    if (spec.kind !== 'remote-forward') throw new Error('x');
    expect(spec.url).toBe('https://10.10.10.82:9440/api/mcp/unifi');
  });

  it('encodet einen Servernamen mit Sonderzeichen in der URL', () => {
    const plan: McpRoutePlan = { mode: 'remote', server: 'foo/bar baz', target: resolution({ skill_id: 'mcp:foo/bar baz' }) };
    const spec = buildMcpForwardSpec({
      plan,
      selfSenderUri: SELF,
      resolvePeer: peerMap(peer('https://10.10.10.82:9440')),
    });
    if (spec.kind !== 'remote-forward') throw new Error('x');
    expect(spec.url).toBe('https://10.10.10.82:9440/api/mcp/foo%2Fbar%20baz');
  });

  // CR-MEDIUM: Endpoint mit Path/Query/Userinfo darf NICHT in die Forward-URL durchschlagen.
  it('nimmt nur die origin (scheme://host:port) — Path/Query am Endpoint wird verworfen', () => {
    const plan: McpRoutePlan = { mode: 'remote', server: 'unifi', target: resolution() };
    const spec = buildMcpForwardSpec({
      plan,
      selfSenderUri: SELF,
      resolvePeer: peerMap(peer('https://10.10.10.82:9440/x?a=b')),
    });
    if (spec.kind !== 'remote-forward') throw new Error('x');
    expect(spec.url).toBe('https://10.10.10.82:9440/api/mcp/unifi');
  });

  it('verwirft Userinfo am Endpoint (kein user@ in der Forward-URL)', () => {
    const plan: McpRoutePlan = { mode: 'remote', server: 'unifi', target: resolution() };
    const spec = buildMcpForwardSpec({
      plan,
      selfSenderUri: SELF,
      resolvePeer: peerMap(peer('https://evil@10.10.10.82:9440')),
    });
    if (spec.kind !== 'remote-forward') throw new Error('x');
    expect(spec.url).toBe('https://10.10.10.82:9440/api/mcp/unifi');
    expect(spec.url).not.toContain('evil@');
  });

  it('fail-closed: kein Endpoint für den Provider → unavailable', () => {
    const plan: McpRoutePlan = { mode: 'remote', server: 'unifi', target: resolution() };
    const spec = buildMcpForwardSpec({ plan, selfSenderUri: SELF, resolvePeer: peerMap() });
    expect(spec.kind).toBe('unavailable');
    if (spec.kind !== 'unavailable') throw new Error('x');
    expect(spec.reason).toMatch(/kein Endpoint/);
  });

  it('fail-closed: leerer Endpoint-String → unavailable', () => {
    const plan: McpRoutePlan = { mode: 'remote', server: 'unifi', target: resolution() };
    const spec = buildMcpForwardSpec({ plan, selfSenderUri: SELF, resolvePeer: peerMap(peer('')) });
    expect(spec.kind).toBe('unavailable');
  });

  it('fail-closed: nicht-HTTPS-Endpoint (http) → unavailable, kein Plaintext-Forward', () => {
    const plan: McpRoutePlan = { mode: 'remote', server: 'unifi', target: resolution() };
    const spec = buildMcpForwardSpec({
      plan,
      selfSenderUri: SELF,
      resolvePeer: peerMap(peer('http://10.10.10.82:9440')),
    });
    expect(spec.kind).toBe('unavailable');
    if (spec.kind !== 'unavailable') throw new Error('x');
    expect(spec.reason).toMatch(/nicht-HTTPS/);
  });

  it('fail-closed: ungültiger Endpoint (kein URL) → unavailable', () => {
    const plan: McpRoutePlan = { mode: 'remote', server: 'unifi', target: resolution() };
    const spec = buildMcpForwardSpec({
      plan,
      selfSenderUri: SELF,
      resolvePeer: peerMap(peer('::::nonsense')),
    });
    expect(spec.kind).toBe('unavailable');
    if (spec.kind !== 'unavailable') throw new Error('x');
    expect(spec.reason).toMatch(/ungültiger Endpoint/);
  });

  it('fail-closed: leere eigene Sender-Identität bei Remote-Forward → unavailable', () => {
    const plan: McpRoutePlan = { mode: 'remote', server: 'unifi', target: resolution() };
    const spec = buildMcpForwardSpec({
      plan,
      selfSenderUri: '   ',
      resolvePeer: peerMap(peer('https://10.10.10.82:9440')),
    });
    expect(spec.kind).toBe('unavailable');
    if (spec.kind !== 'unavailable') throw new Error('x');
    expect(spec.reason).toMatch(/keine eigene Sender-Identität/);
  });

  it('local-exec braucht KEINE Sender-Identität (leerer Sender ist ok)', () => {
    const plan: McpRoutePlan = { mode: 'local', server: 'unifi', execution_tier: 'self' };
    const spec = buildMcpForwardSpec({ plan, selfSenderUri: '', resolvePeer: peerMap() });
    expect(spec.kind).toBe('local-exec');
  });
});
