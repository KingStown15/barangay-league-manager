import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldInvalidateSession } from '../src/api/client.js';

test('authenticated 401 responses invalidate the stored browser session', () => {
  assert.equal(shouldInvalidateSession(401, true), true);
  assert.equal(shouldInvalidateSession(403, true), false);
  assert.equal(shouldInvalidateSession(500, true), false);
});

test('public 401 responses do not invalidate an authenticated session', () => {
  assert.equal(shouldInvalidateSession(401, false), false);
});
