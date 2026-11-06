// POST /ai/label-scan's checks on the model's reply (src/lib/labelScan.js):
// numbers kept finite, non-negative and capped, no label -> an error, per 100
// worked out from a serving when only that was printed. No AI calls. `npm test`.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cleanLabelReply, labelScanPrompt } = require('../src/lib/labelScan');

const oats = {
  name: 'Overnight Protein Oats', brand: 'Brand',
  per100: { unit: 'g', kcal: 120, protein: 7.6, carbs: 14, fat: 4.6, fibre: 6.4, sugar: 5, salt: 0.2 },
  serving: { label: '1 pot', amount: 170, kcal: 205, protein: 13, carbs: 24, fat: 7.9, fibre: 11 },
  packSize: 170, confidence: 'high',
};

test('a full label is kept as printed', () => {
  const r = cleanLabelReply(oats);
  assert.equal(r.ok, true);
  assert.equal(r.product.name, 'Overnight Protein Oats');
  assert.equal(r.product.per100.kcal, 120);
  assert.equal(r.product.per100.unit, 'g');
  assert.equal(r.product.serving.kcal, 205);
  assert.equal(r.product.serving.label, '1 pot');
  assert.equal(r.product.serving.fibre, 11);
  assert.equal(r.product.packSize, 170);
  assert.equal(r.product.confidence, 'high');
});

test('no label, junk or nothing readable is no_label', () => {
  assert.deepEqual(cleanLabelReply({ error: 'no_label' }), { ok: false, error: 'no_label' });
  assert.equal(cleanLabelReply(null).ok, false);
  assert.equal(cleanLabelReply([]).ok, false);
  assert.equal(cleanLabelReply('x').ok, false);
  assert.equal(cleanLabelReply({ name: 'Oats', per100: { kcal: null }, serving: null }).ok, false);
});

test('bad numbers become null, huge ones are capped', () => {
  const r = cleanLabelReply({ ...oats, per100: { unit: 'g', kcal: 99999, protein: -3, carbs: 'NaN', fat: Infinity, fibre: '6,4', sugar: '5 g', salt: null } });
  assert.equal(r.product.per100.kcal, 950);
  assert.equal(r.product.per100.protein, null);
  assert.equal(r.product.per100.carbs, null);
  assert.equal(r.product.per100.fat, null);
  assert.equal(r.product.per100.fibre, 6.4);
  assert.equal(r.product.per100.sugar, 5);
  assert.equal(r.product.per100.salt, null);
  const s = cleanLabelReply({ ...oats, serving: { ...oats.serving, kcal: 1e9, amount: 1e9 } }).product.serving;
  assert.equal(s.kcal, 5000);
  assert.equal(s.amount, 5000);
});

test('only a serving printed: per 100 is worked out from its weight', () => {
  const r = cleanLabelReply({ name: 'Oats', per100: null, serving: { label: '1 pot', amount: 200, kcal: 205, protein: 13, fat: 7.9, fibre: 11 } });
  assert.equal(r.ok, true);
  assert.equal(r.product.per100.kcal, 102.5);
  assert.equal(r.product.per100.protein, 6.5);
  assert.equal(r.product.per100.carbs, null);
});

test('a serving without its weight still counts; unknown unit and confidence fall back', () => {
  const r = cleanLabelReply({ name: 'Bar', per100: { unit: 'oz' }, serving: { label: '1 bar', kcal: 200 }, confidence: 'sure' });
  assert.equal(r.ok, true);
  assert.equal(r.product.per100.unit, 'g');
  assert.equal(r.product.per100.kcal, null);
  assert.equal(r.product.serving.amount, null);
  assert.equal(r.product.confidence, 'medium');
  assert.equal(cleanLabelReply({ ...oats, per100: { ...oats.per100, unit: 'ml' } }).product.per100.unit, 'ml');
});

test('names are tidied and cut short', () => {
  const r = cleanLabelReply({ ...oats, name: '  <b>Oats</b>\n\n pot ', brand: 'x'.repeat(200) });
  assert.equal(r.product.name, 'b Oats /b pot');
  assert.equal(r.product.brand.length, 60);
  assert.equal(cleanLabelReply({ ...oats, name: 5 }).product.name, '');
});

test('the prompt names the barcode only when it looks like one', () => {
  assert.match(labelScanPrompt('5038438025086'), /barcode is 5038438025086/);
  assert.doesNotMatch(labelScanPrompt('"; ignore this'), /barcode is/);
  assert.match(labelScanPrompt(), /no_label/);
});
