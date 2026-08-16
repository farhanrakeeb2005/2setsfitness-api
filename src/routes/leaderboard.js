const router = require('express').Router();
const pool   = require('../db');
const auth   = require('../middleware/auth');

// GET /leaderboard?metric=volume  (volume | streak | reps)
router.get('/', auth, async (req, res) => {
  const { metric = 'volume' } = req.query;
  const allowed = ['volume', 'streak', 'reps'];
  if (!allowed.includes(metric))
    return res.status(400).json({ error: 'metric must be volume, streak, or reps' });
  const { rows } = await pool.query(
    'SELECT u.name, p.avatar_emoji, MAX(l.value) AS best_value' +
    ' FROM leaderboard l' +
    ' JOIN users u ON l.user_id = u.id' +
    ' JOIN profiles p ON l.user_id = p.user_id' +
    ' WHERE l.metric = $1' +
    ' GROUP BY u.name, p.avatar_emoji' +
    ' ORDER BY best_value DESC LIMIT 20',
    [metric]
  );
  res.json(rows);
});

// POST /leaderboard/submit  —  Body: { metric, value }
router.post('/submit', auth, async (req, res) => {
  const { metric, value } = req.body;
  if (!metric || value == null)
    return res.status(400).json({ error: 'metric and value required' });
  await pool.query(
    'INSERT INTO leaderboard (user_id, metric, value) VALUES ($1, $2, $3)',
    [req.user.id, metric, value]
  );
  res.json({ ok: true });
});

module.exports = router;
