// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * websocket.test.ts — Tests fuer WebSocket-Server mit Subscriptions
 *
 * ADR-004 Phase 3: Subscription-Filter, Agent-Filter, Query-String-Parsing
 */

import { describe, it, expect } from 'vitest';
import { matchesSubscription, parseQuerySubscription, rejectsAgentFilter, isLoopbackIp, type ClientState } from './websocket.js';
import type { MeshEvent, MeshEventType } from './events.js';

// ─── Helper ────────────────────────────────────────────────────────

function makeEvent(type: MeshEventType, data: Record<string, unknown> = {}): MeshEvent {
  return { type, timestamp: new Date().toISOString(), data };
}

function makeState(opts: {
  events?: MeshEventType[];
  agent?: string | null;
  isLoopback?: boolean;
} = {}): ClientState {
  return {
    ws: {} as ClientState['ws'], // dummy, not used in pure matching
    subscribedEvents: new Set(opts.events ?? []),
    agentFilter: opts.agent ?? null,
    isLoopback: opts.isLoopback ?? true,
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

  // ─── TL-11: directed event (agent:wake) ────────────────────────────
  const SP = 'spiffe://thinklocal/host/h/agent/claude-code/instance/inst-a';

  it('directed agent:wake: NEVER delivered to an unfiltered client (Leak zu, D1)', () => {
    const state = makeState({}); // kein agentFilter → sonst „alles"
    expect(matchesSubscription(makeEvent('agent:wake', { instance_id: 'inst-a', spiffe_uri: SP }), state)).toBe(false);
  });

  it('directed agent:wake: matcht agentFilter=spiffe_uri (routbar, D2)', () => {
    const state = makeState({ agent: SP });
    expect(matchesSubscription(makeEvent('agent:wake', { instance_id: 'inst-a', spiffe_uri: SP }), state)).toBe(true);
  });

  it('directed agent:wake: matcht agentFilter=instance_id', () => {
    const state = makeState({ agent: 'inst-a' });
    expect(matchesSubscription(makeEvent('agent:wake', { instance_id: 'inst-a', spiffe_uri: SP }), state)).toBe(true);
  });

  it('directed agent:wake: nicht-passender Filter → drop (deny-by-default)', () => {
    const state = makeState({ agent: 'someone-else' });
    expect(matchesSubscription(makeEvent('agent:wake', { instance_id: 'inst-a', spiffe_uri: SP }), state)).toBe(false);
  });

  it('directed agent:wake: event-type-Filter greift weiterhin (nur inbox:new abonniert)', () => {
    const state = makeState({ events: ['inbox:new'], agent: SP });
    expect(matchesSubscription(makeEvent('agent:wake', { instance_id: 'inst-a', spiffe_uri: SP }), state)).toBe(false);
  });

  it('REGRESSION: nicht-directed Event an ungefilterten Client → unverändert Delivery', () => {
    const state = makeState({});
    expect(matchesSubscription(makeEvent('inbox:new', { to_agent_instance: 'inst-a' }), state)).toBe(true);
    expect(matchesSubscription(makeEvent('peer:join', { agentId: 'x' }), state)).toBe(true);
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

// ─── TL-11 §8.1-Härtung: Loopback-only für agent-Filter (Query UND Frame) ───────────
describe('isLoopbackIp', () => {
  it('erkennt IPv4/IPv6/IPv4-mapped Loopback', () => {
    expect(isLoopbackIp('127.0.0.1')).toBe(true);
    expect(isLoopbackIp('::1')).toBe(true);
    expect(isLoopbackIp('::ffff:127.0.0.1')).toBe(true);
  });
  it('lehnt Nicht-Loopback + undefined ab', () => {
    expect(isLoopbackIp('10.10.10.55')).toBe(false);
    expect(isLoopbackIp('100.103.115.126')).toBe(false);
    expect(isLoopbackIp(undefined)).toBe(false);
  });
});

describe('rejectsAgentFilter (Loopback-only-Regel — beide Pfade, §8.1)', () => {
  it('nicht-leerer agent von NICHT-Loopback → abgelehnt (schließt Frame-Bypass)', () => {
    expect(rejectsAgentFilter('spiffe://thinklocal/node/PID', false)).toBe(true);
  });
  it('nicht-leerer agent von Loopback → erlaubt', () => {
    expect(rejectsAgentFilter('spiffe://thinklocal/node/PID', true)).toBe(false);
  });
  it('leerer agent (= Filter löschen) → erlaubt, auch von Nicht-Loopback', () => {
    expect(rejectsAgentFilter('', false)).toBe(false);
  });
  it('fehlender agent (null/undefined) → erlaubt (kein Filter präsent)', () => {
    expect(rejectsAgentFilter(undefined, false)).toBe(false);
    expect(rejectsAgentFilter(null, false)).toBe(false);
  });
  it('CR-LOW L1: präsenter Nicht-String agent (Array/Number) von Nicht-Loopback → abgelehnt (fail-closed, keine Asymmetrie)', () => {
    expect(rejectsAgentFilter(['a', 'b'], false)).toBe(true);   // ?agent=a&agent=b → Array
    expect(rejectsAgentFilter(123, false)).toBe(true);
    // von Loopback bleibt jeder Wert erlaubt (der String-Setter ignoriert Nicht-Strings ohnehin)
    expect(rejectsAgentFilter(['a', 'b'], true)).toBe(false);
  });
  it('Query- und Frame-Pfad teilen dieselbe Regel → keine Umgehung per Frame', () => {
    const agent = 'spiffe://thinklocal/node/victim';
    // identisches Verhalten unabhängig vom Pfad — nur isLoopback entscheidet
    expect(rejectsAgentFilter(agent, false)).toBe(true);  // remote → immer abgelehnt
    expect(rejectsAgentFilter(agent, true)).toBe(false);  // loopback → immer erlaubt
  });
});
