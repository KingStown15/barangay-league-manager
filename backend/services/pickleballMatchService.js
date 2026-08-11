const { applyPickleballAction } = require('./pickleballRules');

function matchError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function loadGame(db, gameId) {
  return db.prepare(
    `SELECT g.*, t.sport, t.sport_config_json
     FROM games g JOIN tournaments t ON t.id = g.tournament_id
     WHERE g.id = ?`
  ).get(gameId);
}

function parseRules(row) {
  try {
    return JSON.parse(row.rules_snapshot_json);
  } catch {
    throw matchError(500, 'Pickleball rules snapshot is invalid.');
  }
}

function rowToState(row, game) {
  return {
    current_game_number: row.current_game_number,
    side_a_points: row.side_a_points,
    side_b_points: row.side_b_points,
    side_a_games_won: row.side_a_games_won,
    side_b_games_won: row.side_b_games_won,
    serving_side: row.serving_entry_id === game.side_a_entry_id ? 'A' : 'B',
    server_number: row.server_number,
    match_state: row.match_state,
  };
}

function initializePickleballMatch(db, gameId) {
  const game = loadGame(db, gameId);
  if (!game) throw matchError(404, 'Game not found.');
  if (game.sport !== 'pickleball') return null;
  if (!game.side_a_entry_id || !game.side_b_entry_id) throw matchError(400, 'Both Pickleball entries are required.');
  const existing = db.prepare('SELECT * FROM pickleball_match_state WHERE game_id = ?').get(gameId);
  if (existing) return existing;
  const rulesSnapshot = game.rules_snapshot_json || game.sport_config_json;
  if (!rulesSnapshot) throw matchError(400, 'Pickleball rules snapshot is missing.');
  let rules;
  try { rules = JSON.parse(rulesSnapshot); } catch { throw matchError(400, 'Pickleball rules snapshot is invalid.'); }
  const serverNumber = rules.competition_format === 'doubles' && rules.track_server_number ? 2 : null;
  db.prepare(
    `INSERT INTO pickleball_match_state (
       game_id, serving_entry_id, server_number, service_state_json, rules_snapshot_json
     ) VALUES (?, ?, ?, ?, ?)`
  ).run(
    gameId,
    game.side_a_entry_id,
    serverNumber,
    JSON.stringify({ serving_side: 'A', server_number: serverNumber }),
    rulesSnapshot,
  );
  return db.prepare('SELECT * FROM pickleball_match_state WHERE game_id = ?').get(gameId);
}

function serializePickleballMatch(db, gameId) {
  const game = loadGame(db, gameId);
  if (!game) throw matchError(404, 'Game not found.');
  if (game.sport !== 'pickleball') throw matchError(400, 'This is not a Pickleball match.');
  const row = db.prepare('SELECT * FROM pickleball_match_state WHERE game_id = ?').get(gameId);
  if (!row) return { state: null, completed_games: [] };
  const completedGames = db.prepare(
    `SELECT mg.*,
            CASE WHEN mg.winner_entry_id = ? THEN 'A' ELSE 'B' END AS winner_side
     FROM match_games mg WHERE mg.game_id = ? ORDER BY mg.sequence_number`
  ).all(game.side_a_entry_id, gameId);
  return {
    state: {
      ...rowToState(row, game),
      version: row.version,
      rules: parseRules(row),
      can_undo: Boolean(row.last_action_json),
    },
    completed_games: completedGames,
  };
}

function applyMatchAction(db, gameId, { actionId, expectedVersion, action, payload, actorId, actorRole }) {
  if (typeof actionId !== 'string' || !actionId.trim() || actionId.length > 100) {
    throw matchError(400, 'A valid action_id is required.');
  }
  const normalizedActionId = actionId.trim();
  if (typeof expectedVersion !== 'number' || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
    throw matchError(400, 'expected_version must be a non-negative whole number.');
  }

  const run = db.transaction(() => {
    const duplicate = db.prepare('SELECT game_id FROM match_actions WHERE action_id = ?').get(normalizedActionId);
    if (duplicate) {
      if (Number(duplicate.game_id) !== Number(gameId)) throw matchError(409, 'Action ID was already used for another match.');
      return { duplicate: true };
    }
    const game = loadGame(db, gameId);
    if (!game) throw matchError(404, 'Game not found.');
    if (game.sport !== 'pickleball') throw matchError(400, 'Pickleball actions are only available for Pickleball matches.');
    if (game.status !== 'ongoing') throw matchError(409, 'Only an ongoing Pickleball match can be scored.');
    const inactive = db.prepare(
      `SELECT ce.id FROM competition_entries ce
       WHERE ce.id IN (?, ?) AND ce.status != 'active' LIMIT 1`
    ).get(game.side_a_entry_id, game.side_b_entry_id);
    if (inactive) throw matchError(409, 'A withdrawn or disqualified entry cannot be scored.');

    const row = db.prepare('SELECT * FROM pickleball_match_state WHERE game_id = ?').get(gameId);
    if (!row) throw matchError(409, 'Start the Pickleball match before scoring.');
    if (row.version !== expectedVersion) throw matchError(409, 'Match state changed in another session. Reload before scoring.');
    const current = rowToState(row, game);
    const rules = parseRules(row);
    let next;
    let completedGame = null;
    let completedSequenceToDelete = null;

    if (action === 'undo') {
      if (!row.last_action_json) throw matchError(409, 'No scoring action is available to undo.');
      let undo;
      try { undo = JSON.parse(row.last_action_json); } catch { throw matchError(500, 'Undo snapshot is invalid.'); }
      next = undo.state;
      completedSequenceToDelete = undo.completed_game_sequence || null;
      if (completedSequenceToDelete) {
        db.prepare('DELETE FROM match_games WHERE game_id = ? AND sequence_number = ?').run(gameId, completedSequenceToDelete);
      }
    } else {
      const result = applyPickleballAction(current, rules, action, payload || {}, actorRole);
      next = result.state;
      completedGame = result.completedGame;
      if (completedGame) {
        const winnerEntryId = completedGame.winner_side === 'A' ? game.side_a_entry_id : game.side_b_entry_id;
        db.prepare(
          `INSERT INTO match_games (game_id, sequence_number, side_a_points, side_b_points, winner_entry_id)
           VALUES (?, ?, ?, ?, ?)`
        ).run(gameId, completedGame.sequence_number, completedGame.side_a_points, completedGame.side_b_points, winnerEntryId);
      }
    }

    const servingEntryId = next.serving_side === 'A' ? game.side_a_entry_id : game.side_b_entry_id;
    const lastAction = action === 'undo' ? null : JSON.stringify({
      state: current,
      completed_game_sequence: completedGame?.sequence_number || null,
    });
    const update = db.prepare(
      `UPDATE pickleball_match_state SET
         current_game_number = ?, side_a_points = ?, side_b_points = ?,
         side_a_games_won = ?, side_b_games_won = ?, serving_entry_id = ?, server_number = ?,
         service_state_json = ?, match_state = ?, version = version + 1,
         last_action_json = ?, updated_at = datetime('now')
       WHERE game_id = ? AND version = ?`
    ).run(
      next.current_game_number, next.side_a_points, next.side_b_points,
      next.side_a_games_won, next.side_b_games_won, servingEntryId, next.server_number,
      JSON.stringify({ serving_side: next.serving_side, server_number: next.server_number }),
      next.match_state, lastAction, gameId, expectedVersion,
    );
    if (update.changes !== 1) throw matchError(409, 'Match state changed in another session. Reload before scoring.');
    db.prepare(
      `INSERT INTO match_actions (action_id, game_id, actor_id, action_type, expected_version, resulting_version, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(normalizedActionId, gameId, actorId, action, expectedVersion, expectedVersion + 1, payload ? JSON.stringify(payload) : null);
    return { duplicate: false };
  });

  const result = run();
  return { ...serializePickleballMatch(db, gameId), duplicate: result.duplicate };
}

module.exports = {
  applyMatchAction,
  initializePickleballMatch,
  loadGame,
  serializePickleballMatch,
};
