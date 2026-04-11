/**
 * session-checkout.ts — Atomic Session-Checkout (Phase D1)
 *
 * Prevents two agents from working on the same git branch simultaneously.
 * Uses a SQLite-backed lock table with automatic expiry.
 *
 * Flow:
 * 1. Agent calls `checkout(branch, agentId)` before starting work
 * 2. If the branch is free → lock acquired, returns { ok: true }
 * 3. If the branch is locked by another agent → returns { ok: false, holder }
 * 4. If the branch is locked by the same agent → idempotent success
 * 5. Agent calls `release(branch, agentId)` when done
 * 6. Stale locks auto-expire after `maxLockDurationMs` (default: 2h)
 *
 * This prevents the "two agents editing the same files" collision that
 * causes git merge conflicts and wasted context budget.
 */

import Database from 'better-sqlite3';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

export interface CheckoutResult {
  ok: boolean;
  branch: string;
  holder?: string;
  locked_at?: string;
  expires_at?: string;
}

export interface CheckoutLock {
  branch: string;
  agent_id: string;
  locked_at: string;
  expires_at: string;
  purpose?: string;
}

export interface SessionCheckoutOptions {
  dataDir: string;
  /** Max lock duration in ms. Default: 2 hours */
  maxLockDurationMs?: number;
}

export class SessionCheckout {
  private db: Database.Database;
  private maxLockDurationMs: number;

  constructor(opts: SessionCheckoutOptions) {
    this.maxLockDurationMs = opts.maxLockDurationMs ?? 2 * 60 * 60 * 1000; // 2h

    const dir = join(opts.dataDir, 'sessions');
    mkdirSync(dir, { recursive: true });

    this.db = new Database(join(dir, 'checkout.db'));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 3000');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS branch_locks (
        branch TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        locked_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        purpose TEXT
      )
    `);
  }

  /**
   * Attempt to acquire a lock on a branch.
   * Idempotent: if the same agent already holds the lock, returns ok.
   * Automatically evicts expired locks.
   */
  checkout(branch: string, agentId: string, purpose?: string): CheckoutResult {
    // Evict expired locks first
    this.evictExpired();

    const existing = this.db
      .prepare('SELECT * FROM branch_locks WHERE branch = ?')
      .get(branch) as CheckoutLock | undefined;

    if (existing) {
      // Same agent → idempotent success, refresh expiry
      if (existing.agent_id === agentId) {
        const expiresAt = new Date(Date.now() + this.maxLockDurationMs).toISOString();
        this.db
          .prepare('UPDATE branch_locks SET expires_at = ?, purpose = COALESCE(?, purpose) WHERE branch = ?')
          .run(expiresAt, purpose ?? null, branch);
        return {
          ok: true,
          branch,
          holder: agentId,
          locked_at: existing.locked_at,
          expires_at: expiresAt,
        };
      }

      // Different agent → denied
      return {
        ok: false,
        branch,
        holder: existing.agent_id,
        locked_at: existing.locked_at,
        expires_at: existing.expires_at,
      };
    }

    // Branch is free → acquire lock
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + this.maxLockDurationMs).toISOString();

    this.db
      .prepare('INSERT INTO branch_locks (branch, agent_id, locked_at, expires_at, purpose) VALUES (?, ?, ?, ?, ?)')
      .run(branch, agentId, now, expiresAt, purpose ?? null);

    return { ok: true, branch, holder: agentId, locked_at: now, expires_at: expiresAt };
  }

  /**
   * Release a branch lock. Only the holder can release.
   * Returns true if the lock was released, false if not held or held by another.
   */
  release(branch: string, agentId: string): boolean {
    const result = this.db
      .prepare('DELETE FROM branch_locks WHERE branch = ? AND agent_id = ?')
      .run(branch, agentId);
    return result.changes > 0;
  }

  /**
   * Force-release a branch lock (admin operation).
   */
  forceRelease(branch: string): boolean {
    const result = this.db
      .prepare('DELETE FROM branch_locks WHERE branch = ?')
      .run(branch);
    return result.changes > 0;
  }

  /**
   * List all active locks.
   */
  listLocks(): CheckoutLock[] {
    this.evictExpired();
    return this.db
      .prepare('SELECT * FROM branch_locks ORDER BY locked_at DESC')
      .all() as CheckoutLock[];
  }

  /**
   * Check if a specific branch is locked.
   */
  isLocked(branch: string): CheckoutLock | null {
    this.evictExpired();
    return (
      this.db
        .prepare('SELECT * FROM branch_locks WHERE branch = ?')
        .get(branch) as CheckoutLock | undefined
    ) ?? null;
  }

  /**
   * Evict all expired locks.
   */
  private evictExpired(): number {
    const now = new Date().toISOString();
    const result = this.db
      .prepare('DELETE FROM branch_locks WHERE expires_at < ?')
      .run(now);
    return result.changes;
  }

  close(): void {
    this.db.close();
  }
}
