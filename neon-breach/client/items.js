// Detailed pickup models: medkit, armour carrier, ammo crate, laser mine, throwing knives, proximity mine.
// Each is built from real parts (cases, latches, straps, webbing, rounds, lenses ...) and then brought to PARTS_PER_GUN parts with the same
// surface micro-detail the guns get, so a floating icon is as detailed as a gun in a player's hand. They draw through drawGun.
import { B, T, E, microDetail, drawGun } from './guns.js';

const WHITE = [0.92, 0.92, 0.9], RED = [0.85, 0.12, 0.1], OLV = [0.27, 0.3, 0.2], OLD = [0.18, 0.2, 0.14], TAN = [0.55, 0.46, 0.32], NYL = [0.2, 0.22, 0.2], BRASS = [0.82, 0.62, 0.25], STEEL = [0.78, 0.8, 0.84], LEAT = [0.3, 0.18, 0.1];
const ITEMS = {};
const make = (id, fn) => { const it = { id: 'item_' + id, parts: [], muzzle: 0 }; fn(it.parts); it.nBase = it.parts.length; it.nDetail = it.parts.length; microDetail(it, id); ITEMS[id] = it; };

make('health', (a) => {
  a.push(B(0, 0, 0, 0.46, 0.3, 0.2, WHITE, 0.04), B(0, 0.0, 0, 0.462, 0.012, 0.202, [0.7, 0.7, 0.68], 0.003), B(0, 0.158, 0, 0.44, 0.02, 0.18, WHITE, 0.02));
  a.push(B(0, 0.04, 0.1004, 0.3, 0.09, 0.006, RED, 0.002), B(0, 0.04, 0.1004, 0.09, 0.28, 0.006, RED, 0.002), B(0, 0.04, -0.1004, 0.3, 0.09, 0.006, RED, 0.002), B(0, 0.04, -0.1004, 0.09, 0.28, 0.006, RED, 0.002));    // red crosses on both faces
  a.push(B(0, 0.2, 0, 0.2, 0.02, 0.05, 'd', 0.01), B(-0.1, 0.18, 0, 0.02, 0.05, 0.05, 'd', 0.005), B(0.1, 0.18, 0, 0.02, 0.05, 0.05, 'd', 0.005), T(-0.09, 0.2, 0, 0.09, 0.2, 0, 0.018, [0.15, 0.15, 0.17]));   // carry handle
  for (const x of [-0.14, 0.14]) a.push(B(x, 0.07, 0.108, 0.07, 0.08, 0.014, 'm', 0.004), B(x, 0.07, 0.116, 0.04, 0.05, 0.006, 'd', 0.002), B(x, 0.115, 0.112, 0.05, 0.012, 0.014, STEEL, 0.003));   // latches
  for (const x of [-0.14, 0.14]) a.push(B(x, 0.07, -0.108, 0.06, 0.07, 0.014, 'd', 0.004), T(x - 0.025, 0.1, -0.116, x + 0.025, 0.1, -0.116, 0.007, 'm'));    // hinges
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) a.push(B(sx * 0.225, sy * 0.15, sz * 0.095, 0.03, 0.03, 0.03, [0.45, 0.45, 0.45], 0.008));   // corner guards
  for (let i = 0; i < 8; i++) a.push(B(-0.19 + i * 0.054, 0.0, 0.1014, 0.004, 0.26, 0.004, [0.8, 0.8, 0.78], 0.001));    // stamped ribs
  a.push(B(-0.13, -0.09, 0.1, 0.12, 0.05, 0.004, [0.2, 0.5, 0.25], 0.002), B(0.13, -0.09, 0.1, 0.12, 0.05, 0.004, 'a', 0.002));
});
make('armor', (a) => {
  a.push(B(0, 0.02, 0.05, 0.44, 0.52, 0.07, NYL, 0.03), B(0, 0.02, 0.09, 0.4, 0.46, 0.03, OLV, 0.02), B(0, 0.12, 0.112, 0.2, 0.2, 0.008, 'a', 0.003), B(0, 0.02, -0.04, 0.4, 0.46, 0.05, [0.12, 0.13, 0.12], 0.02));
  for (const x of [-0.14, 0.14]) { a.push(B(x, 0.32, 0.0, 0.1, 0.05, 0.16, NYL, 0.015), B(x, 0.28, 0.07, 0.09, 0.06, 0.02, [0.3, 0.32, 0.28], 0.01), B(x, 0.28, -0.05, 0.09, 0.06, 0.02, [0.3, 0.32, 0.28], 0.01)); }
  a.push(B(0, -0.17, 0.0, 0.56, 0.1, 0.2, NYL, 0.02));                                                      // cummerbund
  for (let i = 0; i < 3; i++) a.push(B(-0.13 + i * 0.13, -0.16, 0.115, 0.11, 0.15, 0.05, OLD, 0.015), B(-0.13 + i * 0.13, -0.095, 0.14, 0.1, 0.03, 0.02, OLV, 0.008), B(-0.13 + i * 0.13, -0.11, 0.142, 0.03, 0.04, 0.008, 'm', 0.003));    // mag pouches
  for (let r = 0; r < 4; r++) for (let c = 0; c < 10; c++) a.push(B(-0.18 + c * 0.04, -0.01 + r * 0.045 + 0.1, 0.116, 0.032, 0.008, 0.005, [0.1, 0.11, 0.1], 0.001));   // MOLLE webbing
  for (const x of [-0.3, 0.3]) a.push(B(x, -0.17, 0.0, 0.08, 0.08, 0.2, [0.12, 0.13, 0.12], 0.012));
  a.push(B(0, 0.28, 0.112, 0.18, 0.04, 0.008, [0.1, 0.1, 0.11], 0.003), E(0, 0.12, 0.119, 0.045, 0.045, 0.006, 'r'));
});
make('ammo', (a) => {
  a.push(B(0, 0, 0, 0.44, 0.24, 0.26, OLV, 0.025), B(0, 0.13, 0, 0.46, 0.03, 0.28, OLD, 0.02), B(0, 0.0, 0, 0.45, 0.04, 0.27, OLD, 0.01));
  for (let i = 0; i < 5; i++) a.push(B(-0.18 + i * 0.09, 0.0, 0.1325, 0.012, 0.2, 0.006, OLD, 0.002), B(-0.18 + i * 0.09, 0.0, -0.1325, 0.012, 0.2, 0.006, OLD, 0.002));
  a.push(T(-0.1, 0.17, 0, 0.1, 0.17, 0, 0.012, 'd'), B(-0.1, 0.15, 0, 0.012, 0.04, 0.012, 'd', 0.003), B(0.1, 0.15, 0, 0.012, 0.04, 0.012, 'd', 0.003));     // top handle
  for (const x of [-0.17, 0.17]) a.push(B(x, 0.09, 0.14, 0.06, 0.1, 0.014, 'm', 0.004), B(x, 0.11, 0.15, 0.03, 0.04, 0.008, STEEL, 0.002), B(x, 0.09, -0.14, 0.06, 0.08, 0.014, 'd', 0.004));   // latches + hinges
  a.push(B(0, 0.02, 0.1345, 0.2, 0.08, 0.004, 'a', 0.002), B(0, 0.0, 0.1345, 0.14, 0.012, 0.004, [0.9, 0.9, 0.8], 0.001));
  for (let i = 0; i < 6; i++) for (let j = 0; j < 2; j++) { const x = -0.14 + i * 0.055, z = -0.04 + j * 0.08; a.push(T(x, 0.145, z, x, 0.285, z, 0.022, BRASS, 0.022), T(x, 0.285, z, x, 0.33, z, 0.022, [0.75, 0.55, 0.2], 0.009), E(x, 0.335, z, 0.009, 0.014, 0.009, [0.8, 0.45, 0.15]), T(x, 0.145, z, x, 0.15, z, 0.016, 'd')); }  // loose rounds standing on the lid
  for (let i = 0; i < 12; i++) a.push(B(-0.22 + i * 0.04, 0.13, 0.15, 0.03, 0.012, 0.014, BRASS, 0.004));    // belt links
});
make('laser', (a) => {
  a.push(B(0, 0, 0, 0.34, 0.1, 0.17, [0.2, 0.21, 0.24], 0.025), B(0, -0.052, 0, 0.36, 0.014, 0.19, 'd', 0.004), B(0.0, 0.056, 0, 0.3, 0.014, 0.15, [0.28, 0.29, 0.32], 0.006));
  a.push(T(-0.17, 0.0, 0, -0.205, 0.0, 0, 0.038, 'd'), T(-0.205, 0.0, 0, -0.215, 0.0, 0, 0.026, [0.15, 0.4, 0.55], 0.026), E(-0.218, 0.0, 0, 0.007, 0.022, 0.022, 'r'));         // emitter lens
  a.push(T(-0.22, 0.0, 0, -0.55, 0.0, 0, 0.004, 'r'));                                                    // visible beam
  a.push(B(0.1, 0.07, 0, 0.06, 0.012, 0.06, 'd', 0.004), E(0.1, 0.082, 0, 0.012, 0.01, 0.012, 'r'), B(0.0, 0.065, 0.05, 0.1, 0.006, 0.02, [0.6, 0.6, 0.15], 0.002));
  for (const z of [-0.07, 0.07]) for (const x of [-0.12, 0.12]) a.push(T(x, 0.056, z, x, 0.068, z, 0.01, 'm'), B(x, 0.0, z * 1.4, 0.014, 0.014, 0.03, STEEL, 0.003));
  for (const x of [-0.08, 0.08]) a.push(T(x, -0.052, 0, x, -0.16, 0, 0.012, STEEL, 0.002));                // ground stakes
  a.push(T(0.17, 0.0, 0.0, 0.26, 0.04, 0.05, 0.006, [0.7, 0.1, 0.1]), T(0.26, 0.04, 0.05, 0.24, 0.0, 0.1, 0.006, [0.1, 0.1, 0.1]), B(0.0, 0.0, 0.0975, 0.2, 0.03, 0.006, 'a', 0.002));
});
make('knives', (a) => {
  a.push(B(0, -0.02, 0, 0.3, 0.36, 0.03, LEAT, 0.012), B(0, 0.17, 0.0, 0.31, 0.06, 0.034, [0.22, 0.12, 0.07], 0.01));                  // leather roll-up
  for (let i = 0; i < 16; i++) a.push(B(-0.14 + i * 0.0187, -0.02, 0.0175, 0.004, 0.34, 0.003, [0.15, 0.08, 0.04], 0.001));          // stitching
  for (let k = -1; k <= 1; k++) {
    const x = k * 0.1, rl = -k * 0.18;
    a.push(B(x, 0.28, 0.0, 0.04, 0.17, 0.008, STEEL, 0.001, 0, rl), B(x, 0.34, 0.0, 0.02, 0.08, 0.006, [0.86, 0.88, 0.92], 0.0006, 0, rl), B(x - k * 0.002, 0.2, 0, 0.02, 0.012, 0.016, 'm', 0.002, 0, rl), B(x, 0.22, 0.0, 0.07, 0.014, 0.018, 'd', 0.003, 0, rl));  // blade, edge bevel, guard
    for (let i = 0; i < 5; i++) a.push(B(x + k * 0.01 * 0, 0.14 - i * 0.02 + 0.0, 0.0, 0.034, 0.012, 0.024, [0.1, 0.1, 0.11], 0.004, 0, rl));    // wrapped grip
    a.push(B(x, 0.03, 0.0, 0.04, 0.03, 0.03, 'm', 0.006, 0, rl), E(x, 0.02, 0.0, 0.014, 0.014, 0.012, 'a'));     // pommel
  }
  a.push(B(0.0, -0.1, 0.0, 0.34, 0.016, 0.04, [0.12, 0.12, 0.14], 0.006), B(-0.13, -0.1, 0.0, 0.03, 0.04, 0.04, 'm', 0.006), B(0.13, -0.1, 0.0, 0.03, 0.04, 0.04, 'm', 0.006));
});
make('mines', (a) => {
  a.push(T(0, -0.04, 0, 0, 0.04, 0, 0.2, [0.2, 0.21, 0.24], 0.18), T(0, 0.04, 0, 0, 0.06, 0, 0.18, 'd', 0.17), T(0, -0.05, 0, 0, -0.04, 0, 0.21, 'm'), E(0, 0.062, 0, 0.12, 0.03, 0.12, [0.26, 0.27, 0.3]));
  for (let i = 0; i < 12; i++) { const an = i / 12 * 6.283; a.push(B(Math.cos(an) * 0.195, 0.0, Math.sin(an) * 0.195, 0.02, 0.026, 0.02, 'm', 0.004, 0, 0), B(Math.cos(an) * 0.18, 0.062, Math.sin(an) * 0.18, 0.018, 0.01, 0.018, 'd', 0.003)); }    // rim bolts + pressure ring studs
  for (let i = 0; i < 3; i++) { const an = i / 3 * 6.283 + 0.5; a.push(T(Math.cos(an) * 0.19, -0.045, Math.sin(an) * 0.19, Math.cos(an) * 0.2, -0.15, Math.sin(an) * 0.2, 0.012, STEEL, 0.002)); }   // ground spikes
  a.push(E(0.0, 0.085, 0.0, 0.03, 0.02, 0.03, 'r'), B(0.12, 0.062, 0.0, 0.06, 0.012, 0.04, 'a', 0.003), B(-0.12, 0.062, 0.0, 0.05, 0.01, 0.03, [0.7, 0.65, 0.1], 0.002));
  for (let i = 0; i < 24; i++) { const an = i / 24 * 6.283; a.push(B(Math.cos(an) * 0.14, 0.066, Math.sin(an) * 0.14, 0.012, 0.006, 0.022, [0.1, 0.1, 0.12], 0.002, 0, 0)); }   // tread
});

export const ITEM_KINDS = Object.keys(ITEMS);
export const itemModel = (kind) => ITEMS[kind];

/** Draw a spinning pickup icon. d = distance from the camera (for level of detail). */
export function drawItem(R, kind, gunDefs, x, y, z, spin, accent, d) {
  const lod = d < 10 ? {} : d < 24 ? { mid: true } : { far: true };
  const g = gunDefs[kind];
  if (g) {                                                                                     // weapon pickup = the real gun model, spun about its centre
    const s = 0.78, mid = (g.muzzle + 0.25) / 2 * s, rot = R.rotate(spin - Math.PI / 2, 0.05);
    const ox = x - (rot[6] * mid), oy = y - (rot[7] * mid) - 0.02, oz = z - (rot[8] * mid);
    drawGun(R, g, { origin: [ox, oy, oz], yaw: spin - Math.PI / 2, pitch: 0.05, accent, gold: !!g.gold, scale: s, ...lod });
    return true;
  }
  const it = ITEMS[kind]; if (!it) return false;
  drawItem.k = 1;
  drawGun(R, it, { origin: [x, y, z], yaw: spin, pitch: 0, accent, scale: 1.1, ...lod });
  return true;
}
