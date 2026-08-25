const router = require('express').Router();
const pool   = require('../db');
const auth   = require('../middleware/auth');

// GET /nutrition?limit=30
router.get('/', auth, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 30, 90);
  const { rows } = await pool.query(
    'SELECT * FROM nutrition_logs WHERE user_id=$1 ORDER BY logged_at DESC LIMIT $2',
    [req.user.id, limit]
  );
  res.json(rows);
});

// POST /nutrition
router.post('/', auth, async (req, res) => {
  const { meal = 'Any', protein = 0, carbs = 0, fat = 0, calories = 0 } = req.body;
  const { rows } = await pool.query(
    'INSERT INTO nutrition_logs (user_id, meal, protein, carbs, fat, calories) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [req.user.id, meal, protein, carbs, fat, calories]
  );
  await pool.query('UPDATE profiles SET points = points + 10 WHERE user_id = $1', [req.user.id]);
  res.status(201).json({ ...rows[0], points_earned: 10 });
});

module.exports = router;
