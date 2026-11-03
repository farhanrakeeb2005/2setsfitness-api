// Challenge requests expire CHALLENGE_REQUEST_TTL_H hours after they're sent
// (routes/challenges.js, lib/challengeRules.js): on read, an answer to an
// expired one is refused (410), the sender is told once, no points move, and
// an expired request doesn't block a new one. Against an in-memory stand-in
// for Postgres, a stub auth and a stub push: no database, no Firebase.
// `npm test`.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');
const express = require('express');
const R = require('../src/lib/challengeRules');

const HOUR = 3600 * 1000;
const ID = (c) => c.repeat(32);
const USERS = {
  sam: { name: 'Sam', public_id: ID('a'), challenge_pts: 40 },
  mo: { name: 'Mo', public_id: ID('b'), challenge_pts: 10 },
};

// the challenges table and what the route asks of it
const db = { rows: [], seq: 0 };
const pushes = [];
const q = (sql) => sql.replace(/\s+/g, ' ').trim();
const ago = (h) => new Date(Date.now() - h * HOUR);
async function query(sqlIn, p = []) {
  const sql = q(sqlIn);
  const byId = (id) => db.rows.find((r) => r.id === id);
  if (sql.startsWith("UPDATE challenges SET status = 'expired'")) {
    const ttl = Number(p[0]);
    const out = db.rows.filter((r) => r.status === 'pending' && r.created_at.getTime() <= Date.now() - ttl * HOUR
      && (!p[1] || p[1].includes(r.from_user) || p[1].includes(r.to_user)));
    out.forEach((r) => { r.status = 'expired'; });
    return { rows: out.map(({ id, from_user, to_user }) => ({ id, from_user, to_user })), rowCount: out.length };
  }
  if (sql.startsWith('SELECT c.*, fp.points AS from_now')) return { rows: [] };   // no running races here
  if (sql.startsWith('SELECT c.id, c.status, c.created_at')) {
    const [me, withExpired, shownH] = p;
    const rows = db.rows.filter((r) => (r.from_user === me || r.to_user === me)
      && (['pending', 'accepted'].includes(r.status)
        || (withExpired && r.status === 'expired' && r.from_user === me && r.created_at.getTime() > Date.now() - shownH * HOUR)))
      .map((r) => {
        const opp = USERS[r.from_user === me ? r.to_user : r.from_user];
        return { ...r, sent: r.from_user === me, opp_name: opp.name, opp_id: opp.public_id, from_now: 0, to_now: 0 };
      });
    return { rows };
  }
  if (sql.startsWith('SELECT COALESCE(challenge_pts, 0) AS n')) return { rows: [{ n: USERS[p[0]].challenge_pts }] };
  if (sql.includes('op.public_id AS opp')) return { rows: [] };
  if (sql.includes("FROM challenges c WHERE c.status = 'done'")) return { rows: [{ won: 0, drawn: 0, lost: 0 }] };
  if (sql.startsWith('SELECT stake, status, created_at FROM challenges')) {
    const r = byId(p[0]);
    return { rows: r && r.to_user === p[1] && ['pending', 'expired'].includes(r.status) ? [r] : [] };
  }
  if (sql.startsWith("UPDATE challenges c SET status = 'accepted'")) {
    const r = byId(p[0]);
    if (!r || r.to_user !== p[1] || r.status !== 'pending' || r.created_at.getTime() <= Date.now() - Number(p[2]) * HOUR) return { rowCount: 0, rows: [] };
    r.status = 'accepted'; r.starts_at = new Date(); r.ends_at = new Date(Date.now() + r.days * 24 * HOUR);
    return { rowCount: 1, rows: [] };
  }
  if (sql.startsWith("UPDATE challenges SET status = 'declined'")) {
    const r = byId(p[0]);
    if (!r || r.to_user !== p[1] || r.status !== 'pending') return { rowCount: 0, rows: [] };
    r.status = 'declined';
    return { rowCount: 1, rows: [] };
  }
  if (sql.startsWith('SELECT from_user FROM challenges')) return { rows: [byId(p[0])].filter(Boolean) };
  if (sql.startsWith('SELECT u.name, p.public_id FROM users u')) return { rows: USERS[p[0]] ? [USERS[p[0]]] : [] };
  // sending one
  if (sql.startsWith('SELECT p.user_id, p.leaderboard_hidden')) {
    const uid = Object.keys(USERS).find((k) => USERS[k].public_id === p[0]);
    return { rows: uid ? [{ user_id: uid, leaderboard_hidden: false, created_at: ago(24 * 30) }] : [] };
  }
  if (sql.startsWith('SELECT 1 FROM blocks')) return { rows: [], rowCount: 0 };
  if (sql.includes('FROM friends')) return { rows: [{ friends: true, pa: 0, pb: 0 }] };
  if (sql.startsWith('SELECT COUNT(*) FILTER')) {
    const [a, b] = p;
    const open = db.rows.filter((r) => ['pending', 'accepted'].includes(r.status) && (r.from_user === a || r.to_user === a));
    return { rows: [{ sent: open.filter((r) => r.from_user === a).length,
      pair: open.filter((r) => (r.from_user === a && r.to_user === b) || (r.from_user === b && r.to_user === a)).length }] };
  }
  if (sql.startsWith('INSERT INTO challenges')) {
    const r = add({ from_user: p[0], to_user: p[1], kind: p[2], days: p[3], stake: p[4] });
    return { rows: [{ id: r.id }] };
  }
  throw new Error(`fake pool: unexpected SQL ${sql}`);
}
function add(r) {
  const row = { id: (++db.seq).toString(16).padStart(32, '0'), status: 'pending', created_at: new Date(), kind: 'points', days: 7, stake: 0, ...r };
  db.rows.push(row);
  return row;
}

// the route's db, auth and push, stood in for before it loads
function stub(rel, exports) {
  const file = require.resolve(path.join(__dirname, rel));
  const m = new Module(file); m.filename = file; m.loaded = true; m.exports = exports;
  require.cache[file] = m;
}
stub('../src/db', { query, connect: async () => ({ query, release() {} }) });
stub('../src/middleware/auth', (req, res, next) => {
  const who = req.headers['x-test-user'];
  if (!who) return res.status(401).json({ error: 'No token provided' });
  req.user = { id: who };
  next();
});
stub('../src/lib/push', { notifyUser: (userId, kind, opts) => { pushes.push({ userId, kind, ...opts }); } });
const challenges = require('../src/routes/challenges');

let server, base;
before(async () => {
  const app = express();
  app.use('/challenges', express.json(), challenges);
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((r) => server.close(r)));
beforeEach(() => { db.rows = []; pushes.length = 0; USERS.sam.challenge_pts = 40; USERS.mo.challenge_pts = 10; });

const call = async (who, method, url, body) => {
  const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', 'x-test-user': who }, body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const tick = () => new Promise((r) => setTimeout(r, 20));

test('the rule: a request expires 12 hours after it is sent', () => {
  assert.equal(R.CHALLENGE_REQUEST_TTL_H, 12);
  const sent = new Date('2026-11-03T08:00:00Z');
  assert.equal(R.requestExpiresAt(sent).toISOString(), '2026-11-03T20:00:00.000Z');
  assert.equal(R.requestExpiresAt('nope'), null);
  const at = (h) => sent.getTime() + h * HOUR;
  assert.equal(R.requestExpired({ status: 'pending', created_at: sent }, at(11.99)), false);
  assert.equal(R.requestExpired({ status: 'pending', created_at: sent }, at(12)), true);
  assert.equal(R.requestExpired({ status: 'pending', createdAt: sent.toISOString() }, at(13)), true);
  assert.equal(R.requestExpired({ status: 'expired', created_at: sent }, at(1)), true);
  // only a request: a running or finished race never expires this way
  assert.equal(R.requestExpired({ status: 'accepted', created_at: sent }, at(100)), false);
  assert.equal(R.requestExpired(null), false);
});

test('on read: a pending request past its time is expired, gone from the lists, the sender told once', async () => {
  const fresh = add({ from_user: 'sam', to_user: 'mo', created_at: ago(1) });
  const old = add({ from_user: 'sam', to_user: 'mo', created_at: ago(13), stake: 50 });
  // the challenged player's list: only the fresh one, with when it expires
  const mo = await call('mo', 'GET', '/challenges');
  assert.equal(mo.status, 200);
  assert.deepEqual(mo.body.challenges.map((c) => c.id), [fresh.id]);
  assert.equal(mo.body.challenges[0].status, 'pending');
  assert.equal(new Date(mo.body.challenges[0].expiresAt).getTime(), fresh.created_at.getTime() + 12 * HOUR);
  assert.equal(old.status, 'expired');
  await tick();
  assert.deepEqual(pushes.map((x) => [x.userId, x.kind, x.name, x.data.challengeId]), [['sam', 'expired', 'Mo', old.id]]);
  // the sender: an older app never sees it; one that asks sees it as expired
  const plain = await call('sam', 'GET', '/challenges');
  assert.deepEqual(plain.body.challenges.map((c) => c.id), [fresh.id]);
  const asked = await call('sam', 'GET', '/challenges?expired=1');
  const ex = asked.body.challenges.find((c) => c.id === old.id);
  assert.equal(ex.status, 'expired');
  assert.equal(ex.direction, 'sent');
  assert.equal(ex.opponent.name, 'Mo');
  // (the receiver never gets it, asked or not)
  assert.ok(!(await call('mo', 'GET', '/challenges?expired=1')).body.challenges.some((c) => c.id === old.id));
  // told once: reading again doesn't tell again
  await tick();
  assert.equal(pushes.length, 1);
});

test('answering an expired request: refused with a clear error, nothing changes', async () => {
  const old = add({ from_user: 'sam', to_user: 'mo', created_at: ago(12.5), stake: 25 });
  const r = await call('mo', 'POST', `/challenges/${old.id}/respond`, { accept: true });
  assert.equal(r.status, 410);
  assert.equal(r.body.error, 'expired');
  assert.match(r.body.message, /12 hours/);
  assert.equal(old.status, 'expired');
  assert.equal(old.starts_at, undefined);
  // declining it now: the same answer
  const d = await call('mo', 'POST', `/challenges/${old.id}/respond`, { accept: false });
  assert.equal(d.status, 410);
  assert.equal(old.status, 'expired');
  // the sender was told; nobody heard "accepted"
  await tick();
  assert.deepEqual(pushes.map((x) => x.kind), ['expired']);
});

test('points: nothing is held while a request waits, so an expired one leaves both players\' points as they were', async () => {
  add({ from_user: 'sam', to_user: 'mo', created_at: ago(20), stake: 100 });
  const before = [USERS.sam.challenge_pts, USERS.mo.challenge_pts];
  const r = await call('sam', 'GET', '/challenges?expired=1');
  assert.equal(r.body.challengePoints, before[0]);
  assert.equal(r.body.challenges[0].moved, 0);
  assert.deepEqual([USERS.sam.challenge_pts, USERS.mo.challenge_pts], before);
});

test('a request still in time is answered as before', async () => {
  const c = add({ from_user: 'sam', to_user: 'mo', created_at: ago(11.5) });
  const r = await call('mo', 'POST', `/challenges/${c.id}/respond`, { accept: true });
  assert.equal(r.status, 200);
  assert.equal(c.status, 'accepted');
  await tick();
  assert.deepEqual(pushes.map((x) => [x.userId, x.kind]), [['sam', 'accepted']]);
});

test('an expired request doesn\'t block a new challenge to the same player', async () => {
  add({ from_user: 'sam', to_user: 'mo', created_at: ago(30) });
  const r = await call('sam', 'POST', '/challenges', { to: USERS.mo.public_id });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(db.rows.filter((x) => x.status === 'pending').length, 1);
  // while a request is still waiting, a second one is refused as before
  const again = await call('sam', 'POST', '/challenges', { to: USERS.mo.public_id });
  assert.equal(again.status, 409);
});

test('the every-few-minutes job expires everyone\'s old requests', async () => {
  const a = add({ from_user: 'sam', to_user: 'mo', created_at: ago(13) });
  const b = add({ from_user: 'mo', to_user: 'sam', created_at: ago(2) });
  await challenges.settleDue();
  assert.equal(a.status, 'expired');
  assert.equal(b.status, 'pending');
  await tick();
  assert.deepEqual(pushes.map((x) => [x.userId, x.kind]), [['sam', 'expired']]);
});
