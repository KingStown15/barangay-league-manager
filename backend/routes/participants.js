const express = require('express');
const { requireAuthFor, requireRole } = require('../middleware/auth');
const { logAction } = require('../utils/audit');

function cleanText(value, label, { required = false, max = 160 } = {}) {
  if (value === undefined || value === null) {
    if (required) throw new Error(`${label} is required.`);
    return null;
  }
  if (typeof value !== 'string') throw new Error(`${label} must be text.`);
  const cleaned = value.trim();
  if (required && !cleaned) throw new Error(`${label} is required.`);
  if (cleaned.length > max) throw new Error(`${label} must be ${max} characters or fewer.`);
  return cleaned || null;
}

module.exports = function participantRoutes(db) {
  const router = express.Router();
  const requireAuth = requireAuthFor(db);

  router.get('/', requireAuth, (req, res) => {
    const clauses = [];
    const params = [];
    if (req.query.status) {
      if (!['active', 'inactive'].includes(req.query.status)) return res.status(400).json({ error: 'Invalid participant status.' });
      clauses.push('status = ?');
      params.push(req.query.status);
    }
    if (req.query.search) {
      clauses.push('LOWER(display_name) LIKE ?');
      params.push(`%${String(req.query.search).trim().toLowerCase()}%`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const participants = db.prepare(
      `SELECT id, display_name, affiliation, status, legacy_player_id, created_at, updated_at
       FROM participants ${where} ORDER BY display_name COLLATE NOCASE, id LIMIT 100`
    ).all(...params);
    res.json({ participants });
  });

  router.get('/:id', requireAuth, (req, res) => {
    const participant = db.prepare(
      'SELECT id, display_name, affiliation, status, legacy_player_id, created_at, updated_at FROM participants WHERE id = ?'
    ).get(req.params.id);
    if (!participant) return res.status(404).json({ error: 'Participant not found.' });
    res.json({ participant });
  });

  router.post('/', requireAuth, requireRole('admin'), (req, res) => {
    let displayName, affiliation;
    try {
      displayName = cleanText(req.body?.display_name, 'Display name', { required: true });
      affiliation = cleanText(req.body?.affiliation, 'Affiliation', { max: 120 });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    const legacyPlayerId = req.body?.legacy_player_id ?? null;
    if (legacyPlayerId !== null && (typeof legacyPlayerId !== 'number' || !Number.isSafeInteger(legacyPlayerId))) {
      return res.status(400).json({ error: 'legacy_player_id must be a whole number or null.' });
    }
    if (legacyPlayerId !== null && !db.prepare('SELECT id FROM players WHERE id = ?').get(legacyPlayerId)) {
      return res.status(400).json({ error: 'Legacy player not found.' });
    }
    try {
      const result = db.prepare(
        'INSERT INTO participants (display_name, affiliation, legacy_player_id) VALUES (?, ?, ?)'
      ).run(displayName, affiliation, legacyPlayerId);
      logAction(db, { userId: req.user.id, action: 'create_participant', entityType: 'participant', entityId: result.lastInsertRowid });
      const participant = db.prepare('SELECT * FROM participants WHERE id = ?').get(result.lastInsertRowid);
      res.status(201).json({ participant });
    } catch (error) {
      if (String(error.code).includes('SQLITE_CONSTRAINT')) return res.status(409).json({ error: 'That legacy player is already linked to a participant.' });
      throw error;
    }
  });

  router.put('/:id', requireAuth, requireRole('admin'), (req, res) => {
    const current = db.prepare('SELECT * FROM participants WHERE id = ?').get(req.params.id);
    if (!current) return res.status(404).json({ error: 'Participant not found.' });
    const updates = [];
    const params = [];
    try {
      if (req.body.display_name !== undefined) {
        updates.push('display_name = ?');
        params.push(cleanText(req.body.display_name, 'Display name', { required: true }));
      }
      if (req.body.affiliation !== undefined) {
        updates.push('affiliation = ?');
        params.push(cleanText(req.body.affiliation, 'Affiliation', { max: 120 }));
      }
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    if (req.body.status !== undefined) {
      if (!['active', 'inactive'].includes(req.body.status)) return res.status(400).json({ error: 'Invalid participant status.' });
      updates.push('status = ?');
      params.push(req.body.status);
    }
    if (req.body.legacy_player_id !== undefined) {
      const id = req.body.legacy_player_id;
      if (id !== null && (typeof id !== 'number' || !Number.isSafeInteger(id))) return res.status(400).json({ error: 'legacy_player_id must be a whole number or null.' });
      if (id !== null && !db.prepare('SELECT id FROM players WHERE id = ?').get(id)) return res.status(400).json({ error: 'Legacy player not found.' });
      updates.push('legacy_player_id = ?');
      params.push(id);
    }
    if (updates.length === 0) return res.json({ participant: current });
    params.push(req.params.id);
    try {
      db.prepare(`UPDATE participants SET ${updates.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...params);
    } catch (error) {
      if (String(error.code).includes('SQLITE_CONSTRAINT')) return res.status(409).json({ error: 'That legacy player is already linked to a participant.' });
      throw error;
    }
    logAction(db, { userId: req.user.id, action: 'update_participant', entityType: 'participant', entityId: req.params.id });
    res.json({ participant: db.prepare('SELECT * FROM participants WHERE id = ?').get(req.params.id) });
  });

  return router;
};
