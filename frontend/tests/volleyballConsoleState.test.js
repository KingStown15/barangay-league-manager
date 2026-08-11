import assert from 'node:assert/strict';
import test from 'node:test';
import { canReopenVolleyballSet, getVolleyballSetMessage } from '../src/utils/volleyballConsoleState.js';

function state(scoreA, scoreB, target = 25, winner = null, overrides = {}) {
  return {
    sets_won_a: 0,
    sets_won_b: 0,
    completed_sets: [],
    current_set: { set_number: 1, team_a_score: scoreA, team_b_score: scoreB, target, winner },
    match_complete: false,
    ...overrides,
  };
}

test('regular-set win-by-two messages distinguish tied, one-ahead, and complete states', () => {
  assert.equal(getVolleyballSetMessage(state(24, 24)).title, 'WIN BY 2');
  assert.equal(getVolleyballSetMessage(state(25, 24)).title, 'WIN BY 2 — PLAY CONTINUES');
  assert.equal(getVolleyballSetMessage(state(26, 24, 25, 'A')).title, 'SET READY TO CONFIRM');
});

test('deciding-set win-by-two messages use the authoritative target', () => {
  assert.equal(getVolleyballSetMessage(state(14, 14, 15)).title, 'WIN BY 2');
  assert.equal(getVolleyballSetMessage(state(15, 14, 15)).title, 'WIN BY 2 — PLAY CONTINUES');
  assert.equal(getVolleyballSetMessage(state(16, 14, 15, 'A')).title, 'SET READY TO CONFIRM');
});

test('completed-set reopening follows the backend lifecycle precondition', () => {
  assert.equal(canReopenVolleyballSet(state(0, 0, 25, null, { completed_sets: [{ set_number: 1 }] })), true);
  assert.equal(canReopenVolleyballSet(state(1, 0, 25, null, { completed_sets: [{ set_number: 1 }] })), false);
  assert.equal(canReopenVolleyballSet({ completed_sets: [{ set_number: 3 }], current_set: null, match_complete: true }), true);
});
