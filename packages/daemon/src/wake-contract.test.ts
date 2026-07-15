// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * wake-contract.test.ts — ADR-043 (TL-11 Slice A). Deckt die Invarianten (CO opus+sonnet):
 * fail-closed Fanout (unadressiert/nicht-live → []), Coalescing (per-Instanz, Fenster), Zero-Content,
 * und die Verdrahtung: inbox:new (adressiert/live) → agent:wake; unadressiert → kein Wake + WARN.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveWakeTargets,
  WakeCoalescer,
  computeWakes,
  registerWakeEmitter,
  DEFAULT_WAKE_COALESCE_MS,
  type WakeEventBus,
} from './wake-contract.js';

const LIVE = ['inst-a', 'inst-b'];

describe('resolveWakeTargets (fail-closed)', () => {
  it('adressierte, live Instanz → [it]', () => {
    expect(resolveWakeTargets('inst-a', LIVE)).toEqual(['inst-a']);
  });
  it('unadressiert (null/undefined/leer) → [] (KEIN Broadcast)', () => {
    expect(resolveWakeTargets(null, LIVE)).toEqual([]);
    expect(resolveWakeTargets(undefined, LIVE)).toEqual([]);
    expect(resolveWakeTargets('', LIVE)).toEqual([]);
  });
  it('adressiert aber nicht live → []', () => {
    expect(resolveWakeTargets('inst-x', LIVE)).toEqual([]);
  });
});

describe('WakeCoalescer', () => {
  it('erster Wake true, rascher Repeat false, nach Fenster wieder true', () => {
    const c = new WakeCoalescer(1000);
    expect(c.shouldWake('a', 0)).toBe(true);
    expect(c.shouldWake('a', 500)).toBe(false); // im Fenster
    expect(c.shouldWake('a', 1000)).toBe(true); // Fenster abgelaufen
  });
  it('Instanzen sind unabhängig', () => {
    const c = new WakeCoalescer(1000);
    expect(c.shouldWake('a', 0)).toBe(true);
    expect(c.shouldWake('b', 0)).toBe(true); // andere Instanz, nicht gedämpft
  });
  it('Default-Fenster ist gesetzt', () => {
    expect(DEFAULT_WAKE_COALESCE_MS).toBeGreaterThan(0);
  });
});

describe('computeWakes', () => {
  it('adressiert+live → genau 1 inhaltsfreies WakeSignal', () => {
    const wakes = computeWakes('inst-a', LIVE, new WakeCoalescer(), 0);
    expect(wakes).toEqual([{ instanceId: 'inst-a', reason: 'inbox' }]);
  });
  it('zwei rasche Nachrichten → nur 1 Wake (coalesced)', () => {
    const c = new WakeCoalescer(1000);
    expect(computeWakes('inst-a', LIVE, c, 0)).toHaveLength(1);
    expect(computeWakes('inst-a', LIVE, c, 100)).toHaveLength(0);
  });
  it('unadressiert → 0 Wakes (fail-closed, kein Fanout)', () => {
    expect(computeWakes(null, LIVE, new WakeCoalescer(), 0)).toEqual([]);
  });
});

// --- Verdrahtung (Emitter-Seam) mit fake EventBus ---
function fakeBus(): WakeEventBus & {
  fire: (data: Record<string, unknown>) => void;
  emitted: Array<{ type: string; data: Record<string, unknown> }>;
} {
  let handler: ((e: { type: string; data: Record<string, unknown> }) => void) | undefined;
  const emitted: Array<{ type: string; data: Record<string, unknown> }> = [];
  return {
    on: (_type, h) => {
      handler = h;
    },
    emit: (type, data) => {
      emitted.push({ type, data });
    },
    fire: (data) => handler?.({ type: 'inbox:new', data }),
    emitted,
  };
}
function fakeLog(): { warns: unknown[]; warn: (o: unknown, m: string) => void } {
  const warns: unknown[] = [];
  return { warns, warn: (o) => warns.push(o) };
}

describe('registerWakeEmitter (Verdrahtung, kein Transport)', () => {
  it('inbox:new adressiert an live Instanz → agent:wake (inhaltsfrei)', () => {
    const bus = fakeBus();
    registerWakeEmitter({ eventBus: bus, listInstances: () => LIVE, coalescer: new WakeCoalescer(), now: () => 0 });
    bus.fire({ from: 'peer', message_id: 'm1', to_agent_instance: 'inst-a' });
    expect(bus.emitted).toEqual([{ type: 'agent:wake', data: { instance_id: 'inst-a', reason: 'inbox' } }]);
  });

  it('Loopback-Send mit explizit null to_agent_instance → KEIN agent:wake + WARN-Log', () => {
    const bus = fakeBus();
    const log = fakeLog();
    registerWakeEmitter({ eventBus: bus, listInstances: () => LIVE, coalescer: new WakeCoalescer(), now: () => 0, log });
    bus.fire({ from: 'peer', message_id: 'm2', to_agent_instance: null }); // Feld präsent (null)
    expect(bus.emitted).toHaveLength(0);
    expect(log.warns).toHaveLength(1);
  });

  it('CR-LOW: Remote/Broadcast OHNE to_agent_instance-Feld → KEIN Wake, KEIN WARN (keine Alert-Fatigue)', () => {
    const bus = fakeBus();
    const log = fakeLog();
    registerWakeEmitter({ eventBus: bus, listInstances: () => LIVE, coalescer: new WakeCoalescer(), now: () => 0, log });
    bus.fire({ from: 'peer', message_id: 'm-remote', to: 'spiffe://thinklocal/host/x/agent/y' }); // Feld fehlt
    expect(bus.emitted).toHaveLength(0);
    expect(log.warns).toHaveLength(0);
  });

  it('adressiert aber nicht live → KEIN Wake, KEIN WARN (nicht unadressiert)', () => {
    const bus = fakeBus();
    const log = fakeLog();
    registerWakeEmitter({ eventBus: bus, listInstances: () => LIVE, coalescer: new WakeCoalescer(), now: () => 0, log });
    bus.fire({ from: 'peer', message_id: 'm3', to_agent_instance: 'inst-gone' });
    expect(bus.emitted).toHaveLength(0);
    expect(log.warns).toHaveLength(0);
  });

  it('zwei rasche inbox:new an dieselbe Instanz → nur 1 agent:wake (coalesced)', () => {
    const bus = fakeBus();
    let t = 0;
    registerWakeEmitter({ eventBus: bus, listInstances: () => LIVE, coalescer: new WakeCoalescer(1000), now: () => t });
    bus.fire({ to_agent_instance: 'inst-a' });
    t = 200;
    bus.fire({ to_agent_instance: 'inst-a' });
    expect(bus.emitted).toHaveLength(1);
  });
});
