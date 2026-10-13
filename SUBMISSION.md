# AI Builder Hackathon 2026 — submission pack

**Focus category:** Prompt-to-world creation / AI-generated gameplay

## Short description (paste into the form)

**What we built.** Agerous is a browser-native 3D game built on three.js. You play it by typing events in plain language — "A severe flood is coming and the election is tomorrow" — and a small living town reacts: the river rises over real terrain, roads go under, the school closes, civil defence opens a shelter, and 25 residents decide for themselves whether to flee, vote or go to work. School, market, church and homes keep running on their own, all at the same time, and the town remembers across reloads.

**Problem.** Language models are good at understanding intent but unsafe and unreliable as world engines: they hallucinate state and can't be tested. Most "AI worlds" are an LLM improvising a scene.

**How AI is used.** The LLM is the *interpreter*: it turns a free-form sentence into structured events from a fixed schema. A validator rejects unknown types and clamps numbers, then a deterministic, seeded simulation decides the consequences (water physics, a road graph, needs-driven NPC rules, an election model). The renderer only reads state. Invalid or unsupported prompts are rejected with an explanation and leave the world byte-identical. An offline parser is the fallback when the model is unavailable.

**Say it, and it exists.** Plain language also *builds*: "build a levee around the market" raises a wall in the 3D scene and changes the flood physics. Residents can be talked to, and answer in character from real world state.

**Compete and talk.** Storm Day is a fixed disaster scenario with a leaderboard whose scores are verified by deterministic server-side replay, plus a global chat. Any OpenAI- or Anthropic-compatible provider works via a custom base URL.

**Feels alive.** Procedural storm audio (rain, wind, river, thunder timed to lightning, church bell, alert tones), a wellbeing-over-time graph that marks each sentence you typed, and touch controls so it plays on a phone.

**Why it holds up.** 69 automated tests (physics, 30-day autonomy, concurrent-event fuzz, interpreter, persistence), 28 Playwright end-to-end checks (including a phone viewport), and an honest [AUDIT.md](AUDIT.md).

## Deliverables checklist

- [x] Public repository — https://github.com/Agozie180/Agerous
- [ ] Hosted browser demo — import the repo into Vercel; set `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` (or `OPENAI_API_KEY`) and add the Upstash Redis integration so the leaderboard and chat are durable; deploy. Judges then get real LLM interpretation with no key.
- [ ] Demo video, under 3 minutes — script below
- [x] Written description — above
- [x] Focus category — above

## Demo video script (≈2:30)

1. **0:00** Land on the page: "Type what happens. A living 3D town reacts." Press **Watch a flood unfold**.
2. **0:20** Show the live flood: river rising, roads going under, the chip strip (school closed, shelter open, campaign running together).
3. **0:50** Walk view. Click a resident → "why" panel (the decision reason).
4. **1:15** Type a new sentence yourself: "Build a levee around the market" then "A severe flood is coming" — the market stays dry. Show the interpretation card (events + validation) and the consequence chain.
5. **1:45** Open 🏆 Challenge: play Storm Day with one sentence ("send in the clean-up crews"), fast-forward, show the server-verified rank and the leaderboard, post a line in chat.
6. **2:05** Type nonsense ("summon a dragon") → rejected, world unchanged. Say why that matters.
6b. **2:10** Point at the *Wellbeing over time* graph: each amber marker is a sentence you typed, the blue area is the river. Turn the sound on (🔊) before recording to get the thunder.
7. **2:15** Reload → the town remembers. Show `npm test` (69 passing).
8. **2:25** Close: AI proposes, validator checks, simulation decides.

## Honest limits (say them, judges respect it)

Residents' *decisions* are rule-driven (their *voices* can be LLM-generated). Live LLM interpretation needs a key or the hosted proxy. Frame rate was measured on software rendering only.
