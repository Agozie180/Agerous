/**
 * AGEROUS — AI Event Interpreter
 *
 * Converts free natural language into a validated structured event.
 *
 * Architecture:
 *   user text → OpenAI (if available) → structured event JSON
 *             → fallback: keyword rule-matcher
 *
 * The AI ONLY interprets intent.
 * The simulation engine decides consequences.
 */

import { EVENT_TYPES } from './worldState.js';

const SYSTEM_PROMPT = `You are the event interpreter for AGEROUS, a living 3D community simulation.

Your job is to convert a natural language description of an event into a structured JSON event object.

Respond ONLY with a single valid JSON object — no explanation, no markdown, no code fences.

Supported event types and their required fields:

flood          → { "event_type": "flood", "severity": "low"|"medium"|"high", "duration": <days 1-3> }
rain           → { "event_type": "rain", "severity": "low"|"high", "duration": <days> }
school_closure → { "event_type": "school_closure", "reason": string, "duration": <days> }
school_exam    → { "event_type": "school_exam" }
market_shipment    → { "event_type": "market_shipment" }
market_disruption  → { "event_type": "market_disruption", "road_blocked": true|false, "duration": <days> }
church_service → { "event_type": "church_service" }
election_announced → { "event_type": "election_announced", "days_until": <1-3> }
election_day       → { "event_type": "election_day" }
weather_change     → { "event_type": "weather_change", "weather": "clear"|"cloudy"|"rain"|"storm" }
recovery           → { "event_type": "recovery" }

If the user's message does not match any event type, return:
{ "event_type": "unknown", "original": "<user's text>" }

Examples:
"A severe flood is coming" → { "event_type": "flood", "severity": "high", "duration": 2 }
"School is closed tomorrow" → { "event_type": "school_closure", "reason": "administrative", "duration": 1 }
"The local election is tomorrow" → { "event_type": "election_announced", "days_until": 1 }
"It is sunny now" → { "event_type": "weather_change", "weather": "clear" }
"A large food shipment arrived" → { "event_type": "market_shipment" }`;

/**
 * Interpret user text → structured event.
 * @param {string} text
 * @param {string|null} apiKey
 * @returns {Promise<object>} structured event
 */
export async function interpretEvent(text, apiKey) {
  // Try OpenAI first
  if (apiKey) {
    try {
      const result = await _callOpenAI(text, apiKey);
      if (result && result.event_type && result.event_type !== 'unknown') {
        return result;
      }
    } catch (err) {
      console.warn('[Agerous] OpenAI call failed, falling back to rule-matcher:', err.message);
    }
  }

  // Fallback: rule-based keyword matcher
  return _ruleBasedInterpret(text);
}

async function _callOpenAI(text, apiKey) {
  const cleanApiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!cleanApiKey) {
    throw new Error('Missing OpenAI API key');
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cleanApiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: text },
      ],
      temperature: 0.1,
      max_tokens: 150,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `HTTP ${response.status}`);
  }

  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content?.trim();
  if (!raw) throw new Error('Empty response from OpenAI');

  // Strip markdown code fences if the model added them anyway
  const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  return JSON.parse(clean);
}

/**
 * Rule-based fallback — no API needed.
 * Matches common phrases to event types.
 */
function _ruleBasedInterpret(text) {
  const t = text.toLowerCase();

  // Flood
  if (/flood|flooding|floodwater|inundation/.test(t)) {
    const severity = /severe|major|serious|heavy|bad/.test(t) ? 'high'
      : /mild|minor|small/.test(t) ? 'low' : 'medium';
    return { event_type: EVENT_TYPES.FLOOD, severity, duration: severity === 'high' ? 2 : 1 };
  }

  // Rain / Storm
  if (/storm|hurricane|typhoon/.test(t)) {
    return { event_type: EVENT_TYPES.RAIN, severity: 'high', duration: 2 };
  }
  if (/rain|drizzle|downpour|shower/.test(t)) {
    const heavy = /heavy|hard|pour|downpour/.test(t);
    return { event_type: EVENT_TYPES.RAIN, severity: heavy ? 'high' : 'low', duration: 1 };
  }

  // School
  if (/school.*clos|clos.*school|school.*shut/.test(t)) {
    return { event_type: EVENT_TYPES.SCHOOL_CLOSURE, reason: 'administrative', duration: 1 };
  }
  if (/exam|test|assessment/.test(t) && /school|student/.test(t)) {
    return { event_type: EVENT_TYPES.SCHOOL_EXAM };
  }

  // Market
  if (/shipment|supply|delivery|food.*arriv|stock/.test(t)) {
    return { event_type: EVENT_TYPES.MARKET_SHIPMENT };
  }
  if (/market.*clos|market.*flood|road.*market|market.*damage/.test(t)) {
    return { event_type: EVENT_TYPES.MARKET_DISRUPTION, road_blocked: /road/.test(t), duration: 1 };
  }

  // Church
  if (/church|service|sunday|mass|prayer|worship/.test(t)) {
    return { event_type: EVENT_TYPES.CHURCH_SERVICE };
  }

  // Election
  if (/election.*day|voting.*day|polls.*open/.test(t)) {
    return { event_type: EVENT_TYPES.ELECTION_DAY };
  }
  if (/election|vote|campaign|ballot|candidat/.test(t)) {
    const days = /tomorrow/.test(t) ? 1 : /next week/.test(t) ? 7 : 2;
    return { event_type: EVENT_TYPES.ELECTION_ANNOUNCED, days_until: days };
  }

  // Weather
  if (/clear|sunny|sunshine|bright/.test(t)) {
    return { event_type: EVENT_TYPES.WEATHER_CHANGE, weather: 'clear' };
  }
  if (/cloudy|overcast/.test(t)) {
    return { event_type: EVENT_TYPES.WEATHER_CHANGE, weather: 'cloudy' };
  }

  // Recovery
  if (/recover|rebuild|reopen|normal|calm/.test(t)) {
    return { event_type: EVENT_TYPES.RECOVERY };
  }

  return { event_type: 'unknown', original: text };
}

/**
 * Basic validation — ensure the event has required fields.
 * Returns { valid: bool, reason: string }
 */
export function validateEvent(event) {
  if (!event || typeof event !== 'object') {
    return { valid: false, reason: 'Invalid event structure.' };
  }
  if (!event.event_type) {
    return { valid: false, reason: 'Missing event_type.' };
  }
  if (event.event_type === 'unknown') {
    return { valid: false, reason: `Could not interpret: "${event.original}". Try describing a flood, election, school event, or market event.` };
  }
  if (!Object.values(EVENT_TYPES).includes(event.event_type)) {
    return { valid: false, reason: `Unknown event type: ${event.event_type}` };
  }
  return { valid: true, reason: '' };
}
