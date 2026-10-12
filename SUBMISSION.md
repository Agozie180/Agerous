# AI Builder Hackathon 2026 — submission pack

**Focus category:** Prompt-to-world creation / AI-generated gameplay

## Short description (paste into the form)

**What we built.** Agerous is a browser-native 3D game built on three.js. You play it by typing events in plain language — "A severe flood is coming and the election is tomorrow" — and a small living town reacts: the river rises over real terrain, roads go under, the school closes, civil defence opens a shelter, and 25 residents decide for themselves whether to flee, vote or go to work. School, market, church and homes keep running on their own, all at the same time, and the town remembers across reloads.

**Problem.** Language models are good at understanding intent but unsafe and unreliable as world engines: they hallucinate state and can't be tested. Most "AI worlds" are an LLM improvising a scene.

**How AI is used.** The LLM is the *interpreter*: it turns a free-form sentence into structured events from a fixed schema. A validator rejects unknown types and clamps numbers, then a deterministic, seeded simulation decides the consequences (water physics, a road graph, needs-driven NPC rules, an election model). The renderer only reads state. Invalid or unsupported prompts are rejected with an explanation and leave the world byte-identical. An offline parser is the fallback when the model is unavailable.

**Why it holds up.** 46 automated tests (physics, 30-day autonomy, concurrent-event fuzz, interpreter, persistence), Playwright end-to-end flows, and an honest [AUDIT.md](AUDIT.md).

## Deliverables checklist

- [x] Public repository — https://github.com/Agozie180/Agerous
- [ ] Hosted browser demo — deploy (GitHub Pages workflow included: Settings → Pages → Source: GitHub Actions). Build with `VITE_PROXY_URL=https://<your-proxy>/interpret` so judges get the real LLM without a key.
- [ ] Demo video, under 3 minutes — script below
- [x] Written description — above
- [x] Focus category — above

## Demo video script (≈2:30)

1. **0:00** Land on the page: "Type what happens. A living 3D town reacts." Press **Watch a flood unfold**.
2. **0:20** Show the live flood: river rising, roads going under, the chip strip (school closed, shelter open, campaign running together).
3. **0:50** Walk view. Click a resident → "why" panel (the decision reason).
4. **1:15** Type a new sentence yourself: "The market road is blocked and a food shipment arrived". Show the interpretation card (events + validation) and the consequence chain.
5. **1:45** Type nonsense ("summon a dragon") → rejected, world unchanged. Say why that matters.
6. **2:05** Reload → the town remembers. Show `npm test` (46 passing).
7. **2:25** Close: AI proposes, validator checks, simulation decides.

## Honest limits (say them, judges respect it)

Residents are rule-driven agents, not LLM agents. Live LLM interpretation needs a key or the hosted proxy. Frame rate was measured on software rendering only.
