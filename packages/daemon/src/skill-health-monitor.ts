// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * skill-health-monitor.ts — ADR-021: generisches Skill-Health-&-Lifecycle-Monitoring.
 *
 * Zentrale Komponente, der jeder Skill nur seinen `healthcheck.fn()` + Thresholds
 * mitgibt. Scheduling, State-Machine, Hysterese, Timeout und Audit/Registry-Update
 * (via `onTransition`) orchestriert der Monitor.
 *
 * Design (ADR-021):
 *  - Pro Skill ein Timer-getriebener Loop mit **Jitter ±20 %** (Thundering-Herd-Schutz).
 *  - Pro Skill genau **ein Inflight-Check** (Single-Flight) — überlappende Checks vermieden.
 *  - **Kooperatives Timeout via AbortController** (kein Promise.race-fd-Leak): bei Timeout
 *    wird das Signal aborted; eine kooperierende fn (z.B. fetch mit signal) bricht ab und
 *    zählt als Fehlschlag. Das Inflight-Flag bleibt gesetzt, bis die fn() tatsächlich
 *    settled — eine fn, die das Signal IGNORIERT, blockiert nur ihren eigenen Skill
 *    (kein State-Flip bis sie settled), staut aber keine Checks/Timer auf.
 *  - **Binäre State-Machine** UNKNOWN → HEALTHY ↔ UNHEALTHY (kein DEGRADED — ADR §3).
 *  - **Hysterese**: `debounceUp` Erfolge in Folge → HEALTHY, `debounceDown` Fehlschläge → UNHEALTHY.
 *  - **Linearer Backoff** (ADR §5): healthy 30s, unhealthy 60s, getrennte Intervalle.
 *  - `stop()` cancelt alle Timer + laufenden AbortController.
 */

import type { Logger } from 'pino';

export type SkillHealthState = 'unknown' | 'healthy' | 'unhealthy';

/** Health-Check-Funktion: liefert true=gesund. Bekommt ein AbortSignal (Timeout). */
export type SkillHealthCheckFn = (signal: AbortSignal) => Promise<boolean>;

export interface SkillHealthOpts {
  intervalHealthyMs: number;
  intervalUnhealthyMs: number;
  timeoutMs: number;
  debounceUp: number;
  debounceDown: number;
}

export const DEFAULT_SKILL_HEALTH_OPTS: SkillHealthOpts = {
  intervalHealthyMs: 30_000,
  intervalUnhealthyMs: 60_000,
  timeoutMs: 5_000,
  debounceUp: 2,
  debounceDown: 3,
};

export interface SkillHealthTransition {
  skillId: string;
  from: SkillHealthState;
  to: SkillHealthState;
  consecutiveFailures: number;
  lastError: string | null;
}

export interface SkillHealthStatus {
  skill_id: string;
  state: SkillHealthState;
  last_check_at: string | null;
  next_check_at: string | null;
  consecutive_failures: number;
  consecutive_successes: number;
  last_error: string | null;
  state_changes: number;
}

export interface SkillHealthMonitorDeps {
  /** Wird bei JEDEM State-Flip gerufen (Registry-Update + Audit übernimmt der Aufrufer). */
  onTransition?: (t: SkillHealthTransition) => void;
  log?: Logger;
  /** Injizierbar für Tests (Default Date.now). */
  now?: () => number;
  /** Injizierbar für deterministischen Jitter in Tests (Default Math.random). */
  random?: () => number;
}

interface SkillEntry {
  skillId: string;
  fn: SkillHealthCheckFn;
  opts: SkillHealthOpts;
  state: SkillHealthState;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastError: string | null;
  lastCheckAt: number | null;
  nextCheckAt: number | null;
  stateChanges: number;
  inflight: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  abort: AbortController | null;
}

export class SkillHealthMonitor {
  private skills = new Map<string, SkillEntry>();
  private started = false;
  private stopped = false;
  private readonly now: () => number;
  private readonly random: () => number;

  constructor(private deps: SkillHealthMonitorDeps = {}) {
    this.now = deps.now ?? ((): number => Date.now());
    this.random = deps.random ?? ((): number => Math.random());
  }

  /** Registriert einen Skill-Health-Check. Idempotent pro skillId (re-register ersetzt). */
  register(skillId: string, fn: SkillHealthCheckFn, opts: Partial<SkillHealthOpts> = {}): void {
    const merged = { ...DEFAULT_SKILL_HEALTH_OPTS, ...opts };
    const existing = this.skills.get(skillId);
    if (existing?.timer) clearTimeout(existing.timer);
    existing?.abort?.abort();
    const entry: SkillEntry = {
      skillId,
      fn,
      opts: merged,
      state: 'unknown',
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      lastError: null,
      lastCheckAt: null,
      nextCheckAt: null,
      stateChanges: 0,
      inflight: false,
      timer: null,
      abort: null,
    };
    this.skills.set(skillId, entry);
    if (this.started && !this.stopped) this.scheduleNext(entry, 0);
  }

  /** Startet die Loops aller registrierten Skills (erster Tick zeitnah). */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.stopped = false;
    for (const entry of this.skills.values()) {
      // Erster Tick mit kleinem (jitter-) Initial-Delay, damit der Boot-Race
      // (Service kommt Sekunden nach dem Daemon hoch) schnell erkannt wird.
      this.scheduleNext(entry, 0);
    }
  }

  /** Cancelt alle Timer + laufenden Checks. Idempotent. */
  stop(): void {
    this.stopped = true;
    this.started = false;
    for (const entry of this.skills.values()) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = null;
      entry.abort?.abort();
    }
  }

  getStatus(): SkillHealthStatus[] {
    return [...this.skills.values()].map((e) => ({
      skill_id: e.skillId,
      state: e.state,
      last_check_at: e.lastCheckAt ? new Date(e.lastCheckAt).toISOString() : null,
      next_check_at: e.nextCheckAt ? new Date(e.nextCheckAt).toISOString() : null,
      consecutive_failures: e.consecutiveFailures,
      consecutive_successes: e.consecutiveSuccesses,
      last_error: e.lastError,
      state_changes: e.stateChanges,
    }));
  }

  /** Aktueller State eines Skills (für Tests / gezielte Abfrage). */
  stateOf(skillId: string): SkillHealthState | undefined {
    return this.skills.get(skillId)?.state;
  }

  /** Intervall für den aktuellen State (linearer Backoff, ADR §5). unknown → healthy-Intervall (schnell konvergieren). */
  private intervalFor(entry: SkillEntry): number {
    return entry.state === 'unhealthy' ? entry.opts.intervalUnhealthyMs : entry.opts.intervalHealthyMs;
  }

  /** Jitter ±20 % auf ein Basis-Intervall. */
  private withJitter(baseMs: number): number {
    const jitter = (this.random() * 2 - 1) * 0.2; // [-0.2, +0.2]
    return Math.max(0, Math.round(baseMs * (1 + jitter)));
  }

  private scheduleNext(entry: SkillEntry, baseMs?: number): void {
    if (this.stopped) return;
    if (entry.timer) clearTimeout(entry.timer);
    const delay = this.withJitter(baseMs ?? this.intervalFor(entry));
    entry.nextCheckAt = this.now() + delay;
    entry.timer = setTimeout(() => {
      void this.runCheck(entry);
    }, delay);
  }

  private async runCheck(entry: SkillEntry): Promise<void> {
    if (this.stopped || entry.inflight) return; // Single-Flight
    entry.inflight = true;
    const ac = new AbortController();
    entry.abort = ac;
    const timer = setTimeout(() => ac.abort(new Error('health check timeout')), entry.opts.timeoutMs);
    let ok = false;
    let err: string | null = null;
    try {
      ok = (await entry.fn(ac.signal)) === true;
    } catch (e) {
      ok = false;
      err = e instanceof Error ? e.message : String(e);
    } finally {
      clearTimeout(timer);
      entry.inflight = false;
      entry.abort = null;
    }
    // CR gpt-5.5 MEDIUM/LOW: nach dem Await NICHT mehr anwenden, wenn (a) der Monitor
    // inzwischen gestoppt wurde (Shutdown-Race: kein onTransition/Registry-Write/republish
    // während/nach dem Shutdown) oder (b) der Skill neu registriert wurde (diese Entry ist
    // veraltet) — sonst würde ein stale Ergebnis die aktuelle Entry beeinflussen.
    if (this.stopped || this.skills.get(entry.skillId) !== entry) return;
    if (!ok && err === null) err = ac.signal.aborted ? 'timeout' : 'health check returned false';
    this.applyResult(entry, ok, ok ? null : err);
    this.scheduleNext(entry);
  }

  private applyResult(entry: SkillEntry, ok: boolean, err: string | null): void {
    entry.lastCheckAt = this.now();
    if (ok) {
      entry.consecutiveSuccesses += 1;
      entry.consecutiveFailures = 0;
      entry.lastError = null;
    } else {
      entry.consecutiveFailures += 1;
      entry.consecutiveSuccesses = 0;
      entry.lastError = err;
    }

    let next: SkillHealthState | null = null;
    if (entry.state !== 'healthy' && entry.consecutiveSuccesses >= entry.opts.debounceUp) {
      next = 'healthy';
    } else if (entry.state !== 'unhealthy' && entry.consecutiveFailures >= entry.opts.debounceDown) {
      next = 'unhealthy';
    }

    if (next !== null && next !== entry.state) {
      const from = entry.state;
      entry.state = next;
      entry.stateChanges += 1;
      this.deps.log?.info(
        { skillId: entry.skillId, from, to: next, consecutiveFailures: entry.consecutiveFailures },
        '[skill-health] State-Transition',
      );
      try {
        this.deps.onTransition?.({
          skillId: entry.skillId,
          from,
          to: next,
          consecutiveFailures: entry.consecutiveFailures,
          lastError: entry.lastError,
        });
      } catch (e) {
        this.deps.log?.error({ skillId: entry.skillId, err: e }, '[skill-health] onTransition-Hook fehlgeschlagen');
      }
    }
  }
}
