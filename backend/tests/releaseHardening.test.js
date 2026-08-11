const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');

const authRoutes = require('../routes/auth');
const { JWT_SECRET } = require('../middleware/auth');
const { migrateUserRoles, ensureSuperAdmin } = require('../db/init');
const { ensureConfig, DEFAULT_PORT } = require('../scripts/ensure-config');

const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');

test('security config uses the dedicated port and migrates the former default without rotating a valid secret', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blm-config-test-'));
  const envPath = path.join(root, '.env');
  const customEnvPath = path.join(root, '.env.custom');
  const secret = 'a'.repeat(48);
  try {
    fs.writeFileSync(envPath, `PORT=3000\nJWT_SECRET=${secret}\n`);
    assert.equal(ensureConfig(envPath), true);
    const migrated = fs.readFileSync(envPath, 'utf8');
    assert.match(migrated, new RegExp(`^PORT=${DEFAULT_PORT}$`, 'm'));
    assert.match(migrated, new RegExp(`^JWT_SECRET=${secret}$`, 'm'));
    assert.equal(ensureConfig(envPath), false);

    const customConfig = `PORT=4567\nJWT_SECRET=${secret}\n`;
    fs.writeFileSync(customEnvPath, customConfig);
    assert.equal(ensureConfig(customEnvPath), false);
    assert.equal(fs.readFileSync(customEnvPath, 'utf8'), customConfig);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function tokenFor(id, username, role, secret = JWT_SECRET, sessionVersion = 1) {
  return jwt.sign({ id, username, role, sessionVersion }, secret, { expiresIn: '1h' });
}

function expiredTokenFor(id, username, role, sessionVersion = 1) {
  return jwt.sign(
    { id, username, role, sessionVersion },
    JWT_SECRET,
    { expiresIn: -1 },
  );
}

function createHarness() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(schema);
  const hash = bcrypt.hashSync('password123', 4);
  db.prepare('INSERT INTO users (id, username, password_hash, role, status) VALUES (?, ?, ?, ?, ?)')
    .run(1, 'owner', hash, 'super_admin', 'active');
  db.prepare('INSERT INTO users (id, username, password_hash, role, status) VALUES (?, ?, ?, ?, ?)')
    .run(2, 'admin', hash, 'admin', 'active');
  db.prepare('INSERT INTO users (id, username, password_hash, role, status) VALUES (?, ?, ?, ?, ?)')
    .run(3, 'scorer', hash, 'scorer', 'active');

  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes(db));
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/auth`;

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
    db,
    request,
    superToken: tokenFor(1, 'owner', 'super_admin'),
    adminToken: tokenFor(2, 'admin', 'admin'),
    scorerToken: tokenFor(3, 'scorer', 'scorer'),
    close: () => new Promise((resolve) => server.close(() => { db.close(); resolve(); })),
  };
}

test('legacy user schema migrates transactionally and promotes one active admin', () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin', 'scorer')),
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        action TEXT NOT NULL
      );
      INSERT INTO users (id, username, password_hash, role) VALUES (7, 'legacy-admin', 'x', 'admin');
      INSERT INTO audit_logs (user_id, action) VALUES (7, 'existing');
    `);

    assert.equal(migrateUserRoles(db), true);
    assert.equal(ensureSuperAdmin(db), 7);
    assert.equal(db.prepare('SELECT role FROM users WHERE id = 7').get().role, 'super_admin');
    assert.equal(db.prepare('SELECT user_id FROM audit_logs').get().user_id, 7);
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
    assert.equal(migrateUserRoles(db), false);
  } finally {
    db.close();
  }
});

test('known legacy signing secret cannot forge a session', async (t) => {
  const h = createHarness();
  t.after(() => h.close());
  const forged = tokenFor(999, 'forged', 'super_admin', 'barangay-league-manager-change-this-secret');
  assert.equal((await h.request('GET', '/users', undefined, forged)).status, 401);
});

test('login accepts valid credentials, rejects invalid credentials, and expired sessions fail closed', async (t) => {
  const h = createHarness();
  t.after(() => h.close());

  const valid = await h.request('POST', '/login', {
    username: 'scorer', password: 'password123',
  });
  assert.equal(valid.status, 200);
  assert.equal(valid.body.user.role, 'scorer');
  assert.ok(valid.body.token);

  const invalid = await h.request('POST', '/login', {
    username: 'scorer', password: 'incorrect-password',
  });
  assert.equal(invalid.status, 401);
  assert.equal(invalid.body.error, 'Invalid username or password.');

  const expired = expiredTokenFor(3, 'scorer', 'scorer');
  assert.equal((await h.request('GET', '/me', undefined, expired)).status, 401);
});

test('super admin inherits admin access while privileged account management stays isolated', async (t) => {
  const h = createHarness();
  t.after(() => h.close());

  assert.equal((await h.request('GET', '/users', undefined, h.superToken)).status, 200);
  assert.equal((await h.request('GET', '/users', undefined, h.adminToken)).status, 200);
  assert.equal((await h.request('POST', '/users', {
    username: 'blocked-owner', password: 'password123', role: 'super_admin',
  }, h.adminToken)).status, 403);
  assert.equal((await h.request('POST', '/users', {
    username: 'second-owner', password: 'password123', role: 'super_admin', currentPassword: 'password123',
  }, h.superToken)).status, 201);
  assert.equal((await h.request('POST', '/users/1/reset-password', {
    newPassword: 'updated123',
  }, h.adminToken)).status, 403);
  assert.equal((await h.request('PATCH', '/users/1/status', {
    status: 'inactive',
  }, h.adminToken)).status, 403);
});

test('a super-admin session alone cannot grant or take over super-admin privileges', async (t) => {
  const h = createHarness();
  t.after(() => h.close());
  const createWithoutPassword = await h.request('POST', '/users', {
    username: 'unauthorized-owner', password: 'password123', role: 'super_admin',
  }, h.superToken);
  assert.equal(createWithoutPassword.status, 401);
  assert.equal(h.db.prepare("SELECT COUNT(*) AS count FROM users WHERE username = 'unauthorized-owner'").get().count, 0);

  h.db.prepare('INSERT INTO users (id, username, password_hash, role, status) VALUES (?, ?, ?, ?, ?)')
    .run(4, 'second-owner', bcrypt.hashSync('password123', 4), 'super_admin', 'active');
  assert.equal((await h.request('POST', '/users/4/reset-password', {
    newPassword: 'replacement123',
  }, h.superToken)).status, 401);
  assert.equal((await h.request('PATCH', '/users/4/status', {
    status: 'inactive',
  }, h.superToken)).status, 401);
});

test('self-deactivation is blocked and deactivated sessions stop working immediately', async (t) => {
  const h = createHarness();
  t.after(() => h.close());

  const self = await h.request('PATCH', '/users/1/status', { status: 'inactive' }, h.superToken);
  assert.equal(self.status, 409);
  assert.match(self.body.error, /own account/i);

  assert.equal((await h.request('PATCH', '/users/3/status', { status: 'inactive' }, h.adminToken)).status, 200);
  assert.equal((await h.request('GET', '/me', undefined, h.scorerToken)).status, 401);
  const audit = h.db.prepare("SELECT details_json FROM audit_logs WHERE action = 'update_user_status' AND entity_id = 3").get();
  assert.deepEqual(JSON.parse(audit.details_json), { status: 'inactive' });
});

test('password changes and resets are audited and revoke prior sessions', async (t) => {
  const h = createHarness();
  t.after(() => h.close());

  assert.equal((await h.request('POST', '/change-password', {
    currentPassword: 'password123', newPassword: 'newpassword123',
  }, h.scorerToken)).status, 200);
  assert.equal((await h.request('GET', '/me', undefined, h.scorerToken)).status, 401);
  const renewedScorerToken = tokenFor(3, 'scorer', 'scorer', JWT_SECRET, 2);
  assert.equal((await h.request('POST', '/users/3/reset-password', {
    newPassword: 'resetpassword123',
  }, h.adminToken)).status, 200);
  assert.equal((await h.request('GET', '/me', undefined, renewedScorerToken)).status, 401);
  const actions = h.db.prepare(
    "SELECT action FROM audit_logs WHERE entity_id = 3 AND action IN ('change_password', 'reset_user_password') ORDER BY id"
  ).all().map((row) => row.action);
  assert.deepEqual(actions, ['change_password', 'reset_user_password']);
});

test('an administrator cannot bypass current-password verification for their own reset', async (t) => {
  const h = createHarness();
  t.after(() => h.close());
  const response = await h.request('POST', '/users/2/reset-password', {
    newPassword: 'replacement123',
  }, h.adminToken);
  assert.equal(response.status, 409);
  assert.match(response.body.error, /change password/i);
});

test('privileged user mutations roll back when their audit record cannot be written', async (t) => {
  const h = createHarness();
  t.after(() => h.close());
  h.db.exec('DROP TABLE audit_logs');
  const response = await h.request('POST', '/users', {
    username: 'must-not-persist', password: 'password123', role: 'scorer',
  }, h.adminToken);
  assert.equal(response.status, 500);
  assert.equal(h.db.prepare("SELECT COUNT(*) AS count FROM users WHERE username = 'must-not-persist'").get().count, 0);
});
