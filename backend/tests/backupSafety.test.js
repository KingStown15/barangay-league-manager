const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');

const { createDatabaseBackup } = require('../services/backupService');

test('online backup includes committed WAL rows and verifies the result', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'blm-backup-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const sourcePath = path.join(directory, 'source.sqlite');
  const db = new Database(sourcePath);
  t.after(() => db.close());
  db.pragma('journal_mode = WAL');
  db.exec("CREATE TABLE proof (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO proof(value) VALUES ('checkpointed')");
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.prepare('INSERT INTO proof(value) VALUES (?)').run('committed-in-wal');
  assert.ok(fs.statSync(`${sourcePath}-wal`).size > 0);

  const result = await createDatabaseBackup({
    sourcePath,
    backupRoot: path.join(directory, 'backups'),
    label: 'qa',
  });
  const backup = new Database(result.destination, { readonly: true });
  try {
    assert.equal(backup.prepare('SELECT COUNT(*) AS count FROM proof').get().count, 2);
    assert.equal(backup.pragma('quick_check', { simple: true }), 'ok');
  } finally {
    backup.close();
  }
  assert.equal(result.manifest.foreign_key_violations, 0);
  assert.match(result.manifest.database_sha256, /^[a-f0-9]{64}$/);
});

test('offline restore verifies the source and preserves a pre-restore safety backup', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blm-restore-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'backend'), { recursive: true });
  const databasePath = path.join(root, 'backend', 'database.sqlite');
  const db = new Database(databasePath);
  db.exec("CREATE TABLE proof (value TEXT); INSERT INTO proof VALUES ('wanted')");
  db.close();
  const wanted = await createDatabaseBackup({
    sourcePath: databasePath,
    backupRoot: path.join(root, 'backups'),
    label: 'wanted',
  });
  const changed = new Database(databasePath);
  changed.exec("DELETE FROM proof; INSERT INTO proof VALUES ('unwanted')");
  changed.close();

  const result = spawnSync(process.execPath, [
    path.join(__dirname, '..', 'scripts', 'restore.js'),
    wanted.directory,
    '--confirm-restore',
  ], {
    encoding: 'utf8',
    env: { ...process.env, BLM_PROJECT_ROOT: root, BLM_DATABASE_PATH: databasePath },
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const restored = new Database(databasePath, { readonly: true });
  try {
    assert.equal(restored.prepare('SELECT value FROM proof').get().value, 'wanted');
  } finally {
    restored.close();
  }
  const backupFolders = fs.readdirSync(path.join(root, 'backups'));
  assert.ok(backupFolders.some((name) => name.endsWith('-pre-restore')));
});

test('restore refuses a database outside the managed backup folder', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blm-restore-boundary-'));
  try {
    fs.mkdirSync(path.join(root, 'backend'), { recursive: true });
    const outside = path.join(root, 'outside');
    fs.mkdirSync(outside);
    const result = spawnSync(process.execPath, [
      path.join(__dirname, '..', 'scripts', 'restore.js'),
      outside,
      '--confirm-restore',
    ], {
      encoding: 'utf8',
      env: { ...process.env, BLM_PROJECT_ROOT: root, BLM_DATABASE_PATH: path.join(root, 'backend', 'database.sqlite') },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /inside this project's backups directory/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
