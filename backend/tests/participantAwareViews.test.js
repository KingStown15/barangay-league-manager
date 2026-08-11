const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');

const bracketRoutes = require('../routes/bracket');
const dashboardRoutes = require('../routes/dashboard');
const gameRoutes = require('../routes/games');
const publicRoutes = require('../routes/public');
const standingsRoutes = require('../routes/standings');
const { computeStandings } = require('../services/standingsService');
const { JWT_SECRET } = require('../middleware/auth');

const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');

function createHarness() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(schema);
  db.prepare("INSERT INTO users (id, username, password_hash, role, status) VALUES (1, 'admin', 'PRIVATE-PASSWORD-HASH', 'admin', 'active')").run();
  const token = jwt.sign({ id: 1, username: 'admin', role: 'admin', sessionVersion: 1 }, JWT_SECRET, { expiresIn: '1h' });
  const config = {
    competition_format: 'doubles', division: 'mixed', scoring_mode: 'side_out', games_to_win: 2,
    points_to_win_standard_game: 11, points_to_win_deciding_game: 11, win_by: 2, score_cap: null,
    allow_tied_final: false, track_service: true, track_server_number: true,
    side_switch_enabled: true, side_switch_point: 6,
  };
  db.prepare(
    `INSERT INTO tournaments (
       id, name, sport, category, competition_format, division, sport_config_json, format, status
     ) VALUES (1, 'Mixed Doubles Views QA', 'pickleball', 'Mixed', 'doubles', 'mixed', ?, 'round_robin', 'active')`
  ).run(JSON.stringify(config));

  const names = [
    ['Ana Santos', 'Ben Cruz'],
    ['Cara Reyes', 'Dan Lim'],
    ['Ella Flores', 'Finn Go'],
  ];
  let participantId = 1;
  names.forEach((members, entryIndex) => {
    const entryId = entryIndex + 1;
    db.prepare(
      `INSERT INTO competition_entries (id, tournament_id, entry_type, display_name, division, seed_number)
       VALUES (?, 1, 'pair', ?, 'mixed', ?)`
    ).run(entryId, members.join(' / '), entryId);
    members.forEach((name, memberIndex) => {
      db.prepare('INSERT INTO participants (id, display_name, affiliation) VALUES (?, ?, ?)').run(
        participantId, name, entryIndex === 0 ? 'Purok 1' : `Purok ${entryIndex + 1}`,
      );
      db.prepare(
        'INSERT INTO competition_entry_members (competition_entry_id, participant_id, member_order) VALUES (?, ?, ?)'
      ).run(entryId, participantId, memberIndex + 1);
      participantId += 1;
    });
  });

  function completedGame(sideA, sideB, scoreA, scoreB, perGameScores) {
    const winner = scoreA > scoreB ? sideA : sideB;
    const gameId = Number(db.prepare(
      `INSERT INTO games (
         tournament_id, side_a_entry_id, side_b_entry_id, scheduled_at, status,
         score_a, score_b, winner_entry_id, submitted_by, submitted_at, approved_by, approved_at, rules_snapshot_json
       ) VALUES (1, ?, ?, datetime('now'), 'completed', ?, ?, ?, 1, datetime('now'), 1, datetime('now'), ?)`
    ).run(sideA, sideB, scoreA, scoreB, winner, JSON.stringify(config)).lastInsertRowid);
    perGameScores.forEach(([a, b], index) => db.prepare(
      `INSERT INTO match_games (game_id, sequence_number, side_a_points, side_b_points, winner_entry_id)
       VALUES (?, ?, ?, ?, ?)`
    ).run(gameId, index + 1, a, b, a > b ? sideA : sideB));
    db.prepare(
      `INSERT INTO pickleball_match_state (
         game_id, current_game_number, side_a_games_won, side_b_games_won, serving_entry_id,
         server_number, service_state_json, match_state, version, rules_snapshot_json
       ) VALUES (?, ?, ?, ?, ?, 2, ?, 'approved', 10, ?)`
    ).run(gameId, perGameScores.length, scoreA, scoreB, sideA, JSON.stringify({ serving_side: 'A', server_number: 2 }), JSON.stringify(config));
    return gameId;
  }

  const gameAB = completedGame(1, 2, 2, 1, [[11, 8], [8, 11], [11, 3]]); // A +8 points
  const gameBC = completedGame(2, 3, 2, 0, [[11, 5], [11, 8]]); // B +9 points
  const gameCA = completedGame(3, 1, 2, 0, [[11, 2], [11, 3]]); // C +17 points
  db.prepare(
    `INSERT INTO games (tournament_id, round_label, side_a_entry_id, side_b_entry_id, scheduled_at, status, rules_snapshot_json)
     VALUES (1, 'Live Court', 1, 2, datetime('now'), 'ongoing', ?)`
  ).run(JSON.stringify(config));
  const liveGameId = Number(db.prepare('SELECT last_insert_rowid() AS id').get().id);
  db.prepare(
    `INSERT INTO pickleball_match_state (
       game_id, current_game_number, side_a_points, side_b_points, side_a_games_won, side_b_games_won,
       serving_entry_id, server_number, service_state_json, match_state, version, rules_snapshot_json
     ) VALUES (?, 2, 7, 6, 1, 0, 2, 1, ?, 'in_progress', 4, ?)`
  ).run(liveGameId, JSON.stringify({ serving_side: 'B', server_number: 1 }), JSON.stringify(config));

  // A separate approved final proves entry-aware champion serialization without
  // changing the round-robin standings matrix above.
  db.prepare("INSERT INTO stages (id, tournament_id, name, type, order_index) VALUES (1, 1, 'Playoffs', 'playoff', 1)").run();
  const finalId = Number(db.prepare(
    `INSERT INTO games (
       tournament_id, stage_id, round_label, bracket_slot, side_a_entry_id, side_b_entry_id,
       scheduled_at, status, score_a, score_b, winner_entry_id, submitted_by, submitted_at, approved_by, approved_at, rules_snapshot_json
     ) VALUES (1, 1, 'Final', 'R2-1', 1, 2, datetime('now'), 'completed', 2, 0, 1, 1, datetime('now'), 1, datetime('now'), ?)`
  ).run(JSON.stringify(config)).lastInsertRowid);
  [[11, 6], [11, 7]].forEach(([a, b], index) => db.prepare(
    'INSERT INTO match_games (game_id, sequence_number, side_a_points, side_b_points, winner_entry_id) VALUES (?, ?, ?, ?, 1)'
  ).run(finalId, index + 1, a, b));

  // Legacy Basketball control tournament.
  db.prepare("INSERT INTO tournaments (id, name, sport, category, format, status) VALUES (2, 'Basketball Control', 'basketball', 'Open', 'round_robin', 'active')").run();
  db.prepare("INSERT INTO teams (id, tournament_id, name, contact_number, notes) VALUES (20, 2, 'Legacy A', 'PRIVATE-CONTACT-A', 'PRIVATE-TEAM-NOTES-A')").run();
  db.prepare("INSERT INTO teams (id, tournament_id, name, contact_number, notes) VALUES (21, 2, 'Legacy B', 'PRIVATE-CONTACT-B', 'PRIVATE-TEAM-NOTES-B')").run();
  db.prepare("INSERT INTO players (tournament_id, team_id, full_name, age, eligibility_note) VALUES (2, 20, 'Private Roster Member', 19, 'PRIVATE-ELIGIBILITY-NOTE')").run();
  db.prepare("INSERT INTO audit_logs (user_id, action, details_json) VALUES (1, 'private-proof', '{\"secret\":\"PRIVATE-AUDIT-SECRET\"}')").run();
  db.prepare(
    `INSERT INTO games (tournament_id, team_a_id, team_b_id, status, score_a, score_b, winner_team_id, submitted_by, submitted_at, approved_by, approved_at)
     VALUES (2, 20, 21, 'completed', 80, 70, 20, 1, datetime('now'), 1, datetime('now'))`
  ).run();

  const app = express();
  app.use(express.json());
  app.use('/api/games', gameRoutes(db));
  app.use('/api/dashboard', dashboardRoutes(db));
  app.use('/api/standings', standingsRoutes(db));
  app.use('/api/bracket', bracketRoutes(db));
  app.use('/api/public', publicRoutes(db));
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;

  async function request(route, { auth = true } = {}) {
    const response = await fetch(`${baseUrl}${route}`, {
      headers: auth ? { Authorization: `Bearer ${token}` } : {},
    });
    const body = await response.json();
    return { status: response.status, body };
  }

  return {
    db, gameAB, gameBC, gameCA, liveGameId, finalId, request,
    close: () => new Promise((resolve) => server.close(() => { db.close(); resolve(); })),
  };
}

test('Pickleball standings use deterministic entry-aware match, game, and point metrics', (t) => {
  const h = createHarness();
  t.after(() => h.close());
  // Exclude the playoff final so this assertion isolates a three-way circular tie.
  h.db.prepare('UPDATE games SET approved_at = NULL WHERE id = ?').run(h.finalId);
  const standings = computeStandings(h.db, 1);
  assert.deepEqual(standings.map((row) => row.entryId), [2, 3, 1]);
  assert.ok(standings.every((row) => row.entryType === 'pair' && row.played === 2 && row.wins === 1 && row.losses === 1));
  assert.deepEqual(
    standings.map((row) => ({ id: row.entryId, gameDiff: row.gameDiff, pointDiff: row.pointDiff })),
    [{ id: 2, gameDiff: 1, pointDiff: 1 }, { id: 3, gameDiff: 0, pointDiff: 8 }, { id: 1, gameDiff: -1, pointDiff: -9 }],
  );
  assert.equal(standings[0].entryName, 'Cara Reyes / Dan Lim');
  assert.equal(standings[0].affiliation, 'Purok 2');
});

test('admin read models expose entry names, members, live state, breakdowns, and champion IDs', async (t) => {
  const h = createHarness();
  t.after(() => h.close());
  const games = await h.request('/games?tournament_id=1');
  assert.equal(games.status, 200);
  const live = games.body.games.find((game) => game.id === h.liveGameId);
  assert.equal(live.side_a.display_name, 'Ana Santos / Ben Cruz');
  assert.deepEqual(live.side_a.members.map((member) => member.display_name), ['Ana Santos', 'Ben Cruz']);
  assert.equal(live.live_score_a, 7);
  assert.equal(live.live_score_b, 6);
  assert.equal(live.pickleball.state.serving_side, 'B');
  const completed = games.body.games.find((game) => game.id === h.gameAB);
  assert.equal(completed.pickleball.completed_games.length, 3);

  const dashboard = await h.request('/dashboard?tournament_id=1');
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.body.ongoingGames[0].side_b.entry_type, 'pair');
  assert.ok(dashboard.body.topStandings.every((row) => row.entryId));

  const bracket = await h.request('/bracket?tournament_id=1');
  assert.equal(bracket.status, 200);
  assert.equal(bracket.body.games[0].winner_entry_id, 1);
  assert.equal(bracket.body.games[0].side_a.display_name, 'Ana Santos / Ben Cruz');
  assert.equal(bracket.body.games[0].pickleball.completed_games.length, 2);
});

test('public APIs return safe entry views and Pickleball schedule/results/standings/bracket data', async (t) => {
  const h = createHarness();
  t.after(() => h.close());
  const schedule = await h.request('/public/tournaments/1/schedule', { auth: false });
  const results = await h.request('/public/tournaments/1/results', { auth: false });
  const standings = await h.request('/public/tournaments/1/standings', { auth: false });
  const bracket = await h.request('/public/tournaments/1/bracket', { auth: false });
  const tournamentList = await h.request('/public/tournaments', { auth: false });
  const tournamentDetail = await h.request('/public/tournaments/1', { auth: false });
  const basketballResults = await h.request('/public/tournaments/2/results', { auth: false });
  for (const response of [schedule, results, standings, bracket, tournamentList, tournamentDetail, basketballResults]) {
    assert.equal(response.status, 200);
  }

  assert.equal(schedule.body.games[0].live_score_a, 7);
  assert.equal(schedule.body.games[0].side_a.members[0].display_name, 'Ana Santos');
  assert.equal(schedule.body.games[0].side_a.members[0].affiliation, 'Purok 1');
  assert.equal(results.body.games.find((game) => game.id === h.gameAB).pickleball.completed_games.length, 3);
  assert.ok(standings.body.groups[0].standings.every((row) => row.entryId));
  assert.equal(bracket.body.games[0].winner_entry_id, 1);

  const publicJson = JSON.stringify({
    schedule: schedule.body,
    results: results.body,
    standings: standings.body,
    bracket: bracket.body,
    tournamentList: tournamentList.body,
    tournamentDetail: tournamentDetail.body,
    basketballResults: basketballResults.body,
  });
  for (const forbidden of [
    'participant_id', 'legacy_player_id', 'contact_number', 'address', 'birthday',
    'private_notes', 'password_hash', 'session_version', 'eligibility_note',
  ]) {
    assert.equal(publicJson.includes(forbidden), false, forbidden);
  }
  for (const privateValue of [
    'PRIVATE-PASSWORD-HASH', 'PRIVATE-CONTACT-A', 'PRIVATE-CONTACT-B',
    'PRIVATE-TEAM-NOTES-A', 'PRIVATE-TEAM-NOTES-B', 'PRIVATE-ELIGIBILITY-NOTE',
    'PRIVATE-AUDIT-SECRET',
  ]) assert.equal(publicJson.includes(privateValue), false, privateValue);
  assert.equal(Object.prototype.hasOwnProperty.call(schedule.body.games[0], 'side_a_entry_status'), false);
});

test('legacy Basketball standings remain team-based and unchanged', (t) => {
  const h = createHarness();
  t.after(() => h.close());
  const standings = computeStandings(h.db, 2);
  assert.equal(standings[0].teamId, 20);
  assert.equal(standings[0].teamName, 'Legacy A');
  assert.equal(standings[0].wins, 1);
  assert.equal(standings[1].losses, 1);
  assert.equal(standings[0].entryId, undefined);
});
