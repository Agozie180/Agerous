import { createWorld, day, hour, minute } from '../src/simulation/world.js';
import { advanceMinutes, startWorld } from '../src/simulation/engine.js';
import { queueEvent } from '../src/simulation/events.js';
import { interpretOffline } from '../src/simulation/interpreter.js';
import { validateEvent } from '../src/simulation/schema.js';

export function fresh(seed = 1) { return startWorld(createWorld(seed)); }
export const hours = (w, h) => advanceMinutes(w, h * 60);
export function toTime(w, d, h, m = 0) {
  const target = (d - 1) * 1440 + h * 60 + m;
  if (target < w.t) throw new Error(`cannot go back in time (${w.t} -> ${target})`);
  advanceMinutes(w, target - w.t);
}
export const event = o => { const v = validateEvent(o); if (!v.ok) throw new Error(v.reason); return v.event; };
export const fire = (w, o) => queueEvent(w, event(o));
export const at = (w, loc) => Object.values(w.npcs).filter(n => n.location === loc);
export const by = (w, pred) => Object.values(w.npcs).filter(pred);
export const said = (w, re) => w.history.some(h => re.test(h.text));
export const clock = w => `Day ${day(w)} ${String(hour(w)).padStart(2, '0')}:${String(minute(w)).padStart(2, '0')}`;
/** run a full prompt through the offline interpreter and fire the validated events */
export function say(w, text) {
  const r = interpretOffline(text);
  for (const e of r.events) queueEvent(w, e);
  return r;
}
export function peakStageOf(w, hrs) {
  let peak = 0;
  for (let i = 0; i < hrs * 4; i++) { advanceMinutes(w, 15); peak = Math.max(peak, w.env.stage); }
  return peak;
}
