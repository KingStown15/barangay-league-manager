const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');

const { migrateCompetitionEntryData } = require('../db/init');
const { JWT_SECRET } = require('../middleware/auth');
const competitionEntryRoutes = require('../routes/competitionEntries');
const participantRoutes = require('../routes/participants');
const tournamentRoutes = require('../routes/tournaments');

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
  app.use('/api/participants', participantRoutes(db));
  app.use('/api/tournaments', tournamentRoutes(db));
  app.use('/api/tournaments', competitionEntryRoutes(db));
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

function tournamentPayload(overrides = {}) {
  return {
    name: 'Pickleball QA',
    sport: 'pickleball',
    format: 'round_robin',
    competition_format: 'singles',
    division: 'open',
    scoring_mode: 'side_out',
    games_to_win: 2,
    points_to_win_standard_game: 11,
    points_to_win_deciding_game: 11,
    win_by: 2,
    score_cap: null,
    track_service: true,
    track_server_number: false,
    side_switch_enabled: true,
    side_switch_point: 6,
    ...overrides,
  };
}

async function addParticipant(h, name) {
  const response = await h.request('POST', '/participants', { display_name: name });
  assert.equal(response.status, 201, response.body?.error);
  return response.body.participant.id;
}

async function addEntry(h, tournament, participantIds) {
  const response = await h.request('POST', `/tournaments/${tournament.id}/entries`, {
    entry_type: tournament.competition_format === 'singles' ? 'individual' : 'pair',
    participant_ids: participantIds,
    division: tournament.division,
  });
  assert.equal(response.status, 201, response.body?.error);
  return response.body.entry;
}

test('Pickleball tournament configuration validates formats, divisions, and rules', async (t) => {
  const h = createHarness();
  t.after(() => h.close());

  const singles = await h.request('POST', '/tournaments', tournamentPayload());
  assert.equal(singles.status, 201, singles.body?.error);
  assert.equal(singles.body.tournament.competition_format, 'singles');
  assert.equal(singles.body.tournament.division, 'open');
  assert.equal(singles.body.tournament.sport_config.games_to_win, 2);
  assert.equal(singles.body.tournament.sport_config.allow_tied_final, false);
  const updated = await h.request('PUT', `/tournaments/${singles.body.tournament.id}`, {
    points_to_win_standard_game: 15,
    points_to_win_deciding_game: 15,
    side_switch_point: 8,
  });
  assert.equal(updated.status, 200, updated.body?.error);
  assert.equal(updated.body.tournament.sport_config.points_to_win_standard_game, 15);

  const doubles = await h.request('POST', '/tournaments', tournamentPayload({
    name: 'Doubles', competition_format: 'doubles', division: 'mixed', track_server_number: true,
  }));
  assert.equal(doubles.status, 201, doubles.body?.error);

  assert.equal((await h.request('POST', '/tournaments', tournamentPayload({ division: 'mixed' }))).status, 400);
  assert.equal((await h.request('POST', '/tournaments', tournamentPayload({ format: 'groups_playoffs' }))).status, 400);
  assert.equal((await h.request('POST', '/tournaments', tournamentPayload({ score_cap: 9 }))).status, 400);
  assert.equal((await h.request('POST', '/tournaments', tournamentPayload({ division: 'custom', custom_division: '' }))).status, 400);
});

test('legacy Basketball and Volleyball tournament creation remains compatible', async (t) => {
  const h = createHarness();
  t.after(() => h.close());
  for (const sport of ['basketball', 'volleyball']) {
    const response = await h.request('POST', '/tournaments', {
      name: `${sport} QA`, sport, category: 'Open', format: 'round_robin',
    });
    assert.equal(response.status, 201, response.body?.error);
    assert.equal(response.body.tournament.sport, sport);
    assert.equal(response.body.tournament.competition_format, null);
    assert.equal(response.body.tournament.sport_config, null);
  }
});

test('Singles entries generate an entry-only round robin and exclude withdrawals', async (t) => {
  const h = createHarness();
  t.after(() => h.close());
  const created = await h.request('POST', '/tournaments', tournamentPayload());
  const tournament = created.body.tournament;
  const ids = [];
  for (const name of ['Ana', 'Bea', 'Cara', 'Dina']) ids.push(await addParticipant(h, name));
  const entries = [];
  for (const id of ids) entries.push(await addEntry(h, tournament, [id]));
  const blockedChange = await h.request('PUT', `/tournaments/${tournament.id}`, { competition_format: 'doubles' });
  assert.equal(blockedChange.status, 409);
  assert.equal((await h.request('PUT', `/tournaments/${tournament.id}`, { format: 'single_elimination' })).status, 409);
  assert.equal((await h.request('PUT', `/tournaments/${tournament.id}`, { sport: 'basketball' })).status, 409);

  const generated = await h.request('POST', `/tournaments/${tournament.id}/generate-schedule`);
  assert.equal(generated.status, 200, generated.body?.error);
  assert.equal(generated.body.gamesCreated, 6);
  const games = h.db.prepare('SELECT * FROM games WHERE tournament_id = ? ORDER BY id').all(tournament.id);
  assert.equal(games.length, 6);
  assert.ok(games.every((game) => game.team_a_id === null && game.team_b_id === null));
  assert.ok(games.every((game) => game.side_a_entry_id && game.side_b_entry_id && game.side_a_entry_id !== game.side_b_entry_id));
  assert.ok(games.every((game) => JSON.parse(game.rules_snapshot_json).competition_format === 'singles'));
  assert.equal(h.db.prepare('SELECT COUNT(*) AS count FROM teams WHERE tournament_id = ?').get(tournament.id).count, 0);

  await h.request('POST', `/tournaments/${tournament.id}/entries/${entries[3].id}/withdraw`, { reason: 'QA' });
  const regenerated = await h.request('POST', `/tournaments/${tournament.id}/generate-schedule`);
  assert.equal(regenerated.status, 200, regenerated.body?.error);
  assert.equal(regenerated.body.gamesCreated, 0);
  assert.equal(regenerated.body.gamesRemoved, 3);
  const remaining = h.db.prepare('SELECT * FROM games WHERE tournament_id = ? ORDER BY id').all(tournament.id);
  assert.equal(remaining.length, 3);
  assert.ok(remaining.every((game) => game.side_a_entry_id !== entries[3].id && game.side_b_entry_id !== entries[3].id));
  assert.deepEqual(remaining.map((game) => game.id), games.filter(
    (game) => game.side_a_entry_id !== entries[3].id && game.side_b_entry_id !== entries[3].id
  ).map((game) => game.id));
});

test('Doubles entries validate type and generate an entry-aware single-elimination bracket', async (t) => {
  const h = createHarness();
  t.after(() => h.close());
  const created = await h.request('POST', '/tournaments', tournamentPayload({
    name: 'Mixed Doubles', format: 'single_elimination', competition_format: 'doubles', division: 'mixed', track_server_number: true,
  }));
  const tournament = created.body.tournament;
  const ids = [];
  for (let index = 1; index <= 8; index++) ids.push(await addParticipant(h, `Player ${index}`));

  const invalid = await h.request('POST', `/tournaments/${tournament.id}/entries`, {
    entry_type: 'individual', participant_ids: [ids[0]], division: 'mixed',
  });
  assert.equal(invalid.status, 400);

  for (let index = 0; index < ids.length; index += 2) {
    await addEntry(h, tournament, [ids[index], ids[index + 1]]);
  }
  const generated = await h.request('POST', `/tournaments/${tournament.id}/generate-schedule`);
  assert.equal(generated.status, 200, generated.body?.error);
  assert.equal(generated.body.gamesCreated, 3);
  const games = h.db.prepare('SELECT * FROM games WHERE tournament_id = ? ORDER BY id').all(tournament.id);
  assert.equal(games.length, 3);
  assert.ok(games.every((game) => game.bracket_slot));
  assert.ok(games.slice(0, 2).every((game) => game.side_a_entry_id && game.side_b_entry_id));
  assert.equal(games[2].side_a_entry_id, null);
  assert.equal(games[2].side_b_entry_id, null);
  assert.ok(games.every((game) => JSON.parse(game.rules_snapshot_json).competition_format === 'doubles'));
  assert.equal(h.db.prepare('SELECT COUNT(*) AS count FROM teams WHERE tournament_id = ?').get(tournament.id).count, 0);
});
