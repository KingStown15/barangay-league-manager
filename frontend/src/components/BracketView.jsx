import Badge from './ui/Badge';
import { getWinnerSide } from '../utils/gameResultStyles';
import { formatCompletedGames, getGameSideName } from '../utils/entryDisplay';

function groupByRound(games) {
  const order = [];
  const map = {};
  games.forEach((g) => {
    const key = g.round_label || 'Round';
    if (!map[key]) {
      map[key] = [];
      order.push(key);
    }
    map[key].push(g);
  });
  return order.map((name) => ({ name, games: map[name] }));
}

function MatchCard({ game }) {
  const winnerSide = getWinnerSide(game);
  const winnerA = winnerSide === 'A';
  const winnerB = winnerSide === 'B';
  const isLive = game.status === 'ongoing' && game.live_score_a !== null && game.live_score_a !== undefined;
  const scoreA = isLive ? game.live_score_a : game.score_a;
  const scoreB = isLive ? game.live_score_b : game.score_b;
  return (
    <div className={`bracket-match-card${isLive ? ' live' : ''}`}>
      <div className={`bracket-team${winnerA ? ' winner' : ''}`}>
        <span className="bracket-team-name" style={{ color: winnerA ? '#16A34A' : undefined }}>{getGameSideName(game, 'a')}</span>
        {scoreA !== null && scoreA !== undefined && (
          <span className={`bracket-score${isLive ? ' live-score' : ''}`}>{scoreA}</span>
        )}
      </div>
      <hr className="bracket-divider" />
      <div className={`bracket-team${winnerB ? ' winner' : ''}`}>
        <span className="bracket-team-name" style={{ color: winnerB ? '#16A34A' : undefined }}>{getGameSideName(game, 'b')}</span>
        {scoreB !== null && scoreB !== undefined && (
          <span className={`bracket-score${isLive ? ' live-score' : ''}`}>{scoreB}</span>
        )}
      </div>
      {formatCompletedGames(game) && <div className="bracket-game-breakdown">Games: {formatCompletedGames(game)}</div>}
      <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Badge variant={game.status}>{game.status}</Badge>
        {isLive && <span style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#F97316' }}>● Live</span>}
      </div>
    </div>
  );
}

export default function BracketView({ games }) {
  if (!games || games.length === 0) {
    return <div style={{ color: 'var(--color-text-muted)', fontStyle: 'italic', padding: '24px 0', textAlign: 'center' }}>The playoff bracket hasn't been generated yet.</div>;
  }

  const rounds = groupByRound(games);

  return (
    <div className="bracket-board">
      {rounds.map((round) => (
        <div key={round.name} className="bracket-round">
          <div className="bracket-round-header">{round.name}</div>
          {round.games.map((g) => (
            <MatchCard key={g.id} game={g} />
          ))}
        </div>
      ))}
    </div>
  );
}
