// Server-side bot AI: waypoint navigation (A*), target acquisition with line of sight,
// strafing combat, mode-aware goals, stuck recovery. Bots use the same physics and the
// same fire/pickup/mode code paths as human players.

import { P, stepBody, raycast, dirFromAngles, norm3 } from '../shared/physics.js';
import { nearestNode, findPath } from '../shared/nav.js';
import { WEAPONS, GADGETS } from '../shared/weapons.js';

export const BOT_NAMES = ['Cipher', 'Vesper', 'Sable', 'Quill', 'Onyx', 'Wraith', 'Marlowe', 'Zephyr', 'Halcyon', 'Mirage', 'Kestrel', 'Argent', 'Nocturne', 'Phantom', 'Gambit', 'Sterling'];

export function makeBot() {
  return {
    skill: 0.35 + Math.random() * 0.45,
    target: null, seenAt: 0, lastSeen: 0, lastSeenPos: null, nextScan: 0,
    path: null, pathI: 1, goal: null, nextGoal: 0, nextPath: 0,
    strafe: Math.random() < 0.5 ? 1 : -1, strafeUntil: 0,
    lx: 0, lz: 0, nextMoveCheck: 0, stuck: 0, jumpUntil: 0,
    burstLeft: 0, nextShot: 0, pauseUntil: 0, errYaw: 0, errPitch: 0, errUntil: 0,
    role: Math.random() < 0.3 ? 'defend' : 'attack',
  };
}

const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const CLOSE = ['spas', 'shotgun', 'mossberg', 'p90', 'mp5', 'smg'];
const MID = ['m4', 'aug', 'rifle', 'p90', 'mp5', 'smg', 'spas', 'mossberg', 'shotgun'];
function bestWeapon(p, dist) {
  const has = (w) => p.owned.has(w);
  if (has('golden')) return 'golden';
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

function chooseGoal(room, p, b) {
  const mode = room.settings.mode, flags = room.flags;
  // survival first
  if (p.hp < 45) { const s = nearestActivePickup(room, p, ['health']); if (s && Math.random() < 0.8) return s; }
  if (p.owned.size <= 1 && Math.random() < 0.7) {
    const s = nearestActivePickup(room, p, ['rifle', 'aug', 'm4', 'smg', 'mp5', 'p90', 'shotgun', 'mossberg', 'spas', 'sniper', 'deagle', 'revolver']); if (s) return s;
  }
  if (mode === 'ctf' && flags) {
    const own = flags[p.team], enemy = flags[1 - p.team];
    if (p.carrying >= 0) return own.home;
    if (own.st === 2) return { x: own.x, y: own.y, z: own.z };
    if (own.st === 1 && own.carrier != null) { const c = room.players.get(own.carrier); if (c) return { x: c.x, y: c.y, z: c.z }; }
    if (b.role === 'defend') { const n = randomNode(room); return Math.hypot(n.x - own.home.x, n.z - own.home.z) < 14 ? n : own.home; }
    if (enemy.st === 1 && enemy.carrier != null) { const c = room.players.get(enemy.carrier); if (c && c.team === p.team) return own.home; }
    return { x: enemy.x, y: enemy.y, z: enemy.z };
  }
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
  if (r < 0.55) { const e = nearestEnemy(room, p); if (e) return { x: e.x, y: e.y, z: e.z }; }
  if (r < 0.75) { const s = nearestActivePickup(room, p, ['armor', 'ammo', 'health', 'mines', 'laser', 'knives']); if (s) return s; }
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
    } else if (b.target != null && t - b.lastSeen > 2.5) b.target = null;
    p.wpn = bestWeapon(p, best ? bd : 20);
  }
  let tp = b.target != null ? room.players.get(b.target) : null;
  if (!tp || !tp.alive) { tp = null; b.target = null; }
  const visible = tp && t - b.lastSeen < 0.5;

  // ---- goal + path
  if (t >= b.nextGoal) { b.nextGoal = t + 2 + Math.random() * 3; b.goal = chooseGoal(room, p, b); b.path = null; }
  let goal = b.goal;
  if (tp && !visible && b.lastSeenPos) goal = b.lastSeenPos;
  if (tp && visible && Math.hypot(tp.x - p.x, tp.z - p.z) > 22) goal = tp;
  if (!goal) goal = randomNode(room);

  let wx = 0, wz = 0, moving = false;
  const combat = visible && Math.hypot(tp.x - p.x, tp.z - p.z) <= 22;
  if (combat) {
    const dx = tp.x - p.x, dz = tp.z - p.z, d = Math.hypot(dx, dz) || 1;
    const ux = dx / d, uz = dz / d;
    if (t >= b.strafeUntil) { b.strafeUntil = t + 0.7 + Math.random() * 1.4; if (Math.random() < 0.6) b.strafe *= -1; }
    const cat = (WEAPONS[p.wpn] || {}).cat;
    const ideal = cat === 'shotgun' ? 5 : p.wpn === 'sniper' ? 26 : cat === 'smg' ? 8 : 11;
    const px = -uz * b.strafe, pz = ux * b.strafe;
    if (d > ideal + 3) { wx = ux * 0.8 + px * 0.5; wz = uz * 0.8 + pz * 0.5; }
    else if (d < ideal - 3) { wx = -ux * 0.7 + px * 0.7; wz = -uz * 0.7 + pz * 0.7; }
    else { wx = px; wz = pz; }
    moving = true;
  } else {
    if (!b.path || t >= b.nextPath) {
      const a = nearestNode(nav, p.x, p.y, p.z), g = nearestNode(nav, goal.x, goal.y, goal.z);
      b.path = a && g ? findPath(nav, a.i, g.i) : null;
      b.pathI = 1; b.nextPath = t + 2.5;
      if (!b.path) b.nextGoal = 0;
    }
    if (b.path) {
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
      const e = (1 - b.skill) * 0.07;
      b.errYaw = (Math.random() - 0.5) * 2 * e; b.errPitch = (Math.random() - 0.5) * 2 * e;
    }
    const ty = tp.y + (b.skill > 0.65 ? 1.5 : 1.15) + (tp.crouch ? -0.5 : 0);
    const dx = tp.x - p.x, dz = tp.z - p.z, dy = ty - eyeY, hd = Math.hypot(dx, dz) || 1;
    wantYaw = Math.atan2(-dx, -dz) + b.errYaw;
    wantPitch = Math.atan2(dy, hd) + b.errPitch;
  } else if (moving) {
    wantYaw = Math.atan2(-wx, -wz);
  }
  const turn = (3 + b.skill * 5) * dt;
  const dyaw = angDiff(p.yaw, wantYaw);
  p.yaw += clamp(dyaw, -turn, turn);
  p.pitch += clamp(wantPitch - p.pitch, -turn, turn);
  p.pitch = clamp(p.pitch, -1.3, 1.3);

  // ---- melee when a target is in knife range, an occasional thrown knife at mid range
  if (visible && !frozen && tp && Math.abs(angDiff(p.yaw, wantYaw)) < 0.3) {
    const bd = Math.hypot(tp.x - p.x, tp.z - p.z);
    if (bd < 2 && t > (b.nextMelee || 0)) { b.nextMelee = t + 0.8; room.onMelee(p); }
    else if (bd > 6 && bd < 16 && p.knives > 0 && t > (b.nextThrow || 0) && Math.random() < 0.02) {
      b.nextThrow = t + 4; room.onThrow(p, { o: eye, d: dirFromAngles(p.yaw, p.pitch) });
    }
  }

  // ---- shooting
  if (visible && !frozen && t - b.seenAt > 0.25 + (1 - b.skill) * 0.45 && Math.abs(dyaw) < 0.12) {
    const w = WEAPONS[p.wpn] || WEAPONS.pistol;
    if (t >= b.pauseUntil && t >= b.nextShot) {
      if (b.burstLeft <= 0) b.burstLeft = w.auto ? 4 + ((Math.random() * 8) | 0) : 1;
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
