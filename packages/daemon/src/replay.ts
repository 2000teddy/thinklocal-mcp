/**
 * replay.ts — Replay-Schutz für signierte Nachrichten
 *
 * Prüft ob eine Nachricht mit dem gleichen idempotency_key bereits
 * verarbeitet wurde. Verhindert Replay-Angriffe innerhalb der TTL.
 *
 * In-Memory-Cache mit automatischem Cleanup abgelaufener Einträge.
 */

export class ReplayGuard {
  /** Map: `${sender}:${idempotency_key}` → Timestamp (ms) */
  private seen = new Map<string, number>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private cleanupIntervalMs = 60_000) {
    this.cleanupTimer = setInterval(() => this.cleanup(), this.cleanupIntervalMs);
  }

  /**
   * Prüft ob eine Nachricht ein Replay ist.
   * @returns true wenn Replay (bereits gesehen), false wenn neu
   */
  isReplay(sender: string, idempotencyKey: string, ttlMs: number): boolean {
    const key = `${sender}:${idempotencyKey}`;
    const now = Date.now();
    const seenAt = this.seen.get(key);

    if (seenAt !== undefined && now - seenAt < ttlMs) {
      return true; // Replay!
    }

    this.seen.set(key, now);
    return false;
  }

  /**
   * Entfernt abgelaufene Einträge (älter als 2 Minuten).
   */
  private cleanup(): void {
    const cutoff = Date.now() - 120_000;
    for (const [key, timestamp] of this.seen) {
      if (timestamp < cutoff) {
        this.seen.delete(key);
      }
    }
  }

  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}
