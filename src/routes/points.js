const router = require('express').Router();
const pool   = require('../db');
const auth   = require('../middleware/auth');

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

// GET /points/leaderboard — top 20 by points + caller's global position
router.get('/leaderboard', auth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT u.name, p.avatar_emoji, p.points
     FROM profiles p
     JOIN users u ON p.user_id = u.id
     ORDER BY p.points DESC
     LIMIT 20`
  );
  const leaderboard = rows.map((r, i) => ({
    position: i + 1,
    name: r.name,
    avatarEmoji: r.avatar_emoji,
    points: r.points ?? 0,
    rank: getRank(r.points ?? 0),
  }));
  const posRow = await pool.query(
    `SELECT COUNT(*) + 1 AS position
     FROM profiles
     WHERE points > (SELECT COALESCE(points, 0) FROM profiles WHERE user_id = $1)`,
    [req.user.id]
  );
  res.json({
    leaderboard,
    myPosition: parseInt(posRow.rows[0]?.position || 1),
  });
});

module.exports = router;
