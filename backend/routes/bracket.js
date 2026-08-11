const express = require('express');
const { requireAuthFor } = require('../middleware/auth');
const { GAME_ENTRY_JOINS, GAME_ENTRY_SELECT, serializeGamesWithEntries } = require('../services/entryResolver');

module.exports = function bracketRoutes(db) {
  const router = express.Router();
  const requireAuth = requireAuthFor(db);

  router.get('/', requireAuth, (req, res) => {
    const { tournament_id } = req.query;
    if (!tournament_id) return res.status(400).json({ error: 'tournament_id is required.' });

    const stage = db.prepare(
      "SELECT * FROM stages WHERE tournament_id = ? AND type = 'playoff' ORDER BY order_index DESC LIMIT 1"
    ).get(tournament_id);

    if (!stage) return res.json({ stage: null, games: [] });

    const games = db.prepare(
      `SELECT g.*, t.sport, t.competition_format, t.division AS tournament_division, ta.name AS team_a_name, tb.name AS team_b_name ${GAME_ENTRY_SELECT}
       FROM games g
       LEFT JOIN teams ta ON ta.id = g.team_a_id
       LEFT JOIN teams tb ON tb.id = g.team_b_id
       ${GAME_ENTRY_JOINS}
       JOIN tournaments t ON t.id = g.tournament_id
       WHERE g.stage_id = ?
       ORDER BY g.id`
    ).all(stage.id);

    res.json({ stage, games: serializeGamesWithEntries(db, games) });
  });

  return router;
};
