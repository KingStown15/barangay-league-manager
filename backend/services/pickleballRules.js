function rulesError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function otherSide(side) {
  return side === 'A' ? 'B' : 'A';
}

function validateSide(side) {
  if (!['A', 'B'].includes(side)) throw rulesError('Side must be A or B.');
  return side;
}

function gameTarget(state, rules) {
  const isDecidingGame = rules.games_to_win > 1 &&
    state.side_a_games_won === rules.games_to_win - 1 &&
    state.side_b_games_won === rules.games_to_win - 1;
  return isDecidingGame
    ? rules.points_to_win_deciding_game
    : rules.points_to_win_standard_game;
}

function isGameComplete(pointsA, pointsB, target, winBy, cap) {
  if (pointsA === pointsB) return false;
  const leader = Math.max(pointsA, pointsB);
  const margin = Math.abs(pointsA - pointsB);
  if (cap !== null && cap !== undefined && leader >= cap) return true;
  return leader >= target && margin >= winBy;
}

function advanceService(state, rules) {
  if (rules.competition_format === 'doubles' && rules.track_server_number) {
    if (state.server_number === 1) return { serving_side: state.serving_side, server_number: 2 };
    return { serving_side: otherSide(state.serving_side), server_number: 1 };
  }
  return { serving_side: otherSide(state.serving_side), server_number: null };
}

function completeGameIfNeeded(state, rules) {
  const target = gameTarget(state, rules);
  if (!isGameComplete(state.side_a_points, state.side_b_points, target, rules.win_by, rules.score_cap)) {
    return { state, completedGame: null };
  }
  const winnerSide = state.side_a_points > state.side_b_points ? 'A' : 'B';
  const completedGame = {
    sequence_number: state.current_game_number,
    side_a_points: state.side_a_points,
    side_b_points: state.side_b_points,
    winner_side: winnerSide,
  };
  const next = {
    ...state,
    side_a_points: 0,
    side_b_points: 0,
    side_a_games_won: state.side_a_games_won + (winnerSide === 'A' ? 1 : 0),
    side_b_games_won: state.side_b_games_won + (winnerSide === 'B' ? 1 : 0),
  };
  const matchComplete = Math.max(next.side_a_games_won, next.side_b_games_won) >= rules.games_to_win;
  next.match_state = matchComplete ? 'ready_to_submit' : 'between_games';
  return { state: next, completedGame };
}

function applyPickleballAction(current, rules, action, payload = {}, actorRole = 'scorer') {
  const state = { ...current };
  if (!rules || rules.allow_tied_final !== false) throw rulesError('Pickleball rules snapshot is invalid.');

  if (action === 'start_next_game') {
    if (state.match_state !== 'between_games') throw rulesError('The next game can only start between completed games.');
    return {
      state: {
        ...state,
        current_game_number: state.current_game_number + 1,
        serving_side: otherSide(state.serving_side),
        // Doubles starts each game with the standard one-server exception,
        // represented by the conventional "second server" call.
        server_number: rules.competition_format === 'doubles' && rules.track_server_number ? 2 : null,
        match_state: 'in_progress',
      },
      completedGame: null,
    };
  }

  if (state.match_state !== 'in_progress') throw rulesError('Normal scoring is not allowed in the current match state.');

  if (action === 'award_point') {
    const side = validateSide(payload.side);
    let next = { ...state };
    if (rules.scoring_mode === 'side_out') {
      if (side === state.serving_side) {
        if (side === 'A') next.side_a_points += 1;
        else next.side_b_points += 1;
      } else {
        Object.assign(next, advanceService(state, rules));
      }
    } else if (rules.scoring_mode === 'rally') {
      if (side === 'A') next.side_a_points += 1;
      else next.side_b_points += 1;
      next.serving_side = side;
      next.server_number = rules.competition_format === 'doubles' && rules.track_server_number ? 1 : null;
    } else {
      throw rulesError('Unsupported Pickleball scoring mode.');
    }
    return completeGameIfNeeded(next, rules);
  }

  if (action === 'remove_point') {
    const side = validateSide(payload.side);
    if (side === 'A') state.side_a_points = Math.max(0, state.side_a_points - 1);
    else state.side_b_points = Math.max(0, state.side_b_points - 1);
    return { state, completedGame: null };
  }

  if (action === 'change_service') {
    return { state: { ...state, ...advanceService(state, rules) }, completedGame: null };
  }

  if (action === 'set_server') {
    if (rules.competition_format !== 'doubles' || !rules.track_server_number) {
      throw rulesError('Server number is not enabled for this match.');
    }
    if (![1, 2].includes(payload.server_number)) throw rulesError('Server number must be 1 or 2.');
    return { state: { ...state, server_number: payload.server_number }, completedGame: null };
  }

  if (action === 'correct_score') {
    if (actorRole !== 'admin') throw rulesError('Only an admin can directly correct a Pickleball score.');
    if (!String(payload.reason || '').trim()) throw rulesError('A correction reason is required.');
    for (const value of [payload.side_a_points, payload.side_b_points]) {
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 999) {
        throw rulesError('Corrected scores must be non-negative whole numbers.');
      }
    }
    state.side_a_points = payload.side_a_points;
    state.side_b_points = payload.side_b_points;
    return completeGameIfNeeded(state, rules);
  }

  throw rulesError('Unsupported Pickleball scoring action.');
}

module.exports = {
  advanceService,
  applyPickleballAction,
  gameTarget,
  isGameComplete,
  otherSide,
};
