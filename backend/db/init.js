const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const DB_PATH = process.env.BLM_DATABASE_PATH
  ? path.resolve(process.env.BLM_DATABASE_PATH)
  : path.join(__dirname, '..', 'database.sqlite');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

function addColumnIfMissing(db, table, columns, name, definition) {
  if (!columns.includes(name)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    columns.push(name);
  }
}

function migrateTournamentColumns(db) {
  const tournamentColumns = db.prepare("PRAGMA table_info(tournaments)").all().map((c) => c.name);
  addColumnIfMissing(db, 'tournaments', tournamentColumns, 'competition_format', 'TEXT');
  addColumnIfMissing(db, 'tournaments', tournamentColumns, 'division', 'TEXT');
  addColumnIfMissing(db, 'tournaments', tournamentColumns, 'sport_config_json', 'TEXT');
}

function migrateUserRoles(db) {
  const usersTable = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
  if (!usersTable || usersTable.sql.includes("'super_admin'")) return false;

  const foreignKeysWereEnabled = db.pragma('foreign_keys', { simple: true }) === 1;
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE users_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          session_version INTEGER NOT NULL DEFAULT 1,
          role TEXT NOT NULL CHECK (role IN ('super_admin', 'admin', 'scorer')),
          status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO users_new (id, username, password_hash, session_version, role, status, created_at, updated_at)
        SELECT id, username, password_hash, 1, role, status, created_at, updated_at FROM users;
        DROP TABLE users;
        ALTER TABLE users_new RENAME TO users;
      `);
      if (db.prepare('PRAGMA foreign_key_check').all().length > 0) {
        throw new Error('User-role migration created a foreign key violation.');
      }
    })();
  } finally {
    db.pragma(`foreign_keys = ${foreignKeysWereEnabled ? 'ON' : 'OFF'}`);
  }
  return true;
}

function migrateUserSessionVersion(db) {
  const columns = db.prepare("PRAGMA table_info(users)").all().map((column) => column.name);
  addColumnIfMissing(db, 'users', columns, 'session_version', 'INTEGER NOT NULL DEFAULT 1');
}

function createBootstrapSuperAdmin(db) {
  let username = 'super_admin';
  let suffix = 1;
  while (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
    username = `super_admin_${suffix}`;
    suffix += 1;
  }
  const password = crypto.randomBytes(18).toString('base64url');
  const passwordHash = bcrypt.hashSync(password, 10);
  const result = db.prepare(
    'INSERT INTO users (username, password_hash, role, status) VALUES (?, ?, ?, ?)'
  ).run(username, passwordHash, 'super_admin', 'active');
  console.log('----------------------------------------------------');
  console.log('Bootstrap super-admin account created:');
  console.log(`  username: ${username}`);
  console.log(`  temporary password: ${password}`);
  console.log('  Sign in and change this password immediately.');
  console.log('----------------------------------------------------');
  return Number(result.lastInsertRowid);
}

function ensureSuperAdmin(db) {
  if (db.prepare("SELECT id FROM users WHERE role = 'super_admin'").get()) return null;
  const activeAdmin = db.prepare(
    "SELECT id FROM users WHERE role = 'admin' AND status = 'active' ORDER BY id LIMIT 1"
  ).get();
  if (activeAdmin) {
    db.prepare("UPDATE users SET role = 'super_admin', updated_at = datetime('now') WHERE id = ?").run(activeAdmin.id);
    console.log(`Existing admin account ${activeAdmin.id} promoted to super_admin.`);
    return activeAdmin.id;
  }
  return createBootstrapSuperAdmin(db);
}

function migrateCompetitionEntryData(db) {
  const gameColumns = db.prepare("PRAGMA table_info(games)").all().map((c) => c.name);
  addColumnIfMissing(db, 'games', gameColumns, 'side_a_entry_id', 'INTEGER REFERENCES competition_entries(id) ON DELETE SET NULL');
  addColumnIfMissing(db, 'games', gameColumns, 'side_b_entry_id', 'INTEGER REFERENCES competition_entries(id) ON DELETE SET NULL');
  addColumnIfMissing(db, 'games', gameColumns, 'winner_entry_id', 'INTEGER REFERENCES competition_entries(id) ON DELETE SET NULL');
  addColumnIfMissing(db, 'games', gameColumns, 'forfeit_entry_id', 'INTEGER REFERENCES competition_entries(id) ON DELETE SET NULL');
  addColumnIfMissing(db, 'games', gameColumns, 'rules_snapshot_json', 'TEXT');

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_games_side_a_entry ON games(side_a_entry_id);
    CREATE INDEX IF NOT EXISTS idx_games_side_b_entry ON games(side_b_entry_id);

    CREATE TRIGGER IF NOT EXISTS trg_games_sync_team_entries_insert
    AFTER INSERT ON games
    BEGIN
      UPDATE games
      SET side_a_entry_id = COALESCE(
            NEW.side_a_entry_id,
            (SELECT id FROM competition_entries WHERE entry_type = 'team' AND team_id = NEW.team_a_id)
          ),
          side_b_entry_id = COALESCE(
            NEW.side_b_entry_id,
            (SELECT id FROM competition_entries WHERE entry_type = 'team' AND team_id = NEW.team_b_id)
          ),
          winner_entry_id = COALESCE(
            NEW.winner_entry_id,
            (SELECT id FROM competition_entries WHERE entry_type = 'team' AND team_id = NEW.winner_team_id)
          ),
          forfeit_entry_id = COALESCE(
            NEW.forfeit_entry_id,
            (SELECT id FROM competition_entries WHERE entry_type = 'team' AND team_id = NEW.forfeit_team_id)
          )
      WHERE id = NEW.id;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_games_sync_team_entries_update
    AFTER UPDATE OF team_a_id, team_b_id, winner_team_id, forfeit_team_id ON games
    BEGIN
      UPDATE games
      SET side_a_entry_id = CASE
            WHEN NEW.team_a_id IS NULL THEN NEW.side_a_entry_id
            ELSE (SELECT id FROM competition_entries WHERE entry_type = 'team' AND team_id = NEW.team_a_id)
          END,
          side_b_entry_id = CASE
            WHEN NEW.team_b_id IS NULL THEN NEW.side_b_entry_id
            ELSE (SELECT id FROM competition_entries WHERE entry_type = 'team' AND team_id = NEW.team_b_id)
          END,
          winner_entry_id = CASE
            WHEN NEW.winner_team_id IS NULL THEN NEW.winner_entry_id
            ELSE (SELECT id FROM competition_entries WHERE entry_type = 'team' AND team_id = NEW.winner_team_id)
          END,
          forfeit_entry_id = CASE
            WHEN NEW.forfeit_team_id IS NULL THEN NEW.forfeit_entry_id
            ELSE (SELECT id FROM competition_entries WHERE entry_type = 'team' AND team_id = NEW.forfeit_team_id)
          END
      WHERE id = NEW.id;
    END;
  `);

  const migrate = db.transaction(() => {
    db.prepare(
      `INSERT INTO competition_entries (
         tournament_id, entry_type, display_name, team_id, division, group_id,
         manual_rank_override, status
       )
       SELECT tm.tournament_id, 'team', tm.name, tm.id,
              COALESCE(NULLIF(TRIM(t.category), ''), 'Open'), tm.group_id,
              tm.manual_rank_override, tm.status
       FROM teams tm
       JOIN tournaments t ON t.id = tm.tournament_id
       WHERE NOT EXISTS (
         SELECT 1 FROM competition_entries ce
         WHERE ce.entry_type = 'team' AND ce.team_id = tm.id
       )`
    ).run();

    db.prepare(
      `UPDATE games SET side_a_entry_id = (
         SELECT ce.id FROM competition_entries ce
         WHERE ce.entry_type = 'team' AND ce.team_id = games.team_a_id
       ) WHERE team_a_id IS NOT NULL AND side_a_entry_id IS NULL`
    ).run();
    db.prepare(
      `UPDATE games SET side_b_entry_id = (
         SELECT ce.id FROM competition_entries ce
         WHERE ce.entry_type = 'team' AND ce.team_id = games.team_b_id
       ) WHERE team_b_id IS NOT NULL AND side_b_entry_id IS NULL`
    ).run();
    db.prepare(
      `UPDATE games SET winner_entry_id = (
         SELECT ce.id FROM competition_entries ce
         WHERE ce.entry_type = 'team' AND ce.team_id = games.winner_team_id
       ) WHERE winner_team_id IS NOT NULL AND winner_entry_id IS NULL`
    ).run();
    db.prepare(
      `UPDATE games SET forfeit_entry_id = (
         SELECT ce.id FROM competition_entries ce
         WHERE ce.entry_type = 'team' AND ce.team_id = games.forfeit_team_id
       ) WHERE forfeit_team_id IS NOT NULL AND forfeit_entry_id IS NULL`
    ).run();

    const validation = db.prepare(
      `SELECT
         (SELECT COUNT(*) FROM teams) AS team_count,
         (SELECT COUNT(*) FROM competition_entries WHERE entry_type = 'team') AS team_entry_count,
         (SELECT COUNT(*) FROM (
            SELECT team_id FROM competition_entries WHERE entry_type = 'team'
            GROUP BY team_id HAVING COUNT(*) > 1
          )) AS duplicate_team_entries,
         (SELECT COUNT(*) FROM competition_entries ce JOIN teams tm ON tm.id = ce.team_id
          WHERE ce.entry_type = 'team' AND ce.tournament_id != tm.tournament_id) AS tournament_mismatches,
         (SELECT COUNT(*) FROM games WHERE team_a_id IS NOT NULL AND side_a_entry_id IS NULL) +
         (SELECT COUNT(*) FROM games WHERE team_b_id IS NOT NULL AND side_b_entry_id IS NULL) +
         (SELECT COUNT(*) FROM games WHERE winner_team_id IS NOT NULL AND winner_entry_id IS NULL) +
         (SELECT COUNT(*) FROM games WHERE forfeit_team_id IS NOT NULL AND forfeit_entry_id IS NULL)
           AS unmapped_game_references`
    ).get();

    if (validation.team_count !== validation.team_entry_count ||
        validation.duplicate_team_entries !== 0 ||
        validation.tournament_mismatches !== 0 ||
        validation.unmapped_game_references !== 0) {
      throw new Error('Competition entry migration validation failed.');
    }
    if (db.prepare('PRAGMA foreign_key_check').all().length > 0) {
      throw new Error('Competition entry migration created a foreign key violation.');
    }
  });
  migrate();
}

function initDatabase() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(schema);

  migrateUserRoles(db);
  migrateUserSessionVersion(db);

  migrateTournamentColumns(db);

  // Forward-compatible migration for installs upgrading from an older copy
  // of the app: CREATE TABLE IF NOT EXISTS above won't add new columns to a
  // games table that already exists on disk, so add them here if missing.
  // This never touches existing data - it only adds nullable columns.
  const gameColumns = db.prepare("PRAGMA table_info(games)").all().map((c) => c.name);
  if (!gameColumns.includes('live_score_a')) {
    db.exec('ALTER TABLE games ADD COLUMN live_score_a INTEGER');
  }
  if (!gameColumns.includes('live_score_b')) {
    db.exec('ALTER TABLE games ADD COLUMN live_score_b INTEGER');
  }
  if (!gameColumns.includes('current_period')) {
    db.exec('ALTER TABLE games ADD COLUMN current_period INTEGER');
  }
  if (!gameColumns.includes('game_clock_remaining')) {
    db.exec('ALTER TABLE games ADD COLUMN game_clock_remaining INTEGER');
  }
  if (!gameColumns.includes('game_clock_running')) {
    db.exec('ALTER TABLE games ADD COLUMN game_clock_running INTEGER DEFAULT 0');
  }
  if (!gameColumns.includes('game_clock_started_at')) {
    db.exec('ALTER TABLE games ADD COLUMN game_clock_started_at TEXT');
  }
  if (!gameColumns.includes('shot_clock_remaining')) {
    db.exec('ALTER TABLE games ADD COLUMN shot_clock_remaining INTEGER');
  }
  if (!gameColumns.includes('shot_clock_running')) {
    db.exec('ALTER TABLE games ADD COLUMN shot_clock_running INTEGER DEFAULT 0');
  }
  if (!gameColumns.includes('shot_clock_started_at')) {
    db.exec('ALTER TABLE games ADD COLUMN shot_clock_started_at TEXT');
  }

  migrateCompetitionEntryData(db);

  ensureSuperAdmin(db);

  return db;
}

module.exports = {
  initDatabase,
  migrateCompetitionEntryData,
  migrateTournamentColumns,
  migrateUserRoles,
  migrateUserSessionVersion,
  ensureSuperAdmin,
  DB_PATH,
};
