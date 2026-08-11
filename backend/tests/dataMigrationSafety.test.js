const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');

const legacySchema = `
PRAGMA foreign_keys = ON;
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'scorer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE tournaments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sport TEXT NOT NULL DEFAULT 'basketball',
  category TEXT,
  format TEXT NOT NULL CHECK (format IN ('round_robin', 'groups_playoffs', 'single_elimination')),
  venue TEXT,
  start_date TEXT,
  end_date TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'completed', 'archived')),
  rules TEXT,
  points_config_json TEXT NOT NULL DEFAULT '{"win":2,"loss":1,"forfeitWinner":2,"forfeitLoser":0}',
  tiebreaker_config_json TEXT NOT NULL DEFAULT '["wins","points","head_to_head","point_diff","points_scored","manual"]',
  groups_count INTEGER NOT NULL DEFAULT 2,
  advancing_per_group INTEGER NOT NULL DEFAULT 2,
  third_place_game INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE stages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('group', 'playoff')),
  order_index INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE groups_table (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  stage_id INTEGER REFERENCES stages(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  group_id INTEGER REFERENCES groups_table(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  purok TEXT,
  coach_name TEXT,
  contact_number TEXT,
  uniform_color TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'withdrawn', 'disqualified')),
  notes TEXT,
  manual_rank_override INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  jersey_number TEXT,
  age INTEGER,
  category TEXT,
  eligibility_note TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'disqualified')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  stage_id INTEGER REFERENCES stages(id) ON DELETE SET NULL,
  group_id INTEGER REFERENCES groups_table(id) ON DELETE SET NULL,
  round_label TEXT,
  bracket_slot TEXT,
  team_a_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  team_b_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  scheduled_at TEXT,
  venue TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'ongoing', 'completed', 'postponed', 'cancelled', 'forfeited')),
  score_a INTEGER,
  score_b INTEGER,
  forfeit_team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  remarks TEXT,
  winner_team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  feeds_game_id INTEGER REFERENCES games(id) ON DELETE SET NULL,
  feeds_slot TEXT,
  submitted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  submitted_at TEXT,
  approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE game_period_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  period_number INTEGER NOT NULL,
  team_a_score INTEGER NOT NULL DEFAULT 0,
  team_b_score INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE standings_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  group_id INTEGER REFERENCES groups_table(id) ON DELETE CASCADE,
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  data_json TEXT NOT NULL
);
CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  details_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

function runStartupMigration(databasePath) {
  return spawnSync(process.execPath, ['-e', "const db=require('./db/init').initDatabase();db.close();"], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    env: { ...process.env, BLM_DATABASE_PATH: databasePath },
  });
}

test('file-based pre-entry schema migrates completely and remains idempotent after restart', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blm-pre-entry-migration-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const databasePath = path.join(root, 'legacy.sqlite');
  const legacy = new Database(databasePath);
  legacy.exec(legacySchema);
  legacy.prepare("INSERT INTO users (id, username, password_hash, role) VALUES (7, 'legacy-admin', 'hash', 'admin')").run();
  legacy.prepare("INSERT INTO tournaments (id, name, sport, category, format, status) VALUES (10, 'Legacy League', 'basketball', 'Open', 'round_robin', 'active')").run();
  legacy.prepare("INSERT INTO teams (id, tournament_id, name) VALUES (100, 10, 'Legacy A')").run();
  legacy.prepare("INSERT INTO teams (id, tournament_id, name) VALUES (101, 10, 'Legacy B')").run();
  legacy.prepare(
    "INSERT INTO games (id, tournament_id, team_a_id, team_b_id, status, score_a, score_b, winner_team_id, submitted_by, approved_by) VALUES (200, 10, 100, 101, 'completed', 82, 77, 100, 7, 7)"
  ).run();
  legacy.prepare("INSERT INTO audit_logs (user_id, action) VALUES (7, 'legacy-proof')").run();
  legacy.close();

  const first = runStartupMigration(databasePath);
  assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);

  let migrated = new Database(databasePath, { readonly: true });
  const firstEntries = migrated.prepare("SELECT id, team_id, display_name FROM competition_entries WHERE tournament_id = 10 ORDER BY team_id").all();
  assert.deepEqual(firstEntries.map((entry) => entry.team_id), [100, 101]);
  assert.deepEqual(firstEntries.map((entry) => entry.display_name), ['Legacy A', 'Legacy B']);
  const migratedGame = migrated.prepare(
    'SELECT score_a, score_b, side_a_entry_id, side_b_entry_id, winner_entry_id FROM games WHERE id = 200'
  ).get();
  assert.deepEqual([migratedGame.score_a, migratedGame.score_b], [82, 77]);
  assert.equal(migratedGame.side_a_entry_id, firstEntries[0].id);
  assert.equal(migratedGame.side_b_entry_id, firstEntries[1].id);
  assert.equal(migratedGame.winner_entry_id, firstEntries[0].id);
  assert.equal(migrated.prepare('SELECT role, session_version FROM users WHERE id = 7').get().role, 'super_admin');
  assert.equal(migrated.prepare("SELECT user_id FROM audit_logs WHERE action = 'legacy-proof'").get().user_id, 7);
  migrated.close();

  const second = runStartupMigration(databasePath);
  assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`);

  migrated = new Database(databasePath, { readonly: true });
  assert.equal(migrated.prepare('SELECT COUNT(*) AS count FROM competition_entries WHERE tournament_id = 10').get().count, 2);
  assert.equal(migrated.prepare('SELECT COUNT(DISTINCT team_id) AS count FROM competition_entries WHERE tournament_id = 10').get().count, 2);
  const columns = migrated.prepare('PRAGMA table_info(games)').all().map((column) => column.name);
  for (const required of ['side_a_entry_id', 'side_b_entry_id', 'winner_entry_id', 'forfeit_entry_id', 'rules_snapshot_json']) {
    assert.ok(columns.includes(required), required);
  }
  const indexes = new Set(migrated.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((row) => row.name));
  for (const required of [
    'idx_competition_entries_tournament',
    'idx_competition_entry_members_entry',
    'idx_games_side_a_entry',
    'idx_games_side_b_entry',
    'idx_match_actions_game',
  ]) assert.ok(indexes.has(required), required);
  assert.equal(migrated.pragma('integrity_check', { simple: true }), 'ok');
  assert.equal(migrated.prepare('PRAGMA foreign_key_check').all().length, 0);
  migrated.close();
});
