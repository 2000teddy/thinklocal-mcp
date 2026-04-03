/**
 * ratelimit.ts — Token Bucket Rate-Limiter pro Peer
 *
 * Schützt den Daemon vor übermäßigen Anfragen einzelner Peers.
 * Jeder Peer hat einen eigenen Token Bucket mit konfigurierbarer
 * Kapazität und Auffüllrate.
 *
 * Defaults: 20 Tokens, 2 Tokens/Sekunde Refill → Burst von 20,
 * dann maximal 2 Requests/Sekunde pro Peer.
 */

import type { Logger } from 'pino';

export interface RateLimitConfig {
  /** Maximale Anzahl Tokens im Bucket */
  maxTokens: number;
  /** Tokens pro Sekunde die nachgefüllt werden */
  refillRate: number;
}

interface BucketState {
  tokens: number;
  lastRefill: number;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  maxTokens: 20,
  refillRate: 2,
};

export class RateLimiter {
  private buckets = new Map<string, BucketState>();
  private config: RateLimitConfig;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    config?: Partial<RateLimitConfig>,
    private log?: Logger,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Periodisch inaktive Buckets aufräumen (alle 5 Minuten)
    this.cleanupTimer = setInterval(() => this.cleanup(), 5 * 60_000);
  }

  /**
   * Prüft ob ein Request von einem Peer erlaubt ist.
   * Verbraucht ein Token wenn erlaubt.
   * @returns true wenn erlaubt, false wenn Rate-Limited
   */
  allow(peerId: string): boolean {
    const bucket = this.getOrCreateBucket(peerId);
    this.refill(bucket);

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }

    this.log?.debug({ peerId, tokens: bucket.tokens }, 'Rate-Limited');
    return false;
  }

  /**
   * Gibt die verbleibenden Tokens für einen Peer zurück.
   */
  remaining(peerId: string): number {
    const bucket = this.buckets.get(peerId);
    if (!bucket) return this.config.maxTokens;
    this.refill(bucket);
    return Math.floor(bucket.tokens);
  }

  /**
   * Entfernt den Rate-Limit-State für einen Peer (z.B. bei Disconnect).
   */
  removePeer(peerId: string): void {
    this.buckets.delete(peerId);
  }

  /**
   * Stoppt den Cleanup-Timer.
   */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  private getOrCreateBucket(peerId: string): BucketState {
    let bucket = this.buckets.get(peerId);
    if (!bucket) {
      bucket = {
        tokens: this.config.maxTokens,
        lastRefill: Date.now(),
      };
      this.buckets.set(peerId, bucket);
    }
    return bucket;
  }

  private refill(bucket: BucketState): void {
    const now = Date.now();
    const elapsed = (now - bucket.lastRefill) / 1000; // Sekunden
    const newTokens = elapsed * this.config.refillRate;

    if (newTokens > 0) {
      bucket.tokens = Math.min(this.config.maxTokens, bucket.tokens + newTokens);
      bucket.lastRefill = now;
    }
  }

  /**
   * Entfernt Buckets die seit 10 Minuten nicht benutzt wurden.
   */
  private cleanup(): void {
    const cutoff = Date.now() - 10 * 60_000;
    for (const [peerId, bucket] of this.buckets) {
      if (bucket.lastRefill < cutoff) {
        this.buckets.delete(peerId);
      }
    }
  }
}
