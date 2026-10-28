// Who can challenge whom: friends, or two players in the same rank (the
// leaderboard's "your rank" list, routes/points.js). A stranger in another
// rank can only be looked at.
const { getRank } = require('../routes/points');

const EFFECTIVE = 'GREATEST(0, COALESCE(points, 0) + COALESCE(challenge_pts, 0))';

/** the rank's points range: { name, min, max } (max null for the top rank) */
function rankBounds(points) {
  const r = getRank(Number(points) || 0);
  return { name: r.name, min: r.min, max: r.nextRankPts ?? null };
}

/** true when userA may challenge userB */
async function canChallenge(db, a, b) {
  if (!a || !b || a === b) return false;
  const { rows: [r] } = await db.query(
    `SELECT EXISTS (SELECT 1 FROM friends WHERE user_id = $1 AND friend_id = $2)
            AND EXISTS (SELECT 1 FROM friends WHERE user_id = $2 AND friend_id = $1) AS friends,
            (SELECT ${EFFECTIVE} FROM profiles WHERE user_id = $1) AS pa,
            (SELECT ${EFFECTIVE} FROM profiles WHERE user_id = $2) AS pb`, [a, b]);
  if (r?.friends) return true;
  return rankBounds(r?.pa).name === rankBounds(r?.pb).name;
}

module.exports = { rankBounds, canChallenge };
