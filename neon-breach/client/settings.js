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
  gfx: { quality: 'high', brightness: 1, fov: 90, fogScale: 1, particles: true, dynRes: true },
  audio: { master: 0.8, sfx: 1, ui: 0.8, music: 0.35 },
  mouse: { sens: 1.0, adsMult: 0.7, invert: false },
  pad: { sens: 1.0, deadzone: 0.15, invert: false },
  sight: { shape: 'cross', color: 'red', size: 1 },
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
  { name: 'Viper', camo: 'camoUrban', hair: [0.1, 0.07, 0.05],   suit: [0.16, 0.18, 0.22], trim: [0.85, 0.2, 0.25], skin: [0.8, 0.62, 0.5],  visor: [1, 0.3, 0.3],    hat: 'balaclava', hatCol: [0.07, 0.07, 0.08] },   // black-ops assaulter
  { name: 'Halo',  camo: 'camoDesert', hair: [0.08, 0.06, 0.05], suit: [0.62, 0.55, 0.42], trim: [0.2, 0.55, 0.95], skin: [0.58, 0.42, 0.32], visor: [0.4, 0.9, 1],    hat: 'helmet',    hatCol: [0.5, 0.43, 0.32] },    // desert operator, ACH + NVG mount
  { name: 'Moss',  camo: 'camoWood',   hair: [0.06, 0.05, 0.04], suit: [0.20, 0.30, 0.20], trim: [0.7, 0.8, 0.3],  skin: [0.45, 0.32, 0.24], visor: [0.8, 1, 0.4],    hat: 'boonie',    hatCol: [0.28, 0.33, 0.2] },    // jungle recon, boonie hat
  { name: 'Saffron', camo: 'camoDesert', hair: [0.3, 0.2, 0.1],  suit: [0.55, 0.45, 0.28], trim: [0.95, 0.65, 0.2], skin: [0.84, 0.66, 0.52], visor: [1, 0.85, 0.3],   hat: 'cap',       hatCol: [0.36, 0.31, 0.22] },   // contractor, ball cap + shades
  { name: 'Orchid', camo: 'camoMulti', hair: [0.22, 0.12, 0.07], suit: [0.22, 0.24, 0.2],  trim: [0.95, 0.7, 0.95], skin: [0.76, 0.58, 0.46], visor: [0.9, 0.5, 1],    hat: 'beanie',    hatCol: [0.1, 0.12, 0.14] },    // cold-weather commando, watch cap
  { name: 'Slate', camo: 'fabric',     hair: [0.05, 0.05, 0.05], suit: [0.09, 0.1, 0.14],  trim: [0.95, 0.95, 0.98], skin: [0.4, 0.29, 0.22],  visor: [0.7, 0.8, 1],    hat: 'agent',     hatCol: [0.1, 0.1, 0.12] },     // field agent: black suit, tie, shades, earpiece
];

// ------------------------------------------------------------------ team palettes (CSS colour + RGB 0..1)
const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const PALETTES = {
  none:   [{ name: 'CIPHER', css: '#33c9ff', shape: '■' }, { name: 'EMBER', css: '#ff7a29', shape: '▲' }],
  deuter: [{ name: 'CIPHER', css: '#4c8dff', shape: '■' }, { name: 'EMBER', css: '#ffd23f', shape: '▲' }],
  protan: [{ name: 'CIPHER', css: '#4c8dff', shape: '■' }, { name: 'EMBER', css: '#ffd23f', shape: '▲' }],
  tritan: [{ name: 'CIPHER', css: '#16c7a8', shape: '■' }, { name: 'EMBER', css: '#ff4f93', shape: '▲' }],
};
let customTeamNames = ['', ''];
/** Team names chosen by the host in the lobby ('' = default). Called whenever room or match settings arrive. */
export function setTeamNames(a) { customTeamNames = [0, 1].map(i => String((a && a[i]) || '').trim()); }
export function teamInfo(t) {
  const p = PALETTES[settings.access.colorVision] || PALETTES.none;
  const e = p[t] || p[0], custom = customTeamNames[t === 1 ? 1 : 0];
  return { name: custom ? custom.toUpperCase() : e.name, css: e.css, rgb: hex(e.css), shape: e.shape };
}
