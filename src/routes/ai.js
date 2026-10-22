const router    = require('express').Router();
const Anthropic = require('@anthropic-ai/sdk');
const pool      = require('../db');
const auth      = require('../middleware/auth');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Helper — calls Claude Haiku with a prompt, returns the text response
async function ask(prompt, maxTokens = 400) {
  const msg = await anthropic.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: maxTokens,
    messages:   [{ role: 'user', content: prompt }],
  });
  return msg.content[0].text;
}

// Strip markdown code fences that Claude sometimes adds despite instructions
function parseJSON(text) {
  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  return JSON.parse(stripped);
}

const { langDirective, COACH_STYLE, splitCoachNote, clean } = require('../lib/aiText');
const { aiQuota } = require('../lib/aiQuota');

// per-user daily caps on every AI call (src/lib/aiQuota.js), after the token check
const quota = (endpoint) => aiQuota(pool, endpoint);

// ─── POST /ai/coach ──────────────────────────────────────────────────────────
// Body: { exercise, reps, weight, units, setNum, setsPlanned, recentSets,
//         score, usingWeights, context, lang }
// Returns a coaching tip for the next set. The app sends what the athlete
// already did (sets left, earlier exercises, the same muscles trained in the
// last days, fatigue) as `context`, or, from builds before this route read
// it, as "[coach context: ...]" after the exercise name.
router.post('/coach', auth, quota('coach'), async (req, res) => {
  const { reps, weight, units = 'kg', setNum, setsPlanned, recentSets = [], score, usingWeights, lang } = req.body;
  const { name: exercise, context: fromName } = splitCoachNote(req.body.exercise);
  const context = clean(req.body.context, 700) || fromName;
  const u = clean(units, 6) || 'kg';
  const sets = Array.isArray(recentSets) ? recentSets.slice(-6) : [];

  const histSummary = sets.length
    ? `Previous sets of this exercise this session: ${sets.map(s => `${s.w ?? s.weight ?? '?'}${u} × ${s.r ?? s.reps ?? '?'}`).join(', ')}.`
    : '';
  const planned = Number(setsPlanned) > 0
    ? `This is set ${setNum} of ${Number(setsPlanned)} planned (${Math.max(0, Number(setsPlanned) - Number(setNum))} left). Never suggest more sets than planned.`
    : '';
  const weightLine = usingWeights === false || !(Number(weight) > 0)
    ? `${clean(reps, 6)} reps (bodyweight or weight not logged, so do not talk about weight)`
    : `${clean(weight, 8)}${u} × ${clean(reps, 6)} reps`;
  const form = Number.isFinite(Number(score)) && score !== null && score !== '' ? `Form score from the camera: ${Math.round(Number(score))}%.` : '';

  const prompt = `You are a strength coach. The athlete just finished set ${clean(setNum, 4)} of ${exercise}: ${weightLine}.
${[histSummary, planned, form].filter(Boolean).join('\n')}
${context ? `What they have already done: ${context}.` : ''}
Write 1-2 sentences of specific feedback for their next set: weight (keep, raise or lower), tempo or technique. If the muscles are already tired from earlier work, say so and do not push for more weight, sets or reps. No filler, no generic encouragement.
${COACH_STYLE}${langDirective(lang)}`;

  try {
    const text = await ask(prompt, 170);
    res.json({ message: text });
  } catch (err) {
    res.status(500).json({ error: 'AI unavailable', detail: err.message });
  }
});
 
// ─── POST /ai/plan ───────────────────────────────────────────────────────────
// Body: { goal, level, daysPerWeek, focusAreas }
// Returns a structured weekly workout plan as JSON.
router.post('/plan', auth, quota('plan'), async (req, res) => {
  const { goal, level, daysPerWeek = 4, focusAreas = [], lang } = req.body;
 
  const prompt = `You are an expert personal trainer. Create a ${daysPerWeek}-day per week
workout programme for a ${level} athlete whose goal is ${goal}.
Focus areas: ${focusAreas.join(', ') || 'general fitness'}.
Return ONLY a JSON array. Each element: { day, name, exercises: [{ name, sets, reps, rest }] }
No extra text, no markdown, only valid JSON.${langDirective(lang, { json: true })}`;
 
  try {
    const text = await ask(prompt, 1200);
    const programme = parseJSON(text);
    res.json({ programme });
  } catch (err) {
    res.status(500).json({ error: 'Plan generation failed', detail: err.message });
  }
});
 
// ─── POST /ai/summary ────────────────────────────────────────────────────────
// Body: { sessions }  — array of last 7 days of workout sessions
// Returns a written weekly progress narrative.
router.post('/summary', auth, quota('summary'), async (req, res) => {
  const { sessions = [], lang } = req.body;
  if (!sessions.length) return res.json({ message: 'No sessions to summarise this week.' });
 
  const sessionText = sessions.map(s =>
    `${s.name}: ${s.sets} sets, ${s.volume}kg total volume, form ${s.formScore ?? '??'}%`
  ).join('\n');
 
  const prompt = `You are a fitness coach writing a weekly progress summary for your athlete.
Here are their workouts from the past 7 days:
${sessionText}
 
Write a 3-4 sentence weekly summary. Cover:
- What went well (volume, consistency, form)
- Any warning signs (missed days, declining reps)
- One specific thing to focus on next week
Be encouraging but honest.${langDirective(lang)}`;
 
  try {
    const text = await ask(prompt, 350);
    res.json({ message: text });
  } catch (err) {
    res.status(500).json({ error: 'Summary generation failed' });
  }
});
 
// How chat answers are laid out: the app shows "**Monday: Push Day**" lines
// as day cards with the "- " lines under them as the exercises, and "- "
// bullets and short paragraphs as such (formcoach-app src/lib/aiFormat.js).
const ADVICE_FORMAT = `Answer like a personal trainer messaging the athlete: specific, practical, friendly. No generic advice.
Keep it short (under 120 words) unless they ask for a plan or programme.
For a weekly plan or programme: one line per day written exactly like "**Monday: Push Day**", then that day's exercises on their own lines as "- Bench press 3x8-10" (rest days as "**Sunday: Rest**"), then at most 2 short tips as "- " bullets.
For anything else: short paragraphs of 1-2 sentences, or "- " bullets for lists. Put a blank line between parts.
No tables, no headings with #, no arrows, never use em dashes or en dashes.`;

// ─── POST /ai/advice ─────────────────────────────────────────────────────────
// Body: { question, profile }
// Free-form fitness Q&A with user context.
router.post('/advice', auth, quota('advice'), async (req, res) => {
  const { question, profile = {}, lang } = req.body;
 
  const prompt = `You are a knowledgeable personal trainer answering a question from your athlete.
Athlete profile: goal=${profile.goal || 'general fitness'}, level=${profile.level || 'intermediate'}.
Question: ${question}
 
${ADVICE_FORMAT}${langDirective(lang)}`;
 
  try {
    const text = await ask(prompt, 700);
    res.json({ answer: text });
  } catch (err) {
    res.status(500).json({ error: 'Advice unavailable' });
  }
});
 
// ─── POST /ai/plateau ────────────────────────────────────────────────────────
// Body: { exercise, sessions }  — last 8 sessions for one exercise
// Detects stalled progress and returns a specific intervention.
router.post('/plateau', auth, quota('plateau'), async (req, res) => {
  const { exercise, sessions = [], lang } = req.body;
  if (sessions.length < 4) return res.json({ plateau: false, message: 'Not enough data yet.' });
 
  const history = sessions.map(s => `${s.reps} reps @ ${s.formScore ?? '??'}%`).join(', ');
 
  const prompt = `Analyse this ${exercise} performance history over the last ${sessions.length} sessions:
${history}
 
Is the athlete plateauing? Answer in this exact JSON format:
{ "plateau": true/false, "reason": "one sentence reason", "intervention": "one specific change to make" }
Only return valid JSON.${langDirective(lang, { json: true })}`;
 
  try {
    const text = await ask(prompt, 200);
    const result = parseJSON(text);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Plateau analysis failed' });
  }
});
 
// ─── POST /ai/sports-workout ─────────────────────────────────────────────────
// Body: { sport, duration, level }
// Returns a sport-specific training session plan.
router.post('/sports-workout', auth, quota('sports-workout'), async (req, res) => {
  const { sport = 'Football', duration = 60, level = 'intermediate', lang } = req.body;

  const prompt = `You are a sports conditioning coach. Generate a ${duration}-minute ${sport} training session for a ${level} athlete.

Return ONLY a JSON object in this exact format (no markdown, no extra text):
{
  "warmup": "2-3 sentence warmup description",
  "drills": [
    { "name": "drill name", "duration": "X min", "desc": "one line description" },
    { "name": "drill name", "duration": "X min", "desc": "one line description" },
    { "name": "drill name", "duration": "X min", "desc": "one line description" }
  ],
  "conditioning": "2 sentence conditioning block description",
  "cooldown": "1 sentence cooldown"
}

Make it specific to ${sport}. Include 3-5 drills. Fit everything within ${duration} minutes.${langDirective(lang, { json: true })}`;

  try {
    const text = await ask(prompt, 600);
    const plan = parseJSON(text);
    res.json({ plan });
  } catch (err) {
    res.status(500).json({ error: 'Plan generation failed', detail: err.message });
  }
});

// ─── POST /ai/meal-scan ───────────────────────────────────────────────────────
// Body: { imageBase64: string, mimeType?: string }
// Returns estimated nutrition from a meal photo using Claude vision.
// The app shrinks the photo to ~640 px first; up to ~1.4 MB of base64 is
// accepted (app.js gives /ai a 2 MB body limit).
const MEAL_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
router.post('/meal-scan', auth, quota('meal-scan'), async (req, res) => {
  const { imageBase64, mimeType = 'image/jpeg', lang } = req.body;
  if (!imageBase64 || typeof imageBase64 !== 'string') return res.status(400).json({ error: 'No image provided' });
  if (imageBase64.length > 1_400_000) return res.status(413).json({ error: 'Image too large' });
  if (!MEAL_TYPES.has(mimeType)) return res.status(400).json({ error: 'Unsupported image type' });

  try {
    const msg = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 700,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mimeType, data: imageBase64 },
          },
          {
            type: 'text',
            text: `Analyse this meal photo and estimate nutrition. Be realistic with portion sizes.
Return ONLY valid JSON, no markdown fences:
{"items":[{"name":"food name","amount":150,"unit":"g","calories":230,"protein":8,"carbs":30,"fat":7}],"total":{"calories":230,"protein":8,"carbs":30,"fat":7},"confidence":"high"}
confidence must be "high", "medium", or "low". Include every distinct food item visible.
If there is no food in the photo, return {"items":[],"total":{"calories":0,"protein":0,"carbs":0,"fat":0},"confidence":"low"}.${langDirective(lang, { json: true })}`,
          },
        ],
      }],
    });

    const result = parseJSON(msg.content[0].text);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Meal scan failed', detail: err.message });
  }
});

module.exports = router;
