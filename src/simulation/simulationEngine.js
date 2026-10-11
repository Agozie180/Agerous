/**
 * AGEROUS — Simulation Engine
 *
 * Receives structured events and applies them to world state.
 * All consequence logic lives here — NOT in the renderer, NOT in the AI interpreter.
 *
 * Bugs fixed vs. original:
 *   - tickTime: _onNewDay is now called BEFORE _onNewHour (was inverted)
 *   - Church service: ends after a fixed duration from start, not at hardcoded noon
 *   - Individual NPC voting: castVoteIfEligible called each tick on election day
 *   - concludeElection: uses actual tallied votes (no re-roll)
 *   - flags.churchService added so NPC rules don't need to read institution internals
 *   - flags.schoolExam added
 *   - market activityLevel and customerFlow both updated correctly
 */

import {
  EVENT_TYPES, WEATHER, LOCATION_IDS,
  addHistory, activateEvent, deactivateEvent,
} from './worldState.js';
import { tickAllNPCs, castVoteIfEligible } from './npcSystem.js';

// ─── Event Executor ───────────────────────────────────────────────

/**
 * Apply a structured event to the world state.
 * @param {object} state
 * @param {object} event  — { event_type, severity, duration, ... }
 */
export function executeEvent(state, event) {
  const type = event.event_type;

  switch (type) {
    case EVENT_TYPES.FLOOD:              return _executeFlood(state, event);
    case EVENT_TYPES.RAIN:               return _executeRain(state, event);
    case EVENT_TYPES.SCHOOL_CLOSURE:     return _executeSchoolClosure(state, event);
    case EVENT_TYPES.SCHOOL_EXAM:        return _executeSchoolExam(state, event);
    case EVENT_TYPES.MARKET_SHIPMENT:    return _executeMarketShipment(state, event);
    case EVENT_TYPES.MARKET_DISRUPTION:  return _executeMarketDisruption(state, event);
    case EVENT_TYPES.CHURCH_SERVICE:     return _executeChurchService(state, event);
    case EVENT_TYPES.ELECTION_ANNOUNCED: return _executeElectionAnnounced(state, event);
    case EVENT_TYPES.ELECTION_DAY:       return _executeElectionDay(state, event);
    case EVENT_TYPES.WEATHER_CHANGE:     return _executeWeatherChange(state, event);
    case EVENT_TYPES.RECOVERY:           return _executeRecovery(state, event);
    default:
      addHistory(state, `Unsupported event type: ${type}`, 'normal');
  }
}

// ─── Flood ───────────────────────────────────────────────────────

function _executeFlood(state, event) {
  const severity = event.severity === 'high' ? 3 : event.severity === 'medium' ? 2 : 1;
  const duration = event.duration || 2;

  state.weather = WEATHER.RAIN;
  addHistory(state, 'Heavy rainfall has begun.', 'warning');

  state.flood = {
    active:     true,
    severity,
    dayStarted: state.day,
    duration,
    recovering: false,
  };

  activateEvent(state, {
    type:                EVENT_TYPES.FLOOD,
    label:               'Flood Warning',
    severity,
    startDay:            state.day,
    endDay:              state.day + duration,
    phase:               'rising',   // rising → peak → receding → done
    phaseTicksRemaining: 8,
  });

  // Immediately flood the closest road to the river
  state.roads.riverside_road.accessible = false;
  state.roads.riverside_road.flooded    = true;

  addHistory(state, 'Riverside Road is now inaccessible.', 'warning');
  tickAllNPCs(state);
}

/**
 * Progress the flood through its phases.
 * Called once per sim-hour when a flood is active.
 */
export function progressFlood(state) {
  const ev = state.activeEvents.find(e => e.type === EVENT_TYPES.FLOOD);
  if (!ev) return;

  ev.phaseTicksRemaining -= 1;

  if (ev.phase === 'rising') {
    state.waterLevel = Math.min(100, state.waterLevel + 12);
    state.weather    = WEATHER.HEAVY_RAIN;

    if (state.waterLevel >= 40) {
      // Market road floods → market inaccessible
      if (state.roads.market_road.accessible) {
        state.roads.market_road.accessible              = false;
        state.roads.market_road.flooded                 = true;
        state.locations[LOCATION_IDS.MARKET].accessible = false;
        state.locations[LOCATION_IDS.MARKET].flooded    = true;
        state.locations[LOCATION_IDS.MARKET].activityLevel = 0;
        state.institutions.market.disrupted             = true;
        state.institutions.market.customerFlow          = 0.0;
        state.flags.marketFlooded                       = true;
        addHistory(state, 'Market Road flooded. Market is inaccessible.', 'warning');
      }
    }

    if (state.waterLevel >= 55) {
      // School closes due to flooding
      if (!state.flags.schoolClosed) {
        state.flags.schoolClosed                       = true;
        state.locations[LOCATION_IDS.SCHOOL].open      = false;
        state.institutions.school.isOpen               = false;
        state.institutions.school.schedule             = 'closed';
        addHistory(state, 'School has been closed due to flooding.', 'warning');
      }

      // Church opens as emergency shelter
      if (!state.flags.churchShelter) {
        state.flags.churchShelter                         = true;
        state.locations[LOCATION_IDS.CHURCH].isShelter    = true;
        state.locations[LOCATION_IDS.CHURCH].open         = true;
        state.institutions.church.isShelter               = true;
        state.institutions.church.isOpen                  = true;
        addHistory(state, 'Church has opened as an emergency shelter.', 'important');
      }
    }

    if (state.waterLevel >= 70) {
      // Some houses flood
      state.locations[LOCATION_IDS.HOUSE_1].flooded = true;
      state.locations[LOCATION_IDS.HOUSE_2].flooded = true;
      state.weather = WEATHER.FLOOD;
      addHistory(state, 'Several homes are now flooded. Residents evacuating.', 'warning');

      ev.phase               = 'peak';
      ev.phaseTicksRemaining = 6;
    }

    tickAllNPCs(state);

  } else if (ev.phase === 'peak') {
    if (ev.phaseTicksRemaining <= 0) {
      ev.phase               = 'receding';
      ev.phaseTicksRemaining = 10;
      state.weather = WEATHER.RAIN;
      addHistory(state, 'Flood waters are beginning to recede.', 'good');
    }

  } else if (ev.phase === 'receding') {
    state.waterLevel = Math.max(0, state.waterLevel - 8);

    if (state.waterLevel < 20) {
      _executeRecovery(state, { event_type: EVENT_TYPES.RECOVERY });
      deactivateEvent(state, EVENT_TYPES.FLOOD);
      state.flood.active     = false;
      state.flood.recovering = false;
    }
  }
}

// ─── Rain ────────────────────────────────────────────────────────

function _executeRain(state, event) {
  const heavy = event.severity === 'high';
  state.weather = heavy ? WEATHER.HEAVY_RAIN : WEATHER.RAIN;
  addHistory(state, heavy ? 'Heavy rain has started.' : 'Rain has started.', 'normal');
  activateEvent(state, {
    type:     EVENT_TYPES.RAIN,
    label:    heavy ? 'Heavy Rain' : 'Rain',
    startDay: state.day,
    endDay:   state.day + (event.duration || 1),
  });
  tickAllNPCs(state);
}

// ─── Recovery ────────────────────────────────────────────────────

function _executeRecovery(state, _event) {
  // Restore roads
  for (const road of Object.values(state.roads)) {
    road.accessible = true;
    road.flooded    = false;
  }
  // Restore locations
  for (const loc of Object.values(state.locations)) {
    loc.accessible = true;
    loc.flooded    = false;
    loc.open       = true;
    // Church shelter only clears if there's no ongoing service
    if (loc.id === LOCATION_IDS.CHURCH) {
      loc.isShelter = false;
      // Keep church structurally open but deactivate shelter role
    } else {
      loc.isShelter = false;
    }
  }

  // Restore institution state
  state.flags.schoolClosed              = false;
  state.flags.marketFlooded             = false;
  state.flags.churchShelter             = false;
  state.locations[LOCATION_IDS.SCHOOL].open  = true;
  state.locations[LOCATION_IDS.MARKET].open  = true;
  state.locations[LOCATION_IDS.MARKET].activityLevel = 1.0;
  state.institutions.school.isOpen      = true;
  state.institutions.school.schedule    = 'normal';
  state.institutions.market.disrupted   = false;
  state.institutions.market.customerFlow = 1.0;
  state.institutions.church.isShelter   = false;
  state.institutions.church.isOpen      = false;
  state.weather    = WEATHER.CLOUDY;
  state.waterLevel = 0;

  addHistory(state, 'Flood has receded. Community beginning recovery.', 'good');
  addHistory(state, 'School has reopened.', 'good');
  addHistory(state, 'Market is partially operational.', 'good');
  tickAllNPCs(state);
}

// ─── School ──────────────────────────────────────────────────────

function _executeSchoolClosure(state, event) {
  state.flags.schoolClosed                      = true;
  state.locations[LOCATION_IDS.SCHOOL].open     = false;
  state.institutions.school.isOpen              = false;
  state.institutions.school.schedule            = 'closed';
  const duration = event.duration || 1;
  activateEvent(state, {
    type:     EVENT_TYPES.SCHOOL_CLOSURE,
    label:    'School Closed',
    startDay: state.day,
    endDay:   state.day + duration,
  });
  addHistory(state, `School has been closed${event.reason ? ' (' + event.reason + ')' : ''}.`, 'important');
  tickAllNPCs(state);
}

function _executeSchoolExam(state, _event) {
  state.flags.schoolExam               = true;
  state.institutions.school.schedule   = 'exams';
  activateEvent(state, {
    type:     EVENT_TYPES.SCHOOL_EXAM,
    label:    'School Exams',
    startDay: state.day,
    endDay:   state.day + 1,
  });
  addHistory(state, 'Examinations are underway at the school.', 'important');
  tickAllNPCs(state);
}

// ─── Market ──────────────────────────────────────────────────────

function _executeMarketShipment(state, _event) {
  const bonus = 0.5;
  state.institutions.market.shipmentBonus = 1;
  state.institutions.market.customerFlow  = Math.min(1.8, state.institutions.market.customerFlow + bonus);
  state.locations[LOCATION_IDS.MARKET].activityLevel = Math.min(
    1.8,
    (state.locations[LOCATION_IDS.MARKET].activityLevel || 1.0) + bonus
  );
  state.locations[LOCATION_IDS.MARKET].priceIndex = Math.max(
    0.6,
    (state.locations[LOCATION_IDS.MARKET].priceIndex || 1.0) - 0.2
  );
  activateEvent(state, {
    type:     EVENT_TYPES.MARKET_SHIPMENT,
    label:    'Market Shipment',
    startDay: state.day,
    endDay:   state.day + 1,
  });
  addHistory(state, 'Large food shipment arrived. Prices are lower, more customers.', 'good');
  tickAllNPCs(state);
}

function _executeMarketDisruption(state, event) {
  state.institutions.market.disrupted    = true;
  state.institutions.market.customerFlow = 0.2;
  state.locations[LOCATION_IDS.MARKET].activityLevel = 0.2;
  if (event.road_blocked) {
    state.roads.market_road.accessible              = false;
    state.roads.market_road.flooded                 = true;
    state.locations[LOCATION_IDS.MARKET].accessible = false;
    state.flags.marketFlooded                       = true;
    addHistory(state, 'Road to the market is damaged. Market barely accessible.', 'warning');
  } else {
    addHistory(state, 'Market has been disrupted. Activity greatly reduced.', 'warning');
  }
  activateEvent(state, {
    type:     EVENT_TYPES.MARKET_DISRUPTION,
    label:    'Market Disrupted',
    startDay: state.day,
    endDay:   state.day + (event.duration || 1),
  });
  tickAllNPCs(state);
}

// ─── Church ──────────────────────────────────────────────────────

function _executeChurchService(state, _event) {
  state.institutions.church.isOpen          = true;
  state.institutions.church.serviceActive   = true;
  state.institutions.church.serviceStartHour = state.hour;
  state.locations[LOCATION_IDS.CHURCH].open = true;
  state.locations[LOCATION_IDS.CHURCH].serviceActive = true;
  state.flags.churchService                 = true;

  activateEvent(state, {
    type:     EVENT_TYPES.CHURCH_SERVICE,
    label:    'Church Service',
    startDay: state.day,
    endDay:   state.day + 0.5,
    startHour: state.hour,
  });
  addHistory(state, 'Church service is underway.', 'normal');
  tickAllNPCs(state);
}

// ─── Election ────────────────────────────────────────────────────

function _executeElectionAnnounced(state, event) {
  state.flags.electionAnnounced                   = true;
  state.institutions.election.announced           = true;
  state.institutions.election.campaignActive      = true;
  const electionInDays = event.days_until || 2;
  state.institutions.election.electionDay         = state.day + electionInDays;

  // Reset votes from any prior election
  state.institutions.election.candidates.forEach(c => { c.votes = 0; });
  state.institutions.election.totalVotes = 0;
  state.institutions.election.winner     = null;
  state.institutions.election.completed  = false;

  // Assign campaigners (first 4 eligible voters)
  const voters = Object.values(state.npcs).filter(n => n.voter);
  voters.forEach(n => { n.campaigning = false; });
  voters.slice(0, 4).forEach(n => { n.campaigning = true; });

  state.locations[LOCATION_IDS.POLLING_STATION].open = false;

  activateEvent(state, {
    type:     EVENT_TYPES.ELECTION_ANNOUNCED,
    label:    'Election Campaign',
    startDay: state.day,
    endDay:   state.day + electionInDays,
  });

  addHistory(state, `Local election announced! Voting in ${electionInDays} day(s).`, 'important');
  addHistory(state, `Candidates: ${state.institutions.election.candidates.map(c => c.name).join(' vs ')}`, 'normal');
  tickAllNPCs(state);
}

function _executeElectionDay(state, _event) {
  state.flags.electionDay                              = true;
  state.institutions.election.campaignActive           = false;
  state.institutions.election.votingOpen               = true;
  state.locations[LOCATION_IDS.POLLING_STATION].open       = true;
  state.locations[LOCATION_IDS.POLLING_STATION].accessible = true;

  // Clear campaign flags; reset voted flags so everyone votes fresh today
  Object.values(state.npcs).forEach(n => {
    n.campaigning = false;
    n.voted       = false;
  });

  activateEvent(state, {
    type:     EVENT_TYPES.ELECTION_DAY,
    label:    'Election Day!',
    startDay: state.day,
    endDay:   state.day + 1,
  });

  addHistory(state, 'Election Day has arrived! Polling station is open.', 'important');
  tickAllNPCs(state);
}

/**
 * Tally votes and conclude election.
 * Uses actual per-NPC castVoteIfEligible tallies, NOT a re-roll.
 * Called after election day closes (hour >= 18).
 */
export function concludeElection(state) {
  if (state.institutions.election.completed) return;

  const election = state.institutions.election;

  // Force any NPCs still at the polling station to cast their vote
  for (const npc of Object.values(state.npcs)) {
    castVoteIfEligible(npc, state);
  }

  const votesA = election.candidates[0].votes;
  const votesB = election.candidates[1].votes;
  const total  = votesA + votesB;

  election.totalVotes = total;
  const winner = votesA >= votesB ? election.candidates[0] : election.candidates[1];
  election.winner     = winner;
  election.completed  = true;
  election.votingOpen = false;
  state.flags.electionDay         = false;
  state.flags.electionAnnounced   = false;
  state.institutions.election.campaignActive = false;
  state.locations[LOCATION_IDS.POLLING_STATION].open = false;

  deactivateEvent(state, EVENT_TYPES.ELECTION_DAY);
  deactivateEvent(state, EVENT_TYPES.ELECTION_ANNOUNCED);

  addHistory(
    state,
    `Election results: ${election.candidates[0].name} ${votesA} — ${election.candidates[1].name} ${votesB}`,
    'important'
  );
  addHistory(state, `🏆 ${winner.name} wins the local election! (${total} votes cast)`, 'important');

  Object.values(state.npcs).forEach(n => { n.voted = false; });
  tickAllNPCs(state);
}

// ─── Weather Change ───────────────────────────────────────────────

function _executeWeatherChange(state, event) {
  const weatherMap = {
    clear:  WEATHER.CLEAR,
    sunny:  WEATHER.CLEAR,
    cloudy: WEATHER.CLOUDY,
    rain:   WEATHER.RAIN,
    storm:  WEATHER.HEAVY_RAIN,
  };
  const newWeather = weatherMap[event.weather] || WEATHER.CLEAR;
  state.weather = newWeather;
  addHistory(state, `Weather changed to ${event.weather}.`, 'normal');
  tickAllNPCs(state);
}

// ─── Time Tick ────────────────────────────────────────────────────

/**
 * Advance simulation time.
 * Called by the main loop every real-time frame.
 *
 * BUG FIX: _onNewDay must fire BEFORE _onNewHour on a day rollover,
 * because _onNewHour uses the updated day number for election checks.
 *
 * @param {object} state
 * @param {number} deltaMs — real milliseconds elapsed
 */
export function tickTime(state, deltaMs) {
  const simMinutesPerMs = state.timeSpeed / 60000;
  const simMinutes      = deltaMs * simMinutesPerMs;

  state.minute += simMinutes;

  if (state.minute >= 60) {
    const hoursAdvanced = Math.floor(state.minute / 60);
    state.minute = state.minute % 60;
    state.hour  += hoursAdvanced;

    if (state.hour >= 24) {
      const daysAdvanced = Math.floor(state.hour / 24);
      state.hour  = state.hour % 24;
      state.day  += daysAdvanced;

      // Day-level expiry runs first (uses new state.day)
      _onNewDay(state);
    }

    // Hourly logic runs after day rollover
    _onNewHour(state);
  }
}

function _onNewHour(state) {
  // ── Flood progression ────────────────────────────────────────────
  if (state.flood.active) {
    progressFlood(state);
  }

  // ── NPC voting: cast votes for NPCs at the polls ─────────────────
  if (state.flags.electionDay) {
    for (const npc of Object.values(state.npcs)) {
      castVoteIfEligible(npc, state);
    }
  }

  // ── Election: auto-trigger election day ──────────────────────────
  const election = state.institutions.election;
  if (election.announced && !election.completed && !state.flags.electionDay) {
    if (election.electionDay !== null && state.day >= election.electionDay && state.hour >= 7) {
      _executeElectionDay(state, {});
    }
  }

  // ── Election: auto-conclude at close of polls ────────────────────
  if (state.flags.electionDay && state.hour >= 18) {
    concludeElection(state);
  }

  // ── Church service: end after 2 hours from start ─────────────────
  const churchEv = state.activeEvents.find(e => e.type === EVENT_TYPES.CHURCH_SERVICE);
  if (churchEv && state.institutions.church.serviceActive) {
    const startHour  = churchEv.startHour ?? 8;
    const hoursElapsed = (state.hour - startHour + 24) % 24;
    if (hoursElapsed >= 2) {
      state.institutions.church.serviceActive    = false;
      state.institutions.church.isOpen           = false;
      state.institutions.church.serviceStartHour = null;
      state.locations[LOCATION_IDS.CHURCH].serviceActive = false;
      state.flags.churchService                  = false;
      // Only close location if not serving as shelter
      if (!state.institutions.church.isShelter) {
        state.locations[LOCATION_IDS.CHURCH].open = true; // structurally open
      }
      deactivateEvent(state, EVENT_TYPES.CHURCH_SERVICE);
      addHistory(state, 'Church service has ended.', 'normal');
      tickAllNPCs(state);
    }
  }

  // ── NPC tick every 2 sim-hours ───────────────────────────────────
  if (state.hour % 2 === 0) {
    tickAllNPCs(state);
  }
}

function _onNewDay(state) {
  addHistory(state, `--- Day ${state.day} ---`, 'normal');

  // ── Rain expires ─────────────────────────────────────────────────
  const rainEv = state.activeEvents.find(e => e.type === EVENT_TYPES.RAIN);
  if (rainEv && state.day > rainEv.endDay) {
    deactivateEvent(state, EVENT_TYPES.RAIN);
    if (state.weather === WEATHER.RAIN || state.weather === WEATHER.HEAVY_RAIN) {
      state.weather = WEATHER.CLEAR;
      addHistory(state, 'The rain has stopped.', 'good');
    }
  }

  // ── School closure expires ────────────────────────────────────────
  const schoolEv = state.activeEvents.find(e => e.type === EVENT_TYPES.SCHOOL_CLOSURE);
  if (schoolEv && state.day > schoolEv.endDay && !state.flood.active) {
    state.flags.schoolClosed                      = false;
    state.flags.schoolExam                        = false;
    state.locations[LOCATION_IDS.SCHOOL].open     = true;
    state.institutions.school.isOpen              = true;
    state.institutions.school.schedule            = 'normal';
    deactivateEvent(state, EVENT_TYPES.SCHOOL_CLOSURE);
    addHistory(state, 'School has reopened.', 'good');
  }

  // ── School exam expires ───────────────────────────────────────────
  const examEv = state.activeEvents.find(e => e.type === EVENT_TYPES.SCHOOL_EXAM);
  if (examEv && state.day > examEv.endDay) {
    state.flags.schoolExam             = false;
    state.institutions.school.schedule = 'normal';
    deactivateEvent(state, EVENT_TYPES.SCHOOL_EXAM);
    addHistory(state, 'Exams have finished.', 'good');
  }

  // ── Market shipment bonus expires ────────────────────────────────
  const shipEv = state.activeEvents.find(e => e.type === EVENT_TYPES.MARKET_SHIPMENT);
  if (shipEv && state.day > shipEv.endDay) {
    state.institutions.market.shipmentBonus = 0;
    state.institutions.market.customerFlow  = 1.0;
    state.locations[LOCATION_IDS.MARKET].activityLevel = 1.0;
    state.locations[LOCATION_IDS.MARKET].priceIndex    = 1.0;
    deactivateEvent(state, EVENT_TYPES.MARKET_SHIPMENT);
  }

  // ── Market disruption expires ────────────────────────────────────
  const disruptEv = state.activeEvents.find(e => e.type === EVENT_TYPES.MARKET_DISRUPTION);
  if (disruptEv && state.day > disruptEv.endDay && !state.flood.active) {
    state.institutions.market.disrupted    = false;
    state.institutions.market.customerFlow = 1.0;
    state.locations[LOCATION_IDS.MARKET].accessible    = true;
    state.locations[LOCATION_IDS.MARKET].activityLevel = 1.0;
    state.roads.market_road.accessible                 = true;
    state.roads.market_road.flooded                    = false;
    state.flags.marketFlooded                          = false;
    deactivateEvent(state, EVENT_TYPES.MARKET_DISRUPTION);
    addHistory(state, 'Market has recovered from disruption.', 'good');
  }

  tickAllNPCs(state);
}
