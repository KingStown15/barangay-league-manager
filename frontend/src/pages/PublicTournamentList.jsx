import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Trophy } from 'lucide-react';
import { api } from '../api/client';
import { formatEntryLabel } from '../utils/entryDisplay';

export default function PublicTournamentList() {
  const [tournaments, setTournaments] = useState([]);

  useEffect(() => {
    api.public.get('/public/tournaments').then((d) => setTournaments(d.tournaments)).catch(() => {});
  }, []);

  return (
    <div className="public-theme public-shell">
      <div className="public-container">
        <header className="public-header">
          <div className="public-label">Barangay Sports League</div>
          <h1 className="public-title">Tournaments</h1>
        </header>

        <div className="max-w-2xl mx-auto mt-8 space-y-3">
          {tournaments.length === 0 && (
            <div style={{ color: 'var(--color-text-subtle)', textAlign: 'center', fontStyle: 'italic', padding: '40px 0' }}>
              No tournaments are live right now. Check back soon!
            </div>
          )}
          {tournaments.map((t) => (
            <Link
              key={t.id}
              to={`/public/${t.id}`}
              className="public-card"
              style={{ display: 'block', padding: '20px 24px', textDecoration: 'none', transition: 'box-shadow 0.12s, transform 0.12s' }}
              onMouseEnter={(e) => { e.currentTarget.style.boxShadow = 'var(--shadow-card-hover)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'var(--shadow-card)'; e.currentTarget.style.transform = 'none'; }}
            >
              <div style={{ fontSize: '20px', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--color-text)' }}>{t.name}</div>
              <div className="entry-context-line">{formatEntryLabel(t.sport)}{t.competition_format ? ` · ${formatEntryLabel(t.competition_format)}` : ''}{t.division ? ` · ${formatEntryLabel(t.division)}` : ''}</div>
              <div style={{ fontSize: '14px', color: 'var(--color-text-muted)' }}>{t.venue || 'Venue TBA'} · {t.status}</div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
