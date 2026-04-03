import { useMemo, useCallback } from 'react';
import { api, type Capability } from '../api.ts';
import { usePolling } from '../hooks/usePolling.ts';

/** Skill-Matrix: Tabelle Agent x Capability mit Status */
export function SkillMatrix() {
  const fetchCaps = useCallback(() => api.getCapabilities(), []);
  const { data, loading } = usePolling(fetchCaps, 10_000);

  const { agents, skills, matrix } = useMemo(() => {
    const caps = data?.capabilities ?? [];
    const agentSet = new Set<string>();
    const skillSet = new Set<string>();
    const m = new Map<string, Capability>();

    for (const cap of caps) {
      agentSet.add(cap.agent_id);
      skillSet.add(cap.skill_id);
      m.set(`${cap.agent_id}::${cap.skill_id}`, cap);
    }

    return {
      agents: [...agentSet].sort(),
      skills: [...skillSet].sort(),
      matrix: m,
    };
  }, [data]);

  // Agent-ID kuerzen fuer Anzeige
  const shortAgent = (id: string) => {
    const match = id.match(/agent\/(.+)$/);
    return match ? match[1] : id.slice(-20);
  };

  if (loading && !data) {
    return <p style={{ color: 'var(--text-secondary)' }}>Lade Capabilities...</p>;
  }

  if (skills.length === 0) {
    return (
      <div>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1rem' }}>Skill-Matrix</h2>
        <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
          <p style={{ color: 'var(--text-secondary)' }}>Keine Capabilities registriert</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1rem' }}>
        Skill-Matrix
        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginLeft: '0.75rem' }}>
          {data?.count ?? 0} Capabilities | Hash: {data?.hash?.slice(0, 8)}
        </span>
      </h2>
      <div className="card" style={{ overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
          <thead>
            <tr>
              <th style={thStyle}>Skill</th>
              {agents.map((a) => (
                <th key={a} style={thStyle}>{shortAgent(a)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {skills.map((skill) => (
              <tr key={skill}>
                <td style={tdStyle}>{skill}</td>
                {agents.map((agent) => {
                  const cap = matrix.get(`${agent}::${skill}`);
                  return (
                    <td key={agent} style={{ ...tdStyle, textAlign: 'center' }}>
                      {cap ? (
                        <span className={`badge badge-${cap.health}`}>
                          {cap.version}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--border)' }}>--</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
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
  padding: '0.5rem 0.75rem',
  borderBottom: '1px solid var(--border)',
};
