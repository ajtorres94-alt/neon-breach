// Server-side bot AI: waypoint navigation (A*), target acquisition with line of sight,
// strafing combat, mode-aware goals, stuck recovery. Bots use the same physics and the
// same fire/pickup/mode code paths as human players.

import { P, stepBody, raycast, dirFromAngles, norm3 } from '../shared/physics.js';
import { nearestNode, findPath } from '../shared/nav.js';
import { WEAPONS, GADGETS } from '../shared/weapons.js';

export const BOT_NAMES = ['Cipher', 'Vesper', 'Sable', 'Quill', 'Onyx', 'Wraith', 'Marlowe', 'Zephyr', 'Halcyon', 'Mirage', 'Kestrel', 'Argent', 'Nocturne', 'Phantom', 'Gambit', 'Sterling'];

/** Seconds added to every bot's reaction time (time from first seeing an enemy to the first shot). */
export const REACTION_PENALTY = 0.5;

/**
 * Ten bot personalities. Every bot gets one at random; it changes where they go, how they fight and what they take risks for.
 *   hunt / pick : chance (per goal choice) of heading for the nearest enemy / for pickups; the rest is roaming or camping
 *   camp        : holds a chosen spot and ambushes instead of roaming
 *   flank       : takes routes that approach enemies from the side
 *   range       : multiplier on the fighting distance a bot likes (small = rushes in, large = stays back)
 *   fleeHp      : health below which it breaks off to find a health pack
 *   react       : extra reaction time (s), added on top of the global penalty
 *   acc / turn  : added to skill (aim error) / multiplier on turn speed
 *   strafe      : how often it changes strafe direction (larger = more erratic)
 *   burst       : multiplier on burst length for automatic weapons
 *   memory      : seconds it keeps chasing a target it lost sight of
 *   jumpy       : jumps around in a fight
 *   knife       : chance per tick of throwing a knife at mid range
 *   weapons     : preferred weapons, tried first when they are owned
 *   role        : 'attack' or 'defend' (objective modes: defend sits near its own flag / base)
 */
export const PERSONALITIES = [
  { id: 'rusher',     name: 'Rusher',      hunt: 0.85, pick: 0.05, range: 0.45, fleeHp: 20, react: -0.1, acc: -0.08, turn: 1.1, strafe: 1.2, burst: 1.1, memory: 3.5, jumpy: 0, knife: 0.03, weapons: ['spas', 'shotgun', 'mossberg', 'smg', 'mp5', 'p90'], role: 'attack' },
  { id: 'sniper',     name: 'Sniper',      hunt: 0.1, pick: 0.1, camp: true, range: 2.4, fleeHp: 40, react: 0.15, acc: 0.18, turn: 0.8, strafe: 0.3, burst: 0.5, memory: 3, jumpy: 0, knife: 0, weapons: ['sniper', 'rifle', 'm4', 'aug'], role: 'defend' },
  { id: 'camper',     name: 'Camper',      hunt: 0.1, pick: 0.1, camp: true, range: 1.0, fleeHp: 35, react: -0.05, acc: 0.05, turn: 1.0, strafe: 0.4, burst: 0.9, memory: 2.5, jumpy: 0, knife: 0.01, weapons: ['m4', 'aug', 'rifle', 'mp5'], role: 'defend' },
  { id: 'flanker',    name: 'Flanker',     hunt: 0.35, pick: 0.1, flank: true, range: 0.8, fleeHp: 35, react: 0, acc: 0, turn: 1.15, strafe: 1.0, burst: 1.0, memory: 3, jumpy: 0.1, knife: 0.04, weapons: ['mp5', 'smg', 'm4', 'aug'], role: 'attack' },
  { id: 'guard',      name: 'Guardian',    hunt: 0.2, pick: 0.15, camp: true, range: 0.9, fleeHp: 45, react: -0.05, acc: 0.05, turn: 1.0, strafe: 0.6, burst: 1.0, memory: 3, jumpy: 0, knife: 0.01, weapons: ['m4', 'aug', 'mossberg', 'spas'], role: 'defend', guard: true },
  { id: 'scavenger',  name: 'Scavenger',   hunt: 0.25, pick: 0.6, range: 1.0, fleeHp: 50, react: 0.05, acc: -0.03, turn: 1.0, strafe: 1.0, burst: 1.0, memory: 2.5, jumpy: 0, knife: 0.05, weapons: [], role: 'attack' },
  { id: 'survivor',   name: 'Survivor',    hunt: 0.35, pick: 0.25, range: 1.3, fleeHp: 75, react: 0.1, acc: 0.06, turn: 0.95, strafe: 1.3, burst: 0.8, memory: 2, jumpy: 0, knife: 0, weapons: ['aug', 'm4', 'rifle'], role: 'defend' },
  { id: 'berserker',  name: 'Berserker',   hunt: 0.9, pick: 0.02, range: 0.35, fleeHp: 0, react: -0.15, acc: -0.12, turn: 1.25, strafe: 1.8, burst: 1.7, memory: 4, jumpy: 1, knife: 0.08, weapons: ['spas', 'shotgun', 'p90', 'smg'], role: 'attack' },
  { id: 'tactician',  name: 'Tactician',   hunt: 0.5, pick: 0.2, range: 1.1, fleeHp: 40, react: 0.05, acc: 0.12, turn: 1.0, strafe: 1.6, burst: 0.55, memory: 3, jumpy: 0, knife: 0.01, weapons: ['m4', 'aug', 'mp5'], role: 'attack' },
  { id: 'hunter',     name: 'Hunter',      hunt: 0.75, pick: 0.1, range: 1.0, fleeHp: 30, react: 0, acc: 0.04, turn: 1.05, strafe: 1.0, burst: 1.0, memory: 7, jumpy: 0, knife: 0.03, weapons: ['m4', 'rifle', 'aug', 'mp5'], role: 'attack' },
];

export function makeBot(persId) {
  const pers = PERSONALITIES.find(x => x.id === persId) || PERSONALITIES[(Math.random() * PERSONALITIES.length) | 0];
  return {
    pers,
    skill: 0.35 + Math.random() * 0.45,
    target: null, seenAt: 0, lastSeen: 0, lastSeenPos: null, nextScan: 0,
    path: null, pathI: 1, goal: null, nextGoal: 0, nextPath: 0,
    strafe: Math.random() < 0.5 ? 1 : -1, strafeUntil: 0,
    lx: 0, lz: 0, nextMoveCheck: 0, stuck: 0, jumpUntil: 0,
    burstLeft: 0, nextShot: 0, pauseUntil: 0, errYaw: 0, errPitch: 0, errUntil: 0,
    role: pers.role === 'defend' ? 'defend' : Math.random() < 0.15 ? 'defend' : 'attack',
    campNode: null, campUntil: 0, sweepPh: Math.random() * 6.28,
  };
}

const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const CLOSE = ['spas', 'shotgun', 'mossberg', 'p90', 'mp5', 'smg'];
const MID = ['m4', 'aug', 'rifle', 'p90', 'mp5', 'smg', 'spas', 'mossberg', 'shotgun'];
function bestWeapon(p, dist, pers) {
  const has = (w) => p.owned.has(w);
  if (has('golden')) return 'golden';
  if (pers && pers.weapons.length && !(dist > 28 && has('sniper'))) { const w = pers.weapons.find(has); if (w && (pers.range < 1.5 || dist > 12)) return w; }
  if (pers && pers.id === 'sniper' && has('sniper')) return 'sniper';
  if (dist > 28 && has('sniper')) return 'sniper';
  if (dist < 9) { const c = CLOSE.find(has); if (c) return c; }
  const m = MID.find(has); if (m) return m;
  if (has('sniper')) return 'sniper';
  if (has('deagle')) return 'deagle';
  if (has('revolver')) return 'revolver';
  return 'pistol';
}

function nearestActivePickup(room, p, kinds) {
  let best = null, bd = Infinity;
  for (const s of room.pickups) {
    if (!s.active || !kinds.includes(s.kind)) continue;
    const d = Math.hypot(s.x - p.x, s.z - p.z) + Math.abs(s.y - p.y) * 2;
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

function nearestEnemy(room, p) {
  let best = null, bd = Infinity;
  for (const o of room.players.values()) {
    if (o === p || !o.alive) continue;
    if (room.teamMode && o.team === p.team) continue;
    const d = Math.hypot(o.x - p.x, o.z - p.z);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

function randomNode(room) {
  const nodes = room.map.nav.nodes;
  return nodes[(Math.random() * nodes.length) | 0];
}

/** A spot with a long view that is away from the bot's current position (for ambushers). */
function pickCampNode(room, p) {
  const nodes = room.map.nav.nodes; let best = null, bs = -1;
  for (let i = 0; i < 10; i++) {
    const n = nodes[(Math.random() * nodes.length) | 0];
    if (Math.hypot(n.x - p.x, n.z - p.z) < 6) continue;
    let open = 0;
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, h = raycast(room.map.boxes, [n.x, n.y + 1.5, n.z], [Math.cos(a), 0, Math.sin(a)], 30); open += h ? h.t : 30; }
    if (open > bs) { bs = open; best = n; }
  }
  return best || randomNode(room);
}

/** A node that approaches `e` from the side rather than head-on. */
function flankNode(room, p, e) {
  const nodes = room.map.nav.nodes, dx = e.x - p.x, dz = e.z - p.z, dl = Math.hypot(dx, dz) || 1; let best = null, bs = -1;
  for (let i = 0; i < 12; i++) {
    const n = nodes[(Math.random() * nodes.length) | 0], ex = n.x - e.x, ez = n.z - e.z, el = Math.hypot(ex, ez) || 1;
    if (el < 5 || el > 18) continue;
    const side = Math.abs((ex / el) * (dz / dl) - (ez / el) * (dx / dl));            // how far off the direct line (0 = in front, 1 = fully side-on)
    if (side > bs) { bs = side; best = n; }
  }
  return best;
}

function chooseGoal(room, p, b, t) {
  const mode = room.settings.mode, flags = room.flags;
  // survival first
  const pers = b.pers;
  if (p.hp < pers.fleeHp) { const s = nearestActivePickup(room, p, ['health']); if (s && Math.random() < 0.85) return s; }
  if (p.owned.size <= 1 && Math.random() < 0.7) {
    const s = nearestActivePickup(room, p, ['rifle', 'aug', 'm4', 'smg', 'mp5', 'p90', 'shotgun', 'mossberg', 'spas', 'sniper', 'deagle', 'revolver']); if (s) return s;
  }
  if (mode === 'ctf' && flags) {
    const own = flags[p.team], enemy = flags[1 - p.team];
    if (p.carrying >= 0) return own.home;
    if (own.st === 2) return { x: own.x, y: own.y, z: own.z };
    if (own.st === 1 && own.carrier != null) { const c = room.players.get(own.carrier); if (c) return { x: c.x, y: c.y, z: c.z }; }
    if (b.role === 'defend') { const n = randomNode(room); return Math.hypot(n.x - own.home.x, n.z - own.home.z) < (pers.guard ? 9 : 14) ? n : own.home; }
    if (enemy.st === 1 && enemy.carrier != null) { const c = room.players.get(enemy.carrier); if (c && c.team === p.team) return own.home; }
    return { x: enemy.x, y: enemy.y, z: enemy.z };
  }
  if (mode === 'koth' && pers.guard) { const h = room.map.hill, a = Math.random() * Math.PI * 2, r = h.r * (0.6 + Math.random() * 0.8); return { x: h.x + Math.cos(a) * r, y: h.y, z: h.z + Math.sin(a) * r }; }   // guardians ring the hill
  if (mode === 'koth') {
    const h = room.map.hill; const a = Math.random() * Math.PI * 2, r = Math.random() * h.r * 0.6;
    return { x: h.x + Math.cos(a) * r, y: h.y, z: h.z + Math.sin(a) * r };
  }
  if (mode === 'kc' && room.tokens.length) {
    let best = null, bd = Infinity;
    for (const t of room.tokens) { const d = Math.hypot(t.x - p.x, t.z - p.z); if (d < bd) { bd = d; best = t; } }
    if (best && Math.random() < 0.85) return best;
  }
  if (mode === 'gg') {
    const g = room.golden;
    if (g.holder == null) return g;
    if (g.holder !== p.id) { const h = room.players.get(g.holder); if (h && h.alive) return h; }
  }
  // default: hunt the nearest enemy (bots know roughly where people are), otherwise roam / grab items
  const r = Math.random();
  if (pers.camp && r > pers.hunt + pers.pick) {                                      // campers, snipers and guardians settle at a spot and ambush from it
    if (!b.campNode || t > b.campUntil) { b.campNode = pickCampNode(room, p); b.campUntil = t + 14 + Math.random() * 14; }
    return b.campNode;
  }
  if (r < pers.hunt) {
    const e = nearestEnemy(room, p);
    if (e) { if (pers.flank) { const n = flankNode(room, p, e); if (n) return n; } return { x: e.x, y: e.y, z: e.z }; }
  }
  if (r < pers.hunt + pers.pick) { const s = nearestActivePickup(room, p, ['armor', 'ammo', 'health', 'mines', 'laser', 'knives', 'rifle', 'aug', 'm4', 'mp5', 'smg', 'shotgun', 'spas']); if (s) return s; }
  return randomNode(room);
}

export function botThink(room, p, dt, t) {
  const b = p.bot, map = room.map, boxes = map.boxes, nav = map.nav;
  if (!p.alive) return;
  const frozen = room.phase !== 'play';
  const eyeY = p.y + (p.crouch ? P.eyec : P.eye);
  const eye = [p.x, eyeY, p.z];

  // ---- target acquisition
  if (!frozen && t >= b.nextScan) {
    b.nextScan = t + 0.2 + Math.random() * 0.1;
    let best = null, bd = Infinity;
    for (const o of room.players.values()) {
      if (o === p || !o.alive) continue;
      if (room.teamMode && o.team === p.team) continue;
      const dx = o.x - p.x, dy = (o.y + 1.2) - eyeY, dz = o.z - p.z;
      const L = Math.hypot(dx, dy, dz);
      if (L > 55) continue;
      if (raycast(boxes, eye, [dx / L, dy / L, dz / L], L - 0.4)) continue;
      if (L < bd) { bd = L; best = o; }
    }
    if (best) {
      if (b.target !== best.id) { b.target = best.id; b.seenAt = t; }
      b.lastSeen = t; b.lastSeenPos = { x: best.x, y: best.y, z: best.z };
    } else if (b.target != null && t - b.lastSeen > b.pers.memory) b.target = null;
    p.wpn = bestWeapon(p, best ? bd : 20, b.pers);
  }
  let tp = b.target != null ? room.players.get(b.target) : null;
  if (!tp || !tp.alive) { tp = null; b.target = null; }
  const visible = tp && t - b.lastSeen < 0.5;

  // ---- goal + path
  if (t >= b.nextGoal) { b.nextGoal = t + 2 + Math.random() * 3; b.goal = chooseGoal(room, p, b, t); b.path = null; }
  let goal = b.goal;
  if (tp && !visible && b.lastSeenPos) goal = b.lastSeenPos;
  if (tp && visible && Math.hypot(tp.x - p.x, tp.z - p.z) > 22) goal = tp;
  if (!goal) goal = randomNode(room);

  let wx = 0, wz = 0, moving = false;
  const pers = b.pers, combat = visible && Math.hypot(tp.x - p.x, tp.z - p.z) <= (pers.range > 1.5 ? 45 : 22);
  if (combat) {
    const dx = tp.x - p.x, dz = tp.z - p.z, d = Math.hypot(dx, dz) || 1;
    const ux = dx / d, uz = dz / d;
    if (t >= b.strafeUntil) { b.strafeUntil = t + (0.7 + Math.random() * 1.4) / pers.strafe; if (Math.random() < 0.6) b.strafe *= -1; }
    if (pers.jumpy && t > (b.nextJump || 0)) { b.jumpUntil = t + 0.3; b.nextJump = t + 1.2 + Math.random() * 2 / pers.jumpy; }
    const cat = (WEAPONS[p.wpn] || {}).cat;
    const ideal = (cat === 'shotgun' ? 5 : p.wpn === 'sniper' ? 26 : cat === 'smg' ? 8 : 11) * pers.range;
    const px = -uz * b.strafe, pz = ux * b.strafe;
    if (d > ideal + 3) { wx = ux * 0.8 + px * 0.5; wz = uz * 0.8 + pz * 0.5; }
    else if (d < ideal - 3) { wx = -ux * 0.7 + px * 0.7; wz = -uz * 0.7 + pz * 0.7; }
    else { wx = px; wz = pz; }
    moving = true;
  } else {
    const holding = b.pers.camp && b.campNode && b.goal === b.campNode && Math.hypot(b.campNode.x - p.x, b.campNode.z - p.z) < 1.2;   // camper arrived at its spot: hold it
    if (holding) b.sweepPh += dt * 0.5;
    if (!holding && (!b.path || t >= b.nextPath)) {
      const a = nearestNode(nav, p.x, p.y, p.z), g = nearestNode(nav, goal.x, goal.y, goal.z);
      b.path = a && g ? findPath(nav, a.i, g.i) : null;
      b.pathI = 1; b.nextPath = t + 2.5;
      if (!b.path) b.nextGoal = 0;
    }
    if (!holding && b.path) {
      while (b.pathI < b.path.length) {
        const n = nav.nodes[b.path[b.pathI]];
        if (Math.hypot(n.x - p.x, n.z - p.z) < 0.8 && Math.abs(n.y - p.y) < 1.2) b.pathI++; else break;
      }
      if (b.pathI >= b.path.length) { b.nextGoal = 0; b.path = null; }
      else {
        const n = nav.nodes[b.path[b.pathI]];
        const dx = n.x - p.x, dz = n.z - p.z, d = Math.hypot(dx, dz) || 1;
        wx = dx / d; wz = dz / d; moving = true;
      }
    }
  }

  // ---- stuck recovery
  if (t >= b.nextMoveCheck) {
    b.nextMoveCheck = t + 0.5;
    if (moving && !frozen && Math.hypot(p.x - b.lx, p.z - b.lz) < 0.15) {
      b.stuck++; b.jumpUntil = t + 0.3; b.strafe *= -1; b.nextPath = 0;
      if (b.stuck >= 5) { b.nextGoal = 0; b.stuck = 0; }
    } else b.stuck = 0;
    b.lx = p.x; b.lz = p.z;
  }

  // ---- aiming
  let wantYaw = p.yaw, wantPitch = 0;
  if (visible) {
    if (t >= b.errUntil) {
      b.errUntil = t + 0.25 + Math.random() * 0.2;
      const e = (1 - clamp(b.skill + b.pers.acc, 0.15, 0.97)) * 0.07;
      b.errYaw = (Math.random() - 0.5) * 2 * e; b.errPitch = (Math.random() - 0.5) * 2 * e;
    }
    const ty = tp.y + (b.skill > 0.65 ? 1.5 : 1.15) + (tp.crouch ? -0.5 : 0);
    const dx = tp.x - p.x, dz = tp.z - p.z, dy = ty - eyeY, hd = Math.hypot(dx, dz) || 1;
    wantYaw = Math.atan2(-dx, -dz) + b.errYaw;
    wantPitch = Math.atan2(dy, hd) + b.errPitch;
  } else if (moving) {
    wantYaw = Math.atan2(-wx, -wz);
  } else if (b.pers.camp && b.campNode && b.goal === b.campNode && Math.hypot(b.campNode.x - p.x, b.campNode.z - p.z) < 1.2) {   // holding a spot: slowly sweep the view
    wantYaw = (b.campYaw ?? (b.campYaw = p.yaw)) + Math.sin(b.sweepPh) * 1.2;
  }
  const turn = (3 + b.skill * 5) * b.pers.turn * dt;
  const dyaw = angDiff(p.yaw, wantYaw);
  p.yaw += clamp(dyaw, -turn, turn);
  p.pitch += clamp(wantPitch - p.pitch, -turn, turn);
  p.pitch = clamp(p.pitch, -1.3, 1.3);

  // ---- melee when a target is in knife range, an occasional thrown knife at mid range
  if (visible && !frozen && tp && Math.abs(angDiff(p.yaw, wantYaw)) < 0.3) {
    const bd = Math.hypot(tp.x - p.x, tp.z - p.z);
    if (bd < 2 && t > (b.nextMelee || 0)) { b.nextMelee = t + 0.8; room.onMelee(p); }
    else if (bd > 6 && bd < 16 && p.knives > 0 && t > (b.nextThrow || 0) && Math.random() < b.pers.knife) {
      b.nextThrow = t + 4; room.onThrow(p, { o: eye, d: dirFromAngles(p.yaw, p.pitch) });
    }
  }

  // ---- shooting
  if (visible && !frozen && t - b.seenAt > Math.max(0.2, 0.25 + REACTION_PENALTY + b.pers.react + (1 - b.skill) * 0.45) && Math.abs(dyaw) < 0.12) {
    const w = WEAPONS[p.wpn] || WEAPONS.pistol;
    if (t >= b.pauseUntil && t >= b.nextShot) {
      if (b.burstLeft <= 0) b.burstLeft = w.auto ? Math.max(2, Math.round((4 + ((Math.random() * 8) | 0)) * b.pers.burst)) : 1;
      const d = dirFromAngles(p.yaw, p.pitch);
      room.fire(p, p.wpn, eye, d, false);
      b.nextShot = t + 1 / w.rate + (w.auto ? 0 : 0.15 + Math.random() * 0.25);
      if (--b.burstLeft <= 0) b.pauseUntil = t + 0.15 + Math.random() * 0.5 * (1.2 - b.skill);
    }
  }

  // ---- move through the real physics
  let f = 0, r = 0;
  if (moving && !frozen) {
    const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
    f = wx * -sy + wz * -cy; r = wx * cy + wz * -sy;
  }
  stepBody(boxes, p, { f, r, yaw: p.yaw, jump: t < b.jumpUntil, crouch: false, ads: false }, dt);
  if (p.y < -15) room.damage(p, 999, null, 'fall', false);
}
