import { KeyRound, LogOut } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ScorerLayout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--color-surface-muted)' }}>
      <header style={{ background: '#FFFFFF', borderBottom: '1px solid var(--color-border)', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: '18px', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--color-text)', lineHeight: 1.2 }}>Scorer</div>
          <div style={{ fontSize: '12px', color: 'var(--color-primary)' }}>{user.username}</div>
        </div>
        <div className="flex items-center gap-1">
          <button className="btn-ghost text-sm" onClick={() => navigate('/change-password')}>
            <KeyRound size={16} strokeWidth={2} />
            Password
          </button>
          <button className="btn-ghost text-sm" onClick={handleLogout}>
            <LogOut size={16} strokeWidth={2} />
            Log out
          </button>
        </div>
      </header>
      <main className="flex-1 p-3">{children}</main>
    </div>
  );
}
