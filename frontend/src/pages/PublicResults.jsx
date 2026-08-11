import { useState, useMemo } from 'react';
import { api } from '../api/client';
import PublicLayout from '../layouts/PublicLayout';
import { usePublicTournament } from '../utils/usePublicTournament';
import { usePolling } from '../utils/usePolling';
import { useLiveScoreStream } from '../utils/useLiveScoreStream';
import { getWinnerSide } from '../utils/gameResultStyles';
import { formatCompletedGames, formatEntryLabel, getGameDivision, getGameSideName, isPickleballGame } from '../utils/entryDisplay';

export default function PublicResults() {
  const { tournament } = usePublicTournament();
  const [games, setGames] = useState([]);
  const verifiedTournamentId = tournament?.id;
  const { finalizedScores, reconcilePolledGames } = useLiveScoreStream(verifiedTournamentId);

  usePolling(() => {
    if (!verifiedTournamentId) return;
    const requestStartedAt = Date.now();
    api.public.get(`/public/tournaments/${verifiedTournamentId}/results`).then((d) => {
      reconcilePolledGames(d.games, requestStartedAt);
      setGames(d.games);
    }).catch(() => {});
  }, [verifiedTournamentId, reconcilePolledGames], 12000);

  const displayGames = useMemo(() => {
    return games.map((g) => {
      const final = finalizedScores[g.id];
      if (!final || !final.approved_at) return g;
      return { ...g, score_a: final.score_a, score_b: final.score_b, status: final.status, approved_at: final.approved_at };
    });
  }, [games, finalizedScores]);

  return (
    <PublicLayout tournamentName={tournament?.name}>
      <h2 style={{ fontSize: '13px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.16em', color: 'var(--color-primary)', marginBottom: '16px' }}>Results</h2>
      {displayGames.length === 0 ? (
        <div style={{ color: 'var(--color-text-subtle)', fontStyle: 'italic', textAlign: 'center', padding: '32px 0' }}>No results yet.</div>
      ) : (
        <div className="space-y-2">
          {displayGames.map((g) => {
            const winnerSide = getWinnerSide(g);
            const winnerA = winnerSide === 'A';
            const winnerB = winnerSide === 'B';
            const sideAName = getGameSideName(g, 'a');
            const sideBName = getGameSideName(g, 'b');
            const breakdown = formatCompletedGames(g);
            return (
              <div key={g.id} className="public-card" style={{ padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                <div>
                  {g.round_label && <div style={{ fontSize: '11px', color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 800 }}>{g.round_label}{g.group_name ? ` · ${g.group_name}` : ''}</div>}
                  {isPickleballGame(g) && <div className="entry-context-line">Pickleball · {formatEntryLabel(getGameDivision(g))}</div>}
                  <div style={{ fontSize: '13px', marginTop: '4px' }}>
                    <span style={{ fontWeight: winnerA ? 700 : (winnerSide ? 500 : 700), color: winnerA ? '#16A34A' : (winnerSide ? '#EF4444' : '#0F172A') }}>{sideAName}</span>
                    {g.score_a !== null && g.score_a !== undefined && <span style={{ fontWeight: 400, color: '#94A3B8', marginLeft: '4px' }}>{g.score_a}</span>}
                  </div>
                  <div style={{ fontSize: '13px', marginTop: '2px' }}>
                    <span style={{ fontWeight: winnerB ? 700 : (winnerSide ? 500 : 700), color: winnerB ? '#16A34A' : (winnerSide ? '#EF4444' : '#0F172A') }}>{sideBName}</span>
                    {g.score_b !== null && g.score_b !== undefined && <span style={{ fontWeight: 400, color: '#94A3B8', marginLeft: '4px' }}>{g.score_b}</span>}
                  </div>
                  {breakdown && <div className="entry-game-breakdown">Games: {breakdown}</div>}
                </div>
                {g.status === 'forfeited' ? (
                  <span style={{ color: '#DC2626', fontSize: '12px', fontWeight: 800, textTransform: 'uppercase' }}>Forfeit</span>
                ) : (
                  <div className="game-score-cluster" style={{ flex: '0 0 136px' }}>
                    <span className="game-score-chip">{g.score_a !== null && g.score_a !== undefined ? g.score_a : '-'}</span>
                    <span className="game-score-separator">-</span>
                    <span className="game-score-chip">{g.score_b !== null && g.score_b !== undefined ? g.score_b : '-'}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </PublicLayout>
  );
}
