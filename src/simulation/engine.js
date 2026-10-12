/**
 * AGEROUS — Simulation engine
 *
 * step(world, dtSeconds) advances the clock.  Everything is derived from `world`
 * alone, so the same function runs in the browser's frame loop and in the Node
 * test-suite.
 */

import { day, hour, log } from './world.js';
import { moveNPCs, purchase, needsGroceries } from './npcs.js';
import { refresh } from './policies.js';
import { runScheduled } from './events.js';
import { findPath } from './pathing.js';
import { isRaining } from './hazard.js';
import { rand } from './rng.js';

const RISE_PER_HOUR = 0.35;     // river rises this fast (m/h) while it rains
const FALL_PER_HOUR = 0.12;     // and recedes this fast after

function updateEnvironment(w, m) {
  const env = w.env;
  if (isRaining(w)) {
    env.stage = Math.min(env.peak, env.stage + (RISE_PER_HOUR * m) / 60);
    env.wasRaining = true;
  } else {
    if (env.wasRaining) {
      env.wasRaining = false; env.rainUntil = null;
      if (env.stage > 0.1) log(w, 'The rain has stopped, but the river will take time to fall.', 'info');
      else log(w, 'The rain has stopped.', 'good');
    }
    env.stage = Math.max(0, env.stage - (FALL_PER_HOUR * m) / 60);
    if (env.stage === 0) env.peak = 0;
  }
}

const WAGE = { teacher: 18, farmer: 14, worker: 15, priest: 12, parent: 10, vendor: 12 };
const WORKPLACE = { teacher: 'school', vendor: 'market', parent: 'market', farmer: 'fields', worker: 'town_square', priest: 'church' };
const MEALS = [7, 13, 19];

function hourly(w) {
  const h = hour(w);
  const { market, election, civil } = w.institutions;

  // Work is real: time actually spent at the workplace is what earns a wage.
  for (const n of Object.values(w.npcs)) {
    if (n.activity === 'working' && n.location === WORKPLACE[n.occupation]) n.workedMin += 60;
    // Farmers' labour is where the market's fresh produce comes from — no fields, no harvest.
    if (n.occupation === 'farmer' && n.activity === 'working' && n.location === 'fields' && findPath(w.env, n, 'market') !== null) { market.stock = Math.min(100, market.stock + 1); market.harvested += 1; }
  }
  // Parents and vendors at the stalls pick up groceries for their household.
  for (const n of Object.values(w.npcs)) {
    if (n.location === 'market' && ['vendor', 'parent'].includes(n.occupation) && needsGroceries(w, n.home)) purchase(w, n);
  }

  // Meals: everyone eats from their household's cupboard; shelters serve rations.
  if (MEALS.includes(h)) {
    for (const n of Object.values(w.npcs)) {
      const hh = w.households[n.home];
      if (n.location && w.locations[n.location]?.isShelter) n.needs.food = Math.min(1, n.needs.food + 0.33);
      else if (hh.pantry > 0) { hh.pantry -= 1; n.needs.food = Math.min(1, n.needs.food + 0.33); }
    }
  }

  // Needs
  for (const n of Object.values(w.npcs)) {
    const asleep = h >= 22 || h < 6;
    n.needs.food = Math.max(0, n.needs.food - (asleep ? 0.015 : 0.04));
    const social = ['town_square', 'church', 'market', 'polling_station'].includes(n.location);
    n.needs.social = Math.min(1, Math.max(0, n.needs.social + (social ? 0.06 : -0.012)));
  }

  // 18:00 payday — only for people who really put in the hours.
  if (h === 18) {
    for (const n of Object.values(w.npcs)) {
      n.wageToday = 0;
      if (WAGE[n.occupation] && n.workedMin >= 240) {
        n.wageToday = WAGE[n.occupation] + (n.occupation === 'vendor' ? Math.round(market.revenueToday / 12) : 0);
        n.money += n.wageToday;
      }
      n.workedMin = 0;
    }
  }

  // Midnight: roll the market's daily counters
  if (h === 0) {
    market.customersYesterday = market.customersToday;
    market.salesToday = 0; market.revenueToday = 0; market.customersToday = 0;
  }
  // 06:00: the supply truck comes in from the west — if the road lets it through
  if (h === 6) {
    if (findPath(w.env, { x: -30, z: 0 }, 'market') !== null && !(w.env.blockedRoads.market_road != null)) {
      market.stock = Math.min(100, market.stock + 10); market.supplyBlockedLogged = false;
    } else if (!market.supplyBlockedLogged) {
      log(w, "The supply truck couldn't get through to the market.", 'warn');
      market.supplyBlockedLogged = true;
    }
  }

  // Campaigning: persuasion happens where people actually meet
  if (election.state === 'campaign') {
    const crowd = Object.values(w.npcs).filter(n => n.location === 'town_square' && n.voter);
    for (const c of crowd.filter(n => n.campaignsFor)) {
      for (const n of crowd) {
        if (n === c) continue;
        n.leaning += (c.campaignsFor === 'a' ? -0.06 : 0.06);
        if (rand(w) < 0.4) n.intends = true;     // being canvassed raises turnout
      }
    }
    // The world leans on voters too: floods favour the flood-defence candidate,
    // dear food favours the one promising lower prices.
    for (const n of Object.values(w.npcs)) {
      if (w.institutions.civil.alert >= 2) n.leaning -= 0.01;
      if (market.price > 1.3) n.leaning += 0.01;
    }
  }
}

/** Advance the world by `minutes` simulated minutes (in ≤1-minute slices). */
export function advanceMinutes(world, minutes) {
  let left = minutes;
  while (left > 1e-9) {
    const m = Math.min(1, left);
    left -= m;
    const t0 = world.t;
    world.t += m;
    updateEnvironment(world, m);
    runScheduled(world);
    moveNPCs(world, m);
    if (Math.floor(world.t / 15) !== Math.floor(t0 / 15)) refresh(world);
    if (Math.floor(world.t / 60) !== Math.floor(t0 / 60)) hourly(world);
    if (Math.floor(world.t / 1440) !== Math.floor(t0 / 1440)) {
      log(world, `Day ${day(world)} begins.`, 'info');
    }
  }
}

/** Frame-loop entry point. */
export function step(world, dtSeconds) {
  const dt = Math.min(dtSeconds, 0.25);       // a hidden tab must not fast-forward the town
  if (world.timeSpeed > 0) advanceMinutes(world, dt * world.timeSpeed);
}

/**
 * Prepare a freshly created world: let the town wake up and walk to work so the
 * first frame the player sees is a community already in motion (08:00).
 * Loaded saves are untouched.
 */
export function startWorld(world) {
  if (!world.started) {
    refresh(world);
    advanceMinutes(world, 8 * 60 - world.t);
    world.history = world.history.filter(h => h.text.startsWith('Day 1 ·'));
    world.started = true;
  }
  return world;
}
