import { useState, useCallback } from 'react';
import { api } from '../api/client';
import PublicLayout from '../layouts/PublicLayout';
import { usePublicTournament } from '../utils/usePublicTournament';
import { usePolling } from '../utils/usePolling';
import { useLiveScoreStream } from '../utils/useLiveScoreStream';
import GameFocusView from '../components/GameFocusView';
import { useBasketballLiveClock } from '../utils/useBasketballLiveClock';
import { formatCompletedGames, formatEntryLabel, getGameDivision, getGameSideName, hasGameSides, isPickleballGame } from '../utils/entryDisplay';

function formatTime(iso) {
  if (!iso) return 'Time TBA';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function ScheduleGameRow({ liveGame, connectionState, isLive, needsApproval, isFinal, isForfeit, rightContent, onClick }) {
  const clockDisplay = useBasketballLiveClock(liveGame);
  const breakdown = formatCompletedGames(liveGame);
  return (
    <button
      className="public-card"
      style={{ width: '100%', textAlign: 'left', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', cursor: 'pointer', border: isLive ? '1px solid var(--color-primary)' : needsApproval ? '1px solid var(--color-warning)' : undefined }}
      onClick={onClick}
    >
      <div>
        {liveGame.round_label && <div style={{ fontSize: '11px', color: 'var(--color-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>{liveGame.round_label}{liveGame.group_name ? ` · ${liveGame.group_name}` : ''}</div>}
        {isPickleballGame(liveGame) && <div className="entry-context-line">Pickleball · {formatEntryLabel(getGameDivision(liveGame))}</div>}
        <div className="entry-matchup-label" style={{ fontSize: '18px', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--color-text)' }}>
          {getGameSideName(liveGame, 'a')} <span style={{ color: 'var(--color-text-subtle)' }}>vs</span> {getGameSideName(liveGame, 'b')}
        </div>
        {clockDisplay && (
          <div style={{ fontSize: '12px', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-muted)', marginTop: '4px' }}>{clockDisplay.text}</div>
        )}
        {breakdown && <div className="entry-game-breakdown">Games: {breakdown}</div>}
      </div>
      {rightContent || (
        <div style={{ fontSize: '13px', color: 'var(--color-text-muted)', textAlign: 'right' }}>
          {formatTime(liveGame.scheduled_at)}{liveGame.venue ? <><br />{liveGame.venue}</> : ''}
        </div>
      )}
    </button>
  );
}

export default function PublicSchedule() {
  const { tournament } = usePublicTournament();
  const [games, setGames] = useState([]);
  const [focusedGame, setFocusedGame] = useState(null);
  const verifiedTournamentId = tournament?.id;
  const { liveScores, finalizedScores, connectionState, reconcilePolledGames } = useLiveScoreStream(verifiedTournamentId);

  const applyLive = useCallback((game) => {
    const final = finalizedScores[game.id];
    if (final) {
      if (game.status !== 'ongoing') return { ...game, approved_at: game.approved_at || final.approved_at };
      return { ...game, score_a: final.score_a, score_b: final.score_b, status: final.status, approved_at: final.approved_at, live_score_a: null, live_score_b: null };
    }
    const live = liveScores[game.id];
    if (!live) return game;
    if (game.status !== 'ongoing') return game;
    return { ...game, ...live, status: live.status || game.status, pickleball: live.pickleball || game.pickleball, volleyball: live.volleyball || game.volleyball };
  }, [liveScores, finalizedScores]);

  usePolling(() => {
    if (!verifiedTournamentId) return;
    const requestStartedAt = Date.now();
    api.public.get(`/public/tournaments/${verifiedTournamentId}/schedule`).then((d) => {
      reconcilePolledGames(d.games, requestStartedAt);
      setGames(d.games);
      setFocusedGame((previous) => {
        if (!previous) return previous;
        const refreshed = d.games.find((game) => game.id === previous.id);
        return refreshed ? { ...previous, ...refreshed } : previous;
      });
    }).catch(() => {});
  }, [verifiedTournamentId, reconcilePolledGames], 10000);

  if (focusedGame) {
    return (
      <PublicLayout tournamentName={tournament?.name}>
        <GameFocusView game={applyLive(focusedGame)} onBack={() => setFocusedGame(null)} />
      </PublicLayout>
    );
  }

  return (
    <PublicLayout tournamentName={tournament?.name}>
      <h2 style={{ fontSize: '13px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.16em', color: 'var(--color-primary)', marginBottom: '16px' }}>Upcoming Schedule</h2>
      {games.length === 0 ? (
        <div style={{ color: 'var(--color-text-subtle)', fontStyle: 'italic', textAlign: 'center', padding: '32px 0' }}>No upcoming games scheduled.</div>
      ) : (
        <div className="space-y-2">
          {games.map((g) => {
            const liveGame = applyLive(g);
            const isLive = liveGame.status === 'ongoing' && hasGameSides(liveGame);
            const isForfeit = liveGame.status === 'forfeited';
            const needsApproval = liveGame.status === 'completed' && !liveGame.approved_at;
            const isFinal = liveGame.status === 'completed' && liveGame.approved_at;

            let rightContent = null;
            if (isLive) {
              const volleyballSet = liveGame.sport === 'volleyball' ? liveGame.volleyball?.current_set : null;
              rightContent = (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
                  <div className="game-score-cluster">
                    <span className="game-score-chip live">{volleyballSet?.team_a_score ?? liveGame.live_score_a ?? 0}</span>
                    <span className="game-score-separator">-</span>
                    <span className="game-score-chip live">{volleyballSet?.team_b_score ?? liveGame.live_score_b ?? 0}</span>
                  </div>
                  {volleyballSet && <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--color-text-muted)' }}>Set {volleyballSet.set_number} · Sets {liveGame.volleyball.sets_won_a}–{liveGame.volleyball.sets_won_b}</span>}
                  {connectionState === 'connected' ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--color-warning)' }}>
                      <span className="live-dot" /> Live
                    </span>
                  ) : (
                    <span style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--color-text-subtle)' }}>
                      Auto-refreshing
                    </span>
                  )}
                </div>
              );
            } else if (needsApproval) {
              rightContent = (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
                  <div className="game-score-cluster">
                    <span className="game-score-chip">{liveGame.score_a}</span>
                    <span className="game-score-separator">-</span>
                    <span className="game-score-chip">{liveGame.score_b}</span>
                  </div>
                  <span style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--color-warning)', textAlign: 'right' }}>
                    FULL TIME
                    <br />
                    <span style={{ fontWeight: 400, color: 'var(--color-text-subtle)', fontSize: '9px' }}>Awaiting approval</span>
                  </span>
                </div>
              );
            } else if (isFinal) {
              rightContent = (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
                  <div className="game-score-cluster">
                    <span className="game-score-chip">{liveGame.score_a}</span>
                    <span className="game-score-separator">-</span>
                    <span className="game-score-chip">{liveGame.score_b}</span>
                  </div>
                  <span style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--color-primary)' }}>FINAL</span>
                </div>
              );
            } else if (isForfeit) {
              rightContent = (
                <span style={{ color: 'var(--color-danger)', fontSize: '13px', fontWeight: 800, textTransform: 'uppercase' }}>Forfeit</span>
              );
            } else {
              rightContent = (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
                  <span style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--color-text-muted)' }}>
                    SCHEDULED
                  </span>
                  <div style={{ fontSize: '13px', color: 'var(--color-text-muted)', textAlign: 'right' }}>
                    {formatTime(liveGame.scheduled_at)}{liveGame.venue ? <><br />{liveGame.venue}</> : ''}
                  </div>
                </div>
              );
            }

            return (
              <ScheduleGameRow
                key={g.id}
                liveGame={liveGame}
                connectionState={connectionState}
                isLive={isLive}
                needsApproval={needsApproval}
                isFinal={isFinal}
                isForfeit={isForfeit}
                rightContent={rightContent}
                onClick={() => setFocusedGame(liveGame)}
              />
            );
          })}
        </div>
      )}
    </PublicLayout>
  );
}
