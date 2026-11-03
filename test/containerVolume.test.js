// POST /ai/container-volume (src/lib/containerVolume.js): label strings to
// ml, the AI's answer made safe, and the route with a fake Anthropic call.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { labelToMl, cleanVolume, containerVolumeHandler } = require('../src/lib/containerVolume');
const { request, replyText } = require('../src/lib/aiModel');
const { langDirective } = require('../src/lib/aiText');
const { kindOf, overLimit, limits } = require('../src/lib/aiQuota');

test('label strings to ml', () => {
  const cases = {
    '500 ml': 500, '500ML': 500, '0.75 L': 750, '0,75l': 750, '1 L': 1000, '1.5 litres': 1500, '2 liters': 2000,
    '33 cl': 330, '75cl': 750, '16.9 fl oz': 500, '12 fl. oz.': 355, '20 oz': 590, '5 dl': 500,
    '500 ml (16.9 fl oz)': 500, 'Net 330ml can': 330, '2 x 330 ml': 330, '1500 ml': 1500,
  };
  for (const [s, ml] of Object.entries(cases)) assert.equal(labelToMl(s), ml, s);
  for (const s of ['', null, 'Water bottle', '500', '10 ml', '20 L', 'mlk 5']) assert.equal(labelToMl(s), null, String(s));
});

test('the AI answer: a label wins, odd sizes become "ask the user"', () => {
  assert.deepEqual(cleanVolume({ name: 'Water bottle', ml: 600, label: '0.75 L', confidence: 'high', reason: 'Printed on the label' }),
    { name: 'Water bottle', ml: 750, confidence: 'high', reason: 'Printed on the label', label: '0.75 L' });
  assert.deepEqual(cleanVolume({ name: 'Mug', ml: 297, label: null, confidence: 'medium', reason: 'A standard mug' }),
    { name: 'Mug', ml: 300, confidence: 'medium', reason: 'A standard mug', label: null });
  assert.equal(cleanVolume({ ml: '33 cl' }).ml, 330);
  const none = cleanVolume({ name: '', ml: null, confidence: 'high' });
  assert.equal(none.ml, null);
  assert.equal(none.confidence, 'low');
  assert.equal(cleanVolume({ ml: 90000, confidence: 'high' }).ml, null);
  assert.equal(cleanVolume({ ml: 500, confidence: 'sure' }).confidence, 'low');
  assert.deepEqual(cleanVolume(null), { name: '', ml: null, confidence: 'low', reason: '', label: null });
});

test('a logging tool for the caps, not a coach chat', () => {
  assert.equal(kindOf('container-volume'), 'logging');
  const lim = limits({});
  assert.equal(overLimit({ chat: 10, chat24: 20 }, lim, 'container-volume'), null);   // chats used up: still works
  assert.equal(overLimit({ logging: 40 }, lim, 'container-volume'), 'logging');
});

function fakeRes() {
  return { code: 200, body: null, locals: {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
}
const parseJSON = (t) => JSON.parse(t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim());
function handler(reply, seen = []) {
  return containerVolumeHandler({
    create: async (r) => { seen.push(r); if (reply instanceof Error) throw reply; return { stop_reason: 'end_turn', content: [{ type: 'text', text: reply }] }; },
    models: () => ({ all: 'h', chat: 'h', scan: 'scan-model' }), request, replyText, parseJSON, langDirective,
  });
}

test('the route: the photo goes to the scan model, the answer comes back cleaned', async () => {
  const seen = [];
  const res = fakeRes();
  await handler('```json\n{"name":"Sports bottle","ml":700,"label":"750 ml","confidence":"high","reason":"On the side"}\n```', seen)(
    { body: { imageBase64: 'abc', lang: 'fr' } }, res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, { name: 'Sports bottle', ml: 750, confidence: 'high', reason: 'On the side', label: '750 ml' });
  assert.equal(seen[0].model, 'scan-model');
  const [img, txt] = seen[0].messages[0].content;
  assert.equal(img.source.data, 'abc');
  assert.match(txt.text, /fl oz/);
  assert.match(txt.text, /French/);
});

test('the route: bad input is refused; an AI failure is a 500 and the call is refunded', async () => {
  let res = fakeRes();
  await handler('{}')({ body: {} }, res);
  assert.equal(res.code, 400);
  res = fakeRes();
  await handler('{}')({ body: { imageBase64: 'x'.repeat(1_400_001) } }, res);
  assert.equal(res.code, 413);
  res = fakeRes();
  await handler('{}')({ body: { imageBase64: 'abc', mimeType: 'image/tiff' } }, res);
  assert.equal(res.code, 400);
  for (const bad of [new Error('down'), 'not json']) {
    res = fakeRes();
    let refunded = 0;
    res.locals.aiRefund = () => { refunded += 1; };
    const orig = console.error; console.error = () => {};
    await handler(bad)({ body: { imageBase64: 'abc' } }, res);
    console.error = orig;
    assert.equal(res.code, 500);
    assert.equal(refunded, 1);
  }
});
