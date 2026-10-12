# AGEROUS

### Type what happens. A living 3D town reacts — for real.

**A browser-native 3D game where plain language is the controller.** Say *"A severe flood is coming and the election is tomorrow"* and the river rises over real terrain, roads go under, the school closes, civil defence opens a shelter, and 25 residents decide for themselves whether to flee, vote, or go to work.

![30-second demo: one sentence, a whole town reacts](docs/demo.gif)

| ✍ You type | 🧠 AI proposes | ✅ Schema validates | 🌍 Simulation decides | 🎥 3D renders |
|---|---|---|---|---|
| any sentence | structured events only | unknown → rejected, numbers clamped | physics + rules + needs | reads state, never writes it |

**The one idea:** the AI never touches the world. It only *proposes* events; a validator and a deterministic simulation decide what they mean. That is why it is safe, testable and reproducible.

**Try it in 10 seconds:** open the page → press **▶ Watch a flood unfold**. No key, no install, no account.

## What makes it different from "an AI game"

- **Everything runs together.** School, market, church, homes, the river and an election are all live at once. Floods close the market *and* the polling station *and* the school, and the town works through it.
- **The town lives without you.** 30 simulated days with no input: teachers teach, vendors sell, farmers harvest, people eat and get paid, Sunday service fills the pews. Take away the teacher and lessons really cancel.
- **Causality you can see.** A chip strip shows what is running; a chain of consequences (*You → flood → Main Road impassable → shelter opened*) appears after every sentence; click anyone to read **why** they are doing what they do.
- **It remembers.** Reload the page and the water level, votes, positions and history return.
- **Honest.** 46 unit tests, browser end-to-end flows, and an [audit](AUDIT.md) of what was fake before and what is verified now.

Type **"A severe flood is coming."** and the river rises over real terrain. Low ground floods first: the fields, the riverside houses, then the market. Roads go under, the supply truck turns back, and the school closes. Civil defence opens the driest reachable building as a shelter, and the residents walk there along the roads that are still open. Once the water falls, they clean up, reopen and go home. All of it is written to a history that survives a page reload.

Then type **"The local election is tomorrow."** Campaigners canvass the square, voters walk to the polling station, and ballots count only when someone *arrives*. If you do both at once, turnout drops.

## What it is, who it's for

| | |
|---|---|
| **What** | A small, real simulation of a community (school, market, church, polling station, 5 houses, farm fields, a river, 25 residents) with a natural-language interface and a walkable 3D world. |
| **For** | **Players and judges** who want to see "AI → world" that really changes simulated state. **Educators and civic-planning teams** who want a cheap sandbox for explaining cascading risk (flood → roads → markets → schools → shelters → turnout). **Builders** who want a clean reference for a safe LLM-to-simulation pattern. |
| **Why AI?** | Natural language is the *input device*. It lets anyone author events and scenarios without programming the simulation. |
| **Why not just let the AI drive?** | The LLM can only emit events from a fixed, validated schema. The simulation decides what they mean. |

## Play

```bash
npm install
npm run dev        # http://localhost:5173
```

| Key | Action |
|---|---|
| **Enter** | Focus the prompt box and type an event |
| **W A S D** / arrows, **Shift** | Walk, run (deep water slows you; buildings are solid) |
| Drag / wheel | Look / zoom |
| **E** or click a person | Inspect them: what they're doing **and why**, their needs, money, routine |
| **Tab** | Toggle walk view and sky view |
| **Space** | Pause. The speed buttons give 1× / 3× / 9× |

Things to type:

- `A severe flood is coming` · `a minor flood tomorrow` · `heavy rain`
- `The local election is tomorrow` · `the election is today`
- `School is closed tomorrow` · `exam day at school` · `school reopens`
- `A large food shipment arrived at the market` · `the market road is blocked`
- `Sunday service this morning` · `it is sunny now` · `clean-up crews are out`
- Compound sentences: `A severe flood is coming and the election is tomorrow`
- Nonsense (`make it snow dragons`) is **rejected with an explanation**. The world is not changed.

The **Challenges** panel scores you from world state: bring the town through a flood with almost nobody exposed, reach 80% turnout, finish an election during a flood warning, or fill the pews on Sunday.

## How it works

```
 your sentence
      │
      ▼
 Interpreter ── LLM (OpenAI / Anthropic, bring-your-own-key)  ┐ both only PROPOSE events
      │         or offline rule parser (no key, no network)   ┘
      ▼
 Schema validator ── unknown types rejected · fields stripped · numbers clamped
      ▼
 Event handlers ───→ change WORLD STATE (src/simulation/events.js)
      ▼
 World state (plain JSON, the single source of truth)
      ▼
 Rules, every simulated quarter-hour (src/simulation/policies.js, npcs.js)
   civil defence · school · market · church · election · each NPC's decision
      ▼
 Renderer (three.js) READS state: water surface, people, signs, beacons, sky
```

- **Physics, not scripts.** A river stage in metres is compared against the same `terrainHeight()` the renderer draws. Roads are a graph and flood section by section. Severity changes the peak (1.3 / 2.2 / 2.8 m), so a *low* flood really is milder than a *high* one.
- **Shelters are chosen by rule** (dry, outside the forecast zone, reachable, has capacity, driest first). Nothing says "church". If the church is flooded, a different building gets used. If nothing qualifies, residents are stranded and the history says so.
- **People walk** along the road graph at a fixed pace. A flooded road can really cut someone off. Every decision carries a human-readable `reason`.
- **Market economy:** stock, price, sales and customers all come from who can actually arrive. A truck restocks it at 06:00 only if the road is open.
- **Election:** campaigners persuade the people they meet in the square. Floods and high prices nudge voters. Votes are counted on arrival at the polling station. If the polling station is flooded, the election is postponed.
- **Determinism:** one seeded RNG lives inside the world, so the same seed and prompts give the same history. That is what makes the 46 tests meaningful.
- **Memory:** the whole world autosaves to `localStorage`. Reload and the clock, flood, votes, positions and history come back.

## The AI interpreter

It works **out of the box offline**. To use an LLM, click **AI**, pick a provider, and paste a key. The model is editable, and the defaults are `gpt-4o-mini` and `claude-haiku-5-5`. The LLM never sees or touches the world. Its JSON goes through the same validator as the offline parser, so hallucinated events are dropped. If the call fails, Agerous falls back to the offline rules and tells you so.

> The key lives in your browser's localStorage and goes straight to the provider, which is fine for a demo. For a public deployment run `node server/proxy.mjs` (zero dependencies, key stays in `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` on the server) and pick **Server proxy** in the AI dialog.

## Development

```bash
npm test          # 46 tests: physics, institutions, autonomy, concurrency fuzz, election, interpreter, proxy, schema, persistence
npm run build     # production bundle in dist/
npm run e2e       # Playwright flows A–D against `vite preview` (needs Chromium)
```

```
src/simulation/   geography · pathing · world · events · policies · npcs · engine · schema · interpreter · persistence · challenges
src/renderer/     scene.js (terrain, water, buildings, people, sky) · player.js (avatar + cameras)
src/ui/           HUD, history, inspector, minimap
test/             node:test suites (no dependencies)
e2e/              browser end-to-end script
```

## Honest limitations

- The simulation is deliberately small: one valley, 25 residents, rule-based behaviour. These are **rule-driven agents, not autonomous AI agents**.
- The offline parser understands a fixed vocabulary. The LLM path is covered by mocked tests, because live providers need your key.
- The visuals are low-poly by design. The production bundle is about 575 kB (three.js is code-split). Rendering quality adapts to frame rate; only software rendering has been measured.
- See [AUDIT.md](AUDIT.md) for what the original repo claimed, what was fake, and what is now verified.

## License

MIT
