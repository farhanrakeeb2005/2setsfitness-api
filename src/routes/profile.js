const router = require('express').Router();
const pool   = require('../db');
const auth   = require('../middleware/auth');
const { cleanCard } = require('../lib/publicCard');
const { getRank } = require('./points');
 
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
  // Settings → Show me on the leaderboard
  if (typeof req.body.leaderboardHidden === 'boolean') {
    await pool.query('UPDATE profiles SET leaderboard_hidden = $1 WHERE user_id = $2', [req.body.leaderboardHidden, req.user.id]);
  }
  res.json({ ok: true });
});
 
// PUT /profile/card — { card }: what other players see on this player's
// profile (counts, streak, top sports and exercises, the fighter's look),
// worked out on the phone; cleaned to known fields (src/lib/publicCard.js)
router.put('/card', auth, async (req, res) => {
  const card = cleanCard(req.body?.card);
  if (!card) return res.status(400).json({ error: 'Invalid card' });
  await pool.query('UPDATE profiles SET public_card = $1 WHERE user_id = $2', [card, req.user.id]);
  res.json({ ok: true });
});

// GET /profile/public/:id — a player's public profile, by the public id the
// leaderboard rows carry. Players hidden from the leaderboard (Settings) are
// not shown, except to themselves.
router.get('/public/:id', auth, async (req, res) => {
  const id = String(req.params.id || '');
  if (!/^[0-9a-f]{32}$/.test(id)) return res.status(404).json({ error: 'Not found' });
  const { rows } = await pool.query(
    `SELECT u.name, u.created_at, p.points, p.avatar_emoji, p.avatar_photo, p.public_card, p.leaderboard_hidden,
            (p.user_id = $2) AS me
     FROM profiles p JOIN users u ON u.id = p.user_id
     WHERE p.public_id = $1`,
    [id, req.user.id]
  );
  const r = rows[0];
  if (!r || (r.leaderboard_hidden && !r.me)) return res.status(404).json({ error: 'Not found' });
  const points = r.points ?? 0;
  const pos = await pool.query(
    `SELECT COUNT(*) + 1 AS position FROM profiles WHERE NOT leaderboard_hidden AND COALESCE(points, 0) > $1`,
    [points]
  );
  res.json({
    id,
    name: r.name,
    points,
    rank: getRank(points),
    position: r.leaderboard_hidden ? null : parseInt(pos.rows[0]?.position || 1),
    avatarEmoji: r.avatar_emoji || null,
    avatarPhoto: r.avatar_photo || null,
    joined: r.created_at,
    card: r.public_card || null,
    me: !!r.me,
  });
});

module.exports = router;
