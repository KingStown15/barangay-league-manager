const CHAMPIONSHIP_LABELS = new Set(['final', 'finals', 'championship']);

function isChampionshipRound(roundLabel) {
  return CHAMPIONSHIP_LABELS.has(String(roundLabel || '').trim().toLowerCase());
}

function getVolleyballRules(roundLabel) {
  const championship = isChampionshipRound(roundLabel);
  return {
    format: championship ? 'best_of_5' : 'best_of_3',
    sets_to_win: championship ? 3 : 2,
    max_sets: championship ? 5 : 3,
    regular_set_target: 25,
    deciding_set_target: 15,
    win_by: 2,
  };
}

function getSetTarget(setNumber, rules) {
  return setNumber === rules.max_sets ? rules.deciding_set_target : rules.regular_set_target;
}

function getSetWinner(scoreA, scoreB, target) {
  if (Math.max(scoreA, scoreB) < target || Math.abs(scoreA - scoreB) < 2) return null;
  return scoreA > scoreB ? 'A' : 'B';
}

function buildVolleyballState(game, rows) {
  const rules = getVolleyballRules(game.round_label);
  const setsWonA = Number(game.live_score_a ?? game.score_a ?? 0);
  const setsWonB = Number(game.live_score_b ?? game.score_b ?? 0);
  const matchComplete = setsWonA >= rules.sets_to_win || setsWonB >= rules.sets_to_win;
  const confirmedCount = setsWonA + setsWonB;
  const completedSets = rows.slice(0, confirmedCount).map((row) => ({
    set_number: row.period_number,
    team_a_score: row.team_a_score,
    team_b_score: row.team_b_score,
  }));
  const currentRow = matchComplete ? null : rows[confirmedCount] || null;
  const currentSetNumber = currentRow?.period_number || Math.min(confirmedCount + 1, rules.max_sets);
  const target = getSetTarget(currentSetNumber, rules);
  const currentSet = currentRow ? {
    set_number: currentSetNumber,
    team_a_score: currentRow.team_a_score,
    team_b_score: currentRow.team_b_score,
    target,
    winner: getSetWinner(currentRow.team_a_score, currentRow.team_b_score, target),
  } : null;

  return {
    rules,
    sets_won_a: setsWonA,
    sets_won_b: setsWonB,
    completed_sets: completedSets,
    current_set: currentSet,
    match_complete: matchComplete,
    ready_to_submit: matchComplete,
  };
}

function getVolleyballState(db, game) {
  const rows = db.prepare(
    'SELECT id, period_number, team_a_score, team_b_score FROM game_period_scores WHERE game_id = ? ORDER BY period_number'
  ).all(game.id);
  return buildVolleyballState(game, rows);
}

function getVolleyballStates(db, games) {
  const rows = Array.isArray(games) ? games : [games];
  const volleyballGames = rows.filter((game) => game.sport === 'volleyball');
  if (volleyballGames.length === 0) return {};
  const ids = volleyballGames.map((game) => game.id);
  const placeholders = ids.map(() => '?').join(',');
  const periodsByGame = {};
  db.prepare(
    `SELECT game_id, id, period_number, team_a_score, team_b_score
     FROM game_period_scores WHERE game_id IN (${placeholders}) ORDER BY game_id, period_number`
  ).all(...ids).forEach((period) => {
    if (!periodsByGame[period.game_id]) periodsByGame[period.game_id] = [];
    periodsByGame[period.game_id].push(period);
  });
  return Object.fromEntries(volleyballGames.map((game) => [game.id, buildVolleyballState(game, periodsByGame[game.id] || [])]));
}

function initializeVolleyballMatch(db, game) {
  if (!game || game.sport !== 'volleyball') return null;
  const count = db.prepare('SELECT COUNT(*) AS count FROM game_period_scores WHERE game_id = ?').get(game.id).count;
  if (count === 0) {
    db.prepare(
      'INSERT INTO game_period_scores (game_id, period_number, team_a_score, team_b_score) VALUES (?, 1, 0, 0)'
    ).run(game.id);
  }
  db.prepare(
    'UPDATE games SET live_score_a = COALESCE(live_score_a, 0), live_score_b = COALESCE(live_score_b, 0) WHERE id = ?'
  ).run(game.id);
  return getVolleyballState(db, { ...game, live_score_a: game.live_score_a ?? 0, live_score_b: game.live_score_b ?? 0 });
}

function validateVolleyballPeriods(roundLabel, scoreA, scoreB, periods) {
  const rules = getVolleyballRules(roundLabel);
  if (!Array.isArray(periods) || periods.length !== scoreA + scoreB || periods.length > rules.max_sets) {
    return 'Volleyball set history does not match the final sets-won score.';
  }
  let winsA = 0;
  let winsB = 0;
  for (let index = 0; index < periods.length; index += 1) {
    const period = periods[index];
    const target = getSetTarget(index + 1, rules);
    const winner = getSetWinner(period.team_a_score, period.team_b_score, target);
    if (!winner) return `Set ${index + 1} must reach ${target} points with a two-point lead.`;
    if (winner === 'A') winsA += 1;
    else winsB += 1;
    if (index < periods.length - 1 && (winsA === rules.sets_to_win || winsB === rules.sets_to_win)) {
      return 'Volleyball set history continues after the match was already won.';
    }
  }
  if (winsA !== scoreA || winsB !== scoreB || Math.max(winsA, winsB) !== rules.sets_to_win) {
    return 'Volleyball set winners do not match the final result.';
  }
  return null;
}

module.exports = {
  getSetTarget,
  getSetWinner,
  getVolleyballRules,
  getVolleyballState,
  getVolleyballStates,
  initializeVolleyballMatch,
  isChampionshipRound,
  validateVolleyballPeriods,
};
