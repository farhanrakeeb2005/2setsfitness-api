// POST /ai/container-volume: how much a drinking container holds, from a
// photo (the app's water card saves it as one of the user's containers:
// "My bottle · 750 ml"). The label is read when there is one ("500 ml",
// "0.75 L", "33 cl", "16.9 fl oz"); else the size is estimated from the
// container's type and shape, and the app asks the user to check the size
// when the answer isn't sure (confidence "low", or no ml).
// A logging tool for the AI caps (aiQuota.js LOGGING_ENDPOINTS), like a
// meal scan: never one of the day's coach chats; a guest is asked to sign in.
// The same label parsing is in the app (formcoach-app src/lib/waterContainers.js
// labelToMl; test/crossRepo.test.js checks they agree).

const MIN_ML = 30;
const MAX_ML = 5000;
const US_FL_OZ = 29.5735;

const UNITS = [
  // [pattern after the number, ml per unit, round to]
  [/^(?:ml|mls|millilit(?:re|er)s?)\b/, 1, 1],
  [/^(?:cl|centilit(?:re|er)s?)\b/, 10, 1],
  [/^(?:dl|decilit(?:re|er)s?)\b/, 100, 1],
  [/^(?:fl\.?\s*oz\.?|fluid\s+ounces?|oz\.?|ounces?)(?![a-z])/, US_FL_OZ, 5],
  [/^(?:l|lt|ltr|ltrs|lit(?:re|er)s?)\b/, 1000, 1],
];

/**
 * A volume as written on a label, in ml: "500 ml", "0.75 L", "0,75l", "33 cl",
 * "1.5 litres", "16.9 fl oz" (US ounces, to the nearest 5 ml: 500). The first
 * volume in the text counts ("500 ml (16.9 fl oz)"). null when there is none
 * or it isn't a believable drink (under 30 ml or over 5 L).
 */
function labelToMl(text) {
  const s = String(text ?? '').toLowerCase();
  const re = /(\d+(?:[.,]\d+)?)\s*/g;
  let m;
  while ((m = re.exec(s))) {
    // (a digit right before: "1500" was read whole already)
    if (m.index > 0 && /[\d.,]/.test(s[m.index - 1])) continue;
    const n = Number(m[1].replace(',', '.'));
    const rest = s.slice(m.index + m[0].length);
    for (const [unit, per, step] of UNITS) {
      if (!unit.test(rest)) continue;
      const ml = Math.round((n * per) / step) * step;
      return ml >= MIN_ML && ml <= MAX_ML ? ml : null;
    }
  }
  return null;
}

const CONFIDENCE = new Set(['high', 'medium', 'low']);
const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * The AI's answer made safe for the app: { name, ml, confidence, reason,
 * label }. A readable label wins over the AI's own number; an ml outside
 * 30 ml-5 L, or none, comes back as null with confidence "low" (the app
 * then asks for the size).
 */
function cleanVolume(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const label = text(r.label, 40) || null;
  const fromLabel = labelToMl(label);
  let ml = fromLabel;
  if (ml == null) {
    const n = Number(typeof r.ml === 'string' ? labelToMl(r.ml) ?? r.ml : r.ml);
    ml = Number.isFinite(n) && n >= MIN_ML && n <= MAX_ML ? Math.round(n / 10) * 10 : null;
  }
  let confidence = CONFIDENCE.has(r.confidence) ? r.confidence : 'low';
  if (ml == null) confidence = 'low';
  return { name: text(r.name, 40), ml, confidence, reason: text(r.reason, 160), label: fromLabel != null ? label : null };
}

function containerPrompt() {
  return `This photo shows a drinking container (a glass, mug, cup, can, bottle or flask). Work out how much it holds when full, in millilitres.
1. If a volume is printed or embossed anywhere (label, cap, base, side), read it exactly and copy it into "label" as written, e.g. "500 ml", "0.75 L", "33 cl", "16.9 fl oz". That is the answer, with confidence "high".
2. Otherwise estimate from its type, shape and size, using anything for scale (a hand, a phone, a table): a standard can is 330 ml (355 ml in the US), a tall can 440-500 ml, a small water bottle 500 ml, a large one 1-1.5 L, a sports bottle 600-750 ml, a mug about 300 ml, a tumbler 250 ml, a pint glass 568 ml. Use confidence "medium" when the type makes the size clear, "low" when you can't really tell (opaque, unusual, partly hidden, no label).
Return ONLY valid JSON, no markdown fences:
{"name":"Water bottle","ml":500,"label":"500 ml","confidence":"high","reason":"500 ml is printed on the label"}
name: 1-3 words for what it is. label: null when no volume is readable. reason: one short sentence.
If there is no container in the photo: {"name":"","ml":null,"label":null,"confidence":"low","reason":"No container seen"}.`;
}

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/**
 * The route's handler. deps: { create(request) -> Anthropic message, models,
 * request, replyText, parseJSON, langDirective } (the tests pass a fake create).
 */
function containerVolumeHandler({ create, models, request, replyText, parseJSON, langDirective }) {
  return async function containerVolume(req, res) {
    const { imageBase64, mimeType = 'image/jpeg', lang } = req.body || {};
    if (!imageBase64 || typeof imageBase64 !== 'string') return res.status(400).json({ error: 'No image provided' });
    if (imageBase64.length > 1_400_000) return res.status(413).json({ error: 'Image too large' });
    if (!IMAGE_TYPES.has(mimeType)) return res.status(400).json({ error: 'Unsupported image type' });
    try {
      const msg = await create(request({
        // the meal scan's model (aiModel.js): reading small print on a label
        model: models().scan,
        effort: 'low',
        maxTokens: 300,
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } },
          { type: 'text', text: `${containerPrompt()}${langDirective(lang, { json: true })}` },
        ],
      }));
      res.json(cleanVolume(parseJSON(replyText(msg))));
    } catch (err) {
      console.error('Container volume failed:', err.message);
      res.locals?.aiRefund?.();
      res.status(500).json({ error: 'Container volume failed' });
    }
  };
}

module.exports = { labelToMl, cleanVolume, containerPrompt, containerVolumeHandler, MIN_ML, MAX_ML };
