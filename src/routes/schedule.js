const router = require('express').Router();
const pool   = require('../db');
const auth   = require('../middleware/auth');

// GET /schedule
router.get('/', auth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT week_schedule FROM profiles WHERE user_id=$1',
    [req.user.id]
  );
  res.json(rows[0]?.week_schedule ?? {});
});

// PUT /schedule  — Body: { schedule: { '0': 'routineId', '1': 'rest', ... } }
router.put('/', auth, async (req, res) => {
  const { schedule = {} } = req.body;
  await pool.query(
    'UPDATE profiles SET week_schedule=$1, updated_at=NOW() WHERE user_id=$2',
    [JSON.stringify(schedule), req.user.id]
  );
  res.json({ ok: true });
});

module.exports = router;
