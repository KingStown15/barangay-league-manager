const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');

const { JWT_SECRET } = require('../middleware/auth');
const bracketRoutes = require('../routes/bracket');
const competitionEntryRoutes = require('../routes/competitionEntries');
const dashboardRoutes = require('../routes/dashboard');
const gameRoutes = require('../routes/games');
const participantRoutes = require('../routes/participants');
const pickleballRoutes = require('../routes/pickleball');
const publicRoutes = require('../routes/public');
const standingsRoutes = require('../routes/standings');

const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');

function tokenFor(role, id = role === 'admin' ? 1 : 2) {
  return jwt.sign({ id, username: role, role, sessionVersion: 1 }, JWT_SECRET, { expiresIn: '1h' });
}

function createDatabase() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(schema);
  db.prepare("INSERT INTO users (id, username, password_hash, role, status) VALUES (1, 'admin', 'x', 'admin', 'active')").run();
  db.prepare("INSERT INTO users (id, username, password_hash, role, status) VALUES (2, 'scorer', 'x', 'scorer', 'active')").run();
  return db;
}

function createHarness(db = createDatabase()) {
  const app = express();
  app.use(express.json());
  app.use('/api/games', gameRoutes(db));
  app.use('/api/games', pickleballRoutes(db));
  app.use('/api/participants', participantRoutes(db));
  app.use('/api/tournaments', competitionEntryRoutes(db));
  app.use('/api/dashboard', dashboardRoutes(db));
  app.use('/api/standings', standingsRoutes(db));
  app.use('/api/bracket', bracketRoutes(db));
  app.use('/api/public', publicRoutes(db));
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;

  async function request(method, route, body, token = tokenFor('admin')) {
    const response = await fetch(`${baseUrl}${route}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
    close: () => new Promise((resolve) => server.close(() => { db.close(); resolve(); })),
  };
}

function addLegacyTournament(db, { id, name, sport, format = 'round_robin' }) {
  db.prepare(
    'INSERT INTO tournaments (id, name, sport, category, format, status) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, name, sport, 'Open', format, 'active');
  const teamA = Number(db.prepare('INSERT INTO teams (tournament_id, name) VALUES (?, ?)').run(id, `${name} A`).lastInsertRowid);
  const teamB = Number(db.prepare('INSERT INTO teams (tournament_id, name) VALUES (?, ?)').run(id, `${name} B`).lastInsertRowid);
  return { teamA, teamB };
}

function addScheduledGame(db, tournamentId, teamA, teamB, extra = {}) {
  return Number(db.prepare(
    `INSERT INTO games (
       tournament_id, stage_id, round_label, bracket_slot, team_a_id, team_b_id,
       scheduled_at, venue, status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scheduled')`
  ).run(
    tournamentId,
    extra.stageId || null,
    extra.roundLabel || null,
    extra.bracketSlot || null,
    teamA,
    teamB,
    '2026-07-13T09:00:00.000Z',
    'QA Court',
  ).lastInsertRowid);
}

test('Basketball live score, clocks, approval lifecycle, standings, bracket, and public snapshots remain stable', async (t) => {
  const h = createHarness();
  t.after(() => h.close());
  const { teamA, teamB } = addLegacyTournament(h.db, {
    id: 1, name: 'Basketball Regression', sport: 'basketball', format: 'single_elimination',
  });
  h.db.prepare("INSERT INTO stages (id, tournament_id, name, type, order_index) VALUES (1, 1, 'Playoffs', 'playoff', 1)").run();
  const gameId = addScheduledGame(h.db, 1, teamA, teamB, { stageId: 1, roundLabel: 'Final', bracketSlot: 'R1-1' });

  const scorer = tokenFor('scorer');
  assert.equal((await h.request('PATCH', `/games/${gameId}/status`, { status: 'ongoing' }, scorer)).status, 200);
  let game = h.db.prepare('SELECT * FROM games WHERE id = ?').get(gameId);
  assert.deepEqual(
    [game.live_score_a, game.live_score_b, game.current_period, game.game_clock_remaining, game.shot_clock_remaining],
    [0, 0, 1, 600, 24],
  );

  // Mirrors the scorer's +1, +2, +3, -1, and Undo score snapshots.
  let expectedScore = 0;
  for (const score of [1, 3, 6, 5, 6]) {
    const response = await h.request('PATCH', `/games/${gameId}/live-score`, {
      live_score_a: score,
      live_score_b: 0,
      expected_live_score_a: expectedScore,
      expected_live_score_b: 0,
    }, scorer);
    assert.equal(response.status, 200, response.body?.error);
    expectedScore = score;
  }

  assert.equal((await h.request('PATCH', `/games/${gameId}/clock`, { action: 'set_game_clock', seconds: 125 }, scorer)).status, 200);
  assert.equal((await h.request('PATCH', `/games/${gameId}/clock`, { action: 'start_game_clock' }, scorer)).status, 200);
  assert.equal((await h.request('PATCH', `/games/${gameId}/clock`, { action: 'pause_game_clock' }, scorer)).status, 200);
  assert.equal((await h.request('PATCH', `/games/${gameId}/clock`, { action: 'start_shot_clock' }, scorer)).status, 200);
  assert.equal((await h.request('PATCH', `/games/${gameId}/clock`, { action: 'pause_shot_clock' }, scorer)).status, 200);
  game = h.db.prepare('SELECT * FROM games WHERE id = ?').get(gameId);
  assert.equal(game.game_clock_remaining, 125);
  assert.equal(game.game_clock_running, 0);
  assert.equal(game.shot_clock_running, 0);

  const publicLive = await h.request('GET', '/public/tournaments/1/schedule', undefined, null);
  assert.equal(publicLive.status, 200);
  assert.equal(publicLive.body.games[0].live_score_a, 6);
  assert.equal(publicLive.body.games[0].game_clock_remaining, 125);

  const submitted = await h.request('POST', `/games/${gameId}/submit`, {
    score_a: 6,
    score_b: 0,
    expected_live_score_a: 6,
    expected_live_score_b: 0,
    remarks: 'Cross-sport QA',
  }, scorer);
  assert.equal(submitted.status, 200, submitted.body?.error);
  assert.equal(submitted.body.pendingApproval, true);
  assert.equal((await h.request('POST', `/games/${gameId}/submit`, {
    score_a: 7, score_b: 0, expected_live_score_a: 6, expected_live_score_b: 0,
  }, scorer)).status, 409);
  assert.equal((await h.request('POST', `/games/${gameId}/approve`, {}, scorer)).status, 403);
  assert.equal((await h.request('POST', `/games/${gameId}/approve`, {})).status, 200);
  assert.equal((await h.request('POST', `/games/${gameId}/approve`, {})).status, 409);
  assert.equal((await h.request('POST', `/games/${gameId}/reject`, { reason: 'Too late' })).status, 409);
  assert.equal((await h.request('PATCH', `/games/${gameId}/live-score`, { live_score_a: 7, live_score_b: 0 }, scorer)).status, 400);
  assert.equal((await h.request('PATCH', `/games/${gameId}/clock`, { action: 'reset_game_clock' }, scorer)).status, 400);

  const standings = await h.request('GET', '/standings?tournament_id=1');
  const bracket = await h.request('GET', '/bracket?tournament_id=1');
  const publicResults = await h.request('GET', '/public/tournaments/1/results', undefined, null);
  assert.equal(standings.status, 200);
  assert.equal(standings.body.standings[0].teamId, teamA);
  assert.equal(standings.body.standings[0].wins, 1);
  assert.equal(bracket.status, 200);
  assert.equal(bracket.body.games[0].winner_team_id, teamA);
  assert.equal(publicResults.status, 200);
  assert.equal(publicResults.body.games[0].winner_team_id, teamA);
});

test('three-minute scorer logout, public viewing, reconnect, and pause never restores older clock time', async (t) => {
  const h = createHarness();
  t.after(() => h.close());
  const { teamA, teamB } = addLegacyTournament(h.db, {
    id: 4, name: 'Long Clock Regression', sport: 'basketball', format: 'round_robin',
  });
  const gameId = addScheduledGame(h.db, 4, teamA, teamB);
  const scorer = tokenFor('scorer');
  assert.equal((await h.request('PATCH', `/games/${gameId}/status`, { status: 'ongoing' }, scorer)).status, 200);
  assert.equal((await h.request('PATCH', `/games/${gameId}/clock`, { action: 'start_game_clock' }, scorer)).status, 200);
  assert.equal((await h.request('PATCH', `/games/${gameId}/clock`, { action: 'start_shot_clock' }, scorer)).status, 200);

  // Simulate leaving the scorer for just over three minutes without a real-time wait.
  const firstStartedAt = new Date(Date.now() - 185_000).toISOString();
  h.db.prepare(
    `UPDATE games
     SET game_clock_started_at = ?, shot_clock_started_at = ?
     WHERE id = ?`
  ).run(firstStartedAt, firstStartedAt, gameId);

  const publicAfterLogout = await h.request('GET', '/public/tournaments/4/schedule', undefined, null);
  assert.equal(publicAfterLogout.status, 200);
  const publicGame = publicAfterLogout.body.games[0];
  assert.ok(publicGame.game_clock_remaining <= 415 && publicGame.game_clock_remaining >= 414);
  assert.equal(publicGame.shot_clock_remaining, 0);
  assert.equal(publicGame.game_clock_running, 1);

  // A reconnect/retry may send Start again. It must persist the effective
  // snapshot instead of restoring the original 10:00 value.
  const repeatedStart = await h.request('PATCH', `/games/${gameId}/clock`, { action: 'start_game_clock' }, scorer);
  assert.equal(repeatedStart.status, 200, repeatedStart.body?.error);
  assert.ok(repeatedStart.body.game.game_clock_remaining <= publicGame.game_clock_remaining);
  assert.ok(repeatedStart.body.game.game_clock_remaining < 600);
  const repeatedShotStart = await h.request('PATCH', `/games/${gameId}/clock`, { action: 'start_shot_clock' }, scorer);
  assert.equal(repeatedShotStart.status, 200, repeatedShotStart.body?.error);
  assert.equal(repeatedShotStart.body.game.shot_clock_remaining, 0);

  // Simulate another two minutes, then pause from the returned scorer session.
  h.db.prepare('UPDATE games SET game_clock_started_at = ? WHERE id = ?')
    .run(new Date(Date.now() - 125_000).toISOString(), gameId);
  const publicBeforePause = await h.request('GET', '/public/tournaments/4/schedule', undefined, null);
  const pause = await h.request('PATCH', `/games/${gameId}/clock`, { action: 'pause_game_clock' }, scorer);
  assert.equal(pause.status, 200, pause.body?.error);
  assert.equal(pause.body.game.game_clock_running, 0);
  assert.equal(pause.body.game.game_clock_started_at, null);
  assert.ok(pause.body.game.game_clock_remaining <= publicBeforePause.body.games[0].game_clock_remaining);

  const stoppedValue = pause.body.game.game_clock_remaining;
  const publicAfterPause = await h.request('GET', '/public/tournaments/4/schedule', undefined, null);
  const scorerAfterPause = await h.request('GET', `/games/${gameId}`, undefined, scorer);
  assert.equal(publicAfterPause.body.games[0].game_clock_remaining, stoppedValue);
  assert.equal(scorerAfterPause.body.game.game_clock_remaining, stoppedValue);
  assert.equal(h.db.prepare('SELECT game_clock_remaining FROM games WHERE id = ?').get(gameId).game_clock_remaining, stoppedValue);
});

test('Volleyball keeps stage-aware validation, rejection correction, public results, and sport-isolated controls', async (t) => {
  const h = createHarness();
  t.after(() => h.close());
  const { teamA, teamB } = addLegacyTournament(h.db, { id: 2, name: 'Volleyball Regression', sport: 'volleyball' });
  const gameId = addScheduledGame(h.db, 2, teamA, teamB);
  const scorer = tokenFor('scorer');

  assert.equal((await h.request('PATCH', `/games/${gameId}/status`, { status: 'ongoing' }, scorer)).status, 200);
  assert.equal((await h.request('PATCH', `/games/${gameId}/clock`, { action: 'start_game_clock' }, scorer)).status, 400);
  assert.equal((await h.request('GET', `/games/${gameId}/pickleball-state`, undefined, scorer)).status, 400);
  assert.equal((await h.request('PATCH', `/games/${gameId}/live-score`, { live_score_a: 2, live_score_b: 1 }, scorer)).status, 400);
  h.db.prepare('UPDATE games SET live_score_a = 2, live_score_b = 1 WHERE id = ?').run(gameId);

  const invalid = await h.request('POST', `/games/${gameId}/submit`, {
    score_a: 3, score_b: 1, expected_live_score_a: 2, expected_live_score_b: 1,
  }, scorer);
  assert.equal(invalid.status, 400);
  assert.equal((await h.request('POST', `/games/${gameId}/submit`, {
    score_a: 2, score_b: 1, expected_live_score_a: 2, expected_live_score_b: 1,
  }, scorer)).status, 200);
  assert.equal((await h.request('POST', `/games/${gameId}/reject`, { reason: 'Correct the score sheet' })).status, 200);

  const reopened = h.db.prepare('SELECT * FROM games WHERE id = ?').get(gameId);
  assert.equal(reopened.status, 'ongoing');
  assert.deepEqual([reopened.live_score_a, reopened.live_score_b], [0, 0]);
  assert.equal((await h.request('POST', `/games/${gameId}/submit`, {
    score_a: 2, score_b: 0, expected_live_score_a: 0, expected_live_score_b: 0,
  }, scorer)).status, 200);
  assert.equal((await h.request('POST', `/games/${gameId}/approve`, {})).status, 200);

  const standings = await h.request('GET', '/standings?tournament_id=2');
  const publicResults = await h.request('GET', '/public/tournaments/2/results', undefined, null);
  assert.equal(standings.body.standings[0].teamId, teamA);
  assert.equal(publicResults.body.games[0].score_a, 2);
  assert.equal(publicResults.body.games[0].score_b, 0);
});

test('entry, participant, scoring, approval, membership, and tournament-context authorization remain enforced', async (t) => {
  const h = createHarness();
  t.after(() => h.close());
  const config = JSON.stringify({
    competition_format: 'doubles', division: 'mixed', scoring_mode: 'side_out', games_to_win: 2,
    points_to_win_standard_game: 11, points_to_win_deciding_game: 11, win_by: 2, score_cap: null,
    allow_tied_final: false, track_service: true, track_server_number: true,
    side_switch_enabled: true, side_switch_point: 6,
  });
  h.db.prepare(
    `INSERT INTO tournaments (id, name, sport, category, competition_format, division, sport_config_json, format, status)
     VALUES (3, 'Mixed Pair Security', 'pickleball', 'Mixed', 'doubles', 'mixed', ?, 'round_robin', 'active')`
  ).run(config);
  h.db.prepare(
    `INSERT INTO tournaments (id, name, sport, category, competition_format, division, sport_config_json, format, status)
     VALUES (4, 'Other Pair Security', 'pickleball', 'Mixed', 'doubles', 'mixed', ?, 'round_robin', 'active')`
  ).run(config);
  for (const [id, name] of [[1, 'Ana'], [2, 'Ben'], [3, 'Cara'], [4, 'Dan']]) {
    h.db.prepare('INSERT INTO participants (id, display_name) VALUES (?, ?)').run(id, name);
  }
  h.db.prepare("INSERT INTO competition_entries (id, tournament_id, entry_type, display_name, division) VALUES (1, 3, 'pair', 'Ana / Ben', 'mixed')").run();
  h.db.prepare("INSERT INTO competition_entries (id, tournament_id, entry_type, display_name, division) VALUES (2, 3, 'pair', 'Cara / Dan', 'mixed')").run();
  h.db.prepare("INSERT INTO competition_entries (id, tournament_id, entry_type, display_name, division) VALUES (3, 4, 'pair', 'Other Pair', 'mixed')").run();
  for (const [entry, participant, order] of [[1, 1, 1], [1, 2, 2], [2, 3, 1], [2, 4, 2], [3, 1, 1], [3, 3, 2]]) {
    h.db.prepare('INSERT INTO competition_entry_members (competition_entry_id, participant_id, member_order) VALUES (?, ?, ?)').run(entry, participant, order);
  }
  const scorer = tokenFor('scorer');

  assert.equal((await h.request('POST', '/tournaments/3/entries', {
    entry_type: 'pair', participant_ids: [1, 3], division: 'mixed',
  }, scorer)).status, 403);
  assert.equal((await h.request('PUT', '/tournaments/3/entries/1', { participant_ids: [2, 3] }, scorer)).status, 403);
  assert.equal((await h.request('POST', '/tournaments/3/entries/1/withdraw', {}, scorer)).status, 403);
  assert.equal((await h.request('PUT', '/participants/1', { display_name: 'Blocked' }, scorer)).status, 403);
  assert.equal((await h.request('POST', '/games', {
    tournament_id: 3, side_a_entry_id: 1, side_b_entry_id: 3, scheduled_at: '2026-07-13T10:00:00.000Z',
  })).status, 400);
  assert.equal((await h.request('POST', '/games', {
    tournament_id: 3, side_a_entry_id: 1, side_b_entry_id: 2, scheduled_at: '2026-07-13T10:00:00.000Z',
  }, scorer)).status, 403);
  assert.equal((await h.request('POST', '/games/999/pickleball-actions', {
    action_id: 'blocked', expected_version: 0, action: 'award_point', payload: { side: 'A' },
  }, null)).status, 401);
  assert.deepEqual(
    h.db.prepare('SELECT participant_id FROM competition_entry_members WHERE competition_entry_id = 1 ORDER BY member_order').all().map((row) => row.participant_id),
    [1, 2],
  );
});

test('realistic entry-aware reads stay bounded and avoid per-game participant queries', async (t) => {
  const rawDb = createDatabase();
  const config = JSON.stringify({
    competition_format: 'doubles', division: 'mixed', scoring_mode: 'side_out', games_to_win: 2,
    points_to_win_standard_game: 11, points_to_win_deciding_game: 11, win_by: 2, score_cap: null,
    allow_tied_final: false, track_service: true, track_server_number: true,
    side_switch_enabled: true, side_switch_point: 6,
  });
  rawDb.prepare(
    `INSERT INTO tournaments (id, name, sport, category, competition_format, division, sport_config_json, format, status)
     VALUES (10, 'Performance Doubles', 'pickleball', 'Mixed', 'doubles', 'mixed', ?, 'round_robin', 'active')`
  ).run(config);
  const insertParticipant = rawDb.prepare('INSERT INTO participants (display_name, affiliation) VALUES (?, ?)');
  const insertEntry = rawDb.prepare("INSERT INTO competition_entries (tournament_id, entry_type, display_name, division, seed_number) VALUES (10, 'pair', ?, 'mixed', ?)");
  const insertMember = rawDb.prepare('INSERT INTO competition_entry_members (competition_entry_id, participant_id, member_order) VALUES (?, ?, ?)');
  const entries = [];
  for (let index = 1; index <= 64; index += 1) {
    const first = Number(insertParticipant.run(`Player ${index * 2 - 1}`, `Purok ${(index % 7) + 1}`).lastInsertRowid);
    const second = Number(insertParticipant.run(`Player ${index * 2}`, `Purok ${(index % 7) + 1}`).lastInsertRowid);
    const entry = Number(insertEntry.run(`Player ${index * 2 - 1} / Player ${index * 2}`, index).lastInsertRowid);
    insertMember.run(entry, first, 1);
    insertMember.run(entry, second, 2);
    entries.push(entry);
  }
  const insertGame = rawDb.prepare(
    `INSERT INTO games (tournament_id, side_a_entry_id, side_b_entry_id, scheduled_at, status, rules_snapshot_json)
     VALUES (10, ?, ?, ?, 'scheduled', ?)`
  );
  let firstGameId = null;
  for (let index = 0; index < 240; index += 1) {
    const result = insertGame.run(entries[index % entries.length], entries[(index + 1) % entries.length], `2026-07-${String((index % 20) + 1).padStart(2, '0')}T09:00:00.000Z`, config);
    if (firstGameId === null) firstGameId = Number(result.lastInsertRowid);
  }
  const stageId = Number(rawDb.prepare(
    "INSERT INTO stages (tournament_id, name, type, order_index) VALUES (10, 'Performance Bracket', 'playoff', 1)"
  ).run().lastInsertRowid);
  const insertBracketGame = rawDb.prepare(
    `INSERT INTO games (
       tournament_id, stage_id, round_label, bracket_slot, side_a_entry_id, side_b_entry_id,
       scheduled_at, status, rules_snapshot_json
     ) VALUES (10, ?, 'Round 1', ?, ?, ?, '2026-07-21T09:00:00.000Z', 'scheduled', ?)`
  );
  for (let index = 0; index < 31; index += 1) {
    insertBracketGame.run(stageId, `R1-${index + 1}`, entries[index], entries[index + 32], config);
  }

  let queryCount = 0;
  let memberQueryCount = 0;
  const db = new Proxy(rawDb, {
    get(target, property) {
      if (property === 'prepare') {
        return (sql) => {
          queryCount += 1;
          if (String(sql).includes('FROM competition_entry_members cem')) memberQueryCount += 1;
          return target.prepare(sql);
        };
      }
      const value = target[property];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const h = createHarness(db);
  t.after(() => h.close());

  async function measure(route, { auth = true } = {}) {
    queryCount = 0;
    memberQueryCount = 0;
    const started = performance.now();
    const response = await h.request('GET', route, undefined, auth ? tokenFor('admin') : null);
    return {
      status: response.status,
      elapsedMs: performance.now() - started,
      queries: queryCount,
      memberQueries: memberQueryCount,
    };
  }

  const results = {
    dashboard: await measure('/dashboard?tournament_id=10'),
    entries: await measure('/tournaments/10/entries'),
    schedule: await measure('/games?tournament_id=10'),
    standings: await measure('/standings?tournament_id=10'),
    bracket: await measure('/bracket?tournament_id=10'),
    publicOverviewData: await measure('/public/tournaments/10/schedule', { auth: false }),
    scorerGame: await measure(`/games/${firstGameId}`),
  };
  t.diagnostic(`performance ${JSON.stringify(results)}`);
  for (const [name, result] of Object.entries(results)) {
    assert.equal(result.status, 200, name);
    assert.ok(result.elapsedMs < 1500, `${name} took ${result.elapsedMs.toFixed(1)}ms`);
  }
  assert.ok(results.schedule.queries < 10, JSON.stringify(results.schedule));
  assert.equal(results.schedule.memberQueries, 1);
  assert.ok(results.publicOverviewData.queries < 10, JSON.stringify(results.publicOverviewData));
  assert.equal(results.publicOverviewData.memberQueries, 1);
  assert.ok(results.standings.queries < 12, JSON.stringify(results.standings));
  assert.ok(results.bracket.queries < 8, JSON.stringify(results.bracket));
  assert.equal(results.bracket.memberQueries, 1);
  assert.ok(results.scorerGame.queries < 12, JSON.stringify(results.scorerGame));
  assert.equal(results.scorerGame.memberQueries, 1);
  assert.ok(results.dashboard.queries < 30, JSON.stringify(results.dashboard));
  assert.ok(results.dashboard.memberQueries <= 4, JSON.stringify(results.dashboard));
});
