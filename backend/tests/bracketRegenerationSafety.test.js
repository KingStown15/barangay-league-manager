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
  const token = jwt.sign(
    { id: 1, username: 'admin', role: 'admin', sessionVersion: 1 },
    JWT_SECRET,
    { expiresIn: '1h' },
  );
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

  return {
    db,
    request,
    close: () => new Promise((resolve) => server.close(() => {
      db.close();
      resolve();
    })),
  };
}

async function createTournament(h, overrides = {}) {
  const response = await h.request('POST', '/tournaments', {
    name: 'Bracket Regeneration QA',
    sport: 'basketball',
    category: 'Open',
    format: 'single_elimination',
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

function bracketGames(h, tournamentId) {
  return h.db.prepare(
    `SELECT id, stage_id, round_label, bracket_slot, team_a_id, team_b_id,
            side_a_entry_id, side_b_entry_id, scheduled_at, venue, status,
            feeds_game_id, feeds_slot, updated_at
     FROM games
     WHERE tournament_id = ? AND bracket_slot IS NOT NULL
     ORDER BY id`,
  ).all(tournamentId);
}

function matchupKey(game) {
  return [game.team_a_id, game.team_b_id].sort((left, right) => left - right).join(':');
}

test('team bracket regeneration honors seeds and preserves game identity and manual scheduling', async (t) => {
  const h = createHarness();
  t.after(() => h.close());
  const tournament = await createTournament(h);
  const teams = [];
  for (const name of ['Seed 1', 'Seed 4', 'Seed 2', 'Seed 3']) {
    teams.push(await createTeam(h, tournament.id, name));
  }
  const seeds = new Map([
    [teams[0].id, 1], [teams[1].id, 4], [teams[2].id, 2], [teams[3].id, 3],
  ]);
  for (const [teamId, seed] of seeds) {
    h.db.prepare('UPDATE competition_entries SET seed_number = ? WHERE team_id = ?').run(seed, teamId);
  }

  const generated = await h.request('POST', `/tournaments/${tournament.id}/generate-schedule`);
  assert.deepEqual(
    { status: generated.status, created: generated.body.gamesCreated, removed: generated.body.gamesRemoved },
    { status: 200, created: 3, removed: 0 },
  );
  const initial = bracketGames(h, tournament.id);
  const semifinalPairs = new Set(initial.filter((game) => game.round_label === 'Semifinals').map(matchupKey));
  assert.deepEqual(
    semifinalPairs,
    new Set([
      matchupKey({ team_a_id: teams[0].id, team_b_id: teams[1].id }),
      matchupKey({ team_a_id: teams[2].id, team_b_id: teams[3].id }),
    ]),
  );

  const edited = initial.find((game) => game.round_label === 'Semifinals');
  h.db.prepare("UPDATE games SET scheduled_at = '2026-08-05 19:00:00', venue = 'Court Seed' WHERE id = ?").run(edited.id);
  const regenerated = await h.request('POST', `/tournaments/${tournament.id}/generate-schedule`);
  assert.deepEqual(
    { status: regenerated.status, created: regenerated.body.gamesCreated, removed: regenerated.body.gamesRemoved },
    { status: 200, created: 0, removed: 0 },
  );
  const stable = bracketGames(h, tournament.id);
  assert.deepEqual(stable.map((game) => game.id), initial.map((game) => game.id));
  assert.equal(stable.find((game) => game.id === edited.id).scheduled_at, '2026-08-05 19:00:00');
  assert.equal(stable.find((game) => game.id === edited.id).venue, 'Court Seed');

  const repeated = await Promise.all([
    h.request('POST', `/tournaments/${tournament.id}/generate-schedule`),
    h.request('POST', `/tournaments/${tournament.id}/generate-schedule`),
  ]);
  assert.ok(repeated.every((response) => response.status === 200 && response.body.gamesCreated === 0));
  assert.deepEqual(bracketGames(h, tournament.id).map((game) => game.id), initial.map((game) => game.id));
  assert.equal(h.db.prepare('PRAGMA foreign_key_check').all().length, 0);
});

test('odd-team byes remain populated and safe duplicate slots collapse to the original game', async (t) => {
  const h = createHarness();
  t.after(() => h.close());
  const tournament = await createTournament(h, { name: 'Odd Bye QA' });
  for (const name of ['One', 'Two', 'Three']) await createTeam(h, tournament.id, name);

  const generated = await h.request('POST', `/tournaments/${tournament.id}/generate-schedule`);
  assert.equal(generated.status, 200, generated.body?.error);
  const initial = bracketGames(h, tournament.id);
  const final = initial.find((game) => game.round_label === 'Final');
  assert.ok(final);
  assert.equal([final.team_a_id, final.team_b_id].filter(Boolean).length, 1);
  const duplicateSource = initial[0];
  h.db.prepare(
    `INSERT INTO games (
       tournament_id, stage_id, round_label, bracket_slot, team_a_id, team_b_id, status
     ) VALUES (?, ?, ?, ?, ?, ?, 'scheduled')`,
  ).run(
    tournament.id,
    duplicateSource.stage_id,
    duplicateSource.round_label,
    duplicateSource.bracket_slot,
    duplicateSource.team_a_id,
    duplicateSource.team_b_id,
  );

  const regenerated = await h.request('POST', `/tournaments/${tournament.id}/generate-schedule`);
  assert.deepEqual(
    { status: regenerated.status, created: regenerated.body.gamesCreated, removed: regenerated.body.gamesRemoved },
    { status: 200, created: 0, removed: 1 },
  );
  const stable = bracketGames(h, tournament.id);
  assert.deepEqual(stable.map((game) => game.id), initial.map((game) => game.id));
  assert.equal(new Set(stable.map((game) => game.bracket_slot)).size, stable.length);
  const stableFinal = stable.find((game) => game.round_label === 'Final');
  assert.equal([stableFinal.team_a_id, stableFinal.team_b_id].filter(Boolean).length, 1);
});

test('a changed bracket shape is rejected without mutating the existing safe bracket', async (t) => {
  const h = createHarness();
  t.after(() => h.close());
  const tournament = await createTournament(h, { name: 'Shape Lock QA' });
  for (const name of ['A', 'B', 'C', 'D']) await createTeam(h, tournament.id, name);
  assert.equal((await h.request('POST', `/tournaments/${tournament.id}/generate-schedule`)).status, 200);
  const before = bracketGames(h, tournament.id);

  await createTeam(h, tournament.id, 'E');
  const changed = await h.request('POST', `/tournaments/${tournament.id}/generate-schedule`);
  assert.equal(changed.status, 409);
  assert.match(changed.body.error, /bracket structure changed/i);
  assert.deepEqual(bracketGames(h, tournament.id), before);
});

test('group playoff regeneration preserves IDs and rolls back every update on failure', async (t) => {
  const h = createHarness();
  t.after(() => h.close());
  const tournament = await createTournament(h, {
    name: 'Group Playoff QA',
    format: 'groups_playoffs',
    groups_count: 2,
    advancing_per_group: 2,
    third_place_game: true,
  });
  for (const name of ['A1', 'A2', 'B1', 'B2']) await createTeam(h, tournament.id, name);
  assert.equal((await h.request('POST', `/tournaments/${tournament.id}/assign-groups`)).status, 200);
  assert.equal((await h.request('POST', `/tournaments/${tournament.id}/generate-schedule`)).status, 200);

  const generated = await h.request('POST', `/tournaments/${tournament.id}/generate-playoffs`);
  assert.deepEqual(
    { status: generated.status, created: generated.body.gamesCreated, removed: generated.body.gamesRemoved },
    { status: 200, created: 4, removed: 0 },
  );
  const initial = bracketGames(h, tournament.id);
  assert.equal(initial.filter((game) => game.round_label === 'Semifinals').length, 2);
  assert.equal(initial.filter((game) => game.round_label === 'Final').length, 1);
  assert.equal(initial.filter((game) => game.bracket_slot === '3RD').length, 1);

  const edited = initial.find((game) => game.round_label === 'Semifinals');
  h.db.prepare("UPDATE games SET scheduled_at = '2026-08-06 20:00:00', venue = 'Playoff Court' WHERE id = ?").run(edited.id);
  const stableResponse = await h.request('POST', `/tournaments/${tournament.id}/generate-playoffs`);
  assert.deepEqual(
    { status: stableResponse.status, created: stableResponse.body.gamesCreated, removed: stableResponse.body.gamesRemoved },
    { status: 200, created: 0, removed: 0 },
  );
  const stable = bracketGames(h, tournament.id);
  assert.deepEqual(stable.map((game) => game.id), initial.map((game) => game.id));
  assert.equal(stable.find((game) => game.id === edited.id).scheduled_at, '2026-08-06 20:00:00');
  assert.equal(stable.find((game) => game.id === edited.id).venue, 'Playoff Court');

  const semifinal = stable.find((game) => game.round_label === 'Semifinals');
  h.db.prepare("UPDATE games SET round_label = 'Atomic sentinel' WHERE id = ?").run(semifinal.id);
  const beforeFailure = bracketGames(h, tournament.id);
  h.db.exec(
    `CREATE TRIGGER r2a_abort_final_update BEFORE UPDATE ON games
     WHEN NEW.tournament_id = ${Number(tournament.id)} AND NEW.round_label = 'Final'
     BEGIN SELECT RAISE(ABORT, 'R2A forced playoff update failure'); END;`,
  );
  const failed = await h.request('POST', `/tournaments/${tournament.id}/generate-playoffs`);
  h.db.exec('DROP TRIGGER r2a_abort_final_update');
  assert.equal(failed.status, 400);
  assert.match(failed.body.error, /forced playoff update failure/i);
  assert.deepEqual(bracketGames(h, tournament.id), beforeFailure);
  assert.equal(h.db.prepare('PRAGMA foreign_key_check').all().length, 0);
});
