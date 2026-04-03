import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { signData } from './identity.js';
import { createHash } from 'node:crypto';
import type { Logger } from 'pino';

export type AuditEventType =
  | 'PEER_JOIN'
  | 'PEER_LEAVE'
  | 'HEARTBEAT'
  | 'CAPABILITY_QUERY'
  | 'TASK_DELEGATE'
  | 'CREDENTIAL_ACCESS';

export interface AuditEvent {
  id: number;
  timestamp: string;
  event_type: AuditEventType;
  agent_id: string;
  peer_id: string | null;
  details: string | null;
  signature: string;
  prev_hash: string;
  entry_hash: string;
}

export class AuditLog {
  private db: Database.Database;
  private insertStmt: Database.Statement;
  private lastHash: string = '0'.repeat(64);

  constructor(
    dataDir: string,
    private privateKeyPem: string,
    private agentId: string,
    private log?: Logger,
  ) {
    const dbDir = resolve(dataDir, 'audit');
    mkdirSync(dbDir, { recursive: true });

    this.db = new Database(resolve(dbDir, 'audit.db'), {
      verbose: undefined,
    });
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        event_type TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        peer_id TEXT,
        details TEXT,
        signature TEXT NOT NULL,
        prev_hash TEXT NOT NULL,
        entry_hash TEXT NOT NULL
      )
    `);

    this.insertStmt = this.db.prepare(`
      INSERT INTO audit_events (timestamp, event_type, agent_id, peer_id, details, signature, prev_hash, entry_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Letzten Hash laden für Chain-Integrität (persistierter entry_hash)
    const lastRow = this.db
      .prepare('SELECT entry_hash FROM audit_events ORDER BY id DESC LIMIT 1')
      .get() as { entry_hash: string } | undefined;
    if (lastRow) {
      this.lastHash = lastRow.entry_hash;
    }
  }

  append(eventType: AuditEventType, peerId?: string, details?: string): void {
    const timestamp = new Date().toISOString();
    const prevHash = this.lastHash;

    // Signiere den Event-Inhalt
    const payload = Buffer.from(
      `${timestamp}|${eventType}|${this.agentId}|${peerId ?? ''}|${details ?? ''}`,
    );
    const sig = signData(this.privateKeyPem, payload);
    const sigBase64 = sig.toString('base64');

    // Hash über alle immutablen Felder + prev_hash berechnen
    const entryHash = createHash('sha256')
      .update(
        `${timestamp}|${eventType}|${this.agentId}|${peerId ?? ''}|${details ?? ''}|${sigBase64}|${prevHash}`,
      )
      .digest('hex');

    this.insertStmt.run(
      timestamp,
      eventType,
      this.agentId,
      peerId ?? null,
      details ?? null,
      sigBase64,
      prevHash,
      entryHash,
    );

    this.lastHash = entryHash;
    this.log?.debug({ eventType, peerId }, 'Audit-Event geschrieben');
  }

  getEvents(limit = 100): AuditEvent[] {
    return this.db
      .prepare('SELECT * FROM audit_events ORDER BY id DESC LIMIT ?')
      .all(limit) as AuditEvent[];
  }

  close(): void {
    this.db.close();
  }
}
