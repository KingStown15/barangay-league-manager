import { useState } from 'react';
import { api } from '../api/client';
import PublicLayout from '../layouts/PublicLayout';
import { usePublicTournament } from '../utils/usePublicTournament';
import { usePolling } from '../utils/usePolling';

function PublicStandingsTable({ standings }) {
  if (!standings || standings.length === 0) {
    return <div style={{ color: 'var(--color-text-subtle)', fontStyle: 'italic', textAlign: 'center', padding: '24px 0' }}>No standings yet.</div>;
  }
  const entryAware = standings.some((row) => row.entryId);
  return (
    <div className="standings-table-wrap public-standings-wrap">
      <table className={`standings-table public-standings-table${entryAware ? ' entry-aware' : ''}`}>
        <thead>
          <tr style={{ borderBottom: '2px solid var(--color-primary)', fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.16em', color: 'var(--color-primary)' }}>
            <th style={{ padding: '8px 8px 8px 0' }}>#</th>
            <th style={{ padding: '8px 8px 8px 0' }}>{entryAware ? 'Entry' : 'Team'}</th>
            <th className="standings-mobile-hide" style={{ padding: '8px 4px', textAlign: 'center' }}>P</th>
            <th style={{ padding: '8px 4px', textAlign: 'center' }}>W</th>
            <th style={{ padding: '8px 4px', textAlign: 'center' }}>L</th>
            {entryAware && <th className="standings-detail-col" style={{ padding: '8px 4px', textAlign: 'center' }}>GD</th>}
            {entryAware && <th className="standings-detail-col" style={{ padding: '8px 4px', textAlign: 'center' }}>PF</th>}
            {entryAware && <th className="standings-detail-col" style={{ padding: '8px 4px', textAlign: 'center' }}>PA</th>}
            <th style={{ padding: '8px 4px', textAlign: 'center' }}>Diff</th>
            <th className="standings-detail-col" style={{ padding: '8px 0 8px 4px', textAlign: 'center' }}>Pts</th>
          </tr>
        </thead>
        <tbody>
          {standings.map((row) => (
            <tr key={row.entryId || row.teamId} style={{ borderBottom: '1px solid var(--color-border)' }}>
              <td style={{ padding: '12px 8px 12px 0', fontSize: '20px', fontWeight: 800 }}>{row.rank}</td>
              <td style={{ padding: '12px 8px 12px 0', fontWeight: 600, fontSize: '18px' }}>
                <span className="standings-entry-name">{row.entryName || row.teamName}</span>
                {entryAware && row.affiliation && <small className="standings-affiliation">{row.affiliation}</small>}
                {row.manualOverride != null && <span style={{ marginLeft: '8px', color: 'var(--color-text-subtle)', fontSize: '14px' }}>*</span>}
              </td>
              <td className="standings-mobile-hide" style={{ padding: '12px 4px', textAlign: 'center' }}>{row.played}</td>
              <td style={{ padding: '12px 4px', textAlign: 'center', color: 'var(--color-success)', fontWeight: 700 }}>{row.wins}</td>
              <td style={{ padding: '12px 4px', textAlign: 'center', color: 'var(--color-danger)', fontWeight: 700 }}>{row.losses}</td>
              {entryAware && <td className="standings-detail-col" style={{ padding: '12px 4px', textAlign: 'center' }}>{row.gameDiff > 0 ? `+${row.gameDiff}` : row.gameDiff}</td>}
              {entryAware && <td className="standings-detail-col" style={{ padding: '12px 4px', textAlign: 'center' }}>{row.pointsScored}</td>}
              {entryAware && <td className="standings-detail-col" style={{ padding: '12px 4px', textAlign: 'center' }}>{row.pointsAllowed}</td>}
              <td style={{ padding: '12px 4px', textAlign: 'center' }}>{row.pointDiff > 0 ? `+${row.pointDiff}` : row.pointDiff}</td>
              <td className="standings-detail-col" style={{ padding: '12px 0 12px 4px', textAlign: 'center', fontWeight: 800, color: 'var(--color-primary)' }}>{row.leaguePoints}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PublicStandings() {
  const { tournament } = usePublicTournament();
  const [groups, setGroups] = useState([]);
  const verifiedTournamentId = tournament?.id;

  usePolling(() => {
    if (!verifiedTournamentId) return;
    api.public.get(`/public/tournaments/${verifiedTournamentId}/standings`).then((d) => setGroups(d.groups)).catch(() => {});
  }, [verifiedTournamentId], 15000);

  return (
    <PublicLayout tournamentName={tournament?.name}>
      <div className="space-y-8">
        {groups.map(({ group, standings }) => (
          <section key={group ? group.id : 'overall'}>
            <h2 style={{ fontSize: '13px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.16em', color: 'var(--color-primary)', marginBottom: '12px' }}>
              {group ? group.name : 'Standings'}
            </h2>
            <PublicStandingsTable standings={standings} />
          </section>
        ))}
      </div>
    </PublicLayout>
  );
}
