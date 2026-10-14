// Sanity checks for every map: spawns/pickups/flags are standable and not inside geometry,
// and the bot nav graph connects both bases, flags, the hill and every pickup.
import { getMap, MAP_IDS } from '../shared/maps.js';
import { hitBox, floorAt, P } from '../shared/physics.js';
import { nearestNode, findPath } from '../shared/nav.js';

let problems = 0;
const bad = (m, msg) => { problems++; console.log(`  ✗ [${m.id}] ${msg}`); };

for (const id of MAP_IDS) {
  const t0 = Date.now();
  const m = getMap(id);
  console.log(`${m.name}: ${m.boxes.length} boxes, ${m.nav.nodes.length} nav nodes (${Date.now() - t0}ms)`);
  const free = (x, y, z, what) => {
    const b = hitBox(m.boxes, x, y + 0.02, z, P.r, P.h);
    if (b) bad(m, `${what} at (${x},${y.toFixed(2)},${z}) overlaps geometry (box ${b.x0},${b.z0}..${b.x1},${b.z1} y ${b.y0}..${b.y1})`);
    const f = floorAt(m.boxes, x, z, y + 0.1);
    if (Math.abs(f - y) > 0.05) bad(m, `${what} at (${x},${z}) is not on a floor (y=${y}, floor=${f})`);
  };
  for (const k of ['t0', 't1', 'ffa']) m.spawns[k].forEach((s, i) => free(s.x, s.y, s.z, `spawn ${k}[${i}]`));
  m.flags.forEach((f, i) => free(f.x, f.y, f.z, `flag ${i}`));
  m.pickups.forEach(p => free(p.x, p.y, p.z, `pickup ${p.id}:${p.kind}`));
  free(m.golden.x, m.golden.y, m.golden.z, 'golden');

  const nav = m.nav;
  const nodeOf = (o) => nearestNode(nav, o.x, o.y, o.z);
  const origin = nodeOf(m.spawns.t0[0]);
  const reach = (o, what) => {
    const n = nodeOf(o);
    if (!n) return bad(m, `no nav node near ${what}`);
    const p = findPath(nav, origin.i, n.i);
    if (!p) bad(m, `${what} unreachable from team-0 spawn`);
    return p;
  };
  m.spawns.t1.forEach((s, i) => reach(s, `t1 spawn ${i}`));
  m.spawns.ffa.forEach((s, i) => reach(s, `ffa spawn ${i}`));
  m.flags.forEach((f, i) => reach(f, `flag ${i}`));
  const hillNode = nav.nodes.find(n => Math.hypot(n.x - m.hill.x, n.z - m.hill.z) < m.hill.r && Math.abs(n.y - m.hill.y) < 1.6);
  if (!hillNode) bad(m, 'no standable nav node inside the hill zone'); else reach(hillNode, 'hill zone');
  reach(m.golden, 'golden');
  m.pickups.forEach(p => reach(p, `pickup ${p.id}:${p.kind}`));
  // symmetric path lengths between bases (fairness sanity check)
  const a = reach(m.flags[1], 'flag1'), b = nearestNode(nav, m.flags[1].x, m.flags[1].y, m.flags[1].z);
  const back = findPath(nav, b.i, origin.i);
  if (a && back) console.log(`  base-to-base path: ${a.length} / ${back.length} nodes`);
}
console.log(problems ? `\n${problems} problem(s)` : '\nAll maps OK');
process.exit(problems ? 1 : 0);
