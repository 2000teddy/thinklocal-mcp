/**
 * websocket.test.ts — Tests fuer WebSocket-Server mit Subscriptions
 *
 * ADR-004 Phase 3: Subscription-Filter, Agent-Filter, Query-String-Parsing
 */

import { describe, it, expect } from 'vitest';
import { matchesSubscription, parseQuerySubscription, type ClientState } from './websocket.js';
import type { MeshEvent, MeshEventType } from './events.js';

// ─── Helper ────────────────────────────────────────────────────────

function makeEvent(type: MeshEventType, data: Record<string, unknown> = {}): MeshEvent {
  return { type, timestamp: new Date().toISOString(), data };
}

function makeState(opts: {
  events?: MeshEventType[];
  agent?: string | null;
} = {}): ClientState {
  return {
    ws: {} as ClientState['ws'], // dummy, not used in pure matching
    subscribedEvents: new Set(opts.events ?? []),
    agentFilter: opts.agent ?? null,
  };
}

// ─── matchesSubscription ───────────────────────────────────────────

describe('matchesSubscription', () => {
  it('matches all events when no filter is set', () => {
    const state = makeState();
    expect(matchesSubscription(makeEvent('inbox:new'), state)).toBe(true);
    expect(matchesSubscription(makeEvent('peer:join'), state)).toBe(true);
    expect(matchesSubscription(makeEvent('system:startup'), state)).toBe(true);
  });

  it('filters by event type', () => {
    const state = makeState({ events: ['inbox:new', 'peer:join'] });
    expect(matchesSubscription(makeEvent('inbox:new'), state)).toBe(true);
    expect(matchesSubscription(makeEvent('peer:join'), state)).toBe(true);
    expect(matchesSubscription(makeEvent('peer:leave'), state)).toBe(false);
    expect(matchesSubscription(makeEvent('system:startup'), state)).toBe(false);
  });

  it('filters by agent (data.to)', () => {
    const agent = 'spiffe://thinklocal/host/abc/agent/claude-code';
    const state = makeState({ agent });
    expect(matchesSubscription(makeEvent('inbox:new', { to: agent }), state)).toBe(true);
    expect(matchesSubscription(makeEvent('inbox:new', { to: 'other-agent' }), state)).toBe(false);
  });

  it('filters by agent (data.from)', () => {
    const agent = 'spiffe://thinklocal/host/abc/agent/claude-code';
    const state = makeState({ agent });
    expect(matchesSubscription(makeEvent('inbox:new', { from: agent }), state)).toBe(true);
  });

  it('filters by agent (data.agentId)', () => {
    const agent = 'spiffe://thinklocal/host/abc/agent/claude-code';
    const state = makeState({ agent });
    expect(matchesSubscription(makeEvent('peer:join', { agentId: agent }), state)).toBe(true);
  });

  it('filters by agent (data.peer_id)', () => {
    const agent = 'spiffe://thinklocal/host/abc/agent/claude-code';
    const state = makeState({ agent });
    expect(matchesSubscription(makeEvent('peer:leave', { peer_id: agent }), state)).toBe(true);
  });

  it('combines event type + agent filter', () => {
    const agent = 'spiffe://thinklocal/host/abc/agent/claude-code';
    const state = makeState({ events: ['inbox:new'], agent });

    // Both match
    expect(matchesSubscription(makeEvent('inbox:new', { to: agent }), state)).toBe(true);
    // Wrong event type
    expect(matchesSubscription(makeEvent('peer:join', { agentId: agent }), state)).toBe(false);
    // Right event, wrong agent
    expect(matchesSubscription(makeEvent('inbox:new', { to: 'other' }), state)).toBe(false);
  });

  it('agent filter does not match when none of to/from/agentId/peer_id present', () => {
    const state = makeState({ agent: 'spiffe://thinklocal/host/abc/agent/x' });
    expect(matchesSubscription(makeEvent('system:startup', {}), state)).toBe(false);
  });
});

// ─── parseQuerySubscription ────────────────────────────────────────

describe('parseQuerySubscription', () => {
  it('returns empty set when no subscribe param', () => {
    const result = parseQuerySubscription({});
    expect(result.events.size).toBe(0);
    expect(result.agent).toBeNull();
  });

  it('parses comma-separated event types', () => {
    const result = parseQuerySubscription({ subscribe: 'inbox:new,peer:join' });
    expect(result.events.has('inbox:new' as MeshEventType)).toBe(true);
    expect(result.events.has('peer:join' as MeshEventType)).toBe(true);
    expect(result.events.size).toBe(2);
  });

  it('trims whitespace in event types', () => {
    const result = parseQuerySubscription({ subscribe: ' inbox:new , peer:join ' });
    expect(result.events.has('inbox:new' as MeshEventType)).toBe(true);
    expect(result.events.has('peer:join' as MeshEventType)).toBe(true);
  });

  it('parses agent filter', () => {
    const agent = 'spiffe://thinklocal/host/abc/agent/claude-code';
    const result = parseQuerySubscription({ subscribe: 'inbox:new', agent });
    expect(result.agent).toBe(agent);
  });

  it('handles single event type', () => {
    const result = parseQuerySubscription({ subscribe: 'inbox:new' });
    expect(result.events.size).toBe(1);
    expect(result.events.has('inbox:new' as MeshEventType)).toBe(true);
  });

  it('ignores empty segments in comma-separated list', () => {
    const result = parseQuerySubscription({ subscribe: 'inbox:new,,peer:join,' });
    expect(result.events.size).toBe(2);
  });
});

// ─── inbox:new event shape ─────────────────────────────────────────

describe('inbox:new event filtering', () => {
  it('inbox:new event with to field matches agent subscription', () => {
    const myAgent = 'spiffe://thinklocal/host/69bc/agent/claude-code';
    const state = makeState({ events: ['inbox:new'], agent: myAgent });

    const event = makeEvent('inbox:new', {
      from: 'spiffe://thinklocal/host/68f7/agent/claude-code',
      message_id: 'msg-123',
      subject: 'Test',
      to: myAgent,
    });

    expect(matchesSubscription(event, state)).toBe(true);
  });

  it('inbox:new from different agent does not match', () => {
    const myAgent = 'spiffe://thinklocal/host/69bc/agent/claude-code';
    const state = makeState({ events: ['inbox:new'], agent: myAgent });

    const event = makeEvent('inbox:new', {
      from: 'spiffe://thinklocal/host/68f7/agent/claude-code',
      message_id: 'msg-123',
      to: 'spiffe://thinklocal/host/other/agent/claude-code',
    });

    expect(matchesSubscription(event, state)).toBe(false);
  });
});
