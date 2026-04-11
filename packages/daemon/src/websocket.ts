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
}

/**
 * Check whether a MeshEvent matches the client's subscription filter.
 */
function matchesSubscription(event: MeshEvent, state: ClientState): boolean {
  // Event-type filter
  if (state.subscribedEvents.size > 0 && !state.subscribedEvents.has(event.type)) {
    return false;
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

    // Agent-filtered subscriptions are loopback-only (prevent event snooping)
    if (query.agent) {
      const ip = req.ip;
      const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
      if (!isLocal) {
        log?.warn({ ip, agent: query.agent }, 'WebSocket agent-filter rejected: not loopback');
        socket.close(4003, 'Agent-filtered subscriptions are loopback-only');
        return;
      }
    }
    const initial = parseQuerySubscription(query);

    const state: ClientState = {
      ws: socket,
      subscribedEvents: initial.events,
      agentFilter: initial.agent,
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
export { matchesSubscription, parseQuerySubscription, type ClientState };
