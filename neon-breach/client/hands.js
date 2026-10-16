// Soldier hands: sculpted from lofted tubes instead of boxes and balls. A half-finger tactical glove covers the palm, the back of the hand,
// the thumb base and the first finger segment; the fingertips and thumb tip are bare skin with a nail. Each finger has three tapering segments with a
// raised knuckle, curled round whatever it holds.
//
// Two poses are baked in a canonical frame and drawn with any orientation:
//   'grip' : wrapped round a pistol grip (grip axis = -y, forward = -z, origin = grip centre). Right hand: palm on the right face, fingers wrap round
//            the front strap, index finger laid along the frame, thumb along the left side.   side = -1 mirrors it into a left hand.
//   'cup'  : under a handguard / foregrip (axis = z, origin = hand centre, handguard centre at the origin): palm underneath, fingers curl up the right
//            side, thumb up the left side.  Used for the supporting (left) hand of long guns.
// Meshes are cached per (pose, side, skin, glove, lod).

import * as G from './geom.js';

const D2R = Math.PI / 180;
const WRIST = { grip: [0.02, -0.011, 0.074], cup: [-0.056, -0.034, 0.012] };      // canonical wrist centre (where the forearm joins)
export const handWrist = (pose) => WRIST[pose];

/** Join a list of tube pieces { st: [[x,y,z,r]...], col } into one vertex-coloured mesh. */
function build(pieces, seg) {
  const out = [];
  const sph = G.genSphere(10, 6);
  for (const pc of pieces) {
    if (pc.sph) { G.appendMesh(out, sph, pc.sph, null, pc.rad, pc.col); continue; }
    const m = G.genPath(pc.st.map(s => ({ p: [s[0], s[1], s[2]], a: s[3], b: s[4] ?? s[3], n: s[5] ?? 2 })), pc.seg || seg, { uvScale: 6 });
    G.appendMesh(out, m, [0, 0, 0], null, [1, 1, 1], pc.col);
  }
  return new Float32Array(out);
}

/** Ellipse round a pistol grip. A, B are the semi-axes (x, z); phi 0 = back strap, 90 = right face, 180 = front strap, 270 = left face. */
const GA = 0.0275, GB = 0.0285;
const ap = (phi, y, e = 0, mir = 1) => [mir * (GA + e) * Math.sin(phi * D2R), y, (GB + e) * Math.cos(phi * D2R)];

function gripPieces(side, skin, glove, gloveDk) {
  const mir = side, P = [];
  const FY = [0.0215, 0, -0.0215];                                        // middle, ring, pinky from the top of the grip down (index is separate)
  const R1 = [0.0105, 0.0099, 0.0096, 0.0094], R2 = [0.0094, 0.0089, 0.0085], R3 = [0.0085, 0.0079, 0.007, 0.0002];
  // dorsal plate + palm: one curved slab laid on the right face of the grip, running back past the back strap into the heel of the hand
  { const pts = [98, 82, 64, 46, 28, 14].map(ph => ap(ph, 0.0107, 0.0, mir)), n = pts.length;
    const rear = [[0.0125, 0.0425], [0.0185, 0.0585], [0.0215, 0.0705]];
    const st = pts.map((p, i) => [p[0], p[1], p[2], 0.0074 + Math.sin(i / (n - 1) * Math.PI) * 0.0012, 0.0425, 2.8]);
    rear.forEach((q, i) => st.push([mir * q[0], 0.0107, q[1], 0.0086 - i * 0.0006, 0.0425 - i * 0.0042, 2.8]));
    P.push({ col: glove, seg: 14, st });
  }
  for (const y of [0.043, 0.0215, 0, -0.0215]) P.push({ col: gloveDk.map(c => c * 1.25), sph: ap(103, y, 0.0042, mir), rad: [0.0106, 0.0098, 0.0106] });   // knuckle bumps
  { const a = [mir * 0.0182, 0.0107, 0.0572], b = [mir * 0.0196, 0.0107, 0.0614]; P.push({ col: gloveDk, seg: 14, st: [[a[0], a[1], a[2], 0.0098, 0.0434, 2.8], [b[0], b[1], b[2], 0.0098, 0.0434, 2.8]] }); }   // velcro wrist strap
  // middle / ring / pinky: wrap round the front strap
  FY.forEach((y, k) => {
    const sc = 1 - (k === 2 ? 0.1 : 0) + (k === 0 ? 0.04 : 0);               // pinky shorter, middle longer
    const ph = (a) => 100 + (a - 100) * sc;
    const glv = [100, 124, 150, 178].map((a, i) => { const p = ap(ph(a), y, 0, mir); return [p[0], p[1], p[2], R1[i] * (k === 2 ? 0.93 : 1)]; });
    const sk1 = [178, 205, 232].map((a, i) => { const p = ap(ph(a), y, -0.0004 * i, mir); return [p[0], p[1], p[2], R2[i] * (k === 2 ? 0.93 : 1)]; });
    const sk2 = [232, 253, 272, 284].map((a, i) => { const p = ap(ph(a), y, -0.001 * i, mir); return [p[0], p[1], p[2], R3[i] * (k === 2 ? 0.93 : 1)]; });
    P.push({ col: glove, st: glv });
    P.push({ col: skin, st: sk1.concat(sk2.slice(1)) });
  });
  // index finger laid along the frame towards the trigger
  { const y = 0.0430, X = (v) => mir * v;
    P.push({ col: glove, st: [[X(0.0272), y, -0.005, 0.0105], [X(0.0264), y, -0.022, 0.0099], [X(0.0252), y + 0.0005, -0.040, 0.0095]] });
    P.push({ col: skin, st: [[X(0.0252), y + 0.0005, -0.040, 0.0094], [X(0.0236), y + 0.001, -0.054, 0.0088], [X(0.0205), y - 0.0005, -0.064, 0.0082], [X(0.0148), y - 0.002, -0.0705, 0.0072], [X(0.0138), y - 0.0025, -0.0725, 0.0002]] }); }
  // thumb: over the top of the back strap and forward along the left face
  { const y = 0.054, X = (v) => mir * v;
    P.push({ col: glove, st: [[X(0.016), y + 0.002, 0.034, 0.0128], [X(-0.004), y, 0.04, 0.0128], [X(-0.022), y - 0.001, 0.03, 0.0124], [X(-0.0315), y - 0.001, 0.008, 0.0118], [X(-0.0335), y - 0.0005, -0.014, 0.0112]] });
    P.push({ col: skin, st: [[X(-0.0335), y - 0.0005, -0.014, 0.0111], [X(-0.0338), y, -0.032, 0.0102], [X(-0.0335), y + 0.001, -0.05, 0.0094], [X(-0.0328), y + 0.002, -0.0655, 0.0078], [X(-0.0326), y + 0.0025, -0.0675, 0.0002]] }); }
  return P;
}

/** Cup pose: handguard of radius ~0.031 along z; angle phi measured from the bottom (-y) round towards +x. */
const CR = 0.0405;
const cp = (phi, z, e = 0) => [(CR + e) * Math.sin(phi * D2R), -(CR + e) * Math.cos(phi * D2R), z];

function cupPieces(skin, glove, gloveDk) {
  const P = [];
  const FZ = [-0.0325, -0.0108, 0.0108, 0.0325];                           // index (forward), middle, ring, pinky
  const R1 = [0.0105, 0.0099, 0.0096, 0.0094], R2 = [0.0094, 0.0089, 0.0085], R3 = [0.0085, 0.0079, 0.007, 0.0002];
  // palm + back of the hand underneath and to the left of the handguard
  const pal = [-100, -80, -58, -36, -14, 8, 26];
  P.push({ col: glove, seg: 14, st: pal.map((ph, i) => { const k = i / (pal.length - 1), p = cp(ph, 0.0, 0.0); return [p[0], p[1], p[2], 0.0078 + Math.sin(k * Math.PI) * 0.0014 - k * 0.0008, 0.0455 - (i === 0 ? 0.006 : 0), 2.8]; }) });
  { const p = cp(28, 0, 0.0068); P.push({ col: gloveDk, seg: 10, st: [[p[0], p[1], p[2] - 0.044, 0.0042], [p[0], p[1], p[2] - 0.014, 0.0048], [p[0], p[1], p[2] + 0.014, 0.0048], [p[0], p[1], p[2] + 0.044, 0.0042]].map(s => [s[0], s[1], s[2], s[3], s[3], 2]) }); }
  for (const z of [-0.0325, -0.0108, 0.0108, 0.0325]) P.push({ col: gloveDk.map(c => c * 1.25), sph: cp(33, z, 0.0042), rad: [0.0098, 0.0106, 0.0106] });   // knuckle bumps
  FZ.forEach((z, k) => {
    const sc = k === 3 ? 0.9 : k === 1 ? 1.04 : 1, ph = (a) => 28 + (a - 28) * sc, zz = z - (k === 0 ? 0.0 : 0), rs = k === 3 ? 0.93 : 1;
    const glv = [28, 52, 78, 104].map((a, i) => { const p = cp(ph(a), zz, 0); return [p[0], p[1], p[2], R1[i] * rs]; });
    const sk1 = [104, 130, 156].map((a, i) => { const p = cp(ph(a), zz, -0.0004 * i); return [p[0], p[1], p[2], R2[i] * rs]; });
    const sk2 = [156, 178, 196, 208].map((a, i) => { const p = cp(ph(a), zz, -0.001 * i); return [p[0], p[1], p[2], R3[i] * rs]; });
    P.push({ col: glove, st: glv });
    P.push({ col: skin, st: sk1.concat(sk2.slice(1)) });
  });
  // thumb up the left side, pointing at the muzzle
  P.push({ col: glove, st: [[-0.012, -0.043, 0.026, 0.0128], [-0.032, -0.03, 0.012, 0.0126], [-0.045, -0.006, -0.012, 0.0122], [-0.047, 0.014, -0.034, 0.0116]] });
  P.push({ col: skin, st: [[-0.047, 0.014, -0.034, 0.0115], [-0.0455, 0.028, -0.05, 0.0104], [-0.0415, 0.04, -0.064, 0.0092], [-0.0365, 0.0455, -0.0715, 0.0076], [-0.0345, 0.0475, -0.0735, 0.0002]] });
  return P;
}

function nails(skin, pieces, pose) {
  // small fingernail plates on the dorsal side of every bare fingertip (last stations of each skin piece)
  const nail = skin.map(c => Math.min(1, c * 1.12 + 0.05)), out = [];
  for (const pc of pieces) {
    if (pc.col !== skin) continue;
    const n = pc.st.length; if (n < 4) continue;
    const a = pc.st[n - 3], b = pc.st[n - 1];
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], l = Math.hypot(dx, dy, dz) || 1, d = [dx / l, dy / l, dz / l];
    const at = [a[0] + dx * 0.78, a[1] + dy * 0.78, a[2] + dz * 0.78];
    let o = pose === 'grip' ? [at[0], 0, at[2]] : [at[0], at[1], 0];                    // away from the held object
    const dd = o[0] * d[0] + o[1] * d[1] + o[2] * d[2]; o = [o[0] - d[0] * dd, o[1] - d[1] * dd, o[2] - d[2] * dd];
    const ol = Math.hypot(o[0], o[1], o[2]) || 1; o = [o[0] / ol, o[1] / ol, o[2] / ol];
    out.push({ at: [at[0] + o[0] * 0.0056, at[1] + o[1] * 0.0056, at[2] + o[2] * 0.0056], dir: d, up: o, nail });
  }
  return out;
}

const cache = new Map();
/** Returns the baked hand mesh. pose 'grip' | 'cup'; side +1 right hand / -1 left; skin, glove: rgb. lod 0 = full, 1 = simplified (far soldiers). */
export function handMesh(R, pose, side, skin, glove, lod = 0) {
  const key = `hand:${pose}:${side}:${skin.map(v => Math.round(v * 30)).join('.')}:${glove.map(v => Math.round(v * 30)).join('.')}:${lod}`;
  return R.loftMesh(key, () => {
    const gloveDk = glove.map(c => c * 0.55);
    const pieces = pose === 'grip' ? gripPieces(side, skin, glove, gloveDk) : cupPieces(skin, glove, gloveDk);
    const seg = lod ? 6 : 11, out = Array.from(build(pieces, seg));
    if (!lod) {
      const sph = cache.get('sph') || (cache.set('sph', G.genSphere(10, 6)), cache.get('sph'));
      for (const n of nails(skin, pieces, pose)) {
        const d = n.dir, Y = n.up, X = [d[1] * Y[2] - d[2] * Y[1], d[2] * Y[0] - d[0] * Y[2], d[0] * Y[1] - d[1] * Y[0]];
        G.appendMesh(out, sph, n.at, [X[0], X[1], X[2], Y[0], Y[1], Y[2], d[0], d[1], d[2]], [0.0062, 0.0024, 0.0085], n.nail);
      }
    }
    return new Float32Array(out);
  });
}

/** Rotation about X by `a`, post-multiplied onto the 3x3 column-major matrix M (so the hand's canonical frame sits in M's frame, then tilts). */
export function rotXAfter(M, a) {
  const c = Math.cos(a), s = Math.sin(a);
  // columns of RotX(a): (1,0,0), (0,c,s), (0,-s,c)
  const c0 = [M[0], M[1], M[2]], c1 = [M[3] * c + M[6] * s, M[4] * c + M[7] * s, M[5] * c + M[8] * s], c2 = [-M[3] * s + M[6] * c, -M[4] * s + M[7] * c, -M[5] * s + M[8] * c];
  return [c0[0], c0[1], c0[2], c1[0], c1[1], c1[2], c2[0], c2[1], c2[2]];
}
/** Transform a canonical point by (M, pos). */
export const xf = (M, pos, p) => [pos[0] + M[0] * p[0] + M[3] * p[1] + M[6] * p[2], pos[1] + M[1] * p[0] + M[4] * p[1] + M[7] * p[2], pos[2] + M[2] * p[0] + M[5] * p[1] + M[8] * p[2]];

/** Draw one hand. M: 3x3 column-major (canonical -> output space), pos: output-space position of the canonical origin. */
export function drawHand(R, pose, side, skin, glove, M, pos, lod = 0) {
  const m = handMesh(R, pose, side, skin, glove, lod);
  R.texture('plain');
  R.drawBaked(m, pos[0], pos[1], pos[2], M, 0.12, 0, 1);
}

/** Lowest point of the base model under the supporting hand (cached on the gun): the palm rests against it. */
export function foreBottom(gun) {
  if (gun._fb != null) return gun._fb;
  let lo = 9; const z0 = gun.fore - 0.025, z1 = gun.fore + 0.025;
  for (let i = 0; i < gun.nBase; i++) {
    const p = gun.parts[i]; let zs, ys, xs;
    if (p.k === 'b') { zs = [p.z - p.sz / 2, p.z + p.sz / 2]; ys = [p.y - p.sy / 2]; xs = [p.x - p.sx / 2, p.x + p.sx / 2]; }
    else if (p.k === 'l') { const s = p.st; zs = [Math.min(...s.map(a => a.p[2])), Math.max(...s.map(a => a.p[2]))]; ys = [Math.min(...s.map(a => a.p[1] - a.b))]; xs = [Math.min(...s.map(a => a.p[0] - a.a)), Math.max(...s.map(a => a.p[0] + a.a))]; }
    else if (p.k === 't') { zs = [Math.min(p.z0, p.z1), Math.max(p.z0, p.z1)]; ys = [Math.min(p.y0, p.y1) - p.r]; xs = [Math.min(p.x0, p.x1) - p.r, Math.max(p.x0, p.x1) + p.r]; }
    else continue;
    if (zs[0] > z0 || zs[1] < z1 || Math.abs(xs[0] + xs[1]) / 2 > 0.04 || xs[1] - xs[0] > 0.12) continue;
    lo = Math.min(lo, ys[0]);
  }
  return (gun._fb = lo > 5 ? -0.02 : Math.max(-0.045, Math.min(0.0, lo)));
}

/**
 * Draw both hands of a gun and return where the wrists are.
 * o: { M (weapon -> output 3x3), P(lx, ly, lz) (weapon -> output position), skin, glove, lod, d1, d2 (weapon-space hand offsets from the reload animation) }
 * Returns { w1, w2 } (output-space wrist centres) so the forearms can be attached.
 */
export function drawGunHands(R, gun, o) {
  const { M, P, skin, glove, lod = 0, d1 = [0, 0, 0], d2 = [0, 0, 0] } = o, rake = gun.rake ?? 0.38;
  const Ms = rotXAfter(M, -rake), c1 = P(d1[0], -0.062 + d1[1], gun.grip + 0.012 + d1[2]);
  drawHand(R, 'grip', 1, skin, glove, Ms, c1, lod);
  const w1 = xf(Ms, c1, WRIST.grip);
  let w2;
  if (gun.grip - gun.fore < 0.1) {                                                                           // pistols: the off hand wraps the grip from the left
    const c2 = P(d2[0], -0.05 + d2[1], gun.grip + 0.012 + d2[2]), k = 1.12, m = handMesh(R, 'grip', -1, skin, glove, lod);
    R.texture('plain'); R.drawBaked(m, c2[0], c2[1], c2[2], Ms, 0.12, 0, k);
    w2 = xf(Ms, c2, [-WRIST.grip[0] * k, WRIST.grip[1] * k, WRIST.grip[2] * k]);
  } else {                                                                                                  // long guns: cupped under the handguard
    const c2 = P(d2[0], foreBottom(gun) + 0.0315 + d2[1], gun.fore + d2[2]);
    drawHand(R, 'cup', 1, skin, glove, M, c2, lod);
    w2 = xf(M, c2, WRIST.cup);
  }
  return { w1, w2 };
}

/** A relaxed, half-curled hand at `wrist` pointing along `dir` (unit vector from elbow to wrist): used for ragdoll arms. side +1 right / -1 left. */
export function drawLooseHand(R, side, skin, glove, wrist, dir, lod = 0) {
  const z = [-dir[0], -dir[1], -dir[2]];
  let y = [0 - z[0] * z[1], 1 - z[1] * z[1], 0 - z[2] * z[1]]; const yl = Math.hypot(y[0], y[1], y[2]);
  if (yl < 0.2) y = [1, 0, 0]; else y = [y[0] / yl, y[1] / yl, y[2] / yl];
  const x = [y[1] * z[2] - y[2] * z[1], y[2] * z[0] - y[0] * z[2], y[0] * z[1] - y[1] * z[0]];
  const M = [x[0], x[1], x[2], y[0], y[1], y[2], z[0], z[1], z[2]], W = [WRIST.grip[0] * side, WRIST.grip[1], WRIST.grip[2]];
  const pos = [wrist[0] - (M[0] * W[0] + M[3] * W[1] + M[6] * W[2]), wrist[1] - (M[1] * W[0] + M[4] * W[1] + M[7] * W[2]), wrist[2] - (M[2] * W[0] + M[5] * W[1] + M[8] * W[2])];
  drawHand(R, 'grip', side, skin, glove, M, pos, lod);
}
