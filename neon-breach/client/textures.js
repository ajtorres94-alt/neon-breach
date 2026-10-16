// Procedural, tileable material textures. Everything is generated in code at start-up (no image assets).
// Each material is a function (u, v) -> [r, g, b, height] over the unit square; the height channel is baked into the
// colour as emboss lighting so surfaces read as bumpy under the dynamic lights.

export const TEX_SCALE = {          // metres per texture tile
  floor: 3, wall: 2.4, metal: 2.4, crate: 1.2, accent: 2.4, marble: 3, stone: 2.2, rock: 1.6, grass: 3, hedge: 1.4, dark: 3,
  glow: 2, asphalt: 4, sand: 1.2, brick: 2.0, wood: 2.2, rust: 2.4, concrete: 3.2, olive: 2.4, blue: 2.4, red: 2.4,
  dirt: 3.2, hay: 1.5, leaf: 1.6, plain: 1, fabric: 0.5, camoWood: 1, camoDesert: 1, camoUrban: 1, camoMulti: 1, skin: 1, gunmetal: 1, polymer: 1, gunwood: 1, gunmetalS: 1, polymerS: 1, gunwoodS: 1,
};

// ---------------------------------------------------------------- noise helpers (all tileable)
function hash2(x, y, s) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1013904223)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y, Px, Py, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const x0 = ((xi % Px) + Px) % Px, x1 = (x0 + 1) % Px, y0 = ((yi % Py) + Py) % Py, y1 = (y0 + 1) % Py;
  const a = hash2(x0, y0, s), b = hash2(x1, y0, s), c = hash2(x0, y1, s), d = hash2(x1, y1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(u, v, f, oct, s) {
  let a = 0, amp = 0.5, tot = 0;
  for (let i = 0; i < oct; i++) { a += vnoise(u * f, v * f, f, f, s + i * 17) * amp; tot += amp; amp *= 0.5; f *= 2; }
  return a / tot;
}
/** Tileable cellular noise: returns [F1, F2, cell id hash] */
function worley(u, v, F, s) {
  const x = u * F, y = v * F, xi = Math.floor(x), yi = Math.floor(y);
  let d1 = 9, d2 = 9, id = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = xi + i, cy = yi + j, wx = ((cx % F) + F) % F, wy = ((cy % F) + F) % F;
    const px = cx + hash2(wx, wy, s) , py = cy + hash2(wx, wy, s + 99);
    const d = Math.hypot(px - x, py - y);
    if (d < d1) { d2 = d1; d1 = d; id = hash2(wx, wy, s + 7); } else if (d < d2) d2 = d;
  }
  return [d1, d2, id];
}
const clamp = (v, a = 0, b = 1) => v < a ? a : v > b ? b : v;
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const mix3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const fr = (x) => x - Math.floor(x);
const mul3 = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

// ---------------------------------------------------------------- material functions
const GEN = {};

GEN.concrete = (u, v) => {
  const n = fbm(u, v, 4, 4, 1), fine = vnoise(u * 128, v * 128, 128, 128, 2);
  let c = 0.52 + (n - 0.5) * 0.28 + (fine - 0.5) * 0.09;
  const stain = smooth(0.58, 0.72, fbm(u, v, 2, 3, 7)); c *= 1 - 0.22 * stain;
  const j = Math.min(Math.abs(u - 0.5), Math.abs(fr(v + 0.25) - 0.5)) < 0.004 ? 0.55 : 1;   // expansion joints
  return [c * j, c * j * 0.99, c * j * 0.96, (fine * 0.4 + n * 0.4) * j];
};

GEN.floor = (u, v) => {
  const tu = fr(u * 4), tv = fr(v * 4), e = Math.min(tu, 1 - tu, tv, 1 - tv);
  const id = hash2(Math.floor(u * 4), Math.floor(v * 4), 3), n = fbm(u, v, 8, 4, 5), fine = vnoise(u * 160, v * 160, 160, 160, 9);
  const grout = e < 0.018;
  const tone = 0.88 + id * 0.24 + (n - 0.5) * 0.18 + (fine - 0.5) * 0.06;
  const scuff = smooth(0.7, 0.85, fbm(u, v, 12, 3, 11)) * 0.12;
  if (grout) return [0.12, 0.13, 0.15, 0];
  const edge = smooth(0.018, 0.05, e);
  return [(0.31 + scuff) * tone * (0.9 + 0.1 * edge), (0.34 + scuff) * tone * (0.9 + 0.1 * edge), (0.39 + scuff) * tone * (0.9 + 0.1 * edge), 0.55 * edge + fine * 0.2];
};

GEN.wall = (u, v) => {
  const n = fbm(u, v, 3, 4, 21), fine = vnoise(u * 140, v * 140, 140, 140, 22), streak = vnoise(u * 48, v * 3, 48, 3, 23);
  let c = 0.66 + (n - 0.5) * 0.14 + (fine - 0.5) * 0.06 - streak * 0.05;
  const seam = (Math.min(Math.abs(fr(u * 2) - 0.0), 1 - fr(u * 2)) < 0.006) || (Math.min(fr(v * 2), 1 - fr(v * 2)) < 0.006);
  if (seam) c *= 0.7;
  return [c * 0.94, c * 0.97, c, seam ? 0 : 0.5 + fine * 0.3];
};

GEN.metal = (u, v) => {
  const pu = fr(u * 2), pv = fr(v * 2), e = Math.min(pu, 1 - pu, pv, 1 - pv);
  const brush = vnoise(u * 8, v * 200, 8, 200, 31), n = fbm(u, v, 5, 4, 32);
  let c = 0.44 + (brush - 0.5) * 0.12 + (n - 0.5) * 0.14;
  let h = 0.6;
  if (e < 0.012) { c *= 0.45; h = 0; }
  else if (e < 0.03) { c *= 1.12; }
  // rivets near the plate corners
  for (const [cx, cy] of [[0.07, 0.07], [0.93, 0.07], [0.07, 0.93], [0.93, 0.93]]) {
    const d = Math.hypot(pu - cx, pv - cy); if (d < 0.022) { c *= 1.25 - d * 12; h = 1; }
  }
  const scratch = smooth(0.93, 0.97, vnoise(u * 20, v * 300, 20, 300, 33)) * 0.25; c += scratch;
  return [c * 0.92, c * 0.97, c * 1.08, h];
};

GEN.crate = (u, v) => {
  const pv = fr(v * 5), plank = Math.floor(v * 5), grainN = vnoise(u * 5, v * 60, 5, 60, 41 + plank), n = fbm(u, v, 6, 3, 43);
  const tone = 0.8 + hash2(plank, 1, 42) * 0.35;
  let col = mul3([0.64, 0.46, 0.25], tone * (0.78 + grainN * 0.4) * (0.92 + n * 0.16));
  let h = 0.55 + grainN * 0.15;
  if (pv < 0.035 || pv > 0.965) { col = [0.12, 0.08, 0.04]; h = 0; }
  const bat = u < 0.1 || u > 0.9;                                       // vertical battens at the tile edges
  if (bat) { col = mul3(col, 0.82); h += 0.25; }
  const nailU = u < 0.05 ? 0.05 : u > 0.95 ? 0.95 : 0.5, nailV = (Math.floor(v * 5) + 0.5) / 5;
  if (Math.hypot((u - nailU) * 1.0, (v - nailV) * 1.0) < 0.012 && bat) { col = [0.2, 0.2, 0.22]; h = 1; }
  return [col[0], col[1], col[2], h];
};

GEN.accent = (u, v) => {
  const pu = fr(u * 2), pv = fr(v * 2), e = Math.min(pu, 1 - pu, pv, 1 - pv), n = fbm(u, v, 6, 3, 51), fine = vnoise(u * 150, v * 150, 150, 150, 52);
  let c = [0.13, 0.36, 0.5]; c = mul3(c, 0.9 + (n - 0.5) * 0.25 + (fine - 0.5) * 0.06);
  let h = 0.6;
  if (e < 0.012) { c = mul3(c, 0.4); h = 0; } else if (e < 0.04) { c = mul3(c, 1.15); }
  if (hash2(Math.floor(u * 90), Math.floor(v * 90), 53) > 0.996) { c = [0.35, 0.36, 0.38]; }   // chipped paint
  return [c[0], c[1], c[2], h];
};

GEN.marble = (u, v) => {
  const w = fbm(u, v, 4, 5, 61), t = Math.abs(Math.sin((u * 2 + v + w * 2.6) * Math.PI * 2)), t2 = Math.abs(Math.sin((u * 3 - v * 2 + w * 3.4) * Math.PI * 2));
  const vein = Math.min(smooth(0.0, 0.09, t), smooth(0.0, 0.05, t2) * 0.5 + 0.5);
  let c = mix3([0.5, 0.5, 0.55], [0.86, 0.84, 0.8], vein);
  c = mul3(c, 0.95 + (vnoise(u * 160, v * 160, 160, 160, 62) - 0.5) * 0.05);
  const pu = fr(u * 2), pv = fr(v * 2), e = Math.min(pu, 1 - pu, pv, 1 - pv);
  if (e < 0.008) c = mul3(c, 0.6);
  return [c[0], c[1], c[2], 0.5];
};

GEN.stone = (u, v) => {
  const rows = 5, row = Math.floor(v * rows), bv = fr(v * rows), bu = fr(u * 2 + (row % 2) * 0.5);
  const id = hash2(Math.floor(u * 2 + (row % 2) * 0.5), row, 71), n = fbm(u, v, 8, 4, 72), pit = vnoise(u * 180, v * 180, 180, 180, 73);
  if (bv < 0.06 || bv > 0.94 || bu < 0.03 || bu > 0.97) return [0.36, 0.34, 0.31, 0];
  const edge = smooth(0.06, 0.16, Math.min(bv, 1 - bv)) * smooth(0.03, 0.09, Math.min(bu, 1 - bu));
  const tone = 0.86 + id * 0.26 + (n - 0.5) * 0.25 - (pit > 0.8 ? 0.08 : 0);
  return [0.60 * tone * (0.85 + 0.15 * edge), 0.57 * tone * (0.85 + 0.15 * edge), 0.52 * tone * (0.85 + 0.15 * edge), 0.5 * edge + n * 0.5];
};

GEN.rock = (u, v) => {
  const w = worley(u, v, 4, 81), n = fbm(u, v, 6, 5, 82), crack = smooth(0.0, 0.05, w[1] - w[0]);
  const c = (0.46 + (n - 0.5) * 0.4) * (0.9 + w[2] * 0.2) * (0.6 + 0.4 * crack);
  return [c * 1.0, c * 0.97, c * 0.92, n * 0.7 + (1 - w[0]) * 0.3];
};

GEN.grass = (u, v) => {
  const n = fbm(u, v, 5, 5, 91), blade = vnoise(u * 160, v * 40, 160, 40, 92), blade2 = vnoise(u * 90, v * 70, 90, 70, 93), dry = fbm(u, v, 3, 3, 94);
  let c = mix3([0.17, 0.30, 0.11], [0.30, 0.45, 0.17], n);
  c = mix3(c, [0.45, 0.46, 0.2], smooth(0.6, 0.85, dry) * 0.4);
  c = mul3(c, 0.78 + blade * 0.3 + blade2 * 0.2);
  return [c[0], c[1], c[2], blade * 0.5 + blade2 * 0.5];
};

function leafy(base, hi, F, seed) {
  return (u, v) => {
    const w = worley(u, v, F, seed), n = fbm(u, v, 8, 3, seed + 1);
    const lit = clamp(1 - w[0] * 1.35), tone = 0.7 + w[2] * 0.5;
    let c = mix3(mul3(base, 0.7), hi, lit * 0.7 * tone);
    c = mul3(c, 0.85 + n * 0.3);
    if (w[1] - w[0] < 0.07) c = mul3(c, 0.7);
    return [c[0], c[1], c[2], lit];
  };
}
GEN.hedge = leafy([0.12, 0.32, 0.13], [0.26, 0.55, 0.2], 8, 101);
GEN.leaf = leafy([0.17, 0.34, 0.12], [0.34, 0.54, 0.2], 6, 111);

GEN.dark = (u, v) => {
  const pu = fr(u * 4), pv = fr(v * 4), e = Math.min(pu, 1 - pu, pv, 1 - pv), n = fbm(u, v, 8, 3, 121);
  let c = 0.16 + (n - 0.5) * 0.06; if (e < 0.012) c *= 0.5;
  return [c, c * 1.03, c * 1.15, e < 0.012 ? 0 : 0.5];
};

GEN.glow = (u, v) => {
  const b = 0.9 + 0.1 * Math.sin(v * Math.PI * 32), n = fbm(u, v, 6, 3, 131);
  return [0.3 * b + n * 0.1, 0.95 * b, 0.85 * b, 0];
};

GEN.asphalt = (u, v) => {
  const n = fbm(u, v, 6, 5, 141), fine = vnoise(u * 200, v * 200, 200, 200, 142), agg = hash2(Math.floor(u * 220), Math.floor(v * 220), 143);
  let c = 0.17 + (n - 0.5) * 0.08 + (fine - 0.5) * 0.06 + (agg > 0.93 ? 0.16 : 0);
  const w = worley(u, v, 3, 144), crack = 1 - smooth(0.0, 0.012, w[1] - w[0]); c *= 1 - 0.7 * crack;
  const oil = smooth(0.62, 0.8, fbm(u, v, 2, 3, 145)); c *= 1 - 0.3 * oil;
  return [c, c, c * 1.04, fine * 0.5 + agg * 0.3 - crack * 0.5];
};

GEN.sand = (u, v) => {                                                   // stacked sandbags
  const rows = 4, row = Math.floor(v * rows), bv = fr(v * rows), bu = fr(u * 2 + (row % 2) * 0.5);
  const id = hash2(Math.floor(u * 2 + (row % 2) * 0.5), row, 151);
  const bump = Math.pow(Math.sin(bu * Math.PI), 0.55) * Math.pow(Math.sin(bv * Math.PI), 0.55);
  const weave = (Math.sin(u * 620) * Math.sin(v * 620)) * 0.04;
  const tone = 0.85 + id * 0.25;
  let c = mul3([0.72, 0.63, 0.43], tone * (0.62 + 0.45 * bump) + weave);
  if (bump < 0.12) c = mul3(c, 0.55);
  return [c[0], c[1], c[2], bump];
};

GEN.brick = (u, v) => {
  const rows = 8, row = Math.floor(v * rows), bv = fr(v * rows), bu = fr(u * 4 + (row % 2) * 0.5);
  const id = hash2(Math.floor(u * 4 + (row % 2) * 0.5), row, 161), n = fbm(u, v, 12, 4, 162), fine = vnoise(u * 200, v * 200, 200, 200, 163);
  if (bv < 0.1 || bv > 0.93 || bu < 0.035 || bu > 0.965) { const m = 0.6 + fine * 0.12; return [m, m * 0.97, m * 0.92, 0]; }
  let c = mix3([0.50, 0.21, 0.16], [0.68, 0.34, 0.24], id);
  c = mul3(c, 0.82 + n * 0.35 + (fine - 0.5) * 0.1);
  if (hash2(Math.floor(u * 60), Math.floor(v * 60), 164) > 0.985) c = mul3(c, 1.4);
  const edge = smooth(0.1, 0.18, Math.min(bv, 1 - bv));
  return [c[0] * (0.8 + 0.2 * edge), c[1] * (0.8 + 0.2 * edge), c[2] * (0.8 + 0.2 * edge), 0.6 + n * 0.3];
};

GEN.wood = (u, v) => {
  const planks = 6, pl = Math.floor(u * planks), pu = fr(u * planks), tone = 0.78 + hash2(pl, 2, 171) * 0.35;
  const grain = vnoise(u * 60, v * 3 + pl * 7, 60, 3, 172 + pl), ring = 0.5 + 0.5 * Math.sin((grain * 9 + v * 2) * Math.PI), n = fbm(u, v, 5, 4, 173);
  let c = mix3([0.46, 0.32, 0.19], [0.52, 0.48, 0.42], smooth(0.55, 0.85, n) * 0.6);
  c = mul3(c, tone * (0.82 + ring * 0.25));
  if (pu < 0.045 || pu > 0.955) return [0.07, 0.05, 0.03, 0];
  const knot = worley(u, v, 3, 175);
  if (knot[0] < 0.1) c = mul3(c, 0.6 + knot[0] * 4);
  return [c[0], c[1], c[2], 0.5 + grain * 0.3];
};

GEN.rust = (u, v) => {
  const ridge = 0.5 + 0.5 * Math.sin(u * Math.PI * 2 * 12), n = fbm(u, v, 5, 5, 181), streak = vnoise(u * 40, v * 3, 40, 3, 182);
  const rustAmt = smooth(0.42, 0.68, n * 0.8 + streak * 0.3);
  let c = mix3([0.45, 0.34, 0.23], [0.55, 0.27, 0.11], rustAmt);
  c = mix3(c, [0.28, 0.14, 0.07], smooth(0.75, 0.95, n));
  c = mul3(c, 0.7 + ridge * 0.4);
  return [c[0], c[1], c[2], ridge];
};

function container(base, seed) {
  return (u, v) => {
    const ridge = 0.5 + 0.5 * Math.sin(u * Math.PI * 2 * 10), n = fbm(u, v, 6, 5, seed), streak = vnoise(u * 30, v * 2, 30, 2, seed + 1), fine = vnoise(u * 160, v * 160, 160, 160, seed + 2);
    let c = mul3(base, 0.62 + ridge * 0.5 + (fine - 0.5) * 0.08);
    const wear = smooth(0.62, 0.8, n * 0.7 + streak * 0.35); c = mix3(c, [0.40, 0.23, 0.14], wear * 0.8);
    c = mul3(c, 1 - 0.18 * smooth(0.5, 1, streak));
    return [c[0], c[1], c[2], ridge];
  };
}
GEN.olive = container([0.30, 0.37, 0.22], 191);
GEN.blue = container([0.17, 0.32, 0.54], 201);
GEN.red = container([0.60, 0.19, 0.15], 211);

GEN.dirt = (u, v) => {
  const n = fbm(u, v, 5, 5, 221), fine = vnoise(u * 180, v * 180, 180, 180, 222), peb = hash2(Math.floor(u * 90), Math.floor(v * 90), 223);
  let c = mix3([0.33, 0.25, 0.16], [0.46, 0.36, 0.24], n);
  c = mul3(c, 0.88 + (fine - 0.5) * 0.25); if (peb > 0.955) c = mul3([0.55, 0.5, 0.44], 0.8 + fine * 0.3);
  return [c[0], c[1], c[2], fine * 0.6 + (peb > 0.955 ? 0.4 : 0)];
};

GEN.hay = (u, v) => {
  const st = vnoise(u * 220, v * 6, 220, 6, 241), st2 = vnoise(u * 110, v * 14, 110, 14, 242), n = fbm(u, v, 4, 3, 243);
  const c = mix3([0.62, 0.48, 0.2], [0.86, 0.72, 0.34], st * 0.7 + st2 * 0.3);
  return [c[0] * (0.85 + n * 0.3), c[1] * (0.85 + n * 0.3), c[2] * (0.85 + n * 0.3), st];
};

GEN.plain = () => [1, 1, 1, 0.5];
GEN.fabric = (u, v) => {
  const w = 0.5 + 0.5 * Math.sin(u * 256 * Math.PI) * Math.sin(v * 256 * Math.PI), n = fbm(u, v, 16, 3, 231);
  const c = 0.86 + w * 0.1 + (n - 0.5) * 0.12;
  return [c, c, c, w];
};

// ---------------------------------------------------------------- avatar and weapon materials
function camo(cols, seed, F = 5) {
  return (u, v) => {
    const a = fbm(u, v, F, 4, seed), b = fbm(u, v, F * 1.3, 4, seed + 7), c = vnoise(u * F * 5, v * F * 5, F * 5, F * 5, seed + 13);
    let col = cols[0];
    if (a > 0.52) col = cols[1];
    if (b > 0.58) col = cols[2];
    if (c > 0.74 && a < 0.5) col = cols[3];
    const fine = vnoise(u * 120, v * 120, 120, 120, seed + 21), weave = 0.5 + 0.5 * Math.sin(u * 220 * Math.PI) * Math.sin(v * 220 * Math.PI);
    const k = 0.9 + (fine - 0.5) * 0.14 + weave * 0.06;
    return [col[0] * k, col[1] * k, col[2] * k, weave * 0.6];
  };
}
GEN.camoWood = camo([[0.30, 0.33, 0.20], [0.20, 0.26, 0.14], [0.42, 0.34, 0.20], [0.08, 0.09, 0.07]], 301);
GEN.camoDesert = camo([[0.64, 0.54, 0.38], [0.52, 0.42, 0.28], [0.72, 0.65, 0.5], [0.36, 0.3, 0.22]], 311);
GEN.camoUrban = camo([[0.36, 0.38, 0.4], [0.24, 0.26, 0.28], [0.5, 0.52, 0.54], [0.1, 0.11, 0.12]], 321);
GEN.camoMulti = camo([[0.5, 0.45, 0.33], [0.36, 0.38, 0.26], [0.58, 0.51, 0.4], [0.27, 0.21, 0.16]], 331);
GEN.skin = (u, v) => {
  const n = fbm(u, v, 6, 4, 341), pore = vnoise(u * 90, v * 90, 90, 90, 342), ruddy = fbm(u, v, 3, 2, 343);
  const k = 0.93 + (n - 0.5) * 0.12 + (pore - 0.5) * 0.05;
  return [k * (1 + ruddy * 0.04), k * (0.99 - ruddy * 0.02), k * (0.98 - ruddy * 0.02), pore * 0.3];
};
GEN.gunmetal = (u, v) => {                                                 // parkerized steel: fine brushed grain, edge wear
  const grain = vnoise(u * 300, v * 24, 300, 24, 351), grain2 = vnoise(u * 90, v * 90, 90, 90, 352), n = fbm(u, v, 4, 3, 353);
  const k = 0.82 + (grain - 0.5) * 0.22 + (grain2 - 0.5) * 0.1 + (n - 0.5) * 0.1;
  return [k, k * 1.01, k * 1.04, grain * 0.5];
};
GEN.polymer = (u, v) => {                                                  // moulded polymer: fine matte stipple, very low contrast
  const st = vnoise(u * 160, v * 160, 160, 160, 361), st2 = hash2(Math.floor(u * 96), Math.floor(v * 96), 362);
  const k = 0.93 + (st - 0.5) * 0.08 + (st2 > 0.5 ? 0.02 : -0.015);
  return [k, k, k * 1.015, st2 * 0.6];
};
GEN.gunwood = (u, v) => {                                                  // walnut: straight fine grain running along the part (v), darker figure bands
  const g = fbm(u * 0.8, v * 0.25, 3, 3, 371), line = Math.sin((u * 46 + g * 7 + vnoise(u * 5, v * 1.2, 5, 1.2, 372) * 2.4) * Math.PI);
  const k = 0.82 + line * 0.07 + (g - 0.5) * 0.28, fine = vnoise(u * 160, v * 12, 160, 12, 373);
  return [0.4 * k * (0.92 + fine * 0.16), 0.235 * k * (0.92 + fine * 0.16), 0.125 * k * (0.92 + fine * 0.16), line * 0.3];
};

// Smooth variants used on the gun in your hands: the same colours, but a soft satin finish with no stipple, grain bump or noise speckle.
GEN.gunmetalS = (u, v) => { const n = fbm(u, v, 2, 2, 353), k = 0.84 + (n - 0.5) * 0.04; return [k, k * 1.01, k * 1.04, 0]; };
GEN.polymerS = (u, v) => { const n = fbm(u, v, 2, 2, 361), k = 0.94 + (n - 0.5) * 0.03; return [k, k, k * 1.015, 0]; };
GEN.gunwoodS = (u, v) => {
  const g = fbm(u * 0.8, v * 0.25, 2, 2, 371), line = Math.sin((u * 14 + g * 3) * Math.PI), k = 0.84 + line * 0.025 + (g - 0.5) * 0.12;
  return [0.34 * k, 0.205 * k, 0.12 * k, 0];
};

// ---------------------------------------------------------------- baking
function bake(size, fn, bump, paintOverride) {
  const N = size * size, col = new Float32Array(N * 3), hgt = new Float32Array(N);
  const inv = 1 / size;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const o = fn((x + 0.5) * inv, (y + 0.5) * inv), i = y * size + x;
    col[i * 3] = o[0]; col[i * 3 + 1] = o[1]; col[i * 3 + 2] = o[2]; hgt[i] = o[3];
  }
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(size, size), d = img.data;
  const paint = paintOverride !== undefined ? paintOverride : bump > 0;
  const xm = new Int32Array(size), xp = new Int32Array(size);                     // wrapped neighbour indices (textures tile)
  for (let x = 0; x < size; x++) { xm[x] = (x + size - 1) % size; xp[x] = (x + 1) % size; }
  if (paint) {
    const tmp = new Float32Array(N), src = new Float32Array(N);
    for (let pass = 0; pass < 2; pass++) {                                         // soften the relief so surfaces read as painted, not gritty (separable 3x3 box blur)
      src.set(hgt);
      for (let y = 0; y < size; y++) { const r = y * size; for (let x = 0; x < size; x++) tmp[r + x] = src[r + xm[x]] + src[r + x] + src[r + xp[x]]; }
      for (let y = 0; y < size; y++) { const r = y * size, rm = xm[y] * size, rp = xp[y] * size; for (let x = 0; x < size; x++) hgt[r + x] = src[r + x] * 0.35 + ((tmp[rm + x] + tmp[r + x] + tmp[rp + x]) / 9) * 0.65; }
    }
  }
  const cblur = paint ? new Float32Array(N * 3) : null;
  if (paint) {
    const tmp = new Float32Array(N * 3);
    for (let y = 0; y < size; y++) { const r = y * size; for (let x = 0; x < size; x++) { const a = (r + xm[x]) * 3, b = (r + x) * 3, c = (r + xp[x]) * 3; tmp[b] = col[a] + col[b] + col[c]; tmp[b + 1] = col[a + 1] + col[b + 1] + col[c + 1]; tmp[b + 2] = col[a + 2] + col[b + 2] + col[c + 2]; } }
    for (let y = 0; y < size; y++) { const r = y * size, rm = xm[y] * size, rp = xp[y] * size; for (let x = 0; x < size; x++) { const a = (rm + x) * 3, b = (r + x) * 3, c = (rp + x) * 3; for (let k = 0; k < 3; k++) cblur[b + k] = (tmp[a + k] + tmp[b + k] + tmp[c + k]) / 9; } }
  }
  const bb = bump * 1.1;
  for (let y = 0; y < size; y++) {
    const ym = xm[y] * size, yp = xp[y] * size;
    for (let x = 0; x < size; x++) {
      const i = y * size + x, dh = (hgt[ym + xm[x]] - hgt[yp + xp[x]]) * bb, s = clamp(1 + dh, 0.5, 1.5);
      let r = col[i * 3], g = col[i * 3 + 1], b = col[i * 3 + 2];
      if (paint) { r = r * 0.4 + cblur[i * 3] * 0.6; g = g * 0.4 + cblur[i * 3 + 1] * 0.6; b = b * 0.4 + cblur[i * 3 + 2] * 0.6; const l = r * 0.3 + g * 0.59 + b * 0.11; r = clamp(l + (r - l) * 1.22); g = clamp(l + (g - l) * 1.22); b = clamp(l + (b - l) * 1.22); }
      d[i * 4] = clamp(r * s) * 255; d[i * 4 + 1] = clamp(g * s) * 255; d[i * 4 + 2] = clamp(b * s) * 255; d[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

/** Returns { name: HTMLCanvasElement } for every material. `quality` shrinks the textures on slow devices. */
const BIG_TEX = new Set(['grass', 'rock', 'stone']);                // only the large, close-up surfaces keep 512 px on high quality
const ORGANIC_TEX = new Set(['rock', 'leaf', 'hedge', 'wood', 'grass', 'dirt', 'sand', 'stone']);
export function buildTextures(quality = 'high') {
  const base = quality === 'low' ? 128 : quality === 'medium' ? 192 : 256;
  const pot = (n) => (n >= 256 ? 256 : n >= 128 ? 128 : 64);
  const out = {};
  for (const name of Object.keys(GEN)) {
    const crisp = /^(camo|skin|gunmetal|polymer|gunwood|fabric)/.test(name);
    const organic = ORGANIC_TEX.has(name), size = name === 'plain' ? 4 : name === 'fabric' ? 64 : crisp ? Math.min(128, pot(base)) : organic && quality === 'high' && BIG_TEX.has(name) ? 512 : pot(base);
    out[name] = bake(size, GEN[name], name === 'glow' || name === 'plain' ? 0 : (crisp && !/S$/.test(name)) ? 0.5 : crisp ? 0 : organic ? 1.5 : 1.15, crisp || organic ? false : undefined);   // organic surfaces: bigger, sharper (no painterly softening), stronger relief
  }
  out.rock = out.rock || out.stone;
  return out;
}
