function serviceError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function cleanText(value, label, { required = false, max = 160 } = {}) {
  if (value === undefined || value === null) {
    if (required) throw serviceError(400, `${label} is required.`);
    return null;
  }
  if (typeof value !== 'string') throw serviceError(400, `${label} must be text.`);
  const cleaned = value.trim();
  if (required && !cleaned) throw serviceError(400, `${label} is required.`);
  if (cleaned.length > max) throw serviceError(400, `${label} must be ${max} characters or fewer.`);
  return cleaned || null;
}

function normalizeOptionalPositiveInteger(value, label) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw serviceError(400, `${label} must be a positive whole number or null.`);
  }
  return value;
}

function getEntryMembers(db, entryId) {
  return db.prepare(
    `SELECT cem.id, cem.participant_id, cem.member_order, cem.role,
            p.display_name, p.affiliation, p.status
     FROM competition_entry_members cem
     JOIN participants p ON p.id = cem.participant_id
     WHERE cem.competition_entry_id = ?
     ORDER BY cem.member_order, cem.id`
  ).all(entryId);
}

function resolveEntryDisplayName(entry, members = []) {
  if (entry.entry_type === 'team') return entry.team_name || entry.display_name;
  return entry.display_name || members.map((member) => member.display_name).join(' / ');
}

function serializeEntry(entry, members = []) {
  return {
    id: entry.id,
    tournament_id: entry.tournament_id,
    entry_type: entry.entry_type,
    display_name: resolveEntryDisplayName(entry, members),
    display_name_override: entry.entry_type === 'team' ? null : entry.display_name,
    team_id: entry.team_id,
    division: entry.division,
    group_id: entry.group_id,
    group_name: entry.group_name || null,
    seed_number: entry.seed_number,
    manual_rank_override: entry.manual_rank_override,
    status: entry.status,
    withdrawal_reason: entry.withdrawal_reason,
    members: members.map((member) => ({
      id: member.id,
      participant_id: member.participant_id,
      member_order: member.member_order,
      role: member.role,
      display_name: member.display_name,
      affiliation: member.affiliation,
      status: member.status,
    })),
    created_at: entry.created_at,
    updated_at: entry.updated_at,
  };
}

function serializePublicEntry(entry) {
  return {
    id: entry.id,
    entry_type: entry.entry_type,
    display_name: entry.display_name,
    division: entry.division,
    affiliation: entry.affiliation || null,
    members: (entry.members || []).map((member) => ({
      display_name: member.display_name,
      affiliation: member.affiliation || null,
      member_order: member.member_order,
    })),
  };
}

function entrySelect(db, where, ...params) {
  return db.prepare(
    `SELECT ce.*, tm.name AS team_name, gt.name AS group_name
     FROM competition_entries ce
     LEFT JOIN teams tm ON tm.id = ce.team_id
     LEFT JOIN groups_table gt ON gt.id = ce.group_id
     ${where}`
  ).all(...params).map((entry) => ({ ...entry, db }));
}

function getEntry(db, tournamentId, entryId) {
  const entry = entrySelect(db, 'WHERE ce.id = ? AND ce.tournament_id = ?', entryId, tournamentId)[0];
  if (!entry) throw serviceError(404, 'Competition entry not found in this tournament.');
  return serializeEntry(entry, getEntryMembers(db, entry.id));
}

function listEntries(db, tournamentId, filters = {}) {
  const tournament = db.prepare('SELECT id FROM tournaments WHERE id = ?').get(tournamentId);
  if (!tournament) throw serviceError(404, 'Tournament not found.');
  const clauses = ['ce.tournament_id = ?'];
  const params = [tournamentId];
  for (const [field, value] of [['status', filters.status], ['entry_type', filters.entry_type], ['division', filters.division]]) {
    if (value) {
      clauses.push(`ce.${field} = ?`);
      params.push(value);
    }
  }
  if (filters.search) {
    clauses.push(`(LOWER(COALESCE(tm.name, ce.display_name, '')) LIKE ? OR EXISTS (
      SELECT 1 FROM competition_entry_members sm
      JOIN participants sp ON sp.id = sm.participant_id
      WHERE sm.competition_entry_id = ce.id AND LOWER(sp.display_name) LIKE ?
    ))`);
    const search = `%${String(filters.search).trim().toLowerCase()}%`;
    params.push(search, search);
  }
  const entries = entrySelect(
    db,
    `WHERE ${clauses.join(' AND ')} ORDER BY ce.seed_number IS NULL, ce.seed_number, COALESCE(tm.name, ce.display_name), ce.id`,
    ...params,
  );
  if (entries.length === 0) return [];
  const placeholders = entries.map(() => '?').join(',');
  const membersByEntry = {};
  db.prepare(
    `SELECT cem.id, cem.competition_entry_id, cem.participant_id, cem.member_order, cem.role,
            p.display_name, p.affiliation, p.status
     FROM competition_entry_members cem
     JOIN participants p ON p.id = cem.participant_id
     WHERE cem.competition_entry_id IN (${placeholders})
     ORDER BY cem.competition_entry_id, cem.member_order, cem.id`
  ).all(...entries.map((entry) => entry.id)).forEach((member) => {
    if (!membersByEntry[member.competition_entry_id]) membersByEntry[member.competition_entry_id] = [];
    membersByEntry[member.competition_entry_id].push(member);
  });
  return entries.map((entry) => serializeEntry(entry, membersByEntry[entry.id] || []));
}

function validateParticipantsAvailable(db, tournamentId, division, participantIds, excludeEntryId = null) {
  const placeholders = participantIds.map(() => '?').join(',');
  const participants = db.prepare(
    `SELECT id, display_name, affiliation, status FROM participants
     WHERE id IN (${placeholders}) ORDER BY id`
  ).all(...participantIds);
  if (participants.length !== participantIds.length || participants.some((participant) => participant.status !== 'active')) {
    throw serviceError(400, 'Every entry member must be an active participant.');
  }

  const duplicate = db.prepare(
    `SELECT p.display_name
     FROM competition_entries ce
     JOIN competition_entry_members cem ON cem.competition_entry_id = ce.id
     JOIN participants p ON p.id = cem.participant_id
     WHERE ce.tournament_id = ? AND ce.division = ? AND ce.status = 'active'
       AND cem.participant_id IN (${placeholders})
       ${excludeEntryId ? 'AND ce.id != ?' : ''}
     LIMIT 1`
  ).get(tournamentId, division, ...participantIds, ...(excludeEntryId ? [excludeEntryId] : []));
  if (duplicate) {
    throw serviceError(409, `${duplicate.display_name} already has an active entry in this tournament division.`);
  }
  return participants;
}

function createEntry(db, tournamentId, body = {}) {
  const tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(tournamentId);
  if (!tournament) throw serviceError(404, 'Tournament not found.');
  const entryType = body.entry_type;
  if (!['team', 'individual', 'pair'].includes(entryType)) {
    throw serviceError(400, 'entry_type must be team, individual, or pair.');
  }
  if (tournament.sport === 'pickleball') {
    const expectedType = tournament.competition_format === 'singles' ? 'individual' : 'pair';
    if (entryType !== expectedType) {
      throw serviceError(400, `This Pickleball tournament requires ${expectedType} entries.`);
    }
    if (body.division !== undefined && body.division !== tournament.division) {
      throw serviceError(400, 'Entry division must match the Pickleball tournament division.');
    }
  }
  const division = cleanText(body.division ?? tournament.category ?? 'Open', 'Division', { required: true, max: 80 });
  const displayName = cleanText(body.display_name, 'Display name');
  const seedNumber = normalizeOptionalPositiveInteger(body.seed_number, 'Seed number');
  const memberIds = body.participant_ids === undefined ? [] : body.participant_ids;
  if (!Array.isArray(memberIds)) throw serviceError(400, 'participant_ids must be an array.');

  const create = db.transaction(() => {
    let teamId = null;
    let resolvedDisplayName = displayName;
    let participants = [];
    if (entryType === 'team') {
      if (memberIds.length !== 0) throw serviceError(400, 'Team entries cannot have generic participant members.');
      if (typeof body.team_id !== 'number' || !Number.isSafeInteger(body.team_id)) {
        throw serviceError(400, 'A valid team_id is required for a team entry.');
      }
      const team = db.prepare('SELECT * FROM teams WHERE id = ? AND tournament_id = ?').get(body.team_id, tournamentId);
      if (!team) throw serviceError(400, 'Team not found in this tournament.');
      teamId = team.id;
      resolvedDisplayName = team.name;
    } else {
      if (body.team_id !== undefined && body.team_id !== null) {
        throw serviceError(400, 'Individual and pair entries cannot reference a team.');
      }
      const requiredCount = entryType === 'individual' ? 1 : 2;
      if (memberIds.length !== requiredCount || memberIds.some((id) => typeof id !== 'number' || !Number.isSafeInteger(id))) {
        throw serviceError(400, `${entryType === 'individual' ? 'Individual' : 'Pair'} entries require exactly ${requiredCount} participant${requiredCount === 1 ? '' : 's'}.`);
      }
      const orderedIds = [...memberIds].sort((a, b) => a - b);
      if (new Set(orderedIds).size !== orderedIds.length) {
        throw serviceError(400, 'The same participant cannot appear twice in one entry.');
      }
      participants = validateParticipantsAvailable(db, tournamentId, division, orderedIds);
      resolvedDisplayName = displayName || participants.map((participant) => participant.display_name).join(' / ');
    }

    let result;
    try {
      result = db.prepare(
        `INSERT INTO competition_entries (
           tournament_id, entry_type, display_name, team_id, division, seed_number, status
         ) VALUES (?, ?, ?, ?, ?, ?, 'active')`
      ).run(tournamentId, entryType, resolvedDisplayName, teamId, division, seedNumber);
    } catch (error) {
      if (String(error.code).includes('SQLITE_CONSTRAINT')) {
        throw serviceError(409, 'That active competition entry or seed already exists in this tournament division.');
      }
      throw error;
    }
    participants.forEach((participant, index) => {
      db.prepare(
        'INSERT INTO competition_entry_members (competition_entry_id, participant_id, member_order) VALUES (?, ?, ?)'
      ).run(result.lastInsertRowid, participant.id, index + 1);
    });
    return result.lastInsertRowid;
  });
  const entryId = create();
  return getEntry(db, tournamentId, entryId);
}

function updateEntry(db, tournamentId, entryId, body = {}) {
  const current = getEntry(db, tournamentId, entryId);
  const updates = [];
  const params = [];
  if (body.display_name !== undefined) {
    if (current.entry_type === 'team') throw serviceError(400, 'Team entry names are managed through the team record.');
    updates.push('display_name = ?');
    params.push(cleanText(body.display_name, 'Display name'));
  }
  if (body.division !== undefined) {
    const division = cleanText(body.division, 'Division', { required: true, max: 80 });
    if (current.members.length > 0) {
      validateParticipantsAvailable(db, tournamentId, division, current.members.map((member) => member.participant_id), Number(entryId));
    }
    updates.push('division = ?');
    params.push(division);
  }
  if (body.seed_number !== undefined) {
    updates.push('seed_number = ?');
    params.push(normalizeOptionalPositiveInteger(body.seed_number, 'Seed number'));
  }
  if (body.manual_rank_override !== undefined) {
    updates.push('manual_rank_override = ?');
    params.push(normalizeOptionalPositiveInteger(body.manual_rank_override, 'Manual rank override'));
  }
  if (updates.length === 0) return current;
  params.push(entryId, tournamentId);
  try {
    db.prepare(
      `UPDATE competition_entries SET ${updates.join(', ')}, updated_at = datetime('now')
       WHERE id = ? AND tournament_id = ?`
    ).run(...params);
  } catch (error) {
    if (String(error.code).includes('SQLITE_CONSTRAINT')) throw serviceError(409, 'That active seed is already in use.');
    throw error;
  }
  return getEntry(db, tournamentId, entryId);
}

function withdrawEntry(db, tournamentId, entryId, reason) {
  const current = getEntry(db, tournamentId, entryId);
  if (current.status !== 'active') throw serviceError(409, 'Only an active entry can be withdrawn.');
  const cleanedReason = cleanText(reason, 'Withdrawal reason', { max: 500 });
  const withdraw = db.transaction(() => {
    if (current.entry_type === 'team') {
      db.prepare("UPDATE teams SET status = 'withdrawn', updated_at = datetime('now') WHERE id = ?").run(current.team_id);
    }
    db.prepare(
      `UPDATE competition_entries SET status = 'withdrawn', withdrawal_reason = ?, updated_at = datetime('now')
       WHERE id = ? AND tournament_id = ? AND status = 'active'`
    ).run(cleanedReason, entryId, tournamentId);
  });
  withdraw();
  return getEntry(db, tournamentId, entryId);
}

module.exports = {
  createEntry,
  getEntry,
  getEntryMembers,
  listEntries,
  resolveEntryDisplayName,
  serializePublicEntry,
  updateEntry,
  withdrawEntry,
};
