// Which Claude model the AI routes use, and reading its reply.
//
// Claude Haiku 5.5 by default: newer and smarter than Haiku 4.5 and a tenth
// of its price. It thinks before it answers (adaptive thinking; `effort`
// sets how much), so max_tokens gets room for that on top of the answer,
// and the reply is read from its text blocks, not content[0]. No sampling
// parameters and no assistant prefill: this model rejects both.
//
// Env: AI_MODEL for every route, AI_CHAT_MODEL for the coach chat
// (/ai/advice) only, e.g. claude-sonnet-5-5 for sharper answers at about
// 20x the cost per reply.

const DEFAULT_MODEL = 'claude-haiku-5-5';

function models(env = process.env) {
  const all = (env.AI_MODEL || '').trim() || DEFAULT_MODEL;
  return { all, chat: (env.AI_CHAT_MODEL || '').trim() || all };
}

// thinking counts toward max_tokens; this much on top of the answer's own cap
const THINK_ROOM = { low: 1500, medium: 3000, high: 6000 };

function request({ model, prompt, content, maxTokens, effort = 'low' }) {
  return {
    model,
    max_tokens: maxTokens + (THINK_ROOM[effort] || THINK_ROOM.low),
    output_config: { effort },
    messages: [{ role: 'user', content: content || prompt }],
  };
}

// the answer text; throws on a refusal or an answer cut off before any text
function replyText(msg) {
  if (msg?.stop_reason === 'refusal') throw new Error('AI declined the request');
  const text = (msg?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  if (!text) throw new Error(`AI reply had no text (${msg?.stop_reason || 'unknown'})`);
  return text;
}

module.exports = { DEFAULT_MODEL, models, request, replyText };
