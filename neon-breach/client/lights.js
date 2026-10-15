// Dynamic map lighting: ceiling lamps, floor uplights and sweeping flood lights, generated deterministically from each map.
// Up to 8 lights are active per frame (the nearest ones, plus transient muzzle flashes / explosions); every lamp also has a visible fixture.
const W = 28;
const hash = (a) => { let h = 2166136261; for (const ch of String(a)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); h ^= h >>> 15; return (h >>> 0) % 10000 / 10000; };
const PAL = [[1.0, 0.9, 0.7], [0.75, 0.88, 1.0], [1.0, 0.8, 0.55], [0.8, 1.0, 0.85]];
const FLOORC = [[0.2, 0.9, 1.0], [1.0, 0.25, 0.7], [1.0, 0.65, 0.15], [0.45, 1.0, 0.45]];

export function buildLights(map) {
  const roofY = map.roofY || 9, id = map.id || 'x', pal = PAL[Math.floor(hash(id) * PAL.length)], fc = [FLOORC[Math.floor(hash(id + 'f') * 4)], FLOORC[Math.floor(hash(id + 'g') * 4)]];
  const dim = Math.max(0.55, 1.35 - map.theme.light * 0.4);
  const L = [];
  let i = 0;
  for (const x of [-18, -6, 6, 18]) for (const z of [-21, -7, 7, 21]) {            // overhead lamps hung from the roof strips
    const r = hash(id + 'o' + i++);
    L.push({ kind: 'over', x, y: roofY - 0.7, z, r: 17, c: pal.map(v => v * 0.55 * dim), dir: [0, -1, 0], cone: 0.5, flick: r < 0.2 ? 1 : 0, ph: r * 50 });
  }
  i = 0;
  for (let k = -24; k <= 24; k += 8) {                                              // floor uplights along the four walls
    for (const [x, z, nx, nz] of [[k, -(W - 0.5), 0, 1], [k, W - 0.5, 0, -1], [-(W - 0.5), k, 1, 0], [W - 0.5, k, -1, 0]]) {
      const c = fc[i++ & 1], r = hash(id + 'u' + i);
      L.push({ kind: 'floor', x: x + nx * 0.3, y: 0.45, z: z + nz * 0.3, nx, nz, r: 8, c: c.map(v => v * 0.6 * dim), dir: null, flick: r < 0.12 ? 1 : 0, ph: r * 40 });
    }
  }
  const fl = [[-W + 1, -W + 1], [W - 1, -W + 1], [-W + 1, W - 1], [W - 1, W - 1], [0, -W + 0.6], [0, W - 0.6], [-W + 0.6, 0], [W - 0.6, 0]];
  fl.forEach(([x, z], k) => L.push({ kind: 'flood', x, y: roofY - 1.4, z, r: 36, c: (k < 4 ? [1, 0.97, 0.88] : [0.85, 0.93, 1]).map(v => v * 0.75 * dim), dir: [0, -1, 0], cone: 0.9, sweep: k % 2 ? 1 : -1, ph: k * 1.3, flick: 0 }));
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
    if (l.kind === 'flood') { const a = aim(l, t); o.dir = [a[0], a[1], a[2]]; }
    const score = Math.hypot(l.x - cam.x, l.y - cam.y, l.z - cam.z) - l.r * 0.65;
    cands.push([score, o]);
  }
  cands.sort((a, b) => a[0] - b[0]);
  for (const [, o] of cands) { if (act.length >= 8) break; act.push(o); }
  R.setLights(act);
}

/** Opaque fixtures: lamp housings, floor light bases, flood light heads. Only those near the camera are drawn. */
export function drawFixtures(R, built, cam, t) {
  const roofY = built.roofY;
  for (const l of built.list) {
    const d = Math.hypot(l.x - cam.x, l.z - cam.z); if (d > 55) continue;
    const k = intensity(l, t), glow = Math.min(1, k), c = l.c.map(v => Math.min(1, v / 0.9));
    if (l.kind === 'over') {
      R.tube(l.x - 0.5, roofY, l.z, l.x - 0.4, l.y + 0.45, l.z, 0.012, 0.012, [0.25, 0.25, 0.28], 0.3);              // chains
      R.tube(l.x + 0.5, roofY, l.z, l.x + 0.4, l.y + 0.45, l.z, 0.012, 0.012, [0.25, 0.25, 0.28], 0.3);
      R.tube(l.x, l.y + 0.5, l.z, l.x, l.y + 0.05, l.z, 0.06, 0.62 * 0.5, [0.2, 0.22, 0.24], 0.6, 0);                // dome shade
      R.tube(l.x, l.y + 0.06, l.z, l.x, l.y + 0.0, l.z, 0.32, 0.34, [0.12, 0.12, 0.14], 0.5);                       // rim
      R.sphere(l.x, l.y - 0.02, l.z, 0.24, 0.07, 0.24, c, glow);                                                     // bulb
    } else if (l.kind === 'floor') {
      R.rbox(l.x, 0.1, l.z, 0.46, 0.2, 0.2, Math.atan2(l.nx, l.nz) * 0 + (l.nx ? Math.PI / 2 : 0), 0, [0.16, 0.17, 0.2], 0.03, 0, 1, 0.5);
      R.rbox(l.x, 0.24, l.z, 0.38, 0.05, 0.14, (l.nx ? Math.PI / 2 : 0), 0, c, 0.02, glow);
    } else {
      const a = aim(l, t), lx = l.x, ly = l.y, lz = l.z;
      R.rbox(lx, ly + 0.2, lz, 0.18, 0.5, 0.18, 0, 0, [0.15, 0.16, 0.18], 0.03, 0, 1, 0.5);                           // bracket
      R.rbox(lx, ly, lz, 0.62, 0.5, 0.42, 0, 0, [0.2, 0.22, 0.25], 0.05, 0, 1, 0.7);                                 // housing
      R.sphere(lx + a[0] * 0.24, ly + a[1] * 0.24, lz + a[2] * 0.24, 0.26, 0.2, 0.2, [1, 0.97, 0.88], 1);            // lens
    }
  }
}

/** Soft volumetric beams for the flood lights and ceiling lamps (drawn in the transparent pass). */
export function drawBeams(R, built, cam, t) {
  for (const l of built.list) {
    const d = Math.hypot(l.x - cam.x, l.z - cam.z); if (d > 60) continue;
    if (l.kind === 'flood') { const a = aim(l, t), len = Math.min(34, Math.abs(l.y) / Math.max(0.2, -a[1])); R.tube(l.x, l.y, l.z, l.x + a[0] * len, l.y + a[1] * len, l.z + a[2] * len, 0.2, 3.2, [1, 0.97, 0.88], 0, 1, 0.055); }
    else if (l.kind === 'over') R.tube(l.x, l.y, l.z, l.x, 0.1, l.z, 0.2, 3.6, l.c.map(v => Math.min(1, v)), 0, 1, 0.035 * Math.min(1, intensity(l, t)));
  }
}
