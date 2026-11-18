// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * inbox-api-ack-reason.test.ts — `ack_reason` auf der Sendeseite.
 *
 * Design-Notiz: `docs/architecture/ack-reason-propagation-2026-11-18.md`
 * Auslöser (gemessen 18.11.2026): die Zustellung an ThinkHub02 lieferte zweimal
 * `ack_status: 'rejected'` OHNE Grund — der Grund (`sender not in pairing store`)
 * stand nur im Log des Empfängers. Die Diagnose brauchte einen SSH-Login dort.
 *
 * Der Remote-Pfad wird hier mit gemocktem `undici.fetch` und einem ECHT
 * signierten ACK-Envelope gefahren (EC P-256 + `createSign('SHA256')`, wie
 * `identity.ts:246`). `inbox-api-adr005.test.ts` deckt nur den Loopback-Pfad ab.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';

const fetchMock = vi.fn();
vi.mock('undici', () => ({
  fetch: (...args: unknown[]): unknown => fetchMock(...args),
  // `Agent` wird von inbox-api.ts nur als Typ verwendet (`tlsDispatcher?: UndiciAgent`),
  // der Wert wird nie instanziiert — ein Platzhalter genügt.
  Agent: function UndiciAgentStub(): void {
    /* nie aufgerufen */
  },
}));

const { AgentInbox } = await import('./agent-inbox.js');
const { registerInboxApi } = await import('./inbox-api.js');
const { MessageType, createEnvelope, encodeAndSign, serializeSignedMessage } =
  await import('./messages.js');
const OWN_ID = 'spiffe://thinklocal/node/12D3KooWownNodeAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const PEER_ID = 'spiffe://thinklocal/node/12D3KooWpeerNodeBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

/** EC P-256 Schlüsselpaar des Peers — das ACK wird damit echt signiert. */
const peerKeys = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

/** Baut ein signiertes AGENT_MESSAGE_ACK, wie es der Empfänger-Daemon schickt. */
function buildAck(
  messageId: string,
  status: 'delivered' | 'rejected',
  reason?: unknown,
  signWith: string = peerKeys.privateKey,
): Uint8Array {
  const payload: Record<string, unknown> = {
    message_id: messageId,
    received_at: new Date().toISOString(),
    status,
  };
  if (reason !== undefined) payload['reason'] = reason;
  const envelope = createEnvelope(MessageType.AGENT_MESSAGE_ACK, PEER_ID, payload, {
    ttl_ms: 60_000,
  });
  return serializeSignedMessage(encodeAndSign(envelope, signWith));
}

/**
 * Antwort-Objekt mit genau den Feldern, die `inbox-api.ts` vom fetch liest.
 *
 * ACHTUNG: `serializeSignedMessage` liefert einen Node-`Buffer`. Dessen
 * `.buffer` ist der GEPOOLTE ArrayBuffer (und `Buffer.prototype.slice` gibt
 * einen View darauf zurück, keine Kopie) — `bytes.slice().buffer` liefert
 * deshalb Fremdbytes und das CBOR-Decode scheitert mit
 * „Data read, but end of buffer not reached". `new Uint8Array(bytes)` kopiert
 * in einen exakt passenden Puffer.
 */
/** Fremdes Schlüsselpaar — signiert ein ACK, das die Verifikation NICHT passiert. */
const fremdKeys = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

interface AckResponseStub {
  ok: boolean;
  status: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
  text: () => Promise<string>;
}

function ackResponse(bytes: Uint8Array): AckResponseStub {
  const copy = new Uint8Array(bytes);
  return {
    ok: true,
    status: 200,
    arrayBuffer: async (): Promise<ArrayBuffer> => copy.buffer,
    text: async (): Promise<string> => '',
  };
}

interface LogSpy {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
}

/** Erstes Argument des Log-Aufrufs mit der ACK-Meldung (CR MEDIUM-2). */
function ackLogObject(log: LogSpy): Record<string, unknown> | undefined {
  const call = log.info.mock.calls.find(
    (c: unknown[]) => c[1] === 'AGENT_MESSAGE + ACK verifiziert',
  );
  return call?.[0] as Record<string, unknown> | undefined;
}

async function buildServer(): Promise<{
  server: FastifyInstance;
  log: LogSpy;
  cleanup: () => Promise<void>;
}> {
  const tmp = mkdtempSync(join(tmpdir(), 'tlmcp-ack-reason-'));
  const inbox = new AgentInbox(tmp);
  const mesh = {
    getPeer: (id: string) =>
      id === PEER_ID
        ? {
            agentId: PEER_ID,
            endpoint: 'https://10.0.0.9:9440',
            agentCard: { publicKey: peerKeys.publicKey },
          }
        : undefined,
  } as unknown as Parameters<typeof registerInboxApi>[1]['mesh'];
  const server: FastifyInstance = Fastify({ logger: false });
  // CR MEDIUM-2: ohne `log` wird der geaenderte `log?.info(...)`-Aufruf wegen
  // Optional Chaining nie ausgefuehrt — das neue Log-Feld waere ungetestet.
  const log: LogSpy = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  registerInboxApi(server, {
    inbox,
    mesh,
    ownAgentId: OWN_ID,
    ownPublicKeyPem: peerKeys.publicKey,
    ownPrivateKeyPem: peerKeys.privateKey,
    log: log as unknown as Parameters<typeof registerInboxApi>[1]['log'],
  });
  await server.ready();
  return {
    server,
    log,
    cleanup: async (): Promise<void> => {
      await server.close();
      inbox.close();
      rmSync(tmp, { recursive: true, force: true });
    },
  };
}

async function send(server: FastifyInstance, to: string): ReturnType<FastifyInstance['inject']> {
  return server.inject({
    method: 'POST',
    url: '/api/inbox/send',
    payload: { to, body: 'probe', subject: 'probe' },
    remoteAddress: '127.0.0.1',
  });
}

describe('inbox-api — ack_reason durchreichen', () => {
  let ctx: Awaited<ReturnType<typeof buildServer>>;

  beforeEach(async () => {
    fetchMock.mockReset();
    ctx = await buildServer();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it('T1: rejected + reason ⇒ ack_status und ack_reason in der Antwort', async () => {
    fetchMock.mockImplementation(async (_url: string, init: { body: Buffer }) => {
      // message_id aus dem gesendeten Envelope ist hier nicht nötig: der
      // Empfänger echot sie, geprüft wird nur die Durchreichung des Grundes.
      expect(init.body).toBeInstanceOf(Buffer);
      return ackResponse(buildAck('irrelevant', 'rejected', 'sender not in pairing store'));
    });

    const res = await send(ctx.server, PEER_ID);
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body['delivery']).toBe('remote');
    expect(body['ack_verified']).toBe(true);
    expect(body['ack_status']).toBe('rejected');
    expect(body['ack_reason']).toBe('sender not in pairing store');
    // CR MEDIUM-2: das Log-Feld ist Teil der Spezifikation, also auch geprüft.
    expect(ackLogObject(ctx.log)?.['ack_reason']).toBe('sender not in pairing store');
  });

  it('T2: rejected OHNE reason ⇒ kein ack_reason, HTTP 200 (Rückwärtskompatibilität)', async () => {
    // Deckt die heute im Mesh laufenden älteren Builds ab (e3acc1a, cec4f96,
    // 842cd7b, a16b475), die nur `status` im ACK setzen.
    fetchMock.mockResolvedValue(ackResponse(buildAck('irrelevant', 'rejected')));

    const res = await send(ctx.server, PEER_ID);
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body['ack_status']).toBe('rejected');
    expect('ack_reason' in body).toBe(false);
    // CR LOW-3: auch im Log-Objekt darf der Key dann nicht auftauchen.
    const logged = ackLogObject(ctx.log);
    expect(logged).toBeDefined();
    expect('ack_reason' in (logged ?? {})).toBe(false);
  });

  it('T3: delivered ⇒ Antwortobjekt unverändert, kein ack_reason', async () => {
    fetchMock.mockResolvedValue(ackResponse(buildAck('irrelevant', 'delivered')));

    const res = await send(ctx.server, PEER_ID);
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(
      [
        'ack_status',
        'ack_verified',
        'delivery',
        'message_id',
        'peer_status',
        'sent_at',
        'status',
      ].sort(),
    );
    expect(body['ack_status']).toBe('delivered');
    expect(Object.keys(ackLogObject(ctx.log) ?? {}).sort()).toEqual(
      ['ack_status', 'ack_verified', 'message_id', 'to'].sort(),
    );
  });

  it('T4: Loopback-Pfad bleibt unverändert (kein fetch, kein ack_reason)', async () => {
    const res = await send(ctx.server, OWN_ID);
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body['delivery']).toBe('loopback');
    expect(body['inbox_status']).toBe('delivered');
    expect('ack_reason' in body).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('T5: Fremdtext wird entschärft — keine Steuerzeichen, max 200 Zeichen', async () => {
    const boshaft =
      'abgelehnt\n{"level":30,"msg":"gefaelscht"}\u001b[31mrot\u0000' + 'x'.repeat(400);
    fetchMock.mockResolvedValue(ackResponse(buildAck('irrelevant', 'rejected', boshaft)));

    const res = await send(ctx.server, PEER_ID);
    const reason = (res.json() as Record<string, unknown>)['ack_reason'] as string;
    expect(typeof reason).toBe('string');
    // CR LOW-4: exakte Grenze statt `<=` — sonst waere auch Laenge 1 gruen.
    expect(Array.from(reason).length).toBe(200);
    // eslint-disable-next-line no-control-regex
    expect(/[\u0000-\u001f\u007f]/.test(reason)).toBe(false);
    expect(reason).not.toContain('\n');
    // Zeilenumbruch wird zu EINEM Leerzeichen, nicht ersatzlos entfernt (CR MEDIUM-1.3):
    expect(reason.startsWith('abgelehnt {"level":30')).toBe(true);
  });

  it('T5b: nicht-String oder leerer reason ⇒ Feld fehlt', async () => {
    fetchMock.mockResolvedValue(ackResponse(buildAck('irrelevant', 'rejected', { boeser: 'typ' })));
    const res1 = await send(ctx.server, PEER_ID);
    expect('ack_reason' in (res1.json() as Record<string, unknown>)).toBe(false);

    fetchMock.mockResolvedValue(ackResponse(buildAck('irrelevant', 'rejected', '   \u0000  ')));
    const res2 = await send(ctx.server, PEER_ID);
    expect('ack_reason' in (res2.json() as Record<string, unknown>)).toBe(false);
  });
  it('T6: ACK mit fremdem Schlüssel signiert ⇒ ack_verified false, KEIN ack_reason (CR LOW-4)', async () => {
    // Sicherheitsgrenze: ein `reason` darf NIE durchgereicht werden, wenn die
    // ACK-Signaturprüfung fehlschlägt — sonst könnte ein Dritter Text in unsere
    // Antwort und unser Log schreiben.
    fetchMock.mockResolvedValue(
      ackResponse(buildAck('irrelevant', 'rejected', 'spoofed', fremdKeys.privateKey)),
    );

    const res = await send(ctx.server, PEER_ID);
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body['ack_verified']).toBe(false);
    expect('ack_reason' in body).toBe(false);
    expect(body['ack_status']).toBeUndefined();
  });

  it('T7: C1-Steuerzeichen, BiDi-Overrides und Unicode-Trenner werden entfernt (CR MEDIUM-1)', async () => {
    // U+009B = 8-Bit-CSI (wirkt wie `ESC [`), U+0085 = NEL, U+2028 = LINE SEPARATOR,
    // U+202E = RIGHT-TO-LEFT OVERRIDE, U+2066 = LEFT-TO-RIGHT ISOLATE.
    const boshaft = 'a\u009b31mrot\u0085zwei\u2028drei\u202eturhcsmu\u2066x';
    fetchMock.mockResolvedValue(ackResponse(buildAck('irrelevant', 'rejected', boshaft)));

    const reason = (await send(ctx.server, PEER_ID)).json()['ack_reason'] as string;
    expect(/[\u0080-\u009f\u202a-\u202e\u2066-\u2069]/.test(reason)).toBe(false);
    // U+0085 und U+2028 wirken als Zeilentrenner ⇒ je EIN Leerzeichen.
    // U+009B/U+202E/U+2066 sind KEINE Trenner ⇒ ersatzlos entfernt, die
    // Nachbarzeichen stossen dabei zusammen ("drei"+"turhcsmu").
    expect(reason).toBe('a31mrot zwei dreiturhcsmux');
  });

  it('T8: ZWNJ/ZWJ bleiben erhalten — sie sind echter Text, kein Steuerzeichen', async () => {
    // U+200C in persischer Schrift, U+200D in einer Emoji-ZWJ-Sequenz. Ein zu
    // breiter Filter würde hier fremde Schriften und Emoji verstümmeln.
    const echt = 'می\u200cخوانم 👨\u200d💻';
    fetchMock.mockResolvedValue(ackResponse(buildAck('irrelevant', 'rejected', echt)));

    const reason = (await send(ctx.server, PEER_ID)).json()['ack_reason'] as string;
    expect(reason).toBe(echt);
  });

  it('T9: Kürzen schneidet kein Surrogatpaar auf — Ergebnis bleibt gültiges UTF-16', async () => {
    // 199 ASCII-Zeichen + Emoji (Nicht-BMP, 2 Code-Units) an der Grenze: ein
    // `slice()` auf Code-Units hätte hier ein halbes Surrogatpaar erzeugt.
    const grenze = 'a'.repeat(199) + '🖨' + 'b'.repeat(50);
    fetchMock.mockResolvedValue(ackResponse(buildAck('irrelevant', 'rejected', grenze)));

    const reason = (await send(ctx.server, PEER_ID)).json()['ack_reason'] as string;
    expect(Array.from(reason).length).toBe(200);
    expect(reason.endsWith('🖨')).toBe(true);
    expect(reason.isWellFormed()).toBe(true);
  });
});
