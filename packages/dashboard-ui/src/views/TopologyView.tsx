import { useMemo, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { api, type Peer } from '../api.ts';
import { usePolling } from '../hooks/usePolling.ts';

/** Topologie-Ansicht: Netzwerkgraph aller verbundenen Agents */
export function TopologyView() {
  const fetchPeers = useCallback(() => api.getPeers(), []);
  const fetchStatus = useCallback(() => api.getStatus(), []);
  const { data: peersData, error: peersError } = usePolling(fetchPeers, 5_000);
  const { data: status } = usePolling(fetchStatus, 5_000);

  const { nodes, edges } = useMemo(() => {
    const n: Node[] = [];
    const e: Edge[] = [];

    // Eigener Node (Zentrum)
    if (status) {
      n.push({
        id: 'self',
        position: { x: 300, y: 200 },
        data: {
          label: `${status.hostname}\n${status.agent_type}\n(this node)`,
        },
        style: {
          background: '#1e40af',
          color: '#fff',
          border: '2px solid #3b82f6',
          borderRadius: '12px',
          padding: '12px 16px',
          fontSize: '12px',
          fontWeight: 600,
          whiteSpace: 'pre-line' as const,
          textAlign: 'center' as const,
          minWidth: '140px',
        },
      });
    }

    // Peer-Nodes
    const peers = peersData?.peers ?? [];
    const angleStep = (2 * Math.PI) / Math.max(peers.length, 1);
    const radius = 200;

    peers.forEach((peer: Peer, i: number) => {
      const angle = i * angleStep - Math.PI / 2;
      const x = 300 + radius * Math.cos(angle);
      const y = 200 + radius * Math.sin(angle);

      const agentType = peer.agent_card?.capabilities?.agents?.[0] ?? 'unknown';
      const isOnline = peer.status === 'online';

      n.push({
        id: peer.agent_id,
        position: { x, y },
        data: {
          label: `${peer.name}\n${agentType}`,
        },
        style: {
          background: isOnline ? '#064e3b' : '#450a0a',
          color: isOnline ? '#34d399' : '#f87171',
          border: `2px solid ${isOnline ? '#22c55e' : '#ef4444'}`,
          borderRadius: '12px',
          padding: '12px 16px',
          fontSize: '12px',
          fontWeight: 500,
          whiteSpace: 'pre-line' as const,
          textAlign: 'center' as const,
          minWidth: '140px',
        },
      });

      // Kante von self zu Peer
      e.push({
        id: `self-${peer.agent_id}`,
        source: 'self',
        target: peer.agent_id,
        style: { stroke: isOnline ? '#22c55e' : '#ef4444', strokeWidth: 2 },
        animated: isOnline,
      });
    });

    return { nodes: n, edges: e };
  }, [peersData, status]);

  if (peersError) {
    return (
      <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--danger)' }}>Verbindung zum Daemon fehlgeschlagen</p>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.5rem' }}>
          Starte den Daemon mit: TLMCP_NO_TLS=1 npx tsx packages/daemon/src/index.ts
        </p>
      </div>
    );
  }

  return (
    <div>
      <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1rem' }}>
        Mesh-Topologie
        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginLeft: '0.75rem' }}>
          {peersData?.count ?? 0} Peers verbunden
        </span>
      </h2>
      <div className="card" style={{ height: '500px' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          proOptions={{ hideAttribution: true }}
          style={{ background: 'var(--bg-primary)' }}
        >
          <Background color="#334155" gap={20} />
          <Controls />
        </ReactFlow>
      </div>
    </div>
  );
}
