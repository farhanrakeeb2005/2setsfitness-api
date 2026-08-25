const router = require('express').Router();
const pool   = require('../db');
const auth   = require('../middleware/auth');

// GET /water?date=YYYY-MM-DD  (defaults to today)
router.get('/', auth, async (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const { rows } = await pool.query(
    'SELECT cups FROM water_logs WHERE user_id=$1 AND log_date=$2',
    [req.user.id, date]
  );
  res.json({ cups: rows[0]?.cups ?? 0, date });
});

// PUT /water  — Body: { cups, date? }
router.put('/', auth, async (req, res) => {
  const { cups = 0, date } = req.body;
  const logDate = date || new Date().toISOString().slice(0, 10);
  await pool.query(
    `INSERT INTO water_logs (user_id, log_date, cups) VALUES ($1,$2,$3)
     ON CONFLICT (user_id, log_date) DO UPDATE SET cups = EXCLUDED.cups`,
    [req.user.id, logDate, Math.max(0, cups)]
  );
  res.json({ ok: true, cups, date: logDate });
});

module.exports = router;
