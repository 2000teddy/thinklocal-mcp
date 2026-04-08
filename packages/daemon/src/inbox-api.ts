/**
 * inbox-api.ts — REST-Endpoints fuer Agent-to-Agent Messaging.
 *
 * Stellt die folgenden Routes bereit:
 *
 *   POST /api/inbox/send       — Sendet eine Nachricht an einen Mesh-Peer
 *   GET  /api/inbox            — Listet eingehende Nachrichten (Inbox)
 *   POST /api/inbox/mark-read  — Markiert eine Nachricht als gelesen
 *   POST /api/inbox/archive    — Archiviert eine Nachricht (soft delete)
 *   GET  /api/inbox/unread     — Zaehlt ungelesene Nachrichten
 *
 * Wird vom MCP-Stdio-Server (mcp-stdio.ts) aufgerufen, um Agenten wie
 * Claude Code und Codex direkten Zugriff auf das Mesh-Messaging zu geben.
 *
 * Die `send`-Route baut intern einen signierten MessageEnvelope und schickt
 * ihn via mTLS an den Ziel-Peer (analog zu gossip.ts).
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { Agent as UndiciAgent, fetch } from 'undici';
import {
  MessageType,
  createEnvelope,
  encodeAndSign,
  serializeSignedMessage,
  type AgentMessagePayload,
} from './messages.js';
import type { AgentInbox } from './agent-inbox.js';
import type { MeshManager } from './mesh.js';
import type { Logger } from 'pino';

export interface InboxApiDeps {
  inbox: AgentInbox;
  mesh: MeshManager;
  ownAgentId: string;
  ownPublicKeyPem: string;
  ownPrivateKeyPem: string;
  tlsDispatcher?: UndiciAgent;
  log?: Logger;
}

interface SendBody {
  to: string;
  body: string | Record<string, unknown>;
  subject?: string;
  in_reply_to?: string;
}

const MAX_BODY_BYTES = 64 * 1024;

export function registerInboxApi(server: FastifyInstance, deps: InboxApiDeps): void {
  const { inbox, mesh, ownAgentId, ownPrivateKeyPem, tlsDispatcher, log } = deps;

  // ---- POST /api/inbox/send ----
  server.post('/api/inbox/send', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as SendBody | undefined;
    if (!body || typeof body !== 'object') {
      return reply.code(400).send({ error: 'missing JSON body' });
    }
    if (!body.to || typeof body.to !== 'string') {
      return reply.code(400).send({ error: 'missing or invalid `to` (target SPIFFE-URI)' });
    }
    if (body.body === undefined || body.body === null) {
      return reply.code(400).send({ error: 'missing `body`' });
    }

    const bodyStr = typeof body.body === 'string' ? body.body : JSON.stringify(body.body);
    if (Buffer.byteLength(bodyStr, 'utf-8') > MAX_BODY_BYTES) {
      return reply.code(413).send({ error: `body exceeds ${MAX_BODY_BYTES} bytes` });
    }
    if (body.subject && body.subject.length > 200) {
      return reply.code(400).send({ error: 'subject exceeds 200 chars' });
    }

    // Find target peer
    const peer = mesh.getPeer(body.to);
    if (!peer || !peer.endpoint) {
      return reply.code(404).send({
        error: 'peer not found in mesh',
        target: body.to,
        hint: 'Use discover_peers to see known agents',
      });
    }

    // Build payload
    const messageId = randomUUID();
    const payload: AgentMessagePayload = {
      message_id: messageId,
      to: body.to,
      subject: body.subject,
      body: body.body,
      in_reply_to: body.in_reply_to,
      sent_at: new Date().toISOString(),
    };

    // Sign and serialize
    const envelope = createEnvelope(MessageType.AGENT_MESSAGE, ownAgentId, payload, {
      ttl_ms: 60_000,
    });
    const signed = encodeAndSign(envelope, ownPrivateKeyPem);
    const wireBody = serializeSignedMessage(signed);

    try {
      const res = await fetch(`${peer.endpoint}/message`, {
        method: 'POST',
        headers: { 'content-type': 'application/cbor' },
        body: Buffer.from(wireBody),
        signal: AbortSignal.timeout(10_000),
        dispatcher: tlsDispatcher,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return reply.code(502).send({
          error: 'peer rejected message',
          status: res.status,
          detail: text.slice(0, 500),
        });
      }

      // ACK kommt als CBOR-Envelope zurueck, aber wir werten hier nur HTTP 2xx aus.
      // Volle Signaturpruefung des ACK ist Phase 2 (braucht Peer-PublicKey-Lookup).
      log?.info(
        { to: body.to, message_id: messageId, subject: body.subject ?? null },
        'AGENT_MESSAGE gesendet',
      );

      return {
        status: 'sent',
        message_id: messageId,
        sent_at: payload.sent_at,
        peer_status: res.status,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log?.warn({ to: body.to, err: msg }, 'AGENT_MESSAGE konnte nicht zugestellt werden');
      return reply.code(502).send({
        error: 'send failed',
        detail: msg,
      });
    }
  });

  // ---- GET /api/inbox ----
  server.get('/api/inbox', async (request: FastifyRequest) => {
    const query = request.query as Record<string, string | undefined>;
    const messages = inbox.list({
      unreadOnly: query['unread'] === 'true',
      fromAgent: query['from'] || undefined,
      limit: query['limit'] ? Number(query['limit']) : undefined,
      includeArchived: query['include_archived'] === 'true',
    });
    return {
      count: messages.length,
      unread_total: inbox.unreadCount(),
      messages: messages.map((m) => ({
        message_id: m.message_id,
        from: m.from_agent,
        to: m.to_agent,
        subject: m.subject,
        body: tryParseJson(m.body),
        in_reply_to: m.in_reply_to,
        sent_at: m.sent_at,
        received_at: m.received_at,
        read: m.read_at !== null,
        read_at: m.read_at,
      })),
    };
  });

  // ---- POST /api/inbox/mark-read ----
  server.post('/api/inbox/mark-read', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { message_id?: string } | undefined;
    if (!body?.message_id) {
      return reply.code(400).send({ error: 'missing message_id' });
    }
    const ok = inbox.markRead(body.message_id);
    return { status: ok ? 'marked_read' : 'not_found_or_already_read', message_id: body.message_id };
  });

  // ---- POST /api/inbox/archive ----
  server.post('/api/inbox/archive', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { message_id?: string } | undefined;
    if (!body?.message_id) {
      return reply.code(400).send({ error: 'missing message_id' });
    }
    const ok = inbox.archive(body.message_id);
    return { status: ok ? 'archived' : 'not_found', message_id: body.message_id };
  });

  // ---- GET /api/inbox/unread ----
  server.get('/api/inbox/unread', async (request: FastifyRequest) => {
    const query = request.query as Record<string, string | undefined>;
    return { unread_count: inbox.unreadCount(query['from'] || undefined) };
  });
}

function tryParseJson(s: string): unknown {
  try {
    const parsed = JSON.parse(s);
    return typeof parsed === 'object' ? parsed : s;
  } catch {
    return s;
  }
}
