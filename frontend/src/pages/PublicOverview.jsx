import { useState, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import PublicLayout from '../layouts/PublicLayout';
import { usePublicTournament } from '../utils/usePublicTournament';
import { usePolling } from '../utils/usePolling';
import { useLiveScoreStream } from '../utils/useLiveScoreStream';
import GameFocusView from '../components/GameFocusView';
import { getWinnerSide } from '../utils/gameResultStyles';
import { useBasketballLiveClock } from '../utils/useBasketballLiveClock';
import { formatCompletedGames, formatEntryLabel, getGameDivision, getGameSideName, hasGameSides, isPickleballGame } from '../utils/entryDisplay';

function formatTime(iso) {
  if (!iso) return 'Time TBA';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function GameCard({ game, onClick, liveConnected }) {
  const hasSides = hasGameSides(game);
  const isLive = game.status === 'ongoing' && hasSides;
  const isForfeit = game.status === 'forfeited';
  const needsApproval = game.status === 'completed' && !game.approved_at;
  const isFinal = game.status === 'completed' && game.approved_at;
  const volleyballSet = isLive && game.sport === 'volleyball' ? game.volleyball?.current_set : null;
  const scoreA = isLive ? (volleyballSet?.team_a_score ?? game.live_score_a) : game.score_a;
  const scoreB = isLive ? (volleyballSet?.team_b_score ?? game.live_score_b) : game.score_b;
  const winnerSide = getWinnerSide(game);
  const wA = winnerSide === 'A';
  const wB = winnerSide === 'B';
  const clockDisplay = useBasketballLiveClock(game);
  const sideAName = getGameSideName(game, 'a');
  const sideBName = getGameSideName(game, 'b');
  const isPickleball = isPickleballGame(game);
  const breakdown = formatCompletedGames(game);

  let rightContent = null;
  if (isLive) {
    rightContent = (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="game-score-chip live" style={{ width: 40, minWidth: 40, height: 28, fontSize: 14 }}>{scoreA ?? 0}</span>
          <span className="game-score-separator" style={{ width: 12 }}>-</span>
          <span className="game-score-chip live" style={{ width: 40, minWidth: 40, height: 28, fontSize: 14 }}>{scoreB ?? 0}</span>
        </div>
        {liveConnected ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '9px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--color-warning)' }}>
            <span className="live-dot" /> Live
          </span>
        ) : (
          <span style={{ fontSize: '9px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--color-text-subtle)' }}>
            Auto-refreshing
          </span>
        )}
      </div>
    );
  } else if (needsApproval) {
    rightContent = (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="game-score-chip" style={{ width: 40, minWidth: 40, height: 28, fontSize: 14 }}>{scoreA}</span>
          <span className="game-score-separator" style={{ width: 12 }}>-</span>
          <span className="game-score-chip" style={{ width: 40, minWidth: 40, height: 28, fontSize: 14 }}>{scoreB}</span>
        </div>
        <span style={{ fontSize: '9px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--color-warning)', textAlign: 'center' }}>
          FULL TIME
          <br />
          <span style={{ fontWeight: 400, color: 'var(--color-text-subtle)', fontSize: '8px' }}>Awaiting approval</span>
        </span>
      </div>
    );
  } else if (isFinal) {
    rightContent = (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="game-score-chip" style={{ width: 40, minWidth: 40, height: 28, fontSize: 14 }}>{scoreA}</span>
          <span className="game-score-separator" style={{ width: 12 }}>-</span>
          <span className="game-score-chip" style={{ width: 40, minWidth: 40, height: 28, fontSize: 14 }}>{scoreB}</span>
        </div>
        <span style={{ fontSize: '9px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--color-primary)' }}>FINAL</span>
      </div>
    );
  } else if (isForfeit) {
    rightContent = (
      <span style={{ color: 'var(--color-danger)', fontSize: '13px', fontWeight: 800, textTransform: 'uppercase', flexShrink: 0 }}>Forfeit</span>
    );
  }

  return (
    <button
      className="public-card"
      style={{ width: '100%', textAlign: 'left', padding: '10px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', cursor: 'pointer', border: isLive ? '1px solid var(--color-primary)' : needsApproval ? '1px solid var(--color-warning)' : undefined }}
      onClick={onClick}
    >
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '3px' }}>
        {game.round_label && <div style={{ fontSize: '10px', color: 'var(--color-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>{game.round_label}{game.group_name ? ` · ${game.group_name}` : ''}</div>}
        {isPickleball && <div className="entry-context-line">Pickleball · {formatEntryLabel(getGameDivision(game))}</div>}
        <div className="entry-matchup-label" style={{ fontSize: '16px', fontWeight: 800, letterSpacing: '-0.01em', color: 'var(--color-text)' }}>
          <span style={{ color: wA ? '#16A34A' : (winnerSide ? '#EF4444' : undefined) }}>{sideAName}</span>
          <span style={{ color: 'var(--color-text-subtle)' }}> vs </span>
          <span style={{ color: wB ? '#16A34A' : (winnerSide ? '#EF4444' : undefined) }}>{sideBName}</span>
        </div>
        {clockDisplay && (
          <div style={{ fontSize: '11px', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-muted)' }}>{clockDisplay.text}</div>
        )}
        {volleyballSet && <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-text-muted)' }}>Set {volleyballSet.set_number} · Sets {game.volleyball.sets_won_a}–{game.volleyball.sets_won_b}</div>}
        <div style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>{formatTime(game.scheduled_at)}{game.venue ? ` · ${game.venue}` : ''}</div>
        {breakdown && <div className="entry-game-breakdown">Games: {breakdown}</div>}
      </div>
      {rightContent}
    </button>
  );
}

export default function PublicOverview() {
  const { tournament, tournamentId } = usePublicTournament();
  const [schedule, setSchedule] = useState([]);
  const [results, setResults] = useState([]);
  const [pendingResults, setPendingResults] = useState([]);
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
    const refreshFocused = (games) => setFocusedGame((previous) => {
      if (!previous) return previous;
      const refreshed = games.find((game) => game.id === previous.id);
      return refreshed ? { ...previous, ...refreshed } : previous;
    });
    const scheduleRequestedAt = Date.now();
    api.public.get(`/public/tournaments/${verifiedTournamentId}/schedule`).then((d) => {
      reconcilePolledGames(d.games, scheduleRequestedAt);
      setSchedule(d.games);
      refreshFocused(d.games);
    }).catch(() => {});
    const resultsRequestedAt = Date.now();
    api.public.get(`/public/tournaments/${verifiedTournamentId}/results`).then((d) => {
      reconcilePolledGames(d.games, resultsRequestedAt);
      setResults(d.games);
      refreshFocused(d.games);
    }).catch(() => {});
    const pendingRequestedAt = Date.now();
    api.public.get(`/public/tournaments/${verifiedTournamentId}/pending-results`).then((d) => {
      const games = d.games || [];
      reconcilePolledGames(games, pendingRequestedAt);
      setPendingResults(games);
      refreshFocused(games);
    }).catch(() => {});
  }, [verifiedTournamentId, reconcilePolledGames], 10000);

  const today = new Date().toDateString();
  const liveGames = schedule.filter((g) => {
    if (finalizedScores[g.id]) return false;
    return g.status === 'ongoing' || liveScores[g.id]?.status === 'ongoing';
  });
  const todaysGames = schedule.filter(
    (g) => g.status !== 'ongoing' && !liveScores[g.id] && !finalizedScores[g.id] && g.scheduled_at && new Date(g.scheduled_at).toDateString() === today
  );

  const pendingGames = useMemo(() => {
    const map = {};
    pendingResults.forEach((g) => {
      const final = finalizedScores[g.id];
      if (final) {
        map[g.id] = { ...g, score_a: final.score_a, score_b: final.score_b, status: final.status, approved_at: final.approved_at };
      } else {
        map[g.id] = g;
      }
    });
    Object.entries(finalizedScores).forEach(([id, f]) => {
      const gameId = Number(id);
      if (!map[gameId] && !f.approved_at && ['completed', 'forfeited'].includes(f.status)) {
        const fromSchedule = schedule.find((s) => s.id === gameId);
        if (fromSchedule) {
          map[gameId] = { ...fromSchedule, score_a: f.score_a, score_b: f.score_b, status: f.status, approved_at: f.approved_at };
        }
      }
    });
    return Object.values(map).filter((g) => !g.approved_at);
  }, [pendingResults, finalizedScores, schedule]);
  const finalGame = results.find((game) => ['final', 'championship', 'finals'].includes(String(game.round_label || '').toLowerCase()) && game.approved_at);
  const championSide = finalGame ? getWinnerSide(finalGame) : null;
  const championName = championSide ? getGameSideName(finalGame, championSide === 'A' ? 'a' : 'b') : null;

  if (focusedGame) {
    return (
      <PublicLayout tournamentName={tournament?.name}>
        <GameFocusView game={applyLive(focusedGame)} onBack={() => setFocusedGame(null)} />
      </PublicLayout>
    );
  }

  return (
    <PublicLayout tournamentName={tournament?.name}>
      <div className="space-y-8">
        {tournament?.sport === 'pickleball' && (
          <div className="entry-context-line">Pickleball · {formatEntryLabel(tournament.division)} · {formatEntryLabel(tournament.competition_format)}</div>
        )}
        {championName && (
          <section className="public-card public-champion-card">
            <span>Champion</span>
            <strong>{championName}</strong>
            <small>{finalGame.score_a}–{finalGame.score_b}{formatCompletedGames(finalGame) ? ` · Games ${formatCompletedGames(finalGame)}` : ''}</small>
          </section>
        )}
        {liveGames.length > 0 && (
          <section>
            <h2 style={{ fontSize: '13px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.16em', color: 'var(--color-primary)', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="live-dot" style={{ color: 'var(--color-primary)' }} /> Live Now
            </h2>
            <div className="space-y-2">
              {liveGames.map((g) => {
                const liveGame = applyLive(g);
                return <GameCard key={g.id} game={liveGame} onClick={() => setFocusedGame(liveGame)} liveConnected={connectionState === 'connected'} />;
              })}
            </div>
          </section>
        )}

        {pendingGames.length > 0 && (
          <section>
            <h2 style={{ fontSize: '13px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.16em', color: 'var(--color-warning)', marginBottom: '12px' }}>
              Pending Results
            </h2>
            <div className="space-y-2">
              {pendingGames.map((g) => (
                <GameCard key={g.id} game={g} onClick={() => setFocusedGame(g)} liveConnected={connectionState === 'connected'} />
              ))}
            </div>
          </section>
        )}

        <section>
          <h2 style={{ fontSize: '13px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.16em', color: 'var(--color-primary)', marginBottom: '12px' }}>Today's Games</h2>
          {todaysGames.length === 0 ? (
            <div style={{ color: 'var(--color-text-subtle)', fontStyle: 'italic' }}>No games scheduled today.</div>
          ) : (
            <div className="space-y-2">
              {todaysGames.map((g) => {
                const liveGame = applyLive(g);
                return <GameCard key={g.id} game={liveGame} onClick={() => setFocusedGame(liveGame)} liveConnected={connectionState === 'connected'} />;
              })}
            </div>
          )}
        </section>

        <section>
          <h2 style={{ fontSize: '13px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.16em', color: 'var(--color-primary)', marginBottom: '12px' }}>Recent Results</h2>
          {results.length === 0 ? (
            <div style={{ color: 'var(--color-text-subtle)', fontStyle: 'italic' }}>No results yet.</div>
          ) : (
            <div className="space-y-2">
              {results.slice(0, 5).map((g) => (
                <GameCard key={g.id} game={g} onClick={() => setFocusedGame(g)} />
              ))}
            </div>
          )}
        </section>

        <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', fontSize: '14px', paddingTop: '16px' }}>
          <Link to={`/public/${tournamentId}/standings`} style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}>Full Standings</Link>
          <Link to={`/public/${tournamentId}/bracket`} style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}>Bracket</Link>
        </div>
      </div>
    </PublicLayout>
  );
}
