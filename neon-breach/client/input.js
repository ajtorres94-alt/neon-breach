// Keyboard / mouse / gamepad input. Everything is exposed as *actions* resolved through the player's bindings.
import { settings } from './settings.js';

const down = new Set();          // currently held codes ('KeyW', 'Mouse0', ...)
const edge = new Set();          // codes pressed since last frame
let mdx = 0, mdy = 0, wheelUp = 0, wheelDown = 0;
let locked = false, canvasEl = null, captureCb = null;
const padPrev = {};
const listeners = { lock: [], key: [] };

export const input = {
  get locked() { return locked; },
  on(evt, fn) { listeners[evt].push(fn); },
  pad: { connected: false, lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0 },
  usingPad: false,
  /** Next key/mouse press is delivered to cb(code) instead of the game (used by the key-rebind UI). */
  capture(cb) { captureCb = cb; },
};

export function bindCanvas(canvas) {
  canvasEl = canvas;
  canvas.addEventListener('mousedown', (e) => { if (!locked) return; e.preventDefault(); press('Mouse' + e.button); });
  window.addEventListener('mouseup', (e) => { down.delete('Mouse' + e.button); });
  window.addEventListener('mousemove', (e) => {
    if (!locked) return;
    mdx += e.movementX || 0; mdy += e.movementY || 0; input.usingPad = false;
  });
  window.addEventListener('wheel', (e) => {
    if (!locked) return;
    if (e.deltaY < 0) wheelUp++; else if (e.deltaY > 0) wheelDown++;
  }, { passive: true });
  window.addEventListener('contextmenu', (e) => { if (locked) e.preventDefault(); });
  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === canvas;
    if (!locked) { down.clear(); edge.clear(); }
    listeners.lock.forEach(fn => fn(locked));
  });
}

window.addEventListener('keydown', (e) => {
  if (captureCb) { e.preventDefault(); const cb = captureCb; captureCb = null; cb(e.code === 'Escape' ? null : e.code); return; }
  if (e.repeat) return;
  if (locked) { e.preventDefault(); input.usingPad = false; press(e.code); }
  listeners.key.forEach(fn => fn(e));
});
window.addEventListener('keyup', (e) => { down.delete(e.code); });
window.addEventListener('blur', () => { down.clear(); });
window.addEventListener('mousedown', (e) => {
  if (captureCb && !locked) { e.preventDefault(); const cb = captureCb; captureCb = null; cb('Mouse' + e.button); }
}, true);

function press(code) { down.add(code); edge.add(code); }

export function requestLock() {
  if (!canvasEl) return;
  try { const p = canvasEl.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch { /* denied */ }
}
export function releaseLock() { if (document.pointerLockElement) document.exitPointerLock(); }

// ------------------------------------------------------------------ gamepad
const PAD_MAP = {
  jump: 0, crouch: 1, reload: 2, next: 3, mine: 4, knife: 5, ads: 6, fire: 7, score: 8, pause: 9, call: 12, laser: 10, melee: 11, leanL: 14, leanR: 15,
};
function padButton(pad, idx) { const b = pad.buttons[idx]; return b ? (b.pressed || b.value > 0.5) : false; }
function padDown(pad, action) {
  const m = PAD_MAP[action]; if (m == null) return false;
  return Array.isArray(m) ? m.some(i => padButton(pad, i)) : padButton(pad, m);
}
const padActionsDown = new Set();

function pollPad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const pad = [...pads].find(p => p && p.connected);
  input.pad.connected = !!pad;
  if (!pad) { padActionsDown.clear(); return; }
  const dz = settings.pad.deadzone;
  const ax = (v) => { const a = Math.abs(v); return a < dz ? 0 : Math.sign(v) * (a - dz) / (1 - dz); };
  input.pad.lx = ax(pad.axes[0] || 0); input.pad.ly = ax(pad.axes[1] || 0);
  input.pad.rx = ax(pad.axes[2] || 0); input.pad.ry = ax(pad.axes[3] || 0);
  let any = Math.abs(input.pad.lx) + Math.abs(input.pad.ly) + Math.abs(input.pad.rx) + Math.abs(input.pad.ry) > 0.2;
  for (const act of Object.keys(PAD_MAP)) {
    const d = padDown(pad, act);
    if (d) any = true;
    if (d && !padPrev[act]) { padPrev[act] = true; edge.add('Pad:' + act); }
    if (!d) padPrev[act] = false;
    if (d) padActionsDown.add(act); else padActionsDown.delete(act);
  }
  if (any) input.usingPad = true;
}

/** Call once per frame before reading actions. */
export function beginFrame() { pollPad(); }
/** Call once per frame after reading actions. */
export function endFrame() { edge.clear(); mdx = mdy = 0; wheelUp = wheelDown = 0; }

export function actionDown(a) {
  const code = settings.keys[a];
  return (code && down.has(code)) || padActionsDown.has(a);
}
export function actionPressed(a) {
  const code = settings.keys[a];
  if (code === 'Wheel+') return wheelUp > 0 || edge.has('Pad:' + a);
  if (code === 'Wheel-') return wheelDown > 0 || edge.has('Pad:' + a);
  return (code && edge.has(code)) || edge.has('Pad:' + a);
}
export function padPressed(a) { return edge.has('Pad:' + a); }
export function mouseDelta() { return [mdx, mdy]; }
export function digitPressed() {
  for (let i = 1; i <= 6; i++) if (edge.has('Digit' + i)) return i;
  return 0;
}
