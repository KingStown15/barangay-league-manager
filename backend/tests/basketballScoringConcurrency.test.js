const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');

const gameRoutes = require('../routes/games');
const publicRoutes = require('../routes/public');
const { JWT_SECRET } = require('../middleware/auth');

const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');

function createHarness() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(schema);
  db.prepare("INSERT INTO users (id, username, password_hash, role, status) VALUES (1, 'scorer-a', 'x', 'scorer', 'active')").run();
  db.prepare("INSERT INTO users (id, username, password_hash, role, status) VALUES (2, 'scorer-b', 'x', 'scorer', 'active')").run();
  db.prepare("INSERT INTO tournaments (id, name, sport, category, format, status) VALUES (1, 'R2A-D Basketball', 'basketball', 'Open', 'round_robin', 'active')").run();
  db.prepare("INSERT INTO teams (id, tournament_id, name) VALUES (1, 1, 'Blue'), (2, 1, 'Red')").run();
  const gameId = Number(db.prepare(
    "INSERT INTO games (tournament_id, team_a_id, team_b_id, scheduled_at, status) VALUES (1, 1, 2, datetime('now'), 'scheduled')"
  ).run().lastInsertRowid);

  const app = express();
  app.use(express.json());
  app.use('/api/games', gameRoutes(db));
  app.use('/api/public', publicRoutes(db));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const token = (id) => jwt.sign(
    { id, username: `scorer-${id}`, role: 'scorer', sessionVersion: 1 },
    JWT_SECRET,
    { expiresIn: '1h' },
  );

  async function request(method, route, body, scorerId = 1) {
    const response = await fetch(`${base}${route}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(scorerId ? { Authorization: `Bearer ${token(scorerId)}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }

  return {
    db,
    gameId,
    request,
    close: () => new Promise((resolve) => server.close(() => { db.close(); resolve(); })),
  };
}

test('basketball score snapshots require fresh expected values and preserve clock state', async (t) => {
  const h = createHarness();
  t.after(() => h.close());
  assert.equal((await h.request('PATCH', `/games/${h.gameId}/status`, { status: 'ongoing' })).status, 200);
  assert.equal((await h.request('PATCH', `/games/${h.gameId}/clock`, { action: 'start_game_clock' })).status, 200);
  assert.equal((await h.request('PATCH', `/games/${h.gameId}/clock`, { action: 'start_shot_clock' })).status, 200);

  const missingExpected = await h.request('PATCH', `/games/${h.gameId}/live-score`, {
    live_score_a: 1,
    live_score_b: 0,
  });
  assert.equal(missingExpected.status, 400);

  const clockBefore = h.db.prepare(
    `SELECT current_period, game_clock_remaining, game_clock_running, game_clock_started_at,
            shot_clock_remaining, shot_clock_running, shot_clock_started_at
     FROM games WHERE id = ?`
  ).get(h.gameId);
  let expectedA = 0;
  for (const scoreA of [1, 3, 6, 5, 6]) {
    const response = await h.request('PATCH', `/games/${h.gameId}/live-score`, {
      live_score_a: scoreA,
      live_score_b: 0,
      expected_live_score_a: expectedA,
      expected_live_score_b: 0,
    });
    assert.equal(response.status, 200, response.body.error);
    expectedA = scoreA;
  }
  const stored = h.db.prepare(
    `SELECT live_score_a, live_score_b, current_period, game_clock_remaining,
            game_clock_running, game_clock_started_at, shot_clock_remaining,
            shot_clock_running, shot_clock_started_at
     FROM games WHERE id = ?`
  ).get(h.gameId);
  assert.deepEqual(
    {
      current_period: stored.current_period,
      game_clock_remaining: stored.game_clock_remaining,
      game_clock_running: stored.game_clock_running,
      game_clock_started_at: stored.game_clock_started_at,
      shot_clock_remaining: stored.shot_clock_remaining,
      shot_clock_running: stored.shot_clock_running,
      shot_clock_started_at: stored.shot_clock_started_at,
    },
    clockBefore,
  );
  assert.deepEqual([stored.live_score_a, stored.live_score_b], [6, 0]);

  const publicSchedule = await h.request('GET', '/public/tournaments/1/schedule', undefined, null);
  assert.equal(publicSchedule.status, 200);
  assert.deepEqual(
    [publicSchedule.body.games[0].live_score_a, publicSchedule.body.games[0].live_score_b],
    [6, 0],
  );
});

test('a stale second basketball scorer cannot overwrite a newer score', async (t) => {
  const h = createHarness();
  t.after(() => h.close());
  assert.equal((await h.request('PATCH', `/games/${h.gameId}/status`, { status: 'ongoing' })).status, 200);

  const newer = await h.request('PATCH', `/games/${h.gameId}/live-score`, {
    live_score_a: 3,
    live_score_b: 0,
    expected_live_score_a: 0,
    expected_live_score_b: 0,
  }, 1);
  assert.equal(newer.status, 200, newer.body.error);

  const stale = await h.request('PATCH', `/games/${h.gameId}/live-score`, {
    live_score_a: 0,
    live_score_b: 1,
    expected_live_score_a: 0,
    expected_live_score_b: 0,
  }, 2);
  assert.equal(stale.status, 409);
  assert.deepEqual(
    h.db.prepare('SELECT live_score_a, live_score_b FROM games WHERE id = ?').get(h.gameId),
    { live_score_a: 3, live_score_b: 0 },
  );
});
