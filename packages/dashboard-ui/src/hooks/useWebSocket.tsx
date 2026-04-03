import { useState, useEffect, useCallback, useRef } from 'react';

export interface MeshEvent {
  type: string;
  timestamp: string;
  data: Record<string, unknown>;
}

/**
 * WebSocket-Hook fuer Echtzeit-Events vom Daemon.
 * Reconnectet automatisch bei Verbindungsverlust.
 */
export function useWebSocket() {
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<MeshEvent | null>(null);
  const [events, setEvents] = useState<MeshEvent[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const connect = useCallback(() => {
    try {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
      };

      ws.onmessage = (msg) => {
        try {
          const event = JSON.parse(msg.data as string) as MeshEvent;
          setLastEvent(event);
          setEvents((prev) => [event, ...prev].slice(0, 200)); // Max 200 Events
        } catch {
          // Ignoriere ungueltige Nachrichten
        }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        // Reconnect nach 3 Sekunden
        reconnectTimer.current = setTimeout(connect, 3_000);
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      // Reconnect bei Fehler
      reconnectTimer.current = setTimeout(connect, 3_000);
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { connected, lastEvent, events };
}
