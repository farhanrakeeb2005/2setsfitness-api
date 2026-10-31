// POST /tts { text, voice?: 'af_heart', speed?: 1 } -> { audio: <MP3, base64>, duration: s, cached }
// The coach's natural English voice (src/lib/tts.js). Signed-in users only,
// 120 lines an hour each. The app falls back to the phone's own voice on any
// error, so failures here are quiet: 400 bad input, 503 not configured,
// 502 the tts service failed.
const express = require('express');
const rateLimit = require('express-rate-limit');
const { validateTts, createTtsService, gcsStore, ttsServiceSynth } = require('../lib/tts');

function ttsLimiter(max = Number(process.env.TTS_HOURLY_LIMIT) || 120) {
  return rateLimit({
    windowMs: 60 * 60 * 1000,
    max,
    keyGenerator: (req) => req.user.id,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many voice requests, please wait.', code: 'tts_quota' },
  });
}

// service: createTtsService(...) | null (no TTS_URL: 503)
function createTtsRouter({ auth, limiter = ttsLimiter(), service, log = console }) {
  const router = express.Router();
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

module.exports = { createTtsRouter, defaultTtsRouter, ttsLimiter };
