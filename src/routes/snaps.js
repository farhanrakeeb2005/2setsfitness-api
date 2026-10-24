// Proof snaps: a photo one player sends another after training, only between
// players with a challenge together (open, running, or ended in the last two
// weeks). Seen once, then gone.
//
//   POST /snaps                    { to: <public id>, image: <base64 JPEG>, caption?, challengeId? }
//   GET  /snaps                    snaps waiting for me (no images), and how mine went
//   POST /snaps/:id/open           the image, once (the viewer's phone keeps it in memory only)
//   POST /snaps/:id/done           viewed: the image is deleted now
//   POST /snaps/:id/screenshot     the viewer's phone saw a screenshot: the sender hears
//   POST /snaps/:id/report         { reason } kept for review, the sender blocked for the reporter
//   GET  /snaps/blocks             players I've blocked;  POST /snaps/blocks { id } ;  DELETE /snaps/blocks/:id
//   PUT  /snaps/settings           { off: true|false } receive snaps or not
//
// Every photo is checked before delivery (lib/snapCheck.js). An image is
// deleted once viewed (or 10 minutes after it was opened), and unopened ones
// after 24 hours; only reported snaps are kept, for review, then deleted
// after 30 days. Blocking works both ways and also stops challenges.
const router = require('express').Router();
const pool   = require('../db');
const auth   = require('../middleware/auth');
const { notifyUser } = require('../lib/push');
const { checkSnap } = require('../lib/snapCheck');
const mailer = require('../lib/mailer');

const PUBLIC_ID = /^[0-9a-f]{32}$/;
const SNAP_ID = /^[0-9a-f]{32}$/;
const MAX_B64 = 700_000;              // ~500 KB JPEG (the app sends ~1080 px at 0.6)
const PER_DAY = 20;                    // snaps one player can send a day
const CAPTION_MAX = 80;
const REPORT_REASONS = ['nudity', 'harassment', 'violence', 'spam', 'other'];

const nameOf = async (userId) => (await pool.query('SELECT name FROM users WHERE id = $1', [userId])).rows[0]?.name || '';

// unviewed images past 24 h, viewed ones past 10 min, and old rows go
async function sweep() {
  await pool.query(
    `UPDATE snaps SET image = NULL
     WHERE image IS NOT NULL AND NOT reported
       AND (created_at < now() - interval '24 hours' OR opened_at < now() - interval '10 minutes')`);
  await pool.query(
    `DELETE FROM snaps WHERE (NOT reported AND created_at < now() - interval '7 days')
       OR (reported AND created_at < now() - interval '30 days')`);
}

// either has blocked the other
const blockedBetween = async (a, b) => (await pool.query(
  'SELECT 1 FROM blocks WHERE (user_id = $1 AND blocked_id = $2) OR (user_id = $2 AND blocked_id = $1) LIMIT 1', [a, b])).rowCount > 0;

router.post('/', auth, async (req, res) => {
  const to = String(req.body?.to || '');
  const image = typeof req.body?.image === 'string' ? req.body.image.replace(/^data:image\/jpeg;base64,/, '') : '';
  const caption = typeof req.body?.caption === 'string' ? req.body.caption.trim().slice(0, CAPTION_MAX) : '';
  if (!PUBLIC_ID.test(to)) return res.status(400).json({ error: 'Invalid player' });
  if (!image || image.length > MAX_B64 || !/^[A-Za-z0-9+/=]+$/.test(image)) return res.status(400).json({ error: 'Invalid image' });
  const { rows: [target] } = await pool.query(
    'SELECT p.user_id, p.snaps_off FROM profiles p WHERE p.public_id = $1', [to]);
  if (!target || target.user_id === req.user.id) return res.status(404).json({ error: 'Not found' });
  if (target.snaps_off) return res.status(403).json({ error: 'off', message: 'They don\'t take snaps' });
  if (await blockedBetween(req.user.id, target.user_id)) return res.status(403).json({ error: 'blocked', message: 'You can\'t send them snaps' });
  const { rows: [ch] } = await pool.query(
    `SELECT id FROM challenges
     WHERE ((from_user = $1 AND to_user = $2) OR (from_user = $2 AND to_user = $1))
       AND (status IN ('pending', 'accepted') OR (status = 'done' AND ends_at > now() - interval '14 days'))
     ORDER BY created_at DESC LIMIT 1`, [req.user.id, target.user_id]);
  if (!ch) return res.status(403).json({ error: 'nochallenge', message: 'Snaps go to players you have a challenge with' });
  const { rows: [sent] } = await pool.query(
    `SELECT COUNT(*) AS n FROM snaps WHERE from_user = $1 AND created_at > now() - interval '24 hours'`, [req.user.id]);
  if (Number(sent.n) >= PER_DAY) return res.status(429).json({ error: 'limit', message: 'That\'s enough snaps for today' });

  let check;
  try { check = await checkSnap(image); }
  catch (e) {
    console.error('snap check failed:', e.message);
    return res.status(503).json({ error: 'check', message: 'Couldn\'t check the photo. Try again.' });
  }
  if (!check.ok) return res.status(422).json({ error: 'rejected', reason: check.reason, message: 'This photo can\'t be sent' });

  const { rows: [s] } = await pool.query(
    `INSERT INTO snaps (from_user, to_user, challenge_id, caption, image) VALUES ($1, $2, $3, $4, decode($5, 'base64')) RETURNING id`,
    [req.user.id, target.user_id, ch.id, caption || null, image]);
  res.status(201).json({ id: s.id });
  notifyUser(target.user_id, 'snap', { name: await nameOf(req.user.id), data: { snapId: s.id } });
});

router.get('/', auth, async (req, res) => {
  await sweep();
  const { rows } = await pool.query(
    `SELECT s.id, s.caption, s.created_at, s.opened_at, s.screenshot, s.challenge_id, s.to_user = $1 AS incoming,
            s.image IS NOT NULL AS waiting, u.name AS other_name, p.public_id AS other_id, p.avatar_emoji, p.avatar_photo
     FROM snaps s
     JOIN users u ON u.id = CASE WHEN s.to_user = $1 THEN s.from_user ELSE s.to_user END
     JOIN profiles p ON p.user_id = u.id
     WHERE (s.to_user = $1 OR s.from_user = $1) AND s.created_at > now() - interval '24 hours'
       AND NOT (s.to_user = $1 AND s.reported)
     ORDER BY s.created_at DESC LIMIT 50`, [req.user.id]);
  const { rows: [me] } = await pool.query('SELECT snaps_off FROM profiles WHERE user_id = $1', [req.user.id]);
  res.json({
    snaps: rows.map((r) => ({
      id: r.id,
      direction: r.incoming ? 'received' : 'sent',
      other: { id: r.other_id, name: r.other_name, avatarEmoji: r.avatar_emoji || null, avatarPhoto: r.avatar_photo || null },
      caption: r.caption || null,
      challengeId: r.challenge_id,
      createdAt: r.created_at,
      // received: can it still be opened; sent: has it been seen, screenshotted
      status: r.incoming ? (r.waiting && !r.opened_at ? 'new' : 'seen') : (r.opened_at ? 'seen' : 'delivered'),
      screenshot: !!r.screenshot,
    })),
    off: !!me?.snaps_off,
  });
});

router.post('/:id/open', auth, async (req, res) => {
  const id = String(req.params.id || '');
  if (!SNAP_ID.test(id)) return res.status(404).json({ error: 'Not found' });
  const { rows: [s] } = await pool.query(
    `UPDATE snaps SET opened_at = now()
     WHERE id = $1 AND to_user = $2 AND opened_at IS NULL AND image IS NOT NULL AND created_at > now() - interval '24 hours'
     RETURNING encode(image, 'base64') AS image, caption`, [id, req.user.id]);
  if (!s) return res.status(404).json({ error: 'Not found' });
  res.json({ image: s.image, caption: s.caption || null });
});

router.post('/:id/done', auth, async (req, res) => {
  const id = String(req.params.id || '');
  if (!SNAP_ID.test(id)) return res.status(404).json({ error: 'Not found' });
  await pool.query(`UPDATE snaps SET image = NULL WHERE id = $1 AND to_user = $2 AND NOT reported`, [id, req.user.id]);
  res.json({ ok: true });
});

router.post('/:id/screenshot', auth, async (req, res) => {
  const id = String(req.params.id || '');
  if (!SNAP_ID.test(id)) return res.status(404).json({ error: 'Not found' });
  const { rows: [s] } = await pool.query(
    `UPDATE snaps SET screenshot = true WHERE id = $1 AND to_user = $2 AND NOT screenshot RETURNING from_user`, [id, req.user.id]);
  res.json({ ok: true });
  if (s) notifyUser(s.from_user, 'screenshot', { name: await nameOf(req.user.id), data: { snapId: id } });
});

router.post('/:id/report', auth, async (req, res) => {
  const id = String(req.params.id || '');
  const reason = REPORT_REASONS.includes(req.body?.reason) ? req.body.reason : 'other';
  if (!SNAP_ID.test(id)) return res.status(404).json({ error: 'Not found' });
  const { rows: [s] } = await pool.query(
    `UPDATE snaps SET reported = true, report_reason = $3 WHERE id = $1 AND to_user = $2 RETURNING from_user`, [id, req.user.id, reason]);
  if (!s) return res.status(404).json({ error: 'Not found' });
  await pool.query('INSERT INTO blocks (user_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.user.id, s.from_user]);
  res.json({ ok: true, blocked: true });
  // the team hears of it (the snap's id and reason, never the photo)
  if (process.env.REPORTS_TO) {
    mailer.send(process.env.REPORTS_TO, {
      subject: `Snap reported: ${reason}`,
      html: `<p>A proof snap was reported (${mailer.esc(reason)}).</p><p>Snap id: ${mailer.esc(id)}</p><p>It is kept for 30 days for review; the sender is blocked for the reporter.</p>`,
    }).catch((e) => console.error('report mail failed:', e.message));
  }
});

router.get('/blocks', auth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT p.public_id, u.name FROM blocks b JOIN users u ON u.id = b.blocked_id JOIN profiles p ON p.user_id = b.blocked_id
     WHERE b.user_id = $1 ORDER BY b.created_at DESC`, [req.user.id]);
  res.json(rows.map((r) => ({ id: r.public_id, name: r.name })));
});

router.post('/blocks', auth, async (req, res) => {
  const id = String(req.body?.id || '');
  if (!PUBLIC_ID.test(id)) return res.status(400).json({ error: 'Invalid player' });
  const { rows: [t] } = await pool.query('SELECT user_id FROM profiles WHERE public_id = $1', [id]);
  if (!t || t.user_id === req.user.id) return res.status(404).json({ error: 'Not found' });
  await pool.query('INSERT INTO blocks (user_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.user.id, t.user_id]);
  // no longer friends either
  await pool.query(
    'DELETE FROM friends WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)', [req.user.id, t.user_id]);
  // their challenges with each other that haven't started end here
  await pool.query(
    `UPDATE challenges SET status = 'cancelled' WHERE status = 'pending'
       AND ((from_user = $1 AND to_user = $2) OR (from_user = $2 AND to_user = $1))`, [req.user.id, t.user_id]);
  res.json({ ok: true });
});

router.delete('/blocks/:id', auth, async (req, res) => {
  const id = String(req.params.id || '');
  if (!PUBLIC_ID.test(id)) return res.status(404).json({ error: 'Not found' });
  await pool.query(
    'DELETE FROM blocks WHERE user_id = $1 AND blocked_id = (SELECT user_id FROM profiles WHERE public_id = $2)', [req.user.id, id]);
  res.json({ ok: true });
});

router.put('/settings', auth, async (req, res) => {
  const off = req.body?.off === true;
  await pool.query('UPDATE profiles SET snaps_off = $1 WHERE user_id = $2', [off, req.user.id]);
  res.json({ off });
});

module.exports = router;
module.exports.blockedBetween = blockedBetween;
