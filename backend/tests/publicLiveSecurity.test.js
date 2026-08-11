const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const Database = require('better-sqlite3');

const liveRoutes = require('../routes/live');
const sse = require('../live/sseHub');

const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');

function createHarness() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(schema);
  db.prepare("INSERT INTO tournaments (id, name, sport, format, status) VALUES (1, 'Active QA', 'basketball', 'round_robin', 'active')").run();
  db.prepare("INSERT INTO tournaments (id, name, sport, format, status) VALUES (2, 'Draft QA', 'basketball', 'round_robin', 'draft')").run();
  db.prepare("INSERT INTO tournaments (id, name, sport, format, status) VALUES (3, 'Completed QA', 'basketball', 'round_robin', 'completed')").run();
  db.prepare("INSERT INTO tournaments (id, name, sport, format, status) VALUES (4, 'Archived QA', 'basketball', 'round_robin', 'archived')").run();

  const app = express();
  app.use('/api/live', liveRoutes(db));
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/live`;

  return {
    db,
    baseUrl,
    close: () => new Promise((resolve) => server.close(() => { db.close(); resolve(); })),
  };
}

async function openFirstEvent(baseUrl, tournamentId) {
  const controller = new AbortController();
  const response = await fetch(`${baseUrl}/events?tournament_id=${encodeURIComponent(tournamentId)}`, {
    signal: controller.signal,
  });
  if (response.status !== 200) {
    const body = await response.json();
    return { status: response.status, body };
  }
  const reader = response.body.getReader();
  const first = await reader.read();
  controller.abort();
  try { await reader.cancel(); } catch {}
  return { status: response.status, text: Buffer.from(first.value).toString('utf8') };
}

test('public SSE accepts only visible tournaments with positive integer IDs', async (t) => {
  const h = createHarness();
  t.after(() => h.close());

  for (const invalid of ['', 'not-a-number', '0', '-1', '1.5']) {
    const response = await openFirstEvent(h.baseUrl, invalid);
    assert.equal(response.status, 400, `expected ${JSON.stringify(invalid)} to be rejected`);
  }
  assert.equal((await openFirstEvent(h.baseUrl, 999)).status, 404);
  assert.equal((await openFirstEvent(h.baseUrl, 2)).status, 404);
  assert.equal((await openFirstEvent(h.baseUrl, 4)).status, 404);

  const active = await openFirstEvent(h.baseUrl, 1);
  assert.equal(active.status, 200);
  assert.match(active.text, /"type":"connected"/);
  assert.match(active.text, /"tournament_id":1/);

  const completed = await openFirstEvent(h.baseUrl, 3);
  assert.equal(completed.status, 200);
  assert.match(completed.text, /"tournament_id":3/);

  for (let attempt = 0; attempt < 20 && (sse.clientCount(1) || sse.clientCount(3)); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(sse.clientCount(1), 0);
  assert.equal(sse.clientCount(3), 0);
});
