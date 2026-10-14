// ASCII top-down view of a map: node test/mapview.js wildwood   (digits = highest surface in metres, letters = pickups)
import { getMap } from '../shared/maps.js';
const m = getMap(process.argv[2] || 'foundry');
const L = { rifle: 'R', smg: 'S', shotgun: 'G', sniper: 'N', armor: 'A', ammo: 'M', health: '+', mines: 'x' };
for (let z = 28; z >= -28; z -= 1) {
  let row = '';
  for (let x = -28; x <= 28; x += 0.5) {
    const p = m.pickups.find(p => Math.abs(p.x - x) < 0.26 && Math.abs(p.z - z) < 0.5);
    if (p) { row += L[p.kind] || '?'; continue; }
    let h = 0;
    for (const b of m.boxes) if (x >= b.x0 && x <= b.x1 && z - 0.5 <= b.z1 && z + 0.5 >= b.z0 && b.y1 > h && b.y0 < 6) h = Math.max(h, b.y1);
    row += h < 0.05 ? '.' : h < 0.5 ? ',' : h < 1.2 ? '-' : h < 2 ? '=' : h < 3 ? '+'.replace('+', '#') : '@';
  }
  console.log(row);
}
