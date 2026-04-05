import { useState, useEffect, useCallback, useRef } from 'react';
import type { MeshEvent } from '../hooks/useWebSocket.tsx';

export interface Toast {
  id: number;
  message: string;
  type: 'info' | 'success' | 'warning' | 'danger';
  timestamp: number;
}

/** Wandelt ein MeshEvent in eine Toast-Notification um (oder null wenn irrelevant) */
function eventToToast(event: MeshEvent): Omit<Toast, 'id' | 'timestamp'> | null {
  const data = event.data;
  switch (event.type) {
    case 'peer:join':
      return { message: `Peer beigetreten: ${data['agentId'] ?? 'unknown'}`, type: 'success' };
    case 'peer:leave':
      return { message: `Peer offline: ${data['agentId'] ?? 'unknown'}`, type: 'danger' };
    case 'task:completed':
      return { message: `Task abgeschlossen: ${data['skillId'] ?? ''}`, type: 'success' };
    case 'task:failed':
      return { message: `Task fehlgeschlagen: ${data['skillId'] ?? ''}`, type: 'danger' };
    case 'system:startup':
      return { message: `Daemon gestartet`, type: 'info' };
    case 'system:shutdown':
      return { message: `Daemon gestoppt`, type: 'warning' };
    default:
      return null; // Heartbeats, capability:synced etc. erzeugen keine Toasts
  }
}

const MAX_TOASTS = 5;
const DISMISS_MS = 6000;

/** Hook fuer Toast-Notifications basierend auf MeshEvents */
export function useToasts(lastEvent: MeshEvent | null) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const nextId = useRef(1);

  // Cleanup aller Timer bei Unmount
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timerId) => clearTimeout(timerId));
      timers.clear();
    };
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timerId = timersRef.current.get(id);
    if (timerId) {
      clearTimeout(timerId);
      timersRef.current.delete(id);
    }
  }, []);

  useEffect(() => {
    if (!lastEvent) return;
    const toastInfo = eventToToast(lastEvent);
    if (!toastInfo) return;

    const newToast: Toast = { ...toastInfo, id: nextId.current++, timestamp: Date.now() };

    setToasts((prev) => {
      const updated = [...prev, newToast];
      // Bei Ueberschreitung: Timer des aeltesten Toasts aufraeumen
      if (updated.length > MAX_TOASTS) {
        const oldest = updated[0];
        const oldTimer = timersRef.current.get(oldest.id);
        if (oldTimer) {
          clearTimeout(oldTimer);
          timersRef.current.delete(oldest.id);
        }
        return updated.slice(-MAX_TOASTS);
      }
      return updated;
    });

    // Auto-Dismiss Timer — jeder Toast hat seinen eigenen
    const timer = setTimeout(() => dismiss(newToast.id), DISMISS_MS);
    timersRef.current.set(newToast.id, timer);
  }, [lastEvent, dismiss]);

  return { toasts, dismiss };
}

const typeColors: Record<Toast['type'], string> = {
  info: 'var(--accent)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
};

/** Toast-Container (rechts oben positioniert) */
export function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;

  return (
    <div style={{
      position: 'fixed',
      top: '1rem',
      right: '1rem',
      zIndex: 200,
      display: 'flex',
      flexDirection: 'column',
      gap: '0.5rem',
      maxWidth: '360px',
    }}>
      {toasts.map((toast) => (
        <div
          key={toast.id}
          onClick={() => onDismiss(toast.id)}
          style={{
            padding: '0.75rem 1rem',
            background: 'var(--bg-card)',
            border: `1px solid ${typeColors[toast.type]}`,
            borderLeft: `4px solid ${typeColors[toast.type]}`,
            borderRadius: '0.5rem',
            color: 'var(--text-primary)',
            fontSize: '0.8125rem',
            cursor: 'pointer',
            boxShadow: '0 4px 12px var(--shadow)',
            animation: 'slideIn 0.25s ease',
          }}
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}
