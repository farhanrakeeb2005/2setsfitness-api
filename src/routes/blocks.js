// Blocking a player: no challenges or friend requests between you, either way.
//
//   GET    /blocks          players I've blocked
//   POST   /blocks { id }   block a player (by public id): also unfriends you and
//                           cancels challenges between you that haven't started
//   DELETE /blocks/:id      unblock
const router = require('express').Router();
const pool   = require('../db');
const auth   = require('../middleware/auth');

const PUBLIC_ID = /^[0-9a-f]{32}$/;

router.get('/', auth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT p.public_id, u.name FROM blocks b JOIN users u ON u.id = b.blocked_id JOIN profiles p ON p.user_id = b.blocked_id
     WHERE b.user_id = $1 ORDER BY b.created_at DESC`, [req.user.id]);
  res.json(rows.map((r) => ({ id: r.public_id, name: r.name })));
});

router.post('/', auth, async (req, res) => {
  const id = String(req.body?.id || '');
  if (!PUBLIC_ID.test(id)) return res.status(400).json({ error: 'Invalid player' });
  const { rows: [t] } = await pool.query('SELECT user_id FROM profiles WHERE public_id = $1', [id]);
  if (!t || t.user_id === req.user.id) return res.status(404).json({ error: 'Not found' });
  await pool.query('INSERT INTO blocks (user_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.user.id, t.user_id]);
  await pool.query(
    'DELETE FROM friends WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)', [req.user.id, t.user_id]);
  await pool.query(
    `UPDATE challenges SET status = 'cancelled' WHERE status = 'pending'
       AND ((from_user = $1 AND to_user = $2) OR (from_user = $2 AND to_user = $1))`, [req.user.id, t.user_id]);
  res.json({ ok: true });
});

router.delete('/:id', auth, async (req, res) => {
  const id = String(req.params.id || '');
  if (!PUBLIC_ID.test(id)) return res.status(404).json({ error: 'Not found' });
  await pool.query(
    'DELETE FROM blocks WHERE user_id = $1 AND blocked_id = (SELECT user_id FROM profiles WHERE public_id = $2)', [req.user.id, id]);
  res.json({ ok: true });
});

module.exports = router;
