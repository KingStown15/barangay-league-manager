import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { buildScorerActionRequest, scorerActionLabel, SCORER_ACTIONS } from '../src/utils/scorerActions.js';

function game(overrides = {}) {
  return { id: 145, sport: 'basketball', status: 'ongoing', live_score_a: 10, live_score_b: 8, ...overrides };
}

test('Basketball score actions preserve the other score and carry strict expected values', () => {
  const result = buildScorerActionRequest(SCORER_ACTIONS.SIDE_A_ADD_3, { game: game() });
  assert.equal(result.ok, true);
  assert.deepEqual(result.request.body, {
    live_score_a: 13,
    live_score_b: 8,
    expected_live_score_a: 10,
    expected_live_score_b: 8,
  });
  assert.equal(result.meta.previousScore, 10);
  assert.equal(result.meta.nextScore, 13);
});

test('Basketball Undo requires a known per-side previous score', () => {
  const blocked = buildScorerActionRequest(SCORER_ACTIONS.SIDE_B_UNDO, { game: game() });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.status, 'blocked');

  const accepted = buildScorerActionRequest(SCORER_ACTIONS.SIDE_B_UNDO, { game: game(), previousScoreB: 5 });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.request.body.live_score_b, 5);
  assert.equal(accepted.request.body.expected_live_score_b, 8);
});

test('Basketball clock controls map to explicit backend start and pause actions', () => {
  const start = buildScorerActionRequest(SCORER_ACTIONS.GAME_CLOCK_START, { game: game() });
  const pause = buildScorerActionRequest(SCORER_ACTIONS.GAME_CLOCK_PAUSE, { game: game() });
  assert.equal(start.request.body.action, 'start_game_clock');
  assert.equal(pause.request.body.action, 'pause_game_clock');
});

test('Basketball Reset 24 and period actions map to the existing clock contract', () => {
  const resetShot = buildScorerActionRequest(SCORER_ACTIONS.SHOT_CLOCK_RESET_24, { game: game() });
  const nextPeriod = buildScorerActionRequest(SCORER_ACTIONS.NEXT_PERIOD, { game: game() });
  assert.deepEqual(resetShot.request.body, { action: 'reset_shot_clock' });
  assert.deepEqual(nextPeriod.request.body, { action: 'next_period' });
});

test('Basketball official time accepts only whole seconds in the backend range', () => {
  const accepted = buildScorerActionRequest(SCORER_ACTIONS.GAME_CLOCK_SET, { game: game(), seconds: 125 });
  assert.deepEqual(accepted.request.body, { action: 'set_game_clock', seconds: 125 });

  for (const seconds of [-1, 3601, 12.5, Number.NaN]) {
    const blocked = buildScorerActionRequest(SCORER_ACTIONS.GAME_CLOCK_SET, { game: game(), seconds });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.status, 'blocked');
  }
});

test('Volleyball actions include the complete expected state snapshot', () => {
  const volleyball = {
    sets_won_a: 1,
    sets_won_b: 0,
    completed_sets: [{ set_number: 1 }],
    current_set: { set_number: 2, team_a_score: 24, team_b_score: 24 },
  };
  const result = buildScorerActionRequest(SCORER_ACTIONS.SIDE_B_ADD_1, {
    game: game({ sport: 'volleyball', volleyball }),
  });
  assert.equal(result.request.body.action, 'add_point');
  assert.equal(result.request.body.side, 'B');
  assert.deepEqual(result.request.body.expected, {
    sets_won_a: 1,
    sets_won_b: 0,
    current_set_number: 2,
    current_score_a: 24,
    current_score_b: 24,
  });
});

test('per-side Volleyball Undo safely translates the remembered one-point delta', () => {
  const volleyball = { sets_won_a: 0, sets_won_b: 0, completed_sets: [], current_set: { set_number: 1, team_a_score: 25, team_b_score: 24 } };
  const undoAdd = buildScorerActionRequest(SCORER_ACTIONS.SIDE_A_UNDO, {
    game: game({ sport: 'volleyball', volleyball }),
    previousVolleyballScoreA: 24,
  });
  assert.equal(undoAdd.ok, true);
  assert.equal(undoAdd.request.body.action, 'subtract_point');
  assert.equal(undoAdd.request.body.side, 'A');

  const undoSubtract = buildScorerActionRequest(SCORER_ACTIONS.SIDE_A_UNDO, {
    game: game({ sport: 'volleyball', volleyball }),
    previousVolleyballScoreA: 26,
  });
  assert.equal(undoSubtract.ok, true);
  assert.equal(undoSubtract.request.body.action, 'add_point');

  const blocked = buildScorerActionRequest(SCORER_ACTIONS.SIDE_A_UNDO, {
    game: game({ sport: 'volleyball', volleyball }),
    previousVolleyballScoreA: 20,
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.status, 'blocked');
});

test('Pickleball requests use action IDs, expected versions, and explicit server numbers', () => {
  const result = buildScorerActionRequest(SCORER_ACTIONS.PICKLEBALL_SET_SERVER_2, {
    game: game({ sport: 'pickleball' }),
    pickleballState: { version: 7 },
    actionId: 'phone-action-1',
  });
  assert.deepEqual(result.request.body, {
    action_id: 'phone-action-1',
    expected_version: 7,
    action: 'set_server',
    payload: { server_number: 2 },
  });
});

test('Pickleball point, global Undo, service, and next-game actions preserve the version gate', () => {
  const context = {
    game: game({ sport: 'pickleball' }),
    pickleballState: { version: 12 },
    actionId: 'phone-pickleball-action',
  };
  const actions = [
    [SCORER_ACTIONS.SIDE_A_ADD_1, 'award_point', { side: 'A' }],
    [SCORER_ACTIONS.SIDE_B_SUBTRACT_1, 'remove_point', { side: 'B' }],
    [SCORER_ACTIONS.PICKLEBALL_UNDO_LAST_ACTION, 'undo', {}],
    [SCORER_ACTIONS.PICKLEBALL_CHANGE_SERVICE, 'change_service', {}],
    [SCORER_ACTIONS.PICKLEBALL_START_NEXT_GAME, 'start_next_game', {}],
  ];
  for (const [action, backendAction, payload] of actions) {
    const result = buildScorerActionRequest(action, context);
    assert.equal(result.ok, true);
    assert.equal(result.request.body.expected_version, 12);
    assert.equal(result.request.body.action, backendAction);
    assert.deepEqual(result.request.body.payload, payload);
  }
});

test('Pickleball feedback describes a rally without promising a side-out point', () => {
  const specification = buildScorerActionRequest(SCORER_ACTIONS.SIDE_B_ADD_1, {
    game: game({ sport: 'pickleball' }),
    pickleballState: { version: 4 },
    actionId: 'feedback-action',
  });
  assert.equal(scorerActionLabel(specification.action, specification.meta), 'Side B Rally');
});

test('non-ongoing games fail closed before action mapping', () => {
  const result = buildScorerActionRequest(SCORER_ACTIONS.SIDE_A_ADD_1, { game: game({ status: 'completed' }) });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'blocked');
});

test('Full Scorer live mutations use the shared scorer action adapter', () => {
  const sources = [
    '../src/pages/Scorer.jsx',
    '../src/components/BasketballClock.jsx',
    '../src/components/VolleyballScorer.jsx',
    '../src/components/PickleballScorer.jsx',
  ].map((relativePath) => fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8'));
  for (const source of sources) assert.match(source, /executeScorerActionRequest/);
  const combined = sources.join('\n');
  for (const route of ['/live-score', '/clock', '/volleyball-score', '/pickleball-actions']) {
    assert.equal(combined.includes(route), false, `Full Scorer must not construct ${route} requests directly.`);
  }
});

test('hidden-tab return requires authoritative restore and an explicit Resume control', () => {
  const dispatcher = fs.readFileSync(new URL('../src/hooks/useScorerActionDispatcher.js', import.meta.url), 'utf8');
  const shell = fs.readFileSync(new URL('../src/components/scorer-console/ScorerConsoleShell.jsx', import.meta.url), 'utf8');
  assert.match(dispatcher, /hiddenSinceRef\.current = true/);
  assert.match(dispatcher, /Console visible again\. Reloading official state/);
  assert.match(dispatcher, /restoreBeforeResume/);
  assert.match(shell, /Resume Scorer Controls/);
});
