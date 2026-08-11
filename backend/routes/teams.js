const express = require('express');
const { requireAuthFor, requireRole } = require('../middleware/auth');
const { logAction } = require('../utils/audit');

module.exports = function teamRoutes(db) {
  const router = express.Router();
  const requireAuth = requireAuthFor(db);

  router.get('/', requireAuth, (req, res) => {
    const { tournament_id } = req.query;
    if (!tournament_id) return res.status(400).json({ error: 'tournament_id is required.' });
    const teams = db.prepare(
      `SELECT t.*, g.name AS group_name FROM teams t
       LEFT JOIN groups_table g ON g.id = t.group_id
       WHERE t.tournament_id = ? ORDER BY t.name`
    ).all(tournament_id);
    res.json({ teams });
  });

  router.get('/:id', requireAuth, (req, res) => {
    const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(req.params.id);
    if (!team) return res.status(404).json({ error: 'Team not found.' });
    const players = db.prepare('SELECT * FROM players WHERE team_id = ? ORDER BY jersey_number').all(req.params.id);
    res.json({ team, players });
  });

  router.post('/', requireAuth, requireRole('admin'), (req, res) => {
    const { tournament_id, name, purok, coach_name, contact_number, uniform_color, notes } = req.body || {};
    if (!tournament_id || !name) {
      return res.status(400).json({ error: 'Tournament and team name are required.' });
    }
    const tournament = db.prepare('SELECT id FROM tournaments WHERE id = ?').get(tournament_id);
    if (!tournament) return res.status(404).json({ error: 'Tournament not found.' });
    const nameMatch = db.prepare('SELECT id FROM teams WHERE tournament_id = ? AND name = ?').get(tournament_id, name);
    if (nameMatch) return res.status(409).json({ error: 'A team with that name already exists in this tournament.' });
    const result = db.prepare(
      `INSERT INTO teams (tournament_id, name, purok, coach_name, contact_number, uniform_color, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(tournament_id, name, purok || null, coach_name || null, contact_number || null, uniform_color || null, notes || null);
    logAction(db, { userId: req.user.id, action: 'create_team', entityType: 'team', entityId: result.lastInsertRowid });
    const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ team });
  });

  router.put('/:id', requireAuth, requireRole('admin'), (req, res) => {
    const existing = db.prepare('SELECT * FROM teams WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Team not found.' });

    if (req.body.status && !['active', 'withdrawn', 'disqualified'].includes(req.body.status)) {
      return res.status(400).json({ error: 'Invalid team status.' });
    }
    if (req.body.manual_rank_override !== undefined && (req.body.manual_rank_override !== null && (typeof req.body.manual_rank_override !== 'number' || req.body.manual_rank_override < 1))) {
      return res.status(400).json({ error: 'Rank override must be a positive number or null.' });
    }
    const fields = ['name', 'purok', 'coach_name', 'contact_number', 'uniform_color', 'status', 'notes', 'manual_rank_override'];
    const updates = [];
    const params = [];
    fields.forEach((f) => {
      if (req.body[f] !== undefined) {
        updates.push(`${f} = ?`);
        params.push(req.body[f]);
      }
    });
    if (updates.length === 0) return res.json({ team: existing });
    params.push(req.params.id);
    db.prepare(`UPDATE teams SET ${updates.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...params);
    logAction(db, { userId: req.user.id, action: 'update_team', entityType: 'team', entityId: req.params.id });
    const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(req.params.id);
    res.json({ team });
  });

  router.delete('/:id', requireAuth, requireRole('admin'), (req, res) => {
    const existing = db.prepare('SELECT * FROM teams WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Team not found.' });
    db.prepare('DELETE FROM teams WHERE id = ?').run(req.params.id);
    logAction(db, { userId: req.user.id, action: 'delete_team', entityType: 'team', entityId: req.params.id });
    res.json({ ok: true });
  });

  return router;
};
