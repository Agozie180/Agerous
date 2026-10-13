# Handoff — pick up here in a new chat

**Goal:** win Victoria VR's *AI Builder Hackathon 2026* (submit by **Nov 11, 2026 16:30 CEST**). Deliverables: public repo ✔, hosted demo ☐, <3 min demo video ☐ (owner records it), written description ✔ (`SUBMISSION.md`), focus category ✔.

**Rules for any assistant continuing this:** commits must be authored by `Agozie180 <137266828+Agozie180@users.noreply.github.com>` only (set `git config user.email` to that) — no AI-assistant author or co-author trailers of any kind. Push to `origin main` (https://github.com/Agozie180/Agerous).

## What exists (all pushed, 69 unit tests passing)
- Vite + three.js 3D town; `npm run dev`, `npm test`, `npm run build`, `npm run e2e`.
- Pipeline: sentence → interpreter (LLM or offline rules) → schema validator → deterministic tick-based simulation (`src/simulation/*`) → renderer reads state.
- Events: flood, weather, school, market, church, election, recovery, **build** (sandbags/levee/flood wall).
- Residents decide by rules; talk to them (`talk.js`, LLM-voiced when available).
- **Any provider:** `src/simulation/llm.js` — OpenAI/Anthropic official or any compatible base URL; server env `LLM_BASE_URL/LLM_API_KEY/LLM_MODEL[/LLM_API_STYLE]`.
- **Storm Day challenge** (`scenario.js`) + **leaderboard verified by server replay** + **global chat** (`server/handlers.mjs`, `server/store.mjs`, `api/*.js`, `src/ui/social.js`). Durable storage needs Upstash/Vercel KV env vars; otherwise in-memory.
- Polish pass: `src/audio.js` (Web Audio soundscape), `src/ui/touch.js` (joystick), lightning in `scene.js`, `UI.trend()` graph, `public/social.png` + `SITE_URL` og:image.
- Docs: `README.md`, `AUDIT.md`, `SUBMISSION.md` (pitch, checklist, video script).

## Still to do
1. Deploy to Vercel; set env vars (LLM_* and the Upstash/KV integration). Share the live URL.
2. On the live site confirm the interpretation card says "Interpreted by AI", a resident reply says "AI-voiced", and a leaderboard score appears after a Storm Day run.
3. ✔ `npm run e2e` re-run on the polished build: 28/28 pass (needs `node server/proxy.mjs` on :8787 and `vite preview` on :4173).
4. Paste the GitHub About description/topics manually (API writes were blocked) and upload `docs/social.png` as the social preview.
5. Owner records the <3 min video (script in `SUBMISSION.md`).
6. ✔ Done in the polish pass: procedural sound, lightning, wellbeing graph, phone controls, share-image fix. Optional next: more Storm Day levers (e.g. building on roads), per-resident LLM memory.

## Honest limits
Resident *decisions* are rules, not LLM agents. Live third-party LLM calls are only mock-tested. Frame rate measured on software rendering only. Public API key + chat need a spend cap and moderation.
