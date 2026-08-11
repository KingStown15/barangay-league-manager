const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');

const gameRoutes = require('../routes/games');
const { JWT_SECRET } = require('../middleware/auth');

const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');

function tokenFor(role, id = role === 'admin' ? 2 : 1) {
  return jwt.sign({ id, username: role, role, sessionVersion: 1 }, JWT_SECRET, { expiresIn: '1h' });
}

function createHarness({ sport = 'basketball', status = 'ongoing', bracket = false, missingTeam = false, roundLabel = null } = {}) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(schema);
  db.prepare("INSERT INTO users (id, username, password_hash, role, status) VALUES (1, 'scorer', 'x', 'scorer', 'active')").run();
  db.prepare("INSERT INTO users (id, username, password_hash, role, status) VALUES (2, 'admin', 'x', 'admin', 'active')").run();
  db.prepare(
    "INSERT INTO tournaments (id, name, sport, format, status) VALUES (1, 'QA Tournament', ?, 'single_elimination', 'active')"
  ).run(sport);
  db.prepare("INSERT INTO teams (id, tournament_id, name) VALUES (1, 1, 'Team A')").run();
  db.prepare("INSERT INTO teams (id, tournament_id, name) VALUES (2, 1, 'Team B')").run();
  db.prepare("INSERT INTO teams (id, tournament_id, name) VALUES (3, 1, 'Winner Slot')").run();

  let targetId = null;
  if (bracket) {
    targetId = Number(db.prepare(
      "INSERT INTO games (tournament_id, round_label, bracket_slot, team_b_id, status) VALUES (1, 'Final', 'R2-1', 3, 'scheduled')"
    ).run().lastInsertRowid);
  }

  const nowMs = Date.now();
  const result = db.prepare(
    `INSERT INTO games (
       tournament_id, round_label, bracket_slot, team_a_id, team_b_id, status,
       live_score_a, live_score_b, current_period,
       game_clock_remaining, game_clock_running, game_clock_started_at,
       shot_clock_remaining, shot_clock_running, shot_clock_started_at,
       feeds_game_id, feeds_slot
     ) VALUES (1, ?, ?, 1, ?, ?, 7, 5, 2, 600, 1, ?, 24, 1, ?, ?, ?)`
  ).run(
    roundLabel || (bracket ? 'Semifinals' : 'Round 1'),
    bracket ? 'R1-1' : null,
    missingTeam ? null : 2,
    status,
    new Date(nowMs - 12_000).toISOString(),
    new Date(nowMs - 5_000).toISOString(),
    targetId,
    bracket ? 'A' : null,
  );
  const gameId = Number(result.lastInsertRowid);

  const app = express();
  app.use(express.json());
  app.use('/api/games', gameRoutes(db));
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  async function request(method, route, body, token) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${baseUrl}/api/games${route}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null;
    try { json = await response.json(); } catch {}
    return { status: response.status, body: json };
  }

  function submitPayload(overrides = {}) {
    return {
      score_a: 7,
      score_b: 5,
      expected_live_score_a: 7,
      expected_live_score_b: 5,
      remarks: 'QA result',
      ...overrides,
    };
  }

  return {
    db,
    gameId,
    targetId,
    scorerToken: tokenFor('scorer'),
    adminToken: tokenFor('admin'),
    request,
    submitPayload,
    close() {
      return new Promise((resolve) => server.close(() => { db.close(); resolve(); }));
    },
  };
}

test('submission rejects unauthenticated or unknown users and requires an ongoing game', async (t) => {
  const h = createHarness();
  t.after(() => h.close());

  assert.equal((await h.request('POST', `/${h.gameId}/submit`, h.submitPayload())).status, 401);
  assert.equal((await h.request('POST', `/${h.gameId}/submit`, h.submitPayload(), tokenFor('viewer', 9))).status, 401);
  assert.equal((await h.request('POST', '/999999/submit', h.submitPayload(), h.scorerToken)).status, 404);

  for (const status of ['scheduled', 'postponed', 'cancelled', 'completed', 'forfeited']) {
    h.db.prepare('UPDATE games SET status = ? WHERE id = ?').run(status, h.gameId);
    const response = await h.request('POST', `/${h.gameId}/submit`, h.submitPayload(), h.scorerToken);
    assert.equal(response.status, 409, status);
    assert.equal(h.db.prepare('SELECT status FROM games WHERE id = ?').get(h.gameId).status, status);
  }
});

test('submission requires both teams and strict fresh live-score expectations', async (t) => {
  const missing = createHarness({ missingTeam: true });
  t.after(() => missing.close());
  assert.equal((await missing.request('POST', `/${missing.gameId}/submit`, missing.submitPayload(), missing.scorerToken)).status, 400);

  const stale = createHarness();
  t.after(() => stale.close());
  assert.equal((await stale.request('POST', `/${stale.gameId}/submit`, {
    score_a: 7,
    score_b: 5,
  }, stale.scorerToken)).status, 400);
  assert.equal((await stale.request('POST', `/${stale.gameId}/submit`, stale.submitPayload({ expected_live_score_a: '7' }), stale.scorerToken)).status, 400);
  const response = await stale.request('POST', `/${stale.gameId}/submit`, stale.submitPayload({ expected_live_score_a: 6 }), stale.scorerToken);
  assert.equal(response.status, 409);
  const row = stale.db.prepare('SELECT status, game_clock_running FROM games WHERE id = ?').get(stale.gameId);
  assert.deepEqual(row, { status: 'ongoing', game_clock_running: 1 });
});

test('basketball rejects invalid values and ties without stopping clocks', async (t) => {
  const h = createHarness();
  t.after(() => h.close());

  const invalidPayloads = [
    h.submitPayload({ score_a: null }),
    h.submitPayload({ score_a: -1 }),
    h.submitPayload({ score_a: 1.5 }),
    h.submitPayload({ score_a: 1000 }),
    h.submitPayload({ score_a: Number.MAX_SAFE_INTEGER }),
    h.submitPayload({ score_a: '9', score_b: '10' }),
    h.submitPayload({ score_a: 5, score_b: 5 }),
  ];
  for (const payload of invalidPayloads) {
    const response = await h.request('POST', `/${h.gameId}/submit`, payload, h.scorerToken);
    assert.equal(response.status, 400);
  }

  const row = h.db.prepare(
    'SELECT status, game_clock_running, game_clock_started_at, shot_clock_running, shot_clock_started_at FROM games WHERE id = ?'
  ).get(h.gameId);
  assert.equal(row.status, 'ongoing');
  assert.equal(row.game_clock_running, 1);
  assert.ok(row.game_clock_started_at);
  assert.equal(row.shot_clock_running, 1);
  assert.ok(row.shot_clock_started_at);
});

test('championship volleyball enforces a first-to-three set result', async (t) => {
  for (const [scoreA, scoreB, expected] of [[3, 0, 200], [3, 2, 200], [0, 0, 400], [2, 2, 400], [4, 0, 400], [3, 3, 400]]) {
    const h = createHarness({ sport: 'volleyball', roundLabel: 'Final' });
    t.after(() => h.close());
    const response = await h.request('POST', `/${h.gameId}/submit`, h.submitPayload({ score_a: scoreA, score_b: scoreB }), h.scorerToken);
    assert.equal(response.status, expected, `${scoreA}-${scoreB}`);
  }
});

test('preliminary and non-final knockout volleyball enforce first-to-two sets', async (t) => {
  for (const roundLabel of ['Round 1', 'Quarterfinals', 'Semifinals', 'Third Place']) {
    for (const [scoreA, scoreB, expected] of [[2, 0, 200], [2, 1, 200], [3, 0, 400], [1, 1, 400]]) {
      const h = createHarness({ sport: 'volleyball', roundLabel });
      t.after(() => h.close());
      const response = await h.request('POST', `/${h.gameId}/submit`, h.submitPayload({
        score_a: scoreA,
        score_b: scoreB,
        expected_live_score_a: 7,
        expected_live_score_b: 5,
      }), h.scorerToken);
      assert.equal(response.status, expected, `${roundLabel} ${scoreA}-${scoreB}: ${response.body?.error || ''}`);
    }
  }
});

test('scorer submission becomes pending and transactionally freezes effective basketball clocks', async (t) => {
  const h = createHarness();
  t.after(() => h.close());

  const response = await h.request('POST', `/${h.gameId}/submit`, h.submitPayload(), h.scorerToken);
  assert.equal(response.status, 200);
  assert.equal(response.body.pendingApproval, true);

  const row = h.db.prepare('SELECT * FROM games WHERE id = ?').get(h.gameId);
  assert.equal(row.status, 'completed');
  assert.equal(row.score_a, 7);
  assert.equal(row.score_b, 5);
  assert.equal(row.winner_team_id, 1);
  assert.equal(row.approved_at, null);
  assert.equal(row.live_score_a, null);
  assert.equal(row.live_score_b, null);
  assert.equal(row.game_clock_running, 0);
  assert.equal(row.game_clock_started_at, null);
  assert.ok(row.game_clock_remaining <= 588 && row.game_clock_remaining >= 586);
  assert.equal(row.shot_clock_running, 0);
  assert.equal(row.shot_clock_started_at, null);
  assert.ok(row.shot_clock_remaining <= 19 && row.shot_clock_remaining >= 17);

  const audit = h.db.prepare("SELECT details_json FROM audit_logs WHERE action = 'submit_result_pending_approval'").get();
  const details = JSON.parse(audit.details_json);
  assert.equal(details.score_a, 7);
  assert.equal(details.score_b, 5);
  assert.equal(details.winner_team_id, 1);
  assert.equal(details.submitted_role, 'scorer');
  assert.equal(details.approval_mode, 'pending_admin');
  assert.equal(details.pending_approval, true);
});

test('forfeit submission validates the team and keeps scorer approval pending', async (t) => {
  const invalid = createHarness();
  t.after(() => invalid.close());
  assert.equal((await invalid.request('POST', `/${invalid.gameId}/submit`, invalid.submitPayload({
    score_a: undefined,
    score_b: undefined,
    forfeit_team_id: '1',
  }), invalid.scorerToken)).status, 400);
  assert.equal((await invalid.request('POST', `/${invalid.gameId}/submit`, invalid.submitPayload({
    score_a: undefined,
    score_b: undefined,
    forfeit_team_id: 3,
  }), invalid.scorerToken)).status, 400);

  const accepted = createHarness();
  t.after(() => accepted.close());
  const response = await accepted.request('POST', `/${accepted.gameId}/submit`, accepted.submitPayload({
    score_a: undefined,
    score_b: undefined,
    forfeit_team_id: 1,
  }), accepted.scorerToken);
  assert.equal(response.status, 200);
  assert.equal(response.body.pendingApproval, true);
  assert.deepEqual(
    accepted.db.prepare('SELECT status, forfeit_team_id, winner_team_id, approved_at FROM games WHERE id = ?').get(accepted.gameId),
    { status: 'forfeited', forfeit_team_id: 1, winner_team_id: 2, approved_at: null },
  );
  assert.equal((await accepted.request('POST', `/${accepted.gameId}/approve`, undefined, accepted.adminToken)).status, 200);

  const legacyInvalid = createHarness();
  t.after(() => legacyInvalid.close());
  legacyInvalid.db.prepare(
    "UPDATE games SET status = 'forfeited', forfeit_team_id = 1, winner_team_id = 1, submitted_by = 1, submitted_at = datetime('now') WHERE id = ?"
  ).run(legacyInvalid.gameId);
  assert.equal((await legacyInvalid.request('POST', `/${legacyInvalid.gameId}/approve`, undefined, legacyInvalid.adminToken)).status, 400);
});

test('duplicate submission cannot overwrite the first accepted result', async (t) => {
  const h = createHarness();
  t.after(() => h.close());

  assert.equal((await h.request('POST', `/${h.gameId}/submit`, h.submitPayload(), h.scorerToken)).status, 200);
  const duplicate = await h.request('POST', `/${h.gameId}/submit`, h.submitPayload({ score_a: 9, score_b: 8 }), h.scorerToken);
  assert.equal(duplicate.status, 409);
  assert.deepEqual(
    h.db.prepare('SELECT score_a, score_b, winner_team_id FROM games WHERE id = ?').get(h.gameId),
    { score_a: 7, score_b: 5, winner_team_id: 1 },
  );
});

test('two concurrent submissions accept exactly one result', async (t) => {
  const h = createHarness();
  t.after(() => h.close());

  const responses = await Promise.all([
    h.request('POST', `/${h.gameId}/submit`, h.submitPayload({ score_a: 7, score_b: 5 }), h.scorerToken),
    h.request('POST', `/${h.gameId}/submit`, h.submitPayload({ score_a: 8, score_b: 5 }), h.scorerToken),
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  assert.equal(h.db.prepare(
    "SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'submit_result_pending_approval'"
  ).get().count, 1);
});

test('bracket conflict rolls back result, clocks, periods, and audit', async (t) => {
  const h = createHarness({ bracket: true });
  t.after(() => h.close());
  h.db.prepare('UPDATE games SET team_a_id = 2 WHERE id = ?').run(h.targetId);

  const response = await h.request('POST', `/${h.gameId}/submit`, h.submitPayload({
    periods: [{ team_a_score: 12, team_b_score: 10 }],
  }), h.adminToken);
  assert.equal(response.status, 500);
  const row = h.db.prepare(
    'SELECT status, score_a, score_b, game_clock_running, game_clock_started_at, shot_clock_running, shot_clock_started_at FROM games WHERE id = ?'
  ).get(h.gameId);
  assert.equal(row.status, 'ongoing');
  assert.equal(row.score_a, null);
  assert.equal(row.score_b, null);
  assert.equal(row.game_clock_running, 1);
  assert.ok(row.game_clock_started_at);
  assert.equal(row.shot_clock_running, 1);
  assert.ok(row.shot_clock_started_at);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS count FROM game_period_scores WHERE game_id = ?').get(h.gameId).count, 0);
  assert.equal(h.db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'submit_result_approved'").get().count, 0);
});

test('admin submission approves and advances a bracket winner exactly once', async (t) => {
  const h = createHarness({ bracket: true });
  t.after(() => h.close());

  const first = await h.request('POST', `/${h.gameId}/submit`, h.submitPayload(), h.adminToken);
  assert.equal(first.status, 200);
  assert.equal(first.body.pendingApproval, false);
  assert.ok(h.db.prepare('SELECT approved_at FROM games WHERE id = ?').get(h.gameId).approved_at);
  assert.equal(h.db.prepare('SELECT team_a_id FROM games WHERE id = ?').get(h.targetId).team_a_id, 1);

  assert.equal((await h.request('POST', `/${h.gameId}/submit`, h.submitPayload(), h.adminToken)).status, 409);
  assert.equal(h.db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'submit_result_approved'").get().count, 1);
});

test('approval and rejection only accept a pending unapproved result', async (t) => {
  const approved = createHarness({ bracket: true });
  t.after(() => approved.close());
  assert.equal((await approved.request('POST', `/${approved.gameId}/submit`, approved.submitPayload(), approved.scorerToken)).status, 200);
  assert.equal(approved.db.prepare('SELECT team_a_id FROM games WHERE id = ?').get(approved.targetId).team_a_id, null);
  assert.equal((await approved.request('POST', `/${approved.gameId}/approve`, undefined, approved.adminToken)).status, 200);
  assert.equal(approved.db.prepare('SELECT team_a_id FROM games WHERE id = ?').get(approved.targetId).team_a_id, 1);
  assert.equal((await approved.request('POST', `/${approved.gameId}/approve`, undefined, approved.adminToken)).status, 409);
  assert.equal((await approved.request('POST', `/${approved.gameId}/reject`, { reason: 'late' }, approved.adminToken)).status, 409);

  const rejected = createHarness();
  t.after(() => rejected.close());
  assert.equal((await rejected.request('POST', `/${rejected.gameId}/submit`, rejected.submitPayload({
    periods: [{ team_a_score: 7, team_b_score: 5 }],
  }), rejected.scorerToken)).status, 200);
  assert.equal((await rejected.request('POST', `/${rejected.gameId}/reject`, { reason: 'correct score' }, rejected.adminToken)).status, 200);
  const row = rejected.db.prepare(
    'SELECT status, game_clock_running, game_clock_started_at, shot_clock_running, shot_clock_started_at FROM games WHERE id = ?'
  ).get(rejected.gameId);
  assert.deepEqual(row, {
    status: 'ongoing',
    game_clock_running: 0,
    game_clock_started_at: null,
    shot_clock_running: 0,
    shot_clock_started_at: null,
  });
  assert.equal(rejected.db.prepare('SELECT COUNT(*) AS count FROM game_period_scores WHERE game_id = ?').get(rejected.gameId).count, 0);
  assert.equal((await rejected.request('POST', `/${rejected.gameId}/reject`, { reason: 'again' }, rejected.adminToken)).status, 409);
});

test('only admins can approve or reject a pending result', async (t) => {
  const h = createHarness();
  t.after(() => h.close());
  assert.equal((await h.request('POST', `/${h.gameId}/submit`, h.submitPayload(), h.scorerToken)).status, 200);

  assert.equal((await h.request('POST', `/${h.gameId}/approve`, undefined, h.scorerToken)).status, 403);
  assert.equal((await h.request('POST', `/${h.gameId}/reject`, { reason: 'unauthorized' }, h.scorerToken)).status, 403);
  assert.equal((await h.request('POST', `/${h.gameId}/approve`, undefined, tokenFor('viewer', 9))).status, 401);
  assert.equal((await h.request('POST', `/${h.gameId}/reject`, { reason: 'unauthorized' }, tokenFor('viewer', 9))).status, 401);

  const row = h.db.prepare('SELECT status, approved_at FROM games WHERE id = ?').get(h.gameId);
  assert.deepEqual(row, { status: 'completed', approved_at: null });
});
