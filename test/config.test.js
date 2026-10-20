// Cloud Run + Neon settings: the Postgres pool config and how firebase-admin
// gets its credentials. No database, no Firebase, no secrets. `npm test`.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { poolConfig } = require('../src/db/config');
const { firebaseCredentialSource } = require('../src/lib/firebaseAdmin');

const NEON = 'postgresql://app:pw@ep-cool-name-123456-pooler.eu-west-2.aws.neon.tech/neondb';

test('Neon: TLS verified, channel binding kept, no sslmode warning, small pool', () => {
  const c = poolConfig({ DATABASE_URL: `${NEON}?sslmode=require&channel_binding=require` });
  assert.equal(c.ssl, true);
  assert.equal(c.enableChannelBinding, true);
  assert.equal(c.connectionString, NEON);
  assert.equal(c.max, 3);
  assert.ok(c.idleTimeoutMillis > 0 && c.connectionTimeoutMillis > 0);
  assert.equal(poolConfig({ DATABASE_URL: NEON }).ssl, true, 'TLS even without sslmode');
  assert.equal(poolConfig({ DATABASE_URL: NEON, PG_POOL_MAX: '5' }).max, 5);
});

test('other hosts: old behaviour kept, explicit sslmode respected, local without TLS', () => {
  const railway = poolConfig({ DATABASE_URL: 'postgresql://u:p@db.example.com:5432/x' });
  assert.deepEqual(railway.ssl, { rejectUnauthorized: false });
  const explicit = poolConfig({ DATABASE_URL: 'postgresql://u:p@db.example.com/x?sslmode=verify-full' });
  assert.equal(explicit.ssl, undefined);
  assert.match(explicit.connectionString, /sslmode=verify-full/);
  assert.equal(poolConfig({ DATABASE_URL: 'postgresql://u:p@localhost/x' }).ssl, false);
  assert.equal(poolConfig({ DATABASE_URL: 'postgresql://u:p@db.example.com/x?sslmode=disable' }).ssl, false);
  const socket = poolConfig({});
  assert.equal(socket.host, '/var/run/postgresql');
  assert.equal(socket.connectionString, undefined);
});

const sa = { type: 'service_account', project_id: 'demo-project', client_email: 'x@demo-project.iam.gserviceaccount.com', private_key: 'k' };
const noFiles = { exists: () => false, readFile: () => { throw new Error('no file'); } };

test('firebase-admin: service account JSON from an env var / secret, raw or base64', () => {
  const raw = firebaseCredentialSource({ FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(sa) }, noFiles);
  assert.equal(raw.source, 'json');
  assert.equal(raw.serviceAccount.project_id, 'demo-project');
  const b64 = firebaseCredentialSource({ FIREBASE_SERVICE_ACCOUNT_JSON: Buffer.from(JSON.stringify(sa)).toString('base64') }, noFiles);
  assert.equal(b64.serviceAccount.client_email, sa.client_email);
});

test('firebase-admin: key file for local dev, as before', () => {
  const files = { cwd: '/app', exists: (p) => p.endsWith('firebase-service-account.json'), readFile: () => JSON.stringify(sa) };
  assert.equal(firebaseCredentialSource({}, files).source, 'file');
  assert.equal(firebaseCredentialSource({ FIREBASE_SERVICE_ACCOUNT_PATH: './k.json' }, { ...files, exists: () => false }).source, 'file');
  assert.throws(() => firebaseCredentialSource({ FIREBASE_SERVICE_ACCOUNT_PATH: './missing.json' }, noFiles), /no file/);
});

test('firebase-admin: Application Default Credentials with an explicit project id', () => {
  const c = firebaseCredentialSource({ FIREBASE_PROJECT_ID: 'fitness-app' }, noFiles);
  assert.deepEqual(c, { source: 'adc', projectId: 'fitness-app' });
  assert.equal(firebaseCredentialSource({ GOOGLE_CLOUD_PROJECT: 'gcp' }, noFiles).projectId, 'gcp');
  assert.throws(() => firebaseCredentialSource({}, noFiles), /FIREBASE_PROJECT_ID/);
});
