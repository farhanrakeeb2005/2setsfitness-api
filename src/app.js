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

const app = express();

app.use(helmet());
app.use(cors());
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
