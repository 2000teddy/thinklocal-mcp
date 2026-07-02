/**
 * Unit-Tests für die T1.1-RSS/CPU-Auswertung (`rss-cpu-stats.ts`).
 */
import { describe, it, expect } from 'vitest';
import {
  percentile,
  computeStats,
  summarizeSamples,
  parsePsSample,
  formatComparison,
  parsePidPpid,
  collectProcessTree,
  aggregateTreeSample,
  type ProcSample,
} from './rss-cpu-stats.js';

describe('percentile (nearest-rank)', () => {
  it('p50/p95/Grenzen auf 1..10', () => {
    const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(v, 0)).toBe(1);
    expect(percentile(v, 0.5)).toBe(5); // ceil(0.5*10)=5 → idx4 → 5
    expect(percentile(v, 0.95)).toBe(10); // ceil(0.95*10)=10 → idx9 → 10
    expect(percentile(v, 1)).toBe(10);
  });
  it('mutiert die Eingabe nicht', () => {
    const v = [3, 1, 2];
    percentile(v, 0.5);
    expect(v).toEqual([3, 1, 2]);
  });
  it('wirft bei leer / ungültigem q', () => {
    expect(() => percentile([], 0.5)).toThrow(/empty/);
    expect(() => percentile([1], 1.5)).toThrow(/q must be/);
  });
});

describe('computeStats', () => {
  it('mean/p50/p95/min/max/count', () => {
    const s = computeStats([2, 4, 6, 8]);
    expect(s).toEqual({ count: 4, mean: 5, p50: 4, p95: 8, min: 2, max: 8 });
  });
  it('wirft bei leer / non-finite', () => {
    expect(() => computeStats([])).toThrow(/empty/);
    expect(() => computeStats([1, NaN])).toThrow(/non-finite/);
  });
});

describe('parsePsSample', () => {
  it('parst "  123456  0.7" → RSS in Bytes (KiB*1024), CPU%', () => {
    expect(parsePsSample('  123456  0.7')).toEqual({ rssBytes: 123456 * 1024, cpuPercent: 0.7 });
  });
  it('null bei unparsebarer Zeile', () => {
    expect(parsePsSample('garbage')).toBeNull();
    expect(parsePsSample('')).toBeNull();
    expect(parsePsSample('123 abc')).toBeNull();
  });
});

describe('parsePidPpid', () => {
  it('parst "  1234  1000" → {pid,ppid}', () => {
    expect(parsePidPpid('  1234  1000')).toEqual({ pid: 1234, ppid: 1000 });
  });
  it('null bei unparsebar', () => {
    expect(parsePidPpid('x y')).toBeNull();
    expect(parsePidPpid('1234')).toBeNull();
  });
});

describe('collectProcessTree', () => {
  // 100 -> 200 (esbuild-Kind) ; 300 unabhängig
  const pairs = [
    { pid: 100, ppid: 1 },
    { pid: 200, ppid: 100 },
    { pid: 250, ppid: 200 }, // Enkel
    { pid: 300, ppid: 1 },
  ];
  it('root + transitive Nachfahren (tsx-Baum), Fremdprozess NICHT enthalten', () => {
    expect(collectProcessTree(100, pairs).sort((a, b) => a - b)).toEqual([100, 200, 250]);
    expect(collectProcessTree(100, pairs)).not.toContain(300);
  });
  it('Einzelprozess (node dist) → nur root', () => {
    expect(collectProcessTree(300, pairs)).toEqual([300]);
  });
  it('zyklen-sicher (pid==ppid o.ä.) → kein Endlos-Loop', () => {
    const cyclic = [{ pid: 5, ppid: 5 }, { pid: 6, ppid: 5 }, { pid: 5, ppid: 6 }];
    const tree = collectProcessTree(5, cyclic).sort((a, b) => a - b);
    expect(tree).toEqual([5, 6]);
  });
});

describe('aggregateTreeSample', () => {
  it('summiert RSS + CPU über den Baum', () => {
    expect(aggregateTreeSample([
      { rssBytes: 100, cpuPercent: 1.5 },
      { rssBytes: 250, cpuPercent: 0.5 },
    ])).toEqual({ rssBytes: 350, cpuPercent: 2 });
  });
  it('wirft bei leerem Prozess-Set', () => {
    expect(() => aggregateTreeSample([])).toThrow(/empty/);
  });
});

describe('summarizeSamples', () => {
  it('verdichtet RSS + CPU getrennt', () => {
    const samples: ProcSample[] = [
      { rssBytes: 100, cpuPercent: 1 },
      { rssBytes: 200, cpuPercent: 3 },
    ];
    const sum = summarizeSamples(samples);
    expect(sum.rss.mean).toBe(150);
    expect(sum.cpu.max).toBe(3);
    expect(sum.rss.count).toBe(2);
  });
  it('wirft ohne Samples', () => {
    expect(() => summarizeSamples([])).toThrow(/no samples/);
  });
});

describe('formatComparison', () => {
  it('Markdown-Tabelle mit Δ (Reduktion zeigt negatives Delta)', () => {
    const before = summarizeSamples([{ rssBytes: 200 * 1024 * 1024, cpuPercent: 2 }]);
    const after = summarizeSamples([{ rssBytes: 150 * 1024 * 1024, cpuPercent: 1 }]);
    const md = formatComparison(before, after);
    expect(md).toContain('| Metrik | tsx (vorher) | node dist (nachher) | Δ |');
    expect(md).toContain('RSS mean (MiB) | 200.0 | 150.0 | -25.0%');
    expect(md).toContain('CPU mean (%) | 2.00 | 1.00 | -50.0%');
    expect(md).toContain('n(vorher)=1, n(nachher)=1');
  });
  it('before=0 → Δ n/a (kein Div-durch-0)', () => {
    const before = summarizeSamples([{ rssBytes: 1024 * 1024, cpuPercent: 0 }]);
    const after = summarizeSamples([{ rssBytes: 1024 * 1024, cpuPercent: 0 }]);
    expect(formatComparison(before, after)).toContain('CPU mean (%) | 0.00 | 0.00 | n/a');
  });

  it('CR-M1: nicht-finite/kaputte Summary (z.B. hand-editierte JSON) → wirft, kein NaN in der Tabelle', () => {
    const ok = summarizeSamples([{ rssBytes: 1024, cpuPercent: 1 }]);
    // rss fehlt komplett:
    expect(() => formatComparison({ cpu: ok.cpu } as never, ok)).toThrow(/non-finite "before"/);
    // NaN in einem Feld:
    const broken = { rss: { ...ok.rss, mean: NaN }, cpu: ok.cpu };
    expect(() => formatComparison(ok, broken as never)).toThrow(/non-finite "after"/);
  });
});
