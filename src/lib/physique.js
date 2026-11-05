// POST /ai/physique: a physique estimate from one photo, for the app's
// "Scan your physique" (formcoach-app src/components/PhysiqueScan.js): a body
// fat range (never one number), a 0-100 physique score and level, and the
// muscle groups that look strong and the ones with room to grow. The app
// draws the 12-week projection itself from the score and level.
// The photo is only passed to the model: never stored, never logged (errors
// log their message only), never in the database.
// A guest gets one scan per install (aiQuota.js), so it is open before sign-in.

// the app's muscle groups (formcoach-app src/progression/muscles.ts GROUPS,
// the i18n 'group.*' names), the ones a photo can show
const PHYSIQUE_GROUPS = ['chest', 'back', 'shoulders', 'arms', 'core', 'legs'];
const LEVELS = ['beginner', 'novice', 'intermediate', 'advanced'];
// why a photo can't be read: the app shows a kind "try another photo"
// (under_16: the scan is for 16 and over)
const REASONS = ['no_person', 'multiple_people', 'under_16', 'not_suitable', 'unclear'];
// refusals that are only the photo (a guest may try another one)
const PHOTO_REASONS = new Set(['no_person', 'multiple_people', 'unclear']);

const BF_MIN = 3;
const BF_MAX = 60;
const MAX_NOTE = 200;
// words a note must never use about someone's body (the prompt asks for
// kind wording; a note that slips through anyway is dropped)
const UNKIND = /\b(obese|ugly|flabby|chubby|skinny|scrawny|lazy|gross|disgusting|pudgy|overweight|out of shape|fatty|weakling)\b/i;

const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));
const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// the level a score falls in, when the model's own is missing or odd
function levelForScore(score) {
  if (score < 30) return 'beginner';
  if (score < 50) return 'novice';
  if (score < 75) return 'intermediate';
  return 'advanced';
}

function groupList(v, skip = new Set()) {
  const out = [];
  for (const g of Array.isArray(v) ? v : []) {
    const id = String(g ?? '').trim().toLowerCase();
    if (PHYSIQUE_GROUPS.includes(id) && !skip.has(id) && !out.includes(id)) out.push(id);
    if (out.length >= 3) break;
  }
  return out;
}

/**
 * The model's answer made safe for the app. Never trusts the raw reply:
 * { ok: true, bodyFatLow, bodyFatHigh, score, level, strengths, focus, note }
 * with whole-number body fat between 3 and 60 (low <= high, 2 to 8 points
 * apart), a score of 0-100, a known level and known muscle groups (3 at most
 * each, none in both), or { ok: false, reason } with a known reason.
 */
function cleanPhysiqueReply(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  if (r.ok !== true) return { ok: false, reason: REASONS.includes(r.reason) ? r.reason : 'unclear' };
  let lo = num(r.bodyFatLow);
  let hi = num(r.bodyFatHigh);
  const score = num(r.score);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || !Number.isFinite(score)) return { ok: false, reason: 'unclear' };
  if (lo > hi) [lo, hi] = [hi, lo];
  lo = Math.min(BF_MAX, Math.max(BF_MIN, Math.round(lo)));
  hi = Math.min(BF_MAX, Math.max(BF_MIN, Math.round(hi)));
  // a range, never one number; and not so wide it says nothing
  const mid = (lo + hi) / 2;
  if (hi - lo < 2) { lo = Math.floor(mid - 1); hi = lo + 2; }
  if (hi - lo > 8) { lo = Math.round(mid - 4); hi = lo + 8; }
  if (lo < BF_MIN) { hi += BF_MIN - lo; lo = BF_MIN; }
  if (hi > BF_MAX) { lo -= hi - BF_MAX; hi = BF_MAX; }
  const s = Math.min(100, Math.max(0, Math.round(score)));
  const level = LEVELS.includes(r.level) ? r.level : levelForScore(s);
  const strengths = groupList(r.strengths);
  const focus = groupList(r.focus, new Set(strengths));
  const note = text(r.note, MAX_NOTE);
  return { ok: true, bodyFatLow: lo, bodyFatHigh: hi, score: s, level, strengths, focus, note: UNKIND.test(note) ? '' : note };
}

// what the user told the app, if anything (only believable values)
function aboutLine({ sex, heightCm, weightKg } = {}) {
  const parts = [];
  if (sex === 'male' || sex === 'female') parts.push(`sex: ${sex}`);
  const h = num(heightCm);
  if (Number.isFinite(h) && h >= 100 && h <= 250) parts.push(`height: ${Math.round(h)} cm`);
  const w = num(weightKg);
  if (Number.isFinite(w) && w >= 30 && w <= 300) parts.push(`weight: ${Math.round(w)} kg`);
  return parts.length ? `\nThe person told the app: ${parts.join(', ')}.` : '';
}

function physiquePrompt(about) {
  return `You are a kind, experienced fitness coach looking at one photo a person took of their own physique, to give them a rough starting point for training. Estimates only, not medical advice.
First check the photo. Answer with ONLY {"ok":false,"reason":"..."} when:
- "no_person": there is no person in it;
- "multiple_people": more than one person is clearly shown;
- "under_16": the person looks younger than 16 (when in doubt, refuse);
- "not_suitable": there is nudity beyond normal gym wear or being shirtless, or anything sexual;
- "unclear": the body can't be seen well enough (too dark, blurry, too far, mostly covered).
Otherwise estimate from what you can see:
- bodyFatLow and bodyFatHigh: a realistic body fat percentage range, 3 to 6 points wide (whole numbers);
- score: 0-100 for muscular development and conditioning together (30 a typical untrained adult, 50 someone who trains, 75 well trained, 90+ competitive);
- level: "beginner", "novice", "intermediate" or "advanced";
- strengths: 1-3 muscle groups that look most developed, and focus: 1-3 with the most room to grow, each from exactly: ${PHYSIQUE_GROUPS.join(', ')} (lower case, never the same group in both);
- note: one short, warm, encouraging sentence about where they can go from here.
Be kind and non-judgemental: never comment on attractiveness, never use words like fat, skinny, obese or weak about the person, and frame focus areas as room to grow. Don't describe the person, their face or their clothes.${about}
Return ONLY valid JSON, no markdown fences, exactly like:
{"ok":true,"bodyFatLow":14,"bodyFatHigh":18,"score":62,"level":"intermediate","strengths":["shoulders","arms"],"focus":["chest","legs"],"note":"Solid base to build on."}`;
}

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * The route's handler. deps: { create(request) -> Anthropic message, models,
 * request, replyText, parseJSON, langDirective } (the tests pass a fake create).
 * The image is never logged or kept: it goes to the model and is gone with
 * the request.
 */
function physiqueHandler({ create, models, request, replyText, parseJSON, langDirective }) {
  return async function physique(req, res) {
    const { imageBase64, mimeType = 'image/jpeg', lang, sex, heightCm, weightKg } = req.body || {};
    if (!imageBase64 || typeof imageBase64 !== 'string') return res.status(400).json({ error: 'No image provided' });
    if (imageBase64.length > 1_400_000) return res.status(413).json({ error: 'Image too large' });
    if (!IMAGE_TYPES.has(mimeType)) return res.status(400).json({ error: 'Unsupported image type' });
    try {
      const msg = await create(request({
        // the meal scan's model (aiModel.js: Sonnet by default): one image, a short answer
        model: models().scan,
        effort: 'low',
        maxTokens: 300,
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } },
          { type: 'text', text: `${physiquePrompt(aboutLine({ sex, heightCm, weightKg }))}${langDirective(lang, { json: true })}` },
        ],
      }));
      const out = cleanPhysiqueReply(parseJSON(replyText(msg)));
      // a photo that only needs retaking: a guest may try another one
      if (!out.ok && PHOTO_REASONS.has(out.reason)) res.locals?.aiRetry?.();
      res.json(out);
    } catch (err) {
      console.error('Physique scan failed:', err.message);
      res.locals?.aiRefund?.();
      res.status(500).json({ error: 'Physique scan failed' });
    }
  };
}

module.exports = {
  PHYSIQUE_GROUPS, LEVELS, REASONS, cleanPhysiqueReply, physiquePrompt, aboutLine, physiqueHandler, levelForScore,
};
