// Arena definitions. Every map is built from axis-aligned boxes (stairs are stepped boxes),
// so the same data drives rendering, player physics, bullets and bot navigation.
// Team 0 (CIPHER) defends z=+22, team 1 (EMBER) defends z=-22. Maps are 56x56 (x,z in [-28,28]).

import { floorAt } from './physics.js';
import { buildNav } from './nav.js';

const W = 28;

class MB {
  constructor() { this.boxes = []; this.decor = []; }
  /** centre x,z; size w,d; from y0 to y1. vis=false keeps the collision box but hides it (a decor object replaces it visually). */
  b(x, z, w, d, y0, y1, mat = 'wall', vis = true) {
    const box = { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, y0, y1, mat };
    if (vis === false) box.vis = false;
    this.boxes.push(box);
    return this;
  }
  /** visual-only scenery (no collision). See client/mapmesh.js for the kinds. */
  deco(d) { this.decor.push(d); return this; }
  /** round column: square collision box, cylindrical visual with base and capital */
  col(x, z, r, y0, y1, mat = 'stone') {
    this.b(x, z, 2 * r, 2 * r, y0, y1, mat, false);
    this.deco({ k: 'cyl', x, z, y: y0, r: r * 0.92, h: y1 - y0, mat, uv: 1.5 });
    this.deco({ k: 'cyl', x, z, y: y0, r, h: 0.3, mat });
    this.deco({ k: 'cyl', x, z, y: y1 - 0.25, r, h: 0.25, mat });
    return this;
  }
  barrel(x, z, mat = 'red', y = 0) {
    this.b(x, z, 0.68, 0.68, y, y + 0.95, 'crate', false);
    return this.deco({ k: 'barrel', x, z, y, mat });
  }
  pump(x, z) {
    this.b(x, z, 0.8, 1.6, 0, 1.5, 'red', false);
    this.deco({ k: 'rbox', x0: x - 0.4, x1: x + 0.4, y0: 0, y1: 1.5, z0: z - 0.8, z1: z + 0.8, mat: 'plain', tint: [0.7, 0.14, 0.12], r: 0.14 });
    return this.deco({ k: 'rbox', x0: x - 0.43, x1: x + 0.43, y0: 0.95, y1: 1.3, z0: z - 0.55, z1: z + 0.55, mat: 'plain', tint: [0.08, 0.1, 0.12], r: 0.05 });
  }
  /** stepped stairs starting at (x,z) (lowest edge) heading (dx,dz); width across, len along, rising `rise` in n steps */
  stairs(x, z, dx, dz, width, len, rise, n, mat = 'metal') {
    const run = len / n;
    for (let i = 0; i < n; i++) {
      const along = (i + 0.5) * run;
      this.b(x + dx * along, z + dz * along, dx !== 0 ? run : width, dz !== 0 ? run : width, 0, rise * (i + 1) / n, mat);
    }
    return this;
  }
  /** wall running along x (xa..xb) at z. gaps: [a, b, sill=0, top=h] in world x. */
  wx(xa, xb, z, t, h, mat, gaps = []) {
    return this._wall(xa, xb, h, gaps, (a, c, y0, y1) => this.b((a + c) / 2, z, c - a, t, y0, y1, mat));
  }
  /** wall running along z (za..zb) at x. gaps in world z. */
  wz(x, za, zb, t, h, mat, gaps = []) {
    return this._wall(za, zb, h, gaps, (a, c, y0, y1) => this.b(x, (a + c) / 2, t, c - a, y0, y1, mat));
  }
  _wall(a0, a1, h, gaps, put) {
    let cur = a0;
    for (const [a, c, sill = 0, top = h] of [...gaps].sort((p, q) => p[0] - q[0])) {
      if (a > cur) put(cur, a, 0, h);
      if (sill > 0) put(a, c, 0, sill);
      if (top < h) put(a, c, top, h);
      cur = c;
    }
    if (cur < a1) put(cur, a1, 0, h);
    return this;
  }
  car(x, z, alongZ = true, mat = 'rust') {
    const w = alongZ ? 1.9 : 4.2, d = alongZ ? 4.2 : 1.9;
    this.b(x, z, w, d, 0.15, 1.05, mat, false);
    this.b(x, z, alongZ ? 1.7 : 2.2, alongZ ? 2.2 : 1.7, 1.05, 1.65, 'dark', false);
    return this.deco({ k: 'car', x, z, alongZ, paint: mat });
  }
  tree(x, z, h = 5, type = 'oak') {
    this.b(x, z, 0.7, 0.7, 0, h, 'wood', false);
    this.b(x, z, 4, 4, h - 0.8, h + 1.2, 'leaf', false);
    return this.deco({ k: 'tree', x, z, h, type });
  }
  shell(floorMat, wallMat = 'wall', wallH = 9) {
    this.b(0, 0, 2 * W + 2, 2 * W + 2, -1, 0, floorMat);
    this.b(0, -(W + 0.5), 2 * W + 2, 1, 0, wallH, wallMat);
    this.b(0, W + 0.5, 2 * W + 2, 1, 0, wallH, wallMat);
    this.b(-(W + 0.5), 0, 1, 2 * W, 0, wallH, wallMat);
    this.b(W + 0.5, 0, 1, 2 * W, 0, wallH, wallMat);
    return this;
  }
}

// ---------------------------------------------------------------- FOUNDRY
function foundry() {
  const mb = new MB().shell('floor', 'wall');
  const pickups = [], ffa = [];
  const both = (x, z, kind, y) => { pickups.push({ x, z, kind, y }); pickups.push({ x, z: -z, kind, y }); };
  for (const s of [1, -1]) {
    mb.b(0, 22 * s, 12, 7, 0, 0.4, 'accent');                       // base pad
    mb.b(0, 26.6 * s, 18, 0.8, 0, 4.5, 'metal');                    // back wall
    mb.b(-9.5, 24 * s, 0.8, 6, 0, 3, 'wall'); mb.b(9.5, 24 * s, 0.8, 6, 0, 3, 'wall');
    mb.b(-5, 16 * s, 3, 2, 0, 1.4, 'crate'); mb.b(5, 16 * s, 3, 2, 0, 1.4, 'crate'); mb.b(0, 17 * s, 2, 2, 0, 1.0, 'crate');
    mb.b(-15, 11 * s, 1, 10, 0, 4, 'wall'); mb.b(15, 11 * s, 1, 10, 0, 4, 'wall');   // lane walls
    mb.b(-22, 19 * s, 4, 3, 0, 1.8, 'metal'); mb.b(22, 19 * s, 4, 3, 0, 1.8, 'metal');
    mb.b(-22, 9 * s, 3, 5, 0, 2.2, 'crate'); mb.b(22, 9 * s, 3, 5, 0, 2.2, 'crate');
    mb.b(-11, 8 * s, 4, 2, 0, 1.2, 'crate'); mb.b(11, 8 * s, 4, 2, 0, 1.2, 'crate');
    mb.stairs(0, 13.4 * s, 0, -s, 4, 7.4, 3, 8, 'metal');           // up to the catwalk
    for (const sx of [1, -1]) mb.b(sx * 5.6, s * 5.85, 6.8, 0.3, 3, 4.1, 'accent'); // catwalk rails (z edges)
    ffa.push([-20, 22], [20, 22], [-24, 12], [24, 12], [-8, 14], [8, 14]);
  }
  mb.b(0, 0, 18, 12, 2.5, 3, 'metal');                              // central catwalk
  for (const [y, r] of [[3.3, 0.18], [4.1, 0.12]]) {                // pipes run along every wall
    mb.deco({ k: 'pipe', x0: -27.4, y0: y, z0: 27.5, x1: 27.4, y1: y, z1: 27.5, r, mat: 'rust' });
    mb.deco({ k: 'pipe', x0: -27.4, y0: y, z0: -27.5, x1: 27.4, y1: y, z1: -27.5, r, mat: 'rust' });
    mb.deco({ k: 'pipe', x0: 27.5, y0: y, z0: -27.4, x1: 27.5, y1: y, z1: 27.4, r, mat: 'rust' });
    mb.deco({ k: 'pipe', x0: -27.5, y0: y, z0: -27.4, x1: -27.5, y1: y, z1: 27.4, r, mat: 'rust' });
  }
  for (const s of [1, -1]) { mb.barrel(-18.2, 13.4 * s, 'red'); mb.barrel(-18.9, 12.6 * s, 'olive'); mb.barrel(12.3, 25.8 * s, 'blue'); mb.barrel(13.1, 25.2 * s, 'red'); }
  for (const sx of [1, -1]) {
    mb.b(sx * 8.85, 0, 0.3, 12, 3, 4.1, 'accent');
    for (const sz of [1, -1]) mb.b(sx * 8, sz * 5, 1, 1, 0, 2.5, 'metal');
    mb.b(sx * 12.5, 0, 3, 3, 0, 1.5, 'crate');
  }
  ffa.push([-18, 0], [18, 0]);
  [[-20, 15, 'rifle'], [20, 15, 'shotgun'], [-12, 4, 'ammo'], [12, 4, 'health'], [0, 24.5, 'armor'], [-25, 5, 'mines'], [25, 5, 'smg']]
    .forEach(([x, z, k]) => both(x, z, k));
  pickups.push({ x: 0, z: 0, kind: 'sniper', y: 3 }, { x: -19, z: 0, kind: 'health' }, { x: 19, z: 0, kind: 'armor' });
  return { id: 'foundry', decor: mb.decor, name: 'Foundry', desc: 'Steel works with a central catwalk and tight flank lanes.',
    theme: { sky: [0.10, 0.12, 0.16], fog: [0.10, 0.12, 0.16], fogNear: 25, fogFar: 90, sun: [0.5, 0.8, 0.3], light: 1.0 },
    boxes: mb.boxes, ffa, pickups, golden: { x: 0, z: 0, y: 3 }, hill: { x: 0, z: 0, r: 5, y: 3 },
    base: { x: 0, z: 22 }, spawnX: [-6, -3, 0, 3, 6] };
}

// ---------------------------------------------------------------- ATRIUM
function atrium() {
  const mb = new MB().shell('marble', 'stone');
  const pickups = [], ffa = [];
  const both = (x, z, kind, y) => { pickups.push({ x, z, kind, y }); pickups.push({ x, z: -z, kind, y }); };
  for (const sx of [1, -1]) {
    mb.b(sx * 23, 0, 6, 40, 3.6, 4, 'marble');                      // balcony
    for (const z of [-18, -6, 6, 18]) mb.col(sx * 20.5, z, 0.5, 0, 3.6, 'marble');
    mb.b(sx * 20.15, 0, 0.3, 32, 4, 5.1, 'accent');
    mb.b(sx * 24.5, 8, 2, 2, 4, 5.2, 'crate'); mb.b(sx * 24.5, -8, 2, 2, 4, 5.2, 'crate');
    mb.b(sx * 24, 0, 2, 3, 0, 1.2, 'crate');
    for (const s of [1, -1]) mb.stairs(sx * 12.8, 18 * s, sx, 0, 4, 7.2, 4, 9, 'marble');
  }
  for (const s of [1, -1]) {
    mb.b(0, 22 * s, 14, 6, 0, 0.4, 'accent');
    mb.b(0, 26.6 * s, 20, 0.8, 0, 6, 'stone');
    mb.b(-7.5, 24.5 * s, 0.8, 5, 0, 3.2, 'stone'); mb.b(7.5, 24.5 * s, 0.8, 5, 0, 3.2, 'stone');
    for (const sx of [1, -1]) {
      mb.col(sx * 9, 10 * s, 0.8, 0, 8, 'marble');
      mb.b(sx * 6, 14 * s, 6, 0.8, 0, 1.2, 'marble');
    }
    ffa.push([-16, 22], [16, 22], [-10, 8], [10, 8]);
  }
  mb.b(0, 0, 8, 8, 0, 0.5, 'marble'); mb.b(0, 0, 2, 2, 0.5, 2.4, 'stone');
  [[-14, 14, 'rifle'], [14, 14, 'shotgun'], [-12, 5, 'health'], [12, 5, 'armor'], [0, 25, 'ammo'], [-4, 11, 'mines']]
    .forEach(([x, z, k]) => both(x, z, k));
  pickups.push({ x: 23, z: 0, kind: 'sniper', y: 4 }, { x: -23, z: 0, kind: 'smg', y: 4 }, { x: 4, z: 3, kind: 'armor', y: 0.5 },
    { x: -22, z: 0, kind: 'health' }, { x: 22, z: -12, kind: 'ammo', y: 4 });
  return { id: 'atrium', decor: mb.decor, name: 'Atrium', desc: 'Marble hall ringed by two balconies. Fight high, fight low.',
    theme: { sky: [0.62, 0.70, 0.80], fog: [0.62, 0.70, 0.80], fogNear: 35, fogFar: 110, sun: [0.3, 0.9, 0.2], light: 1.15 },
    boxes: mb.boxes, ffa, pickups, golden: { x: 0, z: -3, y: 0.5 }, hill: { x: 0, z: 0, r: 5, y: 0.5 },
    base: { x: 0, z: 22 }, spawnX: [-6, -3, 0, 3, 6] };
}

// ---------------------------------------------------------------- COURTYARD
function courtyard() {
  const mb = new MB().shell('grass', 'stone', 7);
  const pickups = [], ffa = [];
  const both = (x, z, kind, y) => { pickups.push({ x, z, kind, y }); pickups.push({ x, z: -z, kind, y }); };
  for (const s of [1, -1]) {
    mb.b(0, 22 * s, 10, 6, 0, 0.3, 'stone');                        // chapel floor
    mb.b(-7, 24 * s, 0.8, 8, 0, 3.5, 'stone'); mb.b(7, 24 * s, 0.8, 8, 0, 3.5, 'stone');
    mb.b(0, 26.6 * s, 14.8, 0.8, 0, 3.5, 'stone');
    mb.b(-4.5, 18 * s, 4, 0.8, 0, 2.5, 'stone'); mb.b(4.5, 18 * s, 4, 0.8, 0, 2.5, 'stone');
    for (const sx of [1, -1]) {
      // watch towers
      mb.b(sx * 22, 13.8 * s, 6, 6, 4.5, 5, 'stone');
      for (const a of [-2.5, 2.5]) for (const c of [-2.5, 2.5]) mb.col(sx * 22 + a, 13.8 * s + c, 0.5, 0, 4.5, 'stone');
      mb.stairs(sx * 22, 1.8 * s, 0, s, 3, 9, 5, 11, 'stone');
      mb.b(sx * 22, 16.3 * s, 3, 0.5, 5, 6.1, 'stone');
      mb.b(sx * 11, 10 * s, 0.8, 8, 0, 2.2, 'stone');
      mb.b(sx * 12, 16 * s, 8, 1.2, 0, 1.6, 'hedge');
      mb.b(sx * 17, 4 * s, 1.2, 6, 0, 1.6, 'hedge');
    }
    ffa.push([-14, 20], [14, 20], [-8, 12], [8, 12]);
  }
  mb.b(0, 0, 11, 11, 0, 0.45, 'stone'); mb.b(0, 0, 9, 9, 0.45, 0.9, 'stone'); mb.b(0, 0, 3, 3, 0.9, 2.2, 'stone', false);
  mb.deco({ k: 'cyl', x: 0, z: 0, y: 0.9, r: 1.3, h: 1.1, mat: 'marble' }).deco({ k: 'cyl', x: 0, z: 0, y: 1.9, r: 1.45, h: 0.3, mat: 'marble' }).deco({ k: 'sphere', x: 0, y: 2.55, z: 0, r: 0.7, mat: 'marble' });
  mb.b(-10, 0, 1.2, 7, 0, 1.6, 'hedge'); mb.b(10, 0, 1.2, 7, 0, 1.6, 'hedge');
  [[-14, 12, 'shotgun'], [14, 12, 'smg'], [-8, 5, 'health'], [8, 5, 'armor'], [0, 25, 'ammo'], [-24, 20, 'mines']]
    .forEach(([x, z, k]) => both(x, z, k));
  for (const sx of [1, -1]) for (const s of [1, -1]) pickups.push({ x: sx * 22, z: 13.8 * s, kind: 'rifle', y: 5 });
  pickups.push({ x: 3.5, z: 3.5, kind: 'sniper', y: 0.9 }, { x: -3.5, z: -3.5, kind: 'health', y: 0.9 });
  return { id: 'courtyard', decor: mb.decor, name: 'Courtyard', desc: 'Overgrown ruins with four watch towers and a central fountain.',
    theme: { sky: [0.45, 0.66, 0.88], fog: [0.62, 0.78, 0.92], fogNear: 40, fogFar: 130, sun: [0.4, 0.85, 0.35], light: 1.25 },
    boxes: mb.boxes, ffa, pickups, golden: { x: 0, z: -4.5, y: 0.9 }, hill: { x: 0, z: 0, r: 5.5, y: 0.9 },
    base: { x: 0, z: 22 }, spawnX: [-3, -1, 1, 3] };
}

// ---------------------------------------------------------------- REACTOR
function reactor() {
  const mb = new MB().shell('dark', 'metal', 7);
  const pickups = [], ffa = [];
  const both = (x, z, kind, y) => { pickups.push({ x, z, kind, y }); pickups.push({ x, z: -z, kind, y }); };
  mb.b(0, 0, 10, 10, 0, 5, 'metal', false); mb.b(0, 0, 6, 6, 5, 7, 'glow', false);   // reactor core
  mb.deco({ k: 'cyl', x: 0, z: 0, y: 0, r: 4.95, h: 5, mat: 'metal', uv: 4 }).deco({ k: 'cyl', x: 0, z: 0, y: 1.2, r: 5.12, h: 0.35, mat: 'dark' }).deco({ k: 'cyl', x: 0, z: 0, y: 3.6, r: 5.12, h: 0.35, mat: 'dark' })
    .deco({ k: 'cyl', x: 0, z: 0, y: 5, r: 2.95, h: 2, mat: 'glow' }).deco({ k: 'cyl', x: 0, z: 0, y: 4.85, r: 3.4, h: 0.3, mat: 'dark' });
  for (const a of [0.4, 1.97, 3.54, 5.11]) mb.deco({ k: 'pipe', x0: Math.cos(a) * 5, y0: 2.5, z0: Math.sin(a) * 5, x1: Math.cos(a) * 7.8, y1: 0.5, z1: Math.sin(a) * 7.8, r: 0.22, mat: 'rust' });
  for (const s of [1, -1]) {
    mb.b(-6, 10 * s, 8, 1, 0, 4, 'wall'); mb.b(6, 10 * s, 8, 1, 0, 4, 'wall');       // ring walls (door at x=0)
    mb.b(-6, 19 * s, 8, 1, 0, 4, 'wall'); mb.b(6, 19 * s, 8, 1, 0, 4, 'wall');       // base room walls
    mb.b(-10, 23.5 * s, 1, 9, 0, 4, 'wall'); mb.b(10, 23.5 * s, 1, 9, 0, 4, 'wall');
    mb.b(0, 24 * s, 6, 4, 0, 0.4, 'accent');
    mb.b(-6, 14 * s, 3, 3, 0, 1.5, 'crate'); mb.b(6, 14 * s, 3, 3, 0, 1.5, 'crate'); mb.b(0, 14.5 * s, 2, 2, 0, 1, 'crate');
    for (const sx of [1, -1]) {
      mb.b(sx * 17, 14 * s, 1, 10, 0, 4, 'wall');
      mb.b(sx * 22, 6 * s, 3, 2, 0, 1.4, 'crate');
      mb.b(sx * 22, 20 * s, 3, 3, 0, 2, 'metal');
      mb.b(sx * 13, 23 * s, 3, 3, 0, 1.4, 'crate');
    }
    ffa.push([-14, 20], [14, 20], [-24, 12], [24, 12]);
  }
  for (const sx of [1, -1]) {
    mb.b(sx * 10, -6, 1, 8, 0, 4, 'wall'); mb.b(sx * 10, 6, 1, 8, 0, 4, 'wall');     // ring side walls (door at z=0)
    mb.b(sx * 17, 0, 1, 14, 0, 4, 'wall');
    mb.b(sx * 22, 0, 3, 3, 0, 1.4, 'crate');
  }
  [[-14, 15, 'rifle'], [14, 15, 'smg'], [-22, 10, 'health'], [22, 10, 'armor'], [0, 24, 'ammo'], [-24, 22, 'mines']]
    .forEach(([x, z, k]) => both(x, z, k));
  pickups.push({ x: 7.5, z: 0, kind: 'shotgun' }, { x: -7.5, z: 0, kind: 'sniper' }, { x: 23, z: 4, kind: 'health' }, { x: -23, z: -4, kind: 'armor' });
  return { id: 'reactor', decor: mb.decor, name: 'Reactor', desc: 'Close-quarters corridors around a humming reactor core.',
    theme: { sky: [0.05, 0.07, 0.09], fog: [0.05, 0.07, 0.09], fogNear: 18, fogFar: 70, sun: [0.2, 0.9, 0.4], light: 0.8 },
    boxes: mb.boxes, ffa, pickups, golden: { x: 7.5, z: 4, y: 0 }, hill: { x: 7.5, z: 0, r: 3.2, y: 0 },
    base: { x: 0, z: 22 }, spawnX: [-3, -1, 1, 3] };
}


// ---------------------------------------------------------------- CROSSWIRE  (war-torn street, shops with windows, a central plaza)
function crosswire() {
  const mb = new MB().shell('asphalt', 'brick', 8);
  const pickups = [], ffa = [];
  const both = (x, z, kind, y) => { pickups.push({ x, z, kind, y }); pickups.push({ x, z: -z, kind, y }); };
  mb.b(0, 0, 9, 9, 0, 0.45, 'concrete'); mb.b(0, 0, 2.4, 2.4, 0.45, 1.7, 'stone');   // central plaza + monument
  mb.b(0, 5.2, 7, 0.7, 0, 1.0, 'concrete'); mb.b(0, -5.2, 7, 0.7, 0, 1.0, 'concrete'); // jersey barriers
  for (const s of [1, -1]) {
    const Z = (a, c, sill, top) => (s > 0 ? [a, c, sill, top] : [-c, -a, sill, top]);
    mb.b(0, 22 * s, 12, 6, 0, 0.2, 'accent');
    mb.b(0, 26.6 * s, 18, 0.8, 0, 3.5, 'concrete');
    mb.b(-9.5, 24.5 * s, 0.8, 5, 0, 2.4, 'concrete'); mb.b(9.5, 24.5 * s, 0.8, 5, 0, 2.4, 'concrete');
    mb.b(-4, 18 * s, 5, 1, 0, 1.0, 'sand'); mb.b(4, 18 * s, 5, 1, 0, 1.0, 'sand');
    mb.car(-5, 11 * s, true, 'rust'); mb.car(5.5, 15.5 * s, true, 'blue'); mb.car(-6.5, 5.5 * s, false, 'olive');
    mb.b(3, 9 * s, 4, 1, 0, 1.1, 'sand'); mb.b(-3, 15.5 * s, 3, 0.8, 0, 1.0, 'concrete');
    for (const sx of [1, -1]) {
      const X = (a, c, sill, top) => (sx > 0 ? [a, c, sill, top] : [-c, -a, sill, top]);
      const lo = Math.min(sx * 10, sx * 24), hi = Math.max(sx * 10, sx * 24);
      // shop: street wall (door + 2 windows), alley wall (door), cross-street wall (door + window), base-side wall (door + 2 windows)
      mb.wz(sx * 10, 7 * s > 0 ? 7 : -19, s > 0 ? 19 : -7, 0.5, 4, 'brick', [Z(11.8, 14.2, 0, 3.1), Z(8, 9.6, 1.0, 2.4), Z(16.4, 18, 1.0, 2.4)]);
      mb.wz(sx * 24, s > 0 ? 7 : -19, s > 0 ? 19 : -7, 0.5, 4, 'brick', [Z(9, 11.2, 0, 3.1)]);
      mb.wx(lo, hi, 7 * s, 0.5, 4, 'brick', [X(15.8, 18.2, 0, 3.1), X(11, 12.6, 1.0, 2.4)]);
      mb.wx(lo, hi, 19 * s, 0.5, 4, 'brick', [X(13, 15, 1.0, 2.4), X(19, 21, 1.0, 2.4), X(16, 18, 0, 3.1)]);
      mb.b(sx * 16, 10 * s, 4, 0.8, 0, 1.0, 'wood'); mb.b(sx * 13, 16 * s, 2, 2, 0, 0.9, 'crate');
      mb.b(sx * 22, 16.2 * s, 4, 5.2, 2.5, 2.8, 'wood');                        // loft
      mb.stairs(sx * 22, 7.6 * s, 0, s, 3, 6, 2.8, 7, 'wood');
      mb.b(sx * 18, 23.5 * s, 9, 2.6, 0, 2.6, 'rust', false);                    // burnt-out bus
      mb.deco({ k: 'rbox', x0: sx * 18 - 4.5, x1: sx * 18 + 4.5, y0: 0.35, y1: 2.6, z0: 23.5 * s - 1.3, z1: 23.5 * s + 1.3, mat: 'rust', r: 0.4, uv: 0.4 });
      mb.deco({ k: 'rbox', x0: sx * 18 - 4.1, x1: sx * 18 + 4.1, y0: 1.4, y1: 2.2, z0: 23.5 * s - 1.33, z1: 23.5 * s + 1.33, mat: 'plain', tint: [0.1, 0.13, 0.17], r: 0.12 });
      for (const wx of [-3, 3]) for (const wz of [-1.25, 1.25]) mb.deco({ k: 'cyl', x: sx * 18 + wx, y: 0.05, z: 23.5 * s + wz, r: 0.45, h: 0.3, mat: 'plain', tint: [0.05, 0.05, 0.06] });
      mb.deco({ k: 'lamp', x: sx * 9.2, z: 20.5 * s, h: 5 }); mb.deco({ k: 'lamp', x: sx * 9.2, z: 5 * s, h: 5 });
      mb.barrel(sx * 25.4, 9.5 * s, 'olive'); mb.barrel(sx * 26.3, 10.2 * s, 'red');
      mb.b(sx * 26.9, 15 * s, 1.4, 2.2, 0, 1.3, 'olive');                        // alley dumpster
      mb.b(sx * 14, 3.5 * s, 2, 2, 0, 1.0, 'crate'); mb.b(sx * 24.5, 3 * s, 1, 4, 0, 1.2, 'concrete');
      mb.b(sx * 18, 0, 6, 2.4, 0, 2.6, sx > 0 ? 'blue' : 'red');                 // container in the yard
    }
    ffa.push([-6, 20], [6, 20], [-21, 5 * s + 0.5], [21, 5 * s - 0.5], [-8, 9 * s], [8, 12 * s]);
  }
  both(-14, 11, 'smg'); both(14, 11, 'shotgun'); both(3, 13, 'rifle'); both(-22, 16.2, 'armor'); both(22, 16.2, 'sniper');
  both(0, 24.5, 'ammo'); both(8, 8, 'health'); both(-8, 8, 'mines'); both(26, 12, 'mines'); both(-26, 12, 'health');
  pickups.push({ x: 3.4, z: 3.4, kind: 'armor' }, { x: -3.4, z: -3.4, kind: 'health' });
  return { id: 'crosswire', decor: mb.decor, name: 'Crosswire', desc: 'Ruined city street: shops with windows, side alleys and a contested central plaza.',
    theme: { sky: [0.58, 0.55, 0.50], fog: [0.62, 0.58, 0.52], fogNear: 30, fogFar: 100, sun: [0.35, 0.8, 0.45], light: 1.1 },
    boxes: mb.boxes, ffa, pickups, golden: { x: 0, z: 3.2, y: 0.45 }, hill: { x: 0, z: 0, r: 4.2, y: 0.45 },
    base: { x: 0, z: 22 }, spawnX: [-6, -3, 0, 3, 6] };
}

// ---------------------------------------------------------------- WILDWOOD  (overgrown farmland: hedgerows, barns with lofts, a ruined hill)
function wildwood() {
  const mb = new MB().shell('grass', 'hedge', 6);
  const pickups = [], ffa = [];
  const both = (x, z, kind, y) => { pickups.push({ x, z, kind, y }); pickups.push({ x, z: -z, kind, y }); };
  mb.b(0, 0, 14, 14, 0, 0.5, 'dirt'); mb.b(0, 0, 10, 10, 0.5, 1.0, 'dirt'); mb.b(0, 0, 6, 6, 1.0, 1.5, 'dirt');
  mb.b(0, 0, 1.6, 1.6, 1.5, 2.7, 'stone');                                       // old well / chimney
  for (const s of [1, -1]) {
    const Z = (a, c, sill, top) => (s > 0 ? [a, c, sill, top] : [-c, -a, sill, top]);
    mb.b(0, 22 * s, 12, 6, 0, 0.15, 'dirt');
    mb.b(0, 26.6 * s, 18, 0.8, 0, 3.4, 'brick');
    for (const sx of [1, -1]) mb.wz(sx * 9.5, s > 0 ? 21 : -27, s > 0 ? 27 : -21, 0.8, 3, 'brick', [Z(23, 24.6, 1.0, 2.2)]);
    mb.tree(-12, 23 * s, 6, 'pine'); mb.tree(12, 23 * s, 6, 'pine');
    for (const sx of [1, -1]) {
      const X = (a, c, sill, top) => (sx > 0 ? [a, c, sill, top] : [-c, -a, sill, top]);
      const lo = Math.min(sx * 13, sx * 23), hi = Math.max(sx * 13, sx * 23);
      mb.b(sx * 10.5, 16 * s, 5, 1.2, 0, 1.7, 'hedge'); mb.b(sx * 18, 16 * s, 6, 1.2, 0, 1.7, 'hedge');   // hedgerow with a gap
      // barn
      mb.wx(lo, hi, 4 * s, 0.5, 4.5, 'wood', [X(19.5, 22, 0, 3.4)]);
      mb.wx(lo, hi, 12 * s, 0.5, 4.5, 'wood', [X(15, 17.5, 0, 3.4), X(20, 21.6, 1.1, 2.4)]);
      mb.wz(sx * 13, s > 0 ? 4 : -12, s > 0 ? 12 : -4, 0.5, 4.5, 'wood', [Z(5.5, 7, 1.1, 2.4), Z(9, 11, 0, 3.4)]);
      mb.wz(sx * 23, s > 0 ? 4 : -12, s > 0 ? 12 : -4, 0.5, 4.5, 'wood', [Z(7.4, 8.8, 1.1, 2.4)]);
      mb.b(sx * 20.5, 8 * s, 5, 7.4, 2.5, 2.8, 'wood');                           // hayloft
      mb.stairs(sx * 13.6, 5.5 * s, sx, 0, 2.4, 4.4, 2.8, 7, 'wood');
      mb.b(sx * 15.5, 10 * s, 2, 1.2, 0, 1.0, 'sand');
      mb.b(sx * 14, 0, 4.5, 2.2, 0, 1.4, 'rust', false); mb.b(sx * 13.2, 0, 1.8, 2, 1.4, 2.4, 'rust', false); mb.deco({ k: 'tractor', x: sx * 14, z: 0, dir: -sx });   // abandoned tractor
      mb.b(sx * 21, 0, 3, 3, 0, 2, 'sand', false);                               // haystack
      mb.deco({ k: 'cyl', x: sx * 21, z: 0, y: 0, r: 1.5, h: 1.6, mat: 'hay', uv: 1.5 }).deco({ k: 'sphere', x: sx * 21, y: 1.6, z: 0, r: 1.5, sy: 0.55, mat: 'hay', uv: 1.5 });
      mb.tree(sx * 6.5, 10.5 * s, 5.4); mb.tree(sx * 26, 20 * s, 6.2, 'pine'); mb.tree(sx * 25, 1.5 * s, 5.6);
      mb.b(sx * 5, 19 * s, 2, 1.6, 0, 1.2, 'rock'); mb.b(sx * 26, 8 * s - 4 * s, 1.4, 1.4, 0, 1.0, 'rock');
      mb.b(sx * 8.5, 3.5 * s, 0.6, 5, 0, 2.4, 'stone'); mb.b(sx * 5.5, 8.2 * s, 5, 0.6, 0, 2.4, 'stone');   // broken farmhouse walls
    }
    ffa.push([-14, 20 * s], [14, 20 * s], [-9, 13 * s], [9, 13 * s], [-24.5, 10 * s], [24.5, 10 * s]);
  }
  both(-15, 7.6, 'smg'); both(15, 7.6, 'shotgun'); both(21, 8, 'sniper'); both(-21, 8, 'rifle');
  both(0, 24.5, 'ammo'); both(-9, 12, 'health'); both(9, 12, 'armor'); both(-24, 18, 'mines'); both(24, 18, 'ammo');
  pickups.push({ x: 0, z: -2.2, kind: 'rifle', y: 1.5 }, { x: 0, z: -4.4, kind: 'health', y: 1.0 });
  return { id: 'wildwood', decor: mb.decor, name: 'Wildwood', desc: 'Overgrown farmland: hedgerows, barns with hay lofts and a ruined hill in the middle.',
    theme: { sky: [0.55, 0.70, 0.55], fog: [0.50, 0.64, 0.50], fogNear: 22, fogFar: 85, sun: [0.3, 0.85, 0.4], light: 1.15 },
    boxes: mb.boxes, ffa, pickups, golden: { x: 0, z: 2.2, y: 1.5 }, hill: { x: 0, z: 0, r: 4, y: 1.5 },
    base: { x: 0, z: 22 }, spawnX: [-6, -3, 0, 3, 6] };
}

// ---------------------------------------------------------------- WRECKAGE  (crashed helicopter, gas station, container yard, overhead walkway)
function wreckage() {
  const mb = new MB().shell('asphalt', 'concrete', 8);
  const pickups = [], ffa = [];
  const both = (x, z, kind, y) => { pickups.push({ x, z, kind, y }); pickups.push({ x, z: -z, kind, y }); };
  mb.b(0, 0, 20, 14, 0, 0.1, 'dirt');                                            // scorched crater
  mb.b(-2, 0, 8, 3, 0.1, 2.6, 'olive', false); mb.b(-7, 0, 1.4, 2, 0.1, 1.5, 'olive', false);   // fuselage + nose
  mb.b(6.5, 0, 9, 1.0, 2.0, 3.0, 'olive', false); mb.b(10.8, 0, 0.6, 0.5, 3.0, 5.2, 'olive', false);   // raised tail boom + fin
  mb.b(-2, 0, 14, 0.8, 2.9, 3.1, 'dark', false); mb.b(-2, 0, 0.8, 14, 2.9, 3.1, 'dark', false); // bent rotor
  mb.deco({ k: 'heli', x: 0, z: 0 });
  mb.barrel(-10.2, -3.2, 'red'); mb.barrel(-10.9, -2.5, 'olive'); mb.barrel(9.5, 4.6, 'blue');
  mb.b(-7.4, 0, 0.8, 0.8, 1.5, 2.1, 'glow');
  mb.b(-9, 3.5, 2, 1.2, 0, 1.0, 'rust'); mb.b(7, -4, 1.6, 2.4, 0, 0.9, 'rust'); mb.b(4, 4.2, 1.2, 1.2, 0, 0.8, 'rust');
  for (const s of [1, -1]) {
    mb.b(0, 22 * s, 12, 6, 0, 0.2, 'accent');
    mb.b(0, 26.6 * s, 18, 0.8, 0, 3.5, 'concrete');
    mb.b(-9.5, 24.5 * s, 0.8, 5, 0, 2.4, 'concrete'); mb.b(9.5, 24.5 * s, 0.8, 5, 0, 2.4, 'concrete');
    mb.b(-3.5, 17.5 * s, 4, 0.8, 0, 1.0, 'concrete'); mb.b(3.5, 17.5 * s, 4, 0.8, 0, 1.0, 'concrete');
    mb.car(-4, 12 * s, true, 'rust'); mb.car(2, 13.5 * s, true, 'olive');
    // overhead walkway across the road
    mb.b(0, 8 * s, 22, 3, 3.0, 3.3, 'metal');
    mb.b(0, 9.45 * s, 22, 0.15, 3.3, 4.2, 'accent'); mb.b(0, 6.55 * s, 22, 0.15, 3.3, 4.2, 'accent');
    for (const px of [-7, 7]) mb.b(px, 8 * s, 1, 1, 0, 3.0, 'concrete');
    for (const sx of [1, -1]) {
      const Z = (a, c, sill, top) => (s > 0 ? [a, c, sill, top] : [-c, -a, sill, top]);
      const X = (a, c, sill, top) => (sx > 0 ? [a, c, sill, top] : [-c, -a, sill, top]);
      mb.stairs(sx * 17.7, 8 * s, -sx, 0, 2.6, 6.5, 3.3, 8, 'metal');
      // gas station canopy
      for (const px of [11, 23]) for (const pz of [10.5, 17.5]) mb.b(sx * px, pz * s, 0.6, 0.6, 0, 4.2, 'concrete');
      mb.b(sx * 17, 14 * s, 12.6, 7.6, 4.2, 4.6, 'accent');
      mb.pump(sx * 14, 13 * s); mb.pump(sx * 14, 15 * s); mb.pump(sx * 20, 13 * s); mb.pump(sx * 20, 15 * s);
      mb.deco({ k: 'lamp', x: sx * 10.2, z: 21.5 * s, h: 5.5 }); mb.deco({ k: 'lamp', x: sx * 9.8, z: 3.5 * s, h: 5.5 });
      // shop
      const lo = Math.min(sx * 12, sx * 22), hi = Math.max(sx * 12, sx * 22);
      mb.wx(lo, hi, 19.5 * s, 0.5, 3.4, 'brick', [X(15.5, 18, 0, 2.8), X(12.8, 14.4, 1.0, 2.3), X(19.4, 21, 1.0, 2.3)]);
      mb.wx(lo, hi, 25.5 * s, 0.5, 3.4, 'brick', []);
      mb.wz(sx * 12, s > 0 ? 19.5 : -25.5, s > 0 ? 25.5 : -19.5, 0.5, 3.4, 'brick', [Z(21.5, 23, 1.0, 2.3)]);
      mb.wz(sx * 22, s > 0 ? 19.5 : -25.5, s > 0 ? 25.5 : -19.5, 0.5, 3.4, 'brick', [Z(22, 24, 0, 2.8)]);
      mb.b(sx * 17, 23.5 * s, 4, 0.8, 0, 1.0, 'wood');
      // containers + stairs of crates
      mb.b(sx * 8.5, 19 * s, 6, 2.4, 0, 2.6, 'blue'); mb.b(sx * 25.5, 5 * s, 2.4, 6, 0, 2.6, sx > 0 ? 'red' : 'blue');
      mb.b(sx * 14, 3 * s, 2, 2, 0, 1.0, 'crate'); mb.b(sx * 21, 2 * s, 3, 1.5, 0, 1.2, 'concrete');
    }
    ffa.push([-3, 21 * s], [3, 21 * s], [-21, 4 * s], [21, 4 * s], [-8, 14 * s], [8, 14 * s]);
  }
  both(-17, 14, 'smg'); both(17, 14, 'shotgun'); both(8, 8, 'rifle', 3.3); both(-8, 8, 'sniper', 3.3);
  both(-17, 22, 'armor'); both(17, 22, 'ammo'); both(0, 24.5, 'ammo'); both(-5, 9.5, 'health'); both(5, 9.5, 'mines'); both(-22, 5, 'mines'); both(24, 9, 'health');
  pickups.push({ x: 0, z: 3.4, kind: 'armor' }, { x: 0, z: -3.4, kind: 'health' });
  return { id: 'wreckage', decor: mb.decor, name: 'Wreckage', desc: 'Crash site at a ruined crossroads: downed helicopter, gas station, containers and an overhead walkway.',
    theme: { sky: [0.30, 0.32, 0.36], fog: [0.34, 0.34, 0.36], fogNear: 20, fogFar: 80, sun: [0.3, 0.7, 0.5], light: 0.95 },
    boxes: mb.boxes, ffa, pickups, golden: { x: 0, z: 4.6, y: 0.1 }, hill: { x: 0, z: 0, r: 5, y: 0.1 },
    base: { x: 0, z: 22 }, spawnX: [-6, -3, 0, 3, 6] };
}

// ---------------------------------------------------------------- assembly
const BUILDERS = { foundry, atrium, courtyard, reactor, crosswire, wildwood, wreckage };
export const MAP_IDS = Object.keys(BUILDERS);
const cache = {};

function spawnAt(boxes, x, z, yawFrom) {
  const y = Math.max(0, floorAt(boxes, x, z, 0.7));
  return { x, y, z, yaw: Math.atan2(x - yawFrom[0], z - yawFrom[1]) };
}

export function getMap(id) {
  if (!BUILDERS[id]) id = 'foundry';
  if (cache[id]) return cache[id];
  const m = BUILDERS[id]();
  const bx = m.boxes;
  const t0 = m.spawnX.map((x, i) => spawnAt(bx, x, 24 + (i % 2) * 0.01, [0, 0]));
  const t1 = m.spawnX.map((x) => spawnAt(bx, x, -24, [0, 0]));
  t0.forEach(s => { s.z = 24; s.yaw = 0; }); t1.forEach(s => { s.z = -24; s.yaw = Math.PI; });
  const ffaPts = [];
  for (const [x, z] of m.ffa) { ffaPts.push(spawnAt(bx, x, z, [0, 0])); }
  m.spawns = { t0, t1, ffa: ffaPts.concat(t0.slice(1, 4), t1.slice(1, 4)) };
  m.flags = [
    { x: m.base.x, z: m.base.z, y: Math.max(0, floorAt(bx, m.base.x, m.base.z, 0.7)) },
    { x: m.base.x, z: -m.base.z, y: Math.max(0, floorAt(bx, m.base.x, -m.base.z, 0.7)) },
  ];
  m.pickups = m.pickups.map((p, i) => ({
    id: i, x: p.x, z: p.z, kind: p.kind,
    y: p.y !== undefined ? p.y : Math.max(0, floorAt(bx, p.x, p.z, 0.7)),
  }));
  m.golden = { x: m.golden.x, z: m.golden.z, y: m.golden.y };
  m.nav = buildNav(m);
  cache[id] = m;
  return m;
}

export function mapList() {
  return MAP_IDS.map(id => { const m = getMap(id); return { id, name: m.name, desc: m.desc }; });
}
