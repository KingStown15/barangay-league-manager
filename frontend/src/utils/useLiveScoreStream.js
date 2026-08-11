import { useEffect, useRef, useState, useCallback } from 'react';
import { mergeLiveClockState, mergeLiveScoreState, retirePolledOverlays } from './liveGameState';

export function useLiveScoreStream(tournamentId) {
  const [liveScores, setLiveScores] = useState({});
  const [finalizedScores, setFinalizedScores] = useState({});
  const [connectionState, setConnectionState] = useState('disconnected');
  const sourceRef = useRef(null);
  const reconnectTimer = useRef(null);
  const mountedRef = useRef(true);

  const updateGameScore = useCallback((gameId, scoreA, scoreB, status, approvedAt) => {
    if (status !== 'ongoing') {
      setLiveScores((prev) => {
        const next = { ...prev };
        delete next[gameId];
        return next;
      });
      setFinalizedScores((prev) => ({
        ...prev,
        [gameId]: { score_a: scoreA, score_b: scoreB, status, approved_at: approvedAt, updated_at: Date.now() },
      }));
      return;
    }
    setLiveScores((prev) => ({
      ...prev,
      [gameId]: mergeLiveScoreState(prev[gameId], { score_a: scoreA, score_b: scoreB, status }),
    }));
  }, []);

  const handleGameStarted = useCallback((gameId) => {
    setLiveScores((prev) => ({
      ...prev,
      [gameId]: { ...prev[gameId], live_score_a: 0, live_score_b: 0, status: 'ongoing', updated_at: Date.now() },
    }));
  }, []);

  const handlePickleballState = useCallback((data) => {
    setLiveScores((prev) => ({
      ...prev,
      [data.game_id]: {
        ...prev[data.game_id],
        live_score_a: data.state?.side_a_points ?? 0,
        live_score_b: data.state?.side_b_points ?? 0,
        status: 'ongoing',
        pickleball: { state: data.state || null, completed_games: data.completed_games || [] },
        updated_at: Date.now(),
      },
    }));
  }, []);

  const handleVolleyballState = useCallback((data) => {
    setLiveScores((prev) => ({
      ...prev,
      [data.game_id]: {
        ...prev[data.game_id],
        live_score_a: data.score_a ?? data.state?.sets_won_a ?? 0,
        live_score_b: data.score_b ?? data.state?.sets_won_b ?? 0,
        status: 'ongoing',
        volleyball: data.state || null,
        updated_at: Date.now(),
      },
    }));
  }, []);

  const handleClockUpdate = useCallback((data) => {
    setLiveScores((prev) => ({
      ...prev,
      [data.game_id]: mergeLiveClockState(prev[data.game_id], data),
    }));
  }, []);

  const reconcilePolledGames = useCallback((games, requestStartedAt) => {
    setLiveScores((previous) => retirePolledOverlays(previous, games, requestStartedAt));
    setFinalizedScores((previous) => retirePolledOverlays(previous, games, requestStartedAt));
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!tournamentId) return;

    function connect() {
      if (!mountedRef.current) return;
      if (sourceRef.current) sourceRef.current.close();

      setConnectionState('connecting');
      const url = `/api/live/events?tournament_id=${tournamentId}`;
      const source = new EventSource(url);
      sourceRef.current = source;

      source.onopen = () => {
        if (mountedRef.current) setConnectionState('connected');
      };

      source.onmessage = (event) => {
        if (!mountedRef.current) return;
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'score_update') {
            updateGameScore(data.game_id, data.score_a, data.score_b, data.status, data.approved_at);
          } else if (data.type === 'game_started') {
            handleGameStarted(data.game_id);
          } else if (data.type === 'pickleball_state_update') {
            handlePickleballState(data);
          } else if (data.type === 'volleyball_state_update') {
            handleVolleyballState(data);
          } else if (data.type === 'clock_update') {
            handleClockUpdate(data);
          } else if (data.type === 'connected') {
            setConnectionState('connected');
          }
        } catch {}
      };

      source.onerror = () => {
        if (!mountedRef.current) return;
        setConnectionState('reconnecting');
        source.close();
        sourceRef.current = null;
        reconnectTimer.current = setTimeout(connect, 3000);
      };
    }

    connect();

    return () => {
      if (sourceRef.current) {
        sourceRef.current.close();
        sourceRef.current = null;
      }
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      setConnectionState('disconnected');
      setFinalizedScores({});
    };
  }, [tournamentId, updateGameScore, handleGameStarted, handlePickleballState, handleVolleyballState, handleClockUpdate]);

  return { liveScores, finalizedScores, connectionState, reconcilePolledGames };
}
