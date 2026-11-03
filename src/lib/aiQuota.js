// Caps on the AI routes, so one account (or a script with a stolen token)
// can't run up the Anthropic bill, and a guest gets a taste, not a free coach.
// One ai_log row per call (ai_guest_log for guests). The per-IP limiter in
// app.js still stops bursts; these stop a steady drain.
//
// What counts as a message with the coach ("chat"): POST /ai/advice from the
// coach chat and the daily check-in's talk-back (the app sends kind: 'chat',
// or nothing: builds from before kind). The coach's sentence on a meal
// (kind: 'meal-take') is a logging tool, like a meal photo scan, a meal
// described in words (food-text), a workout said out loud (workout-text) and
// a drink container's size from a photo (container-volume):
// those have their own, roomier caps and never use up the chat messages.
//
// Limits (env), per signed-in user:
//   AI_CHAT_DAILY_LIMIT     chat messages per local day (default 10). The day
//                           is the phone's: it sends X-TZ-Offset (minutes east
//                           of UTC); without it, UTC. Also never more than
//                           twice that in any 24 hours, whatever offset is sent.
//   AI_LOGGING_DAILY_LIMIT  meal scans + foods described + workouts said +
//                           containers sized from a photo, per
//                           local day (default 40)
//   AI_SCAN_DAILY_LIMIT     of those, meal photo scans (default 30: they cost most)
//   AI_TAKE_DAILY_LIMIT     the coach's take on a meal, per local day (default 30)
//   AI_DAILY_LIMIT          every AI call together, last 24 hours (default 150)
// Guests (no sign-in; the app sends X-Install-Id, a random id made at install):
//   AI_GUEST_CHATS          chat messages per install, ever (default 2)
//   AI_GUEST_IP_DAILY       guest chats per IP in 24 hours (default 6: a
//                           reinstall or a made-up id doesn't buy more)
//   AI_GUEST_DAILY_TOTAL    guest chats from everyone in 24 hours (default 300)
// A signed-in user's database error lets the call through (logged): a cap is
// not worth breaking the app over. A guest's doesn't (they can sign in).
const crypto = require('crypto');

// share of calls that also prune old rows (cheap with the index)
const PRUNE_CHANCE = 0.02;
const DAY_MS = 24 * 60 * 60 * 1000;

// 'advice': rows from before chat and meal takes were told apart
const CHAT_ENDPOINTS = ['chat', 'advice'];
const LOGGING_ENDPOINTS = ['meal-scan', 'food-text', 'workout-text', 'container-volume'];

const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : d);

function limits(env = process.env) {
  return {
    daily: num(env.AI_DAILY_LIMIT, 150),
    scan: num(env.AI_SCAN_DAILY_LIMIT, 30),
    chat: num(env.AI_CHAT_DAILY_LIMIT, 10),
    logging: num(env.AI_LOGGING_DAILY_LIMIT, 40),
    take: num(env.AI_TAKE_DAILY_LIMIT, 30),
    guest: num(env.AI_GUEST_CHATS, 2),
    guestIp: num(env.AI_GUEST_IP_DAILY, 6),
    guestAll: num(env.AI_GUEST_DAILY_TOTAL, 300),
  };
}

function kindOf(endpoint) {
  if (CHAT_ENDPOINTS.includes(endpoint)) return 'chat';
  if (LOGGING_ENDPOINTS.includes(endpoint)) return 'logging';
  if (endpoint === 'meal-take') return 'take';
  return 'other';
}

// POST /ai/advice: what the app says the message is (kind), 'chat' when it
// says nothing (builds from before kind)
const adviceEndpoint = (req) => (req.body?.kind === 'meal-take' ? 'meal-take' : 'chat');

// the phone's UTC offset in minutes (X-TZ-Offset: +60 in Paris in winter,
// -300 in New York); anything else is UTC
function tzOffset(v) {
  if (v === undefined || v === null || String(v).trim() === '') return 0;
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-840, Math.min(840, Math.round(n)));
}

// the user's local day around `now`: when it started and when it resets (UTC instants)
function dayWindow(offsetMin = 0, now = Date.now()) {
  const shift = offsetMin * 60000;
  const startLocal = Math.floor((now + shift) / DAY_MS) * DAY_MS;
  return { start: new Date(startLocal - shift), resetsAt: new Date(startLocal + DAY_MS - shift) };
}

// counts: { total, chat, chat24, logging, scan, take } before this call;
// null when within limits, else which cap was hit
function overLimit(c, lim, endpoint) {
  const n = (k) => Number(c?.[k]) || 0;
  const kind = kindOf(endpoint);
  if (kind === 'chat' && (n('chat') >= lim.chat || n('chat24') >= lim.chat * 2)) return 'chat';
  if (n('total') >= lim.daily) return 'daily';
  if (kind === 'logging' && n('logging') >= lim.logging) return 'logging';
  if (endpoint === 'meal-scan' && n('scan') >= lim.scan) return 'scan';
  if (kind === 'take' && n('take') >= lim.take) return 'take';
  return null;
}

// the 429 for a cap that was hit
function limitReply(hit, c, lim, resetsAt) {
  if (hit === 'chat') {
    return { error: 'daily_limit', code: 'ai_chat_quota', limit: lim.chat, used: Math.min(Number(c?.chat) || 0, lim.chat), resetsAt: resetsAt.toISOString() };
  }
  const text = { daily: 'Daily AI limit reached', scan: 'Daily meal scan limit reached', logging: 'Daily logging limit reached', take: 'Daily limit reached' }[hit];
  const code = { daily: 'ai_quota', scan: 'ai_scan_quota', logging: 'ai_log_quota', take: 'ai_take_quota' }[hit];
  return { error: text, code, resetsAt: resetsAt.toISOString() };
}

// guests: counts { install (ever), ip (24 h), everyone (24 h) } before this call
function guestOverLimit(c, lim) {
  const n = (k) => Number(c?.[k]) || 0;
  if (n('install') >= lim.guest) return 'install';
  if (n('ip') >= lim.guestIp) return 'ip';
  if (n('everyone') >= lim.guestAll) return 'busy';
  return null;
}

// an install id the app made (formcoach-app src/lib/aiChatQuota.js):
// letters, digits, - and _
const INSTALL_ID = /^[A-Za-z0-9_-]{16,64}$/;
function installIdOf(req) {
  const v = String((req.get ? req.get('X-Install-Id') : req.headers?.['x-install-id']) || '').trim();
  return INSTALL_ID.test(v) ? v : null;
}
// IPs are kept only as a salted hash
const ipHash = (ip) => crypto.createHash('sha256').update(`${process.env.IP_HASH_SALT || '2sets-guest'}:${ip || ''}`).digest('hex').slice(0, 32);

// Express middleware for one AI endpoint, after auth (req.user.id) or
// optionalAuth (req.guest). `endpoint` is a name, or a function of the
// request (POST /ai/advice: adviceEndpoint).
// res.locals.aiUsage: the chat count after this call (the app shows it);
// res.locals.aiRefund(): takes the call back off when the AI failed.
function aiQuota(pool, endpoint, { env = process.env, now = () => Date.now() } = {}) {
  return async function quota(req, res, next) {
    const ep = typeof endpoint === 'function' ? endpoint(req) : endpoint;
    const lim = limits(env);
    res.locals = res.locals || {};
    res.locals.aiRefund = () => {};
    const uid = req.user?.id;
    if (!uid) {
      if (req.guest) return guestQuota(pool, ep, lim, req, res, next);
      return next();
    }
    const { start, resetsAt } = dayWindow(tzOffset(req.get ? req.get('X-TZ-Offset') : undefined), now());
    try {
      const { rows } = await pool.query(
        `SELECT COUNT(*) FILTER (WHERE logged_at > NOW() - INTERVAL '24 hours')::int AS total,
                COUNT(*) FILTER (WHERE endpoint = ANY($3) AND logged_at > NOW() - INTERVAL '24 hours')::int AS chat24,
                COUNT(*) FILTER (WHERE endpoint = ANY($3) AND logged_at >= $2)::int AS chat,
                COUNT(*) FILTER (WHERE endpoint = ANY($4) AND logged_at >= $2)::int AS logging,
                COUNT(*) FILTER (WHERE endpoint = 'meal-scan' AND logged_at >= $2)::int AS scan,
                COUNT(*) FILTER (WHERE endpoint = 'meal-take' AND logged_at >= $2)::int AS take
           FROM ai_log WHERE user_id = $1 AND logged_at > LEAST($2::timestamptz, NOW() - INTERVAL '24 hours')`,
        [uid, start.toISOString(), CHAT_ENDPOINTS, LOGGING_ENDPOINTS],
      );
      const c = rows[0] || {};
      const hit = overLimit(c, lim, ep);
      if (hit) return res.status(429).json(limitReply(hit, c, lim, resetsAt));
      const ins = await pool.query('INSERT INTO ai_log (user_id, endpoint) VALUES ($1, $2) RETURNING id', [uid, ep]);
      const id = ins?.rows?.[0]?.id;
      if (id) res.locals.aiRefund = () => pool.query('DELETE FROM ai_log WHERE id = $1', [id]).catch(() => {});
      if (kindOf(ep) === 'chat') {
        const used = Math.min((Number(c.chat) || 0) + 1, lim.chat);
        res.locals.aiUsage = { used, limit: lim.chat, left: lim.chat - used, resetsAt: resetsAt.toISOString() };
      }
      // now and then, drop records older than the 90 days the privacy policy promises
      if (Math.random() < PRUNE_CHANCE) {
        pool.query(`DELETE FROM ai_log WHERE logged_at < NOW() - INTERVAL '90 days'`)
          .catch((e) => console.error('ai_log prune failed:', e.message));
      }
    } catch (err) {
      console.error('ai quota check failed (allowed):', err.message);
    }
    next();
  };
}

async function guestQuota(pool, ep, lim, req, res, next) {
  const signIn = (used) => res.status(401).json({ error: 'sign_in_required', limit: lim.guest, used: Math.min(used, lim.guest) });
  // a guest only chats; the rest of the AI is for accounts
  if (kindOf(ep) !== 'chat') return signIn(lim.guest);
  const { installId } = req.guest;
  const ip = ipHash(req.ip);
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE install_id = $1)::int AS install,
              COUNT(*) FILTER (WHERE ip_hash = $2 AND logged_at > NOW() - INTERVAL '24 hours')::int AS ip,
              COUNT(*) FILTER (WHERE logged_at > NOW() - INTERVAL '24 hours')::int AS everyone
         FROM ai_guest_log WHERE install_id = $1 OR logged_at > NOW() - INTERVAL '24 hours'`,
      [installId, ip],
    );
    const c = rows[0] || {};
    if (guestOverLimit(c, lim)) return signIn(Number(c.install) || 0);
    const ins = await pool.query('INSERT INTO ai_guest_log (install_id, ip_hash) VALUES ($1, $2) RETURNING id', [installId, ip]);
    // now and then, drop guest records older than the 90 days the privacy policy promises
    if (Math.random() < PRUNE_CHANCE) {
      pool.query(`DELETE FROM ai_guest_log WHERE logged_at < NOW() - INTERVAL '90 days'`)
        .catch((e) => console.error('ai_guest_log prune failed:', e.message));
    }
    const id = ins?.rows?.[0]?.id;
    if (id) res.locals.aiRefund = () => pool.query('DELETE FROM ai_guest_log WHERE id = $1', [id]).catch(() => {});
    const used = Math.min((Number(c.install) || 0) + 1, lim.guest);
    res.locals.aiUsage = { used, limit: lim.guest, left: lim.guest - used, guest: true };
    if (Math.random() < PRUNE_CHANCE) {
      pool.query(`DELETE FROM ai_guest_log WHERE logged_at < NOW() - INTERVAL '400 days'`)
        .catch((e) => console.error('ai_guest_log prune failed:', e.message));
    }
  } catch (err) {
    // (no account to protect: closed, and signing in still works)
    console.error('guest ai quota check failed (refused):', err.message);
    return signIn(lim.guest);
  }
  next();
}

// POST /ai/advice: a signed-in user (the normal token check), or a guest with
// an install id (2 free chats, then sign in). Neither: 401 as before.
function optionalAuth(auth) {
  return function maybeAuth(req, res, next) {
    const header = req.headers?.authorization;
    if (header && header.startsWith('Bearer ')) return auth(req, res, next);
    const installId = installIdOf(req);
    if (!installId) return res.status(401).json({ error: 'No token provided' });
    req.guest = { installId };
    next();
  };
}

module.exports = {
  aiQuota, optionalAuth, installIdOf, adviceEndpoint, limits, overLimit, guestOverLimit, limitReply, dayWindow, tzOffset, kindOf,
  CHAT_ENDPOINTS, LOGGING_ENDPOINTS,
};
