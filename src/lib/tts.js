// The coach's natural voice (POST /tts, routes/tts.js): English text -> MP3
// in Kokoro's "af_heart" voice, rendered by the private `tts` Cloud Run
// service (tts/ in this repo) and kept in a GCS bucket so each line is
// rendered once for everybody.
//
//   validateTts(body)        -> { ok, value: { text, voice, speed } } | { error }
//   cacheKey(value)          -> sha256 hex of `voice|speed|text`
//   createTtsService({ store, synth, log }) -> { get(value) }
//     store: { read(key) -> { audio: Buffer, duration } | null, write(key, audio, duration) }
//     synth(value) -> { audio: Buffer, duration }
//   gcsStore(bucketName), ttsServiceSynth(url) : the real store and synth
//
// Env: TTS_URL (the tts service's URL; unset -> /tts answers 503),
// TTS_BUCKET (default setsfitness-api-tts-cache), TTS_NO_AUTH=1 (local
// testing against a tts server on localhost: no ID token).
const crypto = require('node:crypto');

const MAX_CHARS = 600;
const VOICES = ['af_heart'];
const DEFAULT_VOICE = 'af_heart';
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

function createTtsService({ store, synth, log = console }) {
  const inFlight = new Map();   // key -> promise: the same line asked twice at once renders once

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

  async function get(value) {
    const key = cacheKey(value);
    try {
      const hit = await store.read(key);
      if (hit?.audio?.length) return { audio: hit.audio, duration: hit.duration, cached: true };
    } catch (err) {
      log.error('tts cache read failed (rendering):', err.message);
    }
    if (!inFlight.has(key)) {
      inFlight.set(key, render(key, value).finally(() => inFlight.delete(key)));
    }
    return inFlight.get(key);
  }

  return { get, inFlightCount: () => inFlight.size };
}

// ---- the real store and synth (not loaded by the tests) ----

const objectName = (key) => `v1/${key}.mp3`;

function gcsStore(bucketName = process.env.TTS_BUCKET || 'setsfitness-api-tts-cache') {
  const { Storage } = require('@google-cloud/storage');
  const bucket = new Storage().bucket(bucketName);
  return {
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

function ttsServiceSynth(url = process.env.TTS_URL, { noAuth = process.env.TTS_NO_AUTH === '1' } = {}) {
  const base = String(url || '').replace(/\/+$/, '');
  let idClient = null;
  async function authHeader() {
    if (noAuth) return {};
    if (!idClient) {
      const { GoogleAuth } = require('google-auth-library');
      // Cloud Run: an ID token for the tts service, from the metadata server
      idClient = await new GoogleAuth().getIdTokenClient(base);
    }
    const h = await idClient.getRequestHeaders(base);
    const value = typeof h?.get === 'function' ? h.get('authorization') : (h?.Authorization || h?.authorization);
    return value ? { Authorization: value } : {};
  }
  return async function synth({ text, voice, speed }) {
    const res = await fetch(`${base}/synth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify({ text, voice, speed, lang: 'en-us' }),
      signal: AbortSignal.timeout(timeoutFor(text)),
    });
    if (!res.ok) throw new Error(`tts service: HTTP ${res.status}`);
    const audio = Buffer.from(await res.arrayBuffer());
    return { audio, duration: Number(res.headers.get('x-audio-duration')) || null };
  };
}

module.exports = {
  MAX_CHARS, VOICES, normalizeText, validateTts, cacheKey, timeoutFor,
  createTtsService, gcsStore, ttsServiceSynth,
};
