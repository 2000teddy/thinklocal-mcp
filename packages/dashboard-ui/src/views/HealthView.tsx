import { useCallback } from 'react';
import { api, type Peer } from '../api.ts';
import { usePolling } from '../hooks/usePolling.ts';

/** Health-Gauges: CPU, RAM, Disk pro Node */
export function HealthView() {
  const fetchPeers = useCallback(() => api.getPeers(), []);
  const fetchStatus = useCallback(() => api.getStatus(), []);
  const { data: peersData } = usePolling(fetchPeers, 5_000);
  const { data: status } = usePolling(fetchStatus, 5_000);

  const peers = peersData?.peers ?? [];

  return (
    <div>
      <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1rem' }}>
        Health Monitor
      </h2>

      {/* Eigener Node */}
      {status && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <h3 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.75rem' }}>
            {status.hostname} (this node)
            <span className="badge badge-online" style={{ marginLeft: '0.5rem' }}>online</span>
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
            <MetricCard label="Uptime" value={formatUptime(status.uptime_seconds)} />
            <MetricCard label="Peers" value={String(status.peers_online)} />
            <MetricCard label="Capabilities" value={String(status.capabilities_count)} />
            <MetricCard label="Tasks" value={String(status.active_tasks)} />
          </div>
        </div>
      )}

      {/* Peer-Nodes */}
      {peers.map((peer: Peer) => (
        <div key={peer.agent_id} className="card" style={{ marginBottom: '1rem' }}>
          <h3 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.75rem' }}>
            {peer.name}
            <span className={`badge badge-${peer.status}`} style={{ marginLeft: '0.5rem' }}>
              {peer.status}
            </span>
          </h3>
          {peer.agent_card?.health ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
              <GaugeCard label="CPU" value={peer.agent_card.health.cpu_percent} unit="%" />
              <GaugeCard label="RAM" value={peer.agent_card.health.memory_percent} unit="%" />
              <GaugeCard label="Disk" value={peer.agent_card.health.disk_percent} unit="%" />
              <MetricCard label="Uptime" value={formatUptime(peer.agent_card.health.uptime_seconds)} />
            </div>
          ) : (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>
              Keine Health-Daten verfuegbar
            </p>
          )}
        </div>
      ))}

      {peers.length === 0 && !status && (
        <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
          <p style={{ color: 'var(--text-secondary)' }}>Keine Nodes verbunden</p>
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{label}</div>
    </div>
  );
}

function GaugeCard({ label, value, unit }: { label: string; value: number; unit: string }) {
  const color = value > 90 ? 'var(--danger)' : value > 70 ? 'var(--warning)' : 'var(--success)';
  const pct = Math.min(100, Math.max(0, value));

  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: '1.5rem', fontWeight: 700, color }}>{value}{unit}</div>
      <div style={{
        height: '4px',
        background: 'var(--border)',
        borderRadius: '2px',
        margin: '0.25rem 0',
        overflow: 'hidden',
      }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: '2px' }} />
      </div>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{label}</div>
    </div>
  );
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}
