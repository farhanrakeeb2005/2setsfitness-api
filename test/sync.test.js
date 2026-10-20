// /sync against an in-memory stand-in for Postgres and a stub auth: no
// database, no Firebase, no secrets. `npm test`.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createSyncRouter, validateDoc, LIMITS } = require('../src/routes/sync');
const { mergeCollection } = require('../src/lib/syncMerge');

// Enough of pg's Pool for routes/sync.js: rows keyed user|collection, data
// stored as JSON text like JSONB (so the route gets fresh objects back).
function fakePool() {
  const rows = new Map();
  const clock = { t: 1_000_000 };
  const query = async (sql, params = []) => {
    const q = sql.replace(/\s+/g, ' ').trim();
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(q)) return { rows: [] };
    if (q.includes('clock_timestamp()')) return { rows: [{ now_ms: String(++clock.t) }] };
    const [uid, name] = params;
    const k = `${uid}|${name}`;
    if (q.startsWith('SELECT collection, data FROM user_sync')) {
      const out = [];
      for (const [key, r] of rows) {
        const [u, c] = key.split('|');
        if (u === uid && r.updated > Number(params[1])) out.push({ collection: c, data: JSON.parse(r.data) });
      }
      return { rows: out };
    }
    if (q.startsWith('INSERT INTO user_sync')) {
      if (!rows.has(k)) rows.set(k, { data: 'null', updated: ++clock.t });
      return { rows: [] };
    }
    if (q.startsWith('SELECT data FROM user_sync')) {
      return { rows: rows.has(k) ? [{ data: JSON.parse(rows.get(k).data) }] : [] };
    }
    if (q.startsWith('UPDATE user_sync SET data')) {
      rows.set(k, { data: params[2], updated: ++clock.t });
      return { rows: [] };
    }
    if (q.startsWith('DELETE FROM user_sync')) {
      for (const key of [...rows.keys()]) if (key.startsWith(`${uid}|`)) rows.delete(key);
      return { rows: [] };
    }
    throw new Error(`fake pool: unexpected SQL ${q}`);
  };
  return { rows, query, connect: async () => ({ query, release() {} }) };
}

// stands in for middleware/auth.js: the test says who it is
const stubAuth = (req, res, next) => {
  const who = req.headers['x-test-user'];
  if (!who) return res.status(401).json({ error: 'No token provided' });
  req.user = { id: who };
  next();
};

let server, base, pool;
before(async () => {
  pool = fakePool();
  const app = express();
  app.use('/sync', express.json({ limit: '5mb' }), createSyncRouter({ pool, auth: stubAuth }));
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function call(method, path, user, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(user ? { 'x-test-user': user } : {}) },
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

const history = (...items) => ({ items, tombstones: {} });

test('needs a signed-in user', async () => {
  assert.equal((await call('GET', '/sync')).status, 401);
  assert.equal((await call('PUT', '/sync', null, { collections: {} })).status, 401);
});

test('PUT merges into the stored copy: a phone with less data cannot wipe it', async () => {
  const one = await call('PUT', '/sync', 'u1', { collections: { history: history({ id: 'a', ts: 2 }, { id: 'b', ts: 1 }) } });
  assert.equal(one.status, 200);
  assert.deepEqual(one.data.collections.history.items.map((x) => x.id), ['a', 'b']);
  // a second phone that only has 'c'
  const two = await call('PUT', '/sync', 'u1', { collections: { history: history({ id: 'c', ts: 3 }) } });
  assert.deepEqual(two.data.collections.history.items.map((x) => x.id), ['c', 'a', 'b']);
  // and an empty list changes nothing
  const three = await call('PUT', '/sync', 'u1', { collections: { history: history() } });
  assert.equal(three.data.collections.history.items.length, 3);
  assert.ok(Number.isFinite(three.data.serverTime));
});

test('GET returns the user\'s collections, only those changed since `since`', async () => {
  const first = await call('GET', '/sync?since=0', 'u2');
  assert.deepEqual(first.data.collections, {});
  const t0 = first.data.serverTime;
  await call('PUT', '/sync', 'u2', {
    collections: {
      routines: { items: [{ id: 'u1', name: 'My 11', exercises: Array.from({ length: 11 }, (_, i) => `Ex ${i}`) }], tombstones: {} },
      schedule: { data: { 1: { rest: false, items: [] } }, updatedAt: 5 },
    },
  });
  const all = await call('GET', '/sync?since=0', 'u2');
  assert.deepEqual(Object.keys(all.data.collections).sort(), ['routines', 'schedule']);
  assert.equal(all.data.collections.routines.items[0].exercises.length, 11);
  const later = await call('GET', `/sync?since=${all.data.serverTime}`, 'u2');
  assert.deepEqual(later.data.collections, {}, 'nothing new');
  assert.ok(all.data.serverTime > t0);
});

test('each user sees only their own backup', async () => {
  await call('PUT', '/sync', 'alice', { collections: { history: history({ id: 'secret', ts: 1 }) } });
  const bob = await call('GET', '/sync?since=0', 'bob');
  assert.deepEqual(bob.data.collections, {});
  const bobPut = await call('PUT', '/sync', 'bob', { collections: { history: history({ id: 'mine', ts: 1 }) } });
  assert.deepEqual(bobPut.data.collections.history.items.map((x) => x.id), ['mine']);
  const alice = await call('GET', '/sync?since=0', 'alice');
  assert.deepEqual(alice.data.collections.history.items.map((x) => x.id), ['secret']);
});

test('tombstones delete on the server too, and stay', async () => {
  await call('PUT', '/sync', 'u3', { collections: { routines: { items: [{ id: 'x', ts: 1 }, { id: 'y', ts: 1 }], tombstones: {} } } });
  const del = await call('PUT', '/sync', 'u3', { collections: { routines: { items: [{ id: 'y', ts: 1 }], tombstones: { x: 10 } } } });
  assert.deepEqual(del.data.collections.routines.items.map((r) => r.id), ['y']);
  // an old phone still holding x doesn't bring it back
  const old = await call('PUT', '/sync', 'u3', { collections: { routines: { items: [{ id: 'x', ts: 1 }], tombstones: {} } } });
  assert.deepEqual(old.data.collections.routines.items.map((r) => r.id), ['y']);
});

test('bad input is rejected per collection; the rest still saves', async () => {
  const r = await call('PUT', '/sync', 'u4', {
    collections: {
      history: history({ id: 'ok', ts: 1 }),
      nope: { items: [] },
      routines: { items: 'not a list' },
      profile: { data: 'a string', updatedAt: 1 },
      water: { data: { Mon: 'lots' } },
    },
  });
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.data.collections), ['history']);
  assert.deepEqual(Object.keys(r.data.errors).sort(), ['nope', 'profile', 'routines', 'water']);
  assert.equal((await call('PUT', '/sync', 'u4', { nothing: true })).status, 400);
  assert.equal((await call('PUT', '/sync', 'u4', '[1,2]')).status, 400);
});

test('size caps: per collection, and the request body', async () => {
  const big = 'x'.repeat(1000);
  const items = Array.from({ length: Math.ceil(LIMITS.docBytes / 1000) + 10 }, (_, i) => ({ id: `i${i}`, ts: i, note: big }));
  assert.equal(validateDoc('history', { items: items.slice(0, LIMITS.items), tombstones: {} }), 'too large');
  assert.equal(validateDoc('history', { items: Array.from({ length: LIMITS.items + 1 }, (_, i) => ({ id: `i${i}` })) }), 'items must be a list');
  const huge = 'y'.repeat(6 * 1024 * 1024);
  const r = await call('PUT', '/sync', 'u5', { collections: { history: history({ id: 'a', note: huge }) } });
  assert.equal(r.status, 413);
});

test('DELETE removes only the caller\'s backup', async () => {
  await call('PUT', '/sync', 'u6', { collections: { history: history({ id: 'a', ts: 1 }) } });
  await call('PUT', '/sync', 'u7', { collections: { history: history({ id: 'b', ts: 1 }) } });
  assert.equal((await call('DELETE', '/sync', 'u6')).status, 200);
  assert.deepEqual((await call('GET', '/sync?since=0', 'u6')).data.collections, {});
  assert.equal((await call('GET', '/sync?since=0', 'u7')).data.collections.history.items[0].id, 'b');
});

test('the server\'s merge matches the app\'s rules for every kind', () => {
  assert.deepEqual(mergeCollection('prs', { data: { Squat: { weight: 90 } } }, { data: { Squat: { weight: 100 } } }).data, { Squat: { weight: 100 } });
  assert.equal(mergeCollection('profile', { data: { a: 1 }, updatedAt: 2 }, { data: { a: 0, b: 2 }, updatedAt: 1 }).data.b, 2);
  assert.deepEqual(mergeCollection('seededRoutines', { data: ['r1'] }, null).data, ['r1']);
  for (const name of ['history', 'schedule', 'prs', 'water', 'seededRoutines', 'pointsBank']) {
    assert.equal(validateDoc(name, mergeCollection(name, null, null)), null, name);
  }
});
