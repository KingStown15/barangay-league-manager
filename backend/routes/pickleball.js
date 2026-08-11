const express = require('express');
const { requireAuthFor, requireRole, isAdminRole } = require('../middleware/auth');
const { logAction } = require('../utils/audit');
const sse = require('../live/sseHub');
const { applyMatchAction, serializePickleballMatch } = require('../services/pickleballMatchService');

module.exports = function pickleballRoutes(db) {
  const router = express.Router();
  const requireAuth = requireAuthFor(db);

  router.get('/:id/pickleball-state', requireAuth, requireRole('admin', 'scorer'), (req, res) => {
    try {
      res.json(serializePickleballMatch(db, req.params.id));
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message });
    }
  });

  router.post('/:id/pickleball-actions', requireAuth, requireRole('admin', 'scorer'), (req, res) => {
    const { action_id, expected_version, action, payload } = req.body || {};
    if (action === 'correct_score' && !isAdminRole(req.user.role)) {
      return res.status(403).json({ error: 'Only an admin can directly correct a Pickleball score.' });
    }
    try {
      const result = applyMatchAction(db, req.params.id, {
        actionId: action_id,
        expectedVersion: expected_version,
        action,
        payload,
        actorId: req.user.id,
        actorRole: req.user.role,
      });
      const game = db.prepare('SELECT tournament_id FROM games WHERE id = ?').get(req.params.id);
      if (action === 'correct_score') {
        logAction(db, { userId: req.user.id, action: 'correct_pickleball_score', entityType: 'game', entityId: req.params.id, details: payload });
      }
      if (game && !result.duplicate) {
        sse.broadcast(game.tournament_id, {
          type: 'pickleball_state_update',
          game_id: Number(req.params.id),
          tournament_id: game.tournament_id,
          state: result.state,
          completed_games: result.completed_games,
        });
      }
      res.json(result);
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message });
    }
  });

  return router;
};
