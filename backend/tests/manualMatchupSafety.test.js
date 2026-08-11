const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');

const { migrateCompetitionEntryData } = require('../db/init');
const { JWT_SECRET } = require('../middleware/auth');
const gameRoutes = require('../routes/games');

const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');

function createHarness() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(schema);
  migrateCompetitionEntryData(db);
  db.prepare("INSERT INTO users (id, username, password_hash, role, status) VALUES (1, 'admin', 'x', 'admin', 'active')").run();
  const token = jwt.sign({ id: 1, username: 'admin', role: 'admin', sessionVersion: 1 }, JWT_SECRET, { expiresIn: '1h' });
  const app = express();
  app.use(express.json());
  app.use('/api/games', gameRoutes(db));
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;

  async function request(method, route, body) {
    const response = await fetch(`${baseUrl}${route}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null;
    try { json = await response.json(); } catch {}
    return { status: response.status, body: json };
  }

  return { db, request, close: () => new Promise((resolve) => server.close(() => { db.close(); resolve(); })) };
}

function seedTeamTournament(h) {
  h.db.prepare("INSERT INTO tournaments (id, name, sport, category, format, status) VALUES (1, 'QA', 'basketball', 'Open', 'round_robin', 'active')").run();
  for (const [id, name] of [[1, 'A'], [2, 'B'], [3, 'C']]) {
    h.db.prepare('INSERT INTO teams (id, tournament_id, name) VALUES (?, 1, ?)').run(id, name);
  }
}

test('manual non-bracket game creation rejects reversed duplicate matchups', async (t) => {
  const h = createHarness();
  t.after(() => h.close());
  seedTeamTournament(h);

  const first = await h.request('POST', '/games', {
    tournament_id: 1, team_a_id: 1, team_b_id: 2, round_label: 'Round 1',
  });
  assert.equal(first.status, 201, first.body?.error);

  const duplicate = await h.request('POST', '/games', {
    tournament_id: 1, team_a_id: 2, team_b_id: 1, round_label: 'Manual duplicate',
  });
  assert.equal(duplicate.status, 409);
  assert.match(duplicate.body.error, new RegExp(`game ${first.body.game.id}`));
  assert.equal(h.db.prepare('SELECT COUNT(*) AS count FROM games WHERE tournament_id = 1').get().count, 1);
});

test('side edits cannot collide with another non-bracket game while bracket rematches remain allowed', async (t) => {
  const h = createHarness();
  t.after(() => h.close());
  seedTeamTournament(h);

  const first = await h.request('POST', '/games', { tournament_id: 1, team_a_id: 1, team_b_id: 2, round_label: 'Round 1' });
  const second = await h.request('POST', '/games', { tournament_id: 1, team_a_id: 1, team_b_id: 3, round_label: 'Round 2' });
  assert.equal(first.status, 201, first.body?.error);
  assert.equal(second.status, 201, second.body?.error);

  const collision = await h.request('PUT', `/games/${second.body.game.id}`, { team_a_id: 2, team_b_id: 1 });
  assert.equal(collision.status, 409);
  const unchanged = h.db.prepare('SELECT team_a_id, team_b_id FROM games WHERE id = ?').get(second.body.game.id);
  assert.deepEqual(unchanged, { team_a_id: 1, team_b_id: 3 });

  const stageId = h.db.prepare("INSERT INTO stages (tournament_id, name, type, order_index) VALUES (1, 'Finals', 'playoff', 1)").run().lastInsertRowid;
  const bracketGame = h.db.prepare(
    "INSERT INTO games (tournament_id, stage_id, bracket_slot, team_a_id, team_b_id, status) VALUES (1, ?, 'R1-1', 2, 3, 'scheduled')"
  ).run(stageId).lastInsertRowid;
  assert.ok(bracketGame);

  const manualDifferentPair = await h.request('POST', '/games', {
    tournament_id: 1, team_a_id: 2, team_b_id: 3, round_label: 'Placement',
  });
  assert.equal(manualDifferentPair.status, 201, manualDifferentPair.body?.error);
  assert.equal(h.db.prepare('PRAGMA foreign_key_check').all().length, 0);
});
