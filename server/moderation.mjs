/**
 * AGEROUS — chat / display-name moderation. Pure functions, no dependencies.
 *
 *   moderate(text) → { text, links, profanity, empty }
 *     • strips control characters and angle brackets
 *     • removes links: http(s)://, www., bare domains (spam.xyz/free), emails, "spam dot com" forms
 *     • masks profanity and slurs, including leetspeak (f**k → f@ck, sh1t), stretched letters
 *       (fuuuck) and spaced-out letters (f u c k)
 *   isCleanName(name) → false when a display name would need masking or contains a link
 *
 * It is a seatbelt, not a substitute for a moderator: a public chat still needs a spend cap,
 * rate limits (see handlers.mjs) and the admin "clear" switch.
 */

// Written in "collapsed" form: normalize() folds repeated letters, so "kill" is "kil" here and
// "fuuuuck" still matches. Endings are listed explicitly so innocent words ("shiitake") are safe.
const WORDS = [
  '(?:mother)?(?:f[ua*#v]c?k|fck)(?:s|ed|er|ers|ing|face|head|wit|wits)?', 'shit(?:s|ty|head|ed|ting|hole|face)?', 'bulshit', 'bitch(?:es|y|ing)?',
  'cunt(?:s)?', 'ashole(?:s)?', 'bastard(?:s)?', 'dickhead(?:s)?', 'pusy', 'whore(?:s)?', 'slut(?:s|ty)?', 'wanker(?:s)?', 'twat(?:s)?',
  'prick(?:s)?', 'cock(?:s)?', 'cocksucker(?:s)?', 'nige?r(?:s)?', 'niga(?:s)?', 'fagot(?:s)?', 'retard(?:s|ed)?', 'trany', 'chink(?:s)?', 'spic(?:s)?', 'kike(?:s)?',
  'rape(?:d|s|ist|ists)?', 'kys', 'kil\\s*(?:your|ur)\\s*self', 'go\\s*die', 'ashawo', 'oloshi', 'olosho',   // last three: common Nigerian insults
];
const WORD_RE = new RegExp(`(?<![a-z0-9])(?:${WORDS.join('|')})(?![a-z0-9])`, 'g');

const LEET = { '@': 'a', '4': 'a', '3': 'e', '1': 'i', '!': 'i', '|': 'i', '0': 'o', '$': 's', '5': 's', '7': 't', '+': 't', '8': 'b', '€': 'e' };

/** Lower-case, de-leet and collapse repeated letters; map[i] = index in the original text. */
function normalize(text) {
  let norm = '', map = [];
  for (let i = 0; i < text.length; i++) {
    let c = text[i].toLowerCase();
    c = LEET[c] ?? c;
    if (c.length === 1 && norm.endsWith(c) && /[a-z]/.test(c)) continue;      // fuuuck → fuck
    norm += c; map.push(i);
  }
  return { norm, map };
}

// Unambiguous TLDs match as bare domains ("spam.xyz"). Short ones that are also common typos
// ("yes.In the morning") only count when a path follows ("bit.me/free").
const STRONG = 'com|net|org|io|app|dev|xyz|gg|tv|info|biz|ru|cn|top|site|online|link|click|shop|store|live|tk|ml|ga|cf|gq|vip|pw|fun|icu|club|win|bid|cash|money|zip|ng|su';
const WEAK = 'co|me|ly|ai|to|cc|in|us|uk|de|eu|fr|ws|gl|mov';
const LINK_RES = [
  /\bhttps?:\/\/\S+/gi,
  /\b(?:www|ftp)\.\S+/gi,
  /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g,                                                  // emails
  new RegExp(`\\b[a-z0-9-]{2,}(?:\\.[a-z0-9-]+)*\\.(?:${STRONG})\\b(?:[/:?#]\\S*)?`, 'gi'),   // bare domains
  new RegExp(`\\b[a-z0-9-]{2,}(?:\\.[a-z0-9-]+)*\\.(?:${WEAK})(?=[/:?#])\\S*`, 'gi'),         // short TLDs need a path
  new RegExp(`\\b[a-z0-9-]{2,}\\s*[(\\[{]?\\s*dot\\s*[)\\]}]?\\s*(?:${STRONG})\\b`, 'gi'),   // "spam dot com"
  /\b(?:t\.me|wa\.me|discord\.gg|bit\.ly|tinyurl\.com)\/\S*/gi,
];

function stripLinks(text) {
  let found = false;
  for (const re of LINK_RES) text = text.replace(re, () => { found = true; return '[link removed]'; });
  return { text, found };
}

const FULL_RE = new RegExp(`^(?:${WORDS.join('|')})$`);

/** Spans of spaced-out letters ("f u c k", "s.h.i.t") that spell a banned word. Tries every sub-run,
 *  so a stray leading letter ("a f u c k e r") does not hide the word. */
function spacedProfanity(text) {
  const out = [], re = /(?<![a-z0-9])(?:[a-z0-9@$!][\s._\-*]+){2,}[a-z0-9@$!](?![a-z0-9])/gi;
  for (const m of text.matchAll(re)) {
    const letters = [];                                           // [char, absolute index]
    for (let i = 0; i < m[0].length; i++) if (/[a-z0-9@$!]/i.test(m[0][i])) letters.push([m[0][i], m.index + i]);
    for (let i = 0; i < letters.length; i++) for (let j = i + 2; j < letters.length; j++) {
      const word = normalize(letters.slice(i, j + 1).map(l => l[0]).join('')).norm;
      if (FULL_RE.test(word)) out.push([letters[i][1], letters[j][1] + 1]);
    }
  }
  return out;
}

function maskProfanity(text) {
  const spans = [];
  const { norm, map } = normalize(text);
  for (const m of norm.matchAll(WORD_RE)) spans.push([map[m.index], map[m.index + m[0].length - 1] + 1]);
  spans.push(...spacedProfanity(text));
  if (!spans.length) return { text, found: false };
  spans.sort((a, b) => a[0] - b[0]);
  const merged = [];                                              // overlapping matches become one mask
  for (const [st, en] of spans) { const last = merged.at(-1); if (last && st <= last[1]) last[1] = Math.max(last[1], en); else merged.push([st, en]); }
  let out = '', pos = 0;
  for (const [st, en] of merged) { out += text.slice(pos, st) + '•••'; pos = en; }
  return { text: out + text.slice(pos), found: true };
}

export function moderate(input, maxLen = 200) {
  let text = String(input ?? '').replace(/[<>\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  const l = stripLinks(text); text = l.text;
  const p = maskProfanity(text); text = p.text;
  text = text.replace(/\s+/g, ' ').trim().slice(0, maxLen);
  const letters = text.replace(/\[link removed\]|•••|[^\p{L}\p{N}]/gu, '');
  return { text, links: l.found, profanity: p.found, empty: letters.length === 0 };
}

export function isCleanName(name) {
  const r = moderate(name, 40);
  return !r.links && !r.profanity && !r.empty;
}
