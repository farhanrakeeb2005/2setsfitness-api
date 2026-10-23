// Challenges: one player challenges another to a 7-day points race.
//
//   POST /challenges                 { to: <public id> }   send one (pending)
//   GET  /challenges                 mine, sent and received, still open or ended in the last 14 days
//   POST /challenges/:id/respond     { accept: true|false } the challenged player only
//   POST /challenges/:id/cancel      the sender, while it's still pending
//
// Once accepted it runs 7 days from that moment; each side's score is the
// points they gained over it (the same capped points as the leaderboard, so
// it can't be padded from the phone). When the week is up the next read
// fixes both totals and the result. Players are only ever named by their
// public id, never the account id; nobody hidden from the leaderboard can
// be challenged.
const router = require('express').Router();
const pool   = require('../db');
const auth   = require('../middleware/auth');

const DAYS = 7;
const MAX_OPEN_SENT = 5;            // pending or running challenges one player has sent
const PUBLIC_ID = /^[0-9a-f]{32}$/;
const CHALLENGE_ID = /^[0-9a-f]{32}$/;

// ended races get their final totals and result, once
async function settle(userId) {
  await pool.query(
    `UPDATE challenges c SET status = 'done',
       from_end = COALESCE((SELECT points FROM profiles WHERE user_id = c.from_user), 0),
       to_end   = COALESCE((SELECT points FROM profiles WHERE user_id = c.to_user), 0)
     WHERE c.status = 'accepted' AND c.ends_at <= now() AND (c.from_user = $1 OR c.to_user = $1)`,
    [userId]
  );
}

router.post('/', auth, async (req, res) => {
  const to = String(req.body?.to || '');
  if (!PUBLIC_ID.test(to)) return res.status(400).json({ error: 'Invalid player' });
  const { rows: [target] } = await pool.query(
    'SELECT user_id, leaderboard_hidden FROM profiles WHERE public_id = $1', [to]);
  if (!target || target.leaderboard_hidden) return res.status(404).json({ error: 'Not found' });
  if (target.user_id === req.user.id) return res.status(400).json({ error: 'You can\'t challenge yourself' });
  const { rows: [open] } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE from_user = $1) AS sent,
       COUNT(*) FILTER (WHERE (from_user = $1 AND to_user = $2) OR (from_user = $2 AND to_user = $1)) AS pair
     FROM challenges WHERE status IN ('pending', 'accepted') AND (from_user = $1 OR to_user = $1)`,
    [req.user.id, target.user_id]
  );
  if (Number(open.pair) > 0) return res.status(409).json({ error: 'already', message: 'You already have a challenge with this player' });
  if (Number(open.sent) >= MAX_OPEN_SENT) return res.status(429).json({ error: 'limit', message: 'Too many open challenges' });
  const { rows: [c] } = await pool.query(
    'INSERT INTO challenges (from_user, to_user) VALUES ($1, $2) RETURNING id', [req.user.id, target.user_id]);
  res.status(201).json({ id: c.id, status: 'pending' });
});

router.get('/', auth, async (req, res) => {
  await settle(req.user.id);
  const { rows } = await pool.query(
    `SELECT c.id, c.status, c.created_at, c.starts_at, c.ends_at,
            c.from_user = $1 AS sent,
            c.from_start, c.to_start, c.from_end, c.to_end,
            fp.points AS from_now, tp.points AS to_now,
            ou.name AS opp_name, op.public_id AS opp_id, op.avatar_emoji AS opp_emoji, op.avatar_photo AS opp_photo
     FROM challenges c
     JOIN profiles fp ON fp.user_id = c.from_user
     JOIN profiles tp ON tp.user_id = c.to_user
     JOIN users ou ON ou.id = CASE WHEN c.from_user = $1 THEN c.to_user ELSE c.from_user END
     JOIN profiles op ON op.user_id = ou.id
     WHERE (c.from_user = $1 OR c.to_user = $1)
       AND (c.status IN ('pending', 'accepted') OR (c.status = 'done' AND c.ends_at > now() - interval '14 days'))
     ORDER BY c.created_at DESC
     LIMIT 30`,
    [req.user.id]
  );
  res.json(rows.map((r) => {
    const fromGain = r.status === 'pending' ? 0 : Math.max(0, (r.from_end ?? r.from_now ?? 0) - (r.from_start ?? 0));
    const toGain = r.status === 'pending' ? 0 : Math.max(0, (r.to_end ?? r.to_now ?? 0) - (r.to_start ?? 0));
    const mine = r.sent ? fromGain : toGain, theirs = r.sent ? toGain : fromGain;
    return {
      id: r.id,
      status: r.status,                        // pending | accepted | done
      direction: r.sent ? 'sent' : 'received',
      opponent: { id: r.opp_id, name: r.opp_name, avatarEmoji: r.opp_emoji || null, avatarPhoto: r.opp_photo || null },
      createdAt: r.created_at, startsAt: r.starts_at, endsAt: r.ends_at,
      mine, theirs,
      result: r.status === 'done' ? (mine > theirs ? 'won' : mine < theirs ? 'lost' : 'draw') : null,
    };
  }));
});

router.post('/:id/respond', auth, async (req, res) => {
  const id = String(req.params.id || '');
  if (!CHALLENGE_ID.test(id)) return res.status(404).json({ error: 'Not found' });
  const accept = req.body?.accept === true;
  const { rowCount } = accept
    ? await pool.query(
      `UPDATE challenges c SET status = 'accepted', starts_at = now(), ends_at = now() + interval '${DAYS} days',
         from_start = COALESCE((SELECT points FROM profiles WHERE user_id = c.from_user), 0),
         to_start   = COALESCE((SELECT points FROM profiles WHERE user_id = c.to_user), 0)
       WHERE c.id = $1 AND c.to_user = $2 AND c.status = 'pending'`, [id, req.user.id])
    : await pool.query(
      `UPDATE challenges SET status = 'declined' WHERE id = $1 AND to_user = $2 AND status = 'pending'`, [id, req.user.id]);
  if (!rowCount) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true, status: accept ? 'accepted' : 'declined' });
});

router.post('/:id/cancel', auth, async (req, res) => {
  const id = String(req.params.id || '');
  if (!CHALLENGE_ID.test(id)) return res.status(404).json({ error: 'Not found' });
  const { rowCount } = await pool.query(
    `UPDATE challenges SET status = 'cancelled' WHERE id = $1 AND from_user = $2 AND status = 'pending'`, [id, req.user.id]);
  if (!rowCount) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

module.exports = router;
