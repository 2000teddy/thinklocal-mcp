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
  deserializeSignedMessage,
  decodeAndVerify,
  type AgentMessagePayload,
  type AgentMessageAckPayload,
} from './messages.js';
import type { AgentInbox } from './agent-inbox.js';
import type { MeshManager } from './mesh.js';
import type { RateLimiter } from './ratelimit.js';
import type { Logger } from 'pino';
import { normalizeAgentId, SpiffeUriError, SPIFFE_COMPONENT_REGEX } from './spiffe-uri.js';
import type { MeshEventBus } from './events.js';
import type { AgentRegistry } from './agent-registry.js';

export interface InboxApiDeps {
  inbox: AgentInbox;
  mesh: MeshManager;
  ownAgentId: string;
  ownPublicKeyPem: string;
  ownPrivateKeyPem: string;
  tlsDispatcher?: UndiciAgent;
  rateLimiter?: RateLimiter;
  log?: Logger;
  /** ADR-004 Phase 3: EventBus fuer inbox:new Push-Notifications */
  eventBus?: MeshEventBus;
  /** Broadcast-Pattern: Agent-Registry fuer instance/* fanout */
  agentRegistry?: AgentRegistry;
  /**
   * Audit-Hook (optional). Wird mit dem outbound message_id aufgerufen,
   * damit AGENT_MESSAGE_TX in das audit-log laeuft.
   */
  onSent?: (messageId: string, to: string) => void;
}

interface SendBody {
  to: string;
  body: string | Record<string, unknown>;
  subject?: string;
  in_reply_to?: string;
}

const MAX_BODY_BYTES = 64 * 1024;
const MAX_LIMIT = 500;

/**
 * Pruefen ob Aufrufer eine lokale (loopback) Connection hat.
 *
 * SECURITY (PR #79 GPT-5.4 retro CRITICAL): Die Inbox-Routes sind nur fuer
 * den lokalen MCP-Stdio-Server gedacht (Codex/Claude auf demselben Host).
 * Remote-Inbox-Zugriff wuerde die Daemon-Signatur als Oracle verfuegbar
 * machen: /api/inbox/send nutzt ownPrivateKeyPem um Envelopes zu signieren,
 * jeder Aufrufer kann dann Nachrichten als "ich selbst" senden.
 *
 * Deshalb: requireLocal() rejectet non-loopback Aufrufer mit 403, bevor
 * irgendwelche Inbox-Operationen ausgefuehrt werden.
 */
function requireLocal(request: FastifyRequest, reply: FastifyReply): boolean {
  const ip = request.ip;
  const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  if (!isLocal) {
    void reply.code(403).send({ error: 'inbox API is local-only', remote: ip });
    return false;
  }
  return true;
}

/**
 * ADR-005: centralised validation for the `for_instance` query
 * parameter. Both `GET /api/inbox` and `GET /api/inbox/unread`
 * accept it, so the same regex gate lives here instead of being
 * duplicated at each call site. (Gemini-Pro CR 2026-04-09, LOW.)
 *
 * Uses `SPIFFE_COMPONENT_REGEX` imported from `spiffe-uri.ts` so
 * the API-layer validation stays in lock-step with the core URI
 * parser. Any drift would create an asymmetric write/read hole
 * (Gemini-Pro PC finding 2026-04-09, HIGH — caught mid-fix).
 */
function validateInstanceParam(
  instance: string | undefined,
  reply: FastifyReply,
): boolean {
  if (instance !== undefined && !SPIFFE_COMPONENT_REGEX.test(instance)) {
    void reply.code(400).send({
      error: `for_instance must match ${SPIFFE_COMPONENT_REGEX.source}`,
    });
    return false;
  }
  return true;
}

export function registerInboxApi(server: FastifyInstance, deps: InboxApiDeps): void {
  const { inbox, mesh, ownAgentId, ownPrivateKeyPem, tlsDispatcher, rateLimiter, log, eventBus, agentRegistry, onSent } = deps;

  /**
   * Rate-Limiting Gate. Nutzt den vorhandenen RateLimiter aus dem Daemon
   * (falls uebergeben), mit Caller-IP als Key. Verhindert, dass ein
   * kompromittierter/fehlerhafter MCP-Client den Inbox-SQLite flooden kann.
   */
  function checkRate(request: FastifyRequest, reply: FastifyReply, op: string): boolean {
    if (!rateLimiter) return true;
    const key = `inbox:${op}:${request.ip}`;
    if (!rateLimiter.allow(key)) {
      void reply.code(429).send({ error: 'Too Many Requests', op });
      return false;
    }
    return true;
  }

  // ---- POST /api/inbox/send ----
  server.post('/api/inbox/send', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireLocal(request, reply)) return;
    if (!checkRate(request, reply, 'send')) return;
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

    // ADR-005: normalise the target so the loopback-check and peer
    // lookup both work on the 3-component (cert-attested) form,
    // independent of whether the caller passed an `/instance/<id>`
    // tail. Without this, a send to
    //     spiffe://thinklocal/host/X/agent/Y/instance/alpha
    // against an own agent id of
    //     spiffe://thinklocal/host/X/agent/Y
    // would fall through to the remote peer path and fail with 404.
    // (GPT-5.4 gotcha, consensus 2026-04-08.)
    let normalizedTo: string;
    try {
      normalizedTo = normalizeAgentId(body.to);
    } catch (err) {
      const msg = err instanceof SpiffeUriError ? err.message : String(err);
      return reply.code(400).send({ error: `invalid target SPIFFE-URI: ${msg}` });
    }

    const bodyStr = typeof body.body === 'string' ? body.body : JSON.stringify(body.body);
    if (Buffer.byteLength(bodyStr, 'utf-8') > MAX_BODY_BYTES) {
      return reply.code(413).send({ error: `body exceeds ${MAX_BODY_BYTES} bytes` });
    }
    if (body.subject && body.subject.length > 200) {
      return reply.code(400).send({ error: 'subject exceeds 200 chars' });
    }

    // Build payload first (we need it for both loopback and remote paths)
    const messageId = randomUUID();
    const payload: AgentMessagePayload = {
      message_id: messageId,
      to: body.to,
      subject: body.subject,
      body: body.body,
      in_reply_to: body.in_reply_to,
      sent_at: new Date().toISOString(),
    };

    // ---- BROADCAST PATH ----
    if (body.to.endsWith('/instance/*') && agentRegistry) {
      const instances = agentRegistry.list();
      const results: Array<{ instance_id: string; status: string }> = [];
      for (const inst of instances) {
        const targetPayload: AgentMessagePayload = {
          ...payload,
          message_id: randomUUID(),
          to: `${normalizedTo}/instance/${inst.instanceId}`,
        };
        inbox.store(ownAgentId, targetPayload);
        results.push({ instance_id: inst.instanceId, status: 'delivered' });
      }
      log?.info(
        { to: body.to, fanout: results.length, subject: body.subject ?? null },
        'AGENT_MESSAGE broadcast to all instances',
      );
      eventBus?.emit('inbox:new', {
        from: ownAgentId, message_id: messageId, subject: body.subject ?? null,
        to: body.to, broadcast: true, fanout: results.length,
      });
      return { status: 'sent', delivery: 'broadcast', message_id: messageId, sent_at: payload.sent_at, fanout: results };
    }

    // ---- LOOPBACK PATH ----
    // Multiple agents (Claude Code, Codex, Gemini CLI, ...) can share one
    // daemon. They all see the same SPIFFE-URI from the daemon's perspective.
    // When an agent sends to its own daemon's URI, we MUST NOT route through
    // the network — there's no peer to talk to. We store the message directly
    // in the local inbox so the recipient (= a sibling agent on the same host)
    // can read it via read_inbox.
    //
    // ADR-005: compare against the normalised 3-component URI so a
    // 4-component target like `spiffe://…/agent/claude-code/instance/alpha`
    // also resolves to loopback when alpha runs on this daemon.
    if (normalizedTo === ownAgentId) {
      const result = inbox.store(ownAgentId, payload);
      log?.info(
        {
          to: body.to,
          normalized_to: normalizedTo,
          message_id: messageId,
          subject: body.subject ?? null,
          mode: 'loopback',
        },
        'AGENT_MESSAGE loopback (sibling-agent on same daemon)',
      );
      onSent?.(messageId, body.to);
      // ADR-004 Phase 3: Push-Notification fuer loopback-Zustellung
      if (result.status === 'delivered') {
        eventBus?.emit('inbox:new', {
          from: ownAgentId,
          message_id: messageId,
          subject: body.subject ?? null,
          to: body.to,
        });
      }
      return {
        status: 'sent',
        delivery: 'loopback',
        message_id: messageId,
        sent_at: payload.sent_at,
        inbox_status: result.status,
      };
    }

    // ---- REMOTE PEER PATH ----
    // Use the normalised URI for peer lookup — the mesh key is the
    // 3-component daemon URI, not the 4-component instance URI.
    const peer = mesh.getPeer(normalizedTo);
    if (!peer || !peer.endpoint) {
      return reply.code(404).send({
        error: 'peer not found in mesh',
        target: body.to,
        hint: 'Use discover_peers to see known agents',
      });
    }

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

      // ACK-Signaturpruefung: Peer-PublicKey aus AgentCard + Envelope decode.
      let ackVerified = false;
      let ackStatus: string | undefined;
      try {
        const ackBody = new Uint8Array(await res.arrayBuffer());
        const peerInfo = mesh.getPeer(normalizedTo);
        const peerPublicKey = peerInfo?.agentCard?.publicKey;
        if (peerPublicKey && ackBody.length > 0) {
          const signed = deserializeSignedMessage(ackBody);
          const ackEnvelope = decodeAndVerify(signed, peerPublicKey);
          if (!ackEnvelope) throw new Error('ACK signature verification failed');
          const ackPayload = ackEnvelope.payload as AgentMessageAckPayload;
          ackVerified = true;
          ackStatus = ackPayload.status;
          log?.info({ to: body.to, message_id: messageId, ack_status: ackPayload.status, ack_verified: true }, 'AGENT_MESSAGE gesendet + ACK verifiziert');
        } else {
          log?.info({ to: body.to, message_id: messageId }, 'AGENT_MESSAGE gesendet (ACK nicht verifiziert)');
        }
      } catch (ackErr) {
        log?.warn({ to: body.to, message_id: messageId, err: ackErr instanceof Error ? ackErr.message : String(ackErr) }, 'ACK-Signatur ungueltig');
      }
      onSent?.(messageId, body.to);
      return { status: 'sent', delivery: 'remote', message_id: messageId, sent_at: payload.sent_at, peer_status: res.status, ack_verified: ackVerified, ack_status: ackStatus };
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
  //
  // ADR-005 query parameters:
  //   for_instance    — limit results to messages addressed to this
  //                     4th-component instance id. Omit to see all.
  //   include_legacy  — include pre-migration (NULL) rows when
  //                     for_instance is set. Default: false.
  server.get('/api/inbox', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireLocal(request, reply)) return;
    if (!checkRate(request, reply, 'list')) return;
    const query = request.query as Record<string, string | undefined>;

    // SECURITY (GPT-5.4 retro MEDIUM): validate limit to prevent large SQLite reads
    let limit: number | undefined;
    if (query['limit']) {
      const parsed = Number(query['limit']);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
        return reply.code(400).send({ error: `limit must be integer in [1, ${MAX_LIMIT}]` });
      }
      limit = parsed;
    }

    // ADR-005: validate for_instance to defend against SQL injection via
    // query params. The instance id is stored as an opaque token in
    // SQLite, but a hostile value would still poison the prepared-
    // statement placeholder cache, so we reject anything not matching
    // our canonical regex before reaching the store layer.
    const forInstance = query['for_instance'];
    if (!validateInstanceParam(forInstance, reply)) return;
    const includeLegacy = query['include_legacy'] === 'true';

    const messages = inbox.list({
      unreadOnly: query['unread'] === 'true',
      fromAgent: query['from'] || undefined,
      limit,
      includeArchived: query['include_archived'] === 'true',
      forInstance,
      includeLegacy,
    });
    return {
      count: messages.length,
      unread_total: inbox.unreadCount(),
      for_instance: forInstance ?? null,
      include_legacy: includeLegacy,
      messages: messages.map((m) => ({
        message_id: m.message_id,
        from: m.from_agent,
        to: m.to_agent,
        to_instance: m.to_agent_instance,
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
    if (!requireLocal(request, reply)) return;
    if (!checkRate(request, reply, 'mark-read')) return;
    const body = request.body as { message_id?: string } | undefined;
    if (!body?.message_id) {
      return reply.code(400).send({ error: 'missing message_id' });
    }
    const ok = inbox.markRead(body.message_id);
    return { status: ok ? 'marked_read' : 'not_found_or_already_read', message_id: body.message_id };
  });

  // ---- POST /api/inbox/archive ----
  server.post('/api/inbox/archive', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireLocal(request, reply)) return;
    if (!checkRate(request, reply, 'archive')) return;
    const body = request.body as { message_id?: string } | undefined;
    if (!body?.message_id) {
      return reply.code(400).send({ error: 'missing message_id' });
    }
    const ok = inbox.archive(body.message_id);
    return { status: ok ? 'archived' : 'not_found', message_id: body.message_id };
  });

  // ---- GET /api/inbox/unread ----
  //
  // ADR-005: accepts `for_instance` + `include_legacy` query params,
  // same semantics as GET /api/inbox. Back-compat: `from=<uri>` still
  // filters by sender.
  server.get('/api/inbox/unread', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireLocal(request, reply)) return;
    if (!checkRate(request, reply, 'unread')) return;
    const query = request.query as Record<string, string | undefined>;
    const forInstance = query['for_instance'];
    if (!validateInstanceParam(forInstance, reply)) return;
    const includeLegacy = query['include_legacy'] === 'true';
    return {
      unread_count: inbox.unreadCount({
        fromAgent: query['from'] || undefined,
        forInstance,
        includeLegacy,
      }),
    };
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
