// DELETE /account: removes everything this server holds for the signed-in
// user (the app's Settings -> Delete account). The users row cascades to
// every table keyed to it (profile, routines, history, leaderboard, points,
// logs, ai_log...); user_sync has no foreign key, so it is cleared first.
// The app deletes the user's Firestore backup and Firebase sign-in itself.
const router = require('express').Router();
const pool = require('../db');
const auth = require('../middleware/auth');

router.delete('/', auth, async (req, res) => {
  const uid = req.user.id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM user_sync WHERE user_id = $1', [uid]);
    const { rowCount } = await client.query('DELETE FROM users WHERE id = $1', [uid]);
    await client.query('COMMIT');
    res.json({ deleted: true, user: rowCount > 0 });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('account delete failed:', err.message);
    res.status(500).json({ error: 'Account deletion failed' });
  } finally {
    client.release();
  }
});

module.exports = router;
