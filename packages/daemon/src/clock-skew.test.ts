// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * TL-15 — Tests fuer die Uhr-Abweichungs-Erkennung.
 *
 *  - parsePeerTimestamp: nur ISO-Strings; eine blanke Zahl wird ABSICHTLICH abgelehnt.
 *  - estimateClockSkew: Offset gegen die Fenstermitte, nicht gegen den Empfangszeitpunkt.
 *  - classifyClockSkew: konservativ in BEIDE Richtungen — Netzlaufzeit allein darf
 *    weder alarmieren noch eine Erholung vortaeuschen.
 *  - ClockSkewMonitor: Hysterese, Neutralitaet von `unknown`, ein Alarm je Flip.
 *  - observeHeartbeatSkew: fail-open ueber alle Body-Fehlerformen.
 *  - config: TL-15-Keys, Env-Override, Range-Validierung (Env- UND TOML-Pfad).
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parsePeerTimestamp,
  estimateClockSkew,
  classifyClockSkew,
  ClockSkewMonitor,
  observeHeartbeatSkew,
  type ClockSkewEstimate,
} from './clock-skew.js';
import { loadConfig } from './config.js';

const NO_TOML = '/nonexistent/thinklocal-tl15-test.toml';

describe('parsePeerTimestamp', () => {
  it('ISO-String → Millisekunden', () => {
    expect(parsePeerTimestamp('2026-11-09T10:00:00.000Z')).toBe(Date.parse('2026-11-09T10:00:00.000Z'));
  });

  it('blanke Zahl wird ABGELEHNT (Sekunden/Millisekunden nicht unterscheidbar)', () => {
    // Waere das erlaubt, wuerde eine Sekunden-Epoche um Faktor 1000 fehlinterpretiert
    // und erzeugte einen garantierten Fehlalarm. Lieber `unknown` = neutral.
    expect(parsePeerTimestamp(1762682400)).toBeNull();
    expect(parsePeerTimestamp(1762682400000)).toBeNull();
  });

  it('Date.parse-Fallen werden abgewiesen: Zahlen-Strings und Muell mit Ziffern', () => {
    // Nachgemessen (CR-Runde 1, LOW-1): V8s Legacy-Fallback liefert fuer all das
    // ENDLICHE Millisekunden — `Date.parse('1')` ⇒ 2000-12-31, `Date.parse('foo 10')`
    // ⇒ 2001-09-30. Ohne Formatpruefung waere das genau der Epochen-Fehlalarm, den
    // die Zahlen-Ablehnung verhindern soll, nur durch die Hintertuer.
    for (const v of ['0', '1', '12', '99', '2026', 'foo 10']) {
      expect(Number.isFinite(Date.parse(v))).toBe(true); // Date.parse akzeptiert es...
      expect(parsePeerTimestamp(v)).toBeNull(); // ...wir nicht.
    }
    // Gegenprobe, damit der Test nicht nur „alles null" behauptet: `v1.2` scheitert
    // schon an `Date.parse` selbst, ist also kein Beleg fuer die Formatpruefung.
    expect(Number.isFinite(Date.parse('v1.2'))).toBe(false);
  });

  it('ISO ohne Zonen-Designator → null (sonst Lokalzeit-Falle)', () => {
    // Laut Spezifikation wird ein Zeitstempel ohne Zone in der LOKALZEIT des
    // Empfaengers gelesen — zwei Rechner in verschiedenen Zonen messen dann einen
    // kuenstlichen Stunden-Skew.
    expect(parsePeerTimestamp('2026-11-09T10:00:00')).toBeNull();
    expect(parsePeerTimestamp('2026-11-09T10:00:00.000')).toBeNull();
    // Mit Zone dagegen gueltig, auch mit Offset statt Z.
    expect(parsePeerTimestamp('2026-11-09T10:00:00+01:00')).toBe(Date.parse('2026-11-09T10:00:00+01:00'));
  });

  it('leer / nur Whitespace / unparsbar / Nicht-String → null', () => {
    expect(parsePeerTimestamp('')).toBeNull();
    expect(parsePeerTimestamp('   ')).toBeNull();
    expect(parsePeerTimestamp('uebermorgen')).toBeNull();
    expect(parsePeerTimestamp(null)).toBeNull();
    expect(parsePeerTimestamp(undefined)).toBeNull();
    expect(parsePeerTimestamp({ timestamp: '2026-11-09T10:00:00Z' })).toBeNull();
  });
});

describe('estimateClockSkew (Offset gegen die Fenstermitte)', () => {
  const iso = (ms: number): string => new Date(ms).toISOString();

  it('synchrone Uhren trotz RTT → skew 0, Unsicherheit = halbe RTT', () => {
    // Fenster 1000..1200 (RTT 200), Peer-Uhr genau in der Mitte.
    const est = estimateClockSkew({ sentAtMs: 1000, receivedAtMs: 1200, peerTimestamp: iso(1100) });
    expect(est).toEqual({ skewMs: 0, rttMs: 200, uncertaintyMs: 100 });
  });

  it('die naive Rechnung waere falsch: Laufzeit ist kein Skew', () => {
    // Der Peer antwortet mit seiner Zeit zur Fenstermitte. `receivedAt - peer` waere 100 ms
    // „Abweichung", obwohl die Uhren gleich laufen.
    const est = estimateClockSkew({ sentAtMs: 1000, receivedAtMs: 1200, peerTimestamp: iso(1100) });
    expect(est?.skewMs).toBe(0);
    expect(1200 - 1100).toBe(100); // genau der Fehler, den die Mittelung vermeidet
  });

  it('Peer laeuft vor → positiver skew; laeuft nach → negativer', () => {
    expect(
      estimateClockSkew({ sentAtMs: 1000, receivedAtMs: 1200, peerTimestamp: iso(1100 + 5000) })?.skewMs,
    ).toBe(5000);
    expect(
      estimateClockSkew({ sentAtMs: 1000, receivedAtMs: 1200, peerTimestamp: iso(1100 - 5000) })?.skewMs,
    ).toBe(-5000);
  });

  it('unlesbare Partner-Uhrzeit → null', () => {
    expect(estimateClockSkew({ sentAtMs: 1000, receivedAtMs: 1200, peerTimestamp: undefined })).toBeNull();
    expect(estimateClockSkew({ sentAtMs: 1000, receivedAtMs: 1200, peerTimestamp: 'nope' })).toBeNull();
  });

  it('negative RTT (lokale Uhr sprang zurueck) → null, nicht geraten', () => {
    expect(estimateClockSkew({ sentAtMs: 1200, receivedAtMs: 1000, peerTimestamp: iso(1100) })).toBeNull();
  });

  it('nicht-endliche lokale Marken → null', () => {
    expect(estimateClockSkew({ sentAtMs: NaN, receivedAtMs: 1200, peerTimestamp: iso(1100) })).toBeNull();
    expect(
      estimateClockSkew({ sentAtMs: 1000, receivedAtMs: Number.POSITIVE_INFINITY, peerTimestamp: iso(1100) }),
    ).toBeNull();
  });
});

describe('classifyClockSkew (konservativ)', () => {
  const est = (skewMs: number, rttMs: number): ClockSkewEstimate => ({
    skewMs,
    rttMs,
    uncertaintyMs: rttMs / 2,
  });

  it('keine Messung → unknown', () => {
    expect(classifyClockSkew(null, 5000)).toBe('unknown');
  });

  it('Schwelle 0 / negativ / NaN → unknown (aus heisst keine Aussage, nicht „ok")', () => {
    expect(classifyClockSkew(est(60_000, 10), 0)).toBe('unknown');
    expect(classifyClockSkew(est(60_000, 10), -1)).toBe('unknown');
    expect(classifyClockSkew(est(60_000, 10), NaN)).toBe('unknown');
  });

  it('Abweichung deutlich ueber Schwelle → skewed (beide Richtungen)', () => {
    expect(classifyClockSkew(est(12_000, 20), 5000)).toBe('skewed');
    expect(classifyClockSkew(est(-12_000, 20), 5000)).toBe('skewed');
  });

  it('genau auf der Schwelle → ok (strikt >)', () => {
    // |5000| - 0 = 5000, nicht > 5000.
    expect(classifyClockSkew(est(5000, 0), 5000)).toBe('ok');
  });

  it('Netzlaufzeit allein alarmiert NIE — hohe RTT macht die Messung unentscheidbar', () => {
    // 6 s Punktschaetzer bei 4 s RTT: Intervall [4000, 8000] umschliesst die Schwelle
    // ⇒ weder `skewed` noch `ok` ist belegt ⇒ `unknown` (neutral fuer die Hysterese).
    expect(classifyClockSkew(est(6000, 4000), 5000)).toBe('unknown');
    // Dieselbe Abweichung bei schnellem Netz ist dagegen echt.
    expect(classifyClockSkew(est(6000, 20), 5000)).toBe('skewed');
  });

  it('`ok` ist genauso schwer zu behaupten wie `skewed` (symmetrisch)', () => {
    // CR-Runde 1, MEDIUM-2: die erste Fassung prüfte nur die untere Schranke und gab
    // alles andere als `ok` aus. Damit galt ein Peer mit 6 s Vorlauf bei einer
    // RTT-Spitze als „ok" — und loeste eine Erholungsmeldung „behoben: laeuft jetzt
    // 6.0 s vor (Schwelle 5.0 s)" aus, die sich selbst widerspricht.
    // Jetzt: `ok` nur, wenn die OBERE Schranke die Schwelle einhaelt.
    expect(classifyClockSkew(est(4000, 4000), 5000)).toBe('unknown'); // [2000, 6000]
    expect(classifyClockSkew(est(4000, 20), 5000)).toBe('ok'); // [3990, 4010]
  });
});

describe('MEDIUM-2-Szenario: konstant schiefer Peer unter RTT-Spitzen', () => {
  it('kippt NICHT auf „behoben", wenn nur die RTT schwankt', () => {
    const m = new ClockSkewMonitor({ thresholdMs: 5000, debounce: 3 });
    const fast = { skewMs: 6000, rttMs: 20, uncertaintyMs: 10 };
    const slow = { skewMs: 6000, rttMs: 3000, uncertaintyMs: 1500 }; // WLAN-/Last-Spitze

    // Drei schnelle Heartbeats → berechtigter Alarm.
    m.observe('p1', fast);
    m.observe('p1', fast);
    expect(m.observe('p1', fast)).toMatchObject({ from: 'ok', to: 'skewed' });

    // Drei langsame Heartbeats bei UNVERAENDERTER Uhr: vorher waeren das dreimal
    // `ok` gewesen und haetten „behoben" gemeldet. Jetzt: unentscheidbar ⇒ neutral.
    expect(m.observe('p1', slow)).toBeNull();
    expect(m.observe('p1', slow)).toBeNull();
    expect(m.observe('p1', slow)).toBeNull();
    expect(m.stateOf('p1')).toBe('skewed');

    // Und auch danach kein Pendeln zurueck.
    expect(m.observe('p1', fast)).toBeNull();
  });

  it('eine unscharfe Messung bricht eine laufende Serie nicht', () => {
    const m = new ClockSkewMonitor({ thresholdMs: 5000, debounce: 3 });
    const fast = { skewMs: 6000, rttMs: 20, uncertaintyMs: 10 };
    const blurry = { skewMs: 6000, rttMs: 4000, uncertaintyMs: 2000 };
    m.observe('p1', fast);
    m.observe('p1', fast);
    expect(m.observe('p1', blurry)).toBeNull(); // neutral, setzt nicht zurueck
    expect(m.observe('p1', fast)).toMatchObject({ to: 'skewed', confirmations: 3 });
  });

  it('eine echte Erholung wird weiterhin gemeldet', () => {
    const m = new ClockSkewMonitor({ thresholdMs: 5000, debounce: 2 });
    const fast = { skewMs: 6000, rttMs: 20, uncertaintyMs: 10 };
    const healed = { skewMs: 80, rttMs: 20, uncertaintyMs: 10 };
    m.observe('p1', fast);
    m.observe('p1', fast);
    expect(m.observe('p1', healed)).toBeNull();
    expect(m.observe('p1', healed)).toMatchObject({ from: 'skewed', to: 'ok', skewMs: 80 });
  });
});

describe('ClockSkewMonitor — Hysterese', () => {
  const SKEW: ClockSkewEstimate = { skewMs: 12_000, rttMs: 20, uncertaintyMs: 10 };
  const FINE: ClockSkewEstimate = { skewMs: 100, rttMs: 20, uncertaintyMs: 10 };
  const mk = (debounce = 3): ClockSkewMonitor =>
    new ClockSkewMonitor({ thresholdMs: 5000, debounce });

  it('unter der Daempfung kein Flip, auf der Daempfung genau einer', () => {
    const m = mk(3);
    expect(m.observe('p1', SKEW)).toBeNull();
    expect(m.observe('p1', SKEW)).toBeNull();
    const t = m.observe('p1', SKEW);
    expect(t).toMatchObject({
      agentId: 'p1',
      from: 'ok',
      to: 'skewed',
      skewMs: 12_000,
      thresholdMs: 5000,
      confirmations: 3,
    });
  });

  it('ein dauerhaft schiefer Peer erzeugt EINE Meldung, nicht eine pro Heartbeat', () => {
    const m = mk(3);
    const transitions = Array.from({ length: 50 }, () => m.observe('p1', SKEW)).filter(Boolean);
    expect(transitions).toHaveLength(1);
  });

  it('unterbrochene Serie setzt den Zaehler zurueck (Wackeln an der Schwelle kippt nichts)', () => {
    const m = mk(3);
    m.observe('p1', SKEW);
    m.observe('p1', SKEW);
    expect(m.observe('p1', FINE)).toBeNull(); // Serie gebrochen, Zustand ist schon 'ok'
    expect(m.observe('p1', SKEW)).toBeNull();
    expect(m.observe('p1', SKEW)).toBeNull();
    expect(m.observe('p1', SKEW)).not.toBeNull(); // erst die dritte in Folge kippt
  });

  it('Erholung meldet den Rueckweg skewed→ok', () => {
    const m = mk(2);
    m.observe('p1', SKEW);
    expect(m.observe('p1', SKEW)).toMatchObject({ from: 'ok', to: 'skewed' });
    expect(m.observe('p1', FINE)).toBeNull();
    expect(m.observe('p1', FINE)).toMatchObject({ from: 'skewed', to: 'ok', skewMs: 100 });
  });

  it('`unknown` ist NEUTRAL: kippt nichts und bricht die Serie nicht', () => {
    const m = mk(3);
    m.observe('p1', SKEW);
    m.observe('p1', SKEW);
    expect(m.observe('p1', null)).toBeNull(); // z. B. Peer ohne `timestamp`-Feld
    expect(m.stateOf('p1')).toBe('ok');
    // Die Serie steht weiter auf 2 → die naechste echte Messung kippt.
    expect(m.observe('p1', SKEW)).toMatchObject({ to: 'skewed', confirmations: 3 });
  });

  it('ein von Anfang an unauffaelliger Peer erzeugt keinen Alarm', () => {
    const m = mk(1);
    expect(m.observe('p1', FINE)).toBeNull();
    expect(m.stateOf('p1')).toBe('ok');
  });

  it('Peers sind voneinander unabhaengig', () => {
    const m = mk(2);
    m.observe('p1', SKEW);
    expect(m.observe('p2', SKEW)).toBeNull(); // p2 hat erst eine Messung
    expect(m.observe('p1', SKEW)).toMatchObject({ agentId: 'p1', to: 'skewed' });
    expect(m.stateOf('p2')).toBe('ok');
  });

  it('forget() raeumt den Eintrag (kein unbegrenztes Wachstum)', () => {
    const m = mk(1);
    m.observe('p1', SKEW);
    m.observe('p2', SKEW);
    expect(m.size).toBe(2);
    m.forget('p1');
    expect(m.size).toBe(1);
    expect(m.stateOf('p1')).toBeUndefined();
  });

  it('thresholdMs 0 → Monitor gibt gar keine Aussage ab (inert)', () => {
    const m = new ClockSkewMonitor({ thresholdMs: 0, debounce: 1 });
    expect(m.observe('p1', SKEW)).toBeNull();
    expect(m.size).toBe(0);
  });
});

describe('observeHeartbeatSkew — fail-open ueber alle Body-Fehlerformen', () => {
  const mk = (debounce = 1): ClockSkewMonitor =>
    new ClockSkewMonitor({ thresholdMs: 5000, debounce });

  /** Ruft die Klammer so, wie `mesh.ts` es tut: readBody = () => response.json(). */
  async function run(
    monitor: ClockSkewMonitor,
    readBody: () => Promise<unknown>,
    opts: { sentAtMs?: number; receivedAtMs?: number } = {},
  ): ReturnType<typeof observeHeartbeatSkew> {
    return observeHeartbeatSkew({
      monitor,
      agentId: 'p1',
      sentAtMs: opts.sentAtMs ?? 1000,
      readBody,
      now: () => opts.receivedAtMs ?? 1020,
    });
  }

  it('Happy Path: Health-Body mit vorlaufender Uhr → Transition', async () => {
    const m = mk(1);
    const peer = new Date(1010 + 30_000).toISOString();
    const t = await run(m, async () => ({ status: 'ok', timestamp: peer }));
    expect(t).toMatchObject({ agentId: 'p1', from: 'ok', to: 'skewed' });
    expect(t?.skewMs).toBe(30_000);
  });

  it('werfender Reader (abgebrochener Stream) → null, Zustand unberuehrt', async () => {
    const m = mk(1);
    const t = await run(m, () => Promise.reject(new Error('aborted')));
    expect(t).toBeNull();
    expect(m.size).toBe(0);
  });

  it('kein JSON-Objekt (String / Array / null) → null, neutral', async () => {
    const m = mk(1);
    expect(await run(m, async () => 'ok')).toBeNull();
    expect(await run(m, async () => [1, 2, 3])).toBeNull();
    expect(await run(m, async () => null)).toBeNull();
    expect(m.size).toBe(0);
  });

  it('Body ohne `timestamp` (alter/fremder /health) → null, neutral', async () => {
    const m = mk(1);
    expect(await run(m, async () => ({ status: 'ok' }))).toBeNull();
    expect(m.size).toBe(0);
  });

  it('`timestamp` nur ueber die Prototypenkette wird NICHT gelesen', async () => {
    const m = mk(1);
    const hostile = Object.create({ timestamp: new Date(1010 + 30_000).toISOString() }) as object;
    expect(await run(m, async () => hostile)).toBeNull();
    expect(m.size).toBe(0);
  });

  it('unauffaellige Uhr → kein Alarm, aber der Peer ist beobachtet', async () => {
    const m = mk(1);
    const t = await run(m, async () => ({ status: 'ok', timestamp: new Date(1010).toISOString() }));
    expect(t).toBeNull();
    expect(m.stateOf('p1')).toBe('ok');
  });
});

describe('config — TL-15 mesh-Keys', () => {
  const KEYS = ['TLMCP_CLOCK_SKEW_THRESHOLD_MS', 'TLMCP_CLOCK_SKEW_DEBOUNCE'];
  function withEnv(overrides: Record<string, string>, fn: () => void): void {
    const saved = new Map<string, string | undefined>();
    for (const k of KEYS) saved.set(k, process.env[k]);
    try {
      for (const k of KEYS) Reflect.deleteProperty(process.env, k);
      for (const [k, v] of Object.entries(overrides)) process.env[k] = v;
      fn();
    } finally {
      for (const k of KEYS) {
        const orig = saved.get(k);
        if (orig === undefined) Reflect.deleteProperty(process.env, k);
        else process.env[k] = orig;
      }
    }
  }

  it('Default: Schwelle 0 = AUS, Daempfung 3', () => {
    withEnv({}, () => {
      const cfg = loadConfig(NO_TOML);
      // Bewusst inert: ein Default-an wuerde am laufenden Dienst sofort alarmieren.
      expect(cfg.mesh.clock_skew_threshold_ms).toBe(0);
      expect(cfg.mesh.clock_skew_debounce).toBe(3);
    });
  });

  it('Env-Override greift', () => {
    withEnv({ TLMCP_CLOCK_SKEW_THRESHOLD_MS: '5000', TLMCP_CLOCK_SKEW_DEBOUNCE: '5' }, () => {
      const cfg = loadConfig(NO_TOML);
      expect(cfg.mesh.clock_skew_threshold_ms).toBe(5000);
      expect(cfg.mesh.clock_skew_debounce).toBe(5);
    });
  });

  it('negative Schwelle per Env wird abgelehnt', () => {
    withEnv({ TLMCP_CLOCK_SKEW_THRESHOLD_MS: '-1' }, () => {
      expect(() => loadConfig(NO_TOML)).toThrow(/TLMCP_CLOCK_SKEW_THRESHOLD_MS/);
    });
  });

  it('Daempfung 0 per Env wird abgelehnt (waere Daempfung nur dem Namen nach)', () => {
    withEnv({ TLMCP_CLOCK_SKEW_DEBOUNCE: '0' }, () => {
      expect(() => loadConfig(NO_TOML)).toThrow(/TLMCP_CLOCK_SKEW_DEBOUNCE/);
    });
  });

  it('TOML-Pfad: nan / inf / String / Float werden abgewiesen', () => {
    // CR-Runde 1, MEDIUM-1: `deepMerge` uebernimmt TOML-Typen ungepruft, und ein reiner
    // `< 0`/`< 1`-Test laesst all das durch. Nachgemessen: `debounce = nan` haette die
    // Hysterese ausgehebelt (`streak < NaN` ist immer false → Flip bei der 1. Messung),
    // `inf` haette nie alarmiert, und `threshold = "5000"` haette den Monitor gebaut und
    // „aktiv" geloggt, waehrend jede Messung stumm als `unknown` endet.
    const dir = mkdtempSync(join(tmpdir(), 'tlmcp-tl15-cfg2-'));
    try {
      withEnv({}, () => {
        const cases: Array<[string, RegExp]> = [
          ['[mesh]\nclock_skew_debounce = nan\n', /mesh\.clock_skew_debounce/],
          ['[mesh]\nclock_skew_debounce = inf\n', /mesh\.clock_skew_debounce/],
          ['[mesh]\nclock_skew_debounce = 1.5\n', /mesh\.clock_skew_debounce/],
          ['[mesh]\nclock_skew_threshold_ms = "5000"\n', /mesh\.clock_skew_threshold_ms/],
          ['[mesh]\nclock_skew_threshold_ms = nan\n', /mesh\.clock_skew_threshold_ms/],
          ['[mesh]\nclock_skew_threshold_ms = 5000.5\n', /mesh\.clock_skew_threshold_ms/],
        ];
        cases.forEach(([toml, re], i) => {
          const f = join(dir, `bad-${i}.toml`);
          writeFileSync(f, toml);
          expect(() => loadConfig(f)).toThrow(re);
        });
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('TOML-Pfad: negative Schwelle / Daempfung 0 laufen in den Post-Merge-Validator', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tlmcp-tl15-cfg-'));
    try {
      withEnv({}, () => {
        const bad = join(dir, 'skew.toml');
        writeFileSync(bad, '[mesh]\nclock_skew_threshold_ms = -5\n');
        expect(() => loadConfig(bad)).toThrow(/mesh\.clock_skew_threshold_ms/);

        const bad2 = join(dir, 'debounce.toml');
        writeFileSync(bad2, '[mesh]\nclock_skew_debounce = 0\n');
        expect(() => loadConfig(bad2)).toThrow(/mesh\.clock_skew_debounce/);
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
