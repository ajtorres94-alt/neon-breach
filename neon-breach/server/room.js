// One game room: lobby, match lifecycle, authoritative combat, pickups, mines, modes, bots.
// Movement is client-authoritative (validated for speed/bounds); combat is server-authoritative.

import { P, raycast, rayAABB, norm3, newBody } from '../shared/physics.js';
import { getMap, MAP_IDS } from '../shared/maps.js';
import { buildCameras, camsSee, CAM } from '../shared/cameras.js';
import {
  WEAPONS, PRIMARY, SIDEARMS, GADGETS, PICKUP_VARIANTS, MODES, PICKUP_RESPAWN, DEFAULT_SETTINGS, MAX_PLAYERS, TICK_RATE, RESPAWN_TIME, PROTECT_TIME,
} from '../shared/weapons.js';
import { makeBot, botThink, BOT_NAMES } from './bots.js';
import { Streaks, UNIT_WIDS } from './streaks.js';

const DT = 1 / TICK_RATE;
const nowS = () => Date.now() / 1000;
const r2 = (v) => Math.round(v * 100) / 100;
const MODE_IDS = Object.keys(MODES);
const SENTRY_W = { dmg: 9, hs: 1, rate: 9, spread: 0.03, adsSpread: 0.03, pellets: 1, range: 40, kind: 'hit' };

export class Room {
  constructor(code, opts = {}) {
    this.code = code;
    this.isPublic = !!opts.isPublic;
    this.settings = { ...DEFAULT_SETTINGS, ...(opts.settings || {}) };
    this.players = new Map();
    this.nextId = 1;
    this.hostId = null;
    this.phase = 'lobby';
    this.tick = 0;
    this.map = getMap(this.settings.map);
    this.mode = MODES[this.settings.mode];
    this.teamMode = this.mode.team;
    this.pickups = []; this.flags = null; this.mines = []; this.tokens = []; this.projs = []; this.lasers = [];
    this.golden = { holder: null, x: 0, y: 0, z: 0 };
    this.hillOwner = -2; this.hillAcc = 0;
    this.teamScore = [0, 0];
    this.timeLeft = 0; this.countdownEnd = 0; this.endAt = 0; this.winner = null;
    this.evAll = []; this.evTo = new Map();
    this.idleSince = nowS();
    this.rotation = 0;
    this.vote = null; this.callAt = new Map();
    this.streaks = new Streaks(this);
    this.interval = setInterval(() => { try { this.update(); } catch (e) { console.error('room update error', this.code, e); } }, 1000 / TICK_RATE);
    if (this.isPublic) { this.fillBots(); this.startMatch(); }
  }

  // ------------------------------------------------------------ helpers
  get humans() { return [...this.players.values()].filter(p => !p.bot); }
  get bots() { return [...this.players.values()].filter(p => p.bot); }
  emit(ev, to) { if (to != null) { (this.evTo.get(to) || this.evTo.set(to, []).get(to)).push(ev); } else this.evAll.push(ev); }
  send(p, obj) { if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify(obj)); }
  broadcast(obj) { const s = JSON.stringify(obj); for (const p of this.humans) if (p.ws.readyState === 1) p.ws.send(s); }
  eyeY(p) { return p.y + (p.crouch ? P.eyec : P.eye); }

  newPlayer(name, ws, bot) {
    const p = {
      id: this.nextId++, name, ws, bot: bot ? makeBot() : null, op: 0, team: 0,
      ...newBody(0, 0, 0), yaw: 0, pitch: 0, lean: 0, ads: false, wpn: 'pistol',
      hp: 100, armor: 0, alive: false, respawnAt: 0, protectUntil: 0, owned: new Set(['pistol']),
      mines: 0, minesOut: 0, lasers: 0, laserOut: 0, knives: GADGETS.knife.start, lastMelee: 0, lastThrow: 0, kills: 0, deaths: 0, assists: 0, caps: 0, returns: 0, score: 0,
      lastFire: {}, dmgBy: new Map(), carrying: -1, lastIn: nowS(), joined: nowS(),
    };
    return p;
  }

  smallerTeam() {
    let c = [0, 0];
    for (const p of this.players.values()) c[p.team]++;
    return c[1] < c[0] ? 1 : 0;
  }

  // ------------------------------------------------------------ roster / lobby
  roomInfo() {
    return {
      t: 'room', code: this.code, host: this.hostId, phase: this.phase, settings: this.settings, public: this.isPublic,
      players: [...this.players.values()].map(p => ({ id: p.id, name: p.name, team: p.team, bot: !!p.bot, op: p.op })),
      max: MAX_PLAYERS,
    };
  }
  pushRoom() { this.broadcast(this.roomInfo()); }

  join(ws, name, op) {
    if (this.players.size >= MAX_PLAYERS) {
      const bots = this.bots;
      if (!bots.length) return null;
      this.removePlayer(bots[bots.length - 1], true); // bots step aside for people
    }
    const p = this.newPlayer(name, ws, false);
    p.op = op | 0; p.team = this.smallerTeam();
    this.players.set(p.id, p);
    if (this.hostId == null) this.hostId = p.id;
    this.idleSince = null;
    this.fillBots(true);
    this.send(p, { t: 'welcome', id: p.id, room: this.code });
    if (this.phase !== 'lobby') {
      this.send(p, this.matchMsg());
      if (this.phase === 'play' || this.phase === 'countdown') this.spawn(p);
    }
    this.pushRoom();
    return p;
  }

  removePlayer(p, silent) {
    if (!this.players.has(p.id)) return;
    if (p.alive) this.dropCarried(p);
    this.players.delete(p.id);
    if (this.hostId === p.id) { const h = this.humans[0]; this.hostId = h ? h.id : null; }
    if (!this.humans.length) this.idleSince = nowS();
    if (!silent) { this.fillBots(true); this.pushRoom(); }
  }

  /** Keep the roster at the "fill to N" target: bots hold empty slots and step aside when people join. */
  fillBots(silent) {
    const target = this.settings.bots | 0;
    const want = target > 0 ? Math.max(0, target - this.humans.length) : 0;
    let bots = this.bots;
    let changed = false;
    while (bots.length > want) {
      // remove from the larger team first
      const c = [0, 0]; for (const p of this.players.values()) c[p.team]++;
      const big = c[0] >= c[1] ? 0 : 1;
      const victim = [...bots].reverse().find(b => b.team === big) || bots[bots.length - 1];
      this.players.delete(victim.id); bots = this.bots; changed = true;
    }
    while (bots.length < want && this.players.size < MAX_PLAYERS) {
      const used = new Set([...this.players.values()].map(p => p.name));
      const name = (BOT_NAMES.filter(n => !used.has(n))[0] || 'Bot' + this.nextId);
      const b = this.newPlayer(name, null, true);
      b.op = (Math.random() * 6) | 0; b.team = this.smallerTeam();
      this.players.set(b.id, b);
      if (this.phase === 'play' || this.phase === 'countdown') this.spawn(b);
      bots = this.bots; changed = true;
    }
    if (changed && !silent) this.pushRoom();
  }

  handleCfg(p, msg) {
    if (p.id !== this.hostId || this.phase !== 'lobby') return;
    const s = this.settings;
    if (MAP_IDS.includes(msg.map)) s.map = msg.map;
    if (MODES[msg.mode]) { s.mode = msg.mode; if (!msg.limit) s.limit = MODES[msg.mode].def; }
    if (MODES[s.mode] && Number.isFinite(msg.limit) && MODES[s.mode].limits.includes(msg.limit)) s.limit = msg.limit;
    if (!MODES[s.mode].limits.includes(s.limit)) s.limit = MODES[s.mode].def;
    if ([180, 300, 480, 600, 900].includes(msg.time)) s.time = msg.time;
    if ([0, 2, 4, 6, 8].includes(msg.bots)) s.bots = msg.bots;
    if (['clear', 'rain'].includes(msg.weather)) s.weather = msg.weather;
    if (['random', 'classic'].includes(msg.items)) s.items = msg.items;
    if (['arsenal', 'tactical'].includes(msg.loadout)) s.loadout = msg.loadout;
    this.map = getMap(s.map); this.mode = MODES[s.mode]; this.teamMode = this.mode.team;
    this.fillBots(true);
    this.pushRoom();
  }

  handleTeam(p, team) {
    if (this.phase !== 'lobby' || (team !== 0 && team !== 1)) return;
    const c = [0, 0]; for (const q of this.players.values()) if (q !== p) c[q.team]++;
    if (c[team] > c[1 - team]) return; // keep squads within one player of each other
    p.team = team; this.pushRoom();
  }

  // ------------------------------------------------------------ match lifecycle
  matchMsg() {
    return { t: 'match', map: this.settings.map, mode: this.settings.mode, settings: this.settings, pk: this.pickups.map(s => s.kind), phase: this.phase, cams: this.cams || [], camSeed: this.camSeed || 0 };
  }

  startMatch() {
    const s = this.settings;
    this.map = getMap(s.map); this.mode = MODES[s.mode]; this.teamMode = this.mode.team;
    this.fillBots(true);
    // rebalance teams
    const list = [...this.players.values()];
    if (this.teamMode) { let c = [0, 0]; list.forEach(p => c[p.team]++); while (Math.abs(c[0] - c[1]) > 1) { const big = c[0] > c[1] ? 0 : 1; const mv = list.filter(p => p.team === big).pop(); mv.team = 1 - big; c[big]--; c[1 - big]++; } }
    this.teamScore = [0, 0]; this.mines = []; this.tokens = []; this.projs = []; this.lasers = []; this.winner = null;
    this.streaks.reset();
    this.hillOwner = -2; this.hillAcc = 0;
    this.camSeed = 1 + Math.floor(Math.random() * 2147483646); this.cams = buildCameras(this.map, this.camSeed); this.camT0 = nowS();   // 2-3 randomly placed security cameras each match
    // pickups
    let kinds = this.map.pickups.map(p => p.kind);
    if (s.items === 'random') for (let i = kinds.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [kinds[i], kinds[j]] = [kinds[j], kinds[i]]; }
    const occ = {};
    kinds = kinds.map((k) => {
      const v = PICKUP_VARIANTS[k]; if (!v) return k;
      const n = occ[k] = (occ[k] || 0) + 1;
      return s.items === 'random' ? v[(Math.random() * v.length) | 0] : v[(n - 1) % v.length];
    });
    this.pickups = this.map.pickups.map((p, i) => ({ id: i, x: p.x, y: p.y, z: p.z, kind: kinds[i], active: true, at: 0 }));
    // mode state
    this.flags = null;
    if (s.mode === 'ctf') this.flags = this.map.flags.map((f, i) => ({ team: i, home: { x: f.x, y: f.y, z: f.z }, x: f.x, y: f.y, z: f.z, st: 0, carrier: null, droppedAt: 0 }));
    this.golden = { holder: null, x: this.map.golden.x, y: this.map.golden.y, z: this.map.golden.z };
    for (const p of this.players.values()) {
      p.kills = p.deaths = p.assists = p.caps = p.returns = p.score = 0;
      p.carrying = -1; p.alive = false; p.owned = new Set(['pistol']); p.minesOut = 0; p.laserOut = 0;
      p.streak = 0; p.offers = []; p.helmet = false; p.wall = false; p.exposedUntil = 0;
    }
    this.phase = 'countdown'; this.countdownEnd = nowS() + 3; this.timeLeft = s.time;
    this.broadcast(this.matchMsg());
    for (const p of this.players.values()) this.spawn(p);
    this.pushRoom();
  }

  spawn(p) {
    const m = this.map;
    let list = this.teamMode ? (p.team === 0 ? m.spawns.t0 : m.spawns.t1) : m.spawns.ffa;
    // pick the spawn farthest from living enemies
    let best = list[0], bs = -1;
    for (const sp of list) {
      let md = 1e9;
      for (const o of this.players.values()) {
        if (o === p || !o.alive) continue;
        if (this.teamMode && o.team === p.team) continue;
        md = Math.min(md, Math.hypot(o.x - sp.x, o.z - sp.z));
      }
      const sc = md + Math.random() * 6;
      if (sc > bs) { bs = sc; best = sp; }
    }
    p.x = best.x; p.y = best.y; p.z = best.z; p.vx = p.vy = p.vz = 0; p.yaw = best.yaw; p.pitch = 0;
    p.crouch = false; p.lean = 0; p.grounded = true;
    p.hp = 100; p.armor = 0; p.alive = true; p.protectUntil = nowS() + PROTECT_TIME + (this.phase === 'countdown' ? 3 : 0);
    p.owned = new Set(['pistol']); p.wpn = 'pistol'; p.mines = GADGETS.mine.start; p.lasers = GADGETS.laser.start; p.knives = GADGETS.knife.start; p.dmgBy.clear(); p.carrying = -1; p.lastIn = nowS();
    this.send(p, { t: 'spawn', x: best.x, y: best.y, z: best.z, yaw: best.yaw, mines: p.mines });
    if (p.bot) { p.bot.path = null; p.bot.nextGoal = 0; p.bot.target = null; }
  }

  endMatch(winner) {
    if (this.phase === 'ended') return;
    this.phase = 'ended'; this.winner = winner; this.endAt = nowS() + 12;
    this.vote = { options: this.pickVoteOptions(), votes: new Map() };
    this.broadcast({ t: 'end', winner, teamScore: this.teamScore, mode: this.settings.mode, players: this.playerStats(), teams: this.teamMode,
      vote: { options: this.vote.options, secs: 12 } });
    this.pushRoom();
  }

  playerStats() {
    return [...this.players.values()].map(p => ({ id: p.id, name: p.name, team: p.team, bot: !!p.bot, k: p.kills, d: p.deaths, a: p.assists, cp: p.caps, rt: p.returns, sc: p.score }));
  }

  checkWin() {
    const lim = this.settings.limit, id = this.settings.mode;
    if (this.teamMode) {
      for (const t of [0, 1]) if (this.teamScore[t] >= lim) return this.endMatch({ type: 'team', id: t });
    } else {
      for (const p of this.players.values()) if (p.score >= lim) return this.endMatch({ type: 'player', id: p.id });
    }
  }

  timeUp() {
    if (this.teamMode) {
      if (this.teamScore[0] === this.teamScore[1]) return this.endMatch({ type: 'draw' });
      return this.endMatch({ type: 'team', id: this.teamScore[0] > this.teamScore[1] ? 0 : 1 });
    }
    let best = null, tie = false;
    for (const p of this.players.values()) { if (!best || p.score > best.score) { best = p; tie = false; } else if (p.score === best.score) tie = true; }
    if (!best || tie || best.score === 0) return this.endMatch({ type: 'draw' });
    this.endMatch({ type: 'player', id: best.id });
  }

  // ------------------------------------------------------------ input from clients
  handle(p, msg) {
    switch (msg.t) {
      case 'in': return this.onInput(p, msg);
      case 'fire': return this.onFire(p, msg);
      case 'mine': return this.onMine(p, msg);
      case 'laser': return this.onLaser(p, msg);
      case 'throw': return this.onThrow(p, msg);
      case 'melee': return this.onMelee(p);
      case 'ks': return this.streaks.pick(p, msg.k);
      case 'cfg': return this.handleCfg(p, msg);
      case 'team': return this.handleTeam(p, msg.team | 0);
      case 'op': p.op = msg.op | 0; return this.pushRoom();
      case 'name': { const n = cleanName(msg.name); if (n) { p.name = n; this.pushRoom(); } return; }
      case 'start': if (p.id === this.hostId && this.phase === 'lobby') this.startMatch(); return;
      case 'lobby': if (p.id === this.hostId && this.phase === 'ended') { this.applyVote(this.resolveVote()); this.phase = 'lobby'; this.pushRoom(); } return;
      case 'vote': return this.onVote(p, msg);
      case 'call': return this.onCall(p, msg);
      case 'ping': return this.send(p, { t: 'pong', ts: msg.ts });
    }
  }

  onInput(p, m) {
    if (!p.alive || this.phase === 'ended') return;
    const t = nowS(); const dt = Math.min(0.5, Math.max(0.001, t - p.lastIn)); p.lastIn = t;
    const x = +m.x, y = +m.y, z = +m.z;
    if (![x, y, z].every(Number.isFinite)) return;
    const dist = Math.hypot(x - p.x, z - p.z);
    const allowed = P.sprint * 1.5 * dt + 1.2;
    if (dist > allowed + 3 || Math.abs(y - p.y) > 14 * dt + 4) { this.send(p, { t: 'tp', x: p.x, y: p.y, z: p.z }); return; }
    p.x = Math.max(-28, Math.min(28, x)); p.z = Math.max(-28, Math.min(28, z)); p.y = Math.max(-10, Math.min(30, y));
    p.yaw = +m.a || 0; p.pitch = Math.max(-1.6, Math.min(1.6, +m.p || 0));
    p.crouch = !!m.c; p.lean = Math.max(-1, Math.min(1, +m.l || 0)); p.ads = !!m.ad;
    if (WEAPONS[m.w] && p.owned.has(m.w)) p.wpn = m.w;
    if (p.y < -9) this.damage(p, 999, null, 'fall', false);
  }

  onFire(p, m) {
    const o = Array.isArray(m.o) ? m.o : null, d = Array.isArray(m.d) ? m.d : null;
    if (!o || !d || ![...o, ...d].every(Number.isFinite)) return;
    const eye = [p.x, this.eyeY(p), p.z];
    const origin = Math.hypot(o[0] - eye[0], o[1] - eye[1], o[2] - eye[2]) < 2.2 ? o : eye;
    this.fire(p, m.w, origin, norm3(d), !!m.ad);
  }

  /** Authoritative hitscan. Shared by humans and bots. */
  fire(p, wid, origin, dir, ads) {
    if (!p.alive || this.phase !== 'play') return;
    const w = WEAPONS[wid] || (wid === 'sentry' ? SENTRY_W : null);
    if (!w || !p.owned.has(wid)) return;
    const t = nowS();
    if (t - (p.lastFire[wid] || 0) < (1 / w.rate) * 0.8) return;
    p.lastFire[wid] = t;
    if (w.kind === 'rocket') {
      this.spawnProjectile(p, 'rocket', origin, dir, w.speed);
      this.emit({ e: 'shot', id: p.id, w: wid, o: [r2(origin[0]), r2(origin[1]), r2(origin[2])], ends: [] });
      return;
    }
    const spread = ads ? w.adsSpread : w.spread;
    const ends = [];
    for (let i = 0; i < w.pellets; i++) {
      let d = dir;
      if (spread > 0) {
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
        // build a perpendicular basis
        const up = Math.abs(dir[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
        const rx = norm3([dir[1] * up[2] - dir[2] * up[1], dir[2] * up[0] - dir[0] * up[2], dir[0] * up[1] - dir[1] * up[0]]);
        const ry = [dir[1] * rx[2] - dir[2] * rx[1], dir[2] * rx[0] - dir[0] * rx[2], dir[0] * rx[1] - dir[1] * rx[0]];
        d = norm3([dir[0] + (rx[0] * Math.cos(a) + ry[0] * Math.sin(a)) * r, dir[1] + (rx[1] * Math.cos(a) + ry[1] * Math.sin(a)) * r, dir[2] + (rx[2] * Math.cos(a) + ry[2] * Math.sin(a)) * r]);
      }
      const wh = raycast(this.map.boxes, origin, d, w.range);
      let maxT = wh ? wh.t : w.range, victim = null, vhead = false, uhit = null;
      const uh = this.streaks.hitUnits(origin, d, maxT, p);
      if (uh) { maxT = uh.t; uhit = uh.unit; }
      for (const o of this.players.values()) {
        if (o === p || !o.alive || o.id === p.ownerId) continue;
        if (this.teamMode && o.team === p.team) continue;
        const h = o.crouch ? P.hc : P.h, R = 0.45; // slightly generous hitbox to forgive network latency
        const tt = rayAABB(origin[0], origin[1], origin[2], d[0], d[1], d[2], o.x - R, o.y, o.z - R, o.x + R, o.y + h, o.z + R);
        if (tt >= 0 && tt < maxT) { maxT = tt; victim = o; uhit = null; vhead = (origin[1] + d[1] * tt) > o.y + h - 0.36; }
      }
      ends.push([r2(origin[0] + d[0] * maxT), r2(origin[1] + d[1] * maxT), r2(origin[2] + d[2] * maxT)]);
      if (victim && vhead && victim.helmet) { vhead = false; victim.helmet = false; this.emit({ e: 'helmet', id: victim.id, x: r2(victim.x), y: r2(victim.y + 1.7), z: r2(victim.z) }); }
      if (victim) {
        let dmg = w.dmg * (vhead ? w.hs : 1);
        if (!w.nofall) dmg *= 1 - 0.5 * Math.pow(maxT / w.range, 2);
        this.damage(victim, dmg, p, wid, vhead, !!w.pierce);
      } else if (uhit) {
        let dmg = w.dmg; if (!w.nofall) dmg *= 1 - 0.5 * Math.pow(maxT / w.range, 2);
        this.streaks.damage(uhit, dmg, p, wid);
      }
    }
    this.emit({ e: 'shot', id: p.id, w: wid, o: [r2(origin[0]), r2(origin[1]), r2(origin[2])], ends });
  }

  damage(v, amt, att, wid, head, pierce = false) {
    if (!v.alive) return;
    if (att && att.unit) { wid = att.unit.type; att = this.players.get(att.unit.owner) || null; if (!att) att = { id: 0, team: -1, unitOnly: true, kills: 0, score: 0, assists: 0 }; }
    const t = nowS();
    if (wid !== 'fall') {
      if (this.phase !== 'play') return;
      if (t < v.protectUntil) return;
      if (att && att !== v && this.teamMode && att.team === v.team) return;
    }
    const absorbed = pierce ? 0 : Math.min(v.armor, amt * 0.5);
    v.armor = Math.max(0, v.armor - absorbed);
    v.hp -= amt - absorbed;
    if (att && att !== v) {
      v.dmgBy.set(att.id, t);
      this.emit({ e: 'hit', hs: !!head, kill: v.hp <= 0 }, att.id);
      this.emit({ e: 'dmg', x: r2(att.x - v.x), z: r2(att.z - v.z) }, v.id);
    }
    if (v.hp <= 0) this.kill(v, att, wid, head);
  }

  kill(v, att, wid, head) {
    v.alive = false; v.exposedUntil = 0; v.hp = 0; v.deaths++; v.respawnAt = nowS() + RESPAWN_TIME; v.ads = false;
    const t = nowS();
    const ghost = att && att.unitOnly;                                // killed by the unit of a player who has since left
    if (ghost) att = null;
    const selfKill = !att || att === v;
    this.streaks.onDeath(v);
    if (!selfKill) {
      att.kills++;
      if (!UNIT_WIDS.has(wid)) this.streaks.onKill(att);
      for (const [id, at] of v.dmgBy) { if (id !== att.id && t - at < 8) { const a = this.players.get(id); if (a && (!this.teamMode || a.team === att.team)) a.assists++; } }
    }
    const mode = this.settings.mode;
    if (ghost) { /* no points */ } else if (mode === 'dm' && !selfKill) att.score++;
    else if (mode === 'dm' && selfKill) v.score = Math.max(0, v.score - 1);
    else if (mode === 'tdm' && !selfKill) this.teamScore[att.team]++;
    else if (mode === 'gg') {
      if (!selfKill) att.score += att.owned.has('golden') ? 2 : 1;
      if (this.golden.holder === v.id) {
        this.golden.holder = null; v.owned.delete('golden');
        this.golden.x = v.x; this.golden.y = v.y; this.golden.z = v.z;
        if (!selfKill && att.alive) this.takeGolden(att);
      }
    } else if (mode === 'kc') {
      this.tokens.push({ id: this.nextId++, x: v.x, y: v.y, z: v.z, team: v.team, at: t });
    }
    this.dropCarried(v);
    this.emit({ e: 'kill', a: selfKill ? null : att.id, v: v.id, w: wid, hs: !!head });
    this.checkWin();
  }

  takeGolden(p) {
    this.golden.holder = p.id; p.owned.add('golden'); p.wpn = 'golden';
    this.emit({ e: 'pick', kind: 'golden', w: 'golden' }, p.id);
    this.emit({ e: 'golden', by: p.id });
  }

  dropCarried(p) {
    if (p.carrying >= 0 && this.flags) {
      const f = this.flags[p.carrying];
      f.st = 2; f.carrier = null; f.x = p.x; f.y = p.y; f.z = p.z; f.droppedAt = nowS();
      this.emit({ e: 'flag', kind: 'dropped', team: f.team, by: p.id });
      p.carrying = -1;
    }
    if (this.settings.mode === 'gg' && this.golden.holder === p.id) {
      this.golden.holder = null; p.owned.delete('golden');
      this.golden.x = p.x; this.golden.y = p.y; this.golden.z = p.z;
    }
  }

  // ------------------------------------------------------------ mines
  onMine(p, m) {
    if (!p.alive || this.phase !== 'play' || p.mines <= 0 || p.minesOut >= 5) return;
    const pos = m.p, n = m.n;
    if (!Array.isArray(pos) || !Array.isArray(n) || ![...pos, ...n].every(Number.isFinite)) return;
    if (Math.hypot(pos[0] - p.x, pos[1] - (p.y + 1), pos[2] - p.z) > 5) return;
    p.mines--; p.minesOut++;
    this.mines.push({ id: this.nextId++, owner: p.id, team: p.team, x: pos[0], y: pos[1], z: pos[2], nx: n[0], ny: n[1], nz: n[2], armAt: nowS() + 1.2 });
    this.emit({ e: 'mine', id: p.id });
  }

  explode(mine) {
    this.mines = this.mines.filter(m => m !== mine);
    const owner = this.players.get(mine.owner);
    if (owner) owner.minesOut = Math.max(0, owner.minesOut - 1);
    this.emit({ e: 'boom', x: r2(mine.x), y: r2(mine.y), z: r2(mine.z) });
    this.streaks.blast([mine.x, mine.y, mine.z], 4.5, 110, 25, owner || { id: mine.owner, team: mine.team }, 'mine');
    for (const o of [...this.players.values()]) {
      if (!o.alive) continue;
      if (owner && o === owner) continue;
      if (this.teamMode && o.team === mine.team) continue;
      const d = Math.hypot(o.x - mine.x, o.y + 0.9 - mine.y, o.z - mine.z);
      if (d > 4.5) continue;
      this.damage(o, Math.max(25, 110 * (1 - d / 4.5)), owner || null, 'mine', false);
    }
  }

  // ------------------------------------------------------------ laser mines
  onLaser(p, m) {
    const G = GADGETS.laser;
    if (!p.alive || this.phase !== 'play' || p.lasers <= 0 || p.laserOut >= G.maxOut) return;
    const pos = m.p, n = m.n;
    if (!Array.isArray(pos) || !Array.isArray(n) || ![...pos, ...n].every(Number.isFinite)) return;
    if (Math.hypot(pos[0] - p.x, pos[1] - (p.y + 1), pos[2] - p.z) > 5) return;
    const nn = norm3(n), org = [pos[0] + nn[0] * 0.06, pos[1] + nn[1] * 0.06, pos[2] + nn[2] * 0.06];
    const wh = raycast(this.map.boxes, org, nn, G.range);
    const len = wh ? wh.t : G.range;
    if (len < 0.8) return;                                           // no room for a beam
    p.lasers--; p.laserOut++;
    this.lasers.push({ id: this.nextId++, owner: p.id, team: p.team, x: org[0], y: org[1], z: org[2], nx: nn[0], ny: nn[1], nz: nn[2], len, armAt: nowS() + G.arm });
    this.emit({ e: 'mine', id: p.id });
  }

  tickLasers(t) {
    for (const L of [...this.lasers]) {
      if (t < L.armAt) continue;
      for (const o of this.players.values()) {
        if (!o.alive || o.id === L.owner) continue;
        if (this.teamMode && o.team === L.team) continue;
        const h = o.crouch ? P.hc : P.h, R = 0.4;
        const tt = rayAABB(L.x, L.y, L.z, L.nx, L.ny, L.nz, o.x - R, o.y, o.z - R, o.x + R, o.y + h, o.z + R);
        if (tt >= 0 && tt <= L.len) { this.detonateLaser(L, tt, o); break; }
      }
    }
  }

  /** The charge goes off where the beam was broken. */
  detonateLaser(L, tt, victim) {
    this.lasers = this.lasers.filter(x => x !== L);
    const owner = this.players.get(L.owner);
    if (owner) owner.laserOut = Math.max(0, owner.laserOut - 1);
    const G = GADGETS.laser;
    this.explodeAt([L.x + L.nx * tt, L.y + L.ny * tt, L.z + L.nz * tt], owner || null, 'laser', G.radius, G.dmg, G.minDmg, 0, victim || null);
  }

  // ------------------------------------------------------------ projectiles, splash, thrown knives, melee
  spawnProjectile(p, type, origin, dir, speed) {
    const pr = { id: this.nextId++, type, owner: p.id, team: p.team, x: origin[0], y: origin[1], z: origin[2],
      vx: dir[0] * speed, vy: dir[1] * speed, vz: dir[2] * speed, born: nowS() };
    this.projs.push(pr);
    return pr;
  }

  tickProjectiles(dt, t) {
    for (let i = this.projs.length - 1; i >= 0; i--) {
      const pr = this.projs[i];
      if (t - pr.born > 4) { this.projs.splice(i, 1); continue; }
      if (pr.type === 'knife') pr.vy -= GADGETS.knife.gravity * dt;
      const sp = Math.hypot(pr.vx, pr.vy, pr.vz), len = sp * dt;
      const d = [pr.vx / sp, pr.vy / sp, pr.vz / sp], o = [pr.x, pr.y, pr.z];
      const wh = raycast(this.map.boxes, o, d, len);
      let maxT = wh ? wh.t : len, victim = null;
      for (const q of this.players.values()) {
        if (!q.alive || q.id === pr.owner) continue;
        if (this.teamMode && q.team === pr.team) continue;
        const h = q.crouch ? P.hc : P.h, R = 0.5;
        const tt = rayAABB(o[0], o[1], o[2], d[0], d[1], d[2], q.x - R, q.y, q.z - R, q.x + R, q.y + h, q.z + R);
        if (tt >= 0 && tt < maxT) { maxT = tt; victim = q; }
      }
      let uvic = null;
      { const uh = this.streaks.hitUnits(o, d, maxT, { id: pr.owner, team: pr.team }); if (uh && uh.t <= maxT) { maxT = uh.t; uvic = uh.unit; victim = null; } }
      if (!wh && !victim && !uvic) { pr.x += d[0] * len; pr.y += d[1] * len; pr.z += d[2] * len; continue; }
      this.projs.splice(i, 1);
      const owner = this.players.get(pr.owner) || null;
      const hx = o[0] + d[0] * maxT, hy = o[1] + d[1] * maxT, hz = o[2] + d[2] * maxT;
      if (pr.type === 'rocket') {
        const W = WEAPONS.launcher;
        this.explodeAt([hx - d[0] * 0.3, hy - d[1] * 0.3, hz - d[2] * 0.3], owner, 'launcher', W.radius, W.dmg, W.minDmg, 0.6, victim);
      } else if (uvic) this.streaks.damage(uvic, GADGETS.knife.dmg, owner || { id: pr.owner, team: pr.team }, 'knife');
      else if (victim && owner) this.damage(victim, GADGETS.knife.dmg, owner, 'knife', false, true);
      else this.emit({ e: 'tink', x: r2(hx), y: r2(hy), z: r2(hz) });
    }
  }

  /** Radial blast with line-of-sight check. selfScale: 0 = owner immune, otherwise fraction of damage the owner takes. */
  explodeAt(pos, owner, wid, radius, maxDmg, minDmg, selfScale, direct) {
    this.emit({ e: 'boom', x: r2(pos[0]), y: r2(pos[1]), z: r2(pos[2]), r: radius });
    this.streaks.blast(pos, radius, maxDmg, minDmg, owner, wid);
    for (const o of [...this.players.values()]) {
      if (!o.alive) continue;
      if (owner && o === owner && selfScale === 0) continue;
      const cx = o.x, cy = o.y + (o.crouch ? 0.6 : 0.9), cz = o.z;
      const dx = cx - pos[0], dy = cy - pos[1], dz = cz - pos[2], d = Math.hypot(dx, dy, dz);
      if (d > radius) continue;
      if (d > 0.05) { const wall = raycast(this.map.boxes, pos, [dx / d, dy / d, dz / d], d); if (wall && wall.t < d - 0.35) continue; }
      let dmg = o === direct ? maxDmg : maxDmg + (minDmg - maxDmg) * (d / radius);
      if (owner && o === owner) dmg *= selfScale;
      this.damage(o, dmg, owner, wid, false, false);
    }
  }

  onThrow(p, m) {
    const G = GADGETS.knife, t = nowS();
    if (!p.alive || this.phase !== 'play' || p.knives <= 0 || t - p.lastThrow < G.cooldown) return;
    const o = Array.isArray(m.o) ? m.o : null, d = Array.isArray(m.d) ? m.d : null;
    if (!o || !d || ![...o, ...d].every(Number.isFinite)) return;
    const eye = [p.x, this.eyeY(p), p.z];
    const origin = Math.hypot(o[0] - eye[0], o[1] - eye[1], o[2] - eye[2]) < 2.2 ? o : eye;
    p.knives--; p.lastThrow = t;
    this.spawnProjectile(p, 'knife', origin, norm3(d), G.speed);
    this.emit({ e: 'throw', id: p.id, o: [r2(origin[0]), r2(origin[1]), r2(origin[2])] });
  }

  onMelee(p) {
    const G = GADGETS.melee, t = nowS();
    if (!p.alive || this.phase !== 'play' || t - p.lastMelee < G.cooldown) return;
    p.lastMelee = t;
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw), eye = [p.x, this.eyeY(p), p.z];
    let best = null, bd = 1e9;
    for (const o of this.players.values()) {
      if (o === p || !o.alive) continue;
      if (this.teamMode && o.team === p.team) continue;
      const dx = o.x - p.x, dz = o.z - p.z, d = Math.hypot(dx, dz);
      if (d > G.range || Math.abs(o.y - p.y) > 1.4) continue;
      if (d > 0.05 && (dx * fx + dz * fz) / d < G.cone) continue;      // must be in front
      const ty = o.y + 1.1, dist = Math.hypot(o.x - eye[0], ty - eye[1], o.z - eye[2]);
      if (raycast(this.map.boxes, eye, norm3([o.x - eye[0], ty - eye[1], o.z - eye[2]]), Math.max(0.1, dist - 0.2))) continue;
      if (d < bd) { bd = d; best = o; }
    }
    if (!best && this.streaks.melee(p, G.range, G.front)) { this.emit({ e: 'melee', id: p.id, hit: true }); return; }
    this.emit({ e: 'melee', id: p.id, hit: !!best });
    if (!best) return;
    const vfx = -Math.sin(best.yaw), vfz = -Math.cos(best.yaw), ax = best.x - p.x, az = best.z - p.z, al = Math.hypot(ax, az) || 1;
    const fromBehind = (vfx * ax + vfz * az) / al > 0.35;               // victim is looking the way the attacker is facing
    this.damage(best, fromBehind ? G.back : G.front, p, 'melee', false, true);
  }

  // ------------------------------------------------------------ pickups
  touchPickups(p, t) {
    for (const s of this.pickups) {
      if (!s.active) continue;
      if (Math.hypot(p.x - s.x, p.z - s.z) > 1.25 || Math.abs(p.y - s.y) > 1.6) continue;
      if (this.applyPickup(p, s)) { s.active = false; s.at = t + PICKUP_RESPAWN[s.kind]; this.emit({ e: 'pu', id: s.id, by: p.id }); }
    }
  }

  applyPickup(p, s) {
    const k = s.kind;
    if (k === 'health') { if (p.hp >= 100) return false; p.hp = Math.min(100, p.hp + 50); this.emit({ e: 'pick', kind: 'health' }, p.id); return true; }
    if (k === 'armor') { if (p.armor >= 100) return false; p.armor = Math.min(100, p.armor + 50); this.emit({ e: 'pick', kind: 'armor' }, p.id); return true; }
    if (k === 'mines') { const G = GADGETS.mine; if (p.mines >= G.carry) return false; p.mines = Math.min(G.carry, p.mines + G.batch); this.emit({ e: 'pick', kind: 'mines', mines: p.mines }, p.id); return true; }
    if (k === 'laser') { const G = GADGETS.laser; if (p.lasers >= G.carry) return false; p.lasers = Math.min(G.carry, p.lasers + G.batch); this.emit({ e: 'pick', kind: 'laser' }, p.id); return true; }
    if (k === 'knives') { const G = GADGETS.knife; if (p.knives >= G.carry) return false; p.knives = Math.min(G.carry, p.knives + G.batch); this.emit({ e: 'pick', kind: 'knives' }, p.id); return true; }
    if (k === 'ammo') {
      const guns = [...p.owned].filter(w => WEAPONS[w].reserve !== Infinity);
      if (!guns.length) return false;
      this.emit({ e: 'pick', kind: 'ammo' }, p.id); return true;
    }
    if (WEAPONS[k]) {
      let drop = null;
      if (this.settings.loadout === 'tactical' && !p.owned.has(k)) {
        const group = PRIMARY.includes(k) ? PRIMARY : SIDEARMS.includes(k) ? SIDEARMS : null;
        const have = group ? [...p.owned].filter(w => group.includes(w)) : [];
        if (group && have.length >= (group === PRIMARY ? 2 : 1)) { drop = have.includes(p.wpn) ? p.wpn : have[0]; p.owned.delete(drop); }
      }
      p.owned.add(k);
      this.emit({ e: 'pick', kind: 'weapon', w: k, drop }, p.id); return true;
    }
    return false;
  }

  // ------------------------------------------------------------ per-tick update
  update() {
    const t = nowS();
    this.tick++;
    if (this.phase === 'lobby') { if (this.tick % 15 === 0) this.snapshot(t); return; }
    if (this.phase === 'countdown' && t >= this.countdownEnd) { this.phase = 'play'; this.timeLeft = this.settings.time; this.matchEnd = t + this.settings.time; this.pushRoom(); }
    if (this.phase === 'ended') {
      if (t >= this.endAt) {
        const win = this.resolveVote();
        if (this.isPublic) this.nextPublicMatch(win);
        else { this.applyVote(win); this.phase = 'lobby'; this.pushRoom(); }
      }
      this.snapshot(t); return;
    }
    if (this.phase === 'play') this.timeLeft = Math.max(0, this.matchEnd - t);

    for (const p of this.players.values()) {
      if (p.bot) botThink(this, p, DT, t);
      if (!p.alive && this.phase !== 'ended' && t >= p.respawnAt) this.spawn(p);
    }
    if (this.phase === 'play') {
      for (const p of this.players.values()) if (p.alive) this.touchPickups(p, t);
      for (const s of this.pickups) if (!s.active && t >= s.at) { s.active = true; this.emit({ e: 'pr', id: s.id }); }
      this.tickMines(t);
      this.tickProjectiles(DT, t);
      this.tickLasers(t);
      this.tickCameras(t);
      this.streaks.tick(DT, t);
      this.tickMode(t);
      if (this.timeLeft <= 0) this.timeUp();
    }
    this.snapshot(t);
  }

  // ------------------------------------------------------------ map vote
  pickVoteOptions() {
    const ids = [...MAP_IDS];
    for (let i = ids.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [ids[i], ids[j]] = [ids[j], ids[i]]; }
    return ids.slice(0, Math.min(3, ids.length));
  }
  voteCounts() {
    const c = {}; if (!this.vote) return c;
    for (const o of this.vote.options) c[o] = 0;
    for (const [id, m] of this.vote.votes) if (this.players.has(id)) c[m]++;
    return c;
  }
  onVote(p, msg) {
    if (this.phase !== 'ended' || !this.vote || p.bot || !this.vote.options.includes(msg.map)) return;
    this.vote.votes.set(p.id, msg.map);
    this.broadcast({ t: 'votes', c: this.voteCounts() });
  }
  /** Winning map id (ties broken at random), or null when nobody voted. */
  resolveVote() {
    if (!this.vote) return null;
    const c = this.voteCounts(); const top = Math.max(0, ...Object.values(c));
    this.vote = null;
    if (top === 0) return null;
    const tied = Object.keys(c).filter(k => c[k] === top);
    return tied[(Math.random() * tied.length) | 0];
  }
  applyVote(win) {
    if (!win || !MAP_IDS.includes(win)) return;
    this.settings.map = win; this.map = getMap(win);
  }

  // ------------------------------------------------------------ team callouts (ping wheel)
  onCall(p, m) {
    const KINDS = ['ping', 'attack', 'defend', 'enemy', 'help', 'move'];
    if (!p.alive || !this.teamMode || this.phase !== 'play' || !KINDS.includes(m.k)) return;
    const pos = m.p;
    if (!Array.isArray(pos) || pos.length !== 3 || !pos.every(Number.isFinite)) return;
    if (Math.abs(pos[0]) > 30 || Math.abs(pos[2]) > 30 || pos[1] < -2 || pos[1] > 20) return;
    const t = nowS();
    if (t - (this.callAt.get(p.id) || 0) < 1) return;                 // one callout per second
    this.callAt.set(p.id, t);
    const ev = { e: 'call', id: p.id, k: m.k, p: [r2(pos[0]), r2(pos[1]), r2(pos[2])] };
    for (const q of this.humans) if (q.team === p.team) this.emit(ev, q.id);
  }

  nextPublicMatch(win) {
    this.rotation++;
    const maps = MAP_IDS, modes = ['dm', 'tdm', 'ctf', 'koth', 'kc', 'gg'];
    const mode = modes[this.rotation % modes.length];
    this.settings.map = win && MAP_IDS.includes(win) ? win : maps[this.rotation % maps.length];
    this.settings.mode = mode; this.settings.limit = MODES[mode].def;
    this.startMatch();
  }

  /** Security cameras: anyone inside a cone with a clear line of sight is exposed to the whole map for CAM.expose seconds (refreshed while they stay in view). */
  tickCameras(t) {
    if (!this.cams || !this.cams.length) return;
    const ct = t - this.camT0;
    for (const p of this.players.values()) {
      if (!p.alive || t < p.protectUntil) continue;
      const ci = camsSee(this.map.boxes, this.cams, ct, p.x, p.y, p.z, p.crouch);
      if (ci < 0) continue;
      const fresh = !(p.exposedUntil > t);
      p.exposedUntil = t + CAM.expose;
      if (fresh) this.emit({ e: 'camspot', id: p.id, c: ci, x: r2(p.x), y: r2(p.y), z: r2(p.z) });
    }
  }

  tickMines(t) {
    for (const m of [...this.mines]) {
      if (t < m.armAt) continue;
      for (const o of this.players.values()) {
        if (!o.alive || o.id === m.owner) continue;
        if (this.teamMode && o.team === m.team) continue;
        if (Math.hypot(o.x - m.x, o.y + 0.9 - m.y, o.z - m.z) < 2.2) { this.explode(m); break; }
      }
    }
  }

  tickMode(t) {
    const mode = this.settings.mode;
    if (mode === 'ctf' && this.flags) {
      for (const f of this.flags) {
        if (f.st === 1) { const c = this.players.get(f.carrier); if (c && c.alive) { f.x = c.x; f.y = c.y; f.z = c.z; } else { f.st = 2; f.carrier = null; f.droppedAt = t; } }
        if (f.st === 2 && t - f.droppedAt > 25) { f.st = 0; f.x = f.home.x; f.y = f.home.y; f.z = f.home.z; this.emit({ e: 'flag', kind: 'returned', team: f.team, auto: true }); }
      }
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        for (const f of this.flags) {
          if (Math.hypot(p.x - f.x, p.z - f.z) > 1.5 || Math.abs(p.y - f.y) > 2) continue;
          if (f.team !== p.team) {
            if (f.st !== 1 && p.carrying < 0) { f.st = 1; f.carrier = p.id; p.carrying = f.team; this.emit({ e: 'flag', kind: 'taken', team: f.team, by: p.id }); }
          } else if (f.st === 2) {
            f.st = 0; f.x = f.home.x; f.y = f.home.y; f.z = f.home.z; p.returns++; this.emit({ e: 'flag', kind: 'returned', team: f.team, by: p.id });
          } else if (f.st === 0 && p.carrying >= 0) {
            const ef = this.flags[p.carrying];
            ef.st = 0; ef.carrier = null; ef.x = ef.home.x; ef.y = ef.home.y; ef.z = ef.home.z;
            p.carrying = -1; p.caps++; this.teamScore[p.team]++;
            this.emit({ e: 'flag', kind: 'captured', team: ef.team, by: p.id });
            this.checkWin();
          }
        }
      }
    } else if (mode === 'koth') {
      const h = this.map.hill; const present = [0, 0];
      for (const p of this.players.values()) if (p.alive && Math.hypot(p.x - h.x, p.z - h.z) < h.r && Math.abs(p.y - h.y) < 1.6) present[p.team]++;
      if (present[0] && present[1]) this.hillOwner = -1;
      else if (present[0] || present[1]) {
        const owner = present[0] ? 0 : 1; this.hillOwner = owner; this.hillAcc += DT;
        if (this.hillAcc >= 1) { this.hillAcc -= 1; this.teamScore[owner]++; this.checkWin(); }
      } else this.hillOwner = -2;
    } else if (mode === 'kc') {
      this.tokens = this.tokens.filter(k => t - k.at < 25);
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        for (const k of [...this.tokens]) {
          if (Math.hypot(p.x - k.x, p.z - k.z) > 1.4 || Math.abs(p.y - k.y) > 2) continue;
          this.tokens = this.tokens.filter(q => q !== k);
          if (p.team !== k.team) { this.teamScore[p.team]++; p.score++; this.emit({ e: 'intel', kind: 'collect', by: p.id }); this.checkWin(); }
          else this.emit({ e: 'intel', kind: 'deny', by: p.id });
        }
      }
    } else if (mode === 'gg') {
      const g = this.golden;
      if (g.holder == null) {
        for (const p of this.players.values()) if (p.alive && Math.hypot(p.x - g.x, p.z - g.z) < 1.5 && Math.abs(p.y - g.y) < 2) { this.takeGolden(p); break; }
      } else { const h = this.players.get(g.holder); if (h && h.alive) { g.x = h.x; g.y = h.y; g.z = h.z; } else g.holder = null; }
    }
  }

  // ------------------------------------------------------------ snapshots
  snapshot(t) {
    if (!this.humans.length) { this.evAll = []; this.evTo.clear(); return; }
    const players = [];
    for (const p of this.players.values()) {
      players.push({
        i: p.id, x: r2(p.x), y: r2(p.y), z: r2(p.z), a: r2(p.yaw), p: r2(p.pitch), c: p.crouch ? 1 : 0, l: r2(p.lean),
        h: Math.round(p.hp), r: Math.round(p.armor), w: p.wpn, al: p.alive ? 1 : 0, ad: p.ads ? 1 : 0, pr: t < p.protectUntil ? 1 : 0,
        k: p.kills, d: p.deaths, as: p.assists, cp: p.caps, rt: p.returns, sc: p.score, tm: p.team,
        ex: p.exposedUntil > t ? 1 : 0, cr: p.carrying, gd: p.owned.has('golden') ? 1 : 0, mi: p.mines, lm: p.lasers, kn: p.knives, st: p.streak || 0, hm: p.helmet ? 1 : 0, ww: p.wall ? 1 : 0,
      });
    }
    const snap = {
      t: 's', ct: r2(t - (this.camT0 || t)), k: this.tick, ph: this.phase, tl: Math.ceil(this.timeLeft), cd: Math.max(0, Math.ceil(this.countdownEnd - t)),
      p: players, ts: this.teamScore,
      pk: this.pickups.map(s => s.active ? 1 : 0).join(''),
      m: this.mines.map(m => [m.id, r2(m.x), r2(m.y), r2(m.z), r2(m.nx), r2(m.ny), r2(m.nz), m.team, m.owner, t >= m.armAt ? 1 : 0]),
      pj: this.projs.map(q => [q.id, q.type === 'rocket' ? 0 : 1, r2(q.x), r2(q.y), r2(q.z), r2(q.vx), r2(q.vy), r2(q.vz)]),
      u: this.streaks.snapshot(),
      lz: this.lasers.map(L => [L.id, r2(L.x), r2(L.y), r2(L.z), r2(L.nx), r2(L.ny), r2(L.nz), r2(L.len), L.team, L.owner, t >= L.armAt ? 1 : 0]),
    };
    if (this.flags) snap.f = this.flags.map(f => [f.st, f.carrier, r2(f.x), r2(f.y), r2(f.z)]);
    if (this.settings.mode === 'koth') snap.h = this.hillOwner;
    if (this.settings.mode === 'kc') snap.tk = this.tokens.map(k => [k.id, r2(k.x), r2(k.y), r2(k.z), k.team]);
    if (this.settings.mode === 'gg') snap.g = [this.golden.holder, r2(this.golden.x), r2(this.golden.y), r2(this.golden.z)];
    const base = JSON.stringify(snap).slice(0, -1);
    for (const p of this.humans) {
      if (p.ws.readyState !== 1) continue;
      const ev = this.evTo.get(p.id);
      p.ws.send(`${base},"ev":${JSON.stringify(ev ? this.evAll.concat(ev) : this.evAll)}}`);
    }
    this.evAll = []; this.evTo.clear();
  }

  info() {
    return { code: this.code, map: this.settings.map, mode: this.settings.mode, players: this.humans.length, total: this.players.size, max: MAX_PLAYERS, phase: this.phase, time: Math.ceil(this.timeLeft), public: this.isPublic };
  }

  destroy() { clearInterval(this.interval); }
}

export function cleanName(n) {
  n = String(n || '').replace(/[^A-Za-z0-9 _-]/g, '').trim().slice(0, 14);
  return n.length >= 2 ? n : '';
}
