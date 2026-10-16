// Security cameras: 2-3 wall-mounted cameras per match, placed at random, each swivelling back and forth with a vision cone.
// A player caught inside a cone (with a clear line of sight) is exposed to everyone on the map for EXPOSE seconds.
// Pure and deterministic given (map, seed), so the server and every client agree on where the cameras are and where they point.

import { raycast, hitBox, dirFromAngles } from './physics.js';

export const CAM = {
  range: 26,          // metres
  half: 0.36,         // cone half-angle (rad), about 21 degrees
  pitch: -0.42,       // tilt down toward the floor
  amp: 0.6981,        // swivel +/- radians either side of straight ahead: 80 degrees in total
  period: 9,          // seconds per full back-and-forth (20% slower than before)
  expose: 5,          // seconds a spotted player stays revealed
};

function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Candidate wall mounts: [x, z, inwardYaw]. Walls are at |x| or |z| = 28; we sit just inside the shell. Skips the spawn/base ends of the map. */
function mounts() {
  const out = [];
  for (let u = -22; u <= 22; u += 4) {
    out.push([27.6, u, Math.PI / 2]);        // east wall (x = +27.6) looks toward -x
    out.push([-27.6, u, -Math.PI / 2]);           // west wall looks toward +x
    if (Math.abs(u) >= 11) { out.push([u, 27.6, 0]); out.push([u, -27.6, Math.PI]); }   // north / south walls, clear of the base alcoves
  }
  return out;
}

/** Choose the cameras for a match. Returns [{ x, y, z, yaw, pitch, amp, w, ph }]. count defaults to 2 or 3 (seeded). */
export function buildCameras(map, seed, count) {
  const r = rng(seed), n = count || (r() < 0.5 ? 2 : 3);
  const roofY = map.roofY || 9, y = Math.min(roofY - 1.3, 7.8);
  const cands = mounts().filter(([x, z, yaw]) => {
    if (hitBox(map.boxes, x, y, z, 0.3, 0.4)) return false;
    const d = dirFromAngles(yaw, -0.2);
    const h = raycast(map.boxes, [x, y, z], d, 40);
    return !h || h.t > 12;                                    // needs a long clear view into the arena
  });
  const picked = [];
  let guard = 0;
  while (picked.length < n && cands.length && guard++ < 200) {
    const i = Math.floor(r() * cands.length), c = cands[i];
    if (picked.some(p => Math.hypot(p[0] - c[0], p[1] - c[1]) < 22)) continue;   // spread them out
    picked.push(c);
  }
  for (const c of cands) { if (picked.length >= n) break; if (!picked.includes(c)) picked.push(c); }
  return picked.map(([x, z, yaw]) => ({ x, y, z, yaw, pitch: CAM.pitch, amp: CAM.amp, w: (Math.PI * 2) / CAM.period * (0.85 + r() * 0.3), ph: r() * Math.PI * 2 }));
}

/** Current heading of a camera at time t (seconds since match start). */
export function camYaw(c, t) { return c.yaw + c.amp * Math.sin(c.w * t + c.ph); }

/** Unit vector the camera is looking along. */
export function camDir(c, t) { return dirFromAngles(camYaw(c, t), c.pitch); }

/** True when the point (x,y,z) is inside the cone and not hidden behind scenery. */
export function camSeesPoint(boxes, c, t, x, y, z) {
  const dx = x - c.x, dy = y - c.y, dz = z - c.z, d = Math.hypot(dx, dy, dz);
  if (d > CAM.range || d < 0.5) return false;
  const a = camDir(c, t);
  if ((dx * a[0] + dy * a[1] + dz * a[2]) / d < Math.cos(CAM.half)) return false;
  return !raycast(boxes, [c.x, c.y, c.z], [dx / d, dy / d, dz / d], d - 0.25);
}

/** Does any camera see a player standing at (x,y,z) (feet position)? Checks the head and the chest. Returns the camera index or -1. */
export function camsSee(boxes, cams, t, x, y, z, crouch = false) {
  for (let i = 0; i < cams.length; i++) {
    const c = cams[i];
    if (camSeesPoint(boxes, c, t, x, y + (crouch ? 1.15 : 1.55), z) || camSeesPoint(boxes, c, t, x, y + 0.9, z)) return i;
  }
  return -1;
}
