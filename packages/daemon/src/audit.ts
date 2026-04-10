import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { signData, verifySignature } from './identity.js';
import { createHash } from 'node:crypto';
import type { Logger } from 'pino';

export type AuditEventType =
  | 'PEER_JOIN'
  | 'PEER_LEAVE'
  | 'HEARTBEAT'
  | 'CAPABILITY_QUERY'
  | 'TASK_DELEGATE'
  | 'CREDENTIAL_ACCESS'
  | 'AGENT_MESSAGE_RX'
  | 'AGENT_MESSAGE_TX'
  // ADR-004 Phase 2: agent-instance lifecycle tracking
  | 'AGENT_REGISTER'
  | 'AGENT_HEARTBEAT'
  | 'AGENT_UNREGISTER'
  | 'AGENT_STALE'
  // ADR-007: extensible event types for governance features
  | 'CONFIG_CHANGE'
  | 'APPROVAL_CREATED'
  | 'APPROVAL_DECIDED'
  | 'CAPABILITY_ACTIVATED'
  | 'CAPABILITY_SUSPENDED'
  | 'CAPABILITY_REVOKED';

/**
 * ADR-007 Phase A: Entity types for structured audit querying.
 * Every audit event can optionally reference an entity (the "what")
 * in addition to the peer (the "who"). This lets dashboards and
 * CLI tools filter by entity class instead of parsing freetext details.
 */
export type AuditEntityType =
  | 'peer'
  | 'agent_instance'
  | 'message'
  | 'session'
  | 'skill'
  | 'capability'
  | 'config'
  | 'approval';

export interface AuditEvent {
  id: number;
  timestamp: string;
  event_type: AuditEventType;
  agent_id: string;
  peer_id: string | null;
  details: string | null;
  /** ADR-007: entity class (peer, message, session, skill, …). NULL for legacy events. */
  entity_type: AuditEntityType | null;
  /** ADR-007: entity identifier (SPIFFE-URI, message_id, session-uuid, …). NULL for legacy. */
  entity_id: string | null;
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

    // ADR-007 Phase A: schema migration for entity_type + entity_id columns.
    // Uses the same PRAGMA table_info pattern as agent-inbox.ts (ADR-005).
    this.migrateToV3();

    this.insertStmt = this.db.prepare(`
      INSERT INTO audit_events (timestamp, event_type, agent_id, peer_id, details, entity_type, entity_id, signature, prev_hash, entry_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Tabelle fuer importierte Peer-Events (Mesh-weite Sync)
    // ADR-007: entity_type + entity_id included for full parity with local events.
    // (Gemini-Pro CR CRITICAL: peer sync must propagate entity data.)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS peer_audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        event_type TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        peer_id TEXT,
        details TEXT,
        entity_type TEXT,
        entity_id TEXT,
        signature TEXT NOT NULL,
        entry_hash TEXT NOT NULL UNIQUE
      )
    `);
    // Migrate peer_audit_events too (idempotent).
    {
      const peerCols = this.db
        .prepare(`PRAGMA table_info(peer_audit_events)`)
        .all() as Array<{ name: string }>;
      const peerNames = new Set(peerCols.map((c) => c.name));
      if (!peerNames.has('entity_type')) {
        this.db.exec(`ALTER TABLE peer_audit_events ADD COLUMN entity_type TEXT`);
      }
      if (!peerNames.has('entity_id')) {
        this.db.exec(`ALTER TABLE peer_audit_events ADD COLUMN entity_id TEXT`);
      }
    }
    this.importPeerStmt = this.db.prepare(`
      INSERT OR IGNORE INTO peer_audit_events (timestamp, event_type, agent_id, peer_id, details, entity_type, entity_id, signature, entry_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Letzten Hash laden für Chain-Integrität (persistierter entry_hash)
    const lastRow = this.db
      .prepare('SELECT entry_hash FROM audit_events ORDER BY id DESC LIMIT 1')
      .get() as { entry_hash: string } | undefined;
    if (lastRow) {
      this.lastHash = lastRow.entry_hash;
    }
  }

  /**
   * ADR-007 Phase A: add entity_type + entity_id columns.
   * Idempotent — safe to run on fresh or already-migrated databases.
   */
  /**
   * Wrapped in a transaction so a partial failure (e.g. disk full
   * after adding entity_type but before entity_id) cannot leave the
   * schema in an inconsistent state. (Gemini-Pro CR MEDIUM.)
   */
  private migrateToV3(): void {
    this.db.transaction(() => {
      const columns = this.db
        .prepare(`PRAGMA table_info(audit_events)`)
        .all() as Array<{ name: string }>;
      const names = new Set(columns.map((c) => c.name));
      if (!names.has('entity_type')) {
        this.db.exec(`ALTER TABLE audit_events ADD COLUMN entity_type TEXT`);
        this.log?.info('[audit] migrated schema: added entity_type column');
      }
      if (!names.has('entity_id')) {
        this.db.exec(`ALTER TABLE audit_events ADD COLUMN entity_id TEXT`);
        this.log?.info('[audit] migrated schema: added entity_id column');
      }
      this.db.exec(
        `CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_events (entity_type, entity_id)`,
      );
    })();
  }

  /**
   * Append an audit event.
   *
   * ADR-007: extended with optional entity_type + entity_id for structured
   * querying. Back-compatible: callers that only pass (eventType, peerId, details)
   * still work — entity fields default to NULL.
   *
   * The new fields are included in the signature payload and entry hash so
   * the Merkle chain covers them. Legacy events (no entity) have empty
   * strings in the hash input, identical to NULL details/peerId.
   */
  append(
    eventType: AuditEventType,
    peerId?: string,
    details?: string,
    entityType?: AuditEntityType,
    entityId?: string,
  ): void {
    const timestamp = new Date().toISOString();
    const prevHash = this.lastHash;
    const et = entityType ?? '';
    const eid = entityId ?? '';

    // Signiere den Event-Inhalt (incl. ADR-007 entity fields)
    const payload = Buffer.from(
      `${timestamp}|${eventType}|${this.agentId}|${peerId ?? ''}|${details ?? ''}|${et}|${eid}`,
    );
    const sig = signData(this.privateKeyPem, payload);
    const sigBase64 = sig.toString('base64');

    // Hash über alle immutablen Felder + prev_hash berechnen
    const entryHash = createHash('sha256')
      .update(
        `${timestamp}|${eventType}|${this.agentId}|${peerId ?? ''}|${details ?? ''}|${et}|${eid}|${sigBase64}|${prevHash}`,
      )
      .digest('hex');

    this.insertStmt.run(
      timestamp,
      eventType,
      this.agentId,
      peerId ?? null,
      details ?? null,
      entityType ?? null,
      entityId ?? null,
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
   * ADR-007: Query events by entity (the "what" of the audit trail).
   * Returns events in reverse chronological order.
   */
  getEventsByEntity(
    entityType: AuditEntityType,
    entityId?: string,
    limit = 100,
  ): AuditEvent[] {
    if (entityId) {
      return this.db
        .prepare(
          'SELECT * FROM audit_events WHERE entity_type = ? AND entity_id = ? ORDER BY id DESC LIMIT ?',
        )
        .all(entityType, entityId, limit) as AuditEvent[];
    }
    return this.db
      .prepare(
        'SELECT * FROM audit_events WHERE entity_type = ? ORDER BY id DESC LIMIT ?',
      )
      .all(entityType, limit) as AuditEvent[];
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
    // ADR-007: entity_type + entity_id included (Gemini-Pro CR MEDIUM).
    const header = 'id,timestamp,event_type,agent_id,peer_id,details,entity_type,entity_id,signature,prev_hash,entry_hash';
    const rows = events.map((e) =>
      [
        e.id,
        e.timestamp,
        sanitizeCsvCell(e.event_type),
        sanitizeCsvCell(e.agent_id),
        sanitizeCsvCell(e.peer_id ?? ''),
        sanitizeCsvCell(e.details ?? ''),
        sanitizeCsvCell(e.entity_type ?? ''),
        sanitizeCsvCell(e.entity_id ?? ''),
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
   * SECURITY: Verifiziert die Signatur wenn publicKey vorhanden.
   */
  /**
   * Importiert ein Audit-Event von einem Peer.
   * ADR-007: entity_type + entity_id sind optional fuer Back-Compat
   * mit Peers die noch keine v3-Schema-Events senden.
   * (Gemini-Pro CR CRITICAL: peer sync must propagate entity data.)
   */
  importPeerEvent(event: {
    timestamp: string;
    event_type: string;
    agent_id: string;
    peer_id?: string;
    details?: string;
    entity_type?: string;
    entity_id?: string;
    signature: string;
    entry_hash: string;
  }, peerPublicKeyPem?: string): boolean {
    // SECURITY: Signatur verifizieren wenn Public Key verfuegbar.
    // ADR-007: entity fields are included in the signature payload
    // to match the extended append() format.
    if (peerPublicKeyPem) {
      const et = event.entity_type ?? '';
      const eid = event.entity_id ?? '';
      const payload = Buffer.from(
        `${event.timestamp}|${event.event_type}|${event.agent_id}|${event.peer_id ?? ''}|${event.details ?? ''}|${et}|${eid}`,
      );
      const sigBuffer = Buffer.from(event.signature, 'base64');
      try {
        const valid = verifySignature(peerPublicKeyPem, payload, sigBuffer);
        if (!valid) {
          this.log?.warn({ from: event.agent_id, type: event.event_type }, 'Peer-Audit-Event: Signatur ungueltig — abgelehnt');
          return false;
        }
      } catch (err) {
        this.log?.warn({ from: event.agent_id, err }, 'Peer-Audit-Event: Signaturpruefung fehlgeschlagen — abgelehnt');
        return false;
      }
    } else {
      this.log?.debug({ from: event.agent_id }, 'Peer-Audit-Event: Kein Public Key — Signatur nicht geprueft');
    }

    // INSERT OR IGNORE mit UNIQUE entry_hash — ein Query statt zwei
    const info = this.importPeerStmt.run(
      event.timestamp,
      event.event_type,
      event.agent_id,
      event.peer_id ?? null,
      event.details ?? null,
      event.entity_type ?? null,
      event.entity_id ?? null,
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
  /**
   * ADR-007: entity_type + entity_id included in sync payload so receiving
   * peers can build their entity-filtered audit views too.
   * (Gemini-Pro CR CRITICAL: peer sync must propagate entity data.)
   */
  getRecentForSync(limit = 20): Array<{
    timestamp: string;
    event_type: string;
    agent_id: string;
    peer_id: string | null;
    details: string | null;
    entity_type: string | null;
    entity_id: string | null;
    signature: string;
    entry_hash: string;
  }> {
    return this.db
      .prepare('SELECT timestamp, event_type, agent_id, peer_id, details, entity_type, entity_id, signature, entry_hash FROM audit_events ORDER BY id DESC LIMIT ?')
      .all(limit) as Array<{
        timestamp: string;
        event_type: string;
        agent_id: string;
        peer_id: string | null;
        details: string | null;
        entity_type: string | null;
        entity_id: string | null;
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
