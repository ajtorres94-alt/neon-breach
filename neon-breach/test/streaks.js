// Killstreaks: earning, the pick-one offers, and every reward (helmet, dog, sentry, barrier, rats, clone).
let clock = 1_000_000_000;
Date.now = () => clock;
const { Room } = await import('../server/room.js');
const { STREAK_UNITS: U } = await import('../shared/weapons.js');

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  ✗', m); } else console.log('  ✓', m); };
const fakeWs = () => ({ readyState: 1, sent: [], send(s) { this.sent.push(JSON.parse(s)); } });
const advance = (room, secs) => { for (let i = 0; i < secs * 30; i++) { clock += 1000 / 30; room.update(); } };
const evs = (ws, k) => ws.sent.filter(m => m.t === 's').flatMap(m => m.ev || []).filter(e => e.e === k);

function setup(mapId = 'foundry', empty = true) {
  const room = new Room('S' + Math.random(), { settings: { map: mapId, mode: 'dm', bots: 0, loadout: 'arsenal' } }); room.destroy();
  const wa = fakeWs(), wb = fakeWs();
  const A = room.join(wa, 'A', 0), B = room.join(wb, 'B', 0);
  room.handle(A, { t: 'start' }); advance(room, 8);
  if (empty) room.map = { ...room.map, boxes: [{ x0: -40, x1: 40, z0: -40, z1: 40, y0: -1, y1: 0 }] };     // flat floor only, leaves the shared map alone
  for (const q of [A, B]) { q.hp = 100; q.armor = 0; q.protectUntil = 0; q.y = 0; q.vy = 0; }
  A.x = 0; A.z = 0; B.x = 0; B.z = -10; A.yaw = 0; B.yaw = 0;
  return { room, wa, wb, A, B };
}
const kills = (room, A, B, n) => { for (let i = 0; i < n; i++) { B.alive = true; B.hp = 100; B.protectUntil = 0; room.damage(B, 999, A, 'pistol', false); } };
const earn = (room, A, B, tier) => { kills(room, A, B, tier - (A.streak || 0)); };
const only = (room, A, tier) => { A.offers = A.offers.filter(o => o.tier === tier); if (A.offers[0]) { A.offers[0].until = 0; room.streaks.nextOffer(A); } };
const reviveB = (B, x, z) => { B.alive = true; B.hp = 100; B.x = x; B.z = z; B.y = 0; B.protectUntil = 0; };

console.log('Earning and choosing');
{
  const { room, wa, A, B } = setup();
  kills(room, A, B, 2); ok(!A.offers.length, 'no reward after 2 kills');
  kills(room, A, B, 1); advance(room, 0.1);
  ok(A.offers.length === 1 && evs(wa, 'ksoffer').some(e => e.tier === 3 && e.opts.join() === 'uav,helmet,wall'), '3 kills: offered UAV / helmet / wall boots');
  room.handle(A, { t: 'ks', k: 'dog' }); ok(A.offers.length === 1, 'an option from another tier is refused');
  room.handle(A, { t: 'ks', k: 'helmet' }); ok(A.helmet && !A.offers.length, 'metal helmet equipped');
  room.handle(A, { t: 'ks', k: 'uav' });
  kills(room, A, B, 2); advance(room, 0.1); ok(A.offers.length === 1 && A.streak === 5, '5 kills: second reward offered');
  const opts = evs(wa, 'ksoffer').filter(e => e.tier === 5)[0];
  ok(opts && opts.opts.join() === 'dog,sentry,barrier', 'offered dog / sentry / barrier');
  kills(room, A, B, 2); advance(room, 0.1); ok(A.offers.length === 2 && A.streak === 7, '7 kills queue a third reward behind the unclaimed one');
  room.handle(A, { t: 'ks', k: 'sentry' }); advance(room, 0.1);
  const o7 = evs(wa, 'ksoffer').filter(e => e.tier === 7).pop();
  ok(o7 && o7.opts.join() === 'radar,rats,clone', 'offered radar / rats / clone');
  room.damage(A, 999, B, 'pistol', false);
  ok(A.streak === 0 && !A.helmet && !A.offers.length, 'dying clears the streak, helmet and unclaimed offers');
}
{
  const { room, wa, A, B } = setup();
  earn(room, A, B, 3); advance(room, U.offerTime + 1);
  ok(!A.offers.length && (A.helmet || evs(wa, 'fx').length), 'an unclaimed offer is auto-picked when the timer runs out');
}
console.log('UAV / radar');
{
  const { room, wa, A, B } = setup();
  earn(room, A, B, 3); room.handle(A, { t: 'ks', k: 'uav' }); advance(room, 0.1);
  ok(evs(wa, 'fx').some(e => e.k === 'uav' && e.dur === 30), 'UAV lasts 30s');
  earn(room, A, B, 7); only(room, A, 7); room.handle(A, { t: 'ks', k: 'radar' }); advance(room, 0.1);
  ok(evs(wa, 'fx').some(e => e.k === 'radar' && e.dur === 60), 'radar lasts a minute');
}
console.log('Metal helmet');
{
  const { room, A, B } = setup();
  earn(room, A, B, 3); room.handle(A, { t: 'ks', k: 'helmet' }); reviveB(B, 0, -8);
  A.x = 0; A.z = 0; A.yaw = 0;
  const shootHead = () => { clock += 1500; B.owned.add('sniper'); room.fire(B, 'sniper', [B.x, 1.75, B.z], [0, 0, -1], true); };
  B.x = 0; B.z = 8; const hp0 = A.hp; shootHead();
  ok(A.alive && !A.helmet, `first headshot is absorbed and the helmet breaks (hp ${A.hp})`);
  shootHead();
  ok(!A.alive || A.hp < hp0, 'second headshot lands normally');
}
console.log('Attack dog');
{
  const { room, A, B } = setup();
  earn(room, A, B, 5); only(room, A, 5); room.handle(A, { t: 'ks', k: 'dog' });
  const dog = room.streaks.units.find(u => u.type === 'dog');
  ok(dog && dog.hp === 75, 'one dog with 75 health');
  reviveB(B, 6, 6); advance(room, 4);
  ok(B.hp < 100 || !B.alive, `dog runs down and bites the enemy (hp ${Math.round(B.hp)})`);
  ok(Math.hypot(dog.x - B.x, dog.z - B.z) < 3 || !B.alive, 'dog stays on its target');
  const kA = A.streak;
  reviveB(B, 2, 2); B.hp = 5; advance(room, 2);
  ok(!B.alive && A.streak === kA, 'a kill by the dog scores but does not extend the streak');
  const before = B.hp; reviveB(B, 3, 3); A.owned.add('rifle');
}
console.log('Sentry gun');
{
  const { room, A, B } = setup();
  earn(room, A, B, 5); only(room, A, 5); room.handle(A, { t: 'ks', k: 'sentry' });
  const s = room.streaks.units.find(u => u.type === 'sentry');
  ok(s && s.ammo === 100, 'sentry has 100 rounds');
  reviveB(B, 6, -10); advance(room, 3);
  ok(B.hp < 100 || !B.alive, `sentry auto-targets and hits an enemy (hp ${Math.round(B.hp)}, ammo ${s.ammo})`);
  ok(s.ammo < 100, 'rounds are used up');
  A.hp = 100; const x0 = s.x; advance(room, 1); ok(s.x === x0, 'sentry is immobile');
  s.ammo = 0; advance(room, 0.5); ok(!room.streaks.units.includes(s), 'sentry is removed when it runs dry');
  // friendly fire: the owner is never targeted
  const { room: r2, A: A2, B: B2 } = setup(); earn(r2, A2, B2, 5); only(r2, A2, 5); r2.handle(A2, { t: 'ks', k: 'sentry' }); B2.alive = false; A2.x = 1; A2.z = -2; advance(r2, 3);
  ok(A2.hp === 100, 'sentry never shoots its owner');
}
console.log('Barrier');
{
  const { room, A, B } = setup('atrium', false);
  const n0 = room.map.boxes.length; const base = room.map.boxes;
  A.x = 0; A.z = 20; A.y = 0; A.yaw = Math.PI;                       // somewhere open, looking along +z / -z
  earn(room, A, B, 5); only(room, A, 5); room.handle(A, { t: 'ks', k: 'barrier' });
  const bar = room.streaks.units.find(u => u.type === 'barrier');
  ok(bar && bar.hp === 300, 'barrier has 300 health');
  ok(room.map.boxes.length === n0 + 1 && base.length === n0, 'barrier is a collision box in this room only (shared map untouched)');
  ok(bar.box.x1 - bar.box.x0 > 4 || bar.box.z1 - bar.box.z0 > 4, `barrier spans the corridor (${(bar.box.x1 - bar.box.x0).toFixed(1)} x ${(bar.box.z1 - bar.box.z0).toFixed(1)} m)`);
  const cx = (bar.box.x0 + bar.box.x1) / 2, cz = (bar.box.z0 + bar.box.z1) / 2;
  B.owned.add('m4'); const o = [cx, 1.5, cz + 3 * Math.sign(A.z - cz)];
  reviveB(B, 30, 30);
  for (let i = 0; i < 20; i++) { clock += 200; room.fire(B, 'm4', o, [0, 0, -Math.sign(A.z - cz)], false); }
  ok(bar.hp < 300 || !room.streaks.units.includes(bar), `enemy fire chews through the barrier (hp ${bar.hp})`);
  for (const u of room.streaks.units) room.streaks.destroy(u, null, true);
  ok(room.map.boxes.length === n0, 'destroying it removes the collision box');
}
console.log('Rat swarm');
{
  const { room, A, B } = setup();
  earn(room, A, B, 7); only(room, A, 7); room.handle(A, { t: 'ks', k: 'rats' });
  const r = room.streaks.units.find(u => u.type === 'rats');
  ok(r && r.hp === 1000 && U.rats.count === 10 && U.rats.dps === 80, '10 rats, 1000 total life, 80 damage per second');
  reviveB(B, 8, 8); advance(room, 5);
  ok(Math.hypot(r.x - B.x, r.z - B.z) < 3 || !B.alive, 'swarm hunts the enemy down');
  const hp = r.hp; room.streaks.damage(r, 400, B, 'rifle'); ok(r.hp === hp - 400, 'life pool is shared');
}
{
  const { room, A, B } = setup();
  earn(room, A, B, 7); A.offers.length = 0; room.streaks.activate(A, 'rats');
  const r = room.streaks.units.find(u => u.type === 'rats');
  reviveB(B, 4, 4); B.armor = 0; let hp = 100;
  // keep B pinned next to the swarm for exactly 2 seconds and measure
  r.x = r.body.x = 4; r.z = r.body.z = 4;
  for (let i = 0; i < 60; i++) { B.hp = Math.max(B.hp, 0.0001); B.x = r.x + 0.5; B.z = r.z; clock += 1000 / 30; room.update(); }
  const dealt = 100 - B.hp;
  ok(!B.alive || (dealt > 60 && dealt <= 175), `swarm deals about 80 dps (${B.alive ? dealt.toFixed(0) : 'killed'} in 2s)`);
}
console.log('Clone');
{
  const { room, A, B } = setup();
  earn(room, A, B, 7); only(room, A, 7); room.handle(A, { t: 'ks', k: 'clone' });
  const c = room.streaks.units.find(u => u.type === 'clone');
  ok(c && c.hp === 50 && c.max === 50, 'clone has half health');
  reviveB(B, 40, 40);
  for (let i = 0; i < 120; i++) { A.x += 0.2; A.z -= 0.05; clock += 1000 / 30; room.update(); A.hp = 100; }
  const gap = Math.hypot(c.x - A.x, c.z - A.z);
  ok(gap < 1.3, `clone stays at the player's side while they move (gap ${gap.toFixed(2)} m)`);
  reviveB(B, A.x + 8, A.z - 2); B.protectUntil = 0; advance(room, 3);
  ok(B.hp < 100 || !B.alive, `clone attacks opponents (hp ${Math.round(B.hp)})`);
  room.damage(A, 999, B, 'pistol', false); ok(!room.streaks.units.includes(c), 'clone vanishes when the owner dies');
}
console.log('Wall boots');
{
  const { stepBody, newBody } = await import('../shared/physics.js');
  const boxes = [{ x0: -20, x1: 20, z0: -20, z1: 20, y0: -1, y1: 0 }, { x0: -5, x1: 5, z0: -6, z1: -5, y0: 0, y1: 12 }];
  const run = (wall) => { const b = newBody(0, 0, -3); b.grounded = true; for (let i = 0; i < 120; i++) stepBody(boxes, b, { f: 1, r: 0, yaw: 0, jump: false, crouch: false, ads: false, wall }, 1 / 60); return b; };
  ok(run(false).y < 0.5, 'without the boots you cannot climb a 12 m wall');
  const c = run(true); ok(c.y > 6, `with the boots, holding forward runs up the wall (height ${c.y.toFixed(1)} m in 2 s)`);
  const b = newBody(0, 0, -3); b.grounded = true; let crossed = false;
  for (let i = 0; i < 400; i++) { stepBody(boxes, b, { f: 1, r: 0, yaw: 0, jump: false, crouch: false, ads: false, wall: true }, 1 / 60); if (b.z < -6.4 && b.y > 11.9) crossed = true; }
  ok(crossed, 'and carries on over the top of the wall');
}
console.log(fails ? `\n${fails} FAILED` : '\nKillstreak tests OK');
process.exit(fails ? 1 : 0);
