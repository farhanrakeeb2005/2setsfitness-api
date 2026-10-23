const router = require('express').Router();
const pool   = require('../db');
const auth   = require('../middleware/auth');
const { cappedPoints } = require('../lib/pointsCap');

const RANKS = [
  { name: 'Bronze',   min: 0,     icon: '🥉' },
  { name: 'Silver',   min: 500,   icon: '🥈' },
  { name: 'Gold',     min: 2000,  icon: '🥇' },
  { name: 'Platinum', min: 5000,  icon: '💎' },
  { name: 'Diamond',  min: 10000, icon: '💠' },
  { name: 'Elite',    min: 25000, icon: '👑' },
];

function getRank(points) {
  for (let i = RANKS.length - 1; i >= 0; i--) {
    if (points >= RANKS[i].min) {
      const next = RANKS[i + 1] || null;
      return {
        ...RANKS[i],
        nextRank:    next?.name || null,
        nextRankPts: next?.min  || null,
        progress: next
          ? Math.round(((points - RANKS[i].min) / (next.min - RANKS[i].min)) * 100)
          : 100,
      };
    }
  }
  return {
    ...RANKS[0],
    nextRank: RANKS[1].name,
    nextRankPts: RANKS[1].min,
    progress: Math.round((points / 500) * 100),
  };
}

// GET /points — current user's points + rank
router.get('/', auth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT points FROM profiles WHERE user_id = $1',
    [req.user.id]
  );
  const points = rows[0]?.points ?? 0;
  res.json({ points, rank: getRank(points) });
});

// PUT /points — { points }: the app's own total. Points are worked out on the
// phone from its logs (local-first; the old per-log server routes are no
// longer called), so the app reports the total for the leaderboard, held to
// what the account's age makes believable (src/lib/pointsCap.js).
const MAX_POINTS = 10_000_000;
router.put('/', auth, async (req, res) => {
  const pts = Math.round(Number(req.body?.points));
  if (!Number.isFinite(pts) || pts < 0 || pts > MAX_POINTS) return res.status(400).json({ error: 'Invalid points' });
  const { rows } = await pool.query('SELECT created_at FROM users WHERE id = $1', [req.user.id]);
  const stored = cappedPoints(pts, rows[0]?.created_at);
  await pool.query('UPDATE profiles SET points = $1 WHERE user_id = $2', [stored, req.user.id]);
  res.json({ points: stored, rank: getRank(stored) });
});

// GET /points/leaderboard — top 20 by points + caller's global position;
// the caller's own row says me: true (rows don't carry user ids). Accounts
// hidden from the leaderboard (Settings) aren't listed or counted, except
// to themselves.
router.get('/leaderboard', auth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT u.name, p.avatar_emoji, p.points, (p.user_id = $1) AS me
     FROM profiles p
     JOIN users u ON p.user_id = u.id
     WHERE NOT p.leaderboard_hidden OR p.user_id = $1
     ORDER BY p.points DESC NULLS LAST, u.id
     LIMIT 20`,
    [req.user.id]
  );
  const leaderboard = rows.map((r, i) => ({
    position: i + 1,
    name: r.name,
    avatarEmoji: r.avatar_emoji,
    points: r.points ?? 0,
    rank: getRank(r.points ?? 0),
    me: !!r.me,
  }));
  // (COALESCE outside the subquery: a caller with no profile row counts as 0)
  const posRow = await pool.query(
    `SELECT COUNT(*) + 1 AS position
     FROM profiles
     WHERE NOT leaderboard_hidden
       AND COALESCE(points, 0) > COALESCE((SELECT points FROM profiles WHERE user_id = $1), 0)`,
    [req.user.id]
  );
  const mine = leaderboard.find((r) => r.me);
  res.json({
    leaderboard,
    myPosition: mine ? mine.position : parseInt(posRow.rows[0]?.position || 1),
  });
});

module.exports = router;
