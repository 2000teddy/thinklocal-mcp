#!/usr/bin/env node
/**
 * measure-daemon-rss-cpu.mjs — T1.1 (V5 Spur 1): Sampler + Vergleichs-CLI für den
 * RSS/CPU-Vorher(tsx)/Nachher(node dist)-Nachweis. Nutzt den reinen, getesteten
 * Helfer `packages/daemon/dist/rss-cpu-stats.js` (vorher `npm run daemon:build`).
 *
 * Modi:
 *   Sampeln:   node scripts/measure-daemon-rss-cpu.mjs --pid <pid> [--samples 60] [--interval-ms 1000]
 *              → JSON-Summary (SampleSummary) auf stdout.
 *   Vergleich: node scripts/measure-daemon-rss-cpu.mjs --compare before.json after.json
 *              → Markdown-Vergleichstabelle auf stdout.
 *
 * KEIN Deploy, keine Zahlen-Erfindung — misst nur den angegebenen Prozess.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { summarizeSamples, parsePsSample, formatComparison, assertFiniteSummary } from '../packages/daemon/dist/rss-cpu-stats.js';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

/** Positive-Integer-Arg oder klarer Usage-Fehler (statt still als „0 samples" zu enden). */
function intArg(name, fallback) {
  const raw = arg(name, String(fallback));
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    process.stderr.write(`[measure] ${name} muss eine positive Ganzzahl sein, got: ${raw}\n`);
    process.exit(2);
  }
  return n;
}

async function sampleMode(pid, samples, intervalMs) {
  const collected = [];
  for (let i = 0; i < samples; i++) {
    let out;
    try {
      // LC_ALL=C erzwingt Punkt-Dezimale (parsePsSample matcht keine Komma-Locale).
      out = execFileSync('ps', ['-o', 'rss=,%cpu=', '-p', String(pid)], {
        encoding: 'utf-8',
        env: { ...process.env, LC_ALL: 'C' },
      });
    } catch {
      process.stderr.write(`[measure] ps failed for pid ${pid} (process gone?) — stopping after ${collected.length} samples\n`);
      break;
    }
    const s = parsePsSample(out);
    if (s) collected.push(s);
    if (i < samples - 1) await sleep(intervalMs);
  }
  if (collected.length === 0) {
    process.stderr.write('[measure] no samples collected\n');
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify(summarizeSamples(collected), null, 2)}\n`);
}

function compareMode(beforePath, afterPath) {
  const before = JSON.parse(readFileSync(beforePath, 'utf-8'));
  const after = JSON.parse(readFileSync(afterPath, 'utf-8'));
  // CR-M1: kaputte/hand-editierte Summary → lauter Fehler statt NaN in der Tabelle.
  assertFiniteSummary(before, `before (${beforePath})`);
  assertFiniteSummary(after, `after (${afterPath})`);
  process.stdout.write(`${formatComparison(before, after)}\n`);
}

const compare = process.argv.indexOf('--compare');
if (compare >= 0) {
  const before = process.argv[compare + 1];
  const after = process.argv[compare + 2];
  if (!before || !after) {
    process.stderr.write('usage: --compare <before.json> <after.json>\n');
    process.exit(2);
  }
  compareMode(before, after);
} else {
  const pid = arg('--pid');
  if (!pid) {
    process.stderr.write('usage: --pid <pid> [--samples 60] [--interval-ms 1000]\n');
    process.exit(2);
  }
  const pidNum = Number(pid);
  if (!Number.isInteger(pidNum) || pidNum <= 0) {
    process.stderr.write(`[measure] --pid muss eine positive Ganzzahl sein, got: ${pid}\n`);
    process.exit(2);
  }
  await sampleMode(pidNum, intArg('--samples', 60), intArg('--interval-ms', 1000));
}
