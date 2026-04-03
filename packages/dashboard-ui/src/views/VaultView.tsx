import { useState, useCallback } from 'react';
import { usePolling } from '../hooks/usePolling.ts';

interface Credential {
  id: string;
  name: string;
  category: string;
  tags: string[];
  expiresAt: string | null;
  createdAt: string;
  lastAccessedAt: string | null;
  accessCount: number;
}

interface Approval {
  id: string;
  requester: string;
  credential_name: string;
  reason: string;
  status: string;
  requested_at: string;
}

const fetchCredentials = () =>
  fetch('/api/vault/credentials').then((r) => r.json()) as Promise<{ credentials: Credential[]; count: number }>;
const fetchApprovals = () =>
  fetch('/api/vault/approvals').then((r) => r.json()) as Promise<{ approvals: Approval[]; count: number }>;

/** Vault-View: Credentials verwalten + Approval-Gate */
export function VaultView() {
  const { data: credsData, refresh: refreshCreds } = usePolling(useCallback(fetchCredentials, []), 10_000);
  const { data: approvalsData, refresh: refreshApprovals } = usePolling(useCallback(fetchApprovals, []), 5_000);

  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newCategory, setNewCategory] = useState('general');

  const handleAdd = async () => {
    if (!newName || !newValue) return;
    await fetch('/api/vault/credentials', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: newName, value: newValue, category: newCategory }),
    });
    setNewName('');
    setNewValue('');
    setShowAdd(false);
    refreshCreds();
  };

  const handleDelete = async (name: string) => {
    await fetch(`/api/vault/credentials/${encodeURIComponent(name)}`, { method: 'DELETE' });
    refreshCreds();
  };

  const handleApproval = async (id: string, action: 'approve' | 'deny') => {
    await fetch(`/api/vault/approvals/${id}/${action}`, { method: 'POST' });
    refreshApprovals();
  };

  const credentials = credsData?.credentials ?? [];
  const approvals = approvalsData?.approvals ?? [];

  return (
    <div>
      <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1rem' }}>
        Credential Vault
        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginLeft: '0.75rem' }}>
          {credentials.length} Credentials
        </span>
      </h2>

      {/* Pending Approvals */}
      {approvals.length > 0 && (
        <div className="card" style={{ marginBottom: '1rem', borderColor: 'var(--warning)' }}>
          <h3 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--warning)' }}>
            Ausstehende Genehmigungen ({approvals.length})
          </h3>
          {approvals.map((a) => (
            <div key={a.id} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '0.5rem 0.75rem', background: 'var(--bg-primary)', borderRadius: '0.5rem',
              marginBottom: '0.375rem', fontSize: '0.8125rem',
            }}>
              <div>
                <strong>{a.credential_name}</strong>
                <span style={{ color: 'var(--text-secondary)', marginLeft: '0.5rem' }}>
                  von {a.requester.split('/').pop()}
                </span>
                {a.reason && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.125rem' }}>
                    {a.reason}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: '0.375rem' }}>
                <button onClick={() => handleApproval(a.id, 'approve')} style={btnApprove}>Genehmigen</button>
                <button onClick={() => handleApproval(a.id, 'deny')} style={btnDeny}>Ablehnen</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Credential */}
      <div style={{ marginBottom: '1rem' }}>
        {showAdd ? (
          <div className="card">
            <h3 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.75rem' }}>Neues Credential</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <input placeholder="Name (z.B. github-token)" value={newName} onChange={(e) => setNewName(e.target.value)} style={inputStyle} />
              <input placeholder="Wert (wird verschluesselt)" value={newValue} onChange={(e) => setNewValue(e.target.value)} type="password" style={inputStyle} />
              <input placeholder="Kategorie" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} style={inputStyle} />
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button onClick={handleAdd} style={btnApprove}>Speichern</button>
                <button onClick={() => setShowAdd(false)} style={{ ...btnDeny, background: 'transparent' }}>Abbrechen</button>
              </div>
            </div>
          </div>
        ) : (
          <button onClick={() => setShowAdd(true)} style={{
            background: 'var(--accent)', color: '#fff', border: 'none',
            padding: '0.5rem 1rem', borderRadius: '0.375rem', fontSize: '0.8125rem',
            fontWeight: 600, cursor: 'pointer',
          }}>
            + Credential hinzufuegen
          </button>
        )}
      </div>

      {/* Credential-Liste */}
      <div className="card">
        {credentials.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '2rem' }}>
            Keine Credentials gespeichert
          </p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
            <thead>
              <tr>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Kategorie</th>
                <th style={thStyle}>Tags</th>
                <th style={thStyle}>Zugriffe</th>
                <th style={thStyle}>Erstellt</th>
                <th style={thStyle}>Ablauf</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {credentials.map((c) => (
                <tr key={c.id}>
                  <td style={tdStyle}><strong>{c.name}</strong></td>
                  <td style={tdStyle}><span className="badge badge-healthy">{c.category}</span></td>
                  <td style={tdStyle}>{c.tags.join(', ') || '--'}</td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>{c.accessCount}</td>
                  <td style={{ ...tdStyle, fontSize: '0.75rem' }}>{new Date(c.createdAt).toLocaleDateString()}</td>
                  <td style={{ ...tdStyle, fontSize: '0.75rem' }}>{c.expiresAt ? new Date(c.expiresAt).toLocaleDateString() : '--'}</td>
                  <td style={tdStyle}>
                    <button onClick={() => handleDelete(c.name)} style={{ ...btnDeny, fontSize: '0.6875rem', padding: '0.125rem 0.5rem' }}>
                      Entfernen
                    </button>
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

const inputStyle: React.CSSProperties = {
  background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: '0.375rem',
  padding: '0.5rem 0.75rem', color: 'var(--text-primary)', fontSize: '0.8125rem', outline: 'none',
};
const btnApprove: React.CSSProperties = {
  background: '#064e3b', color: '#34d399', border: '1px solid #22c55e', borderRadius: '0.375rem',
  padding: '0.25rem 0.75rem', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer',
};
const btnDeny: React.CSSProperties = {
  background: '#450a0a', color: '#f87171', border: '1px solid #ef4444', borderRadius: '0.375rem',
  padding: '0.25rem 0.75rem', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer',
};
const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--border)',
  color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase',
};
const tdStyle: React.CSSProperties = { padding: '0.375rem 0.75rem', borderBottom: '1px solid var(--border)' };
