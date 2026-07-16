// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * websocket.ts — WebSocket-Server fuer Echtzeit-Dashboard-Updates
 *
 * Registriert eine WebSocket-Route auf /ws im Fastify-Server.
 * Jeder verbundene Client empfaengt alle MeshEvents als JSON.
 *
 * ADR-004 Phase 3: Erweitert um Agent-spezifische Subscriptions.
 * Clients koennen beim Connect oder per Message filtern:
 *
 *   ws://localhost:9440/ws?subscribe=inbox:new,peer:join
 *   ws://localhost:9440/ws?subscribe=inbox:new&agent=spiffe://...
 *
 * Oder per JSON-Message nach dem Connect:
 *   { "type": "subscribe", "events": ["inbox:new"], "agent": "spiffe://..." }
 *   { "type": "unsubscribe" }  // -> zurueck zu all-events
 *
 * Features:
 * - Automatisches Broadcast an alle Clients (default)
 * - Selective Subscriptions per Event-Typ
 * - Agent-ID Filter (nur Events die den Agent betreffen)
 * - Ping/Pong Heartbeat (30s)
 * - Client-Zaehler fuer Monitoring
 * - Graceful Disconnect-Handling
 */

import type { FastifyInstance } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import websocketPlugin from '@fastify/websocket';
import type { MeshEventBus, MeshEvent, MeshEventType } from './events.js';
import type { Logger } from 'pino';

/** Per-client subscription state */
interface ClientState {
  ws: WebSocket;
  /** If set, only these event types are forwarded. Empty = all events. */
  subscribedEvents: Set<MeshEventType>;
  /** If set, only events where data.to or data.from matches this agent. */
  agentFilter: string | null;
  /**
   * Ist die Verbindung von Loopback? Agent-gefilterte Subscriptions sind loopback-only
   * (Snooping-Schutz, TL-11). Am Connect aus `req.ip` gestempelt, damit der `subscribe`-Frame-
   * Pfad dieselbe Schranke durchsetzt wie der Query-Pfad (sonst umgehbar — TL-11 §8.1-Härtung).
   */
  isLoopback: boolean;
}

/** Loopback-IP-Test (IPv4, IPv6, IPv4-mapped-IPv6). */
function isLoopbackIp(ip: string | undefined): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

/**
 * Zentrale Loopback-only-Schranke für agent-gefilterte Subscriptions (TL-11, Snooping-Schutz):
 * ein **nicht-leerer** `agent`-Filter ist NUR von Loopback erlaubt. Wird von BEIDEN Pfaden benutzt —
 * Query (`?agent=`) am Connect UND `subscribe`-Frame — damit die Schranke nicht per Frame umgehbar ist
 * (§8.1-Härtung). Leerer/fehlender `agent` (= kein Filter / Filter löschen) ist immer erlaubt.
 */
function rejectsAgentFilter(agent: unknown, isLoopback: boolean): boolean {
  // Fail-closed: JEDER präsente, nicht-leere `agent`-Wert von Nicht-Loopback wird abgelehnt — auch ein
  // Array (`?agent=a&agent=b` → Fastify liefert ein Array) oder ein Nicht-String; sonst entstünde eine
  // Asymmetrie zum Query-Parser (CR-LOW L1). `null`/`undefined`/'' (= kein Filter / Filter löschen) ist erlaubt.
  return agent != null && agent !== '' && !isLoopback;
}

/**
 * Gerichtete (directed) Event-Typen (TL-11 Wake-Routing): werden **nur** an einen Client geliefert,
 * dessen `agentFilter` das Ziel matcht — **nie** an einen ungefilterten Client (deny-by-default). Das
 * schließt den `agent:wake`-Leak (Ziel-`instance_id` an alle Dashboards) und macht das Wake für den
 * adressierten Agenten routbar. Siehe `docs/architecture/TL-11-wake-routing.md`.
 */
const DIRECTED_EVENT_TYPES = new Set<MeshEventType>(['agent:wake']);

/**
 * Check whether a MeshEvent matches the client's subscription filter.
 */
function matchesSubscription(event: MeshEvent, state: ClientState): boolean {
  // Event-type filter
  if (state.subscribedEvents.size > 0 && !state.subscribedEvents.has(event.type)) {
    return false;
  }

  // Gerichtetes Event: deny-by-default. Ohne agentFilter NIE liefern (kein Leak an Ungefilterte);
  // mit agentFilter nur, wenn er die Ziel-Identität (`instance_id` ODER `spiffe_uri`) matcht.
  // Hinweis (CR-LOW): der Event-Typ-Filter oben greift zuerst — ein Wake-Konsument MUSS `agent:wake`
  // abonnieren (oder den Event-Filter weglassen), sonst wird sein Wake schon dort verworfen.
  if (DIRECTED_EVENT_TYPES.has(event.type)) {
    if (!state.agentFilter) return false;
    const { instance_id, spiffe_uri } = event.data as Record<string, string | undefined>;
    return state.agentFilter === instance_id || state.agentFilter === spiffe_uri;
  }

  // Agent filter: check if `to` or `from` in data matches
  if (state.agentFilter) {
    const { from, to, agentId, peer_id } = event.data as Record<string, string | undefined>;
    const target = state.agentFilter;
    if (from !== target && to !== target && agentId !== target && peer_id !== target) {
      return false;
    }
  }
  return true;
}

/**
 * Parse subscription from query string parameters.
 */
function parseQuerySubscription(query: Record<string, string | undefined>): {
  events: Set<MeshEventType>;
  agent: string | null;
} {
  const events = new Set<MeshEventType>();
  if (query.subscribe) {
    for (const e of query.subscribe.split(',')) {
      const trimmed = e.trim();
      if (trimmed) events.add(trimmed as MeshEventType);
    }
  }
  return {
    events,
    agent: query.agent ?? null,
  };
}

export async function registerWebSocket(
  server: FastifyInstance,
  eventBus: MeshEventBus,
  log?: Logger,
): Promise<void> {
  // Plugin registrieren
  await server.register(websocketPlugin);

  // Aktive WebSocket-Clients mit Subscription-State
  const clients = new Map<WebSocket, ClientState>();

  // Ping-Intervall (30s)
  const pingInterval = setInterval(() => {
    for (const [ws] of clients) {
      if (ws.readyState === ws.OPEN) {
        ws.ping();
      }
    }
  }, 30_000);

  // Server-Shutdown: Ping stoppen
  server.addHook('onClose', async () => {
    clearInterval(pingInterval);
    for (const [ws] of clients) {
      ws.close(1001, 'Server shutdown');
    }
    clients.clear();
  });

  // WebSocket-Route
  // CR Gemini Pro: WebSocket with agent-specific subscriptions needs access control.
  // Agent subscriptions (filter by SPIFFE-URI) are loopback-only to prevent snooping.
  // Dashboard connections (no agent filter) are allowed from mTLS-authenticated peers.
  server.get('/ws', { websocket: true }, (socket: WebSocket, req) => {
    // Parse initial subscription from query string
    const query = (req.query ?? {}) as Record<string, string | undefined>;

    // Agent-filtered subscriptions are loopback-only (prevent event snooping).
    // Am Connect einmal bestimmen; derselbe Wert gilt für den Query-Pfad HIER und den
    // späteren `subscribe`-Frame-Pfad (ClientState.isLoopback) — sonst ließe sich die
    // Schranke per Frame umgehen (TL-11 §8.1-Härtung).
    const isLocal = isLoopbackIp(req.ip);
    if (rejectsAgentFilter(query.agent, isLocal)) {
      log?.warn({ ip: req.ip, agent: query.agent }, 'WebSocket agent-filter rejected: not loopback');
      socket.close(4003, 'Agent-filtered subscriptions are loopback-only');
      return;
    }
    const initial = parseQuerySubscription(query);

    const state: ClientState = {
      ws: socket,
      subscribedEvents: initial.events,
      agentFilter: initial.agent,
      isLoopback: isLocal,
    };
    clients.set(socket, state);

    log?.info(
      {
        clients: clients.size,
        subscribed: initial.events.size > 0 ? [...initial.events] : 'all',
        agentFilter: initial.agent,
      },
      'WebSocket-Client verbunden',
    );

    // Willkommensnachricht
    socket.send(JSON.stringify({
      type: 'system:connected',
      timestamp: new Date().toISOString(),
      data: {
        message: 'Connected to thinklocal-mcp mesh',
        subscription: initial.events.size > 0 ? [...initial.events] : 'all',
        agentFilter: initial.agent,
      },
    }));

    // Client-Messages: subscribe/unsubscribe
    socket.on('message', (raw: Buffer | string) => {
      try {
        const msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf-8'));
        if (msg.type === 'subscribe') {
          // Loopback-only-Schranke wie am Query-Pfad (dieselbe reine Regel): ein Nicht-Loopback-Client
          // darf keinen agent-Filter per Frame setzen (sonst Snooping fremder directed Events). VOR
          // jeder State-Mutation prüfen, damit ein abgelehnter Frame den Client nicht halb-
          // umkonfiguriert zurücklässt. Leerer `agent` (= Filter löschen) ist erlaubt.
          if (rejectsAgentFilter(msg.agent, state.isLoopback)) {
            log?.warn({ ip: req.ip, agent: msg.agent }, 'WebSocket agent-filter (frame) rejected: not loopback');
            socket.close(4003, 'Agent-filtered subscriptions are loopback-only');
            return;
          }
          state.subscribedEvents.clear();
          if (Array.isArray(msg.events)) {
            for (const e of msg.events) {
              if (typeof e === 'string') state.subscribedEvents.add(e as MeshEventType);
            }
          }
          if (typeof msg.agent === 'string') {
            state.agentFilter = msg.agent;
          }
          socket.send(JSON.stringify({
            type: 'system:subscribed',
            timestamp: new Date().toISOString(),
            data: {
              events: [...state.subscribedEvents],
              agentFilter: state.agentFilter,
            },
          }));
          log?.debug(
            { events: [...state.subscribedEvents], agent: state.agentFilter },
            'WebSocket subscription updated',
          );
        } else if (msg.type === 'unsubscribe') {
          state.subscribedEvents.clear();
          state.agentFilter = null;
          socket.send(JSON.stringify({
            type: 'system:subscribed',
            timestamp: new Date().toISOString(),
            data: { events: 'all', agentFilter: null },
          }));
        }
      } catch {
        // Ignoriere ungueltige Messages (z.B. Pong-Frames)
      }
    });

    // Disconnect-Handler
    socket.on('close', () => {
      clients.delete(socket);
      log?.debug({ clients: clients.size }, 'WebSocket-Client getrennt');
    });

    socket.on('error', (err: Error) => {
      log?.warn({ err: err.message }, 'WebSocket-Fehler');
      clients.delete(socket);
    });
  });

  // Alle Mesh-Events an WebSocket-Clients broadcasten (mit Subscription-Filter)
  eventBus.onAny((event: MeshEvent) => {
    if (clients.size === 0) return;

    const payload = JSON.stringify(event);
    for (const [ws, state] of clients) {
      if (ws.readyState === ws.OPEN && matchesSubscription(event, state)) {
        ws.send(payload);
      }
    }
  });

  log?.info('WebSocket-Server registriert auf /ws');
}

// Export for testing
export { matchesSubscription, parseQuerySubscription, rejectsAgentFilter, isLoopbackIp, type ClientState };
