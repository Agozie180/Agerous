/**
 * Seeded RNG (mulberry32).  The state lives inside the world object, so a given
 * seed + the same sequence of prompts always produces the same town history —
 * which is what lets the test-suite assert on outcomes — and a saved game resumes
 * exactly where it left off.
 */
export function rand(world) {
  let t = (world.rngState = (world.rngState + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Stable hash of a string to [0, 1) — for per-NPC constants. */
export function hash01(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}
