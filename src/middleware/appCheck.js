// Firebase App Check: each request from the real app carries a short-lived
// token (header X-Firebase-AppCheck) that Google issues only to the genuine
// app on a genuine device (Play Integrity on Android, App Attest on iOS, a
// registered debug token in development builds). A script with a stolen
// sign-in can't get one.
//
// APP_CHECK (env):
//   monitor  (default) check every token and log how many are missing or
//            invalid, but let the request through: app builds from before
//            App Check, and copies not installed from Google Play, still work
//   enforce  refuse requests without a valid token (401, code 'app_check')
//   off      don't check
// Switch to enforce once the App Check build is what users have (the app on
// Google Play / the App Store) and the monitor log shows ~no missing tokens.
const MODES = ['off', 'monitor', 'enforce'];

function appCheckMode(env = process.env) {
  const m = String(env.APP_CHECK || 'monitor').toLowerCase().trim();
  return MODES.includes(m) ? m : 'monitor';
}

// routes that never carry a token: the health check and the email footer link
const exempt = (path) => path === '/health' || path.startsWith('/email/');

function appCheckGuard({ env = process.env, verify, log = console } = {}) {
  const mode = appCheckMode(env);
  const check = verify || ((token) => require('firebase-admin/app-check').getAppCheck().verifyToken(token));
  const stats = { ok: 0, missing: 0, invalid: 0 };
  const guard = async function appCheck(req, res, next) {
    if (mode === 'off' || exempt(req.path)) return next();
    const token = req.get('X-Firebase-AppCheck');
    let state = 'ok';
    if (!token) state = 'missing';
    else {
      try { await check(token); } catch { state = 'invalid'; }
    }
    stats[state] += 1;
    if (state === 'ok') return next();
    if (mode === 'enforce') return res.status(401).json({ error: 'This app could not be verified. Update the app and try again.', code: 'app_check' });
    // monitor: a line now and then, enough to see whether it's safe to enforce
    if ((stats.missing + stats.invalid) % 50 === 1) log.warn(`app check (monitor): ${JSON.stringify(stats)}`);
    return next();
  };
  guard.stats = stats;
  guard.mode = mode;
  return guard;
}

module.exports = { appCheckGuard, appCheckMode };
