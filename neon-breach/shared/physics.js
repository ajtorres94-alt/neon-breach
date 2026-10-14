// Shared player physics + ray queries. Used by the browser client (own movement),
// the server (bots, validation, hitscan) and the map validator.
// World: Y up. A player is an AABB (feet-centre position, half-width P.r).
// Looking direction at yaw=0,pitch=0 is -Z. forward = (-sin yaw, -cos yaw).

export const P = Object.freeze({
  r: 0.35, h: 1.8, hc: 1.15, eye: 1.62, eyec: 1.0,
  step: 0.55, walk: 6.4, crouchSpeed: 3.2, jump: 8.2, gravity: 24,
});

const E = 1e-4;

/** First box overlapping the player AABB at (x,y,z) with half-width r and height h, or null. */
export function hitBox(boxes, x, y, z, r, h) {
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (x + r > b.x0 + E && x - r < b.x1 - E && y + h > b.y0 + E && y < b.y1 - E &&
        z + r > b.z0 + E && z - r < b.z1 - E) return b;
  }
  return null;
}

/** Height of the highest box top at (x,z) that is <= maxY (or -Infinity). */
export function floorAt(boxes, x, z, maxY) {
  let best = -Infinity;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && b.y1 <= maxY + E && b.y1 > best) best = b.y1;
  }
  return best;
}

export function newBody(x = 0, y = 0, z = 0) {
  return { x, y, z, vx: 0, vy: 0, vz: 0, grounded: false, crouch: false };
}

function approach(v, target, amt) {
  if (v < target) return Math.min(v + amt, target);
  return Math.max(v - amt, target);
}

function stepOnce(boxes, s, inp, dt) {
  // crouch / uncrouch (only if there is headroom)
  if (inp.crouch) s.crouch = true;
  else if (s.crouch && !hitBox(boxes, s.x, s.y, s.z, P.r, P.h)) s.crouch = false;
  const h = s.crouch ? P.hc : P.h;

  const sy = Math.sin(inp.yaw), cy = Math.cos(inp.yaw);
  let wx = -sy * inp.f + cy * inp.r;
  let wz = -cy * inp.f - sy * inp.r;
  const len = Math.hypot(wx, wz);
  if (len > 1) { wx /= len; wz /= len; }
  let sp = s.crouch ? P.crouchSpeed : P.walk;
  if (inp.ads) sp *= 0.7;
  const acc = (s.grounded ? 60 : 14) * dt;
  s.vx = approach(s.vx, wx * sp, acc);
  s.vz = approach(s.vz, wz * sp, acc);

  if (inp.jump && s.grounded && !s.crouch) { s.vy = P.jump; s.grounded = false; }
  s.vy = Math.max(s.vy - P.gravity * dt, -50);

  // --- vertical
  s.y += s.vy * dt;
  let b = hitBox(boxes, s.x, s.y, s.z, P.r, h);
  if (b) {
    if (s.vy <= 0) { s.y = b.y1; s.grounded = true; }
    else { s.y = b.y0 - h - 2 * E; s.grounded = false; }
    s.vy = 0;
  } else s.grounded = false;

  // --- horizontal (axis separated, with step-up)
  for (const axis of ['x', 'z']) {
    const vk = axis === 'x' ? 'vx' : 'vz';
    s[axis] += s[vk] * dt;
    for (let it = 0; it < 4; it++) {
      b = hitBox(boxes, s.x, s.y, s.z, P.r, h);
      if (!b) break;
      const rise = b.y1 - s.y;
      if (s.grounded && rise > 0 && rise <= P.step + E && !hitBox(boxes, s.x, b.y1 + 2 * E, s.z, P.r, h)) {
        s.y = b.y1; continue;
      }
      const lo = axis === 'x' ? b.x0 : b.z0, hi = axis === 'x' ? b.x1 : b.z1;
      const v = s[vk];
      const pushLow = v > 0 ? true : v < 0 ? false : (s[axis] < (lo + hi) / 2);
      s[axis] = pushLow ? lo - P.r - 2 * E : hi + P.r + 2 * E;
      s[vk] = 0;
    }
  }
}

/** Advance a body by dt (sub-stepped to avoid tunnelling). inp = {f,r,yaw,jump,crouch,ads}. */
export function stepBody(boxes, s, inp, dt) {
  const n = Math.max(1, Math.ceil(dt / (1 / 60)));
  for (let i = 0; i < n; i++) stepOnce(boxes, s, inp, dt / n);
}

/** Ray vs AABB -> distance t (>=0) or -1. */
export function rayAABB(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1) {
  const ix = 1 / (dx || 1e-12), iy = 1 / (dy || 1e-12), iz = 1 / (dz || 1e-12);
  let t1 = (x0 - ox) * ix, t2 = (x1 - ox) * ix;
  let tn = Math.min(t1, t2), tf = Math.max(t1, t2);
  t1 = (y0 - oy) * iy; t2 = (y1 - oy) * iy;
  tn = Math.max(tn, Math.min(t1, t2)); tf = Math.min(tf, Math.max(t1, t2));
  t1 = (z0 - oz) * iz; t2 = (z1 - oz) * iz;
  tn = Math.max(tn, Math.min(t1, t2)); tf = Math.min(tf, Math.max(t1, t2));
  if (tf < tn || tf < 0) return -1;
  return Math.max(tn, 0);
}

/** Nearest world box hit by a ray: {t, box, n:[x,y,z]} or null. o,d are [x,y,z] arrays; d normalised. */
export function raycast(boxes, o, d, maxT) {
  let best = maxT, hit = null;
  const ox = o[0], oy = o[1], oz = o[2], dx = d[0], dy = d[1], dz = d[2];
  const ix = 1 / (dx || 1e-12), iy = 1 / (dy || 1e-12), iz = 1 / (dz || 1e-12);
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    let t1 = (b.x0 - ox) * ix, t2 = (b.x1 - ox) * ix;
    let tn = Math.min(t1, t2), tf = Math.max(t1, t2), ax = 0;
    t1 = (b.y0 - oy) * iy; t2 = (b.y1 - oy) * iy;
    let a = Math.min(t1, t2), c = Math.max(t1, t2);
    if (a > tn) { tn = a; ax = 1; } if (c < tf) tf = c;
    t1 = (b.z0 - oz) * iz; t2 = (b.z1 - oz) * iz;
    a = Math.min(t1, t2); c = Math.max(t1, t2);
    if (a > tn) { tn = a; ax = 2; } if (c < tf) tf = c;
    if (tf >= tn && tf > 0 && tn >= 0 && tn < best) { best = tn; hit = { t: tn, box: b, ax }; }
  }
  if (hit) {
    const dd = [dx, dy, dz];
    hit.n = [0, 0, 0];
    hit.n[hit.ax] = -Math.sign(dd[hit.ax]) || 1;
  }
  return hit;
}

export function dirFromAngles(yaw, pitch) {
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
}

export function norm3(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
