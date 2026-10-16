// Data checks for the visual systems that do not need a GPU: iron sights, reload animations, reload timings.
import { GUNS } from '../client/guns.js';
import { reloadPose } from '../client/reload.js';
import { WEAPONS } from '../shared/weapons.js';

let fails = 0;
const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) fails++; };
const finite = (v) => v.every(Number.isFinite);

console.log('Iron sights');
for (const [id, g] of Object.entries(GUNS)) {
  if (id === 'sniper') { ok(g.ads && g.ads.y > 0, 'sniper aims through its scope overlay'); continue; }
  const top = g.ads && g.ads.y;
  // two rear posts exist (the front sight at the muzzle was removed) at the sight height and nothing in between rises above them
  const posts = g.parts.filter(p => p.k === 'b' && !p.f && p.y + p.sy / 2 >= top - 0.004 && p.sx <= 0.006 && Math.abs(p.x) < 0.012);
  const rear = posts.filter(p => Math.abs(p.z - (g.grip - 0.03)) < 0.01), front = posts.filter(p => Math.abs(p.z - (g.muzzle + 0.05)) < 0.01);
  ok(rear.length >= 2 && front.length === 0, `${id}: rear notch (${rear.length} posts), no front sight at the muzzle (${front.length}), ads height ${top.toFixed(3)}`);
}

console.log('Reload animations');
for (const [id, w] of Object.entries(WEAPONS)) {
  ok(w.reload >= 1 && w.reload <= 2.0, `${id}: reload takes ${w.reload}s (1-2 s)`);
  let good = true, moved = 0, prev = null;
  for (let i = 0; i <= 40; i++) {
    const p = reloadPose(id, GUNS[id], w, i / 40);
    if (!p || !finite(p.g) || !finite(p.h1) || !finite(p.h2) || p.props.some(q => !finite(q.p))) { good = false; break; }
    if (prev) moved += Math.hypot(p.h2[0] - prev.h2[0], p.h2[1] - prev.h2[1], p.h2[2] - prev.h2[2]) + Math.abs(p.g[5] - prev.g[5]) + Math.abs(p.g[3] - prev.g[3]);
    prev = p;
  }
  const a = reloadPose(id, GUNS[id], w, 0), z = reloadPose(id, GUNS[id], w, 1);
  ok(good && moved > 0.4, `${id}: scripted pose is finite and moves the gun/hands (${moved.toFixed(2)})`);
  ok(Math.hypot(...a.g.slice(0, 3)) < 0.02 && Math.hypot(...z.g.slice(0, 3)) < 0.03 && Math.hypot(...z.h2) < 0.01, `${id}: starts and ends at the normal grip`);
}
// every reload family has a different motion
const sig = (id) => { let s = ''; for (let i = 0; i <= 10; i++) { const p = reloadPose(id, GUNS[id], WEAPONS[id], i / 10); s += p.g.map(v => v.toFixed(2)).join(',') + p.h2.map(v => v.toFixed(2)).join(',') + ';'; } return s; };
const fam = { mag: 'rifle', cyl: 'revolver', shell: 'shotgun', bolt: 'sniper', rocket: 'launcher' };
ok(new Set(Object.values(fam).map(sig)).size === 5, 'magazine, revolver, shotgun, bolt-action and launcher reloads are all different');
ok(sig('rifle') !== sig('smg'), 'each magazine gun reloads at its own well position');

console.log(fails ? `\n${fails} FAILED` : '\nVisual data tests OK');
process.exit(fails ? 1 : 0);
