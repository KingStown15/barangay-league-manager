import { useState, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Trophy, CalendarDays, CalendarOff, Medal } from 'lucide-react';
import { api } from '../api/client';
import { useTournamentSelection } from '../utils/useTournamentSelection';
import TournamentPicker from '../components/TournamentPicker';
import GameCard from '../components/GameCard';
import StandingsTable from '../components/StandingsTable';
import PageHeader from '../components/ui/PageHeader';
import EmptyState from '../components/ui/EmptyState';
import Badge from '../components/ui/Badge';
import { getWinnerSide, hasScorePair } from '../utils/gameResultStyles';
import { SkeletonList, SkeletonCard } from '../components/Skeleton';
import { usePolling } from '../utils/usePolling';
import { useLiveScoreStream } from '../utils/useLiveScoreStream';
import { useAuth } from '../context/AuthContext';
import { formatCompletedGames, getGameSideName, getMatchupLabel } from '../utils/entryDisplay';
import { isAdminRole } from '../utils/roles';

function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getGameLocalDateKey(game) {
  if (!game.scheduled_at) return null;
  const d = new Date(game.scheduled_at);
  if (Number.isNaN(d.getTime())) return null;
  return getLocalDateKey(d);
}

function getDashboardGameBucket(game, todayKey) {
  const status = String(game.status || '').toLowerCase().replace(/\s+/g, '_');

  if (['completed', 'forfeited'].includes(status) && !game.approved_at) {
    return 'pendingApproval';
  }

  if (status === 'ongoing') {
    return 'ongoing';
  }

  if (getGameLocalDateKey(game) === todayKey && status === 'scheduled') {
    return 'todayScheduled';
  }

  if (['completed', 'forfeited'].includes(status) && game.approved_at) {
    return 'recentlyCompleted';
  }

  return null;
}

function DashboardRecentResultCard({ game }) {
  const winnerSide = getWinnerSide(game);
  const wA = winnerSide === 'A';
  const wB = winnerSide === 'B';
  const hasScore = hasScorePair(game.score_a, game.score_b);
  const sideAName = getGameSideName(game, 'a');
  const sideBName = getGameSideName(game, 'b');
  const breakdown = formatCompletedGames(game);

  return (
    <div className="card" style={{
      minHeight: 92,
      padding: '14px 16px',
      display: 'grid',
      gridTemplateColumns: '1fr auto',
      alignItems: 'center',
      gap: 16,
    }}>
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {game.round_label && (
            <span style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--color-text-muted)' }}>{game.round_label}</span>
          )}
          <Badge variant={game.status}>{game.status}</Badge>
        </div>
        <div className="entry-matchup-label" style={{ fontSize: 15, fontWeight: 800 }}>
          <span style={{ color: wA ? '#16A34A' : (winnerSide ? '#EF4444' : undefined) }}>{sideAName}</span>
          <span style={{ color: 'var(--color-text-soft)' }}> vs </span>
          <span style={{ color: wB ? '#16A34A' : (winnerSide ? '#EF4444' : undefined) }}>{sideBName}</span>
        </div>
        {breakdown && <div className="entry-game-breakdown">Games: {breakdown}</div>}
      </div>

      {hasScore && (
        <div className="game-score-cluster" style={{ minWidth: 'auto', flex: 'none' }}>
          <span className="game-score-chip" style={{ width: 42, minWidth: 42, height: 30, fontSize: 15 }}>{game.score_a}</span>
          <span className="game-score-separator">-</span>
          <span className="game-score-chip" style={{ width: 42, minWidth: 42, height: 30, fontSize: 15 }}>{game.score_b}</span>
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const { tournaments, tournamentId, setTournamentId, loading: tLoading } = useTournamentSelection();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const fetchIdRef = useRef(0);

  const { liveScores, finalizedScores, reconcilePolledGames } = useLiveScoreStream(tournamentId);

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
    if (!tournamentId) return;
    setError('');
    setData(null);
    const id = ++fetchIdRef.current;
    const requestStartedAt = Date.now();
    api.get(`/dashboard?tournament_id=${tournamentId}&date=${getLocalDateKey()}`)
      .then((d) => {
        if (fetchIdRef.current === id) {
          reconcilePolledGames([
            ...(d.todaysGames || []),
            ...(d.ongoingGames || []),
            ...(d.recentlyCompleted || []),
            ...(d.pendingApprovals || []),
          ], requestStartedAt);
          setData(d);
          setError('');
        }
      })
      .catch((err) => { if (fetchIdRef.current === id) setError(err.message); });
  }, [tournamentId, reconcilePolledGames]);

  if (tLoading) {
    return (
      <div className="space-y-8">
        <SkeletonCard lines={2} />
        <SkeletonList count={2} />
      </div>
    );
  }

  if (error) return <div style={{ color: 'var(--color-danger)' }}>{error}</div>;

  const selectedTournament = tournaments.find((t) => String(t.id) === String(tournamentId));
  const noTournaments = tournaments.length === 0;

  if (noTournaments) {
    return (
      <div>
        <PageHeader title="Dashboard" />
        <EmptyState
          icon={Trophy}
          title="No tournaments yet"
          description="Create a tournament to see your dashboard."
          action={isAdminRole(user.role) && (
            <Link to="/tournaments" className="btn-primary">Set Up a Tournament</Link>
          )}
        />
      </div>
    );
  }

  if (!data) return null;

  const { notFound, activeTournament, todaysGames, ongoingGames, recentlyCompleted, pendingApprovals, topStandings } = data;
  const todayKey = getLocalDateKey();

  const allGames = [
    ...(pendingApprovals || []),
    ...(ongoingGames || []),
    ...(todaysGames || []),
    ...(recentlyCompleted || []),
  ];

  const seenIds = new Set();
  const buckets = { pendingApproval: [], ongoing: [], todayScheduled: [], recentlyCompleted: [] };
  for (const game of allGames) {
    if (seenIds.has(game.id)) continue;
    const g = applyLive(game);
    const bucket = getDashboardGameBucket(g, todayKey);
    if (bucket && buckets[bucket]) {
      seenIds.add(g.id);
      buckets[bucket].push(g);
    }
  }

  if (notFound || !selectedTournament) {
    return (
      <div>
        <PageHeader title="Dashboard" />
        <TournamentPicker tournaments={tournaments} tournamentId={tournamentId} onChange={setTournamentId} />
        <EmptyState
          icon={Trophy}
          title="Tournament not found"
          description="The selected tournament may have been archived or deleted. Select a different tournament."
        />
      </div>
    );
  }

  const scopedStandings = topStandings || [];

  return (
    <div className="space-y-6">
      <TournamentPicker tournaments={tournaments} tournamentId={tournamentId} onChange={setTournamentId} />

      <PageHeader
        eyebrow="Active Tournament"
        title={selectedTournament.name}
        subtitle={selectedTournament.venue || ''}
      />

      {isAdminRole(user.role) && buckets.pendingApproval.length > 0 && (
        <section className="card card-padding" style={{ borderLeft: '3px solid var(--color-danger)' }}>
          <h2 className="font-semibold text-sm mb-3" style={{ color: 'var(--color-danger)' }}>
            Pending Score Approvals
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            {buckets.pendingApproval.map((g) => (
              <Link key={g.id} to="/games">
                <GameCard game={g} />
              </Link>
            ))}
          </div>
        </section>
      )}

      {buckets.ongoing.length > 0 && (
        <section>
          <h2 className="font-semibold text-sm mb-3 flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            <span className="w-2 h-2 rounded-full" style={{ background: 'var(--color-primary)', boxShadow: '0 0 0 0 rgba(217, 119, 6, 0.7)', animation: 'livePulse 1.6s infinite' }} />
            Ongoing Now
            <Badge variant="live">{buckets.ongoing.length}</Badge>
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            {buckets.ongoing.map((g) => <GameCard key={g.id} game={g} />)}
          </div>
        </section>
      )}

      <section>
        <h2 className="font-semibold text-sm mb-3" style={{ color: 'var(--color-text)' }}>Today's Games</h2>
        {buckets.todayScheduled.length === 0 ? (
          <EmptyState icon={CalendarOff} title="No games scheduled today" description="Once games are added for this tournament today, they will appear here." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {buckets.todayScheduled.map((g) => (
              <Link
                key={g.id}
                to={`/games?gameId=${g.id}`}
                aria-label={`Open scheduled game ${getMatchupLabel(g)}`}
              >
                <GameCard game={g} />
              </Link>
            ))}
          </div>
        )}
      </section>

      <div className="grid md:grid-cols-2 gap-6">
        <section>
          <h2 className="font-semibold text-sm mb-3" style={{ color: 'var(--color-text)' }}>Recently Completed</h2>
          <div className="space-y-3">
            {buckets.recentlyCompleted.length === 0 ? (
              <EmptyState icon={Medal} title="No results yet" description="Final scores will appear after results are submitted and approved." variant="compact" />
            ) : (
              buckets.recentlyCompleted.map((g) => <DashboardRecentResultCard key={g.id} game={g} />)
            )}
          </div>
        </section>

        <section>
          <h2 className="font-semibold text-sm mb-3" style={{ color: 'var(--color-text)' }}>Top Standings</h2>
          <div className="card" style={{ padding: '16px' }}>
            <StandingsTable standings={scopedStandings} compact />
          </div>
        </section>
      </div>
    </div>
  );
}
