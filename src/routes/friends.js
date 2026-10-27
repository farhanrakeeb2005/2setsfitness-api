// Friends: players add each other by friend code or by name, and the other
// side accepts. Friends show in Compete and as pins on the rank journey map.
//
//   GET    /friends               { code, friends, incoming, outgoing }
//   GET    /friends/search?q=     players by name (3+ letters; visible on the leaderboard)
//   POST   /friends               { code } or { id: <public id> } send a request
//                                 (or accept theirs, when they already asked)
//   POST   /friends/:id/accept    accept their request
//   DELETE /friends/:id           remove a friend, decline theirs, or cancel mine
//
// A row (user_id -> friend_id) is a request until the other side's row
// exists too; two rows mean friends. Blocked players (routes/blocks.js) can't
// ask. Players are named by public id, never the account id.
const router = require('express').Router();
const pool   = require('../db');
const { notifyUser } = require('../lib/push');
const nameOf = async (userId) => (await pool.query('SELECT name FROM users WHERE id = $1', [userId])).rows[0]?.name || '';
const auth   = require('../middleware/auth');
const { NAMED } = require('../lib/names');

const PUBLIC_ID = /^[0-9a-f]{32}$/;
const CODE = /^(?:2S-?)?([0-9A-F]{6})$/i;
const MAX_FRIENDS = 200;
const EFFECTIVE = 'GREATEST(0, COALESCE(p.points, 0) + COALESCE(p.challenge_pts, 0))';

const card = (r) => ({
  id: r.public_id, name: r.name, points: Number(r.points) || 0,
  avatarEmoji: r.avatar_emoji || null, avatarPhoto: r.avatar_photo || null,
});

const codeOf = async (userId) =>
  (await pool.query('SELECT friend_code FROM profiles WHERE user_id = $1', [userId])).rows[0]?.friend_code || null;

router.get('/', auth, async (req, res) => {
  const me = req.user.id;
  const { rows } = await pool.query(
    `SELECT u.name, p.public_id, p.avatar_emoji, p.avatar_photo, ${EFFECTIVE} AS points,
            EXISTS (SELECT 1 FROM friends f WHERE f.user_id = $1 AND f.friend_id = p.user_id) AS mine,
            EXISTS (SELECT 1 FROM friends f WHERE f.user_id = p.user_id AND f.friend_id = $1) AS theirs
     FROM profiles p JOIN users u ON u.id = p.user_id
     WHERE p.user_id IN (SELECT friend_id FROM friends WHERE user_id = $1 UNION SELECT user_id FROM friends WHERE friend_id = $1)
       AND p.user_id <> $1
     ORDER BY points DESC, u.name
     LIMIT 400`, [me]);
  const code = await codeOf(me);
  // my own row, for the friends ranking (the app puts me in it)
  const { rows: [self] } = await pool.query(
    `SELECT u.name, p.public_id, p.avatar_emoji, p.avatar_photo, ${EFFECTIVE} AS points
     FROM profiles p JOIN users u ON u.id = p.user_id WHERE p.user_id = $1`, [me]);
  res.json({
    code: code ? `2S-${code}` : null,
    me: self ? card(self) : null,
    friends: rows.filter((r) => r.mine && r.theirs).map(card),
    incoming: rows.filter((r) => !r.mine && r.theirs).map(card),
    outgoing: rows.filter((r) => r.mine && !r.theirs).map(card),
  });
});

router.get('/search', auth, async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 40);
  if (q.length < 3) return res.json([]);
  const { rows } = await pool.query(
    `SELECT u.name, p.public_id, p.avatar_emoji, p.avatar_photo, ${EFFECTIVE} AS points
     FROM profiles p JOIN users u ON u.id = p.user_id
     WHERE NOT p.leaderboard_hidden AND ${NAMED('u')} AND p.user_id <> $1 AND u.name ILIKE $2
     ORDER BY points DESC LIMIT 10`,
    [req.user.id, `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`]);
  res.json(rows.map(card));
});

router.post('/', auth, async (req, res) => {
  const me = req.user.id;
  const code = CODE.exec(String(req.body?.code || '').trim());
  const id = String(req.body?.id || '');
  let target;
  if (code) {
    ({ rows: [target] } = await pool.query('SELECT user_id FROM profiles WHERE friend_code = $1', [code[1].toUpperCase()]));
  } else if (PUBLIC_ID.test(id)) {
    ({ rows: [target] } = await pool.query('SELECT user_id FROM profiles WHERE public_id = $1 AND NOT leaderboard_hidden', [id]));
  } else {
    return res.status(400).json({ error: 'Invalid player' });
  }
  if (!target) return res.status(404).json({ error: 'notfound', message: 'No player with that code' });
  if (target.user_id === me) return res.status(400).json({ error: 'self', message: 'That\'s your own code' });
  const { rowCount: blocked } = await pool.query(
    'SELECT 1 FROM blocks WHERE (user_id = $1 AND blocked_id = $2) OR (user_id = $2 AND blocked_id = $1) LIMIT 1', [me, target.user_id]);
  if (blocked) return res.status(404).json({ error: 'notfound', message: 'No player with that code' });
  const { rows: [n] } = await pool.query('SELECT COUNT(*) AS n FROM friends WHERE user_id = $1', [me]);
  if (Number(n.n) >= MAX_FRIENDS) return res.status(429).json({ error: 'limit', message: 'That\'s a lot of friends' });
  const { rowCount: added } = await pool.query('INSERT INTO friends (user_id, friend_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [me, target.user_id]);
  const { rowCount: theirs } = await pool.query('SELECT 1 FROM friends WHERE user_id = $2 AND friend_id = $1', [me, target.user_id]);
  // (a request sent again doesn't notify again; adding back someone who
  // asked first is accepting it)
  if (added) notifyUser(target.user_id, theirs ? 'friendAccepted' : 'friendRequest', { name: await nameOf(me), data: { open: 'inbox' } });
  res.status(201).json({ status: theirs ? 'friends' : 'requested' });
});

router.post('/:id/accept', auth, async (req, res) => {
  const id = String(req.params.id || '');
  if (!PUBLIC_ID.test(id)) return res.status(404).json({ error: 'Not found' });
  const { rows: [t] } = await pool.query(
    `SELECT p.user_id FROM profiles p JOIN friends f ON f.user_id = p.user_id AND f.friend_id = $2 WHERE p.public_id = $1`,
    [id, req.user.id]);
  if (!t) return res.status(404).json({ error: 'Not found' });
  const { rowCount: added } = await pool.query('INSERT INTO friends (user_id, friend_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.user.id, t.user_id]);
  if (added) notifyUser(t.user_id, 'friendAccepted', { name: await nameOf(req.user.id), data: { open: 'inbox' } });
  res.json({ status: 'friends' });
});

router.delete('/:id', auth, async (req, res) => {
  const id = String(req.params.id || '');
  if (!PUBLIC_ID.test(id)) return res.status(404).json({ error: 'Not found' });
  await pool.query(
    `DELETE FROM friends WHERE (user_id = $1 AND friend_id = (SELECT user_id FROM profiles WHERE public_id = $2))
        OR (friend_id = $1 AND user_id = (SELECT user_id FROM profiles WHERE public_id = $2))`,
    [req.user.id, id]);
  res.json({ ok: true });
});

module.exports = router;
