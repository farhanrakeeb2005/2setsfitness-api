const router = require('express').Router();
const pool   = require('../db');
const auth   = require('../middleware/auth');

// GET /recovery?limit=30
router.get('/', auth, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 30, 90);
  const { rows } = await pool.query(
    'SELECT * FROM recovery_logs WHERE user_id=$1 ORDER BY logged_at DESC LIMIT $2',
    [req.user.id, limit]
  );
  res.json(rows);
});

// POST /recovery
router.post('/', auth, async (req, res) => {
  const { score, sleepHours, soreness, note } = req.body;
  if (score == null) return res.status(400).json({ error: 'score required' });
  const { rows } = await pool.query(
    'INSERT INTO recovery_logs (user_id, score, sleep_hours, soreness, note) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [req.user.id, score, sleepHours ?? null, soreness ?? null, note ?? null]
  );
  await pool.query('UPDATE profiles SET points = points + 20 WHERE user_id = $1', [req.user.id]);
  res.status(201).json({ ...rows[0], points_earned: 20 });
});

module.exports = router;
