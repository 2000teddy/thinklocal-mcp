import { describe, it, expect, afterEach } from 'vitest';
import { RateLimiter } from './ratelimit.js';

describe('RateLimiter — Token Bucket pro Peer', () => {
  let limiter: RateLimiter;

  afterEach(() => {
    limiter?.stop();
  });

  it('erlaubt Requests bis zum Burst-Limit', () => {
    limiter = new RateLimiter({ maxTokens: 5, refillRate: 1 });
    const peer = 'peer-1';

    for (let i = 0; i < 5; i++) {
      expect(limiter.allow(peer)).toBe(true);
    }
    // 6. Request wird abgelehnt
    expect(limiter.allow(peer)).toBe(false);
  });

  it('füllt Tokens über Zeit nach', async () => {
    limiter = new RateLimiter({ maxTokens: 3, refillRate: 10 }); // 10/s = schnell
    const peer = 'peer-2';

    // Alle Tokens verbrauchen
    for (let i = 0; i < 3; i++) {
      limiter.allow(peer);
    }
    expect(limiter.allow(peer)).toBe(false);

    // 200ms warten → ~2 Tokens nachgefüllt (10/s * 0.2s = 2)
    await new Promise((r) => setTimeout(r, 200));
    expect(limiter.allow(peer)).toBe(true);
  });

  it('hält separate Buckets pro Peer', () => {
    limiter = new RateLimiter({ maxTokens: 2, refillRate: 0.1 });

    // Peer A verbraucht alle Tokens
    limiter.allow('peer-a');
    limiter.allow('peer-a');
    expect(limiter.allow('peer-a')).toBe(false);

    // Peer B ist davon nicht betroffen
    expect(limiter.allow('peer-b')).toBe(true);
  });

  it('zeigt verbleibende Tokens an', () => {
    limiter = new RateLimiter({ maxTokens: 10, refillRate: 1 });
    expect(limiter.remaining('new-peer')).toBe(10);

    limiter.allow('new-peer');
    expect(limiter.remaining('new-peer')).toBeGreaterThanOrEqual(9);
  });

  it('entfernt Peer-State', () => {
    limiter = new RateLimiter({ maxTokens: 1, refillRate: 0 });
    limiter.allow('peer-x');
    expect(limiter.allow('peer-x')).toBe(false);

    limiter.removePeer('peer-x');
    // Nach Remove: frischer Bucket
    expect(limiter.allow('peer-x')).toBe(true);
  });

  it('füllt nie über maxTokens auf', async () => {
    limiter = new RateLimiter({ maxTokens: 5, refillRate: 100 }); // Extrem schnell
    const peer = 'peer-overflow';
    limiter.allow(peer);

    await new Promise((r) => setTimeout(r, 200));
    // Trotz schnellem Refill: nicht über maxTokens
    expect(limiter.remaining(peer)).toBeLessThanOrEqual(5);
  });
});
