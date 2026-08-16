const router = require('express').Router();
const pool   = require('../db');
const auth   = require('../middleware/auth');
 
router.get('/', auth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT u.name, u.email, p.* FROM users u JOIN profiles p ON u.id = p.user_id WHERE u.id = $1',
    [req.user.id]
  );
  res.json(rows[0] || {});
});
 
router.put('/', auth, async (req, res) => {
  const { name, goal, level, units, streak, last_workout_day, avatar_emoji } = req.body;
  await pool.query('UPDATE users SET name = COALESCE($1, name) WHERE id = $2', [name, req.user.id]);
  await pool.query(
    `UPDATE profiles SET goal=$1, level=$2, units=$3, streak=$4,
     last_workout_day=$5, avatar_emoji=$6, updated_at=NOW() WHERE user_id=$7`,
    [goal, level, units, streak, last_workout_day, avatar_emoji, req.user.id]
  );
  res.json({ ok: true });
});
 
module.exports = router;
