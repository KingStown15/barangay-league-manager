import { useBasketballLiveClock } from '../utils/useBasketballLiveClock';
import { getWinnerSide } from '../utils/gameResultStyles';
import { formatCompletedGames, formatEntryLabel, getGameDivision, getGameSideName, isPickleballGame } from '../utils/entryDisplay';
import { getPublicGameStatus } from '../utils/gamePublicStatus';

function formatTime(iso) {
  if (!iso) return 'Time TBA';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function hasPair(a, b) {
  return a !== null && a !== undefined && b !== null && b !== undefined;
}

function getDisplayScore(game) {
  const status = String(game.status || '').toLowerCase().replace(/\s+/g, '_');

  if (status === 'ongoing' || status === 'live') {
    if (game.sport === 'volleyball' && game.volleyball?.current_set) {
      return {
        scoreA: game.volleyball.current_set.team_a_score,
        scoreB: game.volleyball.current_set.team_b_score,
        hasScore: true,
      };
    }
    if (hasPair(game.live_score_a, game.live_score_b)) {
      return { scoreA: game.live_score_a, scoreB: game.live_score_b, hasScore: true };
    }
    if (hasPair(game.score_a, game.score_b)) {
      return { scoreA: game.score_a, scoreB: game.score_b, hasScore: true };
    }
  }

  if (status === 'needs_approval' || status === 'pending_approval' || status === 'completed' || status === 'approved' || game.approved_at) {
    if (hasPair(game.score_a, game.score_b)) {
      return { scoreA: game.score_a, scoreB: game.score_b, hasScore: true };
    }
    if (hasPair(game.live_score_a, game.live_score_b)) {
      return { scoreA: game.live_score_a, scoreB: game.live_score_b, hasScore: true };
    }
  }

  return { scoreA: null, scoreB: null, hasScore: false };
}

export default function GameFocusView({ game, onBack }) {
  const g = game;
  const displayScore = getDisplayScore(g);
  const ps = getPublicGameStatus(g);
  const ws = getWinnerSide(g);
  const wA = ws === 'A';
  const wB = ws === 'B';

  const clockDisplay = useBasketballLiveClock(g);
  const pickleball = isPickleballGame(g);
  const volleyball = g.sport === 'volleyball' ? g.volleyball : null;
  const pickleballState = g.pickleball?.state;
  const breakdown = formatCompletedGames(g);

  const statusBadge = (() => {
    if (ps.showLiveDot) {
      return (
        <div className="mt-3 flex items-center justify-center gap-2 text-sm font-black uppercase tracking-[0.2em]" style={{ color: 'var(--color-accent)' }}>
          <span className="h-2.5 w-2.5 rounded-full animate-pulse" style={{ background: 'var(--color-accent)' }} aria-hidden="true" />
          <span>LIVE</span>
        </div>
      );
    }
    if (ps.label === 'FULL TIME') {
      return (
        <div className="mt-3 flex flex-col items-center gap-1">
          <span className="text-sm font-black uppercase tracking-[0.2em]" style={{ color: 'var(--color-warning)' }}>FULL TIME</span>
          {ps.helper && <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{ps.helper}</span>}
        </div>
      );
    }
    if (ps.label === 'FINAL') {
      return (
        <div className="mt-3 text-sm font-black uppercase tracking-[0.2em]" style={{ color: 'var(--color-primary)' }}>FINAL</div>
      );
    }
    if (ps.label === 'FORFEIT') {
      return (
        <div className="mt-3 flex flex-col items-center gap-1">
          <span className="text-sm font-black uppercase tracking-[0.2em]" style={{ color: 'var(--color-danger)' }}>Forfeit</span>
          {ps.helper && <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{ps.helper}</span>}
        </div>
      );
    }
    return (
      <div className="mt-3 text-sm font-black uppercase tracking-[0.2em]" style={{ color: 'var(--color-text-muted)' }}>SCHEDULED</div>
    );
  })();

  return (
    <div>
      <button style={{ color: 'var(--color-primary)', textDecoration: 'underline', fontSize: '14px', marginBottom: '16px', opacity: 0.7 }} onClick={onBack} onMouseEnter={(e) => e.currentTarget.style.opacity = '1'} onMouseLeave={(e) => e.currentTarget.style.opacity = '0.7'}>
        &larr; Back
      </button>
      <div className="mx-auto max-w-5xl px-6 py-10 text-center">
        {g.round_label && (
          <div className="text-sm font-black uppercase tracking-[0.25em]" style={{ color: 'var(--color-text-muted)' }}>
            {g.round_label.toLowerCase() === 'final' ? 'Finals' : g.round_label}
          </div>
        )}
        {pickleball && <div className="entry-context-line" style={{ marginTop: 8 }}>Pickleball · {formatEntryLabel(getGameDivision(g))}</div>}
        {statusBadge}
        {clockDisplay && (
          <div className="mt-5 flex items-center justify-center gap-4 md:gap-8">
            <span className="text-base md:text-lg" style={{
              fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em',
              background: 'var(--color-primary-soft, #dbeafe)', color: 'var(--color-primary, #2563eb)',
              padding: '6px 14px', borderRadius: '8px', whiteSpace: 'nowrap',
            }}>
              {clockDisplay.period}
            </span>
            <span className="text-4xl md:text-5xl" style={{
              fontWeight: 900, fontVariantNumeric: 'tabular-nums',
              letterSpacing: '-0.02em', color: 'var(--color-text)',
            }}>
              {clockDisplay.gameClock}
            </span>
            <span className="text-lg md:text-2xl" style={{
              fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em',
              padding: '6px 14px', borderRadius: '8px', whiteSpace: 'nowrap',
              color: clockDisplay.shotExpired ? 'var(--color-danger, #DC2626)' : 'var(--color-text-muted)',
              background: clockDisplay.shotExpired ? 'rgba(220,38,38,0.1)' : 'var(--color-surface-hover, #f1f5f9)',
            }}>
              SHOT {clockDisplay.shotClock}
              {clockDisplay.shotExpired && (
                <span style={{ marginLeft: '4px', fontWeight: 800 }}>EXPIRED</span>
              )}
            </span>
          </div>
        )}
        {displayScore.hasScore && (
          <div className={`flex items-center justify-center gap-4 md:gap-6 ${clockDisplay ? 'mt-10' : 'mt-8'}`}>
            <span className="inline-flex h-20 min-w-[110px] md:h-28 md:min-w-[150px] items-center justify-center rounded-2xl px-6 text-5xl md:text-7xl font-black text-white" style={{ background: 'var(--color-text)' }}>
              {displayScore.scoreA}
            </span>
            <span className="text-4xl md:text-6xl font-black" style={{ color: 'var(--color-text-soft)' }}>-</span>
            <span className="inline-flex h-20 min-w-[110px] md:h-28 md:min-w-[150px] items-center justify-center rounded-2xl px-6 text-5xl md:text-7xl font-black text-white" style={{ background: 'var(--color-text)' }}>
              {displayScore.scoreB}
            </span>
          </div>
        )}
        {pickleballState && (
          <div className="pickleball-public-state">
            Game {pickleballState.current_game_number} · Games won {pickleballState.side_a_games_won}–{pickleballState.side_b_games_won}
            {pickleballState.match_state === 'in_progress' && ` · ${pickleballState.serving_side === 'A' ? getGameSideName(g, 'a') : getGameSideName(g, 'b')} serving`}
          </div>
        )}
        {volleyball && (
          <div className="pickleball-public-state">
            {volleyball.current_set ? `Set ${volleyball.current_set.set_number} · ` : ''}
            Sets won {volleyball.sets_won_a}–{volleyball.sets_won_b}
            {volleyball.current_set ? ` · First to ${volleyball.current_set.target}, win by 2` : ' · Match complete'}
          </div>
        )}
        {volleyball?.completed_sets?.length > 0 && (
          <div className="entry-game-breakdown" style={{ justifyContent: 'center', marginTop: 10 }}>
            {volleyball.completed_sets.map((set) => `S${set.set_number} ${set.team_a_score}–${set.team_b_score}`).join(' · ')}
          </div>
        )}
        <h1 className="mt-8 text-3xl md:text-5xl font-black tracking-tight" style={{ color: 'var(--color-text)' }}>
          <span style={{ color: wA ? '#16A34A' : (ws ? '#EF4444' : undefined) }}>{getGameSideName(g, 'a')}</span>
          <span style={{ color: 'var(--color-text-soft)' }}> vs </span>
          <span style={{ color: wB ? '#16A34A' : (ws ? '#EF4444' : undefined) }}>{getGameSideName(g, 'b')}</span>
        </h1>
        {breakdown && <div className="entry-game-breakdown" style={{ justifyContent: 'center', marginTop: 12 }}>Games: {breakdown}</div>}
        {g.scheduled_at && (
          <div className="mt-8 text-base md:text-lg font-semibold" style={{ color: 'var(--color-text-muted)' }}>
            {formatTime(g.scheduled_at)}{g.venue ? ` \u00B7 ${g.venue}` : ''}
          </div>
        )}
      </div>
    </div>
  );
}
