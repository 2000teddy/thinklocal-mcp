/**
 * agent-inbox.ts — Persistenter Nachrichten-Briefkasten fuer Agent-to-Agent
 * Kommunikation ueber das ThinkLocal Mesh.
 *
 * Jede empfangene AgentMessagePayload wird in einer SQLite-Tabelle
 * (~/.thinklocal/inbox/inbox.db) persistiert. MCP-Tools stellen die Inbox
 * ueber send_message_to_peer / read_inbox / mark_message_read bereit,
 * sodass Agenten wie Claude Code und Codex OHNE menschlichen Vermittler
 * ueber das Mesh kommunizieren koennen.
 *
 * Design-Entscheidungen:
 * - SQLite mit WAL (bereits als Dependency via better-sqlite3).
 * - Append-only fuer eingehende Nachrichten; "read"/"archived" sind Flags,
 *   nicht DELETE, damit Audit-Log und Replay moeglich bleiben.
 * - 64 KB Size-Limit pro Nachricht (in Bytes nach JSON.stringify).
 * - Message-ID Dedupe: gleicher message_id wird nur einmal akzeptiert.
 * - Bounce-Protection: wenn Sender nicht im PairingStore ist, wird die
 *   Nachricht mit status=rejected abgewiesen (Reason: "untrusted sender").
 */

import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { Logger } from 'pino';
import type { AgentMessagePayload } from './messages.js';
import { getAgentInstance, normalizeAgentId } from './spiffe-uri.js';

const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_SUBJECT_LENGTH = 200;

/**
 * Current schema version. Bumped whenever the SQLite DDL changes.
 * Stored in `PRAGMA user_version` so re-opens detect and migrate.
 *
 *   v1 (pre-ADR-005): messages table without `to_agent_instance`
 *   v2 (ADR-005):     adds `to_agent_instance TEXT NULL` + index for
 *                     per-agent-instance routing
 */
const CURRENT_SCHEMA_VERSION = 2;

export interface InboxMessage {
  id: number;
  message_id: string;
  from_agent: string;
  to_agent: string;
  /**
   * ADR-005: the 4-component instance tail that the sender targeted,
   * or NULL for legacy rows (pre-migration) and for broadcasts that
   * used the 3-component daemon URI.
   */
  to_agent_instance: string | null;
  subject: string | null;
  body: string;
  in_reply_to: string | null;
  sent_at: string;
  received_at: string;
  read_at: string | null;
  archived: number;
}

export interface StoreResult {
  status: 'delivered' | 'duplicate' | 'rejected';
  reason?: string;
  inbox_id?: number;
}

export class AgentInbox {
  private db: Database.Database;

  constructor(
    dataDir: string,
    private log?: Logger,
  ) {
    const inboxDir = resolve(dataDir, 'inbox');
    mkdirSync(inboxDir, { recursive: true });
    const dbPath = resolve(inboxDir, 'inbox.db');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.init();
    this.log?.info({ dbPath }, 'AgentInbox initialisiert');
  }

  /**
   * Initialise the schema, creating a fresh v2 db from scratch or
   * running forward-migrations on an existing one. (Gemini-Pro CR
   * finding 2026-04-09, MEDIUM — cleaner separation than the old
   * "create v1 then ALTER" flow.)
   */
  private init(): void {
    const existingTables = this.db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='messages'`)
      .all() as Array<{ name: string }>;
    const hasTable = existingTables.length > 0;

    if (!hasTable) {
      this.createSchemaV2();
    } else {
      const currentVersion =
        (this.db.pragma('user_version', { simple: true }) as number) ?? 0;
      if (currentVersion < 2) {
        this.migrateToV2();
      }
    }
    this.db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`);
  }

  /** Create a pristine v2 schema (fresh database case). */
  private createSchemaV2(): void {
    this.db.exec(`
      CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT NOT NULL UNIQUE,
        from_agent TEXT NOT NULL,
        to_agent TEXT NOT NULL,
        to_agent_instance TEXT,
        subject TEXT,
        body TEXT NOT NULL,
        in_reply_to TEXT,
        sent_at TEXT NOT NULL,
        received_at TEXT NOT NULL,
        read_at TEXT,
        archived INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_messages_unread
        ON messages (read_at, archived) WHERE read_at IS NULL AND archived = 0;
      CREATE INDEX idx_messages_from ON messages (from_agent);
      CREATE INDEX idx_messages_sent_at ON messages (sent_at DESC);
      CREATE INDEX idx_messages_instance ON messages (to_agent_instance);
    `);
    this.log?.info({ schemaVersion: 2 }, '[agent-inbox] fresh db created at v2');
  }

  /**
   * ADR-005 migration: add `to_agent_instance` column + index on
   * an existing v1 database. Idempotent — if the column already
   * exists (e.g. partial migration) we only rebuild the index.
   */
  private migrateToV2(): void {
    const columns = this.db
      .prepare(`PRAGMA table_info(messages)`)
      .all() as Array<{ name: string }>;
    const hasColumn = columns.some((c) => c.name === 'to_agent_instance');
    if (!hasColumn) {
      this.db.exec(`ALTER TABLE messages ADD COLUMN to_agent_instance TEXT`);
      this.log?.info(
        { from: 1, to: 2 },
        '[agent-inbox] migrated schema: added to_agent_instance column',
      );
    }
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_messages_instance ON messages (to_agent_instance)`,
    );
  }

  /**
   * Speichert eine eingehende Nachricht.
   *
   * @param fromAgent Absender-SPIFFE-URI (bereits signatur-verifiziert durch agent-card.ts)
   * @param payload Die entschluesselte Payload
   * @returns delivered | duplicate | rejected mit Begruendung
   */
  store(fromAgent: string, payload: AgentMessagePayload): StoreResult {
    // Size-Limit
    const bodyStr =
      typeof payload.body === 'string' ? payload.body : JSON.stringify(payload.body);
    if (Buffer.byteLength(bodyStr, 'utf-8') > MAX_MESSAGE_BYTES) {
      this.log?.warn(
        { fromAgent, message_id: payload.message_id, bytes: Buffer.byteLength(bodyStr) },
        'Nachricht zu gross, abgelehnt',
      );
      return { status: 'rejected', reason: `body exceeds ${MAX_MESSAGE_BYTES} bytes` };
    }

    // Subject-Limit
    if (payload.subject && payload.subject.length > MAX_SUBJECT_LENGTH) {
      return {
        status: 'rejected',
        reason: `subject exceeds ${MAX_SUBJECT_LENGTH} chars`,
      };
    }

    // Message-ID Format (UUID v4-ish, aber wir sind pragmatisch)
    if (!payload.message_id || typeof payload.message_id !== 'string') {
      return { status: 'rejected', reason: 'missing message_id' };
    }

    // Dedupe
    const existing = this.db
      .prepare('SELECT id FROM messages WHERE message_id = ?')
      .get(payload.message_id) as { id: number } | undefined;
    if (existing) {
      return { status: 'duplicate', inbox_id: existing.id };
    }

    // ADR-005: extract the per-instance routing tail (if present).
    // `to_agent` is stored in its normalised (3-component) form so
    // legacy queries keep working; the instance tail lives in its
    // own column. We fail closed on malformed input — a bad payload
    // with a non-parseable `to` is rejected rather than silently
    // stripped.
    let normalizedTo: string;
    let toInstance: string | null;
    try {
      normalizedTo = normalizeAgentId(payload.to);
      toInstance = getAgentInstance(payload.to) ?? null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { status: 'rejected', reason: `invalid target URI: ${msg}` };
    }

    const receivedAt = new Date().toISOString();
    const info = this.db
      .prepare(
        `INSERT INTO messages
         (message_id, from_agent, to_agent, to_agent_instance, subject, body, in_reply_to, sent_at, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        payload.message_id,
        fromAgent,
        normalizedTo,
        toInstance,
        payload.subject ?? null,
        bodyStr,
        payload.in_reply_to ?? null,
        payload.sent_at,
        receivedAt,
      );

    this.log?.info(
      {
        fromAgent,
        message_id: payload.message_id,
        subject: payload.subject,
        to_instance: toInstance,
      },
      'Nachricht empfangen und gespeichert',
    );
    return { status: 'delivered', inbox_id: info.lastInsertRowid as number };
  }

  /**
   * Liest Nachrichten aus der Inbox.
   *
   * @param opts.unreadOnly Nur ungelesene
   * @param opts.fromAgent Filter nach Absender
   * @param opts.limit Max Anzahl
   * @param opts.includeArchived Auch archivierte
   * @param opts.forInstance  ADR-005: filter to messages addressed to a
   *   specific agent-instance. When set, only rows with
   *   `to_agent_instance = <value>` are returned; legacy rows
   *   (`to_agent_instance IS NULL`) are included iff `includeLegacy`
   *   is also true. When `forInstance` is omitted, all rows match
   *   (back-compat with pre-ADR-005 callers).
   * @param opts.includeLegacy  ADR-005: include pre-migration rows
   *   (`to_agent_instance IS NULL`) in the result. Defaults to `true`
   *   when `forInstance` is unset (back-compat), and `false` when
   *   `forInstance` is set (strict per-instance isolation).
   */
  list(opts?: {
    unreadOnly?: boolean;
    fromAgent?: string;
    limit?: number;
    includeArchived?: boolean;
    forInstance?: string;
    includeLegacy?: boolean;
  }): InboxMessage[] {
    const limit = opts?.limit ?? 50;
    const clauses: string[] = [];
    const params: Array<string | number> = [];

    if (!opts?.includeArchived) {
      clauses.push('archived = 0');
    }
    if (opts?.unreadOnly) {
      clauses.push('read_at IS NULL');
    }
    if (opts?.fromAgent) {
      clauses.push('from_agent = ?');
      params.push(opts.fromAgent);
    }
    // ADR-005: per-instance filter.
    if (opts?.forInstance) {
      const includeLegacy = opts.includeLegacy ?? false;
      if (includeLegacy) {
        clauses.push('(to_agent_instance = ? OR to_agent_instance IS NULL)');
      } else {
        clauses.push('to_agent_instance = ?');
      }
      params.push(opts.forInstance);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const sql = `SELECT * FROM messages ${where} ORDER BY received_at DESC LIMIT ?`;
    params.push(limit);

    return this.db.prepare(sql).all(...params) as InboxMessage[];
  }

  /** Markiert eine Nachricht als gelesen. */
  markRead(messageId: string): boolean {
    const info = this.db
      .prepare('UPDATE messages SET read_at = ? WHERE message_id = ? AND read_at IS NULL')
      .run(new Date().toISOString(), messageId);
    return info.changes > 0;
  }

  /** Archiviert eine Nachricht (soft delete). */
  archive(messageId: string): boolean {
    const info = this.db
      .prepare('UPDATE messages SET archived = 1 WHERE message_id = ?')
      .run(messageId);
    return info.changes > 0;
  }

  /**
   * Zaehlt ungelesene Nachrichten.
   *
   * @param opts.fromAgent     optionaler Absender-Filter
   * @param opts.forInstance   ADR-005: nur Messages fuer diese Instance zaehlen
   * @param opts.includeLegacy ADR-005: legacy rows (NULL) mitzaehlen. Default
   *   analog zu `list()`: true wenn forInstance unset, false sonst.
   */
  unreadCount(
    opts?: { fromAgent?: string; forInstance?: string; includeLegacy?: boolean } | string,
  ): number {
    // Back-compat: string argument still works and is treated as `fromAgent`.
    const options: { fromAgent?: string; forInstance?: string; includeLegacy?: boolean } =
      typeof opts === 'string' ? { fromAgent: opts } : (opts ?? {});

    const clauses = ['read_at IS NULL', 'archived = 0'];
    const params: string[] = [];
    if (options.fromAgent) {
      clauses.push('from_agent = ?');
      params.push(options.fromAgent);
    }
    if (options.forInstance) {
      const includeLegacy = options.includeLegacy ?? false;
      if (includeLegacy) {
        clauses.push('(to_agent_instance = ? OR to_agent_instance IS NULL)');
      } else {
        clauses.push('to_agent_instance = ?');
      }
      params.push(options.forInstance);
    }
    const sql = `SELECT COUNT(*) as n FROM messages WHERE ${clauses.join(' AND ')}`;
    const row = this.db.prepare(sql).get(...params) as { n: number };
    return row.n;
  }

  /** Findet eine Nachricht anhand ihrer message_id. */
  findByMessageId(messageId: string): InboxMessage | undefined {
    return this.db
      .prepare('SELECT * FROM messages WHERE message_id = ?')
      .get(messageId) as InboxMessage | undefined;
  }

  close(): void {
    this.db.close();
  }
}
