// routes/challenges.js against spare-account farming: one open challenge a
// pair held by the unique index (two sent at once: the second is 409), stakes
// refused for a new account or one with no live logs, and a race's start
// taken from the higher of the total and its peak. Against a stand-in for
// Postgres, a stub auth, push and Firestore. `npm test`.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');
const express = require('express');

const DAY = 864e5;
const ID = (c) => c.repeat(32);
const USERS = {
  sam: { public_id: ID('a'), created_at: new Date(Date.now() - 60 * DAY) },
  mo: { public_id: ID('b'), created_at: new Date(Date.now() - 60 * DAY) },
};
const state = { uniqueClash: false, sql: [], logs: {} };
const q = (sql) => sql.replace(/\s+/g, ' ').trim();
async function query(sqlIn, p = []) {
  const sql = q(sqlIn);
  state.sql.push(sql);
  if (sql.startsWith("UPDATE challenges SET status = 'expired'")) return { rows: [], rowCount: 0 };
  if (sql.startsWith('SELECT p.user_id, p.leaderboard_hidden')) {
    const uid = Object.keys(USERS).find((k) => USERS[k].public_id === p[0]);
    return { rows: uid ? [{ user_id: uid, leaderboard_hidden: false, created_at: USERS[uid].created_at }] : [] };
  }
  if (sql.startsWith('SELECT created_at FROM users')) return { rows: [{ created_at: USERS[p[0]].created_at }] };
  if (sql.startsWith('SELECT 1 FROM blocks')) return { rows: [], rowCount: 0 };
  if (sql.includes('FROM friends')) return { rows: [{ friends: true, pa: 0, pb: 0 }] };
  if (sql.startsWith('SELECT collection, data FROM user_sync')) {
    return { rows: [{ collection: 'history', data: { items: state.logs[p[0]] || [] } }] };
  }
  if (sql.includes('AS p FROM profiles')) return { rows: [{ p: 1000 }] };
  if (sql.startsWith('SELECT COUNT(*) FILTER')) return { rows: [{ sent: 0, pair: 0 }] };   // (the check passes: both sent at once)
  if (sql.startsWith('INSERT INTO challenges')) {
    if (state.uniqueClash) { const e = new Error('duplicate key value violates unique constraint "challenges_open_pair"'); e.code = '23505'; throw e; }
    return { rows: [{ id: ID('c') }] };
  }
  if (sql.startsWith('SELECT stake, status, created_at FROM challenges')) {
    return { rows: [{ stake: 50, status: 'pending', created_at: new Date() }] };
  }
  if (sql.startsWith("UPDATE challenges c SET status = 'accepted'")) return { rowCount: 1, rows: [] };
  if (sql.startsWith('SELECT from_user FROM challenges')) return { rows: [{ from_user: 'sam' }] };
  if (sql.startsWith('SELECT u.name, p.public_id FROM users u')) return { rows: [{ name: 'X', public_id: ID('a') }] };
  throw new Error(`fake pool: unexpected SQL ${sql}`);
}
function stub(rel, exports) {
  const file = require.resolve(path.join(__dirname, rel));
  const m = new Module(file); m.filename = file; m.loaded = true; m.exports = exports;
  require.cache[file] = m;
}
stub('../src/db', { query, connect: async () => ({ query, release() {} }) });
stub('../src/middleware/auth', (req, res, next) => { req.user = { id: req.headers['x-test-user'] }; next(); });
stub('../src/lib/push', { notifyUser: () => {} });
const challenges = require('../src/routes/challenges');

let server, base;
before(async () => {
  const app = express();
  app.use('/challenges', express.json(), challenges);
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((r) => server.close(r)));
const live = (n) => Array.from({ length: n }, (_, i) => ({ id: `w${i}`, ts: Date.now() - (i + 1) * 3600e3 }));
beforeEach(() => {
  state.uniqueClash = false; state.sql = [];
  state.logs = { sam: live(3), mo: live(3) };
  USERS.sam.created_at = new Date(Date.now() - 60 * DAY);
});
const call = async (who, method, url, body) => {
  const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', 'x-test-user': who }, body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};

test('two challenges sent at once: the unique index lets one in, the other is told "already"', async () => {
  assert.equal((await call('sam', 'POST', '/challenges', { to: USERS.mo.public_id })).status, 201);
  state.uniqueClash = true;
  const r = await call('sam', 'POST', '/challenges', { to: USERS.mo.public_id });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'already');
});

test('a stake: refused for an account under a week old, or without 3 live logs in 2 weeks', async () => {
  assert.equal((await call('sam', 'POST', '/challenges', { to: USERS.mo.public_id, stake: 50 })).status, 201);
  USERS.sam.created_at = new Date(Date.now() - 5 * DAY);
  const young = await call('sam', 'POST', '/challenges', { to: USERS.mo.public_id, stake: 50 });
  assert.equal(young.status, 403);
  assert.equal(young.body.error, 'new');
  USERS.sam.created_at = new Date(Date.now() - 60 * DAY);
  state.logs.mo = live(5).map((h) => ({ ...h, imported: true }));
  assert.equal((await call('sam', 'POST', '/challenges', { to: USERS.mo.public_id, stake: 50 })).status, 403);
  // accepting one is held to the same rule
  state.logs.mo = live(2);
  assert.equal((await call('mo', 'POST', `/challenges/${ID('c')}/respond`, { accept: true })).status, 403);
  state.logs.mo = live(3);
  assert.equal((await call('mo', 'POST', `/challenges/${ID('c')}/respond`, { accept: true })).status, 200);
});

test('a race starts from the higher of each total and its peak', async () => {
  await call('mo', 'POST', `/challenges/${ID('c')}/respond`, { accept: true });
  const sql = state.sql.find((s) => s.startsWith("UPDATE challenges c SET status = 'accepted'"));
  assert.match(sql, /from_start = COALESCE\(\(SELECT GREATEST\(COALESCE\(points, 0\), COALESCE\(points_peak, 0\)\) FROM profiles WHERE user_id = c\.from_user\), 0\)/);
  assert.match(sql, /to_start = COALESCE\(\(SELECT GREATEST\(COALESCE\(points, 0\), COALESCE\(points_peak, 0\)\)/);
});

test('the migration holds one open challenge a pair', () => {
  const src = require('fs').readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /CREATE UNIQUE INDEX IF NOT EXISTS challenges_open_pair ON challenges \(LEAST\(from_user, to_user\), GREATEST\(from_user, to_user\)\)\s+WHERE status IN \('pending', 'accepted'\)/);
  assert.match(src, /ADD COLUMN IF NOT EXISTS points_peak INTEGER/);
});
