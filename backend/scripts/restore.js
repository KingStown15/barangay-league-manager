const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const { createDatabaseBackup, verifyDatabaseBackup } = require('../services/backupService');

const projectRoot = process.env.BLM_PROJECT_ROOT
  ? path.resolve(process.env.BLM_PROJECT_ROOT)
  : path.join(__dirname, '..', '..');
const databasePath = process.env.BLM_DATABASE_PATH
  ? path.resolve(process.env.BLM_DATABASE_PATH)
  : path.join(projectRoot, 'backend', 'database.sqlite');
const backupRoot = path.join(projectRoot, 'backups');
const pidPath = path.join(projectRoot, 'backend', 'server.pid');

function isProcessRunning(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function assertServerStopped() {
  if (!fs.existsSync(pidPath)) return;
  const pid = Number(fs.readFileSync(pidPath, 'utf8').trim());
  if (isProcessRunning(pid)) throw new Error('The server is still running. Stop it before restoring a database.');
  fs.unlinkSync(pidPath);
}

async function restoreDatabase(backupDirectory) {
  assertServerStopped();
  const resolvedBackup = path.resolve(backupDirectory);
  if (!resolvedBackup.startsWith(`${path.resolve(backupRoot)}${path.sep}`)) {
    throw new Error('Restore source must be a verified folder inside this project\'s backups directory.');
  }
  const source = verifyDatabaseBackup(resolvedBackup);
  const preRestore = fs.existsSync(databasePath)
    ? await createDatabaseBackup({ sourcePath: databasePath, backupRoot, label: 'pre-restore' })
    : null;
  const temporaryPath = `${databasePath}.restore-tmp`;
  const displacedPath = `${databasePath}.restore-displaced`;
  if (fs.existsSync(temporaryPath) || fs.existsSync(displacedPath)) {
    throw new Error('A previous restore marker exists. Ask a developer to inspect it before retrying.');
  }

  let displaced = false;
  try {
    fs.copyFileSync(source.databasePath, temporaryPath, fs.constants.COPYFILE_EXCL);
    const temporary = new Database(temporaryPath, { readonly: true, fileMustExist: true });
    try {
      if (temporary.pragma('quick_check', { simple: true }) !== 'ok'
        || temporary.prepare('PRAGMA foreign_key_check').all().length > 0) {
        throw new Error('Copied restore database failed integrity verification.');
      }
    } finally {
      temporary.close();
    }
    if (fs.existsSync(databasePath)) {
      fs.renameSync(databasePath, displacedPath);
      displaced = true;
    }
    for (const suffix of ['-wal', '-shm', '-journal']) {
      if (fs.existsSync(`${databasePath}${suffix}`)) fs.unlinkSync(`${databasePath}${suffix}`);
    }
    fs.renameSync(temporaryPath, databasePath);
    const restored = new Database(databasePath);
    try {
      if (restored.pragma('quick_check', { simple: true }) !== 'ok'
        || restored.prepare('PRAGMA foreign_key_check').all().length > 0) {
        throw new Error('Restored database failed final verification.');
      }
      const hasAuditLogs = restored.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'audit_logs'").get();
      if (hasAuditLogs) {
        restored.prepare(
          "INSERT INTO audit_logs (action, entity_type, details_json) VALUES ('restore_database', 'database', ?)"
        ).run(JSON.stringify({ source_backup: resolvedBackup, pre_restore_backup: preRestore?.directory || null }));
      }
    } finally {
      restored.close();
    }
    if (displaced && fs.existsSync(displacedPath)) fs.unlinkSync(displacedPath);
    return { source: resolvedBackup, preRestore: preRestore?.directory || null };
  } catch (error) {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    if (preRestore) {
      fs.copyFileSync(preRestore.destination, databasePath);
      if (displaced && fs.existsSync(displacedPath)) fs.unlinkSync(displacedPath);
    } else if (displaced && fs.existsSync(displacedPath)) {
      fs.renameSync(displacedPath, databasePath);
    }
    throw error;
  }
}

async function main() {
  const backupDirectory = process.argv[2];
  if (!backupDirectory || !process.argv.includes('--confirm-restore')) {
    throw new Error('Usage: node backend/scripts/restore.js <backup-folder> --confirm-restore');
  }
  const result = await restoreDatabase(backupDirectory);
  console.log(`Database restored and verified from: ${result.source}`);
  if (result.preRestore) console.log(`Pre-restore safety backup: ${result.preRestore}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[RESTORE ERROR] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { restoreDatabase, assertServerStopped };
