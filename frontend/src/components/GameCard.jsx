import Badge from './ui/Badge';
import { getWinnerSide, hasScorePair } from '../utils/gameResultStyles';
import { useBasketballLiveClock } from '../utils/useBasketballLiveClock';
import {
  formatCompletedGames,
  formatEntryLabel,
  getGameDivision,
  getCompetitionLabel,
  getGameSideName,
  hasGameSides,
  isPickleballGame,
} from '../utils/entryDisplay';

function formatTime(iso) {
  if (!iso) return <span className="time-tba-badge">Time TBA</span>;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function GameCard({ game, onClick, dense }) {
  const hasSides = hasGameSides(game);
  const sideAName = getGameSideName(game, 'a');
  const sideBName = getGameSideName(game, 'b');
  const isPickleball = isPickleballGame(game);
  const completedGames = formatCompletedGames(game);
  const hasFinalScore = hasScorePair(game.score_a, game.score_b);
  const hasLiveScore = hasScorePair(game.live_score_a, game.live_score_b);

  const displayScoreA = hasFinalScore ? game.score_a : hasLiveScore ? game.live_score_a : null;
  const displayScoreB = hasFinalScore ? game.score_b : hasLiveScore ? game.live_score_b : null;
  const hasScore = hasScorePair(displayScoreA, displayScoreB);

  const isForfeit = game.status === 'forfeited';
  const isOngoing = game.status === 'ongoing' && hasSides && hasLiveScore && !hasFinalScore;
  const needsApproval = ['completed', 'forfeited'].includes(game.status) && !game.approved_at;
  const winnerSide = getWinnerSide(game);
  const wA = winnerSide === 'A';
  const wB = winnerSide === 'B';
  const clockDisplay = useBasketballLiveClock(game);

  return (
    <div
      className="schedule-card"
      style={{ borderLeft: isOngoing ? '4px solid var(--color-accent)' : needsApproval ? '4px solid var(--color-danger)' : undefined }}
      onClick={onClick}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
          {game.round_label && (
            <span style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--color-text-muted)' }}>{game.round_label}</span>
          )}
          {game.group_name && !dense && (
            <span style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--color-text-soft)' }}>{game.group_name}</span>
          )}
          {game.sport && <span className="entry-context-badge">{formatEntryLabel(game.sport)}</span>}
          {isPickleball && getCompetitionLabel(game) && <span className="entry-context-badge">{getCompetitionLabel(game)}</span>}
          {isPickleball && getGameDivision(game) && <span className="entry-context-badge">{formatEntryLabel(getGameDivision(game))}</span>}
          <Badge variant={needsApproval ? 'needs-approval' : game.status}>{needsApproval ? 'Needs Approval' : game.status}</Badge>
        </div>
        {hasSides ? (
          <div className="entry-matchup-label" style={{ fontSize: '18px', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--color-text)' }}>
            <span style={{ color: wA ? '#16A34A' : (winnerSide ? '#EF4444' : undefined) }}>{sideAName}</span>
            <span style={{ color: 'var(--color-text-soft)' }}> vs </span>
            <span style={{ color: wB ? '#16A34A' : (winnerSide ? '#EF4444' : undefined) }}>{sideBName}</span>
          </div>
        ) : (
          <div style={{ fontSize: '16px', fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--color-text-muted)' }}>
            <span className="time-tba-badge">Awaiting qualifiers</span>
          </div>
        )}
        {clockDisplay && (
          <div style={{ fontSize: '13px', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-muted)', marginTop: '4px' }}>
            {clockDisplay.text}
          </div>
        )}
        {!dense && (
          <div style={{ fontSize: '14px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
            {formatTime(game.scheduled_at)}{game.venue ? ` · ${game.venue}` : ''}
          </div>
        )}
        {isForfeit && <div style={{ color: 'var(--color-danger)', fontSize: '14px', marginTop: '4px' }}>Forfeit</div>}
        {completedGames && <div className="entry-game-breakdown">Games: {completedGames}</div>}
      </div>

      {hasScore && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px', flexShrink: 0 }}>
          <div className="game-score-cluster">
            <span className={`game-score-chip${hasLiveScore && !hasFinalScore ? ' live' : ''}`}>{displayScoreA}</span>
            <span className="game-score-separator">-</span>
            <span className={`game-score-chip${hasLiveScore && !hasFinalScore ? ' live' : ''}`}>{displayScoreB}</span>
          </div>
          {hasLiveScore && !hasFinalScore && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--color-accent)' }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--color-accent)', animation: 'livePulse 1.6s infinite' }} /> Live
            </span>
          )}
        </div>
      )}
    </div>
  );
}
