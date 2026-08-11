const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');

const { migrateCompetitionEntryData } = require('../db/init');
const { JWT_SECRET } = require('../middleware/auth');
const tournamentRoutes = require('../routes/tournaments');
const teamRoutes = require('../routes/teams');
const gameRoutes = require('../routes/games');

const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');

function createHarness() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(schema);
  migrateCompetitionEntryData(db);
  db.prepare("INSERT INTO users (id, username, password_hash, role, status) VALUES (1, 'admin', 'x', 'admin', 'active')").run();
  db.prepare("INSERT INTO users (id, username, password_hash, role, status) VALUES (2, 'scorer', 'x', 'scorer', 'active')").run();
  const tokenFor = (id, role) => jwt.sign({ id, username: role, role, sessionVersion: 1 }, JWT_SECRET, { expiresIn: '1h' });
  const app = express();
  app.use(express.json());
  app.use('/api/tournaments', tournamentRoutes(db));
  app.use('/api/teams', teamRoutes(db));
  app.use('/api/games', gameRoutes(db));
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;

  async function request(method, route, body, role = 'admin') {
    const response = await fetch(`${baseUrl}${route}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${role === 'admin' ? tokenFor(1, 'admin') : tokenFor(2, 'scorer')}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null;
    try { json = await response.json(); } catch {}
    return { status: response.status, body: json };
  }

  return { db, request, close: () => new Promise((resolve) => server.close(() => { db.close(); resolve(); })) };
}

async function createTournament(h, overrides = {}) {
  const response = await h.request('POST', '/tournaments', {
    name: 'Schedule Safety QA', sport: 'basketball', category: 'Open', format: 'round_robin',
    ...overrides,
  });
  assert.equal(response.status, 201, response.body?.error);
  return response.body.tournament;
}

async function createTeam(h, tournamentId, name) {
  const response = await h.request('POST', '/teams', { tournament_id: tournamentId, name });
  assert.equal(response.status, 201, response.body?.error);
  return response.body.team;
}

function gamesFor(h, tournamentId) {
  return h.db.prepare(
    `SELECT id, group_id, round_label, team_a_id, team_b_id, scheduled_at, venue, status
     FROM games WHERE tournament_id = ? ORDER BY id`
  ).all(tournamentId);
}

function matchupKey(game) {
  return [game.team_a_id, game.team_b_id].sort((a, b) => a - b).join(':');
}

function assertNoRoundConflicts(games) {
  const competitorsByRound = new Map();
  games.forEach((game) => {
    if (!competitorsByRound.has(game.round_label)) competitorsByRound.set(game.round_label, new Set());
    const competitors = competitorsByRound.get(game.round_label);
    assert.equal(competitors.has(game.team_a_id), false, `${game.team_a_id} overlaps in ${game.round_label}`);
    assert.equal(competitors.has(game.team_b_id), false, `${game.team_b_id} overlaps in ${game.round_label}`);
    competitors.add(game.team_a_id);
    competitors.add(game.team_b_id);
  });
}

test('round-robin regeneration is incremental, stable, and preserves manual schedule edits', async (t) => {
  const h = createHarness();
  t.after(() => h.close());
  const tournament = await createTournament(h);
  const teams = [];
  for (const name of ['A', 'B', 'C', 'D']) teams.push(await createTeam(h, tournament.id, name));

  const first = await h.request('POST', `/tournaments/${tournament.id}/generate-schedule`);
  assert.deepEqual({ status: first.status, created: first.body.gamesCreated, removed: first.body.gamesRemoved }, { status: 200, created: 6, removed: 0 });
  const initial = gamesFor(h, tournament.id);
  const edited = initial[0];
  const edit = await h.request('PUT', `/games/${edited.id}`, { scheduled_at: '2026-08-02 19:30:00', venue: 'Court Alpha' });
  assert.equal(edit.status, 200, edit.body?.error);

  const identical = await h.request('POST', `/tournaments/${tournament.id}/generate-schedule`);
  assert.deepEqual({ created: identical.body.gamesCreated, removed: identical.body.gamesRemoved }, { created: 0, removed: 0 });
  const unchanged = gamesFor(h, tournament.id);
  assert.deepEqual(unchanged.map((game) => game.id), initial.map((game) => game.id));
  assert.equal(unchanged.find((game) => game.id === edited.id).scheduled_at, '2026-08-02 19:30:00');
  assert.equal(unchanged.find((game) => game.id === edited.id).venue, 'Court Alpha');

  await createTeam(h, tournament.id, 'E');
  const expanded = await h.request('POST', `/tournaments/${tournament.id}/generate-schedule`);
  assert.deepEqual({ created: expanded.body.gamesCreated, removed: expanded.body.gamesRemoved }, { created: 4, removed: 0 });
  const fiveTeamGames = gamesFor(h, tournament.id);
  assert.equal(fiveTeamGames.length, 10);
  assert.equal(new Set(fiveTeamGames.map(matchupKey)).size, 10);
  assert.deepEqual(fiveTeamGames.slice(0, 6).map((game) => game.id), initial.map((game) => game.id));
  assertNoRoundConflicts(fiveTeamGames);

  const withdrawn = await createTeam(h, tournament.id, 'Withdrawn before schedule');
  const withdraw = await h.request('PUT', `/teams/${withdrawn.id}`, { status: 'withdrawn' });
  assert.equal(withdraw.status, 200, withdraw.body?.error);
  const afterWithdraw = await h.request('POST', `/tournaments/${tournament.id}/generate-schedule`);
  assert.deepEqual({ created: afterWithdraw.body.gamesCreated, removed: afterWithdraw.body.gamesRemoved }, { created: 0, removed: 0 });
  assert.deepEqual(gamesFor(h, tournament.id).map((game) => game.id), fiveTeamGames.map((game) => game.id));
  assert.equal(h.db.prepare('PRAGMA foreign_key_check').all().length, 0);
});

test('ongoing history prevents duplicate regeneration and repeat requests remain idempotent', async (t) => {
  const h = createHarness();
  t.after(() => h.close());
  const tournament = await createTournament(h);
  for (const name of ['A', 'B', 'C', 'D']) await createTeam(h, tournament.id, name);
  await h.request('POST', `/tournaments/${tournament.id}/generate-schedule`);
  const initial = gamesFor(h, tournament.id);
  const ongoing = initial[0];
  await h.request('PUT', `/games/${ongoing.id}`, { scheduled_at: '2026-08-02 18:00:00' });
  const started = await h.request('PATCH', `/games/${ongoing.id}/status`, { status: 'ongoing' }, 'scorer');
  assert.equal(started.status, 200, started.body?.error);

  const regenerated = await h.request('POST', `/tournaments/${tournament.id}/generate-schedule`);
  assert.deepEqual({ created: regenerated.body.gamesCreated, removed: regenerated.body.gamesRemoved }, { created: 0, removed: 0 });
  const after = gamesFor(h, tournament.id);
  assert.equal(after.filter((game) => matchupKey(game) === matchupKey(ongoing)).length, 1);
  assert.equal(after.find((game) => game.id === ongoing.id).status, 'ongoing');

  const beforeIds = after.map((game) => game.id);
  const repeated = await Promise.all([
    h.request('POST', `/tournaments/${tournament.id}/generate-schedule`),
    h.request('POST', `/tournaments/${tournament.id}/generate-schedule`),
  ]);
  assert.ok(repeated.every((response) => response.status === 200 && response.body.gamesCreated === 0 && response.body.gamesRemoved === 0));
  assert.deepEqual(gamesFor(h, tournament.id).map((game) => game.id), beforeIds);
});

test('group assignment is transactional and cannot orphan an existing schedule', async (t) => {
  const h = createHarness();
  t.after(() => h.close());
  const tournament = await createTournament(h, { format: 'groups_playoffs', groups_count: 2, advancing_per_group: 2 });
  for (const name of ['A1', 'A2', 'B1', 'B2']) await createTeam(h, tournament.id, name);

  const firstAssignment = await h.request('POST', `/tournaments/${tournament.id}/assign-groups`);
  assert.equal(firstAssignment.status, 200, firstAssignment.body?.error);
  const firstSchedule = await h.request('POST', `/tournaments/${tournament.id}/generate-schedule`);
  assert.deepEqual({ created: firstSchedule.body.gamesCreated, removed: firstSchedule.body.gamesRemoved }, { created: 2, removed: 0 });
  const before = gamesFor(h, tournament.id);

  const blocked = await h.request('POST', `/tournaments/${tournament.id}/assign-groups`);
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error, /cannot be reassigned after games exist/i);
  assert.deepEqual(gamesFor(h, tournament.id), before);
  assert.equal(gamesFor(h, tournament.id).some((game) => game.group_id === null), false);

  const identical = await h.request('POST', `/tournaments/${tournament.id}/generate-schedule`);
  assert.deepEqual({ created: identical.body.gamesCreated, removed: identical.body.gamesRemoved }, { created: 0, removed: 0 });
  assert.deepEqual(gamesFor(h, tournament.id), before);
});

test('round robin rejects fewer than two eligible competitors with a stable error', async (t) => {
  const h = createHarness();
  t.after(() => h.close());
  const tournament = await createTournament(h);
  const response = await h.request('POST', `/tournaments/${tournament.id}/generate-schedule`);
  assert.equal(response.status, 400);
  assert.match(response.body.error, /at least two active compatible competitors/i);
  assert.equal(gamesFor(h, tournament.id).length, 0);
});
