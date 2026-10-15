// Realistic soldier avatar: lofted torso/head/limb meshes, 2-bone IK for legs and arms, camo uniform, plate carrier,
// helmet / headgear, gloves, boots, face details. Drawn at human proportions (~1.78 m). Hitboxes live in shared/ and are unchanged.
import * as G from './geom.js';
import { drawGun } from './guns.js';

const S = (y, rx, rz, cx = 0, cz = 0) => ({ y, rx, rz, cx, cz });
const MESH = {
  torso: () => G.genLoft([S(0, 0.165, 0.105), S(0.1, 0.155, 0.1), S(0.2, 0.17, 0.105), S(0.34, 0.205, 0.12), S(0.46, 0.215, 0.125), S(0.53, 0.17, 0.1), S(0.57, 0.08, 0.06), S(0.58, 0.0, 0.0)], 16),
  vest: () => G.genLoft([S(0.16, 0.185, 0.122), S(0.3, 0.222, 0.138), S(0.45, 0.232, 0.142), S(0.5, 0.2, 0.125), S(0.51, 0.0, 0.0)], 16),
  head: () => G.genLoft([S(-0.12, 0.0, 0.0), S(-0.115, 0.03, 0.04, 0, -0.01), S(-0.09, 0.062, 0.078, 0, -0.012), S(-0.04, 0.08, 0.095), S(0.02, 0.088, 0.103), S(0.07, 0.086, 0.1), S(0.115, 0.066, 0.08), S(0.14, 0.03, 0.04), S(0.148, 0.0, 0.0)], 18),
  helmet: () => G.genLoft([S(0, 0.108, 0.125, 0, 0.005), S(0.04, 0.112, 0.13, 0, 0.005), S(0.09, 0.1, 0.118), S(0.125, 0.07, 0.085), S(0.14, 0.03, 0.04), S(0.145, 0, 0)], 18),
  limb: () => G.genLoft([S(-0.5, 0.78, 0.78), S(-0.3, 0.94, 0.94), S(0, 1.0, 1.0), S(0.3, 0.9, 0.9), S(0.5, 0.74, 0.74)], 12),
  hair: () => G.genLoft([S(0.0, 0.092, 0.108, 0, 0.004), S(0.05, 0.094, 0.108), S(0.1, 0.076, 0.09), S(0.14, 0.03, 0.045), S(0.15, 0, 0)], 14),
};
const mesh = (R, k) => R.loftMesh('av' + k, MESH[k]);

const skinTone = (op) => op.skin;
const CAMO_DEFAULT = ['camoUrban', 'camoDesert', 'camoWood', 'camoDesert', 'camoMulti', 'camoUrban'];

/** Two-bone IK: returns the joint position for a chain a->b of lengths l1,l2, bending towards `hint` (a direction vector). */
function ik(a, b, l1, l2, hint) {
  let dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], d = Math.hypot(dx, dy, dz) || 1e-4;
  const reach = l1 + l2 - 1e-3; if (d > reach) { const k = reach / d; dx *= k; dy *= k; dz *= k; d = reach; }
  const ux = dx / d, uy = dy / d, uz = dz / d;
  const al = (d * d + l1 * l1 - l2 * l2) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - al * al));
  let px = hint[0] - ux * (hint[0] * ux + hint[1] * uy + hint[2] * uz), py = hint[1] - uy * (hint[0] * ux + hint[1] * uy + hint[2] * uz), pz = hint[2] - uz * (hint[0] * ux + hint[1] * uy + hint[2] * uz);
  const pl = Math.hypot(px, py, pz) || 1; px /= pl; py /= pl; pz /= pl;
  return [a[0] + ux * al + px * h, a[1] + uy * al + py * h, a[2] + uz * al + pz * h];
}

const BOOT = [0.1, 0.085, 0.07], SOLE = [0.04, 0.04, 0.04], GLOVE = [0.09, 0.09, 0.1], WEBBING = [0.17, 0.17, 0.15], TAN = [0.42, 0.36, 0.26];

/**
 * o: { op, tc (team colour rgb), tm (team mode), gun, accent, gold, flash, wpn }
 */
export function drawSoldier(R, pl, t, o) {
  const { op, tc, gun } = o, camo = op.camo || CAMO_DEFAULT[0];
  const cy = Math.cos(pl.ra), sy = Math.sin(pl.ra);
  const wp = (lx, ly, lz) => [pl.rx + cy * lx + sy * lz, pl.ry + ly, pl.rz - sy * lx + cy * lz];
  const skin = skinTone(op), white = [1, 1, 1];
  if (!pl.al) { drawDead(R, pl, t, o, wp, skin, camo); return; }
  const ch = pl.crouch ? 0.72 : 1, lean = (pl.lean || 0) * 0.3 * (pl.crouch ? 0.8 : 1);
  const amp = Math.min(1, pl.speed / 4), ph = pl.walk * 3;
  // ---- legs (2-bone IK with a walk cycle)
  const hipY = 0.93 * ch - (pl.crouch ? 0.04 : 0), fwd = [-sy, 0, -cy], L1 = 0.44, L2 = 0.45;
  const pit = pl.crouch ? -0.35 : -0.05 - amp * 0.06 - Math.max(0, Math.min(1, (pl.speed - 8.3) / 2)) * 0.14;                       // torso pitch (forward lean)
  const cp = Math.cos(pit), sp = Math.sin(pit);
  const TP = (lx, ly, lz) => wp(lean + lx, hipY + (cp * ly - sp * lz), sp * ly + cp * lz);   // torso-space -> world
  R.texture(camo, 2);
  const limb = mesh(R, 'limb');
  const feet = [];
  for (let i = 0; i < 2; i++) {
    const side = i ? 0.1 : -0.1, f = ph + i * Math.PI, st = Math.sin(f), lift = Math.max(0, Math.cos(f)) * 0.17 * amp;
    const hip = wp(side + lean * 0.4, hipY, 0), stride = pl.crouch ? 0.16 : 0.38;
    const ankle = wp(side, 0.1 + lift, -st * stride * amp - (pl.crouch ? 0.14 : 0));
    const knee = ik(hip, ankle, L1, L2, fwd);
    R.span(limb, hip[0], hip[1], hip[2], knee[0], knee[1], knee[2], 0.088, white, 0.05);
    R.span(limb, knee[0], knee[1], knee[2], ankle[0], ankle[1] + 0.02, ankle[2], 0.066, white, 0.05);
    feet.push({ ankle, knee, lift, side });
  }
  R.texture('plain');
  for (const { ankle, knee, lift } of feet) {
    const bx = ankle[0] - sy * 0.07, bz = ankle[2] - cy * 0.07, tilt = lift > 0.04 ? 0.35 : 0;
    R.rbox(bx, ankle[1] - 0.03, bz, 0.115, 0.13, 0.31, pl.ra, tilt, BOOT, 0.04, 0, 1, 0.25);
    R.rbox(bx, ankle[1] - 0.085, bz, 0.12, 0.035, 0.32, pl.ra, tilt, SOLE, 0.012);
    R.span(R.meshes.cyl, ankle[0], ankle[1] + 0.02, ankle[2], ankle[0] + (knee[0] - ankle[0]) * 0.2, ankle[1] + 0.2, ankle[2] + (knee[2] - ankle[2]) * 0.2, 0.062, BOOT, 0.2);   // boot shaft
    const kp = [knee[0] + fwd[0] * 0.06, knee[1], knee[2] + fwd[2] * 0.06]; R.rbox(kp[0], kp[1], kp[2], 0.11, 0.14, 0.05, pl.ra, 0, [0.07, 0.07, 0.08], 0.02, 0, 1, 0.3);
  }
  // ---- torso, belt, vest
  const hipC = wp(lean, hipY - 0.04, 0);
  R.texture(camo, 2);
  R.drawMesh(mesh(R, 'torso'), hipC[0], hipC[1], hipC[2], R.rotate(pl.ra, pit), 1, 1, 1, white, 0, 1, 0.05);
  R.texture('fabric', 2);
  R.drawMesh(mesh(R, 'vest'), hipC[0], hipC[1], hipC[2], R.rotate(pl.ra, pit), 1, 1, 1, o.tm ? tc.map(c => c * 0.28 + 0.1) : WEBBING, 0, 1, 0.1);
  R.texture('plain');
  const rb = (lx, ly, lz, sx, sy_, sz, col, r, em = 0, spc = 0.2) => { const q = TP(lx, ly - 0.04, lz); R.rbox(q[0], q[1], q[2], sx, sy_, sz, pl.ra, pit, col, r, em, 1, spc); };
  rb(0, 0.04, 0, 0.35, 0.07, 0.23, [0.07, 0.07, 0.08], 0.025);                               // belt
  rb(0, 0.04, -0.12, 0.06, 0.05, 0.02, [0.55, 0.55, 0.5], 0.008, 0, 0.8);                    // buckle
  rb(0.2, -0.04, -0.06, 0.07, 0.2, 0.12, [0.1, 0.1, 0.11], 0.025);                           // thigh holster
  rb(0.17, 0.04, -0.01, 0.06, 0.1, 0.11, WEBBING, 0.02);
  for (const sx of [-0.105, -0.035, 0.035, 0.105]) rb(sx, 0.31, -0.15, 0.065, 0.14, 0.05, TAN.map(c => c * 0.8), 0.02);   // magazine pouches
  rb(-0.1, 0.17, -0.14, 0.12, 0.09, 0.06, WEBBING, 0.02); rb(0.1, 0.17, -0.14, 0.12, 0.09, 0.06, WEBBING, 0.02);
  rb(0, 0.44, -0.145, 0.15, 0.06, 0.03, [0.1, 0.1, 0.11], 0.012);                            // admin panel
  rb(-0.15, 0.45, -0.1, 0.035, 0.035, 0.03, [0.08, 0.08, 0.08], 0.012);                      // radio mic
  rb(0, 0.3, 0.17, 0.3, 0.38, 0.12, TAN.map(c => c * 0.75), 0.05, 0, 0.1);                   // assault pack
  rb(0, 0.28, 0.24, 0.22, 0.22, 0.04, TAN.map(c => c * 0.65), 0.03);
  // team identification: emissive chest strip + shoulder patches
  rb(0, 0.38, -0.16, 0.2, 0.026, 0.012, tc, 0.006, 0.9);
  // ---- neck + head
  const head0 = TP(0, 0.64, -0.01), hpit = pl.rp;
  R.texture('skin', 1);
  const nk = TP(0, 0.55, -0.01); R.span(R.meshes.cyl, nk[0], nk[1], nk[2], head0[0], head0[1] - 0.02, head0[2], 0.052, skin, 0.05);
  const hp = [head0[0], head0[1] + 0.07, head0[2]];
  const HP = (dx, dy, dz) => { const c = Math.cos(hpit), s = Math.sin(hpit); const y = dy * c - dz * s, z = dy * s + dz * c; return [hp[0] + cy * dx + sy * z, hp[1] + y, hp[2] - sy * dx + cy * z]; };
  R.drawMesh(mesh(R, 'head'), hp[0], hp[1], hp[2], R.rotate(pl.ra, hpit), 1, 1, 1, skin, 0, 1, 0.05);
  R.texture('plain');
  const face = (dx, dy, dz, rx, ry, rz, col, em = 0, spc = 0) => { const q = HP(dx, dy, dz); R.sphere(q[0], q[1], q[2], rx, ry, rz, col, em, 1, spc, pl.ra, hpit); };
  const mask = op.hat === 'balaclava';
  if (!mask) {
    face(0, -0.02, -0.098, 0.016, 0.02, 0.02, skin.map(c => c * 0.94));                       // nose
    face(0, -0.065, -0.085, 0.03, 0.008, 0.02, skin.map(c => c * 0.7 + 0.1));                  // lips
    for (const e of [-1, 1]) { face(e * 0.088, -0.01, 0.0, 0.012, 0.03, 0.02, skin.map(c => c * 0.96)); face(e * 0.038, 0.02, -0.093, 0.049 * 0.45, 0.012, 0.012, skin.map(c => c * 0.4)); }
  }
  for (const e of [-1, 1]) { face(e * 0.037, 0.0, -0.088, 0.017, 0.011, 0.012, [0.95, 0.95, 0.93], 0, 0.3); face(e * 0.037, 0.0, -0.096, 0.007, 0.008, 0.006, op.eye || [0.16, 0.12, 0.1], 0, 0.8); }
  // hair / headgear
  const hairC = op.hair || [0.1, 0.07, 0.05], hatC = op.hatCol || [0.2, 0.2, 0.2];
  const hat = (k, col, sc = 1, up = 0, tex = 'plain') => { R.texture(tex, 2); R.drawMesh(mesh(R, k), hp[0], hp[1] - 0.0 + up, hp[2], R.rotate(pl.ra, hpit), sc, sc, sc, col, 0, 1, 0.1); R.texture('plain'); };
  const rbH = (dx, dy, dz, sx, sy_, sz, col, r, spc = 0.2, em = 0) => { const q = HP(dx, dy, dz); R.rbox(q[0], q[1], q[2], sx, sy_, sz, pl.ra, hpit, col, r, em, 1, spc); };
  if (mask) { hat('head', hatC, 1.04); face(0, 0.015, -0.085, 0.07, 0.022, 0.03, skin); for (const e of [-1, 1]) face(e * 0.037, 0.015, -0.1, 0.017, 0.011, 0.01, [0.95, 0.95, 0.93]); hat('hair', hatC, 1.06, 0.005); }
  else if (op.hat === 'helmet' || op.hat === 'hardhat') {
    const hc = op.hat === 'helmet' ? [0.3, 0.34, 0.24] : TAN;
    hat('helmet', hc, 1.04, 0.0, 'fabric'); rbH(0, 0.115, -0.115, 0.07, 0.04, 0.04, [0.08, 0.08, 0.09], 0.01, 0.4); rbH(0, 0.08, 0.1, 0.12, 0.06, 0.05, hc.map(c => c * 0.8), 0.02);
    rbH(0, 0.05, -0.108, 0.17, 0.02, 0.08, tc, 0.006, 0.2, 0.7);                              // team helmet band
    face(0, 0.12, -0.14, 0.05, 0.012, 0.035, [0.1, 0.1, 0.11], 0, 0.4);
    if (op.hat === 'hardhat') for (const e of [-1, 1]) { rbH(e * 0.115, -0.02, 0.02, 0.025, 0.07, 0.09, [0.08, 0.08, 0.09], 0.01, 0.3); }
    else { for (const e of [-1, 1]) face(e * 0.04, 0.085, -0.155, 0.032, 0.022, 0.016, [0.1, 0.16, 0.2], 0.15, 1); }   // goggles on the brow
  }
  else if (op.hat === 'cap') { hat('hair', hairC, 1.02); hat('helmet', hatC, 1.0, 0.012); rbH(0, 0.082, -0.125, 0.17, 0.014, 0.12, hatC.map(c => c * 0.9), 0.006); rbH(0, 0.11, -0.108, 0.06, 0.03, 0.01, tc, 0.004, 0.2, 0.7); }
  else if (op.hat === 'beanie') { hat('helmet', hatC, 1.02, -0.01, 'fabric'); rbH(0, 0.06, 0, 0.2, 0.05, 0.22, hatC.map(c => c * 0.85), 0.02); hat('hair', hairC, 0.98, -0.05); }
  else { hat('hair', hairC, 1.03); rbH(0, 0.0, 0.0, 0.0, 0.0, 0.0, hairC, 0); for (const e of [-1, 1]) rbH(e * 0.1, 0.0, 0.02, 0.03, 0.09, 0.08, hatC, 0.014, 0.5); const a = HP(-0.1, 0.02, 0.02), b = HP(0.1, 0.02, 0.02), c = HP(0, 0.12, 0.02); R.tube(a[0], a[1], a[2], c[0], c[1], c[2], 0.008, 0.008, hatC, 0.5); R.tube(c[0], c[1], c[2], b[0], b[1], b[2], 0.008, 0.008, hatC, 0.5); const m0 = HP(0.1, -0.01, -0.04), m1 = HP(0.04, -0.06, -0.1); R.tube(m0[0], m0[1], m0[2], m1[0], m1[1], m1[2], 0.005, 0.005, hatC); }
  // ---- arms + weapon
  const shY = 0.5, cpp = Math.cos(pl.rp), spp = Math.sin(pl.rp);
  const shR = TP(0.215, shY, 0), shL = TP(-0.215, shY, 0);
  const A = (lx, ly, lz) => { const dy = ly - (hipY + 0.5), dz = lz; return wp(lean + lx, hipY + 0.5 + dy * cpp - dz * spp, dy * spp + dz * cpp); };
  const ox = 0.2, oy = hipY + 0.42 - 0.0, oz = -0.34;
  drawGun(R, gun, { origin: A(ox, oy, oz), yaw: pl.ra, pitch: pl.rp, accent: o.accent, gold: o.gold, far: !!o.far });
  const handR = A(ox, oy - 0.07, oz + gun.grip + 0.02), handL = A(ox - 0.02, oy - 0.035, oz + gun.fore);
  const l1 = 0.3, l2 = 0.29;
  const elR = ik(shR, handR, l1, l2, [0.5 * cy, -1, -0.5 * sy]), elL = ik(shL, handL, l1, l2, [-0.5 * cy, -1, 0.5 * sy]);
  R.texture(camo, 2);
  for (const [sh, el, hd] of [[shR, elR, handR], [shL, elL, handL]]) {
    R.span(limb, sh[0], sh[1], sh[2], el[0], el[1], el[2], 0.058, white, 0.05);
    R.span(limb, el[0], el[1], el[2], hd[0], hd[1], hd[2], 0.047, white, 0.05);
  }
  R.texture('plain');
  R.texture(camo, 2); for (const sh of [shR, shL]) R.sphere(sh[0], sh[1], sh[2], 0.072, 0.068, 0.072, white, 0, 1, 0.05); R.texture('plain');
  for (const hd of [handR, handL]) R.rbox(hd[0], hd[1], hd[2], 0.07, 0.07, 0.1, pl.ra, pl.rp, GLOVE, 0.028, 0, 1, 0.2);
  const ab = A(0.4 * -1 - 0.0, hipY + 0.5, -0.02);                                           // armband (emissive team colour) on the left upper arm
  const mid = [(shL[0] * 0.55 + elL[0] * 0.45), (shL[1] * 0.55 + elL[1] * 0.45), (shL[2] * 0.55 + elL[2] * 0.45)];
  R.tube(mid[0], mid[1] - 0.04, mid[2], mid[0], mid[1] + 0.04, mid[2], 0.066, 0.066, tc, 0.2, 0.85);
  void ab;
  if (o.flash) { const f = A(ox, oy + 0.03, oz + gun.muzzle - 0.05); R.sphere(f[0], f[1], f[2], 0.07, 0.07, 0.16, [1, 0.85, 0.4], 1, 1); }
  if (t - (pl.meleeAt || -9) < 0.3) { const k = (t - pl.meleeAt) / 0.3, a0 = A(0.45 - k * 0.6, oy, -0.4 - Math.sin(k * Math.PI) * 0.2), a1 = A(0.45 - k * 0.6, oy, -0.72 - Math.sin(k * Math.PI) * 0.2); R.tube(a0[0], a0[1], a0[2], a1[0], a1[1], a1[2], 0.022, 0.006, [0.88, 0.92, 0.96], 1.1, 0.3); }
}

function drawDead(R, pl, t, o, wp, skin, camo) {
  if (t - pl.deadAt >= 4) return;
  const a = pl.ra || 0, dx = -Math.sin(a), dz = -Math.cos(a), sx = Math.cos(a), sz = -Math.sin(a), X = pl.rx, Y = pl.ry, Z = pl.rz;
  const limb = mesh(R, 'limb'), white = [1, 1, 1];
  R.texture(camo, 2);
  R.drawMesh(mesh(R, 'torso'), X - dx * 0.25, Y + 0.14, Z - dz * 0.25, R.rotate(a, -Math.PI / 2 + 0.05), 1, 1, 1, white, 0, 1, 0.05);   // face down, head forward
  const leg = (s, bend) => { const h = [X - dx * 0.28 + sx * s * 0.1, Y + 0.1, Z - dz * 0.28 + sz * s * 0.1], k = [h[0] - dx * 0.4 + sx * bend, Y + 0.09, h[2] - dz * 0.4 + sz * bend], f = [k[0] - dx * 0.4 + sx * bend * 0.6, Y + 0.06, k[2] - dz * 0.4 + sz * bend * 0.6]; R.span(limb, h[0], h[1], h[2], k[0], k[1], k[2], 0.088, white); R.span(limb, k[0], k[1], k[2], f[0], f[1], f[2], 0.066, white); R.rbox(f[0] - dx * 0.05, Y + 0.05, f[2] - dz * 0.05, 0.11, 0.1, 0.28, a, 0, BOOT, 0.04); };
  leg(-1, -0.1); leg(1, 0.14);
  const arm = (s, spread) => { const sh = [X + dx * 0.2 + sx * s * 0.22, Y + 0.12, Z + dz * 0.2 + sz * s * 0.22], e = [sh[0] + sx * s * spread + dx * 0.1, Y + 0.06, sh[2] + sz * s * spread + dz * 0.1], h = [e[0] + sx * s * spread * 0.6 + dx * 0.15, Y + 0.05, e[2] + sz * s * spread * 0.6 + dz * 0.15]; R.span(limb, sh[0], sh[1], sh[2], e[0], e[1], e[2], 0.058, white); R.span(limb, e[0], e[1], e[2], h[0], h[1], h[2], 0.047, white); R.sphere(h[0], h[1], h[2], 0.04, 0.03, 0.045, GLOVE); };
  arm(-1, 0.25); arm(1, 0.15);
  R.texture('skin', 1);
  R.drawMesh(mesh(R, 'head'), X + dx * 0.62, Y + 0.11, Z + dz * 0.62, R.rotate(a, -Math.PI / 2 + 0.3), 1, 1, 1, skin, 0, 1, 0.05);
  R.texture('plain');
  if (o.op.hat && o.op.hat !== 'balaclava') R.sphere(X + dx * 0.66, Y + 0.2, Z + dz * 0.66, 0.1, 0.06, 0.11, o.op.hatCol || [0.25, 0.28, 0.2], 0, 1, 0.1);
}
