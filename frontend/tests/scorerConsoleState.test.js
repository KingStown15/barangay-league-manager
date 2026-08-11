import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canEnableConsoleControls,
  getConsoleConnectionStatus,
  getConsoleMatchStatus,
  mergeConsoleSnapshot,
  parseConsoleGameId,
} from '../src/utils/scorerConsoleState.js';

test('console accepts only positive integer game route IDs', () => {
  assert.equal(parseConsoleGameId('145'), 145);
  assert.equal(parseConsoleGameId('001'), 1);
  for (const value of ['', '0', '-1', '1.5', 'abc', '1/2']) assert.equal(parseConsoleGameId(value), null);
});

test('match and connection statuses remain separate and lifecycle-aware', () => {
  assert.deepEqual(getConsoleMatchStatus({ status: 'ongoing' }).label, 'ONGOING');
  assert.deepEqual(getConsoleMatchStatus({ status: 'completed', approved_at: null }).label, 'PENDING APPROVAL');
  assert.deepEqual(getConsoleMatchStatus({ status: 'completed', approved_at: '2026-07-18' }).label, 'COMPLETED');
  assert.equal(getConsoleConnectionStatus('reconnecting').label, 'RECONNECTING');
});

test('console controls require ongoing authoritative state and a visible connected page', () => {
  const game = { id: 145, status: 'ongoing' };
  assert.equal(canEnableConsoleControls({ game, connectionState: 'connected', restoring: false, documentHidden: false }), true);
  assert.equal(canEnableConsoleControls({ game, connectionState: 'reconnecting', restoring: false, documentHidden: false }), false);
  assert.equal(canEnableConsoleControls({ game, connectionState: 'connected', restoring: false, documentHidden: false, hasError: true }), false);
  assert.equal(canEnableConsoleControls({ game: { ...game, status: 'completed' }, connectionState: 'connected' }), false);
});

test('polling cannot overwrite an SSE event received after the request began', () => {
  const authoritative = { id: 145, live_score_a: 4, live_score_b: 3, game_clock_remaining: 500 };
  const newerOverlay = { live_score_a: 6, live_score_b: 3, updated_at: 200 };
  const olderOverlay = { live_score_a: 2, live_score_b: 3, updated_at: 50 };
  assert.equal(mergeConsoleSnapshot(authoritative, newerOverlay, 100).live_score_a, 6);
  assert.equal(mergeConsoleSnapshot(authoritative, olderOverlay, 100).live_score_a, 4);
});
