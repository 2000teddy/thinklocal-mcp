import { describe, it, expect } from 'vitest';
import { runAllProbes, runProbeById, listProbeIds } from './system-probes.js';

describe('listProbeIds', () => {
  it('returns the whitelist of probe IDs', () => {
    const ids = listProbeIds();
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toContain('disk-usage');
    expect(ids).toContain('memory');
    expect(ids).toContain('uptime');
  });

  it('returns only known safe IDs', () => {
    const ids = listProbeIds();
    const allowed = [
      'disk-usage', 'memory', 'uptime', 'kernel', 'os-release',
      'failed-services', 'recent-logs', 'user-cron', 'apt-upgradable', 'top-mem',
    ];
    for (const id of ids) {
      expect(allowed).toContain(id);
    }
  });
});

describe('runProbeById', () => {
  it('returns null for unknown probe ID', async () => {
    const result = await runProbeById('not-a-real-probe');
    expect(result).toBeNull();
  });

  it('executes uptime probe (cross-platform)', async () => {
    const result = await runProbeById('uptime');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('uptime');
    expect(result!.category).toBe('uptime');
    expect(result!.duration_ms).toBeGreaterThanOrEqual(0);
    // uptime works on both macOS and Linux
    expect(result!.output.length).toBeGreaterThan(0);
    expect(result!.error).toBeNull();
  });

  it('handles probe errors gracefully (no throw)', async () => {
    // apt is not available on macOS — this probe should fail gracefully
    const result = await runProbeById('apt-upgradable');
    expect(result).not.toBeNull();
    // Either succeeds (Linux with apt) or returns error (macOS without apt)
    expect(typeof result!.duration_ms).toBe('number');
  });
});

describe('runAllProbes', () => {
  it('runs all whitelisted probes', async () => {
    const results = await runAllProbes();
    const ids = listProbeIds();
    expect(results).toHaveLength(ids.length);

    // Every result has the expected shape
    for (const r of results) {
      expect(typeof r.id).toBe('string');
      expect(typeof r.category).toBe('string');
      expect(typeof r.command).toBe('string');
      expect(typeof r.duration_ms).toBe('number');
      expect(r.error === null || typeof r.error === 'string').toBe(true);
    }
  });

  it('includes duration measurements', async () => {
    const results = await runAllProbes();
    for (const r of results) {
      expect(r.duration_ms).toBeGreaterThanOrEqual(0);
    }
  });

  it('parallel execution is faster than sum of individual timeouts', async () => {
    // Sanity check: if probes ran sequentially, 10 probes * 5s timeout = 50s.
    // In practice, all probes should complete well under that.
    const start = Date.now();
    await runAllProbes();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(15_000); // 15s upper bound
  });
});
