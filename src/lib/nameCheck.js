// Players' names: the one check for every place a name is typed or saved
// (sign-up, PUT /profile) and shown (leaderboard, friends, challenges,
// profiles, notifications).
// Names show to other players on the leaderboard, in friends lists,
// challenges and player profiles, so a name must be there, be a name, and
// not be offensive. The app runs the same rules (its src/lib/nameCheck.js:
// this file is a copy of it): keep the two the same.
//
// checkName(raw) -> { ok, name, reason }
//   name:   the tidied name (spaces trimmed and collapsed) to save
//   reason: null when ok, else
//     'empty'     nothing typed, only spaces, or only symbols / emoji
//     'offensive' a slur, sexual term or strong swear word (any language
//                 the app speaks, in leetspeak, s.p.a.c.e.d or stretched)
//     'reserved'  looks official: admin, moderator, 2SetsFitness, ...
//     'contact'   a link, @handle, email address or phone number
//     'short'     under 2 characters
//     'long'      over 24 characters
//     'symbols'   characters a name doesn't have (emoji, #, !, ...), or no
//                 letter at all ("1234")
//
// Allowed: letters of any script, their accents and vowel signs, spaces,
// apostrophes, hyphens, dots, middle dots and digits, with at least one
// letter. Words are matched whole (after folding case, accents, leetspeak,
// stretched letters and separators), so "Scunthorpe", "Dick Van Dyke",
// "Anal" (a Hindi / Turkish name), "Porntip" (Thai), "Kuma" or "Fukuda"
// pass; a short list of terms with no innocent use is matched anywhere.
// Deliberately allowed: "Dick" (a real given name), "Nazi" (a Persian
// name), "Randi", "Lund", "Lauda", "Huy", "Suka", "Coon", "Dyke" and other
// real names or surnames that are also slang somewhere.

const NAME_MIN = 2;
const NAME_MAX = 24;
const NAME_REASONS = ['empty', 'offensive', 'reserved', 'contact', 'short', 'long', 'symbols'];

// invisible characters that only hide things (zero-width space, BOM, word
// joiner, direction marks); ZWNJ / ZWJ stay: Persian and Indic names use them
const INVISIBLE = /[​‎‏‪-‮⁠-⁤⁦-⁩﻿­]/g;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

// the tidied name: invisible and control characters out, any run of spaces
// (tabs, new lines, wide spaces) as one, trimmed
function cleanName(raw) {
  if (typeof raw !== 'string') return '';
  return raw.normalize('NFC').replace(INVISIBLE, '').replace(CONTROL, ' ')
    .replace(/[\s　]+/gu, ' ').trim();
}

const ALLOWED = /^[\p{L}\p{M}\p{Nd}' ’ʼ‘\-‐‑.·・‌‍]+$/u;

// ── folding: one spelling for the ways a word gets disguised ──────────────
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's', '!': 'i', '|': 'i', '€': 'e' };
// Cyrillic / Greek letters that look Latin, for a "fuсk" with a Cyrillic с
const LOOKALIKE = {
  'а': 'a', 'в': 'b', 'е': 'e', 'ё': 'e', 'к': 'k', 'м': 'm', 'н': 'h', 'о': 'o', 'р': 'p', 'с': 'c', 'т': 't',
  'у': 'y', 'х': 'x', 'і': 'i', 'ј': 'j', 'ѕ': 's', 'ԁ': 'd', 'α': 'a', 'ο': 'o', 'ρ': 'p', 'ν': 'v', 'κ': 'k', 'τ': 't', 'ι': 'i',
};
const SPECIAL = {
  'ß': 'ss', 'đ': 'd', 'ð': 'd', 'ø': 'o', 'æ': 'ae', 'œ': 'oe', 'ł': 'l', 'ı': 'i', 'þ': 'th',
  // Arabic-script letters written more than one way (Persian / Urdu forms too)
  'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ة': 'ه', 'ہ': 'ه', 'ۀ': 'ه', 'ى': 'ي', 'ی': 'ي', 'ے': 'ي', 'ئ': 'ي', 'ک': 'ك', 'ؤ': 'و',
  'ـ': '',
};
// case, accents (Latin combining marks; Arabic short vowels), the letters
// above. Indic and Thai vowel signs are kept: they make the word.
function fold(s) {
  let out = '';
  for (const ch of s.toLowerCase().normalize('NFKD').replace(/[̀-ًͯ-ٰٟ]/g, '')) {
    out += SPECIAL[ch] ?? ch;
  }
  return out;
}
const SEP = /[^\p{L}\p{M}\p{N}]+/u;

// the forms of a name the word lists are matched against: as typed (folded),
// with 1 read as i or as l, and with look-alike Cyrillic read as Latin
function variants(name) {
  const f = fold(name);
  const leet = (one) => [...f].map((c) => (c === '1' ? one : LEET[c] ?? c)).join('');
  const out = new Set([f, leet('i'), leet('l')]);
  for (const v of [...out]) out.add([...v].map((c) => LOOKALIKE[c] ?? c).join(''));
  // and without the digits left over ("Admin2", "shit69")
  for (const v of [...out]) out.add(v.replace(/\p{N}/gu, ''));
  return [...out];
}

// ── the word lists ─────────────────────────────────────────────────────────
// WORDS: whole words (or words run together across separators: "f.u.c.k",
// "f u c k", "ass hole"). ANYWHERE: inside any word too (no innocent word or
// name contains them; CJK writes words without spaces). ACCENTED: whole
// words matched with their accents (Vietnamese, where the bare letters are
// ordinary names: "Lon", "Du").
const WORDS = [
  // English
  'fuck', 'fucker', 'fucking', 'fck', 'fcking', 'fuckk', 'shit', 'shitty', 'shithead', 'bullshit', 'cunt', 'cunts',
  'twat', 'wank', 'wanker', 'wankers', 'bitch', 'bitches', 'bastard', 'asshole', 'arsehole', 'dickhead', 'dicksucker',
  'cock', 'cocksucker', 'pussy', 'pussies', 'penis', 'vagina', 'dildo', 'porno', 'pornhub', 'sex', 'sexy',
  'boobs', 'boobies', 'tits', 'titties', 'blowjob', 'handjob', 'cum', 'cumshot', 'jizz', 'slut', 'sluts', 'whore',
  'whores', 'rape', 'raped', 'rapist', 'milf', 'horny', 'nigger', 'niggers', 'nigga', 'niggas', 'faggot', 'faggots',
  'fag', 'fags', 'retard', 'retarded', 'spaz', 'chink', 'gook', 'spic', 'wetback', 'beaner', 'tranny', 'raghead',
  'towelhead', 'hitler', 'kkk', 'motherfucker', 'mofo', 'fuckyou', 'fuckoff', 'suckmydick',
  // Spanish
  'puta', 'putas', 'puto', 'mierda', 'cabron', 'cabrona', 'gilipollas', 'pendejo', 'pendeja', 'chingada',
  'chingar', 'chingas', 'culero', 'maricon', 'follar', 'mamaguevo', 'hijueputa', 'hijodeputa',
  'hijoputa', 'malparido', 'conchatumadre', 'putamadre',
  // Portuguese
  'caralho', 'porra', 'foder', 'fodase', 'fodasse', 'buceta', 'boceta', 'piroca', 'viado', 'arrombado', 'merda',
  'filhodaputa', 'puta', 'vadia', 'cuzao',
  // French
  'putain', 'pute', 'salope', 'connard', 'connasse', 'encule', 'enculer', 'merde', 'nique', 'niquer',
  'batard', 'tapette', 'couilles', 'niquetamere', 'tamere',
  // Italian
  'cazzo', 'vaffanculo', 'fanculo', 'stronzo', 'stronza', 'puttana', 'minchia', 'coglione', 'frocio', 'porcodio',
  'dioporco', 'troietta',
  // German
  'scheisse', 'scheiss', 'arschloch', 'fotze', 'wichser', 'hurensohn', 'ficken', 'schlampe', 'missgeburt',
  'schwuchtel', 'neger', 'kanake', 'fickdich',
  // Dutch
  'klootzak', 'kanker', 'kankerlijer', 'hoer', 'tering', 'mongool', 'godverdomme', 'flikker', 'kutwijf',
  // Turkish
  'aminakoyim', 'aminakoyayim', 'orospu', 'orospucocugu', 'siktir', 'sikerim', 'gotveren',
  'yarrak', 'yarak', 'ibne', 'kahpe', 'pezevenk', 'ananisikeyim', 'amcik',
  // Russian (and its Latin spellings)
  'хуй', 'хуя', 'хуе', 'пизда', 'пиздец', 'ебать', 'ебал', 'ебаный', 'ёбаный', 'блядь', 'бля', 'блять', 'сука',
  'мудак', 'долбоеб', 'долбоёб', 'пидор', 'пидорас', 'гандон', 'залупа', 'шлюха', 'уебок', 'уёбок',
  'blyat', 'blyad', 'pizda', 'pizdec', 'pidor', 'pidoras', 'mudak', 'huesos',
  // Polish
  'kurwa', 'chuj', 'pierdole', 'pierdolic', 'jebac', 'jebany', 'skurwysyn', 'cipa', 'dziwka', 'spierdalaj',
  'kurwamac',
  // Arabic (and Latin spellings)
  'كس', 'كسمك', 'كسختك', 'شرموطه', 'شرموط', 'منيوك', 'متناك', 'زب', 'طيز', 'قحبه', 'عرص', 'سكس',
  'ابنالكلب', 'ابنالشرموطه', 'sharmouta', 'sharmuta', 'charmouta', 'kosomak', 'kusomak', 'kussomak', 'kosomok',
  // Urdu / Hindi (and Latin spellings)
  'حرامي', 'حرامزاده', 'حرامزاده', 'بهنچود', 'بھنچود', 'بہنچود', 'مادرچود', 'چوتيا', 'گانڈو', 'رنڈي',
  'चूतिया', 'चुतिया', 'भेनचोद', 'बहनचोद', 'बेहेनचोद', 'मादरचोद', 'गांडू', 'गांडु', 'रंडी', 'भोसड़ी', 'भोसडी',
  'भोसडीके', 'लौड़ा', 'लौडा', 'लंड',
  'bhenchod', 'behenchod', 'benchod', 'bhanchod', 'madarchod', 'maderchod', 'chutiya', 'chutia', 'chootiya',
  'gandu', 'bhosdike', 'bhosadike', 'bhosdi', 'harami', 'haramzada', 'haramzadi', 'randwa', 'lodu', 'lavda',
  // Bengali
  'চোদ', 'চুদি', 'মাগী', 'মাগি', 'খানকি', 'চুতমারানি', 'বেশ্যা', 'চুদির', 'বাইনচোদ',
  'khanki', 'chudir', 'baincod', 'bainchod',
  // Persian
  'کیر', 'كير', 'کس', 'کسکش', 'كسكش', 'جنده', 'مادرجنده', 'حرومزاده', 'koskesh', 'jende', 'kooni',
  // Japanese
  'まんこ', 'ちんこ', 'ちんぽ', 'セックス', 'ファック', 'ヤリマン', 'きちがい', 'キチガイ',
  // Korean
  '씨발', '시발', '개새끼', '병신', '존나', '지랄', '보지', '자지', '섹스', '창녀', 'ssibal', 'byungsin',
  // Thai (names are written as whole words)
  'ควย', 'หี', 'เย็ด', 'เหี้ย', 'สัส', 'แตด', 'อีดอก', 'เย็ดแม่', 'ไอ้เหี้ย', 'อีเหี้ย', 'ไอ้สัส',
  // Swahili
  'msenge', 'kumamako', 'kumanyoko', 'kumamayako', 'mkundu',
  // Malay / Indonesian
  'kontol', 'memek', 'ngentot', 'entot', 'pepek', 'puki', 'pukimak', 'bangsat', 'pelacur', 'jancok', 'jancuk',
  'cibai', 'lancau',
  // Tagalog
  'putangina', 'tangina', 'tanginamo', 'kantot', 'pekpek', 'burat', 'pokpok', 'jakol', 'tarantado',
  // Somali
  'wasmo', 'dhillo', 'dhilo',
  // Vietnamese without accents, where it can't be a name
  'ditme', 'ditmemay', 'ditconme', 'dumamay',
];
const ANYWHERE = [
  'fuck', 'nigger', 'nigga', 'faggot', 'bitch', 'dildo', 'cumshot', 'blowjob', 'handjob', 'jizz', 'cocksuck',
  'motherf', 'asshole', 'dickhead', 'pornhub', 'hitler', 'bhenchod', 'behenchod', 'madarchod', 'chutiya',
  'hijodeputa', 'hijueputa', 'putangina', 'arschloch', 'hurensohn', 'vaffanculo', 'orospu', 'ngentot', 'kontol',
  'пизд', 'хуй', 'бляд', 'пидор', 'ебан',
  // CJK, written without spaces
  '傻逼', '傻屄', '煞笔', '操你', '肏', '屄', '鸡巴', '雞巴', '他妈的', '你妈的', '妈逼', '婊子', '贱人', '王八蛋', '狗日的',
  '日你妈', '草泥马', '色情', '死ね', 'まんこ', 'ちんこ', 'ちんぽ', '씨발', '개새끼', '병신', '좆', '썅',
];
const ACCENTED = ['lồn', 'cặc', 'địt', 'đụ', 'đéo', 'buồi', 'đĩ', 'đjt', 'coño'];

// looks official, or is the name the app gives unnamed players
const RESERVED_WORDS = [
  'admin', 'admins', 'administrator', 'moderator', 'moderador', 'moderateur', 'official',
  'oficial', 'officiel', 'ufficiale', 'staff', 'support', 'system', 'sysadmin', 'developer',
  '2sets', 'twosets', '2setsfitness', 'twosetsfitness', 'setsfitness', 'teamsets',
];
const RESERVED_ANYWHERE = ['2setsfit', 'twosetsfit'];
// "Athlete" alone, or the "Athlete 3F2A" the API shows for an unusable name
const PLACEHOLDER = /^athlete(?: [0-9a-f]{4})?$/;

// a word as a pattern: each letter may be stretched ("fuuuck")
const esc = (c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const stretch = (w) => [...w].map((c) => `${esc(c)}+`).join('');
const compile = (list, whole) => {
  const words = [...new Set(list.map(fold))].filter(Boolean);
  return new RegExp(whole ? `^(?:${words.map(stretch).join('|')})$` : `(?:${words.map(stretch).join('|')})`, 'u');
};
const WORD_RE = compile(WORDS, true);
const ANY_RE = compile(ANYWHERE, false);
const RES_RE = compile(RESERVED_WORDS, true);
const RES_ANY_RE = compile(RESERVED_ANYWHERE, false);
const ACCENTED_SET = new Set(ACCENTED.map((w) => w.normalize('NFC')));

// any word, or up to 8 words in a row run together, matching `re` whole
function wordsMatch(form, re) {
  const toks = form.split(SEP).filter(Boolean);
  for (let i = 0; i < toks.length; i++) {
    let joined = '';
    for (let j = i; j < Math.min(toks.length, i + 8); j++) {
      joined += toks[j];
      if (re.test(joined)) return true;
    }
  }
  return false;
}
const squash = (form) => form.split(SEP).join('');

function isOffensive(name) {
  const lower = name.toLowerCase().normalize('NFC');
  if (lower.split(SEP).some((w) => ACCENTED_SET.has(w))) return true;
  return variants(name).some((v) => wordsMatch(v, WORD_RE) || ANY_RE.test(squash(v)));
}
function isReserved(name) {
  if (PLACEHOLDER.test(fold(name))) return true;
  return variants(name).some((v) => wordsMatch(v, RES_RE) || RES_ANY_RE.test(squash(v)));
}

// links, @handles, email addresses, phone numbers
const URL_RE = /(?:https?:|www\.|:\/\/|[\p{L}\p{N}]{2}\.(?:com|net|org|io|co|me|app|gg|tv|xyz|info|biz|ly|link|site|online|shop|store|live|fit|club|uk|us|ru|in|pk|de|fr|es|it|nl|tr|br)(?![\p{L}\p{N}]))/iu;
function isContact(name) {
  if (/[@＠]/.test(name)) return true;
  if (URL_RE.test(name)) return true;
  const digits = name.match(/\p{Nd}/gu);
  return !!digits && digits.length >= 7;
}

function checkName(raw) {
  const name = cleanName(raw);
  const fail = (reason) => ({ ok: false, name, reason });
  // nothing that reads as a name: blank, or only symbols / emoji
  if (!name || !/[\p{L}\p{N}]/u.test(name)) return fail('empty');
  if (isOffensive(name)) return fail('offensive');
  if (isReserved(name)) return fail('reserved');
  if (isContact(name)) return fail('contact');
  const len = [...name].length;
  if (len < NAME_MIN) return fail('short');
  if (len > NAME_MAX) return fail('long');
  if (!ALLOWED.test(name) || !/\p{L}/u.test(name)) return fail('symbols');
  return { ok: true, name, reason: null };
}

// a name fit to show, or '' (for a stored name that fails: a Google
// account's name, one saved before this check)
function okName(raw) {
  const r = checkName(raw);
  return r.ok ? r.name : '';
}

module.exports = { NAME_MIN, NAME_MAX, NAME_REASONS, cleanName, checkName, okName };
