// POST /sports: a mirror write the app still fires after logging a sport
// (HomeScreen, VoiceLogSheet; fire-and-forget). Nothing on the server reads
// sports_logs any more (challenge races read the sports backed up to Firestore
// or /sync: routes/challenges.js logsOf); the route stays so current and
// recent builds get a 201 instead of a 404.
const router = require('express').Router();
const pool   = require('../db');
const auth   = require('../middleware/auth');

router.post('/', auth, async (req, res) => {
  const { sport, emoji, duration = 0, calories = 0 } = req.body;
  if (!sport) return res.status(400).json({ error: 'sport required' });
  const { rows } = await pool.query(
    'INSERT INTO sports_logs (user_id, sport, emoji, duration, calories) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [req.user.id, sport, emoji ?? null, duration, calories]
  );
  // (no points here: the app works out its own total and reports it, PUT /points)
  res.status(201).json(rows[0]);
});

module.exports = router;
