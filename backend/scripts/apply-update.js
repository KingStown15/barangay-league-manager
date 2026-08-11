const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const Database = require('better-sqlite3');

const { inspectStagedUpdate, sha256File } = require('../services/updateService');

const PROJECT_ROOT = process.env.BLM_PROJECT_ROOT
  ? path.resolve(process.env.BLM_PROJECT_ROOT)
  : path.join(__dirname, '..', '..');
const DATABASE_PATH = process.env.BLM_DATABASE_PATH
  ? path.resolve(process.env.BLM_DATABASE_PATH)
  : path.join(PROJECT_ROOT, 'backend', 'database.sqlite');
const UPDATE_ROOT = path.join(PROJECT_ROOT, 'updates');
const PREPARED_PATH = path.join(UPDATE_ROOT, 'prepared-update.json');
const PID_PATH = path.join(PROJECT_ROOT, 'backend', 'server.pid');

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
  if (!fs.existsSync(PID_PATH)) return;
  const pid = Number(fs.readFileSync(PID_PATH, 'utf8').trim());
  if (isProcessRunning(pid)) throw new Error('The Barangay League Manager server is still running. Stop it before applying the update.');
  fs.unlinkSync(PID_PATH);
}

function run(command, args, cwd) {
  console.log(`Running: ${command} ${args.join(' ')}`);
  execFileSync(command, args, { cwd, stdio: 'inherit', windowsHide: false });
}

function copyFile(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function loadPreparedUpdate() {
  if (!fs.existsSync(PREPARED_PATH)) {
    throw new Error('No super-admin-authorized update is prepared. Use System Update in the app first.');
  }
  const prepared = JSON.parse(fs.readFileSync(PREPARED_PATH, 'utf8'));
  if (prepared.format !== 1 || !prepared.authorization_nonce || !prepared.manifest_sha256) {
    throw new Error('Prepared update authorization is invalid.');
  }
  const preparedAt = Date.parse(prepared.prepared_at);
  if (!Number.isFinite(preparedAt) || Date.now() - preparedAt > 30 * 60 * 1000 || preparedAt > Date.now() + 60_000) {
    throw new Error('Prepared update authorization has expired. Prepare it again while signed in as super admin.');
  }
  return prepared;
}

function assertPreparedActor(prepared) {
  const db = new Database(DATABASE_PATH, { readonly: true, fileMustExist: true });
  try {
    const actor = db.prepare('SELECT id, role, status FROM users WHERE id = ?').get(prepared.prepared_by);
    if (!actor || actor.role !== 'super_admin' || actor.status !== 'active') {
      throw new Error('The authorizing super-admin account is no longer active.');
    }
    const audit = db.prepare(
      "SELECT details_json FROM audit_logs WHERE user_id = ? AND action = 'prepare_system_update' ORDER BY id DESC LIMIT 1"
    ).get(prepared.prepared_by);
    const auditDetails = audit ? JSON.parse(audit.details_json || '{}') : {};
    if (!audit || auditDetails.manifest_sha256 !== prepared.manifest_sha256
      || auditDetails.authorization_nonce !== prepared.authorization_nonce) {
      throw new Error('Prepared update audit authorization could not be verified.');
    }
    return auditDetails;
  } finally {
    db.close();
  }
}

function assertPreparedBackup(prepared, auditDetails) {
  const backupRoot = path.join(PROJECT_ROOT, 'backups');
  const backupDirectory = path.resolve(prepared.database_backup || '');
  if (!backupDirectory.startsWith(`${path.resolve(backupRoot)}${path.sep}`)) {
    throw new Error('Prepared database backup path is invalid.');
  }
  const manifestPath = path.join(backupDirectory, 'backup-manifest.json');
  const databasePath = path.join(backupDirectory, 'database.sqlite');
  if (!fs.existsSync(manifestPath) || !fs.existsSync(databasePath)) {
    throw new Error('Prepared database backup is missing.');
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const actualHash = sha256File(databasePath);
  if (manifest.quick_check !== 'ok' || manifest.foreign_key_violations !== 0 || manifest.database_sha256 !== actualHash || auditDetails.backup_sha256 !== actualHash) {
    throw new Error('Prepared database backup verification failed.');
  }
  const backup = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    if (backup.pragma('quick_check', { simple: true }) !== 'ok' || backup.prepare('PRAGMA foreign_key_check').all().length > 0) {
      throw new Error('Prepared database backup integrity check failed.');
    }
  } finally {
    backup.close();
  }
}

function recordAppliedUpdate(prepared, rollbackDirectory) {
  const db = new Database(DATABASE_PATH);
  try {
    db.prepare(
      `INSERT INTO audit_logs (user_id, action, entity_type, details_json)
       VALUES (?, 'apply_system_update', 'system_update', ?)`
    ).run(prepared.prepared_by, JSON.stringify({
      from_version: prepared.current_version,
      to_version: prepared.update_version,
      manifest_sha256: prepared.manifest_sha256,
      rollback_directory: rollbackDirectory,
      database_backup: prepared.database_backup,
    }));
  } finally {
    db.close();
  }
}

function main() {
  assertServerStopped();
  const prepared = loadPreparedUpdate();
  const auditDetails = assertPreparedActor(prepared);
  assertPreparedBackup(prepared, auditDetails);
  const staged = inspectStagedUpdate({ projectRoot: PROJECT_ROOT, updateRoot: UPDATE_ROOT });
  if (staged.state !== 'ready') throw new Error(staged.message || 'The staged update is not ready.');
  if (staged.manifest_sha256 !== prepared.manifest_sha256 || staged.update.version !== prepared.update_version) {
    throw new Error('The staged update changed after super-admin authorization.');
  }

  const manifest = JSON.parse(fs.readFileSync(staged.paths.manifestPath, 'utf8'));
  const safeTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const rollbackDirectory = path.join(PROJECT_ROOT, 'backups', 'releases', `${safeTimestamp}-v${prepared.current_version}`);
  const rollbackFiles = path.join(rollbackDirectory, 'files');
  const rollbackEntries = [];
  const dependencyPaths = [
    'backend/package.json', 'backend/package-lock.json',
    'frontend/package.json', 'frontend/package-lock.json',
  ];
  const oldDependencies = Object.fromEntries(dependencyPaths.map((releasePath) => {
    const absolute = path.join(PROJECT_ROOT, ...releasePath.split('/'));
    return [releasePath, fs.existsSync(absolute) ? sha256File(absolute) : null];
  }));

  for (const file of manifest.files) {
    const target = path.join(PROJECT_ROOT, ...file.path.split('/'));
    const existed = fs.existsSync(target);
    rollbackEntries.push({ path: file.path, existed });
    if (existed) copyFile(target, path.join(rollbackFiles, ...file.path.split('/')));
  }
  fs.mkdirSync(rollbackDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(rollbackDirectory, 'rollback-manifest.json'),
    `${JSON.stringify({
      format: 1,
      created_at: new Date().toISOString(),
      from_version: prepared.current_version,
      attempted_version: prepared.update_version,
      database_backup: prepared.database_backup,
      files: rollbackEntries,
    }, null, 2)}\n`,
    { flag: 'wx' },
  );

  let applied = false;
  let backendDependenciesChanged = false;
  let frontendDependenciesChanged = false;
  try {
    for (const file of manifest.files) {
      copyFile(
        path.join(staged.paths.payloadRoot, ...file.path.split('/')),
        path.join(PROJECT_ROOT, ...file.path.split('/')),
      );
    }

    const newDependencies = Object.fromEntries(dependencyPaths.map((releasePath) => {
      const absolute = path.join(PROJECT_ROOT, ...releasePath.split('/'));
      return [releasePath, fs.existsSync(absolute) ? sha256File(absolute) : null];
    }));
    backendDependenciesChanged = dependencyPaths.slice(0, 2)
      .some((releasePath) => oldDependencies[releasePath] !== newDependencies[releasePath]);
    frontendDependenciesChanged = dependencyPaths.slice(2)
      .some((releasePath) => oldDependencies[releasePath] !== newDependencies[releasePath]);
    if (backendDependenciesChanged) {
      run('npm', ['ci', '--omit=dev'], path.join(PROJECT_ROOT, 'backend'));
    }
    if (frontendDependenciesChanged) {
      run('npm', ['ci'], path.join(PROJECT_ROOT, 'frontend'));
    }
    run('npm', ['run', 'build'], path.join(PROJECT_ROOT, 'frontend'));
    run('npm', ['test'], path.join(PROJECT_ROOT, 'backend'));

    const installedRelease = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'release.json'), 'utf8'));
    if (installedRelease.version !== prepared.update_version) throw new Error('Installed release version verification failed.');
    recordAppliedUpdate(prepared, rollbackDirectory);
    fs.writeFileSync(
      path.join(UPDATE_ROOT, 'last-update.json'),
      `${JSON.stringify({
        applied_at: new Date().toISOString(),
        applied_by: prepared.prepared_by,
        from_version: prepared.current_version,
        to_version: prepared.update_version,
        manifest_sha256: prepared.manifest_sha256,
        rollback_directory: rollbackDirectory,
        database_backup: prepared.database_backup,
      }, null, 2)}\n`,
    );
    fs.unlinkSync(PREPARED_PATH);
    applied = true;
    console.log(`Update ${prepared.update_version} applied and verified successfully.`);
    console.log(`Code rollback snapshot: ${rollbackDirectory}`);
    console.log(`Database rollback backup: ${prepared.database_backup}`);
  } finally {
    if (!applied) {
      console.error('Update failed. Restoring the previous code files...');
      for (const entry of rollbackEntries) {
        const target = path.join(PROJECT_ROOT, ...entry.path.split('/'));
        if (entry.existed) copyFile(path.join(rollbackFiles, ...entry.path.split('/')), target);
        else if (fs.existsSync(target)) fs.unlinkSync(target);
      }
      try {
        if (backendDependenciesChanged) {
          run('npm', ['ci', '--omit=dev'], path.join(PROJECT_ROOT, 'backend'));
        }
        if (frontendDependenciesChanged) {
          run('npm', ['ci'], path.join(PROJECT_ROOT, 'frontend'));
        }
      } catch {}
      try { run('npm', ['run', 'build'], path.join(PROJECT_ROOT, 'frontend')); } catch {}
      console.error(`Previous code restored from ${rollbackDirectory}.`);
      console.error(`The verified database backup remains at ${prepared.database_backup}.`);
    }
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[UPDATE ERROR] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { main, assertServerStopped, isProcessRunning };
