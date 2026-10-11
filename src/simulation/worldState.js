/**
 * AGEROUS — World State
 *
 * The single source of truth for everything in the simulation.
 * The renderer reads from this; it never writes to it.
 */

export const WEATHER = {
  CLEAR:      'clear',
  CLOUDY:     'cloudy',
  RAIN:       'rain',
  HEAVY_RAIN: 'heavy_rain',
  FLOOD:      'flood',
};

export const NPC_ACTIVITY = {
  IDLE:         'idle',
  WORKING:      'working',
  STUDYING:     'studying',
  SHOPPING:     'shopping',
  PRAYING:      'praying',
  VOTING:       'voting',
  EVACUATING:   'evacuating',
  SHELTERING:   'sheltering',
  SLEEPING:     'sleeping',
  TRAVELING:    'traveling',
  CAMPAIGNING:  'campaigning',
  STAYING_HOME: 'staying_home',
};

export const LOCATION_IDS = {
  SCHOOL:          'school',
  MARKET:          'market',
  CHURCH:          'church',
  POLLING_STATION: 'polling_station',
  TOWN_SQUARE:     'town_square',
  RIVER:           'river',
  HOUSE_1:         'house_1',
  HOUSE_2:         'house_2',
  HOUSE_3:         'house_3',
  HOUSE_4:         'house_4',
  HOUSE_5:         'house_5',
};

export const EVENT_TYPES = {
  FLOOD:               'flood',
  SCHOOL_CLOSURE:      'school_closure',
  SCHOOL_EXAM:         'school_exam',
  MARKET_SHIPMENT:     'market_shipment',
  MARKET_DISRUPTION:   'market_disruption',
  CHURCH_SERVICE:      'church_service',
  ELECTION_ANNOUNCED:  'election_announced',
  ELECTION_DAY:        'election_day',
  SHELTER_OPENED:      'shelter_opened',
  WEATHER_CHANGE:      'weather_change',
  RECOVERY:            'recovery',
  RAIN:                'rain',
};

/**
 * Create the initial world state.
 */
export function createWorldState() {
  return {
    // Time
    day:       1,
    hour:      8,
    minute:    0,
    // 12 sim-minutes per real-second → one full day = 120 real-seconds ≈ 2 minutes.
    // Slow enough to watch a scenario unfold, fast enough to see multiple days in a demo.
    timeSpeed: 12,

    // Environment
    weather:     WEATHER.CLEAR,
    waterLevel:  0,       // 0–100; visually appears at > 20
    temperature: 22,      // Celsius (cosmetic for now)

    // Locations: each location has accessibility and status
    locations: {
      [LOCATION_IDS.SCHOOL]: {
        id:         LOCATION_IDS.SCHOOL,
        name:       'School',
        open:       true,
        accessible: true,
        flooded:    false,
        isShelter:  false,
        capacity:   50,
        occupants:  [],
      },
      [LOCATION_IDS.MARKET]: {
        id:            LOCATION_IDS.MARKET,
        name:          'Market',
        open:          true,
        accessible:    true,
        flooded:       false,
        isShelter:     false,
        activityLevel: 1.0,  // 0–2; used by renderer to tint and by NPCs
        priceIndex:    1.0,
        occupants:     [],
      },
      [LOCATION_IDS.CHURCH]: {
        id:           LOCATION_IDS.CHURCH,
        name:         'Church',
        // Church is always structurally "open" (accessible building).
        // serviceActive and isShelter are the meaningful states.
        open:         true,
        accessible:   true,
        flooded:      false,
        isShelter:    false,
        serviceActive: false,
        occupants:    [],
      },
      [LOCATION_IDS.POLLING_STATION]: {
        id:         LOCATION_IDS.POLLING_STATION,
        name:       'Polling Station',
        open:       false,   // opens only on election day
        accessible: true,
        flooded:    false,
        isShelter:  false,
        occupants:  [],
      },
      [LOCATION_IDS.TOWN_SQUARE]: {
        id:         LOCATION_IDS.TOWN_SQUARE,
        name:       'Town Square',
        open:       true,
        accessible: true,
        flooded:    false,
        isShelter:  false,
        occupants:  [],
      },
      [LOCATION_IDS.RIVER]: {
        id:         LOCATION_IDS.RIVER,
        name:       'River',
        open:       true,
        accessible: true,
        flooded:    false,
        isShelter:  false,
        occupants:  [],
      },
      [LOCATION_IDS.HOUSE_1]: { id: LOCATION_IDS.HOUSE_1, name: 'House 1', open: true, accessible: true, flooded: false, isShelter: false, occupants: [] },
      [LOCATION_IDS.HOUSE_2]: { id: LOCATION_IDS.HOUSE_2, name: 'House 2', open: true, accessible: true, flooded: false, isShelter: false, occupants: [] },
      [LOCATION_IDS.HOUSE_3]: { id: LOCATION_IDS.HOUSE_3, name: 'House 3', open: true, accessible: true, flooded: false, isShelter: false, occupants: [] },
      [LOCATION_IDS.HOUSE_4]: { id: LOCATION_IDS.HOUSE_4, name: 'House 4', open: true, accessible: true, flooded: false, isShelter: false, occupants: [] },
      [LOCATION_IDS.HOUSE_5]: { id: LOCATION_IDS.HOUSE_5, name: 'House 5', open: true, accessible: true, flooded: false, isShelter: false, occupants: [] },
    },

    // Roads: which routes are passable
    roads: {
      market_road:   { id: 'market_road',   name: 'Market Road',   accessible: true, flooded: false },
      school_road:   { id: 'school_road',   name: 'School Road',   accessible: true, flooded: false },
      church_road:   { id: 'church_road',   name: 'Church Road',   accessible: true, flooded: false },
      riverside_road:{ id: 'riverside_road',name: 'Riverside Road',accessible: true, flooded: false },
    },

    // NPCs — populated by npcSystem
    npcs: {},

    // Institutions
    institutions: {
      school: {
        isOpen:       true,
        schedule:     'normal',  // normal | closed | exams
        studentCount: 0,
        teacherCount: 0,
      },
      market: {
        isOpen:       true,
        vendorCount:  0,
        customerFlow: 1.0,
        disrupted:    false,
        shipmentBonus: 0,
      },
      church: {
        isOpen:            false,
        serviceScheduled:  false,
        serviceActive:     false,
        isShelter:         false,
        congregationCount: 0,
        // Track when a service started (sim-hour) so we can end it correctly
        serviceStartHour:  null,
      },
      election: {
        announced:      false,
        electionDay:    null,      // sim day number
        candidates: [
          { id: 'candidate_a', name: 'Maria Santos',  votes: 0, support: 0.52 },
          { id: 'candidate_b', name: 'Carlos Rivera', votes: 0, support: 0.48 },
        ],
        campaignActive: false,
        votingOpen:     false,
        completed:      false,
        winner:         null,
        totalVotes:     0,
      },
    },

    // Active events (ongoing)
    activeEvents: [],

    // Persistent world history (in-memory; cleared on reload)
    history: [],

    // Flood state
    flood: {
      active:    false,
      severity:  0,        // 0–3
      dayStarted: null,
      duration:  0,
      recovering: false,
    },

    // Flags — quick lookups for NPC rules
    flags: {
      schoolClosed:      false,
      schoolExam:        false,
      marketFlooded:     false,
      churchShelter:     false,
      churchService:     false,
      electionAnnounced: false,
      electionDay:       false,
    },
  };
}

/**
 * Add an entry to world history.
 */
export function addHistory(state, text, importance = 'normal') {
  state.history.push({
    day:        state.day,
    hour:       state.hour,
    text,
    importance,
  });
}

/**
 * Add or replace an active event (by type).
 */
export function activateEvent(state, event) {
  state.activeEvents = state.activeEvents.filter(e => e.type !== event.type);
  state.activeEvents.push(event);
}

/**
 * Remove an active event by type.
 */
export function deactivateEvent(state, type) {
  state.activeEvents = state.activeEvents.filter(e => e.type !== type);
}

/**
 * Deep-clone a world state for reset purposes.
 * We keep it simple: just recreate from scratch.
 * Returns a fresh world state (caller must re-populate NPCs).
 */
export function resetWorldState(existingState) {
  const fresh = createWorldState();
  // Preserve time speed preference if user changed it
  fresh.timeSpeed = existingState.timeSpeed;
  return fresh;
}
