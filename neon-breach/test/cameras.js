// Security cameras: random placement per match, swivel, cone + line-of-sight detection, 5-second exposure for everyone.
let clock = 1_000_000_000;
Date.now = () => clock;
const { Room } = await import('../server/room.js');
const { getMap, MAP_IDS } = await import('../shared/maps.js');
const { buildCameras, camYaw, camDir, camsSee, CAM } = await import('../shared/cameras.js');
const { hitBox, raycast, dirFromAngles } = await import('../shared/physics.js');

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  ✗', m); } else console.log('  ✓', m); };
const fakeWs = () => ({ readyState: 1, sent: [], send(s) { this.sent.push(JSON.parse(s)); } });
const advance = (room, secs) => { for (let i = 0; i < secs * 30; i++) { clock += 1000 / 30; room.update(); } };

console.log('Placement');
{
  let bad = 0, counts = new Set(), layouts = new Set();
  for (const id of MAP_IDS) {
    const map = getMap(id);
    for (let seed = 1; seed <= 40; seed++) {
      const cams = buildCameras(map, seed * 7919);
      counts.add(cams.length); layouts.add(id + cams.map(c => c.x + ',' + c.z).join('|'));
      if (cams.length < 2 || cams.length > 3) bad++;
      for (const c of cams) {
        if (hitBox(map.boxes, c.x, c.y, c.z, 0.3, 0.4)) bad++;
        if (c.y >= map.roofY) bad++;
        const h = raycast(map.boxes, [c.x, c.y, c.z], dirFromAngles(c.yaw, -0.2), 40); if (h && h.t < 12) bad++;
      }
    }
  }
  ok(bad === 0, 'every map / seed gets 2-3 cameras, mounted in free space with a long view');
  ok(counts.has(2) && counts.has(3), 'both 2 and 3 camera layouts occur');
  ok(layouts.size > 40, `placement is random across seeds (${layouts.size} distinct layouts)`);
  const a = buildCameras(getMap('foundry'), 12345), b = buildCameras(getMap('foundry'), 12345);
  ok(JSON.stringify(a) === JSON.stringify(b), 'same seed gives the same cameras (server and clients agree)');
}

console.log('Swivel and cone');
{
  const map = getMap('crosswire'), c = buildCameras(map, 99)[0];
  const ys = []; for (let t = 0; t < CAM.period * 1.2; t += 0.1) ys.push(camYaw(c, t));
  ok(Math.max(...ys) - Math.min(...ys) > CAM.amp * 1.5, 'the camera sweeps back and forth');
  const flat = [{ x0: -40, x1: 40, z0: -40, z1: 40, y0: -1, y1: 0 }];
  const d = camDir(c, 0), reach = 12;
  const px = c.x + d[0] * reach, pz = c.z + d[2] * reach, py = Math.max(0, c.y + d[1] * reach - 1.2);
  ok(camsSee(flat, [c], 0, px, py, pz) === 0 || camsSee(flat, [c], 0, px, 0, pz) === 0, 'a player on the cone axis is seen');
  ok(camsSee(flat, [c], 0, c.x - d[0] * 8, 0, c.z - d[2] * 8) === -1, 'a player behind the camera is not');
  const side = [-d[2], 0, d[0]];
  ok(camsSee(flat, [c], 0, c.x + d[0] * 10 + side[0] * 12, 0, c.z + d[2] * 10 + side[2] * 12) === -1, 'a player far off to the side is not');
  const wall = [...flat, { x0: px - 4, x1: px + 4, z0: pz - 0.5, z1: pz + 0.5, y0: 0, y1: 9 }];
  const before = [{ ...c }]; // a wall across the cone axis hides someone behind it
  const bx = c.x + d[0] * (reach + 3), bz = c.z + d[2] * (reach + 3);
  const wall2 = [...flat, { x0: Math.min(c.x + d[0] * reach, c.x + d[0] * reach) - 5, x1: c.x + d[0] * reach + 5, z0: c.z + d[2] * reach - 5, z1: c.z + d[2] * reach + 5, y0: 0, y1: 9 }];
  ok(camsSee(wall2, before, 0, bx, 0, bz) === -1, 'scenery between the camera and a player blocks the view');
}

console.log('Room: exposure for everyone');
{
  const room = new Room('C' + Math.random(), { settings: { map: 'foundry', mode: 'dm', bots: 0, loadout: 'arsenal' } }); room.destroy();
  const wa = fakeWs(), wb = fakeWs();
  const A = room.join(wa, 'A', 0), B = room.join(wb, 'B', 0);
  room.handle(A, { t: 'start' }); advance(room, 8);
  ok(room.cams.length >= 2 && room.cams.length <= 3, `match starts with ${room.cams.length} cameras`);
  ok(wa.sent.some(m => m.t === 'match' && m.cams && m.cams.length === room.cams.length), 'clients are told where the cameras are');
  room.map = { ...room.map, boxes: [{ x0: -40, x1: 40, z0: -40, z1: 40, y0: -1, y1: 0 }] };
  for (const q of [A, B]) { q.hp = 100; q.protectUntil = 0; q.y = 0; q.vy = 0; q.alive = true; q.exposedUntil = 0; }
  B.x = 0; B.z = 20; B.protectUntil = 0;
  const tNow = () => clock / 1000 - room.camT0;
  const c = room.cams[0], d = camDir(c, tNow());
  A.x = c.x + d[0] * 11; A.z = c.z + d[2] * 11; A.y = 0;
  const sees = camsSee(room.map.boxes, room.cams, tNow(), A.x, 0, A.z) >= 0;
  ok(sees, 'test setup: A stands in the cone');
  wa.sent.length = 0; wb.sent.length = 0;
  advance(room, 0.2);
  const snapB = wb.sent.filter(m => m.t === 's').pop();
  ok(snapB && snapB.p.find(p => p.i === A.id).ex === 1, 'player B is told A is exposed');
  ok(wb.sent.some(m => m.t === 's' && (m.ev || []).some(e => e.e === 'camspot' && e.id === A.id)), 'everyone gets a camera-spotted event');
  A.x = 0; A.z = -26;     // walk out of every cone (back-corner, behind the cameras' sweep); freeze their sweep onto the old spot
  room.cams = [];
  advance(room, 4);
  ok(wb.sent.filter(m => m.t === 's').pop().p.find(p => p.i === A.id).ex === 1, 'exposure lasts after leaving the cone (4 s in)');
  advance(room, 1.5);
  ok(wb.sent.filter(m => m.t === 's').pop().p.find(p => p.i === A.id).ex === 0, 'exposure ends after 5 seconds');
  const A2 = A; A2.exposedUntil = clock / 1000 + 5; room.damage(A2, 999, B, 'pistol', false);
  ok(!(A2.exposedUntil > clock / 1000), 'dying clears exposure');
}

console.log(fails ? `\n${fails} FAILED` : '\nCamera tests OK');
process.exit(fails ? 1 : 0);
