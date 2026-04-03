import { useCallback, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, type Peer, type Capability } from '../api.ts';
import { usePolling } from '../hooks/usePolling.ts';

/** Agent-Detail-Ansicht: Skills, Health, Verbindungen, Audit fuer einen einzelnen Agent */
export function AgentDetailView() {
  const { agentId } = useParams<{ agentId: string }>();
  const decodedId = decodeURIComponent(agentId ?? '');

  const fetchPeers = useCallback(() => api.getPeers(), []);
  const fetchCaps = useCallback(() => api.getCapabilities(), []);
  const fetchAudit = useCallback(() => api.getAudit(20), []);

  const { data: peersData } = usePolling(fetchPeers, 5_000);
  const { data: capsData } = usePolling(fetchCaps, 10_000);
  const { data: auditData } = usePolling(fetchAudit, 10_000);

  const peer = useMemo(() => {
    return peersData?.peers?.find((p: Peer) => p.agent_id === decodedId);
  }, [peersData, decodedId]);

  const capabilities = useMemo(() => {
    return capsData?.capabilities?.filter((c: Capability) => c.agent_id === decodedId) ?? [];
  }, [capsData, decodedId]);

  const auditEvents = useMemo(() => {
    return auditData?.events?.filter(
      (e) => e.agent_id === decodedId || e.peer_id === decodedId,
    ) ?? [];
  }, [auditData, decodedId]);

  const shortId = (id: string) => id.match(/agent\/(.+)$/)?.[1] ?? id.slice(-20);

  if (!peer) {
    return (
      <div>
        <Link to="/" style={{ color: 'var(--accent)', textDecoration: 'none', fontSize: '0.875rem' }}>
          &larr; Zurueck zur Topologie
        </Link>
        <div className="card" style={{ marginTop: '1rem', textAlign: 'center', padding: '2rem' }}>
          <p style={{ color: 'var(--text-secondary)' }}>Agent nicht gefunden: {shortId(decodedId)}</p>
        </div>
      </div>
    );
  }

  const card = peer.agent_card;
  const health = card?.health;

  return (
    <div>
      <Link to="/" style={{ color: 'var(--accent)', textDecoration: 'none', fontSize: '0.875rem' }}>
        &larr; Zurueck zur Topologie
      </Link>

      {/* Header */}
      <div className="card" style={{ marginTop: '1rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700 }}>
              {peer.name}
              <span className={`badge badge-${peer.status}`} style={{ marginLeft: '0.75rem' }}>
                {peer.status}
              </span>
            </h2>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
              {decodedId}
            </p>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
              {peer.host}:{peer.port} | Version {card?.version ?? '?'}
            </p>
          </div>
          <div style={{ textAlign: 'right', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            <p>Zuletzt gesehen: {new Date(peer.last_seen).toLocaleTimeString('de-DE')}</p>
          </div>
        </div>
      </div>

      {/* Health */}
      {health && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <h3 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.75rem' }}>System-Health</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1.5rem' }}>
            <Gauge label="CPU" value={health.cpu_percent} />
            <Gauge label="RAM" value={health.memory_percent} />
            <Gauge label="Disk" value={health.disk_percent} />
            <Metric label="Uptime" value={formatUptime(health.uptime_seconds)} />
          </div>
        </div>
      )}

      {/* Capabilities */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.75rem' }}>
          Capabilities ({capabilities.length})
        </h3>
        {capabilities.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {capabilities.map((c: Capability) => (
              <div key={c.skill_id} style={{
                background: 'var(--bg-primary)', border: '1px solid var(--border)',
                borderRadius: '0.5rem', padding: '0.5rem 0.75rem', fontSize: '0.8125rem',
              }}>
                <div style={{ fontWeight: 600 }}>{c.skill_id}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  v{c.version} | {c.category} |{' '}
                  <span className={`badge badge-${c.health}`}>{c.health}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Keine Capabilities registriert</p>
        )}
      </div>

      {/* Audit-Events fuer diesen Agent */}
      <div className="card">
        <h3 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.75rem' }}>
          Letzte Audit-Events ({auditEvents.length})
        </h3>
        {auditEvents.length > 0 ? (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
            <thead>
              <tr>
                <th style={thStyle}>Zeit</th>
                <th style={thStyle}>Typ</th>
                <th style={thStyle}>Details</th>
              </tr>
            </thead>
            <tbody>
              {auditEvents.slice(0, 10).map((e) => (
                <tr key={e.id}>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap', fontSize: '0.75rem' }}>
                    {new Date(e.timestamp).toLocaleTimeString('de-DE')}
                  </td>
                  <td style={tdStyle}><span style={{ fontWeight: 600 }}>{e.event_type}</span></td>
                  <td style={{ ...tdStyle, color: 'var(--text-secondary)' }}>{e.details ?? '--'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Keine Events fuer diesen Agent</p>
        )}
      </div>
    </div>
  );
}

function Gauge({ label, value }: { label: string; value: number }) {
  const color = value > 90 ? 'var(--danger)' : value > 70 ? 'var(--warning)' : 'var(--success)';
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: '1.5rem', fontWeight: 700, color }}>{value}%</div>
      <div style={{ height: '4px', background: 'var(--border)', borderRadius: '2px', margin: '0.25rem 0' }}>
        <div style={{ height: '100%', width: `${Math.min(100, value)}%`, background: color, borderRadius: '2px' }} />
      </div>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{label}</div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{label}</div>
    </div>
  );
}

function formatUptime(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--border)',
  color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase',
};
const tdStyle: React.CSSProperties = { padding: '0.375rem 0.75rem', borderBottom: '1px solid var(--border)' };
