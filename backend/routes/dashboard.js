const express = require('express');
const { requireAuthFor } = require('../middleware/auth');
const { computeStandings } = require('../services/standingsService');
const { GAME_ENTRY_JOINS, GAME_ENTRY_SELECT, serializeGamesWithEntries } = require('../services/entryResolver');

module.exports = function dashboardRoutes(db) {
  const router = express.Router();
  const requireAuth = requireAuthFor(db);

  router.get('/', requireAuth, (req, res) => {
    let tid = req.query.tournament_id;
    let activeTournament;

    if (tid) {
      activeTournament = db.prepare('SELECT * FROM tournaments WHERE id = ? AND status != ?').get(tid, 'archived');
    } else {
      activeTournament = db.prepare(
        "SELECT * FROM tournaments WHERE status = 'active' ORDER BY updated_at DESC LIMIT 1"
      ).get();
    }

    if (!activeTournament) {
      if (tid) return res.json({ activeTournament: null, notFound: true });
      return res.json({ activeTournament: null });
    }

    const localDate = req.query.date || new Date().toISOString().slice(0, 10);
    const todaysGames = db.prepare(
      `SELECT g.*, t.sport, t.competition_format, t.division AS tournament_division, ta.name AS team_a_name, tb.name AS team_b_name ${GAME_ENTRY_SELECT} FROM games g
       LEFT JOIN teams ta ON ta.id = g.team_a_id
       LEFT JOIN teams tb ON tb.id = g.team_b_id
       ${GAME_ENTRY_JOINS}
       JOIN tournaments t ON t.id = g.tournament_id
       WHERE g.tournament_id = ? AND date(g.scheduled_at) = ?
       ORDER BY g.scheduled_at`
    ).all(activeTournament.id, localDate);

    const ongoingGames = db.prepare(
      `SELECT g.*, t.sport, t.competition_format, t.division AS tournament_division, ta.name AS team_a_name, tb.name AS team_b_name ${GAME_ENTRY_SELECT} FROM games g
       LEFT JOIN teams ta ON ta.id = g.team_a_id
       LEFT JOIN teams tb ON tb.id = g.team_b_id
       ${GAME_ENTRY_JOINS}
       JOIN tournaments t ON t.id = g.tournament_id
       WHERE g.tournament_id = ? AND g.status = 'ongoing'
       ORDER BY g.scheduled_at`
    ).all(activeTournament.id);

    const recentlyCompleted = db.prepare(
      `SELECT g.*, t.sport, t.competition_format, t.division AS tournament_division, ta.name AS team_a_name, tb.name AS team_b_name ${GAME_ENTRY_SELECT} FROM games g
       LEFT JOIN teams ta ON ta.id = g.team_a_id
       LEFT JOIN teams tb ON tb.id = g.team_b_id
       ${GAME_ENTRY_JOINS}
       JOIN tournaments t ON t.id = g.tournament_id
       WHERE g.tournament_id = ? AND g.status IN ('completed','forfeited') AND g.approved_at IS NOT NULL
       ORDER BY g.updated_at DESC LIMIT 5`
    ).all(activeTournament.id);

    const pendingApprovals = db.prepare(
      `SELECT g.*, t.sport, t.competition_format, t.division AS tournament_division, ta.name AS team_a_name, tb.name AS team_b_name ${GAME_ENTRY_SELECT} FROM games g
       LEFT JOIN teams ta ON ta.id = g.team_a_id
       LEFT JOIN teams tb ON tb.id = g.team_b_id
       ${GAME_ENTRY_JOINS}
       JOIN tournaments t ON t.id = g.tournament_id
       WHERE g.tournament_id = ? AND g.status IN ('completed','forfeited') AND g.approved_at IS NULL
       ORDER BY g.submitted_at`
    ).all(activeTournament.id);

    let topStandings = [];
    try {
      topStandings = computeStandings(db, activeTournament.id, null).slice(0, 5);
    } catch (err) {
      topStandings = [];
    }

    res.json({
      activeTournament,
      todaysGames: serializeGamesWithEntries(db, todaysGames),
      ongoingGames: serializeGamesWithEntries(db, ongoingGames),
      recentlyCompleted: serializeGamesWithEntries(db, recentlyCompleted),
      pendingApprovals: serializeGamesWithEntries(db, pendingApprovals),
      topStandings,
    });
  });

  return router;
};
