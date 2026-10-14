// New weapons & gadgets: revolver/deagle one/two-shot, rocket splash, laser mine, melee, knives, pickups.
let clock = 1_000_000_000;
const realNow = Date.now; Date.now = () => clock;
const { Room } = await import('../server/room.js');
const { WEAPONS, GADGETS } = await import('../shared/weapons.js');

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  ✗', m); } else console.log('  ✓', m); };
const fakeWs = () => ({ readyState: 1, sent: [], send(s) { this.sent.push(JSON.parse(s)); } });
const advance = (room, secs) => { for (let i = 0; i < secs * 30; i++) { clock += 1000 / 30; room.update(); } };
const evs = (ws, k) => ws.sent.filter(m => m.t === 's').flatMap(m => m.ev || []).filter(e => e.e === k);

function setup(mode = 'dm') {
  const room = new Room('C' + Math.random(), { settings: { map: 'foundry', mode, bots: 0, loadout: 'arsenal' } }); room.destroy();
  const wa = fakeWs(), wb = fakeWs();
  const A = room.join(wa, 'A', 0), B = room.join(wb, 'B', 0);
  room.handle(A, { t: 'start' }); advance(room, 8);
  // line them up in open air facing each other: A at origin looking -z, B 10 m ahead
  for (const q of [A, B]) { q.hp = 100; q.armor = 0; q.protectUntil = 0; q.y = 0; q.vy = 0; }
  A.x = 0; A.z = 0; B.x = 0; B.z = -10; A.yaw = 0; B.yaw = 0;
  room.map.boxes.length = 0;                       // empty arena: tests combat, not geometry
  return { room, wa, wb, A, B };
}
const shoot = (room, A, w, B, n = 1) => { for (let i = 0; i < n; i++) { clock += 700; A.owned.add(w); const o = [A.x, room.eyeY(A), A.z]; const d = [B.x - A.x, B.y + 1.1 - o[1], B.z - A.z]; const l = Math.hypot(...d); room.fire(A, w, o, d.map(v => v / l), false); } };

console.log('Revolver / Desert Eagle');
{
  const { room, A, B } = setup();
  B.armor = 100; shoot(room, A, 'revolver', B, 1);
  ok(B.alive && B.hp < 60, `revolver: one body shot does not kill (hp ${B.hp.toFixed(0)}), armor ignored (armor ${B.armor})`);
  shoot(room, A, 'revolver', B, 1);
  ok(!B.alive, 'revolver: second body shot kills');
}
{
  const { room, A, B } = setup(); B.armor = 100; B.x = 0; B.z = -35;
  B.z = -30; shoot(room, A, 'deagle', B, 1);
  ok(!B.alive, 'deagle: one body shot kills at long range through full armor');
  ok(WEAPONS.deagle.mag === 7 && WEAPONS.revolver.mag === 6, 'magazines are 7 and 6');
}

console.log('Shotgun');
ok(WEAPONS.shotgun.range === 40 && WEAPONS.shotgun.dmg === 12 && WEAPONS.shotgun.pellets === 10, 'breacher is 12 x 10, range 40');

console.log('Rocket');
{
  const { room, A, B, wb } = setup();
  A.owned.add('launcher'); B.z = -20; B.x = 0;
  room.fire(A, 'launcher', [0, room.eyeY(A), 0], [0, 0, -1], false);
  ok(room.projs.length === 1, 'rocket spawned as a projectile');
  const C = null;
  advance(room, 1.5);
  ok(room.projs.length === 0 && evs(wb, 'boom').length >= 1, 'rocket detonated');
  ok(!B.alive, 'direct hit kills (150 dmg)');
}
{
  const { room, A, B } = setup();
  A.owned.add('launcher'); B.x = 3; B.z = -20; A.z = 0;     // 3 m to the side of the impact point -> splash only
  const wall = { x0: -2, x1: 2, z0: -20.6, z1: -20.1, y0: 0, y1: 6 };
  room.map.boxes.push(wall);
  room.fire(A, 'launcher', [0, room.eyeY(A), 0], [0, 0, -1], false);
  advance(room, 1.5);
  ok(B.alive && B.hp < 100 && B.hp > 0, `splash damages bystander without killing (hp ${B.hp.toFixed(0)})`);
}
{
  const { room, A } = setup();
  A.owned.add('launcher'); room.map.boxes.push({ x0: -2, x1: 2, z0: -3.1, z1: -2.6, y0: 0, y1: 6 });
  const hp0 = A.hp; room.fire(A, 'launcher', [0, room.eyeY(A), 0], [0, 0, -1], false); advance(room, 1);
  ok(A.hp < hp0, `point-blank rocket hurts the shooter (hp ${A.hp.toFixed(0)})`);
}

console.log('Laser mine');
{
  const { room, A, B, wa } = setup();
  room.map.boxes.push({ x0: -5, x1: 5, z0: -12.2, z1: -12, y0: 0, y1: 4 });  // back wall
  A.lasers = 2; A.x = 0; A.z = -8; B.x = 6; B.z = 0;
  room.handle(A, { t: 'laser', p: [0, 1, -12], n: [0, 0, 1] });
  ok(room.lasers.length === 1 && A.lasers === 1, 'placed on a wall, inventory drops');
  ok(Math.abs(room.lasers[0].len - 12) < 0.3 || room.lasers[0].len > 0.8, `beam length measured (${room.lasers[0].len.toFixed(1)} m)`);
  advance(room, 2);
  B.x = 0; B.z = -5; B.y = 0; advance(room, 0.2);   // walk into the beam
  ok(!B.alive, 'enemy crossing the beam is destroyed');
  ok(room.lasers.length === 0 && A.laserOut === 0, 'mine is consumed, slot freed');
  A.lasers = 5; for (let i = 0; i < 5; i++) { A.x = 0; A.z = -8; room.handle(A, { t: 'laser', p: [0, 1, -12], n: [0, 0, 1] }); }
  ok(room.lasers.length === GADGETS.laser.maxOut, `max ${GADGETS.laser.maxOut} placed per player`);
}
{
  const { room, A } = setup(); A.x = 0; A.z = 0;
  room.handle(A, { t: 'laser', p: [0, 1, -3], n: [0, 0, 1] });
  ok(room.lasers.length === 0, 'cannot place with none in inventory');
}

console.log('Melee');
{
  const { room, A, B } = setup(); B.x = 0; B.z = -1.5; B.yaw = Math.PI;   // B faces A
  room.onMelee(A);
  ok(B.hp === 45, `frontal strike = 55 (hp ${B.hp})`);
  clock += 800; B.hp = 100; B.yaw = 0;                                      // B looks away
  room.onMelee(A);
  ok(!B.alive, 'backstab kills');
}
{
  const { room, A, B } = setup(); B.z = -4; room.onMelee(A);
  ok(B.hp === 100, 'out of reach = no damage');
  B.z = 1.5; clock += 800; room.onMelee(A);
  ok(B.hp === 100, 'target behind the attacker is not hit');
}

console.log('Throwing knives');
{
  const { room, A, B } = setup(); B.z = -9;
  const k0 = A.knives;
  room.onThrow(A, { o: [0, room.eyeY(A), 0], d: [0, (B.y + 1.2 - room.eyeY(A)) / 9, -1] });
  ok(A.knives === k0 - 1 && room.projs.length === 1, 'knife thrown, inventory decrements');
  advance(room, 1);
  ok(!B.alive, 'knife kills in one hit');
  const n = A.knives; room.onThrow(A, { o: [0, 1.6, 0], d: [0, 0, -1] }); room.onThrow(A, { o: [0, 1.6, 0], d: [0, 0, -1] });
  ok(A.knives === n - 1, 'throw cooldown enforced');
}

console.log('Pickups');
{
  const { room, A } = setup();
  A.lasers = 0; room.applyPickup(A, { kind: 'laser' }); ok(A.lasers === 2, 'laser mines come in batches of 2');
  room.applyPickup(A, { kind: 'laser' }); room.applyPickup(A, { kind: 'laser' });
  ok(A.lasers === GADGETS.laser.carry, 'carry cap respected');
  A.knives = 0; room.applyPickup(A, { kind: 'knives' }); ok(A.knives === GADGETS.knife.batch, 'knives come in batches of 3');
}
{
  const room = new Room('V', { settings: { map: 'foundry', mode: 'dm', bots: 0, items: 'random' } }); room.destroy();
  const w = fakeWs(); const A = room.join(w, 'A', 0); room.handle(A, { t: 'start' });
  const known = new Set(Object.keys(WEAPONS).concat(['armor', 'health', 'ammo', 'mines', 'laser', 'knives']));
  ok(room.pickups.every(p => known.has(p.kind)), 'every spawned pickup is a known kind');
}

Date.now = realNow;
console.log(fails ? `\n${fails} failure(s)` : '\nCombat tests OK');
process.exit(fails ? 1 : 0);
