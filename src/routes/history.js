const router = require('express').Router();
const pool   = require('../db');
const auth   = require('../middleware/auth');

// GET /history — last 30 sessions
router.get('/', auth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM history WHERE user_id = $1 ORDER BY logged_at DESC LIMIT 30',
    [req.user.id]
  );
  res.json(rows);
});

// POST /history — log a completed workout
// Body: { name, sets, volume, exercises: [{ exercise, reps, formScore }] }
router.post('/', auth, async (req, res) => {
  const { name, sets = 0, volume = 0, exercises = [] } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const { rows } = await pool.query(
    'INSERT INTO history (user_id, name, sets, volume, exercises) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [req.user.id, name, sets, volume, JSON.stringify(exercises)]
  );
  res.status(201).json(rows[0]);
});

module.exports = router;
