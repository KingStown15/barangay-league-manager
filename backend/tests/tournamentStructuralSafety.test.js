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
  app.use('/api/tournaments', tournamentRoutes(db));
  app.use('/api/teams', teamRoutes(db));
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

async function createTournament(h) {
  const response = await h.request('POST', '/tournaments', {
    name: 'Structural QA', sport: 'basketball', category: 'Open', format: 'round_robin', venue: 'Old Court',
  });
  assert.equal(response.status, 201, response.body?.error);
  return response.body.tournament;
}

test('empty tournaments may change structure before registration begins', async (t) => {
  const h = createHarness();
  t.after(() => h.close());
  const tournament = await createTournament(h);
  const changed = await h.request('PUT', `/tournaments/${tournament.id}`, {
    sport: 'volleyball', format: 'single_elimination',
  });
  assert.equal(changed.status, 200, changed.body?.error);
  assert.equal(changed.body.tournament.sport, 'volleyball');
  assert.equal(changed.body.tournament.format, 'single_elimination');
});

test('entries lock sport and format while ordinary metadata remains editable', async (t) => {
  const h = createHarness();
  t.after(() => h.close());
  const tournament = await createTournament(h);
  const team = await h.request('POST', '/teams', { tournament_id: tournament.id, name: 'Registered Team' });
  assert.equal(team.status, 201, team.body?.error);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS count FROM competition_entries WHERE tournament_id = ?').get(tournament.id).count, 1);

  const sportChange = await h.request('PUT', `/tournaments/${tournament.id}`, { sport: 'volleyball' });
  assert.equal(sportChange.status, 409);
  assert.match(sportChange.body.error, /cannot change after entries or games exist/i);

  const formatChange = await h.request('PUT', `/tournaments/${tournament.id}`, { format: 'single_elimination' });
  assert.equal(formatChange.status, 409);
  assert.match(formatChange.body.error, /cannot change after entries or games exist/i);

  const metadata = await h.request('PUT', `/tournaments/${tournament.id}`, {
    name: 'Structural QA Renamed', venue: 'New Court', start_date: '2026-08-01', end_date: '2026-08-02',
  });
  assert.equal(metadata.status, 200, metadata.body?.error);
  assert.equal(metadata.body.tournament.name, 'Structural QA Renamed');
  assert.equal(metadata.body.tournament.venue, 'New Court');
  assert.equal(metadata.body.tournament.sport, 'basketball');
  assert.equal(metadata.body.tournament.format, 'round_robin');
  assert.equal(h.db.prepare('PRAGMA foreign_key_check').all().length, 0);
});
