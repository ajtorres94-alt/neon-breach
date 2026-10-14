// Drives a simulated player along nav paths with the real physics to prove the paths are physically walkable.
import { getMap, MAP_IDS } from '../shared/maps.js';
import { stepBody, newBody } from '../shared/physics.js';
import { nearestNode, findPath } from '../shared/nav.js';

let fails = 0;
function walk(m, from, to, label) {
  const nav = m.nav;
  const a = nearestNode(nav, from.x, from.y, from.z), b = nearestNode(nav, to.x, to.y, to.z);
  const path = findPath(nav, a.i, b.i);
  if (!path) { console.log(`  ✗ ${label}: no path`); fails++; return; }
  const s = newBody(from.x, from.y, from.z);
  let idx = 1, t = 0, stuck = 0, lx = s.x, lz = s.z, jumpTimer = 0;
  const dt = 1 / 30;
  while (idx < path.length && t < 90) {
    const n = nav.nodes[path[idx]];
    const dx = n.x - s.x, dz = n.z - s.z;
    if (Math.hypot(dx, dz) < 0.7 && Math.abs(n.y - s.y) < 1.0) { idx++; continue; }
    const yaw = Math.atan2(-dx, -dz);
    stepBody(m.boxes, s, { f: 1, r: 0, yaw, jump: jumpTimer > 0, crouch: false, ads: false }, dt);
    t += dt;
    if (jumpTimer > 0) jumpTimer -= dt;
    if (Math.floor(t * 2) !== Math.floor((t - dt) * 2)) {
      if (Math.hypot(s.x - lx, s.z - lz) < 0.3) { stuck++; jumpTimer = 0.2; } else stuck = 0;
      lx = s.x; lz = s.z;
      if (stuck >= 6) { console.log(`  ✗ ${label}: stuck at node ${idx}/${path.length} (${s.x.toFixed(1)},${s.y.toFixed(2)},${s.z.toFixed(1)}) heading to (${n.x.toFixed(1)},${n.y.toFixed(2)},${n.z.toFixed(1)})`); fails++; return; }
    }
    if (s.y < -5) { console.log(`  ✗ ${label}: fell out of the world`); fails++; return; }
  }
  if (idx < path.length) { console.log(`  ✗ ${label}: timed out`); fails++; return; }
  console.log(`  ✓ ${label}: ${t.toFixed(1)}s, ${path.length} nodes`);
}

for (const id of MAP_IDS) {
  const m = getMap(id);
  console.log(m.name);
  walk(m, m.spawns.t0[0], m.flags[1], 'base -> enemy flag');
  walk(m, m.spawns.t1[2], m.flags[0], 'enemy base -> flag');
  walk(m, m.spawns.t0[2], { ...m.hill, y: m.hill.y }, 'spawn -> hill');
  for (const p of m.pickups) if (p.y > 1.5) walk(m, m.spawns.t0[1], p, `spawn -> high pickup ${p.kind}@y${p.y}`);
}
console.log(fails ? `\n${fails} failure(s)` : '\nAll walks OK');
process.exit(fails ? 1 : 0);
