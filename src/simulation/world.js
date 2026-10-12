/**
 * AGEROUS — World state
 *
 * THE source of truth.  A plain JSON-serialisable object: nothing in here is a
 * Three.js object, DOM node or function, so it can be saved, loaded, diffed and
 * unit-tested without a browser.  The renderer reads it; only the engine writes it.
 */

import { LOCATION_SPECS, slotPosition } from './geography.js';
import { rand as rngNext, hash01 } from './rng.js';

export const SAVE_VERSION = 2;
export const START_T = 6 * 60 + 30;          // Day 1, 06:30 (a Monday) — startWorld() pre-rolls to 08:00

export const day  = w => Math.floor(w.t / 1440) + 1;
export const hour = w => Math.floor((w.t % 1440) / 60);
export const hourF = w => (w.t % 1440) / 60;  // fractional hour of day
export const minute = w => Math.floor(w.t % 60);
export const dayStartT = d => (d - 1) * 1440;

export function log(world, text, kind = 'info') {
  world.history.push({ t: world.t, day: day(world), hour: hour(world), minute: minute(world), text, kind });
}

// ─── The people ─────────────────────────────────────────────────────────

const OCC = { STUDENT: 'student', TEACHER: 'teacher', VENDOR: 'vendor', FARMER: 'farmer',
  PRIEST: 'priest', ELDER: 'elder', PARENT: 'parent', WORKER: 'worker' };

const ROUTINES = {
  student: 'School Mon–Fri 07:00–15:00 · home otherwise',
  teacher: 'School Mon–Fri 07:00–15:00 · home otherwise',
  vendor:  'Market stall Mon–Sat 07:30–17:00',
  farmer:  'Fields Mon–Sat 06:30–17:00',
  priest:  'Lives at the church · leads Sunday service',
  elder:   'Mostly home · short visits to the square · church on Sundays',
  parent:  'Shops at the market · evenings at the square',
  worker:  'Public works at the square Mon–Fri 07:00–17:00',
};

// [name, age, occupation, home, voter, churchGoer, campaignsFor]
const ROSTER = [
  ['Elena Reyes',    38, OCC.TEACHER, 'house_1', true,  true,  null],
  ['James Okafor',   44, OCC.TEACHER, 'house_2', true,  false, null],
  ['Lucia Reyes',    12, OCC.STUDENT, 'house_1', false, true,  null],
  ['Marco Diaz',     13, OCC.STUDENT, 'house_2', false, false, null],
  ['Aisha Kamara',   11, OCC.STUDENT, 'house_3', false, true,  null],
  ['Sam Torres',     14, OCC.STUDENT, 'house_4', false, false, null],
  ['Priya Nair',     12, OCC.STUDENT, 'house_5', false, true,  null],
  ['Eli Mensah',     13, OCC.STUDENT, 'house_3', false, false, null],
  ['Rosa Valdez',    45, OCC.VENDOR,  'house_2', true,  true,  null],
  ['David Kim',      50, OCC.VENDOR,  'house_4', true,  false, null],
  ['Fatima Al-Amin', 35, OCC.VENDOR,  'house_5', true,  false, null],
  ['Thomas Eze',     55, OCC.FARMER,  'house_3', true,  true,  null],
  ['Clara Nkosi',    48, OCC.FARMER,  'house_1', true,  true,  null],
  ['Father Gomez',   62, OCC.PRIEST,  'church',  true,  true,  null],
  ['Grandma Yuki',   78, OCC.ELDER,   'house_1', true,  true,  null],
  ['Old Man Bayo',   73, OCC.ELDER,   'house_2', true,  true,  null],
  ['Sofia Cruz',     33, OCC.PARENT,  'house_4', true,  true,  'a'],
  ['Ahmed Hassan',   40, OCC.WORKER,  'house_5', true,  false, null],
  ['Grace Obi',      29, OCC.WORKER,  'house_3', true,  true,  null],
  ['Luis Morales',   36, OCC.WORKER,  'house_2', true,  false, 'b'],
  ['Mei Lin',        31, OCC.PARENT,  'house_5', true,  true,  null],
  ['Omar Siddiqui',  42, OCC.WORKER,  'house_1', true,  false, null],
  ['Nina Petrov',    27, OCC.WORKER,  'house_4', true,  false, null],
  ['Ben Adeyemi',    60, OCC.ELDER,   'house_3', true,  true,  null],
  ['Lena Müller',    32, OCC.PARENT,  'house_2', true,  true,  null],
];

function makeNPCs(world, rand) {
  const npcs = {};
  ROSTER.forEach(([name, age, occupation, home, voter, churchGoer, campaignsFor], i) => {
    const id = `npc_${String(i + 1).padStart(2, '0')}`;
    const p = slotPosition(home, i + 1);
    npcs[id] = {
      id, name, age, occupation, home, voter, churchGoer, campaignsFor,
      routine: ROUTINES[occupation],
      x: p.x, z: p.z, heading: 0,
      location: home,            // place they are AT (null while walking)
      dest: home,                // place they are heading for
      path: [],                  // remaining waypoints [[x,z],...]
      activity: 'idle',
      reason: 'Just waking up.',
      money: 80 + Math.floor(rand() * 220),
      needs: { food: 0.6 + rand() * 0.4, safety: 1, social: 0.5 + rand() * 0.4 },
      // election-related
      leaning: (hash01(id) - 0.5) * 1.2,   // <0 leans candidate A, >0 candidate B
      intends: true, voteHour: 8 + Math.floor(rand() * 8), voted: false,
      workedMin: 0, wageToday: 0,
      slot: i + 1,
    };
  });
  return npcs;
}

// ─── Fresh world ────────────────────────────────────────────────────────

export function createWorld(seed = 1337) {
  const world = {
    version: SAVE_VERSION,
    seed, rngState: seed >>> 0,
    t: START_T,
    timeSpeed: 10,            // simulated minutes per real second (0 = paused)

    env: {
      stage: 0,               // metres the river is above its normal line
      peak: 0,                // level the current rain will drive it towards
      rainUntil: null,        // absolute sim-minute the rain stops
      baseWeather: 'clear',   // weather when it is not raining
      blockedRoads: {},       // roadId -> t it is cleared (fallen trees, rubble...)
    },

    locations: {},
    institutions: {
      school:   { open: true, reasons: [], eventClosedUntil: null, exam: false, examUntil: null, noTeacherDay: null, attendance: null },
      market:   { open: true, reasons: [], disruptedUntil: null, stock: 80, price: 1.0,
                  salesToday: 0, revenueToday: 0, customersToday: 0, customersYesterday: 0, supplyBlockedLogged: false, noStaffDay: null, harvested: 0 },
      church:   { service: null, lastAttendance: null, cancelledDay: null },
      civil:    { alert: 0, evacuation: false, shelters: [], assign: {}, forecast: 0 },
      election: { state: 'none', electionDay: null, announcedT: null, postponements: 0,
                  candidates: [
                    { id: 'a', name: 'Maria Santos',  platform: 'Flood defences & school funding', votes: 0 },
                    { id: 'b', name: 'Carlos Rivera', platform: 'Market growth & lower prices',    votes: 0 },
                  ],
                  eligible: 0, voted: 0 },
    },
    elections: [],            // archive of concluded elections
    npcs: {},
    households: {},          // home id -> { pantry } — meals in the cupboard
    scheduled: [],            // [{ t, event }]
    history: [],
    prompts: [],              // what the player asked & how it was interpreted
    stats: { episode: null, episodesDone: 0, bestEpisode: null },
    achievements: {},
  };

  for (const [id, spec] of Object.entries(LOCATION_SPECS)) {
    if (spec.kind === 'river') continue;
    world.locations[id] = {
      id, name: spec.name, kind: spec.kind,
      flooded: false,         // unusable: water has reached it (stays true during clean-up)
      cleanupUntil: null,
      isShelter: false,
    };
  }

  const rand = () => rngNext(world);
  world.npcs = makeNPCs(world, rand);
  for (const id of new Set(Object.values(world.npcs).map(n => n.home))) world.households[id] = { pantry: 12 + Math.floor(rand() * 13) };

  log(world, 'Day 1 · Monday. The community of Agerous wakes up.', 'info');
  return world;
}
