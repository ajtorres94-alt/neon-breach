// Killstreak units: attack dog, sentry gun, rat swarm and barrier. (The clone is drawn with the regular soldier model.)
import { drawGun, GUNS } from './guns.js';

const FUR = [0.34, 0.24, 0.15], FUR2 = [0.2, 0.14, 0.09], DARK = [0.08, 0.08, 0.09], RAT = [0.34, 0.31, 0.29];

function frame(u) { const c = Math.cos(u.ra), s = Math.sin(u.ra); return { f: [-s, -c], r: [c, -s] }; }
const at = (u, F, fw, sd, up) => [u.rx + F.f[0] * fw + F.r[0] * sd, u.ry + up, u.rz + F.f[1] * fw + F.r[1] * sd];

/** hp bar floating above a unit, always facing the camera. */
export function hpBar(R, x, y, z, frac, camYaw, col) {
  const w = 0.8;
  R.rbox(x, y, z, w + 0.04, 0.07, 0.03, camYaw, 0, [0.02, 0.02, 0.03], 0.01, 0.2);
  const f = Math.max(0.001, Math.min(1, frac)), off = -(w * (1 - f)) / 2, c = Math.cos(camYaw), s = -Math.sin(camYaw);
  R.rbox(x + c * off, y, z + s * off + 0.0, w * f, 0.045, 0.036, camYaw, 0, col, 0.008, 0.9);
}

export function drawDog(R, u, t, tint) {
  const F = frame(u), run = Math.min(1, u.speed / 3), ph = u.phase, bob = Math.abs(Math.sin(ph)) * 0.05 * run;
  const bod = at(u, F, 0, 0, 0.56 + bob);
  R.rbox(bod[0], bod[1], bod[2], 0.3, 0.3, 0.72, u.ra, -0.04 * run, FUR, 0.1, 0, 1, 0.1);
  const ch = at(u, F, -0.28, 0, 0.62 + bob); R.rbox(ch[0], ch[1], ch[2], 0.26, 0.3, 0.26, u.ra, 0, FUR2, 0.09);           // chest / shoulders
  const nk = at(u, F, -0.46, 0, 0.78 + bob); R.rbox(nk[0], nk[1], nk[2], 0.15, 0.16, 0.18, u.ra, 0.5, FUR, 0.07);
  const hd = at(u, F, -0.62, 0, 0.88 + bob); R.rbox(hd[0], hd[1], hd[2], 0.2, 0.19, 0.22, u.ra, 0, FUR, 0.07);
  const sn = at(u, F, -0.76, 0, 0.84 + bob); R.rbox(sn[0], sn[1], sn[2], 0.11, 0.1, 0.16, u.ra, 0, FUR2, 0.04);
  const nose = at(u, F, -0.85, 0, 0.855 + bob); R.sphere(nose[0], nose[1], nose[2], 0.03, 0.025, 0.025, DARK, 0, 1, 0.8);
  for (const e of [-1, 1]) {
    const ear = at(u, F, -0.58, e * 0.08, 1.02 + bob); R.rbox(ear[0], ear[1], ear[2], 0.05, 0.12, 0.06, u.ra, 0, FUR2, 0.02, 0, 1, 0, e * 0.25);
    const eye = at(u, F, -0.72, e * 0.07, 0.92 + bob); R.sphere(eye[0], eye[1], eye[2], 0.018, 0.018, 0.018, [1, 0.75, 0.2], 0.9);
  }
  const col = at(u, F, -0.5, 0, 0.8 + bob); R.rbox(col[0], col[1], col[2], 0.22, 0.05, 0.07, u.ra, 0.5, tint, 0.015, 0.7);        // team collar
  const tl0 = at(u, F, 0.36, 0, 0.64 + bob), tl1 = at(u, F, 0.62, 0, 0.78 + bob + Math.sin(t * 12) * 0.03 * run);
  R.tube(tl0[0], tl0[1], tl0[2], tl1[0], tl1[1], tl1[2], 0.035, 0.015, FUR2);
  { // fur ruff + spine ridge + haunch muscle, jaw with teeth and tongue, nostrils, brows, tactical harness
    const bite = u.biting ? 0.05 : 0.0;
    for (let k = 0; k < 7; k++) { const q = at(u, F, -0.4 + k * 0.1, 0, 0.72 + bob - (k > 4 ? 0.02 : 0) + Math.sin(t * 9 + k) * 0.004 * run); R.rbox(q[0], q[1], q[2], 0.05, 0.05, 0.09, u.ra, 0, FUR2, 0.02); }
    for (const e of [-1, 1]) {
      const hq = at(u, F, 0.24, e * 0.12, 0.54 + bob); R.sphere(hq[0], hq[1], hq[2], 0.09, 0.12, 0.13, FUR, 0, 1, 0.1);
      const sh = at(u, F, -0.26, e * 0.12, 0.56 + bob); R.sphere(sh[0], sh[1], sh[2], 0.075, 0.11, 0.11, FUR, 0, 1, 0.1);
      for (let k = 0; k < 4; k++) { const r = at(u, F, -0.5 + k * 0.045, e * (0.1 + k * 0.006), 0.78 + bob + k * 0.018); R.rbox(r[0], r[1], r[2], 0.04, 0.03, 0.06, u.ra, 0, FUR, 0.012); }   // cheek / neck fur tufts
      const br = at(u, F, -0.68, e * 0.06, 0.965 + bob); R.rbox(br[0], br[1], br[2], 0.05, 0.015, 0.03, u.ra, 0, FUR2, 0.006);
      const ei = at(u, F, -0.585, e * 0.075, 1.0 + bob); R.rbox(ei[0], ei[1], ei[2], 0.03, 0.08, 0.02, u.ra, 0, [0.5, 0.35, 0.3], 0.01);
      const nos = at(u, F, -0.84, e * 0.022, 0.865 + bob); R.sphere(nos[0], nos[1], nos[2], 0.008, 0.008, 0.006, [0.02, 0.02, 0.02], 0);
      for (let w = 0; w < 3; w++) { const w0 = at(u, F, -0.8, e * 0.05, 0.835 + bob + w * 0.012), w1 = at(u, F, -0.86, e * 0.12, 0.825 + bob + w * 0.02); R.tube(w0[0], w0[1], w0[2], w1[0], w1[1], w1[2], 0.002, 0.001, [0.85, 0.85, 0.8], 0); }
      const pup = at(u, F, -0.72, e * 0.07, 0.925 + bob); R.sphere(pup[0], pup[1], pup[2], 0.008, 0.01, 0.006, [0.02, 0.02, 0.02], 0, 1, 0.9);
      for (let k = 0; k < 3; k++) { const tt = at(u, F, -0.79 + k * 0.025, e * (0.035 - k * 0.006), 0.8 + bob - bite); R.rbox(tt[0], tt[1], tt[2], 0.008, 0.026, 0.01, u.ra, 0, [0.95, 0.95, 0.9], 0.003, 0, 1, 0.6); }   // fangs + teeth
    }
    const jw = at(u, F, -0.74, 0, 0.785 + bob - bite); R.rbox(jw[0], jw[1], jw[2], 0.085, 0.03, 0.14, u.ra, bite * 4, FUR2, 0.02);
    const tg = at(u, F, -0.76, 0, 0.775 + bob - bite); R.rbox(tg[0], tg[1], tg[2], 0.045, 0.012, 0.09, u.ra, bite * 4, [0.85, 0.35, 0.4], 0.005);
    const hr = [at(u, F, -0.2, 0, 0.7 + bob), at(u, F, 0.12, 0, 0.7 + bob)];                                                      // harness: dorsal panel + straps + buckle + team patch
    R.rbox(hr[0][0], hr[0][1], hr[0][2], 0.2, 0.05, 0.32, u.ra, 0, [0.12, 0.13, 0.11], 0.015, 0, 1, 0.2);
    for (const e of [-1, 1]) { const sa = at(u, F, -0.2, e * 0.14, 0.55 + bob), sb = at(u, F, 0.12, e * 0.14, 0.55 + bob); R.rbox(sa[0], sa[1], sa[2], 0.022, 0.3, 0.03, u.ra, 0, [0.1, 0.1, 0.1], 0.006); R.rbox(sb[0], sb[1], sb[2], 0.022, 0.3, 0.03, u.ra, 0, [0.1, 0.1, 0.1], 0.006); const pt = at(u, F, -0.05, e * 0.145, 0.66 + bob); R.rbox(pt[0], pt[1], pt[2], 0.014, 0.07, 0.1, u.ra, 0, tint, 0.004, 0.8); }
    const bk = at(u, F, -0.05, 0, 0.74 + bob); R.rbox(bk[0], bk[1], bk[2], 0.05, 0.02, 0.05, u.ra, 0, [0.6, 0.6, 0.6], 0.005, 0, 1, 0.9);
    for (let k = 0; k < 6; k++) { const rb = at(u, F, -0.15 + k * 0.05, 0, 0.745 + bob); R.rbox(rb[0], rb[1], rb[2], 0.1, 0.008, 0.012, u.ra, 0, [0.07, 0.07, 0.07], 0.002); }
    const ld = at(u, F, 0.0, 0, 0.77 + bob); R.sphere(ld[0], ld[1], ld[2], 0.012, 0.012, 0.012, [0.3, 1, 0.5], 0.9);
  }
  for (let k = 0; k < 4; k++) {                                                                                                  // legs: diagonal gait
    const front = k < 2, side = k % 2 ? 0.1 : -0.1, a = ph + (front ? 0 : Math.PI) + (k % 2 ? Math.PI : 0), sw = Math.sin(a) * 0.2 * run, lift = Math.max(0, Math.cos(a)) * 0.1 * run;
    const hipF = front ? -0.25 : 0.25, hip = at(u, F, hipF, side, 0.46 + bob), paw = at(u, F, hipF + sw, side, 0.03 + lift);
    const kn = at(u, F, hipF + sw * 0.45 + (front ? 0.04 : -0.06), side, 0.26 + lift * 0.5);
    R.limb(hip[0], hip[1], hip[2], kn[0], kn[1], kn[2], front ? 0.048 : 0.058, front ? FUR : FUR2);
    R.limb(kn[0], kn[1], kn[2], paw[0], paw[1] + 0.03, paw[2], 0.035, front ? FUR : FUR2);
    R.rbox(paw[0] + F.f[0] * -0.03, paw[1] + 0.015, paw[2] + F.f[1] * -0.03, 0.07, 0.04, 0.1, u.ra, 0, FUR2, 0.02);
    for (let q = -1; q <= 1; q++) { const to = [paw[0] + F.f[0] * -0.085 + F.r[0] * q * 0.022, paw[1] + 0.012, paw[2] + F.f[1] * -0.085 + F.r[1] * q * 0.022]; R.sphere(to[0], to[1], to[2], 0.016, 0.014, 0.02, FUR2, 0); R.rbox(to[0] + F.f[0] * -0.02, to[1] - 0.006, to[2] + F.f[1] * -0.02, 0.006, 0.006, 0.018, u.ra, 0, [0.12, 0.1, 0.08], 0.002); }
  }
}

export function drawSentry(R, u, t, tint, flash) {
  const x = u.rx, y = u.ry, z = u.rz;
  for (let k = 0; k < 3; k++) {                                                                                                  // tripod
    const a = k * 2.094 + 0.4, ex = x + Math.cos(a) * 0.55, ez = z + Math.sin(a) * 0.55;
    R.tube(x, y + 0.72, z, ex, y + 0.02, ez, 0.035, 0.04, [0.2, 0.21, 0.24], 0.5);
    R.rbox(ex, y + 0.02, ez, 0.12, 0.04, 0.12, a, 0, DARK, 0.01);
  }
  R.tube(x, y + 0.7, z, x, y + 0.82, z, 0.11, 0.1, [0.25, 0.27, 0.3], 0.6);                                                      // pivot
  const c = Math.cos(u.ra), s = Math.sin(u.ra), fw = [-s, -c], hy = y + 1.0;
  R.rbox(x, hy - 0.08, z, 0.3, 0.2, 0.34, u.ra, u.rp, [0.25, 0.3, 0.22], 0.05, 0, 1, 0.4);                                      // turret body
  R.rbox(x - fw[0] * 0.12, hy + 0.06, z - fw[1] * 0.12, 0.22, 0.05, 0.2, u.ra, u.rp, [0.18, 0.2, 0.16], 0.02);
  R.rbox(x + fw[0] * 0.24, hy - 0.04, z + fw[1] * 0.24 + 0, 0.36, 0.3, 0.05, u.ra, u.rp, [0.15, 0.17, 0.14], 0.015, 0, 1, 0.5);   // armour plate
  drawGun(R, GUNS.m4, { origin: [x - fw[0] * 0.25, hy, z - fw[1] * 0.25], yaw: u.ra, pitch: u.rp, accent: [0.6, 0.6, 0.6], scale: 1.0, mid: true });
  { // gimbal, barrel shroud, sensor head with laser, radar dish, feed belt, armour bolts + hazard decal, antenna, battery, tripod joints
    R.tube(x, hy - 0.2, z, x, hy - 0.04, z, 0.075, 0.075, [0.18, 0.2, 0.22], 0.6);
    for (let k = 0; k < 8; k++) { const an = k * 0.785, q = [x + Math.cos(an) * 0.075, hy - 0.2, z + Math.sin(an) * 0.075]; R.sphere(q[0], q[1], q[2], 0.01, 0.01, 0.01, [0.5, 0.5, 0.52], 0, 1, 0.9); }
    const sh0 = [x + fw[0] * 0.55, hy - 0.01 + Math.sin(u.rp) * 0.55, z + fw[1] * 0.55];
    R.tube(sh0[0] - fw[0] * 0.2, sh0[1] - Math.sin(u.rp) * 0.2, sh0[2] - fw[1] * 0.2, sh0[0] + fw[0] * 0.28, sh0[1] + Math.sin(u.rp) * 0.28, sh0[2] + fw[1] * 0.28, 0.034, 0.034, [0.14, 0.15, 0.16], 0.6);
    for (let k = 0; k < 8; k++) { const q = [sh0[0] - fw[0] * 0.15 + fw[0] * k * 0.045, sh0[1] - Math.sin(u.rp) * 0.15 + Math.sin(u.rp) * k * 0.045 + 0.036, sh0[2] - fw[1] * 0.15 + fw[1] * k * 0.045]; R.rbox(q[0], q[1], q[2], 0.012, 0.012, 0.02, u.ra, u.rp, [0.05, 0.05, 0.05], 0.004); }   // shroud vents
    const eye = [x + fw[0] * 0.14, hy + 0.2, z + fw[1] * 0.14];
    R.rbox(eye[0], eye[1] - 0.04, eye[2], 0.1, 0.07, 0.1, u.ra, 0, [0.15, 0.16, 0.17], 0.02, 0, 1, 0.6); R.tube(eye[0] - fw[0] * 0.03, eye[1] - 0.04, eye[2] - fw[1] * 0.03, eye[0] + fw[0] * 0.07, eye[1] - 0.04, eye[2] + fw[1] * 0.07, 0.03, 0.026, [0.05, 0.05, 0.06], 0.7);
    R.sphere(eye[0] + fw[0] * 0.075, eye[1] - 0.04, eye[2] + fw[1] * 0.075, 0.018, 0.018, 0.012, [1, 0.15, 0.1], 0.9);
    R.tube(x + fw[0] * 0.2, hy + 0.1, z + fw[1] * 0.2, x + fw[0] * 4, hy + 0.1 + Math.sin(u.rp) * 4, z + fw[1] * 4, 0.003, 0.003, [1, 0.1, 0.1], 0, 1, 0.0);
    const dsh = [x - fw[0] * 0.05 + c * 0.14, hy + 0.2, z - fw[1] * 0.05 - s * 0.14]; R.tube(dsh[0], dsh[1] - 0.1, dsh[2], dsh[0], dsh[1], dsh[2], 0.008, 0.008, [0.2, 0.2, 0.22], 0.5); R.sphere(dsh[0], dsh[1] + 0.01, dsh[2], 0.06, 0.02, 0.06, [0.3, 0.32, 0.34], 0, 1, 0.8, u.ra + t * 2.0, 0.4);
    const an = [x - c * 0.14, hy + 0.1, z + s * 0.14]; R.tube(an[0], an[1], an[2], an[0], an[1] + 0.32, an[2], 0.006, 0.003, [0.1, 0.1, 0.1], 0.5); R.sphere(an[0], an[1] + 0.33, an[2], 0.01, 0.01, 0.01, [1, 0.2, 0.2], 0.9);
    for (let k = 0; k < 6; k++) for (const sd of [-1, 1]) R.sphere(x + fw[0] * 0.27 + c * sd * (0.12 - (k % 2) * 0.01), hy - 0.15 + Math.floor(k / 2) * 0.09, z + fw[1] * 0.27 - s * sd * 0.12, 0.009, 0.009, 0.009, [0.55, 0.55, 0.57], 0, 1, 0.9);   // plate bolts
    for (let k = 0; k < 5; k++) R.rbox(x + fw[0] * 0.27, hy - 0.2 + k * 0.045, z + fw[1] * 0.27, 0.3, 0.02, 0.012, u.ra, 0, k % 2 ? [0.95, 0.75, 0.1] : [0.07, 0.07, 0.08], 0.003);   // hazard decal
    const bt = [x - fw[0] * 0.12, hy - 0.2, z - fw[1] * 0.12]; R.rbox(bt[0], bt[1], bt[2], 0.2, 0.1, 0.14, u.ra, 0, [0.1, 0.11, 0.12], 0.02); R.rbox(bt[0], bt[1] - 0.03, bt[2], 0.16, 0.02, 0.12, u.ra, 0, [0.9, 0.7, 0.1], 0.004, 0.3);
    for (let k = 0; k < 3; k++) { const a2 = k * 2.094 + 0.4, j = [x + Math.cos(a2) * 0.3, y + 0.38, z + Math.sin(a2) * 0.3]; R.sphere(j[0], j[1], j[2], 0.04, 0.04, 0.04, [0.15, 0.16, 0.18], 0, 1, 0.8); R.tube(x + Math.cos(a2) * 0.58, y + 0.04, z + Math.sin(a2) * 0.58, x + Math.cos(a2) * 0.66, y + 0.0, z + Math.sin(a2) * 0.66, 0.008, 0.002, [0.7, 0.7, 0.72], 0.8); }
  }
  const bx = x - c * 0.26, bz = z + s * 0.26;
  R.rbox(bx, y + 0.9, bz, 0.12, 0.18, 0.22, u.ra, 0, [0.22, 0.24, 0.17], 0.03);                                                  // ammo box
  { // ammo belt from the box into the gun: brass rounds on a link strip
    const n = 9; for (let k = 0; k < n; k++) { const f = k / (n - 1), px = bx + (x - fw[0] * 0.1 - bx) * f, pz = bz + (z - fw[1] * 0.1 - bz) * f, py = y + 0.9 + (hy - 0.05 - (y + 0.9)) * f + Math.sin(f * Math.PI) * 0.06;
      R.tube(px, py - 0.02, pz, px, py + 0.02, pz, 0.01, 0.01, [0.85, 0.62, 0.22], 0.8); R.rbox(px, py - 0.01, pz, 0.012, 0.012, 0.02, u.ra, 0, [0.3, 0.3, 0.3], 0.003); }
    const bars = Math.round(u.am / 100 * 8); for (let k = 0; k < 8; k++) R.rbox(bx, y + 0.85 + k * 0.02, bz + 0.0 - s * 0.0, 0.015, 0.012, 0.115, u.ra, 0, k < bars ? [0.3, 1, 0.4] : [0.15, 0.15, 0.15], 0.003, k < bars ? 0.8 : 0);
  }
  const ammo = u.am / 100;
  R.sphere(x, hy + 0.14, z, 0.03, 0.03, 0.03, ammo > 0.25 ? [0.3, 1, 0.4] : [1, 0.25, 0.2], 1);                                  // status light
  R.rbox(x, hy + 0.11, z, 0.05, 0.015, 0.05, u.ra, 0, tint, 0.004, 0.9);
  if (flash) R.sphere(x + fw[0] * 1.15, hy + Math.sin(u.rp) * 1.1, z + fw[1] * 1.15, 0.1, 0.1, 0.1, [1, 0.85, 0.45], 1, 0.9);
}

export function drawRats(R, u, t, tint) {
  const F = frame(u);
  for (let k = 0; k < 10; k++) {
    const a = k * 2.399 + Math.sin(t * 0.8 + k) * 0.5, rad = 0.25 + (k % 5) * 0.14 + Math.sin(t * 7 + k * 3) * 0.05;
    const ox = Math.cos(a) * rad, oz = Math.sin(a) * rad + Math.sin(t * 5 + k) * 0.08, y = u.ry;
    const x = u.rx + ox, z = u.rz + oz, yaw = u.ra + Math.sin(t * 9 + k * 2) * 0.35, c = Math.cos(yaw), s = Math.sin(yaw), sc = 0.1 + (k % 3) * 0.01;
    const sc2 = Math.abs(Math.sin(t * 20 + k)) * 0.012 * Math.min(1, u.speed / 2);
    R.rbox(x, y + 0.075 + sc2, z, 0.1, 0.09, 0.22, yaw, 0, RAT, 0.04, 0, 1, 0.1);
    R.sphere(x - s * 0.13, y + 0.085 + sc2, z - c * 0.13, 0.05, 0.045, 0.06, [0.4, 0.36, 0.33], 0, 1, 0.1);
    R.sphere(x - s * 0.19, y + 0.08 + sc2, z - c * 0.19, 0.012, 0.012, 0.012, DARK, 0);
    R.sphere(x - s * 0.04, y + 0.05, z - c * 0.04, 0.052, 0.03, 0.09, [0.55, 0.45, 0.4], 0, 1, 0.1);                                      // pale belly
    R.sphere(x + s * 0.04, y + 0.12, z + c * 0.04, 0.055, 0.045, 0.09, [0.3, 0.27, 0.25], 0, 1, 0.1);                                       // hunched back
    for (let l = 0; l < 4; l++) { const fr = l < 2 ? -0.06 : 0.07, sd = l % 2 ? 0.035 : -0.035, sw = Math.sin(t * 22 + k + l * 1.6) * 0.03 * Math.min(1, u.speed / 2);
      const hx = x - s * (fr + sw) + c * sd, hz = z - c * (fr + sw) - s * sd; R.limb(x - s * fr + c * sd * 0.6, y + 0.06, z - c * fr - s * sd * 0.6, hx, y + 0.012, hz, 0.012, [0.5, 0.4, 0.38]); R.rbox(hx - s * 0.012, y + 0.008, hz - c * 0.012, 0.018, 0.01, 0.03, yaw, 0, [0.6, 0.5, 0.48], 0.003); }
    for (const sd of [-1, 1]) { R.sphere(x - s * 0.15 + c * sd * 0.022, y + 0.1, z - c * 0.15 - s * sd * 0.022, 0.012, 0.012, 0.01, [0.9, 0.9, 0.85], 0);
      for (let w = 0; w < 3; w++) R.tube(x - s * 0.19 + c * sd * 0.01, y + 0.082 + w * 0.01, z - c * 0.19 - s * sd * 0.01, x - s * 0.25 + c * sd * 0.07, y + 0.085 + w * 0.02, z - c * 0.25 - s * sd * 0.07, 0.0015, 0.0008, [0.85, 0.85, 0.8], 0);
      R.rbox(x - s * 0.17 + c * sd * 0.006, y + 0.066, z - c * 0.17 - s * sd * 0.006, 0.004, 0.012, 0.006, yaw, 0, [0.95, 0.95, 0.9], 0.001); }
    R.sphere(x - s * 0.16 + c * 0.03, y + 0.115, z - c * 0.16 - s * 0.03, 0.01, 0.01, 0.01, [1, 0.15, 0.1], 1);
    R.sphere(x - s * 0.16 - c * 0.03, y + 0.115, z - c * 0.16 + s * 0.03, 0.01, 0.01, 0.01, [1, 0.15, 0.1], 1);
    R.sphere(x - s * 0.1 + c * 0.04, y + 0.14, z - c * 0.1 - s * 0.04, 0.025, 0.025, 0.012, [0.5, 0.4, 0.4], 0);
    R.sphere(x - s * 0.1 - c * 0.04, y + 0.14, z - c * 0.1 + s * 0.04, 0.025, 0.025, 0.012, [0.5, 0.4, 0.4], 0);
    R.tube(x + s * 0.1, y + 0.06, z + c * 0.1, x + s * 0.3 + c * Math.sin(t * 8 + k) * 0.06, y + 0.04, z + c * 0.3, 0.012, 0.004, [0.6, 0.45, 0.45]);
  }
  R.sphere(u.rx, u.ry + 0.02, u.rz, 0.05, 0.01, 0.05, tint, 0.8, 0.0);
}

export function drawBarrier(R, u, t, tint, camYaw) {
  const [x0, x1, z0, z1, y0, y1] = u.bx, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, sx = x1 - x0, sz = z1 - z0, h = y1 - y0, frac = u.h / u.m, long = sx > sz;
  const dmg = 1 - frac, base = [0.4 - dmg * 0.15, 0.42 - dmg * 0.16, 0.45 - dmg * 0.17];
  R.rbox(cx, y0 + h / 2, cz, sx, h, sz, 0, 0, base, 0.05, 0, 1, 0.3);                                                          // slab
  const hz = (a, b, c2, d2, e, f) => R.rbox(a, b, c2, d2, e, f, 0, 0, [0.14, 0.15, 0.17], 0.015, 0, 1, 0.5);
  const n = Math.max(2, Math.round((long ? sx : sz) / 1.6));
  for (let i = 0; i <= n; i++) {                                                                                                 // vertical ribs + bolts
    const p = (long ? x0 : z0) + (i / n) * (long ? sx : sz);
    if (long) { hz(p, y0 + h / 2, cz, 0.12, h + 0.02, sz + 0.12); } else { hz(cx, y0 + h / 2, p, sx + 0.12, h + 0.02, 0.12); }
  }
  for (let i = 0; i < n * 2; i++) {                                                                                              // hazard stripe along the top
    const p = (long ? x0 : z0) + (i + 0.5) / (n * 2) * (long ? sx : sz), seg = (long ? sx : sz) / (n * 2), col = i % 2 ? [0.95, 0.75, 0.1] : [0.07, 0.07, 0.08];
    if (long) R.rbox(p, y1 - 0.12, cz, seg, 0.2, sz + 0.14, 0, 0, col, 0.01, 0.1); else R.rbox(cx, y1 - 0.12, p, sx + 0.14, 0.2, seg, 0, 0, col, 0.01, 0.1);
  }
  { // bolt rows both faces, reflective chevrons, corner caps, warning beacons, cable conduit, mesh vision slits, impact marks
    const L = long ? sx : sz, face = long ? sz / 2 + 0.01 : sx / 2 + 0.01, nb = Math.max(4, Math.round(L / 0.45));
    for (let side = -1; side <= 1; side += 2) for (let r = 0; r < 4; r++) for (let i = 0; i <= nb; i++) {
      const p = (long ? x0 : z0) + (i / nb) * L, yy = y0 + 0.35 + r * (h - 0.8) / 3;
      if (long) R.sphere(p, yy, cz + side * face, 0.022, 0.022, 0.012, [0.55, 0.56, 0.58], 0, 1, 0.9); else R.sphere(cx + side * face, yy, p, 0.012, 0.022, 0.022, [0.55, 0.56, 0.58], 0, 1, 0.9);
    }
    for (let side = -1; side <= 1; side += 2) for (let i = 0; i < Math.floor(L / 0.9); i++) {
      const p = (long ? x0 : z0) + 0.5 + i * 0.9, yy = y0 + h * 0.5;
      if (long) { R.rbox(p, yy, cz + side * face, 0.5, 0.1, 0.012, 0, 0, [0.9, 0.9, 0.85], 0.003, 0.25); R.rbox(p, yy + 0.16, cz + side * face, 0.5, 0.06, 0.012, 0, 0, [0.9, 0.15, 0.1], 0.003, 0.25); }
      else { R.rbox(cx + side * face, yy, p, 0.012, 0.1, 0.5, 0, 0, [0.9, 0.9, 0.85], 0.003, 0.25); R.rbox(cx + side * face, yy + 0.16, p, 0.012, 0.06, 0.5, 0, 0, [0.9, 0.15, 0.1], 0.003, 0.25); }
    }
    const bl = Math.sin(t * 7) > 0;
    for (const e of [0.05, 0.95]) { const p = (long ? x0 : z0) + L * e; if (long) { R.tube(p, y1 + 0.06, cz, p, y1 + 0.2, cz, 0.05, 0.05, [0.15, 0.15, 0.17], 0.4); R.sphere(p, y1 + 0.22, cz, 0.06, 0.05, 0.06, [1, 0.5, 0.1], bl ? 1 : 0.15); } else { R.tube(cx, y1 + 0.06, p, cx, y1 + 0.2, p, 0.05, 0.05, [0.15, 0.15, 0.17], 0.4); R.sphere(cx, y1 + 0.22, p, 0.06, 0.05, 0.06, [1, 0.5, 0.1], bl ? 1 : 0.15); } }
    for (let side = -1; side <= 1; side += 2) { if (long) R.tube(x0 + 0.2, y0 + 0.5, cz + side * (face + 0.02), x1 - 0.2, y0 + 0.5, cz + side * (face + 0.02), 0.025, 0.025, [0.08, 0.08, 0.08], 0.3); else R.tube(cx + side * (face + 0.02), y0 + 0.5, z0 + 0.2, cx + side * (face + 0.02), y0 + 0.5, z1 - 0.2, 0.025, 0.025, [0.08, 0.08, 0.08], 0.3); }
    for (let i = 0; i < Math.floor(L / 3); i++) { const p = (long ? x0 : z0) + 1.5 + i * 3; if (long) { R.rbox(p, y0 + h * 0.7, cz, 0.7, 0.07, sz + 0.04, 0, 0, [0.02, 0.02, 0.03], 0.01); for (let m = 0; m < 6; m++) R.rbox(p - 0.3 + m * 0.12, y0 + h * 0.7, cz, 0.012, 0.07, sz + 0.06, 0, 0, [0.12, 0.12, 0.13], 0.002); } else { R.rbox(cx, y0 + h * 0.7, p, sx + 0.04, 0.07, 0.7, 0, 0, [0.02, 0.02, 0.03], 0.01); for (let m = 0; m < 6; m++) R.rbox(cx, y0 + h * 0.7, p - 0.3 + m * 0.12, sx + 0.06, 0.07, 0.012, 0, 0, [0.12, 0.12, 0.13], 0.002); } }
    if (frac < 0.8) for (let i = 0; i < Math.floor((1 - frac) * 14); i++) { const p = (long ? x0 : z0) + (((i * 0.73 + 0.11) % 1) * L), yy = y0 + 0.4 + ((i * 0.37 + 0.05) % 1) * (h - 0.8), side = i % 2 ? 1 : -1; if (long) { R.sphere(p, yy, cz + side * (face + 0.002), 0.06, 0.06, 0.01, [0.05, 0.05, 0.05], 0); R.sphere(p, yy, cz + side * (face + 0.004), 0.018, 0.018, 0.01, [0.5, 0.5, 0.5], 0, 1, 0.8); } else { R.sphere(cx + side * (face + 0.002), yy, p, 0.01, 0.06, 0.06, [0.05, 0.05, 0.05], 0); R.sphere(cx + side * (face + 0.004), yy, p, 0.01, 0.018, 0.018, [0.5, 0.5, 0.5], 0, 1, 0.8); } }
  }
  if (long) { R.rbox(cx, y1 + 0.04, cz, sx, 0.05, sz + 0.2, 0, 0, tint, 0.01, 0.9); R.rbox(cx, y0 + 0.15, cz, sx, 0.3, sz + 0.2, 0, 0, [0.2, 0.2, 0.22], 0.03); }
  else { R.rbox(cx, y1 + 0.04, cz, sx + 0.2, 0.05, sz, 0, 0, tint, 0.01, 0.9); R.rbox(cx, y0 + 0.15, cz, sx + 0.2, 0.3, sz, 0, 0, [0.2, 0.2, 0.22], 0.03); }
  if (frac < 0.5) for (let i = 0; i < 6; i++) {                                                                                  // scorch + cracks as it breaks
    const p = ((i * 0.37 + 0.13) % 1) * (long ? sx : sz), yy = y0 + ((i * 0.61 + 0.2) % 1) * h;
    if (long) R.rbox(x0 + p, yy, cz, 0.18, 0.05, sz + 0.16, 0, 0, [0.06, 0.05, 0.05], 0.01, frac < 0.25 ? 0.4 : 0); else R.rbox(cx, yy, z0 + p, sx + 0.16, 0.05, 0.18, 0, 0, [0.06, 0.05, 0.05], 0.01, frac < 0.25 ? 0.4 : 0);
  }
  hpBar(R, cx, y1 + 0.45, cz, frac, camYaw, frac > 0.5 ? [0.3, 0.9, 0.4] : frac > 0.25 ? [1, 0.75, 0.2] : [1, 0.25, 0.2]);
}
