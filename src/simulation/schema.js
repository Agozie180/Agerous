/**
 * AGEROUS — Event schema & validation
 *
 * This is the ONLY door into the simulation.  An LLM (or the offline parser)
 * proposes events; this module decides whether they are legal.  Unknown event
 * types are rejected, unknown fields are dropped, numbers are clamped and enums
 * are checked.  The AI never touches the world — it only produces data that must
 * survive this validator.
 */

const enumOf = (values, dflt) => ({ kind: 'enum', values, dflt });
const intOf = (min, max, dflt) => ({ kind: 'int', min, max, dflt });
const boolOf = dflt => ({ kind: 'bool', dflt });
const strOf = (max, dflt = '') => ({ kind: 'str', max, dflt });

const DELAY = { delay_days: intOf(0, 7, 0) };

export const EVENT_SCHEMA = {
  flood: {
    describe: 'The river rises. severity sets how high; duration_days how long it rains.',
    params: { severity: enumOf(['low', 'medium', 'high'], 'medium'), duration_days: intOf(1, 3, null), ...DELAY },
  },
  weather_change: {
    describe: 'Set the weather. "clear" stops any rain.',
    params: { weather: enumOf(['clear', 'cloudy', 'rain', 'storm'], 'clear'), ...DELAY },
  },
  school_closure: {
    describe: 'The school is closed by order.',
    params: { duration_days: intOf(1, 7, 1), reason: strOf(60, 'closed by order'), ...DELAY },
  },
  school_reopen: { describe: 'Lift an order closing the school.', params: { ...DELAY } },
  school_exam: { describe: 'An exam day: students and teachers attend, even on a Saturday.', params: { ...DELAY } },
  market_shipment: { describe: 'A big shipment of goods arrives at the market.', params: { ...DELAY } },
  market_disruption: {
    describe: 'The market is disrupted; optionally its road is blocked.',
    params: { duration_days: intOf(1, 3, 1), road_blocked: boolOf(false), ...DELAY },
  },
  church_service: { describe: 'A special church service starts.', params: { ...DELAY } },
  election: {
    describe: 'A local election between two candidates. days_until 0 = today.',
    params: { days_until: intOf(0, 7, 2) },
  },
  recovery: { describe: 'Clean-up crews clear blockages and speed up repairs.', params: { ...DELAY } },
};

export const EVENT_TYPES = Object.keys(EVENT_SCHEMA);
export const MAX_EVENTS_PER_PROMPT = 3;

function coerce(spec, value, notes, name) {
  if (value === undefined || value === null || value === '') return spec.dflt;
  switch (spec.kind) {
    case 'enum': {
      const v = String(value).toLowerCase().trim();
      if (spec.values.includes(v)) return v;
      notes.push(`${name} "${value}" is not one of ${spec.values.join('/')}; using ${spec.dflt}`);
      return spec.dflt;
    }
    case 'int': {
      const n = Number(value);
      if (!Number.isFinite(n)) { notes.push(`${name} "${value}" is not a number; using ${spec.dflt}`); return spec.dflt; }
      const c = Math.min(spec.max, Math.max(spec.min, Math.round(n)));
      if (c !== Math.round(n)) notes.push(`${name} ${n} clamped to ${c}`);
      return c;
    }
    case 'bool': return value === true || value === 'true' || value === 1;
    case 'str': return String(value).replace(/[<>]/g, '').slice(0, spec.max) || spec.dflt;
  }
  return spec.dflt;
}

/**
 * Validate one raw event object.
 * @returns {{ok:true,event:object,notes:string[]}|{ok:false,reason:string}}
 */
export function validateEvent(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'Event must be a JSON object.' };
  const type = String(raw.event_type ?? '').toLowerCase().trim();
  if (!type) return { ok: false, reason: 'Missing event_type.' };
  const def = EVENT_SCHEMA[type];
  if (!def) return { ok: false, reason: `"${type}" is not something this world can simulate.` };
  const notes = [];
  const event = { event_type: type };
  for (const [name, spec] of Object.entries(def.params)) event[name] = coerce(spec, raw[name], notes, name);
  if (type === 'flood' && event.duration_days == null) event.duration_days = event.severity === 'high' ? 2 : 1;
  return { ok: true, event, notes };
}

/**
 * Validate the interpreter's whole answer: an array (or {events:[...]}) of raw events.
 * @returns {{events:object[], rejected:{reason:string}[], notes:string[]}}
 */
export function validateEvents(raw) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.events) ? raw.events : raw && typeof raw === 'object' ? [raw] : [];
  const events = [], rejected = [], notes = [];
  for (const r of list.slice(0, MAX_EVENTS_PER_PROMPT)) {
    if (r && r.event_type === 'unsupported') { rejected.push({ reason: r.reason || 'Not something this world can simulate.' }); continue; }
    const v = validateEvent(r);
    if (v.ok) { events.push(v.event); notes.push(...v.notes); } else rejected.push({ reason: v.reason });
  }
  if (list.length > MAX_EVENTS_PER_PROMPT) notes.push(`Only the first ${MAX_EVENTS_PER_PROMPT} events were used.`);
  return { events, rejected, notes };
}

/** Compact schema text for the LLM prompt. */
export function schemaForPrompt() {
  return Object.entries(EVENT_SCHEMA).map(([type, def]) => {
    const ps = Object.entries(def.params).map(([n, s]) => {
      if (s.kind === 'enum') return `${n}: ${s.values.join('|')}`;
      if (s.kind === 'int') return `${n}: int ${s.min}-${s.max}`;
      if (s.kind === 'bool') return `${n}: true|false`;
      return `${n}: short string`;
    }).join(', ');
    return `- ${type} { ${ps} } — ${def.describe}`;
  }).join('\n');
}
