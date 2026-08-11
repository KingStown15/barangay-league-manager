const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const DEFAULT_UPDATE_ROOT = path.join(PROJECT_ROOT, 'updates');
const ROOT_FILES = new Set([
  'APPLY_UPDATE.bat',
  'BACKUP.bat',
  'NETWORK_CHECK.bat',
  'README.md',
  'REBUILD.bat',
  'RESTORE.bat',
  'START.bat',
  'package-lock.json',
  'package.json',
  'release.json',
]);
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const MAX_UPDATE_FILES = 10_000;
const MAX_UPDATE_BYTES = 1024 * 1024 * 1024;
const DEPENDENCY_FILES = [
  'backend/package.json',
  'backend/package-lock.json',
  'frontend/package.json',
  'frontend/package-lock.json',
];

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

function normalizeReleasePath(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Update file path is required.');
  const normalized = value.replaceAll('\\', '/');
  if (normalized.length > 240 || normalized.startsWith('/') || normalized.includes('\0')) throw new Error(`Unsafe update path: ${value}`);
  const parts = normalized.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || /[<>:"|?*]/.test(part) || /[. ]$/.test(part) || WINDOWS_RESERVED_NAMES.test(part))) {
    throw new Error(`Unsafe update path: ${value}`);
  }
  return parts.join('/');
}

function isAllowedReleasePath(releasePath) {
  if (ROOT_FILES.has(releasePath)) return true;
  if (!(releasePath.startsWith('backend/') || releasePath.startsWith('frontend/'))) return false;
  const blocked = [
    '/.env', '/config/update-public-key.pem', '/database.sqlite', '/node_modules/',
    '/backups/', '/updates/', '/uploads/',
  ];
  const wrapped = `/${releasePath}/`;
  return !blocked.some((value) => wrapped.includes(value));
}

function parseVersion(value) {
  const match = String(value || '').match(/^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/);
  if (!match) throw new Error('Release version must use semantic versioning (for example, 1.2.0).');
  return match.slice(1).map(Number);
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  }
  return 0;
}

function walkPayload(root, current = root, result = []) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error('Update payload cannot contain symbolic links.');
    if (entry.isDirectory()) walkPayload(root, absolute, result);
    else if (entry.isFile()) result.push(path.relative(root, absolute).split(path.sep).join('/'));
    else throw new Error(`Unsupported update payload entry: ${entry.name}`);
  }
  return result.sort();
}

function readCurrentRelease(projectRoot = PROJECT_ROOT) {
  const releasePath = path.join(projectRoot, 'release.json');
  const release = JSON.parse(fs.readFileSync(releasePath, 'utf8'));
  parseVersion(release.version);
  return release;
}

function inspectStagedUpdate({
  projectRoot = PROJECT_ROOT,
  updateRoot = DEFAULT_UPDATE_ROOT,
  publicKeyPath = process.env.UPDATE_PUBLIC_KEY_PATH
    ? path.resolve(projectRoot, process.env.UPDATE_PUBLIC_KEY_PATH)
    : path.join(projectRoot, 'backend', 'config', 'update-public-key.pem'),
} = {}) {
  const current = readCurrentRelease(projectRoot);
  const inbox = path.join(updateRoot, 'inbox');
  const manifestPath = path.join(inbox, 'update-manifest.json');
  const signaturePath = path.join(inbox, 'update-signature.txt');
  const payloadRoot = path.join(inbox, 'payload');

  if (!fs.existsSync(publicKeyPath)) {
    return { state: 'not_configured', current, message: 'A trusted update public key has not been configured.' };
  }
  if (!fs.existsSync(manifestPath) || !fs.existsSync(signaturePath) || !fs.existsSync(payloadRoot)) {
    return { state: 'no_update', current, message: 'No staged update package was found.' };
  }

  const manifestBytes = fs.readFileSync(manifestPath);
  let manifest;
  try { manifest = JSON.parse(manifestBytes.toString('utf8')); } catch { throw new Error('Update manifest is not valid JSON.'); }
  if (manifest.format !== 1 || !Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error('Update manifest format is invalid.');
  }
  if (manifest.files.length > MAX_UPDATE_FILES) throw new Error('Update manifest contains too many files.');
  if (compareVersions(manifest.version, current.version) <= 0) {
    throw new Error(`Update version ${manifest.version} is not newer than ${current.version}.`);
  }

  const publicKey = crypto.createPublicKey(fs.readFileSync(publicKeyPath));
  if (publicKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('Trusted update public key must be Ed25519.');
  }
  const signature = Buffer.from(fs.readFileSync(signaturePath, 'utf8').trim(), 'base64');
  if (!signature.length || !crypto.verify(null, manifestBytes, publicKey, signature)) {
    throw new Error('Update signature is invalid.');
  }

  const expected = new Map();
  let expectedBytes = 0;
  for (const file of manifest.files) {
    const releasePath = normalizeReleasePath(file.path);
    if (!isAllowedReleasePath(releasePath)) throw new Error(`Update path is not allowed: ${releasePath}`);
    if (expected.has(releasePath)) throw new Error(`Duplicate update path: ${releasePath}`);
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 0 || !/^[a-f0-9]{64}$/.test(file.sha256 || '')) {
      throw new Error(`Invalid file metadata for ${releasePath}.`);
    }
    expectedBytes += file.bytes;
    if (!Number.isSafeInteger(expectedBytes) || expectedBytes > MAX_UPDATE_BYTES) {
      throw new Error('Update payload exceeds the maximum supported size.');
    }
    expected.set(releasePath, file);
  }
  if (!expected.has('release.json')) throw new Error('Update payload must include release.json.');

  const actualPaths = walkPayload(payloadRoot);
  if (actualPaths.length !== expected.size || actualPaths.some((releasePath) => !expected.has(releasePath))) {
    throw new Error('Update payload files do not exactly match the signed manifest.');
  }
  for (const releasePath of actualPaths) {
    const file = expected.get(releasePath);
    const absolute = path.join(payloadRoot, ...releasePath.split('/'));
    if (fs.statSync(absolute).size !== file.bytes || sha256File(absolute) !== file.sha256) {
      throw new Error(`Update payload verification failed for ${releasePath}.`);
    }
  }
  const nextRelease = JSON.parse(fs.readFileSync(path.join(payloadRoot, 'release.json'), 'utf8'));
  if (nextRelease.version !== manifest.version) {
    throw new Error('Signed manifest version does not match payload release.json.');
  }

  const dependencyChanges = DEPENDENCY_FILES.filter((releasePath) => {
    const stagedFile = expected.get(releasePath);
    if (!stagedFile) return false;
    const installedPath = path.join(projectRoot, ...releasePath.split('/'));
    return !fs.existsSync(installedPath) || sha256File(installedPath) !== stagedFile.sha256;
  });

  return {
    state: 'ready',
    current,
    update: {
      version: manifest.version,
      files: actualPaths.length,
      notes: manifest.notes || null,
      dependency_changes: dependencyChanges,
      requires_network_or_cached_dependencies: dependencyChanges.length > 0,
    },
    manifest_sha256: sha256Buffer(manifestBytes),
    paths: { inbox, payloadRoot, manifestPath, signaturePath },
  };
}

module.exports = {
  PROJECT_ROOT,
  DEFAULT_UPDATE_ROOT,
  compareVersions,
  inspectStagedUpdate,
  isAllowedReleasePath,
  normalizeReleasePath,
  readCurrentRelease,
  sha256File,
};
