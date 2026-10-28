const router = require('express').Router();
const pool   = require('../db');
const auth   = require('../middleware/auth');
const { cleanCard } = require('../lib/publicCard');
const { getRank } = require('./points');
const { realName, NAMED } = require('../lib/names');
const { recordOf } = require('../lib/record');
const { canChallenge } = require('../lib/challengeAccess');
 
router.get('/', auth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT u.name, u.email, p.* FROM users u JOIN profiles p ON u.id = p.user_id WHERE u.id = $1',
    [req.user.id]
  );
  res.json(rows[0] || {});
});
 
router.put('/', auth, async (req, res) => {
  const { name, goal, level, units, streak, last_workout_day, avatar_emoji } = req.body;
  // (a blank name or the 'Athlete' placeholder never replaces a real one)
  await pool.query('UPDATE users SET name = COALESCE($1, name) WHERE id = $2', [realName(name), req.user.id]);
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

// PUT /profile/push-token — { token, lang }: this phone's FCM token, for
// challenge notifications (lib/push.js). A token moves to whoever signs in
// on that phone. DELETE (same body) forgets it, on sign-out.
const LANGS = /^[a-zA-Z]{2}(-[A-Za-z]{2})?$/;
router.put('/push-token', auth, async (req, res) => {
  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  if (!token || token.length > 4096) return res.status(400).json({ error: 'Invalid token' });
  const lang = typeof req.body?.lang === 'string' && LANGS.test(req.body.lang) ? req.body.lang : null;
  await pool.query(
    `INSERT INTO push_tokens (token, user_id, lang) VALUES ($1, $2, $3)
     ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, lang = EXCLUDED.lang, updated_at = now()`,
    [token, req.user.id, lang]);
  res.json({ ok: true });
});
router.delete('/push-token', auth, async (req, res) => {
  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  if (token) await pool.query('DELETE FROM push_tokens WHERE token = $1 AND user_id = $2', [token, req.user.id]);
  res.json({ ok: true });
});

// GET /profile/public/:id — a player's public profile, by the public id the
// leaderboard rows carry. Players hidden from the leaderboard (Settings) are
// not shown, except to themselves.
router.get('/public/:id', auth, async (req, res) => {
  const id = String(req.params.id || '');
  if (!/^[0-9a-f]{32}$/.test(id)) return res.status(404).json({ error: 'Not found' });
  const { rows } = await pool.query(
    `SELECT p.user_id, u.name, u.created_at, GREATEST(0, COALESCE(p.points, 0) + COALESCE(p.challenge_pts, 0)) AS points, p.avatar_emoji, p.avatar_photo, p.public_card, p.leaderboard_hidden,
            (p.user_id = $2) AS me,
            EXISTS (SELECT 1 FROM friends f WHERE f.user_id = $2 AND f.friend_id = p.user_id) AS asked,
            EXISTS (SELECT 1 FROM friends f WHERE f.user_id = p.user_id AND f.friend_id = $2) AS asked_me
     FROM profiles p JOIN users u ON u.id = p.user_id
     WHERE p.public_id = $1`,
    [id, req.user.id]
  );
  const r = rows[0];
  if (!r || (r.leaderboard_hidden && !r.me)) return res.status(404).json({ error: 'Not found' });
  const points = r.points ?? 0;
  const pos = await pool.query(
    `SELECT COUNT(*) + 1 AS position FROM profiles p JOIN users u ON u.id = p.user_id
     WHERE NOT p.leaderboard_hidden AND ${NAMED('u')} AND GREATEST(0, COALESCE(p.points, 0) + COALESCE(p.challenge_pts, 0)) > $1`,
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
    // you and them (routes/friends.js): none | requested | incoming | friends
    friend: r.asked && r.asked_me ? 'friends' : r.asked ? 'requested' : r.asked_me ? 'incoming' : 'none',
    // challenges (lib/record.js): their wins / draws / losses, and theirs against the viewer
    record: await recordOf(pool, r.user_id),
    vsMe: r.me ? null : await recordOf(pool, r.user_id, req.user.id),
    // a friend, or in the viewer's rank (lib/challengeAccess.js)
    canChallenge: r.me ? false : await canChallenge(pool, req.user.id, r.user_id),
  });
});

module.exports = router;
