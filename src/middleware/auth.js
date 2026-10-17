const fs = require('fs');
const path = require('path');
const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const pool = require('../db');

if (!getApps().length) {
  const keyPath = path.resolve(process.cwd(), process.env.FIREBASE_SERVICE_ACCOUNT_PATH || './firebase-service-account.json');
  const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
  initializeApp({ credential: cert(serviceAccount) });
}

// Creates the users/profiles rows on a brand-new Firebase uid's first request.
// Safe to call on every request — ON CONFLICT DO NOTHING makes it a no-op after the first time.
async function ensureProfile(uid, email, name) {
  await pool.query(
    `INSERT INTO users (id, email, password, name) VALUES ($1, $2, 'firebase', $3)
     ON CONFLICT (id) DO NOTHING`,
    [uid, email || `${uid}@firebase.local`, name || 'Athlete']
  );
  await pool.query('INSERT INTO profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [uid]);
}

module.exports = async function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const idToken = header.slice(7);
  try {
    const decoded = await getAuth().verifyIdToken(idToken);
    req.user = { id: decoded.uid, email: decoded.email };
    await ensureProfile(decoded.uid, decoded.email, decoded.name);
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};
