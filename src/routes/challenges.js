// Challenges: one player challenges another (lib/challengeRules.js has what
// they can be and how they're won).
//
//   POST /challenges                 { to: <public id>, kind, days, stake, forfeit, target, routine }
//                                    send one (pending); left out, a 7-day points race
//   GET  /challenges                 mine, sent and received, still open or ended in the last 30 days;
//                                    record (my wins / draws / losses) and records (by opponent's public id);
//                                    ?expired=1: also my sent requests that expired in the last day
//                                    (older app builds don't know the status, so they never get them)
//   POST /challenges/:id/respond     { accept: true|false } the challenged player only
//   POST /challenges/:id/cancel      the sender, while it's still pending
//   POST /challenges/:id/forfeit-done   the loser: the forfeit is done (the winner hears)
//   POST /challenges/:id/nudge       the winner: remind the loser of the forfeit (once a day)
//
// Once accepted it runs `days` from that moment. A points race scores the
// points each side gained over it (the leaderboard's capped points); a target
// or routine race scores the reps, km or finished routines in the workouts
// and sports each side's app backed up (/sync), and ends as soon as someone
// gets there. Reads settle what's over: the result, and the stake moved from
// the loser's challenge points to the winner's (profiles.challenge_pts, added
// to the points the app reports; never below 0 in all). Players are only ever
// named by their public id, never the account id; nobody hidden from the
// leaderboard can be challenged. When a race is decided both players get
// the result as a notification (with the forfeit owed), and races whose time
// is up are settled every few minutes as well (settleDue, server.js), so the
// result comes even if neither player opens the app.
//
// A request waits CHALLENGE_REQUEST_TTL_H hours (lib/challengeRules.js) for
// an answer; after that it's 'expired': it can't be accepted or declined
// (410), and the sender hears "Sam didn't answer in time". Expired on read
// (a pending row past its time is never shown or treated as pending) and
// marked so by expireRequests: before a player's list, a new challenge or an
// answer, and every few minutes with settleDue. No points are held while a
// request waits, so none are given back.
const router = require('express').Router();
const pool   = require('../db');
const auth   = require('../middleware/auth');
const { notifyUser } = require('../lib/push');
const R = require('../lib/challengeRules');
const { recordOf, recordsByOpponent } = require('../lib/record');
const { canChallenge } = require('../lib/challengeAccess');
const { shownName } = require('../lib/names');
const { EFFECTIVE_SQL: EFFECTIVE, PUBLIC_ID } = require('../lib/sql');

// a player's name as others see it (lib/names.js shownName)
const nameOf = async (userId) => {
  const { rows: [r] } = await pool.query(
    'SELECT u.name, p.public_id FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = $1', [userId]);
  return r ? shownName(r.name, r.public_id) : '';
};

const MAX_OPEN_SENT = 5;            // pending or running challenges one player has sent
const CHALLENGE_ID = /^[0-9a-f]{32}$/;   // (the same shape as a public id, lib/sql.js)
const DAY_MS = 864e5;

// a player's points as the leaderboard counts them: the app's total and the challenges' net
const effectivePoints = async (db, userId) =>
  Number((await db.query(`SELECT ${EFFECTIVE} AS p FROM profiles WHERE user_id = $1`, [userId])).rows[0]?.p || 0);

// a player who has logged enough workouts or sports to play for points
const activeEnough = async (userId) => {
  const l = await logsOf(userId);
  return l.history.length + l.sports.length >= R.STAKE_MIN_LOGS;
};

const specOf = (c) => ({ kind: c.kind || 'points', days: c.days || 7, stake: c.stake || 0, target: c.target, routine: c.routine });

// One player's workouts and sports logged since `since` (ms). The app backs
// up to Firestore (users/{uid}/history|sports/{key}, each { updatedAt, json:
// '{"item":…}' },
// lib/firestoreSync.js in the app); anything logged during a race was written
// after it began, so only docs updated since then are read. Older app builds
// backed up to /sync (user_sync): those are read too, and the two merged by id.
async function logsOf(userId, since = 0) {
  const out = { history: [], sports: [] };
  const seen = { history: new Set(), sports: new Set() };
  const add = (name, it) => {
    if (!it || typeof it !== 'object') return;
    const key = it.id != null ? String(it.id) : `${it.ts}`;
    if (seen[name].has(key)) return;
    seen[name].add(key); out[name].push(it);
  };
  try {
    const { getFirestore, Timestamp } = require('firebase-admin/firestore');
    const db = getFirestore();
    await Promise.all(['history', 'sports'].map(async (name) => {
      const snap = await db.collection(`users/${userId}/${name}`)
        .where('updatedAt', '>=', Timestamp.fromMillis(Math.max(0, since - 60_000))).get();
      // (each doc is { item, deleted? }: a deleted one doesn't count)
      snap.forEach((d) => { try { const e = JSON.parse(d.get('json')); if (e?.item && !e.deleted) add(name, e.item); } catch { /* a bad doc */ } });
    }));
  } catch (e) {
    console.error('challenge logs (firestore):', e.message);
  }
  const { rows } = await pool.query(
    `SELECT collection, data FROM user_sync WHERE user_id = $1 AND collection IN ('history', 'sports')`, [userId]);
  for (const r of rows) if (Array.isArray(r.data?.items)) r.data.items.forEach((it) => add(r.collection, it));
  return out;
}

// both sides' progress in a running target or routine race
async function raceProgress(c) {
  const spec = specOf(c);
  const start = new Date(c.starts_at).getTime(), end = new Date(c.ends_at).getTime();
  const [a, b] = await Promise.all([logsOf(c.from_user, start), logsOf(c.to_user, start)]);
  const now = Date.now();
  return { from: R.progress(spec, a, start, end, now), to: R.progress(spec, b, start, end, now) };
}

// Finishes a race that's decided: its totals, its result and the stake, once
// (only the UPDATE that flips it from 'accepted' moves points)
async function finish(c, fromValue, toValue, winner) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let moved = 0;
    if (winner !== 'draw' && c.stake > 0) {
      const [w, l] = winner === 'from' ? [c.from_user, c.to_user] : [c.to_user, c.from_user];
      const { rows: [won] } = await client.query(
        `SELECT COALESCE(SUM(moved), 0) AS n FROM challenges
         WHERE status = 'done' AND ends_at > now() - interval '7 days'
           AND ((winner = 'from' AND from_user = $1 AND to_user = $2) OR (winner = 'to' AND to_user = $1 AND from_user = $2))`,
        [w, l]);
      moved = R.transfer(c.stake, await effectivePoints(client, l), Number(won.n));
    }
    const { rowCount } = await client.query(
      `UPDATE challenges SET status = 'done', winner = $2, moved = $3, from_value = $4, to_value = $5,
         ends_at = LEAST(ends_at, now()),
         from_end = COALESCE((SELECT points FROM profiles WHERE user_id = from_user), 0),
         to_end   = COALESCE((SELECT points FROM profiles WHERE user_id = to_user), 0)
       WHERE id = $1 AND status = 'accepted'`,
      [c.id, winner, moved, fromValue, toValue]);
    if (rowCount && moved > 0) {
      const [w, l] = winner === 'from' ? [c.from_user, c.to_user] : [c.to_user, c.from_user];
      await client.query('UPDATE profiles SET challenge_pts = COALESCE(challenge_pts, 0) + $2 WHERE user_id = $1', [w, moved]);
      await client.query('UPDATE profiles SET challenge_pts = COALESCE(challenge_pts, 0) - $2 WHERE user_id = $1', [l, moved]);
    }
    await client.query('COMMIT');
    if (rowCount) announce(c, winner);
    return rowCount > 0;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// both players hear the result, the forfeit owed with it (after the commit;
// a notification never holds anything up)
async function announce(c, winner) {
  try {
    const [fromName, toName] = await Promise.all([nameOf(c.from_user), nameOf(c.to_user)]);
    const data = { challengeId: c.id };
    const forfeit = c.forfeit || undefined;
    if (winner === 'draw') {
      notifyUser(c.from_user, 'draw', { name: toName, data });
      notifyUser(c.to_user, 'draw', { name: fromName, data });
      return;
    }
    const [w, l, wName, lName] = winner === 'from'
      ? [c.from_user, c.to_user, fromName, toName] : [c.to_user, c.from_user, toName, fromName];
    notifyUser(w, 'won', { name: lName, forfeit, data });
    notifyUser(l, 'lost', { name: wName, forfeit, data });
  } catch (e) {
    console.warn('challenge result push:', e.message);
  }
}

// Settles the races in `rows` that are decided; the rest get their live
// progress (by challenge id)
async function settleRows(rows) {
  const live = {};
  for (const c of rows) {
    const ended = new Date(c.ends_at).getTime() <= Date.now();
    let from, to;
    if ((c.kind || 'points') === 'points') {
      from = { value: Math.max(0, (c.from_now ?? 0) - (c.from_start ?? 0)), reachedAt: null };
      to = { value: Math.max(0, (c.to_now ?? 0) - (c.to_start ?? 0)), reachedAt: null };
    } else {
      ({ from, to } = await raceProgress(c));
    }
    const winner = R.decide(specOf(c), from, to, ended);
    if (winner) await finish(c, from.value, to.value, winner);
    else live[c.id] = { from: from.value, to: to.value };
  }
  return live;
}

const RUNNING = `SELECT c.*, fp.points AS from_now, tp.points AS to_now FROM challenges c
  JOIN profiles fp ON fp.user_id = c.from_user JOIN profiles tp ON tp.user_id = c.to_user
  WHERE c.status = 'accepted'`;

// The caller's running races: settle those that are over; the rest get their
// live progress (by challenge id) for the reply
async function settle(userId) {
  const { rows } = await pool.query(`${RUNNING} AND (c.from_user = $1 OR c.to_user = $1)`, [userId]);
  return settleRows(rows);
}

// Requests past their time (all, or those of userIds) become 'expired', once
// (only the UPDATE that flips a row tells its sender); the expired rows
async function expireRequests(userIds = null) {
  const scoped = Array.isArray(userIds) && userIds.length > 0;
  const { rows } = await pool.query(
    `UPDATE challenges SET status = 'expired'
     WHERE status = 'pending' AND created_at <= now() - make_interval(hours => $1)
       ${scoped ? 'AND (from_user = ANY($2) OR to_user = ANY($2))' : ''}
     RETURNING id, from_user, to_user`,
    scoped ? [R.CHALLENGE_REQUEST_TTL_H, userIds] : [R.CHALLENGE_REQUEST_TTL_H]);
  for (const c of rows) {
    try {
      notifyUser(c.from_user, 'expired', { name: await nameOf(c.to_user), data: { challengeId: c.id } });
    } catch (e) {
      console.warn('challenge expired push:', e.message);
    }
  }
  return rows;
}

// Every race whose time is up, whoever's they are (server.js runs it every
// few minutes), so the result and its notification come on time; and every
// request past its time expires (its sender told)
async function settleDue() {
  try {
    const { rows } = await pool.query(`${RUNNING} AND c.ends_at <= now() LIMIT 50`);
    for (const c of rows) await settleRows([c]).catch((e) => console.warn('settle', c.id, e.message));
  } catch (e) {
    console.warn('settleDue:', e.message);
  }
  await expireRequests().catch((e) => console.warn('expireRequests:', e.message));
}

router.post('/', auth, async (req, res) => {
  const to = String(req.body?.to || '');
  if (!PUBLIC_ID.test(to)) return res.status(400).json({ error: 'Invalid player' });
  const { spec, error } = R.cleanSpec(req.body || {});
  if (error) return res.status(400).json({ error });
  const { rows: [target] } = await pool.query(
    `SELECT p.user_id, p.leaderboard_hidden, u.created_at FROM profiles p JOIN users u ON u.id = p.user_id WHERE p.public_id = $1`, [to]);
  if (!target || target.leaderboard_hidden) return res.status(404).json({ error: 'Not found' });
  if (target.user_id === req.user.id) return res.status(400).json({ error: 'You can\'t challenge yourself' });
  // (either has blocked the other: routes/blocks.js)
  const { rowCount: blocked } = await pool.query(
    'SELECT 1 FROM blocks WHERE (user_id = $1 AND blocked_id = $2) OR (user_id = $2 AND blocked_id = $1) LIMIT 1', [req.user.id, target.user_id]);
  if (blocked) return res.status(404).json({ error: 'Not found' });
  // friends, or someone in the same rank (lib/challengeAccess.js)
  if (!(await canChallenge(pool, req.user.id, target.user_id))) {
    return res.status(403).json({ error: 'notallowed', message: 'You can challenge friends, and players in your rank' });
  }
  if (spec.stake > 0) {
    const [mine, theirs] = await Promise.all([activeEnough(req.user.id), activeEnough(target.user_id)]);
    if (!mine || !theirs) {
      return res.status(403).json({ error: 'new', message: `Points can be put on a challenge once both players have logged ${R.STAKE_MIN_LOGS} workouts or sports` });
    }
    if (await effectivePoints(pool, req.user.id) < spec.stake) {
      return res.status(403).json({ error: 'points', message: 'You don\'t have that many points to put on it' });
    }
  }
  await expireRequests([req.user.id, target.user_id]).catch((e) => console.warn('expireRequests:', e.message));
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
    `INSERT INTO challenges (from_user, to_user, kind, days, stake, forfeit, target, routine)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [req.user.id, target.user_id, spec.kind, spec.days, spec.stake, spec.forfeit,
      spec.target && JSON.stringify(spec.target), spec.routine && JSON.stringify(spec.routine)]);
  res.status(201).json({ id: c.id, status: 'pending' });
  // a notification to accept it (after the reply: it never holds the request up)
  notifyUser(target.user_id, 'challenged', { name: await nameOf(req.user.id), data: { challengeId: c.id } });
});

router.get('/', auth, async (req, res) => {
  await expireRequests([req.user.id]).catch((e) => console.warn('expireRequests:', e.message));
  const live = await settle(req.user.id);
  const withExpired = req.query?.expired === '1';
  const { rows } = await pool.query(
    `SELECT c.id, c.status, c.created_at, c.starts_at, c.ends_at, c.kind, c.days, c.stake, c.forfeit, c.target, c.routine,
            c.winner, c.moved, c.from_value, c.to_value, c.forfeit_done_at, c.nudged_at,
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
       AND (c.status IN ('pending', 'accepted') OR (c.status = 'done' AND c.ends_at > now() - interval '30 days')
         OR ($2 AND c.status = 'expired' AND c.from_user = $1 AND c.created_at > now() - make_interval(hours => $3)))
     ORDER BY c.created_at DESC
     LIMIT 30`,
    [req.user.id, withExpired, R.CHALLENGE_REQUEST_TTL_H + R.EXPIRED_SHOWN_H]
  );
  const { rows: [me] } = await pool.query('SELECT COALESCE(challenge_pts, 0) AS n FROM profiles WHERE user_id = $1', [req.user.id]);
  const now = Date.now();
  res.json({
    challenges: rows.map((r) => ({ ...r, status: R.requestExpired(r, now) ? 'expired' : r.status }))
      // (expired: only the sender's, and only for an app that asked)
      .filter((r) => r.status !== 'expired' || (withExpired && r.sent))
      .map((r) => {
      const kind = r.kind || 'points';
      let fromV = 0, toV = 0;
      if (r.status === 'done' && r.from_value != null) { fromV = Number(r.from_value); toV = Number(r.to_value); }
      else if (r.status === 'accepted' && live[r.id]) { fromV = live[r.id].from; toV = live[r.id].to; }
      else if (r.status !== 'pending' && r.status !== 'expired' && kind === 'points') {
        fromV = Math.max(0, (r.from_end ?? r.from_now ?? 0) - (r.from_start ?? 0));
        toV = Math.max(0, (r.to_end ?? r.to_now ?? 0) - (r.to_start ?? 0));
      }
      const mine = r.sent ? fromV : toV, theirs = r.sent ? toV : fromV;
      const won = r.winner ? (r.winner === 'draw' ? 'draw' : (r.winner === 'from') === r.sent ? 'won' : 'lost')
        : r.status === 'done' ? (mine > theirs ? 'won' : mine < theirs ? 'lost' : 'draw') : null;
      return {
        id: r.id,
        status: r.status,                        // pending | accepted | done | expired
        direction: r.sent ? 'sent' : 'received',
        opponent: { id: r.opp_id, name: shownName(r.opp_name, r.opp_id), avatarEmoji: r.opp_emoji || null, avatarPhoto: r.opp_photo || null },
        kind, days: r.days || 7, stake: r.stake || 0, forfeit: r.forfeit || null,
        target: r.target || null, routine: r.routine || null, goal: R.goalOf({ kind, target: r.target, routine: r.routine }),
        createdAt: r.created_at, startsAt: r.starts_at, endsAt: r.ends_at,
        // a request: when it stops waiting for an answer
        expiresAt: r.status === 'pending' || r.status === 'expired' ? R.requestExpiresAt(r.created_at) : null,
        mine, theirs,
        result: r.status === 'done' ? won : null,
        moved: r.status === 'done' ? (r.moved || 0) : 0,
        // the forfeit: done (the loser said so), and when the winner last asked for it
        forfeitDone: !!r.forfeit_done_at,
        nudgedAt: r.nudged_at || null,
      };
    }),
    // the net points the caller's challenges have won or lost (added to the app's own total)
    challengePoints: Number(me?.n || 0),
    record: await recordOf(pool, req.user.id),
    records: await recordsByOpponent(pool, req.user.id),
  });
});

router.post('/:id/respond', auth, async (req, res) => {
  const id = String(req.params.id || '');
  if (!CHALLENGE_ID.test(id)) return res.status(404).json({ error: 'Not found' });
  const accept = req.body?.accept === true;
  const { rows: [c] } = await pool.query(
    `SELECT stake, status, created_at FROM challenges WHERE id = $1 AND to_user = $2 AND status IN ('pending', 'expired')`, [id, req.user.id]);
  if (!c) return res.status(404).json({ error: 'Not found' });
  // too late to answer (its sender is told by expireRequests)
  if (R.requestExpired(c)) {
    await expireRequests([req.user.id]).catch((e) => console.warn('expireRequests:', e.message));
    return res.status(410).json({ error: 'expired', message: `This challenge expired: it wasn't answered within ${R.CHALLENGE_REQUEST_TTL_H} hours` });
  }
  if (accept) {
    if (c.stake > 0) {
      if (!(await activeEnough(req.user.id))) {
        return res.status(403).json({ error: 'new', message: `Points can be put on a challenge once both players have logged ${R.STAKE_MIN_LOGS} workouts or sports` });
      }
      if (await effectivePoints(pool, req.user.id) < c.stake) {
        return res.status(403).json({ error: 'points', message: 'You don\'t have that many points to put on it' });
      }
    }
  }
  const { rowCount } = accept
    ? await pool.query(
      `UPDATE challenges c SET status = 'accepted', starts_at = now(), ends_at = now() + make_interval(days => COALESCE(c.days, 7)),
         from_start = COALESCE((SELECT points FROM profiles WHERE user_id = c.from_user), 0),
         to_start   = COALESCE((SELECT points FROM profiles WHERE user_id = c.to_user), 0)
       WHERE c.id = $1 AND c.to_user = $2 AND c.status = 'pending' AND c.created_at > now() - make_interval(hours => $3)`,
      [id, req.user.id, R.CHALLENGE_REQUEST_TTL_H])
    : await pool.query(
      `UPDATE challenges SET status = 'declined' WHERE id = $1 AND to_user = $2 AND status = 'pending'`, [id, req.user.id]);
  if (!rowCount) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true, status: accept ? 'accepted' : 'declined' });
  // the challenger hears the race is on
  if (accept) {
    const { rows: [c] } = await pool.query('SELECT from_user FROM challenges WHERE id = $1', [id]);
    if (c) notifyUser(c.from_user, 'accepted', { name: await nameOf(req.user.id), data: { challengeId: id } });
  }
});

router.post('/:id/cancel', auth, async (req, res) => {
  const id = String(req.params.id || '');
  if (!CHALLENGE_ID.test(id)) return res.status(404).json({ error: 'Not found' });
  const { rowCount } = await pool.query(
    `UPDATE challenges SET status = 'cancelled' WHERE id = $1 AND from_user = $2 AND status = 'pending'`, [id, req.user.id]);
  if (!rowCount) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// the loser and the winner of a finished race with a forfeit (and their names)
async function forfeitRace(id) {
  const { rows: [c] } = await pool.query(
    `SELECT * FROM challenges WHERE id = $1 AND status = 'done' AND winner IN ('from', 'to') AND forfeit IS NOT NULL`, [id]);
  if (!c) return null;
  return { c, winner: c.winner === 'from' ? c.from_user : c.to_user, loser: c.winner === 'from' ? c.to_user : c.from_user };
}

router.post('/:id/forfeit-done', auth, async (req, res) => {
  const id = String(req.params.id || '');
  if (!CHALLENGE_ID.test(id)) return res.status(404).json({ error: 'Not found' });
  const r = await forfeitRace(id);
  if (!r || r.loser !== req.user.id) return res.status(404).json({ error: 'Not found' });
  const { rowCount } = await pool.query(
    'UPDATE challenges SET forfeit_done_at = now() WHERE id = $1 AND forfeit_done_at IS NULL', [id]);
  res.json({ ok: true });
  if (rowCount) notifyUser(r.winner, 'forfeitDone', { name: await nameOf(req.user.id), forfeit: r.c.forfeit, data: { challengeId: id } });
});

// once a day at most, and not after it's done
const NUDGE_EVERY_MS = 20 * 3600 * 1000;
router.post('/:id/nudge', auth, async (req, res) => {
  const id = String(req.params.id || '');
  if (!CHALLENGE_ID.test(id)) return res.status(404).json({ error: 'Not found' });
  const r = await forfeitRace(id);
  if (!r || r.winner !== req.user.id) return res.status(404).json({ error: 'Not found' });
  if (r.c.forfeit_done_at) return res.status(409).json({ error: 'done', message: 'The forfeit is already done' });
  const { rowCount } = await pool.query(
    `UPDATE challenges SET nudged_at = now() WHERE id = $1 AND forfeit_done_at IS NULL
       AND (nudged_at IS NULL OR nudged_at < now() - make_interval(secs => $2))`, [id, NUDGE_EVERY_MS / 1000]);
  if (!rowCount) return res.status(429).json({ error: 'soon', message: 'You can remind them again tomorrow' });
  res.json({ ok: true });
  notifyUser(r.loser, 'forfeitNudge', { name: await nameOf(req.user.id), forfeit: r.c.forfeit, data: { challengeId: id } });
});

module.exports = router;
module.exports.settleDue = settleDue;
module.exports.expireRequests = expireRequests;
