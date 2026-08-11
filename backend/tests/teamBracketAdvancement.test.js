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
const bracketRoutes = require('../routes/bracket');
const publicRoutes = require('../routes/public');

const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');

function createHarness() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(schema);
  migrateCompetitionEntryData(db);
  db.prepare("INSERT INTO users (id, username, password_hash, role, status) VALUES (1, 'admin', 'x', 'admin', 'active')").run();
  db.prepare("INSERT INTO users (id, username, password_hash, role, status) VALUES (2, 'scorer', 'x', 'scorer', 'active')").run();
  const tokenFor = (id, role) => jwt.sign(
    { id, username: role, role, sessionVersion: 1 },
    JWT_SECRET,
    { expiresIn: '1h' },
  );
  const tokens = { admin: tokenFor(1, 'admin'), scorer: tokenFor(2, 'scorer') };
  const app = express();
  app.use(express.json());
  app.use('/api/tournaments', tournamentRoutes(db));
  app.use('/api/teams', teamRoutes(db));
  app.use('/api/games', gameRoutes(db));
  app.use('/api/bracket', bracketRoutes(db));
  app.use('/api/public', publicRoutes(db));
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;

  async function request(method, route, body, role = 'admin') {
    const response = await fetch(`${baseUrl}${route}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(role ? { Authorization: `Bearer ${tokens[role]}` } : {}),
      },
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

async function createTournament(h) {
  const response = await h.request('POST', '/tournaments', {
    name: 'Team Advancement QA',
    sport: 'basketball',
    category: 'Open',
    format: 'groups_playoffs',
    groups_count: 2,
    advancing_per_group: 2,
    third_place_game: true,
  });
  assert.equal(response.status, 201, response.body?.error);
  return response.body.tournament;
}

async function createTeam(h, tournamentId, name) {
  const response = await h.request('POST', '/teams', { tournament_id: tournamentId, name });
  assert.equal(response.status, 201, response.body?.error);
  return response.body.team;
}

async function submitResult(h, game, scoreA, scoreB, role) {
  h.db.prepare(
    `UPDATE games SET status = 'ongoing', live_score_a = ?, live_score_b = ?,
       game_clock_running = 0, shot_clock_running = 0
     WHERE id = ?`,
  ).run(scoreA, scoreB, game.id);
  return h.request('POST', `/games/${game.id}/submit`, {
    score_a: scoreA,
    score_b: scoreB,
    expected_live_score_a: scoreA,
    expected_live_score_b: scoreB,
  }, role);
}

function bracketGames(h, tournamentId) {
  return h.db.prepare(
    `SELECT id, round_label, bracket_slot, team_a_id, team_b_id,
            side_a_entry_id, side_b_entry_id, winner_team_id, winner_entry_id,
            status, submitted_at, approved_at, feeds_game_id, feeds_slot
     FROM games WHERE tournament_id = ? AND bracket_slot IS NOT NULL ORDER BY id`,
  ).all(tournamentId);
}

test('approved team semifinals advance winners and losers once into final and third place', async (t) => {
  const h = createHarness();
  t.after(() => h.close());
  const tournament = await createTournament(h);
  for (const name of ['Alpha', 'Bravo', 'Charlie', 'Delta']) {
    await createTeam(h, tournament.id, name);
  }
  assert.equal((await h.request('POST', `/tournaments/${tournament.id}/assign-groups`)).status, 200);
  assert.equal((await h.request('POST', `/tournaments/${tournament.id}/generate-schedule`)).status, 200);
  assert.equal((await h.request('POST', `/tournaments/${tournament.id}/generate-playoffs`)).status, 200);

  const generated = bracketGames(h, tournament.id);
  const semifinals = generated.filter((game) => game.round_label === 'Semifinals');
  const final = generated.find((game) => game.round_label === 'Final');
  const thirdPlace = generated.find((game) => game.bracket_slot === '3RD');
  assert.equal(semifinals.length, 2);
  assert.ok(final);
  assert.ok(thirdPlace);

  const firstPending = await submitResult(h, semifinals[0], 10, 8, 'scorer');
  assert.equal(firstPending.status, 200, firstPending.body?.error);
  assert.equal(firstPending.body.pendingApproval, true);
  assert.deepEqual(
    h.db.prepare('SELECT team_a_id, team_b_id, side_a_entry_id, side_b_entry_id FROM games WHERE id = ?').get(final.id),
    { team_a_id: null, team_b_id: null, side_a_entry_id: null, side_b_entry_id: null },
  );
  assert.deepEqual(
    h.db.prepare('SELECT team_a_id, team_b_id, side_a_entry_id, side_b_entry_id FROM games WHERE id = ?').get(thirdPlace.id),
    { team_a_id: null, team_b_id: null, side_a_entry_id: null, side_b_entry_id: null },
  );

  const approveFirst = await h.request('POST', `/games/${semifinals[0].id}/approve`);
  assert.equal(approveFirst.status, 200, approveFirst.body?.error);
  const secondPending = await submitResult(h, semifinals[1], 7, 9, 'scorer');
  assert.equal(secondPending.status, 200, secondPending.body?.error);
  const approveSecond = await h.request('POST', `/games/${semifinals[1].id}/approve`);
  assert.equal(approveSecond.status, 200, approveSecond.body?.error);

  const advancedFinal = h.db.prepare('SELECT * FROM games WHERE id = ?').get(final.id);
  const advancedThird = h.db.prepare('SELECT * FROM games WHERE id = ?').get(thirdPlace.id);
  const expectedFinalists = [semifinals[0].team_a_id, semifinals[1].team_b_id];
  const expectedThirdPlace = [semifinals[0].team_b_id, semifinals[1].team_a_id];
  assert.deepEqual([advancedFinal.team_a_id, advancedFinal.team_b_id], expectedFinalists);
  assert.deepEqual([advancedThird.team_a_id, advancedThird.team_b_id], expectedThirdPlace);
  assert.deepEqual(
    [advancedFinal.side_a_entry_id, advancedFinal.side_b_entry_id],
    expectedFinalists.map((teamId) => h.db.prepare('SELECT id FROM competition_entries WHERE team_id = ?').get(teamId).id),
  );
  assert.deepEqual(
    [advancedThird.side_a_entry_id, advancedThird.side_b_entry_id],
    expectedThirdPlace.map((teamId) => h.db.prepare('SELECT id FROM competition_entries WHERE team_id = ?').get(teamId).id),
  );

  const beforeDuplicate = bracketGames(h, tournament.id);
  const duplicateApproval = await h.request('POST', `/games/${semifinals[0].id}/approve`);
  assert.equal(duplicateApproval.status, 409);
  assert.deepEqual(bracketGames(h, tournament.id), beforeDuplicate);
  assert.equal(
    h.db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'approve_result'").get().count,
    2,
  );

  const thirdResult = await submitResult(h, advancedThird, 11, 13, 'admin');
  assert.equal(thirdResult.status, 200, thirdResult.body?.error);
  const finalResult = await submitResult(h, advancedFinal, 15, 12, 'admin');
  assert.equal(finalResult.status, 200, finalResult.body?.error);

  const adminBracket = await h.request('GET', `/bracket?tournament_id=${tournament.id}`);
  const publicBracket = await h.request('GET', `/public/tournaments/${tournament.id}/bracket`, undefined, null);
  assert.equal(adminBracket.status, 200, adminBracket.body?.error);
  assert.equal(publicBracket.status, 200, publicBracket.body?.error);
  const adminFinal = adminBracket.body.games.find((game) => game.round_label === 'Final');
  const adminThird = adminBracket.body.games.find((game) => game.bracket_slot === '3RD');
  const publicFinal = publicBracket.body.games.find((game) => game.round_label === 'Final');
  const publicThird = publicBracket.body.games.find((game) => game.bracket_slot === '3RD');
  assert.equal(adminFinal.winner_team_id, expectedFinalists[0]);
  assert.equal(adminThird.winner_team_id, expectedThirdPlace[1]);
  assert.notEqual(adminFinal.winner_team_id, adminThird.winner_team_id);
  assert.equal(publicFinal.winner_team_id, adminFinal.winner_team_id);
  assert.equal(publicThird.winner_team_id, adminThird.winner_team_id);
  assert.equal(publicBracket.body.games.length, adminBracket.body.games.length);
  assert.equal(h.db.prepare('PRAGMA foreign_key_check').all().length, 0);
  assert.equal(h.db.pragma('quick_check', { simple: true }), 'ok');
});
