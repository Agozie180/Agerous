/**
 * AGEROUS — Institutions & civil defence
 *
 * All the "who decides what" rules live here.  They run every simulated
 * quarter-hour (and immediately after any event) and read ONLY world state, so
 * the consequences of a flood, a closure or an election are computed — never
 * scripted per event.
 */

import {
  LOCATION_SPECS, locationElevation, isSunday, isSchoolDay, weekdayIndex,
} from './geography.js';
import { GRAPH, edgeBlocked, findPath } from './pathing.js';
import { FLOOD_DEPTH, atRisk, forecastStage, isRaining } from './hazard.js';
import { day, hour, hourF, log, dayStartT } from './world.js';
import { decideAll } from './npcs.js';
import { rand } from './rng.js';

const nm = id => LOCATION_SPECS[id].name;
const SQUARE = { x: 0, z: 0 };
const WEST_ENTRANCE = { x: -30, z: 0 };

/** Everything that must be re-evaluated when the world changes. */
export function refresh(world) {
  updateLocations(world);
  updatePathSignature(world);
  updateCivilDefence(world);
  updateSchool(world);
  updateMarket(world);
  updateChurch(world);
  updateElection(world);
  decideAll(world);
  updateSafety(world);
  trackEpisode(world);
}

// ─── Places & roads ─────────────────────────────────────────────────────

function updateLocations(w) {
  const stage = w.env.stage;
  for (const [id, loc] of Object.entries(w.locations)) {
    const elev = locationElevation(id);
    const spec = LOCATION_SPECS[id];
    const wet = stage > elev + FLOOD_DEPTH;
    if (wet) {
      if (!loc.flooded) {
        loc.flooded = true;
        const major = ['school', 'market', 'church', 'polling_station'].includes(id);
        log(w, `Flooding at ${loc.name}.`, major ? 'warn' : 'info');
      }
      loc.cleanupUntil = null;
    } else if (loc.flooded) {
      if (loc.cleanupUntil == null) {
        if (spec.cleanupHours === 0) { loc.flooded = false; continue; }
        loc.cleanupUntil = w.t + spec.cleanupHours * 60;
        log(w, `Floodwater has left ${loc.name}. Clean-up under way (~${spec.cleanupHours}h).`, 'info');
      } else if (w.t >= loc.cleanupUntil) {
        loc.flooded = false; loc.cleanupUntil = null;
        log(w, `${loc.name} usable again.`, 'good');
      }
    }
  }
  for (const [roadId, until] of Object.entries(w.env.blockedRoads)) {
    if (w.t >= until) { delete w.env.blockedRoads[roadId]; log(w, `${roadName(roadId)} has been cleared.`, 'good'); }
  }
}

const roadName = id => id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

function updatePathSignature(w) {
  const blocked = [];
  GRAPH.edges.forEach((e, i) => { if (edgeBlocked(e, w.env)) blocked.push(i); });
  const sig = blocked.join(',');
  if (w.pathSig !== sig) {
    w.pathSig = sig;
    // announce when a named road first becomes impassable / reopens
    const nowBlockedRoads = new Set(blocked.map(i => GRAPH.edges[i].road).filter(r => !r.startsWith('spur:')));
    const prev = new Set(w.roadsDown ?? []);
    for (const r of nowBlockedRoads) if (!prev.has(r)) log(w, `${roadName(r)} is impassable.`, 'warn');
    for (const r of prev) if (!nowBlockedRoads.has(r)) log(w, `${roadName(r)} is passable again.`, 'good');
    w.roadsDown = [...nowBlockedRoads];
  }
}

// ─── Civil defence: warnings, evacuation, shelters ──────────────────────

function updateCivilDefence(w) {
  const civil = w.institutions.civil;
  const forecast = forecastStage(w);
  civil.forecast = forecast;

  const homes = [...new Set(Object.values(w.npcs).map(n => n.home))];
  const hot = homes.filter(h => atRisk(w, h) || w.locations[h].flooded);
  const flooded = homes.filter(h => w.locations[h].flooded);

  // 1 watch: heavy rain · 2 warning: forecast puts homes at risk · 3 emergency: homes are under water
  let alert = 0;
  if (isRaining(w) && forecast >= 0.5) alert = 1;
  if (hot.length > 0) alert = 2;
  if (flooded.length > 0) alert = 3;

  const evacuees = Object.values(w.npcs).filter(n => hot.includes(n.home)).map(n => n.id).sort();
  const evacuation = evacuees.length > 0;

  // Choose shelters by RULE: dry, not at risk, reachable from the town centre, with
  // capacity — driest first — until the evacuees fit.  Nothing here names the church.
  let shelters = [];
  if (evacuation) {
    const candidates = Object.entries(LOCATION_SPECS)
      .filter(([id, s]) => s.shelterCapacity > 0 && !w.locations[id].flooded && !atRisk(w, id)
        && findPath(w.env, SQUARE, id) !== null)
      .sort((a, b) => locationElevation(b[0]) - locationElevation(a[0]));
    let cap = 0;
    for (const [id, s] of candidates) {
      if (cap >= evacuees.length) break;
      shelters.push(id); cap += s.shelterCapacity;
    }
  }

  // Assign each evacuee to the nearest chosen shelter with room.
  const assign = {};
  const room = Object.fromEntries(shelters.map(id => [id, LOCATION_SPECS[id].shelterCapacity]));
  for (const nid of evacuees) {
    const n = w.npcs[nid];
    const ranked = shelters.filter(id => room[id] > 0)
      .sort((a, b) => dist(n, a) - dist(n, b));
    if (ranked.length) { assign[nid] = ranked[0]; room[ranked[0]]--; }
  }

  // ---- announcements (only on change) ----
  if (alert !== civil.alert) {
    const names = ['', 'Flood watch issued: heavy rain, river rising.', 'FLOOD WARNING: forecast puts homes at risk.', 'FLOOD EMERGENCY: homes are under water.'];
    if (alert > civil.alert) log(w, names[alert] ?? '', alert >= 2 ? 'warn' : 'info');
    else if (alert === 0) log(w, 'Flood alert lifted.', 'good');
  }
  if (evacuation && !civil.evacuation) {
    log(w, `Evacuation ordered for ${hot.map(nm).join(', ')} (forecast river level ${forecast.toFixed(1)} m).`, 'warn');
  }
  const prevS = civil.shelters.join(','), nextS = shelters.join(',');
  if (prevS !== nextS) {
    for (const id of shelters) if (!civil.shelters.includes(id)) {
      log(w, `${nm(id)} opened as an emergency shelter (dry, reachable, room for ${LOCATION_SPECS[id].shelterCapacity}).`, 'major');
    }
    for (const id of civil.shelters) if (!shelters.includes(id)) {
      log(w, `${nm(id)} shelter closed.`, shelters.length ? 'info' : 'good');
    }
  }
  if (!evacuation && civil.evacuation) log(w, 'Evacuation lifted — residents may return home.', 'good');
  if (evacuation && shelters.length === 0 && (!civil.evacuation || prevS !== '')) {
    log(w, 'No dry, reachable shelter is available!', 'warn');
  }

  civil.alert = alert; civil.evacuation = evacuation; civil.evacuees = evacuees;
  civil.shelters = shelters; civil.assign = assign;
  for (const [id, loc] of Object.entries(w.locations)) loc.isShelter = shelters.includes(id);
}

const dist = (n, id) => Math.hypot(n.x - LOCATION_SPECS[id].x, n.z - LOCATION_SPECS[id].z);

// ─── School ─────────────────────────────────────────────────────────────

function updateSchool(w) {
  const s = w.institutions.school;
  if (s.exam && s.examUntil != null && w.t >= s.examUntil) { s.exam = false; s.examUntil = null; log(w, 'Exams are over.', 'info'); }
  const reasons = [];
  if (s.eventClosedUntil != null && w.t < s.eventClosedUntil) reasons.push(s.eventReason || 'closed by order');
  if (w.locations.school.flooded) reasons.push('building flooded / being cleaned');
  else {
    if (findPath(w.env, SQUARE, 'school') === null) reasons.push('road to school is under water');
    if (atRisk(w, 'school')) reasons.push('flood warning: school at risk');
  }
  const students = Object.values(w.npcs).filter(n => n.occupation === 'student');
  const affected = students.filter(n => atRisk(w, n.home) || w.locations[n.home].flooded).length;
  if (students.length && affected / students.length >= 0.4) reasons.push(`${affected} of ${students.length} students live in the flood zone`);
  if (w.institutions.civil.shelters.includes('school')) reasons.push('being used as a shelter');

  const open = reasons.length === 0;
  if (open !== s.open) {
    log(w, open ? 'School reopens.' : `School closed: ${reasons.join('; ')}.`, open ? 'good' : 'major');
  }
  s.open = open; s.reasons = reasons;
}

// ─── Market ─────────────────────────────────────────────────────────────

function updateMarket(w) {
  const m = w.institutions.market;
  const reasons = [];
  if (m.disruptedUntil != null && w.t < m.disruptedUntil) reasons.push('disrupted');
  if (w.locations.market.flooded) reasons.push('market flooded / being cleaned');
  else if (findPath(w.env, SQUARE, 'market') === null) reasons.push('road to the market is cut');
  const open = reasons.length === 0;
  if (open !== m.open) log(w, open ? 'Market reopens.' : `Market closed: ${reasons.join('; ')}.`, open ? 'good' : 'major');
  m.open = open; m.reasons = reasons;
  m.price = Math.max(0.7, Math.min(1.8, 1.6 - m.stock * 0.01));
}

// ─── Church ─────────────────────────────────────────────────────────────

function updateChurch(w) {
  const c = w.institutions.church;
  const d = day(w), h = hourF(w);
  if (c.service && w.t >= c.service.endT) {
    const goers = Object.values(w.npcs).filter(n => n.churchGoer && (c.service.kind === 'sunday' || !['student', 'teacher', 'vendor'].includes(n.occupation)));
    const attended = goers.filter(n => n.location === 'church').length;
    c.lastAttendance = { kind: c.service.kind, day: d, goers: goers.length, attended };
    log(w, `Church service ended (${attended} of ${goers.length} regulars attended).`, 'info');
    c.service = null;
  }
  if (c.service && w.locations.church.flooded) { log(w, 'Church service cancelled: flooded.', 'warn'); c.service = null; }
  // Sunday service is on the calendar: congregation starts walking at 07:45 for 09:00–11:00.
  if (!c.service && isSunday(d) && h >= 7.5 && h < 11 && c.lastSundayDay !== d && !w.locations.church.flooded) {
    c.lastSundayDay = d;
    c.service = { kind: 'sunday', startT: dayStartT(d) + 9 * 60, endT: dayStartT(d) + 11 * 60, begun: false };
  }
  if (c.service && !c.service.begun && w.t >= c.service.startT) {
    c.service.begun = true;
    log(w, c.service.kind === 'sunday' ? 'Sunday service begins.' : 'The service begins.', 'info');
  }
}

// ─── Election ───────────────────────────────────────────────────────────

function updateElection(w) {
  const el = w.institutions.election;
  const d = day(w), h = hourF(w);
  if (el.state === 'campaign' && d >= el.electionDay && h >= 8) {
    if (w.locations.polling_station.flooded || findPath(w.env, SQUARE, 'polling_station') === null) {
      el.electionDay = d + 1; el.postponements += 1;
      log(w, 'Election POSTPONED a day: the polling station cannot be used.', 'warn');
    } else {
      el.state = 'polling';
      el.voted = 0; el.floodDuringPolling = false;
      el.eligible = Object.values(w.npcs).filter(n => n.voter).length;
      log(w, 'Polls are open (08:00–18:00). Voters head for the polling station.', 'major');
    }
  }
  if (el.state === 'polling') {
    if (w.institutions.civil.alert >= 2) el.floodDuringPolling = true;
    if (h >= 18) concludeElection(w);
  }
}

function concludeElection(w) {
  const el = w.institutions.election;
  const [a, b] = el.candidates;
  const total = a.votes + b.votes;
  const turnout = el.eligible ? Math.round((total / el.eligible) * 100) : 0;
  const winner = b.votes > a.votes ? b : a;
  el.state = 'done';
  el.result = { day: day(w), winner: winner.name, a: a.votes, b: b.votes, total, eligible: el.eligible, turnout,
    flood: !!el.floodDuringPolling };
  w.elections.push(el.result);
  log(w, `Polls closed. ${a.name} ${a.votes} — ${b.name} ${b.votes}. Turnout ${turnout}% (${total}/${el.eligible}).`, 'major');
  log(w, `${winner.name} wins the local election.`, 'major');
  for (const n of Object.values(w.npcs)) n.voted = false;
}

// ─── Safety need & flood-episode accounting ─────────────────────────────

function updateSafety(w) {
  for (const n of Object.values(w.npcs)) {
    let target = 1;
    if (n.activity === 'stranded') target = 0.25;
    else if (n.location && w.locations[n.location]?.isShelter) target = 0.9;
    else if (n.location && (w.locations[n.location].flooded || atRisk(w, n.location))) target = 0.5;
    else if (!n.location && w.institutions.civil.evacuation) target = 0.7;
    n.needs.safety += (target - n.needs.safety) * 0.5;
  }
}

function trackEpisode(w) {
  const st = w.stats;
  const forecast = forecastStage(w);
  if (!st.episode && forecast >= 1.0) {
    st.episode = { startT: w.t, peakStage: 0, exposedNpcHours: 0 };
  }
  const ep = st.episode;
  if (!ep) return;
  ep.peakStage = Math.max(ep.peakStage, w.env.stage);
  ep.exposedNpcHours += 0.25 * Object.values(w.npcs).filter(n => n.needs.safety < 0.55).length;
  const over = !isRaining(w) && w.env.stage < 0.1 && !w.institutions.civil.evacuation;
  if (over) {
    st.episodesDone += 1;
    st.lastEpisode = { ...ep, endT: w.t };
    log(w, `The flood is over. Peak river level ${ep.peakStage.toFixed(1)} m; ${Math.round(ep.exposedNpcHours)} person-hours spent exposed.`, 'good');
    st.episode = null;
  }
}
