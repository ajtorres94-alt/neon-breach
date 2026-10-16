// Sculpted organic geometry for the scenery: boulders (ridged multifractal + cleaved facets), hedges and foliage clumps (leaf-scale lumps),
// bark-ridged trunks with root buttresses, forked branches. Everything is a dense lattice with smooth normals and baked vertex colour
// (crevice darkening, lichen, bark furrows), so silhouettes and shading stay round up close. Pure JS (no GL): testable in node.
import * as G from './geom.js';

const { noise3, fbm3 } = G;
const clamp = (v, a = 0, b = 1) => v < a ? a : v > b ? b : v;
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const sp = (v, p) => Math.sign(v) * Math.pow(Math.abs(v), p);

/** Global detail multiplier for lattice resolution (0.5 = half, 1 = default, 1.5 = extra). Settable from the page: localStorage nb.detail. */
export const DETAIL = { v: typeof navigator !== 'undefined' && (navigator.hardwareConcurrency || 8) < 4 ? 0.55 : 0.8 };
try { const s = typeof localStorage !== 'undefined' && parseFloat(localStorage.getItem('nb.detail')); if (s > 0.2 && s < 3) DETAIL.v = s; } catch { /* storage blocked */ }

export function rng(seed) { let s = (seed * 2654435761 + 12345) >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
/** ridged multifractal: 1 on ridge lines, 0 in valleys */
function ridged(x, y, z, oct, s) { let a = 0, amp = 0.5, tot = 0, f = 1; for (let i = 0; i < oct; i++) { let n = 1 - Math.abs(2 * noise3(x * f, y * f, z * f, s + i * 7) - 1); n *= n; a += n * amp; tot += amp; amp *= 0.5; f *= 2.07; } return a / tot; }
const res = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v * DETAIL.v)));

/**
 * Generic sculpted solid inside half-extents (hx, hy, hz). A super-ellipsoid lattice is carved INWARD only, so the result never leaves its
 * collision box. o: { e, seg, rings, seed, kind: 'rock'|'hedge'|'leaf'|'dune'|'dirt', taper, ridge:{f,a,oct}, lumps:{f,a}, grain:{f,a}, planes, warp, moss }
 */
export function sculpt(hx, hy, hz, o = {}) {
  const { e = 0.7, seed = 0, kind = 'rock', taper = 0, ridge = null, lumps = null, grain = null, planes = 0, warp = 0, moss = 0 } = o;
  const seg = res(o.seg ?? 48, 12, 96), rings = res(o.rings ?? 30, 8, 64);
  const r = rng(seed * 31 + 7), PL = [];
  for (let k = 0; k < planes; k++) { const a = r() * 6.283, b = (r() - 0.35) * 1.9; const n = [Math.cos(a) * Math.cos(b), Math.sin(b), Math.sin(a) * Math.cos(b)]; PL.push({ n, o: 0.62 + r() * 0.22 }); }
  const P = [], C = [], H = [];
  const so = seed * 3.7;
  for (let j = 0; j <= rings; j++) {
    const th = -Math.PI / 2 + Math.PI * j / rings, ct = Math.cos(th), st = Math.sin(th), row = [], crow = [];
    for (let i = 0; i <= seg; i++) {
      const ph = (i === seg ? 0 : i) / seg * Math.PI * 2;
      let ux = sp(ct, e) * sp(Math.cos(ph), e), uy = sp(st, e), uz = sp(ct, e) * sp(Math.sin(ph), e);
      let x = ux * hx, y = uy * hy, z = uz * hz;
      let q = [x + so, y + so * 0.7, z - so];
      if (warp) q = [q[0] + warp * (noise3(q[0] * 0.7, q[1] * 0.7, q[2] * 0.7, 11) - 0.5), q[1] + warp * (noise3(q[0] * 0.7, q[1] * 0.7, q[2] * 0.7, 12) - 0.5), q[2] + warp * (noise3(q[0] * 0.7, q[1] * 0.7, q[2] * 0.7, 13) - 0.5)];
      let k = 1, rv = 1, lv = 0.5;
      if (ridge) { rv = ridged(q[0] * ridge.f, q[1] * ridge.f, q[2] * ridge.f, ridge.oct || 5, seed); k -= ridge.a * (1 - rv); }
      if (lumps) { lv = noise3(q[0] * lumps.f, q[1] * lumps.f, q[2] * lumps.f, 31); k -= lumps.a * (1 - lv); }
      if (grain) k -= grain.a * noise3(q[0] * grain.f, q[1] * grain.f, q[2] * grain.f, 41);
      k = Math.max(0.25, k);
      ux *= k; uy *= k; uz *= k;
      for (const p of PL) { const s = ux * p.n[0] + uy * p.n[1] + uz * p.n[2] - p.o, c = s > 0 ? Math.sqrt(s * s + 0.0016) - 0.04 + s * 0.0 : 0; if (s > -0.05) { const m = 0.5 * (s + Math.sqrt(s * s + 0.004)); ux -= p.n[0] * m; uy -= p.n[1] * m; uz -= p.n[2] * m; } }
      if (taper && uy > 0) { const t = 1 - taper * uy * uy; ux *= t; uz *= t; }
      row.push([ux * hx, uy * hy, uz * hz]);
      // baked colour: crevices dark, ridge tops lighter, lichen / moss on upward facets, leaf-lump highlights
      let c;
      if (kind === 'rock') { const cav = 0.62 + 0.5 * rv, up = smooth(0.35, 0.8, uy / (Math.hypot(ux, uy, uz) || 1) + (fbm3(q[0] * 1.3, q[1] * 1.3, q[2] * 1.3, 5) - 0.5) * 0.9) * moss, st2 = 0.92 + 0.12 * Math.sin(y * 7 + fbm3(q[0], q[1], q[2], 8) * 6);
        c = [cav * st2 * (1 - 0.35 * up), cav * st2 * (1 - 0.05 * up) * 1.0, cav * st2 * (1 - 0.5 * up)]; }
      else if (kind === 'hedge' || kind === 'leaf') { const v = 0.62 + 0.55 * lv + 0.12 * (fbm3(q[0] * 2, q[1] * 2, q[2] * 2, 17) - 0.5); c = [v * (0.95 + 0.1 * noise3(q[0] * 3, q[1] * 3, q[2] * 3, 19)), v, v * 0.92]; }
      else { const v = 0.8 + 0.3 * fbm3(q[0], q[1], q[2], 23); c = [v, v, v]; }
      crow.push(c);
    }
    P.push(row); C.push(crow);
  }
  // pole rows collapse to a point
  for (const j of [0, rings]) { const p = P[j][0]; for (let i = 0; i <= seg; i++) P[j][i] = p; }
  const uv = (i, j, p, n) => { const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]); const s = 0.62; return ax > ay && ax > az ? [p[2] * s, p[1] * s] : ay > az ? [p[0] * s, p[2] * s] : [p[0] * s, p[1] * s]; };
  return G.genLattice(P, { C, uv, wrap: true, flip: false });
}

/** Cached boulder variants (unit-ish; scale to the wanted size). */
const cache = new Map();
const cached = (key, make) => { let m = cache.get(key); if (!m) { m = make(); cache.set(key, m); } return m; };
export const rockVariant = (i, seg = 34, rings = 22) => cached(`rock${i}:${seg}:${DETAIL.v}`, () => sculpt(1, 0.78, 1, { e: 0.62, seed: 40 + i, seg, rings, kind: 'rock', ridge: { f: 0.9, a: 0.4, oct: 5 }, grain: { f: 9, a: 0.035 }, planes: 4, warp: 0.5, taper: 0.25, moss: 0.8 }));
export const bushClump = (i, seg = 14, rings = 10) => cached(`clump${i}:${seg}:${DETAIL.v}`, () => sculpt(1, 0.85, 1, { e: 0.92, seed: 70 + i, seg, rings, kind: 'leaf', lumps: { f: 4.2, a: 0.42 }, grain: { f: 11, a: 0.12 }, ridge: { f: 1.6, a: 0.18, oct: 2 } }));

// ---------------------------------------------------------------- bark trunks and branches
/** Tapered, slightly curved trunk along +y from 0 to h with root buttresses, vertical bark ridges, knots and furrow-dark vertex colour. */
export function trunkMesh(seed, h, r0, r1, o = {}) {
  const seg = res(o.seg ?? 30, 10, 64), rings = res(o.rings ?? 44, 8, 90), r = rng(seed + 5), lean = (r() - 0.5) * (o.lean ?? 0.5), bu = 3 + Math.floor(r() * 3), ph0 = r() * 6.28;
  const P = [], C = [];
  for (let j = 0; j <= rings; j++) {
    const t = j / rings, y = t * h, cx = lean * t * t * h * 0.25 + Math.sin(t * 5 + seed) * 0.03 * h * 0.2, cz = Math.cos(t * 4 + seed) * 0.02 * h * 0.2;
    const row = [], crow = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i === seg ? 0 : i) / seg * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      let rad = lerp(r0, r1, Math.pow(t, 0.85));
      const flare = (o.flare ?? 1.0) * Math.exp(-t * h / 0.55) * (0.55 + 0.9 * Math.pow(Math.max(0, Math.cos(bu * a + ph0)), 2));
      rad *= 1 + flare * 0.9;
      const rid = ridged(ca * 2.6 + seed, y * 0.9, sa * 2.6, 3, seed), fine = noise3(ca * 9 + seed, y * 4.5, sa * 9, 3);
      const knot = smooth(0.82, 0.97, noise3(ca * 2 + 9, y * 0.8, sa * 2 + 4, 6 + seed)) * 0.6;
      rad *= 1 - 0.16 * (1 - rid) - 0.025 * fine + knot * 0.12;
      row.push([cx + ca * rad, y, cz + sa * rad]);
      const dark = 0.5 + 0.6 * rid, lich = smooth(0.62, 0.82, fbm3(ca * 2 + seed, y * 0.5, sa * 2, 9)) * (t < 0.7 ? 1 : 0.4) * (o.lichen ?? 0.5);
      crow.push([dark * (1 - 0.35 * lich), dark * (1 + 0.05 * lich), dark * (1 - 0.5 * lich)]);
    }
    P.push(row); C.push(crow);
  }
  const uv = (i, j) => [i / seg * (2 * Math.PI * (r0 + r1) / 2) / 1.3, j / rings * h / 1.3];
  return G.genLattice(P, { C, uv, wrap: true, flip: true });
}

/** Curved branch along a polyline of points with per-point radius; bark ridged, dark furrows. */
export function tubeMesh(pts, radii, seed = 0, seg = 8) {
  const n = pts.length, P = [], C = [], Tn = [];
  for (let k = 0; k < n; k++) { const a = pts[Math.max(0, k - 1)], b = pts[Math.min(n - 1, k + 1)]; const t = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; const l = Math.hypot(...t) || 1; Tn.push([t[0] / l, t[1] / l, t[2] / l]); }
  let up = Math.abs(Tn[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  for (let k = 0; k < n; k++) {
    const t = Tn[k]; let ax = up[1] * t[2] - up[2] * t[1], ay = up[2] * t[0] - up[0] * t[2], az = up[0] * t[1] - up[1] * t[0]; const al = Math.hypot(ax, ay, az) || 1; ax /= al; ay /= al; az /= al;
    const bx = t[1] * az - t[2] * ay, by = t[2] * ax - t[0] * az, bz = t[0] * ay - t[1] * ax; up = [bx, by, bz];
    const row = [], crow = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i === seg ? 0 : i) / seg * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), rid = ridged(ca * 2 + seed, k * 0.6, sa * 2, 2, seed + 3);
      const rad = radii[k] * (1 - 0.14 * (1 - rid));
      row.push([pts[k][0] + (ax * ca + bx * sa) * rad, pts[k][1] + (ay * ca + by * sa) * rad, pts[k][2] + (az * ca + bz * sa) * rad]);
      const d = 0.5 + 0.6 * rid; crow.push([d, d, d]);
    }
    P.push(row); C.push(crow);
  }
  return G.genLattice(P, { C, uv: (i, j) => [i / seg * 0.5, j * 0.5], wrap: true, flip: true });
}

/**
 * Deciduous tree skeleton and meshes: trunk, forked branches, and foliage clump placements. Returns { parts: [{ mesh, mat, pos, scale, tint, yaw }] }.
 * All geometry is relative to the tree's base (0,0,0); the caller translates it.
 */
export function buildTree(seed, h, s, pine = false) {
  const r = rng(Math.floor(seed * 1000) + 3), parts = [];
  const trunkH = h * (pine ? 0.5 : 0.62), r0 = 0.3 * s, r1 = 0.15 * s;
  const trunk = trunkMesh(Math.floor(r() * 90), trunkH, r0, r1, { lean: 0.45 });
  parts.push({ mesh: trunk, mat: 'wood', pos: [0, 0, 0], scale: [1, 1, 1], tint: [1, 1, 1] });
  const tips = [];
  const grow = (p0, dir, len, rad, depth) => {
    const pts = [], radii = [], n = 7, d = dir.slice();
    let p = p0.slice();
    for (let k = 0; k <= n; k++) { pts.push(p.slice()); radii.push(rad * (1 - 0.7 * k / n)); const w = 0.14 + 0.06 * depth; d[0] += (r() - 0.5) * w; d[2] += (r() - 0.5) * w; d[1] += 0.035 * (pine ? -2 : 1); const l = Math.hypot(...d); p = [p[0] + d[0] / l * len / n, p[1] + d[1] / l * len / n, p[2] + d[2] / l * len / n]; }
    parts.push({ mesh: tubeMesh(pts, radii, Math.floor(r() * 50), depth ? 6 : 8), mat: 'wood', pos: [0, 0, 0], scale: [1, 1, 1], tint: [0.95, 0.9, 0.85] });
    const end = pts[n], endDir = [pts[n][0] - pts[n - 2][0], pts[n][1] - pts[n - 2][1], pts[n][2] - pts[n - 2][2]];
    if (depth < 2) { const k = 2; for (let b = 0; b < k; b++) { const a = (b / k) * 6.28 + r(), nd = [endDir[0] + Math.cos(a) * 0.6, endDir[1] * 0.6 + 0.35, endDir[2] + Math.sin(a) * 0.6]; const l = Math.hypot(...nd); grow(end, nd.map(v => v / l), len * 0.66, rad * 0.5, depth + 1); } }
    else tips.push(end);
  };
  if (!pine) {
    const nb = 5 + Math.floor(r() * 2);
    for (let b = 0; b < nb; b++) { const t = 0.58 + 0.38 * (b / nb), a = b * 2.4 + r(), y0 = t * trunkH, dir = [Math.cos(a), 0.55 + 0.4 * r(), Math.sin(a)]; const l = Math.hypot(...dir); grow([Math.cos(a) * r1 * 0.8, y0, Math.sin(a) * r1 * 0.8], dir.map(v => v / l), (1.7 + 0.9 * r()) * s * (1.25 - t * 0.4), 0.09 * s, 0); }
    // foliage: lumpy clumps packed around branch tips and a fuller core
    const place = (x, y, z, rad) => { const v = Math.floor(r() * 4); parts.push({ mesh: bushClump(v, 10, 8), mat: 'leaf', pos: [x, y, z], scale: [rad, rad * (0.8 + r() * 0.2), rad], tint: [0.74 + r() * 0.28, 0.92 + r() * 0.12, 0.7 + r() * 0.2], yaw: r() * 6.28 }); };
    for (const tp of tips) for (let k = 0; k < 2; k++) place(tp[0] + (r() - 0.5) * 0.9 * s, tp[1] + (r() - 0.35) * 0.8 * s, tp[2] + (r() - 0.5) * 0.9 * s, (0.7 + r() * 0.5) * s);
    for (let k = 0; k < 7; k++) { const a = r() * 6.28, d = r() * 1.5 * s; place(Math.cos(a) * d, h - 0.5 * s + (r() - 0.3) * 1.5 * s, Math.sin(a) * d, (0.8 + r() * 0.5) * s); }
  } else {
    const tiers = 6;
    for (let k = 0; k < tiers; k++) {
      const t = k / (tiers - 1), y0 = trunkH * 0.35 + t * (h - trunkH * 0.35) * 0.98, rad = (2.1 * (1 - t * 0.86) + 0.15) * s, nb = 6;
      for (let b = 0; b < nb; b++) {
        const a = b / nb * 6.28 + k * 0.7 + r() * 0.4, len = rad * (0.85 + r() * 0.3), dir = [Math.cos(a), -0.35, Math.sin(a)];
        const l = Math.hypot(...dir), pts = [], radii = [];
        for (let q = 0; q <= 5; q++) { pts.push([Math.cos(a) * len * q / 5, y0 - 0.12 * s * Math.pow(q / 5, 2) * 3 + 0.12 * s * (q / 5), Math.sin(a) * len * q / 5]); radii.push(0.045 * s * (1 - q / 6)); }
        parts.push({ mesh: tubeMesh(pts, radii, k * 7 + b, 6), mat: 'wood', pos: [0, 0, 0], scale: [1, 1, 1], tint: [0.9, 0.85, 0.8] });
        for (let q = 1; q <= 2; q++) parts.push({ mesh: bushClump((k + b + q) % 4, 10, 7), mat: 'leaf', pos: [Math.cos(a) * len * (0.2 + q * 0.3), y0 - 0.1 * s * q, Math.sin(a) * len * (0.2 + q * 0.3)], scale: [len * 0.34, 0.2 * s, len * 0.34], tint: [0.45 + 0.1 * r(), 0.7 + 0.1 * r(), 0.5], yaw: a });
      }
    }
    parts.push({ mesh: bushClump(1, 12, 8), mat: 'leaf', pos: [0, h - 0.4 * s, 0], scale: [0.42 * s, 0.9 * s, 0.42 * s], tint: [0.5, 0.78, 0.5] });
  }
  return parts;
}
