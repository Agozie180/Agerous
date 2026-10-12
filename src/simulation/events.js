/**
 * AGEROUS — Event execution
 *
 * Validated events (see schema.js) are applied here.  Each handler changes
 * WORLD STATE — environment, institutions, calendars.  None of them moves an NPC
 * or an object: people react on their own because the rules in npcs.js and
 * policies.js read the new state.
 */

import { day, hour, log, dayStartT } from './world.js';
import { rand } from './rng.js';
import { refresh } from './policies.js';
import { weekdayName } from './geography.js';

export const FLOOD_PEAK = { low: 1.3, medium: 2.2, high: 2.8 };   // metres above the normal river line
const RAIN_PEAK = { drizzle: 0.2, rain: 0.2, storm: 0.5 };

function startRain(w, peak, hours) {
  w.env.peak = Math.max(w.env.peak, peak);
  w.env.rainUntil = Math.max(w.env.rainUntil ?? w.t, w.t + hours * 60);
}

export const DEFENSE_HEIGHT = { sandbags: 0.5, levee: 1.0, flood_wall: 1.6 };
const STRUCTURE_NAME = { sandbags: 'Sandbags', levee: 'A levee', flood_wall: 'A flood wall' };
const HOMES = ['house_1', 'house_2', 'house_3', 'house_4', 'house_5'];

const HANDLERS = {
  build(w, e) {
    w.env.defenses ??= {};
    const h = DEFENSE_HEIGHT[e.structure];
    const targets = e.target === 'homes' ? HOMES : [e.target];
    const built = [], skipped = [];
    for (const id of targets) {
      const name = w.locations[id]?.name ?? id;
      if (w.locations[id]?.flooded) skipped.push(`${name} (already under water)`);
      else if ((w.env.defenses[id] ?? 0) >= h) skipped.push(`${name} (already protected as well or better)`);
      else { w.env.defenses[id] = h; built.push(name); }
    }
    if (built.length) log(w, `${STRUCTURE_NAME[e.structure]} goes up around ${built.join(', ')} (+${h.toFixed(1)} m of protection).`, 'major');
    if (skipped.length) log(w, `Nothing built at ${skipped.join(', ')}.`, 'info');
    if (!built.length) return { ok: false, message: `Could not build: ${skipped.join('; ')}.` };
    return { ok: true };
  },
  flood(w, e) {
    const peak = FLOOD_PEAK[e.severity];
    startRain(w, peak, e.duration_days * 12);
    log(w, `Heavy rain begins. Forecast: the river may rise ${peak.toFixed(1)} m (${e.severity} flood, ~${e.duration_days * 12}h of rain).`, 'warn');
  },
  weather_change(w, e) {
    if (e.weather === 'clear' || e.weather === 'cloudy') {
      w.env.baseWeather = e.weather;
      if (w.env.rainUntil != null && w.t < w.env.rainUntil) { w.env.rainUntil = w.t; log(w, 'The rain stops.', 'good'); }
      else log(w, `The sky turns ${e.weather}.`, 'info');
    } else {
      startRain(w, RAIN_PEAK[e.weather], 12);
      log(w, e.weather === 'storm' ? 'A storm blows in.' : 'Rain begins.', 'info');
    }
  },
  school_closure(w, e) {
    const s = w.institutions.school;
    s.eventClosedUntil = w.t + e.duration_days * 1440;
    s.eventReason = e.reason;
    log(w, `School closed for ${e.duration_days} day(s): ${e.reason}.`, 'major');
  },
  school_reopen(w) {
    w.institutions.school.eventClosedUntil = null;
    log(w, 'The order closing the school is lifted.', 'good');
  },
  school_exam(w) {
    const s = w.institutions.school;
    s.exam = true; s.examUntil = dayStartT(day(w) + 1);
    log(w, 'Exam day: students and teachers are expected at school.', 'info');
  },
  market_shipment(w) {
    const m = w.institutions.market;
    m.stock = Math.min(150, m.stock + 70);
    log(w, 'A large shipment of goods arrives at the market. Stock is up, prices fall.', 'good');
  },
  market_disruption(w, e) {
    w.institutions.market.disruptedUntil = w.t + e.duration_days * 1440;
    if (e.road_blocked) w.env.blockedRoads.market_road = w.t + e.duration_days * 1440;
    log(w, `The market is disrupted for ${e.duration_days} day(s)${e.road_blocked ? ' and Market Road is blocked' : ''}.`, 'warn');
  },
  church_service(w) {
    const c = w.institutions.church;
    if (w.locations.church.flooded) { log(w, 'A church service was called, but the church is flooded.', 'info'); return; }
    c.service = { kind: 'special', startT: w.t, endT: w.t + 150, begun: false };
    log(w, 'A special church service is called. The congregation gathers.', 'info');
  },
  election(w, e) {
    const el = w.institutions.election;
    if (el.state === 'campaign' || el.state === 'polling') {
      log(w, 'An election is already in progress.', 'info');
      return { ok: false, message: 'An election is already under way.' };
    }
    let when = day(w) + e.days_until;
    if (e.days_until === 0 && hour(w) >= 17) when = day(w) + 1;   // polls would be shut
    el.state = 'campaign'; el.electionDay = when; el.announcedT = w.t; el.postponements = 0;
    el.candidates.forEach(c => { c.votes = 0; });
    el.voted = 0; el.result = null;
    for (const n of Object.values(w.npcs)) {
      n.voted = false;
      n.intends = rand(w) < 0.75;
      n.voteHour = 8 + Math.floor(rand(w) * 8);
    }
    const [a, b] = el.candidates;
    log(w, `Local election called for Day ${when} (${weekdayName(when)}): ${a.name} vs ${b.name}. Campaigns begin.`, 'major');
  },
  recovery(w) {
    for (const loc of Object.values(w.locations)) if (loc.cleanupUntil != null) loc.cleanupUntil = Math.min(loc.cleanupUntil, w.t + 60);
    for (const r of Object.keys(w.env.blockedRoads)) w.env.blockedRoads[r] = w.t;
    w.institutions.market.disruptedUntil = null;
    log(w, 'Clean-up crews are out: blockages cleared, repairs speeded up.', 'good');
  },
};

/** Apply a validated event right now. */
export function applyEvent(world, event) {
  const h = HANDLERS[event.event_type];
  if (!h) return { ok: false, message: `Unsupported event: ${event.event_type}` };
  const res = h(world, event) || { ok: true };
  refresh(world);
  return res;
}

/** Apply now, or queue for later if the event says "tomorrow" / "in N days". */
export function queueEvent(world, event) {
  const delay = event.delay_days ?? 0;
  if (delay > 0) {
    const t = dayStartT(day(world) + delay);
    world.scheduled.push({ t, event: { ...event, delay_days: 0 } });
    world.scheduled.sort((a, b) => a.t - b.t);
    log(world, `Scheduled for Day ${day(world) + delay} (${weekdayName(day(world) + delay)}): ${event.event_type.replace(/_/g, ' ')}.`, 'info');
    return { ok: true, scheduled: true, message: `Scheduled for Day ${day(world) + delay}.` };
  }
  return applyEvent(world, event);
}

/** Fire any scheduled events that have come due. */
export function runScheduled(world) {
  while (world.scheduled.length && world.scheduled[0].t <= world.t) {
    const { event } = world.scheduled.shift();
    applyEvent(world, event);
  }
}
