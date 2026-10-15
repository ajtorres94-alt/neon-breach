// Killstreak rewards and their server-side units (attack dog, sentry gun, barrier, rat swarm, clone).
// Everything here is authoritative: units move, target, shoot and take damage on the server and are sent in each snapshot.

import { P, stepBody, raycast, rayAABB, dirFromAngles, norm3, floorAt, hitBox } from '../shared/physics.js';
import { nearestNode, findPath } from '../shared/nav.js';
import { WEAPONS, STREAK_TIERS, STREAK_OPTIONS, STREAK_UNITS as U } from '../shared/weapons.js';

const nowS = () => Date.now() / 1000;
const r2 = (v) => Math.round(v * 100) / 100;
export const UNIT_WIDS = new Set(['dog', 'sentry', 'rats', 'clone']);
const SENTRY_WEAPON = { dmg: 9, hs: 1, rate: 9, spread: 0.03, adsSpread: 0.03, pellets: 1, range: 40, nofall: false };
const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };

export class Streaks {
  constructor(room) { this.room = room; this.units = []; this.mapOwned = false; }

  reset() { this.units = []; this.mapOwned = false; }

  // ------------------------------------------------------------ earning + choosing
  /** Called when `att` makes a normal kill (not by one of their own units). */
  onKill(att) {
    att.streak = (att.streak || 0) + 1;
    if (!STREAK_TIERS.includes(att.streak)) return;
    att.offers = att.offers || [];
    att.offers.push({ tier: att.streak, until: 0 });
    this.nextOffer(att);
  }
  nextOffer(p) {
    if (!p.offers || !p.offers.length || p.offers[0].until) return;
    const o = p.offers[0]; o.until = nowS() + U.offerTime;
    this.room.emit({ e: 'ksoffer', tier: o.tier, opts: STREAK_OPTIONS[o.tier], ttl: U.offerTime }, p.id);
  }
  onDeath(v) {
    v.streak = 0; v.offers = []; v.helmet = false; v.wall = false;
    // a clone vanishes with its owner; everything else stays
    for (const u of [...this.units]) if (u.type === 'clone' && u.owner === v.id) this.destroy(u, null, true);
  }
  pick(p, optId) {
    const o = p.offers && p.offers[0];
    if (!o || !p.alive || this.room.phase !== 'play' || !STREAK_OPTIONS[o.tier].includes(optId)) return;
    if (!this.activate(p, optId)) { this.room.emit({ e: 'ksfail', k: optId }, p.id); return; }       // e.g. no room for a barrier: keep the offer
    p.offers.shift(); this.nextOffer(p);
  }
  tickOffers(t) {
    for (const p of this.room.players.values()) {
      const o = p.offers && p.offers[0];
      if (o && o.until && t > o.until) {                                  // ran out of time: take the first option that works
        for (const id of STREAK_OPTIONS[o.tier]) if (this.activate(p, id)) break;
        p.offers.shift(); this.nextOffer(p);
      } else if (o && p.bot && o.until && t > o.until - U.offerTime + 1) {
        const opts = STREAK_OPTIONS[o.tier]; this.activate(p, opts[(Math.random() * opts.length) | 0]) || this.activate(p, opts[0]); p.offers.shift(); this.nextOffer(p);
      }
    }
  }

  activate(p, id) {
    const room = this.room, t = nowS();
    let ok = true;
    if (id === 'uav' || id === 'radar') {
      const dur = id === 'uav' ? U.uavTime : U.radarTime;
      for (const q of room.players.values()) if (!q.bot && (q === p || (room.teamMode && q.team === p.team))) room.emit({ e: 'fx', k: id, dur }, q.id);
    } else if (id === 'helmet') { p.helmet = true; room.emit({ e: 'fx', k: 'helmet' }, p.id); }
    else if (id === 'wall') { p.wall = true; room.emit({ e: 'fx', k: 'wall' }, p.id); }
    else if (id === 'dog') { const q = this.spawnPos(p, 1.0); this.addUnit(p, 'dog', q[0], p.y, q[1]); }
    else if (id === 'sentry') ok = this.placeSentry(p);
    else if (id === 'barrier') ok = this.placeBarrier(p);
    else if (id === 'rats') { const q = this.spawnPos(p, 1.4); this.addUnit(p, 'rats', q[0], p.y, q[1]); }
    else if (id === 'clone') this.addUnit(p, 'clone', p.x + Math.cos(p.yaw) * U.clone.offset, p.y, p.z - Math.sin(p.yaw) * U.clone.offset);
    if (ok) room.emit({ e: 'ksann', id: p.id, k: id });
    return ok;
  }

  // ------------------------------------------------------------ units
  addUnit(p, type, x, y, z) {
    const room = this.room, cfg = U[type];
    const u = {
      id: room.nextId++, unit: null, type, owner: p.id, ownerId: p.id, team: p.team, x, y, z, yaw: p.yaw, pitch: 0, hp: cfg.hp, max: cfg.hp,
      born: nowS(), alive: true, owned: new Set(), lastFire: {}, body: { x, y, z, vx: 0, vy: 0, vz: 0, grounded: true, crouch: false }, path: null, nextPath: 0, pathI: 1, nextBite: 0, ammo: cfg.rounds || 0,
    };
    u.unit = u;
    if (type === 'clone') { let w = p.wpn; if (!WEAPONS[w] || WEAPONS[w].kind === 'rocket') w = 'rifle'; u.w = w; u.owned.add(w); u.op = p.op; u.pitch = p.pitch; }
    this.units.push(u);
    return u;
  }
  /** A free spot beside the player (right-hand side, then left, then on top of them). */
  spawnPos(p, d) {
    const boxes = this.room.map.boxes;
    for (const s of [1, -1]) { const x = p.x + Math.cos(p.yaw) * d * s, z = p.z - Math.sin(p.yaw) * d * s; if (!hitBox(boxes, x, p.y + 0.1, z, 0.4, 1.0)) return [x, z]; }
    return [p.x, p.z];
  }
  playerOf(u) { return this.room.players.get(u.owner) || null; }
  enemies(u) {
    const room = this.room, out = [];
    for (const o of room.players.values()) {
      if (!o.alive || o.id === u.owner) continue;
      if (room.teamMode && o.team === u.team) continue;
      out.push(o);
    }
    return out;
  }
  nearestEnemy(u, needLOS, maxD = 1e9, eyeH = 0.7) {
    const boxes = this.room.map.boxes; let best = null, bd = maxD;
    for (const o of this.enemies(u)) {
      const d = Math.hypot(o.x - u.x, o.y - u.y, o.z - u.z); if (d >= bd) continue;
      if (needLOS) {
        const o3 = [u.x, u.y + eyeH, u.z], dx = o.x - u.x, dy = o.y + 1.2 - (u.y + eyeH), dz = o.z - u.z, L = Math.hypot(dx, dy, dz);
        if (raycast(boxes, o3, [dx / L, dy / L, dz / L], L - 0.4)) continue;
      }
      bd = d; best = o;
    }
    return best;
  }

  placeSentry(p) {
    const f = [-Math.sin(p.yaw), -Math.cos(p.yaw)], boxes = this.room.map.boxes;
    for (const dist of [2.2, 1.7, 1.2]) {
      const x = p.x + f[0] * dist, z = p.z + f[1] * dist, y = Math.max(p.y, floorAt(boxes, x, z, p.y + 0.6));
      if (hitBox(boxes, x, y + 0.05, z, 0.4, 1.1)) continue;
      const u = this.addUnit(p, 'sentry', x, y, z); u.yaw = p.yaw; return true;
    }
    return false;
  }

  /** A wall across the hallway ahead of the player: measures free width to the side walls and spans it (capped). */
  placeBarrier(p) {
    const room = this.room, C = U.barrier, f = [-Math.sin(p.yaw), -Math.cos(p.yaw)];
    for (const dist of [2.4, 3.2, 4.2]) {
      const cx = p.x + f[0] * dist, cz = p.z + f[1] * dist, y = Math.max(p.y, floorAt(room.map.boxes, cx, cz, p.y + 0.6));
      const alongX = Math.abs(f[0]) < Math.abs(f[1]);                       // looking mostly along z -> the wall runs along x
      const org = [cx, y + 1.0, cz], dA = alongX ? [1, 0, 0] : [0, 0, 1], dB = alongX ? [-1, 0, 0] : [0, 0, -1];
      const ha = raycast(room.map.boxes, org, dA, C.maxSide), hb = raycast(room.map.boxes, org, dB, C.maxSide);
      const ea = (ha ? ha.t : C.maxSide * 0.5) + (ha ? 0.12 : 0), eb = (hb ? hb.t : C.maxSide * 0.5) + (hb ? 0.12 : 0);
      if (ea + eb < 1.2) continue;
      const half = C.thick / 2;
      const box = alongX
        ? { x0: cx - eb, x1: cx + ea, z0: cz - half, z1: cz + half, y0: y, y1: y + C.height }
        : { x0: cx - half, x1: cx + half, z0: cz - eb, z1: cz + ea, y0: y, y1: y + C.height };
      if ([...room.players.values()].some(q => q.alive && q.x > box.x0 - 0.45 && q.x < box.x1 + 0.45 && q.z > box.z0 - 0.45 && q.z < box.z1 + 0.45 && q.y < box.y1 && q.y + 1.8 > box.y0)) continue;
      if (this.units.some(u => u.type === 'barrier' && u.box.x0 < box.x1 && u.box.x1 > box.x0 && u.box.z0 < box.z1 && u.box.z1 > box.z0 && u.box.y0 < box.y1 && u.box.y1 > box.y0)) continue;
      box.mat = 'barrier';
      if (!this.mapOwned) { room.map = { ...room.map, boxes: room.map.boxes.slice() }; this.mapOwned = true; }
      room.map.boxes.push(box);
      const u = this.addUnit(p, 'barrier', cx, y, cz); u.box = box; u.yaw = alongX ? 0 : Math.PI / 2;
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------ damage
  boxOf(u) {
    if (u.type === 'barrier') return u.box;
    const c = U[u.type], r = c.r, h = c.h;
    return { x0: u.x - r, x1: u.x + r, y0: u.y, y1: u.y + h, z0: u.z - r, z1: u.z + r };
  }
  /** Nearest unit hit by a ray (ignoring friendly units of the shooter's own team and the shooter's own units). */
  hitUnits(o, d, maxT, shooter) {
    let best = null, bt = maxT + 1e-6;
    for (const u of this.units) {
      if (!u.alive || this.friendly(u, shooter)) continue;
      const b = this.boxOf(u), tt = rayAABB(o[0], o[1], o[2], d[0], d[1], d[2], b.x0, b.y0, b.z0, b.x1, b.y1, b.z1);
      if (tt >= 0 && tt <= bt && (u.type === 'barrier' || tt < maxT)) { bt = tt; best = u; }
    }
    return best ? { unit: best, t: bt } : null;
  }
  friendly(u, shooter) {
    if (!shooter) return false;
    if (u.owner === shooter.id || (shooter.unit && shooter.unit.owner === u.owner)) return true;
    return this.room.teamMode && u.team === shooter.team;
  }
  damage(u, amt, att, wid) {
    if (!u.alive) return;
    if (att && this.friendly(u, att)) return;
    u.hp -= amt;
    if (att && att.id != null && !att.unit) this.room.emit({ e: 'hit', hs: false, kill: u.hp <= 0 }, att.id);
    if (u.hp <= 0) this.destroy(u, att, false);
  }
  destroy(u, att, quiet) {
    if (!u.alive) return;
    u.alive = false;
    this.units = this.units.filter(x => x !== u);
    if (u.type === 'barrier' && u.box) { const bx = this.room.map.boxes, i = bx.indexOf(u.box); if (i >= 0) bx.splice(i, 1); }
    const room = this.room;
    if (!quiet) {
      room.emit({ e: 'ukill', id: u.id, k: u.type, x: r2(u.x), y: r2(u.y + 0.6), z: r2(u.z), a: att && !att.unit ? att.id : null });
      if (u.type === 'sentry' || u.type === 'barrier') room.emit({ e: 'boom', x: r2(u.x), y: r2(u.y + 0.8), z: r2(u.z), r: 2.5 });
    }
  }
  /** Radial damage from explosions. */
  blast(pos, radius, maxDmg, minDmg, owner, wid) {
    for (const u of [...this.units]) {
      if (this.friendly(u, owner)) continue;
      const b = this.boxOf(u), cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, cz = (b.z0 + b.z1) / 2;
      const nx = Math.max(b.x0, Math.min(pos[0], b.x1)), ny = Math.max(b.y0, Math.min(pos[1], b.y1)), nz = Math.max(b.z0, Math.min(pos[2], b.z1));
      const d = Math.hypot(nx - pos[0], ny - pos[1], nz - pos[2]); if (d > radius) continue;
      this.damage(u, maxDmg + (minDmg - maxDmg) * (d / radius), owner, wid);
    }
  }
  /** Melee swing / thrown knife against units in front of a player. */
  melee(p, range, dmg) {
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    for (const u of [...this.units]) {
      if (this.friendly(u, p) || u.type === 'barrier') continue;
      const dx = u.x - p.x, dz = u.z - p.z, d = Math.hypot(dx, dz);
      if (d > range + 0.5 || (d > 0.1 && (dx * fx + dz * fz) / d < 0.3)) continue;
      this.damage(u, dmg, p, 'melee'); return true;
    }
    return false;
  }

  // ------------------------------------------------------------ per tick
  steer(u, goal, f, t, dt, sprint) {
    const room = this.room, nav = room.map.nav, b = u.body;
    let wx = 0, wz = 0;
    if (!u.path || t >= u.nextPath) {
      const a = nearestNode(nav, b.x, b.y, b.z), g = nearestNode(nav, goal.x, goal.y, goal.z);
      u.path = a && g ? findPath(nav, a.i, g.i) : null; u.pathI = 1; u.nextPath = t + 0.8;
    }
    if (u.path) {
      while (u.pathI < u.path.length) { const n = nav.nodes[u.path[u.pathI]]; if (Math.hypot(n.x - b.x, n.z - b.z) < 0.8 && Math.abs(n.y - b.y) < 1.2) u.pathI++; else break; }
      if (u.pathI < u.path.length) { const n = nav.nodes[u.path[u.pathI]]; const dx = n.x - b.x, dz = n.z - b.z, d = Math.hypot(dx, dz) || 1; wx = dx / d; wz = dz / d; }
      else { const dx = goal.x - b.x, dz = goal.z - b.z, d = Math.hypot(dx, dz) || 1; wx = dx / d; wz = dz / d; }
    }
    if (Math.hypot(goal.x - b.x, goal.z - b.z) < 2.5) { const dx = goal.x - b.x, dz = goal.z - b.z, d = Math.hypot(dx, dz) || 1; wx = dx / d; wz = dz / d; }   // close: go straight
    this.drive(u, wx, wz, f, sprint, t, dt);
  }
  drive(u, wx, wz, f, sprint, t, dt) {
    const b = u.body;
    if (Math.hypot(wx, wz) < 0.01) { stepBody(this.room.map.boxes, b, { f: 0, r: 0, yaw: 0, jump: false, crouch: false, ads: false }, dt); }
    else {
      const yaw = Math.atan2(-wx, -wz);
      // stuck: hop / sidestep
      if (t >= (u.nextCheck || 0)) { u.nextCheck = t + 0.5; u.stuck = Math.hypot(b.x - (u.lx ?? 1e9), b.z - (u.lz ?? 1e9)) < 0.15; u.lx = b.x; u.lz = b.z; if (u.stuck) u.nextPath = 0; }
      stepBody(this.room.map.boxes, b, { f, r: 0, yaw, jump: !!u.stuck, crouch: false, ads: false, sprint }, dt);
      u.faceYaw = yaw;
    }
    u.x = b.x; u.y = b.y; u.z = b.z;
  }

  tick(dt, t) {
    const room = this.room;
    this.tickOffers(t);
    for (const u of [...this.units]) {
      if (!u.alive) continue;
      if (u.type !== 'barrier' && u.y < -12) { this.destroy(u, null, true); continue; }
      if (t - u.born > U[u.type].life) { this.destroy(u, null, u.type !== 'sentry'); continue; }
      const own = this.playerOf(u);
      if (u.type === 'dog') this.tickDog(u, dt, t);
      else if (u.type === 'rats') this.tickRats(u, dt, t);
      else if (u.type === 'sentry') this.tickSentry(u, dt, t);
      else if (u.type === 'clone') { if (!own || !own.alive) this.destroy(u, null, true); else this.tickClone(u, own, dt, t); }
    }
  }

  tickDog(u, dt, t) {
    const C = U.dog, tg = this.nearestEnemy(u, false); if (!tg) { this.drive(u, 0, 0, 0, false, t, dt); return; }
    const d = Math.hypot(tg.x - u.x, tg.z - u.z);
    if (d > 1.2) this.steer(u, tg, 1, t, dt, true); else this.drive(u, 0, 0, 0, false, t, dt);
    if (u.faceYaw != null) u.yaw += angDiff(u.yaw, u.faceYaw) * Math.min(1, dt * 12);
    if (d < 1.7 && Math.abs(tg.y - u.y) < 1.5 && t >= u.nextBite) {
      u.nextBite = t + C.biteEvery; u.yaw = Math.atan2(-(tg.x - u.x), -(tg.z - u.z));
      this.room.emit({ e: 'bite', id: u.id, x: r2(u.x), y: r2(u.y + 0.4), z: r2(u.z) });
      this.room.damage(tg, C.bite, u, 'dog', false, true);
    }
  }

  tickRats(u, dt, t) {
    const C = U.rats, tg = this.nearestEnemy(u, false);
    if (tg) { this.steer(u, tg, C.speed / P.walk, t, dt, false); if (u.faceYaw != null) u.yaw += angDiff(u.yaw, u.faceYaw) * Math.min(1, dt * 8); }
    else this.drive(u, 0, 0, 0, false, t, dt);
    const near = this.enemies(u).filter(o => Math.hypot(o.x - u.x, o.z - u.z) < 1.9 && Math.abs(o.y - u.y) < 1.6);
    for (const o of near) { u.acc = (u.acc || {}); u.acc[o.id] = (u.acc[o.id] || 0) + C.dps / near.length * dt; if (u.acc[o.id] >= 1) { const a = Math.floor(u.acc[o.id]); u.acc[o.id] -= a; this.room.damage(o, a, u, 'rats', false, true); } }
  }

  tickSentry(u, dt, t) {
    const C = U.sentry, o3 = [u.x, u.y + 1.0, u.z];
    if (u.ammo <= 0) { this.destroy(u, null, false); return; }
    let tg = this.nearestEnemy(u, true, C.range, 1.0);
    if (!tg) { u.yaw += dt * 0.5; u.pitch *= 0.9; return; }
    const dx = tg.x - o3[0], dy = tg.y + 1.2 - o3[1], dz = tg.z - o3[2], L = Math.hypot(dx, dy, dz);
    const wantYaw = Math.atan2(-dx, -dz), wantPitch = Math.asin(dy / L);
    const dyaw = angDiff(u.yaw, wantYaw), turn = C.turn * dt;
    u.yaw += Math.max(-turn, Math.min(turn, dyaw)); u.pitch += Math.max(-turn, Math.min(turn, wantPitch - u.pitch));
    if (Math.abs(dyaw) < 0.12 && t - (u.lastFire.sentry || 0) >= 1 / C.rate) {
      const dir = dirFromAngles(u.yaw, u.pitch), muzzle = [o3[0] + dir[0] * 0.8, o3[1] + dir[1] * 0.8, o3[2] + dir[2] * 0.8];
      u.ammo--; u.owned.add('sentry');
      this.room.fire(u, 'sentry', muzzle, dir, false);
    }
  }

  tickClone(u, own, dt, t) {
    const C = U.clone, b = u.body;
    const want = { x: own.x + Math.cos(own.yaw) * C.offset, z: own.z - Math.sin(own.yaw) * C.offset };
    let tgx = want.x - b.x, tgz = want.z - b.z, dist = Math.hypot(tgx, tgz);
    if (dist > 4) {                                                        // fell behind: reappear beside the owner
      b.x = want.x; b.y = own.y; b.z = want.z; b.vx = b.vy = b.vz = 0; dist = 0; tgx = tgz = 0;
    }
    const sp = Math.hypot(own.x - (u.ox ?? own.x), own.z - (u.oz ?? own.z)) / dt; u.ox = own.x; u.oz = own.z;
    if (dist > 0.12) this.drive(u, tgx / dist, tgz / dist, Math.min(1, dist * 3) * (sp > 8.5 ? 1.3 : 1), sp > 8.5, t, dt);
    else this.drive(u, 0, 0, 0, false, t, dt);
    u.y = b.y;
    // aim at the nearest visible enemy, otherwise copy the owner's look direction
    const tg = this.nearestEnemy(u, true, C.range, 1.5);
    let wy = own.yaw, wp = own.pitch;
    if (tg) { const dx = tg.x - u.x, dy = tg.y + 1.25 - (u.y + 1.5), dz = tg.z - u.z; wy = Math.atan2(-dx, -dz); wp = Math.atan2(dy, Math.hypot(dx, dz)); }
    u.yaw += angDiff(u.yaw, wy) * Math.min(1, dt * 10); u.pitch += (wp - u.pitch) * Math.min(1, dt * 10);
    u.crouch = own.crouch;
    if (tg && Math.abs(angDiff(u.yaw, wy)) < 0.1) {
      const w = WEAPONS[u.w], eye = [u.x, u.y + 1.5, u.z];
      if (!u.nextShot || t >= u.nextShot) { u.nextShot = t + 1 / w.rate + (w.auto ? 0 : 0.2); const e = (Math.random() - 0.5) * 0.04; this.room.fire(u, u.w, eye, norm3(dirFromAngles(u.yaw + e, u.pitch + e)), false); }
    }
  }

  // ------------------------------------------------------------ snapshot
  snapshot() {
    return this.units.map(u => {
      const o = { i: u.id, ty: u.type, x: r2(u.x), y: r2(u.y), z: r2(u.z), a: r2(u.yaw), h: Math.max(0, Math.round(u.hp)), m: u.max, tm: u.team, o: u.owner };
      if (u.type === 'sentry') { o.p = r2(u.pitch); o.am = u.ammo; }
      else if (u.type === 'barrier') { o.bx = [r2(u.box.x0), r2(u.box.x1), r2(u.box.z0), r2(u.box.z1), r2(u.box.y0), r2(u.box.y1)]; }
      else if (u.type === 'clone') { o.p = r2(u.pitch); o.w = u.w; o.op = u.op; o.c = u.crouch ? 1 : 0; }
      return o;
    });
  }
}
