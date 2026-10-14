// Waypoint navigation grid generated from a map's boxes. Used for bot pathfinding.
// A node is a standable spot on a 2m lattice; edges connect walkable neighbours
// (step-ups <= P.step, drops <= 1m, clear of obstacles).

import { P, hitBox, floorAt } from './physics.js';

const CELL = 2, HALF = 28;
const OFF = 0.037; // keeps the lattice off exact box edges (which sit on round numbers)

export function buildNav(map) {
  const boxes = map.boxes;
  const nodes = [], grid = new Map();
  const n = (HALF * 2) / CELL;
  for (let ix = 0; ix < n; ix++) {
    for (let iz = 0; iz < n; iz++) {
      const x = -HALF + CELL / 2 + OFF + ix * CELL, z = -HALF + CELL / 2 + OFF + iz * CELL;
      const tops = new Set();
      for (const b of boxes) if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1 && b.y1 > -0.01 && b.y1 < 8) tops.add(b.y1);
      for (const y of tops) {
        // the node height must be the real surface under this exact point (not a floor buried inside a low pad)
        if (floorAt(boxes, x, z, y + P.step) > y + 1e-3) continue;
        // same rule as walkable(): anything lower than a step is climbed by the physics
        if (hitBox(boxes, x, y + P.step + 0.02, z, 0.32, P.h - P.step - 0.05)) continue;
        const node = { i: nodes.length, x, y, z, links: [] };
        nodes.push(node);
        const k = ix + ',' + iz;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(node);
      }
    }
  }

  function walkable(a, b) {
    let prev = a.y;
    const steps = 8;
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      const fy = floorAt(boxes, x, z, prev + P.step + 1e-3);
      if (fy === -Infinity || prev - fy > 1.3) return false;
      // obstacles lower than a step are climbed by the physics, so only test the volume above step height
      if (hitBox(boxes, x, fy + P.step + 0.02, z, 0.3, P.h - P.step - 0.05)) return false;
      prev = fy;
    }
    return Math.abs(prev - b.y) < 0.1;
  }

  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (const a of nodes) {
    const ix = Math.round((a.x + HALF - CELL / 2 - OFF) / CELL), iz = Math.round((a.z + HALF - CELL / 2 - OFF) / CELL);
    for (const [dx, dz] of dirs) {
      const list = grid.get((ix + dx) + ',' + (iz + dz));
      if (!list) continue;
      for (const b of list) {
        if (Math.abs(b.y - a.y) > 1.6) continue;
        if (walkable(a, b)) a.links.push(b.i);
      }
    }
  }
  return { nodes, grid, cell: CELL, half: HALF };
}

/** Closest node to a world position (height-aware: a node on a crate is not "near" a pickup on the floor). */
export function nearestNode(nav, x, y, z) {
  const ix = Math.floor((x + nav.half) / nav.cell), iz = Math.floor((z + nav.half) / nav.cell);
  let best = null, bd = Infinity;
  for (let r = 1; r <= 4; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const list = nav.grid.get((ix + dx) + ',' + (iz + dz));
        if (!list) continue;
        for (const nd of list) {
          const d = (nd.x - x) ** 2 + (nd.z - z) ** 2 + 12 * (nd.y - y) ** 2;
          if (d < bd) { bd = d; best = nd; }
        }
      }
    }
    if (best) break;
  }
  return best;
}

// --- A* with a binary heap
class Heap {
  constructor() { this.a = []; }
  push(item, pri) {
    const a = this.a; a.push([pri, item]); let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop() {
    const a = this.a; if (!a.length) return null;
    const top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top[1];
  }
  get size() { return this.a.length; }
}

/** A* over nav nodes. Returns array of node indices from start to goal (inclusive) or null. */
export function findPath(nav, startIdx, goalIdx) {
  if (startIdx === goalIdx) return [startIdx];
  const nodes = nav.nodes, goal = nodes[goalIdx];
  const g = new Map([[startIdx, 0]]), from = new Map(), closed = new Set();
  const open = new Heap();
  open.push(startIdx, 0);
  while (open.size) {
    const cur = open.pop();
    if (cur === goalIdx) {
      const path = [cur];
      let c = cur;
      while (from.has(c)) { c = from.get(c); path.push(c); }
      return path.reverse();
    }
    if (closed.has(cur)) continue;
    closed.add(cur);
    const cn = nodes[cur];
    for (const nb of cn.links) {
      if (closed.has(nb)) continue;
      const nn = nodes[nb];
      const cost = g.get(cur) + Math.hypot(nn.x - cn.x, nn.z - cn.z) + Math.abs(nn.y - cn.y) * 1.5;
      if (cost < (g.has(nb) ? g.get(nb) : Infinity)) {
        g.set(nb, cost); from.set(nb, cur);
        open.push(nb, cost + Math.hypot(nn.x - goal.x, nn.z - goal.z) + Math.abs(nn.y - goal.y));
      }
    }
  }
  return null;
}
