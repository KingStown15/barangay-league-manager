require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const os = require('os');
const release = require('../release.json');

const { initDatabase } = require('./db/init');
const { assertSecureJwtConfig } = require('./middleware/auth');

assertSecureJwtConfig();
const app = express();
const PID_PATH = process.env.BLM_PID_PATH
  ? path.resolve(process.env.BLM_PID_PATH)
  : path.join(__dirname, 'server.pid');
function processIsRunning(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}
if (fs.existsSync(PID_PATH)) {
  const existingPid = Number(fs.readFileSync(PID_PATH, 'utf8').trim());
  if (processIsRunning(existingPid)) {
    throw new Error(`Another Barangay League Manager server is already running (PID ${existingPid}).`);
  }
  fs.unlinkSync(PID_PATH);
}
fs.mkdirSync(path.dirname(PID_PATH), { recursive: true });
fs.writeFileSync(PID_PATH, `${process.pid}\n`, { flag: 'wx' });
let db;
try {
  db = initDatabase();
} catch (error) {
  try { fs.unlinkSync(PID_PATH); } catch {}
  throw error;
}

app.use(helmet({
  strictTransportSecurity: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", 'data:'],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      scriptSrcAttr: ["'none'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      upgradeInsecureRequests: null,
    },
  },
}));
app.use(express.json({ limit: '1mb' }));
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// --- API routes ---
app.use('/api/auth', require('./routes/auth')(db));
app.use('/api/tournaments', require('./routes/tournaments')(db));
app.use('/api/teams', require('./routes/teams')(db));
app.use('/api/players', require('./routes/players')(db));
app.use('/api/participants', require('./routes/participants')(db));
app.use('/api/tournaments', require('./routes/competitionEntries')(db));
app.use('/api/games', require('./routes/games')(db));
app.use('/api/games', require('./routes/pickleball')(db));
app.use('/api/standings', require('./routes/standings')(db));
app.use('/api/bracket', require('./routes/bracket')(db));
app.use('/api/dashboard', require('./routes/dashboard')(db));
app.use('/api/public', require('./routes/public')(db));
app.use('/api/live', require('./routes/live')(db));
app.use('/api/system-update', require('./routes/systemUpdate')(db));

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'barangay-league-manager',
    version: release.version,
    time: new Date().toISOString(),
  });
});

// --- Serve the built frontend (npm run build in /frontend outputs to /frontend/dist) ---
const FRONTEND_DIST = path.join(__dirname, '..', 'frontend', 'dist');
if (fs.existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res.send(
      '<h1>Barangay League Manager backend is running.</h1>' +
      '<p>The frontend has not been built yet. Run <code>npm run build --prefix frontend</code> ' +
      'from the project root, then restart the backend.</p>'
    );
  });
}

// Global Express error handler — prevents stack traces leaking to clients
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error.' });
});

const PORT = process.env.PORT || 3100;

const server = app.listen(PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) addresses.push(net.address);
    }
  }
  console.log('======================================================');
  console.log(' Barangay League Manager is running');
  console.log(`   On this computer:  http://localhost:${PORT}`);
  addresses.forEach((addr) => console.log(`   On the network:    http://${addr}:${PORT}`));
  console.log('======================================================');
});

server.on('error', (error) => {
  console.error('Server failed to start:', error.message);
  try { db.close(); } catch {}
  try { fs.unlinkSync(PID_PATH); } catch {}
  process.exit(1);
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; closing the server safely...`);
  server.close(() => {
    try { db.close(); } catch {}
    try { fs.unlinkSync(PID_PATH); } catch {}
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
  shutdown('unhandledRejection');
});
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  shutdown('uncaughtException');
});
