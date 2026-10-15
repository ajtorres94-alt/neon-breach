// Builds the static, textured, ambient-occluded mesh of a map: subdivided box faces with world-space UVs and
// baked vertex AO, rounded boxes for soft materials, and the visual-only decor (trees, cars, barrels, pipes...).
// Pure JS (no GL), so it can be timed and tested in node. Output: { matName: number[] } in geom.js vertex format.

import { TEX_SCALE } from './textures.js';
import * as G from './geom.js';
import { scatterClutter } from './clutter.js';

const CELL = 1.6;                                   // max face-grid cell (metres): AO and texture detail resolution
const AO_R = 1.9, AO_STRENGTH = 0.62;
const ROUNDED = { hedge: 0.22, sand: 0.1, rock: 0.3, leaf: 0.25, crate: 0.022, hay: 0.1,
  // only a hair of edge bevel on architecture and props, enough to catch a highlight but still read as hard-edged
  wall: 0.02, concrete: 0.025, metal: 0.018, stone: 0.025, marble: 0.02, brick: 0.02, wood: 0.018, rust: 0.025, olive: 0.025, blue: 0.025, red: 0.025, dark: 0.018, accent: 0.015, dirt: 0.06 };

// ---------------------------------------------------------------- shared unit meshes
let UNIT = null;
function unit() {
  if (!UNIT) UNIT = { sphere: G.genSphere(16, 10), cyl: G.genCylinder(18), cone: G.genCone(16), cube: G.genCube(), tcache: new Map() };
  return UNIT;
}
const cached = (key, make) => { const c = unit().tcache; if (!c.has(key)) c.set(key, make()); return c.get(key); };
const rbox = (hx, hy, hz, r, cell = 1e9) => cached(`rb${hx.toFixed(3)},${hy.toFixed(3)},${hz.toFixed(3)},${r.toFixed(3)},${cell}`, () => G.genRBox(hx, hy, hz, r, cell));
const frustum = (rt, rb, seg = 14) => cached(`fr${rt.toFixed(3)},${rb.toFixed(3)},${seg}`, () => G.genFrustum(rt, rb, seg, true));

const hash = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };

export function buildMapMesh(map) {
  const groups = {};
  const out = (mat) => (groups[mat] ||= []);
  const boxes = map.boxes;

  // ---- spatial hash for ambient occlusion queries
  const GS = 4, grid = new Map(), key = (i, j) => i * 4096 + j;
  boxes.forEach((b, bi) => {
    const i0 = Math.floor((b.x0 - AO_R) / GS), i1 = Math.floor((b.x1 + AO_R) / GS), j0 = Math.floor((b.z0 - AO_R) / GS), j1 = Math.floor((b.z1 + AO_R) / GS);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const k = key(i, j); (grid.get(k) || grid.set(k, []).get(k)).push(bi); }
  });
  const near = (x, z) => grid.get(key(Math.floor(x / GS), Math.floor(z / GS))) || [];

  function rayBox(ox, oy, oz, dx, dy, dz, b) {
    let t0 = 0, t1 = AO_R;
    const O = [ox, oy, oz], D = [dx, dy, dz], lo = [b.x0, b.y0, b.z0], hi = [b.x1, b.y1, b.z1];
    for (let a = 0; a < 3; a++) {
      if (Math.abs(D[a]) < 1e-9) { if (O[a] < lo[a] || O[a] > hi[a]) return -1; continue; }
      let ta = (lo[a] - O[a]) / D[a], tb = (hi[a] - O[a]) / D[a]; if (ta > tb) { const t = ta; ta = tb; tb = t; }
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) return -1;
    }
    return t0;
  }
  /** Ambient occlusion (1 = open sky, lower = enclosed) at point p with surface normal n. */
  function ao(p, n, skip) {
    const cand = near(p[0], p[2]);
    if (!cand.length) return 1;
    const t1 = Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    let ax = n[1] * t1[2] - n[2] * t1[1], ay = n[2] * t1[0] - n[0] * t1[2], az = n[0] * t1[1] - n[1] * t1[0];
    const al = Math.hypot(ax, ay, az) || 1; ax /= al; ay /= al; az /= al;
    const bx = n[1] * az - n[2] * ay, by = n[2] * ax - n[0] * az, bz = n[0] * ay - n[1] * ax;
    const ox = p[0] + n[0] * 0.03, oy = p[1] + n[1] * 0.03, oz = p[2] + n[2] * 0.03;
    let occ = 0, cnt = 0;
    for (let k = 0; k < 9; k++) {
      let dx, dy, dz;
      if (k === 8) { dx = n[0]; dy = n[1]; dz = n[2]; } else {
        const a = k * Math.PI / 4 + 0.3, c = Math.cos(a) * 0.86, s = Math.sin(a) * 0.86;
        dx = n[0] * 0.5 + ax * c + bx * s; dy = n[1] * 0.5 + ay * c + by * s; dz = n[2] * 0.5 + az * c + bz * s;
        const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
      }
      let best = AO_R;
      for (const bi of cand) { if (bi === skip) continue; const t = rayBox(ox, oy, oz, dx, dy, dz, boxes[bi]); if (t >= 0 && t < best) best = t; }
      occ += 1 - best / AO_R; cnt++;
    }
    return 1 - AO_STRENGTH * (occ / cnt) * 1.35;
  }

  const uvFor = (mat, axis, x, y, z) => {
    const s = TEX_SCALE[mat] || 2;
    return axis === 0 ? [z / s, y / s] : axis === 1 ? [x / s, z / s] : [x / s, y / s];
  };

  // ---- plain boxes: subdivided faces
  boxes.forEach((b, bi) => {
    if (b.vis === false || b.y1 - b.y0 < 0.001) return;
    const mat = b.mat in TEX_SCALE ? b.mat : 'wall', arr = out(mat);
    const vari = 0.95 + hash(bi, 7) * 0.1;
    const rr = ROUNDED[mat];
    if (rr && Math.min(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0) > rr * 1.2) {
      const hx = (b.x1 - b.x0) / 2, hy = (b.y1 - b.y0) / 2, hz = (b.z1 - b.z0) / 2, c = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2];
      const m = G.genRBox(hx, hy, hz, rr, CELL, rr <= 0.12);
      for (let i = 0; i < m.length; i += G.STRIDE) {
        const p = [m[i] + c[0], m[i + 1] + c[1], m[i + 2] + c[2]], n = [m[i + 3], m[i + 4], m[i + 5]];
        const ax = Math.abs(n[0]) > Math.abs(n[1]) && Math.abs(n[0]) > Math.abs(n[2]) ? 0 : Math.abs(n[1]) > Math.abs(n[2]) ? 1 : 2;
        const uv = uvFor(mat, ax, p[0], p[1], p[2]), a = ao(p, n, bi) * vari;
        arr.push(p[0], p[1], p[2], n[0], n[1], n[2], a, a, a, uv[0], uv[1]);
      }
      return;
    }
    const lo = [b.x0, b.y0, b.z0], hi = [b.x1, b.y1, b.z1];
    for (let axis = 0; axis < 3; axis++) for (const sg of [1, -1]) {
      if (axis === 1 && sg < 0 && b.y0 <= 0.001) continue;             // underside resting on the ground
      if (axis !== 1 && b.y1 <= 0.001) continue;                       // sides of the sunken floor slab
      const bx = (axis + 1) % 3, cx = (axis + 2) % 3;
      const nb = Math.max(1, Math.min(48, Math.ceil((hi[bx] - lo[bx]) / CELL))), nc = Math.max(1, Math.min(48, Math.ceil((hi[cx] - lo[cx]) / CELL)));
      const n = [0, 0, 0]; n[axis] = sg;
      const at = (i, j) => { const p = [0, 0, 0]; p[axis] = sg > 0 ? hi[axis] : lo[axis]; p[bx] = lo[bx] + (hi[bx] - lo[bx]) * i / nb; p[cx] = lo[cx] + (hi[cx] - lo[cx]) * j / nc; return p; };
      const verts = [];
      for (let j = 0; j <= nc; j++) { const row = []; for (let i = 0; i <= nb; i++) { const p = at(i, j), a = ao(p, n, bi) * vari, uv = uvFor(mat, axis, p[0], p[1], p[2]); row.push([p, a, uv]); } verts.push(row); }
      const emit = (v) => arr.push(v[0][0], v[0][1], v[0][2], n[0], n[1], n[2], v[1], v[1], v[1], v[2][0], v[2][1]);
      for (let j = 0; j < nc; j++) for (let i = 0; i < nb; i++) {
        const q = [verts[j][i], verts[j][i + 1], verts[j + 1][i + 1], verts[j + 1][i]];
        const order = sg > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
        // (b, c, axis) is a cyclic triple so e_b x e_c = +e_axis: this order is CCW seen from +axis
        for (const k of order) emit(q[k]);
      }
    }
  });

  // ---- decor
  const put = (mat, mesh, pos, R, scale, tint = [1, 1, 1], uvMul = 1) => G.appendMesh(out(mat), mesh, pos, R, scale, tint, uvMul);
  const Rm = new Float32Array(9);
  const yawR = (yaw) => G.rotYXZ(new Float32Array(9), yaw, 0, 0);
  const PAINT = { rust: [0.50, 0.30, 0.18], olive: [0.30, 0.36, 0.22], blue: [0.18, 0.32, 0.55], red: [0.60, 0.18, 0.15], white: [0.75, 0.75, 0.72], yellow: [0.78, 0.62, 0.16], gray: [0.4, 0.42, 0.45] };
  const U = unit();

  const DECOR = {
    tree(d) {
      const h = d.h || 5.2, s = d.s || 1, x = d.x, z = d.z, r = hash(x, z), pine = d.type === 'pine';
      const trunkH = h * (pine ? 0.45 : 0.6);
      put('wood', frustum(0.2 * s, 0.34 * s, 10), [x, trunkH / 2, z], null, [1, trunkH, 1], [0.85, 0.8, 0.75], 1);
      const tints = [[0.8 + r * 0.2, 0.95, 0.8], [0.7, 0.9 + r * 0.1, 0.7], [0.9, 1.0, 0.75]];
      if (pine) {
        for (let k = 0; k < 4; k++) {
          const rad = (2.0 - k * 0.42) * s, yy = trunkH * 0.5 + k * h * 0.17;
          put('leaf', U.cone, [x, yy + 0.9, z], null, [rad, 1.7 * s, rad], [0.55, 0.8, 0.6], 3);
        }
      } else {
        const blobs = [[0, 0, 0, 2.3], [1.2, -0.3, 0.5, 1.7], [-1.1, -0.2, -0.7, 1.8], [0.2, 0.7, -1.0, 1.6], [-0.4, 0.8, 1.0, 1.5]];
        blobs.forEach((bl, i) => put('leaf', U.sphere, [x + bl[0] * s, h - 0.2 + bl[1] * s, z + bl[2] * s], G.rotYXZ(new Float32Array(9), r * 6 + i, 0, 0), [bl[3] * s, bl[3] * 0.82 * s, bl[3] * s], tints[i % 3], 3));
      }
    },
    car(d) {
      const col = PAINT[d.paint || d.mat] || PAINT.rust, yaw = d.alongZ === false ? Math.PI / 2 : 0, R = yawR(yaw);
      const L = (lx, ly, lz) => [d.x + R[0] * lx + R[6] * lz, ly, d.z + R[2] * lx + R[8] * lz];
      put('plain', rbox(0.95, 0.42, 2.1, 0.22), L(0, 0.57, 0), R, [1, 1, 1], col);
      put('plain', rbox(0.84, 0.3, 1.05, 0.2), L(0, 1.25, -0.15), R, [1, 1, 1], [0.1, 0.14, 0.18]);          // glass band
      put('plain', rbox(0.8, 0.05, 0.95, 0.04), L(0, 1.58, -0.15), R, [1, 1, 1], col.map(c => c * 0.9));      // roof
      put('plain', rbox(0.9, 0.06, 0.1, 0.05), L(0, 0.35, 2.05), R, [1, 1, 1], [0.12, 0.12, 0.13]);           // bumpers
      put('plain', rbox(0.9, 0.06, 0.1, 0.05), L(0, 0.35, -2.05), R, [1, 1, 1], [0.12, 0.12, 0.13]);
      for (const sx of [1, -1]) for (const sz of [1, -1]) {
        const wp = L(sx * 0.93, 0.36, sz * 1.3), WR = G.alignY(new Float32Array(9), R[0], 0, R[2]);      // axle along the car's X
        put('plain', U.cyl, wp, WR, [0.37, 0.28, 0.37], [0.05, 0.05, 0.06]);
        put('plain', U.cyl, L(sx * 1.04, 0.36, sz * 1.3), WR, [0.2, 0.05, 0.2], [0.5, 0.5, 0.52]);
      }
      for (const sx of [1, -1]) put('plain', U.sphere, L(sx * 0.6, 0.72, 2.12), R, [0.14, 0.1, 0.06], [1, 0.95, 0.7]);
    },
    barrel(d) {
      const y = d.y || 0, h = d.h || 0.95, rad = 0.33, mat = d.mat || 'red';
      put(mat, U.cyl, [d.x, y + h / 2, d.z], null, [rad, h, rad], [1, 1, 1], 1);
      for (const f of [0.22, 0.78]) put('plain', U.cyl, [d.x, y + h * f, d.z], null, [rad + 0.012, 0.045, rad + 0.012], [0.15, 0.15, 0.16]);
    },
    lamp(d) {
      const h = d.h || 5;
      put('plain', U.cyl, [d.x, h / 2, d.z], null, [0.07, h, 0.07], [0.12, 0.13, 0.14]);
      put('plain', rbox(0.5, 0.045, 0.1, 0.03), [d.x + 0.45, h, d.z], null, [1, 1, 1], [0.12, 0.13, 0.14]);
      put('glow', rbox(0.18, 0.05, 0.12, 0.04), [d.x + 0.85, h - 0.07, d.z], null, [1, 1, 1], [1, 0.95, 0.8]);
    },
    pipe(d) {
      const dx = d.x1 - d.x0, dy = (d.y1 ?? d.y0) - d.y0, dz = d.z1 - d.z0, len = Math.hypot(dx, dy, dz), r = d.r || 0.12;
      put(d.mat || 'metal', U.cyl, [(d.x0 + d.x1) / 2, d.y0 + dy / 2, (d.z0 + d.z1) / 2], G.alignY(new Float32Array(9), dx, dy, dz), [r, len, r], d.tint || [0.9, 0.9, 0.95], 1);
      for (const e of [[d.x0, d.y0, d.z0], [d.x1, d.y1 ?? d.y0, d.z1]]) put('plain', U.sphere, e, null, [r * 1.15, r * 1.15, r * 1.15], [0.2, 0.2, 0.22]);
    },
    cyl(d) {
      put(d.mat || 'concrete', d.cone ? U.cone : U.cyl, [d.x, d.y + d.h / 2, d.z], null, [d.r, d.h, d.r], d.tint || [1, 1, 1], d.uv || 2);
    },
    sphere(d) { put(d.mat || 'plain', U.sphere, [d.x, d.y, d.z], null, [d.r, d.r * (d.sy || 1), d.r], d.tint || [1, 1, 1], d.uv || 1); },
    rbox(d) {
      const hx = (d.x1 - d.x0) / 2, hy = (d.y1 - d.y0) / 2, hz = (d.z1 - d.z0) / 2;
      put(d.mat || 'plain', rbox(hx, hy, hz, d.r ?? 0.2, CELL), [(d.x0 + d.x1) / 2, (d.y0 + d.y1) / 2, (d.z0 + d.z1) / 2], d.yaw ? yawR(d.yaw) : null, [1, 1, 1], d.tint || [1, 1, 1], d.uv || 0.5);
    },
    hay(d) {
      put('hay', U.cyl, [d.x, 0.7, d.z], G.alignY(new Float32Array(9), d.alongX === false ? 0 : 1, 0, d.alongX === false ? 1 : 0), [0.7, 1.5, 0.7], [1, 1, 1], 1);
    },
    tractor(d) {
      const s = d.dir || 1, x = d.x, z = d.z, green = [0.18, 0.42, 0.2], dark = [0.06, 0.06, 0.07];
      put('plain', rbox(2.25, 0.62, 1.1, 0.35), [x, 0.95, z], null, [1, 1, 1], green);                           // hood + engine
      put('plain', rbox(0.9, 0.55, 0.95, 0.15), [x + s * 0.8, 1.95, z], null, [1, 1, 1], [0.1, 0.14, 0.17]);     // cab glass
      put('plain', rbox(0.95, 0.06, 1.0, 0.04), [x + s * 0.8, 2.52, z], null, [1, 1, 1], green);                  // cab roof
      for (const sz of [1, -1]) {
        put('plain', U.cyl, [x + s * 1.3, 0.85, z + sz * 1.25], G.alignY(new Float32Array(9), 0, 0, 1), [0.85, 0.5, 0.85], dark);
        put('plain', U.cyl, [x + s * 1.3, 0.85, z + sz * 1.55], G.alignY(new Float32Array(9), 0, 0, 1), [0.4, 0.08, 0.4], [0.7, 0.55, 0.15]);
        put('plain', U.cyl, [x - s * 1.6, 0.5, z + sz * 1.0], G.alignY(new Float32Array(9), 0, 0, 1), [0.5, 0.34, 0.5], dark);
      }
      put('plain', U.cyl, [x - s * 1.7, 1.55, z], null, [0.07, 0.8, 0.07], [0.1, 0.1, 0.1]);                      // exhaust
    },
    heli(d) {                                                           // downed helicopter around the collision boxes at the crater
      const x = d.x, z = d.z, olive = [0.30, 0.34, 0.22], dark = [0.09, 0.09, 0.1];
      put('plain', rbox(4.05, 1.25, 1.5, 0.9), [x - 2, 1.35, z], null, [1, 1, 1], olive);                        // fuselage
      put('plain', rbox(1.6, 0.32, 0.95, 0.3), [x - 1.2, 2.72, z], null, [1, 1, 1], olive.map(c => c * 0.8));    // engine cowling
      put('plain', rbox(0.85, 0.85, 1.1, 0.55), [x - 6.85, 1.0, z], null, [1, 1, 1], [0.1, 0.15, 0.19]);         // cockpit glass
      put('plain', rbox(1.2, 0.05, 1.52, 0.04), [x - 3.2, 1.6, z], null, [1, 1, 1], dark);                        // door seam band
      put('plain', frustum(0.2, 0.5), [x + 6.5, 2.5, z], G.alignY(new Float32Array(9), 1, 0, 0), [1, 9, 1], olive);                       // tail boom
      put('plain', rbox(0.1, 1.2, 0.45, 0.08), [x + 10.8, 3.7, z], G.rotYXZ(new Float32Array(9), 0, 0, 0.35), [1, 1, 1], olive);          // fin
      put('plain', U.cyl, [x - 2, 3.0, z], null, [0.22, 0.5, 0.22], dark);                                                                 // rotor hub
      [[0.35, 0], [2.45, 1], [4.55, 2]].forEach(([ang, i]) => {
        const len = 6.0, R = G.rotYXZ(new Float32Array(9), ang, 0, 0.12 * (i - 1));
        put('plain', rbox(0.2, 0.035, len / 2, 0.03), [x - 2 + Math.sin(ang) * len / 2, 3.1 - 0.1 * i, z + Math.cos(ang) * len / 2], R, [1, 1, 1], dark);
      });
      for (const sz of [1, -1]) {
        put('plain', U.cyl, [x - 2.2, 0.22, z + sz * 1.15], G.alignY(new Float32Array(9), 1, 0, 0), [0.09, 4.4, 0.09], dark);                // skids
        for (const px of [-3.6, -0.8]) put('plain', U.cyl, [x + px, 0.62, z + sz * 1.15], null, [0.06, 0.8, 0.06], dark);
      }
    },
  };
  for (const d of map.decor || []) { const f = DECOR[d.k]; if (f) f(d); }
  scatterClutter(map, { put, rbox: (hx, hy, hz, r) => cached(`cb${hx.toFixed(3)},${hy.toFixed(3)},${hz.toFixed(3)},${r.toFixed(3)}`, () => G.genRBox(hx, hy, hz, r, 1e9, true)), frustum, U, boxes, near });

  return groups;
}
