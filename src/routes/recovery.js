// POST /recovery: a mirror write the app still fires after a recovery check-in
// (HomeScreen, fire-and-forget). Nothing on the server reads recovery_logs any
// more (the app keeps its own data and backs up to Firestore); the route stays
// so current and recent builds get a 201 instead of a 404.
const router = require('express').Router();
const pool   = require('../db');
const auth   = require('../middleware/auth');

router.post('/', auth, async (req, res) => {
  const { score, sleepHours, soreness, note } = req.body;
  if (score == null) return res.status(400).json({ error: 'score required' });
  const { rows } = await pool.query(
    'INSERT INTO recovery_logs (user_id, score, sleep_hours, soreness, note) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [req.user.id, score, sleepHours ?? null, soreness ?? null, note ?? null]
  );
  // (no points here: the app works out its own total and reports it, PUT /points)
  res.status(201).json(rows[0]);
});

module.exports = router;
