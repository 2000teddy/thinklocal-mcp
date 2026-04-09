/**
 * ADR-006 Phase 1 — Session Event Store
 *
 * SQLite-backed append-only event store that is the single
 * canonical source of truth for what happened in an agent session.
 * The Markdown derived-views (HISTORY.md, START-PROMPT.md) are
 * regenerated from this table, so any Markdown corruption /
 * hallucination is recoverable.
 *
 * One table, WAL mode, synchronous=NORMAL. Events are uniqued per
 * (instance_uuid, seq) so replaying the same native session file
 * from a stored byte offset is idempotent.
 *
 * See: docs/architecture/ADR-006-session-persistence.md §Architektur/3
 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

export type SessionEventType =
  | 'user_message'
  | 'assistant_message'
  | 'tool_call'
  | 'tool_result'
  | 'system';

export interface SessionEventInput {
  instanceUuid: string;
  seq: number;
  timestamp: string; // ISO 8601
  eventType: SessionEventType;
  payload: unknown;
  adapterVersion: string;
}

export interface SessionEventRow {
  id: number;
  instance_uuid: string;
  seq: number;
  timestamp: string;
  event_type: SessionEventType;
  content_hash: string;
  payload: string; // JSON
  adapter_version: string;
}

export interface SessionEventsStoreOptions {
  /** Base data dir (~/.thinklocal). Schema is placed at `<dataDir>/sessions/events.db`. */
  dataDir: string;
  /** Test-only: override the database file path directly. */
  dbPathOverride?: string;
}

/** DDL version stored in `PRAGMA user_version` for forward migrations. */
const SCHEMA_VERSION = 1;

/**
 * Canonical hash over the logical event identity. Used for
 * idempotent inserts — if the same event is parsed twice, the
 * content hash lets the caller detect it without relying on the
 * AUTOINCREMENT id.
 */
function computeContentHash(input: SessionEventInput): string {
  const canonical = JSON.stringify({
    i: input.instanceUuid,
    s: input.seq,
    t: input.timestamp,
    e: input.eventType,
    p: input.payload,
    v: input.adapterVersion,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export class SessionEventsStore {
  private readonly db: Database.Database;
  private readonly insertStmt: Database.Statement;
  private readonly selectByInstanceStmt: Database.Statement;
  private readonly latestSeqStmt: Database.Statement;
  private readonly countStmt: Database.Statement;

  constructor(opts: SessionEventsStoreOptions) {
    const dbPath =
      opts.dbPathOverride ?? resolve(opts.dataDir, 'sessions', 'events.db');
    if (!opts.dbPathOverride) {
      mkdirSync(resolve(opts.dataDir, 'sessions'), { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.migrate();

    this.insertStmt = this.db.prepare(
      `INSERT OR IGNORE INTO session_events
       (instance_uuid, seq, timestamp, event_type, content_hash, payload, adapter_version)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    this.selectByInstanceStmt = this.db.prepare(
      `SELECT * FROM session_events WHERE instance_uuid = ? ORDER BY seq ASC LIMIT ?`,
    );
    this.latestSeqStmt = this.db.prepare(
      `SELECT MAX(seq) AS max_seq FROM session_events WHERE instance_uuid = ?`,
    );
    this.countStmt = this.db.prepare(
      `SELECT COUNT(*) AS n FROM session_events WHERE instance_uuid = ?`,
    );
  }

  private migrate(): void {
    const current = (this.db.pragma('user_version', { simple: true }) as number) ?? 0;
    if (current < 1) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS session_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          instance_uuid TEXT NOT NULL,
          seq INTEGER NOT NULL,
          timestamp TEXT NOT NULL,
          event_type TEXT NOT NULL,
          content_hash TEXT NOT NULL,
          payload TEXT NOT NULL,
          adapter_version TEXT NOT NULL,
          UNIQUE(instance_uuid, seq)
        );
        CREATE INDEX IF NOT EXISTS idx_session_events_instance
          ON session_events(instance_uuid, seq);
        CREATE INDEX IF NOT EXISTS idx_session_events_hash
          ON session_events(content_hash);
      `);
      this.db.pragma(`user_version = ${SCHEMA_VERSION}`);
    }
  }

  /**
   * Append a new event. Idempotent — if an event with the same
   * `(instance_uuid, seq)` already exists, the insert is a no-op.
   * Returns `true` when a new row was actually inserted.
   */
  append(input: SessionEventInput): boolean {
    const contentHash = computeContentHash(input);
    const info = this.insertStmt.run(
      input.instanceUuid,
      input.seq,
      input.timestamp,
      input.eventType,
      contentHash,
      JSON.stringify(input.payload),
      input.adapterVersion,
    );
    return info.changes > 0;
  }

  /** Max seq observed for a given instance, or -1 if empty. */
  latestSeq(instanceUuid: string): number {
    const row = this.latestSeqStmt.get(instanceUuid) as
      | { max_seq: number | null }
      | undefined;
    return row?.max_seq ?? -1;
  }

  /** Number of events stored for a given instance. */
  count(instanceUuid: string): number {
    const row = this.countStmt.get(instanceUuid) as { n: number };
    return row.n;
  }

  /** Chronological list of events for an instance. */
  list(instanceUuid: string, limit = 10_000): SessionEventRow[] {
    return this.selectByInstanceStmt.all(instanceUuid, limit) as SessionEventRow[];
  }

  close(): void {
    this.db.close();
  }
}
