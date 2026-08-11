-- Barangay League Manager - SQLite schema
-- Applied automatically on first run by db/init.js

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  session_version INTEGER NOT NULL DEFAULT 1,
  role TEXT NOT NULL CHECK (role IN ('super_admin', 'admin', 'scorer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tournaments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sport TEXT NOT NULL DEFAULT 'basketball',
  category TEXT,
  competition_format TEXT CHECK (competition_format IS NULL OR competition_format IN ('singles', 'doubles')),
  division TEXT CHECK (division IS NULL OR division IN ('men', 'women', 'mixed', 'open', 'custom')),
  sport_config_json TEXT,
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

CREATE TABLE IF NOT EXISTS stages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('group', 'playoff')),
  order_index INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS groups_table (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  stage_id INTEGER REFERENCES stages(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS teams (
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

CREATE TABLE IF NOT EXISTS players (
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

-- Reusable people who may compete without belonging to a team. This is kept
-- separate from players because player rows are tournament/team roster rows.
CREATE TABLE IF NOT EXISTS participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  display_name TEXT NOT NULL,
  affiliation TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  legacy_player_id INTEGER UNIQUE REFERENCES players(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS competition_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('team', 'individual', 'pair')),
  display_name TEXT,
  team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
  division TEXT NOT NULL,
  group_id INTEGER REFERENCES groups_table(id) ON DELETE SET NULL,
  seed_number INTEGER,
  manual_rank_override INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'withdrawn', 'disqualified')),
  withdrawal_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (
    (entry_type = 'team' AND team_id IS NOT NULL) OR
    (entry_type IN ('individual', 'pair') AND team_id IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS competition_entry_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  competition_entry_id INTEGER NOT NULL REFERENCES competition_entries(id) ON DELETE CASCADE,
  participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  member_order INTEGER NOT NULL CHECK (member_order IN (1, 2)),
  role TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (competition_entry_id, participant_id),
  UNIQUE (competition_entry_id, member_order)
);

-- score_a/score_b are the OFFICIAL result: only set on final submit, and only
-- count for standings once approved_at is set. live_score_a/live_score_b are
-- an unofficial, frequently-updated in-progress score the scorer can push
-- while a game is 'ongoing', shown on the public view with a "LIVE" badge.
-- They're cleared once a final score is submitted for that game.
CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  stage_id INTEGER REFERENCES stages(id) ON DELETE SET NULL,
  group_id INTEGER REFERENCES groups_table(id) ON DELETE SET NULL,
  round_label TEXT,
  bracket_slot TEXT,
  team_a_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  team_b_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  side_a_entry_id INTEGER REFERENCES competition_entries(id) ON DELETE SET NULL,
  side_b_entry_id INTEGER REFERENCES competition_entries(id) ON DELETE SET NULL,
  scheduled_at TEXT,
  venue TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'ongoing', 'completed', 'postponed', 'cancelled', 'forfeited')),
  score_a INTEGER,
  score_b INTEGER,
  live_score_a INTEGER,
  live_score_b INTEGER,
  -- Basketball clock/timer fields (nullable; only set for basketball games)
  current_period INTEGER,
  game_clock_remaining INTEGER,
  game_clock_running INTEGER DEFAULT 0,
  game_clock_started_at TEXT,
  shot_clock_remaining INTEGER,
  shot_clock_running INTEGER DEFAULT 0,
  shot_clock_started_at TEXT,
  forfeit_team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  forfeit_entry_id INTEGER REFERENCES competition_entries(id) ON DELETE SET NULL,
  remarks TEXT,
  winner_team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  winner_entry_id INTEGER REFERENCES competition_entries(id) ON DELETE SET NULL,
  rules_snapshot_json TEXT,
  feeds_game_id INTEGER REFERENCES games(id) ON DELETE SET NULL,
  feeds_slot TEXT,
  submitted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  submitted_at TEXT,
  approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS game_period_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  period_number INTEGER NOT NULL,
  team_a_score INTEGER NOT NULL DEFAULT 0,
  team_b_score INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pickleball_match_state (
  game_id INTEGER PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  current_game_number INTEGER NOT NULL DEFAULT 1,
  side_a_points INTEGER NOT NULL DEFAULT 0,
  side_b_points INTEGER NOT NULL DEFAULT 0,
  side_a_games_won INTEGER NOT NULL DEFAULT 0,
  side_b_games_won INTEGER NOT NULL DEFAULT 0,
  serving_entry_id INTEGER NOT NULL REFERENCES competition_entries(id) ON DELETE RESTRICT,
  server_number INTEGER,
  service_state_json TEXT,
  match_state TEXT NOT NULL DEFAULT 'in_progress' CHECK (match_state IN ('in_progress', 'between_games', 'ready_to_submit', 'pending_approval', 'approved')),
  version INTEGER NOT NULL DEFAULT 0,
  rules_snapshot_json TEXT NOT NULL,
  last_action_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS match_games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  sequence_number INTEGER NOT NULL,
  side_a_points INTEGER NOT NULL,
  side_b_points INTEGER NOT NULL,
  winner_entry_id INTEGER NOT NULL REFERENCES competition_entries(id) ON DELETE RESTRICT,
  completed_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (game_id, sequence_number)
);

CREATE TABLE IF NOT EXISTS match_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action_id TEXT NOT NULL UNIQUE,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL,
  expected_version INTEGER NOT NULL,
  resulting_version INTEGER NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS standings_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  group_id INTEGER REFERENCES groups_table(id) ON DELETE CASCADE,
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  data_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  details_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_teams_tournament ON teams(tournament_id);
CREATE INDEX IF NOT EXISTS idx_players_team ON players(team_id);
CREATE INDEX IF NOT EXISTS idx_participants_display_name ON participants(display_name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_participants_status ON participants(status);
CREATE INDEX IF NOT EXISTS idx_competition_entries_tournament ON competition_entries(tournament_id);
CREATE INDEX IF NOT EXISTS idx_competition_entries_status ON competition_entries(tournament_id, status);
CREATE INDEX IF NOT EXISTS idx_competition_entry_members_entry ON competition_entry_members(competition_entry_id);
CREATE INDEX IF NOT EXISTS idx_competition_entry_members_participant ON competition_entry_members(participant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_competition_entries_team_unique
  ON competition_entries(tournament_id, team_id) WHERE entry_type = 'team';
CREATE UNIQUE INDEX IF NOT EXISTS idx_competition_entries_active_seed_unique
  ON competition_entries(tournament_id, division, seed_number)
  WHERE seed_number IS NOT NULL AND status = 'active';
CREATE INDEX IF NOT EXISTS idx_games_tournament ON games(tournament_id);
CREATE INDEX IF NOT EXISTS idx_games_status ON games(status);
CREATE INDEX IF NOT EXISTS idx_games_scheduled ON games(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_match_games_game ON match_games(game_id, sequence_number);
CREATE INDEX IF NOT EXISTS idx_match_actions_game ON match_actions(game_id, created_at);

-- Keep the additive generic layer synchronized for legacy team workflows.
CREATE TRIGGER IF NOT EXISTS trg_teams_create_competition_entry
AFTER INSERT ON teams
BEGIN
  INSERT OR IGNORE INTO competition_entries (
    tournament_id, entry_type, display_name, team_id, division, group_id,
    manual_rank_override, status
  )
  SELECT NEW.tournament_id, 'team', NEW.name, NEW.id,
         COALESCE(NULLIF(TRIM(t.category), ''), 'Open'), NEW.group_id,
         NEW.manual_rank_override, NEW.status
  FROM tournaments t WHERE t.id = NEW.tournament_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_teams_update_competition_entry
AFTER UPDATE OF name, group_id, manual_rank_override, status ON teams
BEGIN
  UPDATE competition_entries
  SET display_name = NEW.name,
      group_id = NEW.group_id,
      manual_rank_override = NEW.manual_rank_override,
      status = NEW.status,
      withdrawal_reason = CASE WHEN NEW.status = 'active' THEN NULL ELSE withdrawal_reason END,
      updated_at = datetime('now')
  WHERE entry_type = 'team' AND team_id = NEW.id;
END;
