// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * rss-cpu-stats.ts — T1.1 (V5 Spur 1): reine Auswertung von RSS-/CPU-Messreihen für
 * den Vorher/Nachher-Vergleich der Daemon-Startumstellung `tsx` → `node dist/`.
 *
 * Die eigentliche Umstellung ist bereits gemergt (PR #217). Dieses Modul liefert die
 * **deploy-agnostische Auswertungs-Primitive** für den DoD „RSS/CPU vorher/nachher
 * gemessen": ein Sampler (Runbook, s. docs/operations/T1.1-rss-cpu-measurement.md)
 * erhebt Roh-Samples pro Modus; hier werden sie zu Kennzahlen (mean/p50/p95/min/max)
 * verdichtet und als Vorher/Nachher-Delta-Tabelle formatiert.
 *
 * Rein + seiteneffektfrei (kein Prozess-Zugriff, keine Uhr) → vollständig unit-testbar.
 */

/** Ein Messpunkt eines Daemon-Prozesses. */
export interface ProcSample {
  /** Resident Set Size in Bytes. */
  rssBytes: number;
  /** CPU-Auslastung in Prozent (z.B. `ps %cpu`). */
  cpuPercent: number;
}

/** Verdichtete Kennzahlen einer Messreihe. */
export interface MetricStats {
  count: number;
  mean: number;
  p50: number;
  p95: number;
  min: number;
  max: number;
}

/** Kennzahlen für RSS + CPU einer Messreihe. */
export interface SampleSummary {
  rss: MetricStats;
  cpu: MetricStats;
}

/**
 * Perzentil per **nearest-rank** (kein Interpolieren): das kleinste Element, dessen
 * Rang ≥ ⌈q·n⌉ ist. Deterministisch, robust für kleine Stichproben. `q` in [0,1].
 * `values` wird NICHT mutiert (Kopie wird sortiert).
 */
export function percentile(values: readonly number[], q: number): number {
  if (values.length === 0) throw new Error('percentile: empty sample');
  if (q < 0 || q > 1 || !Number.isFinite(q)) throw new Error(`percentile: q must be in [0,1], got ${q}`);
  const sorted = [...values].sort((a, b) => a - b);
  if (q === 0) return sorted[0] as number;
  const rank = Math.ceil(q * sorted.length);
  const idx = Math.min(rank, sorted.length) - 1;
  return sorted[idx] as number;
}

/** Verdichtet eine Zahlenreihe zu {count, mean, p50, p95, min, max}. Wirft bei leer. */
export function computeStats(values: readonly number[]): MetricStats {
  if (values.length === 0) throw new Error('computeStats: empty sample');
  for (const v of values) {
    if (!Number.isFinite(v)) throw new Error(`computeStats: non-finite value ${v}`);
  }
  const sum = values.reduce((a, b) => a + b, 0);
  return {
    count: values.length,
    mean: sum / values.length,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

/** Verdichtet Roh-Samples (RSS+CPU) zu einer `SampleSummary`. */
export function summarizeSamples(samples: readonly ProcSample[]): SampleSummary {
  if (samples.length === 0) throw new Error('summarizeSamples: no samples');
  return {
    rss: computeStats(samples.map((s) => s.rssBytes)),
    cpu: computeStats(samples.map((s) => s.cpuPercent)),
  };
}

/**
 * Parst eine `ps -o rss=,%cpu=`-Zeile (`ps` liefert RSS in **KiB**) in ein `ProcSample`.
 * Beispiel-Zeile: `  123456  0.7`. **Einzeilig by contract** (ein PID pro Aufruf); eine
 * Komma-Dezimal-Locale (`0,7`) matcht bewusst NICHT → `null` (fail-closed, kein falscher
 * Wert; Runbook empfiehlt `LC_ALL=C`). `null` bei unparsebarer Zeile. Reine Funktion.
 */
export function parsePsSample(line: string): ProcSample | null {
  const m = line.trim().match(/^(\d+)\s+([\d.]+)$/);
  if (!m) return null;
  const rssKib = Number(m[1]);
  const cpuPercent = Number(m[2]);
  if (!Number.isFinite(rssKib) || !Number.isFinite(cpuPercent)) return null;
  return { rssBytes: rssKib * 1024, cpuPercent };
}

/** Ein `pid`→`ppid`-Paar aus `ps -e -o pid=,ppid=`. */
export interface PidPpid {
  pid: number;
  ppid: number;
}

/** Parst eine `ps -e -o pid=,ppid=`-Zeile (`  1234  1000`). `null` bei unparsebar. */
export function parsePidPpid(line: string): PidPpid | null {
  const m = line.trim().match(/^(\d+)\s+(\d+)$/);
  if (!m) return null;
  const pid = Number(m[1]);
  const ppid = Number(m[2]);
  if (!Number.isInteger(pid) || !Number.isInteger(ppid)) return null;
  return { pid, ppid };
}

/**
 * Sammelt den **Prozessbaum**: `rootPid` + alle transitiven Nachfahren (BFS,
 * zyklen-sicher via `seen`). `pairs` = die pid→ppid-Liste ALLER Prozesse (aus
 * `ps -e -o pid=,ppid=`). Nötig für einen fairen Vorher/Nachher-Vergleich: der
 * `tsx`-Start hat ein Transform-Kind (esbuild), `node dist/` ist ein Einzelprozess —
 * nur die Baum-Summe ist vergleichbar. Reine Funktion; `rootPid` ist immer enthalten.
 */
export function collectProcessTree(rootPid: number, pairs: readonly PidPpid[]): number[] {
  const childrenByPpid = new Map<number, number[]>();
  for (const { pid, ppid } of pairs) {
    const arr = childrenByPpid.get(ppid);
    if (arr) arr.push(pid);
    else childrenByPpid.set(ppid, [pid]);
  }
  const out: number[] = [];
  const seen = new Set<number>();
  const queue: number[] = [rootPid];
  while (queue.length > 0) {
    const pid = queue.shift() as number;
    if (seen.has(pid)) continue;
    seen.add(pid);
    out.push(pid);
    for (const child of childrenByPpid.get(pid) ?? []) {
      if (!seen.has(child)) queue.push(child);
    }
  }
  return out;
}

/**
 * Summiert die Per-Prozess-Samples eines Baums zu EINEM Baum-Sample (Σ RSS, Σ CPU)
 * für einen Messzeitpunkt. Wirft bei leerer Eingabe (Aufrufer überspringt den Tick).
 */
export function aggregateTreeSample(perProcess: readonly ProcSample[]): ProcSample {
  if (perProcess.length === 0) throw new Error('aggregateTreeSample: empty process set');
  return {
    rssBytes: perProcess.reduce((sum, s) => sum + s.rssBytes, 0),
    cpuPercent: perProcess.reduce((sum, s) => sum + s.cpuPercent, 0),
  };
}

function isFiniteStats(m: MetricStats | undefined): boolean {
  return (
    m !== undefined &&
    [m.count, m.mean, m.p50, m.p95, m.min, m.max].every((v) => typeof v === 'number' && Number.isFinite(v))
  );
}

/**
 * CR-M1: verweigert das Rendern einer nicht-finiten/kaputten Summary (z.B. aus einer
 * hand-editierten `--compare`-JSON). Statt `NaN`/`NaN%` in die Tabelle zu schreiben
 * (was wie erfundene Zahlen aussähe) → lauter Fehler. „Kein Zahlen-Erfinden."
 */
export function assertFiniteSummary(s: SampleSummary, label: string): void {
  if (!s || !isFiniteStats(s.rss) || !isFiniteStats(s.cpu)) {
    throw new Error(`rss-cpu-stats: invalid/non-finite "${label}" summary — refuse to render (no fabricated numbers)`);
  }
}

function mib(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

/** Relatives Delta after↔before in Prozent (+ = Zunahme). `0` before → `n/a`. */
function deltaPct(before: number, after: number): string {
  if (before === 0) return 'n/a';
  const d = ((after - before) / before) * 100;
  return `${d >= 0 ? '+' : ''}${d.toFixed(1)}%`;
}

/**
 * Formatiert den Vorher(tsx)/Nachher(node dist)-Vergleich als Markdown-Tabelle
 * (RSS in MiB, CPU in %). Rein — für Runbook/PR-Body/CHANGES. `before` = tsx-Lauf,
 * `after` = node-dist-Lauf.
 */
export function formatComparison(before: SampleSummary, after: SampleSummary): string {
  assertFiniteSummary(before, 'before');
  assertFiniteSummary(after, 'after');
  const rows: Array<[string, string, string, string]> = [
    ['RSS mean (MiB)', mib(before.rss.mean), mib(after.rss.mean), deltaPct(before.rss.mean, after.rss.mean)],
    ['RSS p95 (MiB)', mib(before.rss.p95), mib(after.rss.p95), deltaPct(before.rss.p95, after.rss.p95)],
    ['RSS max (MiB)', mib(before.rss.max), mib(after.rss.max), deltaPct(before.rss.max, after.rss.max)],
    ['CPU mean (%)', before.cpu.mean.toFixed(2), after.cpu.mean.toFixed(2), deltaPct(before.cpu.mean, after.cpu.mean)],
    ['CPU p95 (%)', before.cpu.p95.toFixed(2), after.cpu.p95.toFixed(2), deltaPct(before.cpu.p95, after.cpu.p95)],
  ];
  const header = `| Metrik | tsx (vorher) | node dist (nachher) | Δ |\n|---|---|---|---|`;
  const body = rows.map((r) => `| ${r[0]} | ${r[1]} | ${r[2]} | ${r[3]} |`).join('\n');
  const note = `\n\n_n(vorher)=${before.rss.count}, n(nachher)=${after.rss.count} Samples._`;
  return `${header}\n${body}${note}`;
}
