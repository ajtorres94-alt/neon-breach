// Player settings, key bindings, operator skins and accessibility palettes. Saved in localStorage.

export const ACTIONS = [
  ['forward', 'Move forward'], ['back', 'Move back'], ['left', 'Strafe left'], ['right', 'Strafe right'],
  ['jump', 'Jump'], ['crouch', 'Crouch (hold)'], ['sprint', 'Sprint (hold)'], ['fire', 'Fire'], ['ads', 'Aim down sights'],
  ['reload', 'Reload'], ['mine', 'Place proximity mine'], ['laser', 'Place laser mine'], ['knife', 'Throw knife'], ['melee', 'Melee'], ['leanL', 'Lean left'], ['leanR', 'Lean right'],
  ['next', 'Next weapon'], ['prev', 'Previous weapon'], ['call', 'Callout wheel (hold)'], ['score', 'Scoreboard (hold)'],
];

export const DEFAULTS = {
  name: '',
  op: 0,
  gfx: { quality: 'high', brightness: 1, fov: 90, fogScale: 1, particles: true },
  audio: { master: 0.8, sfx: 1, ui: 0.8, music: 0.35 },
  mouse: { sens: 1.0, adsMult: 0.7, invert: false },
  pad: { sens: 1.0, deadzone: 0.15, invert: false },
  sight: { shape: 'dot', color: 'red', size: 1 },
  hud: { minimap: true, mapSize: 1, mapRotate: true },
  access: { colorVision: 'none', shapeCues: false, reduceShake: false },
  keys: {
    forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', crouch: 'KeyC', sprint: 'ShiftLeft',
    fire: 'Mouse0', ads: 'Mouse2', reload: 'KeyR', mine: 'KeyF', laser: 'KeyT', knife: 'KeyX', melee: 'KeyV', leanL: 'KeyQ', leanR: 'KeyE',
    next: 'Wheel+', prev: 'Wheel-', call: 'KeyG', score: 'Tab',
  },
};

const KEY = 'neonbreach.settings.v1';
function merge(base, over) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  if (!over || typeof over !== 'object') return out;
  for (const k of Object.keys(base)) {
    if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) out[k] = merge(base[k], over[k]);
    else if (k in over && typeof over[k] === typeof base[k]) out[k] = over[k];
  }
  return out;
}

export const settings = (() => {
  try { return merge(DEFAULTS, JSON.parse(localStorage.getItem(KEY) || 'null')); } catch { return merge(DEFAULTS, null); }
})();

const listeners = new Set();
export function onSettings(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* storage unavailable */ }
  for (const fn of listeners) fn(settings);
}
export function resetSection(section) {
  if (section === 'name') return;
  settings[section] = merge(DEFAULTS[section], null);
  saveSettings();
}

/** Human-readable label for a binding code. */
export function bindLabel(code) {
  if (!code) return '—';
  if (code.startsWith('Mouse')) return ['Left click', 'Middle click', 'Right click', 'Mouse 4', 'Mouse 5'][+code.slice(5)] || code;
  if (code === 'Wheel+') return 'Wheel up'; if (code === 'Wheel-') return 'Wheel down';
  return code.replace(/^Key/, '').replace(/^Digit/, '').replace('Left', ' L').replace('Right', ' R').replace('Space', 'Space').replace('Arrow', '');
}

// ------------------------------------------------------------------ operators (cosmetic skins)
export const OPERATORS = [
  { name: 'Viper', camo: 'camoUrban', hair: [0.1, 0.07, 0.05],   suit: [0.16, 0.18, 0.22], trim: [0.85, 0.2, 0.25], skin: [0.85, 0.66, 0.52], visor: [1, 0.3, 0.3], hat: 'balaclava', hatCol: [0.1, 0.1, 0.12] },
  { name: 'Halo', camo: 'camoDesert', hair: [0.08, 0.06, 0.05],    suit: [0.90, 0.92, 0.95], trim: [0.2, 0.55, 0.95], skin: [0.62, 0.45, 0.34], visor: [0.4, 0.9, 1], hat: 'hardhat',   hatCol: [0.96, 0.76, 0.16] },
  { name: 'Moss', camo: 'camoWood', hair: [0.06, 0.05, 0.04],    suit: [0.20, 0.30, 0.20], trim: [0.7, 0.8, 0.3], skin: [0.45, 0.32, 0.24], visor: [0.8, 1, 0.4], hat: 'helmet',    hatCol: [0.3, 0.38, 0.24] },
  { name: 'Saffron', camo: 'camoDesert', hair: [0.3, 0.2, 0.1], suit: [0.75, 0.55, 0.15], trim: [0.15, 0.12, 0.1], skin: [0.88, 0.7, 0.55], visor: [1, 0.85, 0.3], hat: 'cap',       hatCol: [0.72, 0.22, 0.14] },
  { name: 'Orchid', camo: 'camoMulti', hair: [0.22, 0.12, 0.07],  suit: [0.40, 0.22, 0.55], trim: [0.95, 0.7, 0.95], skin: [0.78, 0.6, 0.48], visor: [0.9, 0.5, 1], hat: 'beanie',    hatCol: [0.9, 0.55, 0.8] },
  { name: 'Slate', camo: 'camoUrban', hair: [0.05, 0.05, 0.05],   suit: [0.35, 0.38, 0.44], trim: [0.95, 0.95, 0.98], skin: [0.36, 0.26, 0.2], visor: [0.7, 0.8, 1], hat: 'headset',   hatCol: [0.12, 0.12, 0.14] },
];

// ------------------------------------------------------------------ team palettes (CSS colour + RGB 0..1)
const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const PALETTES = {
  none:   [{ name: 'CIPHER', css: '#33c9ff', shape: '■' }, { name: 'EMBER', css: '#ff7a29', shape: '▲' }],
  deuter: [{ name: 'CIPHER', css: '#4c8dff', shape: '■' }, { name: 'EMBER', css: '#ffd23f', shape: '▲' }],
  protan: [{ name: 'CIPHER', css: '#4c8dff', shape: '■' }, { name: 'EMBER', css: '#ffd23f', shape: '▲' }],
  tritan: [{ name: 'CIPHER', css: '#16c7a8', shape: '■' }, { name: 'EMBER', css: '#ff4f93', shape: '▲' }],
};
export function teamInfo(t) {
  const p = PALETTES[settings.access.colorVision] || PALETTES.none;
  const e = p[t] || p[0];
  return { name: e.name, css: e.css, rgb: hex(e.css), shape: e.shape };
}
