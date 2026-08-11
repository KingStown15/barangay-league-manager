const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const INSECURE_SECRETS = new Set([
  'barangay-league-manager-change-this-secret',
  'change-this-to-any-random-text',
]);
const configuredSecret = String(process.env.JWT_SECRET || '').trim();
const JWT_SECRET = configuredSecret || crypto.randomBytes(64).toString('hex');

function assertSecureJwtConfig() {
  if (!configuredSecret) {
    throw new Error('JWT_SECRET is required. Run node backend/scripts/ensure-config.js first.');
  }
  if (configuredSecret.length < 32 || INSECURE_SECRETS.has(configuredSecret)) {
    throw new Error('JWT_SECRET must be a unique random value of at least 32 characters.');
  }
}

function isAdminRole(role) {
  return role === 'admin' || role === 'super_admin';
}

function roleSatisfies(actualRole, allowedRoles) {
  if (allowedRoles.includes(actualRole)) return true;
  return actualRole === 'super_admin' && allowedRoles.includes('admin');
}

// Simple in-memory rate limiter (login endpoint)
const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW = 60_000;
const RATE_LIMIT_MAX = 10;

function loginRateLimiter(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  for (const [key, value] of rateLimitStore) {
    if (now - value.windowStart >= RATE_LIMIT_WINDOW) rateLimitStore.delete(key);
  }
  if (rateLimitStore.size >= 10_000 && !rateLimitStore.has(ip)) {
    const oldest = rateLimitStore.keys().next().value;
    rateLimitStore.delete(oldest);
  }
  const entry = rateLimitStore.get(ip);
  if (entry && now - entry.windowStart < RATE_LIMIT_WINDOW) {
    entry.count += 1;
    if (entry.count > RATE_LIMIT_MAX) {
      return res.status(429).json({ error: 'Too many login attempts. Try again in 1 minute.' });
    }
  } else {
    rateLimitStore.set(ip, { count: 1, windowStart: now });
  }
  next();
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Login required.' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Session expired. Please log in again.' });
  }
}

function requireAuthFor(db) {
  return (req, res, next) => {
    requireAuth(req, res, () => {
      const user = db.prepare(
        'SELECT id, username, role, status, session_version FROM users WHERE id = ?'
      ).get(req.user.id);
      if (!user || user.status !== 'active' || Number(req.user.sessionVersion) !== user.session_version) {
        return res.status(401).json({ error: 'Session expired. Please log in again.' });
      }
      req.user = { id: user.id, username: user.username, role: user.role, sessionVersion: user.session_version };
      next();
    });
  };
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roleSatisfies(req.user.role, roles)) {
      return res.status(403).json({ error: 'You do not have permission to do that.' });
    }
    next();
  };
}

module.exports = {
  requireAuth,
  requireAuthFor,
  requireRole,
  loginRateLimiter,
  JWT_SECRET,
  assertSecureJwtConfig,
  isAdminRole,
  roleSatisfies,
};
