const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const ENV_PATH = path.join(__dirname, '..', '.env');
const DEFAULT_PORT = '3100';
const LEGACY_DEFAULT_PORT = '3000';
const INSECURE_SECRETS = new Set([
  'barangay-league-manager-change-this-secret',
  'change-this-to-any-random-text',
]);

function generateSecret() {
  return crypto.randomBytes(48).toString('base64url');
}

function ensureConfig(envPath = ENV_PATH) {
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const parsed = dotenv.parse(existing);
  const current = String(parsed.JWT_SECRET || '').trim();
  let updated = existing;
  let changed = false;

  if (!updated) {
    updated = `PORT=${DEFAULT_PORT}\n`;
    changed = true;
  } else if (String(parsed.PORT || '').trim() === LEGACY_DEFAULT_PORT) {
    updated = updated.replace(/^PORT=3000\s*$/m, `PORT=${DEFAULT_PORT}`);
    changed = true;
    console.log(`Migrated the League Manager port from ${LEGACY_DEFAULT_PORT} to ${DEFAULT_PORT} to avoid the reserved BMS port.`);
  } else if (!String(parsed.PORT || '').trim()) {
    if (!updated.endsWith('\n')) updated += '\n';
    updated += `PORT=${DEFAULT_PORT}\n`;
    changed = true;
  }

  if (current.length < 32 || INSECURE_SECRETS.has(current)) {
    const nextSecret = generateSecret();
    if (/^JWT_SECRET=.*$/m.test(updated)) {
      updated = updated.replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${nextSecret}`);
    } else {
      if (updated && !updated.endsWith('\n')) updated += '\n';
      updated += `JWT_SECRET=${nextSecret}\n`;
    }
    changed = true;
    console.log('Generated a unique persistent session secret in backend/.env.');
  }

  if (changed) fs.writeFileSync(envPath, updated, { mode: 0o600 });
  else console.log('Security and network configuration are ready.');
  return changed;
}

if (require.main === module) ensureConfig();

module.exports = { ensureConfig, ENV_PATH, DEFAULT_PORT };
