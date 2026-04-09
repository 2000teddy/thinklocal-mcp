/**
 * ADR-004 Phase 1 — Cron-Heartbeat Adaptive Interval Logic
 *
 * Pure-function module providing the polling-interval state machine used
 * by the inbox-heartbeat cron job. Implements:
 *
 *   - exponential backoff (initialMs * 2^emptyPollCount, capped at maxMs)
 *   - reset to initialMs on any non-empty poll
 *   - ±20% polling jitter (GPT-5.4 anti-thundering-herd recommendation
 *     from the consensus review on 2026-04-08)
 *
 * Mode defaults are taken verbatim from ADR-004 §"Adaptive Intervall-Strategie".
 *
 * No external dependencies, no I/O, no mutable globals — easy to test and
 * easy to embed in any future scheduler implementation.
 *
 * See: docs/architecture/ADR-004-cron-heartbeat.md
 */

export type MeshMode = 'local' | 'lan' | 'federated' | 'adhoc';

export interface HeartbeatState {
  /** Number of consecutive empty polls observed so far. */
  readonly emptyPollCount: number;
  /** Last interval (in ms) returned by `nextInterval`. */
  readonly lastIntervalMs: number;
}

export interface HeartbeatConfig {
  readonly initialMs: number;
  readonly maxMs: number;
}

/** Mesh-mode polling defaults from ADR-004. */
export const MODE_DEFAULTS: Record<MeshMode, HeartbeatConfig> = {
  local: { initialMs: 2_000, maxMs: 10_000 },
  lan: { initialMs: 5_000, maxMs: 30_000 },
  federated: { initialMs: 30_000, maxMs: 300_000 },
  adhoc: { initialMs: 60_000, maxMs: 600_000 },
};

/**
 * Compute the next polling interval and state transition.
 *
 * @param state         current heartbeat state (immutable, never mutated)
 * @param hadMessages   true if the last poll returned at least one unread msg
 * @param mode          active mesh mode (selects the config from MODE_DEFAULTS)
 * @returns the chosen interval (ms) and the next heartbeat state
 *
 * @example
 *   let state: HeartbeatState = { emptyPollCount: 0, lastIntervalMs: 0 };
 *   const { intervalMs, nextState } = nextInterval(state, false, 'lan');
 *   state = nextState; // CRITICAL: caller must persist the next state
 *   await sleep(applyJitter(intervalMs));
 */
export function nextInterval(
  state: HeartbeatState,
  hadMessages: boolean,
  mode: MeshMode,
): { intervalMs: number; nextState: HeartbeatState } {
  const cfg = MODE_DEFAULTS[mode];

  if (hadMessages) {
    return {
      intervalMs: cfg.initialMs,
      nextState: { emptyPollCount: 0, lastIntervalMs: cfg.initialMs },
    };
  }

  // Exponential backoff. Use Math.min against maxMs to cap.
  // 2^emptyPollCount can grow large; min() handles overflow gracefully
  // because Infinity > maxMs is still maxMs.
  const raw = cfg.initialMs * Math.pow(2, state.emptyPollCount);
  const intervalMs = Math.min(raw, cfg.maxMs);

  return {
    intervalMs,
    nextState: {
      emptyPollCount: state.emptyPollCount + 1,
      lastIntervalMs: intervalMs,
    },
  };
}

/**
 * Apply ±20% jitter to a polling interval to avoid thundering-herd
 * patterns when many agents start their heartbeats simultaneously.
 *
 * Formula: `intervalMs * (0.8 + rng() * 0.4)`
 *
 * @param intervalMs   non-negative base interval in ms
 * @param rng          uniform [0, 1) random source (default: Math.random)
 * @returns jittered interval in ms
 * @throws RangeError if `intervalMs` is negative
 */
export function applyJitter(intervalMs: number, rng: () => number = Math.random): number {
  if (intervalMs < 0) {
    throw new RangeError(`applyJitter: intervalMs must be non-negative, got ${intervalMs}`);
  }
  if (intervalMs === 0) return 0;
  return intervalMs * (0.8 + rng() * 0.4);
}
