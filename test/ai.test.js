// The AI routes' shared text (src/lib/aiText.js) and per-user daily caps
// (src/lib/aiQuota.js), without Anthropic or a database.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { langName, langDirective, splitCoachNote, clean } = require('../src/lib/aiText');
const { aiQuota, limits, overLimit } = require('../src/lib/aiQuota');

test('every app language gets its own reply language', () => {
  for (const code of ['en', 'ar', 'ur', 'es', 'fr', 'pt', 'tr', 'de', 'it', 'nl', 'ru', 'hi', 'ja', 'kr', 'vi', 'th',
    'tl', 'ms', 'id', 'sw', 'bn', 'fa', 'so', 'pl', 'zh-CN']) {
    assert.ok(langName(code), code);
  }
  assert.equal(langName('kr'), 'Korean');
  assert.equal(langName('de-DE'), 'German');          // regional code -> base language
  assert.equal(langName('pt-BR'), 'Brazilian Portuguese');
  assert.equal(langName('xx'), 'English');
  assert.equal(langName(undefined), 'English');
  assert.equal(langDirective('en'), '');
  assert.match(langDirective('ur'), /Reply entirely in Urdu/);
  assert.match(langDirective('ja', { json: true }), /JSON keys .* in English/);
});

test('the app\'s coach note is split off the exercise name', () => {
  const r = splitCoachNote('Leg extension [coach context: set 2 of 3 planned, 1 left. these muscles are already fatigued.]');
  assert.equal(r.name, 'Leg extension');
  assert.equal(r.context, 'set 2 of 3 planned, 1 left. these muscles are already fatigued');
  assert.deepEqual(splitCoachNote('Bench press'), { name: 'Bench press', context: '' });
  assert.equal(clean('  a\n  b  ', 10), 'a b');
});

test('daily caps: all AI calls, and meal scans on their own', () => {
  const lim = limits({ AI_DAILY_LIMIT: '100', AI_SCAN_DAILY_LIMIT: '10' });
  assert.deepEqual(lim, { daily: 100, scan: 10 });
  assert.deepEqual(limits({}), { daily: 150, scan: 30 });
  assert.equal(overLimit({ total: 99, scan: 9 }, lim, 'meal-scan'), null);
  assert.equal(overLimit({ total: 99, scan: 10 }, lim, 'meal-scan'), 'scan');
  assert.equal(overLimit({ total: 99, scan: 10 }, lim, 'coach'), null);
  assert.equal(overLimit({ total: 100, scan: 0 }, lim, 'coach'), 'daily');
});

function fakeRes() {
  return { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
}
test('the middleware logs a call, refuses past the cap, and lets calls through on a database error', async () => {
  const calls = [];
  let count = { total: 0, scan: 0 };
  const pool = { query: async (sql, args) => { calls.push([sql.trim().split(/\s+/)[0], args]); return { rows: [count] }; } };
  let nexted = 0;
  const req = { user: { id: 'u1' } };
  await aiQuota(pool, 'coach')(req, fakeRes(), () => { nexted += 1; });
  assert.equal(nexted, 1);
  assert.deepEqual(calls.map((c) => c[0]), ['SELECT', 'INSERT']);
  assert.deepEqual(calls[1][1], ['u1', 'coach']);

  count = { total: 150, scan: 0 };
  const res = fakeRes();
  await aiQuota(pool, 'coach')(req, res, () => { nexted += 1; });
  assert.equal(res.code, 429);
  assert.equal(res.body.code, 'ai_quota');
  assert.equal(nexted, 1);

  const broken = { query: async () => { throw new Error('db down'); } };
  const orig = console.error; console.error = () => {};
  await aiQuota(broken, 'coach')(req, fakeRes(), () => { nexted += 1; });
  console.error = orig;
  assert.equal(nexted, 2);
});
