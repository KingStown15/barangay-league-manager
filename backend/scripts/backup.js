const fs = require('fs');
const path = require('path');
const { createDatabaseBackup } = require('../services/backupService');
const { DB_PATH } = require('../db/init');

async function main() {
  const preStart = process.argv.includes('--pre-start');
  if (!fs.existsSync(DB_PATH)) {
    if (preStart) {
      console.log('No existing database yet; pre-start backup skipped.');
      return;
    }
    throw new Error('No database exists yet. Start the app once before creating a backup.');
  }

  const result = await createDatabaseBackup({
    sourcePath: DB_PATH,
    backupRoot: path.join(__dirname, '..', '..', 'backups'),
    label: preStart ? 'pre-start' : 'manual',
  });
  console.log(`Verified backup created: ${result.directory}`);
  console.log(`SHA-256: ${result.manifest.database_sha256}`);
}

main().catch((error) => {
  console.error(`[BACKUP ERROR] ${error.message}`);
  process.exitCode = 1;
});
