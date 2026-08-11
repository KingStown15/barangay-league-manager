import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canScorePickleball,
  canStartNextPickleballGame,
  getPickleballFormatLabel,
  getPickleballRuleSummary,
  getPickleballStateMessage,
} from '../src/utils/pickleballConsoleState.js';

test('Pickleball format labels preserve Singles and Doubles configuration', () => {
  assert.equal(getPickleballFormatLabel({}, { competition_format: 'singles', division: 'open', scoring_mode: 'side_out' }), 'Singles · Open · Side Out');
  assert.equal(getPickleballFormatLabel({}, { competition_format: 'doubles', division: 'mixed', scoring_mode: 'rally' }), 'Doubles · Mixed · Rally');
});

test('Pickleball lifecycle messages distinguish scoring, between-game, and final states', () => {
  const rules = {
    games_to_win: 2,
    points_to_win_standard_game: 11,
    points_to_win_deciding_game: 15,
    win_by: 2,
    score_cap: null,
  };
  assert.equal(
    getPickleballStateMessage({ current_game_number: 1, side_a_games_won: 0, side_b_games_won: 0, match_state: 'in_progress', rules }).detail,
    'Best of 3 · First to 11 · Win by 2',
  );
  assert.equal(getPickleballStateMessage({ current_game_number: 1, match_state: 'between_games', rules }).title, 'GAME 1 COMPLETE');
  assert.equal(getPickleballStateMessage({ current_game_number: 2, match_state: 'ready_to_submit', rules }).title, 'MATCH COMPLETE');
});

test('Pickleball rule summary exposes deciding targets and configured house-rule caps', () => {
  const rules = {
    games_to_win: 2,
    points_to_win_standard_game: 11,
    points_to_win_deciding_game: 15,
    win_by: 2,
    score_cap: 21,
  };
  assert.equal(
    getPickleballRuleSummary({ side_a_games_won: 1, side_b_games_won: 1 }, rules),
    'Best of 3 · First to 15 · Win by 2 · Cap 21',
  );
});

test('Pickleball scoring and next-game gates are mutually exclusive', () => {
  assert.equal(canScorePickleball({ match_state: 'in_progress' }), true);
  assert.equal(canStartNextPickleballGame({ match_state: 'in_progress' }), false);
  assert.equal(canScorePickleball({ match_state: 'between_games' }), false);
  assert.equal(canStartNextPickleballGame({ match_state: 'between_games' }), true);
});
