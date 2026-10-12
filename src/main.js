/**
 * AGEROUS — entry point
 *
 *   prompt → interpret (LLM or offline) → validate (schema) → queueEvent → world
 *   world → step() every frame → GameScene + UI read it
 */
import { createWorld } from './simulation/world.js';
import { step, startWorld, advanceMinutes } from './simulation/engine.js';
import { createScenarioWorld, SCENARIO, recordRun, scoreScenario, scenarioOver } from './simulation/scenario.js';
import { Chat, renderBoard, submitRun, playerName, setPlayerName, saveBestLocal, bestLocal } from './ui/social.js';
import { queueEvent } from './simulation/events.js';
import { interpret } from './simulation/interpreter.js';
import { PRESETS } from './simulation/llm.js';
import { loadWorld, saveWorld, clearSave } from './simulation/persistence.js';
import { log, day, hour } from './simulation/world.js';
import { GameScene } from './renderer/scene.js';
import { Player } from './renderer/player.js';
import { UI } from './ui/ui.js';
import { askResident } from './simulation/talk.js';

const $ = id => document.getElementById(id);
const AI_KEY = 'agerous.ai';
// A hosted deployment can bake in a server-side proxy (VITE_PROXY_URL) so judges get real LLM
// interpretation with no key. A user's own saved settings always win.
const DEFAULT_PROXY = import.meta.env?.VITE_PROXY_URL
  || (import.meta.env?.PROD && !/github\.io$|^localhost$|^127\./.test(location.hostname) ? '/api/interpret' : '');
const readAI = () => {
  try { const s = JSON.parse(localStorage.getItem(AI_KEY)); if (s && s.provider) return s; } catch { /* ignore */ }
  return DEFAULT_PROXY ? { provider: 'proxy', proxy: DEFAULT_PROXY } : {};
};

/** Saved AI settings -> the cfg that interpret()/askResident() understand. */
function aiConfig() {
  const a = readAI();
  switch (a.provider) {
    case 'proxy': return { proxyUrl: a.proxy };
    case 'openai': return { style: 'openai', apiKey: a.key, model: a.model };
    case 'anthropic': return { style: 'anthropic', apiKey: a.key, model: a.model };
    case 'compat': return { style: 'openai', baseUrl: a.baseUrl, apiKey: a.key, model: a.model };
    case 'compat_anthropic': return { style: 'anthropic', baseUrl: a.baseUrl, apiKey: a.key, model: a.model };
    default: return {};
  }
}

let world = loadWorld();
const resumed = !!world;
if (!world) world = startWorld(createWorld(Date.now() % 100000));

const gs = new GameScene($('world-canvas'));
const player = new Player(gs);
const ui = new UI();
let busy = false;
let challenge = false, finished = false;
ui.onTyping = v => { player.typing = v; };
ui.onAsk = (id, text) => {
  return askResident(world.npcs[id], world, text, aiConfig());
};

// ── the core loop: describe → interpret → validate → simulate ────────────
export async function runPrompt(text) {
  if (busy || !text.trim()) return null;
  busy = true; $('prompt-go').disabled = true;
  try {
    if (challenge && world.scenario.prompts >= SCENARIO.maxPrompts) {
      const r = { events: [], rejected: [{ reason: 'You are out of sentences — let the town play out.' }], notes: [], source: 'none' };
      ui.showInterpretation(r, []); return { result: r, outcomes: [] };
    }
    const result = await interpret(text, { ...aiConfig(), context: { day: day(world), hour: hour(world) } });
    if (challenge && result.events.length) recordRun(world, result.events);   // the run the server will replay
    const outcomes = result.events.map(e => queueEvent(world, e));
    log(world, `You: “${text.trim()}”${result.events.length ? '' : ' (nothing happened)'}`, 'you');
    world.prompts.push({ t: world.t, text: text.trim(), source: result.source, events: result.events, rejected: result.rejected.length });
    world.prompts = world.prompts.slice(-30);
    ui.showInterpretation(result, outcomes);
    if (!challenge) saveWorld(world);
    return { result, outcomes };
  } finally { busy = false; $('prompt-go').disabled = false; }
}

// ── prompt UI ────────────────────────────────────────────────────────────
const input = $('prompt-input');
input.addEventListener('focus', () => { player.typing = true; });
input.addEventListener('blur', () => { player.typing = false; });
input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') input.blur(); });
$('prompt-form').addEventListener('submit', async e => { e.preventDefault(); const t = input.value; input.value = ''; await runPrompt(t); });
document.querySelectorAll('#chips button').forEach(b => b.addEventListener('click', () => { input.value = b.dataset.p; input.focus(); }));

window.addEventListener('keydown', e => {
  if (player.typing) return;
  if (e.key === 'Enter') { e.preventDefault(); input.focus(); }
  else if (e.key === 'Tab') { e.preventDefault(); toggleView(); }
  else if (e.code === 'KeyE') { const n = player.nearestNPC(world); if (n) ui.npcCard(n, world); }
  else if (e.code === 'Space') { e.preventDefault(); setSpeed(world.timeSpeed === 0 ? 10 : 0); }
});
function toggleView() { $('btn-view').textContent = player.toggleMode() === 'walk' ? 'Sky view' : 'Walk view'; }
$('btn-view').onclick = toggleView;
function setSpeed(v) { world.timeSpeed = v; document.querySelectorAll('#speed button').forEach(b => b.classList.toggle('on', Number(b.dataset.speed) === v)); }
document.querySelectorAll('#speed button').forEach(b => b.addEventListener('click', () => setSpeed(Number(b.dataset.speed))));
setSpeed(world.timeSpeed);

// ── AI settings ─────────────────────────────────────────────────────────
const presetSel = $('ai-preset');
presetSel.innerHTML = '<option value="">Choose a preset…</option>' + Object.entries(PRESETS).filter(([k]) => k !== 'openai' && k !== 'anthropic').map(([k, p]) => `<option value="${k}">${p.label}</option>`).join('');
presetSel.onchange = () => { const p = PRESETS[presetSel.value]; if (!p) return; $('ai-base').value = p.baseUrl; $('ai-model').value = p.model; if ($('ai-provider').value === 'compat_anthropic' && p.style !== 'anthropic') $('ai-provider').value = 'compat'; syncProviderFields(); };
$('btn-ai').onclick = () => {
  const s = readAI();
  $('ai-provider').value = s.provider || ''; $('ai-key').value = s.key || ''; $('ai-model').value = s.model || ''; $('ai-proxy').value = s.proxy || ''; $('ai-base').value = s.baseUrl || '';
  syncProviderFields();
  $('modal').classList.remove('hidden');
};
function syncProviderFields() {
  const p = $('ai-provider').value, compat = p === 'compat' || p === 'compat_anthropic';
  $('lbl-proxy').classList.toggle('hidden', p !== 'proxy'); $('lbl-key').classList.toggle('hidden', p === 'proxy' || !p);
  $('lbl-base').classList.toggle('hidden', !compat); $('lbl-preset').classList.toggle('hidden', !compat);
}
$('ai-provider').onchange = syncProviderFields;
$('ai-close').onclick = () => $('modal').classList.add('hidden');
$('ai-save').onclick = () => {
  const provider = $('ai-provider').value, key = $('ai-key').value.trim(), model = $('ai-model').value.trim(), proxy = $('ai-proxy').value.trim(), baseUrl = $('ai-base').value.trim();
  const compat = provider === 'compat' || provider === 'compat_anthropic';
  const valid = provider && (provider === 'proxy' ? proxy : compat ? baseUrl : key);   // local gateways (Ollama…) may need no key
  try {
    if (!valid) localStorage.removeItem(AI_KEY);
    else localStorage.setItem(AI_KEY, JSON.stringify({ provider, key, proxy, baseUrl, model })); } catch { /* storage blocked */ }
  $('btn-ai').classList.toggle('on', !!readAI().provider);
  $('modal').classList.add('hidden');
};

// ── new world ───────────────────────────────────────────────────────────
$('btn-new').onclick = () => {
  if (!confirm('Start a new world? The current town and its history will be erased.')) return;
  if (challenge) { challenge = false; document.body.classList.remove('in-challenge'); $('chal-bar').classList.add('hidden'); }
  clearSave(); world = startWorld(createWorld(Date.now() % 100000)); ui.histLen = 0; ui.clearSelection(); setSpeed(10); saveWorld(world);
};

// ── picking NPCs by click ───────────────────────────────────────────────
$('world-canvas').addEventListener('pointerup', e => {
  if (!player.consumeClick()) return;
  const id = gs.pickPerson({ x: (e.clientX / innerWidth) * 2 - 1, y: -(e.clientY / innerHeight) * 2 + 1 });
  if (id) ui.npcCard(world.npcs[id], world); else ui.clearSelection();
});

// ── 10-second onboarding + scripted demo ─────────────────────────────────
const intro = $('intro');
const closeIntro = () => { intro.classList.add('gone'); try { localStorage.setItem('agerous.seen', '1'); } catch { /* ignore */ } };
let seen = false; try { seen = !!localStorage.getItem('agerous.seen'); } catch { /* ignore */ }
if (seen || new URLSearchParams(location.search).has('play')) intro.classList.add('gone');
$('intro-play').onclick = closeIntro;
$('btn-help').onclick = () => intro.classList.remove('gone');
let demoToken = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));
function caption(text, sub = '') { const c = $('caption'); c.innerHTML = text ? `${esc2(text)}${sub ? `<small>${esc2(sub)}</small>` : ''}` : ''; c.classList.toggle('hidden', !text); }
const esc2 = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
async function runDemo() {
  const me = ++demoToken; closeIntro();
  clearSave(); world = startWorld(createWorld(7)); ui.histLen = 0; ui.clearSelection(); setSpeed(10);
  if (player.mode !== 'sky') toggleView();
  const skip = document.createElement('button'); skip.id = 'demo-skip'; skip.textContent = 'Skip demo ✕';
  skip.onclick = () => { demoToken++; }; document.body.appendChild(skip);
  const live = () => demoToken === me;
  try {
    caption('A normal morning in Agerous', 'school · market · church · homes — all running on their own'); await sleep(3500); if (!live()) return;
    caption('');
    typeDemo('A severe flood is coming and the election is tomorrow'); await sleep(1200); if (!live()) return;
    await runPrompt('A severe flood is coming and the election is tomorrow');
    caption('One sentence → two validated events', 'flood + election, running together'); await sleep(3500); if (!live()) return;
    setSpeed(40); caption('');
    await sleep(14000); if (!live()) return;
    caption('Water, roads, shelters, votes — all simulated', 'not scripted. Try your own sentence.'); await sleep(4000);
  } finally { caption(''); skip.remove(); input.value = ''; if (live()) setSpeed(10); }
}
async function typeDemo(text) { input.value = ''; for (const ch of text) { if (!document.getElementById('demo-skip')) break; input.value += ch; await sleep(22); } }
$('intro-demo').onclick = runDemo;

// ── Storm Day challenge, leaderboard, chat ───────────────────────────────
const chat = new Chat();
const drawer = $('drawer');
$('chal-brief').textContent = SCENARIO.brief;
const nameInput = $('player-name'); nameInput.value = playerName();
nameInput.addEventListener('keydown', e => e.stopPropagation());
nameInput.addEventListener('focus', () => { player.typing = true; }); nameInput.addEventListener('blur', () => { player.typing = false; });
nameInput.addEventListener('change', () => { const n = nameInput.value.replace(/[^\p{L}\p{N} _.\-]/gu, '').trim().slice(0, 20) || playerName(); nameInput.value = n; setPlayerName(n); });
$('chat-input').addEventListener('focus', () => { player.typing = true; }); $('chat-input').addEventListener('blur', () => { player.typing = false; });
function openDrawer(tab) {
  drawer.classList.remove('hidden');
  document.querySelectorAll('#drawer .tabs button[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  for (const t of ['challenge', 'board', 'chat']) $(`tab-${t}`).classList.toggle('hidden', t !== tab);
  chat.setOpen(tab === 'chat');
  if (tab === 'board') renderBoard(playerName());
  if (tab === 'challenge') $('chal-best').textContent = bestLocal() ? `Your best on this device: ${bestLocal()} / 1000` : '';
}
document.querySelectorAll('#drawer .tabs button[data-tab]').forEach(b => b.onclick = () => openDrawer(b.dataset.tab));
$('drawer-x').onclick = () => { drawer.classList.add('hidden'); chat.setOpen(false); };
$('btn-chal').onclick = () => openDrawer('challenge');
$('btn-chat').onclick = () => openDrawer('chat');
chat.start();

function updateChalBar() {
  const left = SCENARIO.maxPrompts - world.scenario.prompts;
  $('chal-left').textContent = `${left} sentence${left === 1 ? '' : 's'} left`;
  const mins = SCENARIO.endT - world.t;
  $('chal-clock').textContent = `ends in ${Math.floor(mins / 60)}h`;
}
function startChallenge() {
  challenge = true; finished = false;
  closeIntro(); drawer.classList.add('hidden'); $('result').classList.add('hidden');
  world = createScenarioWorld(); ui.histLen = 0; ui.clearSelection(); setSpeed(10);
  if (player.mode !== 'sky') toggleView();
  document.body.classList.add('in-challenge'); $('chal-bar').classList.remove('hidden'); updateChalBar();
}
function exitChallenge() {
  challenge = false; finished = false;
  world = loadWorld() || startWorld(createWorld(Date.now() % 100000));
  ui.histLen = 0; ui.clearSelection(); setSpeed(world.timeSpeed || 10);
  document.body.classList.remove('in-challenge'); $('chal-bar').classList.add('hidden'); $('result').classList.add('hidden');
}
$('chal-start').onclick = startChallenge;
$('chal-quit').onclick = () => { if (confirm('Leave the challenge? This run will not be scored.')) exitChallenge(); };

function finishChallenge() {
  finished = true; setSpeed(0);
  const local = scoreScenario(world), run = world.scenario.run.slice();
  saveBestLocal(local.total);
  const box = $('result-box'); $('result').classList.remove('hidden');
  const parts = p => `<div class="parts">${[['Safety', p.safety, 300], ['Services', p.services, 300], ['Democracy', p.democracy, 250], ['Wellbeing', p.wellbeing, 150]].map(([n, v, m]) => `<div><b>${v}</b>${n} /${m}</div>`).join('')}</div>`;
  const show = (score, rankLine) => {
    box.innerHTML = `<div class="fine">STORM DAY · ${run.length} event${run.length === 1 ? '' : 's'} in ${world.scenario.prompts} sentence${world.scenario.prompts === 1 ? '' : 's'}</div><div class="total">${score.total}</div><div class="rank">${rankLine}</div>${parts(score.parts)}
      <div class="fine">Turnout ${score.turnout ?? '—'}% · ${score.exposedNpcHours} person-hours exposed · market open ${score.marketHours}h · school open ${score.schoolHours}h</div>
      <div class="row"><button id="res-board" class="big">📊 Leaderboard</button><button id="res-again" class="ghost">Try again</button><button id="res-free" class="ghost">Free play</button></div>`;
    $('res-board').onclick = () => { $('result').classList.add('hidden'); openDrawer('board'); };
    $('res-again').onclick = startChallenge; $('res-free').onclick = exitChallenge;
  };
  show(local, `Submitting as <b>${playerName()}</b>…`);
  submitRun(playerName(), run).then(r => show(r.score, `🏆 Rank <b>#${r.rank}</b> of ${r.of} · verified by server replay`))
    .catch(e => show(local, `Score saved on this device only — ${e.message}`));
}

// ── frame loop ──────────────────────────────────────────────────────────
let last = performance.now(), lastSave = last, lastBar = 0;
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.25); last = now;
  if (challenge && !finished) {
    // never run past the end of the scenario, whatever the speed or frame rate
    const room = SCENARIO.endT - world.t, want = dt * world.timeSpeed;
    if (world.timeSpeed > 0) advanceMinutes(world, Math.min(want, room));
    if (scenarioOver(world)) finishChallenge();
    else if (now - lastBar > 300) { lastBar = now; updateChalBar(); }
  } else step(world, dt);
  player.update(world, dt);
  gs.update(world, { selectedId: ui.selected, focus: player.focus });
  gs.render();
  ui.update(world, dt, player);
  ui.talkHint(player.mode === 'walk' && !player.typing ? player.nearestNPC(world) : null);
  if (!challenge && now - lastSave > 5000) { lastSave = now; if (saveWorld(world)) $('saved-note').textContent = 'saved'; }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.addEventListener('beforeunload', () => { if (!challenge) saveWorld(world); });
if (resumed) log(world, 'Welcome back — the world remembered where you left off.', 'good');

// handle for tests and curious judges: window.agerous.world / .say("…")
window.agerous = { get world() { return world; }, say: runPrompt, player, scene: gs, ui, get challenge() { return challenge; }, startChallenge: () => startChallenge() };
