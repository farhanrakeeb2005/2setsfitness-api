const { getAuth } = require('firebase-admin/auth');
const pool = require('../db');
const { initFirebaseAdmin } = require('../lib/firebaseAdmin');
const mailer = require('../lib/mailer');
const { emailOk } = require('../lib/accountRules');

// service account JSON/file, or Application Default Credentials on Cloud Run
// (src/lib/firebaseAdmin.js)
initFirebaseAdmin();

// Creates the users/profiles rows on a brand-new Firebase uid's first request.
// Safe to call on every request — ON CONFLICT DO NOTHING makes it a no-op after the first time.
async function ensureProfile(uid, email, name) {
  const { rowCount } = await pool.query(
    `INSERT INTO users (id, email, password, name) VALUES ($1, $2, 'firebase', $3)
     ON CONFLICT (id) DO NOTHING`,
    [uid, email || `${uid}@firebase.local`, name || 'Athlete']
  );
  await pool.query('INSERT INTO profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [uid]);
  // the row was new: say welcome (never blocks or fails the request)
  if (rowCount) {
    mailer.send(email, mailer.welcomeEmail(name, uid), uid)
      .catch((err) => console.error('welcome email failed:', err.message));
  }
}

module.exports = async function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const idToken = header.slice(7);
  try {
    const decoded = await getAuth().verifyIdToken(idToken);
    // (lib/accountRules.js: email/password accounts once confirmed)
    if (!emailOk(decoded)) return res.status(403).json({ error: 'email_not_verified', message: 'Verify your email address first' });
    req.user = { id: decoded.uid, email: decoded.email };
    await ensureProfile(decoded.uid, decoded.email, decoded.name);
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};
