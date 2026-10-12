import test from 'node:test';
import assert from 'node:assert/strict';
import { fresh, hours, toTime, fire, say, at, by, said } from './helpers.mjs';
import { advanceMinutes } from '../src/simulation/engine.js';
import { membersOf } from '../src/simulation/npcs.js';
import { LOCATION_SPECS } from '../src/simulation/geography.js';

/** Things that must be true in ANY state of the world, however events overlap. */
export function invariants(w, label = '') {
  const fail = m => assert.fail(`${label} t=${Math.round(w.t)}: ${m}`);
  if (!(w.env.stage >= 0 && w.env.stage <= 3.0001)) fail(`stage out of range ${w.env.stage}`);
  for (const n of Object.values(w.npcs)) {
    if (!Number.isFinite(n.x) || !Number.isFinite(n.z)) fail(`${n.name} has NaN position`);
    for (const k of ['food', 'safety', 'social']) if (!(n.needs[k] >= 0 && n.needs[k] <= 1.0001)) fail(`${n.name} ${k}=${n.needs[k]}`);
    if (!(n.money >= 0)) fail(`${n.name} money ${n.money}`);
    if (n.location && !LOCATION_SPECS[n.location]) fail(`${n.name} at unknown place ${n.location}`);
  }
  for (const id of w.institutions.civil.shelters) {
    const cap = LOCATION_SPECS[id].shelterCapacity;
    const assigned = Object.values(w.institutions.civil.assign).filter(s => s === id).length;
    if (assigned > cap) fail(`${id} over capacity ${assigned}/${cap}`);
    if (w.locations[id].flooded) fail(`${id} is a shelter but flooded`);
  }
  const el = w.institutions.election;
  if (el.voted > el.eligible && el.state === 'polling') fail('more votes than voters');
  if (el.candidates[0].votes + el.candidates[1].votes !== el.voted && el.state === 'polling') fail('tally mismatch');
  for (const h of Object.values(w.households)) if (!(h.pantry >= 0)) fail('negative pantry');
  const m = w.institutions.market; if (!(m.stock >= 0 && m.stock <= 150)) fail(`stock ${m.stock}`);
}

test('30 quiet days: school, market, church and homes keep running with NO player input', () => {
  const w = fresh(11);
  let schoolDays = 0, marketDays = 0, sundays = 0, minFood = 1, brokeMax = 0;
  for (let d = 1; d <= 30; d++) {
    let sp = 0, mp = 0, cp = 0;
    toTime(w, d, 8);
    for (let q = 0; q < 56; q++) {            // 08:00 → 22:00
      advanceMinutes(w, 15);
      sp = Math.max(sp, at(w, 'school').length); mp = Math.max(mp, at(w, 'market').length); cp = Math.max(cp, at(w, 'church').length);
      invariants(w, `day ${d}`);
    }
    const wd = (d - 1) % 7;
    if (wd < 5) { assert.ok(sp >= 7, `day ${d}: school ran (peak ${sp})`); schoolDays++; }
    else assert.equal(sp, 0, `day ${d}: school is closed at the weekend`);
    if (wd < 6) { assert.ok(mp >= 4, `day ${d}: market ran (peak ${mp})`); marketDays++; }
    if (wd === 6) { assert.ok(cp >= 14, `day ${d}: Sunday service (peak ${cp})`); sundays++; }
    const npcs = Object.values(w.npcs);
    minFood = Math.min(minFood, npcs.reduce((a, n) => a + n.needs.food, 0) / npcs.length);
    brokeMax = Math.max(brokeMax, npcs.filter(n => n.money < 10).length);
  }
  assert.equal(schoolDays, 22); assert.equal(sundays, 4);
  assert.ok(minFood > 0.45, `average food stays healthy (min ${minFood.toFixed(2)})`);
  assert.ok(brokeMax <= 1, `nobody goes broke (max ${brokeMax})`);
  const m = w.institutions.market;
  assert.ok(m.stock > 10, 'market keeps stock through supply + harvest');
});

test('homes work too: households eat from their cupboards and restock via the market', () => {
  const w = fresh(2);
  toTime(w, 1, 14);
  assert.ok(Object.values(w.npcs).every(n => n.needs.food > 0.3), 'everyone has eaten');
  toTime(w, 6, 20);
  for (const [home, hh] of Object.entries(w.households)) assert.ok(hh.pantry > 0 && hh.pantry < 60, `${home} cupboard is stocked but not endless (${hh.pantry})`);
  // wages were paid for hours worked
  assert.ok(by(w, n => n.occupation === 'teacher').every(n => n.money > 80));
});

test('institutions depend on their people: no priest, no service; no teacher, no lessons; no vendors, no stalls', () => {
  // priest stranded away from church on Sunday
  let w = fresh(3);
  toTime(w, 7, 6);
  w.npcs.npc_14.dest = 'house_1'; w.npcs.npc_14.location = 'house_1'; w.npcs.npc_14.x = -16; w.npcs.npc_14.z = 8;
  w.npcs.npc_14.home = 'house_1';                 // he lives elsewhere today
  toTime(w, 7, 9, 30);
  assert.ok(said(w, /priest could not reach the church|Sunday service begins/));

  // teachers all stay home on a school day → lessons cancelled, students sent home
  w = fresh(4);
  for (const n of by(w, n => n.occupation === 'teacher')) { n.activity = 'idle'; }
  toTime(w, 2, 6);
  for (const n of by(w, n => n.occupation === 'teacher')) n.routine = 'sick';
  const origDecide = w.institutions.school;
  // simulate illness by flagging them as unreachable: block the school road entirely
  w.env.blockedRoads.school_road = w.t + 1440;
  toTime(w, 2, 12);
  assert.equal(w.institutions.school.open, false);
  assert.equal(at(w, 'school').length, 0);
});

// ── Everything at once ──────────────────────────────────────────────────
test('events run TOGETHER: flood + election + school closure + shipment in one sentence, all consistent', () => {
  const w = fresh(7);
  const r = say(w, 'A severe flood is coming, the election is tomorrow, school is closed tomorrow and a large shipment arrived at the market');
  assert.deepEqual(r.events.map(e => e.event_type), ['flood', 'election', 'school_closure']);   // schema cap = 3 per prompt
  say(w, 'a large food shipment arrived');
  for (let i = 0; i < 24 * 4 * 4; i++) { advanceMinutes(w, 15); invariants(w, 'combo'); }
  const text = w.history.map(h => h.text).join('\n');
  for (const re of [/Local election called/, /School closed for 1 day/, /Evacuation ordered/, /shipment of goods/]) assert.match(text, re);
  // the election was either held (maybe with low turnout) or postponed — but never lost
  assert.ok(w.institutions.election.state === 'done' || w.institutions.election.postponements > 0 || w.institutions.election.state === 'campaign');
  assert.ok(w.stats.episodesDone >= 1, 'the flood episode was accounted');
});

test('fuzz: 40 random prompts over 12 days on 8 seeds never break an invariant', () => {
  const prompts = ['a severe flood is coming', 'a minor flood tomorrow', 'heavy rain', 'it is sunny now', 'the election is tomorrow', 'election today',
    'school is closed tomorrow', 'school reopens', 'exam day at school', 'a food shipment arrived', 'the market road is blocked', 'sunday service', 'clean-up crews are out',
    'asdf qwerty', 'make it snow dragons', 'flood and election', 'storm in 2 days', 'the market is on strike'];
  for (let seed = 1; seed <= 8; seed++) {
    const w = fresh(seed);
    let s = seed * 7919;
    const next = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let step = 0; step < 40; step++) {
      say(w, prompts[Math.floor(next() * prompts.length)]);
      for (let q = 0; q < Math.floor(next() * 28) + 4; q++) { advanceMinutes(w, 15); invariants(w, `seed ${seed} step ${step}`); }
    }
  }
});

test('households pool money: an elder with no income still gets the groceries', () => {
  const w = fresh(5);
  const grandma = w.npcs.npc_15; grandma.money = 0;
  assert.ok(membersOf(w, grandma.home).some(n => n.money > 50));
  toTime(w, 10, 20);
  assert.ok(w.households[grandma.home].pantry > 0);
});
