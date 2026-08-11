const express = require('express');
const { requireAuthFor, requireRole, isAdminRole } = require('../middleware/auth');
const { logAction } = require('../utils/audit');
const sse = require('../live/sseHub');
const {
  GAME_ENTRY_JOINS,
  GAME_ENTRY_SELECT,
  resolveGameSidesForWrite,
  serializeGameEntries,
  serializeGamesWithEntries,
} = require('../services/entryResolver');
const { initializePickleballMatch, serializePickleballMatch } = require('../services/pickleballMatchService');
const {
  getSetTarget,
  getSetWinner,
  getVolleyballRules,
  getVolleyballState,
  initializeVolleyballMatch,
  validateVolleyballPeriods,
} = require('../services/volleyballMatchService');

const GAME_SELECT = `
  SELECT g.*, t.sport, t.competition_format, t.division AS tournament_division,
         ta.name AS team_a_name, tb.name AS team_b_name, gt.name AS group_name
  ${GAME_ENTRY_SELECT}
  FROM games g
  LEFT JOIN teams ta ON ta.id = g.team_a_id
  LEFT JOIN teams tb ON tb.id = g.team_b_id
  LEFT JOIN groups_table gt ON gt.id = g.group_id
  ${GAME_ENTRY_JOINS}
  JOIN tournaments t ON t.id = g.tournament_id
`;

const MAX_FINAL_SCORE = 999;

function findDuplicateNonBracketMatchup(db, tournamentId, sides, excludeGameId = null) {
  const hasEntrySides = sides.side_a_entry_id && sides.side_b_entry_id;
  const hasTeamSides = sides.team_a_id && sides.team_b_id;
  if (!hasEntrySides && !hasTeamSides) return null;
  return db.prepare(
    `SELECT id, status FROM games
     WHERE tournament_id = ? AND bracket_slot IS NULL
       AND (((? = 1) AND ((side_a_entry_id = ? AND side_b_entry_id = ?)
         OR (side_a_entry_id = ? AND side_b_entry_id = ?)))
       OR ((? = 1) AND ((team_a_id = ? AND team_b_id = ?)
         OR (team_a_id = ? AND team_b_id = ?))))
       AND (? IS NULL OR id != ?)
     ORDER BY id LIMIT 1`
  ).get(
    tournamentId,
    hasEntrySides ? 1 : 0,
    sides.side_a_entry_id, sides.side_b_entry_id,
    sides.side_b_entry_id, sides.side_a_entry_id,
    hasTeamSides ? 1 : 0,
    sides.team_a_id, sides.team_b_id,
    sides.team_b_id, sides.team_a_id,
    excludeGameId, excludeGameId,
  );
}

function isStrictScore(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_FINAL_SCORE;
}

function validateFinalScoreForSport(sport, scoreA, scoreB, roundLabel) {
  if (!isStrictScore(scoreA) || !isStrictScore(scoreB)) {
    return `Scores must be whole numbers between 0 and ${MAX_FINAL_SCORE}.`;
  }
  if (scoreA === scoreB) {
    return sport === 'basketball'
      ? 'Basketball final scores cannot be tied. Complete overtime before submitting.'
      : 'Volleyball final set scores cannot be tied.';
  }
  if (sport === 'volleyball') {
    const rules = getVolleyballRules(roundLabel);
    const winnerSets = Math.max(scoreA, scoreB);
    const loserSets = Math.min(scoreA, scoreB);
    if (winnerSets !== rules.sets_to_win || loserSets >= rules.sets_to_win) {
      return rules.sets_to_win === 3
        ? 'Championship volleyball results must be first-to-3 sets (3-0, 3-1, or 3-2).'
        : 'Preliminary and knockout volleyball results must be first-to-2 sets (2-0 or 2-1).';
    }
  } else if (sport !== 'basketball') {
    return 'Unsupported sport for final score submission.';
  }
  return null;
}

function normalizePeriods(periods) {
  if (periods === undefined) return { periods: null };
  if (!Array.isArray(periods) || periods.length > 20) {
    return { error: 'Periods must be an array with no more than 20 entries.' };
  }
  const normalized = [];
  for (const period of periods) {
    const scoreA = period?.team_a_score;
    const scoreB = period?.team_b_score;
    if (!isStrictScore(scoreA) || !isStrictScore(scoreB)) {
      return { error: `Period scores must be whole numbers between 0 and ${MAX_FINAL_SCORE}.` };
    }
    normalized.push({ team_a_score: scoreA, team_b_score: scoreB });
  }
  return { periods: normalized };
}

function isPendingResult(game) {
  return ['completed', 'forfeited'].includes(game?.status) && game.submitted_at && !game.approved_at;
}

/**
 * Given a game object with raw clock fields, compute effective remaining
 * time based on the running flag and started_at timestamp. Runs on every
 * read so the frontend always gets fresh values.
 */
function computeEffectiveClockValues(game) {
  const nowMs = Date.now();
  if (game.game_clock_running && game.game_clock_started_at && game.game_clock_remaining !== null) {
    const startedAtMs = new Date(game.game_clock_started_at).getTime();
    const elapsed = Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
    game.game_clock_remaining = Math.max(0, game.game_clock_remaining - elapsed);
    // The remaining value is now a current snapshot. Rebase its timestamp to
    // the same whole-second boundary so clients do not subtract elapsed time
    // from the original start twice after a refresh or fresh login.
    game.game_clock_started_at = new Date(startedAtMs + (elapsed * 1000)).toISOString();
  }
  if (game.shot_clock_running && game.shot_clock_started_at && game.shot_clock_remaining !== null) {
    const startedAtMs = new Date(game.shot_clock_started_at).getTime();
    const elapsed = Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
    game.shot_clock_remaining = Math.max(0, game.shot_clock_remaining - elapsed);
    game.shot_clock_started_at = new Date(startedAtMs + (elapsed * 1000)).toISOString();
  }
  return game;
}

/**
 * Initialize default basketball clock values for a game if they are null.
 * Safe to call on any game — only basketball games with null clock fields
 * will be affected.
 */
function initBasketballClock(db, gameId) {
  const game = db.prepare('SELECT g.*, t.sport FROM games g JOIN tournaments t ON t.id = g.tournament_id WHERE g.id = ?').get(gameId);
  if (!game || game.sport !== 'basketball') return;
  if (game.current_period !== null) return;
  db.prepare(
    `UPDATE games SET
       current_period = 1,
       game_clock_remaining = 600,
       game_clock_running = 0,
       game_clock_started_at = NULL,
       shot_clock_remaining = 24,
       shot_clock_running = 0,
       shot_clock_started_at = NULL
     WHERE id = ?`
  ).run(gameId);
}

function advanceBracketWinner(db, game, winnerTeamId, winnerEntryId = null) {
  const generic = game.sport === 'pickleball';
  const winnerId = generic ? winnerEntryId : winnerTeamId;
  if (!winnerId || !game.feeds_game_id) return;

  const target = db.prepare('SELECT team_a_id, team_b_id, side_a_entry_id, side_b_entry_id, round_label FROM games WHERE id = ?').get(game.feeds_game_id);
  if (!target) throw new Error('Target bracket game not found.');

  const slotValue = generic
    ? (game.feeds_slot === 'A' ? target.side_a_entry_id : target.side_b_entry_id)
    : (game.feeds_slot === 'A' ? target.team_a_id : target.team_b_id);
  if (slotValue !== null && slotValue !== winnerId) {
    throw new Error('Advancement conflict: slot already has a different competitor.');
  }

  if (slotValue !== winnerId) {
    const column = generic
      ? (game.feeds_slot === 'A' ? 'side_a_entry_id' : 'side_b_entry_id')
      : (game.feeds_slot === 'A' ? 'team_a_id' : 'team_b_id');
    db.prepare(`UPDATE games SET ${column} = ? WHERE id = ?`).run(winnerId, game.feeds_game_id);
  }

  if (target.round_label === 'Final') {
    const sideAId = generic ? game.side_a_entry_id : game.team_a_id;
    const sideBId = generic ? game.side_b_entry_id : game.team_b_id;
    const loserId = winnerId === sideAId ? sideBId : sideAId;
    if (loserId) {
      const thirdPlace = db.prepare('SELECT id, team_a_id, team_b_id, side_a_entry_id, side_b_entry_id FROM games WHERE tournament_id = ? AND bracket_slot = ?').get(game.tournament_id, '3RD');
      if (thirdPlace) {
        const tpColumn = generic
          ? (game.feeds_slot === 'A' ? 'side_a_entry_id' : 'side_b_entry_id')
          : (game.feeds_slot === 'A' ? 'team_a_id' : 'team_b_id');
        const tpSlotValue = thirdPlace[tpColumn];
        if (tpSlotValue !== null && tpSlotValue !== loserId) {
          throw new Error('Third-place slot already has a different competitor.');
        }
        if (tpSlotValue !== loserId) {
          db.prepare(`UPDATE games SET ${tpColumn} = ? WHERE id = ?`).run(loserId, thirdPlace.id);
        }
      }
    }
  }
}

module.exports = function gameRoutes(db) {
  const router = express.Router();
  const requireAuth = requireAuthFor(db);

  router.get('/', requireAuth, (req, res) => {
    const { tournament_id, status, date } = req.query;
    if (!tournament_id) return res.status(400).json({ error: 'tournament_id is required.' });

    let query = GAME_SELECT + ' WHERE g.tournament_id = ?';
    const params = [tournament_id];
    if (status) {
      query += ' AND g.status = ?';
      params.push(status);
    }
    if (date) {
      query += " AND date(g.scheduled_at) = date(?)";
      params.push(date);
    }
    query += ' ORDER BY g.scheduled_at IS NULL, g.scheduled_at, g.id';

    const games = db.prepare(query).all(...params);
    games.forEach(computeEffectiveClockValues);
    res.json({ games: serializeGamesWithEntries(db, games) });
  });

  router.get('/:id', requireAuth, (req, res) => {
    const game = db.prepare(GAME_SELECT + ' WHERE g.id = ?').get(req.params.id);
    if (!game) return res.status(404).json({ error: 'Game not found.' });
    computeEffectiveClockValues(game);
    const periods = db.prepare('SELECT * FROM game_period_scores WHERE game_id = ? ORDER BY period_number').all(req.params.id);
    let pickleball = null;
    if (game.sport === 'pickleball') pickleball = serializePickleballMatch(db, req.params.id);
    res.json({ game: serializeGamesWithEntries(db, [game])[0], periods, pickleball });
  });

  // Admin: create a manual game (used when the schedule needs a one-off entry)
  router.post('/', requireAuth, requireRole('admin'), (req, res) => {
    const {
      tournament_id, group_id, team_a_id, team_b_id, side_a_entry_id, side_b_entry_id,
      scheduled_at, venue, round_label, remarks,
    } = req.body || {};
    if (!tournament_id) return res.status(400).json({ error: 'Tournament is required.' });
    let sides;
    try {
      sides = resolveGameSidesForWrite(db, {
        tournamentId: tournament_id,
        sideAEntryId: side_a_entry_id,
        sideBEntryId: side_b_entry_id,
        teamAId: team_a_id,
        teamBId: team_b_id,
      });
    } catch (error) {
      return res.status(error.status || 400).json({ error: error.message });
    }
    const duplicate = findDuplicateNonBracketMatchup(db, tournament_id, sides);
    if (duplicate) {
      return res.status(409).json({
        error: `This matchup already exists as game ${duplicate.id}. Edit the existing game instead.`,
      });
    }
    const result = db.prepare(
      `INSERT INTO games (
         tournament_id, group_id, team_a_id, team_b_id, side_a_entry_id, side_b_entry_id,
         scheduled_at, venue, round_label, remarks, status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled')`
    ).run(
      tournament_id, group_id || null, sides.team_a_id, sides.team_b_id,
      sides.side_a_entry_id, sides.side_b_entry_id,
      scheduled_at || null, venue || null, round_label || null, remarks || null,
    );
    logAction(db, { userId: req.user.id, action: 'create_game', entityType: 'game', entityId: result.lastInsertRowid });
    const game = db.prepare(GAME_SELECT + ' WHERE g.id = ?').get(result.lastInsertRowid);
    res.status(201).json({ game: serializeGamesWithEntries(db, [game])[0] });
  });

  // Admin: edit schedule details (date, venue, teams) - not the score itself
  router.put('/:id', requireAuth, requireRole('admin'), (req, res) => {
    const existing = db.prepare('SELECT * FROM games WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Game not found.' });

    const sideFieldsPresent = ['team_a_id', 'team_b_id', 'side_a_entry_id', 'side_b_entry_id']
      .some((field) => req.body[field] !== undefined);
    const updates = [];
    const params = [];
    if (sideFieldsPresent) {
      const resolveInput = (side) => {
        const entryField = `side_${side}_entry_id`;
        const teamField = `team_${side}_id`;
        const hasEntry = req.body[entryField] !== undefined;
        const hasTeam = req.body[teamField] !== undefined;
        if (hasEntry) {
          return { entryId: req.body[entryField], teamId: hasTeam ? req.body[teamField] : null };
        }
        if (hasTeam) {
          return { entryId: null, teamId: req.body[teamField] };
        }
        return { entryId: existing[entryField], teamId: existing[teamField] };
      };
      const sideAInput = resolveInput('a');
      const sideBInput = resolveInput('b');
      let sides;
      try {
        sides = resolveGameSidesForWrite(db, {
          tournamentId: existing.tournament_id,
          sideAEntryId: sideAInput.entryId,
          sideBEntryId: sideBInput.entryId,
          teamAId: sideAInput.teamId,
          teamBId: sideBInput.teamId,
          requireBoth: false,
        });
      } catch (error) {
        return res.status(error.status || 400).json({ error: error.message });
      }
      const duplicate = findDuplicateNonBracketMatchup(db, existing.tournament_id, sides, existing.id);
      if (duplicate) {
        return res.status(409).json({
          error: `This matchup already exists as game ${duplicate.id}. Edit the existing game instead.`,
        });
      }
      ['team_a_id', 'team_b_id', 'side_a_entry_id', 'side_b_entry_id'].forEach((field) => {
        updates.push(`${field} = ?`);
        params.push(sides[field]);
      });
    }
    ['scheduled_at', 'venue', 'round_label', 'remarks'].forEach((f) => {
      if (req.body[f] !== undefined) {
        updates.push(`${f} = ?`);
        params.push(req.body[f]);
      }
    });
    if (updates.length === 0) {
      const unchanged = db.prepare(GAME_SELECT + ' WHERE g.id = ?').get(req.params.id);
      return res.json({ game: serializeGameEntries(unchanged) });
    }
    params.push(req.params.id);
    db.prepare(`UPDATE games SET ${updates.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...params);
    logAction(db, { userId: req.user.id, action: 'update_game', entityType: 'game', entityId: req.params.id });
    const game = db.prepare(GAME_SELECT + ' WHERE g.id = ?').get(req.params.id);
    res.json({ game: serializeGameEntries(game) });
  });

  router.delete('/:id', requireAuth, requireRole('admin'), (req, res) => {
    const existing = db.prepare('SELECT * FROM games WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Game not found.' });
    db.prepare('DELETE FROM games WHERE id = ?').run(req.params.id);
    logAction(db, { userId: req.user.id, action: 'delete_game', entityType: 'game', entityId: req.params.id });
    res.json({ ok: true });
  });

  // Scorer or Admin: update live status (e.g. mark ongoing) and periods, without finalizing
  router.patch('/:id/status', requireAuth, requireRole('admin', 'scorer'), (req, res) => {
    const game = db.prepare(
      'SELECT g.*, t.sport FROM games g JOIN tournaments t ON t.id = g.tournament_id WHERE g.id = ?'
    ).get(req.params.id);
    if (!game) return res.status(404).json({ error: 'Game not found.' });
    const { status, remarks } = req.body || {};
    const allowed = ['scheduled', 'ongoing', 'postponed', 'cancelled'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${allowed.join(', ')}. Use /submit for final results.` });
    }
    const VALID_TRANSITIONS = {
      scheduled: ['ongoing', 'postponed', 'cancelled'],
      ongoing: ['postponed', 'cancelled'],
      postponed: ['scheduled'],
      cancelled: ['scheduled'],
    };
    const allowedFrom = VALID_TRANSITIONS[game.status];
    if (!allowedFrom || !allowedFrom.includes(status)) {
      return res.status(400).json({ error: `Cannot transition from '${game.status}' to '${status}'.` });
    }
    if (status === 'ongoing') {
      const hasSides = game.sport === 'pickleball'
        ? game.side_a_entry_id && game.side_b_entry_id
        : game.team_a_id && game.team_b_id;
      if (!hasSides) {
        return res.status(400).json({ error: 'Cannot start game because the matchup is not set yet.' });
      }
      if (!game.scheduled_at) {
        return res.status(400).json({ error: 'Cannot start game because schedule date/time is missing.' });
      }
    }
    const resetLiveScore = status === 'ongoing';
    const runStatusTx = db.transaction(() => {
      db.prepare(
        `UPDATE games SET status = ?, remarks = COALESCE(?, remarks),
         live_score_a = CASE WHEN ? THEN 0 ELSE live_score_a END,
         live_score_b = CASE WHEN ? THEN 0 ELSE live_score_b END,
         updated_at = datetime('now') WHERE id = ?`
      ).run(status, remarks ?? null, resetLiveScore ? 1 : 0, resetLiveScore ? 1 : 0, req.params.id);
      if (status === 'ongoing') {
        if (game.sport === 'pickleball') initializePickleballMatch(db, req.params.id);
        else initBasketballClock(db, req.params.id);
      }
    });
    runStatusTx();
    logAction(db, { userId: req.user.id, action: 'update_game_status', entityType: 'game', entityId: req.params.id, details: { status } });
    let updated = db.prepare(GAME_SELECT + ' WHERE g.id = ?').get(req.params.id);
    if (status === 'ongoing' && updated.sport === 'volleyball') {
      initializeVolleyballMatch(db, updated);
      updated = db.prepare(GAME_SELECT + ' WHERE g.id = ?').get(req.params.id);
    }
    if (game.tournament_id) {
      sse.broadcast(game.tournament_id, {
        type: status === 'ongoing' ? 'game_started' : 'game_status_changed',
        game_id: req.params.id,
        tournament_id: game.tournament_id,
        status,
      });
    }
    res.json({ game: serializeGamesWithEntries(db, [updated])[0] });
  });

  router.patch('/:id/volleyball-score', requireAuth, requireRole('admin', 'scorer'), (req, res) => {
    const game = db.prepare(GAME_SELECT + ' WHERE g.id = ?').get(req.params.id);
    if (!game) return res.status(404).json({ error: 'Game not found.' });
    if (game.sport !== 'volleyball') return res.status(400).json({ error: 'Volleyball scoring is only available for volleyball games.' });
    if (game.status !== 'ongoing') return res.status(409).json({ error: 'The volleyball game is not ongoing.' });
    const { action, side, expected } = req.body || {};
    if (!['add_point', 'subtract_point', 'confirm_set', 'undo_last_set'].includes(action)) {
      return res.status(400).json({ error: 'Unsupported volleyball scoring action.' });
    }
    if (['add_point', 'subtract_point'].includes(action) && !['A', 'B'].includes(side)) {
      return res.status(400).json({ error: 'Scoring side must be A or B.' });
    }
    if (!expected || ![expected.sets_won_a, expected.sets_won_b, expected.current_set_number,
      expected.current_score_a, expected.current_score_b].every(Number.isSafeInteger)) {
      return res.status(400).json({ error: 'Expected volleyball state is required. Reload and try again.' });
    }

    try {
      const updateState = db.transaction(() => {
        const fresh = db.prepare(GAME_SELECT + ' WHERE g.id = ?').get(req.params.id);
        const state = initializeVolleyballMatch(db, fresh);
        const current = state.current_set;
        const stateMatches = state.sets_won_a === expected.sets_won_a
          && state.sets_won_b === expected.sets_won_b
          && (current?.set_number ?? state.completed_sets.length) === expected.current_set_number
          && (current?.team_a_score ?? 0) === expected.current_score_a
          && (current?.team_b_score ?? 0) === expected.current_score_b;
        if (!stateMatches) {
          const conflict = new Error('The volleyball score changed in another session. Reload and review.');
          conflict.status = 409;
          throw conflict;
        }

        if (action === 'add_point' || action === 'subtract_point') {
          if (!current) throw Object.assign(new Error('The match is ready for final submission.'), { status: 409 });
          if (action === 'add_point' && current.winner) {
            throw Object.assign(new Error('Confirm the completed set before adding more points.'), { status: 409 });
          }
          const column = side === 'A' ? 'team_a_score' : 'team_b_score';
          const currentValue = side === 'A' ? current.team_a_score : current.team_b_score;
          const nextValue = action === 'add_point' ? currentValue + 1 : Math.max(0, currentValue - 1);
          db.prepare(`UPDATE game_period_scores SET ${column} = ? WHERE game_id = ? AND period_number = ?`)
            .run(nextValue, fresh.id, current.set_number);
        } else if (action === 'confirm_set') {
          if (!current?.winner) throw Object.assign(new Error('The current set has not been won yet.'), { status: 400 });
          const nextA = state.sets_won_a + (current.winner === 'A' ? 1 : 0);
          const nextB = state.sets_won_b + (current.winner === 'B' ? 1 : 0);
          db.prepare("UPDATE games SET live_score_a = ?, live_score_b = ?, updated_at = datetime('now') WHERE id = ?")
            .run(nextA, nextB, fresh.id);
          const rules = getVolleyballRules(fresh.round_label);
          if (Math.max(nextA, nextB) < rules.sets_to_win) {
            db.prepare('INSERT INTO game_period_scores (game_id, period_number, team_a_score, team_b_score) VALUES (?, ?, 0, 0)')
              .run(fresh.id, current.set_number + 1);
          }
        } else {
          if ((current && (current.team_a_score !== 0 || current.team_b_score !== 0)) || state.completed_sets.length === 0) {
            throw Object.assign(new Error('Undo the current points before reopening the previous set.'), { status: 400 });
          }
          if (current) {
            db.prepare('DELETE FROM game_period_scores WHERE game_id = ? AND period_number = ?').run(fresh.id, current.set_number);
          }
          const previous = state.completed_sets[state.completed_sets.length - 1];
          const previousTarget = getSetTarget(previous.set_number, state.rules);
          const winner = getSetWinner(previous.team_a_score, previous.team_b_score, previousTarget);
          db.prepare("UPDATE games SET live_score_a = ?, live_score_b = ?, updated_at = datetime('now') WHERE id = ?")
            .run(state.sets_won_a - (winner === 'A' ? 1 : 0), state.sets_won_b - (winner === 'B' ? 1 : 0), fresh.id);
        }
        const updated = db.prepare(GAME_SELECT + ' WHERE g.id = ?').get(req.params.id);
        return { game: updated, state: getVolleyballState(db, updated) };
      })();

      sse.broadcast(game.tournament_id, {
        type: 'volleyball_state_update',
        game_id: game.id,
        tournament_id: game.tournament_id,
        state: updateState.state,
        score_a: updateState.state.sets_won_a,
        score_b: updateState.state.sets_won_b,
        status: 'ongoing',
        updated_at: new Date().toISOString(),
      });
      res.json({ game: { ...serializeGamesWithEntries(db, [updateState.game])[0], volleyball: updateState.state } });
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  // Scorer or Admin: push an in-progress, unofficial score while a game is
  // live. This never touches standings on its own - it's purely for the
  // public "LIVE" display until the real result is submitted via /submit.
  // Deliberately not audit-logged since it can fire many times per game.
  router.patch('/:id/live-score', requireAuth, requireRole('admin', 'scorer'), (req, res) => {
    const game = db.prepare('SELECT g.*, t.sport FROM games g JOIN tournaments t ON t.id = g.tournament_id WHERE g.id = ?').get(req.params.id);
    if (!game) return res.status(404).json({ error: 'Game not found.' });
    if (game.status !== 'ongoing') {
      return res.status(400).json({ error: 'Mark the game ongoing before pushing a live score.' });
    }
    if (game.sport !== 'basketball') {
      return res.status(400).json({ error: 'Basketball live scoring is only available for basketball games.' });
    }
    const {
      live_score_a,
      live_score_b,
      expected_live_score_a,
      expected_live_score_b,
    } = req.body || {};
    if (live_score_a === undefined || live_score_b === undefined) {
      return res.status(400).json({ error: 'Both live_score_a and live_score_b are required.' });
    }
    if (expected_live_score_a === undefined || expected_live_score_b === undefined) {
      return res.status(400).json({ error: 'Expected live scores are required. Reload and try again.' });
    }
    const scoreA = Number(live_score_a);
    const scoreB = Number(live_score_b);
    const expectedScoreA = Number(expected_live_score_a);
    const expectedScoreB = Number(expected_live_score_b);
    if (![scoreA, scoreB, expectedScoreA, expectedScoreB]
      .every((value) => Number.isSafeInteger(value) && value >= 0 && value <= 999)) {
      return res.status(400).json({ error: 'Scores must be non-negative whole numbers.' });
    }
    const changed = db.prepare(
      `UPDATE games
       SET live_score_a = ?, live_score_b = ?, updated_at = datetime('now')
       WHERE id = ? AND status = 'ongoing' AND live_score_a = ? AND live_score_b = ?`
    ).run(scoreA, scoreB, req.params.id, expectedScoreA, expectedScoreB);
    if (changed.changes !== 1) {
      return res.status(409).json({ error: 'The live score changed in another session. Reload and review.' });
    }
    const updated = db.prepare(GAME_SELECT + ' WHERE g.id = ?').get(req.params.id);
    if (game.tournament_id) {
      sse.broadcast(game.tournament_id, {
        type: 'score_update',
        game_id: req.params.id,
        tournament_id: game.tournament_id,
        score_a: scoreA,
        score_b: scoreB,
        status: 'ongoing',
        updated_at: new Date().toISOString(),
      });
    }
    res.json({ game: serializeGameEntries(updated) });
  });

  // Scorer or Admin: basketball clock controls (game clock + shot clock).
  // Only available for basketball games that are not completed/forfeited.
  router.patch('/:id/clock', requireAuth, requireRole('admin', 'scorer'), (req, res) => {
    const game = db.prepare('SELECT g.*, t.sport FROM games g JOIN tournaments t ON t.id = g.tournament_id WHERE g.id = ?').get(req.params.id);
    if (!game) return res.status(404).json({ error: 'Game not found.' });

    if (game.sport !== 'basketball') {
      return res.status(400).json({ error: 'Clock controls are only available for basketball games.' });
    }

    if (['completed', 'forfeited'].includes(game.status)) {
      return res.status(400).json({ error: 'Cannot modify clock on a completed or forfeited game.' });
    }

    const { action, seconds } = req.body || {};
    const VALID_ACTIONS = [
      'start_game_clock', 'pause_game_clock', 'reset_game_clock', 'set_game_clock',
      'next_period',
      'start_shot_clock', 'pause_shot_clock', 'reset_shot_clock',
    ];
    if (!VALID_ACTIONS.includes(action)) {
      return res.status(400).json({ error: `Invalid action. Must be one of: ${VALID_ACTIONS.join(', ')}` });
    }

    if (action === 'set_game_clock') {
      if (seconds === undefined || seconds === null) {
        return res.status(400).json({ error: 'seconds is required for set_game_clock.' });
      }
      const sec = Number(seconds);
      if (!Number.isInteger(sec) || sec < 0 || sec > 3600) {
        return res.status(400).json({ error: 'seconds must be an integer between 0 and 3600.' });
      }
    }

    if (action === 'next_period' && game.current_period !== null && game.current_period >= 4) {
      return res.status(400).json({ error: 'Game is already in Q4. OT not yet supported.' });
    }

    const runTx = db.transaction(() => {
      initBasketballClock(db, req.params.id);

      const fresh = db.prepare('SELECT * FROM games WHERE id = ?').get(req.params.id);
      const nowIso = new Date().toISOString();
      computeEffectiveClockValues(fresh);

      if (action === 'start_game_clock') {
        db.prepare(
          `UPDATE games
           SET game_clock_remaining = ?, game_clock_running = 1, game_clock_started_at = ?, updated_at = datetime('now')
           WHERE id = ?`
        ).run(fresh.game_clock_remaining, nowIso, req.params.id);
        return db.prepare('SELECT * FROM games WHERE id = ?').get(req.params.id);

      } else if (action === 'pause_game_clock') {
        db.prepare(
          `UPDATE games SET game_clock_remaining = ?, game_clock_running = 0, game_clock_started_at = NULL, updated_at = datetime('now') WHERE id = ?`
        ).run(fresh.game_clock_remaining, req.params.id);
        return db.prepare('SELECT * FROM games WHERE id = ?').get(req.params.id);

      } else if (action === 'reset_game_clock') {
        db.prepare(
          `UPDATE games SET game_clock_remaining = 600, game_clock_running = 0, game_clock_started_at = NULL, updated_at = datetime('now') WHERE id = ?`
        ).run(req.params.id);
        return db.prepare('SELECT * FROM games WHERE id = ?').get(req.params.id);

      } else if (action === 'set_game_clock') {
        db.prepare(
          `UPDATE games SET game_clock_remaining = ?, game_clock_running = 0, game_clock_started_at = NULL, updated_at = datetime('now') WHERE id = ?`
        ).run(seconds, req.params.id);
        return db.prepare('SELECT * FROM games WHERE id = ?').get(req.params.id);

      } else if (action === 'next_period') {
        db.prepare(
          `UPDATE games SET
             current_period = current_period + 1,
             game_clock_remaining = 600,
             game_clock_running = 0,
             game_clock_started_at = NULL,
             shot_clock_remaining = 24,
             shot_clock_running = 0,
             shot_clock_started_at = NULL,
             updated_at = datetime('now')
           WHERE id = ?`
        ).run(req.params.id);
        return db.prepare('SELECT * FROM games WHERE id = ?').get(req.params.id);

      } else if (action === 'start_shot_clock') {
        db.prepare(
          `UPDATE games
           SET shot_clock_remaining = ?, shot_clock_running = 1, shot_clock_started_at = ?, updated_at = datetime('now')
           WHERE id = ?`
        ).run(fresh.shot_clock_remaining, nowIso, req.params.id);
        return db.prepare('SELECT * FROM games WHERE id = ?').get(req.params.id);

      } else if (action === 'pause_shot_clock') {
        db.prepare(
          `UPDATE games SET shot_clock_remaining = ?, shot_clock_running = 0, shot_clock_started_at = NULL, updated_at = datetime('now') WHERE id = ?`
        ).run(fresh.shot_clock_remaining, req.params.id);
        return db.prepare('SELECT * FROM games WHERE id = ?').get(req.params.id);

      } else if (action === 'reset_shot_clock') {
        db.prepare(
          `UPDATE games SET shot_clock_remaining = 24, shot_clock_running = 0, shot_clock_started_at = NULL, updated_at = datetime('now') WHERE id = ?`
        ).run(req.params.id);
        return db.prepare('SELECT * FROM games WHERE id = ?').get(req.params.id);
      }
    });

    let updated;
    try {
      updated = runTx();
    } catch (txErr) {
      return res.status(500).json({ error: txErr.message });
    }

    const result = db.prepare(GAME_SELECT + ' WHERE g.id = ?').get(req.params.id);

    logAction(db, { userId: req.user.id, action: 'clock_action', entityType: 'game', entityId: req.params.id, details: { action, current_period: updated.current_period, game_clock_remaining: updated.game_clock_remaining, shot_clock_remaining: updated.shot_clock_remaining } });

    if (game.tournament_id) {
      sse.broadcast(game.tournament_id, {
        type: 'clock_update',
        game_id: req.params.id,
        tournament_id: game.tournament_id,
        current_period: updated.current_period,
        game_clock_remaining: updated.game_clock_remaining,
        game_clock_running: updated.game_clock_running,
        game_clock_started_at: updated.game_clock_started_at,
        shot_clock_remaining: updated.shot_clock_remaining,
        shot_clock_running: updated.shot_clock_running,
        shot_clock_started_at: updated.shot_clock_started_at,
      });
    }

    res.json({ game: serializeGameEntries(result) });
  });

  // Scorer or Admin: submit a final score. Scorer submissions await admin approval;
  // admin submissions are auto-approved so results go live immediately.
  router.post('/:id/submit', requireAuth, requireRole('admin', 'scorer'), (req, res) => {
    const game = db.prepare(
      'SELECT g.*, t.sport FROM games g JOIN tournaments t ON t.id = g.tournament_id WHERE g.id = ?'
    ).get(req.params.id);
    if (!game) return res.status(404).json({ error: 'Game not found.' });

    if (game.status !== 'ongoing') {
      return res.status(409).json({ error: `This game is already '${game.status}'. Reload before submitting.` });
    }
    const isPickleball = game.sport === 'pickleball';
    if (isPickleball ? (!game.side_a_entry_id || !game.side_b_entry_id) : (!game.team_a_id || !game.team_b_id)) {
      return res.status(400).json({ error: `Both ${isPickleball ? 'entries' : 'teams'} are required before submitting a final result.` });
    }

    const body = req.body || {};
    const {
      score_a, score_b, forfeit_team_id, remarks, periods,
      expected_live_score_a, expected_live_score_b, expected_match_version,
    } = body;

    if (!isPickleball && (!Object.prototype.hasOwnProperty.call(body, 'expected_live_score_a') ||
        !Object.prototype.hasOwnProperty.call(body, 'expected_live_score_b'))) {
      return res.status(400).json({ error: 'Expected live scores are required. Reload the game and try again.' });
    }
    const expectedValuesValid = isPickleball || [expected_live_score_a, expected_live_score_b]
      .every((value) => value === null || isStrictScore(value));
    if (!expectedValuesValid) {
      return res.status(400).json({ error: 'Expected live scores are invalid.' });
    }
    if (!isPickleball && (game.live_score_a !== expected_live_score_a || game.live_score_b !== expected_live_score_b)) {
      return res.status(409).json({ error: 'The live score changed in another session. Reload and review before submitting.' });
    }

    const normalizedPeriods = isPickleball ? { periods: null } : normalizePeriods(periods);
    if (normalizedPeriods.error) return res.status(400).json({ error: normalizedPeriods.error });

    let status, winnerTeamId = null, winnerEntryId = null, forfeitTeamId = null;
    let finalScoreA = null;
    let finalScoreB = null;
    if (isPickleball) {
      if (forfeit_team_id !== undefined && forfeit_team_id !== null) {
        return res.status(400).json({ error: 'Pickleball forfeits are not available in this scorer phase.' });
      }
      if (typeof expected_match_version !== 'number' || !Number.isSafeInteger(expected_match_version) || expected_match_version < 0) {
        return res.status(400).json({ error: 'expected_match_version is required.' });
      }
      const match = db.prepare('SELECT * FROM pickleball_match_state WHERE game_id = ?').get(req.params.id);
      if (!match || match.version !== expected_match_version) {
        return res.status(409).json({ error: 'The Pickleball match changed in another session. Reload and review before submitting.' });
      }
      if (match.match_state !== 'ready_to_submit') {
        return res.status(409).json({ error: 'The Pickleball match is not ready for final submission.' });
      }
      let matchRules;
      try {
        matchRules = JSON.parse(match.rules_snapshot_json);
      } catch {
        return res.status(500).json({ error: 'Pickleball rules snapshot is invalid.' });
      }
      finalScoreA = match.side_a_games_won;
      finalScoreB = match.side_b_games_won;
      if (finalScoreA === finalScoreB || Math.max(finalScoreA, finalScoreB) < matchRules.games_to_win) {
        return res.status(400).json({ error: 'Pickleball match state does not contain a valid winner.' });
      }
      status = 'completed';
      winnerEntryId = finalScoreA > finalScoreB ? game.side_a_entry_id : game.side_b_entry_id;
    } else if (forfeit_team_id !== undefined && forfeit_team_id !== null) {
      if (typeof forfeit_team_id !== 'number' || !Number.isSafeInteger(forfeit_team_id)) {
        return res.status(400).json({ error: 'Forfeiting team is invalid.' });
      }
      if (![game.team_a_id, game.team_b_id].includes(forfeit_team_id)) {
        return res.status(400).json({ error: 'Forfeiting team must be one of the two scheduled teams.' });
      }
      status = 'forfeited';
      forfeitTeamId = forfeit_team_id;
      winnerTeamId = forfeit_team_id === game.team_a_id ? game.team_b_id : game.team_a_id;
    } else {
      if (score_a === undefined || score_b === undefined || score_a === null || score_b === null) {
        return res.status(400).json({ error: 'Both team scores are required to submit a result.' });
      }
      const validationError = validateFinalScoreForSport(game.sport, score_a, score_b, game.round_label);
      if (validationError) return res.status(400).json({ error: validationError });
      if (game.sport === 'volleyball' && normalizedPeriods.periods) {
        const periodsError = validateVolleyballPeriods(game.round_label, score_a, score_b, normalizedPeriods.periods);
        if (periodsError) return res.status(400).json({ error: periodsError });
      }
      finalScoreA = score_a;
      finalScoreB = score_b;
      status = 'completed';
      winnerTeamId = finalScoreA > finalScoreB ? game.team_a_id : game.team_b_id;
    }

    const isAdmin = isAdminRole(req.user.role);
    const now = new Date().toISOString();

    const runTx = db.transaction(() => {
      const fresh = db.prepare(
        'SELECT g.*, t.sport FROM games g JOIN tournaments t ON t.id = g.tournament_id WHERE g.id = ?'
      ).get(req.params.id);
      const freshMatch = isPickleball
        ? db.prepare('SELECT * FROM pickleball_match_state WHERE game_id = ?').get(req.params.id)
        : null;
      const stale = !fresh || fresh.status !== 'ongoing' || (isPickleball
        ? (!freshMatch || freshMatch.version !== expected_match_version || freshMatch.match_state !== 'ready_to_submit')
        : (fresh.live_score_a !== expected_live_score_a || fresh.live_score_b !== expected_live_score_b));
      if (stale) {
        const conflict = new Error('The game changed before submission completed. Reload and review it.');
        conflict.status = 409;
        throw conflict;
      }
      if (fresh.sport === 'basketball') computeEffectiveClockValues(fresh);

      let result;
      if (isPickleball) {
        result = db.prepare(
          `UPDATE games SET
             score_a = ?, score_b = ?, status = 'completed', winner_team_id = NULL, winner_entry_id = ?,
             forfeit_team_id = NULL, forfeit_entry_id = NULL, remarks = COALESCE(?, remarks),
             submitted_by = ?, submitted_at = ?, approved_by = ?, approved_at = ?,
             live_score_a = NULL, live_score_b = NULL, updated_at = datetime('now')
           WHERE id = ? AND status = 'ongoing'`
        ).run(
          finalScoreA, finalScoreB, winnerEntryId, remarks ?? null, req.user.id, now,
          isAdmin ? req.user.id : null, isAdmin ? now : null, req.params.id,
        );
        const matchUpdate = db.prepare(
          `UPDATE pickleball_match_state SET match_state = ?, version = version + 1,
             last_action_json = CASE WHEN ? = 1 THEN NULL ELSE last_action_json END,
             updated_at = datetime('now')
           WHERE game_id = ? AND version = ? AND match_state = 'ready_to_submit'`
        ).run(isAdmin ? 'approved' : 'pending_approval', isAdmin ? 1 : 0, req.params.id, expected_match_version);
        if (matchUpdate.changes !== 1) result = { changes: 0 };
      } else {
        result = db.prepare(
          `UPDATE games SET
           score_a = ?, score_b = ?, status = ?, forfeit_team_id = ?, winner_team_id = ?,
           remarks = COALESCE(?, remarks),
           submitted_by = ?, submitted_at = ?,
           approved_by = ?, approved_at = ?,
           live_score_a = NULL, live_score_b = NULL,
           game_clock_remaining = ?, game_clock_running = ?, game_clock_started_at = ?,
           shot_clock_remaining = ?, shot_clock_running = ?, shot_clock_started_at = ?,
           updated_at = datetime('now')
         WHERE id = ? AND status = 'ongoing' AND live_score_a IS ? AND live_score_b IS ?`
        ).run(
        finalScoreA,
        finalScoreB,
        status, forfeitTeamId, winnerTeamId, remarks ?? null,
        req.user.id, now,
        isAdmin ? req.user.id : null, isAdmin ? now : null,
        fresh.game_clock_remaining, fresh.sport === 'basketball' ? 0 : fresh.game_clock_running,
        fresh.sport === 'basketball' ? null : fresh.game_clock_started_at,
        fresh.shot_clock_remaining, fresh.sport === 'basketball' ? 0 : fresh.shot_clock_running,
        fresh.sport === 'basketball' ? null : fresh.shot_clock_started_at,
        req.params.id, expected_live_score_a, expected_live_score_b,
        );
      }
      if (result.changes !== 1) {
        const conflict = new Error('The game changed before submission completed. Reload and review it.');
        conflict.status = 409;
        throw conflict;
      }

      if (normalizedPeriods.periods) {
        db.prepare('DELETE FROM game_period_scores WHERE game_id = ?').run(req.params.id);
        const insertPeriod = db.prepare(
          'INSERT INTO game_period_scores (game_id, period_number, team_a_score, team_b_score) VALUES (?, ?, ?, ?)'
        );
        normalizedPeriods.periods.forEach((period, idx) => {
          insertPeriod.run(req.params.id, idx + 1, period.team_a_score, period.team_b_score);
        });
      }

      // If this game feeds a later bracket match and is already approved
      // (admin submission), advance the winner immediately.
      if (isAdmin) {
        advanceBracketWinner(db, game, winnerTeamId, winnerEntryId);
      }
    });
    try {
      runTx();
    } catch (txErr) {
      return res.status(txErr.status || 500).json({ error: txErr.message });
    }

    const updated = db.prepare(GAME_SELECT + ' WHERE g.id = ?').get(req.params.id);

    logAction(db, {
      userId: req.user.id,
      action: isAdmin ? 'submit_result_approved' : 'submit_result_pending_approval',
      entityType: 'game',
      entityId: req.params.id,
      details: {
        previous_status: game.status,
        status: updated.status,
        sport: game.sport,
        score_a: updated.score_a,
        score_b: updated.score_b,
        forfeit_team_id: updated.forfeit_team_id,
        winner_team_id: updated.winner_team_id,
        winner_entry_id: updated.winner_entry_id,
        submitted_role: req.user.role,
        approval_mode: isAdmin ? 'immediate' : 'pending_admin',
        pending_approval: !isAdmin,
        game_clock_remaining: updated.game_clock_remaining,
        shot_clock_remaining: updated.shot_clock_remaining,
      },
    });

    if (game.tournament_id) {
      sse.broadcast(game.tournament_id, {
        type: 'score_update',
        game_id: req.params.id,
        tournament_id: game.tournament_id,
        score_a: updated.score_a,
        score_b: updated.score_b,
        status: updated.status,
        approved_at: updated.approved_at,
        updated_at: new Date().toISOString(),
      });
    }
    res.json({ game: serializeGamesWithEntries(db, [updated])[0], pendingApproval: !isAdmin });
  });

  // Admin: approve a scorer-submitted result. This is what makes it count
  // toward standings and advances the winner into any bracket feeder game.
  router.post('/:id/approve', requireAuth, requireRole('admin'), (req, res) => {
    const game = db.prepare(
      'SELECT g.*, t.sport FROM games g JOIN tournaments t ON t.id = g.tournament_id WHERE g.id = ?'
    ).get(req.params.id);
    if (!game) return res.status(404).json({ error: 'Game not found.' });
    if (!isPendingResult(game)) {
      return res.status(409).json({ error: 'Only a pending, unapproved result can be approved.' });
    }
    const isPickleball = game.sport === 'pickleball';
    if (isPickleball ? (!game.side_a_entry_id || !game.side_b_entry_id) : (!game.team_a_id || !game.team_b_id)) {
      return res.status(400).json({ error: `Both ${isPickleball ? 'entries' : 'teams'} are required before approving a result.` });
    }

    if (game.status === 'completed') {
      if (isPickleball) {
        const match = db.prepare('SELECT * FROM pickleball_match_state WHERE game_id = ?').get(req.params.id);
        if (!match || match.match_state !== 'pending_approval') {
          return res.status(409).json({ error: 'The Pickleball result is not pending approval.' });
        }
        if (game.score_a !== match.side_a_games_won || game.score_b !== match.side_b_games_won || game.score_a === game.score_b) {
          return res.status(400).json({ error: 'Submitted Pickleball result does not match the server-authoritative match state.' });
        }
        const expectedWinner = game.score_a > game.score_b ? game.side_a_entry_id : game.side_b_entry_id;
        if (!game.winner_entry_id || game.winner_entry_id !== expectedWinner || game.winner_team_id !== null) {
          return res.status(400).json({ error: 'Submitted Pickleball result has an invalid winner and cannot be approved.' });
        }
      } else {
        const validationError = validateFinalScoreForSport(game.sport, game.score_a, game.score_b, game.round_label);
        if (validationError) return res.status(400).json({ error: validationError });
        const expectedWinner = game.score_a > game.score_b ? game.team_a_id : game.team_b_id;
        if (!game.winner_team_id || game.winner_team_id !== expectedWinner) {
          return res.status(400).json({ error: 'Submitted result has an invalid winner and cannot be approved.' });
        }
      }
    } else {
      if (isPickleball) return res.status(400).json({ error: 'Pickleball forfeits are not available in this scorer phase.' });
      const validForfeitTeam = Number.isSafeInteger(game.forfeit_team_id) &&
        [game.team_a_id, game.team_b_id].includes(game.forfeit_team_id);
      const expectedWinner = game.forfeit_team_id === game.team_a_id ? game.team_b_id : game.team_a_id;
      if (!validForfeitTeam || !expectedWinner || game.winner_team_id !== expectedWinner) {
        return res.status(400).json({ error: 'Submitted forfeit has an invalid winner and cannot be approved.' });
      }
    }

    const now = new Date().toISOString();
    const runTx = db.transaction(() => {
      const result = db.prepare(
        "UPDATE games SET approved_by = ?, approved_at = ?, updated_at = datetime('now') WHERE id = ? AND status IN ('completed','forfeited') AND submitted_at IS NOT NULL AND approved_at IS NULL"
      ).run(req.user.id, now, req.params.id);
      if (result.changes !== 1) {
        const conflict = new Error('This result is no longer pending approval. Reload and review it.');
        conflict.status = 409;
        throw conflict;
      }

      if (isPickleball) {
        const matchUpdate = db.prepare(
          `UPDATE pickleball_match_state SET match_state = 'approved', version = version + 1,
             last_action_json = NULL, updated_at = datetime('now')
           WHERE game_id = ? AND match_state = 'pending_approval'`
        ).run(req.params.id);
        if (matchUpdate.changes !== 1) {
          const conflict = new Error('The Pickleball result is no longer pending approval. Reload and review it.');
          conflict.status = 409;
          throw conflict;
        }
      }

      advanceBracketWinner(db, game, game.winner_team_id, game.winner_entry_id);
    });
    try {
      runTx();
    } catch (txErr) {
      return res.status(txErr.status || 500).json({ error: txErr.message });
    }

    logAction(db, {
      userId: req.user.id,
      action: 'approve_result',
      entityType: 'game',
      entityId: req.params.id,
      details: {
        status: game.status,
        score_a: game.score_a,
        score_b: game.score_b,
        winner_team_id: game.winner_team_id,
        winner_entry_id: game.winner_entry_id,
      },
    });
    const updated = db.prepare(GAME_SELECT + ' WHERE g.id = ?').get(req.params.id);
    if (game.tournament_id) {
      sse.broadcast(game.tournament_id, {
        type: 'score_update',
        game_id: req.params.id,
        tournament_id: game.tournament_id,
        score_a: updated.score_a,
        score_b: updated.score_b,
        status: updated.status,
        approved_at: updated.approved_at,
        updated_at: new Date().toISOString(),
      });
    }
    res.json({ game: serializeGamesWithEntries(db, [updated])[0] });
  });

  // Admin: reject a scorer-submitted result, sending it back to "ongoing" for re-entry.
  router.post('/:id/reject', requireAuth, requireRole('admin'), (req, res) => {
    const game = db.prepare(
      'SELECT g.*, t.sport FROM games g JOIN tournaments t ON t.id = g.tournament_id WHERE g.id = ?'
    ).get(req.params.id);
    if (!game) return res.status(404).json({ error: 'Game not found.' });
    if (!isPendingResult(game)) {
      return res.status(409).json({ error: 'Only a pending, unapproved result can be rejected.' });
    }
    const { reason } = req.body || {};
    const isPickleball = game.sport === 'pickleball';
    if (game.sport === 'basketball') computeEffectiveClockValues(game);
    const runTx = db.transaction(() => {
      const result = isPickleball
        ? db.prepare(
          `UPDATE games SET status = 'ongoing', score_a = NULL, score_b = NULL,
             forfeit_team_id = NULL, forfeit_entry_id = NULL,
             winner_team_id = NULL, winner_entry_id = NULL,
             submitted_by = NULL, submitted_at = NULL, approved_by = NULL, approved_at = NULL,
             live_score_a = NULL, live_score_b = NULL,
             remarks = ?, updated_at = datetime('now')
           WHERE id = ? AND status = 'completed' AND submitted_at IS NOT NULL AND approved_at IS NULL`
        ).run(reason || 'Sent back for correction.', req.params.id)
        : db.prepare(
          `UPDATE games SET status = 'ongoing', score_a = NULL, score_b = NULL, forfeit_team_id = NULL,
           winner_team_id = NULL, submitted_by = NULL, submitted_at = NULL, approved_by = NULL, approved_at = NULL,
           live_score_a = 0, live_score_b = 0,
           game_clock_remaining = ?, game_clock_running = 0, game_clock_started_at = NULL,
           shot_clock_remaining = ?, shot_clock_running = 0, shot_clock_started_at = NULL,
           remarks = ?, updated_at = datetime('now')
           WHERE id = ? AND status IN ('completed','forfeited') AND submitted_at IS NOT NULL AND approved_at IS NULL`
        ).run(game.game_clock_remaining, game.shot_clock_remaining, reason || 'Sent back for correction.', req.params.id);
      if (result.changes !== 1) {
        const conflict = new Error('This result is no longer pending approval. Reload and review it.');
        conflict.status = 409;
        throw conflict;
      }
      if (isPickleball) {
        const matchUpdate = db.prepare(
          `UPDATE pickleball_match_state SET match_state = 'ready_to_submit', version = version + 1,
             updated_at = datetime('now')
           WHERE game_id = ? AND match_state = 'pending_approval'`
        ).run(req.params.id);
        if (matchUpdate.changes !== 1) {
          const conflict = new Error('The Pickleball result is no longer pending approval. Reload and review it.');
          conflict.status = 409;
          throw conflict;
        }
      } else {
        db.prepare('DELETE FROM game_period_scores WHERE game_id = ?').run(req.params.id);
      }
    });
    try {
      runTx();
    } catch (txErr) {
      return res.status(txErr.status || 500).json({ error: txErr.message });
    }
    logAction(db, {
      userId: req.user.id,
      action: 'reject_result',
      entityType: 'game',
      entityId: req.params.id,
      details: { previous_status: game.status, score_a: game.score_a, score_b: game.score_b, reason: reason || null },
    });
    const updated = db.prepare(GAME_SELECT + ' WHERE g.id = ?').get(req.params.id);
    if (game.tournament_id) {
      sse.broadcast(game.tournament_id, {
        type: 'score_update',
        game_id: req.params.id,
        tournament_id: game.tournament_id,
        score_a: 0,
        score_b: 0,
        status: 'ongoing',
        updated_at: new Date().toISOString(),
      });
    }
    res.json({ game: serializeGamesWithEntries(db, [updated])[0] });
  });

  return router;
};
