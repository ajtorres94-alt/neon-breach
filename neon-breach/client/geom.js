// CPU-side mesh generators. Every mesh is a flat triangle list: interleaved
// [px,py,pz, nx,ny,nz, cr,cg,cb, u,v] per vertex (stride 11), centred on the origin.
// Triangle winding is corrected against the vertex normals, so generators only need to get the normals right.

export const STRIDE = 11;

class Builder {
  constructor() { this.v = []; }
  /** Push a triangle from three {p,n,uv} vertices, flipping the winding if it disagrees with the normals. */
  tri(a, b, c) {
    const ux = b.p[0] - a.p[0], uy = b.p[1] - a.p[1], uz = b.p[2] - a.p[2], vx = c.p[0] - a.p[0], vy = c.p[1] - a.p[1], vz = c.p[2] - a.p[2];
    const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
    const nx = a.n[0] + b.n[0] + c.n[0], ny = a.n[1] + b.n[1] + c.n[1], nz = a.n[2] + b.n[2] + c.n[2];
    if (gx * gx + gy * gy + gz * gz < 1e-14) return;                       // degenerate
    const t = gx * nx + gy * ny + gz * nz >= 0 ? [a, b, c] : [a, c, b];
    for (const q of t) this.v.push(q.p[0], q.p[1], q.p[2], q.n[0], q.n[1], q.n[2], q.c ? q.c[0] : 1, q.c ? q.c[1] : 1, q.c ? q.c[2] : 1, q.uv[0], q.uv[1]);
  }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
  done() { return new Float32Array(this.v); }
}
const V = (p, n, uv = [0, 0], c = null) => ({ p, n, uv, c });
const norm = (x, y, z) => { const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };

/** Surface of revolution / parametric grid: fn(i/nu, j/nv) -> {p,n,uv}. */
function grid(b, nu, nv, fn) {
  const rows = [];
  for (let j = 0; j <= nv; j++) { const r = []; for (let i = 0; i <= nu; i++) r.push(fn(i / nu, j / nv)); rows.push(r); }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) b.quad(rows[j][i], rows[j][i + 1], rows[j + 1][i + 1], rows[j + 1][i]);
}

export function genCube() {
  const b = new Builder();
  const F = [[[1, 0, 0], [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]]], [[-1, 0, 0], [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]]],
    [[0, 1, 0], [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]]], [[0, -1, 0], [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]]],
    [[0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]], [[0, 0, -1], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]]];
  const uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
  for (const [n, vs] of F) b.quad(...vs.map((p, i) => V([p[0] * 0.5, p[1] * 0.5, p[2] * 0.5], n, uv[i])));
  return b.done();
}

/** Unit sphere, radius 1. */
export function genSphere(seg = 20, rings = 12) {
  const b = new Builder();
  grid(b, seg, rings, (s, t) => {
    const a = s * Math.PI * 2, e = t * Math.PI, x = Math.cos(a) * Math.sin(e), y = Math.cos(e), z = Math.sin(a) * Math.sin(e);
    return V([x, y, z], [x, y, z], [s, t]);
  });
  return b.done();
}

/** Frustum along Y, height 1 (y in [-0.5,0.5]), radii rb (bottom) / rt (top). Optionally capped. */
export function genFrustum(rt = 1, rb = 1, seg = 20, capped = true) {
  const b = new Builder(), slope = (rb - rt);                               // normal tilts by the taper
  grid(b, seg, 1, (s, t) => {
    const a = s * Math.PI * 2, r = rt + (rb - rt) * t, c = Math.cos(a), sn = Math.sin(a);
    const n = norm(c, slope, sn);
    return V([c * r, 0.5 - t, sn * r], n, [s, t]);
  });
  if (capped) for (const [y, r, ny] of [[0.5, rt, 1], [-0.5, rb, -1]]) {
    if (r <= 0) continue;
    for (let i = 0; i < seg; i++) {
      const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
      b.tri(V([0, y, 0], [0, ny, 0], [0.5, 0.5]), V([Math.cos(a0) * r, y, Math.sin(a0) * r], [0, ny, 0], [0.5 + Math.cos(a0) * 0.5, 0.5 + Math.sin(a0) * 0.5]),
        V([Math.cos(a1) * r, y, Math.sin(a1) * r], [0, ny, 0], [0.5 + Math.cos(a1) * 0.5, 0.5 + Math.sin(a1) * 0.5]));
    }
  }
  return b.done();
}
export const genCylinder = (seg = 20) => genFrustum(1, 1, seg, true);
export const genCone = (seg = 20) => genFrustum(0, 1, seg, true);

/** Capsule along Y with hemisphere radius r and straight section `len` (total length len + 2r). */
export function genCapsule(r, len, seg = 14, hemi = 6) {
  const b = new Builder(), h = len / 2;
  const rows = [];
  for (let j = 0; j <= hemi; j++) { const e = j / hemi * Math.PI / 2; rows.push([Math.sin(e) * r, h + Math.cos(e) * r, Math.sin(e), Math.cos(e)]); }
  for (let j = hemi; j >= 0; j--) { const e = j / hemi * Math.PI / 2; rows.push([Math.sin(e) * r, -h - Math.cos(e) * r, Math.sin(e), -Math.cos(e)]); }
  const nv = rows.length - 1;
  grid(b, seg, nv, (s, t) => {
    const row = rows[Math.round(t * nv)], a = s * Math.PI * 2;
    return V([Math.cos(a) * row[0], row[1], Math.sin(a) * row[0]], [Math.cos(a) * row[2], row[3], Math.sin(a) * row[2]], [s, t]);
  });
  return b.done();
}

/** Flat unit disc in the XZ plane facing up (blob shadows). */
export function genDisc(seg = 20) {
  const b = new Builder();
  for (let i = 0; i < seg; i++) {
    const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
    b.tri(V([0, 0, 0], [0, 1, 0], [0.5, 0.5]), V([Math.cos(a0), 0, Math.sin(a0)], [0, 1, 0], [0.5, 0.5]), V([Math.cos(a1), 0, Math.sin(a1)], [0, 1, 0], [0.5, 0.5]));
  }
  return b.done();
}

/**
 * Box with rounded edges, world-size half extents (hx,hy,hz) and bevel radius r.
 * A box face is a lattice; every lattice point is pushed onto the sphere-swept surface (Minkowski sum of the
 * inner box and a sphere), which gives smooth bevels with correct normals. maxCell subdivides long flat faces.
 */
export function genRBox(hx, hy, hz, r, maxCell = Infinity, coarse = false) {
  const h = [hx, hy, hz];
  r = Math.max(0.002, Math.min(r, Math.min(hx, hy, hz) * 0.98));
  const inner = h.map(v => v - r);
  const samples = (hh) => {
    const ih = hh - r, s = coarse ? [-hh, -hh + r * 0.45, -ih] : [-hh, -hh + r * 0.35, -hh + r * 0.7, -ih];
    const span = ih * 2, n = Math.max(1, Math.ceil(span / maxCell));
    for (let i = 1; i < n; i++) s.push(-ih + span * i / n);
    if (coarse) s.push(ih, hh - r * 0.45, hh); else s.push(ih, hh - r * 0.7, hh - r * 0.35, hh);
    return s.filter((v, i, a) => i === 0 || v > a[i - 1] + 1e-6);
  };
  const S = h.map(samples), b = new Builder();
  for (let a = 0; a < 3; a++) for (const sg of [1, -1]) {
    const bx = (a + 1) % 3, cx = (a + 2) % 3, sb = S[bx], sc = S[cx];
    const pts = [];
    for (let j = 0; j < sc.length; j++) { const row = []; for (let i = 0; i < sb.length; i++) {
      const P = [0, 0, 0]; P[a] = sg * h[a]; P[bx] = sb[i]; P[cx] = sc[j];
      const d = [0, 0, 0], q = [0, 0, 0];
      for (let k = 0; k < 3; k++) { const c = Math.max(-inner[k], Math.min(inner[k], P[k])); d[k] = P[k] - c; q[k] = c; }
      const n = norm(d[0], d[1], d[2]);
      row.push(V([q[0] + n[0] * r, q[1] + n[1] * r, q[2] + n[2] * r], n, [(sb[i] / h[bx]) * 0.5 + 0.5, (sc[j] / h[cx]) * 0.5 + 0.5]));
    } pts.push(row); }
    for (let j = 0; j < sc.length - 1; j++) for (let i = 0; i < sb.length - 1; i++) b.quad(pts[j][i], pts[j][i + 1], pts[j + 1][i + 1], pts[j + 1][i]);
  }
  return b.done();
}

/**
 * Smooth lofted solid along Y: sections = [{ y, rx, rz, cx = 0, cz = 0 }, ...] (elliptical rings, bottom to top).
 * Used for torsos, heads, limbs and helmets. Ends are capped when the end ring has a real radius.
 */
export function genLoft(sections, seg = 18) {
  const n = sections.length, b = new Builder(), P = [];
  let total = 0; const accum = [0];
  for (let j = 1; j < n; j++) { total += Math.abs(sections[j].y - sections[j - 1].y) + 1e-6; accum.push(total); }
  for (let j = 0; j < n; j++) {
    const s = sections[j], row = [];
    for (let i = 0; i <= seg; i++) { const a = i / seg * Math.PI * 2; row.push([(s.cx || 0) + Math.cos(a) * s.rx, s.y, (s.cz || 0) + Math.sin(a) * s.rz]); }
    P.push(row);
  }
  const N = (j, i) => {
    const i0 = (i - 1 + seg) % seg, i1 = (i + 1) % seg, j0 = Math.max(0, j - 1), j1 = Math.min(n - 1, j + 1);
    const du = [P[j][i1][0] - P[j][i0][0], P[j][i1][1] - P[j][i0][1], P[j][i1][2] - P[j][i0][2]];
    const dv = [P[j1][i][0] - P[j0][i][0], P[j1][i][1] - P[j0][i][1], P[j1][i][2] - P[j0][i][2]];
    const nx = dv[1] * du[2] - dv[2] * du[1], ny = dv[2] * du[0] - dv[0] * du[2], nz = dv[0] * du[1] - dv[1] * du[0], l = Math.hypot(nx, ny, nz);
    if (l < 1e-9) return [0, j === 0 ? -1 : 1, 0];
    return [nx / l, ny / l, nz / l];
  };
  const vert = (j, i) => V(P[j][i], N(j, i), [i / seg, accum[j] / total]);
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < seg; i++) b.quad(vert(j, i), vert(j, i + 1), vert(j + 1, i + 1), vert(j + 1, i));
  for (const [j, ny] of [[0, -1], [n - 1, 1]]) {
    const s = sections[j]; if (s.rx < 0.002 || s.rz < 0.002) continue;
    for (let i = 0; i < seg; i++) b.tri(V([s.cx || 0, s.y, s.cz || 0], [0, ny, 0], [0.5, 0.5]), V(P[j][i], [0, ny, 0], [0.5, 0.5]), V(P[j][i + 1], [0, ny, 0], [0.5, 0.5]));
  }
  return b.done();
}

// ---------------------------------------------------------------- transforms
/** 3x3 rotation (column-major, like WebGL) from yaw (Y), pitch (X), roll (Z): R = Ry * Rx * Rz. */
export function rotYXZ(out, yaw, pitch, roll = 0) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
  // M = Ry*Rx columns
  const m0 = [cy, 0, -sy], m1 = [sy * sp, cp, cy * sp], m2 = [sy * cp, -sp, cy * cp];
  for (let k = 0; k < 3; k++) {
    out[k] = m0[k] * cr + m1[k] * sr;
    out[3 + k] = -m0[k] * sr + m1[k] * cr;
    out[6 + k] = m2[k];
  }
  return out;
}

/** Rotation whose +Y axis points along (dx,dy,dz) (limbs, pipes). `up` hints the roll. */
export function alignY(out, dx, dy, dz, up = [0, 0, -1]) {
  const y = norm(dx, dy, dz);
  let u = up; if (Math.abs(y[0] * u[0] + y[1] * u[1] + y[2] * u[2]) > 0.95) u = [1, 0, 0];
  let x = [y[1] * u[2] - y[2] * u[1], y[2] * u[0] - y[0] * u[2], y[0] * u[1] - y[1] * u[0]]; x = norm(x[0], x[1], x[2]);
  const z = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
  out[0] = x[0]; out[1] = x[1]; out[2] = x[2]; out[3] = y[0]; out[4] = y[1]; out[5] = y[2]; out[6] = z[0]; out[7] = z[1]; out[8] = z[2];
  return out;
}

/** Append `mesh` transformed (scale, rotation R (3x3 col-major or null), translation) and tinted into a plain array. */
export function appendMesh(out, mesh, pos, R, scale, tint, uvMul = 1) {
  const sx = scale[0], sy = scale[1], sz = scale[2];
  for (let i = 0; i < mesh.length; i += STRIDE) {
    let x = mesh[i] * sx, y = mesh[i + 1] * sy, z = mesh[i + 2] * sz;
    let nx = mesh[i + 3] / sx, ny = mesh[i + 4] / sy, nz = mesh[i + 5] / sz;
    if (R) {
      const X = R[0] * x + R[3] * y + R[6] * z, Y = R[1] * x + R[4] * y + R[7] * z, Z = R[2] * x + R[5] * y + R[8] * z; x = X; y = Y; z = Z;
      const NX = R[0] * nx + R[3] * ny + R[6] * nz, NY = R[1] * nx + R[4] * ny + R[7] * nz, NZ = R[2] * nx + R[5] * ny + R[8] * nz; nx = NX; ny = NY; nz = NZ;
    }
    const nl = Math.hypot(nx, ny, nz) || 1;
    out.push(x + pos[0], y + pos[1], z + pos[2], nx / nl, ny / nl, nz / nl, tint[0] * mesh[i + 6], tint[1] * mesh[i + 7], tint[2] * mesh[i + 8], mesh[i + 9] * uvMul, mesh[i + 10] * uvMul);
  }
}


// ---------------------------------------------------------------- organic shapes
const hash3 = (x, y, z, s) => { const v = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + s * 19.19) * 43758.5453; return v - Math.floor(v); };
/** Smooth value noise in 0..1. */
export function noise3(x, y, z, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const L = (a, b, t) => a + (b - a) * t, h = (i, j, k) => hash3(xi + i, yi + j, zi + k, s);
  return L(L(L(h(0, 0, 0), h(1, 0, 0), u), L(h(0, 1, 0), h(1, 1, 0), u), v), L(L(h(0, 0, 1), h(1, 0, 1), u), L(h(0, 1, 1), h(1, 1, 1), u), v), w);
}
export const fbm3 = (x, y, z, s = 0) => 0.58 * noise3(x, y, z, s) + 0.29 * noise3(x * 2.1, y * 2.1, z * 2.1, s + 1) + 0.13 * noise3(x * 4.3, y * 4.3, z * 4.3, s + 2);

/**
 * Lumpy solid for boulders, hedges, canopies and dunes: a super-ellipsoid (e < 1 is squarer, 1 is an ellipsoid) with noise carved INWARD (so it always
 * stays inside its half-extents hx, hy, hz, which are the collision box) and an optional taper towards the top. Smooth normals from the lattice.
 */
export function genBlob(hx, hy, hz, o = {}) {
  const { e = 0.7, amp = 0.2, f = 1, taper = 0, seg = 22, rings = 14, seed = 0, uvs = 1 } = o;
  const sp = (v, p) => Math.sign(v) * Math.pow(Math.abs(v), p);
  const P = [];
  for (let j = 0; j <= rings; j++) {
    const th = -Math.PI / 2 + Math.PI * j / rings, ct = Math.cos(th), st = Math.sin(th), row = [];
    for (let i = 0; i <= seg; i++) {
      const ph = i / seg * Math.PI * 2;
      let x = hx * sp(ct, e) * sp(Math.cos(ph), e), y = hy * sp(st, e), z = hz * sp(ct, e) * sp(Math.sin(ph), e);
      const k = 1 - amp * fbm3(x * f, y * f, z * f, seed); x *= k; y *= k; z *= k;
      if (taper && y > 0) { const t = 1 - taper * Math.pow(y / hy, 2); x *= t; z *= t; }
      row.push([x, y, z]);
    }
    P.push(row);
  }
  const b = new Builder(), N = [];
  for (let j = 0; j <= rings; j++) {
    const row = [];
    for (let i = 0; i <= seg; i++) {
      if (j === 0 || j === rings) { row.push([0, j === 0 ? -1 : 1, 0]); continue; }
      const a = P[j][i === seg ? 1 : i + 1], c = P[j][i === 0 ? seg - 1 : i - 1], d = P[j + 1][i], e2 = P[j - 1][i];
      const tu = [a[0] - c[0], a[1] - c[1], a[2] - c[2]], tv = [d[0] - e2[0], d[1] - e2[1], d[2] - e2[2]];
      let n = [tu[1] * tv[2] - tu[2] * tv[1], tu[2] * tv[0] - tu[0] * tv[2], tu[0] * tv[1] - tu[1] * tv[0]];
      const p = P[j][i]; if (n[0] * p[0] + n[1] * p[1] + n[2] * p[2] < 0) n = [-n[0], -n[1], -n[2]];
      row.push(norm(n[0], n[1], n[2]));
    }
    N.push(row);
  }
  for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) {
    const mk = (jj, ii) => V(P[jj][ii], N[jj][ii], [ii / seg * (hx + hz) * 1.57 * uvs, jj / rings * hy * 3.14 * uvs]);
    b.quad(mk(j, i), mk(j, i + 1), mk(j + 1, i + 1), mk(j + 1, i));
  }
  return b.done();
}


/**
 * Smooth surface from a lattice of points. P[j][i] positions (i wraps when `wrap`), C optional colours, UV optional function (i, j, p, n) -> [u, v].
 * Normals come from central differences on the lattice, so dense lattices give smooth, high-resolution shading. `cap0`/`cap1` close the ends.
 */
export function genLattice(P, o = {}) {
  const { C = null, uv = null, wrap = true, flip = false } = o;
  const nj = P.length - 1, ni = P[0].length - 1, b = new Builder(), N = [];
  for (let j = 0; j <= nj; j++) {
    const row = [];
    for (let i = 0; i <= ni; i++) {
      const ia = wrap ? (i === ni ? 1 : i + 1) : Math.min(i + 1, ni), ic = wrap ? (i === 0 ? ni - 1 : i - 1) : Math.max(i - 1, 0);
      const a = P[j][ia], c = P[j][ic], d = P[Math.min(j + 1, nj)][i], e = P[Math.max(j - 1, 0)][i];
      const tu = [a[0] - c[0], a[1] - c[1], a[2] - c[2]], tv = [d[0] - e[0], d[1] - e[1], d[2] - e[2]];
      let n = [tu[1] * tv[2] - tu[2] * tv[1], tu[2] * tv[0] - tu[0] * tv[2], tu[0] * tv[1] - tu[1] * tv[0]];
      if (flip) n = [-n[0], -n[1], -n[2]];
      row.push(norm(n[0], n[1], n[2]));
    }
    N.push(row);
  }
  const mk = (j, i) => V(P[j][i], N[j][i], uv ? uv(i, j, P[j][i], N[j][i]) : [i / ni, j / nj], C ? C[j][i] : null);
  for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) b.quad(mk(j, i), mk(j, i + 1), mk(j + 1, i + 1), mk(j + 1, i));
  return b.done();
}
