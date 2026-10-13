// `npm run measure` — reproduces the numbers quoted in the README's "Measured" table.
// Replays the full Storm Day scenario (4 simulated days) several times: reports wall time per
// replay and checks that every replay yields the identical score (the basis of server verification).
import { createScenarioWorld, scoreScenario, SCENARIO } from '../src/simulation/scenario.js';
import { advanceMinutes } from '../src/simulation/engine.js';

const N = 7, times = [], scores = new Set();
for (let i = 0; i < N; i++) {
  const t0 = performance.now();
  const w = createScenarioWorld();
  advanceMinutes(w, SCENARIO.endT - w.t);
  scores.add(scoreScenario(w).total);
  times.push(performance.now() - t0);
}
times.sort((a, b) => a - b);
console.log(`Storm Day replay: ${SCENARIO.endT} one-minute ticks (${SCENARIO.endT / 1440} simulated days)`);
console.log(`  wall time over ${N} runs: min ${times[0].toFixed(0)} ms · median ${times[N >> 1].toFixed(0)} ms · max ${times.at(-1).toFixed(0)} ms`);
console.log(`  distinct scores across ${N} identical replays: ${scores.size} (${[...scores].join(', ')}) — ${scores.size === 1 ? 'deterministic ✔' : 'NOT deterministic ✘'}`);
process.exit(scores.size === 1 ? 0 : 1);
