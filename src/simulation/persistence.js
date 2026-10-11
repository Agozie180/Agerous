/**
 * AGEROUS — Persistence (localStorage)
 *
 * The whole world is plain JSON, so "the world remembers" is literal: save it,
 * reload the page, and the clock, flood, votes, NPC positions and history come back.
 */
import { SAVE_VERSION } from './world.js';

export const SAVE_KEY = 'agerous.save.v2';

export function serialize(world) { return JSON.stringify(world); }

export function deserialize(json) {
  try {
    const w = JSON.parse(json);
    if (!w || w.version !== SAVE_VERSION || !w.npcs || !w.env || !w.institutions) return null;
    return w;
  } catch { return null; }
}

export function saveWorld(world, storage = globalThis.localStorage) {
  try { storage.setItem(SAVE_KEY, serialize(world)); return true; } catch { return false; }
}
export function loadWorld(storage = globalThis.localStorage) {
  try { const s = storage.getItem(SAVE_KEY); return s ? deserialize(s) : null; } catch { return null; }
}
export function clearSave(storage = globalThis.localStorage) {
  try { storage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}
