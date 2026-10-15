// First-person reload animations, one script per weapon family. Every script maps reload progress (0..1) to:
//   g  : gun pose offset  [dx, dy, dz, pitch, yaw, roll]  (pitch > 0 raises the muzzle)
//   h1 : trigger-hand offset [dx, dy, dz] (weapon space)     h2 : support-hand offset [dx, dy, dz]
//   props : loose items drawn in weapon space (spare magazine, falling magazine, shells, speed loader, rocket, spent cases)
//   cue : names of sound cues to fire as the progress passes them
// Weapon space: +x right, +y up, -z towards the muzzle, origin at the trigger hand.

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const sm = (v) => { v = clamp01(v); return v * v * (3 - 2 * v); };
/** 0 before a, 1 after b, eased in between */
const seg = (p, a, b) => sm((p - a) / (b - a));
const mix = (a, b, k) => a + (b - a) * k;
const mixv = (a, b, k) => [mix(a[0], b[0], k), mix(a[1], b[1], k), mix(a[2], b[2], k)];
/** Piecewise path through points [[t, [x,y,z]], ...] */
function path(p, pts) {
  if (p <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (p <= pts[i][0]) return mixv(pts[i - 1][1], pts[i][1], sm((p - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0])));
  return pts[pts.length - 1][1];
}

// magazine well: centre [y, z] in weapon space, size [w, h, d], tilt
const MAG = {
  pistol: { y: -0.07, z: 0.008, s: [0.026, 0.1, 0.045], pt: -0.28 }, golden: { y: -0.07, z: 0.008, s: [0.026, 0.1, 0.045], pt: -0.28 },
  deagle: { y: -0.075, z: 0.012, s: [0.03, 0.1, 0.05], pt: -0.22 }, smg: { y: -0.08, z: -0.04, s: [0.04, 0.14, 0.045], pt: 0 },
  mp5: { y: -0.12, z: -0.15, s: [0.03, 0.17, 0.05], pt: 0.3 }, rifle: { y: -0.12, z: -0.17, s: [0.034, 0.25, 0.055], pt: 0.45 },
  m4: { y: -0.1, z: -0.11, s: [0.03, 0.14, 0.055], pt: 0.1 }, aug: { y: -0.065, z: -0.06, s: [0.03, 0.1, 0.04], pt: 0 },
  p90: { y: 0.075, z: -0.12, s: [0.034, 0.03, 0.2], pt: 0, top: true }, sniper: { y: -0.065, z: -0.22, s: [0.026, 0.07, 0.04], pt: 0 },
};
const MAGCOL = [0.14, 0.14, 0.16];
const BRASS = [0.9, 0.7, 0.25];
const RED = [0.75, 0.15, 0.1];

const magProp = (id, pos, extra = {}) => { const m = MAG[id]; return { k: 'b', p: pos, s: m.s, rot: [m.pt, 0, 0], c: MAGCOL, r: 0.008, ...extra }; };
/** where a dropped item is after `sec` seconds of free fall from `p0` (weapon space ≈ view space) */
const fall = (p0, sec, vx = 0) => [p0[0] + vx * sec, p0[1] - 0.5 * 9.8 * sec * sec * 0.55, p0[2] + 0.1 * sec];

// per-gun handling: cant (roll of the gun), rock (new magazine is rocked in at an angle, AK style), chg (charging pull length), from (absolute hand spot for charging)
const TW = {
  pistol: { cant: 0.3, chg: 0.07 }, golden: { cant: 0.22, chg: 0.07, flip: 0.5 }, deagle: { cant: 0.55, chg: 0.11 },
  smg: { cant: 0.35, chg: 0.1, from: [0.0, 0.075, -0.1] }, mp5: { cant: 0.4, chg: 0.05, from: [-0.03, 0.05, -0.2] }, p90: { cant: 0.65, chg: 0.07, from: [0.0, 0.1, -0.12] },
  rifle: { cant: 0.45, chg: 0.1, rock: 0.75 }, m4: { cant: 0.58, chg: 0.025, from: [0.02, 0.07, -0.02] }, aug: { cant: 0.3, chg: 0.08, from: [-0.07, 0.07, -0.12] },
};
function magSwap(id, gun, w, p, sec) {
  const tw = TW[id] || {};
  const m = MAG[id], fore = [0, 0, 0], well = [0, m.y - (m.top ? 0.0 : m.s[1] * 0.45), m.z];
  const pouch = [-0.12, -0.26, m.z + 0.12], out = { props: [], cue: [] };
  const pistol = id === 'pistol' || id === 'deagle' || id === 'golden';
  const t = (a, b) => seg(p, a, b);
  const cant = Math.min(t(0, 0.14), 1 - t(0.84, 1));
  out.g = [0.0, -0.01 * cant, 0.02 * cant, 0.1 * cant + (tw.rock ? -0.12 * Math.sin(clamp01((p - 0.62) / 0.16) * Math.PI) : 0), -0.05 * cant, -(tw.cant ?? 0.45) * cant - (tw.flip ? tw.flip * Math.sin(clamp01((p - 0.2) / 0.5) * Math.PI) : 0)];
  if (m.top) { out.g[5] = 0.5 * cant; }
  // support hand: foregrip -> magazine -> pouch -> magazine well -> charging handle -> foregrip
  const base = [0, 0, 0];
  const chargeFrom = tw.from ? [tw.from[0] + 0.02, tw.from[1] + 0.04, tw.from[2] - gun.fore] : pistol ? [0.0, 0.055, gun.grip - 0.04 - gun.fore] : [0.03, 0.08, gun.grip - 0.1 - gun.fore];
  out.h2 = path(p, [[0, base], [0.18, base], [0.3, [0, m.y - 0.0 - 0.0, m.z - gun.fore - 0.0]], [0.4, [0, m.y - 0.02, m.z - gun.fore]], [0.5, [pouch[0], pouch[1], pouch[2] - gun.fore]],
    [0.58, [pouch[0], pouch[1], pouch[2] - gun.fore]], [0.7, [0, m.y - 0.02, m.z - gun.fore]], [0.78, [0, m.y + 0.0, m.z - gun.fore]], [0.84, chargeFrom],
    [0.9, [chargeFrom[0], chargeFrom[1], chargeFrom[2] + (tw.chg ?? 0.09)]], [0.95, [chargeFrom[0], chargeFrom[1], chargeFrom[2]]], [1, base]]);
  out.h1 = [0, 0, 0];
  // seat shove after the new magazine goes in
  const seat = Math.sin(clamp01((p - 0.7) / 0.1) * Math.PI) * 0.02;
  out.g[1] += seat; out.g[3] -= seat * 1.5;
  // pull-and-release on the charging handle / slide
  const ch = Math.sin(clamp01((p - 0.84) / 0.11) * Math.PI);
  out.g[2] += ch * (tw.chg ?? 0.09) * 0.13;
  // old magazine drops from the well after release at 0.3
  if (p > 0.3 && p < 0.9) out.props.push(magProp(id, fall([0, m.y + (m.top ? 0.1 * Math.min(1, (p - 0.3) / 0.08) : 0), m.z], (p - 0.3) * w.reload, 0.2), { rot: [m.pt + (p - 0.3) * 5, (p - 0.3) * 3, 0.4 * (p - 0.3)] }));
  // new magazine rides in the support hand from the pouch to the well
  if (p > 0.48 && p < 0.72) { const k = t(0.5, 0.7); out.props.push(magProp(id, mixv([pouch[0], pouch[1], pouch[2]], [0, m.y, m.z], k), { rot: [m.pt + (tw.rock || 0) * (1 - k) * 1.2, 0, 0] })); }
  out.cue = [[0.3, 'magout'], [0.68, 'magin'], [0.9, 'rack']];
  return out;
}

function revolver(id, gun, w, p, sec) {
  const t = (a, b) => seg(p, a, b), out = { props: [], cue: [[0.18, 'cyl'], [0.36, 'eject'], [0.72, 'loader'], [0.88, 'cylclose']] };
  const open = Math.min(t(0, 0.18), 1 - t(0.8, 0.9));
  const up = Math.min(t(0.24, 0.36), 1 - t(0.44, 0.52));
  out.g = [-0.02 * open, 0.0, 0.03 * open, 0.15 * open + 0.55 * up, 0.0, -0.8 * open];
  const cyl = [-0.03, 0.035, -0.095 - gun.fore];
  out.h2 = path(p, [[0, [0, 0, 0]], [0.2, [-0.02, 0.0, cyl[2] + 0.08]], [0.3, [-0.04, 0.05, cyl[2] + 0.03]], [0.44, [-0.04, 0.05, cyl[2] + 0.03]], [0.54, [-0.1, -0.24, 0.16]], [0.62, [-0.1, -0.24, 0.16]],
    [0.72, [-0.03, 0.0, cyl[2] + 0.02]], [0.82, [-0.04, 0.02, cyl[2] + 0.04]], [0.92, [0, 0, 0]], [1, [0, 0, 0]]]);
  out.h1 = [0, 0, 0];
  if (p > 0.36 && p < 0.7) for (let i = 0; i < 6; i++) { const s = (p - 0.36) * w.reload, an = i / 6 * 6.28; out.props.push({ k: 't', p: fall([Math.cos(an) * 0.02 - 0.02, 0.035 + Math.sin(an) * 0.02, -0.095], s, (i - 2.5) * 0.06), len: 0.026, r: 0.006, rot: [s * 6 + i, 0, s * 4], c: BRASS }); }
  if (p > 0.5 && p < 0.76) {                                                         // speed loader: ring of six rounds
    const k = t(0.52, 0.72), at = mixv([-0.1, -0.24, 0.16], [-0.03, 0.035, -0.095], k);
    out.props.push({ k: 't', p: at, len: 0.05, r: 0.026, rot: [Math.PI / 2, 0, 0], c: [0.25, 0.25, 0.28] });
    for (let i = 0; i < 6; i++) { const an = i / 6 * 6.28; out.props.push({ k: 't', p: [at[0] + Math.cos(an) * 0.017, at[1] + Math.sin(an) * 0.017, at[2] - 0.03], len: 0.03, r: 0.006, rot: [Math.PI / 2, 0, 0], c: BRASS }); }
  }
  return out;
}

function shotgun(id, gun, w, p, sec) {
  const t = (a, b) => seg(p, a, b), out = { props: [], cue: [] };
  const SG = { shotgun: { n: 4, roll: 0.55, pumps: 1 }, mossberg: { n: 5, roll: 0.4, pumps: 2 }, spas: { n: 4, roll: 0.75, pumps: 1 } }[id] || { n: 4, roll: 0.55, pumps: 1 };
  const n = SG.n, tilt = Math.min(t(0, 0.12), 1 - t(0.8, 0.92));
  out.g = [-0.02 * tilt, -0.03 * tilt, 0.03 * tilt, -0.1 * tilt, 0.0, SG.roll * tilt];
  const port = [0.0, -0.04, -0.02 - gun.fore], pouch = [-0.12, -0.24, 0.12 - gun.fore];
  const span = 0.66 / n; let h2 = [0, 0, 0], shell = null;
  if (p < 0.14) h2 = mixv([0, 0, 0], pouch, t(0.02, 0.14));
  else if (p < 0.8) {
    const q = (p - 0.14) / span, i = Math.floor(q), f = q - i;
    // each shell: pick up from the pouch, push into the port, back out
    h2 = f < 0.5 ? mixv(pouch, port, sm(f / 0.5)) : mixv(port, pouch, sm((f - 0.5) / 0.5));
    if (f < 0.5) shell = h2;
    if (f > 0.46 && f < 0.5 && !out.cue.length) out.cue.push([p, 'shell']);
    out.shellNow = f > 0.45 && f < 0.55;
  } else {
    const r = clamp01((p - 0.82) / 0.16);                                              // pump / charge: slide the forend back and forth
    const pm = Math.abs(Math.sin(r * Math.PI * SG.pumps));
    h2 = [0, 0.0, pm * 0.13]; out.g[2] += pm * 0.01;
  }
  out.h2 = h2; out.h1 = [0, 0, 0];
  if (shell) out.props.push({ k: 't', p: [shell[0] + 0.0, shell[1] + 0.02, shell[2] + gun.fore], len: 0.05, r: 0.012, rot: [0.2, 0, Math.PI / 2], c: RED }, { k: 't', p: [shell[0], shell[1] + 0.02, shell[2] + gun.fore + 0.03], len: 0.018, r: 0.0125, rot: [0.2, 0, Math.PI / 2], c: BRASS });
  out.cue = []; for (let i = 0; i < n; i++) out.cue.push([0.14 + span * (i + 0.5) * 1 - span * 0.02, 'shell']); out.cue.push([0.86, 'pump']); if (SG.pumps > 1) out.cue.push([0.92, 'pump']);
  return out;
}

function sniper(id, gun, w, p, sec) {
  const t = (a, b) => seg(p, a, b), out = { props: [], cue: [[0.2, 'boltup'], [0.28, 'boltback'], [0.34, 'magout'], [0.62, 'magin'], [0.76, 'boltfwd'], [0.86, 'bolt']] };
  const cant = Math.min(t(0, 0.1), 1 - t(0.9, 1)), m = MAG.sniper;
  out.g = [-0.02 * cant, -0.02 * cant, 0.02 * cant, 0.12 * cant, 0.0, -0.4 * cant];
  const bolt = [0.07, 0.045, 0.08 - gun.grip];
  out.h1 = path(p, [[0, [0, 0, 0]], [0.1, [0, 0, 0]], [0.18, [bolt[0] - 0.0, bolt[1] + 0.03, bolt[2] + 0.0]], [0.22, [bolt[0], bolt[1] + 0.05, bolt[2]]], [0.3, [bolt[0], bolt[1] + 0.05, bolt[2] + 0.11]],
    [0.74, [bolt[0], bolt[1] + 0.05, bolt[2] + 0.11]], [0.8, [bolt[0], bolt[1] + 0.05, bolt[2]]], [0.86, [bolt[0], bolt[1] + 0.01, bolt[2]]], [0.94, [0, 0, 0]], [1, [0, 0, 0]]]);
  const well = [0, m.y, m.z], pouch = [-0.1, -0.24, m.z + 0.14];
  out.h2 = path(p, [[0, [0, 0, 0]], [0.28, [0, 0, 0]], [0.36, [0, well[1] - 0.02, well[2] - gun.fore]], [0.46, [pouch[0], pouch[1], pouch[2] - gun.fore]], [0.52, [pouch[0], pouch[1], pouch[2] - gun.fore]],
    [0.62, [0, well[1] - 0.02, well[2] - gun.fore]], [0.7, [0, 0, 0]], [1, [0, 0, 0]]]);
  if (p > 0.34 && p < 0.9) out.props.push({ k: 'b', p: fall([0, m.y, m.z], (p - 0.34) * w.reload, 0.15), s: m.s, rot: [(p - 0.34) * 4, 0, 0.3], c: MAGCOL, r: 0.006 });
  if (p > 0.5 && p < 0.64) { const k = t(0.5, 0.62); out.props.push({ k: 'b', p: mixv(pouch, [0, m.y, m.z], k), s: m.s, rot: [0, 0, 0], c: MAGCOL, r: 0.006 }); }
  return out;
}

function launcher(id, gun, w, p, sec) {
  const t = (a, b) => seg(p, a, b), out = { props: [], cue: [[0.4, 'rocketin'], [0.78, 'rocketlock']] };
  const up = Math.min(t(0, 0.22), 1 - t(0.8, 0.98));
  out.g = [0.0, -0.1 * up, 0.08 * up, 0.75 * up, 0.0, 0.0];
  out.h1 = [0, 0, 0];
  out.h2 = path(p, [[0, [0, 0, 0]], [0.2, [0, 0, 0]], [0.32, [0, 0.0, -0.4]], [0.58, [0, 0.0, -0.4]], [0.7, [0.0, 0.0, -0.28]], [0.8, [0, 0, 0]], [1, [0, 0, 0]]]);
  if (p > 0.18 && p < 0.7) {                                                       // fresh rocket slides down the tube from beyond the muzzle
    const k = t(0.3, 0.64), z = mix(gun.muzzle - 0.95, gun.muzzle - 0.15, k);
    out.props.push({ k: 't', p: [0, 0.03, z], len: 0.55, r: 0.026, rot: [Math.PI / 2, 0, 0], c: [0.28, 0.32, 0.22] }, { k: 'e', p: [0, 0.03, z - 0.32], r: [0.039, 0.039, 0.07], c: [0.2, 0.25, 0.18] });
  }
  return out;
}

const SCRIPT = {
  pistol: magSwap, golden: magSwap, deagle: magSwap, smg: magSwap, mp5: magSwap, p90: magSwap, rifle: magSwap, m4: magSwap, aug: magSwap,
  revolver, shotgun, mossberg: shotgun, spas: shotgun, sniper, launcher,
};

/** Pose + props for weapon `id` at reload progress p (0..1). Returns null for weapons without a script. */
export function reloadPose(id, gun, w, p) {
  const f = SCRIPT[id]; if (!f) return null;
  p = clamp01(p);
  const o = f(id, gun, w, p, p * w.reload);
  o.h1 = o.h1 || [0, 0, 0]; o.h2 = o.h2 || [0, 0, 0];
  return o;
}

/** Draw loose reload props (weapon-space positions mapped through P). */
export function drawProps(R, props, P, pitch) {
  for (const q of props) {
    const [x, y, z] = P(q.p[0], q.p[1], q.p[2]);
    if (q.k === 'b') R.rbox(x, y, z, q.s[0], q.s[1], q.s[2], q.rot[1] || 0, pitch + (q.rot[0] || 0), q.c, q.r ?? 0.006, 0, 1, 0.3, q.rot[2] || 0);
    else if (q.k === 'e') R.sphere(x, y, z, q.r[0], q.r[1], q.r[2], q.c, 0, 1, 0.3);
    else { const a = q.rot, c = Math.cos(a[0]), s = Math.sin(a[0]), dy = s * q.len / 2, dz = -c * q.len / 2; const p0 = P(q.p[0], q.p[1] + dy, q.p[2] + dz), p1 = P(q.p[0], q.p[1] - dy, q.p[2] - dz); R.tube(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], q.r, q.r, q.c, 0.5, 0.3); }
  }
}
