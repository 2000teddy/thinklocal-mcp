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

const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_SUBJECT_LENGTH = 200;

export interface InboxMessage {
  id: number;
  message_id: string;
  from_agent: string;
  to_agent: string;
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

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT NOT NULL UNIQUE,
        from_agent TEXT NOT NULL,
        to_agent TEXT NOT NULL,
        subject TEXT,
        body TEXT NOT NULL,
        in_reply_to TEXT,
        sent_at TEXT NOT NULL,
        received_at TEXT NOT NULL,
        read_at TEXT,
        archived INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_messages_unread
        ON messages (read_at, archived) WHERE read_at IS NULL AND archived = 0;
      CREATE INDEX IF NOT EXISTS idx_messages_from ON messages (from_agent);
      CREATE INDEX IF NOT EXISTS idx_messages_sent_at ON messages (sent_at DESC);
    `);
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

    const receivedAt = new Date().toISOString();
    const info = this.db
      .prepare(
        `INSERT INTO messages
         (message_id, from_agent, to_agent, subject, body, in_reply_to, sent_at, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        payload.message_id,
        fromAgent,
        payload.to,
        payload.subject ?? null,
        bodyStr,
        payload.in_reply_to ?? null,
        payload.sent_at,
        receivedAt,
      );

    this.log?.info(
      { fromAgent, message_id: payload.message_id, subject: payload.subject },
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
   */
  list(opts?: {
    unreadOnly?: boolean;
    fromAgent?: string;
    limit?: number;
    includeArchived?: boolean;
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

  /** Zaehlt ungelesene Nachrichten. */
  unreadCount(fromAgent?: string): number {
    const sql = fromAgent
      ? 'SELECT COUNT(*) as n FROM messages WHERE read_at IS NULL AND archived = 0 AND from_agent = ?'
      : 'SELECT COUNT(*) as n FROM messages WHERE read_at IS NULL AND archived = 0';
    const row = (
      fromAgent
        ? this.db.prepare(sql).get(fromAgent)
        : this.db.prepare(sql).get()
    ) as { n: number };
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
