// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
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
import { verifyOrderBytes, type VerifyOrderResult } from './signed-order.js';

const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_SUBJECT_LENGTH = 200;

/**
 * Current schema version. Bumped whenever the SQLite DDL changes.
 * Stored in `PRAGMA user_version` so re-opens detect and migrate.
 *
 *   v1 (pre-ADR-005): messages table without `to_agent_instance`
 *   v2 (ADR-005):     adds `to_agent_instance TEXT NULL` + index for
 *                     per-agent-instance routing
 *   v3 (ADR-038):     adds signed-order columns (signed_bytes, signer_spiffe/keyid/pubkey,
 *                     order_nonce, verified_at, verify_verdict, trust_status, is_order) + order index
 */
const CURRENT_SCHEMA_VERSION = 3;

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
  // ADR-038 (TL-12) — Signatur-/Auftrags-Provenienz. NULL/0 für Nicht-Aufträge.
  /** 1 = verifizierter signierter Auftrag; 0 = Plain-Nachricht (Default). */
  is_order: number;
  /** Verbatim signierte Auftrags-Bytes (BLOB), unverändert wie empfangen. */
  signed_bytes: Buffer | null;
  /** Issuer-SPIFFE aus den signierten Bytes. */
  signer_spiffe: string | null;
  /** Fingerprint des Verify-Keys (Revocation-Join-Key). */
  signer_keyid: string | null;
  /** Immutable Verify-Key (PEM) — Re-Verify beim Lesen läuft gegen genau diesen. */
  signer_pubkey: string | null;
  /** Order-Nonce (idempotency_key) aus den signierten Bytes. */
  order_nonce: string | null;
  /** Zeitpunkt der Ingest-Verifikation (ISO 8601). */
  verified_at: string | null;
  /** Krypto-Integrität: 'VALID' | 'INVALID'. NICHT Revocation-bewusst. */
  verify_verdict: string | null;
  /** Getrennter Vertrauens-/Revocation-Kanal (ADR-038): Slice A immer 'unknown'. */
  trust_status: string | null;
}

export interface StoreResult {
  status: 'delivered' | 'duplicate' | 'rejected';
  reason?: string;
  inbox_id?: number;
}

/**
 * ADR-038: verifizierter Auftrags-Kontext, den `store()` persistiert. `is_order` wird
 * AUSSCHLIESSLICH aus `verdict==='VALID'` abgeleitet — nie ein freier Parameter.
 * INVALID (Marker vorhanden, Verify fehlgeschlagen) wird als Audit-Signal auf der Zeile
 * vermerkt (`verify_verdict='INVALID'`, `is_order=0`).
 */
export type OrderContext =
  | {
      verdict: 'VALID';
      /** Verbatim signierte Bytes (NIE re-serialisiert). */
      signedBytes: Uint8Array;
      signerSpiffe: string;
      signerKeyid: string;
      signerPubkey: string;
      orderNonce: string;
    }
  | { verdict: 'INVALID' };

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
      // Fresh-DB: Schema + user_version-Bump in EINER Transaktion (Symmetrie zu migrateToV3; ein
      // Crash zwischen CREATE und Bump ließe sonst ein v3-Schema mit user_version=0 zurück).
      this.db.transaction(() => {
        this.createSchemaV3();
        this.db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`);
      })();
      return;
    }
    let version = (this.db.pragma('user_version', { simple: true }) as number) ?? 0;
    if (version < 2) {
      this.migrateToV2();
      this.db.pragma('user_version = 2');
      version = 2;
    }
    if (version < 3) {
      this.migrateToV3(); // transaktional inkl. user_version-Bump auf 3
    }
  }

  /** Create a pristine v3 schema (fresh database case). */
  private createSchemaV3(): void {
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
        archived INTEGER NOT NULL DEFAULT 0,
        is_order INTEGER NOT NULL DEFAULT 0,
        signed_bytes BLOB,
        signer_spiffe TEXT,
        signer_keyid TEXT,
        signer_pubkey TEXT,
        order_nonce TEXT,
        verified_at TEXT,
        verify_verdict TEXT,
        trust_status TEXT
      );
      CREATE INDEX idx_messages_unread
        ON messages (read_at, archived) WHERE read_at IS NULL AND archived = 0;
      CREATE INDEX idx_messages_from ON messages (from_agent);
      CREATE INDEX idx_messages_sent_at ON messages (sent_at DESC);
      CREATE INDEX idx_messages_instance ON messages (to_agent_instance);
      CREATE INDEX idx_messages_order ON messages (signer_keyid, order_nonce);
    `);
    this.log?.info({ schemaVersion: 3 }, '[agent-inbox] fresh db created at v3');
  }

  /**
   * ADR-038 migration v2→v3: add signed-order columns + order index. Idempotent
   * (each ADD COLUMN guarded by table_info) and **transactional together with the
   * user_version bump** — a crash mid-migration never leaves a version that lies about
   * the schema. Existing rows land with is_order=0 / NULL order fields (= non-orders).
   */
  private migrateToV3(): void {
    const cols = new Set(
      (this.db.prepare(`PRAGMA table_info(messages)`).all() as Array<{ name: string }>).map(
        (c) => c.name,
      ),
    );
    const addCol = (name: string, decl: string): void => {
      if (!cols.has(name)) this.db.exec(`ALTER TABLE messages ADD COLUMN ${name} ${decl}`);
    };
    const tx = this.db.transaction(() => {
      addCol('is_order', 'INTEGER NOT NULL DEFAULT 0');
      addCol('signed_bytes', 'BLOB');
      addCol('signer_spiffe', 'TEXT');
      addCol('signer_keyid', 'TEXT');
      addCol('signer_pubkey', 'TEXT');
      addCol('order_nonce', 'TEXT');
      addCol('verified_at', 'TEXT');
      addCol('verify_verdict', 'TEXT');
      addCol('trust_status', 'TEXT');
      this.db.exec(
        `CREATE INDEX IF NOT EXISTS idx_messages_order ON messages (signer_keyid, order_nonce)`,
      );
      this.db.pragma('user_version = 3');
    });
    tx();
    this.log?.info({ from: 2, to: 3 }, '[agent-inbox] migrated schema: added signed-order columns');
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
  store(fromAgent: string, payload: AgentMessagePayload, order?: OrderContext | null): StoreResult {
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
    // ADR-038: is_order wird AUSSCHLIESSLICH aus order.verdict==='VALID' abgeleitet — nie ein freier
    // Parameter, nie aus dem Body. INVALID (Marker vorhanden, Verify fehlgeschlagen) hinterlässt nur
    // ein Audit-Signal auf der Zeile (verify_verdict='INVALID'), ist aber KEIN Auftrag.
    const isOrder = order?.verdict === 'VALID' ? 1 : 0;
    const orderCols =
      order?.verdict === 'VALID'
        ? {
            signed_bytes: Buffer.from(order.signedBytes), // verbatim, als BLOB
            signer_spiffe: order.signerSpiffe,
            signer_keyid: order.signerKeyid,
            signer_pubkey: order.signerPubkey,
            order_nonce: order.orderNonce,
            verified_at: receivedAt,
            verify_verdict: 'VALID' as const,
            trust_status: 'unknown' as const,
          }
        : {
            signed_bytes: null,
            signer_spiffe: null,
            signer_keyid: null,
            signer_pubkey: null,
            order_nonce: null,
            verified_at: order?.verdict === 'INVALID' ? receivedAt : null,
            verify_verdict: order?.verdict === 'INVALID' ? ('INVALID' as const) : null,
            trust_status: null,
          };
    const info = this.db
      .prepare(
        `INSERT INTO messages
         (message_id, from_agent, to_agent, to_agent_instance, subject, body, in_reply_to, sent_at, received_at,
          is_order, signed_bytes, signer_spiffe, signer_keyid, signer_pubkey, order_nonce, verified_at, verify_verdict, trust_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        isOrder,
        orderCols.signed_bytes,
        orderCols.signer_spiffe,
        orderCols.signer_keyid,
        orderCols.signer_pubkey,
        orderCols.order_nonce,
        orderCols.verified_at,
        orderCols.verify_verdict,
        orderCols.trust_status,
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
   * ADR-038: Re-verifiziert einen gespeicherten Auftrag beim Lesen — gegen den **gespeicherten**
   * `signer_pubkey` (immutable, trust-on-first-verify, rotationsfest), NICHT gegen einen aktuellen Key.
   * Fail-closed: keine Order-Daten / beschädigte Bytes ⇒ `INVALID`; **wirft nie** (eine bösartige
   * Zeile darf den read_inbox-Pfad nicht lahmlegen). Beantwortet NUR „Signatur echt", nicht „noch
   * autorisiert" (Revocation = `trust_status`, Slice B/C).
   */
  verifyStoredOrder(row: Pick<InboxMessage, 'is_order' | 'signed_bytes' | 'signer_spiffe' | 'signer_pubkey'>): VerifyOrderResult {
    if (row.is_order !== 1 || !row.signed_bytes || !row.signer_spiffe || !row.signer_pubkey) {
      return { verdict: 'INVALID', reason: 'row is not a verified order' };
    }
    return verifyOrderBytes(new Uint8Array(row.signed_bytes), row.signer_spiffe, row.signer_pubkey);
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
