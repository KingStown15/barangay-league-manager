const express = require('express');
const { requireAuthFor, requireRole } = require('../middleware/auth');
const { logAction } = require('../utils/audit');
const {
  createEntry,
  getEntry,
  listEntries,
  updateEntry,
  withdrawEntry,
} = require('../services/competitionEntryService');

module.exports = function competitionEntryRoutes(db) {
  const router = express.Router();
  const requireAuth = requireAuthFor(db);

  function handleError(res, error) {
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Competition entry operation failed.' });
  }

  router.get('/:id/entries', requireAuth, (req, res) => {
    try {
      res.json({ entries: listEntries(db, req.params.id, req.query) });
    } catch (error) {
      handleError(res, error);
    }
  });

  router.post('/:id/entries', requireAuth, requireRole('admin'), (req, res) => {
    try {
      const entry = createEntry(db, Number(req.params.id), req.body || {});
      logAction(db, { userId: req.user.id, action: 'create_competition_entry', entityType: 'competition_entry', entityId: entry.id, details: { tournament_id: Number(req.params.id), entry_type: entry.entry_type } });
      res.status(201).json({ entry });
    } catch (error) {
      handleError(res, error);
    }
  });

  router.get('/:id/entries/:entryId', requireAuth, (req, res) => {
    try {
      res.json({ entry: getEntry(db, req.params.id, req.params.entryId) });
    } catch (error) {
      handleError(res, error);
    }
  });

  router.put('/:id/entries/:entryId', requireAuth, requireRole('admin'), (req, res) => {
    try {
      const entry = updateEntry(db, Number(req.params.id), Number(req.params.entryId), req.body || {});
      logAction(db, { userId: req.user.id, action: 'update_competition_entry', entityType: 'competition_entry', entityId: entry.id });
      res.json({ entry });
    } catch (error) {
      handleError(res, error);
    }
  });

  router.post('/:id/entries/:entryId/withdraw', requireAuth, requireRole('admin'), (req, res) => {
    try {
      const entry = withdrawEntry(db, Number(req.params.id), Number(req.params.entryId), req.body?.reason);
      logAction(db, { userId: req.user.id, action: 'withdraw_competition_entry', entityType: 'competition_entry', entityId: entry.id, details: { reason: entry.withdrawal_reason } });
      res.json({ entry });
    } catch (error) {
      handleError(res, error);
    }
  });

  return router;
};
