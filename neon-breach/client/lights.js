// Dynamic map lighting: fluorescent ceiling tubes (at the ceiling strip positions), floor uplights and four wall-mounted floodlights, generated deterministically from each map.
// Up to 8 lights are active per frame (the nearest ones, plus transient muzzle flashes / explosions); every lamp also has a visible fixture.
import { hitBox } from '/shared/physics.js';
const W = 28;
const hash = (a) => { let h = 2166136261; for (const ch of String(a)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); h ^= h >>> 15; return (h >>> 0) % 10000 / 10000; };
const PAL = [[1.0, 0.9, 0.7], [0.75, 0.88, 1.0], [1.0, 0.8, 0.55], [0.8, 1.0, 0.85]];
const FLOORC = [[0.2, 0.9, 1.0], [1.0, 0.25, 0.7], [1.0, 0.65, 0.15], [0.45, 1.0, 0.45]];

export function buildLights(map) {
  const roofY = map.roofY || 9, id = map.id || 'x', pal = PAL[Math.floor(hash(id) * PAL.length)], fc = [FLOORC[Math.floor(hash(id + 'f') * 4)], FLOORC[Math.floor(hash(id + 'g') * 4)]];
  const dim = Math.max(0.55, 1.35 - map.theme.light * 0.4);
  const L = [];
  let i = 0;
  if (!map.open) for (const x of [-18, -6, 6, 18]) for (const z of [-21, -7, 7, 21]) {   // fluorescent tube fixtures (covered halls only) where the ceiling light strips are (see enclose() in shared/maps.js)
    const r = hash(id + 'o' + i++);
    L.push({ kind: 'tube', x, y: roofY - 0.5, z, r: 17, c: [0.78, 0.92, 1.0].map(v => v * 0.62 * dim), dir: null, flick: r < 0.14 ? 1 : 0, ph: r * 50 });
  }
  i = 0;
  for (let k = -24; k <= 24; k += 8) {                                              // floor uplights along the four walls
    for (const [x, z, nx, nz] of [[k, -(W - 0.5), 0, 1], [k, W - 0.5, 0, -1], [-(W - 0.5), k, 1, 0], [W - 0.5, k, -1, 0]]) {
      const c = fc[i++ & 1], r = hash(id + 'u' + i);
      L.push({ kind: 'floor', x: x + nx * 0.3, y: 0.45, z: z + nz * 0.3, nx, nz, r: 8, c: c.map(v => v * 0.6 * dim), dir: null, flick: r < 0.12 ? 1 : 0, ph: r * 40 });
    }
  }
  // four wall-mounted floodlights in a pinwheel: each sits on a different wall and throws a warm pool across the arena towards the opposite side
  const fy = Math.min(roofY - 2.0, 6.2);
  const FL = [{ x: -14, z: -27.6, nx: 0, nz: 1, tx: 6, tz: 8 }, { x: 14, z: 27.6, nx: 0, nz: -1, tx: -6, tz: -8 }, { x: -27.6, z: 10, nx: 1, nz: 0, tx: 8, tz: -8 }, { x: 27.6, z: -10, nx: -1, nz: 0, tx: -8, tz: 8 }];
  for (const f of FL) {
    let { x, z } = f;
    for (let k = 0; k < 8 && hitBox(map.boxes, x, fy, z, 0.5, 0.6); k++) { const st = (k % 2 ? 1 : -1) * 2 * (1 + (k >> 1)); if (f.nx) z = f.z + st; else x = f.x + st; }   // slide along the wall if something is in the way
    const px = x + f.nx * 0.5, pz = z + f.nz * 0.5, dx = f.tx - px, dy = -fy, dz = f.tz - pz, n = Math.hypot(dx, dy, dz);
    L.push({ kind: 'flood', x: px, y: fy, z: pz, wx: x, wz: z, nx: f.nx, nz: f.nz, r: 44, c: [1.0, 0.86, 0.58].map(v => v * 1.7 * dim), dir: [dx / n, dy / n, dz / n], cone: 0.66, flick: 0, ph: 0 });
  }
  return { list: L, roofY };
}

function intensity(l, t) {
  if (l.flick) { const s = Math.sin(t * 31 + l.ph) * Math.sin(t * 7.3 + l.ph * 2); return s > 0.55 ? 0.15 : s < -0.8 ? 0.5 : 1; }
  if (l.kind === 'floor') return 0.8 + 0.2 * Math.sin(t * 2.2 + l.ph);
  return 1;
}
function aim(l, t) {                                                                  // flood lights sweep a circle around the arena floor
  const a = t * 0.45 * l.sweep + l.ph, tx = Math.cos(a) * 11, tz = Math.sin(a) * 11, ty = 0;
  const dx = tx - l.x, dy = ty - l.y, dz = tz - l.z, n = Math.hypot(dx, dy, dz);
  return [dx / n, dy / n, dz / n, tx, tz];
}

/** Choose and upload the 8 most relevant lights for this frame. extra: transient lights (muzzle flashes, explosions) that take priority. */
export function updateLights(R, built, cam, t, extra = []) {
  const act = [];
  for (const e of extra) act.push(e);
  const cands = [];
  for (const l of built.list) {
    const k = intensity(l, t), c = l.c.map(v => v * k);
    const o = { x: l.x, y: l.y, z: l.z, r: l.r, c, dir: l.dir, cone: l.cone };
    if (l.kind === 'flood' && l.sweep) { const a = aim(l, t); o.dir = [a[0], a[1], a[2]]; }
    const score = Math.hypot(l.x - cam.x, l.y - cam.y, l.z - cam.z) - l.r * 0.65;
    cands.push([score, o]);
  }
  cands.sort((a, b) => a[0] - b[0]);
  for (const [, o] of cands) { if (act.length >= 8) break; act.push(o); }
  R.setLights(act);
}

/** Opaque fixtures: lamp housings, floor light bases, fluorescent tubes. Only those near the camera are drawn. */
export function drawFixtures(R, built, cam, t) {
  const roofY = built.roofY;
  for (const l of built.list) {
    const d = Math.hypot(l.x - cam.x, l.z - cam.z); if (d > 55) continue;
    const k = intensity(l, t), glow = Math.min(1, k), c = l.c.map(v => Math.min(1, v / 0.9));
    if (l.kind === 'tube') {
      for (const sx of [-0.3, 0.3]) {                                                                                 // two fluorescent tubes in a ribbed housing
        R.rbox(l.x + sx, roofY - 0.17, l.z, 0.1, 0.07, 5.5, 0, 0, c.map(v => 0.55 + v * 0.45), 0.03, glow);
        R.rbox(l.x + sx, roofY - 0.17, l.z, 0.16, 0.035, 5.62, 0, 0, [0.06, 0.07, 0.08], 0.012);
      }
      for (const ez of [-2.8, 2.8]) R.rbox(l.x, roofY - 0.15, l.z + ez, 0.9, 0.08, 0.12, 0, 0, [0.12, 0.13, 0.15], 0.02);   // end caps
    } else if (l.kind === 'flood') {                                                                                   // wall-mounted floodlight: plate, yoke, finned housing, glowing lens
      const d = l.dir, yaw = Math.atan2(-d[0], -d[2]), pit = Math.asin(d[1]), hot = [1, 0.93, 0.78];
      const K = 1.45;                                                                                                                           // fixture scale
      R.rbox(l.wx + l.nx * 0.04, l.y, l.wz + l.nz * 0.04, l.nx ? 0.08 : 0.7, 0.7, l.nz ? 0.08 : 0.7, 0, 0, [0.1, 0.11, 0.13], 0.015, 0, 1, 0.4);   // wall plate
      R.tube(l.wx + l.nx * 0.06, l.y, l.wz + l.nz * 0.06, l.x, l.y + 0.02, l.z, 0.07, 0.07, [0.09, 0.1, 0.12], 0.4);                          // arm
      const hx = l.x + d[0] * 0.3, hy = l.y + d[1] * 0.3, hz = l.z + d[2] * 0.3;
      R.rbox(hx, hy, hz, 0.64 * K, 0.44 * K, 0.34 * K, yaw, pit, [0.13, 0.14, 0.16], 0.05, 0, 1, 0.55);                                        // housing
      const rx = Math.cos(yaw), rz = -Math.sin(yaw);
      for (let f = -2; f <= 2; f++) R.rbox(hx + rx * f * 0.17 - d[0] * 0.07, hy + 0.34 - d[1] * 0.07, hz + rz * f * 0.17 - d[2] * 0.07, 0.05, 0.07, 0.34, yaw, pit, [0.07, 0.08, 0.09], 0.005);   // cooling fins on top
      R.rbox(hx + d[0] * 0.254, hy + d[1] * 0.254, hz + d[2] * 0.254, 0.56 * K, 0.36 * K, 0.04, yaw, pit, hot, 0.015, 0.95 * glow + 0.05);      // lens
      R.rbox(hx + d[0] * 0.232, hy + d[1] * 0.232, hz + d[2] * 0.232, 0.68 * K, 0.48 * K, 0.04, yaw, pit, [0.06, 0.06, 0.07], 0.012);          // bezel
    } else if (l.kind === 'floor') {
      R.rbox(l.x, 0.1, l.z, 0.46, 0.2, 0.2, Math.atan2(l.nx, l.nz) * 0 + (l.nx ? Math.PI / 2 : 0), 0, [0.16, 0.17, 0.2], 0.03, 0, 1, 0.5);
      R.rbox(l.x, 0.24, l.z, 0.38, 0.05, 0.14, (l.nx ? Math.PI / 2 : 0), 0, c, 0.02, glow);
    }
  }
}

/** Soft volumetric beams: none now that the cone lamps and flood lights are gone (kept so callers stay valid). */
export function drawBeams() {}
