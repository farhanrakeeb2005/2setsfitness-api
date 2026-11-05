// The app's feedback prompt: what's accepted, the email it becomes, and the
// route (stub auth, fake pool and mailer). No SMTP, no database. `npm test`.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { cleanFeedback, feedbackEmail } = require('../src/lib/feedback');
const { createFeedbackRouter } = require('../src/routes/feedback');

const like = { kind: 'like', text: '  Love the coach voice and the boss fights. ', name: '  Sam,  24 ', canQuote: true, appVersion: '1.9.0', lang: 'en' };

test('a like is accepted and tidied', () => {
  const c = cleanFeedback(like);
  assert.equal(c.ok, true);
  assert.equal(c.value.text, 'Love the coach voice and the boss fights.');
  assert.equal(c.value.name, 'Sam, 24');
  assert.equal(c.value.canQuote, true);
  assert.equal(c.value.appVersion, '1.9.0');
});

test('canQuote only when it is exactly true and there is a name', () => {
  assert.equal(cleanFeedback({ ...like, canQuote: 'true' }).value.canQuote, false);
  assert.equal(cleanFeedback({ ...like, canQuote: undefined }).value.canQuote, false);
  assert.equal(cleanFeedback({ ...like, name: '   ' }).value.canQuote, false);
});

test('an improve note is private: canQuote and name are ignored', () => {
  const c = cleanFeedback({ ...like, kind: 'improve', text: 'More stretches please' });
  assert.equal(c.ok, true);
  assert.equal(c.value.canQuote, false);
  assert.equal(c.value.name, null);
});

test('bad input is refused', () => {
  assert.equal(cleanFeedback({ ...like, kind: 'spam' }).ok, false);
  assert.match(cleanFeedback({ ...like, text: 'hi' }).error, /few words/);
  assert.match(cleanFeedback({ ...like, text: 'x'.repeat(501) }).error, /500/);
  assert.match(cleanFeedback({ ...like, name: 'n'.repeat(41) }).error, /long/);
  assert.equal(cleanFeedback({ ...like, text: 'x'.repeat(500) }).ok, true);
  assert.equal(cleanFeedback().ok, false);
});

test('the email: escaped, subject says the kind and consent, no header injection', () => {
  const v = cleanFeedback({ ...like, name: 'Eve\r\nBcc: x@y.z', text: '<img src=x onerror=alert(1)>' }).value;
  const m = feedbackEmail(v, 'uid123');
  assert.ok(!m.html.includes('<img src=x'));
  assert.ok(m.html.includes('&lt;img'));
  assert.ok(m.html.includes('uid123'));
  assert.ok(m.html.includes('1.9.0'));
  assert.equal(m.subject, 'App feedback: \u{1F44D} (can quote)');
  assert.ok(!/[\r\n]/.test(m.subject));
  assert.equal(feedbackEmail({ ...v, canQuote: false }, 'u').subject, 'App feedback: \u{1F44D}');
  const imp = feedbackEmail(cleanFeedback({ kind: 'improve', text: 'Faster sync' }).value, 'u');
  assert.equal(imp.subject, 'App feedback: \u{1F44E}');
  assert.match(imp.html, /never public/);
});

// ── the route ──
const saved = [];
const mailed = [];
let server, base;
before(async () => {
  const pool = { query: async (sql, params) => { saved.push({ sql, params }); return { rows: [] }; } };
  const auth = (req, res, next) => {
    const who = req.headers['x-test-user'];
    if (!who) return res.status(401).json({ error: 'No token provided' });
    req.user = { id: who };
    next();
  };
  const mailer = { send: async (to, m) => { mailed.push({ to, m }); return { sent: true }; } };
  const app = express();
  app.use(express.json());
  app.use('/feedback', createFeedbackRouter({ pool, auth, mailer }));
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/feedback`;
});
after(() => server.close());

const post = (body, user = 'u1') => fetch(base, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(user ? { 'x-test-user': user } : {}) },
  body: JSON.stringify(body),
});

test('route: needs a signed-in user', async () => {
  const r = await post(like, null);
  assert.equal(r.status, 401);
  assert.equal(saved.length, 0);
});

test('route: saves with the uid, then emails the team', async () => {
  process.env.CONTACT_TO = 'team@example.com';
  const r = await post(like);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
  const s = saved.at(-1);
  assert.match(s.sql, /INSERT INTO app_feedback/);
  assert.deepEqual(s.params, ['u1', 'like', 'Love the coach voice and the boss fights.', 'Sam, 24', true, '1.9.0', 'en', null]);   // (no stars sent: null)
  await new Promise((r2) => setImmediate(r2));
  assert.equal(mailed.at(-1).to, 'team@example.com');
  assert.match(mailed.at(-1).m.subject, /can quote/);
});

test('route: bad body is a 400 and nothing is saved', async () => {
  const n = saved.length;
  const r = await post({ kind: 'like', text: '' });
  assert.equal(r.status, 400);
  assert.equal(saved.length, n);
});

test('route: 5 per hour per user', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await post({ kind: 'improve', text: 'more please' }, 'u2')).status, 200);
  assert.equal((await post({ kind: 'improve', text: 'more please' }, 'u2')).status, 429);
  // someone else is not affected
  assert.equal((await post({ kind: 'improve', text: 'more please' }, 'u3')).status, 200);
});

test('a 1-5 star rating is kept and shown as stars; anything else is dropped', () => {
  const v = cleanFeedback({ ...like, rating: 4 }).value;
  assert.equal(v.rating, 4);
  const mail = feedbackEmail(v, 'u1');
  assert.match(mail.subject, /★★★★☆/);
  assert.match(mail.html, /4\/5/);
  for (const bad of [0, 6, 4.5, '5', null, undefined]) assert.equal(cleanFeedback({ ...like, rating: bad }).value.rating, null);
  assert.doesNotMatch(feedbackEmail(cleanFeedback(like).value, 'u1').subject, /★/);
});
