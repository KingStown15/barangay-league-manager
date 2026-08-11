const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const bcrypt = require('bcryptjs');

const { requireAuthFor, requireRole } = require('../middleware/auth');
const { logAction } = require('../utils/audit');
const { createDatabaseBackup } = require('../services/backupService');
const { DB_PATH } = require('../db/init');
const {
  PROJECT_ROOT,
  DEFAULT_UPDATE_ROOT,
  inspectStagedUpdate,
} = require('../services/updateService');

module.exports = function systemUpdateRoutes(db, options = {}) {
  const router = express.Router();
  const requireAuth = requireAuthFor(db);
  const projectRoot = options.projectRoot || PROJECT_ROOT;
  const updateRoot = options.updateRoot || DEFAULT_UPDATE_ROOT;
  const databasePath = options.databasePath || DB_PATH;
  const publicKeyPath = options.publicKeyPath;
  const preparedPath = path.join(updateRoot, 'prepared-update.json');
  const authorizationLifetimeMs = 30 * 60 * 1000;

  function inspect() {
    return inspectStagedUpdate({ projectRoot, updateRoot, publicKeyPath });
  }

  function requireCurrentPassword(req, res) {
    const currentPassword = req.body?.currentPassword;
    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!currentPassword || !user || !bcrypt.compareSync(currentPassword, user.password_hash)) {
      res.status(401).json({ error: 'Current password is required to authorize a system update.' });
      return false;
    }
    return true;
  }

  function writeAuditStrict({ userId, action, details }) {
    db.prepare(
      `INSERT INTO audit_logs (user_id, action, entity_type, details_json)
       VALUES (?, ?, 'system_update', ?)`
    ).run(userId, action, JSON.stringify(details));
  }

  function readPrepared() {
    if (!fs.existsSync(preparedPath)) return null;
    const prepared = JSON.parse(fs.readFileSync(preparedPath, 'utf8'));
    if (prepared.format !== 1 || !prepared.authorization_nonce || !prepared.manifest_sha256) {
      throw new Error('Prepared update authorization is invalid.');
    }
    const preparedAt = Date.parse(prepared.prepared_at);
    if (!Number.isFinite(preparedAt)) throw new Error('Prepared update timestamp is invalid.');
    return {
      ...prepared,
      expired: Date.now() - preparedAt > authorizationLifetimeMs || preparedAt > Date.now() + 60_000,
      expires_at: new Date(preparedAt + authorizationLifetimeMs).toISOString(),
    };
  }

  router.get('/status', requireAuth, requireRole('super_admin'), (req, res) => {
    try {
      const prepared = readPrepared();
      if (prepared) {
        return res.json({
          state: prepared.expired ? 'expired' : 'prepared',
          update: { version: prepared.update_version },
          prepared_at: prepared.prepared_at,
          expires_at: prepared.expires_at,
          message: prepared.expired
            ? 'The prepared authorization expired. Cancel it, then prepare the update again.'
            : 'Update prepared. Stop the server and run APPLY_UPDATE.bat before authorization expires.',
        });
      }
      res.json(inspect());
    } catch (error) {
      res.status(400).json({ state: 'invalid', error: error.message });
    }
  });

  router.post('/prepare', requireAuth, requireRole('super_admin'), async (req, res) => {
    if (!requireCurrentPassword(req, res)) return;
    let descriptorWritten = false;
    try {
      if (fs.existsSync(preparedPath)) return res.status(409).json({ error: 'An update is already prepared. Cancel it before preparing another.' });
      const staged = inspect();
      if (staged.state !== 'ready') return res.status(409).json({ error: staged.message || 'No verified update is ready.' });
      const backup = await createDatabaseBackup({
        sourcePath: databasePath,
        backupRoot: path.join(projectRoot, 'backups'),
        label: `pre-update-${staged.update.version}`,
      });
      fs.mkdirSync(updateRoot, { recursive: true });
      const prepared = {
        format: 1,
        prepared_at: new Date().toISOString(),
        prepared_by: req.user.id,
        current_version: staged.current.version,
        update_version: staged.update.version,
        manifest_sha256: staged.manifest_sha256,
        database_backup: backup.directory,
        authorization_nonce: crypto.randomBytes(32).toString('hex'),
      };
      fs.writeFileSync(
        preparedPath,
        `${JSON.stringify(prepared, null, 2)}\n`,
        { flag: 'wx', mode: 0o600 },
      );
      descriptorWritten = true;
      writeAuditStrict({
        userId: req.user.id,
        action: 'prepare_system_update',
        details: {
          from_version: staged.current.version,
          to_version: staged.update.version,
          manifest_sha256: staged.manifest_sha256,
          backup_sha256: backup.manifest.database_sha256,
          authorization_nonce: prepared.authorization_nonce,
        },
      });
      res.json({
        ok: true,
        update_version: staged.update.version,
        backup_verified: true,
        message: 'Update verified and prepared. Stop the server, then run APPLY_UPDATE.bat on the server laptop.',
      });
    } catch (error) {
      if (descriptorWritten && fs.existsSync(preparedPath)) fs.unlinkSync(preparedPath);
      logAction(db, {
        userId: req.user.id,
        action: 'prepare_system_update_failed',
        entityType: 'system_update',
        details: { reason: error.message },
      });
      const status = error.code === 'EEXIST' ? 409 : 400;
      res.status(status).json({ error: error.code === 'EEXIST' ? 'An update is already prepared.' : error.message });
    }
  });

  router.post('/cancel', requireAuth, requireRole('super_admin'), (req, res) => {
    if (!requireCurrentPassword(req, res)) return;
    let temporaryPath;
    try {
      const prepared = readPrepared();
      if (!prepared) return res.status(404).json({ error: 'No prepared update was found.' });
      temporaryPath = `${preparedPath}.cancelling-${crypto.randomBytes(8).toString('hex')}`;
      fs.renameSync(preparedPath, temporaryPath);
      writeAuditStrict({
        userId: req.user.id,
        action: 'cancel_system_update',
        details: {
          update_version: prepared.update_version,
          manifest_sha256: prepared.manifest_sha256,
          authorization_nonce: prepared.authorization_nonce,
          expired: prepared.expired,
        },
      });
      fs.unlinkSync(temporaryPath);
      res.json({ ok: true, message: 'Prepared update authorization cancelled.' });
    } catch (error) {
      if (temporaryPath && fs.existsSync(temporaryPath) && !fs.existsSync(preparedPath)) {
        fs.renameSync(temporaryPath, preparedPath);
      }
      res.status(400).json({ error: error.message });
    }
  });

  return router;
};
