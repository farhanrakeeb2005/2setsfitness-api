// Per-user daily caps on the AI routes, so one account (or a script with a
// stolen token) can't run up the Anthropic bill. Counted over the last 24
// hours in ai_log, one row per call. The per-IP limiter in app.js still
// stops bursts; this stops a steady drain.
//
// Limits (env, per user per 24 h): AI_DAILY_LIMIT for all AI calls together
// (default 150), AI_SCAN_DAILY_LIMIT for meal photo scans (default 30, they
// cost the most). A database error lets the call through (logged): a cap
// is not worth breaking the app over.

const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : d);

function limits(env = process.env) {
  return { daily: num(env.AI_DAILY_LIMIT, 150), scan: num(env.AI_SCAN_DAILY_LIMIT, 30) };
}

// the counts are { total, scan } for the last 24 h; null when within limits,
// else which cap was hit
function overLimit(counts, lim, endpoint) {
  if (counts.total >= lim.daily) return 'daily';
  if (endpoint === 'meal-scan' && counts.scan >= lim.scan) return 'scan';
  return null;
}

// Express middleware for one AI endpoint; runs after auth (req.user.id)
function aiQuota(pool, endpoint) {
  return async function quota(req, res, next) {
    const uid = req.user?.id;
    if (!uid) return next();
    const lim = limits();
    try {
      const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE endpoint = 'meal-scan')::int AS scan
           FROM ai_log WHERE user_id = $1 AND logged_at > NOW() - INTERVAL '24 hours'`,
        [uid],
      );
      const hit = overLimit(rows[0] || { total: 0, scan: 0 }, lim, endpoint);
      if (hit) {
        return res.status(429).json({
          error: hit === 'scan' ? 'Daily meal scan limit reached' : 'Daily AI limit reached',
          code: hit === 'scan' ? 'ai_scan_quota' : 'ai_quota',
        });
      }
      await pool.query('INSERT INTO ai_log (user_id, endpoint) VALUES ($1, $2)', [uid, endpoint]);
    } catch (err) {
      console.error('ai quota check failed (allowed):', err.message);
    }
    next();
  };
}

module.exports = { aiQuota, limits, overLimit };
