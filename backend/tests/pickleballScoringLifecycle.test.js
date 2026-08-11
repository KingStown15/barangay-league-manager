const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');

const gameRoutes = require('../routes/games');
const pickleballRoutes = require('../routes/pickleball');
const { JWT_SECRET } = require('../middleware/auth');

const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');

function tokenFor(role, id = role === 'admin' ? 2 : 1) {
  return jwt.sign({ id, username: role, role, sessionVersion: 1 }, JWT_SECRET, { expiresIn: '1h' });
}

function createHarness({ doubles = false, scoringMode = 'side_out', bracket = false } = {}) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(schema);
  db.prepare("INSERT INTO users (id, username, password_hash, role, status) VALUES (1, 'scorer', 'x', 'scorer', 'active')").run();
  db.prepare("INSERT INTO users (id, username, password_hash, role, status) VALUES (2, 'admin', 'x', 'admin', 'active')").run();
  const config = {
    competition_format: doubles ? 'doubles' : 'singles',
    division: doubles ? 'mixed' : 'open',
    custom_division: null,
    scoring_mode: scoringMode,
    games_to_win: 2,
    points_to_win_standard_game: 2,
    points_to_win_deciding_game: 2,
    win_by: 1,
    score_cap: 3,
    allow_tied_final: false,
    track_service: true,
    track_server_number: doubles,
    side_switch_enabled: false,
    side_switch_point: null,
  };
  db.prepare(
    `INSERT INTO tournaments (
       id, name, sport, category, competition_format, division, sport_config_json, format, status
     ) VALUES (1, 'Pickleball Lifecycle QA', 'pickleball', ?, ?, ?, ?, 'single_elimination', 'active')`
  ).run(doubles ? 'Mixed Doubles' : 'Open Singles', config.competition_format, config.division, JSON.stringify(config));

  const memberCount = doubles ? 8 : 4;
  for (let id = 1; id <= memberCount; id += 1) {
    db.prepare('INSERT INTO participants (id, display_name) VALUES (?, ?)').run(id, `Player ${id}`);
  }
  const entryCount = 4;
  for (let id = 1; id <= entryCount; id += 1) {
    const displayName = doubles ? `Player ${(id * 2) - 1} / Player ${id * 2}` : `Player ${id}`;
    db.prepare(
      `INSERT INTO competition_entries (id, tournament_id, entry_type, display_name, division, seed_number)
       VALUES (?, 1, ?, ?, ?, ?)`
    ).run(id, doubles ? 'pair' : 'individual', displayName, config.division, id);
    const firstMember = doubles ? (id * 2) - 1 : id;
    db.prepare(
      'INSERT INTO competition_entry_members (competition_entry_id, participant_id, member_order) VALUES (?, ?, 1)'
    ).run(id, firstMember);
    if (doubles) {
      db.prepare(
        'INSERT INTO competition_entry_members (competition_entry_id, participant_id, member_order) VALUES (?, ?, 2)'
      ).run(id, firstMember + 1);
    }
  }

  let targetId = null;
  if (bracket) {
    targetId = Number(db.prepare(
      `INSERT INTO games (
         tournament_id, round_label, bracket_slot, side_b_entry_id, rules_snapshot_json, status
       ) VALUES (1, 'Final', 'R2-1', 3, ?, 'scheduled')`
    ).run(JSON.stringify(config)).lastInsertRowid);
  }
  const gameId = Number(db.prepare(
    `INSERT INTO games (
       tournament_id, round_label, bracket_slot, side_a_entry_id, side_b_entry_id,
       scheduled_at, status, rules_snapshot_json, feeds_game_id, feeds_slot
     ) VALUES (1, ?, ?, 1, 2, datetime('now'), 'scheduled', ?, ?, ?)`
  ).run(
    bracket ? 'Semifinals' : 'Round 1',
    bracket ? 'R1-1' : null,
    JSON.stringify(config),
    targetId,
    bracket ? 'A' : null,
  ).lastInsertRowid);

  const app = express();
  app.use(express.json());
  app.use('/api/games', gameRoutes(db));
  app.use('/api/games', pickleballRoutes(db));
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/games`;

  async function request(method, route, body, token = tokenFor('scorer')) {
    const response = await fetch(`${baseUrl}${route}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null;
    try { json = await response.json(); } catch {}
    return { status: response.status, body: json };
  }

  let actionSequence = 0;
  async function action(state, actionName, payload = {}, overrides = {}) {
    actionSequence += 1;
    return request('POST', `/${gameId}/pickleball-actions`, {
      action_id: overrides.action_id || `qa-${gameId}-${actionSequence}`,
      expected_version: overrides.expected_version ?? state.version,
      action: actionName,
      payload,
    }, overrides.token || tokenFor('scorer'));
  }

  return {
    db,
    gameId,
    targetId,
    request,
    action,
    scorerToken: tokenFor('scorer'),
    adminToken: tokenFor('admin'),
    close: () => new Promise((resolve) => server.close(() => { db.close(); resolve(); })),
  };
}

async function start(h) {
  const response = await h.request('PATCH', `/${h.gameId}/status`, { status: 'ongoing' }, h.scorerToken);
  assert.equal(response.status, 200, response.body?.error);
  const loaded = await h.request('GET', `/${h.gameId}/pickleball-state`, undefined, h.scorerToken);
  assert.equal(loaded.status, 200, loaded.body?.error);
  return loaded.body.state;
}

async function winGame(h, state, side) {
  let current = state;
  for (let point = 0; point < 2; point += 1) {
    const response = await h.action(current, 'award_point', { side });
    assert.equal(response.status, 200, response.body?.error);
    current = response.body.state;
  }
  return current;
}

async function finishStraightSets(h, initialState) {
  let state = await winGame(h, initialState, 'A');
  assert.equal(state.match_state, 'between_games');
  let response = await h.action(state, 'start_next_game');
  assert.equal(response.status, 200, response.body?.error);
  state = response.body.state;
  // The starting server alternates. Transfer service back to A in side-out mode.
  response = await h.action(state, 'award_point', { side: 'A' });
  assert.equal(response.status, 200, response.body?.error);
  state = response.body.state;
  state = await winGame(h, state, 'A');
  assert.equal(state.match_state, 'ready_to_submit');
  return state;
}

test('server-authoritative actions reject stale writes, deduplicate retries, and support one-level Undo', async (t) => {
  const h = createHarness();
  t.after(() => h.close());
  let state = await start(h);
  assert.equal(state.version, 0);

  const blockedBasketballScore = await h.request('PATCH', `/${h.gameId}/live-score`, {
    live_score_a: 1,
    live_score_b: 0,
    expected_live_score_a: 0,
    expected_live_score_b: 0,
  }, h.scorerToken);
  assert.equal(blockedBasketballScore.status, 400);
  assert.deepEqual(
    h.db.prepare('SELECT live_score_a, live_score_b FROM games WHERE id = ?').get(h.gameId),
    { live_score_a: 0, live_score_b: 0 },
  );

  const first = await h.action(state, 'award_point', { side: 'A' }, { action_id: 'same-action' });
  assert.equal(first.status, 200, first.body?.error);
  assert.equal(first.body.state.side_a_points, 1);
  assert.equal(first.body.duplicate, false);

  const duplicate = await h.action(state, 'award_point', { side: 'A' }, { action_id: 'same-action' });
  assert.equal(duplicate.status, 200, duplicate.body?.error);
  assert.equal(duplicate.body.state.side_a_points, 1);
  assert.equal(duplicate.body.duplicate, true);
  const trimmedDuplicate = await h.action(state, 'award_point', { side: 'A' }, { action_id: '  same-action  ' });
  assert.equal(trimmedDuplicate.status, 200, trimmedDuplicate.body?.error);
  assert.equal(trimmedDuplicate.body.duplicate, true);

  const stale = await h.action(state, 'award_point', { side: 'A' }, { expected_version: 0 });
  assert.equal(stale.status, 409);
  state = first.body.state;
  const undone = await h.action(state, 'undo');
  assert.equal(undone.status, 200, undone.body?.error);
  assert.equal(undone.body.state.side_a_points, 0);
  assert.equal(undone.body.state.can_undo, false);
  assert.equal(undone.body.state.version, 2);
  assert.equal(undone.body.state.match_state, 'in_progress');
});

test('Singles match completes, submits, approves, and advances an entry exactly once without clock state', async (t) => {
  const h = createHarness({ bracket: true });
  t.after(() => h.close());
  const ready = await finishStraightSets(h, await start(h));
  assert.equal(h.db.prepare('SELECT COUNT(*) AS count FROM match_games WHERE game_id = ?').get(h.gameId).count, 2);
  assert.deepEqual(
    h.db.prepare(
      'SELECT game_clock_remaining, shot_clock_remaining, current_period FROM games WHERE id = ?'
    ).get(h.gameId),
    { game_clock_remaining: null, shot_clock_remaining: null, current_period: null },
  );

  const blockedScore = await h.action(ready, 'award_point', { side: 'A' });
  assert.equal(blockedScore.status, 400);
  const submit = await h.request('POST', `/${h.gameId}/submit`, {
    expected_match_version: ready.version,
    score_a: 999,
    score_b: 999,
    remarks: 'Lifecycle QA',
  }, h.scorerToken);
  assert.equal(submit.status, 200, submit.body?.error);
  assert.equal(submit.body.pendingApproval, true);
  assert.equal(submit.body.game.score_a, 2);
  assert.equal(submit.body.game.score_b, 0);
  assert.equal(submit.body.game.winner_entry_id, 1);
  assert.equal((await h.request('POST', `/${h.gameId}/submit`, { expected_match_version: ready.version }, h.scorerToken)).status, 409);
  assert.equal((await h.request('POST', `/${h.gameId}/approve`, undefined, h.scorerToken)).status, 403);

  const approved = await h.request('POST', `/${h.gameId}/approve`, undefined, h.adminToken);
  assert.equal(approved.status, 200, approved.body?.error);
  assert.equal(h.db.prepare('SELECT side_a_entry_id FROM games WHERE id = ?').get(h.targetId).side_a_entry_id, 1);
  assert.equal(h.db.prepare('SELECT match_state FROM pickleball_match_state WHERE game_id = ?').get(h.gameId).match_state, 'approved');
  assert.equal((await h.request('POST', `/${h.gameId}/approve`, undefined, h.adminToken)).status, 409);
  assert.equal((await h.request('POST', `/${h.gameId}/reject`, { reason: 'late' }, h.adminToken)).status, 409);
});

test('rejection reopens the authoritative result and preserves completed games for a safe correction', async (t) => {
  const h = createHarness();
  t.after(() => h.close());
  const ready = await finishStraightSets(h, await start(h));
  const submitted = await h.request('POST', `/${h.gameId}/submit`, { expected_match_version: ready.version }, h.scorerToken);
  assert.equal(submitted.status, 200, submitted.body?.error);
  const rejected = await h.request('POST', `/${h.gameId}/reject`, { reason: 'Check final rally' }, h.adminToken);
  assert.equal(rejected.status, 200, rejected.body?.error);
  const reopened = h.db.prepare(
    'SELECT status, score_a, score_b, winner_entry_id, submitted_at FROM games WHERE id = ?'
  ).get(h.gameId);
  assert.deepEqual(reopened, { status: 'ongoing', score_a: null, score_b: null, winner_entry_id: null, submitted_at: null });

  const stateResponse = await h.request('GET', `/${h.gameId}/pickleball-state`, undefined, h.scorerToken);
  assert.equal(stateResponse.body.state.match_state, 'ready_to_submit');
  assert.equal(stateResponse.body.completed_games.length, 2);
  const undone = await h.action(stateResponse.body.state, 'undo');
  assert.equal(undone.status, 200, undone.body?.error);
  assert.equal(undone.body.state.match_state, 'in_progress');
  assert.equal(undone.body.state.side_a_games_won, 1);
  assert.equal(undone.body.completed_games.length, 1);
});

test('admin submission approves immediately while a tied authoritative match state is rejected', async (t) => {
  const approvedHarness = createHarness({ bracket: true });
  t.after(() => approvedHarness.close());
  const ready = await finishStraightSets(approvedHarness, await start(approvedHarness));
  const approved = await approvedHarness.request('POST', `/${approvedHarness.gameId}/submit`, {
    expected_match_version: ready.version,
  }, approvedHarness.adminToken);
  assert.equal(approved.status, 200, approved.body?.error);
  assert.equal(approved.body.pendingApproval, false);
  assert.ok(approved.body.game.approved_at);
  assert.equal(approvedHarness.db.prepare('SELECT side_a_entry_id FROM games WHERE id = ?').get(approvedHarness.targetId).side_a_entry_id, 1);
  assert.equal(approvedHarness.db.prepare('SELECT match_state FROM pickleball_match_state WHERE game_id = ?').get(approvedHarness.gameId).match_state, 'approved');

  const tiedHarness = createHarness();
  t.after(() => tiedHarness.close());
  await start(tiedHarness);
  tiedHarness.db.prepare(
    "UPDATE pickleball_match_state SET side_a_games_won = 1, side_b_games_won = 1, match_state = 'ready_to_submit' WHERE game_id = ?"
  ).run(tiedHarness.gameId);
  const tied = await tiedHarness.request('POST', `/${tiedHarness.gameId}/submit`, {
    expected_match_version: 0,
  }, tiedHarness.scorerToken);
  assert.equal(tied.status, 400);
  assert.equal(tiedHarness.db.prepare('SELECT status FROM games WHERE id = ?').get(tiedHarness.gameId).status, 'ongoing');
});

test('Doubles service progression is persisted and withdrawn entries cannot be scored', async (t) => {
  const h = createHarness({ doubles: true });
  t.after(() => h.close());
  let state = await start(h);
  assert.equal(state.server_number, 2);
  assert.deepEqual(
    JSON.parse(h.db.prepare('SELECT service_state_json FROM pickleball_match_state WHERE game_id = ?').get(h.gameId).service_state_json),
    { serving_side: 'A', server_number: 2 },
  );
  let response = await h.action(state, 'award_point', { side: 'B' });
  assert.equal(response.status, 200, response.body?.error);
  state = response.body.state;
  assert.equal(state.serving_side, 'B');
  assert.equal(state.server_number, 1);
  response = await h.action(state, 'award_point', { side: 'A' });
  assert.equal(response.status, 200, response.body?.error);
  state = response.body.state;
  assert.equal(state.serving_side, 'B');
  assert.equal(state.server_number, 2);
  response = await h.action(state, 'award_point', { side: 'A' });
  assert.equal(response.status, 200, response.body?.error);
  state = response.body.state;
  assert.equal(state.serving_side, 'A');
  assert.equal(state.server_number, 1);

  h.db.prepare("UPDATE competition_entries SET status = 'withdrawn' WHERE id = 2").run();
  const blocked = await h.action(state, 'award_point', { side: 'B' });
  assert.equal(blocked.status, 409);
});
