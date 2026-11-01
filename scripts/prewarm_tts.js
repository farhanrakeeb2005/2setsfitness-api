// Pre-renders the coach's fixed English lines into the voice cache
// (gs://setsfitness-api-tts-cache/v1/<sha256>.mp3), so POST /tts answers them
// from the cache at once and the app never has to wait for a cold tts server.
// Same text tidy-up and cache key as the route (src/lib/tts.js validateTts +
// cacheKey: sha256 of voice|speed|text), so the app's requests hit these.
//
// The lines: formcoach-app scripts/tts_lines.json (made by its
// scripts/build_tts_lines.mjs: tours, rep cues, timers, celebrations).
//
//   node scripts/prewarm_tts.js --dry-run              count + samples, no network
//   node scripts/prewarm_tts.js                        render what isn't cached yet
//
// Options: --lines <file> (default ../formcoach-app/scripts/tts_lines.json),
// --concurrency <n> (default 4: the tts service takes 2 at a time per
// instance and renders one at a time, so 4 is about 2 instances busy),
// --limit <n> (only the first n lines), --force (render again
// even if cached).
//
// A real run needs, on this PC:
//   - TTS_URL: the tts service's URL (gcloud run services describe tts ...)
//   - gcloud signed in as an account allowed to call it (an owner is) - the
//     ID token comes from `gcloud auth print-identity-token`, or set
//     TTS_ID_TOKEN yourself
//   - application-default credentials that can write the bucket
//     (`gcloud auth application-default login`); TTS_BUCKET to use another
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { validateTts, cacheKey, createTtsService, gcsStore, ttsServiceSynth } = require('../src/lib/tts');

function args(argv) {
  const out = { dryRun: false, force: false, lines: null, concurrency: 4, limit: 0 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--force') out.force = true;
    else if (a === '--lines') out.lines = argv[++i];
    else if (a === '--concurrency') out.concurrency = Math.max(1, Number(argv[++i]) || 1);
    else if (a === '--limit') out.limit = Math.max(0, Number(argv[++i]) || 0);
    else throw new Error(`unknown option ${a}`);
  }
  return out;
}

// the lines file -> [{ text, from, value, key }] (one per cache key), and the ones the route would refuse
function loadLines(file) {
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  const list = Array.isArray(json) ? json : json.lines;
  if (!Array.isArray(list)) throw new Error(`${file}: no "lines" list`);
  const voice = json.voice || undefined;
  const speed = json.speed || undefined;
  const seen = new Set();
  const lines = [];
  const refused = [];
  for (const item of list) {
    const text = typeof item === 'string' ? item : item?.text;
    const v = validateTts({ text, voice, speed });
    if (v.error) { refused.push({ text, error: v.error }); continue; }
    const key = cacheKey(v.value);
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push({ text: v.value.text, from: item?.from || '', value: v.value, key });
  }
  return { lines, refused };
}

// a line may wait behind another on its instance (the service renders one
// at a time), so longer than the route's own timeout
const RENDER_TIMEOUT_MS = 55000;

function idTokenSource() {
  if (process.env.TTS_ID_TOKEN) return async () => process.env.TTS_ID_TOKEN;
  let token = null;
  let at = 0;
  return async () => {
    // gcloud's tokens last an hour
    if (!token || Date.now() - at > 40 * 60 * 1000) {
      token = execSync('gcloud auth print-identity-token', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
      at = Date.now();
      if (!token) throw new Error('gcloud auth print-identity-token gave nothing (gcloud auth login?)');
    }
    return token;
  };
}

async function pool(items, n, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  }));
}

async function main() {
  const opt = args(process.argv.slice(2));
  const file = path.resolve(opt.lines || path.join(__dirname, '..', '..', 'formcoach-app', 'scripts', 'tts_lines.json'));
  let { lines, refused } = loadLines(file);
  if (opt.limit) lines = lines.slice(0, opt.limit);
  const chars = lines.reduce((a, l) => a + l.text.length, 0);
  console.log(`${lines.length} lines to pre-render from ${file}`);
  const audioMin = chars / 15 / 60;
  console.log(`  ${chars} characters, about ${Math.round(audioMin)} min of audio: roughly ${Math.ceil((audioMin * 0.85) / Math.max(1, Math.floor(opt.concurrency / 2)))} min to render at --concurrency ${opt.concurrency}`);
  if (refused.length) console.log(`  ${refused.length} refused by the route's checks:`, refused.slice(0, 5));

  if (opt.dryRun) {
    const picks = [0, 1, 2, Math.floor(lines.length / 3), Math.floor(lines.length / 2), lines.length - 2, lines.length - 1]
      .filter((i, j, a) => i >= 0 && i < lines.length && a.indexOf(i) === j);
    console.log('samples (cache object, where it is said, text):');
    picks.forEach((i) => console.log(`  v1/${lines[i].key.slice(0, 16)}….mp3  [${lines[i].from}]  ${JSON.stringify(lines[i].text)}`));
    console.log('dry run: nothing rendered or stored.');
    return;
  }

  const url = process.env.TTS_URL;
  if (!url) throw new Error('TTS_URL is not set (the tts service URL)');
  const store = gcsStore();
  const synth = ttsServiceSynth(url, { getToken: idTokenSource() });
  const service = createTtsService({ store, synth });

  const t0 = Date.now();
  console.log('waking the tts service…');
  const w = await service.warm();
  console.log(`  awake (${w.ms} ms)`);

  const stats = { cached: 0, rendered: 0, failed: [] };
  await pool(lines, opt.concurrency, async (line, i) => {
    try {
      if (!opt.force && (await store.exists(line.key))) { stats.cached += 1; return; }
      let out;
      try {
        out = await synth({ ...line.value, timeoutMs: RENDER_TIMEOUT_MS });
      } catch {
        await new Promise((r) => setTimeout(r, 3000));   // one more try
        out = await synth({ ...line.value, timeoutMs: RENDER_TIMEOUT_MS });
      }
      if (!out?.audio?.length) throw new Error('no audio');
      await store.write(line.key, out.audio, out.duration);
      stats.rendered += 1;
      if (stats.rendered % 20 === 0) console.log(`  ${i + 1}/${lines.length} (rendered ${stats.rendered}, already cached ${stats.cached})`);
    } catch (err) {
      stats.failed.push({ text: line.text, error: err.message });
    }
  });
  const secs = Math.round((Date.now() - t0) / 1000);
  console.log(`done in ${secs} s: rendered ${stats.rendered}, already cached ${stats.cached}, failed ${stats.failed.length}`);
  stats.failed.slice(0, 10).forEach((f) => console.log(`  failed: ${JSON.stringify(f.text)}: ${f.error}`));
  if (stats.failed.length) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}

module.exports = { loadLines, args };
