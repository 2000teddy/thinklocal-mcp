/**
 * ADR-005 specific tests for AgentInbox:
 *   - Schema migration v1 → v2 (idempotent, column added, index created)
 *   - Routing: messages with a 4-component `to` get an instance tag
 *   - Filtering: `forInstance` isolates messages between sibling agents
 *   - Legacy rows (NULL instance) are surfaced only via includeLegacy
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { AgentInbox } from './agent-inbox.js';
import type { AgentMessagePayload } from './messages.js';

const DAEMON_URI = 'spiffe://thinklocal/host/deadbeefcafe0001/agent/claude-code';
const CLAUDE_INSTANCE = `${DAEMON_URI}/instance/claude1`;
const CODEX_DAEMON = 'spiffe://thinklocal/host/deadbeefcafe0001/agent/codex';
const CODEX_INSTANCE = `${CODEX_DAEMON}/instance/codex1`;

function makePayload(overrides: Partial<AgentMessagePayload>): AgentMessagePayload {
  return {
    message_id: crypto.randomUUID(),
    to: DAEMON_URI,
    subject: 'test',
    body: 'hello',
    sent_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('AgentInbox — ADR-005 per-agent-instance routing', () => {
  let dir: string;
  let inbox: AgentInbox;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tlmcp-inbox-adr005-'));
    inbox = new AgentInbox(dir);
  });

  afterEach(() => {
    inbox.close();
    rmSync(dir, { recursive: true, force: true });
  });

  describe('schema migration', () => {
    it('creates a v2 schema on a fresh database', () => {
      const dbPath = join(dir, 'inbox', 'inbox.db');
      const raw = new Database(dbPath, { readonly: true });
      try {
        const version = raw.pragma('user_version', { simple: true }) as number;
        expect(version).toBe(2);
        const columns = raw
          .prepare(`PRAGMA table_info(messages)`)
          .all() as Array<{ name: string }>;
        const names = columns.map((c) => c.name);
        expect(names).toContain('to_agent_instance');
      } finally {
        raw.close();
      }
    });

    it('migrates a v1 database by adding the column + index', () => {
      // Close the inbox, wipe the db, and create a pristine v1 schema
      // by hand to simulate an older daemon install.
      inbox.close();
      rmSync(dir, { recursive: true, force: true });
      dir = mkdtempSync(join(tmpdir(), 'tlmcp-inbox-v1-'));
      const inboxDir = join(dir, 'inbox');
      // Create inbox dir and v1 schema manually
      const { mkdirSync: mk } = require('node:fs');
      mk(inboxDir, { recursive: true });
      const legacyPath = join(inboxDir, 'inbox.db');
      const legacy = new Database(legacyPath);
      legacy.pragma('journal_mode = WAL');
      legacy.exec(`
        CREATE TABLE messages (
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
        INSERT INTO messages (message_id, from_agent, to_agent, body, sent_at, received_at)
        VALUES ('legacy-1', 'spiffe://thinklocal/host/x/agent/y', 'spiffe://thinklocal/host/deadbeefcafe0001/agent/claude-code', 'legacy body', '2026-04-08T12:00:00.000Z', '2026-04-08T12:00:00.000Z');
      `);
      legacy.pragma('user_version = 1');
      legacy.close();

      // Now open via AgentInbox — this should run migrateToV2.
      inbox = new AgentInbox(dir);

      // Verify the column exists and the legacy row is preserved.
      const probe = new Database(legacyPath, { readonly: true });
      try {
        const version = probe.pragma('user_version', { simple: true }) as number;
        expect(version).toBe(2);
        const columns = probe
          .prepare(`PRAGMA table_info(messages)`)
          .all() as Array<{ name: string }>;
        expect(columns.map((c) => c.name)).toContain('to_agent_instance');
        const legacyRow = probe
          .prepare(`SELECT to_agent_instance FROM messages WHERE message_id = 'legacy-1'`)
          .get() as { to_agent_instance: string | null };
        expect(legacyRow.to_agent_instance).toBeNull();
      } finally {
        probe.close();
      }
    });

    it('is idempotent across re-opens at v2', () => {
      inbox.close();
      // Re-open the same directory — migration must be a no-op.
      expect(() => {
        inbox = new AgentInbox(dir);
      }).not.toThrow();
    });
  });

  describe('store() routing', () => {
    it('records the instance tail when a 4-component target is used', () => {
      const res = inbox.store(
        'spiffe://thinklocal/host/x/agent/y',
        makePayload({ to: CLAUDE_INSTANCE }),
      );
      expect(res.status).toBe('delivered');
      const all = inbox.list();
      expect(all).toHaveLength(1);
      expect(all[0]!.to_agent_instance).toBe('claude1');
      expect(all[0]!.to_agent).toBe(DAEMON_URI); // normalised
    });

    it('records NULL instance when a 3-component target is used', () => {
      inbox.store('spiffe://thinklocal/host/x/agent/y', makePayload({ to: DAEMON_URI }));
      const all = inbox.list();
      expect(all[0]!.to_agent_instance).toBeNull();
    });

    it('rejects a malformed target URI', () => {
      const res = inbox.store(
        'spiffe://thinklocal/host/x/agent/y',
        makePayload({ to: 'not-a-spiffe-uri' }),
      );
      expect(res.status).toBe('rejected');
      expect(res.reason).toContain('invalid target URI');
    });
  });

  describe('list() / unreadCount() isolation', () => {
    beforeEach(() => {
      // Three messages: one for Claude's instance, one for Codex's,
      // one legacy row (no instance at all).
      inbox.store(
        'spiffe://thinklocal/host/x/agent/y',
        makePayload({ to: CLAUDE_INSTANCE, subject: 'for-claude' }),
      );
      inbox.store(
        'spiffe://thinklocal/host/x/agent/y',
        makePayload({ to: CODEX_INSTANCE, subject: 'for-codex' }),
      );
      // "Legacy" row: written with the normalised 3-component form and
      // manually nulled afterwards to mimic a pre-migration insert.
      inbox.store(
        'spiffe://thinklocal/host/x/agent/y',
        makePayload({ to: DAEMON_URI, subject: 'legacy' }),
      );
    });

    it('returns all rows when no forInstance filter is applied (back-compat)', () => {
      const all = inbox.list();
      expect(all).toHaveLength(3);
    });

    it('filters to a single instance when forInstance is set', () => {
      const claudeOnly = inbox.list({ forInstance: 'claude1' });
      expect(claudeOnly).toHaveLength(1);
      expect(claudeOnly[0]!.subject).toBe('for-claude');

      const codexOnly = inbox.list({ forInstance: 'codex1' });
      expect(codexOnly).toHaveLength(1);
      expect(codexOnly[0]!.subject).toBe('for-codex');
    });

    it('excludes legacy (NULL) rows by default when forInstance is set', () => {
      const claudeStrict = inbox.list({ forInstance: 'claude1' });
      const subjects = claudeStrict.map((m) => m.subject);
      expect(subjects).not.toContain('legacy');
    });

    it('includes legacy rows when includeLegacy is set', () => {
      const claudeLegacy = inbox.list({ forInstance: 'claude1', includeLegacy: true });
      const subjects = claudeLegacy.map((m) => m.subject).sort();
      expect(subjects).toEqual(['for-claude', 'legacy']);
    });

    it('unreadCount honours forInstance', () => {
      expect(inbox.unreadCount()).toBe(3);
      expect(inbox.unreadCount({ forInstance: 'claude1' })).toBe(1);
      expect(inbox.unreadCount({ forInstance: 'codex1' })).toBe(1);
      expect(inbox.unreadCount({ forInstance: 'claude1', includeLegacy: true })).toBe(2);
    });

    it('unreadCount back-compat: string arg behaves like fromAgent filter', () => {
      // No sender matches, so count is 0.
      expect(inbox.unreadCount('spiffe://thinklocal/host/nope/agent/nope')).toBe(0);
    });
  });
});
