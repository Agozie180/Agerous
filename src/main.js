/**
 * AGEROUS — page bootstrap
 *
 * Order matters:
 *   1. wire the intro / help buttons (so the page is never dead, whatever happens next)
 *   2. create the WebGL renderer inside try/catch
 *        ✗ failure → hide the intro, show the full-screen "3D isn't available" fallback, stop
 *        ✓ success → startGame() (game.js), then apply the URL parameters
 *
 * URL parameters:  ?play   skip the intro and play
 *                  ?demo   skip the intro and run the 30-second flood demo
 *                  ?challenge        open the Storm Day panel   (?challenge=start begins at once)
 */
import { GameScene } from './renderer/scene.js';
import { startGame } from './game.js';

const $ = id => document.getElementById(id);
const toast = (msg, kind) => window.agerousToast?.(msg, kind);
const params = new URLSearchParams(location.search);

// ── 1. intro buttons first ──────────────────────────────────────────────────
const intro = $('intro');
const closeIntro = () => { intro.classList.add('gone'); try { localStorage.setItem('agerous.seen', '1'); } catch { /* storage blocked */ } };
let seen = false; try { seen = !!localStorage.getItem('agerous.seen'); } catch { /* ignore */ }
if (seen || params.has('play') || params.has('demo') || params.has('challenge')) intro.classList.add('gone');
let game = null;                                                   // set once the renderer works
$('intro-play').onclick = closeIntro;
$('btn-help').onclick = () => intro.classList.remove('gone');
$('intro-demo').onclick = () => (game ? game.runDemo() : closeIntro());
window.__agerousBooted = true;                                     // tells index.html's watchdog we got this far

// ── 2. the 3D fallback ──────────────────────────────────────────────────────
function showNoWebGL(err) {
  console.warn('WebGL unavailable:', err);
  intro.classList.add('gone');
  document.body.classList.add('no-webgl');
  const img = $('nogl-demo'); if (!img.getAttribute('src')) img.src = img.dataset.src;     // only fetch the GIF when it is needed
  $('nogl-why').textContent = `Technical detail: ${String(err?.message || err).slice(0, 140)}`;
  $('nogl-retry').onclick = () => location.reload();
  $('nogl').classList.remove('hidden');
  $('nogl-retry').focus?.();
}

/** Cheap probe so a browser without WebGL goes straight to the fallback without Three.js logging errors. */
function webglAvailable() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl')); }
  catch { return false; }
}

let gs = null;
try {
  if (!webglAvailable()) throw new Error('This browser or device did not provide a WebGL context.');
  gs = new GameScene($('world-canvas'));                           // also throws if the GPU rejects the renderer
} catch (err) {
  showNoWebGL(err);
}

// ── 3. start the game ───────────────────────────────────────────────────────
if (gs) {
  gs.canvas.addEventListener('webglcontextlost', e => {
    e.preventDefault();                                            // lets the browser restore the context
    toast('The 3D view was interrupted by your device. It should come back by itself; if it does not, reload the page.', 'info');
  });
  game = startGame(gs, { closeIntro });

  if (params.has('demo')) game.runDemo();
  else if (params.has('challenge')) {
    if (params.get('challenge') === 'start') game.startChallenge(); else game.openDrawer('challenge');
  }
}
