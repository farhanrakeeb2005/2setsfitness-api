// Challenge records: wins, draws and losses over finished challenges
// (routes/challenges.js sets winner 'from' | 'to' | 'draw' when one ends).
// `me` won when the winning side is the side `me` was on.

// SQL counts for the player in $<n> (the challenges table as c)
const COUNTS = (n) => `
  COUNT(*) FILTER (WHERE c.winner IN ('from', 'to') AND (c.winner = 'from') = (c.from_user = $${n})) AS won,
  COUNT(*) FILTER (WHERE c.winner = 'draw') AS drawn,
  COUNT(*) FILTER (WHERE c.winner IN ('from', 'to') AND (c.winner = 'from') <> (c.from_user = $${n})) AS lost`;

const shape = (r) => ({ won: Number(r?.won || 0), drawn: Number(r?.drawn || 0), lost: Number(r?.lost || 0) });

/** { won, drawn, lost } for userId; with otherId, only against that player */
async function recordOf(db, userId, otherId = null) {
  const { rows: [r] } = await db.query(
    `SELECT ${COUNTS(1)} FROM challenges c
     WHERE c.status = 'done' AND (c.from_user = $1 OR c.to_user = $1)
       ${otherId ? 'AND (c.from_user = $2 OR c.to_user = $2)' : ''}`,
    otherId ? [userId, otherId] : [userId]);
  return shape(r);
}

/** { <opponent public id>: { won, drawn, lost } } for userId, against each player they've finished one with */
async function recordsByOpponent(db, userId) {
  const { rows } = await db.query(
    `SELECT op.public_id AS opp, ${COUNTS(1)} FROM challenges c
     JOIN profiles op ON op.user_id = CASE WHEN c.from_user = $1 THEN c.to_user ELSE c.from_user END
     WHERE c.status = 'done' AND (c.from_user = $1 OR c.to_user = $1)
     GROUP BY op.public_id`,
    [userId]);
  return Object.fromEntries(rows.map((r) => [r.opp, shape(r)]));
}

module.exports = { recordOf, recordsByOpponent };
