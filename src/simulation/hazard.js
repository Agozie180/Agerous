/**
 * AGEROUS — Hazard helpers (flood physics queries shared by engine, NPCs, renderer, UI)
 */
import { LOCATION_SPECS, locationElevation } from './geography.js';

/** Water this deep over a place's ground makes it unusable until cleaned up. */
export const FLOOD_DEPTH = 0.3;
/** Civil defence treats anything the forecast puts within this margin of the water as at risk. */
export const RISK_MARGIN = 0.3;

/** Metres of protection a built defence adds around a place (see the `build` event). */
export const defenseOf = (w, id) => w.env.defenses?.[id] ?? 0;
export const effectiveElevation = (w, id) => locationElevation(id) + defenseOf(w, id);

export const isRaining = w => w.env.rainUntil != null && w.t < w.env.rainUntil;

/** What the river is expected to do: the level the rain is driving it to, or where it is now. */
export const forecastStage = w => (isRaining(w) ? Math.max(w.env.stage, w.env.peak) : w.env.stage);

export function atRisk(w, id) {
  if (!LOCATION_SPECS[id] || id === 'river') return false;
  return forecastStage(w) > effectiveElevation(w, id) - RISK_MARGIN;
}

/** 'clear' | 'cloudy' | 'rain' | 'storm' — derived from the environment, never stored. */
export function weatherOf(w) {
  if (isRaining(w)) return w.env.peak >= 1.5 ? 'storm' : (w.env.peak >= 0.4 ? 'rain' : 'drizzle');
  if (w.env.stage > 0.15) return 'cloudy';
  return w.env.baseWeather;
}
