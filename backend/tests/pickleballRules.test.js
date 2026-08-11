const test = require('node:test');
const assert = require('node:assert/strict');

const {
  applyPickleballAction,
  gameTarget,
  isGameComplete,
} = require('../services/pickleballRules');

function rules(overrides = {}) {
  return {
    competition_format: 'singles',
    scoring_mode: 'side_out',
    games_to_win: 2,
    points_to_win_standard_game: 11,
    points_to_win_deciding_game: 7,
    win_by: 2,
    score_cap: null,
    allow_tied_final: false,
    track_service: true,
    track_server_number: false,
    ...overrides,
  };
}

function state(overrides = {}) {
  return {
    current_game_number: 1,
    side_a_points: 0,
    side_b_points: 0,
    side_a_games_won: 0,
    side_b_games_won: 0,
    serving_side: 'A',
    server_number: null,
    match_state: 'in_progress',
    ...overrides,
  };
}

test('Singles side-out awards only the serving side and transfers service on a lost rally', () => {
  const config = rules();
  const lostServe = applyPickleballAction(state(), config, 'award_point', { side: 'B' });
  assert.equal(lostServe.state.side_b_points, 0);
  assert.equal(lostServe.state.serving_side, 'B');

  const scored = applyPickleballAction(lostServe.state, config, 'award_point', { side: 'B' });
  assert.equal(scored.state.side_b_points, 1);
  assert.equal(scored.state.serving_side, 'B');
});

test('Doubles side-out progresses server 1 to server 2 before changing sides', () => {
  const config = rules({ competition_format: 'doubles', track_server_number: true });
  const firstLoss = applyPickleballAction(state({ server_number: 1 }), config, 'award_point', { side: 'B' });
  assert.deepEqual(
    { serving: firstLoss.state.serving_side, server: firstLoss.state.server_number, score: firstLoss.state.side_b_points },
    { serving: 'A', server: 2, score: 0 },
  );
  const secondLoss = applyPickleballAction(firstLoss.state, config, 'award_point', { side: 'B' });
  assert.deepEqual(
    { serving: secondLoss.state.serving_side, server: secondLoss.state.server_number, score: secondLoss.state.side_b_points },
    { serving: 'B', server: 1, score: 0 },
  );
});

test('Rally scoring awards the rally winner and transfers service', () => {
  const result = applyPickleballAction(state(), rules({ scoring_mode: 'rally' }), 'award_point', { side: 'B' });
  assert.equal(result.state.side_b_points, 1);
  assert.equal(result.state.serving_side, 'B');
});

test('game completion honors win-by, caps, and the deciding-game target', () => {
  assert.equal(isGameComplete(2, 0, 11, 2, null), false);
  assert.equal(isGameComplete(11, 9, 11, 2, null), true);
  assert.equal(isGameComplete(11, 10, 11, 2, null), false);
  assert.equal(isGameComplete(12, 10, 11, 2, null), true);
  assert.equal(isGameComplete(15, 14, 11, 2, 15), true);
  assert.equal(gameTarget(state({ current_game_number: 3, side_a_games_won: 1, side_b_games_won: 1 }), rules()), 7);
  assert.equal(gameTarget(state({ current_game_number: 2 }), rules()), 11);
  assert.equal(gameTarget(state(), rules({ games_to_win: 1 })), 11);
});

test('best-of match completion persists the winning game result in server state', () => {
  const config = rules({ points_to_win_standard_game: 1, points_to_win_deciding_game: 1, win_by: 1 });
  const gameOne = applyPickleballAction(state(), config, 'award_point', { side: 'A' });
  assert.equal(gameOne.state.match_state, 'between_games');
  assert.equal(gameOne.state.side_a_games_won, 1);
  assert.deepEqual(gameOne.completedGame, {
    sequence_number: 1,
    side_a_points: 1,
    side_b_points: 0,
    winner_side: 'A',
  });

  const gameTwoStart = applyPickleballAction(gameOne.state, config, 'start_next_game');
  const serviceBackToA = applyPickleballAction(gameTwoStart.state, config, 'award_point', { side: 'A' });
  const match = applyPickleballAction(serviceBackToA.state, config, 'award_point', { side: 'A' });
  assert.equal(match.state.match_state, 'ready_to_submit');
  assert.equal(match.state.side_a_games_won, 2);
});

test('corrections require admin authorization and a reason', () => {
  const payload = { side_a_points: 10, side_b_points: 8, reason: 'Score sheet correction' };
  assert.throws(
    () => applyPickleballAction(state(), rules(), 'correct_score', payload, 'scorer'),
    /Only an admin/,
  );
  assert.throws(
    () => applyPickleballAction(state(), rules(), 'correct_score', { ...payload, reason: '' }, 'admin'),
    /reason is required/,
  );
  const corrected = applyPickleballAction(state(), rules(), 'correct_score', payload, 'admin');
  assert.equal(corrected.state.side_a_points, 10);
  assert.equal(corrected.state.side_b_points, 8);
});
