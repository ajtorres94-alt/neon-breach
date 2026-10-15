// Scattered set dressing: debris, tyres, cones, pallets, papers, tufts and so on lying about the floor, plus
// posters, vents, lamps and extinguishers on walls. Purely visual (no collision) and deterministic per map.
// Every piece is placed away from solid boxes, pickups and spawn points so it never hides anything that matters.
import * as G from './geom.js';
import { rockVariant, bushClump, trunkMesh } from './organic.js';

// kind -> [count] per map. Floor items are low; wall items are listed separately.
const PROFILES = {
  foundry:   { floor: { pallet: 9, cardboard: 16, tire: 8, bucket: 8, can: 22, papers: 16, toolbox: 5, cone: 8, puddle: 7, oil: 7, rubble: 8, plank: 6, crateS: 6 },
               wall: { vent: 12, sign: 10, lamp: 10, ext: 5, poster: 4 }, rubble: 'concrete' },
  atrium:    { floor: { papers: 18, rubble: 10, bottle: 10, can: 6, cardboard: 6, puddle: 3, plank: 3 },
               wall: { banner: 14, lamp: 14, poster: 4, ext: 3 }, rubble: 'marble' },
  courtyard: { floor: { tuft: 70, flower: 36, rock: 14, bush: 12, log: 4, bucket: 4, leaf: 24, puddle: 4, rubble: 6 },
               wall: { lamp: 10, poster: 3, sign: 2 }, rubble: 'stone' },
  reactor:   { floor: { canister: 9, papers: 10, puddle: 8, oil: 6, crateS: 8, can: 10, plank: 3, rubble: 5 },
               wall: { vent: 16, sign: 14, lamp: 14, ext: 5 }, rubble: 'metal' },
  crosswire: { floor: { tire: 14, cone: 10, rubble: 22, can: 22, bottle: 10, papers: 24, cardboard: 14, pallet: 7, puddle: 9, oil: 6, sand: 8, plank: 8, bucket: 4, toolbox: 3 },
               wall: { poster: 16, vent: 12, lamp: 8, ext: 5, graffiti: 10, sign: 6 }, rubble: 'brick' },
  wildwood:  { floor: { tuft: 110, flower: 50, rock: 22, bush: 14, log: 6, leaf: 36, bucket: 4, puddle: 4, hayS: 8, plank: 4 },
               wall: { lamp: 6, sign: 6 }, rubble: 'stone' },
  wreckage:  { floor: { plank: 14, plate: 14, rubble: 24, tire: 14, cone: 6, can: 18, papers: 12, puddle: 8, oil: 8, cardboard: 6, bucket: 4, burnt: 8 },
               wall: { poster: 8, vent: 8, lamp: 6, ext: 3, graffiti: 8, sign: 4 }, rubble: 'concrete' },
};

const LO = G.genSphere(8, 6);                     // low-poly sphere for the many tiny pieces
const pick = (r, a) => a[Math.floor(r() * a.length) % a.length];

export function scatterClutter(map, H) {
  const prof = PROFILES[map.id]; if (!prof) return;
  const MARK = { foundry: { manhole: 5, drain: 4, crack: 14, stripe: 10, patch: 8 }, atrium: { crack: 8, drain: 3, patch: 4 }, courtyard: { crack: 6, drain: 3 },
    reactor: { manhole: 5, drain: 6, crack: 12, stripe: 12, patch: 8 }, crosswire: { manhole: 4, drain: 6, crack: 18, stripe: 14, paint: 14, patch: 10 },
    wildwood: { crack: 3 }, wreckage: { crack: 20, stripe: 8, manhole: 3, patch: 12, paint: 6 } }[map.id] || {};
  prof.floor = Object.fromEntries(Object.entries(prof.floor).map(([k, n]) => [k, Math.round(n * 1.5)]));
  Object.assign(prof.floor, MARK);
  const { put, rbox, frustum, U, boxes, near } = H;
  let seed = 2166136261; for (const ch of map.id) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619) >>> 0;
  const r = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
  const rr = (a, b) => a + (b - a) * r();
  const yawR = (y, p = 0, rl = 0) => G.rotYXZ(new Float32Array(9), y, p, rl);
  const dirR = (dx, dy, dz) => G.alignY(new Float32Array(9), dx, dy, dz);
  const slab = (mat, pos, R, sx, sy, sz, tint, uv = 1) => put(mat, U.cube, pos, R, [sx, sy, sz], tint, uv);   // cheap hard-edged box for thin parts

  // ---- keep-out points (pickups, spawns, flags)
  const avoid = [];
  for (const p of map.pickups || []) avoid.push([p.x, p.z, 1.2]);
  for (const k of ['t0', 't1', 'ffa']) for (const s of (map.spawns && map.spawns[k]) || []) avoid.push([s.x, s.z, 1.8]);
  for (const f of map.flags || []) avoid.push([f.x, f.z, 2.4]);
  if (map.golden) avoid.push([map.golden.x, map.golden.z, 1.5]);
  const blocked = (x, z, pad) => { for (const a of avoid) if (Math.hypot(x - a[0], z - a[1]) < a[2] + pad) return true; return false; };

  /** ground height at x,z, or null when a solid sits there (overhead catwalks are fine). */
  function floorAt(x, z, pad) {
    let y = 0;
    for (const bi of near(x, z)) {
      const b = boxes[bi];
      if (x > b.x0 - pad && x < b.x1 + pad && z > b.z0 - pad && z < b.z1 + pad) {
        if (b.y1 <= 0.3) y = Math.max(y, b.y1);
        else if (b.y0 < 2.2 && b.y1 > 0.3) return null;
      }
    }
    return y;
  }

  const LIM = 27;
  const MAT = prof.rubble;
  const TINTS = {
    can: [[0.7, 0.15, 0.12], [0.2, 0.4, 0.7], [0.75, 0.75, 0.78], [0.2, 0.55, 0.25], [0.8, 0.6, 0.15]],
    bottle: [[0.15, 0.4, 0.2], [0.35, 0.22, 0.1], [0.7, 0.8, 0.85]],
    cardboard: [[0.62, 0.47, 0.3], [0.55, 0.42, 0.27], [0.68, 0.54, 0.36]],
    flower: [[0.95, 0.85, 0.2], [0.95, 0.95, 0.92], [0.9, 0.25, 0.3], [0.6, 0.4, 0.85], [0.95, 0.55, 0.2]],
    bucket: [[0.7, 0.2, 0.15], [0.2, 0.4, 0.65], [0.55, 0.57, 0.6], [0.85, 0.65, 0.15]],
  };

  const KINDS = {
    manhole(x, z, y) { put('plain', U.cyl, [x, y + 0.008, z], null, [0.36, 0.016, 0.36], [0.2, 0.2, 0.21]); put('plain', U.cyl, [x, y + 0.017, z], null, [0.3, 0.01, 0.3], [0.13, 0.13, 0.14]); for (let i = -2; i <= 2; i++) slab('plain', [x, y + 0.023, z + i * 0.1], null, 0.5 - Math.abs(i) * 0.06, 0.006, 0.02, [0.2, 0.2, 0.21]); },
    drain(x, z, y) { const R = yawR(r() < 0.5 ? 0 : Math.PI / 2); slab('plain', [x, y + 0.008, z], R, 0.7, 0.016, 0.26, [0.12, 0.12, 0.13]); for (let i = -3; i <= 3; i++) slab('plain', [x + R[0] * i * 0.095, y + 0.02, z + R[2] * i * 0.095], R, 0.025, 0.01, 0.2, [0.3, 0.3, 0.32]); },
    crack(x, z, y) { let px = x, pz = z, a = r() * 6.28; for (let i = 0; i < 4; i++) { const l = rr(0.3, 0.6); a += rr(-0.7, 0.7); const R = yawR(a); slab('plain', [px + Math.sin(a) * l / 2, y + 0.005, pz + Math.cos(a) * l / 2], R, 0.022, 0.008, l, [0.05, 0.05, 0.055]); px += Math.sin(a) * l; pz += Math.cos(a) * l; } },
    stripe(x, z, y) { const R = yawR(r() < 0.5 ? 0 : Math.PI / 2), w = rr(1.4, 2.6); for (let i = 0; i < 6; i++) { const tint = i % 2 ? [0.08, 0.08, 0.08] : [0.95, 0.78, 0.1], d = i * w / 6 - w / 2, Q = yawR(Math.PI / 4 + (R[0] ? 0 : 0)); slab('plain', [x + R[0] * d, y + 0.006, z + R[2] * d * 1], R, w / 6 * 0.98, 0.01, 0.18, tint); } },
    paint(x, z, y) { const q = r() < 0.5 ? 0 : Math.PI / 2, R = yawR(q); for (const k of [-1, 1]) slab('plain', [x + R[2] * k * 1.2, y + 0.005, z + R[0] * k * 1.2], R, 0.11, 0.008, 2.4, [0.82, 0.82, 0.78]); },
    patch(x, z, y) { const R = yawR(r() * 6.28), w = rr(0.7, 1.5), d = rr(0.6, 1.2), v = rr(0.8, 1.1); slab('plain', [x, y + 0.004, z], R, w, 0.008, d, [0.17 * v, 0.17 * v, 0.18 * v]); },
    tire(x, z, y) {
      const n = r() < 0.3 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        put('plain', U.cyl, [x, y + 0.11 + i * 0.22, z], null, [0.34, 0.22, 0.34], [0.07, 0.07, 0.08]);
        put('plain', U.cyl, [x, y + 0.225 + i * 0.22, z], null, [0.17, 0.012, 0.17], [0.3, 0.3, 0.32]);
        put('plain', U.cyl, [x, y + 0.232 + i * 0.22, z], null, [0.05, 0.012, 0.05], [0.5, 0.5, 0.52]);
      }
    },
    cone(x, z, y) {
      const R = yawR(r() * 6.28);
      if (r() < 0.25) { const d = dirR(rr(0.8, 1), 0.28, rr(-0.5, 0.5)); put('plain', frustum(0.045, 0.16), [x, y + 0.17, z], d, [1, 0.62, 1], [0.95, 0.42, 0.1]); return; }
      put('plain', frustum(0.045, 0.16), [x, y + 0.31 + 0.015, z], null, [1, 0.62, 1], [0.95, 0.42, 0.1]);
      put('plain', frustum(0.07, 0.1), [x, y + 0.36, z], null, [1, 0.1, 1], [0.95, 0.95, 0.92]);
      put('plain', rbox(0.19, 0.015, 0.19, 0.01), [x, y + 0.015, z], R, [1, 1, 1], [0.8, 0.34, 0.08]);
    },
    bucket(x, z, y) {
      const t = pick(r, TINTS.bucket);
      put('plain', frustum(0.17, 0.125), [x, y + 0.15, z], null, [1, 0.3, 1], t);
      put('plain', U.cyl, [x, y + 0.3, z], null, [0.175, 0.012, 0.175], t.map(c => c * 0.7));
      put('plain', U.cyl, [x, y + 0.29, z], null, [0.14, 0.01, 0.14], [0.05, 0.05, 0.05]);
    },
    can(x, z, y) {
      const t = pick(r, TINTS.can);
      if (r() < 0.45) put('plain', U.cyl, [x, y + 0.035, z], dirR(Math.cos(r() * 6.28), 0, Math.sin(r() * 6.28)), [0.035, 0.11, 0.035], t);
      else { put('plain', U.cyl, [x, y + 0.055, z], null, [0.035, 0.11, 0.035], t); put('plain', U.cyl, [x, y + 0.112, z], null, [0.03, 0.006, 0.03], [0.8, 0.8, 0.82]); }
    },
    bottle(x, z, y) {
      const t = pick(r, TINTS.bottle), d = dirR(Math.cos(r() * 6.28), 0, Math.sin(r() * 6.28));
      put('plain', U.cyl, [x, y + 0.03, z], d, [0.03, 0.15, 0.03], t);
      put('plain', frustum(0.012, 0.028), [x + d[3] * 0.11, y + 0.03 + d[4] * 0.11, z + d[5] * 0.11], d, [1, 0.08, 1], t);
    },
    cardboard(x, z, y) {
      const w = rr(0.28, 0.55), h = rr(0.2, 0.4), dd = rr(0.28, 0.5), t = pick(r, TINTS.cardboard), R = yawR(r() * 6.28);
      slab('plain', [x, y + h / 2, z], R, w, h, dd, t);
      slab('plain', [x, y + h / 2, z], R, 0.08, h + 0.004, dd + 0.004, [0.75, 0.62, 0.42]);
      if (r() < 0.35) { const w2 = w * 0.7, h2 = h * 0.8; slab('plain', [x + rr(-0.03, 0.03), y + h + h2 / 2, z], yawR(r() * 6.28), w2, h2, dd * 0.8, pick(r, TINTS.cardboard)); }
    },
    crateS(x, z, y) {
      const s = rr(0.3, 0.45), R = yawR(r() * 6.28);
      put('crate', rbox(s / 2, s / 2, s / 2, 0.025), [x, y + s / 2, z], R, [1, 1, 1], [1, 1, 1], 1);
      if (r() < 0.3) put('crate', rbox(s * 0.35, s * 0.35, s * 0.35, 0.025), [x + 0.02, y + s + s * 0.35, z], yawR(r() * 6.28), [1, 1, 1], [0.95, 0.95, 0.95], 1);
    },
    pallet(x, z, y) {
      const R = yawR(r() * 6.28), L = (lx, ly, lz) => [x + R[0] * lx + R[6] * lz, y + ly, z + R[2] * lx + R[8] * lz];
      for (let i = 0; i < 5; i++) slab('wood', L(0, 0.14, -0.5 + i * 0.25), R, 1.2, 0.024, 0.13, [0.95, 0.85, 0.7]);
      for (const px of [-0.5, 0, 0.5]) slab('wood', L(px, 0.075, 0), R, 0.1, 0.09, 1.2, [0.8, 0.7, 0.55]);
      for (let i = 0; i < 3; i++) slab('wood', L(0, 0.016, -0.5 + i * 0.5), R, 1.2, 0.024, 0.13, [0.8, 0.7, 0.55]);
    },
    papers(x, z, y) {
      const n = 2 + Math.floor(r() * 4), R0 = r() * 6.28;
      for (let i = 0; i < n; i++) slab('plain', [x + rr(-0.2, 0.2), y + 0.003 + i * 0.003, z + rr(-0.2, 0.2)], yawR(R0 + rr(-0.9, 0.9)), 0.22, 0.005, 0.3, [0.92 - r() * 0.1, 0.9 - r() * 0.08, 0.82 - r() * 0.1]);
    },
    toolbox(x, z, y) {
      const R = yawR(r() * 6.28), t = pick(r, [[0.75, 0.15, 0.1], [0.15, 0.3, 0.6], [0.85, 0.6, 0.1]]);
      put('plain', rbox(0.2, 0.09, 0.09, 0.025), [x, y + 0.09, z], R, [1, 1, 1], t);
      put('plain', rbox(0.08, 0.02, 0.012, 0.008), [x, y + 0.2, z], R, [1, 1, 1], [0.3, 0.3, 0.32]);
      put('plain', rbox(0.21, 0.02, 0.095, 0.01), [x, y + 0.14, z], R, [1, 1, 1], t.map(c => c * 0.6));
    },
    puddle(x, z, y) { const s = rr(0.35, 0.95); put('plain', U.cyl, [x, y + 0.004, z], null, [s, 0.006, s * rr(0.6, 1)], [0.12, 0.16, 0.21]); put('plain', U.cyl, [x + s * 0.2, y + 0.006, z - s * 0.1], null, [s * 0.5, 0.004, s * 0.35], [0.2, 0.27, 0.34]); },
    oil(x, z, y) { const s = rr(0.3, 0.8); put('plain', U.cyl, [x, y + 0.003, z], null, [s, 0.004, s * rr(0.6, 1)], [0.04, 0.04, 0.05]); },
    rubble(x, z, y) {
      const n = 3 + Math.floor(r() * 5);
      for (let i = 0; i < n; i++) { const s = rr(0.03, 0.11); put(MAT === 'brick' ? 'brick' : MAT === 'marble' ? 'marble' : MAT === 'stone' ? 'stone' : MAT === 'metal' ? 'rust' : 'concrete', LO, [x + rr(-0.35, 0.35), y + s * 0.45, z + rr(-0.35, 0.35)], yawR(r() * 6.28, r() * 3, r() * 3), [s * rr(0.9, 1.5), s * 0.7, s * rr(0.9, 1.4)], [0.62, 0.6, 0.58], 3); }
    },
    plank(x, z, y) {
      const len = rr(0.7, 1.5), R = yawR(r() * 6.28, 0, rr(-0.08, 0.08));
      slab('wood', [x, y + 0.025, z], R, len, 0.04, 0.14, [0.85, 0.75, 0.62]);
      if (r() < 0.4) slab('wood', [x + 0.05, y + 0.07, z + 0.04], yawR(r() * 6.28), len * 0.8, 0.04, 0.12, [0.75, 0.65, 0.52]);
    },
    plate(x, z, y) { const w = rr(0.4, 0.9), d = rr(0.3, 0.6); slab('rust', [x, y + 0.04, z], yawR(r() * 6.28, rr(-0.12, 0.12), rr(-0.12, 0.12)), w, 0.024, d, [0.9, 0.85, 0.8]); },
    burnt(x, z, y) {
      const len = rr(0.6, 1.3);
      slab('plain', [x, y + 0.06, z], yawR(r() * 6.28, 0, rr(-0.2, 0.2)), len, 0.1, 0.1, [0.08, 0.065, 0.06]);
      put('plain', U.cyl, [x, y + 0.003, z], null, [0.55, 0.004, 0.5], [0.05, 0.045, 0.045]);
    },
    cable(x, z, y) {
      let px = x, pz = z, a = r() * 6.28;
      for (let i = 0; i < 3 + Math.floor(r() * 2); i++) {
        const len = rr(0.8, 1.8), nx = px + Math.cos(a) * len, nz = pz + Math.sin(a) * len;
        if (floorAt(nx, nz, 0.3) !== y || Math.abs(nx) > LIM || Math.abs(nz) > LIM) break;
        put('plain', U.cyl, [(px + nx) / 2, y + 0.035, (pz + nz) / 2], dirR(nx - px, 0, nz - pz), [0.035, len, 0.035], [0.06, 0.06, 0.07]);
        put('plain', LO, [nx, y + 0.035, nz], null, [0.035, 0.035, 0.035], [0.06, 0.06, 0.07]);
        px = nx; pz = nz; a += rr(-1.0, 1.0);
      }
    },
    canister(x, z, y) {
      const t = pick(r, [[0.75, 0.75, 0.78], [0.2, 0.55, 0.75], [0.85, 0.7, 0.15]]);
      put('plain', U.cyl, [x, y + 0.27, z], null, [0.12, 0.54, 0.12], t);
      put('plain', U.sphere, [x, y + 0.54, z], null, [0.12, 0.07, 0.12], t);
      put('plain', U.cyl, [x, y + 0.6, z], null, [0.03, 0.08, 0.03], [0.15, 0.15, 0.17]);
      put('plain', U.cyl, [x, y + 0.12, z], null, [0.125, 0.04, 0.125], [0.12, 0.12, 0.13]);
    },
    sand(x, z, y) {
      const R = yawR(r() * 6.28), L = (lx, ly, lz) => [x + R[0] * lx + R[6] * lz, y + ly, z + R[2] * lx + R[8] * lz];
      for (let i = 0; i < 2; i++) put('sand', rbox(0.24, 0.08, 0.13, 0.06), L(-0.24 + i * 0.48, 0.08, 0), R, [1, 1, 1], [1, 1, 1], 1);
      put('sand', rbox(0.24, 0.08, 0.13, 0.06), L(0, 0.24, 0.02), R, [1, 1, 1], [1, 1, 1], 1);
    },
    hayS(x, z, y) { for (let i = 0; i < 5; i++) put('hay', LO, [x + rr(-0.3, 0.3), y + 0.05, z + rr(-0.3, 0.3)], yawR(r() * 6.28), [rr(0.15, 0.3), 0.07, rr(0.1, 0.2)], [1, 1, 1], 1.5); },
    tuft(x, z, y) {
      const g = pick(r, [[0.2, 0.42, 0.14], [0.28, 0.5, 0.17], [0.36, 0.52, 0.2], [0.3, 0.4, 0.15]]);
      const n = 8 + Math.floor(r() * 6);
      for (let i = 0; i < n; i++) {                                                  // each blade bends over in two segments and tapers to a point
        const a = r() * 6.28, h = rr(0.18, 0.5), lean = rr(0.15, 0.6), bx = x + Math.cos(a) * rr(0, 0.07), bz = z + Math.sin(a) * rr(0, 0.07), tint = g.map(c => c * rr(0.82, 1.15));
        const m1 = [bx + Math.cos(a) * lean * h * 0.25, y + h * 0.55, bz + Math.sin(a) * lean * h * 0.25], m2 = [m1[0] + Math.cos(a) * lean * h * 0.55, y + h * 0.95, m1[2] + Math.sin(a) * lean * h * 0.55];
        put('plain', frustum(0.012, 0.03, 4), [(bx + m1[0]) / 2, (y + m1[1]) / 2, (bz + m1[2]) / 2], dirR(m1[0] - bx, m1[1] - y, m1[2] - bz), [1, Math.hypot(m1[0] - bx, m1[1] - y, m1[2] - bz), 1], tint);
        put('plain', frustum(0.002, 0.012, 4), [(m1[0] + m2[0]) / 2, (m1[1] + m2[1]) / 2, (m1[2] + m2[2]) / 2], dirR(m2[0] - m1[0], m2[1] - m1[1], m2[2] - m1[2]), [1, Math.hypot(m2[0] - m1[0], m2[1] - m1[1], m2[2] - m1[2]), 1], tint);
      }
    },
    flower(x, z, y) {
      const t = pick(r, TINTS.flower), n = 1 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {
        const ox = rr(-0.12, 0.12), oz = rr(-0.12, 0.12), h = rr(0.25, 0.45);
        put('plain', frustum(0.008, 0.008, 4), [x + ox, y + h / 2, z + oz], null, [1, h, 1], [0.2, 0.42, 0.15]);
        put('plain', LO, [x + ox, y + h, z + oz], null, [0.045, 0.03, 0.045], t);
        put('plain', LO, [x + ox, y + h + 0.012, z + oz], null, [0.018, 0.015, 0.018], [0.95, 0.8, 0.2]);
      }
    },
    leaf(x, z, y) { for (let i = 0; i < 4; i++) put('plain', U.cyl, [x + rr(-0.3, 0.3), y + 0.004 + i * 0.001, z + rr(-0.3, 0.3)], null, [rr(0.05, 0.09), 0.004, rr(0.03, 0.06)], pick(r, [[0.5, 0.4, 0.15], [0.6, 0.3, 0.12], [0.35, 0.45, 0.15], [0.65, 0.5, 0.15]])); },
    rock(x, z, y) {
      const s = rr(0.12, 0.34), v = Math.floor(r() * 6);
      put('rock', rockVariant(v, 26, 18), [x, y + s * 0.34, z], yawR(r() * 6.28, (r() - 0.5) * 0.3, (r() - 0.5) * 0.3), [s * rr(1, 1.4), s * rr(0.7, 0.95), s * rr(0.9, 1.25)], [1, 1, 1], 1);
      if (r() < 0.6) put('rock', rockVariant((v + 3) % 6, 20, 14), [x + s * 1.1, y + s * 0.15, z + s * 0.3], yawR(r() * 6.28), [s * 0.5, s * 0.34, s * 0.45], [0.95, 0.95, 0.95], 1);
    },
    bush(x, z, y) {
      const s = rr(0.35, 0.6);
      for (let i = 0; i < 6; i++) { const a = r() * 6.28, d = rr(0, 0.34) * s * 1.6; put('leaf', bushClump(Math.floor(r() * 4), 12, 9), [x + Math.cos(a) * d, y + s * rr(0.28, 0.6), z + Math.sin(a) * d], yawR(r() * 6.28), [s * rr(0.5, 0.8), s * rr(0.4, 0.6), s * rr(0.5, 0.8)], [0.78 + r() * 0.24, 0.95 + r() * 0.1, 0.78 + r() * 0.2], 1); }
      for (let i = 0; i < 5; i++) { const a = r() * 6.28; put('wood', frustum(0.006, 0.016, 5), [x + Math.cos(a) * 0.08, y + 0.12, z + Math.sin(a) * 0.08], dirR(Math.cos(a) * 0.5, 1, Math.sin(a) * 0.5), [1, 0.3, 1], [0.8, 0.75, 0.7], 1); }
    },
    log(x, z, y) {
      const len = rr(1.2, 2.2), a = r() * 6.28, rad = rr(0.12, 0.2), v = Math.floor(r() * 100);
      put('wood', trunkMesh(v, len, rad * 1.04, rad * 0.96, { seg: 22, rings: 14, flare: 0, lean: 0, lichen: 0.8 }), [x - Math.cos(a) * len / 2, y + rad * 0.9, z - Math.sin(a) * len / 2], dirR(Math.cos(a), rr(-0.05, 0.05), Math.sin(a)), [1, 1, 1], [0.85, 0.8, 0.75], 1);
      put('plain', U.cyl, [x + Math.cos(a) * len / 2, y + rad * 0.9, z + Math.sin(a) * len / 2], dirR(Math.cos(a), 0, Math.sin(a)), [rad * 0.96, 0.02, rad * 0.96], [0.68, 0.52, 0.32]);
    },
  };

  // ---- floor scatter
  for (const [kind, count] of Object.entries(prof.floor)) {
    const f = KINDS[kind]; if (!f) continue;
    let placed = 0, tries = 0;
    while (placed < count && tries++ < count * 25) {
      const x = rr(-LIM, LIM), z = rr(-LIM, LIM);
      const pad = kind === 'pallet' || kind === 'log' || kind === 'cable' ? 0.9 : 0.3;
      if (blocked(x, z, pad * 0.7)) continue;
      const y = floorAt(x, z, pad); if (y === null) continue;
      f(x, z, y); placed++;
    }
  }

  // ---- wall dressing
  const WALLMAT = new Set(['wall', 'brick', 'concrete', 'metal', 'stone', 'marble', 'wood', 'rust', 'olive', 'blue', 'red']);
  const walls = [];
  boxes.forEach((b, i) => { if (b.vis !== false && WALLMAT.has(b.mat) && b.y0 <= 0.1 && b.y1 - b.y0 >= 2.6) walls.push(b); });
  const faces = [];
  for (const b of walls) {
    const sx = b.x1 - b.x0, sz = b.z1 - b.z0;
    if (sx >= 2) { faces.push({ b, n: [0, 1], len: sx }); faces.push({ b, n: [0, -1], len: sx }); }
    if (sz >= 2) { faces.push({ b, n: [1, 0], len: sz }); faces.push({ b, n: [-1, 0], len: sz }); }
  }
  const taken = [];
  // architectural trim: baseboards, cornice, pilasters (walls built with openings are separate boxes, so gaps stay clear)
  const trimC = { foundry: [0.3, 0.3, 0.32], atrium: [0.82, 0.78, 0.7], courtyard: [0.7, 0.66, 0.58], reactor: [0.22, 0.25, 0.3], crosswire: [0.35, 0.3, 0.27], wildwood: [0.4, 0.28, 0.17], wreckage: [0.32, 0.31, 0.3] }[map.id] || [0.4, 0.4, 0.4];
  for (const F of faces) {
    const b = F.b, ns = F.n, hgt = Math.min(b.y1, 5.2), horiz = ns[1] !== 0, len = F.len;
    if (Math.abs((horiz ? (b.x0 + b.x1) : (b.z0 + b.z1)) / 2) > LIM + 3) continue;
    const yaw = horiz ? 0 : Math.PI / 2, R = yawR(yaw), cx = horiz ? (b.x0 + b.x1) / 2 : (ns[0] > 0 ? b.x1 : b.x0), cz = horiz ? (ns[1] > 0 ? b.z1 : b.z0) : (b.z0 + b.z1) / 2;
    const off = (d) => horiz ? [cx, cz + ns[1] * d] : [cx + ns[0] * d, cz];
    const base = off(0.02), top = off(0.025);
    slab('plain', [base[0], 0.11, base[1]], R, len, 0.22, 0.04, trimC.map(c => c * 0.8));
    slab('plain', [top[0], hgt - 0.12, top[1]], R, len, 0.1, 0.05, trimC);
    slab('plain', [top[0], hgt - 0.2, top[1]], R, len, 0.04, 0.07, trimC.map(c => c * 0.9));
    if (len > 5) for (let u = 2; u < len - 1; u += 4) { const q = horiz ? [b.x0 + u, cz + ns[1] * 0.04] : [cx + ns[0] * 0.04, b.z0 + u]; slab('plain', [q[0], hgt / 2, q[1]], R, 0.34, hgt - 0.3, 0.08, trimC.map(c => c * 0.95)); }
  }
  const WALL = {
    poster(P) {
      const bg = pick(r, [[0.85, 0.8, 0.65], [0.75, 0.2, 0.15], [0.2, 0.35, 0.6], [0.9, 0.85, 0.5], [0.3, 0.45, 0.3]]), w = rr(0.45, 0.8), h = w * rr(1.2, 1.5);
      P.box(0, 1.5, 0.006, w + 0.05, h + 0.05, 0.012, [0.12, 0.1, 0.08]);
      P.box(0, 1.5, 0.014, w, h, 0.01, bg);
      P.disc(0, 1.55 + h * 0.1, 0.022, w * 0.28, bg.map(c => 1 - c * 0.9));
      for (let i = 0; i < 3; i++) P.box(0, 1.5 - h * 0.28 - i * 0.07, 0.022, w * rr(0.4, 0.75), 0.03, 0.006, bg.map(c => c * 0.35));
      for (const c of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) P.disc(c[0] * (w / 2 - 0.03), 1.5 + c[1] * (h / 2 - 0.03), 0.02, 0.012, [0.7, 0.7, 0.7]);
    },
    sign(P) {
      const y = [0.9, 1.4, 2.0][Math.floor(r() * 3)], w = rr(0.5, 0.9);
      if (map.id === 'wildwood') { P.box(0, y, 0.025, w, 0.22, 0.04, [0.45, 0.31, 0.18], 'wood'); P.box(0, y, 0.05, w - 0.06, 0.04, 0.01, [0.9, 0.85, 0.7]); return; }
      P.box(0, y, 0.012, w, 0.3, 0.02, [0.95, 0.8, 0.1]);
      for (let i = -3; i <= 3; i++) P.box(i * w * 0.14, y, 0.024, w * 0.07, 0.3, 0.006, [0.08, 0.08, 0.08]);
      P.box(0, y, 0.032, w - 0.05, 0.22, 0.006, [0.95, 0.8, 0.1]);
    },
    banner(P) {
      const col = pick(r, [[0.7, 0.12, 0.15], [0.15, 0.3, 0.6], [0.8, 0.65, 0.2]]), h = rr(1.4, 2.0);
      P.cyl(0, 3.0, 0.05, 0.02, 0.9, [0.8, 0.65, 0.2], true);
      P.box(0, 3.0 - h / 2, 0.03, 0.7, h, 0.015, col);
      P.box(0, 3.0 - h * 0.45, 0.042, 0.36, 0.36, 0.008, col.map(c => c * 0.4 + 0.45));
      for (const s of [-1, 1]) P.box(s * 0.3, 3.0 - h, 0.03, 0.06, 0.12, 0.015, col.map(c => c * 0.8));
    },
    graffiti(P) {
      const c = pick(r, [[0.9, 0.2, 0.5], [0.2, 0.8, 0.9], [0.95, 0.85, 0.2], [0.4, 0.9, 0.3]]), y = rr(1.1, 1.8);
      for (let i = 0; i < 5; i++) P.box(rr(-0.5, 0.5), y + rr(-0.25, 0.25), 0.006 + i * 0.001, rr(0.1, 0.45), rr(0.04, 0.09), 0.004, i % 2 ? c : c.map(v => v * 0.5), null, rr(-0.5, 0.5));
    },
    vent(P) {
      const y = rr(1.8, 2.7), w = rr(0.4, 0.7);
      P.box(0, y, 0.02, w, w * 0.75, 0.04, [0.3, 0.32, 0.35], 'metal');
      for (let i = -2; i <= 2; i++) P.box(0, y + i * w * 0.12, 0.045, w * 0.8, w * 0.04, 0.012, [0.07, 0.07, 0.08]);
    },
    lamp(P) {
      const y = rr(2.3, 3.2), warm = map.id === 'reactor' ? [0.5, 0.95, 1] : [1, 0.9, 0.65];
      P.box(0, y, 0.05, 0.1, 0.1, 0.1, [0.15, 0.15, 0.17]);
      P.box(0, y, 0.12, 0.2, 0.14, 0.1, warm, 'glow');
      P.box(0, y + 0.1, 0.1, 0.24, 0.02, 0.16, [0.15, 0.15, 0.17]);
    },
    ext(P) {
      P.cyl(0, 1.0, 0.1, 0.075, 0.42, [0.78, 0.1, 0.08]);
      P.cyl(0, 1.24, 0.1, 0.03, 0.1, [0.15, 0.15, 0.17]);
      P.box(0, 1.1, 0.04, 0.1, 0.4, 0.04, [0.2, 0.2, 0.22]);
    },
  };

  const budget = prof.wall;
  const total = Object.values(budget).reduce((a, b) => a + b, 0);
  const queue = [];
  for (const [k, n] of Object.entries(budget)) for (let i = 0; i < n; i++) queue.push(k);
  for (let i = queue.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [queue[i], queue[j]] = [queue[j], queue[i]]; }
  let guard = 0;
  while (queue.length && faces.length && guard++ < total * 40) {
    const F = faces[Math.floor(r() * faces.length)], b = F.b, kind = queue[queue.length - 1];
    const u = rr(0.5, F.len - 0.5);
    let x, z, yaw;
    if (F.n[1] !== 0) { x = b.x0 + u; z = F.n[1] > 0 ? b.z1 : b.z0; yaw = F.n[1] > 0 ? 0 : Math.PI; }
    else { z = b.z0 + u; x = F.n[0] > 0 ? b.x1 : b.x0; yaw = F.n[0] > 0 ? Math.PI / 2 : -Math.PI / 2; }
    if (Math.abs(x) > LIM + 0.4 || Math.abs(z) > LIM + 0.4) continue;
    const fx = x + F.n[0] * 0.5, fz = z + F.n[1] * 0.5;
    if (floorAt(fx, fz, 0.1) === null) continue;                       // something solid right in front
    if (taken.some(t => Math.hypot(t[0] - x, t[1] - z) < 1.6)) continue;
    // reject if the wall box is cut by an opening here (another box overlapping this spot at head height)
    let clear = true;
    for (const bi of near(fx, fz)) { const o = boxes[bi]; if (o !== b && o.vis !== false && fx > o.x0 - 0.2 && fx < o.x1 + 0.2 && fz > o.z0 - 0.2 && fz < o.z1 + 0.2 && o.y1 > 0.8 && o.y0 < 3.2) { clear = false; break; } }
    if (!clear) continue;
    const R = yawR(yaw), loc = (lx, ly, lz) => [x + R[0] * lx + R[6] * lz, ly, z + R[2] * lx + R[8] * lz];
    const P = {
      box: (lx, ly, lz, sx, sy, sz, tint, mat, roll) => put(mat || 'plain', U.cube, loc(lx, ly, lz), roll ? yawR(yaw, 0, roll) : R, [sx, sy, sz], tint, 1),
      disc: (lx, ly, lz, rad, tint) => put('plain', U.cyl, loc(lx, ly, lz), dirR(R[6], R[7], R[8]), [rad, 0.008, rad], tint),
      cyl: (lx, ly, lz, rad, len, tint, horiz) => put('plain', U.cyl, loc(lx, ly, lz), horiz ? dirR(R[0], R[1], R[2]) : null, [rad, len, rad], tint),
    };
    queue.pop(); taken.push([x, z]);
    WALL[kind](P);
  }
}
