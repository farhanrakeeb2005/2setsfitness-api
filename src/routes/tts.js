// POST /tts { text, voice?: 'am_santa' (default) | 'af_heart', speed?: 1 } -> { audio: <MP3, base64>, duration: s, cached }
// The coach's natural English voice (src/lib/tts.js). Signed-in users: 120
// lines an hour each. Guests (no token, an X-Install-Id header as for the AI
// guest chats, lib/aiQuota.js): only lines already in the cache (the tour,
// What's new and the other lines scripts/prewarm_tts.js renders), never a new
// render; 404 { code: 'tts_not_cached' } otherwise. 200 an hour per install
// and 400 per IP. The app falls back to the phone's own voice on any
// error, so failures here are quiet: 400 bad input, 503 not configured,
// 502 the tts service failed.
//
// POST /tts/warm -> { warm: true, ms, fresh }
// The app's wake-up call (on start, back in the foreground, at most every
// 5 minutes per phone): the tts service says one word, nothing stored, so a
// cold instance has loaded its model (~10 s) before the coach speaks.
// Signed-in users, 30 an hour each; 503 / 502 as above.
const express = require('express');
const rateLimit = require('express-rate-limit');
const { validateTts, createTtsService, gcsStore, ttsServiceSynth } = require('../lib/tts');
const { installIdOf } = require('../lib/aiQuota');

function perUserHourly(max) {
  return rateLimit({
    windowMs: 60 * 60 * 1000,
    max,
    keyGenerator: (req) => req.user.id,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many voice requests, please wait.', code: 'tts_quota' },
  });
}
const ttsLimiter = (max = Number(process.env.TTS_HOURLY_LIMIT) || 120) => perUserHourly(max);
const warmLimiter = (max = Number(process.env.TTS_WARM_HOURLY_LIMIT) || 30) => perUserHourly(max);

// guests: per install id, and per IP (the default key) so new ids don't help
function guestLimiter({
  perInstall = Number(process.env.TTS_GUEST_HOURLY_LIMIT) || 200,
  perIp = Number(process.env.TTS_GUEST_IP_HOURLY_LIMIT) || 400,
} = {}) {
  const common = {
    windowMs: 60 * 60 * 1000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many voice requests, please wait.', code: 'tts_quota' },
  };
  const byInstall = rateLimit({ ...common, max: perInstall, keyGenerator: (req) => `install:${req.guest.installId}` });
  const byIp = rateLimit({ ...common, max: perIp });
  return (req, res, next) => byIp(req, res, (err) => (err ? next(err) : byInstall(req, res, next)));
}

// a token: the normal check. No token but an install id: a guest. Neither:
// the normal check too (401).
function userOrGuest(auth) {
  return function maybeGuest(req, res, next) {
    if (req.headers?.authorization) return auth(req, res, next);
    const installId = installIdOf(req);
    if (!installId) return auth(req, res, next);
    req.guest = { installId };
    next();
  };
}

// service: createTtsService(...) | null (no TTS_URL: 503)
function createTtsRouter({ auth, limiter = ttsLimiter(), warmLimit = warmLimiter(), guestLimit = guestLimiter(), service, log = console }) {
  const router = express.Router();
  router.post('/warm', auth, warmLimit, async (req, res) => {
    if (!service) return res.status(503).json({ error: 'Voice not available' });
    try {
      res.json(await service.warm());
    } catch (err) {
      log.error('tts warm-up failed:', err.message);
      if (!res.headersSent) res.status(502).json({ error: 'Voice not available' });
    }
  });
  const limitFor = (req, res, next) => (req.guest ? guestLimit : limiter)(req, res, next);
  router.post('/', userOrGuest(auth), limitFor, async (req, res) => {
    const v = validateTts(req.body);
    if (v.error) return res.status(400).json({ error: v.error });
    if (!service) return res.status(503).json({ error: 'Voice not available' });
    try {
      const out = await service.get(v.value, { cacheOnly: !!req.guest });
      if (!out) return res.status(404).json({ error: 'Voice not available', code: 'tts_not_cached' });
      res.json({ audio: out.audio.toString('base64'), duration: out.duration, cached: out.cached });
    } catch (err) {
      log.error('tts failed:', err.message);
      if (!res.headersSent) res.status(502).json({ error: 'Voice not available' });
    }
  });
  return router;
}

function defaultTtsRouter() {
  const service = process.env.TTS_URL
    ? createTtsService({ store: gcsStore(), synth: ttsServiceSynth() })
    : null;
  return createTtsRouter({ auth: require('../middleware/auth'), service });
}

module.exports = { createTtsRouter, defaultTtsRouter, ttsLimiter, warmLimiter, guestLimiter };
