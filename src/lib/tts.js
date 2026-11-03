// The coach's natural voice (POST /tts, routes/tts.js): English text -> MP3
// in Kokoro's "af_heart" voice, rendered by the private `tts` Cloud Run
// service (tts/ in this repo) and kept in a GCS bucket so each line is
// rendered once for everybody.
//
//   validateTts(body)        -> { ok, value: { text, voice, speed } } | { error }
//   cacheKey(value)          -> sha256 hex of `voice|speed|text`
//   createTtsService({ store, synth, log }) -> { get(value, { cacheOnly }), warm() }
//     get(value, { cacheOnly: true }): a cache hit, or null (never renders;
//       guests, routes/tts.js)
//     store: { read(key) -> { audio: Buffer, duration } | null, write(key, audio, duration) }
//     synth(value) -> { audio: Buffer, duration }
//     warm(): has the tts service say one short word, not stored: a cold
//       instance loads its model (~10 s) before the app's lines need it
//   gcsStore(bucketName), ttsServiceSynth(url) : the real store and synth
//     (gcsStore also has exists(key), for scripts/prewarm_tts.js)
//
// Env: TTS_URL (the tts service's URL; unset -> /tts answers 503),
// TTS_BUCKET (default setsfitness-api-tts-cache), TTS_NO_AUTH=1 (local
// testing against a tts server on localhost: no ID token).
const crypto = require('node:crypto');

const MAX_CHARS = 600;
const VOICES = ['af_heart', 'am_santa'];
// the coach is a yeti: a big, jolly voice (af_heart stays available)
const DEFAULT_VOICE = 'am_santa';
// the tts service call: 8 s, plus time for longer lines (it renders at
// roughly real time on 2 vCPUs, about 15 characters a second)
const BASE_TIMEOUT_MS = 8000;
const PER_CHAR_MS = 60;
const MAX_TIMEOUT_MS = 45000;

const timeoutFor = (text) => Math.min(MAX_TIMEOUT_MS, BASE_TIMEOUT_MS + PER_CHAR_MS * text.length);

// one line of text: Unicode NFC, no control characters, single spaces
function normalizeText(s) {
  return String(s ?? '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function validateTts(body) {
  if (!body || typeof body !== 'object') return { error: 'Body must be a JSON object' };
  if (typeof body.text !== 'string') return { error: 'text is required' };
  const text = normalizeText(body.text);
  if (!text) return { error: 'text is required' };
  if (text.length > MAX_CHARS) return { error: `text is longer than ${MAX_CHARS} characters` };
  const voice = body.voice == null ? DEFAULT_VOICE : body.voice;
  if (!VOICES.includes(voice)) return { error: 'Unknown voice' };
  let speed = body.speed == null ? 1 : body.speed;
  if (typeof speed !== 'number' || !Number.isFinite(speed) || speed < 0.5 || speed > 2) {
    return { error: 'speed must be between 0.5 and 2' };
  }
  speed = Math.round(speed * 20) / 20;   // steps of 0.05: fewer cache entries
  return { ok: true, value: { text, voice, speed } };
}

function cacheKey({ voice, speed, text }) {
  return crypto.createHash('sha256').update(`${voice}|${Number(speed).toFixed(2)}|${text}`).digest('hex');
}

// warm(): the word said, and how long a just-woken service counts as awake
// here (calls in that time answer at once, without touching the service)
const WARM_TEXT = 'Ready.';
const WARM_FRESH_MS = 60 * 1000;
// a cold start: the model load (~10 s, up to ~20 s) and the word itself
const WARM_TIMEOUT_MS = 28000;

function createTtsService({ store, synth, log = console, now = Date.now }) {
  const inFlight = new Map();   // key -> promise: the same line asked twice at once renders once
  let warming = null;           // the wake-up in progress
  let warmAt = 0;               // the last one that worked

  // -> { warm: true, ms, fresh: whether the service was asked now }
  async function warm() {
    if (warmAt && now() - warmAt < WARM_FRESH_MS) return { warm: true, ms: 0, fresh: false };
    if (!warming) {
      const t0 = now();
      warming = Promise.resolve()
        .then(() => synth({ text: WARM_TEXT, voice: DEFAULT_VOICE, speed: 1, timeoutMs: WARM_TIMEOUT_MS }))
        .then((out) => {
          if (!out?.audio?.length) throw new Error('tts returned no audio');
          warmAt = now();
          return { warm: true, ms: warmAt - t0, fresh: true };
        })
        .finally(() => { warming = null; });
    }
    return warming;
  }

  async function render(key, value) {
    const out = await synth(value);
    if (!out?.audio?.length) throw new Error('tts returned no audio');
    try {
      await store.write(key, out.audio, out.duration);
    } catch (err) {
      log.error('tts cache write failed:', err.message);
    }
    return { audio: out.audio, duration: out.duration, cached: false };
  }

  async function get(value, { cacheOnly = false } = {}) {
    const key = cacheKey(value);
    try {
      const hit = await store.read(key);
      if (hit?.audio?.length) return { audio: hit.audio, duration: hit.duration, cached: true };
    } catch (err) {
      if (cacheOnly) throw err;
      log.error('tts cache read failed (rendering):', err.message);
    }
    if (cacheOnly) return null;
    if (!inFlight.has(key)) {
      inFlight.set(key, render(key, value).finally(() => inFlight.delete(key)));
    }
    return inFlight.get(key);
  }

  return { get, warm, inFlightCount: () => inFlight.size };
}

// ---- the real store and synth (not loaded by the tests) ----

const objectName = (key) => `v1/${key}.mp3`;

function gcsStore(bucketName = process.env.TTS_BUCKET || 'setsfitness-api-tts-cache') {
  const { Storage } = require('@google-cloud/storage');
  const bucket = new Storage().bucket(bucketName);
  return {
    async exists(key) {
      const [yes] = await bucket.file(objectName(key)).exists();
      return yes;
    },
    async read(key) {
      const file = bucket.file(objectName(key));
      try {
        const [[audio], [meta]] = await Promise.all([file.download(), file.getMetadata()]);
        return { audio, duration: Number(meta?.metadata?.duration) || null };
      } catch (err) {
        if (err?.code === 404) return null;
        throw err;
      }
    },
    async write(key, audio, duration) {
      await bucket.file(objectName(key)).save(audio, {
        resumable: false,
        contentType: 'audio/mpeg',
        metadata: { cacheControl: 'private, max-age=86400', metadata: { duration: String(duration ?? '') } },
      });
    },
  };
}

// getToken: () -> an ID token for the service (scripts/prewarm_tts.js, run on
// a PC: `gcloud auth print-identity-token`); default: from the metadata
// server, as the API's service account
function ttsServiceSynth(url = process.env.TTS_URL, { noAuth = process.env.TTS_NO_AUTH === '1', getToken = null } = {}) {
  const base = String(url || '').replace(/\/+$/, '');
  let idClient = null;
  async function authHeader() {
    if (noAuth) return {};
    if (getToken) return { Authorization: `Bearer ${await getToken()}` };
    if (!idClient) {
      const { GoogleAuth } = require('google-auth-library');
      // Cloud Run: an ID token for the tts service, from the metadata server
      idClient = await new GoogleAuth().getIdTokenClient(base);
    }
    const h = await idClient.getRequestHeaders(base);
    const value = typeof h?.get === 'function' ? h.get('authorization') : (h?.Authorization || h?.authorization);
    return value ? { Authorization: value } : {};
  }
  // timeoutMs: the wake-up's own (a cold start loads the model first)
  return async function synth({ text, voice, speed, timeoutMs }) {
    const res = await fetch(`${base}/synth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify({ text, voice, speed, lang: 'en-us' }),
      signal: AbortSignal.timeout(timeoutMs || timeoutFor(text)),
    });
    if (!res.ok) throw new Error(`tts service: HTTP ${res.status}`);
    const audio = Buffer.from(await res.arrayBuffer());
    return { audio, duration: Number(res.headers.get('x-audio-duration')) || null };
  };
}

module.exports = {
  MAX_CHARS, WARM_TEXT, WARM_FRESH_MS, normalizeText, validateTts, cacheKey, timeoutFor,
  createTtsService, gcsStore, ttsServiceSynth,
};
