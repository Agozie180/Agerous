# AGEROUS audit

Done on the original commit (`ffee5b0`), then repeated after the rebuild.

## Before: what the original repo really did

| Claim | Reality (verified by running the code) |
|---|---|
| "AI-powered dynamic simulation" | The interpreter worked, but validation was a stub: `{flood, severity:'banana', duration:99999}` passed. "Tomorrow" was ignored. |
| Flood simulation | A scripted timeline. Water rose 12/h, and fixed thresholds closed the school and church and flooded houses 1 and 2. **Severity didn't change the water** (a "low" flood peaked at 72 like a high one) and `duration` was unused. The 3D flood was a flat plane unrelated to terrain. |
| Church becomes shelter | Hardcoded to the church. |
| Market economy | `customerFlow` was never read by anything. A disruption changed nothing about who shopped. |
| NPCs react | Their *location* field changed and a mesh lerped in a straight line there. No roads, no arrival. Votes counted the instant the field changed, and used `Math.random()`. |
| World remembers | No storage at all. |
| Sunday service | There was no calendar. It was a manual button. |
| Reset / speed controls | Code existed, but the HTML elements didn't. |
| Geography | An untracked `geography.js` was imported by nothing and disagreed with the renderer. |

**Biggest judge-facing risk:** change the flood severity or schedule something for "tomorrow" and nothing changes.

## After: what is verified

| Spec question | Evidence |
|---|---|
| Different input → different world | `flood severity changes the world (low < medium < high)`: peaks differ, and only medium and high close the school. |
| Real state change under the visuals | Water is `env.stage` (metres). Flooding is `stage > terrainHeight`. The renderer only reads it. |
| Institutions respond dynamically | `shelters are chosen by RULE`: with the church flooded, the school is used and closes to lessons. With nothing dry, people are stranded and the history says so. |
| Roads matter | `a blocked road strands people` (pathing); `market sells to customers who can arrive` (blocked road → 0 customers, supply truck turned back, residents get hungry). |
| School closed tomorrow | Scheduled event: open on Day 1, closed on Day 2, reopens on Day 3 (test + `delay_days`). |
| Election | Campaign → polls → **votes only on arrival** → tally → archived result → history. Deterministic per seed, varies across seeds. A flood on election day postpones it or lowers turnout. |
| AI can't control the world | Schema validator tests: clamping, stripping, rejection, and hallucinated event types dropped. |
| Nonsense input | No crash, a useful message, and the world is byte-identical afterwards (unit test and browser flow C). |
| Persistence | Save → load → run on gives an identical future (unit test). Browser flow D reloads the page and gets back the clock, flood level and history through the real autosave. |
| Real 3D native browser game | `npm run e2e`: walkable avatar, sky view, inspector, minimap, the prompt box, no console errors. |

Counts: 46 unit tests pass (incl. 30-day autonomy and concurrent-event fuzz runs), browser flows A–D pass.

## Known gaps (not hidden)

- The live OpenAI and Anthropic calls were tested only against mocked responses, since no key was available.
- NPC behaviour is a deterministic priority list. The *reasons* come from state, but the agents are not autonomous.
- The offline parser is vocabulary-based. Unusual phrasing will be rejected rather than guessed.
- The browser run used SwiftShader (software WebGL). Frame rate on real GPUs is untested here.
- The bundle is about 540 kB because three.js is included. It could be code-split.

## Update — polish pass (Oct 12)

- Found and fixed: `docs/social.png` was not in the production build, so link previews had no image. It now ships from `public/` with an absolute `og:image` URL (set `SITE_URL`, or Vercel's production URL is used).
- Found and fixed: the top bar wraps to two rows and covered the first rows of both side panels and the consequence banner on desktop; on phones the *New world* button was clipped, there was no way to walk or talk, and the prompt box was cramped. Layout and touch controls fixed.
- Added: procedural audio, lightning, wellbeing-over-time graph. Browser e2e is now 28 checks (flows A–H) and passes, as do the 69 unit tests.
- Still true: live LLM calls are mock-tested only; frame rate was measured on software rendering only.
