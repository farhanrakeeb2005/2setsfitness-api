// The rules this server and the app (formcoach-app, next to this repo) must
// agree on: names, rank thresholds, challenge options, the points cap and the
// stake rule. Reads the app's files from ../formcoach-app (FORMCOACH_APP sets
// another path); skipped, saying so, when it isn't there. `npm test`.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const APP = path.resolve(process.env.FORMCOACH_APP || path.join(__dirname, '..', '..', 'formcoach-app'));
const appFile = (rel) => path.join(APP, rel);
const present = fs.existsSync(appFile('src/lib/nameCheck.js'));
const skip = present ? false : `the app's source isn't at ${APP} (clone formcoach-app next to this repo, or set FORMCOACH_APP)`;
if (skip) console.log(`# crossRepo: skipped: ${skip}`);

const read = (rel) => fs.readFileSync(appFile(rel), 'utf8');

/** the JS value of `export const NAME = <array or number>;` in an app source file */
function exported(src, name) {
  const m = src.match(new RegExp(`export const ${name}\\s*=\\s*([^;]+);`));
  assert.ok(m, `export const ${name} not found`);
  return JSON.parse(m[1].replace(/'/g, '"'));
}

// an app ES module with no imports, loaded as it is (a copy in the temp folder,
// as .mjs, so this CommonJS test can import it)
async function importApp(rel) {
  const src = read(rel);
  assert.ok(!/^\s*import\s/m.test(src), `${rel} has imports: can't be loaded on its own`);
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fc-cross-')), path.basename(rel).replace(/\.js$/, '.mjs'));
  fs.writeFileSync(tmp, src);
  try { return await import(pathToFileURL(tmp).href); } finally { fs.rmSync(path.dirname(tmp), { recursive: true, force: true }); }
}

test('names: the app\'s nameCheck.js and the server\'s give the same answer', { skip }, async () => {
  const app = await importApp('src/lib/nameCheck.js');
  const api = require('../src/lib/nameCheck');
  assert.equal(api.NAME_MIN, app.NAME_MIN);
  assert.equal(api.NAME_MAX, app.NAME_MAX);
  assert.deepEqual(api.NAME_REASONS, app.NAME_REASONS);
  // every string in the server's name tests, and some more edge cases
  const fromTests = [...fs.readFileSync(path.join(__dirname, 'nameCheck.test.js'), 'utf8')
    .matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g)].map((m) => m[1] ?? m[2]);
  const samples = [...new Set([...fromTests,
    '', ' ', 'A', 'Al', 'x'.repeat(40), 'x'.repeat(41), '1234', 'Mo 🔥', 'Mo#1', 'f.u.c.k', 'fuuuuck', 'Ad min', 'admin',
    '2SetsFitness', 'twosetsfitness', 'www.example.com', 'me@example.com', '@mo', '+44 7700 900123', 'Mo​hammed',
    'Ivan Petrоv', 'Zoë', 'O’Brien', 'José', 'José', '山田太郎', 'زهرا‌سادات', null, undefined, 42, {},
  ])];
  for (const s of samples) {
    assert.deepEqual(api.checkName(s), app.checkName(s), `checkName(${JSON.stringify(s)})`);
    assert.equal(api.cleanName(s), app.cleanName(s), `cleanName(${JSON.stringify(s)})`);
    assert.equal(api.okName(s), app.okName(s), `okName(${JSON.stringify(s)})`);
  }
  assert.ok(samples.length > 150, `only ${samples.length} sample names`);
});

test('ranks: the server\'s thresholds are the app\'s BOSSES mins', { skip }, () => {
  const { RANKS } = require('../src/lib/ranks');
  const src = read('src/lib/ranks.js');
  const bosses = [...src.matchAll(/name:\s*'([^']+)',\s*min:\s*(\d+)/g)].map((m) => ({ name: m[1], min: Number(m[2]) }));
  assert.equal(bosses.length, 9, 'the app\'s BOSSES (name, min) not found');
  assert.deepEqual(RANKS.map(({ name, min }) => ({ name, min })), bosses);
});

test('challenges: the app\'s STAKES, DAYS and TARGETS are the server\'s', { skip }, () => {
  const R = require('../src/lib/challengeRules');
  const src = read('src/lib/challenges.js');
  assert.deepEqual(exported(src, 'STAKES'), R.STAKES);
  assert.deepEqual(exported(src, 'DAYS'), R.DAYS);
  const targets = [...src.matchAll(/\{\s*key:\s*'([^']+)',\s*unit:\s*'([^']+)'[^}]*amounts:\s*\[([^\]]*)\]/g)]
    .map((m) => ({ key: m[1], unit: m[2], amounts: m[3].split(',').map(Number) }));
  assert.deepEqual(targets.map((t) => t.key).sort(), Object.keys(R.TARGETS).sort(), 'target keys');
  for (const t of targets) {
    const s = R.TARGETS[t.key];
    assert.equal(t.unit, s.unit, `${t.key} unit`);
    // every amount the app offers is one the server accepts
    for (const a of t.amounts) assert.ok(a >= s.min && a <= s.max, `${t.key} ${a} outside ${s.min}..${s.max}`);
  }
});

test('help facts: the app\'s SERVER_DAILY_CAP, STAKE_MIN_LOGS and STAKE_MAX are the server\'s', { skip }, () => {
  const src = read('src/lib/help/facts.js');
  const { DAILY_POINTS_CAP } = require('../src/lib/pointsCap');
  const R = require('../src/lib/challengeRules');
  assert.equal(exported(src, 'SERVER_DAILY_CAP'), DAILY_POINTS_CAP);
  assert.equal(exported(src, 'STAKE_MIN_LOGS'), R.STAKE_MIN_LOGS);
  assert.equal(exported(src, 'STAKE_MAX'), Math.max(...R.STAKES));
});

test('plausibility: the server\'s limits, speeds and race verdicts are the app\'s', { skip }, async () => {
  // the app's plausibility.js imports sportDistance.js: both copied, as .mjs
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-cross-'));
  try {
    fs.writeFileSync(path.join(dir, 'sportDistance.mjs'), read('src/lib/sportDistance.js'));
    fs.writeFileSync(path.join(dir, 'plausibility.mjs'), read('src/lib/plausibility.js').replace("'./sportDistance.js'", "'./sportDistance.mjs'"));
    const app = await import(pathToFileURL(path.join(dir, 'plausibility.mjs')).href);
    const dist = await import(pathToFileURL(path.join(dir, 'sportDistance.mjs')).href);
    const api = require('../src/lib/plausibility');
    assert.deepEqual(api.LIMITS, app.LIMITS);
    assert.deepEqual(api.KM_TOP_SPEED, dist.KM_TOP_SPEED);
    assert.deepEqual(api.KM_CHECK_SPEED, dist.KM_CHECK_SPEED);
    const sets = (n, r, w = 0) => Array.from({ length: n }, () => ({ w, r, done: true }));
    const workouts = [];
    for (const r of [5, 100, 101, 300, 301, 1000]) for (const n of [1, 4, 10, 38, 60, 151]) for (const dur of [undefined, 60, 300, 900, 1800, 3600, 7200]) {
      for (const name of ['Push-up', 'Plank', 'Treadmill run', 'Bench press']) {
        workouts.push({ ts: 1, durationSec: dur, exercises: [{ name, sets: sets(n, r, name === 'Bench press' ? 400 : 0) }] });
      }
    }
    for (const h of workouts) {
      assert.equal(api.raceWorkoutBlocked(h), app.raceWorkoutBlocked(h), JSON.stringify({ ...h, exercises: h.exercises.map((e) => [e.name, e.sets.length, e.sets[0].r]) }));
      assert.equal(api.paceLevel(h.exercises, h.durationSec), app.checkPace(h.exercises, h.durationSec).level);
    }
    for (const sport of ['Running', 'Cycling', 'Swimming', 'Walking', 'Hiking', 'Rowing', 'Football']) {
      for (const duration of [0, 30, 60, 180, 361]) for (const km of [0, 1, 5, 12, 22, 40, 400]) {
        assert.equal(api.raceSportBlocked({ sport, duration, km }), app.raceSportBlocked({ sport, duration, km }), `${sport} ${duration} ${km}`);
      }
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
