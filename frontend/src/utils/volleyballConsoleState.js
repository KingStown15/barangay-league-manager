export function getVolleyballConsoleSnapshot(state, gameId = null) {
  if (!state) return null;
  return {
    gameId,
    setsA: state.sets_won_a ?? 0,
    setsB: state.sets_won_b ?? 0,
    setNumber: state.current_set?.set_number ?? state.completed_sets?.length ?? 0,
    scoreA: state.current_set?.team_a_score ?? 0,
    scoreB: state.current_set?.team_b_score ?? 0,
    matchComplete: Boolean(state.match_complete),
  };
}

export function getVolleyballSetMessage(state) {
  if (!state) return { tone: 'warning', title: 'STATE UNAVAILABLE', detail: 'Reload the match.' };
  if (state.match_complete) {
    return { tone: 'success', title: 'MATCH COMPLETE', detail: 'Review and submit the final result in Full Scorer.' };
  }
  const current = state.current_set;
  if (!current) return { tone: 'warning', title: 'SET UNAVAILABLE', detail: 'Reload the match.' };
  if (current.winner) {
    return { tone: 'success', title: 'SET READY TO CONFIRM', detail: `Set ${current.set_number} · ${current.team_a_score}–${current.team_b_score}` };
  }
  const high = Math.max(current.team_a_score, current.team_b_score);
  const difference = Math.abs(current.team_a_score - current.team_b_score);
  if (high >= current.target - 1 && difference === 0) {
    return { tone: 'warning', title: 'WIN BY 2', detail: `Target ${current.target} · play continues` };
  }
  if (high >= current.target && difference === 1) {
    return { tone: 'warning', title: 'WIN BY 2 — PLAY CONTINUES', detail: `Target ${current.target}` };
  }
  return { tone: 'neutral', title: `FIRST TO ${current.target}`, detail: 'Win by 2' };
}

export function canReopenVolleyballSet(state) {
  if (!state || (state.completed_sets?.length ?? 0) === 0) return false;
  if (state.match_complete) return true;
  return Boolean(state.current_set && state.current_set.team_a_score === 0 && state.current_set.team_b_score === 0);
}
