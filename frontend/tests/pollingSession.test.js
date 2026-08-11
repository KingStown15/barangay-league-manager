import test from 'node:test';
import assert from 'node:assert/strict';

import { createRequestSession } from '../src/utils/usePolling.js';

test('a cancelled polling session cannot apply a late response after dependency switching', async () => {
  let resolveOldRequest;
  const oldRequest = new Promise((resolve) => { resolveOldRequest = resolve; });
  const applied = [];
  const oldSession = createRequestSession();
  const oldCompletion = oldRequest.then((value) => {
    if (oldSession.isCurrent()) applied.push(value);
  });

  oldSession.cancel();
  const currentSession = createRequestSession();
  if (currentSession.isCurrent()) applied.push('current tournament');
  resolveOldRequest('stale tournament');
  await oldCompletion;

  assert.deepEqual(applied, ['current tournament']);
  assert.equal(oldSession.isCurrent(), false);
  assert.equal(currentSession.isCurrent(), true);
});
