// POST /tts (routes/tts.js, lib/tts.js): input checks, the cache key, the
// GCS cache in front of the tts service, and the route's replies. No GCS,
// no tts service, no Firebase: all stand-ins. `npm test`.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { validateTts, cacheKey, normalizeText, createTtsService, timeoutFor, MAX_CHARS } = require('../src/lib/tts');
const { createTtsRouter } = require('../src/routes/tts');

const quiet = { error: () => {} };

test('text is tidied, and the limits hold', () => {
  assert.equal(normalizeText('  Last\n set.\t Go!  '), 'Last set. Go!');
  assert.equal(normalizeText('Café'), 'Café');   // NFC
  const ok = validateTts({ text: ' Drive  through your heels. ' });
  assert.deepEqual(ok, { ok: true, value: { text: 'Drive through your heels.', voice: 'am_santa', speed: 1 } });
  assert.ok(validateTts({ text: 'x'.repeat(MAX_CHARS) }).ok);
  assert.match(validateTts({ text: 'x'.repeat(MAX_CHARS + 1) }).error, /600/);
  assert.match(validateTts({ text: '   ' }).error, /text/);
  assert.match(validateTts({ text: 42 }).error, /text/);
  assert.match(validateTts(null).error, /object/);
  assert.match(validateTts({ text: 'hi', voice: 'bm_george' }).error, /voice/);
  assert.match(validateTts({ text: 'hi', speed: 3 }).error, /speed/);
  assert.match(validateTts({ text: 'hi', speed: '1' }).error, /speed/);
  assert.equal(validateTts({ text: 'hi', speed: 1.02 }).value.speed, 1);   // 0.05 steps
});

test('the cache key: same line same key; voice, speed or text change it', () => {
  const a = { text: 'Go!', voice: 'af_heart', speed: 1 };
  assert.match(cacheKey(a), /^[0-9a-f]{64}$/);
  assert.equal(cacheKey(a), cacheKey({ ...a }));
  assert.equal(cacheKey(a), cacheKey({ ...a, speed: 1.0 }));
  assert.notEqual(cacheKey(a), cacheKey({ ...a, text: 'Go.' }));
  assert.notEqual(cacheKey(a), cacheKey({ ...a, speed: 1.1 }));
});

test('the service call gets longer for longer lines, within a cap', () => {
  assert.equal(timeoutFor(''), 8000);
  assert.ok(timeoutFor('x'.repeat(100)) > 8000);
  assert.equal(timeoutFor('x'.repeat(10000)), 45000);
});

function rig({ failRead = false, failWrite = false, failSynth = false } = {}) {
  const stored = new Map();
  let synths = 0;
  const store = {
    read: async (k) => { if (failRead) throw new Error('gcs down'); return stored.get(k) || null; },
    write: async (k, audio, duration) => { if (failWrite) throw new Error('gcs down'); stored.set(k, { audio, duration }); },
  };
  const synth = async ({ text }) => {
    synths += 1;
    await new Promise((r) => setTimeout(r, 5));
    if (failSynth) throw new Error('tts down');
    return { audio: Buffer.from(`mp3:${text}`), duration: 1.5 };
  };
  return { stored, store, synth, synths: () => synths };
}

test('a miss renders and stores; the next ask is a cache hit', async () => {
  const r = rig();
  const svc = createTtsService({ store: r.store, synth: r.synth, log: quiet });
  const v = validateTts({ text: 'Last set.' }).value;
  const first = await svc.get(v);
  assert.equal(first.cached, false);
  assert.equal(first.audio.toString(), 'mp3:Last set.');
  assert.equal(r.stored.size, 1);
  assert.ok(r.stored.has(cacheKey(v)));
  const second = await svc.get(v);
  assert.equal(second.cached, true);
  assert.equal(second.duration, 1.5);
  assert.equal(r.synths(), 1);
});

test('the same line asked twice at once is rendered once', async () => {
  const r = rig();
  const svc = createTtsService({ store: r.store, synth: r.synth, log: quiet });
  const v = validateTts({ text: 'Rest is over.' }).value;
  const [a, b] = await Promise.all([svc.get(v), svc.get(v)]);
  assert.equal(r.synths(), 1);
  assert.equal(a.audio.toString(), b.audio.toString());
  assert.equal(svc.inFlightCount(), 0);
});

test('a broken cache never stops the voice; a broken tts service is an error', async () => {
  const r = rig({ failRead: true, failWrite: true });
  const svc = createTtsService({ store: r.store, synth: r.synth, log: quiet });
  const out = await svc.get(validateTts({ text: 'Breathe.' }).value);
  assert.equal(out.audio.toString(), 'mp3:Breathe.');

  const bad = rig({ failSynth: true });
  const svc2 = createTtsService({ store: bad.store, synth: bad.synth, log: quiet });
  await assert.rejects(svc2.get(validateTts({ text: 'Breathe.' }).value), /tts down/);
  assert.equal(svc2.inFlightCount(), 0);   // a later try renders again
  assert.equal(bad.stored.size, 0);
});

// the route on a real express app, with stand-in auth and service
async function call(router, body, { user = 'u1' } = {}) {
  const app = express();
  app.use(express.json());
  app.use('/tts', router);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(user ? { 'X-User': user } : {}) },
      body: JSON.stringify(body),
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
const passLimiter = (req, res, next) => next();

test('the route: signed-in only, checks input, sends base64 audio', async () => {
  const r = rig();
  const service = createTtsService({ store: r.store, synth: r.synth, log: quiet });
  const router = createTtsRouter({ auth: stubAuth, limiter: passLimiter, service, log: quiet });
  assert.equal((await call(router, { text: 'Go!' }, { user: null })).status, 401);
  assert.equal((await call(router, { text: 'x'.repeat(601) })).status, 400);
  assert.equal((await call(router, { text: 'Go!', voice: 'other' })).status, 400);
  const ok = await call(router, { text: 'Go!' });
  assert.equal(ok.status, 200);
  assert.equal(Buffer.from(ok.body.audio, 'base64').toString(), 'mp3:Go!');
  assert.equal(ok.body.duration, 1.5);
  assert.equal(ok.body.cached, false);
  assert.equal((await call(router, { text: 'Go!' })).body.cached, true);
});

test('the route: 503 without a tts service, 502 when it fails', async () => {
  const none = createTtsRouter({ auth: stubAuth, limiter: passLimiter, service: null, log: quiet });
  assert.equal((await call(none, { text: 'Go!' })).status, 503);
  const r = rig({ failSynth: true });
  const broken = createTtsRouter({ auth: stubAuth, limiter: passLimiter, log: quiet,
    service: createTtsService({ store: r.store, synth: r.synth, log: quiet }) });
  const res = await call(broken, { text: 'Go!' });
  assert.equal(res.status, 502);
  assert.equal(res.body.error, 'Voice not available');
});

test('the per-user hourly limit', async () => {
  const { ttsLimiter } = require('../src/routes/tts');
  const r = rig();
  const service = createTtsService({ store: r.store, synth: r.synth, log: quiet });
  const router = createTtsRouter({ auth: stubAuth, limiter: ttsLimiter(2), service, log: quiet });
  const app = express();
  app.use(express.json());
  app.use('/tts', router);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const post = (user) => fetch(`http://127.0.0.1:${port}/tts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User': user }, body: JSON.stringify({ text: 'Go!' }),
    });
    assert.equal((await post('a')).status, 200);
    assert.equal((await post('a')).status, 200);
    const third = await post('a');
    assert.equal(third.status, 429);
    assert.equal((await third.json()).code, 'tts_quota');
    assert.equal((await post('b')).status, 200);   // per user, not per IP
  } finally {
    server.close();
  }
});

// guests: no token, an install id (as for the AI guest chats): cache hits only
const INSTALL = 'guest_install_0123456789';
async function guestCall(router, body, headers = {}) {
  const app = express();
  app.use(express.json());
  app.use('/tts', router);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/tts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  } finally {
    server.close();
  }
}

test('guests: a cached line plays, an uncached one is 404 and never rendered', async () => {
  const r = rig();
  const service = createTtsService({ store: r.store, synth: r.synth, log: quiet });
  const router = createTtsRouter({ auth: stubAuth, limiter: passLimiter, guestLimit: passLimiter, service, log: quiet });
  // the tour line is already in the cache (scripts/prewarm_tts.js)
  const v = validateTts({ text: 'Welcome to 2Sets.' }).value;
  r.stored.set(cacheKey(v), { audio: Buffer.from('mp3:tour'), duration: 2 });

  const hit = await guestCall(router, { text: 'Welcome to 2Sets.' }, { 'X-Install-Id': INSTALL });
  assert.equal(hit.status, 200);
  assert.equal(Buffer.from(hit.body.audio, 'base64').toString(), 'mp3:tour');
  assert.equal(hit.body.cached, true);

  const miss = await guestCall(router, { text: 'Something new.' }, { 'X-Install-Id': INSTALL });
  assert.equal(miss.status, 404);
  assert.equal(miss.body.code, 'tts_not_cached');
  assert.equal(r.synths(), 0);
  assert.equal(r.stored.size, 1);

  // no token and no (or a malformed) install id: 401
  assert.equal((await guestCall(router, { text: 'Welcome to 2Sets.' })).status, 401);
  assert.equal((await guestCall(router, { text: 'Welcome to 2Sets.' }, { 'X-Install-Id': 'short' })).status, 401);
  assert.equal(r.synths(), 0);
});

test('guests: a cache read error is a 502, still no render; signed-in users still render', async () => {
  const r = rig({ failRead: true });
  const service = createTtsService({ store: r.store, synth: r.synth, log: quiet });
  const router = createTtsRouter({ auth: stubAuth, limiter: passLimiter, guestLimit: passLimiter, service, log: quiet });
  assert.equal((await guestCall(router, { text: 'Go!' }, { 'X-Install-Id': INSTALL })).status, 502);
  assert.equal(r.synths(), 0);
  // signed in (with an install id too): renders as before
  const signed = await guestCall(router, { text: 'Go!' }, { 'X-User': 'u1', Authorization: 'Bearer t', 'X-Install-Id': INSTALL });
  assert.equal(signed.status, 200);
  assert.equal(signed.body.cached, false);
  assert.equal(r.synths(), 1);
});

test('guests: the per-install hourly limit; /tts/warm stays signed-in only', async () => {
  const { guestLimiter } = require('../src/routes/tts');
  const r = rig();
  const service = createTtsService({ store: r.store, synth: r.synth, log: quiet });
  const v = validateTts({ text: 'Go!' }).value;
  r.stored.set(cacheKey(v), { audio: Buffer.from('mp3'), duration: 1 });
  const router = createTtsRouter({ auth: stubAuth, limiter: passLimiter, warmLimit: passLimiter,
    guestLimit: guestLimiter({ perInstall: 2, perIp: 4 }), service, log: quiet });
  const app = express();
  app.use(express.json());
  app.use('/tts', router);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const post = (id, p = '') => fetch(`http://127.0.0.1:${port}/tts${p}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Install-Id': id }, body: JSON.stringify({ text: 'Go!' }),
    });
    const a = 'install_aaaaaaaaaaaaaaaa';
    const b = 'install_bbbbbbbbbbbbbbbb';
    assert.equal((await post(a)).status, 200);
    assert.equal((await post(a)).status, 200);
    const third = await post(a);
    assert.equal(third.status, 429);
    assert.equal((await third.json()).code, 'tts_quota');
    assert.equal((await post(b)).status, 200);   // a new install id: its own count...
    assert.equal((await post('install_cccccccccccccccc')).status, 429);   // ...but the IP's cap (4) holds
    assert.equal((await post(b, '/warm')).status, 401);
  } finally {
    server.close();
  }
});
