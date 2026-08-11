const express = require('express');
const { requireAuthFor, requireRole } = require('../middleware/auth');
const { logAction } = require('../utils/audit');
const { generateRoundRobinPairs, splitIntoGroups } = require('../services/scheduleService');
const { generateGroupPlayoffMatchups, generateSingleEliminationBracket } = require('../services/bracketService');
const { computeStandings, saveSnapshot } = require('../services/standingsService');
const { normalizePickleballConfig, parsePickleballConfig } = require('../services/pickleballConfig');

const SUPPORTED_SPORTS = ['basketball', 'volleyball', 'pickleball'];

function serializeTournament(tournament) {
  if (!tournament) return tournament;
  let sportConfig = null;
  if (tournament.sport_config_json) {
    try { sportConfig = JSON.parse(tournament.sport_config_json); } catch {}
  }
  return { ...tournament, sport_config: sportConfig };
}

module.exports = function tournamentRoutes(db) {
  const router = express.Router();
  const requireAuth = requireAuthFor(db);

  function hasUnsafeBracketGames(stageId) {
    const unsafe = db.prepare(`
      SELECT COUNT(*) AS count FROM games
      WHERE stage_id = ? AND bracket_slot IS NOT NULL
        AND (status IN ('ongoing', 'completed', 'forfeited')
             OR approved_at IS NOT NULL
             OR score_a IS NOT NULL
             OR score_b IS NOT NULL
             OR winner_team_id IS NOT NULL
             OR winner_entry_id IS NOT NULL)
    `).get(stageId);
    return unsafe.count > 0;
  }

  function reconcileBracket({ tournamentId, stageId, rounds, isPickleball, rulesSnapshot = null, includeThirdPlace = false }) {
    const expectedGames = [];
    rounds.forEach((round) => {
      round.matches.forEach((match) => {
        expectedGames.push({
          roundLabel: round.name,
          bracketSlot: match.slot,
          sideA: match.teamAId,
          sideB: match.teamBId,
          feedsSlot: match.feedsSlot || null,
          feedsSide: match.feedsSide || null,
        });
      });
    });
    if (includeThirdPlace && rounds.length >= 2 && rounds[rounds.length - 2].matches.length === 2) {
      expectedGames.push({
        roundLabel: 'Third Place',
        bracketSlot: '3RD',
        sideA: null,
        sideB: null,
        feedsSlot: null,
        feedsSide: null,
      });
    }

    const existingGames = db.prepare(
      'SELECT * FROM games WHERE stage_id = ? AND bracket_slot IS NOT NULL ORDER BY id'
    ).all(stageId);
    const expectedSlots = new Set(expectedGames.map((game) => game.bracketSlot));
    const existingSlots = new Set(existingGames.map((game) => game.bracket_slot));
    if (existingGames.length > 0 &&
        (expectedSlots.size !== existingSlots.size || [...expectedSlots].some((slot) => !existingSlots.has(slot)))) {
      const error = new Error('Bracket structure changed. Remove the unstarted bracket before generating a different bracket size or third-place configuration.');
      error.status = 409;
      throw error;
    }

    const existingBySlot = new Map();
    const duplicateIds = [];
    existingGames.forEach((game) => {
      if (existingBySlot.has(game.bracket_slot)) duplicateIds.push(game.id);
      else existingBySlot.set(game.bracket_slot, game);
    });
    const deleteGame = db.prepare('DELETE FROM games WHERE id = ?');
    duplicateIds.forEach((id) => deleteGame.run(id));

    const insertTeamGame = db.prepare(
      `INSERT INTO games (tournament_id, stage_id, round_label, bracket_slot, team_a_id, team_b_id, status)
       VALUES (?, ?, ?, ?, ?, ?, 'scheduled')`
    );
    const insertEntryGame = db.prepare(
      `INSERT INTO games (tournament_id, stage_id, round_label, bracket_slot, side_a_entry_id, side_b_entry_id, rules_snapshot_json, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled')`
    );
    const updateTeamGame = db.prepare(
      `UPDATE games SET round_label = ?, team_a_id = ?, team_b_id = ?,
         side_a_entry_id = (SELECT id FROM competition_entries WHERE entry_type = 'team' AND team_id = ?),
         side_b_entry_id = (SELECT id FROM competition_entries WHERE entry_type = 'team' AND team_id = ?),
         rules_snapshot_json = NULL, feeds_game_id = NULL, feeds_slot = NULL,
         updated_at = datetime('now')
       WHERE id = ?`
    );
    const updateEntryGame = db.prepare(
      `UPDATE games SET round_label = ?, team_a_id = NULL, team_b_id = NULL,
         side_a_entry_id = ?, side_b_entry_id = ?, rules_snapshot_json = ?,
         feeds_game_id = NULL, feeds_slot = NULL, updated_at = datetime('now')
       WHERE id = ?`
    );

    const slotToGameId = {};
    let gamesCreated = 0;
    expectedGames.forEach((game) => {
      const existing = existingBySlot.get(game.bracketSlot);
      if (existing) {
        if (isPickleball) {
          updateEntryGame.run(game.roundLabel, game.sideA, game.sideB, rulesSnapshot, existing.id);
        } else {
          updateTeamGame.run(game.roundLabel, game.sideA, game.sideB, game.sideA, game.sideB, existing.id);
        }
        slotToGameId[game.bracketSlot] = existing.id;
        return;
      }
      const result = isPickleball
        ? insertEntryGame.run(tournamentId, stageId, game.roundLabel, game.bracketSlot, game.sideA, game.sideB, rulesSnapshot)
        : insertTeamGame.run(tournamentId, stageId, game.roundLabel, game.bracketSlot, game.sideA, game.sideB);
      slotToGameId[game.bracketSlot] = Number(result.lastInsertRowid);
      gamesCreated += 1;
    });

    const linkFeeder = db.prepare('UPDATE games SET feeds_game_id = ?, feeds_slot = ? WHERE id = ?');
    expectedGames.forEach((game) => {
      if (!game.feedsSlot) return;
      linkFeeder.run(slotToGameId[game.feedsSlot], game.feedsSide, slotToGameId[game.bracketSlot]);
    });
    return { gamesCreated, gamesRemoved: duplicateIds.length };
  }

  router.get('/', requireAuth, (req, res) => {
    const tournaments = db.prepare('SELECT * FROM tournaments ORDER BY created_at DESC').all();
    res.json({ tournaments: tournaments.map(serializeTournament) });
  });

  router.get('/:id', requireAuth, (req, res) => {
    const tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(req.params.id);
    if (!tournament) return res.status(404).json({ error: 'Tournament not found.' });
    const groups = db.prepare('SELECT * FROM groups_table WHERE tournament_id = ? ORDER BY order_index').all(req.params.id);
    const stages = db.prepare('SELECT * FROM stages WHERE tournament_id = ? ORDER BY order_index').all(req.params.id);
    res.json({ tournament: serializeTournament(tournament), groups, stages });
  });

  router.post('/', requireAuth, requireRole('admin'), (req, res) => {
    const {
      name, sport, category, format, venue, start_date, end_date, rules,
      groups_count, advancing_per_group, third_place_game,
    } = req.body || {};

    if (!name || !format) {
      return res.status(400).json({ error: 'Tournament name and format are required.' });
    }
    if (!['round_robin', 'groups_playoffs', 'single_elimination'].includes(format)) {
      return res.status(400).json({ error: 'Invalid tournament format.' });
    }

    const normalizedSport = sport || 'basketball';
    if (!SUPPORTED_SPORTS.includes(normalizedSport)) return res.status(400).json({ error: 'Invalid sport.' });
    let pickleball = null;
    if (normalizedSport === 'pickleball') {
      if (format === 'groups_playoffs') {
        return res.status(400).json({ error: 'Pickleball currently supports round robin or single elimination.' });
      }
      try {
        pickleball = normalizePickleballConfig(req.body || {});
      } catch (error) {
        return res.status(error.status || 400).json({ error: error.message });
      }
    }

    const result = db.prepare(
      `INSERT INTO tournaments (
         name, sport, category, competition_format, division, sport_config_json,
         format, venue, start_date, end_date, rules, groups_count, advancing_per_group, third_place_game
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      name, normalizedSport, pickleball?.category || category || null,
      pickleball?.competitionFormat || null, pickleball?.division || null,
      pickleball ? JSON.stringify(pickleball.config) : null,
      format, venue || null,
      start_date || null, end_date || null, rules || null,
      groups_count || 2, advancing_per_group || 2, third_place_game === false ? 0 : 1
    );

    logAction(db, { userId: req.user.id, action: 'create_tournament', entityType: 'tournament', entityId: result.lastInsertRowid });
    const tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ tournament: serializeTournament(tournament) });
  });

  router.put('/:id', requireAuth, requireRole('admin'), (req, res) => {
    const existing = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Tournament not found.' });

    if (req.body.format && !['round_robin', 'groups_playoffs', 'single_elimination'].includes(req.body.format)) {
      return res.status(400).json({ error: 'Invalid tournament format.' });
    }
    if (req.body.status && !['draft', 'active', 'completed', 'archived'].includes(req.body.status)) {
      return res.status(400).json({ error: 'Invalid tournament status.' });
    }

    const nextSport = req.body.sport ?? existing.sport;
    const nextFormat = req.body.format ?? existing.format;
    if (!SUPPORTED_SPORTS.includes(nextSport)) return res.status(400).json({ error: 'Invalid sport.' });
    if (nextSport === 'pickleball' && nextFormat === 'groups_playoffs') {
      return res.status(400).json({ error: 'Pickleball currently supports round robin or single elimination.' });
    }
    if (nextSport !== existing.sport || nextFormat !== existing.format) {
      const dependentCount = db.prepare(
        `SELECT (SELECT COUNT(*) FROM competition_entries WHERE tournament_id = ?) +
         (SELECT COUNT(*) FROM games WHERE tournament_id = ?) AS count`
      ).get(req.params.id, req.params.id).count;
      if (dependentCount > 0) {
        return res.status(409).json({
          error: 'Sport and tournament format cannot change after entries or games exist.',
        });
      }
    }

    let pickleball = null;
    if (nextSport === 'pickleball') {
      try {
        const existingConfig = existing.sport === 'pickleball' ? parsePickleballConfig(existing) : null;
        pickleball = normalizePickleballConfig({
          ...(existingConfig || {}),
          competition_format: req.body.competition_format ?? existing.competition_format ?? existingConfig?.competition_format,
          division: req.body.division ?? existing.division ?? existingConfig?.division,
          ...req.body,
        });
      } catch (error) {
        return res.status(error.status || 400).json({ error: error.message });
      }
      const structuralChange = existing.sport !== 'pickleball' ||
        pickleball.competitionFormat !== existing.competition_format ||
        pickleball.division !== existing.division;
      if (structuralChange) {
        const entryCount = db.prepare('SELECT COUNT(*) AS count FROM competition_entries WHERE tournament_id = ?').get(req.params.id).count;
        if (entryCount > 0) {
          return res.status(409).json({ error: 'Competition format and division cannot change after entries are registered.' });
        }
      }
    }

    const fields = [
      'name', 'sport', 'category', 'format', 'venue', 'start_date', 'end_date',
      'status', 'rules', 'groups_count', 'advancing_per_group', 'third_place_game',
    ];
    const updates = [];
    const params = [];
    fields.forEach((f) => {
      if (nextSport === 'pickleball' && f === 'category') return;
      if (req.body[f] !== undefined) {
        updates.push(`${f} = ?`);
        params.push(req.body[f]);
      }
    });
    if (nextSport === 'pickleball') {
      updates.push('category = ?', 'competition_format = ?', 'division = ?', 'sport_config_json = ?');
      params.push(pickleball.category, pickleball.competitionFormat, pickleball.division, JSON.stringify(pickleball.config));
    } else if (existing.sport === 'pickleball' || req.body.sport !== undefined) {
      updates.push('competition_format = NULL', 'division = NULL', 'sport_config_json = NULL');
    }
    if (updates.length === 0) return res.json({ tournament: existing });

    params.push(req.params.id);
    db.prepare(`UPDATE tournaments SET ${updates.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...params);
    logAction(db, { userId: req.user.id, action: 'update_tournament', entityType: 'tournament', entityId: req.params.id });
    const tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(req.params.id);
    res.json({ tournament: serializeTournament(tournament) });
  });

  router.delete('/:id', requireAuth, requireRole('admin'), (req, res) => {
    const existing = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Tournament not found.' });
    db.prepare('DELETE FROM tournaments WHERE id = ?').run(req.params.id);
    logAction(db, { userId: req.user.id, action: 'delete_tournament', entityType: 'tournament', entityId: req.params.id });
    res.json({ ok: true });
  });

  // --- Group assignment for "groups_playoffs" format ---

  router.post('/:id/assign-groups', requireAuth, requireRole('admin'), (req, res) => {
    const tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(req.params.id);
    if (!tournament) return res.status(404).json({ error: 'Tournament not found.' });
    if (tournament.format !== 'groups_playoffs') {
      return res.status(400).json({ error: 'This tournament format does not use groups.' });
    }

    const teams = db.prepare('SELECT id FROM teams WHERE tournament_id = ? AND status = ?').all(req.params.id, 'active');
    if (teams.length < tournament.groups_count * 2) {
      return res.status(400).json({ error: 'Not enough active teams to fill the configured groups.' });
    }

    const existingGameCount = db.prepare(
      'SELECT COUNT(*) AS count FROM games WHERE tournament_id = ?'
    ).get(req.params.id).count;
    if (existingGameCount > 0) {
      return res.status(409).json({
        error: 'Groups cannot be reassigned after games exist. Remove the unstarted schedule first or keep the current groups.',
      });
    }

    // Clear any previous group assignment / stage so this can be re-run safely.
    const assignGroups = db.transaction(() => {
      const existingStage = db.prepare('SELECT * FROM stages WHERE tournament_id = ? AND type = ?').get(req.params.id, 'group');
      const stageId = existingStage
        ? existingStage.id
        : db.prepare('INSERT INTO stages (tournament_id, name, type, order_index) VALUES (?, ?, ?, 0)')
            .run(req.params.id, 'Group Stage', 'group').lastInsertRowid;

      db.prepare('DELETE FROM groups_table WHERE tournament_id = ?').run(req.params.id);

      const teamIds = teams.map((t) => t.id);
      const groupBuckets = splitIntoGroups(teamIds, tournament.groups_count);
      const createdGroups = [];
      groupBuckets.forEach((bucket, idx) => {
        const groupName = `Group ${String.fromCharCode(65 + idx)}`;
        const groupId = db.prepare(
          'INSERT INTO groups_table (tournament_id, stage_id, name, order_index) VALUES (?, ?, ?, ?)'
        ).run(req.params.id, stageId, groupName, idx).lastInsertRowid;

        bucket.forEach((teamId) => {
          db.prepare('UPDATE teams SET group_id = ? WHERE id = ?').run(groupId, teamId);
        });

        createdGroups.push({ id: groupId, name: groupName, teamIds: bucket });
      });
      return createdGroups;
    });
    const createdGroups = assignGroups();

    logAction(db, { userId: req.user.id, action: 'assign_groups', entityType: 'tournament', entityId: req.params.id });
    res.json({ groups: createdGroups });
  });

  // --- Schedule generation ---

  router.post('/:id/generate-schedule', requireAuth, requireRole('admin'), (req, res) => {
    const tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(req.params.id);
    if (!tournament) return res.status(404).json({ error: 'Tournament not found.' });

    const insertTeamGame = db.prepare(
      `INSERT INTO games (tournament_id, stage_id, group_id, round_label, team_a_id, team_b_id, status)
       VALUES (?, ?, ?, ?, ?, ?, 'scheduled')`
    );
    const insertEntryGame = db.prepare(
      `INSERT INTO games (tournament_id, stage_id, group_id, round_label, side_a_entry_id, side_b_entry_id, rules_snapshot_json, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled')`
    );
    const isPickleball = tournament.sport === 'pickleball';
    let pickleballConfig = null;
    let entryIds = [];
    if (isPickleball) {
      try {
        pickleballConfig = parsePickleballConfig(tournament);
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }
      const expectedType = tournament.competition_format === 'singles' ? 'individual' : 'pair';
      entryIds = db.prepare(
        `SELECT id FROM competition_entries
         WHERE tournament_id = ? AND status = 'active' AND entry_type = ? AND division = ?
         ORDER BY seed_number IS NULL, seed_number, id`
      ).all(req.params.id, expectedType, tournament.division).map((entry) => entry.id);
      if (entryIds.length < 2) return res.status(400).json({ error: 'At least two active compatible entries are required.' });
    }

    const insertScheduledGame = (stageId, groupId, roundLabel, a, b, bracketSlot = null) => {
      if (isPickleball) {
        if (bracketSlot) {
          return db.prepare(
            `INSERT INTO games (tournament_id, stage_id, round_label, bracket_slot, side_a_entry_id, side_b_entry_id, rules_snapshot_json, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled')`
          ).run(req.params.id, stageId, roundLabel, bracketSlot, a, b, JSON.stringify(pickleballConfig));
        }
        return insertEntryGame.run(req.params.id, stageId, groupId, roundLabel, a, b, JSON.stringify(pickleballConfig));
      }
      if (bracketSlot) {
        return db.prepare(
          `INSERT INTO games (tournament_id, stage_id, round_label, bracket_slot, team_a_id, team_b_id, status)
           VALUES (?, ?, ?, ?, ?, ?, 'scheduled')`
        ).run(req.params.id, stageId, roundLabel, bracketSlot, a, b);
      }
      return insertTeamGame.run(req.params.id, stageId, groupId, roundLabel, a, b);
    };

    let gamesCreated = 0;
    let gamesRemoved = 0;

    const matchupKey = (a, b) => {
      if (!a || !b || Number(a) === Number(b)) return null;
      return [Number(a), Number(b)].sort((left, right) => left - right).join(':');
    };
    const gameKey = (game) => matchupKey(
      isPickleball ? game.side_a_entry_id : game.team_a_id,
      isPickleball ? game.side_b_entry_id : game.team_b_id,
    );
    const isSafeGeneratedGame = (game, format) => {
      if (game.status !== 'scheduled' || game.approved_at || game.submitted_at ||
          game.score_a !== null || game.score_b !== null ||
          game.winner_team_id || game.winner_entry_id || game.bracket_slot) return false;
      if (format === 'round_robin') {
        return game.stage_id === null && game.group_id === null && /^Round \d+$/.test(game.round_label || '');
      }
      return game.group_id !== null && /^Group .+ - Round \d+$/.test(game.round_label || '');
    };
    const reconcileRoundRobin = (expectedGames, format) => {
      const existingGames = db.prepare(
        `SELECT id, stage_id, group_id, round_label, bracket_slot,
                team_a_id, team_b_id, side_a_entry_id, side_b_entry_id,
                status, score_a, score_b, winner_team_id, winner_entry_id,
                submitted_at, approved_at
         FROM games WHERE tournament_id = ? AND bracket_slot IS NULL
         ORDER BY id`
      ).all(req.params.id);
      const expectedKeys = new Set(expectedGames.map((game) => matchupKey(game.a, game.b)));
      const existingByKey = new Map();
      const deletedIds = new Set();
      existingGames.forEach((game) => {
        const key = gameKey(game);
        if (!key) return;
        if (!existingByKey.has(key)) existingByKey.set(key, []);
        existingByKey.get(key).push(game);
      });

      const deleteGame = db.prepare('DELETE FROM games WHERE id = ?');
      existingByKey.forEach((games, key) => {
        const protectedGame = games.find((game) => !isSafeGeneratedGame(game, format));
        const keeper = protectedGame || games[0];
        games.forEach((game) => {
          const obsolete = !expectedKeys.has(key);
          const duplicate = game.id !== keeper.id;
          if ((obsolete || duplicate) && isSafeGeneratedGame(game, format)) {
            deleteGame.run(game.id);
            deletedIds.add(game.id);
            gamesRemoved += 1;
          }
        });
      });

      const occupancy = new Map();
      const roundParts = (roundLabel) => {
        const match = format === 'round_robin'
          ? /^(Round )(\d+)$/.exec(roundLabel || '')
          : /^(Group .+ - Round )(\d+)$/.exec(roundLabel || '');
        return match ? { prefix: match[1], number: Number(match[2]) } : null;
      };
      const occupancyKey = (groupId, roundNumber) => `${format === 'round_robin' ? 'all' : groupId}:${roundNumber}`;
      const occupy = (groupId, roundNumber, a, b) => {
        const key = occupancyKey(groupId, roundNumber);
        if (!occupancy.has(key)) occupancy.set(key, new Set());
        occupancy.get(key).add(Number(a));
        occupancy.get(key).add(Number(b));
      };
      existingGames.filter((game) => !deletedIds.has(game.id)).forEach((game) => {
        const key = gameKey(game);
        const parts = roundParts(game.round_label);
        if (!key || !parts) return;
        const [a, b] = key.split(':').map(Number);
        occupy(game.group_id, parts.number, a, b);
      });
      const safeRoundLabel = (game) => {
        const parts = roundParts(game.roundLabel);
        if (!parts) return game.roundLabel;
        let roundNumber = parts.number;
        while (true) {
          const occupied = occupancy.get(occupancyKey(game.groupId, roundNumber));
          if (!occupied || (!occupied.has(Number(game.a)) && !occupied.has(Number(game.b)))) {
            occupy(game.groupId, roundNumber, game.a, game.b);
            return `${parts.prefix}${roundNumber}`;
          }
          roundNumber += 1;
        }
      };

      const remainingKeys = new Set(
        existingGames
          .filter((game) => !deletedIds.has(game.id))
          .map(gameKey)
          .filter(Boolean)
      );

      expectedGames.forEach((game) => {
        const key = matchupKey(game.a, game.b);
        if (!key || remainingKeys.has(key)) return;
        insertScheduledGame(game.stageId, game.groupId, safeRoundLabel(game), game.a, game.b);
        remainingKeys.add(key);
        gamesCreated += 1;
      });
    };

    const runTransaction = db.transaction(() => {
      if (tournament.format === 'round_robin') {
        const competitorIds = isPickleball
          ? entryIds
          : db.prepare('SELECT id FROM teams WHERE tournament_id = ? AND status = ?').all(req.params.id, 'active').map((team) => team.id);
        if (competitorIds.length < 2) throw new Error('At least two active compatible competitors are required.');
        const { rounds } = generateRoundRobinPairs(competitorIds);
        const expectedGames = [];
        rounds.forEach((pairs, roundIdx) => {
          pairs.forEach(([a, b]) => {
            expectedGames.push({ stageId: null, groupId: null, roundLabel: `Round ${roundIdx + 1}`, a, b });
          });
        });
        reconcileRoundRobin(expectedGames, 'round_robin');
      } else if (tournament.format === 'groups_playoffs') {
        if (isPickleball) throw new Error('Pickleball groups + playoffs is not supported in this phase.');
        const groups = db.prepare('SELECT * FROM groups_table WHERE tournament_id = ?').all(req.params.id);
        if (groups.length === 0) {
          throw new Error('Assign teams to groups first before generating the schedule.');
        }
        const expectedGames = [];
        groups.forEach((group) => {
          const teams = db.prepare('SELECT id FROM teams WHERE group_id = ?').all(group.id);
          const { rounds } = generateRoundRobinPairs(teams.map((t) => t.id));
          rounds.forEach((pairs, roundIdx) => {
            pairs.forEach(([a, b]) => {
              expectedGames.push({
                stageId: group.stage_id,
                groupId: group.id,
                roundLabel: `${group.name} - Round ${roundIdx + 1}`,
                a,
                b,
              });
            });
          });
        });
        reconcileRoundRobin(expectedGames, 'groups_playoffs');
      } else if (tournament.format === 'single_elimination') {
        const competitorIds = isPickleball
          ? entryIds
          : db.prepare(
            `SELECT tm.id
             FROM teams tm
             JOIN competition_entries ce
               ON ce.team_id = tm.id AND ce.entry_type = 'team'
             WHERE tm.tournament_id = ? AND tm.status = 'active' AND ce.status = 'active'
             ORDER BY ce.seed_number IS NULL, ce.seed_number, tm.id`
          ).all(req.params.id).map((team) => team.id);
        if (competitorIds.length < 2) {
          throw new Error('At least two active compatible competitors are required.');
        }
        const existingStage = db.prepare('SELECT * FROM stages WHERE tournament_id = ? AND type = ?').get(req.params.id, 'playoff');
        const stageId = existingStage
          ? existingStage.id
          : db.prepare('INSERT INTO stages (tournament_id, name, type, order_index) VALUES (?, ?, ?, 0)')
              .run(req.params.id, 'Bracket', 'playoff').lastInsertRowid;
        if (existingStage) {
          if (hasUnsafeBracketGames(stageId)) {
            throw new Error('Cannot regenerate bracket: some bracket games have already started or have results. Reset or complete those games first.');
          }
        }

        const rounds = generateSingleEliminationBracket(competitorIds);
        const reconciliation = reconcileBracket({
          tournamentId: Number(req.params.id),
          stageId,
          rounds,
          isPickleball,
          rulesSnapshot: isPickleball ? JSON.stringify(pickleballConfig) : null,
        });
        gamesCreated += reconciliation.gamesCreated;
        gamesRemoved += reconciliation.gamesRemoved;
      }
    });

    try {
      runTransaction();
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message });
    }

    if (tournament.status === 'draft') {
      db.prepare('UPDATE tournaments SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').run('active', req.params.id);
    }

    logAction(db, { userId: req.user.id, action: 'generate_schedule', entityType: 'tournament', entityId: req.params.id, details: { gamesCreated, gamesRemoved } });
    res.json({ ok: true, gamesCreated, gamesRemoved });
  });

  // --- Generate playoff bracket from current group standings ---

  router.post('/:id/generate-playoffs', requireAuth, requireRole('admin'), (req, res) => {
    const tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(req.params.id);
    if (!tournament) return res.status(404).json({ error: 'Tournament not found.' });
    if (tournament.format !== 'groups_playoffs') {
      return res.status(400).json({ error: 'Playoffs only apply to the groups + playoffs format.' });
    }

    const groups = db.prepare('SELECT * FROM groups_table WHERE tournament_id = ? ORDER BY order_index').all(req.params.id);
    if (groups.length === 0) return res.status(400).json({ error: 'No groups found for this tournament.' });

    const groupsWithStandings = groups.map((g) => ({
      group: g,
      standings: computeStandings(db, req.params.id, g.id),
    }));

    const incomplete = groupsWithStandings.find(
      (g) => g.standings.length < tournament.advancing_per_group
    );
    if (incomplete) {
      return res.status(400).json({ error: `${incomplete.group.name} does not have enough teams to advance.` });
    }

    const { rounds, includeThirdPlace } = generateGroupPlayoffMatchups(
      groupsWithStandings, tournament.advancing_per_group, tournament.third_place_game
    );

    let reconciliation;
    try {
      reconciliation = db.transaction(() => {
        const existingStage = db.prepare(
          'SELECT * FROM stages WHERE tournament_id = ? AND order_index = ?'
        ).get(req.params.id, 1);
        const stageId = existingStage
          ? existingStage.id
          : db.prepare('INSERT INTO stages (tournament_id, name, type, order_index) VALUES (?, ?, ?, 1)')
              .run(req.params.id, 'Playoffs', 'playoff').lastInsertRowid;
        if (existingStage && hasUnsafeBracketGames(stageId)) {
          const error = new Error('Cannot regenerate bracket: some bracket games have already started or have results. Reset or complete those games first.');
          error.status = 409;
          throw error;
        }
        return reconcileBracket({
          tournamentId: Number(req.params.id),
          stageId,
          rounds,
          isPickleball: false,
          includeThirdPlace,
        });
      })();
    } catch (error) {
      return res.status(error.status || 400).json({ error: error.message });
    }

    logAction(db, {
      userId: req.user.id,
      action: 'generate_playoffs',
      entityType: 'tournament',
      entityId: req.params.id,
      details: reconciliation,
    });
    res.json({ ok: true, rounds: rounds.map((r) => r.name), ...reconciliation });
  });

  return router;
};
