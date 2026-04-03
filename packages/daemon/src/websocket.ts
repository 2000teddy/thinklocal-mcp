/**
 * websocket.ts — WebSocket-Server fuer Echtzeit-Dashboard-Updates
 *
 * Registriert eine WebSocket-Route auf /ws im Fastify-Server.
 * Jeder verbundene Client empfaengt alle MeshEvents als JSON.
 *
 * Features:
 * - Automatisches Broadcast an alle Clients
 * - Ping/Pong Heartbeat (30s)
 * - Client-Zaehler fuer Monitoring
 * - Graceful Disconnect-Handling
 */

import type { FastifyInstance } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import websocketPlugin from '@fastify/websocket';
import type { MeshEventBus, MeshEvent } from './events.js';
import type { Logger } from 'pino';

export async function registerWebSocket(
  server: FastifyInstance,
  eventBus: MeshEventBus,
  log?: Logger,
): Promise<void> {
  // Plugin registrieren
  await server.register(websocketPlugin);

  // Aktive WebSocket-Clients
  const clients = new Set<WebSocket>();

  // Ping-Intervall (30s)
  const pingInterval = setInterval(() => {
    for (const ws of clients) {
      if (ws.readyState === ws.OPEN) {
        ws.ping();
      }
    }
  }, 30_000);

  // Server-Shutdown: Ping stoppen
  server.addHook('onClose', async () => {
    clearInterval(pingInterval);
    for (const ws of clients) {
      ws.close(1001, 'Server shutdown');
    }
    clients.clear();
  });

  // WebSocket-Route
  server.get('/ws', { websocket: true }, (socket: WebSocket) => {
    clients.add(socket);
    log?.info({ clients: clients.size }, 'WebSocket-Client verbunden');

    // Willkommensnachricht
    socket.send(JSON.stringify({
      type: 'system:connected',
      timestamp: new Date().toISOString(),
      data: { message: 'Connected to thinklocal-mcp mesh', clients: clients.size },
    }));

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

  // Alle Mesh-Events an WebSocket-Clients broadcasten
  eventBus.onAny((event: MeshEvent) => {
    if (clients.size === 0) return;

    const payload = JSON.stringify(event);
    for (const ws of clients) {
      if (ws.readyState === ws.OPEN) {
        ws.send(payload);
      }
    }
  });

  log?.info('WebSocket-Server registriert auf /ws');
}
