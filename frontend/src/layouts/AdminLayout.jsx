import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { usePolling } from '../utils/usePolling';
import { isAdminRole } from '../utils/roles';
import { isSuperAdminRole } from '../utils/roles';
import {
  LayoutDashboard, Trophy, Shield, Users, CalendarDays,
  BarChart3, GitBranch, ImageDown, UserCog, LogOut, RefreshCw, KeyRound,
} from 'lucide-react';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/tournaments', label: 'Tournaments', icon: Trophy },
  { to: '/teams', label: 'Teams', icon: Shield },
  { to: '/players', label: 'Players', icon: Users },
  { to: '/entries', label: 'Entries', icon: Users },
  { to: '/games', label: 'Schedule', icon: CalendarDays },
  { to: '/standings', label: 'Standings', icon: BarChart3 },
  { to: '/bracket', label: 'Bracket', icon: GitBranch },
  { to: '/export', label: 'Export / Post', icon: ImageDown },
  { to: '/users', label: 'Users', icon: UserCog },
  { to: '/system-update', label: 'System Update', icon: RefreshCw },
  { to: '/change-password', label: 'Change Password', icon: KeyRound },
];

export default function AdminLayout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [pendingApprovals, setPendingApprovals] = useState(0);

  usePolling(() => {
    api.get('/tournaments').then((td) => {
      const eligible = (td.tournaments || []).filter(t => t.status !== 'archived');
      if (eligible.length === 0) { setPendingApprovals(0); return; }
      Promise.all(eligible.map(t =>
        api.get(`/dashboard?tournament_id=${t.id}`).catch(() => ({ pendingApprovals: [] }))
      )).then(results => {
        const total = results.reduce((sum, r) => sum + (r.pendingApprovals?.length ?? 0), 0);
        setPendingApprovals(total);
      });
    }).catch(() => {});
  }, [], 10000);

  const visibleItems = NAV_ITEMS.filter((item) => {
    if (item.to === '/users') return isAdminRole(user.role);
    if (item.to === '/system-update') return isSuperAdminRole(user.role);
    return true;
  });

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <div className="min-h-screen flex flex-col md:flex-row md:h-screen md:overflow-hidden" style={{ background: 'var(--color-app-bg)' }}>
      <div className="md:hidden flex items-center justify-between px-4 py-3 shrink-0" style={{ background: '#FFFFFF', borderBottom: '1px solid var(--color-border)' }}>
        <div className="flex items-center gap-2">
          <img src="/icon.svg" alt="Barangay League Manager icon" className="w-8 h-8 shrink-0" />
          <div>
            <div className="font-semibold text-sm leading-tight" style={{ color: 'var(--color-text)' }}>Barangay League</div>
            <div className="text-[10px] uppercase tracking-wider font-bold" style={{ color: 'var(--color-primary)' }}>{user.role} · {user.username}</div>
          </div>
        </div>
        <button className="btn-ghost text-xs" onClick={handleLogout}>
          <LogOut size={14} strokeWidth={2} />
          Log out
        </button>
      </div>

      <aside className="md:w-[240px] shrink-0 flex flex-col md:h-[100dvh] md:sticky md:top-0 overflow-hidden" style={{ background: 'var(--color-sidebar)', borderRight: '1px solid var(--color-sidebar-border)' }}>
        <div className="sidebar-brand h-[72px] hidden md:flex items-center gap-3 px-[18px] shrink-0" style={{ borderBottom: '1px solid var(--color-sidebar-border)' }}>
          <img src="/icon.svg" alt="Barangay League Manager icon" className="w-10 h-10 shrink-0" />
          <div>
            <div className="font-bold text-sm leading-tight" style={{ color: 'var(--color-text)' }}>Barangay League</div>
            <div className="text-[11px] uppercase tracking-wider font-bold" style={{ color: 'var(--color-primary)' }}>Manager</div>
          </div>
        </div>

        <nav className="sidebar-nav px-2.5 py-3.5 flex-1 overflow-y-auto no-scrollbar">
          <div className="flex flex-col gap-1">
            {visibleItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `sidebar-link ${isActive ? 'active' : ''}`
                }
              >
                <item.icon size={20} strokeWidth={2} />
                <span className="flex items-center gap-2">
                  {item.label}
                  {item.to === '/games' && pendingApprovals > 0 && (
                    <span className="bg-[#DC2626] text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                      {pendingApprovals}
                    </span>
                  )}
                </span>
              </NavLink>
            ))}
          </div>
        </nav>

        <div className="sidebar-footer hidden md:block shrink-0 px-[18px] py-3" style={{ borderTop: '1px solid var(--color-sidebar-border)', background: 'var(--color-sidebar)' }}>
          <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-subtle)' }}>Account</div>
          <div className="mt-1 flex items-center gap-2">
            <span className="font-medium text-sm" style={{ color: 'var(--color-text)' }}>{user.username}</span>
            <span className={`status-pill ${isAdminRole(user.role) ? 'badge-admin' : 'badge-scorer'}`}>{user.role.replace('_', ' ')}</span>
          </div>
          <button className="btn-ghost mt-2 text-sm" onClick={handleLogout}>
            <LogOut size={15} strokeWidth={2} />
            Log out
          </button>
        </div>
      </aside>

      <main className="flex-1 md:overflow-y-auto md:h-screen">
        <div className="page-container">{children}</div>
      </main>
    </div>
  );
}
