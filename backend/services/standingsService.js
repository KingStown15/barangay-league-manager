/**
 * Computes standings for a tournament, optionally scoped to a single group.
 * Only 'completed' and 'forfeited' games count toward standings.
 */

function computeStandings(db, tournamentId, groupId = null) {
  const tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(tournamentId);
  if (!tournament) throw new Error('Tournament not found');

  let pointsConfig, tiebreakers;
  try {
    pointsConfig = JSON.parse(tournament.points_config_json);
    tiebreakers = JSON.parse(tournament.tiebreaker_config_json);
  } catch (parseErr) {
    throw new Error('Invalid tournament configuration data.');
  }

  if (tournament.sport === 'pickleball') {
    return computePickleballStandings(db, tournament, groupId, pointsConfig);
  }

  const teamsQuery = groupId
    ? 'SELECT * FROM teams WHERE tournament_id = ? AND group_id = ? AND status != ?'
    : 'SELECT * FROM teams WHERE tournament_id = ? AND status != ?';
  const teamsParams = groupId ? [tournamentId, groupId, 'disqualified'] : [tournamentId, 'disqualified'];
  const teams = db.prepare(teamsQuery).all(...teamsParams);

  // Only games that are both completed/forfeited AND approved by an admin
  // count toward standings - this keeps scorer-submitted-but-unapproved
  // results from affecting the public table.
  const gamesQuery = groupId
    ? `SELECT * FROM games WHERE tournament_id = ? AND group_id = ? AND status IN ('completed','forfeited') AND approved_at IS NOT NULL`
    : `SELECT * FROM games WHERE tournament_id = ? AND status IN ('completed','forfeited') AND approved_at IS NOT NULL`;
  const gamesParams = groupId ? [tournamentId, groupId] : [tournamentId];
  const games = db.prepare(gamesQuery).all(...gamesParams);

  const table = {};
  for (const team of teams) {
    table[team.id] = {
      teamId: team.id,
      teamName: team.name,
      purok: team.purok,
      played: 0,
      wins: 0,
      losses: 0,
      pointsScored: 0,
      pointsAllowed: 0,
      pointDiff: 0,
      leaguePoints: 0,
      manualOverride: team.manual_rank_override,
      headToHead: {}, // opponentTeamId -> { wins, losses }
    };
  }

  const recordResult = (winnerId, loserId, winnerScore, loserScore, isForfeit) => {
    if (!table[winnerId] || !table[loserId]) return;

    table[winnerId].played += 1;
    table[loserId].played += 1;
    table[winnerId].wins += 1;
    table[loserId].losses += 1;

    table[winnerId].pointsScored += winnerScore || 0;
    table[winnerId].pointsAllowed += loserScore || 0;
    table[loserId].pointsScored += loserScore || 0;
    table[loserId].pointsAllowed += winnerScore || 0;

    const winPts = isForfeit ? pointsConfig.forfeitWinner : pointsConfig.win;
    const lossPts = isForfeit ? pointsConfig.forfeitLoser : pointsConfig.loss;
    table[winnerId].leaguePoints += winPts;
    table[loserId].leaguePoints += lossPts;

    if (!table[winnerId].headToHead[loserId]) table[winnerId].headToHead[loserId] = { wins: 0, losses: 0 };
    if (!table[loserId].headToHead[winnerId]) table[loserId].headToHead[winnerId] = { wins: 0, losses: 0 };
    table[winnerId].headToHead[loserId].wins += 1;
    table[loserId].headToHead[winnerId].losses += 1;
  };

  for (const game of games) {
    if (game.status === 'forfeited') {
      if (!game.forfeit_team_id) continue;
      const loserId = game.forfeit_team_id;
      const winnerId = loserId === game.team_a_id ? game.team_b_id : game.team_a_id;
      if (!winnerId) continue;
      recordResult(winnerId, loserId, 0, 0, true);
      continue;
    }

    if (game.score_a === null || game.score_b === null) continue;
    if (game.score_a === game.score_b) {
      // Tie game (rare in basketball, but keep the data honest rather than dropping it)
      if (table[game.team_a_id]) {
        table[game.team_a_id].played += 1;
        table[game.team_a_id].pointsScored += game.score_a;
        table[game.team_a_id].pointsAllowed += game.score_b;
      }
      if (table[game.team_b_id]) {
        table[game.team_b_id].played += 1;
        table[game.team_b_id].pointsScored += game.score_b;
        table[game.team_b_id].pointsAllowed += game.score_a;
      }
      continue;
    }
    const winnerId = game.score_a > game.score_b ? game.team_a_id : game.team_b_id;
    const loserId = game.score_a > game.score_b ? game.team_b_id : game.team_a_id;
    const winnerScore = Math.max(game.score_a, game.score_b);
    const loserScore = Math.min(game.score_a, game.score_b);
    recordResult(winnerId, loserId, winnerScore, loserScore, false);
  }

  const rows = Object.values(table).map((row) => ({
    ...row,
    pointDiff: row.pointsScored - row.pointsAllowed,
  }));

  rows.sort((a, b) => compareTeams(a, b, tiebreakers));

  rows.forEach((row, idx) => {
    row.rank = idx + 1;
  });

  // Manual override always wins last, applied as a final pass so committee
  // decisions can move a team to a specific rank without touching raw stats.
  const overridden = rows.filter((r) => r.manualOverride != null);
  if (overridden.length > 0) {
    const remaining = rows.filter((r) => r.manualOverride == null);
    const merged = new Array(rows.length).fill(null);
    overridden.forEach((r) => {
      const idx = Math.min(Math.max(r.manualOverride - 1, 0), rows.length - 1);
      merged[idx] = r;
    });
    let ptr = 0;
    for (let i = 0; i < merged.length; i++) {
      if (merged[i] === null) {
        while (ptr < remaining.length && merged.includes(remaining[ptr])) ptr++;
        merged[i] = remaining[ptr];
        ptr++;
      }
    }
    merged.forEach((row, idx) => {
      if (row) row.rank = idx + 1;
    });
    return merged.filter(Boolean).map(stripHeadToHead);
  }

  return rows.map(stripHeadToHead);
}

function computePickleballStandings(db, tournament, groupId, pointsConfig) {
  const entries = groupId
    ? db.prepare(
      `SELECT ce.*, (
         SELECT GROUP_CONCAT(DISTINCT p.affiliation)
         FROM competition_entry_members cem JOIN participants p ON p.id = cem.participant_id
         WHERE cem.competition_entry_id = ce.id AND p.affiliation IS NOT NULL AND TRIM(p.affiliation) != ''
       ) AS affiliation
       FROM competition_entries ce
       WHERE ce.tournament_id = ? AND ce.group_id = ? AND ce.status != 'disqualified'
       ORDER BY ce.seed_number IS NULL, ce.seed_number, ce.display_name, ce.id`
    ).all(tournament.id, groupId)
    : db.prepare(
      `SELECT ce.*, (
         SELECT GROUP_CONCAT(DISTINCT p.affiliation)
         FROM competition_entry_members cem JOIN participants p ON p.id = cem.participant_id
         WHERE cem.competition_entry_id = ce.id AND p.affiliation IS NOT NULL AND TRIM(p.affiliation) != ''
       ) AS affiliation
       FROM competition_entries ce
       WHERE ce.tournament_id = ? AND ce.status != 'disqualified'
       ORDER BY ce.seed_number IS NULL, ce.seed_number, ce.display_name, ce.id`
    ).all(tournament.id);

  const games = groupId
    ? db.prepare(
      `SELECT * FROM games WHERE tournament_id = ? AND group_id = ?
       AND status = 'completed' AND approved_at IS NOT NULL`
    ).all(tournament.id, groupId)
    : db.prepare(
      `SELECT * FROM games WHERE tournament_id = ?
       AND status = 'completed' AND approved_at IS NOT NULL`
    ).all(tournament.id);
  const gameIds = games.map((game) => game.id);
  const pointTotals = {};
  if (gameIds.length > 0) {
    const placeholders = gameIds.map(() => '?').join(',');
    db.prepare(
      `SELECT game_id, SUM(side_a_points) AS side_a_points, SUM(side_b_points) AS side_b_points
       FROM match_games WHERE game_id IN (${placeholders}) GROUP BY game_id`
    ).all(...gameIds).forEach((row) => { pointTotals[row.game_id] = row; });
  }

  const table = {};
  entries.forEach((entry) => {
    table[entry.id] = {
      entryId: entry.id,
      entryName: entry.display_name,
      entryType: entry.entry_type,
      division: entry.division,
      affiliation: entry.affiliation || null,
      seedNumber: entry.seed_number,
      // Legacy aliases keep existing compact dashboard/table consumers stable.
      teamId: entry.team_id,
      teamName: entry.display_name,
      purok: entry.affiliation || null,
      played: 0,
      wins: 0,
      losses: 0,
      gamesWon: 0,
      gamesLost: 0,
      gameDiff: 0,
      pointsScored: 0,
      pointsAllowed: 0,
      pointDiff: 0,
      leaguePoints: 0,
      manualOverride: entry.manual_rank_override,
      headToHead: {},
    };
  });

  games.forEach((game) => {
    const sideA = table[game.side_a_entry_id];
    const sideB = table[game.side_b_entry_id];
    if (!sideA || !sideB || game.score_a === null || game.score_b === null || game.score_a === game.score_b) return;
    const winner = game.winner_entry_id === game.side_a_entry_id || game.score_a > game.score_b ? sideA : sideB;
    const loser = winner === sideA ? sideB : sideA;
    const totals = pointTotals[game.id] || { side_a_points: 0, side_b_points: 0 };

    sideA.played += 1;
    sideB.played += 1;
    winner.wins += 1;
    loser.losses += 1;
    sideA.gamesWon += game.score_a;
    sideA.gamesLost += game.score_b;
    sideB.gamesWon += game.score_b;
    sideB.gamesLost += game.score_a;
    sideA.pointsScored += totals.side_a_points || 0;
    sideA.pointsAllowed += totals.side_b_points || 0;
    sideB.pointsScored += totals.side_b_points || 0;
    sideB.pointsAllowed += totals.side_a_points || 0;
    winner.leaguePoints += pointsConfig.win;
    loser.leaguePoints += pointsConfig.loss;
    if (!winner.headToHead[loser.entryId]) winner.headToHead[loser.entryId] = { wins: 0, losses: 0 };
    if (!loser.headToHead[winner.entryId]) loser.headToHead[winner.entryId] = { wins: 0, losses: 0 };
    winner.headToHead[loser.entryId].wins += 1;
    loser.headToHead[winner.entryId].losses += 1;
  });

  const rows = Object.values(table).map((row) => ({
    ...row,
    gameDiff: row.gamesWon - row.gamesLost,
    pointDiff: row.pointsScored - row.pointsAllowed,
  }));
  const tiedWinCounts = rows.reduce((counts, row) => {
    counts[row.wins] = (counts[row.wins] || 0) + 1;
    return counts;
  }, {});
  rows.sort((a, b) => {
    if (a.wins !== b.wins) return b.wins - a.wins;
    // Head-to-head is only used for an isolated two-entry tie. Multi-entry
    // circular ties proceed to aggregate differentials deterministically.
    if (tiedWinCounts[a.wins] === 2) {
      const headToHead = a.headToHead[b.entryId];
      if (headToHead && headToHead.wins !== headToHead.losses) return headToHead.losses - headToHead.wins;
    }
    if (a.gameDiff !== b.gameDiff) return b.gameDiff - a.gameDiff;
    if (a.pointDiff !== b.pointDiff) return b.pointDiff - a.pointDiff;
    if (a.pointsScored !== b.pointsScored) return b.pointsScored - a.pointsScored;
    const aSeed = a.seedNumber ?? Number.MAX_SAFE_INTEGER;
    const bSeed = b.seedNumber ?? Number.MAX_SAFE_INTEGER;
    if (aSeed !== bSeed) return aSeed - bSeed;
    const nameOrder = a.entryName.localeCompare(b.entryName);
    return nameOrder || a.entryId - b.entryId;
  });

  rows.forEach((row, index) => { row.rank = index + 1; });
  const overridden = rows.filter((row) => row.manualOverride != null);
  let ranked = rows;
  if (overridden.length > 0) {
    const remaining = rows.filter((row) => row.manualOverride == null);
    const merged = new Array(rows.length).fill(null);
    overridden.forEach((row) => {
      const index = Math.min(Math.max(row.manualOverride - 1, 0), rows.length - 1);
      if (merged[index] === null) merged[index] = row;
      else remaining.unshift(row);
    });
    let remainingIndex = 0;
    for (let index = 0; index < merged.length; index += 1) {
      if (merged[index] === null) merged[index] = remaining[remainingIndex++];
    }
    ranked = merged.filter(Boolean);
    ranked.forEach((row, index) => { row.rank = index + 1; });
  }
  return ranked.map(({ headToHead, ...row }) => row);
}

function stripHeadToHead(row) {
  const { headToHead, ...rest } = row;
  return rest;
}

function compareTeams(a, b, tiebreakers) {
  for (const key of tiebreakers) {
    let result = 0;
    switch (key) {
      case 'wins':
        result = b.wins - a.wins;
        break;
      case 'points':
        result = b.leaguePoints - a.leaguePoints;
        break;
      case 'head_to_head': {
        const ab = a.headToHead[b.teamId];
        if (ab) result = ab.losses - ab.wins; // a's wins over b should sort a first
        break;
      }
      case 'point_diff':
        result = b.pointDiff - a.pointDiff;
        break;
      case 'points_scored':
        result = b.pointsScored - a.pointsScored;
        break;
      case 'manual':
      default:
        result = 0;
    }
    if (result !== 0) return result;
  }
  return a.teamName.localeCompare(b.teamName);
}

function saveSnapshot(db, tournamentId, groupId, rows) {
  db.prepare(
    `INSERT INTO standings_snapshots (tournament_id, group_id, data_json) VALUES (?, ?, ?)`
  ).run(tournamentId, groupId || null, JSON.stringify(rows));
}

module.exports = { computeStandings, saveSnapshot };
