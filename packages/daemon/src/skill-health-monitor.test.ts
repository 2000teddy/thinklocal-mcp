import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SkillHealthMonitor, type SkillHealthTransition } from './skill-health-monitor.js';

// random()=>0.5 → Jitter (0.5*2-1)*0.2 = 0 → deterministische Intervalle.
const NO_JITTER = (): number => 0.5;
const FAST = { intervalHealthyMs: 30_000, intervalUnhealthyMs: 60_000, timeoutMs: 5_000, debounceUp: 2, debounceDown: 3 };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** fn, die eine vorgegebene Ergebnis-Sequenz abspielt (danach letzter Wert). */
function seqFn(results: boolean[]): () => Promise<boolean> {
  let i = 0;
  return async () => {
    const v = i < results.length ? results[i] : results[results.length - 1];
    i++;
    return v as boolean;
  };
}

describe('SkillHealthMonitor — Hysterese', () => {
  it('2-up: [false,true,true] → HEALTHY erst nach dem zweiten true', async () => {
    const transitions: SkillHealthTransition[] = [];
    const m = new SkillHealthMonitor({ random: NO_JITTER, onTransition: (t) => transitions.push(t) });
    m.register('s', seqFn([false, true, true]), FAST);
    m.start();
    await vi.advanceTimersByTimeAsync(1);        // tick1: false
    expect(m.stateOf('s')).toBe('unknown');
    await vi.advanceTimersByTimeAsync(30_000);   // tick2: true (1 success)
    expect(m.stateOf('s')).toBe('unknown');
    await vi.advanceTimersByTimeAsync(30_000);   // tick3: true (2 successes) → HEALTHY
    expect(m.stateOf('s')).toBe('healthy');
    expect(transitions).toEqual([
      expect.objectContaining({ skillId: 's', from: 'unknown', to: 'healthy' }),
    ]);
    m.stop();
  });

  it('3-down: aus HEALTHY → UNHEALTHY erst nach dem dritten false', async () => {
    const transitions: SkillHealthTransition[] = [];
    const m = new SkillHealthMonitor({ random: NO_JITTER, onTransition: (t) => transitions.push(t) });
    // [true,true] → healthy, dann [false,false,false] → unhealthy
    m.register('s', seqFn([true, true, false, false, false]), FAST);
    m.start();
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(m.stateOf('s')).toBe('healthy');
    await vi.advanceTimersByTimeAsync(30_000); // false #1
    expect(m.stateOf('s')).toBe('healthy');
    await vi.advanceTimersByTimeAsync(30_000); // false #2
    expect(m.stateOf('s')).toBe('healthy');
    await vi.advanceTimersByTimeAsync(60_000); // false #3 → UNHEALTHY (interval bleibt healthy bis Flip)
    expect(m.stateOf('s')).toBe('unhealthy');
    expect(transitions.map((t) => t.to)).toEqual(['healthy', 'unhealthy']);
    m.stop();
  });
});

describe('SkillHealthMonitor — Timeout & Single-Flight', () => {
  it('Timeout: eine fn, die nur auf Abort reagiert, zählt als Fehlschlag', async () => {
    const m = new SkillHealthMonitor({ random: NO_JITTER });
    // fn rejected erst, wenn das AbortSignal feuert (Timeout)
    m.register('s', (signal) => new Promise((_res, rej) => {
      signal.addEventListener('abort', () => rej(new Error('aborted')));
    }), { ...FAST, debounceDown: 1 }); // 1 Fehlschlag genügt für den Test
    m.start();
    await vi.advanceTimersByTimeAsync(1);       // Check startet
    expect(m.stateOf('s')).toBe('unknown');
    await vi.advanceTimersByTimeAsync(5_000);   // Timeout feuert → Fehlschlag
    expect(m.stateOf('s')).toBe('unhealthy');
    expect(m.getStatus()[0]?.last_error).toMatch(/abort|timeout/i);
    m.stop();
  });

  it('Single-Flight: ein langsamer Check startet keinen zweiten fn-Aufruf', async () => {
    let calls = 0;
    let active = 0;
    let maxActive = 0;
    const m = new SkillHealthMonitor({ random: NO_JITTER });
    m.register('s', () => {
      calls++;
      active++;
      maxActive = Math.max(maxActive, active);
      return new Promise<boolean>((res) => setTimeout(() => { active--; res(true); }, 40_000));
    }, FAST);
    m.start();
    await vi.advanceTimersByTimeAsync(35_000); // mitten im 40s-Check
    expect(calls).toBe(1);
    expect(maxActive).toBe(1);
    await vi.advanceTimersByTimeAsync(10_000); // Check fertig (40s)
    expect(maxActive).toBe(1);
    m.stop();
  });
});

describe('SkillHealthMonitor — Intervall-Switch & Jitter', () => {
  it('schaltet von 30s (healthy/unknown) auf 60s (unhealthy)', async () => {
    const m = new SkillHealthMonitor({ random: NO_JITTER });
    m.register('s', seqFn([false, false, false]), FAST); // debounceDown=3
    m.start();
    const delta = (): number => {
      const st = m.getStatus()[0]!;
      return new Date(st.next_check_at!).getTime() - new Date(st.last_check_at!).getTime();
    };
    await vi.advanceTimersByTimeAsync(1);   // false #1, state unknown → healthy-Intervall
    expect(delta()).toBe(30_000);
    await vi.advanceTimersByTimeAsync(30_000); // false #2, noch unknown
    expect(delta()).toBe(30_000);
    await vi.advanceTimersByTimeAsync(30_000); // false #3 → UNHEALTHY → 60s-Intervall
    expect(m.stateOf('s')).toBe('unhealthy');
    expect(delta()).toBe(60_000);
    m.stop();
  });

  it('Jitter ±20%: random→0 ⇒ 0.8×Intervall, random→~1 ⇒ ~1.2×Intervall', async () => {
    // random=0 → Jitter -0.2 → 0.8×base für den ERSTEN echten Folge-Tick
    let r = 0.5;
    const m = new SkillHealthMonitor({ now: () => 1_000_000, random: () => r });
    m.register('s', seqFn([true]), FAST);
    m.start();
    r = 0; // ab jetzt minimaler Jitter
    await vi.advanceTimersByTimeAsync(1); // tick1 → scheduleNext mit random=0 → 0.8*30000=24000
    const next = m.getStatus()[0]!.next_check_at!;
    const delta = new Date(next).getTime() - 1_000_000;
    expect(delta).toBe(24_000);
    m.stop();
  });
});

describe('SkillHealthMonitor — stop()', () => {
  it('stop() während eines laufenden Checks → kein onTransition mehr (Shutdown-Race)', async () => {
    const transitions: SkillHealthTransition[] = [];
    const m = new SkillHealthMonitor({ random: NO_JITTER, onTransition: (t) => transitions.push(t) });
    // fn hängt bis zum Abort, rejected dann (kooperativ). debounceDown=1 → normal sofort unhealthy.
    m.register('s', (signal) => new Promise<boolean>((_res, rej) => {
      signal.addEventListener('abort', () => rej(new Error('aborted')));
    }), { ...FAST, debounceDown: 1 });
    m.start();
    await vi.advanceTimersByTimeAsync(1); // Check ist inflight
    m.stop();                              // abortet den laufenden Check
    await vi.advanceTimersByTimeAsync(10_000); // Rejection settled
    expect(transitions).toHaveLength(0);   // KEIN State-Flip nach stop()
    expect(m.stateOf('s')).toBe('unknown');
  });

  it('stop() verhindert weitere Checks', async () => {
    let calls = 0;
    const m = new SkillHealthMonitor({ random: NO_JITTER });
    m.register('s', async () => { calls++; return true; }, FAST);
    m.start();
    await vi.advanceTimersByTimeAsync(1);
    const after1 = calls;
    m.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(calls).toBe(after1); // keine weiteren Checks nach stop()
  });
});
