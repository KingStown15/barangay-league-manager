export function mergeLiveScoreState(previous = {}, data) {
  return {
    ...previous,
    live_score_a: data.score_a,
    live_score_b: data.score_b,
    status: data.status || 'ongoing',
    updated_at: Date.now(),
  };
}

export function mergeLiveClockState(previous = {}, data) {
  return {
    ...previous,
    current_period: data.current_period,
    game_clock_remaining: data.game_clock_remaining,
    game_clock_running: data.game_clock_running,
    game_clock_started_at: data.game_clock_started_at,
    shot_clock_remaining: data.shot_clock_remaining,
    shot_clock_running: data.shot_clock_running,
    shot_clock_started_at: data.shot_clock_started_at,
    status: data.status || 'ongoing',
    updated_at: Date.now(),
  };
}

export function applyLiveGameOverlay(game, overlay) {
  if (!game || !overlay) return game;
  return { ...game, ...overlay };
}

export function selectLiveGameSnapshot(game, optimisticGame, optimisticBaseGame) {
  if (optimisticGame && game === optimisticBaseGame) return optimisticGame;
  return game;
}

export function retirePolledOverlays(previous = {}, authoritativeGames = [], requestStartedAt = Date.now()) {
  const coveredIds = new Set((authoritativeGames || []).map((game) => String(game.id)));
  let next = previous;
  for (const [gameId, overlay] of Object.entries(previous)) {
    if (!coveredIds.has(String(gameId))) continue;
    const receivedAt = Number(overlay?.updated_at) || 0;
    // Events received after this request began may be newer than its response,
    // so only retire overlays the authoritative poll is guaranteed to cover.
    if (receivedAt >= requestStartedAt) continue;
    if (next === previous) next = { ...previous };
    delete next[gameId];
  }
  return next;
}
