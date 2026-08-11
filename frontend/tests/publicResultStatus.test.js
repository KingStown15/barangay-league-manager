import test from 'node:test';
import assert from 'node:assert/strict';

import { getPublicGameStatus } from '../src/utils/gamePublicStatus.js';

test('an unapproved completed result remains visibly pending in public detail views', () => {
  assert.deepEqual(
    getPublicGameStatus({ status: 'completed', approved_at: null }),
    { label: 'FULL TIME', helper: 'Awaiting admin approval', showLiveDot: false },
  );
});

test('approval changes a completed public result from pending to final', () => {
  assert.deepEqual(
    getPublicGameStatus({ status: 'completed', approved_at: '2026-07-15T01:00:00.000Z' }),
    { label: 'FINAL', helper: null, showLiveDot: false },
  );
});

test('a pending forfeit remains clearly approval-gated', () => {
  assert.deepEqual(
    getPublicGameStatus({ status: 'forfeited', approved_at: null }),
    { label: 'FORFEIT', helper: 'Awaiting admin approval', showLiveDot: false },
  );
});
