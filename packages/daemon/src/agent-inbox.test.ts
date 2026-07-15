// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { Buffer } from 'node:buffer';
import Database from 'better-sqlite3';
import { AgentInbox, type OrderContext, type InboxMessage } from './agent-inbox.js';
import type { AgentMessagePayload } from './messages.js';
import { buildOrderEnvelope, signOrder, orderKeyId } from './signed-order.js';

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
      // (random id, daher Prüfung über list statt findByMessageId)
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

  // ── ADR-038 (TL-12 Slice A): signierte, re-verifizierbare Aufträge ──
  describe('signierte Aufträge (ADR-038)', () => {
    function keypair(): { priv: string; pub: string } {
      const { privateKey, publicKey } = generateKeyPairSync('ec', {
        namedCurve: 'P-256',
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });
      return { priv: privateKey as string, pub: publicKey as string };
    }
    function validOrder(): { ctx: OrderContext & { verdict: 'VALID' }; pub: string; bytes: Uint8Array } {
      const { priv, pub } = keypair();
      const env = buildOrderEnvelope(FROM, 'nonce-42', { action: 'restart' });
      const bytes = signOrder(env, priv);
      return {
        pub,
        bytes,
        ctx: {
          verdict: 'VALID',
          signedBytes: bytes,
          signerSpiffe: FROM,
          signerKeyid: orderKeyId(pub),
          signerPubkey: pub,
          orderNonce: 'nonce-42',
        },
      };
    }

    it('VALID: persistiert is_order=1 + Provenienz-Spalten, re-verify aus der Zeile → VALID', () => {
      const { ctx, bytes } = validOrder();
      const r = inbox.store(FROM, makeMsg({ message_id: 'ord-1', body: 'irrelevant' }), ctx);
      expect(r.status).toBe('delivered');
      const row = inbox.list()[0] as InboxMessage;
      expect(row.is_order).toBe(1);
      expect(row.signer_spiffe).toBe(FROM);
      expect(row.order_nonce).toBe('nonce-42');
      expect(row.verify_verdict).toBe('VALID');
      expect(row.trust_status).toBe('unknown');
      // BLOB-Roundtrip MUSS byte-identisch sein (sonst bricht die Signatur „Wochen später").
      expect(Buffer.compare(row.signed_bytes as Buffer, Buffer.from(bytes))).toBe(0);
      // Re-Verify aus der gespeicherten Zeile (gegen den immutable signer_pubkey).
      expect(inbox.verifyStoredOrder(row).verdict).toBe('VALID');
    });

    it('INVALID (Marker vorhanden, Verify fehlgeschlagen): is_order=0 + verify_verdict=INVALID (Audit-Signal)', () => {
      const r = inbox.store(FROM, makeMsg({ message_id: 'ord-bad' }), { verdict: 'INVALID' });
      expect(r.status).toBe('delivered');
      const row = inbox.list()[0] as InboxMessage;
      expect(row.is_order).toBe(0);
      expect(row.verify_verdict).toBe('INVALID');
      expect(row.signed_bytes).toBeNull();
      expect(inbox.verifyStoredOrder(row).verdict).toBe('INVALID');
    });

    it('Plain-Nachricht (kein order-Arg): is_order=0, alle Order-Spalten NULL, re-verify → INVALID', () => {
      inbox.store(FROM, makeMsg({ message_id: 'plain-1', body: 'hi' }));
      const row = inbox.list()[0] as InboxMessage;
      expect(row.is_order).toBe(0);
      expect(row.signer_pubkey).toBeNull();
      expect(row.verify_verdict).toBeNull();
      expect(inbox.verifyStoredOrder(row).verdict).toBe('INVALID');
    });

    it('re-verify fail-closed bei beschädigten gespeicherten Bytes (wirft nicht)', () => {
      const { ctx } = validOrder();
      const tampered = Buffer.from(ctx.signedBytes);
      tampered[tampered.length - 2] ^= 0xff;
      const verdict = inbox.verifyStoredOrder({
        is_order: 1,
        signed_bytes: tampered,
        signer_spiffe: ctx.signerSpiffe,
        signer_pubkey: ctx.signerPubkey,
      });
      expect(verdict.verdict).toBe('INVALID');
    });
  });

  describe('Schema-Migration v2 → v3 (ADR-038)', () => {
    it('migriert eine bestehende v2-DB additiv: Bestandszeile bleibt, is_order=0', () => {
      const migDir = mkdtempSync(join(tmpdir(), 'tlmcp-inbox-mig-'));
      const inboxSub = join(migDir, 'inbox');
      mkdirSync(inboxSub, { recursive: true });
      // Eine v2-DB von Hand anlegen (v2-Schema + user_version=2 + eine Bestandszeile).
      const db = new Database(join(inboxSub, 'inbox.db'));
      db.exec(`
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
      `);
      db.prepare(
        `INSERT INTO messages (message_id, from_agent, to_agent, subject, body, sent_at, received_at)
         VALUES ('legacy-1', ?, ?, 'old', 'legacy body', ?, ?)`,
      ).run(FROM, TO, new Date().toISOString(), new Date().toISOString());
      db.pragma('user_version = 2');
      db.close();

      // Öffnen mit v3-Code → migriert additiv.
      const migrated = new AgentInbox(migDir);
      const rows = migrated.list();
      expect(rows.map((m) => m.message_id)).toEqual(['legacy-1']);
      const legacy = rows[0] as InboxMessage;
      expect(legacy.is_order).toBe(0);
      expect(legacy.signed_bytes).toBeNull();
      migrated.close();
      rmSync(migDir, { recursive: true, force: true });
    });
  });
});
