// Headless simulation: 8 bots play each mode on a fast-forwarded clock.
import { MAP_IDS } from '../shared/maps.js';
import { MODES } from '../shared/weapons.js';

let clock = 1_000_000_000;
const realNow = Date.now;
Date.now = () => clock;
const { Room } = await import('../server/room.js');

const SIM_SECONDS = +process.argv[2] || 150;
let problems = 0;

function run(mode, mapId) {
  const room = new Room('TEST', { settings: { map: mapId, mode, bots: 8, time: 600, limit: MODES[mode].limits[2], items: 'random' } });
  room.destroy();
  const stats = { shots: 0, kills: 0, picks: 0, flags: {}, intel: 0, booms: 0, golden: 0 };
  const origEmit = room.emit.bind(room);
  room.emit = (ev, to) => {
    if (ev.e === 'shot') stats.shots++; else if (ev.e === 'kill') stats.kills++; else if (ev.e === 'pu') stats.picks++;
    else if (ev.e === 'flag') stats.flags[ev.kind] = (stats.flags[ev.kind] || 0) + 1;
    else if (ev.e === 'intel') stats.intel++; else if (ev.e === 'boom') stats.booms++; else if (ev.e === 'golden') stats.golden++;
    origEmit(ev, to);
  };
  room.fillBots(); room.startMatch();
  const start = new Map();
  let maxMoved = new Map();
  for (const p of room.players.values()) maxMoved.set(p.id, 0);
  let lastPos = new Map([...room.players.values()].map(p => [p.id, [p.x, p.z]]));
  const total = SIM_SECONDS * 30;
  for (let i = 0; i < total && room.phase !== 'ended'; i++) {
    clock += 1000 / 30;
    room.update();
    if (i % 30 === 0) for (const p of room.players.values()) { const l = lastPos.get(p.id); maxMoved.set(p.id, maxMoved.get(p.id) + Math.hypot(p.x - l[0], p.z - l[1])); lastPos.set(p.id, [p.x, p.z]); }
  }
  const pl = [...room.players.values()];
  const idle = pl.filter(p => maxMoved.get(p.id) < 15).map(p => p.name);
  const simSecs = Math.round((SIM_SECONDS * 30) / 30);
  const kd = pl.map(p => `${p.kills}/${p.deaths}`).join(' ');
  const out = `${mode.padEnd(4)} ${mapId.padEnd(9)} phase=${room.phase.padEnd(7)} kills=${String(stats.kills).padEnd(3)} shots=${String(stats.shots).padEnd(5)} pickups=${String(stats.picks).padEnd(3)} mines=${stats.booms}` +
    ` score=${room.teamMode ? room.teamScore.join(':') : Math.max(...pl.map(p => p.score))}` +
    (mode === 'ctf' ? ` flags=${JSON.stringify(stats.flags)}` : '') + (mode === 'kc' ? ` intel=${stats.intel}` : '') + (mode === 'gg' ? ` golden=${stats.golden}` : '') +
    (idle.length ? `  ⚠ barely moved: ${idle.join(',')}` : '');
  console.log(out);
  if (stats.kills === 0) { problems++; console.log('  ✗ nobody got a kill'); }
  if (idle.length > 2) { problems++; console.log('  ✗ too many idle bots'); }
}

const plan = [['dm', 'foundry'], ['tdm', 'atrium'], ['ctf', 'courtyard'], ['koth', 'reactor'], ['kc', 'foundry'], ['gg', 'atrium'], ['ctf', 'foundry'], ['dm', 'reactor'], ['tdm', 'courtyard']];
for (const [mode, map] of plan) run(mode, map);
Date.now = realNow;
console.log(problems ? `\n${problems} problem(s)` : '\nSimulation OK');
process.exit(problems ? 1 : 0);
