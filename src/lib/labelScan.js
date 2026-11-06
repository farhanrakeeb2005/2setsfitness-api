// POST /ai/label-scan: a packaged food's nutrition label read from a photo,
// for the app's barcode scanner when Open Food Facts doesn't know the barcode
// (or knows it without calories). The prompt, and the checks on the reply:
// the model's numbers are clamped to sane, finite, non-negative values here
// so a misread can't put 90 000 kcal in someone's diary.

// caps per 100 g/ml (pure fat is ~900 kcal, 100 g of anything is 100 g of
// macros at most; salt up to 100 g for a salt pot)
const PER100_CAPS = { kcal: 950, protein: 100, carbs: 100, fat: 100, fibre: 100, sugar: 100, salt: 100 };
// caps per serving (a big ready meal or a 1 kg tub as "1 pack")
const SERVING_CAPS = { kcal: 5000, protein: 500, carbs: 1000, fat: 500, fibre: 300 };
const MAX_AMOUNT = 5000; // g or ml in one serving or pack

function num(v, cap) {
  if (v === null || v === undefined || v === '') return null;
  let n = Number(v);
  if (typeof v === 'string') {
    // "6,4" or "5 g" as printed; "-3" or "n/a" is no number
    const m = v.trim().replace(',', '.').match(/^\d+(?:\.\d+)?/);
    n = m ? Number(m[0]) : NaN;
  }
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(Math.min(n, cap) * 10) / 10;
}

function text(v, max) {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function pick(src, caps) {
  const out = {};
  for (const k of Object.keys(caps)) out[k] = num(src?.[k], caps[k]);
  return out;
}

// The model's parsed JSON -> { ok: true, product } or { ok: false, error }.
function cleanLabelReply(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'no_label' };
  if (raw.error) return { ok: false, error: 'no_label' };
  const unit = raw.per100?.unit === 'ml' ? 'ml' : 'g';
  const per100 = { unit, ...pick(raw.per100, PER100_CAPS) };
  let serving = null;
  if (raw.serving && typeof raw.serving === 'object') {
    const s = { label: text(raw.serving.label, 40), amount: num(raw.serving.amount, MAX_AMOUNT), ...pick(raw.serving, SERVING_CAPS) };
    if (s.amount === 0) s.amount = null;
    if (s.amount != null || s.kcal != null) serving = s;
  }
  // per 100 missing but a serving with its weight: work per 100 out from it
  if (per100.kcal == null && serving?.kcal != null && serving.amount) {
    const f = 100 / serving.amount;
    for (const k of ['kcal', 'protein', 'carbs', 'fat', 'fibre']) {
      if (per100[k] == null && serving[k] != null) per100[k] = num(serving[k] * f, PER100_CAPS[k]);
    }
  }
  if (per100.kcal == null && serving?.kcal == null) return { ok: false, error: 'no_label' };
  const confidence = ['high', 'medium', 'low'].includes(raw.confidence) ? raw.confidence : 'medium';
  return {
    ok: true,
    product: {
      name: text(raw.name, 80),
      brand: text(raw.brand, 60),
      per100,
      serving,
      packSize: num(raw.packSize, MAX_AMOUNT) || null,
      confidence,
    },
  };
}

function labelScanPrompt(barcode) {
  const code = /^\d{6,14}$/.test(String(barcode || '')) ? ` Its barcode is ${barcode}.` : '';
  return `This is a photo of a packaged food or drink: its printed nutrition table and/or the front of the pack.${code}
Read the numbers exactly as printed. Use kcal, never kJ (when only kJ is printed, divide by 4.184). Use grams for protein, carbs (carbohydrate), fat, fibre, sugar (of which sugars) and salt.
"per100" is the per 100 g (or per 100 ml for drinks) column. "serving" is the per serving / per pot / per pack column when printed, with its label as written (e.g. "1 pot", "1 bar", "30 g") and its weight in g or ml as "amount". Front-of-pack figures such as "205 kcal" or "13 g protein" for one pot count as the serving.
"packSize" is the pack's net weight or volume in g or ml when printed (e.g. 350 for "350g").
"name" is the product name and "brand" the brand, as on the pack ("" when not visible).
Use null for any number that is not printed. Don't guess numbers that aren't on the pack.
Return ONLY valid JSON, no markdown fences:
{"name":"Overnight protein oats","brand":"Brand","per100":{"unit":"g","kcal":120,"protein":7.6,"carbs":14,"fat":4.6,"fibre":6.4,"sugar":5,"salt":0.2},"serving":{"label":"1 pot","amount":170,"kcal":205,"protein":13,"carbs":24,"fat":7.9,"fibre":11},"packSize":170,"confidence":"high"}
"serving" is null when there is no per-serving figure. confidence is "high", "medium" or "low" (low when the label is blurry or partly hidden).
If no nutrition label or printed nutrition numbers can be read, return {"error":"no_label"}.`;
}

module.exports = { cleanLabelReply, labelScanPrompt, PER100_CAPS, SERVING_CAPS };
