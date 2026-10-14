// Client game core: networking, local player simulation, combat, effects, rendering and HUD.
import { createRenderer, MATERIALS } from './gl.js';
import { getMap } from '/shared/maps.js';
import { P, stepBody, newBody, raycast, dirFromAngles } from '/shared/physics.js';
import { WEAPONS, WEAPON_ORDER, CATEGORIES, GADGETS, MODES, PICKUP_COLORS } from '/shared/weapons.js';
import { settings, onSettings, OPERATORS, teamInfo } from './settings.js';
import { input, bindCanvas, beginFrame, endFrame, actionDown, actionPressed, padPressed, mouseDelta, digitPressed, requestLock, releaseLock } from './input.js';
import * as audio from './audio.js';
import { boardHTML, esc } from './board.js';

const $ = (id) => document.getElementById(id);
const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
const now = () => performance.now() / 1000;

const CALL_LIFE = 7;

// ------------------------------------------------------------------ module state
const canvas = $('gl'), hudCanvas = $('hud'), hctx = hudCanvas.getContext('2d');
const miniCanvas = $('minimap'), mctx = miniCanvas.getContext('2d');
let R = null;                                 // renderer
const listeners = {};
let ws = null, wsReady = null, joinWaiter = null, pingMs = 0, fps = 0;

export const game = {
  view: 'menu',                                // menu | lobby | match
  myId: 0, code: '', room: null, roster: new Map(),
  map: null, mapId: '', mode: 'dm', match: null,
  paused: false,
  on(evt, fn) { (listeners[evt] ||= []).push(fn); },
  emit(evt, ...a) { (listeners[evt] || []).forEach(fn => fn(...a)); },
};

const S = {
  players: new Map(),
  body: newBody(), yaw: 0, pitch: 0, lean: 0, leanVis: 0, alive: false, hp: 100, armor: 0, eyeH: P.eye,
  inv: {}, cur: 'pistol', reloadEnd: 0, switchEnd: 0, lastShot: 0, rcAcc: 0, vmKick: 0, flash: 0, adsT: 0,
  mines: 0, lasers: 0, knives: 0, pj: [], pjT: 0, lz: [], mineCd: 0, knifeCd: 0, meleeCd: 0, meleeAt: -9, golden: false, carrying: -1, protectedUntil: 0,
  killer: 0, deadAt: 0, deadMsg: '',
  phase: 'lobby', timeLeft: 0, countdown: 0, teamScore: [0, 0],
  pk: '', pkKinds: [], minesWorld: [], flags: null, tokens: [], goldenW: null, hill: -2,
  tracers: [], sparks: [], booms: [], hitMark: 0, hitKind: '', dmgInd: [], shake: 0, landDip: 0,
  bob: 0, stepDist: 0, wasGrounded: true, vyPrev: 0,
  rain: null, weather: 'clear', lastSend: 0, wantShot: false, time: 0, spotted: new Map(),
  uiPrev: {}, boardAt: 0, endAt: 0, lastTick: 0, lastPhase: '',
  calls: [], wheel: { open: false, x: 0, y: 0, sel: -1, shown: -2 },
};
game.S = S;

// ------------------------------------------------------------------ renderer / canvas sizing
function resizeAll() {
  const q = { high: 1, medium: 0.75, low: 0.5 }[settings.gfx.quality] || 1;
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5) * q;
  const w = window.innerWidth, h = window.innerHeight;
  if (R) R.resize(Math.max(160, Math.floor(w * dpr)), Math.max(120, Math.floor(h * dpr)));
  const hd = Math.min(window.devicePixelRatio || 1, 2);
  hudCanvas.width = Math.floor(w * hd); hudCanvas.height = Math.floor(h * hd);
  hudCanvas.style.width = w + 'px'; hudCanvas.style.height = h + 'px';
  S.hd = hd; S.W = w; S.H = h;
  const ms = Math.round(176 * settings.hud.mapSize);
  miniCanvas.width = ms; miniCanvas.height = ms;
  miniCanvas.style.width = ms + 'px'; miniCanvas.style.height = ms + 'px';
  miniCanvas.style.display = settings.hud.minimap ? '' : 'none';
}

export function initGame() {
  try { R = createRenderer(canvas); } catch (e) { game.emit('fatal', e.message); return false; }
  bindCanvas(canvas); buildWheel();
  window.addEventListener('resize', resizeAll);
  onSettings(() => { resizeAll(); audio.setVolumes(settings.audio); buildMini(); });
  resizeAll();
  setMapById('foundry');
  requestAnimationFrame(frame);
  return true;
}

function setMapById(id) {
  if (game.mapId === id && game.map) return;
  game.mapId = id; game.map = getMap(id);
  R.setMap(game.map); buildMini();
}

// ------------------------------------------------------------------ networking
function connect() {
  if (wsReady) return wsReady;
  wsReady = new Promise((resolve, reject) => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => resolve();
    ws.onerror = () => { wsReady = null; reject(new Error('Could not reach the game server.')); };
    ws.onclose = () => {
      const wasIn = game.view !== 'menu';
      ws = null; wsReady = null;
      if (wasIn) game.emit('disconnect');
    };
    ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } onMessage(m); };
  });
  return wsReady;
}
export function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

/** opts: {create}|{quick}|{room}. Resolves when the server welcomes us. */
export async function join(opts) {
  await connect();
  return new Promise((resolve, reject) => {
    joinWaiter = { resolve, reject };
    send({ t: 'join', name: settings.name, op: settings.op, ...opts });
    setTimeout(() => { if (joinWaiter) { joinWaiter.reject(new Error('The server did not answer.')); joinWaiter = null; } }, 8000);
  });
}
export function leave() {
  send({ t: 'leave' });
  if (ws) { try { ws.close(); } catch { /* ignore */ } }
  ws = null; wsReady = null;
  resetSession();
  game.view = 'menu'; game.emit('view', 'menu');
}
function resetSession() {
  S.players.clear(); game.roster.clear(); game.room = null; game.code = ''; game.myId = 0;
  S.alive = false; S.phase = 'lobby'; S.flags = null; S.tokens = []; S.minesWorld = []; S.pj = []; S.lz = []; S.tracers = []; S.sparks = []; S.booms = [];
  $('h-feed').innerHTML = ''; audio.setRain(false); releaseLock();
}

function onMessage(m) {
  switch (m.t) {
    case 'welcome':
      game.myId = m.id; game.code = m.room;
      if (joinWaiter) { joinWaiter.resolve(m); joinWaiter = null; }
      break;
    case 'err':
      if (joinWaiter) { joinWaiter.reject(new Error(m.msg)); joinWaiter = null; } else game.emit('err', m.msg);
      break;
    case 'room': onRoom(m); break;
    case 'match': onMatch(m); break;
    case 'spawn': onSpawn(m); break;
    case 'tp': S.body.x = m.x; S.body.y = m.y; S.body.z = m.z; S.body.vx = S.body.vy = S.body.vz = 0; break;
    case 's': onSnapshot(m); break;
    case 'end': onEnd(m); break;
    case 'pong': pingMs = Math.round(performance.now() - m.ts); break;
    case 'votes': game.emit('votes', m.c); break;
  }
}

function onRoom(m) {
  game.room = m; game.roster.clear();
  for (const p of m.players) game.roster.set(p.id, p);
  const me = game.roster.get(game.myId);
  if (me) { S.team = me.team; }
  if (m.settings && m.settings.map) { setMapById(m.settings.map); }
  if (m.phase === 'lobby' && game.view !== 'lobby') {
    game.view = 'lobby'; S.alive = false; releaseLock(); game.emit('view', 'lobby');
    audio.setMusic('menu'); audio.setRain(false);
  } else if (game.view === 'menu') { game.view = 'lobby'; game.emit('view', 'lobby'); }
  game.emit('room', m);
}

function onMatch(m) {
  setMapById(m.map);
  game.mode = m.mode; game.match = m.settings; S.weather = m.settings.weather || 'clear';
  S.pkKinds = m.pk || []; S.tracers = []; S.sparks = []; S.booms = []; S.dmgInd = [];
  S.calls = []; closeWheel(false);
  S.flags = null; S.tokens = []; S.teamScore = [0, 0]; S.inv = { pistol: { mag: WEAPONS.pistol.mag, reserve: Infinity } };
  S.cur = 'pistol'; S.spotted.clear();
  $('h-feed').innerHTML = '';
  buildRain();
  game.view = 'match'; game.paused = false; game.emit('view', 'match');
  audio.setMusic('match'); audio.setRain(S.weather === 'rain');
  game.emit('match', m);
}

function onSpawn(m) {
  const b = S.body;
  b.x = m.x; b.y = m.y; b.z = m.z; b.vx = b.vy = b.vz = 0; b.grounded = true; b.crouch = false;
  S.yaw = m.yaw; S.pitch = 0; S.alive = true; S.hp = 100; S.armor = 0; S.mines = m.mines; S.lasers = GADGETS.laser.start; S.knives = GADGETS.knife.start; S.lean = 0; S.leanVis = 0;
  S.inv = { pistol: { mag: WEAPONS.pistol.mag, reserve: Infinity } }; S.cur = 'pistol'; S.reloadEnd = 0; S.switchEnd = now() + 0.35;
  S.rcAcc = 0; S.golden = false; S.carrying = -1; S.eyeH = P.eye; S.killer = 0;
  $('h-dead').classList.add('hidden');
  audio.play('click');
}

function onEnd(m) {
  S.phase = 'ended'; S.endAt = now();
  releaseLock();
  game.emit('end', m);
  const mine = game.roster.get(game.myId);
  let won = false;
  if (m.winner.type === 'team') won = mine && mine.team === m.winner.id;
  else if (m.winner.type === 'player') won = m.winner.id === game.myId;
  audio.play(won ? 'win' : 'lost');
}

// ------------------------------------------------------------------ snapshots + events
function onSnapshot(s) {
  if (s.ph !== S.phase) {
    if (s.ph === 'play' && S.phase === 'countdown') { audio.play('start'); banner('GO', '#fff', 900); }
    S.phase = s.ph;
  }
  S.timeLeft = s.tl; S.countdown = s.cd; S.teamScore = s.ts; S.pk = s.pk;
  S.pj = s.pj || []; S.pjT = now(); S.lz = s.lz || [];
  S.minesWorld = s.m; S.flags = s.f || null; S.hill = s.h == null ? -2 : s.h; S.tokens = s.tk || []; S.goldenW = s.g || null;
  const seen = new Set(), t = now();
  for (const e of s.p) {
    seen.add(e.i);
    let pl = S.players.get(e.i);
    const ro = game.roster.get(e.i) || {};
    if (!pl) { pl = { id: e.i, rx: e.x, ry: e.y, rz: e.z, ra: e.a, rp: e.p, walk: 0, speed: 0, deadAt: 0 }; S.players.set(e.i, pl); }
    const respawned = e.al && !pl.al;
    if (!e.al && pl.al) pl.deadAt = t;
    if (respawned || Math.hypot(e.x - pl.tx, e.z - pl.tz) > 6) { pl.rx = e.x; pl.ry = e.y; pl.rz = e.z; pl.ra = e.a; }
    pl.name = ro.name || pl.name || 'Operator'; pl.bot = !!ro.bot; pl.op = ro.op || 0; pl.team = e.tm;
    pl.tx = e.x; pl.ty = e.y; pl.tz = e.z; pl.ta = e.a; pl.tp = e.p; pl.crouch = !!e.c; pl.lean = e.l;
    pl.hp = e.h; pl.armor = e.r; pl.wpn = e.w; pl.al = !!e.al; pl.ads = !!e.ad; pl.prot = !!e.pr;
    pl.k = e.k; pl.d = e.d; pl.a = e.as; pl.cp = e.cp; pl.rt = e.rt; pl.sc = e.sc; pl.carry = e.cr; pl.gd = !!e.gd;
    if (e.i === game.myId) {
      S.hp = e.h; S.armor = e.r; S.mines = e.mi; S.lasers = e.lm || 0; S.knives = e.kn || 0; S.carrying = e.cr; S.team = e.tm;
      S.protectedUntil = e.pr ? t + 0.2 : 0;
      if (S.golden && !e.gd) { S.golden = false; delete S.inv.golden; if (S.cur === 'golden') selectBest(); }
      if (S.alive && !e.al && S.phase === 'play') { /* death is signalled by the kill event; nothing to do */ }
    }
  }
  for (const id of [...S.players.keys()]) if (!seen.has(id)) S.players.delete(id);
  if (s.ev) for (const ev of s.ev) onEvent(ev);
}

function nameOf(id) { const p = S.players.get(id) || game.roster.get(id); return p ? p.name : 'Unknown'; }
function teamOf(id) { const p = S.players.get(id) || game.roster.get(id); return p ? (p.team != null ? p.team : p.tm) : 0; }
function teamMode() { return !!(game.match && MODES[game.mode] && MODES[game.mode].team); }

function listenerPos() { const b = S.body; return [b.x, b.y + S.eyeH, b.z]; }
function spatial(x, y, z, base = 1) {
  const L = listenerPos(), dx = x - L[0], dz = z - L[2], d = Math.hypot(dx, L[1] - y, dz);
  const pan = clamp((dx * Math.cos(S.yaw) - dz * Math.sin(S.yaw)) / (d + 0.1), -1, 1) * 0.8;
  return { vol: clamp(base / (1 + d * 0.09), 0.03, 1), pan };
}

function onEvent(ev) {
  const t = now();
  switch (ev.e) {
    case 'shot': {
      const o = ev.o; const mine = ev.id === game.myId;
      const shooter = S.players.get(ev.id);
      let muzzle = o;
      if (mine) {
        const b = S.body, r = [Math.cos(S.yaw), 0, -Math.sin(S.yaw)], f = dirFromAngles(S.yaw, S.pitch);
        muzzle = [o[0] + r[0] * 0.22 + f[0] * 0.7, o[1] - 0.18 + f[1] * 0.7, o[2] + r[2] * 0.22 + f[2] * 0.7];
      } else {
        const sp = spatial(o[0], o[1], o[2], 0.9);
        audio.play('gun:' + ev.w, sp);
        if (shooter && !shooter.al) break;
        S.spotted.set(ev.id, t + 2);
      }
      const col = WEAPONS[ev.w] ? hex(WEAPONS[ev.w].color) : [1, 1, 1];
      for (const end of ev.ends) {
        const len = Math.hypot(end[0] - muzzle[0], end[1] - muzzle[1], end[2] - muzzle[2]);
        if (len < 0.5) continue;
        S.tracers.push({ a: muzzle, b: end, t, life: 0.1, col: ev.w === 'sniper' || ev.w === 'golden' ? col : [1, 0.95, 0.7], w: ev.w === 'sniper' ? 0.035 : 0.018 });
        if (len < (WEAPONS[ev.w] ? WEAPONS[ev.w].range - 1 : 100)) spark(end, 5, [1, 0.8, 0.4], 3);
      }
      if (!mine) S.flashRemote = (S.flashRemote || new Map()).set(ev.id, t + 0.06);
      break;
    }
    case 'hit':
      S.hitMark = t; S.hitKind = ev.kill ? 'kill' : ev.hs ? 'head' : 'hit';
      audio.play(ev.kill ? 'kill' : ev.hs ? 'headshot' : 'hit');
      break;
    case 'dmg': {
      const fwd = ev.x * -Math.sin(S.yaw) + ev.z * -Math.cos(S.yaw), rgt = ev.x * Math.cos(S.yaw) + ev.z * -Math.sin(S.yaw);
      S.dmgInd.push({ ang: Math.atan2(rgt, fwd), t });
      S.shake = Math.min(1, S.shake + 0.5); audio.play('hurt');
      break;
    }
    case 'kill': {
      feed(ev);
      if (ev.v === game.myId) {
        S.alive = false; S.deadAt = t; S.killer = ev.a || 0; releaseDeath(ev);
        audio.play('die');
      }
      const v = S.players.get(ev.v);
      if (v) { spark([v.tx, v.ty + 1, v.tz], 14, [0.9, 0.1, 0.15], 4); }
      break;
    }
    case 'boom': {
      const sc = (ev.r || 4.5) / 4.5;
      S.booms.push({ x: ev.x, y: ev.y, z: ev.z, t, life: 0.65, sc });
      spark([ev.x, ev.y, ev.z], Math.round(26 * sc), [1, 0.6, 0.2], 9 * sc);
      const sp = spatial(ev.x, ev.y, ev.z, 1); audio.play('boom', sp);
      if (Math.hypot(ev.x - S.body.x, ev.z - S.body.z) < 12) S.shake = Math.min(1, S.shake + 0.8);
      break;
    }
    case 'melee': {
      const p = S.players.get(ev.id);
      if (ev.id !== game.myId) { if (p) { p.meleeAt = t; audio.play(ev.hit ? 'meleehit' : 'melee', spatial(p.tx, p.ty, p.tz, 0.7)); } }
      else if (ev.hit) audio.play('meleehit', { vol: 0.8 });
      break;
    }
    case 'throw': if (ev.id !== game.myId) audio.play('throw', spatial(ev.o[0], ev.o[1], ev.o[2], 0.6)); break;
    case 'tink': audio.play('tink', spatial(ev.x, ev.y, ev.z, 0.6)); spark([ev.x, ev.y, ev.z], 4, [1, 0.9, 0.6], 3); break;
    case 'mine': if (ev.id !== game.myId) { const p = S.players.get(ev.id); if (p) audio.play('mine', spatial(p.tx, p.ty, p.tz, 0.6)); } break;
    case 'pu': { const pk = game.map.pickups[ev.id]; if (pk && ev.by !== game.myId) audio.play('pickup', spatial(pk.x, pk.y, pk.z, 0.5)); break; }
    case 'pick': onPick(ev); break;
    case 'flag': onFlagEvent(ev); break;
    case 'intel':
      if (ev.by === game.myId) { toast(ev.kind === 'collect' ? 'INTEL SECURED +1' : 'INTEL DENIED', ev.kind === 'collect' ? '#8ef' : '#fc6'); audio.play('flag'); }
      break;
    case 'call': {
      const c = CALLS.find(x => x.k === ev.k); if (!c) break;
      S.calls = S.calls.filter(x => x.id !== ev.id);
      S.calls.push({ id: ev.id, k: ev.k, p: ev.p, t });
      toast(`${ev.id === game.myId ? 'YOU' : nameOf(ev.id).toUpperCase()}: ${c.label.toUpperCase()}`, c.css);
      audio.play('callout');
      break;
    }
    case 'golden':
      banner(ev.by === game.myId ? 'YOU HAVE THE GOLDEN GUN' : nameOf(ev.by).toUpperCase() + ' HAS THE GOLDEN GUN', '#ffd23f', 1800);
      audio.play('flag');
      break;
  }
}

function releaseDeath(ev) {
  const killer = ev.a ? nameOf(ev.a) : null;
  S.deadMsg = killer ? `ELIMINATED BY ${killer.toUpperCase()}` : 'YOU DIED';
  $('h-dead-msg').textContent = S.deadMsg;
  $('h-dead').classList.remove('hidden');
}

function onPick(ev) {
  const T = ev.kind;
  if (T === 'health') toast('+50 HEALTH', '#ff7b8b');
  else if (T === 'armor') toast('+50 ARMOR', '#7fb2ff');
  else if (T === 'mines') toast('PROXIMITY MINES', '#ffa060');
  else if (T === 'laser') toast('LASER MINES +2', '#ff6a8a');
  else if (T === 'knives') toast('THROWING KNIVES +3', '#dfe8f0');
  else if (T === 'ammo') { for (const k of Object.keys(S.inv)) { const w = WEAPONS[k]; if (w.reserve !== Infinity) S.inv[k].reserve = w.reserve; } toast('AMMO', '#ffe66d'); }
  else if (T === 'weapon' || T === 'golden') {
    const id = ev.w, w = WEAPONS[id];
    if (ev.drop) { delete S.inv[ev.drop]; if (S.cur === ev.drop) S.cur = 'pistol'; }
    if (S.inv[id]) S.inv[id].reserve = w.reserve; else S.inv[id] = { mag: w.mag, reserve: w.reserve };
    if (id === 'golden') S.golden = true;
    toast(w.name, w.color);
    if (id === 'golden' || WEAPONS[S.cur].cat === 'side' || w.cat === 'heavy') selectWeapon(id, true);
    audio.play('weapon'); return;
  }
  audio.play('pickup');
}

function onFlagEvent(ev) {
  const mine = S.team, ownFlag = ev.team === mine, who = ev.by ? nameOf(ev.by) : '';
  const youDid = ev.by === game.myId;
  const lines = {
    taken: ownFlag ? [`YOUR FLAG WAS TAKEN BY ${who}`, '#ff6a6a', 'lost'] : [youDid ? 'YOU TOOK THE ENEMY FLAG' : `${who} TOOK THE ENEMY FLAG`, '#7fe0ff', 'flag'],
    dropped: [ownFlag ? 'YOUR FLAG IS DROPPED' : 'ENEMY FLAG DROPPED', '#ffd23f', 'flag'],
    returned: [ownFlag ? 'YOUR FLAG WAS RETURNED' : 'ENEMY FLAG RETURNED', '#9f9', 'flag'],
    captured: [ownFlag ? 'ENEMY CAPTURED YOUR FLAG' : (youDid ? 'YOU CAPTURED THE FLAG' : `${who} CAPTURED THE FLAG`), ownFlag ? '#ff6a6a' : '#7fe0ff', ownFlag ? 'lost' : 'capture'],
  };
  const l = lines[ev.kind]; if (!l) return;
  banner(l[0], l[1], 1800); audio.play(l[2]);
}

// ------------------------------------------------------------------ effects
function spark(p, n, col, speed) {
  if (!settings.gfx.particles) n = Math.ceil(n / 3);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, b = Math.random() * 0.9 + 0.1, s = speed * (0.4 + Math.random());
    S.sparks.push({ x: p[0], y: p[1], z: p[2], vx: Math.cos(a) * b * s, vy: Math.random() * s * 0.8 + 0.5, vz: Math.sin(a) * b * s, t: now(), life: 0.35 + Math.random() * 0.4, col });
  }
  if (S.sparks.length > 500) S.sparks.splice(0, S.sparks.length - 500);
}

function buildRain() {
  S.rain = new Float32Array(500 * 6);
  for (let i = 0; i < 500; i++) {
    const o = i * 6, x = (Math.random() - 0.5) * 40, z = (Math.random() - 0.5) * 40, y = Math.random() * 18;
    S.rain[o] = x; S.rain[o + 1] = y; S.rain[o + 2] = z;
  }
}

function feed(ev) {
  const el = $('h-feed');
  const row = document.createElement('div'); row.className = 'feedrow';
  const tm = teamMode();
  const colorFor = (id) => tm ? teamInfo(teamOf(id)).css : (id === game.myId ? '#ffd23f' : '#e9edf3');
  const wn = ev.w === 'mine' ? 'MINE' : ev.w === 'laser' ? 'LASER MINE' : ev.w === 'melee' ? 'MELEE' : ev.w === 'knife' ? 'KNIFE' : ev.w === 'fall' ? 'FELL' : (WEAPONS[ev.w] ? WEAPONS[ev.w].name : ev.w);
  const a = ev.a ? `<b style="color:${colorFor(ev.a)}">${esc(nameOf(ev.a))}</b>` : '';
  row.innerHTML = `${a}<span class="fw">${esc(wn)}${ev.hs ? ' ✦' : ''}</span><b style="color:${colorFor(ev.v)}">${esc(nameOf(ev.v))}</b>`;
  if (ev.a === game.myId || ev.v === game.myId) row.classList.add('mine');
  el.prepend(row);
  setTimeout(() => row.remove(), 6000);
  while (el.children.length > 6) el.lastChild.remove();
}

let bannerTimer = 0, toastTimer = 0;
export function banner(text, color = '#fff', ms = 1500) {
  const b = $('h-banner'); b.textContent = text; b.style.color = color; b.classList.add('show');
  clearTimeout(bannerTimer); bannerTimer = setTimeout(() => b.classList.remove('show'), ms);
}
function toast(text, color = '#fff') {
  const b = $('h-toast'); b.textContent = text; b.style.color = color; b.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => b.classList.remove('show'), 1400);
}

// ------------------------------------------------------------------ callout wheel
// Hold the callout key, flick the mouse (or right stick) towards an option, release to send it where the crosshair points.
const CALLS = [
  { k: 'attack', label: 'Attack', css: '#ff8a3d' }, { k: 'enemy', label: 'Enemy spotted', css: '#ff4a4a' },
  { k: 'help', label: 'Need help', css: '#ffd23f' }, { k: 'move', label: 'Going here', css: '#7dff9b' },
  { k: 'defend', label: 'Defend', css: '#5db0ff' }, { k: 'ping', label: 'Ping', css: '#ffffff' },
];
const WHEEL_R = 90;
function buildWheel() {
  const el = $('callwheel'); if (!el || el.dataset.built) return; el.dataset.built = '1';
  CALLS.forEach((c, i) => {
    const a = i * Math.PI / 3, b = document.createElement('div');
    b.className = 'sector'; b.dataset.i = i; b.textContent = c.label; b.style.setProperty('--c', c.css);
    b.style.left = `calc(50% + ${Math.sin(a) * 118}px)`; b.style.top = `calc(50% - ${Math.cos(a) * 118}px)`;
    el.appendChild(b);
  });
}
function openWheel() {
  if (!teamMode()) { toast('CALLOUTS ARE FOR TEAM MODES', '#aaa'); return; }
  const w = S.wheel; w.open = true; w.x = w.y = 0; w.sel = -1; w.shown = -2;
  $('callwheel').classList.remove('hidden');
}
function closeWheel(sendIt) {
  const w = S.wheel; if (!w.open) return;
  w.open = false; $('callwheel').classList.add('hidden');
  if (sendIt) sendCall(w.sel >= 0 ? CALLS[w.sel].k : 'ping');
}
function sendCall(k) {
  const o = eyePos(), d = dirFromAngles(S.yaw, S.pitch), h = raycast(game.map.boxes, o, d, 150);
  if (!h) { toast('NO TARGET IN RANGE', '#aaa'); return; }
  const t = h.t - 0.05;
  send({ t: 'call', k, p: [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t] });
}
function updateWheel() {
  const w = S.wheel; if (!w.open) return;
  const [dx, dy] = mouseDelta();
  if (input.usingPad && (input.pad.rx || input.pad.ry)) { w.x = input.pad.rx * WHEEL_R; w.y = input.pad.ry * WHEEL_R; }
  else { w.x += dx * 0.9; w.y += dy * 0.9; const m = Math.hypot(w.x, w.y); if (m > WHEEL_R) { w.x *= WHEEL_R / m; w.y *= WHEEL_R / m; } }
  const mag = Math.hypot(w.x, w.y);
  w.sel = mag < 32 ? -1 : (Math.round(Math.atan2(w.x, -w.y) / (Math.PI / 3)) + 6) % 6;
  if (w.shown !== w.sel) {
    w.shown = w.sel;
    $('callwheel').querySelectorAll('.sector').forEach(el => el.classList.toggle('sel', +el.dataset.i === w.sel));
    $('cw-label').textContent = w.sel >= 0 ? CALLS[w.sel].label : 'Ping';
  }
  $('cw-knob').style.transform = `translate(${w.x * 0.5}px, ${w.y * 0.5}px)`;
}

// ------------------------------------------------------------------ weapons
function owned() { return WEAPON_ORDER.filter(w => S.inv[w]); }
function selectWeapon(id, silent) {
  if (!S.inv[id] || id === S.cur && !silent) return;
  S.cur = id; S.reloadEnd = 0; S.switchEnd = now() + 0.3; S.vmKick = 0.5;
  if (!silent) audio.play('click');
}
function digitSwitch(dig) {
  const cat = CATEGORIES[dig - 1]; if (!cat) return;
  const list = WEAPON_ORDER.filter(w => S.inv[w] && WEAPONS[w].cat === cat);
  if (!list.length) return;
  selectWeapon(list[(list.indexOf(S.cur) + 1) % list.length]);
}
function selectBest() { const o = owned(); selectWeapon(o[o.length - 1] || 'pistol', true); }
function cycleWeapon(dir) {
  const o = owned(); if (o.length < 2) return;
  const i = o.indexOf(S.cur); selectWeapon(o[(i + dir + o.length) % o.length]);
}
function startReload() {
  const w = WEAPONS[S.cur], inv = S.inv[S.cur];
  if (!inv || S.reloadEnd || inv.mag >= w.mag || inv.reserve <= 0) return;
  S.reloadEnd = now() + w.reload; audio.play('reload');
}
function finishReload() {
  const w = WEAPONS[S.cur], inv = S.inv[S.cur];
  if (inv) { const take = Math.min(w.mag - inv.mag, inv.reserve); inv.mag += take; if (inv.reserve !== Infinity) inv.reserve -= take; }
  S.reloadEnd = 0;
}

function eyePos() {
  const b = S.body;
  let ox = 0, oz = 0;
  if (Math.abs(S.leanVis) > 0.01) {
    const rx = Math.cos(S.yaw), rz = -Math.sin(S.yaw), want = S.leanVis * 0.42;
    const eye = [b.x, b.y + S.eyeH, b.z];
    const h = raycast(game.map.boxes, eye, [Math.sign(want) * rx, 0, Math.sign(want) * rz], Math.abs(want) + 0.25);
    const use = h ? Math.max(0, h.t - 0.25) * Math.sign(want) : want;
    ox = rx * use; oz = rz * use;
  }
  return [b.x + ox, b.y + S.eyeH, b.z + oz];
}

function tryFire(t, pressed, held) {
  const w = WEAPONS[S.cur], inv = S.inv[S.cur];
  if (!inv || S.phase !== 'play' || t < S.switchEnd) return;
  const want = w.auto ? held : pressed;
  if (!want) return;
  if (S.reloadEnd) return;
  if (inv.mag <= 0) { if (pressed) audio.play('empty'); startReload(); return; }
  if (t - S.lastShot < 1 / w.rate) return;
  S.lastShot = t; inv.mag--;
  const ads = actionDown('ads');
  const o = eyePos(), d = dirFromAngles(S.yaw, S.pitch);
  send({ t: 'fire', w: S.cur, o, d, ad: ads });
  audio.play('gun:' + S.cur, { vol: 0.8 });
  const kick = w.recoil * (ads ? 0.6 : 1) * (0.85 + Math.random() * 0.3);
  S.pitch = Math.min(1.5, S.pitch + kick); S.rcAcc += kick; S.yaw += (Math.random() - 0.5) * kick * 0.6;
  S.vmKick = Math.min(1, S.vmKick + 0.5 + w.recoil * 10); S.flash = t + 0.05;
  if (!settings.access.reduceShake) S.shake = Math.min(1, S.shake + w.recoil * 6);
  if (inv.mag <= 0 && inv.reserve > 0) setTimeout(() => { if (S.alive) startReload(); }, 150);
}

function placeMine(t) {
  if (!S.alive || S.phase !== 'play' || S.mines <= 0 || t < S.mineCd) return;
  const o = eyePos(), d = dirFromAngles(S.yaw, S.pitch);
  const h = raycast(game.map.boxes, o, d, 4.5);
  if (!h) { toast('NO SURFACE IN RANGE', '#aaa'); S.mineCd = t + 0.4; return; }
  const tt = Math.max(0.1, h.t - 0.03);
  send({ t: 'mine', p: [o[0] + d[0] * tt, o[1] + d[1] * tt, o[2] + d[2] * tt], n: h.n });
  S.mineCd = t + 0.6; audio.play('mine');
}

function placeLaser(t) {
  if (!S.alive || S.phase !== 'play' || t < S.mineCd) return;
  if (S.lasers <= 0) { toast('NO LASER MINES', '#aaa'); S.mineCd = t + 0.4; return; }
  const o = eyePos(), d = dirFromAngles(S.yaw, S.pitch);
  const h = raycast(game.map.boxes, o, d, 4.5);
  if (!h) { toast('NO SURFACE IN RANGE', '#aaa'); S.mineCd = t + 0.4; return; }
  const tt = Math.max(0.1, h.t - 0.03);
  send({ t: 'laser', p: [o[0] + d[0] * tt, o[1] + d[1] * tt, o[2] + d[2] * tt], n: h.n });
  S.mineCd = t + 0.6; audio.play('laser');
}
function throwKnife(t) {
  if (!S.alive || S.phase !== 'play' || S.knives <= 0 || t < S.knifeCd) return;
  S.knifeCd = t + GADGETS.knife.cooldown + 0.05;
  send({ t: 'throw', o: eyePos(), d: dirFromAngles(S.yaw, S.pitch) });
  S.meleeAt = t - 0.1; audio.play('throw', { vol: 0.8 });
}
function doMelee(t) {
  if (!S.alive || S.phase !== 'play' || t < S.meleeCd) return;
  S.meleeCd = t + GADGETS.melee.cooldown; S.meleeAt = t;
  send({ t: 'melee' }); audio.play('melee');
}

// ------------------------------------------------------------------ per-frame local update
function controlling() { return game.view === 'match' && (input.locked || (input.usingPad && input.pad.connected && !game.paused)); }

function updateLocal(dt, t) {
  const b = S.body;
  const wDef = WEAPONS[S.cur] || WEAPONS.pistol;
  const ctl = controlling();

  // mouse / stick look, scaled by zoom so ADS aiming feels consistent
  const ads = ctl && S.alive && actionDown('ads') && !S.reloadEnd;
  S.adsT = lerp(S.adsT, ads ? 1 : 0, 1 - Math.exp(-dt * 14));
  const zoom = lerp(1, wDef.zoom, S.adsT);
  if (ctl && S.alive && actionPressed('call')) openWheel();
  if (S.wheel.open && !(ctl && S.alive && actionDown('call'))) closeWheel(S.alive && ctl);
  updateWheel();
  if (ctl && S.alive && !S.wheel.open) {
    const [dx, dy] = mouseDelta();
    const sens = 0.0022 * settings.mouse.sens * (ads ? settings.mouse.adsMult : 1) / zoom;
    S.yaw -= dx * sens; S.pitch -= dy * sens * (settings.mouse.invert ? -1 : 1);
    const ps = 2.9 * settings.pad.sens * dt / zoom;
    S.yaw -= input.pad.rx * Math.abs(input.pad.rx) * ps * (1.2);
    S.pitch -= input.pad.ry * Math.abs(input.pad.ry) * ps * 0.8 * (settings.pad.invert ? -1 : 1);
    S.pitch = clamp(S.pitch, -1.5, 1.5);
    // recoil recovery
    const rec = Math.min(S.rcAcc, S.rcAcc * dt * 5 + dt * 0.02); S.pitch -= rec; S.rcAcc -= rec;
  }
  if (S.yaw > Math.PI) S.yaw -= Math.PI * 2; else if (S.yaw < -Math.PI) S.yaw += Math.PI * 2;

  // movement
  if (S.alive && S.phase !== 'ended') {
    let f = 0, r = 0, jump = false, crouch = false;
    if (ctl) {
      f = (actionDown('forward') ? 1 : 0) - (actionDown('back') ? 1 : 0) - input.pad.ly;
      r = (actionDown('right') ? 1 : 0) - (actionDown('left') ? 1 : 0) + input.pad.lx;
      jump = actionDown('jump'); crouch = actionDown('crouch');
    }
    const wasG = b.grounded, vy0 = b.vy;
    stepBody(game.map.boxes, b, { f: clamp(f, -1, 1), r: clamp(r, -1, 1), yaw: S.yaw, jump, crouch, ads }, dt);
    if (!wasG && b.grounded && vy0 < -5) { audio.play('land', { vol: clamp(-vy0 / 14, 0.2, 1) }); S.landDip = clamp(-vy0 / 40, 0.05, 0.25); }
    if (wasG && !b.grounded && b.vy > 3) audio.play('jump');
    const sp = Math.hypot(b.vx, b.vz);
    if (b.grounded && sp > 1) { S.stepDist += sp * dt; if (S.stepDist > (b.crouch ? 2.6 : 2.0)) { S.stepDist = 0; audio.play('step', { vol: b.crouch ? 0.3 : 1 }); } S.bob += sp * dt * 1.7; }
    const leanT = ctl ? (actionDown('leanR') ? 1 : 0) - (actionDown('leanL') ? 1 : 0) : 0;
    S.lean = leanT; S.leanVis = lerp(S.leanVis, S.lean, 1 - Math.exp(-dt * 14));
    S.eyeH = lerp(S.eyeH, b.crouch ? P.eyec : P.eye, 1 - Math.exp(-dt * 16));

    // weapons
    if (ctl) {
      const dig = digitPressed(); if (dig) digitSwitch(dig);
      if (actionPressed('next')) cycleWeapon(1);
      if (actionPressed('prev')) cycleWeapon(-1);
      if (actionPressed('reload')) startReload();
      if (actionPressed('mine')) placeMine(t);
      if (actionPressed('laser')) placeLaser(t);
      if (actionPressed('knife')) throwKnife(t);
      if (actionPressed('melee')) doMelee(t);
      if (!S.wheel.open) tryFire(t, actionPressed('fire'), actionDown('fire'));
    }
    if (S.reloadEnd && t >= S.reloadEnd) finishReload();
    if (S.cur === 'golden' && !S.golden) selectBest();
  }
  S.vmKick = Math.max(0, S.vmKick - dt * 7);
  S.shake = Math.max(0, S.shake - dt * 2.5);
  S.landDip = Math.max(0, S.landDip - dt * 0.6);

  // send state to the server at 30 Hz
  if (S.alive && game.view === 'match' && t - S.lastSend > 1 / 30) {
    S.lastSend = t;
    send({ t: 'in', x: round2(b.x), y: round2(b.y), z: round2(b.z), a: round2(S.yaw), p: round2(S.pitch), c: b.crouch ? 1 : 0, l: round2(S.leanVis), ad: ads ? 1 : 0, w: S.cur });
  }
}
const round2 = (v) => Math.round(v * 100) / 100;

function updateRemotes(dt, t) {
  const k = 1 - Math.exp(-dt * 18);
  for (const p of S.players.values()) {
    if (p.id === game.myId) continue;
    const ox = p.rx, oz = p.rz;
    p.rx = lerp(p.rx, p.tx, k); p.ry = lerp(p.ry, p.ty, k); p.rz = lerp(p.rz, p.tz, k);
    p.ra += angDiff(p.ra, p.ta) * k; p.rp = lerp(p.rp, p.tp, k);
    const sp = Math.hypot(p.rx - ox, p.rz - oz) / Math.max(dt, 0.001);
    p.speed = lerp(p.speed, sp, 1 - Math.exp(-dt * 8)); p.walk += p.speed * dt * 1.6;
  }
}

// ------------------------------------------------------------------ camera
function computeCamera(dt, t) {
  const aspect = canvas.width / canvas.height;
  const baseH = settings.gfx.fov * Math.PI / 180;
  const baseV = 2 * Math.atan(Math.tan(baseH / 2) / aspect);
  const wDef = WEAPONS[S.cur] || WEAPONS.pistol;
  const zoom = lerp(1, wDef.zoom, S.adsT);
  let fov = 2 * Math.atan(Math.tan(baseV / 2) / zoom);
  const b = S.body;
  if (game.view !== 'match') {
    // slow orbit around the map for the menu / lobby backdrop
    const a = t * 0.08, r = 40;
    return { x: Math.sin(a) * r, y: 22, z: Math.cos(a) * r, yaw: a, pitch: -0.42, roll: 0, fov: baseV, orbit: true };
  }
  if (!S.alive) {
    const kp = S.killer && S.players.get(S.killer);
    if (kp && kp.al && t - S.deadAt > 0.5) {
      return { x: kp.rx, y: kp.ry + (kp.crouch ? P.eyec : P.eye), z: kp.rz, yaw: kp.ra, pitch: kp.rp, roll: 0, fov, killcam: kp.id };
    }
    const fall = Math.min(1, (t - S.deadAt) * 3);
    return { x: b.x, y: b.y + lerp(S.eyeH, 0.35, fall), z: b.z, yaw: S.yaw, pitch: lerp(S.pitch, -0.2, fall), roll: 0.5 * fall, fov };
  }
  const e = eyePos();
  let bobY = 0, bobX = 0;
  if (!settings.access.reduceShake && b.grounded) { const sp = Math.min(1, Math.hypot(b.vx, b.vz) / 6.4); bobY = Math.sin(S.bob * 2) * 0.025 * sp; bobX = Math.cos(S.bob) * 0.012 * sp; }
  const sh = settings.access.reduceShake ? 0 : S.shake;
  const jx = (Math.random() - 0.5) * 0.02 * sh, jy = (Math.random() - 0.5) * 0.02 * sh;
  return { x: e[0] + Math.cos(S.yaw) * bobX, y: e[1] + bobY - S.landDip, z: e[2] - Math.sin(S.yaw) * bobX, yaw: S.yaw + jx, pitch: S.pitch + jy, roll: S.leanVis * 0.13, fov };
}

// ------------------------------------------------------------------ rendering
const VIEWMODELS = {
  pistol:  [[0, 0.02, -0.12, 0.05, 0.065, 0.3, 'm'], [0, -0.06, 0.0, 0.042, 0.1, 0.06, 'd'], [0, 0.058, -0.24, 0.012, 0.02, 0.012, 'a']],
  smg:     [[0, 0, -0.16, 0.06, 0.09, 0.42, 'm'], [0, -0.1, -0.08, 0.04, 0.13, 0.06, 'a'], [0, -0.07, 0.04, 0.045, 0.1, 0.06, 'd'], [0, 0.01, -0.42, 0.028, 0.028, 0.16, 'd']],
  rifle:   [[0, 0, -0.2, 0.06, 0.09, 0.56, 'm'], [0, -0.01, 0.22, 0.05, 0.09, 0.2, 'd'], [0, -0.1, -0.13, 0.045, 0.14, 0.07, 'a'], [0, 0.01, -0.58, 0.028, 0.028, 0.26, 'd'], [0, 0.07, -0.16, 0.02, 0.04, 0.22, 'd']],
  shotgun: [[0, 0, -0.2, 0.06, 0.07, 0.62, 'm'], [0, -0.05, -0.32, 0.07, 0.05, 0.2, 'a'], [0, 0.04, -0.5, 0.036, 0.036, 0.42, 'd'], [0, -0.01, 0.2, 0.05, 0.09, 0.22, 'd']],
  sniper:  [[0, 0, -0.26, 0.055, 0.08, 0.74, 'm'], [0, 0.085, -0.2, 0.05, 0.05, 0.32, 'a'], [0, 0.01, -0.82, 0.026, 0.026, 0.42, 'd'], [0, -0.01, 0.24, 0.05, 0.09, 0.22, 'd']],
  revolver:[[0, 0.02, -0.12, 0.05, 0.07, 0.26, 'm'], [0, 0.035, -0.32, 0.03, 0.04, 0.2, 'd'], [0, 0.02, -0.1, 0.065, 0.075, 0.09, 'a'], [0, -0.07, 0.02, 0.042, 0.11, 0.06, 'd']],
  deagle:  [[0, 0.025, -0.16, 0.06, 0.07, 0.38, 'm'], [0, 0.02, -0.4, 0.04, 0.045, 0.1, 'd'], [0, 0.065, -0.16, 0.02, 0.015, 0.3, 'a'], [0, -0.07, 0.02, 0.05, 0.12, 0.07, 'd']],
  mp5:     [[0, 0, -0.18, 0.06, 0.09, 0.46, 'm'], [0, -0.11, -0.1, 0.04, 0.15, 0.05, 'a'], [0, -0.07, 0.04, 0.045, 0.1, 0.06, 'd'], [0, 0.01, -0.46, 0.035, 0.035, 0.2, 'd'], [0, 0, 0.2, 0.04, 0.07, 0.2, 'd']],
  p90:     [[0, 0.01, -0.15, 0.07, 0.11, 0.52, 'm'], [0, 0.075, -0.15, 0.035, 0.025, 0.3, 'a'], [0, -0.08, -0.02, 0.04, 0.1, 0.06, 'd'], [0, 0.01, -0.44, 0.03, 0.03, 0.1, 'd']],
  aug:     [[0, 0, -0.12, 0.065, 0.1, 0.55, 'm'], [0, 0.09, -0.14, 0.04, 0.05, 0.2, 'a'], [0, -0.1, -0.02, 0.04, 0.12, 0.05, 'a'], [0, 0.01, -0.5, 0.03, 0.03, 0.22, 'd'], [0, -0.08, -0.22, 0.04, 0.1, 0.05, 'd']],
  m4:      [[0, 0, -0.2, 0.06, 0.09, 0.5, 'm'], [0, -0.01, 0.22, 0.05, 0.08, 0.22, 'd'], [0, -0.1, -0.14, 0.04, 0.14, 0.07, 'a'], [0, 0.01, -0.55, 0.026, 0.026, 0.24, 'd'], [0, 0.075, -0.1, 0.018, 0.04, 0.12, 'd']],
  mossberg:[[0, 0.02, -0.42, 0.04, 0.04, 0.7, 'd'], [0, -0.02, -0.36, 0.035, 0.035, 0.5, 'm'], [0, -0.045, -0.4, 0.06, 0.05, 0.18, 'a'], [0, 0, -0.1, 0.06, 0.08, 0.25, 'm'], [0, -0.01, 0.2, 0.05, 0.09, 0.22, 'd']],
  spas:    [[0, 0.015, -0.22, 0.055, 0.07, 0.55, 'm'], [0, 0.04, -0.52, 0.034, 0.034, 0.4, 'd'], [0, 0.075, -0.3, 0.04, 0.02, 0.3, 'a'], [0, 0, 0.2, 0.03, 0.08, 0.2, 'd'], [0, -0.06, 0.2, 0.03, 0.03, 0.2, 'd']],
  launcher:[[0, 0.02, -0.3, 0.085, 0.085, 0.85, 'd'], [0, 0.02, -0.78, 0.065, 0.065, 0.14, 'a'], [0, 0.085, -0.18, 0.02, 0.05, 0.1, 'm'], [0, -0.07, -0.08, 0.045, 0.1, 0.06, 'm'], [0, 0.02, 0.15, 0.11, 0.11, 0.08, 'm']],
  golden:  [[0, 0.02, -0.14, 0.055, 0.07, 0.34, 'g'], [0, -0.06, 0.0, 0.045, 0.1, 0.06, 'g'], [0, 0.065, -0.28, 0.014, 0.024, 0.014, 'g']],
};
const COL = { m: [0.18, 0.19, 0.22], d: [0.09, 0.09, 0.1], g: [1.0, 0.8, 0.22] };

function drawViewmodel(t, cam) {
  if (!S.alive || game.view !== 'match') return;
  const id = S.cur, w = WEAPONS[id], parts = VIEWMODELS[id]; if (!parts) return;
  if (id === 'sniper' && S.adsT > 0.7) return;                     // scope overlay replaces the model
  const b = S.body, sp = Math.min(1, Math.hypot(b.vx, b.vz) / 6.4) * (b.grounded ? 1 : 0.3);
  const bob = settings.access.reduceShake ? 0 : 1;
  const a = S.adsT;
  let x = lerp(0.19, 0, a), y = lerp(-0.2, -0.105, a), z = lerp(-0.38, -0.3, a);
  x += Math.cos(S.bob) * 0.012 * sp * bob; y += Math.abs(Math.sin(S.bob)) * 0.014 * sp * bob;
  z += S.vmKick * 0.07; y += S.vmKick * 0.012;
  let tilt = S.vmKick * 0.12, roll = 0;
  const tt = now();
  if (S.reloadEnd) { const prog = 1 - (S.reloadEnd - tt) / w.reload, dip = Math.sin(clamp(prog, 0, 1) * Math.PI); y -= dip * 0.14; tilt -= dip * 0.5; x += dip * 0.04; }
  if (tt < S.switchEnd) { const p = (S.switchEnd - tt) / 0.3; y -= p * 0.18; tilt -= p * 0.4; }
  const cp = Math.cos(tilt), sp2 = Math.sin(tilt);
  R.beginViewmodel(Math.max(0.6, cam.fov * 0.62 + 0.1));
  const accent = hex(w.color), skin = OPERATORS[settings.op % OPERATORS.length].skin;
  for (const p of parts) {
    // rotate the part offset about the weapon pivot by `tilt` around X
    const py = p[1] * cp - p[2] * sp2, pz = p[1] * sp2 + p[2] * cp;
    const col = p[6] === 'a' ? accent : COL[p[6]] || COL.m;
    R.box(x + p[0], y + py, z + pz, p[3], p[4], p[5], 0, tilt, col, id === 'golden' ? 0.35 : 0, 1);
  }
  const mp = (tt - S.meleeAt) / 0.35;
  if (mp >= 0 && mp < 1) {                                          // knife slash (also used for the throw)
    const sw = Math.sin(mp * Math.PI);
    R.box(lerp(0.34, -0.2, mp), -0.12 + sw * 0.1, -0.42 - sw * 0.1, 0.025, 0.04, 0.34, lerp(-0.9, 0.9, mp), -0.2, [0.85, 0.9, 0.95], 0.3, 1);
    R.box(lerp(0.34, -0.2, mp) + 0.03, -0.13 + sw * 0.1, -0.22 - sw * 0.1, 0.045, 0.05, 0.12, lerp(-0.9, 0.9, mp), -0.2, [0.12, 0.12, 0.14], 0, 1);
  }
  // hands
  R.box(x + 0.0, y - 0.08 * cp, z + 0.04 + 0.08 * sp2, 0.07, 0.07, 0.1, 0, tilt, skin, 0, 1);
  R.box(x - 0.02, y - 0.03 + (-0.02) * cp, z - 0.3, 0.07, 0.06, 0.1, 0, tilt, skin, 0, 1);
  if (t < S.flash) { R.transparent(true); const mz = -0.55 - (id === 'sniper' ? 0.5 : id === 'rifle' ? 0.12 : 0); R.box(x, y + 0.015, z + mz, 0.07, 0.07, 0.12, 0, 0, [1, 0.85, 0.4], 1, 0.9); R.transparent(false); }
  R.endViewmodel();
}

function playerPalette(pl) {
  const op = OPERATORS[(pl.op || 0) % OPERATORS.length];
  return op;
}

const GLEN = { sniper: 0.85, rifle: 0.7, m4: 0.7, aug: 0.58, shotgun: 0.65, mossberg: 0.7, spas: 0.62, launcher: 0.95, pistol: 0.3, revolver: 0.32, deagle: 0.38, p90: 0.5, mp5: 0.48, smg: 0.45 };

function drawPlayer(pl, t, cam) {
  const op = playerPalette(pl), tm = teamMode(), ti = teamInfo(pl.team);
  const tc = tm ? ti.rgb : op.trim;
  if (!pl.al) {
    if (t - pl.deadAt < 4) {                                       // body on the floor
      const a = pl.ra || 0;
      R.box(pl.rx, pl.ry + 0.14, pl.rz, 0.5, 0.26, 1.2, a, 0, op.suit, 0, 1);
      R.box(pl.rx - Math.sin(a) * 0.75, pl.ry + 0.16, pl.rz - Math.cos(a) * 0.75, 0.26, 0.26, 0.26, a, 0, op.skin, 0, 1);
    }
    return;
  }
  const ch = pl.crouch ? 0.64 : 1;
  const cy = Math.cos(pl.ra), sy = Math.sin(pl.ra);
  const wp = (lx, ly, lz) => [pl.rx + cy * lx + sy * lz, pl.ry + ly, pl.rz - sy * lx + cy * lz];
  const lean = (pl.lean || 0) * 0.32 * (pl.crouch ? 0.8 : 1);
  const swing = Math.sin(pl.walk * 3) * Math.min(1, pl.speed / 4) * 0.7;
  const part = (lx, ly, lz, sx, sy_, sz, col, pitch = 0, emit = 0, alpha = 1) => { const p = wp(lx, ly, lz); R.box(p[0], p[1], p[2], sx, sy_, sz, pl.ra, pitch, col, emit, alpha); };
  const flash = (S.flashRemote && S.flashRemote.get(pl.id)) > t;
  // legs
  part(-0.13, 0.43 * ch, -swing * 0.12, 0.2, 0.86 * ch, 0.24, op.suit, swing * 0.6);
  part(0.13, 0.43 * ch, swing * 0.12, 0.2, 0.86 * ch, 0.24, op.suit, -swing * 0.6);
  // torso + trim
  part(lean, 1.16 * ch, 0, 0.5, 0.6 * ch, 0.28, op.suit);
  part(lean, 1.3 * ch, -0.145, 0.34, 0.08, 0.02, op.trim, 0, 0.3);
  // team armband (emissive so it reads at distance)
  part(lean - 0.31, 1.32 * ch, 0, 0.1, 0.13, 0.2, tc, 0, 0.9);
  // head + visor
  part(lean * 1.4, 1.6 * ch, 0, 0.26, 0.27, 0.26, op.skin, pl.rp);
  part(lean * 1.4, 1.62 * ch, -0.135, 0.22, 0.07, 0.04, op.visor, pl.rp, 0.9);
  // arms and weapon, pitched with the aim
  const w = WEAPONS[pl.wpn] || WEAPONS.pistol, gl = hex(w.color);
  const ay = 1.22 * ch + pl.rp * 0.12;
  part(lean + 0.3, ay, -0.2, 0.13, 0.13, 0.46, op.suit, pl.rp);
  part(lean - 0.2, ay - 0.02, -0.3, 0.13, 0.13, 0.42, op.suit, pl.rp);
  const glen = GLEN[pl.wpn] || 0.5;
  part(lean + 0.27, ay + 0.02, -0.28 - glen * 0.35, 0.07, 0.1, glen, pl.wpn === 'golden' ? [1, 0.8, 0.2] : [0.14, 0.15, 0.17], pl.rp, pl.wpn === 'golden' ? 0.4 : 0);
  part(lean + 0.27, ay + 0.07, -0.28 - glen * 0.35, 0.03, 0.04, glen * 0.8, gl, pl.rp, 0.2);
  if (flash) { const p = wp(lean + 0.27, ay + 0.03, -0.3 - glen); R.box(p[0], p[1], p[2], 0.14, 0.14, 0.14, pl.ra, 0, [1, 0.85, 0.4], 1, 1); }
  if (t - (pl.meleeAt || -9) < 0.3) { const k = (t - pl.meleeAt) / 0.3; part(lean + 0.45 - k * 0.6, ay, -0.55 - Math.sin(k * Math.PI) * 0.2, 0.04, 0.05, 0.4, [0.85, 0.9, 0.95], pl.rp, 0.3); }
  if (pl.carry >= 0) { const f = teamInfo(pl.carry).rgb; part(0, 1.35 * ch, 0.2, 0.05, 0.9, 0.05, [0.8, 0.8, 0.8]); part(0.0, 1.7 * ch, 0.2, 0.02, 0.28, 0.4, f, 0, 0.9); }
  if (pl.gd) part(0, 2.05, 0, 0.18, 0.18, 0.18, [1, 0.8, 0.2], t * 3, 1);
}

function beam(x, y, z, h, col, a = 0.22, wd = 0.35) { R.box(x, y + h / 2, z, wd, h, wd, 0, 0, col, 1, a); }

function drawWorldObjects(t, cam) {
  const mp = game.map; if (!mp || game.view !== 'match') return;
  const spin = t * 1.6;
  // pickups
  mp.pickups.forEach((p, i) => {
    if (S.pk[i] !== '1') return;
    const kind = S.pkKinds[i], col = hex(PICKUP_COLORS[kind] || '#fff'), y = p.y + 0.85 + Math.sin(t * 2 + i) * 0.09;
    if (WEAPONS[kind]) { R.box(p.x, y, p.z, 0.2, 0.2, 0.9, spin, 0, col, 0.55, 1); R.box(p.x, y, p.z, 0.2, 0.5, 0.2, spin, 0, [0.15, 0.15, 0.18], 0.1, 1); }
    else if (kind === 'health') { R.box(p.x, y, p.z, 0.5, 0.15, 0.5, spin, 0, [0.95, 0.95, 0.95], 0.5, 1); R.box(p.x, y, p.z, 0.4, 0.2, 0.12, spin, 0, col, 0.8, 1); R.box(p.x, y, p.z, 0.12, 0.2, 0.4, spin, 0, col, 0.8, 1); }
    else if (kind === 'armor') { R.box(p.x, y, p.z, 0.5, 0.55, 0.14, spin, 0, col, 0.6, 1); }
    else if (kind === 'ammo') { R.box(p.x, y, p.z, 0.42, 0.28, 0.3, spin, 0.3, col, 0.55, 1); }
    else if (kind === 'laser') { R.box(p.x, y, p.z, 0.4, 0.14, 0.2, spin, 0, [0.2, 0.2, 0.24], 0.1, 1); R.box(p.x, y + 0.02, p.z, 0.08, 0.08, 0.3, spin, 0, col, 1, 1); }
    else if (kind === 'knives') { for (let k = -1; k <= 1; k++) R.box(p.x + Math.cos(spin) * k * 0.12, y, p.z - Math.sin(spin) * k * 0.12, 0.03, 0.05, 0.4, spin, 0, [0.85, 0.9, 0.95], 0.35, 1); }
    else if (kind === 'mines') { R.box(p.x, y, p.z, 0.45, 0.1, 0.45, spin, 0, col, 0.7, 1); R.box(p.x, y + 0.08, p.z, 0.15, 0.08, 0.15, spin, 0, [1, 0.3, 0.2], 1, 1); }
    R.box(p.x, p.y + 0.03, p.z, 0.8, 0.04, 0.8, spin * 0.5, 0, col, 1, 1);
  });
  // proximity mines
  for (const m of S.minesWorld) {
    const own = teamMode() ? m[7] === S.team : m[8] === game.myId;
    const armed = m[9] === 1, blink = armed ? (Math.sin(t * 9) > 0 ? 1 : 0.25) : 0.15;
    const col = own || !teamMode() && m[8] === game.myId ? [0.2, 1, 0.5] : [1, 0.25, 0.2];
    const nx = m[4], ny = m[5], nz = m[6];
    const px = m[1] + nx * 0.05, py = m[2] + ny * 0.05, pz = m[3] + nz * 0.05;
    R.box(px, py, pz, Math.abs(nx) > 0.5 ? 0.1 : 0.3, Math.abs(ny) > 0.5 ? 0.1 : 0.3, Math.abs(nz) > 0.5 ? 0.1 : 0.3, 0, 0, [0.2, 0.21, 0.24], 0, 1);
    R.box(px + nx * 0.06, py + ny * 0.06, pz + nz * 0.06, 0.07, 0.07, 0.07, 0, 0, col, blink, 1);
  }
  // rockets + thrown knives (extrapolated between snapshots)
  const dtp = Math.min(0.12, t - S.pjT);
  for (const q of S.pj) {
    const knife = q[1] === 1, vx = q[5], vy = q[6], vz = q[7], sp = Math.hypot(vx, vy, vz) || 1;
    const px = q[2] + vx * dtp, py = q[3] + vy * dtp - (knife ? 0.5 * GADGETS.knife.gravity * dtp * dtp : 0), pz = q[4] + vz * dtp;
    const yaw = Math.atan2(-vx, -vz), pitch = Math.asin(clamp(vy / sp, -1, 1)), dx = vx / sp, dy = vy / sp, dz = vz / sp;
    if (knife) { R.box(px, py, pz, 0.05, 0.05, 0.36, yaw, pitch, [0.88, 0.92, 0.96], 0.4, 1); R.box(px - dx * 0.25, py - dy * 0.25, pz - dz * 0.25, 0.07, 0.07, 0.14, yaw, pitch, [0.12, 0.12, 0.14], 0, 1); }
    else {
      R.box(px, py, pz, 0.16, 0.16, 0.7, yaw, pitch, [0.35, 0.38, 0.3], 0.1, 1);
      R.box(px + dx * 0.4, py + dy * 0.4, pz + dz * 0.4, 0.12, 0.12, 0.16, yaw, pitch, [1, 0.35, 0.2], 0.6, 1);
      R.box(px - dx * 0.5, py - dy * 0.5, pz - dz * 0.5, 0.22, 0.22, 0.3, yaw, pitch, [1, 0.8, 0.3], 1, 1);
      if (Math.random() < 0.8) spark([px - dx * 0.6, py - dy * 0.6, pz - dz * 0.6], 1, [1, 0.6, 0.25], 1.5);
    }
  }
  // laser mine emitters
  for (const L of S.lz) {
    const own = teamMode() ? L[8] === S.team : L[9] === game.myId, armed = L[10] === 1;
    const nx = L[4], ny = L[5], nz = L[6];
    R.box(L[1] - nx * 0.03, L[2] - ny * 0.03, L[3] - nz * 0.03, Math.abs(nx) > 0.5 ? 0.1 : 0.28, Math.abs(ny) > 0.5 ? 0.1 : 0.28, Math.abs(nz) > 0.5 ? 0.1 : 0.28, 0, 0, [0.2, 0.21, 0.24], 0, 1);
    R.box(L[1] + nx * 0.04, L[2] + ny * 0.04, L[3] + nz * 0.04, 0.06, 0.06, 0.06, 0, 0, own ? [0.2, 1, 0.5] : [1, 0.2, 0.2], armed ? 1 : (Math.sin(t * 10) > 0 ? 1 : 0.2), 1);
  }
  // CTF flags
  if (S.flags) S.flags.forEach((f, i) => {
    const col = teamInfo(i).rgb, [st, carrier, x, y, z] = f;
    if (st !== 1) { R.box(x, y + 0.9, z, 0.06, 1.8, 0.06, 0, 0, [0.85, 0.85, 0.88], 0, 1); R.box(x + Math.sin(t * 3 + i) * 0.04, y + 1.55, z - 0.4, 0.04, 0.5, 0.8, 0, 0, col, 0.85, 1); }
    if (st === 0) { const hm = mp.flags[i]; R.box(hm.x, hm.y + 0.04, hm.z, 2.2, 0.06, 2.2, 0, 0, col, 1, 1); }
  });
  // hill ring
  if (game.mode === 'koth') {
    const h = mp.hill, col = S.hill === -2 ? [0.9, 0.9, 0.95] : S.hill === -1 ? [1, 0.85, 0.2] : teamInfo(S.hill).rgb;
    const n = 28;
    for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; R.box(h.x + Math.cos(a) * h.r, h.y + 0.05, h.z + Math.sin(a) * h.r, 2 * Math.PI * h.r / n * 1.05, 0.08, 0.3, -a, 0, col, 1, 1); }
  }
  // golden gun
  if (game.mode === 'gg' && S.goldenW && S.goldenW[0] == null) {
    const g = S.goldenW; R.box(g[1], g[3] + 0.9 + Math.sin(t * 2) * 0.1, g[2], 0.2, 0.2, 0.8, spin, 0, [1, 0.8, 0.2], 0.8, 1);
  }
  // intel tokens
  for (const k of S.tokens) { const col = teamInfo(k[4]).rgb; R.box(k[1], k[2] + 0.6 + Math.sin(t * 3) * 0.08, k[3], 0.28, 0.28, 0.28, spin * 2, 0.7, col, 0.9, 1); }
}

function drawTransparent(t, cam) {
  const mp = game.map; if (!mp || game.view !== 'match') return;
  R.transparent(true);
  if (S.flags) S.flags.forEach((f, i) => { if (f[0] !== 1) beam(f[2], f[3], f[4], 14, teamInfo(i).rgb, 0.18, 0.5); });
  if (game.mode === 'koth') { const h = mp.hill; beam(h.x, h.y, h.z, 12, S.hill === -2 ? [0.9, 0.9, 1] : S.hill === -1 ? [1, 0.85, 0.2] : teamInfo(S.hill).rgb, 0.14, h.r * 1.9); }
  if (game.mode === 'gg' && S.goldenW && S.goldenW[0] == null) beam(S.goldenW[1], S.goldenW[3], S.goldenW[2], 14, [1, 0.8, 0.2], 0.25, 0.4);
  mp.pickups.forEach((p, i) => { if (S.pk[i] === '1') { const kind = S.pkKinds[i]; if (WEAPONS[kind]) beam(p.x, p.y, p.z, 3, hex(PICKUP_COLORS[kind]), 0.15, 0.3); } });
  for (const c of S.calls) { const css = CALLS.find(x => x.k === c.k).css; beam(c.p[0], c.p[1], c.p[2], 5, hex(css), 0.22 * Math.min(1, (CALL_LIFE - (t - c.t)) / 1.5), 0.18); }
  // protection shimmer on spawn-protected players
  for (const pl of S.players.values()) {
    if (pl.id === game.myId || !pl.al || !pl.prot) continue;
    const p = 0.28 + Math.sin(t * 12) * 0.08;
    R.box(pl.rx, pl.ry + 0.95, pl.rz, 0.95, 2.0, 0.95, t, 0, [0.5, 0.9, 1], 1, p);
  }
  // laser mine beams
  for (const L of S.lz) {
    const own = teamMode() ? L[8] === S.team : L[9] === game.myId, armed = L[10] === 1;
    const nx = L[4], ny = L[5], nz = L[6], len = L[7];
    const a = armed ? 0.6 + Math.sin(t * 22) * 0.12 : 0.1;
    R.box(L[1] + nx * len / 2, L[2] + ny * len / 2, L[3] + nz * len / 2, armed ? 0.03 : 0.015, armed ? 0.03 : 0.015, len, Math.atan2(-nx, -nz), Math.asin(clamp(ny, -1, 1)), own ? [0.3, 1, 0.55] : [1, 0.15, 0.15], 1, a);
  }
  // tracers
  for (let i = S.tracers.length - 1; i >= 0; i--) {
    const tr = S.tracers[i], age = t - tr.t;
    if (age > tr.life) { S.tracers.splice(i, 1); continue; }
    const dx = tr.b[0] - tr.a[0], dy = tr.b[1] - tr.a[1], dz = tr.b[2] - tr.a[2], len = Math.hypot(dx, dy, dz);
    const yaw = Math.atan2(-dx, -dz), pitch = Math.asin(dy / len);
    R.box((tr.a[0] + tr.b[0]) / 2, (tr.a[1] + tr.b[1]) / 2, (tr.a[2] + tr.b[2]) / 2, tr.w, tr.w, len, yaw, pitch, tr.col, 1, (1 - age / tr.life) * 0.85);
  }
  // explosions
  for (let i = S.booms.length - 1; i >= 0; i--) {
    const b = S.booms[i], k = (t - b.t) / b.life;
    if (k > 1) { S.booms.splice(i, 1); continue; }
    const s = (1 + k * 8) * (b.sc || 1), a = (1 - k) * 0.7;
    R.box(b.x, b.y, b.z, s, s, s, k * 2, k, [1, 0.55, 0.15], 1, a * 0.6);
    R.box(b.x, b.y, b.z, s * 0.6, s * 0.6, s * 0.6, -k * 3, k * 2, [1, 0.9, 0.5], 1, a);
  }
  // sparks
  const dts = 1 / 60;
  for (let i = S.sparks.length - 1; i >= 0; i--) {
    const s = S.sparks[i], age = t - s.t;
    if (age > s.life) { S.sparks.splice(i, 1); continue; }
    s.vy -= 14 * dts; s.x += s.vx * dts; s.y += s.vy * dts; s.z += s.vz * dts;
    R.box(s.x, s.y, s.z, 0.06, 0.06, 0.06, age * 9, age * 7, s.col, 1, 1 - age / s.life);
  }
  // rain
  if (S.weather === 'rain' && S.rain) {
    const cx = cam.x, cz = cam.z, cyy = cam.y, dtr = 1 / 60, arr = S.rain, n = arr.length / 6;
    for (let i = 0; i < n; i++) {
      const o = i * 6;
      arr[o + 1] -= 32 * dtr;
      if (arr[o + 1] < cyy - 12) { arr[o] = (Math.random() - 0.5) * 40; arr[o + 2] = (Math.random() - 0.5) * 40; arr[o + 1] = cyy + 14 + Math.random() * 4; }
      const x = cx + arr[o], z = cz + arr[o + 2], y = arr[o + 1];
      arr[o + 3] = x; arr[o + 4] = y; arr[o + 5] = z;
    }
    // line list needs absolute vertices: build [start,end] pairs
    const out = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) { const o = i * 6; out[o] = arr[o + 3]; out[o + 1] = arr[o + 4]; out[o + 2] = arr[o + 5]; out[o + 3] = arr[o + 3] - 0.12; out[o + 4] = arr[o + 4] + 0.9; out[o + 5] = arr[o + 5] - 0.05; }
    R.lines(out, n, [0.7, 0.8, 0.95], 0.45);
  }
  R.transparent(false);
}

function render(t, dt) {
  const cam = computeCamera(dt, t);
  S.cam = cam;
  R.begin(cam, { brightness: settings.gfx.brightness, weather: S.weather, fogScale: settings.gfx.fogScale });
  if (game.view === 'match') {
    for (const pl of S.players.values()) {
      if (pl.id === game.myId || cam.killcam === pl.id) continue;
      drawPlayer(pl, t, cam);
    }
    drawWorldObjects(t, cam);
  }
  drawTransparent(t, cam);
  drawViewmodel(t, cam);
  if (S.wantShot) { S.wantShot = false; try { game.shotURL = canvas.toDataURL('image/png'); game.emit('shot'); } catch { /* ignore */ } }
}

// ------------------------------------------------------------------ HUD canvas (reticle, markers, tags, indicators)
const RETICLE = { red: '#ff3b3b', green: '#46ff7a' };
function drawHud(t) {
  const W = S.W, H = S.H, hd = S.hd;
  hctx.setTransform(hd, 0, 0, hd, 0, 0); hctx.clearRect(0, 0, W, H);
  if (game.view !== 'match') return;
  const cx = W / 2, cy = H / 2;

  // spawn protection / low-health vignette
  if (S.alive && S.hp < 35) { const a = (1 - S.hp / 35) * 0.45 + Math.sin(t * 6) * 0.04; const g = hctx.createRadialGradient(cx, cy, H * 0.3, cx, cy, H * 0.8); g.addColorStop(0, 'rgba(180,0,0,0)'); g.addColorStop(1, `rgba(180,0,0,${a})`); hctx.fillStyle = g; hctx.fillRect(0, 0, W, H); }
  if (S.alive && t < S.protectedUntil) { const g = hctx.createRadialGradient(cx, cy, H * 0.35, cx, cy, H * 0.85); g.addColorStop(0, 'rgba(90,200,255,0)'); g.addColorStop(1, 'rgba(90,200,255,0.28)'); hctx.fillStyle = g; hctx.fillRect(0, 0, W, H); }

  if (S.alive) {
    const ads = S.adsT;
    if (S.cur === 'sniper' && ads > 0.6) drawScope(cx, cy, W, H);
    else drawReticle(cx, cy, ads, t);
  }
  drawMarkers(t, cx, cy, W, H);
  drawNametags(t);

  // damage direction
  for (let i = S.dmgInd.length - 1; i >= 0; i--) {
    const d = S.dmgInd[i], age = t - d.t; if (age > 1.4) { S.dmgInd.splice(i, 1); continue; }
    hctx.strokeStyle = `rgba(255,60,60,${0.85 * (1 - age / 1.4)})`; hctx.lineWidth = 9; hctx.lineCap = 'round';
    const r = Math.min(W, H) * 0.2, a0 = d.ang - Math.PI / 2;
    hctx.beginPath(); hctx.arc(cx, cy, r, a0 - 0.28, a0 + 0.28); hctx.stroke();
  }
  // hit marker
  const hm = t - S.hitMark;
  if (hm < 0.28) {
    const col = S.hitKind === 'kill' ? '255,70,70' : S.hitKind === 'head' ? '255,210,60' : '255,255,255';
    const g = 8 + hm * 20, l = S.hitKind === 'kill' ? 12 : 8;
    hctx.strokeStyle = `rgba(${col},${1 - hm / 0.28})`; hctx.lineWidth = S.hitKind === 'kill' ? 3 : 2;
    hctx.beginPath();
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { hctx.moveTo(cx + sx * g, cy + sy * g); hctx.lineTo(cx + sx * (g + l), cy + sy * (g + l)); }
    hctx.stroke();
  }
}

function drawReticle(cx, cy, ads, t) {
  const s = settings.sight, col = RETICLE[s.color] || RETICLE.red, sz = s.size, w = WEAPONS[S.cur];
  const spread = (lerp(w.spread, w.adsSpread, ads) * 900 + 3) * (S.body.crouch ? 0.8 : 1);
  hctx.fillStyle = col; hctx.strokeStyle = col; hctx.lineWidth = 2 * sz; hctx.globalAlpha = 0.95;
  hctx.shadowColor = 'rgba(0,0,0,0.7)'; hctx.shadowBlur = 3;
  if (s.shape === 'dot') { hctx.beginPath(); hctx.arc(cx, cy, 2.6 * sz, 0, 7); hctx.fill(); }
  else if (s.shape === 'cross') { const g = spread * sz * 0.6 + 4, l = 8 * sz; hctx.beginPath(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { hctx.moveTo(cx + dx * g, cy + dy * g); hctx.lineTo(cx + dx * (g + l), cy + dy * (g + l)); } hctx.stroke(); hctx.beginPath(); hctx.arc(cx, cy, 1.4 * sz, 0, 7); hctx.fill(); }
  else if (s.shape === 'circle') { hctx.beginPath(); hctx.arc(cx, cy, 11 * sz + spread * 0.3, 0, 7); hctx.stroke(); hctx.beginPath(); hctx.arc(cx, cy, 1.8 * sz, 0, 7); hctx.fill(); }
  else if (s.shape === 'chevron') { hctx.beginPath(); hctx.moveTo(cx - 9 * sz, cy + 8 * sz); hctx.lineTo(cx, cy); hctx.lineTo(cx + 9 * sz, cy + 8 * sz); hctx.stroke(); }
  hctx.shadowBlur = 0; hctx.globalAlpha = 1;
}

function drawScope(cx, cy, W, H) {
  const r = Math.min(W, H) * 0.42;
  hctx.fillStyle = '#000'; hctx.beginPath(); hctx.rect(0, 0, W, H); hctx.arc(cx, cy, r, 0, Math.PI * 2, true); hctx.fill('evenodd');
  hctx.strokeStyle = 'rgba(0,0,0,0.9)'; hctx.lineWidth = 2; hctx.beginPath(); hctx.moveTo(cx - r, cy); hctx.lineTo(cx + r, cy); hctx.moveTo(cx, cy - r); hctx.lineTo(cx, cy + r); hctx.stroke();
  hctx.fillStyle = RETICLE[settings.sight.color] || RETICLE.red; hctx.beginPath(); hctx.arc(cx, cy, 2, 0, 7); hctx.fill();
}

function clampToScreen(p, W, H, m = 40) {
  return { x: clamp(p.x, m, W - m), y: clamp(p.y, m, H - m), off: p.x < m || p.x > W - m || p.y < m || p.y > H - m };
}

function worldMarker(x, y, z, label, css, W, H) {
  const sc = W / canvas.width;
  let p = R.project(x, y, z);
  let sx, sy, off = false;
  if (!p) { // behind the camera: pin to bottom edge
    const dx = x - S.cam.x, dz = z - S.cam.z, rgt = dx * Math.cos(S.cam.yaw) - dz * Math.sin(S.cam.yaw);
    sx = rgt > 0 ? W - 40 : 40; sy = H - 70; off = true;
  } else { const c = clampToScreen({ x: p.x * sc, y: p.y * (H / canvas.height) }, W, H, 44); sx = c.x; sy = c.y; off = c.off; }
  const d = Math.hypot(x - S.cam.x, y - S.cam.y, z - S.cam.z);
  hctx.fillStyle = css; hctx.strokeStyle = 'rgba(0,0,0,0.6)'; hctx.lineWidth = 3;
  hctx.beginPath(); hctx.moveTo(sx, sy - 9); hctx.lineTo(sx + 8, sy); hctx.lineTo(sx, sy + 9); hctx.lineTo(sx - 8, sy); hctx.closePath(); hctx.stroke(); hctx.fill();
  hctx.font = '700 11px system-ui, sans-serif'; hctx.textAlign = 'center'; hctx.fillStyle = '#fff'; hctx.strokeText(`${label} ${Math.round(d)}m`, sx, sy + 24); hctx.fillText(`${label} ${Math.round(d)}m`, sx, sy + 24);
  return off;
}

function drawMarkers(t, cx, cy, W, H) {
  if (!S.alive || S.phase === 'ended') return;
  const mp = game.map; hctx.lineJoin = 'round';
  if (S.flags) S.flags.forEach((f, i) => {
    const ti = teamInfo(i), own = i === S.team;
    let label = own ? 'DEFEND' : 'ATTACK', st = f[0];
    if (st === 1) label = own ? 'KILL CARRIER' : (f[1] === game.myId ? 'RETURN TO BASE' : 'ESCORT');
    if (st === 2) label = own ? 'RETURN' : 'TAKE';
    if (st === 0 && !own && S.carrying >= 0) return;
    if (st === 0 && own && S.carrying < 0) label = 'FLAG';
    worldMarker(f[2], f[3] + 2.4, f[4], label, ti.css, W, H);
  });
  if (S.carrying >= 0 && S.flags) { const hm = mp.flags[S.team]; worldMarker(hm.x, hm.y + 2.4, hm.z, S.flags[S.team][0] === 0 ? 'CAPTURE' : 'FLAG MISSING', '#fff', W, H); }
  if (game.mode === 'koth') { const h = mp.hill; worldMarker(h.x, h.y + 3.2, h.z, 'HILL', S.hill === -2 ? '#e8e8ee' : S.hill === -1 ? '#ffd23f' : teamInfo(S.hill).css, W, H); }
  if (game.mode === 'gg' && S.goldenW && S.goldenW[0] == null) worldMarker(S.goldenW[1], S.goldenW[3] + 2, S.goldenW[2], 'GOLDEN GUN', '#ffd23f', W, H);
  if (game.mode === 'gg' && S.goldenW && S.goldenW[0] != null && S.goldenW[0] !== game.myId) { const h = S.players.get(S.goldenW[0]); if (h && h.al) worldMarker(h.rx, h.ry + 2.6, h.rz, 'GOLD', '#ffd23f', W, H); }
  for (const k of S.tokens) worldMarker(k[1], k[2] + 1.2, k[3], k[4] === S.team ? 'DENY' : 'INTEL', teamInfo(k[4]).css, W, H);
  S.calls = S.calls.filter(c => t - c.t < CALL_LIFE);
  for (const c of S.calls) { const d = CALLS.find(x => x.k === c.k); worldMarker(c.p[0], c.p[1] + 0.9, c.p[2], `${c.id === game.myId ? 'YOU' : nameOf(c.id)}: ${d.label.toUpperCase()}`, d.css, W, H); }
}

function drawNametags(t) {
  const tm = teamMode(), sc = S.W / canvas.width, scy = S.H / canvas.height;
  for (const pl of S.players.values()) {
    if (pl.id === game.myId || !pl.al) continue;
    const ally = tm && pl.team === S.team;
    if (!ally && !settings.access.shapeCues) continue;
    const p = R.project(pl.rx, pl.ry + (pl.crouch ? 1.35 : 1.95), pl.rz); if (!p) continue;
    const eye = eyePos(), head = [pl.rx, pl.ry + 1.5, pl.rz];
    const dir = [head[0] - eye[0], head[1] - eye[1], head[2] - eye[2]], dist = Math.hypot(dir[0], dir[1], dir[2]);
    const los = !raycast(game.map.boxes, eye, [dir[0] / dist, dir[1] / dist, dir[2] / dist], dist - 0.3);
    if (!ally && !los) continue;
    const x = p.x * sc, y = p.y * scy, ti = teamInfo(pl.team), a = los ? 1 : 0.4;
    hctx.globalAlpha = a; hctx.textAlign = 'center'; hctx.font = '700 12px system-ui, sans-serif';
    hctx.lineWidth = 3; hctx.strokeStyle = 'rgba(0,0,0,0.65)';
    const label = (settings.access.shapeCues && tm ? ti.shape + ' ' : '') + pl.name;
    hctx.strokeText(label, x, y - 10); hctx.fillStyle = tm ? ti.css : '#fff'; hctx.fillText(label, x, y - 10);
    if (ally) { hctx.fillStyle = 'rgba(0,0,0,0.55)'; hctx.fillRect(x - 20, y - 6, 40, 4); hctx.fillStyle = pl.hp > 40 ? '#6f6' : '#f66'; hctx.fillRect(x - 20, y - 6, 40 * clamp(pl.hp / 100, 0, 1), 4); }
    if (!ally && settings.access.shapeCues) { hctx.fillStyle = '#ff5050'; hctx.fillText('▼', x, y + 4); }
    hctx.globalAlpha = 1;
  }
}

// ------------------------------------------------------------------ minimap
let miniStatic = null;
function buildMini() {
  if (!game.map) return;
  const scale = 5, size = 60 * scale;
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
  g.fillStyle = '#10151c'; g.fillRect(0, 0, size, size);
  const boxes = [...game.map.boxes].sort((a, b) => a.y1 - b.y1);
  for (const b of boxes) {
    const h = b.y1; if (h <= 0.01 && b.y0 < 0) { continue; }
    const v = Math.round(clamp(40 + h * 22, 40, 150));
    g.fillStyle = h < 0.7 ? `rgb(${v + 10},${v + 14},${v + 20})` : `rgb(${v},${v + 8},${v + 22})`;
    g.fillRect((b.x0 + 30) * scale, (b.z0 + 30) * scale, (b.x1 - b.x0) * scale, (b.z1 - b.z0) * scale);
    if (h > 1.4) { g.strokeStyle = 'rgba(160,190,230,0.55)'; g.lineWidth = 1; g.strokeRect((b.x0 + 30) * scale + 0.5, (b.z0 + 30) * scale + 0.5, (b.x1 - b.x0) * scale - 1, (b.z1 - b.z0) * scale - 1); }
  }
  miniStatic = { c, scale };
}

function drawMini(t) {
  if (!settings.hud.minimap || !miniStatic || game.view !== 'match') return;
  const w = miniCanvas.width, ppu = w / 46;                         // ~46 world units across
  const b = S.body, sc = miniStatic.scale;
  mctx.clearRect(0, 0, w, w);
  mctx.save(); mctx.beginPath(); mctx.roundRect ? mctx.roundRect(0, 0, w, w, 10) : mctx.rect(0, 0, w, w); mctx.clip();
  mctx.fillStyle = '#0b0f14'; mctx.fillRect(0, 0, w, w);
  mctx.translate(w / 2, w / 2);
  const rotate = settings.hud.mapRotate;
  if (rotate) mctx.rotate(S.yaw);
  mctx.translate(-b.x * ppu, -b.z * ppu);
  const k = ppu / sc;
  mctx.drawImage(miniStatic.c, -30 * ppu, -30 * ppu, 60 * sc * k, 60 * sc * k);
  const dot = (x, z, r, col) => { mctx.fillStyle = col; mctx.beginPath(); mctx.arc(x * ppu, z * ppu, r, 0, 7); mctx.fill(); };
  // objectives
  const mp = game.map;
  if (game.mode === 'koth') { const h = mp.hill; mctx.strokeStyle = S.hill === -2 ? '#ddd' : S.hill === -1 ? '#fc3' : teamInfo(S.hill).css; mctx.lineWidth = 2; mctx.beginPath(); mctx.arc(h.x * ppu, h.z * ppu, h.r * ppu, 0, 7); mctx.stroke(); }
  if (S.flags) S.flags.forEach((f, i) => { mctx.fillStyle = teamInfo(i).css; mctx.fillRect(f[2] * ppu - 4, f[4] * ppu - 4, 8, 8); });
  if (game.mode === 'gg' && S.goldenW && S.goldenW[0] == null) dot(S.goldenW[1], S.goldenW[2], 4, '#ffd23f');
  for (const k2 of S.tokens) dot(k2[1], k2[3], 3, teamInfo(k2[4]).css);
  mp.pickups.forEach((p, i) => { if (S.pk[i] === '1') dot(p.x, p.z, 1.8, PICKUP_COLORS[S.pkKinds[i]] || '#fff'); });
  for (const m of S.minesWorld) { if (teamMode() ? m[7] === S.team : m[8] === game.myId) dot(m[1], m[3], 2, '#6f6'); }
  for (const L of S.lz) { if (teamMode() ? L[8] === S.team : L[9] === game.myId) dot(L[1], L[3], 2, '#f66'); }
  for (const c of S.calls) { const col = CALLS.find(x => x.k === c.k).css, age = t - c.t; dot(c.p[0], c.p[2], 4, col); mctx.strokeStyle = col; mctx.lineWidth = 2; mctx.globalAlpha = Math.max(0, 1 - (age % 1)); mctx.beginPath(); mctx.arc(c.p[0] * ppu, c.p[2] * ppu, 4 + (age % 1) * 14, 0, 7); mctx.stroke(); mctx.globalAlpha = 1; }
  // players
  const tm = teamMode();
  for (const pl of S.players.values()) {
    if (pl.id === game.myId || !pl.al) continue;
    const ally = tm && pl.team === S.team, sp = (S.spotted.get(pl.id) || 0) > t;
    if (!ally && !sp) continue;
    const ti = teamInfo(pl.team);
    mctx.save(); mctx.translate(pl.rx * ppu, pl.rz * ppu); mctx.rotate(-pl.ra);
    mctx.fillStyle = ally ? ti.css : '#ff4a4a';
    if (ally || !settings.access.shapeCues) { mctx.beginPath(); mctx.moveTo(0, -6); mctx.lineTo(4.5, 4); mctx.lineTo(-4.5, 4); mctx.closePath(); mctx.fill(); }
    else { mctx.fillRect(-4, -4, 8, 8); }
    mctx.restore();
  }
  mctx.restore();
  // self
  mctx.save(); mctx.translate(w / 2, w / 2); if (!rotate) mctx.rotate(-S.yaw);
  mctx.fillStyle = '#fff'; mctx.strokeStyle = '#000'; mctx.lineWidth = 1.5;
  mctx.beginPath(); mctx.moveTo(0, -8); mctx.lineTo(6, 6); mctx.lineTo(0, 3); mctx.lineTo(-6, 6); mctx.closePath(); mctx.stroke(); mctx.fill();
  mctx.restore();
  mctx.strokeStyle = 'rgba(255,255,255,0.25)'; mctx.lineWidth = 2; mctx.strokeRect(1, 1, w - 2, w - 2);
}

// ------------------------------------------------------------------ DOM HUD
function setText(id, v) { if (S.uiPrev[id] !== v) { S.uiPrev[id] = v; $(id).textContent = v; } }
function setStyle(id, prop, v) { const k = id + prop; if (S.uiPrev[k] !== v) { S.uiPrev[k] = v; $(id).style[prop] = v; } }
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function updateHUD(t) {
  const root = $('hud-root');
  const show = game.view === 'match';
  root.classList.toggle('hidden', !show);
  if (!show) return;
  const m = MODES[game.mode] || MODES.dm, tm = m.team, lim = game.match ? game.match.limit : 0;
  // score bar
  if (tm) {
    const a = teamInfo(0), b = teamInfo(1);
    setText('h-nameA', a.shape + ' ' + a.name); setText('h-nameB', b.name + ' ' + b.shape);
    setStyle('h-nameA', 'color', a.css); setStyle('h-nameB', 'color', b.css);
    setText('h-scoreA', String(S.teamScore[0])); setText('h-scoreB', String(S.teamScore[1]));
  } else {
    const me = S.players.get(game.myId), list = [...S.players.values()].sort((x, y) => y.sc - x.sc);
    const lead = list[0];
    setText('h-nameA', 'YOU'); setStyle('h-nameA', 'color', '#ffd23f'); setText('h-scoreA', String(me ? me.sc : 0));
    setText('h-nameB', lead && lead.id !== game.myId ? lead.name.toUpperCase() : (list[1] ? list[1].name.toUpperCase() : '—')); setStyle('h-nameB', 'color', '#e9edf3');
    setText('h-scoreB', String(lead && lead.id !== game.myId ? lead.sc : (list[1] ? list[1].sc : 0)));
  }
  setText('h-timer', S.phase === 'countdown' ? 'GET READY' : fmtTime(S.timeLeft));
  setText('h-limit', `${m.limitLabel.toUpperCase()}: ${lim}`);
  // objective strip
  let obj = m.name.toUpperCase();
  if (game.mode === 'ctf' && S.carrying >= 0) obj = 'CARRYING THE ENEMY FLAG · RETURN TO BASE';
  else if (game.mode === 'ctf' && S.flags) obj = `CAPTURE THE FLAG · ${S.flags.map((f, i) => `${teamInfo(i).name} ${['HOME', 'TAKEN', 'DROPPED'][f[0]]}`).join(' · ')}`;
  else if (game.mode === 'koth') obj = S.hill === -1 ? 'HILL CONTESTED' : S.hill === -2 ? 'HILL NEUTRAL · CAPTURE IT' : `${teamInfo(S.hill).name} HOLD THE HILL`;
  else if (game.mode === 'gg') obj = S.goldenW && S.goldenW[0] != null ? `${nameOf(S.goldenW[0]).toUpperCase()} HOLDS THE GOLDEN GUN` : 'GOLDEN GUN IS UP FOR GRABS';
  setText('h-objective', obj);
  // vitals + ammo
  setText('h-hp', String(Math.max(0, Math.round(S.hp)))); setStyle('h-hpbar', 'width', clamp(S.hp, 0, 100) + '%');
  setStyle('h-hpbar', 'background', S.hp > 50 ? '#4cd964' : S.hp > 25 ? '#ffb020' : '#ff4040');
  setText('h-armor', String(Math.round(S.armor))); setStyle('h-armorbar', 'width', clamp(S.armor, 0, 100) + '%');
  const w = WEAPONS[S.cur], inv = S.inv[S.cur];
  setText('h-wpn', w ? w.name : '');
  if (inv) {
    setText('h-mag', S.reloadEnd ? 'RELOADING' : String(inv.mag));
    setText('h-reserve', inv.reserve === Infinity ? '∞' : String(inv.reserve));
  }
  setText('h-mines', `MINE ${S.mines} · LASER ${S.lasers} · KNIFE ${S.knives}`);
  const prot = S.alive && t < S.protectedUntil; $('h-prot').classList.toggle('hidden', !prot);
  // weapon slots
  const slots = $('h-slots');
  const key = owned().join(',') + S.cur;
  if (S.uiPrev.slots !== key) {
    S.uiPrev.slots = key;
    slots.innerHTML = WEAPON_ORDER.filter(x => S.inv[x]).map(x => `<span class="${x === S.cur ? 'on' : ''}" style="--wc:${WEAPONS[x].color}">${CATEGORIES.indexOf(WEAPONS[x].cat) + 1}</span>`).join('');
  }
  // countdown / dead text
  const cd = $('h-countdown');
  if (S.phase === 'countdown') { cd.classList.remove('hidden'); setText('h-countdown', String(Math.max(1, S.countdown))); } else cd.classList.add('hidden');
  if (!S.alive && S.phase === 'play') $('h-dead').classList.remove('hidden');
  // ping / fps
  setText('h-ping', `${pingMs} ms · ${fps} fps`);
  // scoreboard (hold)
  const showBoard = actionDown('score');
  $('scoreboard').classList.toggle('hidden', !showBoard);
  if (showBoard && t - S.boardAt > 0.25) {
    S.boardAt = t;
    const players = [...S.players.values()].map(p => ({ id: p.id, name: p.name || 'Operator', team: p.team || 0, bot: p.bot, op: p.op || 0, k: p.k || 0, d: p.d || 0, a: p.a || 0, cp: p.cp || 0, rt: p.rt || 0, sc: p.sc || 0, alive: p.al }));
    $('scoreboard-body').innerHTML = boardHTML({ players, teamMode: tm, mode: game.mode, myId: game.myId, teamScore: S.teamScore });
    $('sb-title').textContent = `${m.name} · ${game.mapId.toUpperCase()}`;
  }
}

// ------------------------------------------------------------------ main loop
let last = now(), fpsAcc = 0, fpsN = 0, pingAt = 0;
function frame() {
  requestAnimationFrame(frame);
  const t = now(); let dt = t - last; last = t; dt = Math.min(dt, 0.05);
  fpsAcc += dt; fpsN++; if (fpsAcc > 0.5) { fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
  try {
    beginFrame();
    if (game.view === 'match') {
      if (padPressed('pause')) game.emit('pause-toggle');
      updateLocal(dt, t); updateRemotes(dt, t);
      if (t - pingAt > 2) { pingAt = t; send({ t: 'ping', ts: performance.now() }); }
    }
    render(t, dt); drawHud(t); drawMini(t); updateHUD(t);
    endFrame();
  } catch (e) { console.error(e); }
}

export function takeScreenshot() { S.wantShot = true; }
export { requestLock, releaseLock };
export function setTeam(team) { send({ t: 'team', team }); }
export function sendCfg(cfg) { send({ t: 'cfg', ...cfg }); }
export function startMatch() { send({ t: 'start' }); }
export function sendVote(map) { send({ t: 'vote', map }); }
export function backToLobby() { send({ t: 'lobby' }); }
export function setOperator(op) { send({ t: 'op', op }); }
export function isHost() { return game.room && game.room.host === game.myId; }
