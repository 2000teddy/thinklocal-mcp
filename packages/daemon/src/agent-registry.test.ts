/**
 * Unit tests for the ADR-004 Phase 2 AgentRegistry.
 *
 * Covers register/heartbeat/unregister, idempotent re-registration,
 * the stale-sweep logic driven by a deterministic injected clock,
 * listener subscription, and start/stop idempotency.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { AgentRegistry, AgentRegistryFullError, type RegisterInput } from './agent-registry.js';

function fakeNow(initial: number): { get: () => number; advance: (ms: number) => void } {
  let t = initial;
  return {
    get: () => t,
    advance: (ms) => {
      t += ms;
    },
  };
}

const baseInput: RegisterInput = {
  instanceId: 'inst-alpha',
  agentType: 'claude-code',
  spiffeUri: 'spiffe://thinklocal/host/abc/agent/claude-code/instance/inst-alpha',
  pid: 12345,
  cliVersion: '0.31.0',
};

describe('AgentRegistry', () => {
  let clock: ReturnType<typeof fakeNow>;
  let registry: AgentRegistry;

  beforeEach(() => {
    clock = fakeNow(1_000_000);
    registry = new AgentRegistry({
      heartbeatIntervalMs: 5_000,
      staleFactor: 3,
      now: () => clock.get(),
    });
  });

  describe('constructor', () => {
    it('rejects non-positive heartbeat interval', () => {
      expect(() => new AgentRegistry({ heartbeatIntervalMs: 0 })).toThrow(RangeError);
      expect(() => new AgentRegistry({ heartbeatIntervalMs: -1 })).toThrow(RangeError);
    });

    it('rejects staleFactor < 1', () => {
      expect(() => new AgentRegistry({ heartbeatIntervalMs: 5_000, staleFactor: 0.5 })).toThrow(
        RangeError,
      );
    });

    it('accepts the minimal config', () => {
      expect(() => new AgentRegistry({ heartbeatIntervalMs: 5_000 })).not.toThrow();
    });
  });

  describe('register', () => {
    it('stores a new entry and echoes it back', () => {
      const entry = registry.register(baseInput);
      expect(entry.instanceId).toBe('inst-alpha');
      expect(entry.agentType).toBe('claude-code');
      expect(entry.spiffeUri).toContain('/instance/inst-alpha');
      expect(entry.pid).toBe(12345);
      expect(entry.cliVersion).toBe('0.31.0');
      expect(entry.registeredAt).toBe(1_000_000);
      expect(entry.lastHeartbeatAt).toBe(1_000_000);
      expect(registry.size()).toBe(1);
    });

    it('is idempotent on re-registration and refreshes the heartbeat', () => {
      registry.register(baseInput);
      clock.advance(2_000);
      const same = registry.register(baseInput);
      expect(registry.size()).toBe(1);
      expect(same.registeredAt).toBe(1_000_000);
      expect(same.lastHeartbeatAt).toBe(1_002_000);
    });

    it('emits a register event to subscribers', () => {
      const events: string[] = [];
      registry.on((reason, entry) => events.push(`${reason}:${entry.instanceId}`));
      registry.register(baseInput);
      expect(events).toEqual(['register:inst-alpha']);
    });
  });

  describe('heartbeat', () => {
    it('updates lastHeartbeatAt and returns the refreshed entry', () => {
      registry.register(baseInput);
      clock.advance(7_000);
      const entry = registry.heartbeat('inst-alpha');
      expect(entry).toBeDefined();
      expect(entry!.lastHeartbeatAt).toBe(1_007_000);
      expect(entry!.spiffeUri).toContain('/instance/inst-alpha');
    });

    it('returns undefined for an unknown instance', () => {
      expect(registry.heartbeat('ghost')).toBeUndefined();
    });
  });

  describe('maxEntries DoS guard (CR regression)', () => {
    it('throws AgentRegistryFullError when the cap is hit', () => {
      const small = new AgentRegistry({
        heartbeatIntervalMs: 5_000,
        maxEntries: 2,
        now: () => clock.get(),
      });
      small.register({ ...baseInput, instanceId: 'a' });
      small.register({ ...baseInput, instanceId: 'b' });
      expect(() => small.register({ ...baseInput, instanceId: 'c' })).toThrow(
        AgentRegistryFullError,
      );
      expect(small.size()).toBe(2);
    });

    it('allows re-registering an existing instance even when full', () => {
      const small = new AgentRegistry({
        heartbeatIntervalMs: 5_000,
        maxEntries: 1,
        now: () => clock.get(),
      });
      small.register({ ...baseInput, instanceId: 'only' });
      clock.advance(1_000);
      expect(() =>
        small.register({ ...baseInput, instanceId: 'only' }),
      ).not.toThrow();
      expect(small.get('only')!.lastHeartbeatAt).toBe(1_001_000);
    });

    it('rejects invalid maxEntries in the constructor', () => {
      expect(() => new AgentRegistry({ heartbeatIntervalMs: 5_000, maxEntries: 0 })).toThrow(
        RangeError,
      );
    });
  });

  describe('unregister', () => {
    it('removes an existing entry, emits, and returns the removed entry', () => {
      const events: string[] = [];
      registry.on((reason, entry) => events.push(`${reason}:${entry.instanceId}`));
      registry.register(baseInput);
      const removed = registry.unregister('inst-alpha');
      expect(removed).toBeDefined();
      expect(removed!.instanceId).toBe('inst-alpha');
      expect(removed!.spiffeUri).toContain('/instance/inst-alpha');
      expect(registry.size()).toBe(0);
      expect(events).toEqual(['register:inst-alpha', 'unregister:inst-alpha']);
    });

    it('is idempotent for unknown ids (returns undefined)', () => {
      expect(registry.unregister('ghost')).toBeUndefined();
    });
  });

  describe('sweep', () => {
    it('evicts entries older than 3 * heartbeatIntervalMs', () => {
      registry.register({ ...baseInput, instanceId: 'stale-1' });
      registry.register({ ...baseInput, instanceId: 'stale-2' });
      registry.register({ ...baseInput, instanceId: 'fresh' });

      clock.advance(10_000); // 10s elapsed — nothing stale yet (threshold = 15s)
      registry.heartbeat('fresh'); // keep it fresh

      clock.advance(6_000); // now stale-1 and stale-2 are 16s old, fresh is 6s old
      const evicted = registry.sweep();
      expect(evicted.map((e) => e.instanceId).sort()).toEqual(['stale-1', 'stale-2']);
      expect(registry.size()).toBe(1);
      expect(registry.get('fresh')).toBeDefined();
    });

    it('emits stale events for evicted entries', () => {
      const staleEvents: string[] = [];
      registry.on((reason, entry) => {
        if (reason === 'stale') staleEvents.push(entry.instanceId);
      });
      registry.register(baseInput);
      clock.advance(20_000);
      registry.sweep();
      expect(staleEvents).toEqual(['inst-alpha']);
    });

    it('leaves the registry untouched when nothing is stale', () => {
      registry.register(baseInput);
      clock.advance(5_000);
      expect(registry.sweep()).toEqual([]);
      expect(registry.size()).toBe(1);
    });
  });

  describe('start / stop', () => {
    it('schedules sweeps via the injected setInterval', () => {
      const calls: Array<{ fn: () => void; ms: number }> = [];
      const fakeTimer = { unref: () => undefined } as unknown as ReturnType<typeof setInterval>;
      const reg = new AgentRegistry({
        heartbeatIntervalMs: 5_000,
        now: () => clock.get(),
        setIntervalFn: ((fn: () => void, ms: number) => {
          calls.push({ fn, ms });
          return fakeTimer;
        }) as unknown as typeof setInterval,
        clearIntervalFn: (() => undefined) as unknown as typeof clearInterval,
      });
      reg.start();
      expect(calls).toHaveLength(1);
      expect(calls[0]!.ms).toBe(5_000);

      // Second start is a no-op.
      reg.start();
      expect(calls).toHaveLength(1);

      // Sweep callback actually runs the eviction logic.
      reg.register(baseInput);
      clock.advance(20_000);
      calls[0]!.fn();
      expect(reg.size()).toBe(0);
    });

    it('stop is idempotent and clears the timer', () => {
      let cleared = 0;
      const reg = new AgentRegistry({
        heartbeatIntervalMs: 5_000,
        setIntervalFn: ((_fn: () => void, _ms: number) =>
          ({ unref: () => undefined }) as unknown as ReturnType<typeof setInterval>) as unknown as typeof setInterval,
        clearIntervalFn: (() => {
          cleared++;
        }) as unknown as typeof clearInterval,
      });
      reg.start();
      reg.stop();
      reg.stop();
      expect(cleared).toBe(1);
    });
  });

  describe('getHeartbeatIntervalMs', () => {
    it('echoes the configured value', () => {
      expect(registry.getHeartbeatIntervalMs()).toBe(5_000);
    });
  });
});
