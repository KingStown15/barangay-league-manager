const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const DEFAULT_BACKUP_ROOT = path.join(PROJECT_ROOT, 'backups');

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function normalizeLabel(value) {
  const label = String(value || 'manual').toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  return label.slice(0, 40) || 'manual';
}

function verifyDatabaseBackup(directory) {
  const manifestPath = path.join(directory, 'backup-manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error('Backup manifest is missing.');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.format !== 1 || manifest.database_file !== 'database.sqlite') {
    throw new Error('Backup manifest format is invalid.');
  }
  const databasePath = path.join(directory, manifest.database_file);
  if (!fs.existsSync(databasePath)) throw new Error('Backup database is missing.');
  if (fs.statSync(databasePath).size !== manifest.database_bytes || sha256(databasePath) !== manifest.database_sha256) {
    throw new Error('Backup file hash or size does not match its manifest.');
  }
  const backup = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const quickCheck = backup.pragma('quick_check', { simple: true });
    const foreignKeyViolations = backup.prepare('PRAGMA foreign_key_check').all().length;
    if (quickCheck !== 'ok' || foreignKeyViolations !== 0
      || manifest.quick_check !== 'ok' || manifest.foreign_key_violations !== 0) {
      throw new Error('Backup database integrity verification failed.');
    }
  } finally {
    backup.close();
  }
  return { directory, databasePath, manifest };
}

async function createDatabaseBackup({
  sourcePath,
  backupRoot = DEFAULT_BACKUP_ROOT,
  label = 'manual',
} = {}) {
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    throw new Error('Database file does not exist; nothing was backed up.');
  }

  const directory = path.join(backupRoot, `${timestamp()}-${normalizeLabel(label)}`);
  const destination = path.join(directory, 'database.sqlite');
  fs.mkdirSync(directory, { recursive: true });

  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    await source.backup(destination);
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  } finally {
    source.close();
  }

  const manifest = {
    format: 1,
    created_at: new Date().toISOString(),
    label: normalizeLabel(label),
    database_file: 'database.sqlite',
    database_bytes: fs.statSync(destination).size,
    database_sha256: sha256(destination),
    quick_check: 'ok',
    foreign_key_violations: 0,
  };
  fs.writeFileSync(
    path.join(directory, 'backup-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { flag: 'wx' },
  );

  try {
    verifyDatabaseBackup(directory);
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw new Error(`Backup verification failed; the incomplete backup was removed. ${error.message}`);
  }

  return { directory, destination, manifest };
}

module.exports = { createDatabaseBackup, verifyDatabaseBackup, DEFAULT_BACKUP_ROOT };
