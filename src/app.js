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
const syncLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: (req) => req.user.id,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many sync requests — please wait a minute.' },
});

const authRoutes            = require('./routes/auth');
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
const emailRoutes           = require('./routes/email');
const { createSyncRouter }  = require('./routes/sync');

const app = express();

// Behind Cloud Run's (or Railway's) proxy every request comes from the proxy:
// trust its X-Forwarded-For so the rate limits count real clients.
if (process.env.K_SERVICE || process.env.TRUST_PROXY) app.set('trust proxy', 1);

app.use(helmet());
app.use(cors());
// before the global parser: a first backup can be a few MB (default 100 kB)
app.use('/sync', express.json({ limit: '5mb' }),
  createSyncRouter({ pool: require('./db'), auth: require('./middleware/auth'), limiter: syncLimiter }));
app.use(express.json());

app.use('/auth',             authRoutes);
app.use('/profile',          profileRoutes);
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
app.use('/email',            emailRoutes);

app.get('/health', async (req, res) => {
  try {
    const pool = require('./db');
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    res.json({ status: 'ok', db: 'error', detail: String(err) });
  }
});

module.exports = app;
