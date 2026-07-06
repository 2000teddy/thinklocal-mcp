// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * static-peer-reconciler.test.ts — ADR-025 Option 2.
 * Deterministisch via vitest fake timers (advanceTimersByTimeAsync flusht Timer + Microtasks).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startStaticPeerReconciler, resolveStaticReconcileSteadyMs } from './static-peer-reconciler.js';
import type { StaticPeer } from './config.js';

const PEERS: StaticPeer[] = [{ host: '10.10.10.94', port: 9440 }];

describe('startStaticPeerReconciler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('retryt transientes EHOSTUNREACH bis Erfolg, dann keine weiteren Versuche', async () => {
    let n = 0;
    const connectOnce = vi.fn(async () => { n += 1; return n >= 3; }); // erst beim 3. Versuch OK
    const h = startStaticPeerReconciler({ staticPeers: PEERS, connectOnce, intervalMs: 15_000, startupWindowMs: 300_000 });

    await vi.advanceTimersByTimeAsync(0);      // 1. Versuch (0ms-Timer) → false
    expect(connectOnce).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15_000); // 2. → false
    await vi.advanceTimersByTimeAsync(15_000); // 3. → true (verbunden)
    expect(connectOnce).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(120_000); // keine weiteren Versuche nach Erfolg
    expect(connectOnce).toHaveBeenCalledTimes(3);
    h.stop();
  });

  it('stoppt nach dem Startup-Fenster, wenn kein steadyInterval gesetzt ist', async () => {
    const connectOnce = vi.fn(async () => false); // nie erreichbar
    const h = startStaticPeerReconciler({ staticPeers: PEERS, connectOnce, intervalMs: 15_000, startupWindowMs: 30_000 });
    await vi.advanceTimersByTimeAsync(0);        // t=0
    await vi.advanceTimersByTimeAsync(15_000);   // t=15s
    await vi.advanceTimersByTimeAsync(15_000);   // t=30s → Fenster erreicht, danach Stop
    const callsAtWindow = connectOnce.mock.calls.length;
    await vi.advanceTimersByTimeAsync(120_000);  // keine weiteren
    expect(connectOnce.mock.calls.length).toBe(callsAtWindow);
    h.stop();
  });

  it('mit steadyInterval (static-only): reconcilet nach dem Fenster langsam weiter', async () => {
    const connectOnce = vi.fn(async () => false);
    const h = startStaticPeerReconciler({
      staticPeers: PEERS, connectOnce, intervalMs: 15_000, startupWindowMs: 30_000, steadyIntervalMs: 60_000,
    });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(30_000);   // Fenster erreicht
    const atWindow = connectOnce.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);   // steady-Tick
    await vi.advanceTimersByTimeAsync(60_000);   // noch einer
    expect(connectOnce.mock.calls.length).toBeGreaterThan(atWindow);
    h.stop();
  });

  it('steady-Modus re-prüft auch bereits verbundene Peers (re-discovery, CR-MEDIUM)', async () => {
    const connectOnce = vi.fn(async () => true); // immer verbunden
    const h = startStaticPeerReconciler({
      staticPeers: PEERS, connectOnce, intervalMs: 15_000, startupWindowMs: 30_000, steadyIntervalMs: 60_000,
    });
    await vi.advanceTimersByTimeAsync(0); // 1. Versuch → verbunden, pending leer
    const afterFirst = connectOnce.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30_000); // Fenster erreicht → re-seed
    await vi.advanceTimersByTimeAsync(60_000); // steady-Tick re-prüft den (bereits verbundenen) Peer
    expect(connectOnce.mock.calls.length).toBeGreaterThan(afterFirst);
    h.stop();
  });

  it('stop() verhindert weitere Versuche', async () => {
    const connectOnce = vi.fn(async () => false);
    const h = startStaticPeerReconciler({ staticPeers: PEERS, connectOnce, intervalMs: 15_000, startupWindowMs: 300_000 });
    await vi.advanceTimersByTimeAsync(0);
    const before = connectOnce.mock.calls.length;
    h.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(connectOnce.mock.calls.length).toBe(before);
  });

  it('connectOnce-Wurf (z.B. EHOSTUNREACH) wird geschluckt → weiter retryt', async () => {
    let n = 0;
    const connectOnce = vi.fn(async () => { n += 1; if (n < 2) throw new Error('EHOSTUNREACH'); return true; });
    const h = startStaticPeerReconciler({ staticPeers: PEERS, connectOnce, intervalMs: 15_000, startupWindowMs: 300_000 });
    await vi.advanceTimersByTimeAsync(0);        // wirft → kein Crash
    await vi.advanceTimersByTimeAsync(15_000);   // 2. → true
    expect(connectOnce).toHaveBeenCalledTimes(2);
    h.stop();
  });

  it('leere static_peers → kein Timer, stop() ist no-op', async () => {
    const connectOnce = vi.fn(async () => true);
    const h = startStaticPeerReconciler({ staticPeers: [], connectOnce });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(connectOnce).not.toHaveBeenCalled();
    expect(() => h.stop()).not.toThrow();
  });

  it('Self-Healing: ein static_peer, der offline flappt (connectOnce false), wird im Steady-Modus re-connectet', async () => {
    // true (initialer Connect) → false (Peer flappt offline) → true (Steady re-connectet = re-online).
    const results = [true, false, true];
    let i = 0;
    const connectOnce = vi.fn(async () => results[Math.min(i++, results.length - 1)] ?? true);
    const h = startStaticPeerReconciler({
      staticPeers: PEERS, connectOnce, intervalMs: 15_000, startupWindowMs: 30_000,
      steadyIntervalMs: resolveStaticReconcileSteadyMs(PEERS.length), // = 60s (immer, mdns-unabhängig)
    });
    await vi.advanceTimersByTimeAsync(0);       // initial connect → true
    await vi.advanceTimersByTimeAsync(30_000);  // Fenster → re-seed pending
    await vi.advanceTimersByTimeAsync(60_000);  // steady-Tick: re-attempt (flapped) → false
    await vi.advanceTimersByTimeAsync(60_000);  // steady-Tick: re-attempt → true (re-online)
    expect(connectOnce.mock.calls.length).toBeGreaterThanOrEqual(3);
    h.stop();
  });
});

describe('resolveStaticReconcileSteadyMs — ADR-026/025 Online-Self-Healing (mdns-unabhängig)', () => {
  it('static_peers vorhanden → Steady-Intervall (60s), UNABHÄNGIG von mdns_enabled', () => {
    // Signatur hat bewusst KEINEN mdns-Parameter → Steady kann nicht mehr an mdns gekoppelt werden
    // (genau das war der one-shot-Bug auf mdns-an-Nodes).
    expect(resolveStaticReconcileSteadyMs(1)).toBe(60_000);
    expect(resolveStaticReconcileSteadyMs(5)).toBe(60_000);
  });
  it('keine static_peers → undefined (one-shot, kein unnötiger Timer)', () => {
    expect(resolveStaticReconcileSteadyMs(0)).toBeUndefined();
  });
  it('konfigurierbares Steady-Intervall', () => {
    expect(resolveStaticReconcileSteadyMs(1, 30_000)).toBe(30_000);
  });
});
