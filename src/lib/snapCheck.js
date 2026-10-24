// The check a proof snap passes before it's delivered (routes/snaps.js): a
// workout photo, a selfie after training, a screen of a run, is fine; nudity
// or anything sexual, violence or gore, hate symbols, drugs or weapons, or a
// photo of someone else's private information are not. Claude reads the
// photo (the meal-scan model, lib/aiModel.js); anything it can't clear, or a
// failed check, is not delivered.
const Anthropic = require('@anthropic-ai/sdk');
const { models, request, replyText } = require('./aiModel');

let client = null;
const anthropic = () => (client ||= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }));

const PROMPT = `You check photos that users of a fitness app send each other as "proof" after a workout (a gym selfie, a sweaty face, a watch or treadmill screen, a medal, a meal). Decide if this photo can be delivered.
Block it if it shows any of: nudity or partial nudity (underwear, bare chest of a woman, exposed genitals or buttocks), sexual or suggestive content, anyone who looks under 13, violence, blood or injury gore, self-harm, weapons, drugs, hate symbols or gestures, or readable private documents (cards, IDs).
Ordinary gym clothes, shorts, sports bras and a man training shirtless are fine.
Return ONLY JSON, no markdown: {"ok":true} or {"ok":false,"reason":"nudity|sexual|minor|violence|selfharm|weapon|drugs|hate|private|other"}`;

const REASONS = new Set(['nudity', 'sexual', 'minor', 'violence', 'selfharm', 'weapon', 'drugs', 'hate', 'private', 'other']);

/** { ok: true } | { ok: false, reason }; throws when the check couldn't run */
async function checkSnap(imageBase64, mimeType = 'image/jpeg', { ask } = {}) {
  const run = ask || ((body) => anthropic().messages.create(body));
  let msg;
  try {
    msg = await run(request({
      model: models().all,
      maxTokens: 60,
      content: [
        { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } },
        { type: 'text', text: PROMPT },
      ],
    }));
  } catch (e) {
    if (/declined|refus/i.test(e?.message || '')) return { ok: false, reason: 'other' };
    throw e;
  }
  if (msg?.stop_reason === 'refusal') return { ok: false, reason: 'other' };
  const text = replyText(msg).replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const r = JSON.parse(text);
  if (r?.ok === true) return { ok: true };
  return { ok: false, reason: REASONS.has(r?.reason) ? r.reason : 'other' };
}

module.exports = { checkSnap };
