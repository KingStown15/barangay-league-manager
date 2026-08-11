export default function StandingsTable({ standings, compact, advancingCount }) {
  if (!standings || standings.length === 0) {
    return <div style={{ color: 'var(--color-text-muted)', fontStyle: 'italic', padding: '24px 0', textAlign: 'center' }}>No standings yet — results will appear here once games are completed.</div>;
  }
  const entryAware = standings.some((row) => row.entryId);

  return (
    <div className="standings-table-wrap">
      <table className={`standings-table${entryAware ? ' entry-aware' : ''}`}>
        <thead>
          <tr style={{ borderBottom: '2px solid var(--color-border)', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--color-text-muted)' }}>
            <th style={{ padding: '8px 8px 8px 0' }}>#</th>
            <th style={{ padding: '8px 8px 8px 0' }}>{entryAware ? 'Entry' : 'Team'}</th>
            <th style={{ padding: '8px 4px', textAlign: 'center' }}>P</th>
            <th style={{ padding: '8px 4px', textAlign: 'center' }}>W</th>
            <th style={{ padding: '8px 4px', textAlign: 'center' }}>L</th>
            {entryAware && !compact && <th className="standings-detail-col" style={{ padding: '8px 4px', textAlign: 'center' }}>GW</th>}
            {entryAware && !compact && <th className="standings-detail-col" style={{ padding: '8px 4px', textAlign: 'center' }}>GL</th>}
            {!compact && <th className="standings-detail-col" style={{ padding: '8px 4px', textAlign: 'center' }}>PF</th>}
            {!compact && <th className="standings-detail-col" style={{ padding: '8px 4px', textAlign: 'center' }}>PA</th>}
            <th style={{ padding: '8px 4px', textAlign: 'center' }}>Diff</th>
            <th style={{ padding: '8px 0 8px 4px', textAlign: 'center' }}>Pts</th>
          </tr>
        </thead>
        <tbody>
          {standings.map((row) => (
            <tr
              key={row.entryId || row.teamId}
              style={{
                borderBottom: '1px solid var(--color-border)',
                background: row.rank <= 3 ? 'rgba(37, 99, 235, 0.03)' : row.rank % 2 === 0 ? 'rgba(0,0,0,0.015)' : undefined,
                borderBottomWidth: advancingCount && row.rank === advancingCount ? '2px' : undefined,
                borderBottomColor: advancingCount && row.rank === advancingCount ? 'var(--color-success)' : undefined,
              }}
            >
              <td className="rank-cell">
                {row.rank === 1 ? <span className="rank-badge rank-1">1</span> :
                 row.rank === 2 ? <span className="rank-badge rank-2">2</span> :
                 row.rank === 3 ? <span className="rank-badge rank-3">3</span> :
                 <span className="rank-number">{row.rank}</span>}
              </td>
              <td style={{ padding: '8px 8px 8px 0', fontWeight: 600 }}>
                <span className="standings-entry-name">{row.entryName || row.teamName}</span>
                {entryAware && row.affiliation && <small className="standings-affiliation">{row.affiliation}</small>}
                {row.manualOverride != null && (
                  <span style={{ marginLeft: '8px', fontSize: '12px', color: 'var(--color-text-soft)', verticalAlign: 'middle' }} title="Committee decision / manual override">*</span>
                )}
              </td>
              <td style={{ padding: '8px 4px', textAlign: 'center' }}>{row.played}</td>
              <td style={{ padding: '8px 4px', textAlign: 'center', color: 'var(--color-success)', fontWeight: 700 }}>{row.wins}</td>
              <td style={{ padding: '8px 4px', textAlign: 'center', color: 'var(--color-danger)', fontWeight: 700 }}>{row.losses}</td>
              {entryAware && !compact && <td className="standings-detail-col" style={{ padding: '8px 4px', textAlign: 'center' }}>{row.gamesWon}</td>}
              {entryAware && !compact && <td className="standings-detail-col" style={{ padding: '8px 4px', textAlign: 'center' }}>{row.gamesLost}</td>}
              {!compact && <td className="standings-detail-col" style={{ padding: '8px 4px', textAlign: 'center' }}>{row.pointsScored}</td>}
              {!compact && <td className="standings-detail-col" style={{ padding: '8px 4px', textAlign: 'center' }}>{row.pointsAllowed}</td>}
              <td style={{ padding: '8px 4px', textAlign: 'center' }}>{row.pointDiff > 0 ? `+${row.pointDiff}` : row.pointDiff}</td>
              <td style={{ padding: '8px 0 8px 4px', textAlign: 'center', fontSize: '18px', fontWeight: 800, color: 'var(--color-text)' }}>{row.leaguePoints}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
