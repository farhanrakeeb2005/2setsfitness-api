// Shared text for the AI routes: the reply language, the coaching style the
// app expects, and the context note the app sends with a coaching request.
// Plain functions (no Anthropic, no database) so the tests run them alone.

// Every language the app offers (its codes, Korean is 'kr'); a regional code
// ('pt-BR', 'es-AR', 'fr-CA') falls back to its base language.
const LANG_NAMES = {
  en: 'English', ar: 'Arabic', ur: 'Urdu', es: 'Spanish', fr: 'French',
  pt: 'Portuguese', tr: 'Turkish', de: 'German', it: 'Italian', nl: 'Dutch',
  ru: 'Russian', hi: 'Hindi', ja: 'Japanese', kr: 'Korean', ko: 'Korean',
  vi: 'Vietnamese', th: 'Thai', tl: 'Filipino (Tagalog)', fil: 'Filipino (Tagalog)',
  ms: 'Malay', id: 'Indonesian', sw: 'Swahili', bn: 'Bengali', fa: 'Persian',
  so: 'Somali', pl: 'Polish', zh: 'Simplified Chinese', 'zh-CN': 'Simplified Chinese',
  'pt-BR': 'Brazilian Portuguese', 'es-AR': 'Argentine Spanish', 'fr-CA': 'Canadian French',
};

function langName(lang) {
  if (typeof lang !== 'string' || !lang) return 'English';
  return LANG_NAMES[lang] || LANG_NAMES[lang.split(/[-_]/)[0].toLowerCase()] || 'English';
}

// appended to a prompt: reply in the user's language (nothing for English).
// json: the reply is JSON the app reads, so only its text values change
function langDirective(lang, { json = false } = {}) {
  const name = langName(lang);
  if (name === 'English') return '';
  return json
    ? `\nWrite every text value (names, descriptions, reasons) in ${name}. Keep the JSON keys and fixed values (such as "high", "medium", "low", true, false) exactly as shown, in English.`
    : `\nReply entirely in ${name}. Keep all user-facing text in ${name}.`;
}

// How the app wants the coach to sound (it also cleans replies itself, for
// older servers): a person talking, not generated text.
const COACH_STYLE = `Write like a real coach talking to the athlete between sets: plain, warm, direct.
Never use em dashes or en dashes; use commas or full stops.
When you suggest a weight to move to, give a small range (for example 45-50kg), because machines and plates may not have the exact number.`;

// The app adds "[coach context: ...]" after the exercise name (sets left,
// what's done this workout, the same muscles trained lately, fatigue). Split
// it off so the prompt gets a clean name and the note as its own line.
function splitCoachNote(exercise) {
  const s = String(exercise || '').slice(0, 900);
  const m = s.match(/^(.*?)\s*\[coach context:\s*([\s\S]*?)\]?\s*$/i);
  if (!m) return { name: s.trim().slice(0, 80), context: '' };
  return { name: m[1].trim().slice(0, 80), context: m[2].trim().replace(/\.$/, '').slice(0, 700) };
}

// a free-text field from the app, kept short and on one line for the prompt
const clean = (v, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

module.exports = { LANG_NAMES, langName, langDirective, COACH_STYLE, splitCoachNote, clean };
