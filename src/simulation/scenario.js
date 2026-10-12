/**
 * AGEROUS — the "Storm Day" challenge: a fixed town, a fixed storm, five sentences.
 *
 * Everyone plays the SAME world (fixed seed + scripted storm and election).  A run is just
 * the list of validated events the player triggered and the tick they triggered them on.
 * Because the simulation is deterministic and tick-based, the server can REPLAY a run and
 * compute the score itself — a client cannot simply claim a high score.
 */
import { createWorld, log } from './world.js';
import { startWorld, advanceMinutes } from './engine.js';
import { queueEvent } from './events.js';
import { validateEvents } from './schema.js';
import { communityScore } from './challenges.js';

export const SCENARIO = {
  id: 'storm-day-v1',
  title: 'Storm Day',
  seed: 20261011,
  brief: 'Everything is going wrong at once: a severe flood is coming, the market road is blocked, the school is shut by order, and the election is in two days. You have 5 sentences to bring the town through it.',
  maxPrompts: 5,
  maxEventsPerRun: 10,
  endT: 4 * 1440,             // end of Day 4 (Day 5 00:00)
};

/** A fresh scenario world with the scripted threats already in motion. */
export function createScenarioWorld() {
  const w = startWorld(createWorld(SCENARIO.seed));
  w.scenario = { id: SCENARIO.id, prompts: 0, events: 0, run: [] };
  queueEvent(w, { event_type: 'flood', severity: 'high', duration_days: 2, delay_days: 0 });
  queueEvent(w, { event_type: 'market_disruption', duration_days: 3, road_blocked: true, delay_days: 0 });
  queueEvent(w, { event_type: 'school_closure', duration_days: 3, reason: 'closed by order', delay_days: 0 });
  queueEvent(w, { event_type: 'election', days_until: 2 });
  log(w, `Challenge: ${SCENARIO.title}. ${SCENARIO.brief}`, 'major');
  return w;
}

export const scenarioOver = w => w.t >= SCENARIO.endT;

/** Daytime service hours possible in the 4 scenario days (Mon–Thu): market 32, school 24. */
const MARKET_H = 32, SCHOOL_H = 24;

/** 0–1000. Safety 300, services 300, democracy 250, wellbeing 150. */
export function scoreScenario(w) {
  const ep = w.stats.lastEpisode || w.stats.episode;
  const exposed = ep ? ep.exposedNpcHours : 0;
  const safety = Math.max(0, 1 - exposed / 140) * 300;
  const services = Math.min(1, (w.stats.marketHours || 0) / MARKET_H) * 150 + Math.min(1, (w.stats.schoolHours || 0) / SCHOOL_H) * 150;
  const election = w.elections.at(-1);
  const democracy = election ? (election.turnout / 100) * 250 : 0;
  const wellbeing = (communityScore(w) / 100) * 150;
  const parts = { safety: Math.round(safety), services: Math.round(services), democracy: Math.round(democracy), wellbeing: Math.round(wellbeing) };
  return { total: parts.safety + parts.services + parts.democracy + parts.wellbeing, parts, exposedNpcHours: Math.round(exposed), turnout: election?.turnout ?? null,
    marketHours: w.stats.marketHours || 0, schoolHours: w.stats.schoolHours || 0 };
}

/**
 * Record a player's sentence as part of the run (called by the game after validation).
 * Returns false if the player is out of sentences.
 */
export function recordRun(w, events) {
  const s = w.scenario;
  if (!s || s.prompts >= SCENARIO.maxPrompts) return false;
  s.prompts++;
  for (const e of events) { if (s.events < SCENARIO.maxEventsPerRun) { s.events++; s.run.push({ t: w.t, event: e }); } }
  return true;
}

/**
 * Re-run a submitted run from scratch and score it.  Input is untrusted: every event is
 * re-validated, budgets are re-applied, and times must be sane.
 * @returns {{ok:true, score:object, used:number}|{ok:false, error:string}}
 */
export function replayRun(run) {
  if (!Array.isArray(run) || run.length > SCENARIO.maxEventsPerRun) return { ok: false, error: 'bad run' };
  const w = createScenarioWorld();
  const start = w.t;
  let last = start;
  for (const item of run) {
    const t = Number(item?.t);
    if (!Number.isInteger(t) || t < last || t >= SCENARIO.endT) return { ok: false, error: 'bad event time' };
    const v = validateEvents({ events: [item.event] });
    if (v.events.length !== 1) return { ok: false, error: 'invalid event in run' };
    advanceMinutes(w, t - w.t);
    queueEvent(w, v.events[0]);
    last = t;
  }
  advanceMinutes(w, SCENARIO.endT - w.t);
  return { ok: true, score: scoreScenario(w), used: run.length };
}
