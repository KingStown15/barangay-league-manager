const { initDatabase, DB_PATH } = require('./init');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const db = initDatabase();

console.log('Clearing existing seedable data...');
db.exec(`
  DELETE FROM game_period_scores;
  DELETE FROM standings_snapshots;
  DELETE FROM audit_logs;
  DELETE FROM games;
  DELETE FROM competition_entry_members;
  DELETE FROM competition_entries;
  DELETE FROM participants;
  DELETE FROM players;
  DELETE FROM teams;
  DELETE FROM groups_table;
  DELETE FROM stages;
  DELETE FROM tournaments;
`);

const adminUser = db.prepare(
  "SELECT id FROM users WHERE role IN ('super_admin', 'admin') AND status = 'active' ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, id LIMIT 1"
).get();
if (!adminUser) throw new Error('No active admin account exists. Initialize the database before seeding demo data.');
const adminId = adminUser.id;

// Create scorer users (if not already exist)
const scorerPassword = String(process.env.BLM_DEMO_PASSWORD || '').trim() || crypto.randomBytes(18).toString('base64url');
const scorerHash = bcrypt.hashSync(scorerPassword, 10);
const upsertUser = db.prepare(
  'INSERT OR IGNORE INTO users (username, password_hash, role, status) VALUES (?, ?, ?, ?)'
);
upsertUser.run('scorer1', scorerHash, 'scorer', 'active');
upsertUser.run('scorer2', scorerHash, 'scorer', 'active');
const scorer1Id = db.prepare("SELECT id FROM users WHERE username = 'scorer1'").get().id;
const scorer2Id = db.prepare("SELECT id FROM users WHERE username = 'scorer2'").get().id;

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

// ============================================================
// TOURNAMENT 1: 2026 Inter-Purok Basketball League
// Groups + Playoffs, 8 teams, May 2 – Jun 20
// ============================================================

const t1Id = db.prepare(`
  INSERT INTO tournaments (name, sport, category, format, venue, start_date, end_date, status, groups_count, advancing_per_group, third_place_game)
  VALUES (?, 'basketball', 'Open', 'groups_playoffs', ?, ?, ?, 'active', 2, 2, 1)
`).run('2026 Inter-Purok Basketball League', 'Barangay Covered Court', '2026-05-02', '2026-06-20').lastInsertRowid;

const insertStage = db.prepare('INSERT INTO stages (tournament_id, name, type, order_index) VALUES (?, ?, ?, ?)');
const t1GroupStageId = insertStage.run(t1Id, 'Group Stage', 'group', 0).lastInsertRowid;
const t1PlayoffStageId = insertStage.run(t1Id, 'Playoffs', 'playoff', 1).lastInsertRowid;

const insertGroup = db.prepare('INSERT INTO groups_table (tournament_id, stage_id, name, order_index) VALUES (?, ?, ?, ?)');
const t1GroupAId = insertGroup.run(t1Id, t1GroupStageId, 'Group A', 0).lastInsertRowid;
const t1GroupBId = insertGroup.run(t1Id, t1GroupStageId, 'Group B', 1).lastInsertRowid;

const t1Teams = [
  { name: 'Purok 1 Warriors',   purok: 'Purok 1', coach: 'Coach Alpha', groupId: t1GroupAId },
  { name: 'Purok 3 Snipers',    purok: 'Purok 3', coach: 'Coach Bravo', groupId: t1GroupAId },
  { name: 'Purok 5 Kings',      purok: 'Purok 5', coach: 'Coach Charlie', groupId: t1GroupAId },
  { name: 'Purok 7 Hawks',      purok: 'Purok 7', coach: 'Coach Delta', groupId: t1GroupAId },
  { name: 'Purok 2 Eagles',     purok: 'Purok 2', coach: 'Coach Echo', groupId: t1GroupBId },
  { name: 'Purok 4 Titans',     purok: 'Purok 4', coach: 'Coach Foxtrot', groupId: t1GroupBId },
  { name: 'Purok 6 Bolts',      purok: 'Purok 6', coach: 'Coach Golf', groupId: t1GroupBId },
  { name: 'Purok 8 Dragons',    purok: 'Purok 8', coach: 'Coach Hotel', groupId: t1GroupBId },
];

const insertTeam = db.prepare(`
  INSERT INTO teams (tournament_id, group_id, name, purok, coach_name) VALUES (?, ?, ?, ?, ?)
`);
const t1TeamIds = t1Teams.map(t =>
  insertTeam.run(t1Id, t.groupId, t.name, t.purok, t.coach).lastInsertRowid
);

// Create 12 players per team
const firstNames = ['Demo', 'Sample', 'Example', 'Test', 'Open', 'Public', 'League', 'Court', 'Score', 'Match', 'Rally', 'Bracket', 'Round', 'Seed', 'Serve', 'Point', 'Final', 'Play', 'Team', 'Game'];
const lastNames = ['Player01', 'Player02', 'Player03', 'Player04', 'Player05', 'Player06', 'Player07', 'Player08', 'Player09', 'Player10', 'Player11', 'Player12', 'Player13', 'Player14', 'Player15', 'Player16', 'Player17', 'Player18', 'Player19', 'Player20'];

const insertPlayer = db.prepare(`
  INSERT INTO players (tournament_id, team_id, full_name, jersey_number, age) VALUES (?, ?, ?, ?, ?)
`);

let playerCount = 0;
t1TeamIds.forEach((teamId, tIdx) => {
  for (let p = 0; p < 12; p++) {
    const fn = firstNames[(tIdx * 12 + p) % firstNames.length];
    const ln = lastNames[(tIdx * 12 + p * 3) % lastNames.length];
    insertPlayer.run(t1Id, teamId, `${fn} ${ln}`, String(p + 1), 18 + (p % 8));
    playerCount++;
  }
});

// Group A: Warriors(0), Snipers(1), Kings(2), Hawks(3)
// Group B: Eagles(4), Titans(5), Bolts(6), Dragons(7)
//
// Circle-method round-robin for 4 teams per group produces 3 rounds:
//   R1: [0,3] [1,2]    R2: [0,2] [3,1]    R3: [0,1] [2,3]
//   R1: [4,7] [5,6]    R2: [4,6] [7,5]    R3: [4,5] [6,7]
//
// Desired standings:
//   Group A: 1.Warriors(3-0) 2.Kings(2-1) 3.Snipers(1-2) 4.Hawks(0-3)
//   Group B: 1.Eagles(3-0) 2.Titans(2-1) 3.Bolts(1-2) 4.Dragons(0-3)

const t1GroupAGames = [
  { a: 0, b: 3, sa: 88, sb: 62, date: '2026-05-02 09:00' },
  { a: 1, b: 2, sa: 71, sb: 79, date: '2026-05-02 14:00' },
  { a: 0, b: 2, sa: 85, sb: 76, date: '2026-05-09 09:00' },
  { a: 3, b: 1, sa: 58, sb: 73, date: '2026-05-09 14:00' },
  { a: 0, b: 1, sa: 92, sb: 78, date: '2026-05-16 09:00' },
  { a: 2, b: 3, sa: 81, sb: 65, date: '2026-05-16 14:00' },
];

const t1GroupBGames = [
  { a: 4, b: 7, sa: 95, sb: 60, date: '2026-05-03 09:00' },
  { a: 5, b: 6, sa: 77, sb: 68, date: '2026-05-03 14:00' },
  { a: 4, b: 6, sa: 82, sb: 74, date: '2026-05-10 09:00' },
  { a: 7, b: 5, sa: 55, sb: 80, date: '2026-05-10 14:00' },
  { a: 4, b: 5, sa: 79, sb: 71, date: '2026-05-17 09:00' },
  { a: 6, b: 7, sa: 84, sb: 70, date: '2026-05-17 14:00' },
];

const insertGame = db.prepare(`
  INSERT INTO games (tournament_id, stage_id, group_id, round_label, team_a_id, team_b_id, scheduled_at, venue, status, score_a, score_b, winner_team_id, submitted_by, submitted_at, approved_by, approved_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?)
`);

const insertPeriodScore = db.prepare(`
  INSERT INTO game_period_scores (game_id, period_number, team_a_score, team_b_score) VALUES (?, ?, ?, ?)
`);

function createGame(tId, stageId, groupId, label, aIdx, bIdx, sa, sb, dateStr, gameId) {
  const teamA = t1TeamIds[aIdx];
  const teamB = t1TeamIds[bIdx];
  const winner = sa > sb ? teamA : teamB;
  const subAt = `${dateStr.slice(0, 10)}T${String(rand(10, 16)).padStart(2, '0')}:00:00Z`;
  const appAt = `${dateStr.slice(0, 10)}T${String(rand(12, 18)).padStart(2, '0')}:00:00Z`;
  const gid = insertGame.run(tId, stageId, groupId, label, teamA, teamB, `${dateStr}:00`, 'Barangay Covered Court', sa, sb, winner, adminId, subAt, adminId, appAt).lastInsertRowid;

  // Per-quarter scores
  const q1a = Math.round(sa * (rand(20, 35) / 100));
  const q1b = Math.round(sb * (rand(20, 35) / 100));
  const q2a = Math.round(sa * (rand(20, 30) / 100));
  const q2b = Math.round(sb * (rand(20, 30) / 100));
  const q3a = Math.round(sa * (rand(20, 30) / 100));
  const q3b = Math.round(sb * (rand(20, 30) / 100));
  const q4a = sa - q1a - q2a - q3a;
  const q4b = sb - q1b - q2b - q3b;
  insertPeriodScore.run(gid, 1, q1a, q1b);
  insertPeriodScore.run(gid, 2, q2a, q2b);
  insertPeriodScore.run(gid, 3, q3a, q3b);
  insertPeriodScore.run(gid, 4, q4a, q4b);
  return gid;
}

t1GroupAGames.forEach(g => createGame(t1Id, t1GroupStageId, t1GroupAId, 'Group Stage', g.a, g.b, g.sa, g.sb, g.date));
t1GroupBGames.forEach(g => createGame(t1Id, t1GroupStageId, t1GroupBId, 'Group Stage', g.a, g.b, g.sa, g.sb, g.date));

// Playoffs
// SF1: Warriors(0) vs Titans(5) -> Warriors win 78-65
// SF2: Eagles(4) vs Kings(2) -> Eagles win 82-74
// Final: Warriors vs Eagles (scheduled Jun 20)
// 3rd Place: Titans vs Kings (scheduled Jun 20)

const sf1Id = db.prepare(`
  INSERT INTO games (tournament_id, stage_id, round_label, bracket_slot, team_a_id, team_b_id, scheduled_at, venue, status, score_a, score_b, winner_team_id, submitted_by, submitted_at, approved_by, approved_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', 78, 65, ?, ?, ?, ?, ?)
`).run(t1Id, t1PlayoffStageId, 'Semifinals', 'R1-1', t1TeamIds[0], t1TeamIds[5], '2026-06-13 09:00:00', 'Barangay Covered Court', t1TeamIds[0], adminId, '2026-06-13T11:00:00Z', adminId, '2026-06-13T12:00:00Z').lastInsertRowid;

const sf2Id = db.prepare(`
  INSERT INTO games (tournament_id, stage_id, round_label, bracket_slot, team_a_id, team_b_id, scheduled_at, venue, status, score_a, score_b, winner_team_id, submitted_by, submitted_at, approved_by, approved_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', 82, 74, ?, ?, ?, ?, ?)
`).run(t1Id, t1PlayoffStageId, 'Semifinals', 'R1-2', t1TeamIds[4], t1TeamIds[2], '2026-06-13 14:00:00', 'Barangay Covered Court', t1TeamIds[4], adminId, '2026-06-13T16:00:00Z', adminId, '2026-06-13T17:00:00Z').lastInsertRowid;

const finalId = db.prepare(`
  INSERT INTO games (tournament_id, stage_id, round_label, bracket_slot, team_a_id, team_b_id, scheduled_at, venue, status)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scheduled')
`).run(t1Id, t1PlayoffStageId, 'Finals', 'R2-1', t1TeamIds[0], t1TeamIds[4], '2026-06-20 15:00:00', 'Barangay Covered Court').lastInsertRowid;

const thirdPlaceId = db.prepare(`
  INSERT INTO games (tournament_id, stage_id, round_label, bracket_slot, team_a_id, team_b_id, scheduled_at, venue, status)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scheduled')
`).run(t1Id, t1PlayoffStageId, 'Third Place', '3RD', t1TeamIds[5], t1TeamIds[2], '2026-06-20 12:00:00', 'Barangay Covered Court').lastInsertRowid;

// Link bracket feeders: SF1 -> Final (A), SF2 -> Final (B)
db.prepare('UPDATE games SET feeds_game_id = ?, feeds_slot = ? WHERE id = ?').run(finalId, 'A', sf1Id);
db.prepare('UPDATE games SET feeds_game_id = ?, feeds_slot = ? WHERE id = ?').run(finalId, 'B', sf2Id);

// ============================================================
// TOURNAMENT 2: Summer Volleyball Cup
// Round Robin, 6 teams, Jun 6 – Aug 2
// ============================================================

const t2Id = db.prepare(`
  INSERT INTO tournaments (name, sport, category, format, venue, start_date, end_date, status)
  VALUES (?, 'volleyball', 'Open', 'round_robin', ?, ?, ?, 'active')
`).run('Summer Volleyball Cup', 'Barangay Gymnasium', '2026-06-06', '2026-08-02').lastInsertRowid;

const t2Teams = [
  { name: 'Purok 1 Spikers',   purok: 'Purok 1', coach: 'Coach Alpha' },
  { name: 'Purok 2 Blockers',  purok: 'Purok 2', coach: 'Coach Bravo' },
  { name: 'Purok 3 Diggers',   purok: 'Purok 3', coach: 'Coach Charlie' },
  { name: 'Purok 4 Aces',      purok: 'Purok 4', coach: 'Coach Delta' },
  { name: 'Purok 5 Setters',   purok: 'Purok 5', coach: 'Coach Echo' },
  { name: 'Purok 6 Liberos',   purok: 'Purok 6', coach: 'Coach Foxtrot' },
];

const insertTeam2 = db.prepare(`
  INSERT INTO teams (tournament_id, name, purok, coach_name) VALUES (?, ?, ?, ?)
`);
const t2TeamIds = t2Teams.map(t => insertTeam2.run(t2Id, t.name, t.purok, t.coach).lastInsertRowid);

const insertPlayer2 = db.prepare(`
  INSERT INTO players (tournament_id, team_id, full_name, jersey_number, age) VALUES (?, ?, ?, ?, ?)
`);
t2TeamIds.forEach((teamId, tIdx) => {
  for (let p = 0; p < 8; p++) {
    const fn = firstNames[(tIdx * 8 + p) % firstNames.length];
    const ln = lastNames[(tIdx * 8 + p * 3) % lastNames.length];
    insertPlayer2.run(t2Id, teamId, `${fn} ${ln}`, String(p + 1), 19 + (p % 7));
    playerCount++;
  }
});

// Circle-method for 6 teams produces 5 rounds:
//   R1: [0,5] [1,4] [2,3]
//   R2: [0,4] [5,3] [1,2]
//   R3: [0,3] [4,2] [5,1]
//   R4: [0,2] [3,1] [4,5]
//   R5: [0,1] [2,5] [3,4]

const t2Rounds = [
  // Round 1 (Jun 6-7) -> completed
  { week: '2026-06-06', games: [
    { a: 0, b: 5, sa: 3, sb: 0, sc: '3-0' },
    { a: 1, b: 4, sa: 3, sb: 1, sc: '3-1' },
    { a: 2, b: 3, sa: 2, sb: 3, sc: '2-3' },
  ]},
  // Round 2 (Jun 13-14) -> completed
  { week: '2026-06-13', games: [
    { a: 0, b: 4, sa: 3, sb: 1, sc: '3-1' },
    { a: 5, b: 3, sa: 0, sb: 3, sc: '0-3' },
    { a: 1, b: 2, sa: 3, sb: 0, sc: '3-0' },
  ]},
  // Round 3 (Jun 20-21) -> completed
  { week: '2026-06-20', games: [
    { a: 0, b: 3, sa: 3, sb: 0, sc: '3-0' },
    { a: 4, b: 2, sa: 1, sb: 3, sc: '1-3' },
    { a: 5, b: 1, sa: 2, sb: 3, sc: '2-3' },
  ]},
  // Round 4 (Jun 27-28) -> scheduled
  { week: '2026-06-27', games: [
    { a: 0, b: 2, sa: 0, sb: 0 },
    { a: 3, b: 1, sa: 0, sb: 0 },
    { a: 4, b: 5, sa: 0, sb: 0 },
  ]},
  // Round 5 (Jul 4-5) -> scheduled
  { week: '2026-07-04', games: [
    { a: 0, b: 1, sa: 0, sb: 0 },
    { a: 2, b: 5, sa: 0, sb: 0 },
    { a: 3, b: 4, sa: 0, sb: 0 },
  ]},
];

const insertGame2 = db.prepare(`
  INSERT INTO games (tournament_id, round_label, team_a_id, team_b_id, scheduled_at, venue, status, score_a, score_b, winner_team_id, submitted_by, submitted_at, approved_by, approved_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

t2Rounds.forEach((round, rIdx) => {
  const isCompleted = rIdx < 3;
  const times = ['09:00', '11:00', '14:00'];
  round.games.forEach((g, gIdx) => {
    const teamA = t2TeamIds[g.a];
    const teamB = t2TeamIds[g.b];
    const winner = isCompleted ? (g.sa > g.sb ? teamA : teamB) : null;
    const status = isCompleted ? 'completed' : 'scheduled';
    const subAt = isCompleted ? `${round.week}T${String(11 + gIdx * 2).padStart(2, '0')}:00:00Z` : null;
    const appAt = isCompleted ? `${round.week}T${String(13 + gIdx * 2).padStart(2, '0')}:00:00Z` : null;
    const subBy = isCompleted ? (gIdx % 2 === 0 ? scorer1Id : scorer2Id) : null;
    const appBy = isCompleted ? adminId : null;

    insertGame2.run(t2Id, `Round ${rIdx + 1}`, teamA, teamB,
      `${round.week} ${times[gIdx]}:00`, 'Barangay Gymnasium',
      status, g.sa || null, g.sb || null, winner,
      subBy, subAt, appBy, appAt);
  });
});

// ============================================================
// TOURNAMENT 3: Purok Cup Single Elimination
// Single Elimination, 8 teams, Jul 4 – Jul 25
// ============================================================

const t3Id = db.prepare(`
  INSERT INTO tournaments (name, sport, category, format, venue, start_date, end_date, groups_count, advancing_per_group, status)
  VALUES (?, 'basketball', 'Open', 'single_elimination', ?, ?, ?, 0, 0, 'active')
`).run('Purok Cup Single Elimination', 'Barangay Covered Court', '2026-07-04', '2026-07-25').lastInsertRowid;

const t3Teams = [
  { name: 'Purok 1 Bulldogs',   purok: 'Purok 1', coach: 'Coach Alpha' },
  { name: 'Purok 2 Wildcats',   purok: 'Purok 2', coach: 'Coach Bravo' },
  { name: 'Purok 3 Panthers',   purok: 'Purok 3', coach: 'Coach Charlie' },
  { name: 'Purok 4 Tigers',     purok: 'Purok 4', coach: 'Coach Delta' },
  { name: 'Purok 5 Eagles',     purok: 'Purok 5', coach: 'Coach Echo' },
  { name: 'Purok 6 Falcons',    purok: 'Purok 6', coach: 'Coach Foxtrot' },
  { name: 'Purok 7 Wolves',     purok: 'Purok 7', coach: 'Coach Golf' },
  { name: 'Purok 8 Bears',      purok: 'Purok 8', coach: 'Coach Hotel' },
];

const insertTeam3 = db.prepare(`
  INSERT INTO teams (tournament_id, name, purok, coach_name) VALUES (?, ?, ?, ?)
`);
const t3TeamIds = t3Teams.map(t => insertTeam3.run(t3Id, t.name, t.purok, t.coach).lastInsertRowid);

const insertPlayer3 = db.prepare(`
  INSERT INTO players (tournament_id, team_id, full_name, jersey_number, age) VALUES (?, ?, ?, ?, ?)
`);
t3TeamIds.forEach((teamId, tIdx) => {
  for (let p = 0; p < 10; p++) {
    const fn = firstNames[(tIdx * 10 + p) % firstNames.length];
    const ln = lastNames[(tIdx * 10 + p * 3) % lastNames.length];
    insertPlayer3.run(t3Id, teamId, `${fn} ${ln}`, String(p + 1), 18 + (p % 9));
    playerCount++;
  }
});

// Generate bracket via backend service
const { generateSingleEliminationBracket } = require('../services/bracketService');
const t3Rounds = generateSingleEliminationBracket(t3TeamIds);

const t3StageId = db.prepare("INSERT INTO stages (tournament_id, name, type, order_index) VALUES (?, ?, ?, 0)")
  .run(t3Id, 'Bracket', 'playoff').lastInsertRowid;

const t3BracketDates = ['2026-07-05', '2026-07-12', '2026-07-19', '2026-07-25'];
const t3Times = ['09:00', '11:00', '14:00', '16:00'];

const insertGame3 = db.prepare(`
  INSERT INTO games (tournament_id, stage_id, round_label, bracket_slot, team_a_id, team_b_id, scheduled_at, venue, status, score_a, score_b, winner_team_id, submitted_by, submitted_at, approved_by, approved_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const t3SlotToGameId = {};
let gameOrder = 0;

t3Rounds.forEach((round, rIdx) => {
  round.matches.forEach((match) => {
    const isScheduled = rIdx >= 2;
    const dateStr = t3BracketDates[rIdx] || '2026-07-25';
    const timeStr = t3Times[gameOrder % 4];
    const teamA = match.teamAId;
    const teamB = match.teamBId;

    let sa = null, sb = null, winner = null, subBy = null, subAt = null, appBy = null, appAt = null;
    let status = 'scheduled';

    if (!isScheduled && teamA !== null && teamB !== null) {
      status = 'completed';
      // Simulate realistic scores based on team index
      const aStr = (teamA % 10 + 5) * 10 + (teamA % 7 + 1);
      const bStr = (teamB % 10 + 5) * 10 + (teamB % 9 + 1);
      sa = Math.max(aStr, 50);
      sb = Math.max(bStr, 50);
      if (sa === sb) sb += 4;
      winner = sa > sb ? teamA : teamB;
      if (sa < sb) [sa, sb] = [sb, sa];
      subBy = gameOrder % 2 === 0 ? scorer1Id : scorer2Id;
      subAt = `${dateStr}T${String(10 + gameOrder).padStart(2, '0')}:00:00Z`;
      appBy = adminId;
      appAt = `${dateStr}T${String(12 + gameOrder).padStart(2, '0')}:00:00Z`;
    }

    const gid = insertGame3.run(t3Id, t3StageId, round.name, match.slot, teamA, teamB,
      `${dateStr} ${timeStr}:00`, 'Barangay Covered Court',
      status, sa, sb, winner, subBy, subAt, appBy, appAt).lastInsertRowid;

    t3SlotToGameId[match.slot] = gid;
    gameOrder++;

    // Link feeder relationships
    if (match.feedsSlot) {
      const feedGid = t3SlotToGameId[match.feedsSlot];
      if (feedGid) {
        db.prepare('UPDATE games SET feeds_game_id = ?, feeds_slot = ? WHERE id = ?')
          .run(feedGid, match.feedsSide, gid);
      }
    }

    // Auto-advance byes
    if (match.byeWinner && match.feedsSlot) {
      const targetGameId = t3SlotToGameId[match.feedsSlot];
      if (targetGameId) {
        const column = match.feedsSide === 'A' ? 'team_a_id' : 'team_b_id';
        db.prepare(`UPDATE games SET ${column} = ? WHERE id = ?`).run(match.byeWinner, targetGameId);
      }
    }
  });
});

// ============================================================
// Audit logs
// ============================================================
const insertAudit = db.prepare(`
  INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?)
`);

const auditEntries = [
  { u: adminId, a: 'create_tournament', t: 'tournament', i: t1Id, d: null, c: '2026-04-28T10:00:00Z' },
  { u: adminId, a: 'create_tournament', t: 'tournament', i: t2Id, d: null, c: '2026-06-01T09:00:00Z' },
  { u: adminId, a: 'create_tournament', t: 'tournament', i: t3Id, d: null, c: '2026-07-01T10:00:00Z' },
  { u: adminId, a: 'add_team', t: 'team', i: t1TeamIds[0], d: null, c: '2026-04-28T11:00:00Z' },
  { u: adminId, a: 'add_team', t: 'team', i: t1TeamIds[4], d: null, c: '2026-04-28T11:05:00Z' },
  { u: adminId, a: 'assign_groups', t: 'tournament', i: t1Id, d: '{"groups":2}', c: '2026-04-29T08:00:00Z' },
  { u: adminId, a: 'generate_schedule', t: 'tournament', i: t1Id, d: '{"gamesCreated":12}', c: '2026-04-29T09:00:00Z' },
  { u: adminId, a: 'submit_result_approved', t: 'game', i: null, d: null, c: '2026-05-02T12:00:00Z' },
  { u: adminId, a: 'generate_playoffs', t: 'tournament', i: t1Id, d: null, c: '2026-05-18T10:00:00Z' },
  { u: scorer1Id, a: 'submit_result', t: 'game', i: null, d: null, c: '2026-06-06T11:00:00Z' },
  { u: adminId, a: 'approve_result', t: 'game', i: null, d: null, c: '2026-06-06T13:00:00Z' },
];

auditEntries.forEach(e => insertAudit.run(e.u, e.a, e.t, e.i, e.d, e.c));

console.log('========================================================');
console.log('  Seed complete!');
console.log(`  Users: existing active admin, scorer1, scorer2 (temporary demo password: ${scorerPassword})`);
console.log(`  Tournament 1: "2026 Inter-Purok Basketball League" (ID: ${t1Id})`);
console.log(`    - Format: Groups + Playoffs, 8 teams, 96 players`);
console.log(`    - Group stage: 12 games (completed + approved)`);
console.log(`    - Playoffs: 2 semis completed, final + 3rd place scheduled`);

const { computeStandings } = require('../services/standingsService');
const t1StandingsA = computeStandings(db, t1Id, t1GroupAId);
const t1StandingsB = computeStandings(db, t1Id, t1GroupBId);
console.log(`    - Group A: ${t1StandingsA.map(s => `${s.teamName}(${s.wins}-${s.losses})`).join(', ')}`);
console.log(`    - Group B: ${t1StandingsB.map(s => `${s.teamName}(${s.wins}-${s.losses})`).join(', ')}`);
  console.log(`  Tournament 2: "Summer Volleyball Cup" (ID: ${t2Id})`);
  console.log(`    - Format: Round Robin, 6 teams, 48 players`);
  console.log(`    - 3 rounds completed, 2 rounds scheduled`);
  console.log(`  Tournament 3: "Purok Cup Single Elimination" (ID: ${t3Id})`);
  console.log(`    - Format: Single Elimination, 8 teams, 80 players`);
  console.log(`    - Quarterfinals + Semifinals completed, Finals scheduled`);
  console.log('========================================================');
