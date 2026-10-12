/**
 * AGEROUS — Natural language → structured events
 *
 * Two interpreters share one output contract:
 *   1. an LLM (OpenAI or Anthropic, bring-your-own-key), and
 *   2. an offline rule parser that needs no key and no network.
 * Both only PROPOSE events.  Every proposal goes through schema.validateEvents(),
 * which is what the simulation trusts.  If the LLM is unreachable or returns junk
 * the offline parser takes over, and the result says so (`source`, `notes`).
 */

import { validateEvents, schemaForPrompt } from './schema.js';
import { weekdayName } from './geography.js';

// ─── Offline interpreter ────────────────────────────────────────────────

/** Words the parser knows.  Typos within edit distance are snapped to these. */
const LEXICON = ['flood', 'flooding', 'flooded', 'election', 'elections', 'school', 'market', 'church', 'service', 'storm', 'shipment', 'delivery',
  'tomorrow', 'closed', 'sunny', 'rain', 'raining', 'exam', 'exams', 'vote', 'voting', 'severe', 'massive', 'minor', 'cloudy', 'students', 'teachers',
  'candidates', 'campaign', 'blocked', 'recovery', 'cleanup', 'reopen', 'drizzle', 'hurricane', 'sunday', 'tonight', 'harvest', 'strike'];
const SYNONYMS = [[/\b(tsunami|torrent\w*|deluge|dam (?:burst|broke|failure))\b/g, 'flood'], [/\b(polling day|go to the polls|mayoral race|ballot box)\b/g, 'election'],
  [/\b(kids? (?:stay|stays) home|no (?:classes|lessons)|classes? (?:are )?(?:off|cancel\w*))\b/g, 'school closed'],
  [/\b(trucks? (?:of )?(?:food|goods|supplies) (?:arrive|arrives|arrived|came|come))\b/g, 'shipment arrived'], [/\b(mass|worship)\b/g, 'service']];

function editDistance(a, b) {          // Damerau–Levenshtein (adjacent swaps count as one edit)
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    const c = a[i - 1] === b[j - 1] ? 0 : 1;
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}
export function normalize(text) {
  let t = String(text).toLowerCase();
  for (const [rx, to] of SYNONYMS) t = t.replace(rx, to);
  return t.replace(/[a-z]{6,}/g, w => {
    if (LEXICON.includes(w)) return w;
    const max = w.length >= 8 ? 2 : 1;
    let best = null, bd = max + 1;
    for (const k of LEXICON) { if (Math.abs(k.length - w.length) > max) continue; const e = editDistance(w, k); if (e < bd) { bd = e; best = k; } }
    return best ?? w;
  });
}

const WORD_NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
const num = s => (/^\d+$/.test(s) ? Number(s) : WORD_NUM[s] ?? null);

function parseDelay(c) {
  if (/\bday after tomorrow\b/.test(c)) return 2;
  if (/\btomorrow\b/.test(c)) return 1;
  let m = c.match(/\bin (\d+|one|two|three|four|five|six|seven) days?\b/);
  if (m) return num(m[1]);
  if (/\bnext week\b/.test(c)) return 7;
  return 0;
}
function parseDuration(c) {
  let m = c.match(/\bfor (\d+|one|two|three|four|five|six|seven|a) (day|days|week|weeks)\b/);
  if (m) return (num(m[1]) ?? 1) * (m[2].startsWith('week') ? 7 : 1);
  if (/\ball week\b/.test(c)) return 7;
  return null;
}
function parseSeverity(c) {
  if (/\b(severe|major|massive|huge|catastrophic|terrible|devastating|worst|serious|big|heavy|violent|extreme|deadly|raging|biblical)\b/.test(c)) return 'high';
  if (/\b(mild|minor|small|slight|little|light|tiny|modest)\b/.test(c)) return 'low';
  return 'medium';
}

const RX = {
  election: /\b(elections?|vot(?:e|es|ing)|ballots?|polls?|candidates?|campaign\w*|mayor)\b/,
  school: /\b(schools?|class(?:es)?|lessons?|students?|pupils?|teachers?)\b/,
  closure: /\b(clos(?:e|ed|es|ing|ure)|shut|cancel(?:l?ed)?|no school|day off|holiday|strike|suspend\w*)\b/,
  reopen: /\b(re-?open\w*|open(?:s|ed)? again|resum\w+)\b/,
  exam: /\b(exams?|examinations?|tests?|quiz(?:zes)?|assessments?)\b/,
  church: /\b(mass|worship|sermon|service|prayers?|congregation|sunday)\b|\bchurch\b.*\b(bells?|gather\w*|pray\w*|hold\w*|start\w*|begin\w*)\b/,
  flood: /\b(flood\w*|deluge|inundat\w*|overflow\w*|river (?:burst|bursts|rises?|rising)|dam (?:burst|breaks?|failure))\b/,
  market: /\b(markets?|bazaar|vendors?|stalls?|traders?)\b/,
  shipment: /\b(shipments?|deliver(?:y|ies|ed)|supplies|supply|goods|truck|harvest|restock\w*|stocked)\b/,
  disrupt: /\b(clos(?:e|ed|es|ing|ure)|shut|strike|fire|raid|robbery|damage\w*|collaps\w+|blocked|inaccessible|disrupt\w*|cut off|riot)\b/,
  storm: /\b(storms?|thunder\w*|hurricane|typhoon|cyclone|tempest|gale)\b/,
  rain: /\b(rain\w*|drizzle|downpour|showers?)\b/,
  clear: /\b(sunny|sunshine|clear (?:sky|skies|weather)|stop(?:s|ped)? raining|rain (?:stops|stopped|ends?)|fine weather|clears? up)\b/,
  cloudy: /\b(cloudy|overcast|clouds?)\b/,
  recovery: /\b(clean ?-?up|rebuild\w*|repair\w*|restor\w*|recover\w*|crews?|clear(?:ed)? the roads?)\b/,
};

function parseClause(raw) {
  let c = normalize(raw).trim();
  if (!c) return null;
  // "due to the flood" is a CAUSE, not a new flood.
  let cause = '';
  c = c.replace(/\b(?:due to|because of|owing to|after|following|thanks to)\s+(?:the\s+|a\s+)?((?:\w+\s+)?(?:flood\w*|storm\w*|rain\w*))/g, (_, w) => { cause = w.trim(); return ' '; });
  const delay = parseDelay(c);
  const withDelay = e => (delay > 0 && e.event_type !== 'election' ? { ...e, delay_days: delay } : e);

  if (RX.election.test(c)) {
    const d = /\b(today|tonight|now)\b/.test(c) ? 0 : (parseDelay(c) || 2);
    return { event_type: 'election', days_until: d };
  }
  if (RX.school.test(c)) {
    if (RX.reopen.test(c)) return withDelay({ event_type: 'school_reopen' });
    if (RX.closure.test(c)) {
      return withDelay({ event_type: 'school_closure', duration_days: parseDuration(c) ?? 1, reason: cause ? `because of the ${cause}` : 'closed by order' });
    }
    if (RX.exam.test(c)) return withDelay({ event_type: 'school_exam' });
  }
  if (RX.church.test(c) && !/\bshelter\b/.test(c)) return withDelay({ event_type: 'church_service' });
  if (RX.flood.test(c)) {
    return withDelay({ event_type: 'flood', severity: parseSeverity(c), duration_days: parseDuration(c) ?? undefined });
  }
  if (RX.market.test(c) || /\bfood\b/.test(c)) {
    if (RX.shipment.test(c) || /\b(arriv\w+)\b/.test(c)) return withDelay({ event_type: 'market_shipment' });
    if (RX.disrupt.test(c)) {
      return withDelay({ event_type: 'market_disruption', road_blocked: /\b(road|blocked|inaccessible|cut off)\b/.test(c), duration_days: parseDuration(c) ?? 1 });
    }
  }
  if (RX.clear.test(c)) return withDelay({ event_type: 'weather_change', weather: 'clear' });
  if (RX.storm.test(c)) return withDelay({ event_type: 'weather_change', weather: 'storm' });
  if (RX.rain.test(c)) return withDelay({ event_type: 'weather_change', weather: /\b(heavy|hard|pouring|downpour)\b/.test(c) ? 'storm' : 'rain' });
  if (RX.cloudy.test(c)) return withDelay({ event_type: 'weather_change', weather: 'cloudy' });
  if (RX.recovery.test(c)) return withDelay({ event_type: 'recovery' });
  return null;
}

export const UNSUPPORTED_HELP =
  'Try describing a flood, rain or storm, a school closure or exam, a market shipment or disruption, a church service, or a local election.';

export function interpretOffline(text) {
  // Split on sentence ends, commas and "and/then" — but keep all clauses that parse.
  const clauses = String(text).split(/[.!?;\n]+|,|\b(?:and then|then|and|but)\b/i).map(s => s.trim()).filter(Boolean);
  const raw = [], notes = [];
  for (const cl of clauses) {
    const e = parseClause(cl);
    if (e) raw.push(e); else if (clauses.length > 1) notes.push(`Ignored: "${cl}"`);
  }
  if (raw.length === 0) {
    return { events: [], rejected: [{ reason: `I couldn't turn "${String(text).trim()}" into anything this world can simulate. ${UNSUPPORTED_HELP}` }], notes: [], source: 'rules' };
  }
  const v = validateEvents(raw);
  return { ...v, notes: [...notes, ...v.notes], source: 'rules' };
}

// ─── LLM interpreter ────────────────────────────────────────────────────

export function buildSystemPrompt(ctx = {}) {
  const when = ctx.day ? `It is Day ${ctx.day} (${weekdayName(ctx.day)}), ${String(ctx.hour ?? 8).padStart(2, '0')}:00 in the simulation. "Tomorrow" = delay_days 1.` : '';
  return `You are the event interpreter for AGEROUS, a small simulated community (a school, a market, a church, a river, houses, a polling station, ~25 residents).
Convert the player's message into events the simulation can run. You ONLY interpret; the simulation decides the consequences.
${when}

Respond with ONE JSON object and nothing else: {"events":[ ... up to 3 events ... ]}

Allowed events (use these event_type names and parameters exactly):
${schemaForPrompt()}

Rules:
- delay_days: 0 for "now"/"coming", 1 for "tomorrow", N for "in N days". For election use days_until instead.
- "A severe/huge flood" → severity high; "minor" → low; otherwise medium.
- If a flood is the CAUSE of something ("school closed because of the flood") do not add a flood event.
- If the message cannot be expressed with these events, return {"events":[{"event_type":"unsupported","reason":"<one short sentence>"}]}.
- Never invent event types, never output code, never explain.

Examples:
"A severe flood is coming" → {"events":[{"event_type":"flood","severity":"high","duration_days":2}]}
"School is closed tomorrow" → {"events":[{"event_type":"school_closure","duration_days":1,"reason":"closed by order","delay_days":1}]}
"The local election is tomorrow" → {"events":[{"event_type":"election","days_until":1}]}
"Make it snow dragons" → {"events":[{"event_type":"unsupported","reason":"Dragons and snow are not part of this world."}]}`;
}

function extractJSON(text) {
  const s = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(s); } catch { /* fall through */ }
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(s.slice(a, b + 1));
  throw new Error('The model did not return JSON.');
}

async function callProxy(text, cfg, fetchImpl) {
  const res = await fetchImpl(cfg.proxyUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, context: cfg.context }) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `HTTP ${res.status}`);
  const data = await res.json();
  cfg.model = data.model;
  return data.rawText ?? '';
}

export const PROVIDERS = {
  openai: { label: 'OpenAI', defaultModel: 'gpt-4o-mini' },
  anthropic: { label: 'Anthropic', defaultModel: 'claude-haiku-5-5' },
};

async function callOpenAI(text, cfg, system, fetchImpl) {
  const res = await fetchImpl('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey.trim()}` },
    body: JSON.stringify({
      model: cfg.model || PROVIDERS.openai.defaultModel,
      messages: [{ role: 'system', content: system }, { role: 'user', content: text }],
      temperature: 0, max_tokens: 400, response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error?.message || `HTTP ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

async function callAnthropic(text, cfg, system, fetchImpl) {
  const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': cfg.apiKey.trim(),
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: cfg.model || PROVIDERS.anthropic.defaultModel,
      max_tokens: 400, temperature: 0, system,
      messages: [{ role: 'user', content: text }],
    }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error?.message || `HTTP ${res.status}`);
  const data = await res.json();
  return data.content?.map(b => b.text ?? '').join('') ?? '';
}

/**
 * Interpret a player's message.
 * @param {string} text
 * @param {{provider?:string, apiKey?:string, model?:string, context?:object, fetch?:Function}} cfg
 */
export async function interpret(text, cfg = {}) {
  const trimmed = String(text ?? '').trim().slice(0, 400);
  if (!trimmed) return { events: [], rejected: [{ reason: 'Type what should happen in the world.' }], notes: [], source: 'none' };

  if (cfg.apiKey || cfg.proxyUrl) {
    const fetchImpl = cfg.fetch ?? globalThis.fetch;
    const system = buildSystemPrompt(cfg.context);
    try {
      const rawText = cfg.proxyUrl ? await callProxy(trimmed, cfg, fetchImpl)
        : cfg.provider === 'anthropic' ? await callAnthropic(trimmed, cfg, system, fetchImpl)
        : await callOpenAI(trimmed, cfg, system, fetchImpl);
      const v = validateEvents(extractJSON(rawText));
      if (v.events.length || v.rejected.length) {
        return { ...v, source: 'ai', model: cfg.model || PROVIDERS[cfg.provider ?? 'openai']?.defaultModel || 'proxy', rawText };
      }
      throw new Error('The model returned no events.');
    } catch (err) {
      const off = interpretOffline(trimmed);
      return { ...off, notes: [`AI interpreter unavailable (${err.message}) — used the offline rules instead.`, ...off.notes] };
    }
  }
  return interpretOffline(trimmed);
}
