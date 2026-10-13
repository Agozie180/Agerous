/**
 * AGEROUS — touch controls: an on-screen joystick (move) and a Talk button.
 * Dragging anywhere else on the canvas still looks around (handled by the Player).
 * Shown automatically on coarse-pointer devices; add ?touch to the URL to force it.
 */
export function isTouchDevice() {
  try {
    return new URLSearchParams(location.search).has('touch') || window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  } catch { return false; }
}

export function initTouch(player) {
  if (!isTouchDevice()) return false;
  document.body.classList.add('touch');
  const pad = document.getElementById('joystick'), knob = pad.querySelector('i');
  let id = null, cx = 0, cy = 0;
  const R = 46;                                    // knob travel in px
  const set = (x, y) => {
    let dx = x - cx, dy = y - cy; const d = Math.hypot(dx, dy);
    if (d > R) { dx = dx / d * R; dy = dy / d * R; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    player.joy.x = dx / R; player.joy.y = dy / R;
  };
  const end = () => { id = null; knob.style.transform = ''; player.joy.x = player.joy.y = 0; pad.classList.remove('live'); };
  pad.addEventListener('pointerdown', e => {
    e.preventDefault(); id = e.pointerId; pad.setPointerCapture(id);
    const r = pad.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2;
    pad.classList.add('live'); set(e.clientX, e.clientY);
  });
  pad.addEventListener('pointermove', e => { if (e.pointerId === id) set(e.clientX, e.clientY); });
  pad.addEventListener('pointerup', e => { if (e.pointerId === id) end(); });
  pad.addEventListener('pointercancel', end);
  window.addEventListener('blur', end);
  return true;
}
