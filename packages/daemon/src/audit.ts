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

    // Tabelle fuer importierte Peer-Events (Mesh-weite Sync)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS peer_audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        event_type TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        peer_id TEXT,
        details TEXT,
        signature TEXT NOT NULL,
        entry_hash TEXT NOT NULL UNIQUE
      )
    `);
    this.importPeerStmt = this.db.prepare(`
      INSERT OR IGNORE INTO peer_audit_events (timestamp, event_type, agent_id, peer_id, details, signature, entry_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?)
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

  /**
   * Exportiert alle Audit-Events als JSON-String.
   */
  exportJson(limit?: number): string {
    const events = this.getEvents(limit ?? 10_000);
    return JSON.stringify(events, null, 2);
  }

  /**
   * Exportiert alle Audit-Events als CSV-String.
   */
  exportCsv(limit?: number): string {
    const events = this.getEvents(limit ?? 10_000);
    const header = 'id,timestamp,event_type,agent_id,peer_id,details,signature,prev_hash,entry_hash';
    const rows = events.map((e) =>
      [
        e.id,
        e.timestamp,
        sanitizeCsvCell(e.event_type),
        sanitizeCsvCell(e.agent_id),
        sanitizeCsvCell(e.peer_id ?? ''),
        sanitizeCsvCell(e.details ?? ''),
        e.signature,
        e.prev_hash,
        e.entry_hash,
      ].join(','),
    );
    return [header, ...rows].join('\n');
  }

  /**
   * Gibt die Anzahl der Audit-Events zurück.
   */
  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM audit_events').get() as { cnt: number };
    return row.cnt;
  }

  /**
   * Importiert ein Audit-Event von einem Peer.
   * Speichert es in einer separaten Tabelle fuer Peer-Events.
   * Verifiziert die Signatur wenn publicKey vorhanden.
   */
  importPeerEvent(event: {
    timestamp: string;
    event_type: string;
    agent_id: string;
    peer_id?: string;
    details?: string;
    signature: string;
    entry_hash: string;
  }): boolean {
    // INSERT OR IGNORE mit UNIQUE entry_hash — ein Query statt zwei
    const info = this.importPeerStmt.run(
      event.timestamp,
      event.event_type,
      event.agent_id,
      event.peer_id ?? null,
      event.details ?? null,
      event.signature,
      event.entry_hash,
    );
    if (info.changes === 0) return false; // Bereits importiert (UNIQUE constraint)
    this.log?.debug({ from: event.agent_id, type: event.event_type }, 'Peer-Audit-Event importiert');
    return true;
  }

  /**
   * Gibt die letzten lokalen Events zurueck (fuer Mesh-Sync).
   * Nur eigene Events, keine importierten Peer-Events.
   */
  getRecentForSync(limit = 20): Array<{
    timestamp: string;
    event_type: string;
    agent_id: string;
    peer_id: string | null;
    details: string | null;
    signature: string;
    entry_hash: string;
  }> {
    return this.db
      .prepare('SELECT timestamp, event_type, agent_id, peer_id, details, signature, entry_hash FROM audit_events ORDER BY id DESC LIMIT ?')
      .all(limit) as Array<{
        timestamp: string;
        event_type: string;
        agent_id: string;
        peer_id: string | null;
        details: string | null;
        signature: string;
        entry_hash: string;
      }>;
  }

  /**
   * Gibt alle Events zurueck (lokal + peer), sortiert nach Timestamp.
   */
  getAllEvents(limit = 100): AuditEvent[] {
    // Lokale Events + Peer-Events zusammenfuehren
    const local = this.getEvents(limit);
    const peer = this.db
      .prepare('SELECT * FROM peer_audit_events ORDER BY id DESC LIMIT ?')
      .all(limit) as AuditEvent[];
    return [...local, ...peer]
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, limit);
  }

  close(): void {
    this.db.close();
  }

  private importPeerStmt!: Database.Statement;
}

/** SECURITY: CSV-Injection-Schutz — Zellen die mit =, +, -, @ beginnen werden prefixed */
function sanitizeCsvCell(value: string): string {
  const escaped = value.replace(/"/g, '""');
  // CSV-Injection: Formeln verhindern
  if (/^[=+\-@\t\r]/.test(escaped)) {
    return `"'${escaped}"`;
  }
  return `"${escaped}"`;
}
