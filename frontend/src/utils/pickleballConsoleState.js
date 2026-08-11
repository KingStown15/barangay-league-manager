function label(value) {
  return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function getPickleballFormatLabel(tournament, rules = {}) {
  const competition = label(rules.competition_format || tournament?.competition_format || 'pickleball');
  const division = label(rules.division || tournament?.division || tournament?.custom_division || 'Open');
  const scoring = label(rules.scoring_mode || 'side_out');
  return `${competition} · ${division} · ${scoring}`;
}

export function getPickleballRuleSummary(state, rules = state?.rules || {}) {
  const gamesToWin = rules.games_to_win ?? 2;
  const decidingGame = gamesToWin > 1
    && state?.side_a_games_won === gamesToWin - 1
    && state?.side_b_games_won === gamesToWin - 1;
  const target = decidingGame
    ? (rules.points_to_win_deciding_game ?? rules.points_to_win_standard_game ?? 11)
    : (rules.points_to_win_standard_game ?? 11);
  const winBy = rules.win_by ?? 2;
  const cap = rules.score_cap;
  return `Best of ${(gamesToWin * 2) - 1} · First to ${target} · Win by ${winBy}${cap ? ` · Cap ${cap}` : ''}`;
}

export function getPickleballStateMessage(state) {
  if (!state) return { tone: 'warning', title: 'STATE UNAVAILABLE', detail: 'Reload the match.' };
  if (state.match_state === 'between_games') {
    return { tone: 'success', title: `GAME ${state.current_game_number} COMPLETE`, detail: 'Review the score, then start the next game.' };
  }
  if (state.match_state === 'ready_to_submit') {
    return { tone: 'success', title: 'MATCH COMPLETE', detail: 'Review and submit the result in Full Scorer.' };
  }
  if (state.match_state === 'pending_approval') {
    return { tone: 'warning', title: 'PENDING APPROVAL', detail: 'Scoring is locked.' };
  }
  if (state.match_state === 'approved') {
    return { tone: 'success', title: 'RESULT APPROVED', detail: 'Scoring is locked.' };
  }
  return { tone: 'neutral', title: `GAME ${state.current_game_number}`, detail: getPickleballRuleSummary(state) };
}

export function canStartNextPickleballGame(state) {
  return state?.match_state === 'between_games';
}

export function canScorePickleball(state) {
  return state?.match_state === 'in_progress';
}
