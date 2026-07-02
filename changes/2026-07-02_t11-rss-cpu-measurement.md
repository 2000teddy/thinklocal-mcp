# T1.1 — RSS/CPU-Mess-Slice (tsx→node dist Vorher/Nachher), code-only

**Datum:** 2026-07-02
**Branch:** `claude/t11-rss-cpu-measure` (eigenständig gegen `origin/main`)
**Owner:** Claude (ThinkLocal-Lane)
**Typ:** Tooling/Perf-Nachweis (V5 Spur 1) — **code-only, kein Deploy**
**Bezug:** V5 T1.1 (`tsx` → `node dist/`) — DoD-Teil „RSS/CPU vorher/nachher gemessen"

## Kontext

Die **Startumstellung `tsx` → `node dist/` ist bereits gemergt** (PR #217: `start`/`daemon:start`
→ `node dist/index.js`, `start:tsx`-Dev-Fallback, systemd `ExecStart` → `node`, `start-path.test.ts`).
Offen war nur der **Zahlen-Nachweis** (RSS/CPU vorher/nachher). Der braucht einen Live-Lauf; dieser
Slice liefert die **deploy-agnostische Auswertungs-Primitive + Runbook**, damit die Zahlen
reproduzierbar erhoben und ehrlich (nur gemessen) berichtet werden.

## Lösung

- **`rss-cpu-stats.ts` (neu, rein):** `percentile` (nearest-rank), `computeStats`
  (mean/p50/p95/min/max, wirft bei leer/non-finite), `summarizeSamples`, `parsePsSample`
  (`ps -o rss=,%cpu=`, KiB→Bytes; einzeilig by contract; Komma-Locale → null fail-closed),
  `formatComparison` (Vorher/Nachher-Markdown-Tabelle, RSS in MiB, Δ%, before=0 → n/a),
  `assertFiniteSummary` (**CR-M1:** verweigert nicht-finite/kaputte Summary → kein `NaN` in der
  Tabelle = keine erfundenen Zahlen).
- **Prozessbaum-Messung (Review-Blocker #235, funktional):** `parsePidPpid` + `collectProcessTree`
  (root + alle transitiven Nachfahren, BFS zyklen-sicher) + `aggregateTreeSample` (Σ RSS/CPU pro Tick).
  Nötig, weil der `tsx`-Start ein **Baum** ist (node + esbuild-Transform-Kind) und `node dist/` ein
  Einzelprozess — Single-PID hätte die tsx-Seite untertrieben (irreführender Vergleich, genau der
  T1.1/#217-Grund). Der Sampler misst jetzt pro Tick `ps -e -o pid=,ppid=` → Baum → `ps -o rss=,%cpu=
  -p <alle>` → Summe.
- **`scripts/measure-daemon-rss-cpu.mjs` (neu):** **Prozessbaum**-Sampler (`--pid --samples
  --interval-ms`, `ps` mit `LC_ALL=C`, Prozess-weg → sauberer Stop) + `--compare before.json after.json`
  (Guard vor Render). Positive-Integer-Arg-Validierung (kein stiller „0 samples").
- **`docs/operations/T1.1-rss-cpu-measurement.md` (neu):** Runbook — Build-Prereq, zwei Läufe
  (before=`start:tsx`, after=`daemon:start`), **echte root-Daemon-PID via `pgrep`** (nicht `$!`),
  **Prozessbaum-Messung** (Σ node+esbuild vs node dist), Warmup, n≥60, `LC_ALL=C`, Vergleichstabelle,
  Akzeptanz. Explizit: **kein Zahlen-Erfinden**.

## Tests

- **`rss-cpu-stats.test.ts`** (19): +Prozessbaum (`parsePidPpid`, `collectProcessTree` inkl.
  Fremdprozess-Ausschluss + Zyklus-Schutz + Einzelprozess, `aggregateTreeSample` Σ/leer). percentile
  (Grenzen/keine Mutation/Fehler), computeStats
  (leer/non-finite), parsePsSample (happy/null), summarizeSamples, formatComparison (Δ-Vorzeichen,
  n/a, **CR-M1** non-finite→wirft). Volle Suite **1349 grün**, tsc 0, authored-eslint 0, build 0.
- **Live-Smoke:** Sampler misst einen echten PID; `--compare` erzeugt die Tabelle; kaputte JSON →
  klarer Fehler (kein NaN); bad args → Usage-Exit.

## Review

Unabhängiger **Claude**-Subagent (adversarial; nur claude/codex/agy — `agy` fehlt im Env):
**APPROVE-WITH-NITS**, 0× CRITICAL/HIGH. Stats-Logik korrekt (percentile nearest-rank ohne
Off-by-one/Mutation), ehrlich zum Scope (reale Zahlen deploy-zeitig). Umgesetzt:
- **CR-M1 (MEDIUM):** `NaN`-Leck in `--compare` (hand-editierte JSON) → `assertFiniteSummary`-Guard +
  Regressionstest + CLI-Guard.
- **CR-L2** Arg-Validierung (positive Ganzzahl), **CR-L3** parsePsSample-Einzeilig-Kommentar,
  **CR-L4** `LC_ALL=C` in `ps` + Runbook, **CR-L5** Runbook nutzt `pgrep` statt `$!`.

## Folge / offen

- **Live-Erhebung der realen Zahlen** (before/after, idle+Last) = Deploy-Schritt (nicht in diesem PR).
  Ergebnis-Tabelle danach in den T1.1-Abschluss übernehmen.
- **Kein Deploy in diesem Slice.**
