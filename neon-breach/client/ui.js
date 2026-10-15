// Menus, staging area, overlays and the settings panel. Game logic lives in game.js.
import { game, initGame, join, leave, send, sendVote, setTeam, sendCfg, startMatch, backToLobby, setOperator, isHost, requestLock, releaseLock, takeScreenshot } from './game.js';
import { settings, saveSettings, resetSection, onSettings, ACTIONS, bindLabel, OPERATORS, teamInfo, DEFAULTS } from './settings.js';
import { input } from './input.js';
import * as audio from './audio.js';
import { getMap, mapList } from '/shared/maps.js';
import { MODES } from '/shared/weapons.js';
import { boardHTML, esc } from './board.js';

const $ = (id) => document.getElementById(id);
const show = (id, on = true) => $(id).classList.toggle('hidden', !on);

// ------------------------------------------------------------------ helpers
const getPath = (o, p) => p.split('.').reduce((a, k) => a[k], o);
const setPath = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; };
const NAME_OK = /^[A-Za-z0-9 _-]{2,14}$/;

function randomName() { return 'Operator' + (10 + Math.floor(Math.random() * 90)); }

let audioStarted = false;
function startAudio() {
  if (audioStarted) return; audioStarted = true;
  audio.initAudio(); audio.setVolumes(settings.audio);
  audio.setMusic(game.view === 'match' ? 'match' : 'menu');
}
window.addEventListener('pointerdown', startAudio, { once: false });
window.addEventListener('keydown', startAudio);

// ------------------------------------------------------------------ views
function setView(v) {
  document.body.dataset.view = v;
  show('screen-menu', v === 'menu'); show('screen-lobby', v === 'lobby');
  if (v !== 'match') { show('deploy', false); show('pause', false); }
  if (v === 'menu') { show('end', false); refreshBrowser(); }
  if (v === 'lobby') show('end', false);
  syncOverlays();
}
game.on('view', setView);

function pad() { return input.usingPad && input.pad.connected; }

function syncOverlays() {
  if (game.view !== 'match') return;
  const ended = game.S.phase === 'ended';
  const settingsOpen = !$('settings').classList.contains('hidden');
  if (ended) { show('deploy', false); show('pause', false); return; }
  if (settingsOpen) { show('deploy', false); return; }
  if (input.locked || (pad() && !game.paused)) { show('deploy', false); show('pause', false); return; }
  if (game.paused) { show('deploy', false); show('pause', true); $('pause-mode').textContent = (MODES[game.mode] || {}).name || ''; }
  else { show('pause', false); show('deploy', true); }
}
setInterval(syncOverlays, 300);

input.on('lock', (locked) => {
  if (game.view !== 'match') return;
  if (locked) game.paused = false; else if (game.S.phase !== 'ended') game.paused = true;
  syncOverlays();
});
game.on('pause-toggle', () => { game.paused = !game.paused; syncOverlays(); });

$('deploy').addEventListener('click', () => { game.paused = false; requestLock(); setTimeout(syncOverlays, 120); });
$('btn-resume').addEventListener('click', () => { game.paused = false; requestLock(); setTimeout(syncOverlays, 120); });
$('btn-pause-settings').addEventListener('click', () => openSettings());
$('btn-pause-leave').addEventListener('click', () => doLeave());

function doLeave() { leave(); show('end', false); show('pause', false); show('disc', false); }

// ------------------------------------------------------------------ menu
const nameIn = $('in-name'), codeIn = $('in-code'), errEl = $('menu-err');
nameIn.value = settings.name || (settings.name = randomName(), saveSettings(), settings.name);
nameIn.addEventListener('input', () => { if (NAME_OK.test(nameIn.value.trim())) { settings.name = nameIn.value.trim(); saveSettings(); if (game.view !== 'menu') send({ t: 'name', name: settings.name }); } });
codeIn.addEventListener('input', () => { codeIn.value = codeIn.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
codeIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-join').click(); });

function menuError(msg) { errEl.textContent = msg; show('menu-err', !!msg); }

async function doJoin(opts) {
  startAudio(); menuError('');
  const n = nameIn.value.trim();
  if (!NAME_OK.test(n)) { menuError('Pick a codename of 2–14 letters, digits, spaces, _ or -.'); nameIn.focus(); return; }
  settings.name = n; saveSettings();
  try { await join(opts); audio.play('click'); } catch (e) { menuError(e.message || 'Could not join.'); }
}
$('btn-quick').addEventListener('click', () => doJoin({ quick: true }));
$('btn-create').addEventListener('click', () => doJoin({ create: true }));
$('btn-join').addEventListener('click', () => { if (codeIn.value.length < 4) { menuError('Enter the 4-character room code.'); codeIn.focus(); return; } doJoin({ room: codeIn.value }); });
$('btn-settings').addEventListener('click', () => openSettings());
$('btn-lb-settings').addEventListener('click', () => openSettings());
$('btn-leave').addEventListener('click', () => doLeave());

let browserTimer = 0;
async function refreshBrowser() {
  clearTimeout(browserTimer);
  if (game.view !== 'menu') return;
  try {
    const rooms = await (await fetch('/api/rooms', { cache: 'no-store' })).json();
    const body = $('browser-body');
    if (!rooms.length) body.innerHTML = '<tr><td colspan="6" class="dim">No public rooms right now.</td></tr>';
    else body.innerHTML = rooms.map(r => {
      const m = getMap(r.map), mode = MODES[r.mode];
      const t = r.phase === 'play' ? `${Math.floor(r.time / 60)}:${String(r.time % 60).padStart(2, '0')}` : r.phase === 'countdown' ? 'starting' : r.phase;
      return `<tr><td><b>${esc(r.code)}</b></td><td>${esc(m.name)}</td><td>${esc(mode.name)}</td><td>${r.players} / ${r.max}${r.total > r.players ? ` <span class="dim">+${r.total - r.players} bots</span>` : ''}</td><td>${t}</td><td><button class="btn" data-room="${esc(r.code)}" ${r.players >= r.max ? 'disabled' : ''}>Join</button></td></tr>`;
    }).join('');
  } catch { /* server unreachable; keep old rows */ }
  browserTimer = setTimeout(refreshBrowser, 4000);
}
$('browser-body').addEventListener('click', (e) => { const b = e.target.closest('button[data-room]'); if (b) doJoin({ room: b.dataset.room }); });

// ------------------------------------------------------------------ staging area
const cfg = {
  map: $('cf-map'), mode: $('cf-mode'), limit: $('cf-limit'), time: $('cf-time'), bots: $('cf-bots'),
  weather: $('cf-weather'), items: $('cf-items'), loadout: $('cf-loadout'),
};
const BOT_LABELS = { 0: 'Off — humans only', 2: 'Fill to 2 operators', 4: 'Fill to 4 operators', 6: 'Fill to 6 operators', 8: 'Fill to 8 operators' };
function fillSelect(sel, opts) { sel.innerHTML = opts.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join(''); }
fillSelect(cfg.map, mapList().map(m => [m.id, m.name]));
fillSelect(cfg.mode, Object.values(MODES).map(m => [m.id, m.name]));
fillSelect(cfg.time, [180, 300, 480, 600, 900].map(s => [s, `${s / 60} minutes`]));
fillSelect(cfg.bots, [0, 2, 4, 6, 8].map(n => [n, BOT_LABELS[n]]));

cfg.map.addEventListener('change', () => sendCfg({ map: cfg.map.value }));
cfg.mode.addEventListener('change', () => sendCfg({ mode: cfg.mode.value }));
cfg.limit.addEventListener('change', () => sendCfg({ limit: +cfg.limit.value }));
cfg.time.addEventListener('change', () => sendCfg({ time: +cfg.time.value }));
cfg.bots.addEventListener('change', () => sendCfg({ bots: +cfg.bots.value }));
cfg.weather.addEventListener('change', () => sendCfg({ weather: cfg.weather.value }));
cfg.items.addEventListener('change', () => sendCfg({ items: cfg.items.value }));
cfg.loadout.addEventListener('change', () => sendCfg({ loadout: cfg.loadout.value }));

$('btn-start').addEventListener('click', () => { startAudio(); startMatch(); });
$('btn-copy').addEventListener('click', async () => {
  const link = `${location.origin}/?room=${game.code}`;
  try { await navigator.clipboard.writeText(link); } catch {
    const t = document.createElement('textarea'); t.value = link; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch { /* ignore */ } t.remove();
  }
  $('btn-copy').textContent = 'Copied!'; setTimeout(() => { $('btn-copy').textContent = 'Copy invite link'; }, 1500);
});

function opSwatch(i) {
  const pics = game.getPortraits && game.getPortraits();
  if (pics && pics[i]) return `<img class="portrait" alt="" src="${pics[i]}">`;
  const o = OPERATORS[i], c = (a) => `rgb(${a.map(v => Math.round(v * 255)).join(',')})`;
  return `<div class="fig" style="background:${c(o.suit)};--skin:${c(o.skin)};--trim:${c(o.trim)}"></div>`;
}
function buildOpGrid(el, onPick) {
  el.innerHTML = OPERATORS.map((o, i) => `<button class="op ${i === settings.op ? 'on' : ''}" data-op="${i}" aria-label="Operator ${o.name}">${opSwatch(i)}${o.name}</button>`).join('');
  el.onclick = (e) => { const b = e.target.closest('[data-op]'); if (!b) return; settings.op = +b.dataset.op; saveSettings(); onPick(settings.op); buildOpGrid(el, onPick); };
}

function renderLobby(m) {
  const host = m.host === game.myId, s = m.settings, mode = MODES[s.mode];
  $('lb-code').textContent = m.code;
  $('lb-role').textContent = host ? 'You are host' : 'Host: ' + ((m.players.find(p => p.id === m.host) || {}).name || '—');
  $('lb-count').textContent = `${m.players.filter(p => !p.bot).length} / ${m.max}`;
  const setIf = (sel, v) => { if (document.activeElement !== sel && String(sel.value) !== String(v)) sel.value = v; };
  setIf(cfg.map, s.map); setIf(cfg.mode, s.mode);
  const lim = mode.limits;
  if (cfg.limit.dataset.mode !== s.mode) { cfg.limit.dataset.mode = s.mode; fillSelect(cfg.limit, lim.map(v => [v, String(v)])); }
  $('cf-limitlabel').textContent = mode.limitLabel;
  setIf(cfg.limit, s.limit); setIf(cfg.time, s.time); setIf(cfg.bots, s.bots); setIf(cfg.weather, s.weather); setIf(cfg.items, s.items); setIf(cfg.loadout, s.loadout);
  for (const el of Object.values(cfg)) el.disabled = !host;
  $('cf-mapdesc').textContent = getMap(s.map).desc; $('cf-modedesc').textContent = mode.desc;
  show('btn-start', host); $('btn-start').disabled = m.phase !== 'lobby';
  // roster
  const teams = $('lb-teams'); teams.classList.toggle('two', mode.team);
  const member = (p) => `<div class="member ${p.id === game.myId ? 'me' : ''}"><i class="dot" style="background:rgb(${OPERATORS[p.op % 6].trim.map(v => Math.round(v * 255)).join(',')})"></i>${esc(p.name)}${p.bot ? ' <em>BOT</em>' : ''}${p.id === m.host ? ' <span class="crown" title="Host">★</span>' : ''}</div>`;
  if (mode.team) {
    teams.innerHTML = [0, 1].map(t => {
      const ti = teamInfo(t), list = m.players.filter(p => p.team === t), mine = (m.players.find(p => p.id === game.myId) || {}).team === t;
      return `<div class="squad" style="--tc:${ti.css}"><header><b>${ti.shape} ${ti.name}</b><span class="dim">${list.length}</span>${mine ? '' : `<button class="btn" data-team="${t}">Join ${ti.name}</button>`}</header>${list.map(member).join('')}</div>`;
    }).join('');
  } else teams.innerHTML = `<div class="squad" style="--tc:#3de0c8"><header><b>FREE-FOR-ALL</b></header>${m.players.map(member).join('')}</div>`;
  show('lb-teamhint', mode.team);
  buildOpGrid($('op-grid'), (i) => setOperator(i));
}
$('lb-teams').addEventListener('click', (e) => { const b = e.target.closest('[data-team]'); if (b) setTeam(+b.dataset.team); });
game.on('room', (m) => { if (m.phase === 'lobby') renderLobby(m); });
game.on('view', (v) => { if (v === 'lobby' && game.room) renderLobby(game.room); });

// ------------------------------------------------------------------ end screen
game.on('match', () => { show('end', false); stopVote(); });
game.on('end', (m) => {
  const mine = game.roster.get(game.myId) || {};
  let title = 'DRAW', cls = '', sub = '';
  if (m.winner.type === 'team') { const won = mine.team === m.winner.id; title = won ? 'VICTORY' : 'DEFEAT'; cls = won ? 'win' : 'lose'; sub = teamInfo(m.winner.id).name + ' wins'; }
  else if (m.winner.type === 'player') { const won = m.winner.id === game.myId; title = won ? 'VICTORY' : 'DEFEAT'; cls = won ? 'win' : 'lose'; const w = m.players.find(p => p.id === m.winner.id); sub = w ? w.name + ' wins' : ''; }
  $('end-title').textContent = title; $('end-title').className = cls;
  const players = m.players.map(p => ({ ...p, a: p.a, cp: p.cp, rt: p.rt, op: (game.roster.get(p.id) || {}).op || 0 }));
  $('end-board').innerHTML = (sub ? `<p class="hint" style="text-align:center;margin:0 0 8px">${esc(sub)}</p>` : '') + boardHTML({ players, teamMode: m.teams, mode: m.mode, myId: game.myId, teamScore: m.teamScore || [0, 0], winner: m.winner });
  const pub = game.room && game.room.public, host = isHost();
  show('btn-rematch', !pub && host);
  $('end-next').textContent = pub ? 'The next match starts automatically on the winning map.' : 'Returning to the staging area with the winning map…';
  renderVote(m.vote);
  show('end', true); show('deploy', false); show('pause', false); show('settings', false);
});
// ---- map vote
let voteTimer = 0, myVote = null;
function stopVote() { clearInterval(voteTimer); voteTimer = 0; myVote = null; show('vote', false); }
function renderVote(v) {
  stopVote();
  if (!v || !v.options || !v.options.length) return;
  $('vote-cards').innerHTML = v.options.map(id => { const m = getMap(id); return `<button class="votecard" data-map="${esc(id)}"><b>${esc(m.name)}</b><small>${esc(m.desc)}</small><span class="cnt">0</span></button>`; }).join('');
  show('vote', true);
  let left = v.secs || 12;
  const tick = () => { $('vote-timer').textContent = left > 0 ? `Voting closes in ${left}s` : 'Counting votes…'; left--; if (left < -1) clearInterval(voteTimer); };
  tick(); voteTimer = setInterval(tick, 1000);
}
$('vote-cards').addEventListener('click', (e) => {
  const b = e.target.closest('[data-map]'); if (!b) return;
  myVote = b.dataset.map; sendVote(myVote); audio.play('vote');
  for (const el of $('vote-cards').children) el.classList.toggle('on', el.dataset.map === myVote);
});
game.on('votes', (c) => { for (const el of $('vote-cards').children) el.querySelector('.cnt').textContent = c[el.dataset.map] || 0; });
$('btn-rematch').addEventListener('click', () => { backToLobby(); startMatch(); });
$('btn-end-leave').addEventListener('click', () => doLeave());
$('btn-shot').addEventListener('click', () => { takeScreenshot(); });
game.on('shot', () => { const a = document.createElement('a'); a.href = game.shotURL; a.download = `neon-breach-${Date.now()}.png`; a.click(); });

game.on('view', (v) => { if (v !== 'match') stopVote(); });
game.on('disconnect', () => { show('disc', true); show('deploy', false); show('pause', false); releaseLock(); });
$('btn-disc').addEventListener('click', () => doLeave());
game.on('err', (m) => { if (game.view === 'menu') menuError(m); });
game.on('fatal', (msg) => { $('fatal-msg').textContent = msg; show('fatal', true); });

// ------------------------------------------------------------------ settings panel
const N = (path, label, min, max, step, note) => ({ type: 'range', path, label, min, max, step, note });
const C = (path, label, note) => ({ type: 'check', path, label, note });
const SEL = (path, label, options, note) => ({ type: 'select', path, label, options, note });
const TABS = {
  Graphics: { reset: ['gfx'], items: [
    SEL('gfx.quality', 'Quality', [['high', 'High'], ['medium', 'Medium (75% resolution)'], ['low', 'Low (50% resolution)']], 'Lower the render resolution for smoother play'),
    N('gfx.brightness', 'Brightness', 0.6, 1.6, 0.05), N('gfx.fov', 'Field of view', 70, 110, 1, 'Horizontal, in degrees'),
    N('gfx.fogScale', 'View distance', 0.6, 1.8, 0.05), C('gfx.particles', 'Impact particles'),
  ] },
  Sight: { reset: ['sight'], items: [
    SEL('sight.shape', 'Reticle shape', [['dot', 'Red dot'], ['cross', 'Crosshair'], ['circle', 'Ring'], ['chevron', 'Chevron']]),
    SEL('sight.color', 'Reticle colour', [['red', 'Red'], ['green', 'Green']]), N('sight.size', 'Reticle size', 0.6, 2.2, 0.1),
  ] },
  Audio: { reset: ['audio'], items: [
    N('audio.master', 'Master', 0, 1, 0.05), N('audio.sfx', 'Effects', 0, 1, 0.05), N('audio.ui', 'Interface', 0, 1, 0.05), N('audio.music', 'Music', 0, 1, 0.05),
  ] },
  'Mouse & Keyboard': { reset: ['mouse', 'keys'], keys: true, items: [
    N('mouse.sens', 'Sensitivity', 0.2, 3, 0.05), N('mouse.adsMult', 'Aim-down-sights multiplier', 0.3, 1.2, 0.05), C('mouse.invert', 'Invert vertical look'),
  ] },
  Controller: { reset: ['pad'], items: [
    N('pad.sens', 'Look sensitivity', 0.3, 2.5, 0.05), N('pad.deadzone', 'Dead zone', 0.05, 0.4, 0.01), C('pad.invert', 'Invert vertical look'),
    { type: 'note', text: 'Left stick move · right stick aim · LT aim · RT fire · A jump · B crouch · X reload · Y switch weapon · LB proximity mine · RB throwing knife · left-stick click laser mine · right-stick click melee · D-pad left-right lean · D-pad up callout wheel (flick the right stick, release) · View scoreboard · Menu pause.' },
  ] },
  Operator: { reset: [], operator: true, items: [] },
  HUD: { reset: ['hud'], items: [ C('hud.minimap', 'Show minimap'), N('hud.mapSize', 'Minimap size', 0.7, 1.6, 0.05), C('hud.mapRotate', 'Rotate minimap with view') ] },
  Accessibility: { reset: ['access'], items: [
    SEL('access.colorVision', 'Colour vision', [['none', 'Standard'], ['deuter', 'Red-green (deuteranopia / protanopia)'], ['protan', 'Red-green (alternate)'], ['tritan', 'Blue-yellow (tritanopia)']], 'Swaps the team colours for a palette that stays distinct'),
    C('access.shapeCues', 'Shape cues', 'Adds ■ / ▲ team shapes and marks visible enemies with ▼'), C('access.reduceShake', 'Reduce camera motion', 'Turns off view bob and screen shake'),
  ] },
};
let curTab = 'Graphics', capturing = false;

function openSettings(tab) {
  if (tab) curTab = tab;
  show('settings', true); renderSettings(); syncOverlays();
}
function closeSettings() { if (capturing) return; show('settings', false); syncOverlays(); }
$('btn-settings-close').addEventListener('click', closeSettings);
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('settings').classList.contains('hidden')) closeSettings(); });
$('settings').addEventListener('mousedown', (e) => { if (e.target === $('settings')) closeSettings(); });
$('btn-set-reset').addEventListener('click', () => {
  const t = TABS[curTab];
  if (t.operator) { settings.op = 0; saveSettings(); setOperator(0); } else t.reset.forEach(resetSection);
  renderSettings();
});

function renderSettings() {
  $('set-tabs').innerHTML = Object.keys(TABS).map(t => `<button class="${t === curTab ? 'on' : ''}" data-tab="${esc(t)}">${esc(t)}</button>`).join('');
  const tab = TABS[curTab], body = $('set-body'); body.innerHTML = '';
  for (const it of tab.items) body.appendChild(settingRow(it));
  if (tab.keys) {
    const h = document.createElement('div'); h.className = 'full'; h.innerHTML = '<h2 style="margin:18px 0 4px">Key bindings</h2><p class="hint">Click a binding, then press a key or mouse button. Esc cancels.</p>'; body.appendChild(h);
    for (const [act, label] of ACTIONS) body.appendChild(keyRow(act, label));
  }
  if (tab.operator) body.appendChild(operatorPanel());
}
$('set-tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) { curTab = b.dataset.tab; renderSettings(); } });

function settingRow(it) {
  const row = document.createElement('div');
  if (it.type === 'note') { row.className = 'full hint'; row.textContent = it.text; return row; }
  row.className = 'srow';
  const lab = document.createElement('label'); lab.innerHTML = esc(it.label) + (it.note ? `<small>${esc(it.note)}</small>` : ''); row.appendChild(lab);
  const cur = getPath(settings, it.path);
  if (it.type === 'range') {
    const inp = document.createElement('input'); inp.type = 'range'; inp.min = it.min; inp.max = it.max; inp.step = it.step; inp.value = cur;
    const val = document.createElement('span'); val.className = 'val'; val.textContent = (+cur).toFixed(it.step < 0.1 ? 2 : it.step < 1 ? 1 : 0);
    inp.addEventListener('input', () => { setPath(settings, it.path, +inp.value); val.textContent = (+inp.value).toFixed(it.step < 0.1 ? 2 : it.step < 1 ? 1 : 0); saveSettings(); });
    row.append(inp, val);
  } else if (it.type === 'check') {
    const inp = document.createElement('input'); inp.type = 'checkbox'; inp.checked = !!cur;
    inp.addEventListener('change', () => { setPath(settings, it.path, inp.checked); saveSettings(); });
    row.appendChild(inp);
  } else if (it.type === 'select') {
    const sel = document.createElement('select'); sel.innerHTML = it.options.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join(''); sel.value = cur;
    sel.addEventListener('change', () => { setPath(settings, it.path, sel.value); saveSettings(); if (it.path === 'access.colorVision' && game.room) renderLobbyIfNeeded(); });
    row.appendChild(sel);
  }
  return row;
}
function renderLobbyIfNeeded() { if (game.view === 'lobby' && game.room) renderLobby(game.room); }

function keyRow(act, label) {
  const row = document.createElement('div'); row.className = 'srow';
  row.innerHTML = `<label>${esc(label)}</label>`;
  const b = document.createElement('button'); b.className = 'btn keybtn'; b.textContent = bindLabel(settings.keys[act]);
  b.addEventListener('click', () => {
    if (capturing) return;
    capturing = true; b.textContent = 'Press a key…'; b.classList.add('wait');
    input.capture((code) => {
      setTimeout(() => { capturing = false; }, 50);
      if (code) {
        for (const k of Object.keys(settings.keys)) if (settings.keys[k] === code && k !== act) settings.keys[k] = settings.keys[act];  // swap on conflict
        settings.keys[act] = code; saveSettings();
      }
      renderSettings();
    });
  });
  row.appendChild(b); return row;
}

function operatorPanel() {
  const wrap = document.createElement('div'); wrap.className = 'full';
  wrap.innerHTML = `<label class="field"><span>Codename</span><input id="set-name" maxlength="14" value="${esc(settings.name)}" spellcheck="false"></label>
    <p class="hint">Shown to everyone in the room — 2 to 14 letters, digits, spaces, _ or -. A new codename applies the next time you join a match.</p>
    <h2 style="margin:18px 0 8px">Operator</h2><div class="opgrid" id="set-ops"></div>
    <p class="hint">Pick the operator you deploy as. Everyone in the room sees your pick; in team modes your squad colour stays on the armband and name tag. In the lobby the change is immediate — during a match it takes effect at your next respawn.</p>`;
  setTimeout(() => {
    const n = $('set-name');
    if (n) n.addEventListener('input', () => { if (NAME_OK.test(n.value.trim())) { settings.name = n.value.trim(); nameIn.value = settings.name; saveSettings(); if (game.view !== 'menu') send({ t: 'name', name: settings.name }); } });
    buildOpGrid($('set-ops'), (i) => { if (game.view !== 'menu') setOperator(i); });
  });
  return wrap;
}

// ------------------------------------------------------------------ boot
export function boot() {
  const ok = initGame();
  $('loading').classList.add('done'); setTimeout(() => $('loading').remove(), 600);
  if (!ok) return;
  setView('menu');
  const room = new URLSearchParams(location.search).get('room');
  if (room) { codeIn.value = room.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4); doJoin({ room: codeIn.value }); }
  window.__nb = game;
}
