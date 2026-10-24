const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkSnap } = require('../src/lib/snapCheck');
const { message } = require('../src/lib/push');

const reply = (text, stop = 'end_turn') => async () => ({ stop_reason: stop, content: [{ type: 'text', text }] });

test('a snap the check clears is delivered; one it flags, or a refusal, is not', async () => {
  assert.deepEqual(await checkSnap('AAAA', 'image/jpeg', { ask: reply('{"ok":true}') }), { ok: true });
  assert.deepEqual(await checkSnap('AAAA', 'image/jpeg', { ask: reply('```json\n{"ok":false,"reason":"nudity"}\n```') }), { ok: false, reason: 'nudity' });
  assert.deepEqual(await checkSnap('AAAA', 'image/jpeg', { ask: reply('{"ok":false,"reason":"weird"}') }), { ok: false, reason: 'other' });
  assert.deepEqual(await checkSnap('AAAA', 'image/jpeg', { ask: reply('', 'refusal') }), { ok: false, reason: 'other' });
});

test('a check that cannot run throws (the route then refuses the snap)', async () => {
  await assert.rejects(checkSnap('AAAA', 'image/jpeg', { ask: async () => { throw new Error('overloaded'); } }));
  await assert.rejects(checkSnap('AAAA', 'image/jpeg', { ask: reply('not json') }));
});

test('snap notifications in every language', () => {
  for (const lang of ['en', 'ar', 'ur', 'es', 'fr', 'pt', 'tr', 'de', 'it', 'nl', 'ru', 'hi', 'ja', 'kr', 'vi', 'th', 'sw', 'zh-CN', 'ms', 'id', 'tl', 'pl', 'fa', 'bn', 'so']) {
    for (const kind of ['snap', 'screenshot']) assert.ok(message(kind, lang, 'Sam').body.includes('Sam'), `${kind} ${lang}`);
  }
});
