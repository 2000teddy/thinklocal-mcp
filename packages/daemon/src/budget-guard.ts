/**
 * budget-guard.ts — Token/Cost Budget Guard (Phase D2)
 *
 * Tracks token usage per agent and enforces budget limits.
 * Prevents runaway costs when agents loop or hallucinate.
 *
 * Features:
 * - Per-agent token counters (prompt + completion)
 * - Configurable budget limits (per-hour, per-day, per-session)
 * - Soft limit (warning) and hard limit (block)
 * - SQLite-backed for persistence across restarts
 * - Auto-reset on time window expiry
 *
 * The guard does NOT talk to any API — it tracks locally reported usage.
 * Agents report their token consumption via POST /api/budget/report.
 */

import Database from 'better-sqlite3';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

export interface BudgetConfig {
  /** Max tokens per hour (0 = unlimited). Default: 500_000 */
  maxTokensPerHour?: number;
  /** Max tokens per day (0 = unlimited). Default: 5_000_000 */
  maxTokensPerDay?: number;
  /** Soft limit percentage (0-1). Default: 0.8 (80%) */
  softLimitRatio?: number;
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  model?: string;
  timestamp?: string;
}

export interface BudgetStatus {
  agent_id: string;
  tokens_last_hour: number;
  tokens_last_day: number;
  limit_hour: number;
  limit_day: number;
  soft_limit_hour: number;
  soft_limit_day: number;
  status: 'ok' | 'soft_limit' | 'hard_limit';
  message: string;
}

export class BudgetGuard {
  private db: Database.Database;
  private config: Required<BudgetConfig>;

  constructor(dataDir: string, config?: BudgetConfig) {
    this.config = {
      maxTokensPerHour: config?.maxTokensPerHour ?? 500_000,
      maxTokensPerDay: config?.maxTokensPerDay ?? 5_000_000,
      softLimitRatio: config?.softLimitRatio ?? 0.8,
    };

    const dir = join(dataDir, 'budget');
    mkdirSync(dir, { recursive: true });

    this.db = new Database(join(dir, 'usage.db'));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 3000');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS token_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        prompt_tokens INTEGER NOT NULL,
        completion_tokens INTEGER NOT NULL,
        total_tokens INTEGER NOT NULL,
        model TEXT,
        timestamp TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_usage_agent_time
        ON token_usage (agent_id, timestamp);
    `);
  }

  /**
   * Report token usage for an agent.
   * Returns the updated budget status (may include warnings).
   */
  report(agentId: string, usage: TokenUsage): BudgetStatus {
    const total = usage.prompt_tokens + usage.completion_tokens;
    const ts = usage.timestamp ?? new Date().toISOString();

    this.db
      .prepare(
        'INSERT INTO token_usage (agent_id, prompt_tokens, completion_tokens, total_tokens, model, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(agentId, usage.prompt_tokens, usage.completion_tokens, total, usage.model ?? null, ts);

    return this.getStatus(agentId);
  }

  /**
   * Get budget status for an agent.
   */
  getStatus(agentId: string): BudgetStatus {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const hourRow = this.db
      .prepare(
        'SELECT COALESCE(SUM(total_tokens), 0) as total FROM token_usage WHERE agent_id = ? AND timestamp > ?',
      )
      .get(agentId, oneHourAgo) as { total: number };

    const dayRow = this.db
      .prepare(
        'SELECT COALESCE(SUM(total_tokens), 0) as total FROM token_usage WHERE agent_id = ? AND timestamp > ?',
      )
      .get(agentId, oneDayAgo) as { total: number };

    const tokensHour = hourRow.total;
    const tokensDay = dayRow.total;

    const { maxTokensPerHour, maxTokensPerDay, softLimitRatio } = this.config;
    const softHour = Math.floor(maxTokensPerHour * softLimitRatio);
    const softDay = Math.floor(maxTokensPerDay * softLimitRatio);

    // Determine status
    let status: BudgetStatus['status'] = 'ok';
    let message = '✅ Budget OK';

    if (
      (maxTokensPerHour > 0 && tokensHour >= maxTokensPerHour) ||
      (maxTokensPerDay > 0 && tokensDay >= maxTokensPerDay)
    ) {
      status = 'hard_limit';
      message = `❌ Budget exceeded: ${tokensHour.toLocaleString()} tokens/h (limit: ${maxTokensPerHour.toLocaleString()}), ${tokensDay.toLocaleString()} tokens/day (limit: ${maxTokensPerDay.toLocaleString()})`;
    } else if (
      (maxTokensPerHour > 0 && tokensHour >= softHour) ||
      (maxTokensPerDay > 0 && tokensDay >= softDay)
    ) {
      status = 'soft_limit';
      message = `⚠️ Approaching budget limit: ${tokensHour.toLocaleString()} tokens/h (soft: ${softHour.toLocaleString()}), ${tokensDay.toLocaleString()} tokens/day (soft: ${softDay.toLocaleString()})`;
    }

    return {
      agent_id: agentId,
      tokens_last_hour: tokensHour,
      tokens_last_day: tokensDay,
      limit_hour: maxTokensPerHour,
      limit_day: maxTokensPerDay,
      soft_limit_hour: softHour,
      soft_limit_day: softDay,
      status,
      message,
    };
  }

  /**
   * Check if an agent is within budget (not hard-limited).
   */
  isAllowed(agentId: string): boolean {
    return this.getStatus(agentId).status !== 'hard_limit';
  }

  /**
   * Prune old usage records (older than 7 days).
   */
  prune(): number {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const result = this.db
      .prepare('DELETE FROM token_usage WHERE timestamp < ?')
      .run(cutoff);
    return result.changes;
  }

  close(): void {
    this.db.close();
  }
}
