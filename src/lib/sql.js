// Bits of SQL and id checks the routes share.

/**
 * A player's points as the leaderboard counts them: the app's reported total
 * plus what challenges won or lost (profiles.challenge_pts), never below 0.
 * `t` is the profiles table's alias in the query ('p' -> p.points), if any.
 */
const effectiveSql = (t) => {
  const c = t ? `${t}.` : '';
  return `GREATEST(0, COALESCE(${c}points, 0) + COALESCE(${c}challenge_pts, 0))`;
};

/** effectiveSql() for queries on profiles without an alias */
const EFFECTIVE_SQL = effectiveSql();

/** A player's public id (profiles.public_id: 32 lowercase hex), the only id other players see. */
const PUBLIC_ID = /^[0-9a-f]{32}$/;

module.exports = { effectiveSql, EFFECTIVE_SQL, PUBLIC_ID };
