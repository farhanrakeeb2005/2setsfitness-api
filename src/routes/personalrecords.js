const router = require('express').Router();
const pool   = require('../db');
const auth   = require('../middleware/auth');

// GET /personal-records
router.get('/', auth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT exercise, weight, recorded_at FROM personal_records WHERE user_id=$1 ORDER BY recorded_at DESC',
    [req.user.id]
  );
  res.json(rows);
});

// PUT /personal-records  — Body: { exercise, weight }
// Only updates if new weight is a personal record (higher than stored)
router.put('/', auth, async (req, res) => {
  const { exercise, weight } = req.body;
  if (!exercise || weight == null) return res.status(400).json({ error: 'exercise and weight required' });
  const existing = await pool.query(
    'SELECT weight FROM personal_records WHERE user_id=$1 AND exercise=$2',
    [req.user.id, exercise]
  );
  const isNewPR = !existing.rows[0] || weight > existing.rows[0].weight;
  await pool.query(
    `INSERT INTO personal_records (user_id, exercise, weight, recorded_at)
     VALUES ($1,$2,$3,CURRENT_DATE)
     ON CONFLICT (user_id, exercise) DO UPDATE
     SET weight      = GREATEST(personal_records.weight, EXCLUDED.weight),
         recorded_at = CASE
           WHEN EXCLUDED.weight > personal_records.weight THEN CURRENT_DATE
           ELSE personal_records.recorded_at
         END`,
    [req.user.id, exercise, weight]
  );
  if (isNewPR) {
    await pool.query('UPDATE profiles SET points = points + 25 WHERE user_id = $1', [req.user.id]);
  }
  res.json({ ok: true, isNewPR, points_earned: isNewPR ? 25 : 0 });
});

module.exports = router;
