/**
 * circuit-breaker.test.ts — Tests fuer Circuit Breaker (Phase D4)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CircuitBreaker } from './circuit-breaker.js';

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 100 });
  });

  // ── CLOSED state ─────────────────────────────────────────

  it('starts in closed state', () => {
    expect(breaker.canExecute('skill-a')).toBe(true);
    expect(breaker.getStatus('skill-a').state).toBe('closed');
  });

  it('stays closed on success', () => {
    breaker.recordSuccess('skill-a');
    expect(breaker.getStatus('skill-a').state).toBe('closed');
    expect(breaker.getStatus('skill-a').successCount).toBe(1);
  });

  it('stays closed below failure threshold', () => {
    breaker.recordFailure('skill-a');
    breaker.recordFailure('skill-a');
    expect(breaker.canExecute('skill-a')).toBe(true);
    expect(breaker.getStatus('skill-a').state).toBe('closed');
  });

  it('resets failure count on success', () => {
    breaker.recordFailure('skill-a');
    breaker.recordFailure('skill-a');
    breaker.recordSuccess('skill-a');
    expect(breaker.getStatus('skill-a').failures).toBe(0);
  });

  // ── OPEN state ───────────────────────────────────────────

  it('opens after reaching failure threshold', () => {
    for (let i = 0; i < 3; i++) breaker.recordFailure('skill-a');
    expect(breaker.getStatus('skill-a').state).toBe('open');
    expect(breaker.canExecute('skill-a')).toBe(false);
  });

  it('rejects requests when open', () => {
    for (let i = 0; i < 3; i++) breaker.recordFailure('skill-a');
    expect(breaker.canExecute('skill-a')).toBe(false);
  });

  it('has nextRetryAt when open', () => {
    for (let i = 0; i < 3; i++) breaker.recordFailure('skill-a');
    const status = breaker.getStatus('skill-a');
    expect(status.nextRetryAt).toBeTruthy();
  });

  // ── HALF_OPEN state ──────────────────────────────────────

  it('transitions to half_open after reset timeout', async () => {
    for (let i = 0; i < 3; i++) breaker.recordFailure('skill-a');
    expect(breaker.canExecute('skill-a')).toBe(false);

    // Wait for reset timeout
    await new Promise(r => setTimeout(r, 120));

    expect(breaker.canExecute('skill-a')).toBe(true);
    expect(breaker.getStatus('skill-a').state).toBe('half_open');
  });

  it('closes on successful probe in half_open', async () => {
    for (let i = 0; i < 3; i++) breaker.recordFailure('skill-a');
    await new Promise(r => setTimeout(r, 120));

    breaker.canExecute('skill-a'); // transitions to half_open
    breaker.recordSuccess('skill-a');

    expect(breaker.getStatus('skill-a').state).toBe('closed');
    expect(breaker.getStatus('skill-a').failures).toBe(0);
  });

  it('reopens on failed probe in half_open', async () => {
    for (let i = 0; i < 3; i++) breaker.recordFailure('skill-a');
    await new Promise(r => setTimeout(r, 120));

    breaker.canExecute('skill-a'); // transitions to half_open
    breaker.recordFailure('skill-a');

    expect(breaker.getStatus('skill-a').state).toBe('open');
  });

  // ── Independent tracking ─────────────────────────────────

  it('tracks skills independently', () => {
    for (let i = 0; i < 3; i++) breaker.recordFailure('skill-a');
    breaker.recordSuccess('skill-b');

    expect(breaker.getStatus('skill-a').state).toBe('open');
    expect(breaker.getStatus('skill-b').state).toBe('closed');
  });

  // ── Admin operations ─────────────────────────────────────

  it('manual reset closes an open circuit', () => {
    for (let i = 0; i < 3; i++) breaker.recordFailure('skill-a');
    expect(breaker.getStatus('skill-a').state).toBe('open');

    breaker.reset('skill-a');
    expect(breaker.getStatus('skill-a').state).toBe('closed');
    expect(breaker.canExecute('skill-a')).toBe(true);
  });

  it('getAll returns all circuits', () => {
    breaker.recordSuccess('skill-a');
    breaker.recordFailure('skill-b');

    const all = breaker.getAll();
    expect(all.length).toBe(2);
    expect(all.map(s => s.skillId).sort()).toEqual(['skill-a', 'skill-b']);
  });

  it('clear removes all circuits', () => {
    breaker.recordSuccess('skill-a');
    breaker.clear();
    expect(breaker.getAll().length).toBe(0);
  });

  it('tracks totalCalls correctly', () => {
    breaker.recordSuccess('skill-a');
    breaker.recordFailure('skill-a');
    breaker.recordSuccess('skill-a');
    expect(breaker.getStatus('skill-a').totalCalls).toBe(3);
  });

  it('lastFailureAt is set after a failure', () => {
    breaker.recordFailure('skill-a');
    expect(breaker.getStatus('skill-a').lastFailureAt).toBeTruthy();
  });

  it('lastFailureAt is null when no failures', () => {
    breaker.recordSuccess('skill-a');
    expect(breaker.getStatus('skill-a').lastFailureAt).toBeNull();
  });
});
