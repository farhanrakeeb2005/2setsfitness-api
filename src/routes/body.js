const router = require('express').Router();
const pool   = require('../db');
const auth   = require('../middleware/auth');

// GET /body — last 90 body weight entries for the user
router.get('/', auth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, weight_kg, note, logged_at
     FROM body_logs
     WHERE user_id = $1
     ORDER BY logged_at DESC
     LIMIT 90`,
    [req.user.id]
  );
  res.json({ logs: rows });
});

// POST /body — log a new body weight
router.post('/', auth, async (req, res) => {
  const { weight_kg, note } = req.body;
  if (!weight_kg || isNaN(weight_kg)) return res.status(400).json({ error: 'weight_kg required' });
  const { rows } = await pool.query(
    `INSERT INTO body_logs (user_id, weight_kg, note)
     VALUES ($1, $2, $3)
     RETURNING id, weight_kg, note, logged_at`,
    [req.user.id, Number(weight_kg), note || null]
  );
  res.json({ log: rows[0] });
});

module.exports = router;
