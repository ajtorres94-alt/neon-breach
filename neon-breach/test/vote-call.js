// Map vote + team callout behaviour, run headless on a fast-forwarded clock.
let clock = 1_000_000_000;
const realNow = Date.now;
Date.now = () => clock;
const { Room } = await import('../server/room.js');
const { MAP_IDS } = await import('../shared/maps.js');

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('  ✗', msg); } else console.log('  ✓', msg); };
const fakeWs = () => ({ readyState: 1, sent: [], send(s) { this.sent.push(JSON.parse(s)); } });
const advance = (room, secs) => { for (let i = 0; i < secs * 30; i++) { clock += 1000 / 30; room.update(); } };
const events = (ws, kind) => ws.sent.filter(m => m.t === 's').flatMap(m => m.ev || []).filter(e => e.e === kind);

console.log('Callouts');
{
  const room = new Room('T1', { settings: { map: 'foundry', mode: 'tdm', bots: 0 } }); room.destroy();
  const wa = fakeWs(), wb = fakeWs(), wc = fakeWs();
  const A = room.join(wa, 'Alice', 0), B = room.join(wb, 'Bob', 0), C = room.join(wc, 'Cara', 0);
  ok(A.team === 0 && B.team === 1 && C.team === 0, 'teams alternate (A and C share a squad)');
  room.handle(A, { t: 'start' }); advance(room, 4);
  ok(room.phase === 'play', 'match is in play');
  const pos = [A.x, A.y, A.z];
  room.handle(A, { t: 'call', k: 'enemy', p: pos }); advance(room, 0.1);
  ok(events(wa, 'call').length === 1 && events(wc, 'call').length === 1, 'sender and teammate receive the callout');
  ok(events(wb, 'call').length === 0, 'the enemy squad does not');
  room.handle(A, { t: 'call', k: 'attack', p: pos }); advance(room, 0.1);
  ok(events(wa, 'call').length === 1, 'second callout within 1s is rate limited');
  advance(room, 1.2);
  room.handle(A, { t: 'call', k: 'bogus', p: pos }); room.handle(A, { t: 'call', k: 'ping', p: [999, 0, 0] }); room.handle(A, { t: 'call', k: 'ping', p: ['x', 0, 0] }); advance(room, 0.1);
  ok(events(wa, 'call').length === 1, 'unknown kind, out-of-bounds and non-numeric positions are rejected');
  room.handle(A, { t: 'call', k: 'help', p: pos }); advance(room, 0.1);
  ok(events(wa, 'call').length === 2 && events(wa, 'call')[1].k === 'help', 'valid callout after the cooldown goes through');
}
{
  const room = new Room('T2', { settings: { map: 'foundry', mode: 'dm', bots: 0 } }); room.destroy();
  const wa = fakeWs(); const A = room.join(wa, 'Solo', 0); room.handle(A, { t: 'start' }); advance(room, 4);
  room.handle(A, { t: 'call', k: 'ping', p: [A.x, A.y, A.z] }); advance(room, 0.1);
  ok(events(wa, 'call').length === 0, 'callouts are ignored in free-for-all modes');
}

console.log('Map vote (private room)');
{
  const room = new Room('T3', { settings: { map: 'foundry', mode: 'dm', bots: 0 } }); room.destroy();
  const wa = fakeWs(), wb = fakeWs(), wc = fakeWs();
  const A = room.join(wa, 'Alice', 0), B = room.join(wb, 'Bob', 0), C = room.join(wc, 'Cara', 0);
  room.handle(A, { t: 'start' }); advance(room, 4);
  room.endMatch({ type: 'draw' });
  const end = wa.sent.find(m => m.t === 'end');
  ok(end && end.vote && end.vote.options.length === 3 && new Set(end.vote.options).size === 3, 'end message carries 3 distinct map options');
  ok(end.vote.options.every(o => MAP_IDS.includes(o)), 'options are real maps');
  const [o1, o2] = end.vote.options;
  room.handle(A, { t: 'vote', map: o2 }); room.handle(B, { t: 'vote', map: o2 }); room.handle(C, { t: 'vote', map: o1 });
  room.handle(C, { t: 'vote', map: 'not-a-map' });
  const last = [...wa.sent].reverse().find(m => m.t === 'votes');
  ok(last && last.c[o2] === 2 && last.c[o1] === 1, 'tally is broadcast (2 vs 1, C\'s invalid vote ignored)');
  room.handle(C, { t: 'vote', map: o2 });
  ok([...wa.sent].reverse().find(m => m.t === 'votes').c[o2] === 3, 'a player can change their vote');
  advance(room, 13);
  ok(room.phase === 'lobby' && room.settings.map === o2, `winner (${o2}) becomes the room's map and the room returns to the lobby`);
}
console.log('Map vote (ties, no votes, bots)');
{
  const room = new Room('T4', { settings: { map: 'reactor', mode: 'dm', bots: 4 } }); room.destroy();
  const wa = fakeWs(), wb = fakeWs(); const A = room.join(wa, 'Alice', 0), B = room.join(wb, 'Bob', 0);
  room.handle(A, { t: 'start' }); advance(room, 4); room.endMatch({ type: 'draw' });
  advance(room, 13);
  ok(room.settings.map === 'reactor', 'no votes keeps the current map');
  room.handle(A, { t: 'start' }); advance(room, 4); room.endMatch({ type: 'draw' });
  const [o1, o2] = wa.sent.filter(m => m.t === 'end').pop().vote.options;
  room.handle(A, { t: 'vote', map: o1 }); room.handle(B, { t: 'vote', map: o2 });
  const bot = room.bots[0]; room.handle(bot, { t: 'vote', map: o1 });
  ok(Object.values(room.voteCounts()).reduce((a, b) => a + b, 0) === 2, 'bots cannot vote');
  advance(room, 13);
  ok([o1, o2].includes(room.settings.map), 'a tie resolves to one of the tied maps');
  // a voter who leaves no longer counts
  room.handle(A, { t: 'start' }); advance(room, 4); room.endMatch({ type: 'draw' });
  const opts = wa.sent.filter(m => m.t === 'end').pop().vote.options;
  room.handle(A, { t: 'vote', map: opts[0] }); room.handle(B, { t: 'vote', map: opts[1] });
  room.removePlayer(A); room.handle(B, { t: 'lobby' });
  ok(room.settings.map === opts[1] && room.phase === 'lobby', 'leavers\' votes are dropped; host "rematch" path applies the winner');
}
console.log('Map vote (public room)');
{
  const room = new Room('PUBX', { isPublic: true, settings: { map: 'foundry', mode: 'dm', bots: 6 } }); room.destroy();
  const wa = fakeWs(); const A = room.join(wa, 'Alice', 0);
  advance(room, 5); room.endMatch({ type: 'draw' });
  const opts = wa.sent.filter(m => m.t === 'end').pop().vote.options;
  room.handle(A, { t: 'vote', map: opts[2] });
  advance(room, 13);
  ok(room.settings.map === opts[2] && (room.phase === 'countdown' || room.phase === 'play'), 'public room starts the next match on the voted map');
}

Date.now = realNow;
console.log(fails ? `\n${fails} failure(s)` : '\nVote/callout tests OK');
process.exit(fails ? 1 : 0);
