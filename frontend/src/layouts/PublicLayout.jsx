import { Link, NavLink, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const TABS = [
  { key: '', label: 'Overview' },
  { key: 'schedule', label: 'Schedule' },
  { key: 'results', label: 'Results' },
  { key: 'standings', label: 'Standings' },
  { key: 'bracket', label: 'Bracket' },
];

export default function PublicLayout({ children, tournamentName, venue, sport }) {
  const { tournamentId } = useParams();
  const { user } = useAuth();

  return (
    <div className="public-theme public-shell">
      <div className="public-container">
        <header className="public-header">
          <img src="/icon.svg" alt="Barangay League Manager icon" className="public-logo" />
          <div className="public-label">Barangay Sports League</div>
          <h1 className="public-title">{tournamentName || 'Tournament'}</h1>
          {(venue || sport) && (
            <p className="public-meta">
              {[sport, venue].filter(Boolean).join(' · ')}
            </p>
          )}
          <div style={{ marginTop: '10px', display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link to="/public" className="back-to-app">Change Tournament</Link>
            {user ? (
              <Link to="/" className="back-to-app">Back to App</Link>
            ) : (
              <Link to="/login" className="back-to-app">Admin Login</Link>
            )}
          </div>
        </header>

        <nav className="public-tabs">
          {TABS.map((tab) => (
            <NavLink
              key={tab.key}
              to={`/public/${tournamentId}${tab.key ? `/${tab.key}` : ''}`}
              end
              className={({ isActive }) =>
                `public-tab ${isActive ? 'active' : ''}`
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>

        <div className="pt-6">{children}</div>
      </div>
    </div>
  );
}
