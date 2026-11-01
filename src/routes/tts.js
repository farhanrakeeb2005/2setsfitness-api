// POST /tts { text, voice?: 'af_heart', speed?: 1 } -> { audio: <MP3, base64>, duration: s, cached }
// The coach's natural English voice (src/lib/tts.js). Signed-in users only,
// 120 lines an hour each. The app falls back to the phone's own voice on any
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

// service: createTtsService(...) | null (no TTS_URL: 503)
function createTtsRouter({ auth, limiter = ttsLimiter(), warmLimit = warmLimiter(), service, log = console }) {
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
  router.post('/', auth, limiter, async (req, res) => {
    const v = validateTts(req.body);
    if (v.error) return res.status(400).json({ error: v.error });
    if (!service) return res.status(503).json({ error: 'Voice not available' });
    try {
      const out = await service.get(v.value);
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

module.exports = { createTtsRouter, defaultTtsRouter, ttsLimiter, warmLimiter };
