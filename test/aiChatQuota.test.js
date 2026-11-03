// The coach chat's daily messages (10 a day on an account, 2 for a guest)
// and the logging tools' own caps (src/lib/aiQuota.js), with a fake database.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  aiQuota, optionalAuth, adviceEndpoint, limits, overLimit, guestOverLimit, dayWindow, tzOffset, kindOf,
} = require('../src/lib/aiQuota');

const lim = limits({});

function fakeRes() {
  return { code: 200, body: null, locals: {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
}
const reqOf = ({ user, guest, headers = {}, body = {}, ip = '1.2.3.4' } = {}) => ({
  user, guest, body, ip, headers,
  get(h) { return headers[h.toLowerCase()]; },
});
// a database that answers the count query with `counts` and records every query
function fakePool(counts) {
  const calls = [];
  return {
    calls,
    counts,
    query: async (sql, args) => {
      const verb = sql.trim().split(/\s+/)[0];
      calls.push({ verb, sql, args });
      if (verb === 'SELECT') return { rows: [pool0(counts)] };
      if (verb === 'INSERT') return { rows: [{ id: 'row1' }] };
      return { rows: [] };
    },
  };
}
const pool0 = (c) => (typeof c === 'function' ? c() : c);

test('what counts as a chat message', () => {
  assert.equal(kindOf('chat'), 'chat');
  assert.equal(kindOf('advice'), 'chat');           // rows from before the split
  for (const e of ['meal-scan', 'food-text', 'workout-text']) assert.equal(kindOf(e), 'logging');
  assert.equal(kindOf('meal-take'), 'take');
  for (const e of ['coach', 'plan', 'summary', 'plateau', 'sports-workout']) assert.equal(kindOf(e), 'other');
  assert.equal(adviceEndpoint({ body: { kind: 'chat' } }), 'chat');
  assert.equal(adviceEndpoint({ body: {} }), 'chat');            // older app builds
  assert.equal(adviceEndpoint({ body: { kind: 'meal-take' } }), 'meal-take');
  assert.equal(adviceEndpoint({ body: { kind: 'anything' } }), 'chat');
});

test('the day is the phone\'s: its UTC offset, else UTC', () => {
  assert.equal(tzOffset(undefined), 0);
  assert.equal(tzOffset(''), 0);
  assert.equal(tzOffset('abc'), 0);
  assert.equal(tzOffset('60'), 60);
  assert.equal(tzOffset('-300'), -300);
  assert.equal(tzOffset('99999'), 840);              // clamped to real offsets
  const now = Date.parse('2026-11-03T22:30:00Z');
  assert.deepEqual(dayWindow(0, now), { start: new Date('2026-11-03T00:00:00Z'), resetsAt: new Date('2026-11-04T00:00:00Z') });
  // UTC+2: already 4 Nov 00:30 there
  assert.deepEqual(dayWindow(120, now), { start: new Date('2026-11-03T22:00:00Z'), resetsAt: new Date('2026-11-04T22:00:00Z') });
  // New York (UTC-5): still 3 Nov, 17:30
  assert.deepEqual(dayWindow(-300, now), { start: new Date('2026-11-03T05:00:00Z'), resetsAt: new Date('2026-11-04T05:00:00Z') });
});

test('10 chat messages a day; logging tools never use them up', () => {
  assert.equal(overLimit({ chat: 9 }, lim, 'chat'), null);
  assert.equal(overLimit({ chat: 10 }, lim, 'chat'), 'chat');
  assert.equal(overLimit({ chat: 10 }, lim, 'advice'), 'chat');
  // a made-up offset can't buy more than twice the day's messages in 24 h
  assert.equal(overLimit({ chat: 0, chat24: 20 }, lim, 'chat'), 'chat');
  assert.equal(overLimit({ chat: 0, chat24: 19 }, lim, 'chat'), null);
  // chat used up: logging, the meal take and the rest still work
  for (const e of ['meal-scan', 'food-text', 'workout-text', 'meal-take', 'coach', 'plan']) {
    assert.equal(overLimit({ chat: 10, chat24: 20 }, lim, e), null, e);
  }
  // logging tools: 40 together, meal scans 30 of them; the meal take 30
  assert.equal(overLimit({ logging: 39 }, lim, 'food-text'), null);
  assert.equal(overLimit({ logging: 40 }, lim, 'food-text'), 'logging');
  assert.equal(overLimit({ logging: 40 }, lim, 'workout-text'), 'logging');
  assert.equal(overLimit({ logging: 30, scan: 30 }, lim, 'meal-scan'), 'scan');
  assert.equal(overLimit({ logging: 30, scan: 30 }, lim, 'food-text'), null);
  assert.equal(overLimit({ take: 30 }, lim, 'meal-take'), 'take');
  assert.equal(overLimit({ total: 150 }, lim, 'food-text'), 'daily');
  // env overrides
  assert.equal(overLimit({ chat: 10 }, limits({ AI_CHAT_DAILY_LIMIT: '20' }), 'chat'), null);
});

test('guests: 2 chats per install, a per-IP and an everyone cap', () => {
  assert.equal(guestOverLimit({ install: 1, ip: 1, everyone: 1 }, lim), null);
  assert.equal(guestOverLimit({ install: 2 }, lim), 'install');
  assert.equal(guestOverLimit({ install: 0, ip: 6 }, lim), 'ip');
  assert.equal(guestOverLimit({ install: 0, ip: 0, everyone: 300 }, lim), 'busy');
});

test('the 11th message of the day gets 429 daily_limit with when it resets', async () => {
  const now = () => Date.parse('2026-11-03T10:00:00Z');
  const pool = fakePool({ total: 12, chat: 10, chat24: 10 });
  const res = fakeRes();
  let nexted = 0;
  await aiQuota(pool, adviceEndpoint, { env: {}, now })(reqOf({ user: { id: 'u1' }, headers: { 'x-tz-offset': '60' }, body: { kind: 'chat' } }), res, () => { nexted += 1; });
  assert.equal(nexted, 0);
  assert.equal(res.code, 429);
  assert.deepEqual(res.body, { error: 'daily_limit', code: 'ai_chat_quota', limit: 10, used: 10, resetsAt: '2026-11-03T23:00:00.000Z' });
  assert.equal(pool.calls.length, 1);                 // nothing logged
  // the local day's start went to the database
  assert.equal(pool.calls[0].args[1], '2026-11-02T23:00:00.000Z');
});

test('a message within the limit is logged as chat, with the count for the app and a refund', async () => {
  const pool = fakePool({ total: 3, chat: 7, chat24: 7 });
  const res = fakeRes();
  let nexted = 0;
  await aiQuota(pool, adviceEndpoint, { env: {}, now: () => Date.parse('2026-11-03T10:00:00Z') })(
    reqOf({ user: { id: 'u1' }, body: {} }), res, () => { nexted += 1; });
  assert.equal(nexted, 1);
  const ins = pool.calls.find((c) => c.verb === 'INSERT');
  assert.deepEqual(ins.args, ['u1', 'chat']);
  assert.deepEqual(res.locals.aiUsage, { used: 8, limit: 10, left: 2, resetsAt: '2026-11-04T00:00:00.000Z' });
  res.locals.aiRefund();
  const del = pool.calls.find((c) => c.verb === 'DELETE');
  assert.deepEqual(del.args, ['row1']);

  // a meal take: its own endpoint, no chat count
  const res2 = fakeRes();
  await aiQuota(pool, adviceEndpoint, { env: {} })(reqOf({ user: { id: 'u1' }, body: { kind: 'meal-take' } }), res2, () => {});
  assert.deepEqual(pool.calls.filter((c) => c.verb === 'INSERT').pop().args, ['u1', 'meal-take']);
  assert.equal(res2.locals.aiUsage, undefined);
});

test('guests get 2 chats, then 401 sign_in_required; never the other AI', async () => {
  let install = 0;
  const pool = fakePool(() => ({ install, ip: install, everyone: install }));
  const run = async (body = {}) => {
    const res = fakeRes();
    let nexted = 0;
    await aiQuota(pool, adviceEndpoint, { env: {} })(reqOf({ guest: { installId: 'abcdefghijklmnop1234' }, body }), res, () => { nexted += 1; });
    return { res, nexted };
  };
  let r = await run();
  assert.equal(r.nexted, 1);
  assert.deepEqual(r.res.locals.aiUsage, { used: 1, limit: 2, left: 1, guest: true });
  install = 1;
  r = await run();
  assert.equal(r.nexted, 1);
  assert.equal(r.res.locals.aiUsage.left, 0);
  install = 2;
  r = await run();
  assert.equal(r.nexted, 0);
  assert.equal(r.res.code, 401);
  assert.deepEqual(r.res.body, { error: 'sign_in_required', limit: 2, used: 2 });
  // the IP is only stored hashed
  const ins = pool.calls.find((c) => c.verb === 'INSERT');
  assert.equal(ins.args[0], 'abcdefghijklmnop1234');
  assert.match(ins.args[1], /^[0-9a-f]{32}$/);
  assert.notEqual(ins.args[1], '1.2.3.4');
  // a guest's meal take: sign in
  install = 0;
  r = await run({ kind: 'meal-take' });
  assert.equal(r.res.code, 401);
  // the database down: a guest is refused (signing in still works)
  const broken = { query: async () => { throw new Error('db down'); } };
  const orig = console.error; console.error = () => {};
  const res = fakeRes();
  let nexted = 0;
  await aiQuota(broken, adviceEndpoint, { env: {} })(reqOf({ guest: { installId: 'abcdefghijklmnop1234' } }), res, () => { nexted += 1; });
  console.error = orig;
  assert.equal(nexted, 0);
  assert.equal(res.code, 401);
});

test('POST /ai/advice: a token goes through the token check; else a valid install id makes a guest', () => {
  let authed = 0;
  const mw = optionalAuth((req, res, next) => { authed += 1; next(); });
  let nexted = 0;
  const next = () => { nexted += 1; };
  const withToken = reqOf({ headers: { 'x-install-id': 'abcdefghijklmnop1234' } });
  withToken.headers.authorization = 'Bearer x';
  mw(withToken, fakeRes(), next);
  assert.equal(authed, 1);
  assert.equal(withToken.guest, undefined);

  const guest = reqOf({ headers: { 'x-install-id': 'abcdefghijklmnop1234' } });
  mw(guest, fakeRes(), next);
  assert.deepEqual(guest.guest, { installId: 'abcdefghijklmnop1234' });
  assert.equal(nexted, 2);

  for (const id of [undefined, 'short', 'has spaces in it here!!', 'x'.repeat(65)]) {
    const res = fakeRes();
    mw(reqOf({ headers: id ? { 'x-install-id': id } : {} }), res, next);
    assert.equal(res.code, 401, String(id));
    assert.equal(res.body.error, 'No token provided');
  }
  assert.equal(nexted, 2);
});
