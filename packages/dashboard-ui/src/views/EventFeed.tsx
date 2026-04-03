import type { MeshEvent } from '../hooks/useWebSocket.tsx';

const EVENT_ICONS: Record<string, string> = {
  'peer:join': '🟢',
  'peer:leave': '🔴',
  'peer:heartbeat': '💓',
  'task:created': '📋',
  'task:accepted': '✅',
  'task:completed': '🎉',
  'task:failed': '❌',
  'capability:registered': '🧩',
  'capability:synced': '🔄',
  'skill:announced': '📢',
  'skill:installed': '📦',
  'audit:new': '📝',
  'system:startup': '🚀',
  'system:shutdown': '⏹️',
  'system:connected': '🔗',
};

interface EventFeedProps {
  events: MeshEvent[];
  connected: boolean;
}

/** Live-Event-Feed: Echtzeit-Stream aller Mesh-Events via WebSocket */
export function EventFeed({ events, connected }: EventFeedProps) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>
          Live-Events
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginLeft: '0.75rem' }}>
            {events.length} Events
          </span>
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{
            width: '10px',
            height: '10px',
            borderRadius: '50%',
            background: connected ? 'var(--success)' : 'var(--danger)',
            display: 'inline-block',
            animation: connected ? 'pulse 2s infinite' : 'none',
          }} />
          <span style={{ fontSize: '0.8125rem', color: connected ? 'var(--success)' : 'var(--danger)' }}>
            {connected ? 'Verbunden' : 'Getrennt — Reconnecting...'}
          </span>
        </div>
      </div>

      <div className="card" style={{ maxHeight: '70vh', overflow: 'auto' }}>
        {events.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '2rem' }}>
            {connected ? 'Warte auf Events...' : 'Keine Verbindung zum Daemon'}
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {events.map((event, i) => (
              <div key={`${event.timestamp}-${i}`} style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.75rem',
                padding: '0.5rem 0.75rem',
                background: i === 0 ? 'rgba(59, 130, 246, 0.08)' : 'transparent',
                borderRadius: '0.375rem',
                fontSize: '0.8125rem',
                transition: 'background 0.3s',
              }}>
                <span style={{ fontSize: '1rem', flexShrink: 0 }}>
                  {EVENT_ICONS[event.type] ?? '📌'}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                      {event.type}
                    </span>
                    <span style={{ fontSize: '0.6875rem', color: 'var(--text-secondary)', flexShrink: 0 }}>
                      {formatTime(event.timestamp)}
                    </span>
                  </div>
                  {Object.keys(event.data).length > 0 && (
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginTop: '0.125rem' }}>
                      {formatData(event.data)}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('de-DE', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function formatData(data: Record<string, unknown>): string {
  return Object.entries(data)
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' | ');
}
