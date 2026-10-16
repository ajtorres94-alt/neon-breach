// Builds the static, textured, ambient-occluded mesh of a map: subdivided box faces with world-space UVs and
// baked vertex AO, rounded boxes for soft materials, and the visual-only decor (trees, cars, barrels, pipes...).
// Pure JS (no GL), so it can be timed and tested in node. Output: { matName: number[] } in geom.js vertex format.

import { TEX_SCALE } from './textures.js';
import * as G from './geom.js';
import { scatterClutter } from './clutter.js';
import { sculpt, buildTree } from './organic.js';

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

const isSandWall = (b) => b.mat === 'sand' && !b.roof && b.y1 - b.y0 > 0.5 && Math.min(b.x1 - b.x0, b.z1 - b.z0) > 0.5 && (b.x1 - b.x0) * (b.z1 - b.z0) <= 40;
const hash = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };

/** Growable Float32Array with Array-style push(): building 1M+ vertices as plain number arrays cost ~8 bytes per float and a lot of GC. */
class FBuf {
  constructor() { this.a = new Float32Array(1 << 15); this.length = 0; }
  push() {
    const n = arguments.length; if (this.length + n > this.a.length) { const b = new Float32Array(Math.max(this.a.length * 2, this.length + n)); b.set(this.a); this.a = b; }
    for (let i = 0; i < n; i++) this.a[this.length + i] = arguments[i];
    this.length += n; return this.length;
  }
  done() { return this.a.slice(0, this.length); }
}

export function buildMapMesh(map) {
  const groups = {};
  const out = (mat) => (groups[mat] ||= new FBuf());
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
    const all = near(p[0], p[2]);
    if (!all.length) return 1;
    const cand = [];                                                          // only boxes within ray range of this point can occlude it
    for (const bi of all) { if (bi === skip) continue; const q = boxes[bi]; if (p[0] > q.x0 - AO_R && p[0] < q.x1 + AO_R && p[1] > q.y0 - AO_R && p[1] < q.y1 + AO_R && p[2] > q.z0 - AO_R && p[2] < q.z1 + AO_R) cand.push(bi); }
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
      for (const bi of cand) { const t = rayBox(ox, oy, oz, dx, dy, dz, boxes[bi]); if (t >= 0 && t < best) best = t; }
      occ += 1 - best / AO_R; cnt++;
    }
    return 1 - AO_STRENGTH * (occ / cnt) * 1.35;
  }

  // ---- weathering: mottled tone, dirt splash near the floor, moss on outdoor stone. Returns an rgb multiplier.
  const OUTDOOR = map.id === 'courtyard' || map.id === 'wildwood', MOSSY = new Set(['stone', 'brick', 'concrete', 'wall', 'marble']);
  const SKIP = new Set(['glow', 'dark', 'accent', 'grass', 'asphalt', 'floor']);
  function patina(p, n, mat) {
    if (SKIP.has(mat)) return [1, 1, 1];
    const m = G.fbm3(p[0] * 0.7, p[1] * 0.8, p[2] * 0.7, 3), k = 0.9 + 0.2 * m, low = Math.max(0, 1 - p[1] / 1.1), side = 1 - Math.abs(n[1]);
    const dirt = low * low * 0.3 * side * (0.55 + 0.9 * G.fbm3(p[0] * 2.2, p[1] * 2.2, p[2] * 2.2, 5));
    let r = k - dirt, g2 = k - dirt * 1.05, b = k - dirt * 1.25;
    if (OUTDOOR && MOSSY.has(mat)) { const t2 = Math.max(0, low * side * G.fbm3(p[0] * 1.6, p[1] * 1.2, p[2] * 1.6, 9) * 1.6 - 0.28); r *= 1 - 0.4 * t2; b *= 1 - 0.55 * t2; }
    return [r, g2, b];
  }
  const ORGANIC = {                                                   // dense sculpted solids; `cell` = target lattice spacing in metres
    rock: { e: 0.6, kind: 'rock', cell: 0.12, ridge: { f: 0.8, a: 0.42, oct: 5 }, grain: { f: 8, a: 0.03 }, planes: 5, warp: 0.6, taper: 0.22, moss: 0.9 },
    hedge: { e: 0.42, kind: 'hedge', cell: 0.21, lumps: { f: 5, a: 0.3 }, grain: { f: 14, a: 0.09 }, ridge: { f: 1.2, a: 0.12, oct: 2 }, taper: 0.06 },
    leaf: { e: 0.82, kind: 'leaf', cell: 0.2, lumps: { f: 4.5, a: 0.34 }, grain: { f: 12, a: 0.1 }, ridge: { f: 1.0, a: 0.15, oct: 2 }, taper: 0.08 },
    sand: { e: 0.95, kind: 'dune', cell: 0.18, ridge: { f: 0.9, a: 0.08, oct: 3 }, grain: { f: 10, a: 0.02 }, taper: 0.4 },
    dirt: { e: 0.8, kind: 'dirt', cell: 0.24, ridge: { f: 0.9, a: 0.1, oct: 3 }, grain: { f: 9, a: 0.03 }, taper: 0.3 } };

  const uvFor = (mat, axis, x, y, z) => {
    const s = TEX_SCALE[mat] || 2;
    return axis === 0 ? [z / s, y / s] : axis === 1 ? [x / s, z / s] : [x / s, y / s];
  };

  // ---- plain boxes: subdivided faces
  const aoMemo = new Map();
  boxes.forEach((b, bi) => {
    if (b.vis === false || b.y1 - b.y0 < 0.001) return;
    const mat = b.roof ? 'ceil' : b.mat in TEX_SCALE ? b.mat : 'wall', arr = out(mat);
    const vari = 0.95 + hash(bi, 7) * 0.1;
    const rr = ROUNDED[mat], org = ORGANIC[mat];
    if (isSandWall(b)) return;                                       // drawn as stacked sandbags in the detail pass below
    if (org && Math.min(b.x1 - b.x0, b.z1 - b.z0) > 0.8 && b.y1 - b.y0 > 0.5 && !b.roof) {      // soft materials become lumpy solids that stay inside their collision box
      const hx = (b.x1 - b.x0) / 2, hy = (b.y1 - b.y0) / 2, hz = (b.z1 - b.z0) / 2, c = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2];
      const seg = Math.round(Math.PI * (hx + hz) / org.cell), rings = Math.round((hy * 2 + (hx + hz) * 0.5) / org.cell);
      const m = sculpt(hx, hy, hz, { ...org, seg, rings, seed: bi % 23 + 1 });
      for (let i = 0; i < m.length; i += G.STRIDE) {
        const p = [m[i] + c[0], m[i + 1] + c[1], m[i + 2] + c[2]], n = [m[i + 3], m[i + 4], m[i + 5]];
        const ax = Math.abs(n[0]) > Math.abs(n[1]) && Math.abs(n[0]) > Math.abs(n[2]) ? 0 : Math.abs(n[1]) > Math.abs(n[2]) ? 1 : 2;
        const uv = uvFor(mat, ax, p[0], p[1], p[2]), ak = Math.round(p[0] / 0.3) * 73856093 ^ Math.round(p[1] / 0.3) * 19349663 ^ Math.round(p[2] / 0.3) * 83492791 ^ (ax * 2 + (n[ax] > 0 ? 1 : 0)) * 1013, a = (aoMemo.get(ak) ?? (aoMemo.set(ak, ao(p, n, bi)), aoMemo.get(ak))) * vari, pt = patina(p, n, mat);
        arr.push(p[0], p[1], p[2], n[0], n[1], n[2], a * pt[0] * m[i + 6], a * pt[1] * m[i + 7], a * pt[2] * m[i + 8], uv[0], uv[1]);
      }
      return;
    }
    if (rr && Math.min(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0) > rr * 1.2) {
      const hx = (b.x1 - b.x0) / 2, hy = (b.y1 - b.y0) / 2, hz = (b.z1 - b.z0) / 2, c = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2];
      const m = G.genRBox(hx, hy, hz, rr, CELL, rr <= 0.12);
      for (let i = 0; i < m.length; i += G.STRIDE) {
        const p = [m[i] + c[0], m[i + 1] + c[1], m[i + 2] + c[2]], n = [m[i + 3], m[i + 4], m[i + 5]];
        const ax = Math.abs(n[0]) > Math.abs(n[1]) && Math.abs(n[0]) > Math.abs(n[2]) ? 0 : Math.abs(n[1]) > Math.abs(n[2]) ? 1 : 2;
        const uv = uvFor(mat, ax, p[0], p[1], p[2]), ak = (Math.round(p[0] / 0.12) * 73856093 ^ Math.round(p[1] / 0.12) * 19349663 ^ Math.round(p[2] / 0.12) * 83492791 ^ (ax * 2 + (n[ax] > 0 ? 1 : 0)) * 1013) + bi * 7919, a = (aoMemo.get(ak) ?? (aoMemo.set(ak, ao(p, n, bi)), aoMemo.get(ak))) * vari, pt = patina(p, n, mat);
        arr.push(p[0], p[1], p[2], n[0], n[1], n[2], a * pt[0], a * pt[1], a * pt[2], uv[0], uv[1]);
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
      for (let j = 0; j <= nc; j++) { const row = []; for (let i = 0; i <= nb; i++) { const p = at(i, j), a = ao(p, n, bi) * vari, uv = uvFor(mat, axis, p[0], p[1], p[2]), pt = patina(p, n, mat); row.push([p, a, uv, pt]); } verts.push(row); }
      const emit = (v) => arr.push(v[0][0], v[0][1], v[0][2], n[0], n[1], n[2], v[1] * v[3][0], v[1] * v[3][1], v[1] * v[3][2], v[2][0], v[2][1]);
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

  // ---------------------------------------------------------------- hand-built detail on top of the plain boxes
  const strip = (mat, cx, cy, cz, sx, sy, sz, tint = [1, 1, 1], R = null, uv = 0.3) => put(mat, U.cube, [cx, cy, cz], R, [sx, sy, sz], tint, uv);
  const rotZ = (ang) => G.rotYXZ(new Float32Array(9), 0, 0, ang), rotY = (ang) => G.rotYXZ(new Float32Array(9), ang, 0, 0);
  let bagMesh = null;
  /** Sandbag wall: a brick-bonded stack of squashed bags on every outer face (a core fills the inside). */
  function sandbags(b, bi) {
    const w = b.x1 - b.x0, d = b.z1 - b.z0, h = b.y1 - b.y0, cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    put('sand', rbox((w - 0.16) / 2, h / 2 - 0.02, (d - 0.16) / 2, 0.06, 1e9), [cx, b.y0 + h / 2 - 0.02, cz], null, [1, 1, 1], [0.62, 0.55, 0.42], 1);
    bagMesh ||= G.genSphere(8, 4);
    const bl = 0.58, bh = 0.2, bt = 0.34, rows = Math.max(1, Math.round(h / (bh * 0.88))), pitch = h / rows;
    const alongX = w >= d, L = alongX ? w : d, T = alongX ? d : w, nL = Math.max(1, Math.round(L / bl)), segL = L / nL, nT = Math.max(1, Math.round(T / bt));
    for (let r = 0; r < rows; r++) {
      const y = b.y0 + pitch * (r + 0.5), stag = r % 2;
      for (let side = 0; side < 2; side++) {
        const sg = side ? 1 : -1;
        for (let i = 0; i < nL; i++) {
          const u = -L / 2 + segL * (i + 0.5) + (stag ? segL * 0.25 : -segL * 0.25) * (i === 0 || i === nL - 1 ? 0 : 1);
          const jit = hash(bi * 13 + r, i * 7 + side), t = sg * (T / 2 - bt * 0.5 + 0.02);
          const p = alongX ? [cx + u, y, cz + t] : [cx + t, y, cz + u], yaw = (jit - 0.5) * 0.18 + (alongX ? 0 : Math.PI / 2), sc = 0.92 + jit * 0.16, tone = 0.88 + hash(i + r * 3, bi) * 0.2;
          put('sand', bagMesh, p, rotY(yaw), [segL * 0.54 * sc, pitch * 0.62, bt * 0.56 * sc], [tone, tone * 0.97, tone * 0.9], 1.6);
        }
      }
      for (let side = 0; side < 2; side++) {
        const sg = side ? 1 : -1;
        for (let i = 0; i < nT; i++) {
          const v = -T / 2 + (T / nT) * (i + 0.5), jit = hash(bi * 5 + r, i + side * 9), e = sg * (L / 2 - bt * 0.5 + 0.02), p = alongX ? [cx + e, y, cz + v] : [cx + v, y, cz + e];
          put('sand', bagMesh, p, rotY((jit - 0.5) * 0.18 + (alongX ? Math.PI / 2 : 0)), [(T / nT) * 0.56, pitch * 0.62, bt * 0.56], [0.9, 0.87, 0.8], 1.6);
        }
      }
    }
  }
  const WALLISH = new Set(['wall', 'concrete', 'brick', 'stone', 'marble']), CORR = new Set(['metal', 'rust', 'olive', 'blue', 'red']);
  boxes.forEach((b, bi) => {
    if (b.vis === false || b.roof || b.st || b.y1 - b.y0 < 0.6) return;
    const mat = b.mat in TEX_SCALE ? b.mat : 'wall', w = b.x1 - b.x0, d = b.z1 - b.z0, h = b.y1 - b.y0, cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2, tone = 0.82 + hash(bi, 3) * 0.1;
    if (isSandWall(b)) { sandbags(b, bi); return; }
    if (mat === 'crate' && Math.min(w, d) >= 0.9 && h <= 3.2) {
      // timber crate: corner posts, top/bottom rails, diagonal braces and steel corner brackets on every face
      const px = 0.12, out = 0.03, tw = [tone * 0.8, tone * 0.72, tone * 0.62];
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) strip('crate', cx + sx * (w / 2 - px / 2 + out), b.y0 + h / 2, cz + sz * (d / 2 - px / 2 + out), px, h + 0.02, px, tw, null, 0.4);
      for (const [fx, fz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const alongX = fz !== 0, fw = alongX ? w : d, px0 = cx + fx * (w / 2 + out * 0.6), pz0 = cz + fz * (d / 2 + out * 0.6), len = fw - px * 1.2;
        for (const yy of [b.y0 + 0.07, b.y1 - 0.07]) strip('crate', px0, yy, pz0, alongX ? len : 0.07 + out, 0.12, alongX ? 0.07 + out : len, tw, null, 0.4);
        const bl = Math.hypot(len, h - 0.3), ang = Math.atan2(h - 0.3, len);
        strip('crate', px0, b.y0 + h / 2, pz0, alongX ? bl : 0.05 + out, 0.1, alongX ? 0.05 + out : bl, tw.map(c => c * 0.97), alongX ? rotZ(ang * (fz > 0 ? 1 : -1)) : G.rotYXZ(new Float32Array(9), Math.PI / 2, 0, ang * (fx > 0 ? -1 : 1)), 0.4);
        for (const yy of [b.y0 + 0.14, b.y1 - 0.14]) for (const sg of [-1, 1]) strip('plain', alongX ? px0 + sg * (w / 2 - 0.13) : px0, yy, alongX ? pz0 : pz0 + sg * (d / 2 - 0.13), alongX ? 0.16 : 0.05, 0.16, alongX ? 0.05 : 0.16, [0.3, 0.3, 0.32], null, 0.2);
      }
    } else if (CORR.has(mat) && Math.max(w, d) >= 2.4 && Math.max(w, d) <= 22 && h >= 1.4 && Math.min(w, d) <= 6) {
      // corrugated sheet metal: vertical ribs every 0.24 m on the long faces, frame rails and corner castings
      const alongX = w >= d, L = alongX ? w : d, T = alongX ? d : w, n = Math.floor((L - 0.3) / 0.24);
      for (let sg = -1; sg <= 1; sg += 2) for (let i = 0; i < n; i++) {
        const u = -L / 2 + 0.15 + (L - 0.3) * (i + 0.5) / n, t = sg * (T / 2 + 0.012);
        strip(mat, alongX ? cx + u : cx + t, b.y0 + h / 2, alongX ? cz + t : cz + u, alongX ? 0.1 : 0.03, h - 0.28, alongX ? 0.03 : 0.1, [tone, tone, tone], null, 0.5);
      }
      for (let sg = -1; sg <= 1; sg += 2) for (const yy of [b.y0 + 0.07, b.y1 - 0.07]) strip('plain', alongX ? cx : cx + sg * (T / 2 + 0.02), yy, alongX ? cz + sg * (T / 2 + 0.02) : cz, alongX ? L + 0.02 : 0.05, 0.14, alongX ? 0.05 : L + 0.02, [0.2, 0.2, 0.21], null, 0.1);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const yy of [b.y0 + 0.08, b.y1 - 0.08]) strip('plain', cx + sx * (w / 2 - 0.08), yy, cz + sz * (d / 2 - 0.08), 0.2, 0.17, 0.2, [0.12, 0.12, 0.13], null, 0.1);
    } else if (WALLISH.has(mat) && Math.max(w, d) >= 1 && h >= 1.8) {
      // masonry trim: skirting, cornice cap, and vertical panel joints on long faces
      const cap = Math.min(b.y1, 12) - 0.06;
      for (const [fx, fz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const alongX = fz !== 0, L = alongX ? w : d, p0x = cx + fx * w / 2, p0z = cz + fz * d / 2, o = 0.035, sx = alongX ? L : o * 2, sz = alongX ? o * 2 : L;
        if (b.y0 < 0.3) strip(mat, p0x, b.y0 + 0.09, p0z, sx + (alongX ? 0.06 : 0), 0.18, sz + (alongX ? 0 : 0.06), [tone * 0.86, tone * 0.86, tone * 0.88], null, 0.8);
        strip(mat, p0x, cap, p0z, sx + (alongX ? 0.1 : 0), 0.12, sz + (alongX ? 0 : 0.1), [tone * 1.04, tone * 1.04, tone * 1.04], null, 0.8);
        strip(mat, p0x, cap - 0.1, p0z, sx, 0.05, sz, [tone * 0.8, tone * 0.8, tone * 0.82], null, 0.5);
        const nj = Math.floor(L / 2.4);
        if (L > 3.6 && h > 2.4) for (let k = 1; k < nj; k++) {
          const u = -L / 2 + k * (L / nj);
          strip('plain', alongX ? cx + u : p0x, b.y0 + h / 2, alongX ? p0z : cz + u, alongX ? 0.035 : 0.03, h - 0.4, alongX ? 0.03 : 0.035, [0.28, 0.28, 0.29], null, 0.1);
        }
      }
    } else if (mat === 'wood' && Math.max(w, d) >= 1.2 && h >= 0.8) {
      // plank gaps and fence posts
      const alongX = w >= d, L = alongX ? w : d, T = alongX ? d : w, n = Math.floor(L / 0.2);
      for (let sg = -1; sg <= 1; sg += 2) for (let i = 1; i < n; i++) {
        const u = -L / 2 + L * i / n, t = sg * (T / 2 + 0.004);
        strip('plain', alongX ? cx + u : cx + t, b.y0 + h / 2, alongX ? cz + t : cz + u, alongX ? 0.012 : 0.01, h - 0.04, alongX ? 0.01 : 0.012, [0.12, 0.09, 0.06], null, 0.1);
      }
      for (const e of [-1, 1]) strip('wood', alongX ? cx + e * (L / 2 - 0.05) : cx, b.y0 + h / 2 + 0.05, alongX ? cz : cz + e * (L / 2 - 0.05), alongX ? 0.14 : T + 0.06, h + 0.1, alongX ? T + 0.06 : 0.14, [tone * 0.85, tone * 0.78, tone * 0.7], null, 0.5);
    }
  });

  const treeCache = new Map();
  const DECOR = {
    tree(d) {
      const h = d.h || 5.2, s = d.s || 1, x = d.x, z = d.z, r = hash(x, z), pine = d.type === 'pine';
      const variant = Math.floor(r * 4), key = (pine ? 'pine' : 'oak') + variant;
      let parts = treeCache.get(key);
      if (!parts) { parts = buildTree(variant * 0.137 + 0.05, pine ? 6 : 5.2, 1, pine); treeCache.set(key, parts); }      // 4 sculpted variants per kind, shared by every tree
      const k = s * h / (pine ? 6 : 5.2), yaw = r * 6.283, Ry = G.rotYXZ(new Float32Array(9), yaw, 0, 0), c = Math.cos(yaw), sn = Math.sin(yaw);
      for (const p of parts) {
        const px = (p.pos[0] * c + p.pos[2] * sn) * k, pz = (-p.pos[0] * sn + p.pos[2] * c) * k;
        const R = p.yaw != null ? G.rotYXZ(new Float32Array(9), yaw + p.yaw, 0, 0) : Ry;
        put(p.mat, p.mesh, [x + px, p.pos[1] * k, z + pz], R, [p.scale[0] * k, p.scale[1] * k, p.scale[2] * k], p.tint, 1);
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
      // detail: pillars, door seams + handles, mirrors, grille, lamps, plate, wheel arches, tyres with rims and lug nuts
      const dk = [0.05, 0.05, 0.06], strip = (c, sx, sy, sz, tint, rr = null) => put('plain', U.cube, c, R, [sx, sy, sz], tint);
      for (const sx of [1, -1]) for (const sz of [-1, 1]) strip(L(sx * 0.8, 1.42, -0.15 + sz * 0.98), 0.07, 0.34, 0.08, col.map(c => c * 0.8));
      for (const sx of [1, -1]) {
        for (const z of [0.55, -0.55, -1.3]) strip(L(sx * 0.955, 0.8, z), 0.015, 0.5, 0.025, dk);
        for (const z of [0.4, -0.7]) strip(L(sx * 0.97, 0.9, z), 0.025, 0.03, 0.18, [0.6, 0.6, 0.62]);
        put('plain', rbox(0.05, 0.07, 0.11, 0.03), L(sx * 1.05, 1.0, 0.62), R, [1, 1, 1], col);                       // mirror
        strip(L(sx * 0.62, 0.74, 2.14), 0.3, 0.1, 0.04, [0.85, 0.8, 0.6]);                                              // lamp lens
        put('glow', U.cube, L(sx * 0.62, 0.74, -2.14), R, [0.3, 0.09, 0.03], [0.9, 0.1, 0.08], 0.2);                  // tail lamp
        for (const sz of [1, -1]) {
          const wp = L(sx * 0.9, 0.36, sz * 1.3), WR = G.alignY(new Float32Array(9), R[0], 0, R[2]);
          put('plain', U.cyl, wp, WR, [0.46, 0.03, 0.46], [0.02, 0.02, 0.025]);                                          // arch shadow
          for (let k = 0; k < 5; k++) { const a = k / 5 * 6.283, q = L(sx * 1.07, 0.36 + Math.sin(a) * 0.13, sz * 1.3 + Math.cos(a) * 0.13); put('plain', U.sphere, q, R, [0.025, 0.025, 0.025], [0.75, 0.75, 0.78]); }
        }
      }
      strip(L(0, 0.55, 2.18), 0.8, 0.14, 0.04, dk);                                                                       // grille
      strip(L(0, 0.55, 2.2), 0.7, 0.012, 0.03, [0.5, 0.5, 0.52]); strip(L(0, 0.6, 2.2), 0.7, 0.012, 0.03, [0.5, 0.5, 0.52]);
      strip(L(0, 0.5, -2.18), 0.34, 0.11, 0.025, [0.85, 0.85, 0.8]);                                                      // plate
      put('plain', rbox(0.9, 0.05, 0.6, 0.04), L(0, 0.92, 1.45), R, [1, 1, 1], col.map(c => c * 0.92));                  // hood crease
    },
    barrel(d) {
      const y = d.y || 0, h = d.h || 0.95, rad = 0.33, mat = d.mat || 'red';
      put(mat, U.cyl, [d.x, y + h / 2, d.z], null, [rad, h, rad], [1, 1, 1], 1);
      for (const f of [0.22, 0.78]) put('plain', U.cyl, [d.x, y + h * f, d.z], null, [rad + 0.012, 0.045, rad + 0.012], [0.15, 0.15, 0.16]);
      for (const f of [0.5, 0.36, 0.64]) put('plain', U.cyl, [d.x, y + h * f, d.z], null, [rad + 0.008, 0.02, rad + 0.008], [0.22, 0.22, 0.24]);
      put('plain', U.cyl, [d.x, y + h + 0.01, d.z], null, [rad * 0.96, 0.03, rad * 0.96], [0.2, 0.2, 0.22]);
      put('plain', U.cyl, [d.x + 0.13, y + h + 0.03, d.z], null, [0.045, 0.03, 0.045], [0.5, 0.5, 0.52]);
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
      const mat = d.mat || 'concrete', col = ['marble', 'stone', 'concrete', 'brick'].includes(mat) && !d.cone && d.h > 2.4 && d.r < 1.4 && d.r > 0.2;
      if (col) {                                                                         // classical column: tapered shaft, plinth, torus rings, flared capital with abacus
        const y0 = d.y, r = d.r, h = d.h, tp = d.tint || [1, 1, 1];
        put(mat, frustum(0.93, 1, 20), [d.x, y0 + h / 2, d.z], null, [r, h, r], tp, d.uv || 2);
        put(mat, rbox(r * 1.32, 0.17, r * 1.32, 0.05), [d.x, y0 + 0.17, d.z], null, [1, 1, 1], tp, 1);
        put(mat, frustum(1.0, 1.25, 20), [d.x, y0 + 0.5, d.z], null, [r, 0.26, r], tp, 1);
        for (const yy of [y0 + 0.4, y0 + h - 0.38]) put(mat, U.cyl, [d.x, yy, d.z], null, [r * 1.12, 0.07, r * 1.12], tp, 1);
        put(mat, frustum(1.55, 0.95, 20), [d.x, y0 + h - 0.16, d.z], null, [r, 0.3, r], tp, 1);
        put(mat, rbox(r * 1.5, 0.06, r * 1.5, 0.03), [d.x, y0 + h - 0.0, d.z], null, [1, 1, 1], tp, 1);
        return;
      }
      put(mat, d.cone ? U.cone : U.cyl, [d.x, d.y + d.h / 2, d.z], null, [d.r, d.h, d.r], d.tint || [1, 1, 1], d.uv || 2);
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
      // detail: grille bars, headlamps, cab pillars, seat, steering wheel, rear-wheel lugs, hubs, wing guards
      for (let k = 0; k < 6; k++) put('plain', U.cube, [x + s * 2.27, 0.78 + k * 0.1, z], null, [0.03, 0.05, 1.5], [0.08, 0.1, 0.08]);
      for (const sz of [1, -1]) {
        put('glow', U.sphere, [x + s * 2.3, 1.1, z + sz * 0.7], null, [0.09, 0.09, 0.09], [1, 0.95, 0.7], 0.2);
        for (const sx of [-1, 1]) put('plain', U.cube, [x + s * (0.8 + sx * 0.42), 2.05, z + sz * 0.85], null, [0.06, 0.6, 0.06], green.map(c => c * 0.8));
        put('plain', rbox(0.5, 0.05, 0.28, 0.03), [x - s * 1.6, 0.98, z + sz * 1.0], null, [1, 1, 1], green.map(c => c * 0.9));      // rear wing guard
        for (let k = 0; k < 14; k++) { const a = k / 14 * 6.283; put('plain', U.cube, [x - s * 1.6 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5, z + sz * 1.0], G.rotYXZ(new Float32Array(9), 0, 0, a), [0.08, 0.06, 0.32], dark); }
        for (const [px, py, r2] of [[x + s * 1.3, 0.85, 0.2], [x - s * 1.6, 0.5, 0.15]]) put('plain', U.cyl, [px, py, z + sz * (r2 > 0.18 ? 1.62 : 1.2)], G.alignY(new Float32Array(9), 0, 0, 1), [r2, 0.04, r2], [0.3, 0.3, 0.32]);
      }
      put('plain', rbox(0.2, 0.05, 0.2, 0.03), [x + s * 0.5, 1.45, z], null, [1, 1, 1], [0.08, 0.08, 0.09]);                // seat
      put('plain', U.cyl, [x + s * 1.15, 1.45, z], G.rotYXZ(new Float32Array(9), 0, 0.4, 0), [0.17, 0.02, 0.17], [0.1, 0.1, 0.11]);   // steering wheel
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

  for (const k of Object.keys(groups)) groups[k] = groups[k].done();
  return groups;
}
