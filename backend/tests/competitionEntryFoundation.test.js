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
const gameRoutes = require('../routes/games');
const participantRoutes = require('../routes/participants');
const { serializePublicEntry } = require('../services/competitionEntryService');

const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');

function tokenFor(role, id = role === 'admin' ? 1 : 2) {
  return jwt.sign({ id, username: role, role, sessionVersion: 1 }, JWT_SECRET, { expiresIn: '1h' });
}

function createDatabase() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(schema);
  migrateCompetitionEntryData(db);
  db.prepare("INSERT INTO users (id, username, password_hash, role, status) VALUES (1, 'admin', 'x', 'admin', 'active')").run();
  db.prepare("INSERT INTO users (id, username, password_hash, role, status) VALUES (2, 'scorer', 'x', 'scorer', 'active')").run();
  db.prepare("INSERT INTO tournaments (id, name, sport, category, format, status) VALUES (1, 'QA', 'basketball', 'Open', 'round_robin', 'active')").run();
  return db;
}

function createHarness() {
  const db = createDatabase();
  const app = express();
  app.use(express.json());
  app.use('/api/participants', participantRoutes(db));
  app.use('/api/tournaments', competitionEntryRoutes(db));
  app.use('/api/games', gameRoutes(db));
  app.use((error, req, res, next) => res.status(500).json({ error: error.message }));
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

async function createParticipant(h, displayName, affiliation = null) {
  const response = await h.request('POST', '/participants', { display_name: displayName, affiliation });
  assert.equal(response.status, 201, response.body?.error);
  return response.body.participant;
}

async function createEntry(h, body) {
  return h.request('POST', '/tournaments/1/entries', body);
}

test('migration backfills teams and games exactly once', () => {
  const db = createDatabase();
  try {
    db.prepare("INSERT INTO teams (id, tournament_id, name, purok) VALUES (10, 1, 'Legacy A', 'Purok 1')").run();
    db.prepare("INSERT INTO teams (id, tournament_id, name, purok) VALUES (11, 1, 'Legacy B', 'Purok 2')").run();
    db.prepare("INSERT INTO games (id, tournament_id, team_a_id, team_b_id, status, winner_team_id) VALUES (20, 1, 10, 11, 'completed', 10)").run();

    // Recreate a pre-backfill state while preserving the upgraded schema.
    db.prepare('UPDATE games SET side_a_entry_id = NULL, side_b_entry_id = NULL, winner_entry_id = NULL').run();
    db.prepare('DELETE FROM competition_entries').run();

    migrateCompetitionEntryData(db);
    const first = db.prepare("SELECT COUNT(*) AS count FROM competition_entries WHERE entry_type = 'team'").get().count;
    const game = db.prepare('SELECT side_a_entry_id, side_b_entry_id, winner_entry_id FROM games WHERE id = 20').get();
    assert.ok(game.side_a_entry_id);
    assert.ok(game.side_b_entry_id);
    assert.equal(game.winner_entry_id, game.side_a_entry_id);

    migrateCompetitionEntryData(db);
    const second = db.prepare("SELECT COUNT(*) AS count FROM competition_entries WHERE entry_type = 'team'").get().count;
    assert.equal(first, 2);
    assert.equal(second, first);
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  } finally {
    db.close();
  }
});

test('legacy team inserts and games dual-write generic entries', () => {
  const db = createDatabase();
  try {
    const teamA = Number(db.prepare("INSERT INTO teams (tournament_id, name) VALUES (1, 'Team A')").run().lastInsertRowid);
    const teamB = Number(db.prepare("INSERT INTO teams (tournament_id, name) VALUES (1, 'Team B')").run().lastInsertRowid);
    const entries = db.prepare("SELECT id, team_id FROM competition_entries WHERE entry_type = 'team' ORDER BY team_id").all();
    assert.deepEqual(entries.map((entry) => entry.team_id), [teamA, teamB]);

    const gameId = Number(db.prepare(
      "INSERT INTO games (tournament_id, team_a_id, team_b_id, status) VALUES (1, ?, ?, 'scheduled')"
    ).run(teamA, teamB).lastInsertRowid);
    const game = db.prepare('SELECT * FROM games WHERE id = ?').get(gameId);
    assert.equal(game.side_a_entry_id, entries[0].id);
    assert.equal(game.side_b_entry_id, entries[1].id);

    db.prepare("UPDATE teams SET name = 'Renamed A', status = 'withdrawn', group_id = NULL WHERE id = ?").run(teamA);
    const updated = db.prepare('SELECT display_name, status FROM competition_entries WHERE team_id = ?').get(teamA);
    assert.deepEqual(updated, { display_name: 'Renamed A', status: 'withdrawn' });
  } finally {
    db.close();
  }
});

test('participant API is authenticated, admin-written, searchable, and updateable', async (t) => {
  const h = createHarness();
  t.after(() => h.close());

  assert.equal((await h.request('GET', '/participants', undefined, null)).status, 401);
  assert.equal((await h.request('POST', '/participants', { display_name: 'Blocked' }, tokenFor('scorer'))).status, 403);
  const ana = await createParticipant(h, 'Ana Santos', 'Purok 1');
  const found = await h.request('GET', '/participants?search=ana', undefined, tokenFor('scorer'));
  assert.equal(found.status, 200);
  assert.equal(found.body.participants.length, 1);
  assert.equal(found.body.participants[0].display_name, 'Ana Santos');

  const updated = await h.request('PUT', `/participants/${ana.id}`, { affiliation: 'Purok 2', status: 'inactive' });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.participant.affiliation, 'Purok 2');
  assert.equal(updated.body.participant.status, 'inactive');
});

test('entry creation enforces team, individual, and pair invariants', async (t) => {
  const h = createHarness();
  t.after(() => h.close());
  const [a, b, c] = await Promise.all([
    createParticipant(h, 'Alpha'),
    createParticipant(h, 'Bravo'),
    createParticipant(h, 'Charlie'),
  ]);

  assert.equal((await createEntry(h, { entry_type: 'individual', participant_ids: [], division: 'Open' })).status, 400);
  assert.equal((await createEntry(h, { entry_type: 'pair', participant_ids: [a.id, a.id], division: 'Open' })).status, 400);
  assert.equal((await createEntry(h, { entry_type: 'team', team_id: 999, division: 'Open' })).status, 400);

  const individual = await createEntry(h, { entry_type: 'individual', participant_ids: [a.id], division: 'Open' });
  assert.equal(individual.status, 201);
  assert.equal(individual.body.entry.members.length, 1);
  assert.equal(individual.body.entry.team_id, null);
  assert.equal((await createEntry(h, { entry_type: 'individual', participant_ids: [a.id], division: 'Open' })).status, 409);

  const pair = await createEntry(h, { entry_type: 'pair', participant_ids: [c.id, b.id], division: 'Open' });
  assert.equal(pair.status, 201);
  assert.deepEqual(pair.body.entry.members.map((member) => member.participant_id), [b.id, c.id]);
  assert.equal(pair.body.entry.display_name, 'Bravo / Charlie');
  assert.equal((await createEntry(h, { entry_type: 'pair', participant_ids: [b.id, c.id], division: 'Open' })).status, 409);
});

test('generic games resolve active entries and reject withdrawn or cross-tournament sides', async (t) => {
  const h = createHarness();
  t.after(() => h.close());
  const a = await createParticipant(h, 'Singles A');
  const b = await createParticipant(h, 'Singles B');
  const entryA = (await createEntry(h, { entry_type: 'individual', participant_ids: [a.id], division: 'Open' })).body.entry;
  const entryB = (await createEntry(h, { entry_type: 'individual', participant_ids: [b.id], division: 'Open' })).body.entry;

  const game = await h.request('POST', '/games', {
    tournament_id: 1,
    side_a_entry_id: entryA.id,
    side_b_entry_id: entryB.id,
    scheduled_at: '2026-07-14T09:00',
  });
  assert.equal(game.status, 201, game.body?.error);
  assert.equal(game.body.game.team_a_id, null);
  assert.equal(game.body.game.side_a.display_name, 'Singles A');
  assert.equal(game.body.game.side_b.display_name, 'Singles B');
  assert.equal((await h.request('POST', '/games', {
    tournament_id: 1,
    side_a_entry_id: entryA.id,
    side_b_entry_id: entryA.id,
  })).status, 400);

  const c = await createParticipant(h, 'Pair C');
  const d = await createParticipant(h, 'Pair D');
  const pair = (await createEntry(h, { entry_type: 'pair', participant_ids: [c.id, d.id], division: 'Open' })).body.entry;
  assert.equal((await h.request('POST', '/games', {
    tournament_id: 1,
    side_a_entry_id: entryA.id,
    side_b_entry_id: pair.id,
  })).status, 400);

  const e = await createParticipant(h, 'Other Division');
  const otherDivision = (await createEntry(h, { entry_type: 'individual', participant_ids: [e.id], division: 'Women' })).body.entry;
  assert.equal((await h.request('POST', '/games', {
    tournament_id: 1,
    side_a_entry_id: entryA.id,
    side_b_entry_id: otherDivision.id,
  })).status, 400);

  assert.equal((await h.request('PUT', `/participants/${a.id}`, { status: 'inactive' })).status, 200);
  assert.equal((await h.request('POST', '/games', {
    tournament_id: 1,
    side_a_entry_id: entryA.id,
    side_b_entry_id: entryB.id,
  })).status, 409);
  assert.equal((await h.request('PUT', `/participants/${a.id}`, { status: 'active' })).status, 200);

  const withdrawn = await h.request('POST', `/tournaments/1/entries/${entryB.id}/withdraw`, { reason: 'Unavailable' });
  assert.equal(withdrawn.status, 200);
  assert.equal((await h.request('POST', '/games', {
    tournament_id: 1,
    side_a_entry_id: entryA.id,
    side_b_entry_id: entryB.id,
  })).status, 409);

  h.db.prepare("INSERT INTO tournaments (id, name, sport, format, status) VALUES (2, 'Other', 'basketball', 'round_robin', 'active')").run();
  const cross = await h.request('POST', '/games', {
    tournament_id: 2,
    side_a_entry_id: entryA.id,
    side_b_entry_id: entryB.id,
  });
  assert.equal(cross.status, 400);
});

test('team game API remains backward compatible and public serializer is allowlisted', async (t) => {
  const h = createHarness();
  t.after(() => h.close());
  const teamA = Number(h.db.prepare("INSERT INTO teams (tournament_id, name) VALUES (1, 'Legacy A')").run().lastInsertRowid);
  const teamB = Number(h.db.prepare("INSERT INTO teams (tournament_id, name) VALUES (1, 'Legacy B')").run().lastInsertRowid);
  const game = await h.request('POST', '/games', { tournament_id: 1, team_a_id: teamA, team_b_id: teamB });
  assert.equal(game.status, 201, game.body?.error);
  assert.equal(game.body.game.team_a_name, 'Legacy A');
  assert.equal(game.body.game.team_b_name, 'Legacy B');
  assert.equal(game.body.game.side_a.entry_type, 'team');
  assert.equal(game.body.game.side_a.team_id, teamA);

  const teamC = Number(h.db.prepare("INSERT INTO teams (tournament_id, name) VALUES (1, 'Legacy C')").run().lastInsertRowid);
  const resultGame = await h.request('POST', '/games', {
    tournament_id: 1,
    team_a_id: teamA,
    team_b_id: teamC,
    scheduled_at: '2026-07-14T10:00',
  });
  h.db.prepare("UPDATE games SET status = 'ongoing', live_score_a = 8, live_score_b = 5 WHERE id = ?").run(resultGame.body.game.id);
  const submitted = await h.request('POST', `/games/${resultGame.body.game.id}/submit`, {
    score_a: 8,
    score_b: 5,
    expected_live_score_a: 8,
    expected_live_score_b: 5,
  });
  assert.equal(submitted.status, 200, submitted.body?.error);
  assert.equal(submitted.body.game.winner_entry_id, submitted.body.game.side_a_entry_id);

  const teamD = Number(h.db.prepare("INSERT INTO teams (tournament_id, name) VALUES (1, 'Legacy D')").run().lastInsertRowid);
  const changed = await h.request('PUT', `/games/${game.body.game.id}`, { team_a_id: teamD });
  assert.equal(changed.status, 200, changed.body?.error);
  assert.equal(changed.body.game.team_a_id, teamD);
  assert.equal(changed.body.game.side_a.team_id, teamD);
  const cleared = await h.request('PUT', `/games/${game.body.game.id}`, { team_a_id: null });
  assert.equal(cleared.status, 200, cleared.body?.error);
  assert.equal(cleared.body.game.team_a_id, null);
  assert.equal(cleared.body.game.side_a, null);

  const safe = serializePublicEntry({
    id: 9,
    entry_type: 'individual',
    display_name: 'Public Name',
    division: 'Open',
    affiliation: 'Purok 1',
    contact_number: 'private',
    address: 'private',
    birthday: 'private',
    resident_id: 44,
    private_notes: 'private',
    members: [{ display_name: 'Public Name', affiliation: 'Purok 1', member_order: 1, age: 22, eligibility_note: 'private' }],
  });
  assert.deepEqual(Object.keys(safe).sort(), ['affiliation', 'display_name', 'division', 'entry_type', 'id', 'members']);
  assert.deepEqual(Object.keys(safe.members[0]).sort(), ['affiliation', 'display_name', 'member_order']);
});
