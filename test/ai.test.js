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
  assert.deepEqual(calls.slice(0, 2).map((c) => c[0]), ['SELECT', 'INSERT']);   // (now and then a prune follows)
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

test('the AI model and how its reply is read', () => {
  const { DEFAULT_MODEL, models, request, replyText } = require('../src/lib/aiModel');
  assert.deepEqual(models({}), { all: DEFAULT_MODEL, chat: DEFAULT_MODEL });
  assert.deepEqual(models({ AI_CHAT_MODEL: 'claude-sonnet-5-5' }), { all: DEFAULT_MODEL, chat: 'claude-sonnet-5-5' });
  const r = request({ model: 'm', prompt: 'hi', maxTokens: 200 });
  assert.equal(r.output_config.effort, 'low');
  assert.ok(r.max_tokens > 200);                      // room for thinking
  assert.equal(r.temperature, undefined);
  assert.deepEqual(r.messages, [{ role: 'user', content: 'hi' }]);
  // thinking blocks come first; only the text is the answer
  assert.equal(replyText({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: ' Hello ' }] }), 'Hello');
  assert.throws(() => replyText({ stop_reason: 'refusal', content: [] }), /declined/);
  assert.throws(() => replyText({ stop_reason: 'max_tokens', content: [{ type: 'thinking' }] }), /no text/);
});

test('meal notes and typed foods go to the AI as quoted descriptions', () => {
  const { mealNoteDirective, foodTextPrompt } = require('../src/lib/aiText');
  assert.equal(mealNoteDirective(''), '');
  const d = mealNoteDirective('ate 2 "eggs"\n and half the rice');
  assert.match(d, /"ate 2 'eggs' and half the rice"/);
  assert.match(d, /"eaten":true/);
  assert.match(foodTextPrompt('2 boiled eggs'), /"2 boiled eggs"/);
});

test('points are held to what the account age makes believable', () => {
  const { DAILY_POINTS_CAP, pointsCap, cappedPoints } = require('../src/lib/pointsCap');
  const now = Date.parse('2026-10-23T12:00:00Z');
  assert.equal(pointsCap(new Date(now - 1000), now), DAILY_POINTS_CAP);          // made today: one day's worth
  assert.equal(pointsCap(new Date(now - 10 * 864e5), now), 11 * DAILY_POINTS_CAP);
  assert.equal(cappedPoints(579, new Date(now - 864e5), now), 579);               // a real total passes
  assert.equal(cappedPoints(9_999_999, new Date(now - 864e5), now), 2 * DAILY_POINTS_CAP);
  assert.equal(cappedPoints(-5, null, now), 0);
  assert.equal(cappedPoints(500, null, now), 500);                                // no created_at: counts from now
});

test('App Check: monitor lets requests through, enforce refuses bad ones', async () => {
  const { appCheckGuard, appCheckMode } = require('../src/middleware/appCheck');
  assert.equal(appCheckMode({}), 'monitor');
  assert.equal(appCheckMode({ APP_CHECK: 'ENFORCE' }), 'enforce');
  assert.equal(appCheckMode({ APP_CHECK: 'nonsense' }), 'monitor');
  const verify = async (t) => { if (t !== 'good') throw new Error('bad'); };
  const run = async (guard, token, path = '/points') => {
    let passed = false, status = null;
    const req = { path, get: (h) => (h === 'X-Firebase-AppCheck' ? token : undefined) };
    const res = { status(s) { status = s; return this; }, json() { return this; } };
    await guard(req, res, () => { passed = true; });
    return { passed, status };
  };
  const quiet = { warn() {} };
  const monitor = appCheckGuard({ env: {}, verify, log: quiet });
  assert.deepEqual(await run(monitor, undefined), { passed: true, status: null });
  assert.deepEqual(await run(monitor, 'forged'), { passed: true, status: null });
  assert.deepEqual(monitor.stats, { ok: 0, missing: 1, invalid: 1 });
  const enforce = appCheckGuard({ env: { APP_CHECK: 'enforce' }, verify, log: quiet });
  assert.deepEqual(await run(enforce, 'good'), { passed: true, status: null });
  assert.deepEqual(await run(enforce, undefined), { passed: false, status: 401 });
  assert.deepEqual(await run(enforce, 'forged'), { passed: false, status: 401 });
  assert.deepEqual(await run(enforce, undefined, '/health'), { passed: true, status: null });
});
