import { useCallback } from 'react';
import { api, type AuditEvent } from '../api.ts';
import { usePolling } from '../hooks/usePolling.ts';

const EVENT_COLORS: Record<string, string> = {
  PEER_JOIN: 'var(--success)',
  PEER_LEAVE: 'var(--danger)',
  HEARTBEAT: 'var(--text-secondary)',
  CAPABILITY_QUERY: 'var(--accent)',
  TASK_DELEGATE: 'var(--warning)',
  CREDENTIAL_ACCESS: '#a855f7',
};

/** Audit-Log-Ansicht mit Event-Liste und CSV-Export */
export function AuditView() {
  const fetchAudit = useCallback(() => api.getAudit(100), []);
  const { data, loading } = usePolling(fetchAudit, 10_000);

  const handleExportCsv = () => {
    window.open('/api/audit?format=csv&limit=500', '_blank');
  };

  const events = data?.events ?? [];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>
          Audit-Log
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginLeft: '0.75rem' }}>
            {data?.count ?? 0} / {data?.total ?? 0} Events
          </span>
        </h2>
        <button
          onClick={handleExportCsv}
          style={{
            background: 'transparent',
            color: 'var(--accent)',
            border: '1px solid var(--accent)',
            padding: '0.375rem 1rem',
            borderRadius: '0.375rem',
            fontSize: '0.8125rem',
            cursor: 'pointer',
          }}
        >
          CSV Export
        </button>
      </div>

      <div className="card" style={{ overflow: 'auto' }}>
        {loading && events.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '2rem' }}>
            Lade Audit-Events...
          </p>
        ) : events.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '2rem' }}>
            Keine Audit-Events vorhanden
          </p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
            <thead>
              <tr>
                <th style={thStyle}>#</th>
                <th style={thStyle}>Zeit</th>
                <th style={thStyle}>Typ</th>
                <th style={thStyle}>Agent</th>
                <th style={thStyle}>Peer</th>
                <th style={thStyle}>Details</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event: AuditEvent) => (
                <tr key={event.id}>
                  <td style={tdStyle}>{event.id}</td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap', fontSize: '0.75rem' }}>
                    {formatTime(event.timestamp)}
                  </td>
                  <td style={tdStyle}>
                    <span style={{
                      color: EVENT_COLORS[event.event_type] ?? 'var(--text-secondary)',
                      fontWeight: 600,
                      fontSize: '0.75rem',
                    }}>
                      {event.event_type}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, fontSize: '0.75rem' }}>{shortId(event.agent_id)}</td>
                  <td style={{ ...tdStyle, fontSize: '0.75rem' }}>{event.peer_id ? shortId(event.peer_id) : '--'}</td>
                  <td style={{ ...tdStyle, color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                    {event.details ?? '--'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function shortId(id: string): string {
  const match = id.match(/agent\/(.+)$/);
  return match ? match[1] : id.slice(-16);
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '0.5rem 0.75rem',
  borderBottom: '1px solid var(--border)',
  color: 'var(--text-secondary)',
  fontSize: '0.75rem',
  fontWeight: 600,
  textTransform: 'uppercase',
};

const tdStyle: React.CSSProperties = {
  padding: '0.375rem 0.75rem',
  borderBottom: '1px solid var(--border)',
};
