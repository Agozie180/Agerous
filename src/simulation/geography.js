/**
 * AGEROUS — Geography
 *
 * One pure, dependency-free description of the physical world, shared by the
 * simulation (what floods, who can reach what) and the renderer (what the
 * ground looks like).  Because both read THE SAME height function, the 3D
 * terrain and the simulation can never disagree about which buildings sit in
 * the flood plain.
 *
 * Units: 1 world unit ≈ 1 metre.  Heights are metres above the river bed's
 * normal water line (y = 0).
 */

export const LOCATION_IDS = {
  SCHOOL:          'school',
  MARKET:          'market',
  CHURCH:          'church',
  POLLING_STATION: 'polling_station',
  TOWN_SQUARE:     'town_square',
  FIELDS:          'fields',
  RIVER:           'river',
  HOUSE_1:         'house_1',
  HOUSE_2:         'house_2',
  HOUSE_3:         'house_3',
  HOUSE_4:         'house_4',
  HOUSE_5:         'house_5',
};

export const RIVER_X = 26;
export const WORLD_HALF_SIZE = 46;

/**
 * Static facts about each place.  Nothing here changes at runtime.
 *   ring            — radius at which NPCs stand around the place
 *   pad             — radius of the level pad bulldozed under the building
 *   roads           — roads that must be passable for the place to be reachable
 *   shelterCapacity — people it can hold if civil defence designates it a shelter
 *   cleanupHours    — how long it stays unusable after water has left
 */
export const LOCATION_SPECS = {
  school: {
    name: 'School', kind: 'school', x: -18, z: -12, ring: 5.4, pad: 5,
    size: [7, 4, 5], roads: ['school_road'], shelterCapacity: 40, cleanupHours: 24,
  },
  market: {
    name: 'Market', kind: 'market', x: 12, z: -14, ring: 6.2, pad: 5.5,
    size: [8, 3, 7], roads: ['market_road'], shelterCapacity: 0, cleanupHours: 10,
  },
  church: {
    name: 'Church', kind: 'church', x: 0, z: -22, ring: 5.2, pad: 4.5,
    size: [5, 6, 7], roads: ['church_road'], shelterCapacity: 30, cleanupHours: 4,
  },
  polling_station: {
    name: 'Polling Station', kind: 'civic', x: -9, z: 13, ring: 4.2, pad: 4,
    size: [5, 3, 4], roads: ['polling_road'], shelterCapacity: 10, cleanupHours: 6,
  },
  town_square: {
    name: 'Town Square', kind: 'plaza', x: 0, z: 0, ring: 3.4, pad: 4,
    size: null, roads: [], shelterCapacity: 0, cleanupHours: 0,
  },
  fields: {
    name: 'Fields', kind: 'farm', x: 19, z: -5, ring: 5, pad: 4,
    size: null, roads: [], shelterCapacity: 0, cleanupHours: 12,
  },
  river: {
    name: 'River', kind: 'river', x: RIVER_X, z: 0, ring: 3,
    size: null, roads: [], shelterCapacity: 0, cleanupHours: 0,
  },
  house_1: { name: 'House 1', kind: 'house', x: -16, z:  8, ring: 3.0, pad: 3.2, size: [3.5, 2.8, 3.5], roads: [], shelterCapacity: 0, cleanupHours: 6 },
  house_2: { name: 'House 2', kind: 'house', x:  -4, z: 18, ring: 3.0, pad: 3.2, size: [3.5, 2.8, 3.5], roads: [], shelterCapacity: 0, cleanupHours: 6 },
  house_3: { name: 'House 3', kind: 'house', x:   6, z: 12, ring: 3.0, pad: 3.2, size: [3.5, 2.8, 3.5], roads: [], shelterCapacity: 0, cleanupHours: 6 },
  house_4: { name: 'House 4', kind: 'house', x:  14, z:  6, ring: 3.0, pad: 3.2, size: [3.5, 2.8, 3.5], roads: [], shelterCapacity: 0, cleanupHours: 6 },
  house_5: { name: 'House 5', kind: 'house', x:  19, z: 16, ring: 3.0, pad: 3.2, size: [3.5, 2.8, 3.5], roads: [], shelterCapacity: 0, cleanupHours: 6 },
};

/** Roads are polylines.  A road floods when water reaches its LOWEST point. */
export const ROAD_SPECS = {
  // Every branch starts ON a main_road vertex so the road network is one connected graph.
  main_road:      { name: 'Main Road',      width: 3, points: [[-30, 0], [-6, 0], [0, 0], [6, 0], [8, 0], [18, 0]] },
  church_road:    { name: 'Church Road',    width: 3, points: [[0, 0], [0, -22]] },
  market_road:    { name: 'Market Road',    width: 3, points: [[6, 0], [12, -6], [12, -14]] },
  school_road:    { name: 'School Road',    width: 3, points: [[-6, 0], [-18, -6], [-18, -12]] },
  polling_road:   { name: 'Polling Road',   width: 3, points: [[0, 0], [-3, 9], [-9, 13]] },
  riverside_road: { name: 'Riverside Road', width: 3, points: [[8, 0], [14, 6], [19, 16]] },
};

// ─── Terrain ────────────────────────────────────────────────────────────

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Natural ground height before any building pads are levelled. */
export function baseHeight(x, z) {
  // Valley floor at the river, rising to the west; low bank on the far side.
  let h = x <= 24
    ? 3.2 * (1 - Math.exp(-(24 - x) / 18))
    : 0.1 * (x - 24);
  // Gentle rolling hills
  h += 0.22 * Math.sin(x * 0.21 + 1.3) * Math.cos(z * 0.17 - 0.4);
  // The church stands on a hill
  h += 1.4 * Math.exp(-((x * x) + (z + 22) * (z + 22)) / (2 * 7 * 7));
  // River channel
  h -= 0.75 * Math.exp(-((x - RIVER_X) ** 2) / (2 * 2.4 * 2.4));
  return h;
}

// A building's elevation is the natural ground height at its centre.
const ELEVATIONS = {};
for (const [id, s] of Object.entries(LOCATION_SPECS)) {
  ELEVATIONS[id] = baseHeight(s.x, s.z);
}
export function locationElevation(id) { return ELEVATIONS[id]; }

const PADS = Object.entries(LOCATION_SPECS)
  .filter(([, s]) => s.kind !== 'river')
  .map(([id, s]) => ({ x: s.x, z: s.z, r: s.pad, h: ELEVATIONS[id] }));

/** Final ground height (building pads levelled). Used by BOTH sim and renderer. */
export function terrainHeight(x, z) {
  let h = baseHeight(x, z);
  for (const p of PADS) {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d > p.r + 4) continue;
    const w = 1 - smoothstep(p.r, p.r + 4, d);
    h = h * (1 - w) + p.h * w;
  }
  return h;
}

// ─── Roads ──────────────────────────────────────────────────────────────

/** Sample points along a road polyline, ~1.5 units apart. */
export function sampleRoad(points, spacing = 1.5) {
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, z0] = points[i], [x1, z1] = points[i + 1];
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.ceil(len / spacing));
    for (let k = 0; k < n; k++) {
      const u = k / n;
      out.push([x0 + (x1 - x0) * u, z0 + (z1 - z0) * u]);
    }
  }
  const last = points[points.length - 1];
  out.push([last[0], last[1]]);
  return out;
}

const ROAD_ELEVATIONS = {};
for (const [id, r] of Object.entries(ROAD_SPECS)) {
  ROAD_ELEVATIONS[id] = Math.min(...sampleRoad(r.points).map(([x, z]) => terrainHeight(x, z)));
}
export function roadElevation(id) { return ROAD_ELEVATIONS[id]; }

// ─── Where people stand ─────────────────────────────────────────────────

/**
 * A stable standing spot around a location for NPC number `slot`.
 * Golden-angle spacing keeps a crowd (e.g. a full shelter) from stacking.
 */
export function slotPosition(locationId, slot) {
  const s = LOCATION_SPECS[locationId];
  const angle = slot * 2.399963;
  const radius = s.ring + (slot % 4) * 0.8;
  return { x: s.x + Math.cos(angle) * radius, z: s.z + Math.sin(angle) * radius };
}

export function distance(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }


// ─── Calendar ───────────────────────────────────────────────────────────

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
/** Day 1 is a Monday. */
export function weekdayIndex(day) { return (day - 1) % 7; }
export function weekdayName(day) { return WEEKDAYS[weekdayIndex(day)]; }
export function isSchoolDay(day) { return weekdayIndex(day) < 5; }
export function isSunday(day) { return weekdayIndex(day) === 6; }
