const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { requireAuthFor, requireRole, loginRateLimiter, JWT_SECRET } = require('../middleware/auth');
const { logAction } = require('../utils/audit');

module.exports = function authRoutes(db) {
  const router = express.Router();
  const requireAuth = requireAuthFor(db);

  function requireSuperAdminPassword(req, res) {
    const actor = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!req.body?.currentPassword || !actor || !bcrypt.compareSync(req.body.currentPassword, actor.password_hash)) {
      res.status(401).json({ error: 'Current super-admin password is required for this action.' });
      return false;
    }
    return true;
  }

  function insertAuditStrict({ userId, action, entityId, details }) {
    db.prepare(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details_json)
       VALUES (?, ?, 'user', ?, ?)`
    ).run(userId, action, entityId, details ? JSON.stringify(details) : null);
  }

  router.post('/login', loginRateLimiter, (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user || user.status !== 'active') {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const valid = bcrypt.compareSync(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, sessionVersion: user.session_version },
      JWT_SECRET,
      { expiresIn: '12h' }
    );

    logAction(db, { userId: user.id, action: 'login', entityType: 'user', entityId: user.id });

    res.json({
      token,
      user: { id: user.id, username: user.username, role: user.role },
    });
  });

  router.get('/me', requireAuth, (req, res) => {
    res.json({ user: req.user });
  });

  router.post('/change-password', requireAuth, (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!newPassword || newPassword.length < 10) {
      return res.status(400).json({ error: 'New password must be at least 10 characters.' });
    }
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!user || !bcrypt.compareSync(currentPassword || '', user.password_hash)) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }
    const newHash = bcrypt.hashSync(newPassword, 10);
    db.transaction(() => {
      db.prepare(`UPDATE users
        SET password_hash = ?, session_version = session_version + 1, updated_at = datetime('now')
        WHERE id = ?`).run(newHash, user.id);
      insertAuditStrict({ userId: user.id, action: 'change_password', entityId: user.id });
    })();
    res.json({ ok: true });
  });

  // --- Admin-only user management (creating scorer accounts, etc.) ---

  router.get('/users', requireAuth, requireRole('admin'), (req, res) => {
    const users = db.prepare('SELECT id, username, role, status, created_at FROM users ORDER BY created_at DESC').all();
    res.json({ users });
  });

  router.post('/users', requireAuth, requireRole('admin'), (req, res) => {
    const { username, password, role } = req.body || {};
    if (!username || !password || !['super_admin', 'admin', 'scorer'].includes(role)) {
      return res.status(400).json({ error: 'Username, password, and a valid role are required.' });
    }
    if (role === 'super_admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Only a super admin can create another super admin.' });
    }
    if (role === 'super_admin' && !requireSuperAdminPassword(req, res)) return;
    if (password.length < 10) {
      return res.status(400).json({ error: 'Password must be at least 10 characters.' });
    }
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
      return res.status(409).json({ error: 'That username is already taken.' });
    }
    const hash = bcrypt.hashSync(password, 10);
    let id;
    db.transaction(() => {
      const result = db
        .prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
        .run(username, hash, role);
      id = Number(result.lastInsertRowid);
      insertAuditStrict({ userId: req.user.id, action: 'create_user', entityId: id, details: { role } });
    })();
    res.status(201).json({ id, username, role });
  });

  router.patch('/users/:id/status', requireAuth, requireRole('admin'), (req, res) => {
    const { status } = req.body || {};
    if (!['active', 'inactive'].includes(status)) {
      return res.status(400).json({ error: 'Status must be active or inactive.' });
    }
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    if (user.role === 'super_admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Only a super admin can manage a super-admin account.' });
    }
    if (status === 'inactive' && Number(user.id) === Number(req.user.id)) {
      return res.status(409).json({ error: 'You cannot deactivate your own account.' });
    }
    if (status === 'inactive' && user.role === 'super_admin') {
      const activeSuperAdmins = db.prepare(
        "SELECT COUNT(*) AS count FROM users WHERE role = 'super_admin' AND status = 'active'"
      ).get().count;
      if (activeSuperAdmins <= 1) {
        return res.status(409).json({ error: 'The last active super admin cannot be deactivated.' });
      }
    }
    if (user.role === 'super_admin' && !requireSuperAdminPassword(req, res)) return;
    db.transaction(() => {
      db.prepare(`UPDATE users
        SET status = ?, session_version = session_version + 1, updated_at = datetime('now')
        WHERE id = ?`).run(status, req.params.id);
      insertAuditStrict({ userId: req.user.id, action: 'update_user_status', entityId: user.id, details: { status } });
    })();
    res.json({ ok: true });
  });

  router.post('/users/:id/reset-password', requireAuth, requireRole('admin'), (req, res) => {
    const { newPassword } = req.body || {};
    if (!newPassword || newPassword.length < 10) {
      return res.status(400).json({ error: 'New password must be at least 10 characters.' });
    }
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    if (user.role === 'super_admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Only a super admin can reset a super-admin password.' });
    }
    if (Number(user.id) === Number(req.user.id)) {
      return res.status(409).json({ error: 'Use Change Password to update your own password.' });
    }
    if (user.role === 'super_admin' && !requireSuperAdminPassword(req, res)) return;
    const hash = bcrypt.hashSync(newPassword, 10);
    db.transaction(() => {
      db.prepare(`UPDATE users
        SET password_hash = ?, session_version = session_version + 1, updated_at = datetime('now')
        WHERE id = ?`).run(hash, req.params.id);
      insertAuditStrict({ userId: req.user.id, action: 'reset_user_password', entityId: user.id });
    })();
    res.json({ ok: true });
  });

  return router;
};
