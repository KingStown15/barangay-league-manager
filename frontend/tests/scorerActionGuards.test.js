import assert from 'node:assert/strict';
import test from 'node:test';
import { getScorerActionGuard, isTextEntryElement } from '../src/utils/scorerActionGuards.js';

const ongoing = { id: 145, status: 'ongoing' };

test('scorer action guard accepts only an armed, visible, connected ongoing game', () => {
  assert.equal(getScorerActionGuard({ armed: true, game: ongoing }).allowed, true);
  assert.equal(getScorerActionGuard({ armed: false, game: ongoing }).allowed, false);
  assert.equal(getScorerActionGuard({ armed: true, game: ongoing, documentHidden: true }).allowed, false);
  assert.equal(getScorerActionGuard({ armed: true, game: ongoing, connectionState: 'reconnecting' }).allowed, false);
});

test('pending requests, modals, and active text fields block score input', () => {
  assert.equal(getScorerActionGuard({ armed: true, game: ongoing, pending: true }).status, 'pending');
  assert.equal(getScorerActionGuard({ armed: true, game: ongoing, modalOpen: true }).allowed, false);
  assert.equal(getScorerActionGuard({ armed: true, game: ongoing, inputActive: true }).allowed, false);
});

test('scheduled, pending, and completed games remain read-only', () => {
  for (const status of ['scheduled', 'pending_approval', 'completed']) {
    const result = getScorerActionGuard({ armed: true, game: { id: 145, status } });
    assert.equal(result.allowed, false);
    assert.equal(result.status, 'blocked');
  }
});

test('text-entry detection covers fields and contenteditable targets', () => {
  assert.equal(isTextEntryElement({ tagName: 'TEXTAREA' }), true);
  assert.equal(isTextEntryElement({ tagName: 'INPUT' }), true);
  assert.equal(isTextEntryElement({ tagName: 'BUTTON' }), false);
  assert.equal(isTextEntryElement({ tagName: 'DIV', isContentEditable: true }), true);
});
