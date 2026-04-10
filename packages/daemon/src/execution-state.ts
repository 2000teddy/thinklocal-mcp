/**
 * ADR-009 Phase C PR C1 — Execution State
 *
 * Tracks the lifecycle of distributed executions (task requests,
 * skill executions, message-reply workflows) with a clear
 * state machine:
 *
 *   accepted → running → completed | failed | aborted
 *
 * Every execution gets a unique ID. Transport retries keep the
 * same execution_id (idempotent delivery), while deliberate
 * re-runs get a new ID.
 *
 * This is a local read-model — each node tracks its own view
 * of executions it initiated or received. Cross-node consistency
 * is achieved through the existing TASK_REQUEST/TASK_RESULT
 * message types that carry the execution_id.
 *
 * Inspired by Paperclip's heartbeat_runs + agentTaskSessions
 * but adapted for decentralised, eventual-consistency semantics.
 *
 * See: docs/ROADMAP-POST-PAPERCLIP.md Phase C PR C1
 */
import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';

export type ExecutionLifecycleState =
  | 'accepted'
  | 'running'
  | 'completed'
  | 'failed'
  | 'aborted';

export type ExecutionType =
  | 'task_request'
  | 'skill_execute'
  | 'message_reply';

export interface ExecutionStateRow {
  execution_id: string;
  instance_uuid: string;
  message_id: string | null;
  lifecycle_state: ExecutionLifecycleState;
  execution_type: ExecutionType | null;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
  metadata_json: string | null;
}

export class ExecutionStateStore {
  private readonly db: Database.Database;
  private readonly log?: Logger;

  constructor(dataDir: string, log?: Logger) {
    const dir = resolve(dataDir, 'executions');
    mkdirSync(dir, { recursive: true });
    this.db = new Database(resolve(dir, 'execution-state.db'));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.log = log;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS execution_state (
        execution_id TEXT PRIMARY KEY,
        instance_uuid TEXT NOT NULL,
        message_id TEXT,
        lifecycle_state TEXT NOT NULL DEFAULT 'accepted'
          CHECK(lifecycle_state IN ('accepted','running','completed','failed','aborted')),
        execution_type TEXT,
        started_at TEXT,
        completed_at TEXT,
        updated_at TEXT NOT NULL,
        metadata_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_exec_instance ON execution_state (instance_uuid);
      CREATE INDEX IF NOT EXISTS idx_exec_state ON execution_state (lifecycle_state);
    `);
  }

  /** Create a new execution in `accepted` state. Returns the execution_id. */
  create(
    instanceUuid: string,
    executionType?: ExecutionType,
    messageId?: string,
  ): string {
    const executionId = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO execution_state (execution_id, instance_uuid, message_id, lifecycle_state, execution_type, started_at, updated_at)
         VALUES (?, ?, ?, 'accepted', ?, ?, ?)`,
      )
      .run(executionId, instanceUuid, messageId ?? null, executionType ?? null, now, now);
    this.log?.debug({ executionId, instanceUuid, executionType }, '[execution] created');
    return executionId;
  }

  /** Transition to a new lifecycle state. Returns true if the transition was valid. */
  transition(executionId: string, newState: ExecutionLifecycleState): boolean {
    const current = this.get(executionId);
    if (!current) return false;

    // Valid transitions:
    // accepted → running
    // running → completed | failed | aborted
    // accepted → aborted (cancel before start)
    const valid: Record<string, ExecutionLifecycleState[]> = {
      accepted: ['running', 'aborted'],
      running: ['completed', 'failed', 'aborted'],
    };
    if (!(valid[current.lifecycle_state] ?? []).includes(newState)) {
      return false;
    }

    const now = new Date().toISOString();
    const completedAt =
      newState === 'completed' || newState === 'failed' || newState === 'aborted'
        ? now
        : null;
    // Atomic WHERE guard: include old state so concurrent transitions
    // don't corrupt the state machine. (Gemini-Pro retroactive CR HIGH: TOCTOU)
    const info = this.db
      .prepare(
        `UPDATE execution_state SET lifecycle_state = ?, completed_at = COALESCE(?, completed_at), updated_at = ? WHERE execution_id = ? AND lifecycle_state = ?`,
      )
      .run(newState, completedAt, now, executionId, current.lifecycle_state);
    if (info.changes > 0) {
      this.log?.debug({ executionId, from: current.lifecycle_state, to: newState }, '[execution] transitioned');
    }
    return info.changes > 0;
  }

  /** Get a single execution by id. */
  get(executionId: string): ExecutionStateRow | null {
    return (
      this.db.prepare('SELECT * FROM execution_state WHERE execution_id = ?').get(executionId) as
        | ExecutionStateRow
        | undefined
    ) ?? null;
  }

  /** List executions for an instance, optionally filtered by state. */
  listByInstance(
    instanceUuid: string,
    state?: ExecutionLifecycleState,
    limit = 50,
  ): ExecutionStateRow[] {
    if (state) {
      return this.db
        .prepare(
          'SELECT * FROM execution_state WHERE instance_uuid = ? AND lifecycle_state = ? ORDER BY updated_at DESC LIMIT ?',
        )
        .all(instanceUuid, state, limit) as ExecutionStateRow[];
    }
    return this.db
      .prepare(
        'SELECT * FROM execution_state WHERE instance_uuid = ? ORDER BY updated_at DESC LIMIT ?',
      )
      .all(instanceUuid, limit) as ExecutionStateRow[];
  }

  /** Count executions by state (dashboard overview). */
  countByState(): Record<ExecutionLifecycleState, number> {
    const rows = this.db
      .prepare(
        'SELECT lifecycle_state, COUNT(*) as n FROM execution_state GROUP BY lifecycle_state',
      )
      .all() as Array<{ lifecycle_state: ExecutionLifecycleState; n: number }>;
    const counts: Record<ExecutionLifecycleState, number> = {
      accepted: 0,
      running: 0,
      completed: 0,
      failed: 0,
      aborted: 0,
    };
    for (const row of rows) {
      counts[row.lifecycle_state] = row.n;
    }
    return counts;
  }

  close(): void {
    this.db.close();
  }
}
