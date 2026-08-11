const express = require('express');
const { requireAuthFor, requireRole } = require('../middleware/auth');
const { computeStandings, saveSnapshot } = require('../services/standingsService');

module.exports = function standingsRoutes(db) {
  const router = express.Router();
  const requireAuth = requireAuthFor(db);

  router.get('/', requireAuth, (req, res) => {
    const { tournament_id, group_id } = req.query;
    if (!tournament_id) return res.status(400).json({ error: 'tournament_id is required.' });
    try {
      const standings = computeStandings(db, tournament_id, group_id || null);
      res.json({ standings });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.get('/by-group', requireAuth, (req, res) => {
    const { tournament_id } = req.query;
    if (!tournament_id) return res.status(400).json({ error: 'tournament_id is required.' });
    try {
      const groups = db.prepare('SELECT * FROM groups_table WHERE tournament_id = ? ORDER BY order_index').all(tournament_id);
      if (groups.length === 0) {
        return res.json({ groups: [{ group: null, standings: computeStandings(db, tournament_id, null) }] });
      }
      const result = groups.map((g) => ({ group: g, standings: computeStandings(db, tournament_id, g.id) }));
      res.json({ groups: result });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Admin: snapshot the current standings (useful right before exporting/posting)
  router.post('/snapshot', requireAuth, requireRole('admin'), (req, res) => {
    const { tournament_id, group_id } = req.body || {};
    if (!tournament_id) return res.status(400).json({ error: 'tournament_id is required.' });
    try {
      const rows = computeStandings(db, tournament_id, group_id || null);
      saveSnapshot(db, tournament_id, group_id || null, rows);
      res.json({ ok: true, standings: rows });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
};
