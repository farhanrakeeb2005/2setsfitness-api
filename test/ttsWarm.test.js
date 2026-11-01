// POST /tts/warm (routes/tts.js) and the service's warm(), the ID-token
// option of the tts call, and scripts/prewarm_tts.js's reading of the app's
// line list. Stand-ins only: no GCS, no tts service. `npm test`.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { createTtsService, ttsServiceSynth, validateTts, cacheKey, WARM_TEXT, WARM_FRESH_MS } = require('../src/lib/tts');
const { createTtsRouter, warmLimiter } = require('../src/routes/tts');
const { loadLines } = require('../scripts/prewarm_tts');

const quiet = { error: () => {} };

function rig({ fail = false } = {}) {
  const calls = [];
  const writes = [];
  const store = { read: async () => null, write: async (...a) => { writes.push(a); } };
  const synth = async (v) => {
    calls.push(v);
    await new Promise((r) => setTimeout(r, 5));
    if (fail) throw new Error('tts down');
    return { audio: Buffer.from('mp3'), duration: 0.4 };
  };
  return { calls, writes, store, synth };
}

test('warm(): says one word, stores nothing, once for callers at the same time, then not again for a minute', async () => {
  let clock = 1_000_000;
  const r = rig();
  const svc = createTtsService({ store: r.store, synth: r.synth, log: quiet, now: () => clock });
  const [a, b] = await Promise.all([svc.warm(), svc.warm()]);
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].text, WARM_TEXT);
  assert.ok(r.calls[0].timeoutMs >= 20000, 'a cold start gets time to load the model');
  assert.equal(a.warm, true);
  assert.equal(a.fresh, true);
  assert.deepEqual(a, b);
  assert.equal(r.writes.length, 0);
  clock += WARM_FRESH_MS - 1;
  assert.deepEqual(await svc.warm(), { warm: true, ms: 0, fresh: false });
  assert.equal(r.calls.length, 1);
  clock += 2;
  assert.equal((await svc.warm()).fresh, true);
  assert.equal(r.calls.length, 2);
});

test('warm(): a failure is an error, and the next call tries again', async () => {
  const r = rig({ fail: true });
  const svc = createTtsService({ store: r.store, synth: r.synth, log: quiet });
  await assert.rejects(svc.warm(), /tts down/);
  await assert.rejects(svc.warm(), /tts down/);
  assert.equal(r.calls.length, 2);
});

async function post(router, pathName, { user = 'u1' } = {}) {
  const app = express();
  app.use(express.json());
  app.use('/tts', router);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}${pathName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(user ? { 'X-User': user } : {}) },
      body: '{}',
    });
    return { status: res.status, body: await res.json() };
  } finally {
    server.close();
  }
}
const stubAuth = (req, res, next) => {
  if (!req.headers['x-user']) return res.status(401).json({ error: 'No token provided' });
  req.user = { id: req.headers['x-user'] };
  next();
};
const pass = (req, res, next) => next();

test('POST /tts/warm: signed in only; 200 awake, 503 not set up, 502 failed', async () => {
  const r = rig();
  const service = createTtsService({ store: r.store, synth: r.synth, log: quiet });
  const router = createTtsRouter({ auth: stubAuth, limiter: pass, warmLimit: pass, service, log: quiet });
  assert.equal((await post(router, '/tts/warm', { user: null })).status, 401);
  const ok = await post(router, '/tts/warm');
  assert.equal(ok.status, 200);
  assert.equal(ok.body.warm, true);
  assert.equal(r.calls.length, 1);

  const none = createTtsRouter({ auth: stubAuth, limiter: pass, warmLimit: pass, service: null, log: quiet });
  assert.equal((await post(none, '/tts/warm')).status, 503);
  const bad = rig({ fail: true });
  const broken = createTtsRouter({ auth: stubAuth, limiter: pass, warmLimit: pass, log: quiet,
    service: createTtsService({ store: bad.store, synth: bad.synth, log: quiet }) });
  const res = await post(broken, '/tts/warm');
  assert.equal(res.status, 502);
  assert.equal(res.body.error, 'Voice not available');
});

test('POST /tts/warm: its own per-user limit', async () => {
  const r = rig();
  const service = createTtsService({ store: r.store, synth: r.synth, log: quiet });
  const router = createTtsRouter({ auth: stubAuth, limiter: pass, warmLimit: warmLimiter(2), service, log: quiet });
  const app = express();
  app.use(express.json());
  app.use('/tts', router);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const go = (user) => fetch(`http://127.0.0.1:${port}/tts/warm`, { method: 'POST', headers: { 'X-User': user } });
    assert.equal((await go('a')).status, 200);
    assert.equal((await go('a')).status, 200);
    const third = await go('a');
    assert.equal(third.status, 429);
    assert.equal((await third.json()).code, 'tts_quota');
    assert.equal((await go('b')).status, 200);
  } finally {
    server.close();
  }
});

test('the tts call: getToken sends that ID token; timeoutMs is accepted', async () => {
  const app = express();
  app.use(express.json());
  let auth = null;
  let body = null;
  app.post('/synth', (req, res) => {
    auth = req.headers.authorization;
    body = req.body;
    res.set('X-Audio-Duration', '1.25').type('audio/mpeg').send(Buffer.from('mp3!'));
  });
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const synth = ttsServiceSynth(`http://127.0.0.1:${port}/`, { getToken: async () => 'tok123' });
    const out = await synth({ text: 'Go!', voice: 'af_heart', speed: 1, timeoutMs: 5000 });
    assert.equal(auth, 'Bearer tok123');
    assert.deepEqual(body, { text: 'Go!', voice: 'af_heart', speed: 1, lang: 'en-us' });   // no timeoutMs sent
    assert.equal(out.audio.toString(), 'mp3!');
    assert.equal(out.duration, 1.25);
  } finally {
    server.close();
  }
});

test('prewarm: the app\'s lines get the route\'s tidy-up and cache key, once each', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prewarm-'));
  const file = path.join(dir, 'lines.json');
  fs.writeFileSync(file, JSON.stringify({
    voice: 'af_heart',
    speed: 1,
    lines: [
      { text: 'Last  set.', from: 'a' },
      { text: ' Last set. ', from: 'b' },   // the same line once tidied
      { text: 'x'.repeat(601), from: 'too long' },
      'Rest over',
    ],
  }));
  try {
    const { lines, refused } = loadLines(file);
    assert.deepEqual(lines.map((l) => l.text), ['Last set.', 'Rest over']);
    assert.equal(lines[0].key, cacheKey(validateTts({ text: 'Last set.' }).value));
    assert.equal(refused.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('prewarm: the app\'s real line list, if it is next to this repo, is all usable', () => {
  const file = path.join(__dirname, '..', '..', 'formcoach-app', 'scripts', 'tts_lines.json');
  if (!fs.existsSync(file)) return;
  const { lines, refused } = loadLines(file);
  assert.equal(refused.length, 0);
  assert.ok(lines.length > 100);
});
