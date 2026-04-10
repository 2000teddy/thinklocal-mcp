/**
 * ADR-007 Phase A: Tests for the entity-model extension of AuditLog.
 *
 *   - Schema migration: entity_type + entity_id columns + index
 *   - append() with entity params (and back-compat without)
 *   - getEventsByEntity() filtering
 *   - Merkle-chain integrity: events with entity fields produce
 *     different hashes than events without (so the chain isn't
 *     accidentally "compatible" with pre-migration data)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import Database from 'better-sqlite3';
import { AuditLog, type AuditEntityType } from './audit.js';

function makeKey(): string {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
}

describe('AuditLog — ADR-007 entity-model', () => {
  let dir: string;
  let audit: AuditLog;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tlmcp-audit-entity-'));
    audit = new AuditLog(dir, makeKey(), 'spiffe://test/host/x/agent/y');
  });

  afterEach(() => {
    audit.close();
    rmSync(dir, { recursive: true, force: true });
  });

  describe('schema migration', () => {
    it('adds entity_type and entity_id columns on a fresh db', () => {
      const dbPath = join(dir, 'audit', 'audit.db');
      const raw = new Database(dbPath, { readonly: true });
      try {
        const columns = raw
          .prepare(`PRAGMA table_info(audit_events)`)
          .all() as Array<{ name: string }>;
        const names = columns.map((c) => c.name);
        expect(names).toContain('entity_type');
        expect(names).toContain('entity_id');
      } finally {
        raw.close();
      }
    });

    it('is idempotent across re-opens', () => {
      audit.close();
      expect(() => {
        audit = new AuditLog(dir, makeKey(), 'spiffe://test/host/x/agent/y');
      }).not.toThrow();
    });

    // Gemini-Pro CR LOW: test must create an actual v2 db, not just re-open v3.
    it('migrates an existing v2 db without entity columns', () => {
      audit.close();
      const dbPath = join(dir, 'audit', 'audit.db');
      rmSync(dbPath);

      // Create a v2-like db manually (no entity columns).
      const v2db = new Database(dbPath);
      v2db.exec(`
        CREATE TABLE audit_events (
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
      v2db.exec(`
        CREATE TABLE peer_audit_events (
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
      v2db.close();

      // Re-opening triggers migrateToV3.
      expect(() => {
        audit = new AuditLog(dir, makeKey(), 'spiffe://test/host/x/agent/y');
      }).not.toThrow();

      // Verify columns were added.
      const migrated = new Database(dbPath, { readonly: true });
      try {
        const cols = migrated
          .prepare(`PRAGMA table_info(audit_events)`)
          .all() as Array<{ name: string }>;
        expect(cols.map((c) => c.name)).toContain('entity_type');
        expect(cols.map((c) => c.name)).toContain('entity_id');
        const peerCols = migrated
          .prepare(`PRAGMA table_info(peer_audit_events)`)
          .all() as Array<{ name: string }>;
        expect(peerCols.map((c) => c.name)).toContain('entity_type');
        expect(peerCols.map((c) => c.name)).toContain('entity_id');
      } finally {
        migrated.close();
      }
    });
  });

  describe('append() with entity params', () => {
    it('stores entity_type and entity_id when provided', () => {
      audit.append('AGENT_MESSAGE_TX', 'peer-1', 'msg-123', 'message', 'msg-uuid-abc');
      const events = audit.getEvents(1);
      expect(events).toHaveLength(1);
      expect(events[0]!.entity_type).toBe('message');
      expect(events[0]!.entity_id).toBe('msg-uuid-abc');
    });

    it('stores NULL entity fields when not provided (back-compat)', () => {
      audit.append('PEER_JOIN', 'peer-1', 'joined');
      const events = audit.getEvents(1);
      expect(events).toHaveLength(1);
      expect(events[0]!.entity_type).toBeNull();
      expect(events[0]!.entity_id).toBeNull();
    });

    it('includes entity fields in the signature payload (different hash)', () => {
      audit.append('PEER_JOIN', 'peer-1', 'test');
      audit.append('PEER_JOIN', 'peer-1', 'test', 'peer', 'peer-spiffe');
      const events = audit.getEvents(2);
      // The two events have the same eventType/peerId/details but different
      // entity fields — their entry_hash MUST differ.
      expect(events[0]!.entry_hash).not.toBe(events[1]!.entry_hash);
    });
  });

  describe('getEventsByEntity()', () => {
    beforeEach(() => {
      audit.append('AGENT_MESSAGE_TX', 'peer-a', 'sent msg-1', 'message', 'msg-1');
      audit.append('AGENT_MESSAGE_TX', 'peer-a', 'sent msg-2', 'message', 'msg-2');
      audit.append('PEER_JOIN', 'peer-b', 'joined', 'peer', 'peer-b-spiffe');
      audit.append('CAPABILITY_ACTIVATED', 'peer-c', 'influxdb', 'capability', 'influxdb.query');
      audit.append('HEARTBEAT', 'peer-a'); // no entity — legacy-style
    });

    it('filters by entity_type only', () => {
      const msgs = audit.getEventsByEntity('message');
      expect(msgs).toHaveLength(2);
      expect(msgs.map((e) => e.entity_id).sort()).toEqual(['msg-1', 'msg-2']);
    });

    it('filters by entity_type + entity_id', () => {
      const specific = audit.getEventsByEntity('message', 'msg-1');
      expect(specific).toHaveLength(1);
      expect(specific[0]!.details).toBe('sent msg-1');
    });

    it('returns empty for non-matching entity_type', () => {
      expect(audit.getEventsByEntity('session')).toEqual([]);
    });

    it('does not return events without entity_type (legacy)', () => {
      const all = audit.getEventsByEntity('peer');
      // Only the PEER_JOIN with entity_type='peer', not the HEARTBEAT
      expect(all).toHaveLength(1);
      expect(all[0]!.event_type).toBe('PEER_JOIN');
    });

    it('respects the limit parameter', () => {
      const limited = audit.getEventsByEntity('message', undefined, 1);
      expect(limited).toHaveLength(1);
    });
  });

  describe('Merkle chain integrity', () => {
    it('maintains a valid hash chain across entity and non-entity events', () => {
      audit.append('PEER_JOIN', 'p1', 'd1');
      audit.append('AGENT_MESSAGE_TX', 'p2', 'd2', 'message', 'msg-x');
      audit.append('CAPABILITY_ACTIVATED', 'p3', 'd3', 'capability', 'cap-y');
      const events = audit.getEvents(10);
      // Events come in reverse order (newest first)
      expect(events).toHaveLength(3);
      // Each event has a unique non-empty hash
      const hashes = events.map((e) => e.entry_hash);
      expect(new Set(hashes).size).toBe(3);
      hashes.forEach((h) => expect(h).toMatch(/^[a-f0-9]{64}$/));

      // Gemini-Pro CR MEDIUM: verify actual chain linkage (prev_hash → entry_hash).
      // Events are returned newest-first, so events[0].prev_hash === events[1].entry_hash.
      for (let i = 0; i < events.length - 1; i++) {
        expect(events[i]!.prev_hash).toBe(events[i + 1]!.entry_hash);
      }
    });
  });
});
