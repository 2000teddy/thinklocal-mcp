/**
 * T2.2 — Tests für die reparierte InfluxDB-Health-Probe.
 *
 * Kernfix: `/health` existiert erst ab InfluxDB 1.8. Auf älteren 1.x-Knoten
 * liefert es 404 → die Probe meldete einen GESUNDEN Dienst faelschlich als
 * unhealthy. Fix: Fallback auf den universellen `/ping`-Endpoint (204).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { influxdbHealthCheck } from './influxdb.js';

function res(ok: boolean): Response {
  return { ok } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('influxdbHealthCheck (T2.2 probe fix)', () => {
  it('healthy via /health (1.8+): true, /ping wird NICHT mehr gebraucht', async () => {
    const fetchMock = vi.fn(async () => res(true));
    vi.stubGlobal('fetch', fetchMock);
    expect(await influxdbHealthCheck()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/health');
  });

  it('REGRESSION: /health 404 (< 1.8) → Fallback /ping 204 → healthy (kein false-negative)', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      String(url).includes('/ping') ? res(true) : res(false),
    );
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    expect(await influxdbHealthCheck()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/ping');
  });

  it('/health Netzwerkfehler → Fallback /ping 204 → healthy', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/ping')) return res(true);
      throw new Error('ECONNREFUSED');
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    expect(await influxdbHealthCheck()).toBe(true);
  });

  it('beide Endpoints nicht-ok → unhealthy', async () => {
    const fetchMock = vi.fn(async () => res(false));
    vi.stubGlobal('fetch', fetchMock);
    expect(await influxdbHealthCheck()).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('Dienst komplett weg (beide werfen) → unhealthy', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('down');
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await influxdbHealthCheck()).toBe(false);
  });

  it('bereits abgebrochenes Signal nach /health-Fehler → false, kein /ping', async () => {
    const ac = new AbortController();
    ac.abort();
    const fetchMock = vi.fn(async () => {
      throw new Error('aborted');
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await influxdbHealthCheck(ac.signal)).toBe(false);
    // /health-Versuch wirft, danach sig.aborted → /ping wird übersprungen.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
