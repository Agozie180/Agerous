/**
 * AGEROUS — Challenges & community score
 *
 * Win conditions are computed from world state, not from UI events, so they can
 * only be met by actually changing how the town behaves.
 */
import { day } from './world.js';

export function communityScore(world) {
  const npcs = Object.values(world.npcs);
  if (!npcs.length) return 0;
  const s = npcs.reduce((a, n) => a + 0.5 * n.needs.safety + 0.3 * n.needs.food + 0.2 * n.needs.social, 0);
  return Math.round((s / npcs.length) * 100);
}

export const CHALLENGES = [
  {
    id: 'higher_ground',
    title: 'Higher Ground',
    brief: 'Describe a severe flood and bring the town through it with almost nobody left exposed.',
    check(w) {
      const e = w.stats.lastEpisode;
      if (!e) return { done: false, progress: w.stats.episode ? `Flood in progress — ${Math.round(w.stats.episode.exposedNpcHours)} person-hours exposed so far (need ≤ 12).` : 'Start a flood: “A severe flood is coming.”' };
      return { done: e.peakStage >= 2.0 && e.exposedNpcHours <= 12, progress: `Last flood: peak ${e.peakStage.toFixed(1)} m, ${Math.round(e.exposedNpcHours)} person-hours exposed (need peak ≥ 2.0 m and ≤ 12).` };
    },
  },
  {
    id: 'every_voice',
    title: 'Every Voice',
    brief: 'Hold a local election with at least 80% turnout.',
    check(w) {
      const r = w.elections.at(-1);
      if (!r) return { done: false, progress: 'Call one: “The local election is tomorrow.”' };
      return { done: w.elections.some(e => e.turnout >= 80), progress: `Best turnout so far: ${Math.max(...w.elections.map(e => e.turnout))}%.` };
    },
  },
  {
    id: 'democracy_under_water',
    title: 'Democracy Under Water',
    brief: 'Get an election finished while a flood warning is in force.',
    check(w) {
      const done = w.elections.some(e => e.flood);
      return { done, progress: done ? 'Polls closed during a flood warning.' : 'Combine a flood with an election day and see what happens to turnout.' };
    },
  },
  {
    id: 'full_pews',
    title: 'Full Pews',
    brief: 'See at least 90% of the regulars at a Sunday service.',
    check(w) {
      const a = w.institutions.church.lastAttendance;
      if (!a || a.kind !== 'sunday') return { done: false, progress: `Sunday is Day 7, 14, … (now Day ${day(w)}). Let the clock run — or use ⏩.` };
      return { done: w.achievements.full_pews || a.attended / a.goers >= 0.9, progress: `Last Sunday: ${a.attended}/${a.goers} attended.` };
    },
  },
];

/** Evaluate all challenges; remember completed ones in world.achievements. */
export function evaluateChallenges(world) {
  const out = [];
  for (const c of CHALLENGES) {
    const r = c.check(world);
    if (r.done && !world.achievements[c.id]) world.achievements[c.id] = { day: day(world) };
    out.push({ id: c.id, title: c.title, brief: c.brief, done: !!world.achievements[c.id], progress: r.progress });
  }
  return out;
}
