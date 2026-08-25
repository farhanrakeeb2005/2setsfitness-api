const router = require('express').Router();
const pool   = require('../db');
const auth   = require('../middleware/auth');

// GET /form-scores?limit=30
router.get('/', auth, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 30, 90);
  const { rows } = await pool.query(
    'SELECT * FROM form_scores WHERE user_id=$1 ORDER BY logged_at DESC LIMIT $2',
    [req.user.id, limit]
  );
  res.json(rows);
});

// POST /form-scores
router.post('/', auth, async (req, res) => {
  const { exercise, score } = req.body;
  if (!exercise || score == null) return res.status(400).json({ error: 'exercise and score required' });
  const { rows } = await pool.query(
    'INSERT INTO form_scores (user_id, exercise, score) VALUES ($1,$2,$3) RETURNING *',
    [req.user.id, exercise, score]
  );
  const ptsEarned = score >= 80 ? 15 : 0;
  if (ptsEarned > 0) {
    await pool.query('UPDATE profiles SET points = points + 15 WHERE user_id = $1', [req.user.id]);
  }
  res.status(201).json({ ...rows[0], points_earned: ptsEarned });
});

module.exports = router;
