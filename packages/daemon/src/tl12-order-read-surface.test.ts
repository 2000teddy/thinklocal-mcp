// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * tl12-order-read-surface.test.ts — TL-12 Slice A (ADR-038), S5 „Read-Surface": der signierte Auftrag wird
 * beim **Lesen** über `GET /api/inbox` **live re-verifiziert** — fail-closed, wirft nie.
 *
 * WELCHE LÜCKE DIESE DATEI SCHLIESST
 * ----------------------------------
 * `verifyStoredOrder` (die reine Re-Verify-Funktion) ist in `agent-inbox.test.ts` gut bewacht — inklusive
 * eines Byte-Flip-Tamper-Falls. Aber der **Read-Surface-Endpunkt** (`inbox-api.ts` `GET /api/inbox`, S5 des
 * Zustellpfads) war für Aufträge nur mittelbar getestet: die vorhandenen inbox-api-Tests decken send/Filter/
 * ACL, **nicht** das `order`-Surfacing (`is_order` + `verify_verdict`) und **nicht** die zentrale Zusage aus
 * `inbox-api.ts:382`:
 *   „ein auf der Platte manipulierter Auftrag zeigt hier `INVALID` … eine bösartige Zeile legt die Liste
 *    nicht lahm."
 * Diese Datei bewacht genau diese Zusage **am HTTP-Rand, den der Konsument tatsächlich liest** — mit einer
 * **echten** On-Disk-Manipulation (zweite SQLite-Verbindung auf dieselbe `inbox.db`, so wie ein Angreifer mit
 * Plattenzugriff), nicht bloß einem hand-getamperten Objekt.
 *
 * ABGRENZUNG: **S6 (Abarbeitung) ist NICHT Gegenstand** — owner-gated, nicht gebaut. Hier geht es allein um
 * das Lese-Verdikt (S5). Keine Ausführung, kein Executor/Ledger, kein Gate-Vorgriff.
 */
import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { Buffer } from 'node:buffer';
import Database from 'better-sqlite3';
import { AgentInbox, type OrderContext } from './agent-inbox.js';
import type { AgentMessagePayload } from './messages.js';
import { registerInboxApi } from './inbox-api.js';
import { buildOrderEnvelope, signOrder, orderKeyId } from './signed-order.js';

const FROM = 'spiffe://thinklocal/host/aaaa111122223333/agent/codex';
const OWN_ID = 'spiffe://thinklocal/host/bbbb444455556666/agent/claude-code';
const TO = `${OWN_ID}/instance/alpha`;

function keypair(): { priv: string; pub: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { priv: privateKey as string, pub: publicKey as string };
}

function makeMsg(overrides: Partial<AgentMessagePayload> = {}): AgentMessagePayload {
  return {
    message_id: overrides.message_id ?? 'msg-x',
    to: overrides.to ?? TO,
    subject: overrides.subject,
    body: overrides.body ?? 'hello world',
    in_reply_to: overrides.in_reply_to,
    sent_at: overrides.sent_at ?? '2026-07-25T00:00:00.000Z',
  };
}

/** Ein wohlgeformter, gültig signierter Auftrag samt VALID-`OrderContext` (wie am Ingest berechnet). */
function validOrder(nonce = 'nonce-42'): { ctx: OrderContext & { verdict: 'VALID' } } {
  const { priv, pub } = keypair();
  const env = buildOrderEnvelope(FROM, nonce, { action: 'restart' });
  const bytes = signOrder(env, priv);
  return {
    ctx: {
      verdict: 'VALID',
      signedBytes: bytes,
      signerSpiffe: FROM,
      signerKeyid: orderKeyId(pub),
      signerPubkey: pub,
      orderNonce: nonce,
    },
  };
}

interface Harness {
  server: FastifyInstance;
  inbox: AgentInbox;
  dbFile: string;
  cleanup: () => Promise<void>;
}

async function buildHarness(): Promise<Harness> {
  const tmp = mkdtempSync(join(tmpdir(), 'tlmcp-tl12-readsurface-'));
  const inbox = new AgentInbox(tmp);
  const mesh = { getPeer: () => undefined } as unknown as Parameters<typeof registerInboxApi>[1]['mesh'];
  const server: FastifyInstance = Fastify({ logger: false });
  registerInboxApi(server, {
    inbox,
    mesh,
    ownAgentId: OWN_ID,
    ownPublicKeyPem: '-----dummy-----',
    ownPrivateKeyPem: '-----dummy-----',
  });
  await server.ready();
  return {
    server,
    inbox,
    dbFile: resolve(tmp, 'inbox', 'inbox.db'),
    cleanup: async (): Promise<void> => {
      await server.close();
      inbox.close();
      rmSync(tmp, { recursive: true, force: true });
    },
  };
}

interface InboxRow {
  message_id: string;
  is_order: boolean;
  order: {
    verify_verdict: string;
    signer_spiffe: string;
    signer_keyid: string;
    order_nonce: string;
  } | null;
}

/** GET /api/inbox via inject (kein Socket) → geparster Body. */
async function getInbox(
  server: FastifyInstance,
): Promise<{ statusCode: number; count: number; messages: InboxRow[] }> {
  const res = await server.inject({ method: 'GET', url: '/api/inbox' });
  const body = res.json() as { count: number; messages: InboxRow[] };
  return { statusCode: res.statusCode, count: body.count, messages: body.messages };
}

/**
 * Simuliert eine **On-Disk-Manipulation** des gespeicherten Auftrags: eine ZWEITE SQLite-Verbindung auf
 * dieselbe `inbox.db` kippt ein Byte in `signed_bytes` (WAL erlaubt den Fremd-Writer). Genau das, was ein
 * Angreifer mit Plattenzugriff täte — der `verify_verdict`-Spaltenwert bleibt „VALID", die Signatur passt
 * aber nicht mehr, also MUSS das Live-Re-Verify beim Lesen `INVALID` liefern.
 */
function tamperStoredOrderOnDisk(dbFile: string, messageId: string): void {
  const db = new Database(dbFile);
  try {
    const row = db.prepare('SELECT signed_bytes AS b FROM messages WHERE message_id = ?').get(messageId) as
      | { b: Buffer | null }
      | undefined;
    if (row?.b == null) throw new Error(`kein signed_bytes für ${messageId} — Testannahme verletzt`);
    const buf = Buffer.from(row.b);
    buf[buf.length - 2] ^= 0xff; // ein Byte kippen ⇒ Signatur bricht
    db.prepare('UPDATE messages SET signed_bytes = ? WHERE message_id = ?').run(buf, messageId);
  } finally {
    db.close();
  }
}

let h: Harness;
afterEach(async () => {
  await h.cleanup();
});

describe('TL-12 S5 Read-Surface: GET /api/inbox re-verifiziert signierte Aufträge live', () => {
  it('gültiger Auftrag → is_order=true, order.verify_verdict=VALID, Provenienz surfaced', async () => {
    h = await buildHarness();
    h.inbox.store(FROM, makeMsg({ message_id: 'ord-1' }), validOrder().ctx);

    const { statusCode, count, messages } = await getInbox(h.server);
    expect(statusCode).toBe(200);
    expect(count).toBe(1);
    expect(messages[0].is_order).toBe(true);
    expect(messages[0].order).not.toBeNull();
    expect(messages[0].order?.verify_verdict).toBe('VALID');
    expect(messages[0].order?.signer_spiffe).toBe(FROM);
    expect(messages[0].order?.order_nonce).toBe('nonce-42');
  });

  it('On-Disk-Manipulation: gespeichert als VALID, aber die Bytes gekippt → Read-Surface zeigt INVALID (inbox-api.ts:382)', async () => {
    h = await buildHarness();
    h.inbox.store(FROM, makeMsg({ message_id: 'ord-tampered' }), validOrder().ctx);

    // Vor der Manipulation: das Live-Verdikt ist VALID.
    const before = await getInbox(h.server);
    expect(before.messages[0].order?.verify_verdict).toBe('VALID');

    // Auf der Platte manipulieren (zweite Verbindung) …
    tamperStoredOrderOnDisk(h.dbFile, 'ord-tampered');

    // … das Live-Re-Verify beim Lesen fängt es: VALID → INVALID, ohne dass der Endpunkt bricht.
    const after = await getInbox(h.server);
    expect(after.statusCode).toBe(200);
    expect(after.messages[0].is_order).toBe(true);
    expect(after.messages[0].order?.verify_verdict).toBe('INVALID');
  });

  it('fail-closed-Loop: eine manipulierte Auftragszeile legt die Liste nicht lahm (Plain + Order kommen beide)', async () => {
    h = await buildHarness();
    h.inbox.store(FROM, makeMsg({ message_id: 'ord-bad', sent_at: '2026-07-25T00:00:01.000Z' }), validOrder().ctx);
    h.inbox.store(FROM, makeMsg({ message_id: 'plain-1', body: 'kein Auftrag', sent_at: '2026-07-25T00:00:02.000Z' }));

    tamperStoredOrderOnDisk(h.dbFile, 'ord-bad');

    const { statusCode, count, messages } = await getInbox(h.server);
    expect(statusCode).toBe(200);
    expect(count).toBe(2); // die bösartige Zeile verschluckt die andere NICHT
    const bad = messages.find((m) => m.message_id === 'ord-bad');
    const plain = messages.find((m) => m.message_id === 'plain-1');
    expect(bad?.order?.verify_verdict).toBe('INVALID');
    expect(plain?.is_order).toBe(false);
    expect(plain?.order).toBeNull();
  });
});
