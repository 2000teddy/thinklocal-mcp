/**
 * budget-guard.test.ts — Tests fuer Budget Guard (Phase D2)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BudgetGuard } from './budget-guard.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('BudgetGuard', () => {
  let dataDir: string;
  let guard: BudgetGuard;

  const agent1 = 'spiffe://thinklocal/host/aaa/agent/claude-code';
  const agent2 = 'spiffe://thinklocal/host/bbb/agent/codex';

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'budget-test-'));
    guard = new BudgetGuard(dataDir, {
      maxTokensPerHour: 10_000,
      maxTokensPerDay: 50_000,
      softLimitRatio: 0.8,
    });
  });

  afterEach(() => {
    guard.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('reports usage and returns OK status', () => {
    const status = guard.report(agent1, { prompt_tokens: 100, completion_tokens: 50 });
    expect(status.status).toBe('ok');
    expect(status.tokens_last_hour).toBe(150);
    expect(status.agent_id).toBe(agent1);
  });

  it('accumulates usage across reports', () => {
    guard.report(agent1, { prompt_tokens: 100, completion_tokens: 50 });
    guard.report(agent1, { prompt_tokens: 200, completion_tokens: 100 });
    const status = guard.getStatus(agent1);
    expect(status.tokens_last_hour).toBe(450);
  });

  it('tracks agents independently', () => {
    guard.report(agent1, { prompt_tokens: 1000, completion_tokens: 500 });
    guard.report(agent2, { prompt_tokens: 200, completion_tokens: 100 });
    expect(guard.getStatus(agent1).tokens_last_hour).toBe(1500);
    expect(guard.getStatus(agent2).tokens_last_hour).toBe(300);
  });

  it('triggers soft limit at 80%', () => {
    // 80% of 10_000 = 8_000
    guard.report(agent1, { prompt_tokens: 5000, completion_tokens: 3500 });
    const status = guard.getStatus(agent1);
    expect(status.status).toBe('soft_limit');
    expect(status.message).toContain('⚠️');
  });

  it('triggers hard limit at 100%', () => {
    guard.report(agent1, { prompt_tokens: 6000, completion_tokens: 4500 });
    const status = guard.getStatus(agent1);
    expect(status.status).toBe('hard_limit');
    expect(status.message).toContain('❌');
  });

  it('isAllowed returns false when hard-limited', () => {
    guard.report(agent1, { prompt_tokens: 6000, completion_tokens: 5000 });
    expect(guard.isAllowed(agent1)).toBe(false);
  });

  it('isAllowed returns true when within budget', () => {
    guard.report(agent1, { prompt_tokens: 100, completion_tokens: 50 });
    expect(guard.isAllowed(agent1)).toBe(true);
  });

  it('isAllowed returns true for unknown agent', () => {
    expect(guard.isAllowed('unknown-agent')).toBe(true);
  });

  it('stores model info', () => {
    guard.report(agent1, {
      prompt_tokens: 100,
      completion_tokens: 50,
      model: 'claude-opus-4',
    });
    // Model is stored but not exposed in status (it's for analytics)
    const status = guard.getStatus(agent1);
    expect(status.tokens_last_hour).toBe(150);
  });

  it('returns correct limits in status', () => {
    const status = guard.getStatus(agent1);
    expect(status.limit_hour).toBe(10_000);
    expect(status.limit_day).toBe(50_000);
    expect(status.soft_limit_hour).toBe(8_000);
    expect(status.soft_limit_day).toBe(40_000);
  });

  it('prune removes old records', () => {
    // Insert a record with an old timestamp
    guard.report(agent1, {
      prompt_tokens: 100,
      completion_tokens: 50,
      timestamp: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
    });
    guard.report(agent1, { prompt_tokens: 200, completion_tokens: 100 });

    const pruned = guard.prune();
    expect(pruned).toBe(1);

    // Only the recent record remains
    const status = guard.getStatus(agent1);
    expect(status.tokens_last_day).toBe(300);
  });
});
