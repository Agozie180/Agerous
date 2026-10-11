/**
 * AGEROUS — Road graph & pathfinding
 *
 * Built from ROAD_SPECS.  People walk along it, so a flooded road really does
 * cut people off: edges are blocked by the water stage (or a manual blockage),
 * and Dijkstra simply cannot route through them.
 */

import {
  ROAD_SPECS, LOCATION_SPECS, terrainHeight, slotPosition, sampleRoad,
} from './geography.js';

/** Metres of water over a road that people can still wade through. */
export const WADE_DEPTH = 0.4;

const key = (x, z) => `${Math.round(x * 10)}:${Math.round(z * 10)}`;

class Graph {
  constructor() {
    this.nodes = [];          // { id, x, z }
    this.edges = [];          // { a, b, len, road, elev }
    this.adj = [];            // adj[nodeId] = [edgeIndex]
    this._index = new Map();
  }

  node(x, z) {
    const k = key(x, z);
    if (this._index.has(k)) return this._index.get(k);
    const id = this.nodes.length;
    this.nodes.push({ id, x, z });
    this.adj.push([]);
    this._index.set(k, id);
    return id;
  }

  edge(a, b, road, elev = null) {
    const A = this.nodes[a], B = this.nodes[b];
    const len = Math.hypot(A.x - B.x, A.z - B.z);
    const mx = (A.x + B.x) / 2, mz = (A.z + B.z) / 2;
    const e = {
      a, b, len, road,
      // Lowest ground along the edge decides when it goes under.
      elev: elev ?? Math.min(terrainHeight(A.x, A.z), terrainHeight(mx, mz), terrainHeight(B.x, B.z)),
    };
    const idx = this.edges.push(e) - 1;
    this.adj[a].push(idx);
    this.adj[b].push(idx);
    return idx;
  }

  nearestNode(x, z) {
    let best = -1, bd = Infinity;
    for (const n of this.nodes) {
      const d = Math.hypot(n.x - x, n.z - z);
      if (d < bd) { bd = d; best = n.id; }
    }
    return best;
  }
}

function build() {
  const g = new Graph();
  for (const [roadId, spec] of Object.entries(ROAD_SPECS)) {
    // sample finely so a road can flood in sections (the low east end of Main Road
    // goes under long before the town centre does)
    const pts = sampleRoad(spec.points, 3);
    let prev = g.node(pts[0][0], pts[0][1]);
    // ensure original vertices (junctions) exist as nodes
    for (let i = 1; i < pts.length; i++) {
      const cur = g.node(pts[i][0], pts[i][1]);
      if (cur !== prev) g.edge(prev, cur, roadId);
      prev = cur;
    }
  }
  // Spurs: every place connects to the network with a short path.  Places that sit
  // on a road (school, market, church, ...) use that road's id so the spur floods
  // with it; free-standing places (houses, fields) have a private spur that floods
  // when the place itself does.
  const doors = {};
  for (const [id, spec] of Object.entries(LOCATION_SPECS)) {
    if (spec.kind === 'river') continue;
    const slot0 = slotPosition(id, 0);
    const nn = g.nearestNode(spec.x, spec.z);
    const door = g.node(slot0.x, slot0.z);
    const road = spec.roads[0] ?? `spur:${id}`;
    if (door !== nn) g.edge(nn, door, road, terrainHeight(spec.x, spec.z));
    doors[id] = door;
  }
  return { g, doors };
}

const { g: GRAPH, doors: DOORS } = build();
export { GRAPH, DOORS };

export function edgeBlocked(edge, env) {
  if (env.blockedRoads && env.blockedRoads[edge.road] != null) return true;
  return env.stage > edge.elev + WADE_DEPTH;
}

/**
 * Cheapest path (array of [x,z] points) from a position to a place's standing spot,
 * or null if flooding/blockages make it unreachable.
 */
export function findPath(env, from, locationId, slot = 0) {
  const spec = LOCATION_SPECS[locationId];
  if (!spec) return null;
  const goal = slotPosition(locationId, slot);
  const startNode = GRAPH.nearestNode(from.x, from.z);
  const goalNode = DOORS[locationId];

  const dist = new Array(GRAPH.nodes.length).fill(Infinity);
  const prev = new Array(GRAPH.nodes.length).fill(-1);
  const done = new Array(GRAPH.nodes.length).fill(false);
  dist[startNode] = 0;
  for (;;) {
    let u = -1, best = Infinity;
    for (let i = 0; i < dist.length; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
    if (u < 0 || u === goalNode) break;
    done[u] = true;
    for (const ei of GRAPH.adj[u]) {
      const e = GRAPH.edges[ei];
      if (edgeBlocked(e, env)) continue;
      const v = e.a === u ? e.b : e.a;
      const nd = dist[u] + e.len;
      if (nd < dist[v]) { dist[v] = nd; prev[v] = u; }
    }
  }
  if (dist[goalNode] === Infinity) return null;
  const rev = [];
  for (let n = goalNode; n !== -1; n = prev[n]) rev.push([GRAPH.nodes[n].x, GRAPH.nodes[n].z]);
  rev.reverse();
  rev.push([goal.x, goal.z]);
  return rev;
}

export function pathLength(points, from) {
  let len = 0, px = from.x, pz = from.z;
  for (const [x, z] of points) { len += Math.hypot(x - px, z - pz); px = x; pz = z; }
  return len;
}

/** Is the given road section (by road id) currently passable end to end? */
export function roadPassable(env, roadId) {
  for (const e of GRAPH.edges) if (e.road === roadId && edgeBlocked(e, env)) return false;
  return true;
}
