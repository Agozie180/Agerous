import test from 'node:test';
import assert from 'node:assert/strict';
import { interpretOffline, interpret } from '../src/simulation/interpreter.js';
import { validateEvent, validateEvents, EVENT_SCHEMA } from '../src/simulation/schema.js';

const types = text => interpretOffline(text).events.map(e => e.event_type);
const first = text => interpretOffline(text).events[0];

test('the five headline prompts', () => {
  assert.deepEqual(first('A severe flood is coming.'), { event_type: 'flood', severity: 'high', duration_days: 2, delay_days: 0 });
  assert.deepEqual(first('School is closed tomorrow'), { event_type: 'school_closure', duration_days: 1, reason: 'closed by order', delay_days: 1 });
  assert.deepEqual(first('The local election is tomorrow'), { event_type: 'election', days_until: 1 });
  assert.equal(first('Sunday service this morning').event_type, 'church_service');
  assert.equal(first('A large food shipment arrived').event_type, 'market_shipment');
});

test('a flood given as a CAUSE does not create a flood', () => {
  const e = interpretOffline('School is closed due to the flood').events;
  assert.deepEqual(e.map(x => x.event_type), ['school_closure']);
  assert.match(e[0].reason, /flood/);
});

test('word boundaries: "a train arrives" is not rain', () => {
  assert.deepEqual(types('a train arrives'), []);
  assert.deepEqual(types('the contest was a test of strength'), []);
});

test('severity words and durations', () => {
  assert.equal(first('a minor flood').severity, 'low');
  assert.equal(first('a flood').severity, 'medium');
  assert.equal(first('a catastrophic flood for 3 days').duration_days, 3);
  assert.equal(first('a flood for a week').duration_days, 3, 'clamped to the schema maximum');
});

test('scheduling words become delay_days', () => {
  assert.equal(first('a flood is coming tomorrow').delay_days, 1);
  assert.equal(first('a storm in 3 days').delay_days, 3);
  assert.equal(first('election in two days').days_until, 2);
  assert.equal(first('the election is today').days_until, 0);
});

test('compound sentences become several events', () => {
  assert.deepEqual(types('A severe flood is coming and the election is tomorrow'), ['flood', 'election']);
  assert.deepEqual(types('School is closed tomorrow, then a shipment arrives at the market'), ['school_closure', 'market_shipment']);
});

test('weather prompts', () => {
  assert.deepEqual(interpretOffline('it is sunny now').events[0], { event_type: 'weather_change', weather: 'clear', delay_days: 0 });
  assert.equal(first('heavy rain').weather, 'storm');
  assert.equal(first('a light drizzle').weather, 'rain');
  assert.equal(first('the rain stops').weather, 'clear');
});

test('unsupported requests are rejected with guidance, never faked', () => {
  for (const t of ['make it snow dragons', 'everyone goes to the stadium', 'asdf', 'open the church as a shelter', 'summon a dragon over the church']) {
    const r = interpretOffline(t);
    if (t.startsWith('open the church')) { assert.equal(r.events.length, 0); }
    assert.equal(r.events.length, 0, t);
    assert.equal(r.rejected.length, 1, t);
    assert.match(r.rejected[0].reason, /flood|school|market|election/i);
  }
  assert.equal(interpretOffline('').events.length, 0);
});

// ── Schema validation ───────────────────────────────────────────────────
test('validator clamps, defaults and strips', () => {
  const v = validateEvent({ event_type: 'flood', severity: 'banana', duration_days: 99999, evil: 'rm -rf', delay_days: -4 });
  assert.equal(v.ok, true);
  assert.deepEqual(v.event, { event_type: 'flood', severity: 'medium', duration_days: 3, delay_days: 0 });
  assert.ok(v.notes.length >= 2);
  assert.equal('evil' in v.event, false);
});

test('validator rejects unknown types and non-objects', () => {
  assert.equal(validateEvent({ event_type: 'meteor' }).ok, false);
  assert.equal(validateEvent('flood').ok, false);
  assert.equal(validateEvent(null).ok, false);
  assert.equal(validateEvent({}).ok, false);
});

test('validateEvents handles arrays, {events}, unsupported markers, and caps at 3', () => {
  const r = validateEvents({ events: [{ event_type: 'flood' }, { event_type: 'unsupported', reason: 'no dragons' }, { event_type: 'xyz' }, { event_type: 'recovery' }, { event_type: 'school_exam' }] });
  assert.equal(r.events.length, 1);              // only the first 3 entries are considered:
  assert.equal(r.rejected.length, 2);            // flood ok · unsupported · xyz
  assert.ok(r.notes.some(n => /first 3/.test(n)));
});

test('every schema type validates with defaults only', () => {
  for (const type of Object.keys(EVENT_SCHEMA)) assert.equal(validateEvent({ event_type: type }).ok, true, type);
});

// ── LLM path (mocked network) ───────────────────────────────────────────
const mockFetch = (payload, ok = true) => async () => ({ ok, status: ok ? 200 : 401, json: async () => payload });
const openai = content => mockFetch({ choices: [{ message: { content } }] });
const anthropic = text => mockFetch({ content: [{ type: 'text', text }] });

test('AI result is validated and labelled', async () => {
  const r = await interpret('a huge flood', { apiKey: 'k', provider: 'openai', fetch: openai('{"events":[{"event_type":"flood","severity":"high","duration_days":2}]}') });
  assert.equal(r.source, 'ai');
  assert.equal(r.events[0].severity, 'high');
});

test('Anthropic adapter works and tolerates ```json fences', async () => {
  let seen;
  const f = async (url, init) => { seen = { url, init }; return { ok: true, json: async () => ({ content: [{ type: 'text', text: '```json\n{"events":[{"event_type":"election","days_until":1}]}\n```' }] }) }; };
  const r = await interpret('vote tomorrow', { apiKey: 'sk-ant', provider: 'anthropic', fetch: f });
  assert.equal(r.source, 'ai');
  assert.equal(r.events[0].event_type, 'election');
  assert.match(seen.url, /anthropic/);
  assert.equal(seen.init.headers['anthropic-dangerous-direct-browser-access'], 'true');
});

test('AI hallucinations are rejected by the validator, not executed', async () => {
  const r = await interpret('summon dragons', { apiKey: 'k', fetch: openai('{"events":[{"event_type":"spawn_dragon","count":99}]}') });
  assert.equal(r.events.length, 0);
  assert.equal(r.rejected.length, 1);
  assert.equal(r.source, 'ai');
});

test('AI says unsupported → rejected honestly (no silent fallback to a guess)', async () => {
  const r = await interpret('make it snow dragons', { apiKey: 'k', fetch: openai('{"events":[{"event_type":"unsupported","reason":"Dragons are not part of this world."}]}') });
  assert.equal(r.events.length, 0);
  assert.equal(r.rejected[0].reason, 'Dragons are not part of this world.');
});

test('network failure / bad key / garbage → offline rules take over and say so', async () => {
  for (const f of [mockFetch({ error: { message: 'Incorrect API key' } }, false), openai('lol not json'), async () => { throw new Error('offline'); }]) {
    const r = await interpret('A severe flood is coming', { apiKey: 'k', fetch: f });
    assert.equal(r.source, 'rules');
    assert.equal(r.events[0].event_type, 'flood');
    assert.match(r.notes[0], /AI interpreter unavailable/);
  }
});
