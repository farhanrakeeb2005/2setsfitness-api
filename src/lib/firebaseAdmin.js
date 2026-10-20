// How firebase-admin is started. The API only verifies Firebase ID tokens,
// which needs the Firebase project id and no secret at all; a service
// account is accepted but not required. In order:
//  1. FIREBASE_SERVICE_ACCOUNT_JSON — the key file's JSON (raw or base64),
//     e.g. from Secret Manager;
//  2. FIREBASE_SERVICE_ACCOUNT_PATH, or ./firebase-service-account.json if
//     it exists — local dev, as before;
//  3. Application Default Credentials (Cloud Run's own service account)
//     with the project from FIREBASE_PROJECT_ID (or GOOGLE_CLOUD_PROJECT /
//     GCLOUD_PROJECT). Set FIREBASE_PROJECT_ID when Cloud Run runs in a
//     different Google Cloud project from Firebase.
const fs = require('fs');
const path = require('path');

function parseJsonSecret(value) {
  const text = value.trim();
  if (text.startsWith('{')) return JSON.parse(text);
  return JSON.parse(Buffer.from(text, 'base64').toString('utf8'));
}

/** -> { source, serviceAccount?, projectId? } (no SDK calls, so it can be tested) */
function firebaseCredentialSource(env = process.env, { cwd = process.cwd(), exists = fs.existsSync, readFile = (p) => fs.readFileSync(p, 'utf8') } = {}) {
  const projectId = env.FIREBASE_PROJECT_ID || env.GOOGLE_CLOUD_PROJECT || env.GCLOUD_PROJECT || undefined;
  if (env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return { source: 'json', serviceAccount: parseJsonSecret(env.FIREBASE_SERVICE_ACCOUNT_JSON), projectId };
  }
  const keyPath = path.resolve(cwd, env.FIREBASE_SERVICE_ACCOUNT_PATH || './firebase-service-account.json');
  if (env.FIREBASE_SERVICE_ACCOUNT_PATH || exists(keyPath)) {
    // an explicitly named file that is missing is an error, not a fallback
    return { source: 'file', serviceAccount: JSON.parse(readFile(keyPath)), projectId };
  }
  if (!projectId) {
    throw new Error('Firebase Admin: set FIREBASE_PROJECT_ID (or FIREBASE_SERVICE_ACCOUNT_JSON / FIREBASE_SERVICE_ACCOUNT_PATH)');
  }
  return { source: 'adc', projectId };
}

function initFirebaseAdmin(env = process.env) {
  const { initializeApp, getApps, cert, applicationDefault } = require('firebase-admin/app');
  if (getApps().length) return;
  const c = firebaseCredentialSource(env);
  if (c.source === 'adc') {
    initializeApp({ credential: applicationDefault(), projectId: c.projectId });
  } else {
    initializeApp({ credential: cert(c.serviceAccount), ...(c.projectId ? { projectId: c.projectId } : {}) });
  }
}

module.exports = { firebaseCredentialSource, initFirebaseAdmin };
