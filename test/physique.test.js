// POST /ai/physique (src/lib/physique.js): the AI's answer made safe, the
// route with a fake Anthropic call, and its caps (src/lib/aiQuota.js): a
// guest's physique scans counted apart from their chats.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cleanPhysiqueReply, physiqueHandler, aboutLine, PHYSIQUE_GROUPS } = require('../src/lib/physique');
const { request, replyText } = require('../src/lib/aiModel');
const { langDirective } = require('../src/lib/aiText');
const { aiQuota, adviceEndpoint, limits, overLimit, guestOverLimit, kindOf, limitReply } = require('../src/lib/aiQuota');

const lim = limits({});

function fakeRes() {
  return { code: 200, body: null, locals: {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
}
const reqOf = ({ user, guest, headers = {}, body = {}, ip = '1.2.3.4' } = {}) => ({
  user, guest, body, ip, headers,
  get(h) { return headers[h.toLowerCase()]; },
});
function fakePool(counts) {
  const calls = [];
  return {
    calls,
    query: async (sql, args) => {
      const verb = sql.trim().split(/\s+/)[0];
      calls.push({ verb, sql, args });
      if (verb === 'SELECT') return { rows: [typeof counts === 'function' ? counts(sql, args) : counts] };
      if (verb === 'INSERT') return { rows: [{ id: 'row1' }] };
      return { rows: [] };
    },
  };
}

test('a good answer comes through as it is', () => {
  const good = { ok: true, bodyFatLow: 14, bodyFatHigh: 18, score: 62, level: 'intermediate', strengths: ['shoulders', 'arms'], focus: ['chest', 'legs'], note: 'Solid base to build on.' };
  assert.deepEqual(cleanPhysiqueReply(good), good);
});

test('numbers are clamped and always a range', () => {
  const r = cleanPhysiqueReply({ ok: true, bodyFatLow: 30, bodyFatHigh: 20, score: 140, level: 'pro' });
  assert.equal(r.bodyFatLow, 21);           // swapped, then narrowed to 8 points around 25
  assert.equal(r.bodyFatHigh, 29);
  assert.ok(r.bodyFatLow <= r.bodyFatHigh);
  assert.equal(r.score, 100);
  assert.equal(r.level, 'advanced');        // an unknown level: from the score
  const one = cleanPhysiqueReply({ ok: true, bodyFatLow: 15, bodyFatHigh: 15, score: 40 });
  assert.equal(one.bodyFatHigh - one.bodyFatLow, 2);   // never one exact number
  assert.equal(one.level, 'novice');
  const low = cleanPhysiqueReply({ ok: true, bodyFatLow: -5, bodyFatHigh: 1, score: -3 });
  assert.equal(low.bodyFatLow, 3);
  assert.ok(low.bodyFatHigh >= 5);
  assert.equal(low.score, 0);
  const high = cleanPhysiqueReply({ ok: true, bodyFatLow: 80, bodyFatHigh: 90, score: '55' });
  assert.equal(high.bodyFatHigh, 60);
  assert.ok(high.bodyFatHigh - high.bodyFatLow >= 2);
  assert.equal(high.score, 55);
  // numbers missing: can't be read
  assert.deepEqual(cleanPhysiqueReply({ ok: true, bodyFatLow: 'x', bodyFatHigh: 18, score: 50 }), { ok: false, reason: 'unclear' });
  assert.deepEqual(cleanPhysiqueReply({ ok: true, bodyFatLow: 12, bodyFatHigh: 16 }), { ok: false, reason: 'unclear' });
});

test('only known muscle groups, three at most, none in both lists', () => {
  const r = cleanPhysiqueReply({ ok: true, bodyFatLow: 12, bodyFatHigh: 16, score: 50, level: 'novice',
    strengths: ['Shoulders', 'arms', 'arms', 'neck', 'chest', 'back'], focus: ['chest', 'legs', 'face', 7, null] });
  assert.deepEqual(r.strengths, ['shoulders', 'arms', 'chest']);
  assert.deepEqual(r.focus, ['legs']);
  for (const g of [...r.strengths, ...r.focus]) assert.ok(PHYSIQUE_GROUPS.includes(g));
  const none = cleanPhysiqueReply({ ok: true, bodyFatLow: 12, bodyFatHigh: 16, score: 50, strengths: 'arms' });
  assert.deepEqual(none.strengths, []);
  assert.deepEqual(none.focus, []);
});

test('an unkind or long note is dropped or cut', () => {
  const base = { ok: true, bodyFatLow: 12, bodyFatHigh: 16, score: 50, level: 'novice' };
  assert.equal(cleanPhysiqueReply({ ...base, note: 'You look a bit chubby.' }).note, '');
  assert.equal(cleanPhysiqueReply({ ...base, note: 'x'.repeat(500) }).note.length, 200);
  assert.equal(cleanPhysiqueReply({ ...base, note: 123 }).note, '123');
});

test('refusals: a known reason, else unclear', () => {
  for (const reason of ['no_person', 'multiple_people', 'under_16', 'not_suitable', 'unclear']) {
    assert.deepEqual(cleanPhysiqueReply({ ok: false, reason }), { ok: false, reason });
  }
  assert.deepEqual(cleanPhysiqueReply({ ok: false, reason: 'other' }), { ok: false, reason: 'unclear' });
  assert.deepEqual(cleanPhysiqueReply(null), { ok: false, reason: 'unclear' });
  assert.deepEqual(cleanPhysiqueReply('nope'), { ok: false, reason: 'unclear' });
  // only ok: true counts as an answer
  assert.deepEqual(cleanPhysiqueReply({ ok: 'yes', bodyFatLow: 12, bodyFatHigh: 16, score: 50 }), { ok: false, reason: 'unclear' });
});

test('what the user told the app goes in only when believable', () => {
  assert.equal(aboutLine({}), '');
  assert.equal(aboutLine({ sex: 'male', heightCm: 180, weightKg: 80.4 }), '\nThe person told the app: sex: male, height: 180 cm, weight: 80 kg.');
  assert.equal(aboutLine({ sex: 'robot', heightCm: 20, weightKg: 'lots' }), '');
});

const deps = (reply, seen = []) => ({
  create: async (r) => { seen.push(r); if (reply instanceof Error) throw reply; return { content: [{ type: 'text', text: reply }] }; },
  models: () => ({ scan: 'scan-model' }), request, replyText, parseJSON: (t) => JSON.parse(t), langDirective,
});

test('the route: checks the photo, asks the scan model, cleans the answer', async () => {
  const seen = [];
  const h = physiqueHandler(deps('{"ok":true,"bodyFatLow":14,"bodyFatHigh":18,"score":62,"level":"intermediate","strengths":["arms"],"focus":["legs"],"note":"Nice."}', seen));
  let res = fakeRes();
  await h(reqOf({ body: {} }), res);
  assert.equal(res.code, 400);
  res = fakeRes();
  await h(reqOf({ body: { imageBase64: 'x'.repeat(1_400_001) } }), res);
  assert.equal(res.code, 413);
  res = fakeRes();
  await h(reqOf({ body: { imageBase64: 'abc', mimeType: 'image/gif' } }), res);
  assert.equal(res.code, 400);
  assert.equal(seen.length, 0);

  res = fakeRes();
  await h(reqOf({ body: { imageBase64: 'abc', lang: 'en' } }), res);
  assert.equal(res.code, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.score, 62);
  assert.equal(seen[0].model, 'scan-model');
  assert.equal(seen[0].messages[0].content[0].source.data, 'abc');
});

test('the route: a failed AI call is refunded and never logs the photo', async () => {
  const logged = [];
  const orig = console.error; console.error = (...a) => logged.push(a.join(' '));
  let refunded = 0;
  const res = fakeRes();
  res.locals.aiRefund = () => { refunded += 1; };
  await physiqueHandler(deps(new Error('boom')))(reqOf({ body: { imageBase64: 'SECRETPHOTO' } }), res);
  console.error = orig;
  assert.equal(res.code, 500);
  assert.equal(refunded, 1);
  assert.ok(!logged.join(' ').includes('SECRETPHOTO'));
});

test('the route: a photo that needs retaking gives a guest another go; under 16 doesn\'t', async () => {
  for (const [reason, retries] of [['no_person', 1], ['unclear', 1], ['multiple_people', 1], ['under_16', 0], ['not_suitable', 0]]) {
    let n = 0;
    const res = fakeRes();
    res.locals.aiRetry = () => { n += 1; };
    await physiqueHandler(deps(JSON.stringify({ ok: false, reason })))(reqOf({ body: { imageBase64: 'abc' } }), res);
    assert.deepEqual(res.body, { ok: false, reason });
    assert.equal(n, retries, reason);
  }
});

test('caps: physique is its own kind, 3 a day on an account', () => {
  assert.equal(kindOf('physique'), 'physique');
  assert.equal(overLimit({ physique: 2 }, lim, 'physique'), null);
  assert.equal(overLimit({ physique: 3 }, lim, 'physique'), 'physique');
  // chats used up: a scan still works, and scans never use up the chat
  assert.equal(overLimit({ chat: 10, chat24: 20 }, lim, 'physique'), null);
  assert.equal(overLimit({ physique: 3 }, lim, 'chat'), null);
  assert.equal(overLimit({ total: 150 }, lim, 'physique'), 'daily');
  assert.equal(limitReply('physique', {}, lim, new Date(0)).code, 'ai_physique_quota');
  assert.equal(overLimit({ physique: 3 }, limits({ AI_PHYSIQUE_DAILY_LIMIT: '5' }), 'physique'), null);
});

test('guests: 1 physique scan per install, 3 per IP, 200 from everyone; chats apart', () => {
  assert.equal(guestOverLimit({ install: 0, ip: 0, everyone: 0 }, lim, 'physique'), null);
  assert.equal(guestOverLimit({ install: 1 }, lim, 'physique'), 'install');
  assert.equal(guestOverLimit({ install: 0, ip: 3 }, lim, 'physique'), 'ip');
  assert.equal(guestOverLimit({ install: 0, ip: 0, everyone: 200 }, lim, 'physique'), 'busy');
  // the chat's own numbers are unchanged
  assert.equal(guestOverLimit({ install: 1, ip: 5, everyone: 299 }, lim, 'chat'), null);
  assert.equal(guestOverLimit({ install: 1, ip: 5, everyone: 299 }, lim), null);
  const env = limits({ AI_GUEST_PHYSIQUE: '2', AI_GUEST_PHYSIQUE_IP_DAILY: '5', AI_GUEST_PHYSIQUE_DAILY_TOTAL: '10' });
  assert.equal(guestOverLimit({ install: 1, ip: 4, everyone: 9 }, env, 'physique'), null);
  assert.equal(guestOverLimit({ install: 0, ip: 0, everyone: 10 }, env, 'physique'), 'busy');
});

test('a guest\'s scan and chats are counted and logged apart', async () => {
  const guest = { installId: 'abcdefghijklmnop1234' };
  // the database: this install has used its 2 chats, no scan yet
  const pool = fakePool((sql, args) => (args[2].includes('physique') ? { install: 0, ip: 0, everyone: 0 } : { install: 2, ip: 2, everyone: 2 }));
  let res = fakeRes();
  let nexted = 0;
  await aiQuota(pool, 'physique', { env: {} })(reqOf({ guest }), res, () => { nexted += 1; });
  assert.equal(nexted, 1);
  const sel = pool.calls.find((c) => c.verb === 'SELECT');
  assert.deepEqual(sel.args.slice(2), [['physique'], ['physique', 'physique-retry']]);
  const ins = pool.calls.find((c) => c.verb === 'INSERT');
  assert.equal(ins.args[2], 'physique');
  assert.deepEqual(res.locals.aiUsage, { used: 1, limit: 1, left: 0, guest: true });
  // a photo to retake: the row is marked, not deleted (the IP still counts it)
  res.locals.aiRetry();
  const upd = pool.calls.find((c) => c.verb === 'UPDATE');
  assert.match(upd.sql, /physique-retry/);
  assert.deepEqual(upd.args, ['row1']);

  // the chats are still used up
  res = fakeRes();
  nexted = 0;
  await aiQuota(pool, adviceEndpoint, { env: {} })(reqOf({ guest, body: { kind: 'chat' } }), res, () => { nexted += 1; });
  assert.equal(nexted, 0);
  assert.equal(res.code, 401);
  assert.deepEqual(res.body, { error: 'sign_in_required', limit: 2, used: 2 });
  const chatSel = pool.calls.filter((c) => c.verb === 'SELECT').pop();
  assert.deepEqual(chatSel.args.slice(2), [['chat'], ['chat']]);

  // the scan used: sign in
  const used = fakePool({ install: 1, ip: 1, everyone: 1 });
  res = fakeRes();
  nexted = 0;
  await aiQuota(used, 'physique', { env: {} })(reqOf({ guest }), res, () => { nexted += 1; });
  assert.equal(nexted, 0);
  assert.deepEqual(res.body, { error: 'sign_in_required', limit: 1, used: 1 });

  // other AI tools: still sign in
  res = fakeRes();
  await aiQuota(fakePool({}), 'meal-scan', { env: {} })(reqOf({ guest }), res, () => { nexted += 1; });
  assert.equal(res.code, 401);
  assert.equal(nexted, 0);
});

test('an account\'s scan: logged as physique, no retry', async () => {
  const pool = fakePool({ total: 1, physique: 1 });
  const res = fakeRes();
  let nexted = 0;
  await aiQuota(pool, 'physique', { env: {} })(reqOf({ user: { id: 'u1' } }), res, () => { nexted += 1; });
  assert.equal(nexted, 1);
  assert.deepEqual(pool.calls.find((c) => c.verb === 'INSERT').args, ['u1', 'physique']);
  res.locals.aiRetry();
  assert.equal(pool.calls.filter((c) => c.verb === 'UPDATE').length, 0);
  const over = fakePool({ total: 3, physique: 3 });
  const res2 = fakeRes();
  await aiQuota(over, 'physique', { env: {} })(reqOf({ user: { id: 'u1' } }), res2, () => {});
  assert.equal(res2.code, 429);
  assert.equal(res2.body.code, 'ai_physique_quota');
});
