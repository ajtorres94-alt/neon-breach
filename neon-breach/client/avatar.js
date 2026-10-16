// Realistic soldier avatar: lofted torso/head/limb meshes, 2-bone IK for legs and arms, camo uniform, plate carrier,
// helmet / headgear, gloves, boots, face details. Drawn at human proportions (~1.78 m). Hitboxes live in shared/ and are unchanged.
import * as G from './geom.js';
import { drawGun } from './guns.js';
import { drawGunHands, drawLooseHand } from './hands.js';

const S = (y, rx, rz, cx = 0, cz = 0) => ({ y, rx, rz, cx, cz });
/** Catmull-Rom subdivision of loft stations (n extra sections between each pair) so silhouettes are curved instead of faceted. */
function smoothSt(st, n = 3) {
  const out = [], P = (i) => st[Math.max(0, Math.min(st.length - 1, i))], cr = (a, b, c, d, t) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
  for (let i = 0; i < st.length - 1; i++) for (let k = 0; k < n; k++) {
    const t = k / n, f = (key) => cr(P(i - 1)[key] || 0, P(i)[key] || 0, P(i + 1)[key] || 0, P(i + 2)[key] || 0, t);
    out.push({ y: f('y'), rx: Math.max(0, f('rx')), rz: Math.max(0, f('rz')), cx: f('cx'), cz: f('cz') });
  }
  out.push(st[st.length - 1]); return out;
}
const SM = (st, seg) => G.genLoft(smoothSt(st), seg);
const MESH = {
  torso: () => SM([S(0, 0.165, 0.105), S(0.1, 0.155, 0.1), S(0.2, 0.17, 0.105), S(0.34, 0.205, 0.12), S(0.46, 0.215, 0.125), S(0.53, 0.17, 0.1), S(0.57, 0.08, 0.06), S(0.58, 0.0, 0.0)], 32),
  vest: () => SM([S(0.16, 0.185, 0.122), S(0.3, 0.222, 0.138), S(0.45, 0.232, 0.142), S(0.5, 0.2, 0.125), S(0.51, 0.0, 0.0)], 32),
  head: () => SM([S(-0.12, 0.0, 0.0), S(-0.115, 0.03, 0.04, 0, -0.01), S(-0.09, 0.062, 0.078, 0, -0.012), S(-0.04, 0.08, 0.095), S(0.02, 0.088, 0.103), S(0.07, 0.086, 0.1), S(0.115, 0.066, 0.08), S(0.14, 0.03, 0.04), S(0.148, 0.0, 0.0)], 36),
  helmet: () => SM([S(0, 0.108, 0.125, 0, 0.005), S(0.04, 0.112, 0.13, 0, 0.005), S(0.09, 0.1, 0.118), S(0.125, 0.07, 0.085), S(0.14, 0.03, 0.04), S(0.145, 0, 0)], 36),
  limb: () => SM([S(-0.5, 0.78, 0.78), S(-0.3, 0.94, 0.94), S(0, 1.0, 1.0), S(0.3, 0.9, 0.9), S(0.5, 0.74, 0.74)], 24),
  hair: () => SM([S(0.0, 0.092, 0.108, 0, 0.004), S(0.05, 0.094, 0.108), S(0.1, 0.076, 0.09), S(0.14, 0.03, 0.045), S(0.15, 0, 0)], 28),
};
MESH.traps = () => SM([S(0.0, 0.2, 0.1), S(0.05, 0.17, 0.095), S(0.1, 0.1, 0.075), S(0.15, 0.06, 0.058), S(0.19, 0.052, 0.052)], 16);          // trapezius slope from the shoulders into the neck
MESH.plate = () => SM([S(-0.17, 0.095, 0.014), S(-0.13, 0.125, 0.02), S(0.0, 0.14, 0.022), S(0.12, 0.14, 0.022), S(0.15, 0.1, 0.017), S(0.17, 0.05, 0.01)], 14);   // ballistic plate (squashed, used front and back)
MESH.pack = () => SM([S(-0.19, 0.11, 0.05), S(-0.16, 0.15, 0.062), S(-0.04, 0.165, 0.07), S(0.1, 0.16, 0.068), S(0.17, 0.12, 0.055), S(0.2, 0.05, 0.035)], 18);   // rounded assault pack
MESH.pouch = () => SM([S(-0.07, 0.03, 0.022), S(-0.05, 0.036, 0.026), S(0.04, 0.036, 0.026), S(0.07, 0.03, 0.022)], 10);                                          // magazine pouch
const mesh = (R, k) => R.loftMesh('av' + k, MESH[k]);
const BOOTST = [[0.15, 0.0, 0.034, 0.05], [0.12, 0.005, 0.052, 0.066], [0.04, 0.0, 0.056, 0.064], [-0.06, -0.012, 0.054, 0.052], [-0.16, -0.03, 0.05, 0.038], [-0.24, -0.045, 0.04, 0.028], [-0.275, -0.05, 0.018, 0.016]];
const bootMesh = (R) => R.loftMesh('avboot', () => G.genPath(BOOTST.map(([z, y, a, b]) => ({ p: [0, y, z], a, b, n: 2.8 })), 18));

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

/** Spy outfit on the torso: white shirt front, team-coloured tie, lapels, jacket buttons, shoulder holster, belt. */
function agentKit(rb, TP, R, pl, tc, op, pit) {
  const suit = op.suit, dk = suit.map(c => c * 0.7);
  rb(0, 0.04, 0, 0.35, 0.07, 0.23, [0.05, 0.04, 0.04], 0.025); rb(0, 0.04, -0.12, 0.05, 0.04, 0.02, [0.7, 0.62, 0.4], 0.008, 0, 0.9);   // belt + buckle
  rb(0, 0.38, -0.132, 0.1, 0.24, 0.018, [0.93, 0.93, 0.95], 0.008, 0, 0.1);                   // shirt front
  rb(0, 0.46, -0.145, 0.034, 0.1, 0.014, tc, 0.006, 0.45);                                      // tie (team colour)
  rb(0, 0.37, -0.147, 0.03, 0.22, 0.012, tc.map(c => c * 0.85), 0.006, 0.35);
  for (const e of [-1, 1]) { rb(e * 0.07, 0.4, -0.146, 0.05, 0.26, 0.02, dk, 0.01, 0, 0.1); rb(e * 0.095, 0.5, -0.14, 0.05, 0.03, 0.03, dk, 0.01); }   // lapels
  rb(0, 0.23, -0.148, 0.014, 0.014, 0.012, [0.05, 0.05, 0.05], 0.004, 0, 0.8);                  // button
  rb(0.15, 0.4, -0.138, 0.05, 0.012, 0.012, [0.95, 0.95, 0.95], 0.004);                         // pocket square
  for (const e of [-1, 1]) rb(e * 0.11, 0.5, -0.01, 0.06, 0.02, 0.22, dk, 0.01);                // shoulder seams
  rb(-0.19, 0.28, -0.03, 0.07, 0.22, 0.1, [0.06, 0.05, 0.05], 0.025, 0, 0.35);                  // shoulder holster, left ribs
  rb(0, 0.3, 0.115, 0.34, 0.5, 0.01, dk.map(c => c * 0.9), 0.01);                               // jacket back vent line
}

/**
 * o: { op, tc (team colour rgb), tm (team mode), gun, accent, gold, flash, wpn }
 */
/** Soften every box on a character: corner radii are roughly doubled (clamped to half the smallest side). */
export function drawSoldier(R, pl, t, o) {
  const rbox0 = R.rbox;
  R.rbox = (x, y, z, sx, sy, sz, yaw, pitch, col, r = 0.02, em, al, sp, roll) => rbox0(x, y, z, sx, sy, sz, yaw, pitch, col, Math.min(Math.max(r * 2.4, 0.01), Math.min(sx, sy, sz) * 0.48), em, al, sp, roll);
  try { drawSoldierRaw(R, pl, t, o); } finally { R.rbox = rbox0; }
}
function drawSoldierRaw(R, pl, t, o) {
  const { op, tc, gun } = o, agent = op.hat === 'agent', camo = agent ? 'fabric' : (op.camo || CAMO_DEFAULT[0]);
  const cy = Math.cos(pl.ra), sy = Math.sin(pl.ra);
  const wp = (lx, ly, lz) => [pl.rx + cy * lx + sy * lz, pl.ry + ly, pl.rz - sy * lx + cy * lz];
  const lod = o.lod || 0, skin = skinTone(op), white = agent ? op.suit.map(c => c * 0.55) : [1, 1, 1];
  if (!pl.al) { drawDead(R, pl, t, o, wp, skin, camo); return; }
  const ch = pl.crouch ? 0.72 : 1, lean = (pl.lean || 0) * 0.3 * (pl.crouch ? 0.8 : 1);
  const amp = Math.min(1, pl.speed / 4), ph = pl.walk * 3;
  // ---- legs (2-bone IK with a walk cycle)
  const hipY = 0.93 * ch - (pl.crouch ? 0.04 : 0), fwd = [-sy, 0, -cy], L1 = 0.44, L2 = 0.45;
  const pit = pl.crouch ? -0.35 : -0.05 - amp * 0.06 - Math.max(0, Math.min(1, (pl.speed - 8.3) / 2)) * 0.14;                       // torso pitch (forward lean)
  const cp = Math.cos(pit), sp = Math.sin(pit);
  const TP = (lx, ly, lz) => wp(lean + lx, hipY + (cp * ly - sp * lz), sp * ly + cp * lz);   // torso-space -> world
  const TPo = (lx, ly, lz) => TP(lx, ly - 0.04, lz);
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
    feet.push({ ankle, knee, lift, side, hip });
  }
  R.texture('plain');
  for (const { ankle, knee, lift, side, hip } of feet) {
    const bx = ankle[0] - sy * 0.07, bz = ankle[2] - cy * 0.07, tilt = lift > 0.04 ? 0.35 : 0;
    R.drawMesh(bootMesh(R), bx, ankle[1] - 0.03, bz, R.rotate(pl.ra, tilt), agent ? 0.95 : 1.0, agent ? 0.8 : 1, 1, agent ? [0.03, 0.03, 0.035] : BOOT, 0, 1, agent ? 0.8 : 0.25);
    R.rbox(bx, ankle[1] - 0.085, bz, 0.12, 0.035, 0.32, pl.ra, tilt, SOLE, 0.012);
    if (!agent) R.span(R.meshes.cyl, ankle[0], ankle[1] + 0.02, ankle[2], ankle[0] + (knee[0] - ankle[0]) * 0.2, ankle[1] + 0.2, ankle[2] + (knee[2] - ankle[2]) * 0.2, 0.062, BOOT, 0.2);   // boot shaft
    if (!agent && lod < 1) { // boot detail: toe cap, heel counter, laces + eyelets, tread blocks, blousing band
      const af = (d, y) => [ankle[0] + fwd[0] * d, ankle[1] + y, ankle[2] + fwd[2] * d], dk = [0.055, 0.05, 0.045];
      const tc2 = af(0.2, -0.045); R.rbox(tc2[0], tc2[1], tc2[2], 0.108, 0.07, 0.1, pl.ra, tilt, dk, 0.03, 0, 1, 0.35);
      const hl = af(-0.065, -0.02); R.rbox(hl[0], hl[1], hl[2], 0.1, 0.1, 0.06, pl.ra, tilt, dk, 0.025, 0, 1, 0.3);
      for (let k = 0; k < 6; k++) { const q = af(0.0 + k * 0.032, 0.058 - k * 0.006 + tilt * k * 0.01); R.rbox(q[0], q[1], q[2], 0.07, 0.01, 0.012, pl.ra, tilt, [0.55, 0.5, 0.4], 0.004); const e1 = af(k * 0.032, 0.056 - k * 0.006); for (const sd of [-0.036, 0.036]) R.sphere(e1[0] + Math.cos(pl.ra) * sd, e1[1], e1[2] - Math.sin(pl.ra) * sd, 0.008, 0.008, 0.008, [0.6, 0.6, 0.62], 0, 1, 0.9); }
      for (let k = 0; k < 5; k++) { const q = af(-0.06 + k * 0.07, -0.108); R.rbox(q[0], q[1], q[2], 0.1, 0.018, 0.034, pl.ra, tilt, [0.02, 0.02, 0.02], 0.006); }
      const bl = af(0.0, 0.2); R.tube(bl[0], bl[1] - 0.03, bl[2], bl[0], bl[1] + 0.04, bl[2], 0.074, 0.082, [0.3, 0.3, 0.22], 0.1);
      const tg = af(-0.05, 0.14); R.rbox(tg[0], tg[1], tg[2], 0.05, 0.05, 0.02, pl.ra, 0, [0.07, 0.07, 0.07], 0.008);     // pull tab
    }
    if (!agent && lod < 1) { // cargo pocket on the outer thigh with flap and button, plus a seam stripe
      const out = Math.sign(side) * 0.095, c = Math.cos(pl.ra), s2 = -Math.sin(pl.ra), m = [hip[0] + (knee[0] - hip[0]) * 0.5 + c * out * 0.9, hip[1] + (knee[1] - hip[1]) * 0.5, hip[2] + (knee[2] - hip[2]) * 0.5 + s2 * out * 0.9];
      R.rbox(m[0], m[1], m[2], 0.045, 0.14, 0.12, pl.ra, 0, [0.3, 0.3, 0.23], 0.015, 0, 1, 0.05);
      R.rbox(m[0] + c * Math.sign(out) * 0.024, m[1] + 0.05, m[2] + s2 * Math.sign(out) * 0.024, 0.016, 0.05, 0.12, pl.ra, 0, [0.26, 0.26, 0.2], 0.008);
      R.sphere(m[0] + c * Math.sign(out) * 0.034, m[1] + 0.03, m[2] + s2 * Math.sign(out) * 0.034, 0.011, 0.011, 0.011, [0.12, 0.12, 0.12], 0, 1, 0.8);
      const hk = [(hip[0] * 0.5 + knee[0] * 0.5), (hip[1] * 0.5 + knee[1] * 0.5), (hip[2] * 0.5 + knee[2] * 0.5)];
      R.rbox(hk[0] - fwd[0] * 0.08, hk[1] - 0.06, hk[2] - fwd[2] * 0.08, 0.02, 0.2, 0.012, pl.ra, 0, [0.22, 0.22, 0.17], 0.004);
    }
    const kp = [knee[0] + fwd[0] * 0.06, knee[1], knee[2] + fwd[2] * 0.06]; if (!agent) R.rbox(kp[0], kp[1], kp[2], 0.11, 0.14, 0.05, pl.ra, 0, [0.07, 0.07, 0.08], 0.02, 0, 1, 0.3);
  }
  // ---- torso, belt, vest
  const hipC = wp(lean, hipY - 0.04, 0);
  R.texture(camo, 2);
  R.drawMesh(mesh(R, 'torso'), hipC[0], hipC[1], hipC[2], R.rotate(pl.ra, pit), 1, 1, 1, white, 0, 1, 0.05);
  R.texture('fabric', 2);
  if (!agent) R.drawMesh(mesh(R, 'vest'), hipC[0], hipC[1], hipC[2], R.rotate(pl.ra, pit), 1, 1, 1, o.tm ? tc.map(c => c * 0.28 + 0.1) : WEBBING, 0, 1, 0.1);
  R.texture(camo, 2); R.drawMesh(mesh(R, 'traps'), hipC[0], hipC[1], hipC[2], R.rotate(pl.ra, pit), 1, 1, 1, white, 0, 1, 0.05);   // trapezius slope up to the neck
  R.texture('plain');
  const lf = (k, lx, ly, lz, col, spc = 0.2) => { const q = TPo(lx, ly, lz); R.drawMesh(mesh(R, k), q[0], q[1], q[2], R.rotate(pl.ra, pit), 1, 1, 1, col, 0, 1, spc); };
  const rb = (lx, ly, lz, sx, sy_, sz, col, r, em = 0, spc = 0.2) => { const q = TP(lx, ly - 0.04, lz); R.rbox(q[0], q[1], q[2], sx, sy_, sz, pl.ra, pit, col, r, em, 1, spc); };
  if (agent) agentKit(rb, TP, R, pl, tc, op, pit);
  else {
  rb(0, 0.04, 0, 0.35, 0.07, 0.23, [0.07, 0.07, 0.08], 0.025);                               // belt
  rb(0, 0.04, -0.12, 0.06, 0.05, 0.02, [0.55, 0.55, 0.5], 0.008, 0, 0.8);                    // buckle
  rb(0.2, -0.04, -0.06, 0.07, 0.2, 0.12, [0.1, 0.1, 0.11], 0.025);                           // thigh holster
  rb(0.17, 0.04, -0.01, 0.06, 0.1, 0.11, WEBBING, 0.02);
  for (const sx of [-0.105, -0.035, 0.035, 0.105]) lf('pouch', sx, 0.31, -0.168, TAN.map(c => c * 0.8), 0.1);   // magazine pouches
  rb(-0.1, 0.17, -0.14, 0.12, 0.09, 0.06, WEBBING, 0.02); rb(0.1, 0.17, -0.14, 0.12, 0.09, 0.06, WEBBING, 0.02);
  rb(0, 0.44, -0.145, 0.15, 0.06, 0.03, [0.1, 0.1, 0.11], 0.012);                            // admin panel
  rb(-0.15, 0.45, -0.1, 0.035, 0.035, 0.03, [0.08, 0.08, 0.08], 0.012);                      // radio mic
  lf('pack', 0, 0.3, 0.17, TAN.map(c => c * 0.75), 0.1);                                        // assault pack (lofted)
  lf('plate', 0, 0.33, -0.152, [0.16, 0.16, 0.15], 0.3);                                       // front plate
  rb(0, 0.28, 0.24, 0.22, 0.22, 0.04, TAN.map(c => c * 0.65), 0.03);
  if (lod < 1) { // plate-carrier detail: pouch flaps + snaps, MOLLE webbing, shoulder straps, cummerbund, pack straps, radio + antenna, hydration tube, patches
  for (const sx of [-0.105, -0.035, 0.035, 0.105]) { rb(sx, 0.39, -0.17, 0.06, 0.03, 0.025, TAN.map(c => c * 0.7), 0.01); rb(sx, 0.375, -0.188, 0.012, 0.012, 0.01, [0.6, 0.6, 0.6], 0.004, 0, 0.9); for (let k = 0; k < 3; k++) rb(sx - 0.02 + k * 0.02, 0.27 + 0.0, -0.18, 0.004, 0.09, 0.006, [0.1, 0.1, 0.1], 0.002); }
  for (const sd of [-1, 1]) for (let k = 0; k < 6; k++) rb(sd * 0.2, 0.18 + k * 0.045, -0.02, 0.012, 0.014, 0.12, [0.1, 0.1, 0.09], 0.003);
  for (let r = 0; r < 3; r++) for (let c2 = 0; c2 < 7; c2++) rb(-0.12 + c2 * 0.04, 0.2 + r * 0.0 + r * 0.0 - 0.07 + r * 0.04, -0.138, 0.032, 0.008, 0.01, [0.09, 0.09, 0.08], 0.002);
  for (const sd of [-1, 1]) { rb(sd * 0.12, 0.52, -0.01, 0.07, 0.026, 0.22, WEBBING.map(c => c * 0.8), 0.012); rb(sd * 0.12, 0.505, -0.12, 0.05, 0.03, 0.03, [0.1, 0.1, 0.1], 0.01); rb(sd * 0.14, 0.12, -0.15, 0.1, 0.1, 0.05, [0.1, 0.1, 0.11], 0.02); }   // shoulder straps, buckles, utility pouches
  rb(0, 0.11, -0.145, 0.34, 0.06, 0.03, [0.1, 0.1, 0.09], 0.012);                              // cummerbund band
  rb(0, 0.46, -0.158, 0.05, 0.018, 0.012, [0.8, 0.8, 0.75], 0.004);                           // name tape
  rb(0.18, 0.47, -0.04, 0.012, 0.07, 0.1, [0.65, 0.12, 0.12], 0.004);                         // shoulder flag patch
  rb(0.0, 0.54, 0.0, 0.05, 0.03, 0.02, [0.1, 0.1, 0.1], 0.008); rb(0.0, 0.52, -0.1, 0.12, 0.012, 0.01, [0.1, 0.1, 0.09], 0.003);   // drag handle + collar
  rb(0.1, 0.46, 0.235, 0.05, 0.12, 0.05, [0.12, 0.13, 0.12], 0.015); { const a0 = TP(0.1, 0.52, 0.235), a1 = TP(0.12, 0.92, 0.235); R.tube(a0[0], a0[1], a0[2], a1[0], a1[1], a1[2], 0.007, 0.004, [0.08, 0.08, 0.08], 0.5); }   // radio + whip antenna
  for (let k = 0; k < 7; k++) rb(-0.1 + k * 0.033, 0.3, 0.234, 0.026, 0.3, 0.008, TAN.map(c => c * 0.55), 0.003);        // pack compression straps
  { const h0 = TP(-0.08, 0.5, 0.2), h1 = TP(-0.05, 0.6, 0.0); R.tube(h0[0], h0[1], h0[2], h1[0], h1[1], h1[2], 0.01, 0.01, [0.1, 0.1, 0.1], 0.3); }    // hydration tube
  }
  // team identification: emissive chest strip + shoulder patches
  rb(0, 0.38, -0.16, 0.2, 0.026, 0.012, tc, 0.006, 0.9);
  }
  // ---- neck + head
  const head0 = TP(0, 0.64, -0.01), hpit = pl.rp;
  R.texture('skin', 1);
  const nk = TP(0, 0.55, -0.01); R.span(R.meshes.cyl, nk[0], nk[1], nk[2], head0[0], head0[1] - 0.02, head0[2], 0.052, skin, 0.05);
  if (agent) { const c0 = TP(0, 0.52, -0.01), c1 = TP(0, 0.6, -0.01); R.tube(c0[0], c0[1], c0[2], c1[0], c1[1], c1[2], 0.066, 0.06, [0.92, 0.92, 0.94], 0.1); R.tube(c0[0], c0[1] - 0.02, c0[2], c1[0], c1[1] - 0.04, c1[2], 0.085, 0.07, op.suit.map(c => c * 0.8), 0.1); }
  const hp = [head0[0], head0[1] + 0.07, head0[2]];
  const HP = (dx, dy, dz) => { const c = Math.cos(hpit), s = Math.sin(hpit); const y = dy * c - dz * s, z = dy * s + dz * c; return [hp[0] + cy * dx + sy * z, hp[1] + y, hp[2] - sy * dx + cy * z]; };
  R.drawMesh(mesh(R, 'head'), hp[0], hp[1], hp[2], R.rotate(pl.ra, hpit), 1, 1, 1, skin, 0, 1, 0.05);
  R.texture('plain');
  const face = (dx, dy, dz, rx, ry, rz, col, em = 0, spc = 0) => { const q = HP(dx, dy, dz); R.sphere(q[0], q[1], q[2], rx, ry, rz, col, em, 1, spc, pl.ra, hpit); };
  const mask = op.hat === 'balaclava';
  if (!mask && lod < 1) {
    face(0, -0.02, -0.098, 0.016, 0.02, 0.02, skin.map(c => c * 0.94));                       // nose
    face(0, -0.065, -0.085, 0.03, 0.008, 0.02, skin.map(c => c * 0.7 + 0.1));                  // lips
    for (const e of [-1, 1]) { face(e * 0.088, -0.01, 0.0, 0.012, 0.03, 0.02, skin.map(c => c * 0.96)); face(e * 0.038, 0.02, -0.093, 0.049 * 0.45, 0.012, 0.012, skin.map(c => c * 0.4)); }
  }
  for (const e of [-1, 1]) { face(e * 0.037, 0.0, -0.088, 0.017, 0.011, 0.012, [0.95, 0.95, 0.93], 0, 0.3); face(e * 0.037, 0.0, -0.096, 0.007, 0.008, 0.006, op.eye || [0.16, 0.12, 0.1], 0, 0.8); }
  // hair / headgear
  const hairC = op.hair || [0.1, 0.07, 0.05], hatC = op.hatCol || [0.2, 0.2, 0.2];
  const hat = (k, col, sc = 1, up = 0, tex = 'plain') => { R.texture(tex, 2); R.drawMesh(mesh(R, k), hp[0], hp[1] - 0.0 + up, hp[2], R.rotate(pl.ra, hpit), sc, sc, sc, col, 0, 1, 0.1); R.texture('plain'); };
  const rbH = (dx, dy, dz, sx, sy_, sz, col, r, spc = 0.2, em = 0) => { const q = HP(dx, dy, dz); R.rbox(q[0], q[1], q[2], sx, sy_, sz, pl.ra, hpit, col, r, em, 1, spc); };
  const shades = (col = [0.02, 0.02, 0.03]) => {
    for (const e of [-1, 1]) { rbH(e * 0.04, 0.005, -0.104, 0.062, 0.036, 0.016, col, 0.012, 0.95); rbH(e * 0.093, 0.01, -0.05, 0.01, 0.014, 0.1, col, 0.004, 0.3); }
    rbH(0, 0.012, -0.108, 0.02, 0.008, 0.01, col, 0.003, 0.5);
  };
  if (agent) {                                                                                 // spy: slicked side-parted hair, dark glasses, coiled earpiece lead
    hat('hair', hairC, 1.03); rbH(-0.03, 0.14, -0.04, 0.09, 0.02, 0.09, hairC.map(c => c * 1.3), 0.01, 0.3);
    shades(); rbH(0.095, -0.012, 0.0, 0.012, 0.022, 0.02, [0.8, 0.65, 0.55], 0.005);
    const e0 = HP(0.095, -0.015, 0.0), e1 = HP(0.1, -0.12, 0.02), e2 = TP(0.1, 0.56, -0.01);
    R.tube(e0[0], e0[1], e0[2], e1[0], e1[1], e1[2], 0.0035, 0.0035, [0.75, 0.6, 0.45], 0.4); R.tube(e1[0], e1[1], e1[2], e2[0], e2[1], e2[2], 0.0035, 0.0035, [0.08, 0.08, 0.08], 0.4);
  }
  else if (op.hat === 'boonie') { hat('hair', hairC, 1.02); hat('helmet', hatC, 1.03, 0.0, 'camoWood'); const b0 = HP(0, 0.07, -0.01), b1 = HP(0, 0.058, -0.01); R.texture('fabric', 2); R.tube(b0[0], b0[1], b0[2], b1[0], b1[1], b1[2], 0.185, 0.2, hatC, 0.05); R.texture('plain'); rbH(0, 0.095, 0.0, 0.2, 0.012, 0.22, hatC.map(c => c * 0.7), 0.006); shades([0.04, 0.04, 0.03]); }
  else if (mask) { hat('head', hatC, 1.04); face(0, 0.015, -0.085, 0.07, 0.022, 0.03, skin); for (const e of [-1, 1]) face(e * 0.037, 0.015, -0.1, 0.017, 0.011, 0.01, [0.95, 0.95, 0.93]); hat('hair', hatC, 1.06, 0.005); }
  else if (op.hat === 'helmet' || op.hat === 'hardhat') {
    const hc = op.hat === 'helmet' ? hatC : TAN;
    hat('helmet', hc, 1.04, 0.0, 'fabric'); rbH(0, 0.115, -0.115, 0.07, 0.04, 0.04, [0.08, 0.08, 0.09], 0.01, 0.4); rbH(0, 0.08, 0.1, 0.12, 0.06, 0.05, hc.map(c => c * 0.8), 0.02);
    rbH(0, 0.05, -0.108, 0.17, 0.02, 0.08, tc, 0.006, 0.2, 0.7);                              // team helmet band
    face(0, 0.12, -0.14, 0.05, 0.012, 0.035, [0.1, 0.1, 0.11], 0, 0.4);
    if (op.hat === 'helmet') { rbH(0, 0.135, -0.15, 0.1, 0.045, 0.045, [0.07, 0.07, 0.08], 0.012, 0.5); for (const e of [-1, 1]) R.tube(...HP(e * 0.028, 0.14, -0.17), ...HP(e * 0.028, 0.14, -0.215), 0.017, 0.015, [0.05, 0.05, 0.06], 0.6); for (const e of [-1, 1]) rbH(e * 0.108, 0.07, -0.02, 0.012, 0.03, 0.12, [0.1, 0.1, 0.1], 0.004); }
    if (op.hat === 'hardhat') for (const e of [-1, 1]) { rbH(e * 0.115, -0.02, 0.02, 0.025, 0.07, 0.09, [0.08, 0.08, 0.09], 0.01, 0.3); }
    else { for (const e of [-1, 1]) face(e * 0.04, 0.085, -0.155, 0.032, 0.022, 0.016, [0.1, 0.16, 0.2], 0.15, 1); }   // goggles on the brow
  }
  else if (op.hat === 'cap') { hat('hair', hairC, 1.02); hat('helmet', hatC, 1.0, 0.012); rbH(0, 0.082, -0.125, 0.17, 0.014, 0.12, hatC.map(c => c * 0.9), 0.006); rbH(0, 0.11, -0.108, 0.06, 0.03, 0.01, tc, 0.004, 0.2, 0.7); shades([0.05, 0.06, 0.07]); }
  else if (op.hat === 'beanie') { hat('helmet', hatC, 1.02, -0.01, 'fabric'); rbH(0, 0.06, 0, 0.2, 0.05, 0.22, hatC.map(c => c * 0.85), 0.02); hat('hair', hairC, 0.98, -0.05); }
  else { hat('hair', hairC, 1.03); rbH(0, 0.0, 0.0, 0.0, 0.0, 0.0, hairC, 0); for (const e of [-1, 1]) rbH(e * 0.1, 0.0, 0.02, 0.03, 0.09, 0.08, hatC, 0.014, 0.5); const a = HP(-0.1, 0.02, 0.02), b = HP(0.1, 0.02, 0.02), c = HP(0, 0.12, 0.02); R.tube(a[0], a[1], a[2], c[0], c[1], c[2], 0.008, 0.008, hatC, 0.5); R.tube(c[0], c[1], c[2], b[0], b[1], b[2], 0.008, 0.008, hatC, 0.5); const m0 = HP(0.1, -0.01, -0.04), m1 = HP(0.04, -0.06, -0.1); R.tube(m0[0], m0[1], m0[2], m1[0], m1[1], m1[2], 0.005, 0.005, hatC); }
  if (pl.helm) {                                                                              // killstreak metal helmet: steel dome, brim, neck guard
    const st = [0.55, 0.58, 0.62];
    rbH(0, 0.075, 0.0, 0.25, 0.15, 0.27, st, 0.06, 0.9); rbH(0, 0.03, -0.01, 0.275, 0.026, 0.295, [0.4, 0.42, 0.46], 0.012, 0.8);
    rbH(0, 0.14, 0.0, 0.05, 0.02, 0.2, [0.4, 0.42, 0.46], 0.008, 0.8); rbH(0, -0.01, 0.13, 0.2, 0.09, 0.03, st, 0.01, 0.8);
    for (const e of [-1, 1]) rbH(e * 0.126, 0.04, 0.0, 0.02, 0.07, 0.1, [0.4, 0.42, 0.46], 0.008, 0.8);
  }
  if (lod < 1) { // face + headgear detail: brows, chin, cheekbones, ear detail, headset boom mic, chin strap, mount
    const hair2 = (op.hair || [0.1, 0.07, 0.05]).map(c => c * 0.9);
    if (!mask) {
      for (const e of [-1, 1]) { face(e * 0.037, 0.034, -0.094, 0.022, 0.006, 0.012, hair2); face(e * 0.037, 0.011, -0.092, 0.02, 0.004, 0.01, skin.map(c => c * 0.84)); face(e * 0.07, -0.04, -0.062, 0.022, 0.022, 0.02, skin.map(c => c * 1.02)); face(e * 0.012, -0.036, -0.094, 0.007, 0.007, 0.007, skin.map(c => c * 0.55)); face(e * 0.092, -0.002, 0.0, 0.007, 0.018, 0.012, skin.map(c => c * 0.8)); }
      face(0, -0.098, -0.07, 0.034, 0.022, 0.03, skin.map(c => c * 0.97)); face(0, -0.052, -0.09, 0.022, 0.005, 0.01, skin.map(c => c * 0.6));
    }
    if (!agent) for (const e of [-1, 1]) rbH(e * 0.1, -0.005, 0.0, 0.022, 0.06, 0.055, [0.06, 0.06, 0.07], 0.01, 0.3);
    if (!agent) { const m0 = HP(0.1, -0.03, 0.0), m1 = HP(0.07, -0.07, -0.07), m2 = HP(0.035, -0.07, -0.1); R.tube(m0[0], m0[1], m0[2], m1[0], m1[1], m1[2], 0.004, 0.004, [0.06, 0.06, 0.06], 0.3); R.tube(m1[0], m1[1], m1[2], m2[0], m2[1], m2[2], 0.004, 0.004, [0.06, 0.06, 0.06], 0.3); R.sphere(m2[0], m2[1], m2[2], 0.011, 0.01, 0.01, [0.08, 0.08, 0.08], 0, 1, 0.5); }
    if (op.hat === 'helmet' || op.hat === 'hardhat') {
      for (const e of [-1, 1]) { const s0 = HP(e * 0.1, 0.02, -0.02), s1 = HP(e * 0.07, -0.1, -0.05), s2 = HP(0, -0.115, -0.07); R.tube(s0[0], s0[1], s0[2], s1[0], s1[1], s1[2], 0.004, 0.004, [0.1, 0.1, 0.1]); R.tube(s1[0], s1[1], s1[2], s2[0], s2[1], s2[2], 0.004, 0.004, [0.1, 0.1, 0.1]); }
      rbH(0, 0.105, -0.12, 0.05, 0.03, 0.03, [0.08, 0.08, 0.09], 0.008, 0.5); rbH(0, 0.1, -0.135, 0.03, 0.02, 0.014, [0.15, 0.2, 0.22], 0.004, 0.2);
      for (let k = -2; k <= 2; k++) rbH(k * 0.022, 0.13, -0.02, 0.012, 0.006, 0.17, [0.09, 0.09, 0.08], 0.003);     // elastic band
    }
  }
  // ---- arms + weapon
  const shY = 0.5, cpp = Math.cos(pl.rp), spp = Math.sin(pl.rp);
  const shR = TP(0.215, shY, 0), shL = TP(-0.215, shY, 0);
  const A = (lx, ly, lz) => { const dy = ly - (hipY + 0.5), dz = lz; return wp(lean + lx, hipY + 0.5 + dy * cpp - dz * spp, dy * spp + dz * cpp); };
  const ox = 0.2, oy = hipY + 0.42 - 0.0, oz = -0.34;
  const g0 = R.state.tris;
  drawGun(R, gun, { origin: A(ox, oy, oz), yaw: pl.ra, pitch: pl.rp, accent: o.accent, gold: o.gold, far: !!o.far, mid: !o.hi });
  R.state.gunTris = R.state.tris - g0;
  const Mg = Array.from(R.rotate(pl.ra, pl.rp)), og = A(ox, oy, oz);                              // gun frame (same rotation drawGun uses)
  const Pg = (lx, ly, lz) => [og[0] + lx * Mg[0] + ly * Mg[3] + lz * Mg[6], og[1] + lx * Mg[1] + ly * Mg[4] + lz * Mg[7], og[2] + lx * Mg[2] + ly * Mg[5] + lz * Mg[8]];
  pl.mz = Pg(0, 0.02, gun.muzzle - 0.01);                                                            // where this soldier's shots leave the gun (used for tracers)
  const { w1: handR, w2: handL } = drawGunHands(R, gun, { M: Mg, P: Pg, skin, glove: agent ? [0.05, 0.045, 0.045] : [0.15, 0.145, 0.13], lod: o.far ? 1 : 0 });   // sculpted hands; returns the wrists
  const l1 = 0.3, l2 = 0.29;
  const elR = ik(shR, handR, l1, l2, [0.5 * cy, -1, -0.5 * sy]), elL = ik(shL, handL, l1, l2, [-0.5 * cy, -1, 0.5 * sy]);
  R.texture(camo, 2);
  for (const [sh, el, hd] of [[shR, elR, handR], [shL, elL, handL]]) {
    R.span(limb, sh[0], sh[1], sh[2], el[0], el[1], el[2], 0.058, white, 0.05);
    R.span(limb, el[0], el[1], el[2], hd[0], hd[1], hd[2], 0.047, white, 0.05);
  }
  R.texture('plain');
  R.texture(camo, 2); for (const sh of [shR, shL]) R.sphere(sh[0], sh[1], sh[2], 0.072, 0.068, 0.072, white, 0, 1, 0.05); R.texture('plain');

  const ab = A(0.4 * -1 - 0.0, hipY + 0.5, -0.02);                                           // armband (emissive team colour) on the left upper arm
  const mid = [(shL[0] * 0.55 + elL[0] * 0.45), (shL[1] * 0.55 + elL[1] * 0.45), (shL[2] * 0.55 + elL[2] * 0.45)];
  R.tube(mid[0], mid[1] - 0.04, mid[2], mid[0], mid[1] + 0.04, mid[2], 0.066, 0.066, tc, 0.2, 0.85);
  void ab;
  { // arms: elbow pads, rolled cuffs, wristwatch, fingers / thumbs / knuckles wrapped on the gun
    const fv = [-sy * cpp, spp, -cy * cpp], sv = [cy, 0, -sy];
    if (!agent) for (const [el, sh] of [[elR, shR], [elL, shL]]) { R.rbox(el[0], el[1] - 0.005, el[2], 0.085, 0.07, 0.07, pl.ra, 0, [0.09, 0.09, 0.1], 0.025, 0, 1, 0.3); const c0 = [el[0] + (sh[0] - el[0]) * 0.28, el[1] + (sh[1] - el[1]) * 0.28, el[2] + (sh[2] - el[2]) * 0.28]; R.tube(c0[0], c0[1], c0[2], el[0] + (sh[0] - el[0]) * 0.18, el[1] + (sh[1] - el[1]) * 0.18, el[2] + (sh[2] - el[2]) * 0.18, 0.062, 0.058, [0.32, 0.32, 0.24]); }
    for (const [hd, el, left] of [[handR, elR, false], [handL, elL, true]]) {
      const gl = [0.09, 0.09, 0.1], gl2 = [0.06, 0.06, 0.07];
      R.tube(hd[0] + (el[0] - hd[0]) * 0.18, hd[1] + (el[1] - hd[1]) * 0.18, hd[2] + (el[2] - hd[2]) * 0.18, hd[0] + (el[0] - hd[0]) * 0.34, hd[1] + (el[1] - hd[1]) * 0.34, hd[2] + (el[2] - hd[2]) * 0.34, 0.042, 0.042, agent ? [0.92, 0.92, 0.94] : gl2, 0.2);   // glove cuff / shirt cuff


      if (left) { const w = [hd[0] + (el[0] - hd[0]) * 0.3, hd[1] + (el[1] - hd[1]) * 0.3 + 0.03, hd[2] + (el[2] - hd[2]) * 0.3]; R.rbox(w[0], w[1], w[2], 0.036, 0.016, 0.036, pl.ra, 0, [0.05, 0.05, 0.05], 0.006, 0, 1, 0.5); R.sphere(w[0], w[1] + 0.01, w[2], 0.011, 0.004, 0.011, [0.3, 1, 0.5], 0.9); }

    }
  }
  if (o.flash) { const f = A(ox, oy + 0.03, oz + gun.muzzle - 0.05); R.sphere(f[0], f[1], f[2], 0.07, 0.07, 0.16, [1, 0.85, 0.4], 1, 1); }
  if (t - (pl.meleeAt || -9) < 0.3) { const k = (t - pl.meleeAt) / 0.3, a0 = A(0.45 - k * 0.6, oy, -0.4 - Math.sin(k * Math.PI) * 0.2), a1 = A(0.45 - k * 0.6, oy, -0.72 - Math.sin(k * Math.PI) * 0.2); R.tube(a0[0], a0[1], a0[2], a1[0], a1[1], a1[2], 0.022, 0.006, [0.88, 0.92, 0.96], 1.1, 0.3); }
}

// ---- death animations. Each kill picks a style (see pickDeath in game.js): 'fwd' crumple forward, 'back' knocked backwards, 'knee' drop to the knees
// then slump, 'blast' thrown through the air in a backflip. The body is posed from a handful of curves (pelvis height, torso tilt, travel), with the
// legs and arms solved by IK, then rests on the floor and sinks away after ~5 s. The weapon is dropped and clatters to the ground.
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const ease = (v) => { v = clamp01(v); return v * v * (3 - 2 * v); };
const easeOut = (v) => 1 - Math.pow(1 - clamp01(v), 3);
const easeIn = (v) => clamp01(v) * clamp01(v);
const lerp1 = (a, b, k) => a + (b - a) * k;
const DEATH_LIFE = 5;
function drawDead(R, pl, t, o, wp, skin, camo) {
  const d = pl.death || { type: 'fwd', push: null, t0: pl.deadAt, hs: false };
  const u = t - (d.t0 == null ? pl.deadAt : d.t0);
  if (u >= DEATH_LIFE) return;
  const sink = u > DEATH_LIFE - 0.7 ? (u - (DEATH_LIFE - 0.7)) / 0.7 * 0.35 : 0;
  const { op, tc, gun } = o, agent = op.hat === 'agent', white = agent ? op.suit.map(c => c * 0.55) : [1, 1, 1], limb = mesh(R, 'limb');
  const fx = -Math.sin(pl.ra), fz = -Math.cos(pl.ra);                                          // original facing
  let px = d.push ? d.push[0] : fx, pz = d.push ? d.push[1] : fz;                              // direction the victim is pushed
  { const l = Math.hypot(px, pz) || 1; px /= l; pz /= l; }
  const type = d.type, fwd = type === 'fwd' || type === 'knee', s = fwd ? 1 : -1;               // fall direction relative to the body (forward / backward)
  // body faces the push direction when falling forwards, towards the shooter when falling backwards; twist into it during the first moments
  const faceX = fwd ? px : -px, faceZ = fwd ? pz : -pz, yawT = Math.atan2(-faceX, -faceZ);
  let dyaw = yawT - pl.ra; dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
  const yaw = pl.ra + dyaw * ease(u / 0.35);
  const fX = -Math.sin(yaw), fZ = -Math.cos(yaw);
  // ---- curves
  let th, hipH, disp, flail, kick = 0, snap = 0, land = 1;
  const rest = Math.PI / 2, restH = fwd ? 0.14 : 0.26;
  if (type === 'fwd') { th = rest * easeIn((u - 0.2) / 0.75) * 0.92 + rest * 0.08 * ease((u - 0.9) / 0.3); hipH = lerp1(0.93, restH, easeOut(u / 0.9)); disp = 0.55 * ease(u / 0.95); flail = Math.sin(clamp01(u / 0.6) * Math.PI); }
  else if (type === 'back') { th = rest * ease(u / 0.65); hipH = lerp1(0.93, restH, easeIn(u / 0.7)); disp = (d.big ? 1.1 : 0.7) * easeOut(u / 0.7); flail = Math.sin(clamp01(u / 0.7) * Math.PI) * 1.2; kick = Math.sin(clamp01(u / 0.65) * Math.PI); snap = d.hs ? Math.sin(clamp01(u / 0.3) * Math.PI / 2) * 0.6 : 0; }
  else if (type === 'knee') { th = rest * easeIn((u - 0.45) / 0.75); hipH = u < 0.45 ? lerp1(0.93, 0.5, ease(u / 0.4)) : lerp1(0.5, restH, easeIn((u - 0.45) / 0.75)); disp = 0.4 * ease(u / 1.1); flail = Math.sin(clamp01(u / 0.8) * Math.PI) * 0.5; }
  else { // blast: launched, tumbling backwards
    const T = 0.95, uu = Math.min(u, T);
    th = (rest + Math.PI * 2) * easeOut(u / T);
    hipH = Math.max(restH, 0.93 + 4.4 * uu - 4.9 * uu * uu); if (u > 0.82) hipH = lerp1(hipH, restH, ease((u - 0.82) / 0.13));
    disp = 2.6 * easeOut(u / T); flail = 1.4 * (1 - ease(u / 0.9)) + 0.2; kick = 1 - ease(u / 0.9); land = ease((u - 0.7) / 0.25);
  }
  const hp0 = [pl.rx + px * disp, pl.ry + hipH - sink, pl.rz + pz * disp];
  // ---- torso frame: columns of R.rotate(yaw, pitch) are the torso-space x, y, z axes
  const pitch = -s * th;
  const M = Array.from(R.rotate(yaw, pitch));
  const TP = (lx, ly, lz) => [hp0[0] + lx * M[0] + ly * M[3] + lz * M[6], hp0[1] + lx * M[1] + ly * M[4] + lz * M[7], hp0[2] + lx * M[2] + ly * M[5] + lz * M[8]];
  const floorY = pl.ry - sink;
  const hipC = TP(0, -0.04, 0);
  R.texture(camo, 2);
  R.drawMesh(mesh(R, 'torso'), hipC[0], hipC[1], hipC[2], R.rotate(yaw, pitch), 1, 1, 1, white, 0, 1, 0.05);
  R.texture('fabric', 2);
  if (!agent) R.drawMesh(mesh(R, 'vest'), hipC[0], hipC[1], hipC[2], R.rotate(yaw, pitch), 1, 1, 1, o.tm ? tc.map(c => c * 0.28 + 0.1) : WEBBING, 0, 1, 0.1);
  R.texture('plain');
  const rb = (lx, ly, lz, sx, sy_, sz, col, r, em = 0, spc = 0.2) => { const q = TP(lx, ly - 0.04, lz); R.rbox(q[0], q[1], q[2], sx, sy_, sz, yaw, pitch, col, r, em, 1, spc); };
  if (agent) { rb(0, 0.04, 0, 0.35, 0.07, 0.23, [0.07, 0.07, 0.08], 0.025); rb(0, 0.3, -0.15, 0.04, 0.3, 0.02, tc, 0.01, 0.6); } else {
  rb(0, 0.04, 0, 0.35, 0.07, 0.23, [0.07, 0.07, 0.08], 0.025); rb(0, 0.04, -0.12, 0.06, 0.05, 0.02, [0.55, 0.55, 0.5], 0.008, 0, 0.8); rb(0.2, -0.04, -0.06, 0.07, 0.2, 0.12, [0.1, 0.1, 0.11], 0.025);
  for (const sx of [-0.105, -0.035, 0.035, 0.105]) rb(sx, 0.31, -0.15, 0.065, 0.14, 0.05, TAN.map(c => c * 0.8), 0.02);
  rb(-0.1, 0.17, -0.14, 0.12, 0.09, 0.06, WEBBING, 0.02); rb(0.1, 0.17, -0.14, 0.12, 0.09, 0.06, WEBBING, 0.02); rb(0, 0.44, -0.145, 0.15, 0.06, 0.03, [0.1, 0.1, 0.11], 0.012);
  rb(0, 0.3, 0.17, 0.3, 0.38, 0.12, TAN.map(c => c * 0.75), 0.05, 0, 0.1); rb(0, 0.28, 0.24, 0.22, 0.22, 0.04, TAN.map(c => c * 0.65), 0.03);
  rb(0, 0.11, -0.145, 0.34, 0.06, 0.03, [0.1, 0.1, 0.09], 0.012); rb(0, 0.38, -0.16, 0.2, 0.026, 0.012, tc, 0.006, 0.9);
  }
  // ---- legs: pelvis frame; ankles blend from standing on the floor to trailing straight behind the torso as it falls
  const w = ease(th / rest), fwdW = [fX, 0, fZ];
  R.texture(camo, 2);
  const feet = [];
  for (let i = 0; i < 2; i++) {
    const sd = i ? 0.1 : -0.1, hip = TP(sd, -0.02, 0);
    const stand = [pl.rx + (-fZ) * 0 + Math.cos(yaw) * sd, floorY + 0.1, pl.rz - Math.sin(yaw) * sd];
    const kneeling = type === 'knee' ? [stand[0] - fX * 0.28 * ease(u / 0.4), floorY + 0.1, stand[2] - fZ * 0.28 * ease(u / 0.4)] : stand;
    const trail = TP(sd * 1.2, -0.88, (i ? 1 : -1) * 0.05 * kick);
    const k = type === 'blast' ? 1 : w;
    let ank = [lerp1(kneeling[0], trail[0], k), lerp1(kneeling[1], trail[1], k), lerp1(kneeling[2], trail[2], k)];
    ank[1] += kick * 0.3 * (i ? 1 : 0.6) * (type === 'blast' ? 0 : 1);
    ank[1] = Math.max(ank[1], floorY + 0.09);
    const knee = ik(hip, ank, 0.44, 0.45, [fwdW[0], 0.4, fwdW[2]]);
    R.span(limb, hip[0], hip[1], hip[2], knee[0], knee[1], knee[2], 0.088, white, 0.05); R.span(limb, knee[0], knee[1], knee[2], ank[0], ank[1] + 0.02, ank[2], 0.066, white, 0.05);
    feet.push(ank);
  }
  R.texture('plain');
  for (const a of feet) { R.rbox(a[0] + fX * 0.07, a[1] - 0.03, a[2] + fZ * 0.07, 0.115, 0.13, 0.31, yaw, -s * th * 0.6 * 0 + 0.1, BOOT, 0.04, 0, 1, 0.25); R.rbox(a[0] + fX * 0.07, a[1] - 0.085, a[2] + fZ * 0.07, 0.12, 0.035, 0.32, yaw, 0.1, SOLE, 0.012); }
  // ---- arms flail out and up, then flop
  const shR = TP(0.215, 0.5, 0), shL = TP(-0.215, 0.5, 0), hands = [], els = [];
  R.texture(camo, 2);
  for (const [sh, sg] of [[shR, 1], [shL, -1]]) {
    const hand = TP(sg * (0.36 + 0.12 * flail), lerp1(0.28, 0.82, flail * 0.8), (type === 'back' ? -0.2 : -0.28) * (1 - 0.5 * ease(u / 1)) - 0.1 * flail * sg);
    const el = ik(sh, hand, 0.3, 0.29, [sg * 0.6, -0.4, 0.2]);
    R.span(limb, sh[0], sh[1], sh[2], el[0], el[1], el[2], 0.058, white, 0.05); R.span(limb, el[0], el[1], el[2], hand[0], hand[1], hand[2], 0.047, white, 0.05);
    R.sphere(sh[0], sh[1], sh[2], 0.072, 0.068, 0.072, white, 0, 1, 0.05); hands.push(hand); els.push(el);
  }
  R.texture('plain');
  hands.forEach((hd, i) => { const el = els[i], dx = hd[0] - el[0], dy = hd[1] - el[1], dz = hd[2] - el[2], l = Math.hypot(dx, dy, dz) || 1; drawLooseHand(R, i ? -1 : 1, skin, [0.15, 0.145, 0.13], hd, [dx / l, dy / l, dz / l], 0); });
  // ---- neck + head (snaps back on a headshot, droops forward otherwise)
  const hpit = pitch + (s > 0 ? -0.35 * ease(u / 0.8) : 0.3 + snap);
  const head0 = TP(0, 0.64, -0.01), hpp = [head0[0], head0[1] + 0.07 * Math.cos(pitch) , head0[2]];
  const nk = TP(0, 0.55, -0.01);
  R.texture('skin', 1);
  R.span(R.meshes.cyl, nk[0], nk[1], nk[2], head0[0], head0[1] - 0.02, head0[2], 0.052, skin, 0.05);
  const hp = TP(0, 0.71, -0.01);
  R.drawMesh(mesh(R, 'head'), hp[0], hp[1], hp[2], R.rotate(yaw, hpit), 1, 1, 1, skin, 0, 1, 0.05);
  R.texture('plain');
  const hatC = op.hatCol || [0.2, 0.2, 0.2], hairC = op.hair || [0.1, 0.07, 0.05];
  const HRot = R.rotate(yaw, hpit);
  const hatMesh = (k, col, sc, tex = 'plain') => { R.texture(tex, 2); R.drawMesh(mesh(R, k), hp[0], hp[1], hp[2], HRot, sc, sc, sc, col, 0, 1, 0.1); R.texture('plain'); };
  if (op.hat === 'balaclava') hatMesh('head', hatC, 1.04);
  else if (op.hat === 'helmet' || op.hat === 'hardhat') hatMesh('helmet', op.hat === 'helmet' ? hatC : TAN, 1.04, 'fabric');
  else if (op.hat === 'boonie') { hatMesh('hair', hairC, 1.02); hatMesh('helmet', hatC, 1.03); const b = TP(0, 0.78, -0.01); R.tube(b[0], b[1], b[2], b[0], b[1] - 0.012, b[2], 0.19, 0.2, hatC, 0.05); }
  else if (op.hat === 'cap' || op.hat === 'beanie') { hatMesh('hair', hairC, 1.02); hatMesh('helmet', hatC, 1.0); }
  else hatMesh('hair', hairC, 1.03);
  if (pl.helm) { const q = hp; R.sphere(q[0], q[1] + 0.07 * Math.cos(hpit), q[2], 0.125, 0.085, 0.135, [0.55, 0.58, 0.62], 0, 1, 0.9, yaw, hpit); }
  // ---- dropped weapon: tossed from the hands at the start of the fall, bounces and settles on its side
  if (gun) {
    const g0 = hands[0], tg = Math.max(0, u - 0.12), gy = Math.max(floorY + 0.045, g0[1] + 1.6 * tg - 4.9 * tg * tg * 0.9), gk = easeOut(tg / 0.7);
    const gx = lerp1(g0[0], g0[0] + px * 0.9 + fX * 0.2, gk), gz = lerp1(g0[2], g0[2] + pz * 0.9 + fZ * 0.2, gk);
    const spin = (1 - ease(tg / 0.6)) * 4.0, roll = lerp1(0, 1.35, ease(tg / 0.5));
    drawGun(R, gun, { origin: [gx, gy, gz], yaw: yaw + 0.7 + spin * 0.4, pitch: 0, roll, accent: o.accent, gold: o.gold, far: true });
  }
  // ---- blood pool spreads under the body once it has landed
  const bl = ease((u - (type === 'blast' ? 0.9 : 0.6)) / 1.6);
  if (bl > 0.01 && !(o.noBlood)) { R.transparent(true); R.tube(hp0[0], floorY + 0.012, hp0[2], hp0[0], floorY + 0.02, hp0[2], 0.2 + 0.4 * bl, 0.2 + 0.4 * bl, [0.32, 0.02, 0.03], 0.2, 0, 0.8 * (1 - sink * 2)); R.transparent(false); }
}
