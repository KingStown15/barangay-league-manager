import test from 'node:test';
import assert from 'node:assert/strict';

import { getBasketballClockDisplay } from '../src/utils/basketballClock.js';
import {
  applyLiveGameOverlay,
  mergeLiveClockState,
  mergeLiveScoreState,
  retirePolledOverlays,
  selectLiveGameSnapshot,
} from '../src/utils/liveGameState.js';

function runningGame(startedAt) {
  return {
    sport: 'basketball',
    status: 'ongoing',
    current_period: 1,
    game_clock_remaining: 600,
    game_clock_running: 1,
    game_clock_started_at: startedAt,
    shot_clock_remaining: 24,
    shot_clock_running: 1,
    shot_clock_started_at: startedAt,
  };
}

test('future server timestamps never increase game or shot clocks', () => {
  const now = Date.parse('2026-07-14T01:00:00.000Z');
  const display = getBasketballClockDisplay(runningGame('2026-07-14T01:00:00.800Z'), now);
  assert.equal(display.gameClock, '10:00');
  assert.equal(display.shotClock, '24');
});

test('public live score and clock events merge without overwriting one another', () => {
  const withClock = mergeLiveClockState({}, {
    current_period: 2,
    game_clock_remaining: 480,
    game_clock_running: 1,
    game_clock_started_at: '2026-07-14T01:00:00.000Z',
    shot_clock_remaining: 24,
    shot_clock_running: 1,
    shot_clock_started_at: '2026-07-14T01:00:00.000Z',
    status: 'ongoing',
  });
  const withScore = mergeLiveScoreState(withClock, { score_a: 64, score_b: 54, status: 'ongoing' });
  assert.equal(withScore.game_clock_remaining, 480);
  assert.equal(withScore.shot_clock_remaining, 24);

  const nextClock = mergeLiveClockState(withScore, {
    current_period: 2,
    game_clock_remaining: 479,
    game_clock_running: 1,
    game_clock_started_at: '2026-07-14T01:00:01.000Z',
    shot_clock_remaining: 23,
    shot_clock_running: 1,
    shot_clock_started_at: '2026-07-14T01:00:01.000Z',
    status: 'ongoing',
  });
  assert.equal(nextClock.live_score_a, 64);
  assert.equal(nextClock.live_score_b, 54);
});

test('a second scorer pause replaces a running scorer snapshot without losing its score', () => {
  const openScorer = {
    id: 7,
    live_score_a: 31,
    live_score_b: 21,
    game_clock_remaining: 560,
    game_clock_running: 1,
    game_clock_started_at: '2026-07-14T01:00:00.000Z',
    shot_clock_remaining: 24,
    shot_clock_running: 0,
    status: 'ongoing',
  };
  const pausedEvent = mergeLiveClockState({}, {
    current_period: 2,
    game_clock_remaining: 511,
    game_clock_running: 0,
    game_clock_started_at: null,
    shot_clock_remaining: 24,
    shot_clock_running: 0,
    shot_clock_started_at: null,
    status: 'ongoing',
  });
  const synchronized = applyLiveGameOverlay(openScorer, pausedEvent);
  assert.equal(synchronized.game_clock_remaining, 511);
  assert.equal(synchronized.game_clock_running, 0);
  assert.equal(synchronized.game_clock_started_at, null);
  assert.equal(synchronized.live_score_a, 31);
  assert.equal(synchronized.live_score_b, 21);
});

test('an optimistic local clock snapshot yields to a newer authoritative game prop', () => {
  const original = { id: 7, game_clock_remaining: 560, game_clock_running: 0 };
  const optimisticStart = { ...original, game_clock_running: 1, game_clock_started_at: '2026-07-14T01:00:00.000Z' };
  assert.equal(selectLiveGameSnapshot(original, optimisticStart, original), optimisticStart);

  const externalPause = { ...original, game_clock_remaining: 511, game_clock_running: 0, game_clock_started_at: null };
  assert.equal(selectLiveGameSnapshot(externalPause, optimisticStart, original), externalPause);
});

test('authoritative polling retires covered stale overlays but preserves events received after request start', () => {
  const previous = {
    7: { game_clock_running: 1, game_clock_remaining: 500, updated_at: 1000 },
    8: { game_clock_running: 1, game_clock_remaining: 400, updated_at: 2000 },
    9: { game_clock_running: 1, game_clock_remaining: 300, updated_at: 500 },
  };
  const next = retirePolledOverlays(previous, [{ id: 7 }, { id: 8 }], 1500);
  assert.equal(next[7], undefined, 'the poll covers the older event for game 7');
  assert.equal(next[8], previous[8], 'an event received after the request began stays live');
  assert.equal(next[9], previous[9], 'unrelated games are untouched');
});
