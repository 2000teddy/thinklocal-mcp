/**
 * static-peer-reconciler.ts — ADR-025 Option 2: robuster static_peer-Join.
 *
 * Statt eines einmaligen Start-Bursts (der auf dual-homed macOS genau das transiente
 * connectx-Poison-Fenster trifft → EHOSTUNREACH → 0 Peers, kein Retry) versucht dieser
 * Reconciler noch nicht verbundene static_peers wiederholt zu verbinden: sofort, dann
 * alle `intervalMs` für `startupWindowMs`, optional danach langsam weiter (`steadyIntervalMs`,
 * z.B. für static-only Nodes ohne mDNS). Non-blocking, idempotent (der `connectOnce`-Caller
 * deduppt über die Mesh-Peer-Liste), sauber stopbar im Graceful Shutdown.
 *
 * Reine Orchestrierung — der eigentliche Connect (fetch agent-card + mesh.addPeer) wird als
 * `connectOnce` injiziert → vollständig ohne Netzwerk/Timer-Globals unit-testbar.
 */
import type { Logger } from 'pino';
import type { StaticPeer } from './config.js';

export interface StaticPeerReconcilerOptions {
  staticPeers: StaticPeer[];
  /** Ein Verbindungsversuch für EINEN Peer. true = verbunden (wird aus dem Pending entfernt). */
  connectOnce: (peer: StaticPeer) => Promise<boolean>;
  log?: Logger;
  /** Retry-Intervall im Startup-Fenster. Default 15s. */
  intervalMs?: number;
  /** Dauer des dichten Retry-Fensters. Default 5min. */
  startupWindowMs?: number;
  /** Optional: nach dem Startup-Fenster langsam weiter-reconcilen (z.B. static-only). undefined = stoppen. */
  steadyIntervalMs?: number;
  /** Injizierbar für Tests. */
  setTimeoutFn?: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (handle: ReturnType<typeof setTimeout>) => void;
  nowFn?: () => number;
}

export interface StaticPeerReconcilerHandle {
  stop: () => void;
}

const peerKey = (p: StaticPeer): string => `${p.host}:${p.port ?? ''}`;

/**
 * Startet den Reconciler. Gibt sofort zurück (non-blocking); der erste Versuch läuft
 * asynchron. Liefert `{ stop }` für den Graceful Shutdown.
 */
export function startStaticPeerReconciler(opts: StaticPeerReconcilerOptions): StaticPeerReconcilerHandle {
  const intervalMs = opts.intervalMs ?? 15_000;
  const startupWindowMs = opts.startupWindowMs ?? 5 * 60_000;
  const steadyIntervalMs = opts.steadyIntervalMs;
  const setT = opts.setTimeoutFn ?? ((cb, ms) => setTimeout(cb, ms));
  const clearT = opts.clearTimeoutFn ?? ((h) => clearTimeout(h));
  const now = opts.nowFn ?? (() => Date.now());
  const log = opts.log;

  const pending = new Map<string, StaticPeer>();
  for (const p of opts.staticPeers) pending.set(peerKey(p), p);

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const start = now();

  if (pending.size === 0) return { stop: () => {} };

  const attemptAll = async (): Promise<void> => {
    // Snapshot der Keys: connectOnce-Erfolg entfernt den Eintrag aus `pending`.
    for (const [key, peer] of [...pending]) {
      if (stopped) return;
      try {
        if (await opts.connectOnce(peer)) pending.delete(key);
      } catch (err) {
        log?.debug({ peer: peerKey(peer), err: (err as Error)?.message }, '[static-peer] Versuch fehlgeschlagen — retry');
      }
    }
  };

  const tick = async (): Promise<void> => {
    if (stopped) return;
    await attemptAll();
    if (stopped) return;
    const elapsed = now() - start;
    const hasSteady = steadyIntervalMs !== undefined;

    // One-shot-Modus (kein steady): fertig, sobald alle verbunden sind.
    if (pending.size === 0 && !hasSteady) {
      log?.info('[static-peer] alle static_peers verbunden — Reconciler beendet');
      return;
    }

    let nextMs: number;
    if (elapsed >= startupWindowMs) {
      if (!hasSteady) {
        log?.warn(
          { remaining: [...pending.keys()] },
          '[static-peer] Startup-Retry-Fenster abgelaufen, Peers weiterhin nicht erreichbar — Reconciler beendet',
        );
        return;
      }
      // CR-MEDIUM: Steady-Modus (z.B. static-only ohne mDNS) re-prüft ALLE Peers, damit
      // zwischenzeitlich abgefallene/neu gestartete Peers wieder verbunden werden
      // (connectOnce ist idempotent → mesh.addPeer dedupt). Pending wird neu geseedet.
      for (const p of opts.staticPeers) pending.set(peerKey(p), p);
      nextMs = steadyIntervalMs as number;
    } else {
      nextMs = intervalMs;
    }
    timer = setT(() => { void tick(); }, nextMs);
  };

  // Non-blocking starten: erster Versuch als 0ms-Timer → alle Ticks laufen einheitlich über
  // den (injizierbaren) Scheduler (deterministisch testbar, kein Boot-Blocking).
  timer = setT(() => { void tick(); }, 0);

  return {
    stop: () => {
      stopped = true;
      if (timer !== undefined) clearT(timer);
    },
  };
}
