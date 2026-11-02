// PUT /schedule: a mirror write the app still fires whenever the week plan
// changes (App.js, ScheduleScreen, TrackScreen, planActions; fire-and-forget).
// Nothing on the server reads profiles.week_schedule any more; the route stays
// so current and recent builds get a 200 instead of a 404.
const router = require('express').Router();
const pool   = require('../db');
const auth   = require('../middleware/auth');

// Body: { schedule: { '0': 'routineId', '1': 'rest', ... } }
router.put('/', auth, async (req, res) => {
  const { schedule = {} } = req.body;
  await pool.query(
    'UPDATE profiles SET week_schedule=$1, updated_at=NOW() WHERE user_id=$2',
    [JSON.stringify(schedule), req.user.id]
  );
  res.json({ ok: true });
});

module.exports = router;
