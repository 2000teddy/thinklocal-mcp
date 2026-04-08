import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentInbox } from './agent-inbox.js';
import type { AgentMessagePayload } from './messages.js';

const FROM = 'spiffe://thinklocal/host/aaaa111122223333/agent/codex';
const TO = 'spiffe://thinklocal/host/bbbb444455556666/agent/claude-code';

function makeMsg(overrides: Partial<AgentMessagePayload> = {}): AgentMessagePayload {
  return {
    message_id: overrides.message_id ?? 'msg-' + Math.random().toString(36).slice(2),
    to: overrides.to ?? TO,
    subject: overrides.subject,
    body: overrides.body ?? 'hello world',
    in_reply_to: overrides.in_reply_to,
    sent_at: overrides.sent_at ?? new Date().toISOString(),
  };
}

describe('AgentInbox', () => {
  let dir: string;
  let inbox: AgentInbox;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tlmcp-inbox-test-'));
    inbox = new AgentInbox(dir);
  });

  afterEach(() => {
    inbox.close();
    rmSync(dir, { recursive: true, force: true });
  });

  describe('store', () => {
    it('speichert eine neue Nachricht und liefert delivered', () => {
      const msg = makeMsg({ subject: 'hi', body: 'first message' });
      const result = inbox.store(FROM, msg);
      expect(result.status).toBe('delivered');
      expect(result.inbox_id).toBeGreaterThan(0);
    });

    it('Dedupe: gleiche message_id liefert duplicate', () => {
      const msg = makeMsg({ message_id: 'dup-123' });
      expect(inbox.store(FROM, msg).status).toBe('delivered');
      expect(inbox.store(FROM, msg).status).toBe('duplicate');
    });

    it('lehnt Nachricht ohne message_id ab', () => {
      const r = inbox.store(FROM, makeMsg({ message_id: '' }));
      expect(r.status).toBe('rejected');
      expect(r.reason).toMatch(/missing message_id/);
    });

    it('lehnt Body ueber 64 KB ab', () => {
      const big = 'x'.repeat(70_000);
      const r = inbox.store(FROM, makeMsg({ body: big }));
      expect(r.status).toBe('rejected');
      expect(r.reason).toMatch(/exceeds/);
    });

    it('lehnt Subject ueber 200 Zeichen ab', () => {
      const r = inbox.store(FROM, makeMsg({ subject: 'a'.repeat(201) }));
      expect(r.status).toBe('rejected');
    });

    it('akzeptiert JSON-Object Body und serialisiert', () => {
      const r = inbox.store(FROM, makeMsg({ body: { type: 'task', count: 5 } }));
      expect(r.status).toBe('delivered');
      const found = inbox.findByMessageId(makeMsg().message_id);
      // we can't reuse the random id; just check via list
      const all = inbox.list();
      expect(all).toHaveLength(1);
      expect(JSON.parse(all[0].body)).toEqual({ type: 'task', count: 5 });
    });
  });

  describe('list / unreadCount / markRead / archive', () => {
    it('list liefert in DESC-Reihenfolge nach received_at', async () => {
      inbox.store(FROM, makeMsg({ message_id: 'a' }));
      await new Promise((r) => setTimeout(r, 5));
      inbox.store(FROM, makeMsg({ message_id: 'b' }));
      await new Promise((r) => setTimeout(r, 5));
      inbox.store(FROM, makeMsg({ message_id: 'c' }));

      const all = inbox.list();
      expect(all.map((m) => m.message_id)).toEqual(['c', 'b', 'a']);
    });

    it('unread_only filtert markierte Nachrichten raus', () => {
      inbox.store(FROM, makeMsg({ message_id: 'r1' }));
      inbox.store(FROM, makeMsg({ message_id: 'r2' }));
      expect(inbox.markRead('r1')).toBe(true);

      expect(inbox.list({ unreadOnly: true }).map((m) => m.message_id)).toEqual(['r2']);
      // Both messages still listed (r1 just marked read), order is by received_at DESC
      const all = inbox.list().map((m) => m.message_id);
      expect(all).toHaveLength(2);
      expect(all).toContain('r1');
      expect(all).toContain('r2');
    });

    it('unreadCount zaehlt nur ungelesene + nicht-archivierte', () => {
      inbox.store(FROM, makeMsg({ message_id: '1' }));
      inbox.store(FROM, makeMsg({ message_id: '2' }));
      inbox.store(FROM, makeMsg({ message_id: '3' }));
      expect(inbox.unreadCount()).toBe(3);
      inbox.markRead('1');
      expect(inbox.unreadCount()).toBe(2);
      inbox.archive('2');
      expect(inbox.unreadCount()).toBe(1);
    });

    it('fromAgent-Filter liefert nur passende', () => {
      const OTHER = 'spiffe://thinklocal/host/cccc777788889999/agent/codex';
      inbox.store(FROM, makeMsg({ message_id: 'from-x' }));
      inbox.store(OTHER, makeMsg({ message_id: 'from-y' }));
      expect(inbox.list({ fromAgent: FROM }).map((m) => m.message_id)).toEqual(['from-x']);
      expect(inbox.list({ fromAgent: OTHER }).map((m) => m.message_id)).toEqual(['from-y']);
    });

    it('markRead idempotent — zweiter Aufruf liefert false', () => {
      inbox.store(FROM, makeMsg({ message_id: 'idem' }));
      expect(inbox.markRead('idem')).toBe(true);
      expect(inbox.markRead('idem')).toBe(false);
    });

    it('archive versteckt Nachricht aus Default-Liste, sichtbar mit include_archived', () => {
      inbox.store(FROM, makeMsg({ message_id: 'arc' }));
      inbox.archive('arc');
      expect(inbox.list().map((m) => m.message_id)).toEqual([]);
      expect(
        inbox.list({ includeArchived: true }).map((m) => m.message_id),
      ).toEqual(['arc']);
    });

    it('limit cap respektiert', () => {
      for (let i = 0; i < 10; i++) {
        inbox.store(FROM, makeMsg({ message_id: `n${i}` }));
      }
      expect(inbox.list({ limit: 3 })).toHaveLength(3);
    });
  });

  describe('persistence', () => {
    it('zweite Inbox-Instanz auf gleichem dataDir liest dieselben Daten', () => {
      inbox.store(FROM, makeMsg({ message_id: 'persist-1' }));
      inbox.close();

      const second = new AgentInbox(dir);
      expect(second.list().map((m) => m.message_id)).toEqual(['persist-1']);
      second.close();
    });
  });
});
