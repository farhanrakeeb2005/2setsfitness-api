const router = require('express').Router();
const pool   = require('../db');
const auth   = require('../middleware/auth');

// GET /sports?limit=30
router.get('/', auth, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 30, 90);
  const { rows } = await pool.query(
    'SELECT * FROM sports_logs WHERE user_id=$1 ORDER BY logged_at DESC LIMIT $2',
    [req.user.id, limit]
  );
  res.json(rows);
});

// POST /sports
router.post('/', auth, async (req, res) => {
  const { sport, emoji, duration = 0, calories = 0 } = req.body;
  if (!sport) return res.status(400).json({ error: 'sport required' });
  const { rows } = await pool.query(
    'INSERT INTO sports_logs (user_id, sport, emoji, duration, calories) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [req.user.id, sport, emoji ?? null, duration, calories]
  );
  res.status(201).json(rows[0]);
});

module.exports = router;
