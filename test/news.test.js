// News & updates (src/lib/news.js): well-formed, unique, newest first.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { NEWS, newsList } = require('../src/lib/news');

test('every item is complete and its id is unique', () => {
  const ids = new Set();
  for (const n of NEWS) {
    for (const k of ['id', 'date', 'tag', 'emoji', 'title', 'body']) assert.ok(typeof n[k] === 'string' && n[k], `${n.id}: ${k}`);
    assert.ok(['new', 'event', 'tip', 'fix'].includes(n.tag), `${n.id}: tag`);
    assert.match(n.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(!ids.has(n.id), `duplicate ${n.id}`);
    ids.add(n.id);
  }
});

test('newest first: ids only ever grow, so the app can count unread ones', () => {
  for (let i = 1; i < NEWS.length; i++) assert.ok(NEWS[i - 1].id > NEWS[i].id, `${NEWS[i - 1].id} before ${NEWS[i].id}`);
});

test('the list sends only the known fields, at most 30', () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ id: String(100 - i), date: '2026-01-01', tag: 'new', emoji: 'x', title: 't', body: 'b', secret: 1 }));
  const out = newsList(many);
  assert.equal(out.length, 30);
  assert.equal(out[0].secret, undefined);
});
