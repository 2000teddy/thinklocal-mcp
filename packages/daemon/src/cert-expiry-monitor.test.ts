/**
 * T2.1 — Tests für den Live-Cert-Ablauf-Monitor.
 *
 * Deckt ab:
 *  - classifyCertExpiry: Tier-Grenzen (inkl. null→unknown, abgelaufen→critical).
 *  - runCertExpiryCheck: Alarm (Audit + EventBus) NUR bei warn/critical; ok/unknown
 *    schreiben kein Audit-Event; der Alert macht das Reissue-bei-Neustart-Verhalten
 *    explizit (RE-CHECK-Verdikt).
 *  - startCertExpiryMonitor: sofortiger Check + periodische Wiederholung (der
 *    eigentliche T2.1-Fix: läuft live, nicht nur beim Start) + Crash-Sicherheit.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  classifyCertExpiry,
  runCertExpiryCheck,
  startCertExpiryMonitor,
  type CertExpiryMonitorDeps,
} from './cert-expiry-monitor.js';
import { loadConfig } from './config.js';

const THRESH = { warnDays: 30, criticalDays: 7 };

function makeLog() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeDeps(daysLeft: number | null): {
  deps: CertExpiryMonitorDeps;
  appends: Array<{ type: string; details?: string }>;
  emits: Array<{ type: string; data?: Record<string, unknown> }>;
  log: ReturnType<typeof makeLog>;
} {
  const appends: Array<{ type: string; details?: string }> = [];
  const emits: Array<{ type: string; data?: Record<string, unknown> }> = [];
  const log = makeLog();
  const deps: CertExpiryMonitorDeps = {
    getDaysLeft: () => daysLeft,
    thresholds: THRESH,
    log,
    audit: { append: (type, _peerId, details) => appends.push({ type, details }) },
    eventBus: { emit: (type, data) => emits.push({ type, data }) },
  };
  return { deps, appends, emits, log };
}

describe('classifyCertExpiry', () => {
  it.each([
    [null, 'unknown'],
    [31, 'ok'],
    [30, 'warn'],
    [8, 'warn'],
    [7, 'critical'],
    [0, 'critical'],
    [-5, 'critical'], // bereits abgelaufen
  ])('daysLeft=%s → %s', (daysLeft, expected) => {
    expect(classifyCertExpiry(daysLeft as number | null, THRESH)).toBe(expected);
  });
});

describe('runCertExpiryCheck', () => {
  it("ok (40 d): kein Audit-Event, kein Emit, nur debug", () => {
    const { deps, appends, emits, log } = makeDeps(40);
    expect(runCertExpiryCheck(deps)).toBe('ok');
    expect(appends).toEqual([]);
    expect(emits).toEqual([]);
    expect(log.debug).toHaveBeenCalledOnce();
  });

  it('unknown (null): kein Audit-Event, kein Emit, warn geloggt', () => {
    const { deps, appends, emits, log } = makeDeps(null);
    expect(runCertExpiryCheck(deps)).toBe('unknown');
    expect(appends).toEqual([]);
    expect(emits).toEqual([]);
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it('warn (20 d): signiertes CERT_EXPIRY_WARNING + system:cert_expiry-Emit', () => {
    const { deps, appends, emits, log } = makeDeps(20);
    expect(runCertExpiryCheck(deps)).toBe('warn');
    expect(appends).toHaveLength(1);
    expect(appends[0]?.type).toBe('CERT_EXPIRY_WARNING');
    expect(emits[0]?.type).toBe('system:cert_expiry');
    expect(emits[0]?.data).toMatchObject({ daysLeft: 20, tier: 'warn' });
    expect(log.warn).toHaveBeenCalledOnce();
    expect(log.error).not.toHaveBeenCalled();
  });

  it('critical (3 d): error-Log + Audit + Emit; Detail macht Reissue-bei-Neustart explizit', () => {
    const { deps, appends, emits, log } = makeDeps(3);
    expect(runCertExpiryCheck(deps)).toBe('critical');
    expect(appends[0]?.type).toBe('CERT_EXPIRY_WARNING');
    // Reissue-Verhalten explizit (RE-CHECK-Verdikt): Neustart erforderlich.
    expect(appends[0]?.details).toMatch(/Neustart/);
    expect(appends[0]?.details).toMatch(/3/);
    expect(emits[0]?.data).toMatchObject({ daysLeft: 3, tier: 'critical' });
    expect(log.error).toHaveBeenCalledOnce();
  });

  // WOCHENPLAN-KW27 §2 RE-CHECK (Dry-Run, worst case): Cert BEREITS ABGELAUFEN (daysLeft < 0),
  // Daemon läuft weiter. Beweist reproduzierbar: der Monitor ROTIERT NICHT in-process — sein
  // einziger Effekt ist ein Alarm (Audit + EventBus) mit Neustart-Hinweis. Er KANN nicht rotieren:
  // `CertExpiryMonitorDeps` exponiert keinerlei Rotate-/Reissue-Fähigkeit (nur getDaysLeft/audit/
  // eventBus/log). Reissue bleibt startup-only (loadOrCreateTlsBundle). → Auto-Rotation feuert NIE live.
  it('RE-CHECK: abgelaufenes Cert (daysLeft=-1) → NUR Alarm, KEINE In-Process-Rotation', () => {
    const { deps, appends, emits, log } = makeDeps(-1);
    // Struktureller Beweis: die Deps haben keinen Rotate-Hook (Compile-/Runtime-Oberfläche).
    expect(Object.keys(deps).sort()).toEqual(['audit', 'eventBus', 'getDaysLeft', 'log', 'thresholds']);

    expect(runCertExpiryCheck(deps)).toBe('critical');
    // Einziger Effekt: Alarm mit Neustart-Hinweis — kein Reissue-Pfad existiert.
    expect(appends).toHaveLength(1);
    expect(appends[0]?.type).toBe('CERT_EXPIRY_WARNING');
    expect(appends[0]?.details).toMatch(/Neustart/);
    expect(appends[0]?.details).toMatch(/KEINE In-Process-Rotation/);
    expect(emits[0]?.data).toMatchObject({ daysLeft: -1, tier: 'critical' });
    expect(log.error).toHaveBeenCalledOnce();
  });
});

describe('startCertExpiryMonitor', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('führt sofort einen Check aus und wiederholt ihn periodisch (T2.1-Kern: läuft live)', () => {
    const getDaysLeft = vi.fn<() => number | null>(() => 3);
    const log = makeLog();
    const deps: CertExpiryMonitorDeps = {
      getDaysLeft,
      thresholds: THRESH,
      log,
      audit: { append: vi.fn() },
      eventBus: { emit: vi.fn() },
    };
    const timer = startCertExpiryMonitor(deps, 1000);
    try {
      expect(getDaysLeft).toHaveBeenCalledTimes(1); // sofort
      vi.advanceTimersByTime(3000);
      expect(getDaysLeft).toHaveBeenCalledTimes(4); // + 3 periodische
    } finally {
      clearInterval(timer);
    }
  });

  it('ein werfender Check crasht den Monitor NICHT', () => {
    const log = makeLog();
    const deps: CertExpiryMonitorDeps = {
      getDaysLeft: () => {
        throw new Error('cert unreadable');
      },
      thresholds: THRESH,
      log,
      audit: { append: vi.fn() },
      eventBus: { emit: vi.fn() },
    };
    let timer: NodeJS.Timeout | undefined;
    expect(() => {
      timer = startCertExpiryMonitor(deps, 1000);
    }).not.toThrow();
    expect(log.warn).toHaveBeenCalled(); // Fehler wurde gefangen + geloggt
    if (timer) clearInterval(timer);
  });
});

describe('config — T2.1 cert section', () => {
  const KEYS = [
    'TLMCP_CERT_EXPIRY_WARN_DAYS',
    'TLMCP_CERT_EXPIRY_CRITICAL_DAYS',
    'TLMCP_CERT_EXPIRY_CHECK_INTERVAL_MS',
  ];
  const NO_TOML = '/nonexistent/thinklocal-t21-test.toml';
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

  it('Defaults: warn=30, critical=7, interval=12h', () => {
    withEnv({}, () => {
      const cfg = loadConfig(NO_TOML);
      expect(cfg.cert.expiry_warn_days).toBe(30);
      expect(cfg.cert.expiry_critical_days).toBe(7);
      expect(cfg.cert.expiry_check_interval_ms).toBe(43_200_000);
    });
  });

  it('Env-Overrides greifen', () => {
    withEnv(
      {
        TLMCP_CERT_EXPIRY_WARN_DAYS: '45',
        TLMCP_CERT_EXPIRY_CRITICAL_DAYS: '14',
        TLMCP_CERT_EXPIRY_CHECK_INTERVAL_MS: '3600000',
      },
      () => {
        const cfg = loadConfig(NO_TOML);
        expect(cfg.cert.expiry_warn_days).toBe(45);
        expect(cfg.cert.expiry_critical_days).toBe(14);
        expect(cfg.cert.expiry_check_interval_ms).toBe(3_600_000);
      },
    );
  });

  it('lehnt nicht-positive Werte ab', () => {
    withEnv({ TLMCP_CERT_EXPIRY_WARN_DAYS: '0' }, () => {
      expect(() => loadConfig(NO_TOML)).toThrow();
    });
  });

  it('lehnt warn <= critical ab (fail fast, sonst warn-Tier unerreichbar)', () => {
    withEnv(
      { TLMCP_CERT_EXPIRY_WARN_DAYS: '5', TLMCP_CERT_EXPIRY_CRITICAL_DAYS: '30' },
      () => {
        expect(() => loadConfig(NO_TOML)).toThrow(/expiry_warn_days/);
      },
    );
  });
});
