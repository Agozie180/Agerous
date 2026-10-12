/**
 * AGEROUS — NPC behaviour
 *
 * Deterministic rules, no LLM.  Every NPC re-decides every simulated quarter-hour
 * from the world state, and every decision carries a human-readable `reason` —
 * that is what the inspector shows, so "why is she there?" always has an
 * answer that comes from the simulation.
 */

import { LOCATION_SPECS, slotPosition, isSchoolDay, isSunday, weekdayIndex } from './geography.js';
import { findPath } from './pathing.js';
import { day, hourF } from './world.js';
import { rand } from './rng.js';
import { atRisk, forecastStage } from './hazard.js';

/** Walking pace in metres per simulated minute (compressed so a commute is watchable). */
export const WALK_M_PER_MIN = 0.5;

const nm = id => LOCATION_SPECS[id].name;
const win = (h, a, b) => h >= a && h < b;

export function decide(world, npc) {
  const w = world, h = hourF(w), d = day(w), t = w.t;
  const { school, market, church, civil, election } = w.institutions;
  const L = w.locations;
  const here = npc.location;
  const reach = id => here === id || findPath(w.env, npc, id, npc.slot) !== null;
  const home = npc.home;
  const occ = npc.occupation;
  const wd = weekdayIndex(d);
  const out = (dest, activity, reason, extra) => ({ dest, activity, reason, ...extra });
  let note = '';

  // 1 ── SAFETY FIRST: evacuation orders override the daily routine ─────────
  const shelter = civil.assign[npc.id];
  if (civil.evacuation && shelter) {
    const why = L[home].flooded ? `${nm(home)} is flooded` : `${nm(home)} is in the flood zone`;
    if (reach(shelter)) {
      return out(shelter, 'sheltering', `${why}. Going to the ${nm(shelter)}, which civil defence opened as a shelter.`);
    }
    return out(here ?? npc.dest, 'stranded', `${why} and the road to the ${nm(shelter)} is under water. Stuck.`, { stranded: true });
  }
  if (civil.evacuation && civil.evacuees?.includes(npc.id)) {
    return out(here ?? npc.dest, 'stranded', `${nm(home)} is in the flood zone and no shelter is available.`, { stranded: true });
  }

  // 2 ── NIGHT ────────────────────────────────────────────────────────────
  if (h >= 22 || h < 6) return out(home, 'sleeping', `Asleep at ${nm(home)}.`);

  // 3 ── ELECTION DAY ──────────────────────────────────────────────────────
  if (election.state === 'polling' && npc.voter && !npc.voted && npc.intends && h >= npc.voteHour && h < 18) {
    if (!w.locations.polling_station.flooded && reach('polling_station')) {
      return out('polling_station', 'voting', 'Going to vote at the polling station.');
    }
    note = 'Wants to vote but cannot reach the polling station. ';
  }

  // 4 ── CAMPAIGN ─────────────────────────────────────────────────────────
  if (election.state === 'campaign' && npc.campaignsFor && win(h, 10, 16) && reach('town_square')) {
    const c = election.candidates.find(c => c.id === npc.campaignsFor);
    return out('town_square', 'campaigning', `Campaigning in the square for ${c.name}.`);
  }

  // 5 ── CHURCH ───────────────────────────────────────────────────────────
  if (occ === 'priest' && !L.church.flooded) {
    if (needsGroceries(w, home) && win(h, 11, 15) && wd < 6 && market.open && reach('market')) return out('market', 'shopping', 'The pantry at the church is empty. Going to the market.');
    return out('church', 'working', 'Tends the church.');
  }
  const sv = church.service;
  if (sv && t >= sv.startT - 90 && t < sv.endT && npc.churchGoer && !L.church.flooded) {
    const eligible = sv.kind === 'sunday' || !['student', 'teacher', 'vendor'].includes(occ);
    if (eligible && reach('church')) return out('church', 'praying', sv.kind === 'sunday' ? 'Sunday service.' : 'Attending a special service.');
  }

  // 6 ── ELDERS stay in when the weather turns ───────────────────────────
  if (occ === 'elder' && (civil.alert >= 2 || forecastStage(w) >= 1.0)) {
    return out(home, 'staying_home', 'Staying in because of the flood warning.');
  }

  // 7 ── SCHOOL ──────────────────────────────────────────────────────────
  const schoolToday = isSchoolDay(d) || (school.exam && wd === 5);
  if ((occ === 'student' || occ === 'teacher') && schoolToday && win(h, 7, 15)) {
    if (school.open && reach('school')) {
      return occ === 'student'
        ? out('school', 'studying', school.exam ? 'Sitting exams.' : 'In class.')
        : out('school', 'working', school.exam ? 'Invigilating exams.' : 'Teaching.');
    }
    const why = school.open ? 'the road to school is under water' : `school is closed (${school.reasons.join('; ')})`;
    return out(home, 'staying_home', `Stays home: ${why}.`);
  }

  // 8 ── MARKET ──────────────────────────────────────────────────────────
  if (wd < 6 && win(h, 7.5, 17)) {
    if (occ === 'vendor') {
      if (market.open && reach('market')) return out('market', 'working', 'Running a stall.');
      return out(home, 'staying_home', `Can't open the stall: ${market.reasons.join('; ') || 'road to the market is cut'}.`);
    }
    // Parents help on the stalls until lunchtime (and buy for the household while there).
    if (occ === 'parent' && win(h, 7.5, 13) && market.open && reach('market')) {
      return out('market', 'working', 'Helping on a stall.');
    }
    if (shopperOf(w, npc.home) === npc.id && needsGroceries(w, npc.home) && win(h, 9, 17)) {
      const cost = basketCost(market);
      if (market.open && market.stock >= BASKET_STOCK && householdCash(w, npc.home) >= cost && reach('market')) {
        return out('market', 'shopping', `The ${nm(npc.home)} cupboard is nearly empty. Going to the market.`);
      }
      note = market.open
        ? (market.stock < BASKET_STOCK ? 'Needs groceries but the market is out of stock. ' : (householdCash(w, npc.home) < cost ? 'Needs groceries but cannot afford them. ' : 'Needs groceries but cannot reach the market. '))
        : `Needs groceries but the market is closed (${market.reasons.join('; ')}). `;
    }
  }

  // 9 ── FARM / PUBLIC WORKS ─────────────────────────────────────────────
  if (occ === 'farmer' && wd < 6 && win(h, 6.5, 17)) {
    if (!L.fields.flooded && !atRisk(w, 'fields') && reach('fields')) return out('fields', 'working', 'Working the fields.');
    return out(home, 'staying_home', 'Cannot work: the fields are flooded or at risk.');
  }
  if (occ === 'worker' && wd < 5 && win(h, 7, 17) && !L.town_square.flooded && reach('town_square')) {
    return out('town_square', 'working', 'On public-works duty in the square.');
  }

  // 10 ── EVENING SOCIAL ──────────────────────────────────────────────────
  // Lonely people go looking for company: the evenings, and weekend afternoons.
  const freeTime = win(h, 17, 21) || (wd >= 5 && win(h, 13, 19));
  if (freeTime && npc.needs.social < 0.65 && !L.town_square.flooded && reach('town_square')) {
    return out('town_square', 'idle', `Feeling isolated (social ${Math.round(npc.needs.social * 100)}%). Heading to the square.`);
  }

  return out(home, 'idle', `${note}At ${nm(home)}.`);
}

/** Apply a decision: start walking, or settle in place. */
export function applyDecision(world, npc, dec) {
  npc.reason = dec.reason;
  if (dec.stranded) {
    npc.path = [];
    npc.activity = 'stranded';
    npc.dest = npc.location ?? npc.dest;
    return;
  }
  if (npc.location === dec.dest && npc.path.length === 0) {
    npc.dest = dec.dest; npc.activity = dec.activity;
    return;
  }
  if (npc.dest === dec.dest && npc.path.length > 0 && npc.pathSig === world.pathSig) {
    npc.activity = dec.activity === 'sheltering' ? 'evacuating' : 'traveling';
    npc.goal = dec.activity;
    return;
  }
  const path = findPath(world.env, npc, dec.dest, npc.slot);
  if (!path) {
    npc.path = []; npc.activity = 'stranded'; npc.dest = npc.location ?? npc.dest;
    npc.reason = `Cannot reach the ${nm(dec.dest)}: roads are flooded.`;
    return;
  }
  npc.dest = dec.dest; npc.goal = dec.activity;
  npc.path = path; npc.pathSig = world.pathSig;
  npc.location = null;
  npc.activity = dec.activity === 'sheltering' ? 'evacuating' : 'traveling';
}

/** Advance everyone along their paths by `minutes` of simulated time. */
export function moveNPCs(world, minutes) {
  for (const npc of Object.values(world.npcs)) {
    if (!npc.path.length) continue;
    let step = WALK_M_PER_MIN * minutes;
    while (step > 0 && npc.path.length) {
      const [tx, tz] = npc.path[0];
      const dx = tx - npc.x, dz = tz - npc.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 1e-6) npc.heading = Math.atan2(dx, dz);
      if (dist <= step) { npc.x = tx; npc.z = tz; step -= dist; npc.path.shift(); }
      else { npc.x += (dx / dist) * step; npc.z += (dz / dist) * step; step = 0; }
    }
    if (!npc.path.length) arrive(world, npc);
  }
}

function arrive(world, npc) {
  npc.location = npc.dest;
  npc.activity = npc.goal ?? 'idle';
  if (npc.location === 'polling_station' && npc.activity === 'voting') castVote(world, npc);
  if (npc.location === 'market' && npc.activity === 'shopping') purchase(world, npc);
}

export function castVote(world, npc) {
  const el = world.institutions.election;
  if (el.state !== 'polling' || npc.voted || !npc.voter) return false;
  npc.voted = true;
  // Secret ballot: only the tally is kept.  The choice follows the voter's leaning,
  // which campaigning, floods and prices have been nudging.
  const choice = npc.leaning + (rand(world) - 0.5) * 0.5 < 0 ? 0 : 1;
  el.candidates[choice].votes += 1;
  el.voted += 1;
  npc.reason = 'Cast a ballot.';
  return true;
}

export const BASKET_STOCK = 4;          // market stock one basket uses
export const BASKET_MEALS = 12;         // meals one basket gives a household
export const basketCost = m => Math.round(38 * m.price);
export const membersOf = (w, home) => Object.values(w.npcs).filter(n => n.home === home);
/** Households pool their money: elders and children don't starve because they don't earn. */
export const householdCash = (w, home) => membersOf(w, home).reduce((a, n) => a + n.money, 0);
function payHousehold(w, home, cost) {
  if (householdCash(w, home) < cost) return false;
  let left = cost;
  for (const n of membersOf(w, home).sort((a, b) => b.money - a.money)) {
    const take = Math.min(n.money, left); n.money -= take; left -= take; if (left <= 0) break;
  }
  return true;
}
export const needsGroceries = (w, home) => w.households[home].pantry < membersOf(w, home).length * 3;
const SHOPPER_ORDER = ['elder', 'farmer', 'worker', 'priest'];
/** The household member who does the shopping: someone not already tied to a stall or a classroom. */
export function shopperOf(w, home) {
  const m = membersOf(w, home).filter(n => SHOPPER_ORDER.includes(n.occupation))
    .sort((a, b) => SHOPPER_ORDER.indexOf(a.occupation) - SHOPPER_ORDER.indexOf(b.occupation) || a.id.localeCompare(b.id));
  return m[0]?.id ?? null;
}

/** Buy groceries for the buyer's household: up to two baskets, while stock, money and cupboard space allow. */
export function purchase(world, npc) {
  const m = world.institutions.market;
  const hh = world.households[npc.home];
  const members = membersOf(world, npc.home).length;
  if (!m.open) { npc.reason = 'The market closed before they arrived.'; return false; }
  let bought = 0;
  while (bought < 2 && hh.pantry < members * 6) {
    const cost = basketCost(m);
    if (m.stock < BASKET_STOCK) { npc.reason = bought ? 'Bought what was left.' : 'The market is out of stock.'; break; }
    if (!payHousehold(world, npc.home, cost)) { npc.reason = bought ? 'Bought what they could afford.' : 'Could not afford the goods.'; break; }
    m.stock -= BASKET_STOCK; hh.pantry += BASKET_MEALS;
    m.salesToday += 1; m.revenueToday += cost; bought++;
  }
  if (bought) { m.customersToday += 1; npc.reason = `Bought ${bought} basket${bought > 1 ? 's' : ''} for the household.`; }
  return bought > 0;
}

/** Re-plan everyone; called every simulated quarter-hour and after any event. */
export function decideAll(world) {
  for (const npc of Object.values(world.npcs)) applyDecision(world, npc, decide(world, npc));
}

export function placeNPC(npc, locationId) {
  const p = slotPosition(locationId, npc.slot);
  npc.x = p.x; npc.z = p.z; npc.location = locationId; npc.dest = locationId; npc.path = [];
}
