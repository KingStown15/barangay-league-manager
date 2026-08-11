const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const express = require('express');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');

const systemUpdateRoutes = require('../routes/systemUpdate');
const { JWT_SECRET } = require('../middleware/auth');

const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function stageSignedUpdate(root) {
  const updateRoot = path.join(root, 'updates');
  const inbox = path.join(updateRoot, 'inbox');
  const payload = path.join(inbox, 'payload');
  fs.mkdirSync(payload, { recursive: true });
  fs.writeFileSync(path.join(root, 'release.json'), '{"name":"QA","version":"1.0.0","channel":"stable"}\n');
  fs.writeFileSync(path.join(root, 'README.md'), '# Original release\n');
  const fileBytes = Buffer.from('# Updated release\n');
  fs.writeFileSync(path.join(payload, 'README.md'), fileBytes);
  const releaseBytes = Buffer.from('{"name":"QA","version":"1.1.0","channel":"stable"}\n');
  fs.writeFileSync(path.join(payload, 'release.json'), releaseBytes);
  const manifestBytes = Buffer.from(`${JSON.stringify({
    format: 1,
    version: '1.1.0',
    notes: 'QA signed update',
    files: [
      { path: 'README.md', bytes: fileBytes.length, sha256: sha256(fileBytes) },
      { path: 'release.json', bytes: releaseBytes.length, sha256: sha256(releaseBytes) },
    ],
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(inbox, 'update-manifest.json'), manifestBytes);
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyPath = path.join(root, 'trusted-update-key.pem');
  fs.writeFileSync(publicKeyPath, publicKey.export({ type: 'spki', format: 'pem' }));
  fs.writeFileSync(path.join(inbox, 'update-signature.txt'), crypto.sign(null, manifestBytes, privateKey).toString('base64'));
  return { updateRoot, publicKeyPath, payload };
}

function createHarness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blm-update-test-'));
  const staged = stageSignedUpdate(root);
  const databasePath = path.join(root, 'database.sqlite');
  fs.mkdirSync(path.join(root, 'backend'), { recursive: true });
  fs.mkdirSync(path.join(root, 'frontend'), { recursive: true });
  fs.writeFileSync(path.join(root, 'backend', 'package.json'), JSON.stringify({
    name: 'qa-backend', private: true, scripts: { test: 'node -e "process.exit(0)"' },
  }));
  fs.writeFileSync(path.join(root, 'frontend', 'package.json'), JSON.stringify({
    name: 'qa-frontend', private: true, scripts: { build: 'node -e "process.exit(0)"' },
  }));
  const db = new Database(databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(schema);
  const hash = bcrypt.hashSync('password123', 4);
  db.prepare('INSERT INTO users (id, username, password_hash, role, status) VALUES (?, ?, ?, ?, ?)')
    .run(1, 'owner', hash, 'super_admin', 'active');
  db.prepare('INSERT INTO users (id, username, password_hash, role, status) VALUES (?, ?, ?, ?, ?)')
    .run(2, 'admin', hash, 'admin', 'active');

  const app = express();
  app.use(express.json());
  app.use('/api/system-update', systemUpdateRoutes(db, {
    projectRoot: root,
    updateRoot: staged.updateRoot,
    publicKeyPath: staged.publicKeyPath,
    databasePath,
  }));
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/system-update`;
  const superToken = jwt.sign({ id: 1, username: 'owner', role: 'super_admin', sessionVersion: 1 }, JWT_SECRET, { expiresIn: '1h' });
  const adminToken = jwt.sign({ id: 2, username: 'admin', role: 'admin', sessionVersion: 1 }, JWT_SECRET, { expiresIn: '1h' });

  async function request(method, route, body, token) {
    const response = await fetch(`${baseUrl}${route}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null;
    try { json = await response.json(); } catch {}
    return { status: response.status, body: json };
  }

  return {
    root,
    staged,
    db,
    superToken,
    adminToken,
    request,
    close: () => new Promise((resolve) => server.close(() => {
      db.close();
      fs.rmSync(root, { recursive: true, force: true });
      resolve();
    })),
  };
}

test('system update endpoints are invisible to non-super-admin roles', async (t) => {
  const h = createHarness();
  t.after(() => h.close());
  assert.equal((await h.request('GET', '/status')).status, 401);
  assert.equal((await h.request('GET', '/status', undefined, h.adminToken)).status, 403);
  const status = await h.request('GET', '/status', undefined, h.superToken);
  assert.equal(status.status, 200);
  assert.equal(status.body.state, 'ready');
  assert.equal(status.body.update.version, '1.1.0');
  assert.equal(status.body.update.files, 2);
  assert.equal(status.body.update.requires_network_or_cached_dependencies, false);
});

test('only a re-authenticated super admin can prepare a signed update and verified backup', async (t) => {
  const h = createHarness();
  t.after(() => h.close());
  assert.equal((await h.request('POST', '/prepare', { currentPassword: 'wrong' }, h.superToken)).status, 401);
  assert.equal((await h.request('POST', '/prepare', { currentPassword: 'password123' }, h.adminToken)).status, 403);

  const prepared = await h.request('POST', '/prepare', { currentPassword: 'password123' }, h.superToken);
  assert.equal(prepared.status, 200, prepared.body?.error);
  assert.equal(prepared.body.backup_verified, true);
  const descriptor = JSON.parse(fs.readFileSync(path.join(h.staged.updateRoot, 'prepared-update.json'), 'utf8'));
  assert.equal(descriptor.prepared_by, 1);
  assert.equal(descriptor.update_version, '1.1.0');
  assert.ok(fs.existsSync(path.join(descriptor.database_backup, 'backup-manifest.json')));
  assert.equal(h.db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'prepare_system_update'").get().count, 1);
  assert.equal((await h.request('POST', '/prepare', { currentPassword: 'password123' }, h.superToken)).status, 409);
  const status = await h.request('GET', '/status', undefined, h.superToken);
  assert.equal(status.body.state, 'prepared');
  assert.equal(status.body.update.version, '1.1.0');
});

test('prepared authorization can expire and be cancelled only after super-admin re-authentication', async (t) => {
  const h = createHarness();
  t.after(() => h.close());
  assert.equal((await h.request('POST', '/prepare', { currentPassword: 'password123' }, h.superToken)).status, 200);
  const descriptorPath = path.join(h.staged.updateRoot, 'prepared-update.json');
  const descriptor = JSON.parse(fs.readFileSync(descriptorPath, 'utf8'));
  descriptor.prepared_at = new Date(Date.now() - 31 * 60 * 1000).toISOString();
  fs.writeFileSync(descriptorPath, `${JSON.stringify(descriptor, null, 2)}\n`);

  assert.equal((await h.request('GET', '/status', undefined, h.superToken)).body.state, 'expired');
  assert.equal((await h.request('POST', '/cancel', { currentPassword: 'wrong' }, h.superToken)).status, 401);
  assert.equal((await h.request('POST', '/cancel', { currentPassword: 'password123' }, h.adminToken)).status, 403);
  assert.equal((await h.request('POST', '/cancel', { currentPassword: 'password123' }, h.superToken)).status, 200);
  assert.equal(fs.existsSync(descriptorPath), false);
  assert.equal(h.db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'cancel_system_update'").get().count, 1);
});

test('update preparation fails closed when its authorization audit cannot be written', async (t) => {
  const h = createHarness();
  t.after(() => h.close());
  h.db.exec('DROP TABLE audit_logs');
  const response = await h.request('POST', '/prepare', { currentPassword: 'password123' }, h.superToken);
  assert.equal(response.status, 400);
  assert.equal(fs.existsSync(path.join(h.staged.updateRoot, 'prepared-update.json')), false);
});

test('tampered staged payload is rejected before backup or preparation', async (t) => {
  const h = createHarness();
  t.after(() => h.close());
  fs.writeFileSync(path.join(h.staged.payload, 'README.md'), '# Tampered\n');
  const status = await h.request('GET', '/status', undefined, h.superToken);
  assert.equal(status.status, 400);
  assert.equal(status.body.state, 'invalid');
  assert.match(status.body.error, /verification failed/i);
  assert.equal((await h.request('POST', '/prepare', { currentPassword: 'password123' }, h.superToken)).status, 400);
  assert.equal(fs.existsSync(path.join(h.staged.updateRoot, 'prepared-update.json')), false);
});

test('missing trust key reports not configured and cannot prepare an update', async (t) => {
  const h = createHarness();
  t.after(() => h.close());
  fs.unlinkSync(h.staged.publicKeyPath);

  const status = await h.request('GET', '/status', undefined, h.superToken);
  assert.equal(status.status, 200);
  assert.equal(status.body.state, 'not_configured');
  assert.equal((await h.request('POST', '/prepare', { currentPassword: 'password123' }, h.superToken)).status, 409);
});

test('modified signed manifest and modified signature are rejected', async (t) => {
  const h = createHarness();
  t.after(() => h.close());
  const manifestPath = path.join(h.staged.updateRoot, 'inbox', 'update-manifest.json');
  const signaturePath = path.join(h.staged.updateRoot, 'inbox', 'update-signature.txt');
  const originalManifest = fs.readFileSync(manifestPath);
  const originalSignature = fs.readFileSync(signaturePath, 'utf8');

  fs.appendFileSync(manifestPath, ' ');
  let status = await h.request('GET', '/status', undefined, h.superToken);
  assert.equal(status.status, 400);
  assert.match(status.body.error, /signature is invalid/i);

  fs.writeFileSync(manifestPath, originalManifest);
  const signatureBytes = Buffer.from(originalSignature.trim(), 'base64');
  signatureBytes[0] ^= 0x01;
  fs.writeFileSync(signaturePath, signatureBytes.toString('base64'));
  status = await h.request('GET', '/status', undefined, h.superToken);
  assert.equal(status.status, 400);
  assert.match(status.body.error, /signature is invalid/i);
});

test('trusted update key must be Ed25519 even when another supported key type is configured', async (t) => {
  const h = createHarness();
  t.after(() => h.close());
  const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  fs.writeFileSync(h.staged.publicKeyPath, publicKey.export({ type: 'spki', format: 'pem' }));

  const status = await h.request('GET', '/status', undefined, h.superToken);
  assert.equal(status.status, 400);
  assert.equal(status.body.state, 'invalid');
  assert.match(status.body.error, /must be Ed25519/i);
});

test('an update signed by a different Ed25519 key is rejected', async (t) => {
  const h = createHarness();
  t.after(() => h.close());
  const manifestPath = path.join(h.staged.updateRoot, 'inbox', 'update-manifest.json');
  const signaturePath = path.join(h.staged.updateRoot, 'inbox', 'update-signature.txt');
  const { privateKey: wrongPrivateKey } = crypto.generateKeyPairSync('ed25519');
  const wrongSignature = crypto.sign(null, fs.readFileSync(manifestPath), wrongPrivateKey);
  fs.writeFileSync(signaturePath, wrongSignature.toString('base64'));

  const status = await h.request('GET', '/status', undefined, h.superToken);
  assert.equal(status.status, 400);
  assert.equal(status.body.state, 'invalid');
  assert.match(status.body.error, /signature is invalid/i);
});

test('prepared update applies offline, records audit, and consumes authorization', async (t) => {
  const h = createHarness();
  t.after(() => h.close());
  const prepared = await h.request('POST', '/prepare', { currentPassword: 'password123' }, h.superToken);
  assert.equal(prepared.status, 200, prepared.body?.error);

  const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'apply-update.js')], {
    cwd: h.root,
    encoding: 'utf8',
    env: {
      ...process.env,
      BLM_PROJECT_ROOT: h.root,
      BLM_DATABASE_PATH: path.join(h.root, 'database.sqlite'),
      UPDATE_PUBLIC_KEY_PATH: h.staged.publicKeyPath,
    },
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(JSON.parse(fs.readFileSync(path.join(h.root, 'release.json'), 'utf8')).version, '1.1.0');
  assert.equal(fs.readFileSync(path.join(h.root, 'README.md'), 'utf8'), '# Updated release\n');
  assert.equal(fs.existsSync(path.join(h.staged.updateRoot, 'prepared-update.json')), false);
  assert.equal(h.db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'apply_system_update'").get().count, 1);
});

test('failed update restores prior code and leaves authorization for a safe retry', async (t) => {
  const h = createHarness();
  t.after(() => h.close());
  const prepared = await h.request('POST', '/prepare', { currentPassword: 'password123' }, h.superToken);
  assert.equal(prepared.status, 200, prepared.body?.error);
  fs.writeFileSync(path.join(h.root, 'backend', 'package.json'), JSON.stringify({
    name: 'qa-backend', private: true, scripts: { test: 'node -e "process.exit(1)"' },
  }));

  const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'apply-update.js')], {
    cwd: h.root,
    encoding: 'utf8',
    env: {
      ...process.env,
      BLM_PROJECT_ROOT: h.root,
      BLM_DATABASE_PATH: path.join(h.root, 'database.sqlite'),
      UPDATE_PUBLIC_KEY_PATH: h.staged.publicKeyPath,
    },
  });
  assert.notEqual(result.status, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(h.root, 'release.json'), 'utf8')).version, '1.0.0');
  assert.equal(fs.readFileSync(path.join(h.root, 'README.md'), 'utf8'), '# Original release\n');
  assert.equal(fs.existsSync(path.join(h.staged.updateRoot, 'prepared-update.json')), true);
  assert.equal(h.db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'apply_system_update'").get().count, 0);
});
