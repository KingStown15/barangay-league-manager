import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { applyLiveGameOverlay } from '../utils/liveGameState.js';
import { mergeConsoleSnapshot } from '../utils/scorerConsoleState.js';
import { useLiveScoreStream } from '../utils/useLiveScoreStream.js';
import { usePolling } from '../utils/usePolling.js';

export default function useScorerConsoleGame(gameId) {
  const [game, setGame] = useState(null);
  const [tournament, setTournament] = useState(null);
  const [pickleball, setPickleball] = useState(null);
  const [periods, setPeriods] = useState([]);
  const [loading, setLoading] = useState(Boolean(gameId));
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState('');
  const gameIdRef = useRef(gameId);
  const liveScoresRef = useRef({});
  const tournamentIdRef = useRef(null);
  const { liveScores, connectionState, reconcilePolledGames } = useLiveScoreStream(game?.tournament_id);

  useEffect(() => { gameIdRef.current = gameId; }, [gameId]);
  useEffect(() => { liveScoresRef.current = liveScores; }, [liveScores]);
  useEffect(() => { tournamentIdRef.current = tournament?.id ?? null; }, [tournament?.id]);

  const loadAuthoritative = useCallback(async ({ initial = false, showRestoring = false, isCurrent = () => true } = {}) => {
    if (!gameId) return null;
    const requestStartedAt = Date.now();
    if (initial) setLoading(true);
    else if (showRestoring) setRestoring(true);
    try {
      const response = await api.get(`/games/${gameId}`);
      if (!isCurrent() || gameIdRef.current !== gameId) return null;
      const authoritative = response.game;
      const overlay = liveScoresRef.current[gameId];
      const merged = mergeConsoleSnapshot(authoritative, overlay, requestStartedAt);
      reconcilePolledGames([authoritative], requestStartedAt);
      setGame(merged);
      setPeriods(response.periods || []);
      setPickleball(response.pickleball || overlay?.pickleball || null);
      setError('');

      if (authoritative.tournament_id !== tournamentIdRef.current) {
        const tournamentResponse = await api.get(`/tournaments/${authoritative.tournament_id}`);
        if (!isCurrent() || gameIdRef.current !== gameId) return null;
        setTournament(tournamentResponse.tournament || null);
      }
      return { game: merged, pickleball: response.pickleball || null };
    } catch (loadError) {
      if (isCurrent() && gameIdRef.current === gameId) setError(loadError.message || 'Unable to load this game.');
      throw loadError;
    } finally {
      if (isCurrent() && gameIdRef.current === gameId) {
        setLoading(false);
        if (showRestoring) setRestoring(false);
      }
    }
  }, [gameId, reconcilePolledGames]);

  usePolling((isCurrent) => {
    loadAuthoritative({ initial: !game, showRestoring: false, isCurrent }).catch(() => {});
  }, [gameId], 7000);

  useEffect(() => {
    if (!gameId || !game?.id) return;
    const overlay = liveScores[gameId];
    if (!overlay) return;
    setGame((previous) => previous?.id === gameId ? applyLiveGameOverlay(previous, overlay) : previous);
    if (overlay.pickleball) setPickleball(overlay.pickleball);
  }, [gameId, game?.id, liveScores]);

  useEffect(() => {
    setGame(null);
    setTournament(null);
    setPickleball(null);
    setPeriods([]);
    setError('');
    setLoading(Boolean(gameId));
  }, [gameId]);

  const applyActionResult = useCallback((accepted) => {
    if (accepted?.game) {
      setGame((previous) => previous?.id === accepted.game.id ? { ...previous, ...accepted.game } : accepted.game);
    }
    if (accepted?.pickleball) {
      setPickleball(accepted.pickleball);
      setGame((previous) => previous ? {
        ...previous,
        live_score_a: accepted.pickleball.state?.side_a_points ?? previous.live_score_a,
        live_score_b: accepted.pickleball.state?.side_b_points ?? previous.live_score_b,
      } : previous);
    }
  }, []);

  const reloadAuthoritative = useCallback(
    () => loadAuthoritative({ initial: false, showRestoring: true }),
    [loadAuthoritative],
  );

  return {
    game,
    tournament,
    pickleball,
    periods,
    loading,
    restoring,
    error,
    connectionState,
    reloadAuthoritative,
    applyActionResult,
  };
}
