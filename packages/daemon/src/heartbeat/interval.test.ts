/**
 * Unit tests for ADR-004 Phase 1 cron-heartbeat interval logic.
 *
 * Test sketches generated via clink gemini (planner role) on 2026-04-09,
 * adapted for local file layout.
 *
 * See: docs/architecture/ADR-004-cron-heartbeat.md
 */
import { describe, it, expect } from 'vitest';
import {
  nextInterval,
  applyJitter,
  MODE_DEFAULTS,
  type HeartbeatState,
  type MeshMode,
} from './interval.js';

describe('Heartbeat Interval Logic (ADR-004)', () => {
  describe('MODE_DEFAULTS', () => {
    it('should contain all four modes with correct ADR-004 values', () => {
      expect(MODE_DEFAULTS.local).toEqual({ initialMs: 2000, maxMs: 10000 });
      expect(MODE_DEFAULTS.lan).toEqual({ initialMs: 5000, maxMs: 30000 });
      expect(MODE_DEFAULTS.federated).toEqual({ initialMs: 30000, maxMs: 300000 });
      expect(MODE_DEFAULTS.adhoc).toEqual({ initialMs: 60000, maxMs: 600000 });
    });
  });

  describe('nextInterval', () => {
    const initialState: HeartbeatState = { emptyPollCount: 0, lastIntervalMs: 0 };

    it('should reset to initialMs and zero emptyPollCount when hadMessages is true', () => {
      const modes: MeshMode[] = ['local', 'lan', 'federated', 'adhoc'];
      modes.forEach((mode) => {
        const state: HeartbeatState = { emptyPollCount: 5, lastIntervalMs: 60000 };
        const { intervalMs, nextState } = nextInterval(state, true, mode);

        expect(intervalMs).toBe(MODE_DEFAULTS[mode].initialMs);
        expect(nextState.emptyPollCount).toBe(0);
        expect(nextState.lastIntervalMs).toBe(MODE_DEFAULTS[mode].initialMs);
      });
    });

    it('should implement exponential backoff: 5s -> 10s -> 20s -> 30s (lan cap)', () => {
      let state = initialState;
      const results: number[] = [];

      for (let i = 0; i < 4; i++) {
        const { intervalMs, nextState } = nextInterval(state, false, 'lan');
        results.push(intervalMs);
        state = nextState;
      }

      expect(results).toEqual([5000, 10000, 20000, 30000]);
    });

    it('should cap intervals correctly for every mode', () => {
      const testCap = (mode: MeshMode, expectedCap: number) => {
        const highState: HeartbeatState = { emptyPollCount: 20, lastIntervalMs: 1000000 };
        const { intervalMs } = nextInterval(highState, false, mode);
        expect(intervalMs).toBe(expectedCap);
      };

      testCap('local', 10000);
      testCap('lan', 30000);
      testCap('federated', 300000);
      testCap('adhoc', 600000);
    });

    it('should increment emptyPollCount when hadMessages is false', () => {
      const { nextState } = nextInterval(
        { emptyPollCount: 2, lastIntervalMs: 1000 },
        false,
        'local',
      );
      expect(nextState.emptyPollCount).toBe(3);
    });

    it('should restart backoff from scratch after a reset', () => {
      const state1 = nextInterval(
        { emptyPollCount: 3, lastIntervalMs: 20000 },
        false,
        'lan',
      );
      expect(state1.intervalMs).toBe(30000);

      const { nextState: resetState } = nextInterval(state1.nextState, true, 'lan');

      const { intervalMs } = nextInterval(resetState, false, 'lan');
      expect(intervalMs).toBe(5000);
    });
  });

  describe('applyJitter', () => {
    const interval = 10000;

    it('should return 0.8 * interval when rng returns 0', () => {
      expect(applyJitter(interval, () => 0)).toBe(8000);
    });

    it('should return ~1.2 * interval when rng returns 0.999', () => {
      const result = applyJitter(interval, () => 0.999);
      expect(result).toBeGreaterThan(11990);
      expect(result).toBeLessThan(12000);
    });

    it('should always return a value in [0.8*x, 1.2*x] with default rng', () => {
      for (let i = 0; i < 100; i++) {
        const jittered = applyJitter(interval);
        expect(jittered).toBeGreaterThanOrEqual(8000);
        expect(jittered).toBeLessThanOrEqual(12000);
      }
    });

    it('should return 0 for a degenerate case of 0ms interval', () => {
      expect(applyJitter(0)).toBe(0);
    });

    it('should reject negative intervals (defensive)', () => {
      expect(() => applyJitter(-1)).toThrow();
    });
  });
});
