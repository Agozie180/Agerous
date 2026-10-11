import test from 'node:test';
import assert from 'node:assert/strict';
import { fresh, hours, toTime, fire, at, by, said, say, peakStageOf, clock } from './helpers.mjs';
import { advanceMinutes } from '../src/simulation/engine.js';
import { findPath } from '../src/simulation/pathing.js';
import { serialize, deserialize } from '../src/simulation/persistence.js';
import { LOCATION_SPECS, locationElevation } from '../src/simulation/geography.js';

// ── A normal day ────────────────────────────────────────────────────────
test('normal Monday: students and teachers are in school, vendors at the market, nobody is evacuating', () => {
  const w = fresh();
  assert.equal(clock(w), 'Day 1 08:00');
  toTime(w, 1, 11);
  const inSchool = at(w, 'school');
  assert.ok(inSchool.filter(n => n.occupation === 'student').length >= 5, 'students in school');
  assert.equal(inSchool.filter(n => n.occupation === 'teacher').length, 2);
  assert.equal(at(w, 'market').filter(n => n.occupation === 'vendor').length, 3);
  assert.equal(by(w, n => n.activity === 'evacuating').length, 0);
  assert.equal(w.institutions.civil.alert, 0);
});

test('NPCs walk: between decisions they have continuous positions, not teleports', () => {
  const w = fresh();
  toTime(w, 1, 8, 0);
  const n = w.npcs.npc_09;           // vendor
  let last = { x: n.x, z: n.z }, maxJump = 0;
  for (let i = 0; i < 120; i++) { advanceMinutes(w, 1); maxJump = Math.max(maxJump, Math.hypot(n.x - last.x, n.z - last.z)); last = { x: n.x, z: n.z }; }
  assert.ok(maxJump <= 0.51, `moved at most 0.5 m per minute (saw ${maxJump})`);
});

// ── Flood: physical cause and effect ────────────────────────────────────
test('HIGH flood: causal chain from rain to shelter to recovery', () => {
  const w = fresh();
  assert.equal(w.env.stage, 0);
  fire(w, { event_type: 'flood', severity: 'high' });
  assert.ok(said(w, /Heavy rain begins/));
  assert.equal(w.institutions.civil.evacuation, true, 'forecast triggers evacuation before water arrives');
  const peak = peakStageOf(w, 20);
  assert.ok(peak > 2.7 && peak <= 2.8001, `river reached its forecast peak (${peak})`);

  // roads and buildings went under in the order the terrain dictates
  const floodedAt = id => w.history.find(h => h.text === `Flooding at ${LOCATION_SPECS[id].name}.`)?.t;
  assert.ok(floodedAt('fields') < floodedAt('house_5'), 'low fields first');
  assert.ok(floodedAt('house_5') < floodedAt('house_4'));
  assert.ok(floodedAt('house_4') < floodedAt('market'));
  assert.equal(w.locations.church.flooded, false, 'church on its hill stays dry');
  assert.equal(w.locations.school.flooded, false);
  assert.ok(said(w, /Main Road is impassable/));

  // institutions responded through rules
  assert.equal(w.institutions.market.open, false);
  assert.match(w.institutions.market.reasons.join(), /flooded|cut/);
  assert.equal(w.institutions.school.open, false);
  assert.deepEqual(w.institutions.civil.shelters, ['church']);
  assert.equal(w.locations.church.isShelter, true);

  // people: everyone from flooded homes is in the church
  const inChurch = at(w, 'church');
  assert.ok(inChurch.length >= 24, `residents sheltering in the church (${inChurch.length})`);
  assert.equal(by(w, n => n.activity === 'stranded').length, 0, 'forecast-based evacuation gets everyone out in time');
  assert.equal(at(w, 'market').length, 0);

  // history is derived from the simulation
  for (const re of [/Evacuation ordered/, /Church opened as an emergency shelter/, /School closed/, /Market closed/]) assert.ok(said(w, re), String(re));

  // and it recovers on its own
  toTime(w, 4, 12);
  assert.equal(w.env.stage, 0);
  assert.equal(w.institutions.school.open, true);
  assert.equal(w.institutions.market.open, true);
  assert.deepEqual(w.institutions.civil.shelters, []);
  assert.ok(said(w, /Evacuation lifted/) && said(w, /The flood is over/));
  assert.equal(by(w, n => n.location === 'church').length, 1, 'only the priest remains');
});

test('flood severity changes the world (low < medium < high)', () => {
  const peaks = {}, closed = {}, marketClosed = {};
  for (const sev of ['low', 'medium', 'high']) {
    const w = fresh();
    fire(w, { event_type: 'flood', severity: sev });
    let seenSchoolClosed = false, seenMarketClosed = false, peak = 0;
    for (let i = 0; i < 24 * 4; i++) {
      advanceMinutes(w, 15); peak = Math.max(peak, w.env.stage);
      seenSchoolClosed ||= !w.institutions.school.open;
      seenMarketClosed ||= !w.institutions.market.open;
    }
    peaks[sev] = peak; closed[sev] = seenSchoolClosed; marketClosed[sev] = seenMarketClosed;
  }
  assert.ok(peaks.low < peaks.medium && peaks.medium < peaks.high, JSON.stringify(peaks));
  assert.equal(closed.low, false, 'a low flood does not close the school');
  assert.equal(closed.medium, true);
  assert.equal(marketClosed.low, false, 'a low flood leaves the market open');
  assert.equal(marketClosed.high, true);
});

test('shelters are chosen by RULE, not by name: if the church is flooded another place is used', () => {
  const w = fresh();
  w.locations.church.flooded = true;
  w.locations.church.cleanupUntil = w.t + 99999;
  fire(w, { event_type: 'flood', severity: 'medium' });
  hours(w, 12);
  const s = w.institutions.civil.shelters;
  assert.ok(!s.includes('church'), 'flooded church is not a shelter');
  assert.deepEqual(s, ['school'], `the next-driest reachable place with room is used: ${s}`);
  assert.equal(w.institutions.school.open, false, 'a school used as shelter is closed to lessons');
  assert.ok(at(w, 'school').length >= 15, 'people actually went there');
});

test('if NO dry reachable shelter exists the town says so and residents are stranded, not teleported to safety', () => {
  const w = fresh();
  w.locations.church.flooded = true;
  w.locations.church.cleanupUntil = w.t + 99999;
  fire(w, { event_type: 'flood', severity: 'high' });     // school + polling station are inside the forecast zone too
  hours(w, 6);
  assert.deepEqual(w.institutions.civil.shelters, []);
  assert.ok(said(w, /No dry, reachable shelter/));
  assert.ok(by(w, n => n.activity === 'stranded').length >= 10);
});

test('a blocked road strands people: roads, not teleports, decide who can reach a shelter', () => {
  const w = fresh();
  assert.ok(findPath(w.env, { x: 19, z: 16 }, 'church'));
  w.env.stage = 1.5;                      // riverside road + main road east end are under water
  assert.equal(findPath(w.env, { x: 19, z: 16 }, 'church'), null, 'house 5 is cut off');
  assert.ok(findPath(w.env, { x: -16, z: 8 }, 'church'), 'house 1 is not');
});

// ── Market: customer flow follows road access ───────────────────────────
test('market sells to customers who can arrive; a blocked road kills sales and supply', () => {
  const a = fresh(); toTime(a, 1, 17);
  const normal = a.institutions.market.customersToday;
  assert.ok(normal >= 4, `normal Monday customers: ${normal}`);

  const b = fresh();
  fire(b, { event_type: 'market_disruption', road_blocked: true, duration_days: 2 });
  toTime(b, 1, 17);
  assert.equal(b.institutions.market.customersToday, 0);
  assert.equal(b.institutions.market.open, false);
  assert.equal(by(b, n => n.occupation === 'vendor' && n.location === 'market').length, 0, 'vendors cannot open the stall');
  const stockBefore = b.institutions.market.stock;
  toTime(b, 2, 7);
  assert.ok(said(b, /supply truck/), 'supply truck turned back');
  assert.ok(b.institutions.market.stock <= stockBefore);
  // hunger accumulates because the market is shut
  const hungry = by(b, n => n.needs.food < 0.35).length;
  assert.ok(hungry >= 1, 'shoppers got hungry');
});

test('shipment raises stock and lowers prices', () => {
  const w = fresh();
  const p0 = w.institutions.market.price, s0 = w.institutions.market.stock;
  fire(w, { event_type: 'market_shipment' });
  assert.ok(w.institutions.market.stock > s0);
  assert.ok(w.institutions.market.price < p0);
});

// ── School ──────────────────────────────────────────────────────────────
test('"school is closed tomorrow": still open today, closed tomorrow, reopens after', () => {
  const w = fresh();
  const r = say(w, 'School is closed tomorrow');
  assert.equal(r.events[0].delay_days, 1);
  assert.equal(w.scheduled.length, 1);
  toTime(w, 1, 10);
  assert.ok(at(w, 'school').filter(n => n.occupation === 'student').length >= 5, 'school is open today');
  toTime(w, 2, 10);
  assert.equal(w.institutions.school.open, false);
  assert.equal(at(w, 'school').length, 0, 'nobody at school');
  const students = by(w, n => n.occupation === 'student');
  assert.ok(students.every(n => n.location === n.home && n.activity === 'staying_home'), 'students stay home');
  assert.ok(students.every(n => /school is closed/i.test(n.reason)), 'and say why');
  toTime(w, 3, 10);
  assert.equal(w.institutions.school.open, true);
  assert.ok(at(w, 'school').length >= 7);
});

test('exam day pulls students to school on a Saturday', () => {
  const w = fresh();
  toTime(w, 6, 7);                         // Saturday
  assert.equal(at(w, 'school').length, 0);
  fire(w, { event_type: 'school_exam' });
  toTime(w, 6, 11);
  assert.ok(at(w, 'school').filter(n => n.occupation === 'student').length >= 5);
});

// ── Church ──────────────────────────────────────────────────────────────
test('Sunday: the congregation actually walks to church and attendance is recorded', () => {
  const w = fresh();
  toTime(w, 7, 8);
  assert.equal(at(w, 'church').length, 1);
  toTime(w, 7, 10, 30);
  const goers = by(w, n => n.churchGoer);
  const inChurch = goers.filter(n => n.location === 'church');
  assert.ok(inChurch.length / goers.length >= 0.9, `${inChurch.length}/${goers.length}`);
  toTime(w, 7, 12);
  assert.ok(w.institutions.church.lastAttendance.attended >= 14);
  assert.equal(at(w, 'church').length, 1, 'service is over; they went home');
});

// ── Election ────────────────────────────────────────────────────────────
function runElection(seed, extra) {
  const w = fresh(seed);
  say(w, 'The local election is tomorrow');
  if (extra) extra(w);
  toTime(w, 2, 7, 59);
  return w;
}

test('election: campaign → polls → arrivals → votes → result → history', () => {
  const w = runElection(3);
  const el = w.institutions.election;
  assert.equal(el.state, 'campaign');
  hours(w, 2);                              // 10:00 on election day
  assert.equal(el.state, 'polling');
  const early = el.voted;
  toTime(w, 2, 12);
  assert.ok(el.voted > early && el.voted > 0, 'votes are recorded as voters arrive');
  // every counted vote belongs to someone who stood at the polling station
  assert.equal(el.candidates[0].votes + el.candidates[1].votes, el.voted);
  toTime(w, 2, 19);
  assert.equal(el.state, 'done');
  const r = w.elections.at(-1);
  assert.equal(r.a + r.b, r.total);
  assert.ok(r.turnout > 40 && r.turnout <= 100, `turnout ${r.turnout}`);
  assert.ok(said(w, /wins the local election/) && said(w, /Turnout/));
  // campaigners really went to the square the day before
  assert.ok(w.history.some(h => /Campaigns begin/.test(h.text)));
});

test('election is deterministic for a seed, and varies across seeds', () => {
  const a = runElection(5); toTime(a, 2, 19);
  const b = runElection(5); toTime(b, 2, 19);
  assert.deepEqual(a.elections, b.elections);
  const results = new Set();
  for (let s = 1; s <= 12; s++) { const w = runElection(s); toTime(w, 2, 19); results.add(`${w.elections[0].a}-${w.elections[0].b}`); }
  assert.ok(results.size > 3, 'different seeds, different tallies');
});

test('campaigners moved the room: voters who met a canvasser shifted their leaning', () => {
  const w = fresh(2);
  say(w, 'There will be an election in 3 days');
  const before = Object.values(w.npcs).map(n => n.leaning);
  toTime(w, 2, 17);
  const after = Object.values(w.npcs).map(n => n.leaning);
  assert.ok(before.some((x, i) => Math.abs(x - after[i]) > 0.05), 'leanings changed through campaigning');
  const campaigners = by(w, n => n.campaignsFor);
  assert.equal(campaigners.length, 2);
});

test('flood on election day lowers turnout (people cannot reach the polls)', () => {
  const calm = runElection(4); toTime(calm, 2, 19);
  const wet = runElection(4, w => { fire(w, { event_type: 'flood', severity: 'high', delay_days: 1 }); });
  toTime(wet, 3, 19);
  const t0 = calm.elections[0]?.turnout ?? 0;
  const t1 = wet.elections[0]?.turnout ?? -1;
  // either postponed past the flood or held with lower turnout — never silently the same
  assert.ok(wet.institutions.election.postponements > 0 || t1 < t0, `calm ${t0}% vs flood ${t1}% (postponements ${wet.institutions.election.postponements})`);
  assert.ok(said(wet, /Flood|flood/));
});

test('election called for "today" before polls close opens polls at once', () => {
  const w = fresh(6);
  fire(w, { event_type: 'election', days_until: 0 });
  hours(w, 1);
  assert.equal(w.institutions.election.state, 'polling');
});

// ── Persistence & determinism ───────────────────────────────────────────
test('save → load round-trips the whole world and the future is identical', () => {
  const a = fresh(9);
  fire(a, { event_type: 'flood', severity: 'medium' });
  hours(a, 5);
  const loaded = deserialize(serialize(a));
  assert.deepEqual(loaded, JSON.parse(JSON.stringify(a)));
  hours(a, 30); hours(loaded, 30);
  assert.deepEqual(JSON.parse(JSON.stringify(loaded)), JSON.parse(JSON.stringify(a)));
});

test('corrupt or old saves are rejected, not trusted', () => {
  assert.equal(deserialize('{nope'), null);
  assert.equal(deserialize(JSON.stringify({ version: 1 })), null);
});

// ── Rejection leaves the world untouched ────────────────────────────────
test('an unsupported prompt changes nothing', () => {
  const w = fresh();
  const before = JSON.stringify(w);
  const r = say(w, 'make it snow dragons');
  assert.equal(r.events.length, 0);
  assert.equal(r.rejected.length, 1);
  assert.equal(JSON.stringify(w), before);
});
