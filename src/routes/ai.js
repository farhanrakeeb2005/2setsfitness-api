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
 
// ─── POST /ai/coach ──────────────────────────────────────────────────────────
// Body: { exercise, reps, score, setNum, recentSets }
// Returns a personalised coaching paragraph for the completed set.
router.post('/coach', auth, async (req, res) => {
  const { exercise, reps, score, setNum, recentSets = [] } = req.body;
  const histSummary = recentSets.length
    ? `Recent sessions: ${recentSets.map(s => `${s.reps} reps @ ${s.score}%`).join(', ')}`
    : 'No recent history.';
 
  const prompt = `You are a world-class strength coach giving feedback after a set.
Exercise: ${exercise}
Set ${setNum}: ${reps} reps, ${score ?? 'unknown'}% form score.
${histSummary}
 
Write 1-2 sentences of specific, motivating coaching feedback. Be direct and practical.
Focus on what to improve or reinforce in the NEXT set. No filler phrases.`;
 
  try {
    const text = await ask(prompt, 200);
    res.json({ message: text });
  } catch (err) {
    res.status(500).json({ error: 'AI unavailable', detail: err.message });
  }
});
 
// ─── POST /ai/plan ───────────────────────────────────────────────────────────
// Body: { goal, level, daysPerWeek, focusAreas }
// Returns a structured weekly workout plan as JSON.
router.post('/plan', auth, async (req, res) => {
  const { goal, level, daysPerWeek = 4, focusAreas = [] } = req.body;
 
  const prompt = `You are an expert personal trainer. Create a ${daysPerWeek}-day per week
workout programme for a ${level} athlete whose goal is ${goal}.
Focus areas: ${focusAreas.join(', ') || 'general fitness'}.
Return ONLY a JSON array. Each element: { day, name, exercises: [{ name, sets, reps, rest }] }
No extra text, no markdown — only valid JSON.`;
 
  try {
    const text = await ask(prompt, 1200);
    const programme = JSON.parse(text);
    res.json({ programme });
  } catch (err) {
    res.status(500).json({ error: 'Plan generation failed', detail: err.message });
  }
});
 
// ─── POST /ai/summary ────────────────────────────────────────────────────────
// Body: { sessions }  — array of last 7 days of workout sessions
// Returns a written weekly progress narrative.
router.post('/summary', auth, async (req, res) => {
  const { sessions = [] } = req.body;
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
Be encouraging but honest.`;
 
  try {
    const text = await ask(prompt, 350);
    res.json({ message: text });
  } catch (err) {
    res.status(500).json({ error: 'Summary generation failed' });
  }
});
 
// ─── POST /ai/advice ─────────────────────────────────────────────────────────
// Body: { question, profile }
// Free-form fitness Q&A with user context.
router.post('/advice', auth, async (req, res) => {
  const { question, profile = {} } = req.body;
 
  const prompt = `You are a knowledgeable personal trainer answering a question from your athlete.
Athlete profile: goal=${profile.goal || 'general fitness'}, level=${profile.level || 'intermediate'}.
Question: ${question}
 
Answer in 2-3 sentences. Be specific and practical. No generic advice.`;
 
  try {
    const text = await ask(prompt, 300);
    res.json({ answer: text });
  } catch (err) {
    res.status(500).json({ error: 'Advice unavailable' });
  }
});
 
// ─── POST /ai/plateau ────────────────────────────────────────────────────────
// Body: { exercise, sessions }  — last 8 sessions for one exercise
// Detects stalled progress and returns a specific intervention.
router.post('/plateau', auth, async (req, res) => {
  const { exercise, sessions = [] } = req.body;
  if (sessions.length < 4) return res.json({ plateau: false, message: 'Not enough data yet.' });
 
  const history = sessions.map(s => `${s.reps} reps @ ${s.formScore ?? '??'}%`).join(', ');
 
  const prompt = `Analyse this ${exercise} performance history over the last ${sessions.length} sessions:
${history}
 
Is the athlete plateauing? Answer in this exact JSON format:
{ "plateau": true/false, "reason": "one sentence reason", "intervention": "one specific change to make" }
Only return valid JSON.`;
 
  try {
    const text = await ask(prompt, 200);
    const result = JSON.parse(text);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Plateau analysis failed' });
  }
});
 
module.exports = router;
