import { Routes, Route, NavLink } from 'react-router-dom';
import { TopologyView } from './views/TopologyView.tsx';
import { SkillMatrix } from './views/SkillMatrix.tsx';
import { HealthView } from './views/HealthView.tsx';
import { PairingView } from './views/PairingView.tsx';
import { AuditView } from './views/AuditView.tsx';

export function App() {
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* Sidebar Navigation */}
      <nav style={{
        width: '220px',
        background: 'var(--bg-secondary)',
        borderRight: '1px solid var(--border)',
        padding: '1rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.25rem',
      }}>
        <div style={{ padding: '0.5rem', marginBottom: '1rem' }}>
          <h1 style={{ fontSize: '1.125rem', fontWeight: 700 }}>thinklocal</h1>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Mesh Dashboard</span>
        </div>
        <NavItem to="/" label="Topologie" />
        <NavItem to="/skills" label="Skill-Matrix" />
        <NavItem to="/health" label="Health" />
        <NavItem to="/pairing" label="Pairing" />
        <NavItem to="/audit" label="Audit-Log" />
      </nav>

      {/* Main Content */}
      <main style={{ flex: 1, padding: '1.5rem', overflow: 'auto' }}>
        <Routes>
          <Route path="/" element={<TopologyView />} />
          <Route path="/skills" element={<SkillMatrix />} />
          <Route path="/health" element={<HealthView />} />
          <Route path="/pairing" element={<PairingView />} />
          <Route path="/audit" element={<AuditView />} />
        </Routes>
      </main>
    </div>
  );
}

function NavItem({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      style={({ isActive }) => ({
        display: 'block',
        padding: '0.5rem 0.75rem',
        borderRadius: '0.5rem',
        fontSize: '0.875rem',
        textDecoration: 'none',
        color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
        background: isActive ? 'var(--accent)' : 'transparent',
        fontWeight: isActive ? 600 : 400,
      })}
    >
      {label}
    </NavLink>
  );
}
