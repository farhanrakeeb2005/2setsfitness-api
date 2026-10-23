const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many AI requests — please wait a minute.' },
});

// cloud backup syncs: a few per minute per phone is normal. (The app now
// backs up to Firestore directly; /sync stays for older app builds.) Counted per
// signed-in user (it runs after the token check), not per IP.
// every route: a generous per-client cap, so a script can't hammer the API
// (each request costs Cloud Run time and a database round trip); the app
// makes a handful of calls per screen
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please wait a minute.' },
});

const syncLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: (req) => req.user.id,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many sync requests — please wait a minute.' },
});

const profileRoutes         = require('./routes/profile');
const routinesRoutes        = require('./routes/routines');
const historyRoutes         = require('./routes/history');
const leaderboardRoutes     = require('./routes/leaderboard');
const aiRoutes              = require('./routes/ai');
const recoveryRoutes        = require('./routes/recovery');
const nutritionRoutes       = require('./routes/nutrition');
const sportsRoutes          = require('./routes/sports');
const waterRoutes           = require('./routes/water');
const scheduleRoutes        = require('./routes/schedule');
const formScoresRoutes      = require('./routes/formscores');
const personalRecordsRoutes = require('./routes/personalrecords');
const pointsRoutes          = require('./routes/points');
const bodyRoutes            = require('./routes/body');
const accountRoutes         = require('./routes/account');
const emailRoutes           = require('./routes/email');
const challengeRoutes       = require('./routes/challenges');
const { createSyncRouter }  = require('./routes/sync');

const app = express();

// Behind Cloud Run's (or Railway's) proxy every request comes from the proxy:
// trust its X-Forwarded-For so the rate limits count real clients.
if (process.env.K_SERVICE || process.env.TRUST_PROXY) app.set('trust proxy', 1);

app.use(helmet());
app.use(generalLimiter);
// Firebase App Check (src/middleware/appCheck.js; APP_CHECK=monitor|enforce|off).
// firebase-admin is started first, by the auth middleware's module
require('./middleware/auth');
app.use(require('./middleware/appCheck').appCheckGuard());
app.use(cors());
// before the global parser: a first backup can be a few MB (default 100 kB)
app.use('/sync', express.json({ limit: '5mb' }),
  createSyncRouter({ pool: require('./db'), auth: require('./middleware/auth'), limiter: syncLimiter }));
// JSON bodies: 100 KB (express's default) everywhere but /ai, where a meal
// photo arrives as base64 (the app shrinks it first; 2 MB leaves headroom)
const jsonSmall = express.json();
const jsonAI = express.json({ limit: '2mb' });
app.use((req, res, next) => (req.path.startsWith('/ai/') ? jsonAI : jsonSmall)(req, res, next));

app.use('/profile',          profileRoutes);
app.use('/challenges',       challengeRoutes);
app.use('/routines',         routinesRoutes);
app.use('/history',          historyRoutes);
app.use('/leaderboard',      leaderboardRoutes);
app.use('/ai',               aiLimiter, aiRoutes);
app.use('/recovery',         recoveryRoutes);
app.use('/nutrition',        nutritionRoutes);
app.use('/sports',           sportsRoutes);
app.use('/water',            waterRoutes);
app.use('/schedule',         scheduleRoutes);
app.use('/form-scores',      formScoresRoutes);
app.use('/personal-records', personalRecordsRoutes);
app.use('/points',           pointsRoutes);
app.use('/body',             bodyRoutes);
app.use('/account',          accountRoutes);
app.use('/email',            emailRoutes);

app.get('/health', async (req, res) => {
  try {
    const pool = require('./db');
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    console.error('health: db error:', err.message);
    res.json({ status: 'ok', db: 'error' });
  }
});

// no such route: a plain JSON 404 (Express's default page names the path)
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// anything a route throws: logged here, never sent back (it can carry SQL or
// provider details)
app.use((err, req, res, next) => {   // eslint-disable-line no-unused-vars
  console.error(`${req.method} ${req.path} failed:`, err?.message || err);
  if (res.headersSent) return;
  const status = Number(err?.status || err?.statusCode);
  res.status(status >= 400 && status < 500 ? status : 500).json({ error: status >= 400 && status < 500 ? 'Bad request' : 'Server error' });
});

module.exports = app;
