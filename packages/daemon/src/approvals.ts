/**
 * ADR-007 Phase A PR A3 — Approval Gates
 *
 * Generic approval service for operations that require human
 * confirmation before proceeding. First use case: Peer-Join
 * (SPAKE2 pairing + SSH bootstrap). Future use cases: sensitive
 * skill activation, credential sharing, config changes.
 *
 * Status flow:
 *   pending → approved  (user accepted)
 *   pending → rejected  (user denied)
 *
 * Only `pending` approvals can be decided. Re-deciding a settled
 * approval is a no-op (idempotent, returns the existing decision).
 *
 * Inspired by Paperclip's `approvals` table but adapted for
 * thinklocal's decentralised model: no centralised "decidedByUserId",
 * instead we track the local daemon's decision and optionally audit
 * it via the entity-model audit log (PR A1).
 *
 * See: docs/ROADMAP-POST-PAPERCLIP.md Phase A PR A3
 * See: BORG.md §2 Step 4
 */
import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';

export type ApprovalType = 'peer_join' | 'skill_activate' | 'credential_share' | 'config_change';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface ApprovalRow {
  id: string; // UUIDv4
  type: ApprovalType;
  status: ApprovalStatus;
  /** JSON payload with context-specific data (peer info, skill manifest, etc). */
  payload_json: string;
  /** Human-readable summary for CLI/Dashboard display. */
  summary: string;
  /** ISO 8601 timestamp of creation. */
  created_at: string;
  /** ISO 8601 timestamp of decision (null while pending). */
  decided_at: string | null;
  /** Optional note from the user explaining their decision. */
  decision_note: string | null;
}

export interface CreateApprovalInput {
  type: ApprovalType;
  payload: unknown;
  summary: string;
}

export class ApprovalService {
  private readonly db: Database.Database;
  private readonly log?: Logger;

  constructor(dataDir: string, log?: Logger) {
    const dir = resolve(dataDir, 'approvals');
    mkdirSync(dir, { recursive: true });
    const dbPath = resolve(dir, 'approvals.db');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.log = log;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        payload_json TEXT NOT NULL,
        summary TEXT NOT NULL,
        created_at TEXT NOT NULL,
        decided_at TEXT,
        decision_note TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals (status);
      CREATE INDEX IF NOT EXISTS idx_approvals_type ON approvals (type, status);
    `);
  }

  /**
   * Create a new approval request. Returns the generated id.
   * The approval starts in `pending` state and must be decided
   * via `decide()` before the gated operation can proceed.
   */
  create(input: CreateApprovalInput): string {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO approvals (id, type, status, payload_json, summary, created_at)
         VALUES (?, ?, 'pending', ?, ?, ?)`,
      )
      .run(id, input.type, JSON.stringify(input.payload), input.summary, now);
    this.log?.info(
      { id, type: input.type, summary: input.summary },
      '[approvals] created',
    );
    return id;
  }

  /**
   * Decide a pending approval. Returns the updated row, or `null`
   * if the approval was not found. If already decided, returns the
   * existing decision without overwriting (idempotent).
   */
  decide(
    id: string,
    status: 'approved' | 'rejected',
    note?: string,
  ): ApprovalRow | null {
    const existing = this.get(id);
    if (!existing) return null;
    if (existing.status !== 'pending') {
      // Already decided — return as-is (idempotent).
      this.log?.debug(
        { id, existing_status: existing.status },
        '[approvals] already decided, returning existing',
      );
      return existing;
    }
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE approvals SET status = ?, decided_at = ?, decision_note = ? WHERE id = ? AND status = 'pending'`,
      )
      .run(status, now, note ?? null, id);
    this.log?.info({ id, status, note }, '[approvals] decided');
    return this.get(id);
  }

  /** Get a single approval by id. */
  get(id: string): ApprovalRow | null {
    return (
      this.db.prepare('SELECT * FROM approvals WHERE id = ?').get(id) as
        | ApprovalRow
        | undefined
    ) ?? null;
  }

  /** List approvals, optionally filtered by status and/or type. */
  list(opts?: {
    status?: ApprovalStatus;
    type?: ApprovalType;
    limit?: number;
  }): ApprovalRow[] {
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    if (opts?.status) {
      clauses.push('status = ?');
      params.push(opts.status);
    }
    if (opts?.type) {
      clauses.push('type = ?');
      params.push(opts.type);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = opts?.limit ?? 50;
    params.push(limit);
    return this.db
      .prepare(`SELECT * FROM approvals ${where} ORDER BY created_at DESC LIMIT ?`)
      .all(...params) as ApprovalRow[];
  }

  /** Count pending approvals (useful for dashboard badge). */
  pendingCount(type?: ApprovalType): number {
    if (type) {
      return (
        this.db
          .prepare(
            'SELECT COUNT(*) as n FROM approvals WHERE status = ? AND type = ?',
          )
          .get('pending', type) as { n: number }
      ).n;
    }
    return (
      this.db
        .prepare('SELECT COUNT(*) as n FROM approvals WHERE status = ?')
        .get('pending') as { n: number }
    ).n;
  }

  /** Check if a specific approval has been approved. Convenience. */
  isApproved(id: string): boolean {
    const row = this.get(id);
    return row?.status === 'approved';
  }

  close(): void {
    this.db.close();
  }
}
