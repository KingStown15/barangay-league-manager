const express = require('express');
const { requireAuthFor, requireRole } = require('../middleware/auth');
const { logAction } = require('../utils/audit');

module.exports = function playerRoutes(db) {
  const router = express.Router();
  const requireAuth = requireAuthFor(db);

  router.get('/', requireAuth, (req, res) => {
    const { team_id, tournament_id } = req.query;
    let players;
    if (team_id) {
      players = db.prepare('SELECT * FROM players WHERE team_id = ? ORDER BY jersey_number').all(team_id);
    } else if (tournament_id) {
      players = db.prepare(
        `SELECT p.*, t.name AS team_name FROM players p
         JOIN teams t ON t.id = p.team_id
         WHERE p.tournament_id = ? ORDER BY t.name, p.jersey_number`
      ).all(tournament_id);
    } else {
      return res.status(400).json({ error: 'team_id or tournament_id is required.' });
    }
    res.json({ players });
  });

  router.post('/', requireAuth, requireRole('admin'), (req, res) => {
    const { tournament_id, team_id, full_name, jersey_number, age, category, eligibility_note } = req.body || {};
    if (!tournament_id || !team_id || !full_name) {
      return res.status(400).json({ error: 'Tournament, team, and player name are required.' });
    }
    const team = db.prepare('SELECT id FROM teams WHERE id = ? AND tournament_id = ?').get(team_id, tournament_id);
    if (!team) return res.status(404).json({ error: 'Team not found in this tournament.' });
    if (age !== undefined && age !== null && age !== '' && (isNaN(Number(age)) || Number(age) < 1 || Number(age) > 120)) {
      return res.status(400).json({ error: 'Age must be between 1 and 120.' });
    }
    const result = db.prepare(
      `INSERT INTO players (tournament_id, team_id, full_name, jersey_number, age, category, eligibility_note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(tournament_id, team_id, full_name, jersey_number || null, age || null, category || null, eligibility_note || null);
    logAction(db, { userId: req.user.id, action: 'create_player', entityType: 'player', entityId: result.lastInsertRowid });
    const player = db.prepare('SELECT * FROM players WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ player });
  });

  router.put('/:id', requireAuth, requireRole('admin'), (req, res) => {
    const existing = db.prepare('SELECT * FROM players WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Player not found.' });

    if (req.body.status && !['active', 'inactive'].includes(req.body.status)) {
      return res.status(400).json({ error: 'Invalid player status.' });
    }
    if (req.body.age !== undefined && req.body.age !== null && req.body.age !== '' && (isNaN(Number(req.body.age)) || Number(req.body.age) < 1 || Number(req.body.age) > 120)) {
      return res.status(400).json({ error: 'Age must be between 1 and 120.' });
    }
    const fields = ['full_name', 'jersey_number', 'age', 'category', 'eligibility_note', 'status', 'team_id'];
    const updates = [];
    const params = [];
    fields.forEach((f) => {
      if (req.body[f] !== undefined) {
        updates.push(`${f} = ?`);
        params.push(req.body[f]);
      }
    });
    if (updates.length === 0) return res.json({ player: existing });
    params.push(req.params.id);
    db.prepare(`UPDATE players SET ${updates.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...params);
    logAction(db, { userId: req.user.id, action: 'update_player', entityType: 'player', entityId: req.params.id });
    const player = db.prepare('SELECT * FROM players WHERE id = ?').get(req.params.id);
    res.json({ player });
  });

  router.delete('/:id', requireAuth, requireRole('admin'), (req, res) => {
    const existing = db.prepare('SELECT * FROM players WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Player not found.' });
    db.prepare('DELETE FROM players WHERE id = ?').run(req.params.id);
    logAction(db, { userId: req.user.id, action: 'delete_player', entityType: 'player', entityId: req.params.id });
    res.json({ ok: true });
  });

  return router;
};
