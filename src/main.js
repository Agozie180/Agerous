/**
 * AGEROUS — Main Entry Point
 *
 * Wires together:
 *   worldState ← simulationEngine ← eventInterpreter ← UI
 *   worldState → worldRenderer → canvas
 *   worldState → uiController → DOM
 */

import { createWorldState, addHistory, resetWorldState } from './simulation/worldState.js';
import { createNPCs, tickAllNPCs } from './simulation/npcSystem.js';
import { tickTime, executeEvent } from './simulation/simulationEngine.js';
import { interpretEvent, validateEvent } from './simulation/eventInterpreter.js';
import { WorldRenderer } from './renderer/worldRenderer.js';
import { UIController } from './ui/uiController.js';

// ─── Bootstrap ───────────────────────────────────────────────────

async function main() {
  // 1. World state
  let state = _createFreshState();

  // 2. Renderer
  const canvas   = document.getElementById('world-canvas');
  const renderer = new WorldRenderer(canvas);
  renderer.init();
  renderer.spawnNPCs(state.npcs);

  // 3. UI
  const ui = new UIController();
  ui.update(state);
  ui.setupSpeedControl(state);

  // 4. API key handling
  let apiKey = localStorage.getItem('agerous_openai_key') || null;
  _setupAPIModal(key => { apiKey = key; });

  // 5. Event input wiring
  _setupEventInput(state, ui, () => apiKey);
  _setupScenarioChips(state, ui, () => apiKey);

  // 6. Reset button
  _setupReset(
    () => {
      // Returns a new state; renderer re-uses its existing scene but
      // NPC meshes are already spawned — we just update NPC data
      state = _createFreshState();
      renderer.syncNPCs(state.npcs);
      ui.resetHistory();
      ui.update(state);
      ui.setupSpeedControl(state);
      _setupEventInput(state, ui, () => apiKey);
    }
  );

  // 7. Mouse tooltip
  window.addEventListener('mousemove', e => {
    renderer.checkNPCHover(state.npcs, e);
    renderer.positionTooltip(e.clientX, e.clientY);
  });

  // 8. Main loop — uses a closure over `state` reference so reset works
  let lastTime = performance.now();
  function loop(now) {
    const deltaMs = now - lastTime;
    lastTime = now;

    tickTime(state, deltaMs);
    renderer.render(state);
    ui.update(state);

    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

// ─── Helper: build a fresh simulation state ──────────────────────

function _createFreshState() {
  const state  = createWorldState();
  state.npcs   = createNPCs();

  addHistory(state, '--- Day 1 ---', 'normal');
  addHistory(state, 'Agerous community has woken up.', 'normal');
  addHistory(state, 'School open · Market open · Church quiet.', 'normal');

  tickAllNPCs(state);
  return state;
}

// ─── API Modal ───────────────────────────────────────────────────

function _setupAPIModal(onKey) {
  const modal   = document.getElementById('api-modal');
  const input   = document.getElementById('api-key-input');
  const saveBtn = document.getElementById('api-key-save');
  const skipBtn = document.getElementById('api-key-skip');

  const stored = localStorage.getItem('agerous_openai_key');
  if (stored) {
    onKey(stored);
    return; // already have key, no modal needed
  }

  modal.classList.remove('hidden');

  saveBtn.addEventListener('click', () => {
    const key = input.value.trim();
    if (key.startsWith('sk-')) {
      localStorage.setItem('agerous_openai_key', key);
      onKey(key);
    }
    modal.classList.add('hidden');
  });

  skipBtn.addEventListener('click', () => {
    modal.classList.add('hidden');
    onKey(null);
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') saveBtn.click();
  });
}

// ─── Event Input ─────────────────────────────────────────────────

// Keep a reference to old listeners so they can be removed on reset
let _currentHandleSubmit = null;
let _currentKeydownHandler = null;

function _setupEventInput(state, ui, getApiKey) {
  const btn   = document.getElementById('simulate-btn');
  const input = document.getElementById('event-input');

  if (_currentHandleSubmit) {
    btn.removeEventListener('click', _currentHandleSubmit);
  }
  if (_currentKeydownHandler) {
    input.removeEventListener('keydown', _currentKeydownHandler);
  }

  async function handleSubmit() {
    const text = ui.getInputText();
    if (!text) return;

    ui.setSimulating(true, 'Interpreting…');

    let event;
    try {
      event = await interpretEvent(text, getApiKey());
    } catch (err) {
      ui.setSimulating(false);
      ui.showStatus(`Error: ${err.message}`, '#f87171');
      return;
    }

    const validation = validateEvent(event);
    if (!validation.valid) {
      ui.setSimulating(false);
      ui.showStatus(validation.reason, '#f87171');
      return;
    }

    ui.showStatus(`→ ${event.event_type.replace(/_/g, ' ')}`, '#6ee7b7');

    setTimeout(() => {
      executeEvent(state, event);
      ui.setSimulating(false);
      ui.showStatus('Event simulated ✓', '#6ee7b7');
      ui.clearInput();
      setTimeout(() => ui.showStatus(''), 4000);
    }, 400);
  }

  function handleKeydown(e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSubmit();
  }

  btn.addEventListener('click', handleSubmit);
  input.addEventListener('keydown', handleKeydown);

  _currentHandleSubmit = handleSubmit;
  _currentKeydownHandler = handleKeydown;
}

function _setupScenarioChips(state, ui, getApiKey) {
  const chips = document.querySelectorAll('.scenario-chip');
  for (const chip of chips) {
    chip.addEventListener('click', () => {
      const text = chip.dataset.event || '';
      const input = document.getElementById('event-input');
      if (!input) return;
      input.value = text;
      input.focus();
      input.dispatchEvent(new Event('input'));
      if (text.trim()) {
        ui.showStatus('Scenario loaded', '#7dd3fc');
      }
    });
  }
}

// ─── Reset Button ─────────────────────────────────────────────────

function _setupReset(onReset) {
  const btn = document.getElementById('reset-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (confirm('Reset the world? All history will be lost.')) {
      onReset();
    }
  });
}

// ─── Start ───────────────────────────────────────────────────────

main().catch(err => {
  console.error('[Agerous] Fatal error:', err);
});
