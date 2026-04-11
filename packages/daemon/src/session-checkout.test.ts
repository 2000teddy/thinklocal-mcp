/**
 * session-checkout.test.ts — Tests fuer Atomic Session-Checkout (Phase D1)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionCheckout } from './session-checkout.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('SessionCheckout', () => {
  let dataDir: string;
  let checkout: SessionCheckout;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'checkout-test-'));
    checkout = new SessionCheckout({ dataDir, maxLockDurationMs: 60_000 });
  });

  afterEach(() => {
    checkout.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  const agent1 = 'spiffe://thinklocal/host/aaa/agent/claude-code';
  const agent2 = 'spiffe://thinklocal/host/bbb/agent/codex';

  it('acquires a lock on a free branch', () => {
    const result = checkout.checkout('main', agent1);
    expect(result.ok).toBe(true);
    expect(result.holder).toBe(agent1);
    expect(result.locked_at).toBeTruthy();
    expect(result.expires_at).toBeTruthy();
  });

  it('denies lock when branch is held by another agent', () => {
    checkout.checkout('main', agent1);
    const result = checkout.checkout('main', agent2);
    expect(result.ok).toBe(false);
    expect(result.holder).toBe(agent1);
  });

  it('allows idempotent re-checkout by same agent', () => {
    checkout.checkout('main', agent1);
    const result = checkout.checkout('main', agent1);
    expect(result.ok).toBe(true);
    expect(result.holder).toBe(agent1);
  });

  it('allows different agents on different branches', () => {
    const r1 = checkout.checkout('feature-a', agent1);
    const r2 = checkout.checkout('feature-b', agent2);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
  });

  it('releases a lock by holder', () => {
    checkout.checkout('main', agent1);
    const released = checkout.release('main', agent1);
    expect(released).toBe(true);

    // Now agent2 can acquire
    const result = checkout.checkout('main', agent2);
    expect(result.ok).toBe(true);
  });

  it('does not release lock held by another agent', () => {
    checkout.checkout('main', agent1);
    const released = checkout.release('main', agent2);
    expect(released).toBe(false);

    // Lock still held by agent1
    const lock = checkout.isLocked('main');
    expect(lock).not.toBeNull();
    expect(lock!.agent_id).toBe(agent1);
  });

  it('force-releases any lock', () => {
    checkout.checkout('main', agent1);
    const released = checkout.forceRelease('main');
    expect(released).toBe(true);

    // Now free
    expect(checkout.isLocked('main')).toBeNull();
  });

  it('evicts expired locks automatically', () => {
    // Create a checkout with very short expiry
    checkout.close();
    checkout = new SessionCheckout({ dataDir, maxLockDurationMs: 1 });

    checkout.checkout('main', agent1);

    // Wait for expiry (1ms)
    const start = Date.now();
    while (Date.now() - start < 5) { /* spin */ }

    // Expired lock should be evicted on next checkout
    const result = checkout.checkout('main', agent2);
    expect(result.ok).toBe(true);
    expect(result.holder).toBe(agent2);
  });

  it('lists all active locks', () => {
    checkout.checkout('main', agent1, 'fixing bug');
    checkout.checkout('feature-x', agent2, 'adding feature');

    const locks = checkout.listLocks();
    expect(locks.length).toBe(2);
    expect(locks.map(l => l.branch).sort()).toEqual(['feature-x', 'main']);
  });

  it('isLocked returns null for free branch', () => {
    expect(checkout.isLocked('nonexistent')).toBeNull();
  });

  it('isLocked returns lock info for locked branch', () => {
    checkout.checkout('main', agent1, 'test');
    const lock = checkout.isLocked('main');
    expect(lock).not.toBeNull();
    expect(lock!.agent_id).toBe(agent1);
    expect(lock!.purpose).toBe('test');
  });

  it('purpose is stored and retrievable', () => {
    checkout.checkout('main', agent1, 'implementing ADR-004');
    const lock = checkout.isLocked('main');
    expect(lock!.purpose).toBe('implementing ADR-004');
  });

  it('refreshes expiry on idempotent re-checkout', () => {
    const first = checkout.checkout('main', agent1);
    // Small delay
    const start = Date.now();
    while (Date.now() - start < 2) { /* spin */ }
    const second = checkout.checkout('main', agent1);

    expect(second.ok).toBe(true);
    // Expiry should be later than the first
    expect(new Date(second.expires_at!).getTime()).toBeGreaterThanOrEqual(
      new Date(first.expires_at!).getTime(),
    );
  });
});
