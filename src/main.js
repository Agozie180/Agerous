/**
 * AGEROUS — entry point
 *
 *   prompt → interpret (LLM or offline) → validate (schema) → queueEvent → world
 *   world → step() every frame → GameScene + UI read it
 */
import { createWorld } from './simulation/world.js';
import { step, startWorld } from './simulation/engine.js';
import { queueEvent } from './simulation/events.js';
import { interpret, PROVIDERS } from './simulation/interpreter.js';
import { loadWorld, saveWorld, clearSave } from './simulation/persistence.js';
import { log, day, hour } from './simulation/world.js';
import { GameScene } from './renderer/scene.js';
import { Player } from './renderer/player.js';
import { UI } from './ui/ui.js';

const $ = id => document.getElementById(id);
const AI_KEY = 'agerous.ai';
// A hosted deployment can bake in a server-side proxy (VITE_PROXY_URL) so judges get real LLM
// interpretation with no key. A user's own saved settings always win.
const DEFAULT_PROXY = import.meta.env?.VITE_PROXY_URL || '';
const readAI = () => {
  try { const s = JSON.parse(localStorage.getItem(AI_KEY)); if (s && s.provider) return s; } catch { /* ignore */ }
  return DEFAULT_PROXY ? { provider: 'proxy', proxy: DEFAULT_PROXY } : {};
};

let world = loadWorld();
const resumed = !!world;
if (!world) world = startWorld(createWorld(Date.now() % 100000));

const gs = new GameScene($('world-canvas'));
const player = new Player(gs);
const ui = new UI();
let busy = false;

// ── the core loop: describe → interpret → validate → simulate ────────────
export async function runPrompt(text) {
  if (busy || !text.trim()) return null;
  busy = true; $('prompt-go').disabled = true;
  try {
    const ai = readAI();
    const result = await interpret(text, { provider: ai.provider, apiKey: ai.key, model: ai.model, proxyUrl: ai.provider === 'proxy' ? ai.proxy : undefined, context: { day: day(world), hour: hour(world) } });
    const outcomes = result.events.map(e => queueEvent(world, e));
    log(world, `You: “${text.trim()}”${result.events.length ? '' : ' (nothing happened)'}`, 'you');
    world.prompts.push({ t: world.t, text: text.trim(), source: result.source, events: result.events, rejected: result.rejected.length });
    world.prompts = world.prompts.slice(-30);
    ui.showInterpretation(result, outcomes);
    saveWorld(world);
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
$('btn-ai').onclick = () => {
  const s = readAI();
  $('ai-provider').value = s.provider || ''; $('ai-key').value = s.key || ''; $('ai-model').value = s.model || ''; $('ai-proxy').value = s.proxy || '';
  syncProviderFields();
  $('modal').classList.remove('hidden');
};
function syncProviderFields() { const p = $('ai-provider').value; $('lbl-proxy').classList.toggle('hidden', p !== 'proxy'); $('lbl-key').classList.toggle('hidden', p === 'proxy' || !p); }
$('ai-provider').onchange = syncProviderFields;
$('ai-close').onclick = () => $('modal').classList.add('hidden');
$('ai-save').onclick = () => {
  const provider = $('ai-provider').value, key = $('ai-key').value.trim(), model = $('ai-model').value.trim(), proxy = $('ai-proxy').value.trim();
  try {
    if (!provider || (provider === 'proxy' ? !proxy : !key)) localStorage.removeItem(AI_KEY);
    else localStorage.setItem(AI_KEY, JSON.stringify({ provider, key, proxy, model: model || PROVIDERS[provider]?.defaultModel })); } catch { /* storage blocked */ }
  $('btn-ai').classList.toggle('on', !!readAI().provider);
  $('modal').classList.add('hidden');
};

// ── new world ───────────────────────────────────────────────────────────
$('btn-new').onclick = () => {
  if (!confirm('Start a new world? The current town and its history will be erased.')) return;
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

// ── frame loop ──────────────────────────────────────────────────────────
let last = performance.now(), lastSave = last;
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.25); last = now;
  step(world, dt);
  player.update(world, dt);
  gs.update(world, { selectedId: ui.selected, focus: player.focus });
  gs.render();
  ui.update(world, dt, player);
  ui.talkHint(player.mode === 'walk' && !player.typing ? player.nearestNPC(world) : null);
  if (now - lastSave > 5000) { lastSave = now; if (saveWorld(world)) $('saved-note').textContent = 'saved'; }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.addEventListener('beforeunload', () => saveWorld(world));
if (resumed) log(world, 'Welcome back — the world remembered where you left off.', 'good');

// handle for tests and curious judges: window.agerous.world / .say("…")
window.agerous = { get world() { return world; }, say: runPrompt, player, scene: gs };
