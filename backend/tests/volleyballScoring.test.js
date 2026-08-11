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
const { getSetWinner, getVolleyballRules, validateVolleyballPeriods } = require('../services/volleyballMatchService');

const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');

function tokenFor(role = 'scorer') {
  return jwt.sign({ id: 1, username: role, role, sessionVersion: 1 }, JWT_SECRET, { expiresIn: '1h' });
}

function createHarness(roundLabel = 'Round 1') {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(schema);
  db.prepare("INSERT INTO users (id, username, password_hash, role, status) VALUES (1, 'scorer', 'x', 'scorer', 'active')").run();
  db.prepare("INSERT INTO tournaments (id, name, sport, format, status) VALUES (1, 'Volleyball QA', 'volleyball', 'single_elimination', 'active')").run();
  db.prepare("INSERT INTO teams (id, tournament_id, name) VALUES (1, 1, 'Team A'), (2, 1, 'Team B')").run();
  const gameId = Number(db.prepare(
    "INSERT INTO games (tournament_id, round_label, team_a_id, team_b_id, scheduled_at, status) VALUES (1, ?, 1, 2, '2026-07-14T09:00:00.000Z', 'scheduled')"
  ).run(roundLabel).lastInsertRowid);
  const app = express();
  app.use(express.json());
  app.use('/api/games', gameRoutes(db));
  app.use('/api/public', publicRoutes(db));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  async function request(method, route, body, auth = true) {
    const response = await fetch(`${base}${route}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${tokenFor()}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }
  return { db, gameId, request, close: () => new Promise((resolve) => server.close(() => { db.close(); resolve(); })) };
}

function expected(state) {
  return {
    sets_won_a: state.sets_won_a,
    sets_won_b: state.sets_won_b,
    current_set_number: state.current_set?.set_number ?? state.completed_sets.length,
    current_score_a: state.current_set?.team_a_score ?? 0,
    current_score_b: state.current_set?.team_b_score ?? 0,
  };
}

test('rules select best-of-three except for championship labels', () => {
  assert.equal(getVolleyballRules('Round 1').sets_to_win, 2);
  assert.equal(getVolleyballRules('Semifinals').sets_to_win, 2);
  assert.equal(getVolleyballRules('Final').sets_to_win, 3);
  assert.equal(getVolleyballRules('FINALS').max_sets, 5);
  assert.equal(getVolleyballRules('Championship').sets_to_win, 3);
});

test('sets require target and a two-point lead, including deciding set', () => {
  assert.equal(getSetWinner(25, 23, 25), 'A');
  assert.equal(getSetWinner(25, 24, 25), null);
  assert.equal(getSetWinner(27, 25, 25), 'A');
  assert.equal(getSetWinner(14, 15, 15), null);
  assert.equal(getSetWinner(16, 14, 15), 'A');
  assert.equal(validateVolleyballPeriods('Round 1', 2, 1, [
    { team_a_score: 25, team_b_score: 20 },
    { team_a_score: 23, team_b_score: 25 },
    { team_a_score: 16, team_b_score: 14 },
  ]), null);
});

test('live volleyball scoring locks a won set, advances sets, survives public reads, and completes best-of-three', async (t) => {
  const h = createHarness();
  t.after(() => h.close());
  const started = await h.request('PATCH', `/games/${h.gameId}/status`, { status: 'ongoing' });
  assert.equal(started.status, 200, started.body.error);
  let state = started.body.game.volleyball;
  assert.equal(state.current_set.set_number, 1);

  h.db.prepare('UPDATE game_period_scores SET team_a_score = 24, team_b_score = 24 WHERE game_id = ? AND period_number = 1').run(h.gameId);
  state = (await h.request('GET', `/games/${h.gameId}`)).body.game.volleyball;
  let response = await h.request('PATCH', `/games/${h.gameId}/volleyball-score`, { action: 'add_point', side: 'A', expected: expected(state) });
  assert.equal(response.status, 200);
  assert.equal(response.body.game.volleyball.current_set.winner, null, '25-24 must continue');
  state = response.body.game.volleyball;
  response = await h.request('PATCH', `/games/${h.gameId}/volleyball-score`, { action: 'add_point', side: 'A', expected: expected(state) });
  assert.equal(response.body.game.volleyball.current_set.winner, 'A');
  state = response.body.game.volleyball;
  response = await h.request('PATCH', `/games/${h.gameId}/volleyball-score`, { action: 'add_point', side: 'A', expected: expected(state) });
  assert.equal(response.status, 409, 'points must lock after a set is won');

  response = await h.request('PATCH', `/games/${h.gameId}/volleyball-score`, { action: 'confirm_set', expected: expected(state) });
  assert.equal(response.status, 200);
  state = response.body.game.volleyball;
  assert.deepEqual([state.sets_won_a, state.sets_won_b, state.current_set.set_number], [1, 0, 2]);

  h.db.prepare('UPDATE game_period_scores SET team_a_score = 25, team_b_score = 10 WHERE game_id = ? AND period_number = 2').run(h.gameId);
  state = (await h.request('GET', `/games/${h.gameId}`)).body.game.volleyball;
  response = await h.request('PATCH', `/games/${h.gameId}/volleyball-score`, { action: 'confirm_set', expected: expected(state) });
  assert.equal(response.status, 200);
  state = response.body.game.volleyball;
  assert.equal(state.match_complete, true);
  assert.equal(state.current_set, null);
  assert.deepEqual([state.sets_won_a, state.sets_won_b], [2, 0]);

  const publicSchedule = await h.request('GET', '/public/tournaments/1/schedule', undefined, false);
  assert.equal(publicSchedule.status, 200);
  assert.equal(publicSchedule.body.games[0].volleyball.match_complete, true);
  assert.equal(publicSchedule.body.games[0].volleyball.completed_sets.length, 2);

  response = await h.request('PATCH', `/games/${h.gameId}/volleyball-score`, { action: 'undo_last_set', expected: expected(state) });
  assert.equal(response.status, 200);
  assert.equal(response.body.game.volleyball.match_complete, false);
  assert.equal(response.body.game.volleyball.current_set.set_number, 2);
  assert.deepEqual([response.body.game.volleyball.sets_won_a, response.body.game.volleyball.sets_won_b], [1, 0]);
});

test('stale volleyball actions are rejected without changing state', async (t) => {
  const h = createHarness('Final');
  t.after(() => h.close());
  const started = await h.request('PATCH', `/games/${h.gameId}/status`, { status: 'ongoing' });
  const stale = expected(started.body.game.volleyball);
  let response = await h.request('PATCH', `/games/${h.gameId}/volleyball-score`, { action: 'add_point', side: 'A', expected: stale });
  assert.equal(response.status, 200);
  response = await h.request('PATCH', `/games/${h.gameId}/volleyball-score`, { action: 'add_point', side: 'B', expected: stale });
  assert.equal(response.status, 409);
  const row = h.db.prepare('SELECT team_a_score, team_b_score FROM game_period_scores WHERE game_id = ?').get(h.gameId);
  assert.deepEqual(row, { team_a_score: 1, team_b_score: 0 });
});
