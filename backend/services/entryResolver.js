const GAME_ENTRY_SELECT = `
  , ea.entry_type AS side_a_entry_type, ea.display_name AS side_a_entry_display_name,
    ea.team_id AS side_a_entry_team_id, ea.division AS side_a_entry_division,
    ea.seed_number AS side_a_entry_seed_number, ea.status AS side_a_entry_status,
    eb.entry_type AS side_b_entry_type, eb.display_name AS side_b_entry_display_name,
    eb.team_id AS side_b_entry_team_id, eb.division AS side_b_entry_division,
    eb.seed_number AS side_b_entry_seed_number, eb.status AS side_b_entry_status
`;

const GAME_ENTRY_JOINS = `
  LEFT JOIN competition_entries ea ON ea.id = g.side_a_entry_id
  LEFT JOIN competition_entries eb ON eb.id = g.side_b_entry_id
`;

function resolverError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function getTeamEntry(db, tournamentId, teamId) {
  if (teamId === null || teamId === undefined || teamId === '') return null;
  return db.prepare(
    `SELECT ce.*, tm.name AS team_name FROM competition_entries ce
     JOIN teams tm ON tm.id = ce.team_id
     WHERE ce.tournament_id = ? AND ce.entry_type = 'team' AND ce.team_id = ?`
  ).get(tournamentId, teamId);
}

function getActiveEntry(db, tournamentId, entryId) {
  if (entryId === null || entryId === undefined || entryId === '') return null;
  if (typeof entryId !== 'number' || !Number.isSafeInteger(entryId)) {
    throw resolverError(400, 'Competition entry IDs must be whole numbers.');
  }
  const entry = db.prepare(
    `SELECT ce.*, tm.name AS team_name FROM competition_entries ce
     LEFT JOIN teams tm ON tm.id = ce.team_id
     WHERE ce.id = ? AND ce.tournament_id = ?`
  ).get(entryId, tournamentId);
  if (!entry) throw resolverError(400, 'Competition entry not found in this tournament.');
  if (entry.status !== 'active') throw resolverError(409, 'Withdrawn or disqualified entries cannot be newly scheduled.');
  const inactiveMember = db.prepare(
    `SELECT p.display_name FROM competition_entry_members cem
     JOIN participants p ON p.id = cem.participant_id
     WHERE cem.competition_entry_id = ? AND p.status != 'active' LIMIT 1`
  ).get(entry.id);
  if (inactiveMember) throw resolverError(409, `${inactiveMember.display_name} is inactive and cannot be newly scheduled.`);
  return entry;
}

function resolveSide(db, tournamentId, entryId, teamId) {
  const entry = entryId !== undefined && entryId !== null && entryId !== ''
    ? getActiveEntry(db, tournamentId, entryId)
    : getTeamEntry(db, tournamentId, teamId);
  if (!entry && teamId !== undefined && teamId !== null && teamId !== '') {
    throw resolverError(400, 'Team entry not found in this tournament.');
  }
  if (entry && teamId !== undefined && teamId !== null && teamId !== '' && entry.team_id !== Number(teamId)) {
    throw resolverError(400, 'Team and competition entry do not identify the same side.');
  }
  return entry;
}

function resolveGameSidesForWrite(db, { tournamentId, sideAEntryId, sideBEntryId, teamAId, teamBId, requireBoth = true }) {
  const sideA = resolveSide(db, tournamentId, sideAEntryId, teamAId);
  const sideB = resolveSide(db, tournamentId, sideBEntryId, teamBId);
  if (requireBoth && (!sideA || !sideB)) throw resolverError(400, 'Tournament and both competitors are required.');
  if (sideA && sideB && sideA.id === sideB.id) throw resolverError(400, 'A competitor cannot be scheduled against itself.');
  if (sideA && sideB && sideA.entry_type !== sideB.entry_type) {
    throw resolverError(400, 'Both competitors must use the same entry type.');
  }
  if (sideA && sideB && sideA.division !== sideB.division) {
    throw resolverError(400, 'Both competitors must belong to the same division.');
  }
  return {
    side_a_entry_id: sideA?.id ?? null,
    side_b_entry_id: sideB?.id ?? null,
    team_a_id: sideA?.entry_type === 'team' ? sideA.team_id : null,
    team_b_id: sideB?.entry_type === 'team' ? sideB.team_id : null,
  };
}

function serializeGameEntries(game, membersByEntry = {}, { publicSafe = false } = {}) {
  const makeSide = (prefix, fallbackName) => {
    const id = game[`${prefix}_entry_id`];
    if (!id) return null;
    const type = game[`${prefix}_entry_type`];
    const members = (membersByEntry[id] || []).map((member) => publicSafe ? {
      display_name: member.display_name,
      affiliation: member.affiliation || null,
      member_order: member.member_order,
    } : {
      participant_id: member.participant_id,
      display_name: member.display_name,
      affiliation: member.affiliation || null,
      member_order: member.member_order,
      role: member.role || null,
      status: member.status,
    });
    const affiliations = [...new Set(members.map((member) => member.affiliation).filter(Boolean))];
    const base = {
      id,
      entry_type: type,
      display_name: type === 'team' ? fallbackName : game[`${prefix}_entry_display_name`],
      division: game[`${prefix}_entry_division`],
      affiliation: affiliations.join(' / ') || null,
      members,
    };
    if (publicSafe) return base;
    return {
      ...base,
      team_id: game[`${prefix}_entry_team_id`],
      seed_number: game[`${prefix}_entry_seed_number`],
      status: game[`${prefix}_entry_status`],
    };
  };
  const serialized = {
    ...game,
    side_a: makeSide('side_a', game.team_a_name),
    side_b: makeSide('side_b', game.team_b_name),
  };
  if (publicSafe) {
    Object.keys(serialized).forEach((key) => {
      if (/^side_[ab]_entry_(type|display_name|team_id|division|seed_number|status)$/.test(key)) delete serialized[key];
    });
  }
  return serialized;
}

function serializeGamesWithEntries(db, games, { publicSafe = false, includeMatchDetails = true } = {}) {
  const rows = Array.isArray(games) ? games : [games];
  if (rows.length === 0) return [];
  const entryIds = [...new Set(rows.flatMap((game) => [game.side_a_entry_id, game.side_b_entry_id]).filter(Boolean))];
  const membersByEntry = {};
  if (entryIds.length > 0) {
    const placeholders = entryIds.map(() => '?').join(',');
    db.prepare(
      `SELECT cem.competition_entry_id, cem.participant_id, cem.member_order, cem.role,
              p.display_name, p.affiliation, p.status
       FROM competition_entry_members cem
       JOIN participants p ON p.id = cem.participant_id
       WHERE cem.competition_entry_id IN (${placeholders})
       ORDER BY cem.competition_entry_id, cem.member_order, cem.id`
    ).all(...entryIds).forEach((member) => {
      if (!membersByEntry[member.competition_entry_id]) membersByEntry[member.competition_entry_id] = [];
      membersByEntry[member.competition_entry_id].push(member);
    });
  }

  const pickleballIds = includeMatchDetails
    ? rows.filter((game) => game.sport === 'pickleball').map((game) => game.id)
    : [];
  const matchStateByGame = {};
  const completedGamesByGame = {};
  if (pickleballIds.length > 0) {
    const placeholders = pickleballIds.map(() => '?').join(',');
    db.prepare(
      `SELECT game_id, current_game_number, side_a_points, side_b_points,
              side_a_games_won, side_b_games_won, serving_entry_id, server_number,
              match_state, version
       FROM pickleball_match_state WHERE game_id IN (${placeholders})`
    ).all(...pickleballIds).forEach((state) => { matchStateByGame[state.game_id] = state; });
    db.prepare(
      `SELECT id, game_id, sequence_number, side_a_points, side_b_points, winner_entry_id, completed_at
       FROM match_games WHERE game_id IN (${placeholders}) ORDER BY game_id, sequence_number`
    ).all(...pickleballIds).forEach((completed) => {
      if (!completedGamesByGame[completed.game_id]) completedGamesByGame[completed.game_id] = [];
      completedGamesByGame[completed.game_id].push(completed);
    });
  }

  const volleyballStateByGame = {};
  if (includeMatchDetails) {
    const { getVolleyballStates } = require('./volleyballMatchService');
    Object.assign(volleyballStateByGame, getVolleyballStates(db, rows));
  }

  return rows.map((row) => {
    const game = serializeGameEntries(row, membersByEntry, { publicSafe });
    if (row.sport === 'volleyball' && includeMatchDetails) {
      return { ...game, volleyball: volleyballStateByGame[row.id] || null };
    }
    if (row.sport !== 'pickleball' || !includeMatchDetails) return game;
    const rawState = matchStateByGame[row.id] || null;
    const state = rawState ? {
      current_game_number: rawState.current_game_number,
      side_a_points: rawState.side_a_points,
      side_b_points: rawState.side_b_points,
      side_a_games_won: rawState.side_a_games_won,
      side_b_games_won: rawState.side_b_games_won,
      serving_side: rawState.serving_entry_id === row.side_a_entry_id ? 'A' : 'B',
      server_number: rawState.server_number,
      match_state: rawState.match_state,
      ...(publicSafe ? {} : { version: rawState.version }),
    } : null;
    return {
      ...game,
      ...(row.status === 'ongoing' && state ? {
        live_score_a: state.side_a_points,
        live_score_b: state.side_b_points,
      } : {}),
      pickleball: {
        state,
        completed_games: completedGamesByGame[row.id] || [],
      },
    };
  });
}

module.exports = {
  GAME_ENTRY_JOINS,
  GAME_ENTRY_SELECT,
  getActiveEntry,
  getTeamEntry,
  resolveGameSidesForWrite,
  serializeGameEntries,
  serializeGamesWithEntries,
};
