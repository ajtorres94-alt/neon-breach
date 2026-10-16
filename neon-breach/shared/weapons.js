// Weapon, pickup and game-mode definitions shared by client and server.

export const WEAPONS = {
  // ---- sidearms
  pistol:   { id: 'pistol',   name: 'PP9 PISTOL',      cat: 'side', dmg: 24,  rate: 5.5, auto: false, mag: 12, reserve: Infinity, reload: 1.1,
              spread: 0.016, adsSpread: 0.003, pellets: 1, range: 90,  zoom: 1.2,  recoil: 0.010, hs: 1.8, color: '#9aa4b2' },
  revolver: { id: 'revolver', name: 'R-6 REVOLVER',    cat: 'side', dmg: 51,  rate: 2.0, auto: false, mag: 6,  reserve: 24, reload: 2.0, pierce: true, nofall: true,
              spread: 0.010, adsSpread: 0.0015, pellets: 1, range: 110, zoom: 1.25, recoil: 0.030, hs: 1.4, color: '#e3c58a' },
  deagle:   { id: 'deagle',   name: 'DE-7 HAND CANNON', cat: 'side', dmg: 101, rate: 1.6, auto: false, mag: 7,  reserve: 21, reload: 2.0, pierce: true, nofall: true,
              spread: 0.012, adsSpread: 0.002, pellets: 1, range: 100, zoom: 1.25, recoil: 0.050, hs: 1.0, color: '#d8dde6' },
  // ---- SMGs
  smg:      { id: 'smg',      name: 'VX SMG',          cat: 'smg', dmg: 13, rate: 13,   auto: true,  mag: 32, reserve: 128, reload: 1.5,
              spread: 0.034, adsSpread: 0.012, pellets: 1, range: 70,  zoom: 1.3,  recoil: 0.007, hs: 1.7, color: '#6fd3ff' },
  mp5:      { id: 'mp5',      name: 'MK-5 SMG',        cat: 'smg', dmg: 15, rate: 11.5, auto: true,  mag: 30, reserve: 120, reload: 1.6,
              spread: 0.026, adsSpread: 0.007, pellets: 1, range: 75,  zoom: 1.4,  recoil: 0.0065, hs: 1.7, color: '#8fb3ff' },
  p90:      { id: 'p90',      name: 'PD-90 PDW',       cat: 'smg', dmg: 11, rate: 16,   auto: true,  mag: 50, reserve: 150, reload: 2.0,
              spread: 0.040, adsSpread: 0.012, pellets: 1, range: 65,  zoom: 1.35, recoil: 0.0055, hs: 1.7, color: '#a0ffd8' },
  // ---- assault rifles
  rifle:    { id: 'rifle',    name: 'KR-7 RIFLE',      cat: 'rifle', dmg: 22, rate: 8.5, auto: true, mag: 30, reserve: 120, reload: 1.8,
              spread: 0.020, adsSpread: 0.005, pellets: 1, range: 120, zoom: 1.7,  recoil: 0.010, hs: 1.8, color: '#9be37f' },
  aug:      { id: 'aug',      name: 'AUR-6 BULLPUP',   cat: 'rifle', dmg: 21, rate: 9,   auto: true, mag: 30, reserve: 120, reload: 1.9,
              spread: 0.018, adsSpread: 0.003, pellets: 1, range: 130, zoom: 2.2,  recoil: 0.0085, hs: 1.8, color: '#c7e0a0' },
  m4:       { id: 'm4',       name: 'CR-4 CARBINE',    cat: 'rifle', dmg: 24, rate: 10.5, auto: true, mag: 30, reserve: 120, reload: 1.7,
              spread: 0.022, adsSpread: 0.0045, pellets: 1, range: 105, zoom: 1.6, recoil: 0.011, hs: 1.8, color: '#6fe0a0' },
  // ---- shotguns
  shotgun:  { id: 'shotgun',  name: 'BREACHER',        cat: 'shotgun', dmg: 12, rate: 1.3, auto: false, mag: 6, reserve: 30, reload: 2.0,
              spread: 0.075, adsSpread: 0.055, pellets: 10, range: 40, zoom: 1.15, recoil: 0.040, hs: 1.5, color: '#ffb35c' },
  mossberg: { id: 'mossberg', name: 'RANGER PUMP',     cat: 'shotgun', dmg: 14, rate: 1.0, auto: false, mag: 8, reserve: 32, reload: 2.0,
              spread: 0.060, adsSpread: 0.042, pellets: 8, range: 38, zoom: 1.15, recoil: 0.045, hs: 1.5, color: '#d39a5a' },
  spas:     { id: 'spas',     name: 'SPARTAN 12',      cat: 'shotgun', dmg: 11, rate: 2.2, auto: false, mag: 8, reserve: 32, reload: 2.0,
              spread: 0.085, adsSpread: 0.060, pellets: 8, range: 32, zoom: 1.15, recoil: 0.030, hs: 1.5, color: '#e0b080' },
  // ---- heavy
  sniper:   { id: 'sniper',   name: 'LONGSHOT',        cat: 'heavy', dmg: 95, rate: 0.9, auto: false, mag: 5, reserve: 20, reload: 2.0, nofall: true,
              spread: 0.045, adsSpread: 0.0, pellets: 1, range: 220, zoom: 4.0, recoil: 0.045, hs: 1.6, color: '#d68cff' },
  launcher: { id: 'launcher', name: 'RL-7 LAUNCHER',   cat: 'heavy', kind: 'rocket', dmg: 150, minDmg: 20, radius: 5.5, speed: 38,
              rate: 0.5, auto: false, mag: 1, reserve: 3, reload: 2.0, spread: 0, adsSpread: 0, pellets: 1, range: 200, zoom: 1.3, recoil: 0.05, hs: 1, color: '#ff6b4a' },
  // ---- mode weapon
  golden:   { id: 'golden',   name: 'GOLDEN GUN',      cat: 'gold', dmg: 999, rate: 2.2, auto: false, mag: 1, reserve: Infinity, reload: 1.0, nofall: true,
              spread: 0.014, adsSpread: 0.002, pellets: 1, range: 120, zoom: 1.4, recoil: 0.020, hs: 1.0, color: '#ffd23f' },
};

/** Weapon categories in number-key order (1-6). Pressing a number again cycles within that category. */
export const CATEGORIES = ['side', 'smg', 'rifle', 'shotgun', 'heavy', 'gold'];
export const WEAPON_IDS = Object.keys(WEAPONS);
export const WEAPON_ORDER = CATEGORIES.flatMap(c => WEAPON_IDS.filter(w => WEAPONS[w].cat === c));
export const SIDEARMS = WEAPON_IDS.filter(w => WEAPONS[w].cat === 'side');
export const PRIMARY = WEAPON_IDS.filter(w => ['smg', 'rifle', 'shotgun', 'heavy'].includes(WEAPONS[w].cat));

// ---- gadgets (not in the weapon slots)
export const GADGETS = {
  mine:   { start: 2, carry: 4, batch: 2, maxOut: 5 },                       // proximity mine
  laser:  { start: 0, carry: 4, batch: 2, maxOut: 3, range: 14, radius: 3.6, dmg: 100, minDmg: 30, arm: 1.5 },
  knife:  { start: 2, carry: 5, batch: 3, speed: 30, gravity: 7, dmg: 100, cooldown: 0.8 },   // throwing knife: one-hit kill
  melee:  { range: 2.3, front: 55, back: 100, cooldown: 0.6, cone: 0.5 },    // cone = cos(60deg)
};

export const PICKUP_KINDS = [...PRIMARY, 'revolver', 'deagle', 'health', 'armor', 'ammo', 'mines', 'laser', 'knives'];
export const PICKUP_RESPAWN = {
  smg: 20, mp5: 20, p90: 20, rifle: 22, aug: 22, m4: 22, shotgun: 22, mossberg: 22, spas: 22, sniper: 30, launcher: 45,
  revolver: 25, deagle: 40, health: 20, armor: 30, ammo: 15, mines: 25, laser: 30, knives: 25,
};
export const PICKUP_COLORS = {
  smg: '#6fd3ff', mp5: '#8fb3ff', p90: '#a0ffd8', rifle: '#9be37f', aug: '#c7e0a0', m4: '#6fe0a0',
  shotgun: '#ffb35c', mossberg: '#d39a5a', spas: '#e0b080', sniper: '#d68cff', launcher: '#ff6b4a',
  revolver: '#e3c58a', deagle: '#d8dde6', health: '#ff5d73', armor: '#5d9bff', ammo: '#ffe66d', mines: '#ff8a3d', laser: '#ff3b3b', knives: '#cfd8e3',
};
/**
 * Maps place the original pickup kinds; each spawn point is then swapped for one of its variants
 * (random each match, or by position in "Classic" item mode) so every map offers the whole arsenal.
 */
export const PICKUP_VARIANTS = {
  smg: ['smg', 'mp5', 'p90'], rifle: ['rifle', 'aug', 'm4'], shotgun: ['shotgun', 'mossberg', 'spas'],
  sniper: ['sniper', 'launcher', 'deagle'], mines: ['mines', 'laser'], ammo: ['ammo', 'ammo', 'knives', 'revolver'],
};

export const TEAMS = [
  { name: 'CIPHER', color: '#33c9ff', alt: '#2f6bff' },
  { name: 'EMBER',  color: '#ff7a29', alt: '#ffb000' },
];

export const MODES = {
  dm:   { id: 'dm',   name: 'Deathmatch',       team: false, limits: [20, 30, 50],  def: 30,  limitLabel: 'Kill limit',
          desc: 'Free-for-all. First operator to the kill limit wins, or the most kills when the clock runs out.' },
  tdm:  { id: 'tdm',  name: 'Team Deathmatch',  team: true,  limits: [30, 50, 75],  def: 50,  limitLabel: 'Team kill limit',
          desc: 'Two squads. First team to the kill limit wins.' },
  ctf:  { id: 'ctf',  name: 'Capture the Flag', team: true,  limits: [1, 3, 5],     def: 3,   limitLabel: 'Captures to win',
          desc: 'Carry the enemy flag to your own base while your flag is home. Touch your dropped flag to return it.' },
  koth: { id: 'koth', name: 'King of the Hill', team: true,  limits: [60, 100, 200], def: 100, limitLabel: 'Hill points to win',
          desc: 'Hold the marked zone alone to earn a point every second.' },
  gg:   { id: 'gg',   name: 'Golden Gun',       team: false, limits: [10, 20, 30],  def: 20,  limitLabel: 'Points to win',
          desc: 'One golden gun, one-hit kills. Kill its holder to take it. Golden kills score double.' },
  kc:   { id: 'kc',   name: 'Intel Recovery',   team: true,  limits: [15, 25, 40],  def: 25,  limitLabel: 'Intel to win',
          desc: 'Fallen operators drop intel. Collect the enemy\'s to score, grab your own squad\'s to deny them.' },
};

export const DEFAULT_SETTINGS = {
  map: 'foundry', mode: 'dm', limit: 30, time: 480, bots: 0, weather: 'clear', items: 'random', loadout: 'arsenal', teamNames: ['', ''],
};

export const MAX_PLAYERS = 8;
export const TICK_RATE = 30;
export const RESPAWN_TIME = 3;
export const PROTECT_TIME = 1.5;

// ---------------------------------------------------------------- killstreaks
// Kills in a row (without dying) at 3 / 5 / 7 earn a pick-one reward. Kills made by your own units don't count toward the next streak.
export const STREAK_TIERS = [3, 5, 7];
export const STREAK_OPTIONS = {
  3: ['uav', 'helmet', 'wall'],
  5: ['dog', 'sentry', 'barrier'],
  7: ['radar', 'rats', 'clone'],
};
export const STREAK_INFO = {
  uav:     { name: 'UAV',            desc: 'Reveals enemy positions on your minimap for 30s' },
  helmet:  { name: 'Metal Helmet',   desc: 'Absorbs one headshot' },
  wall:    { name: 'Wall Boots',     desc: 'Hold forward into a wall to climb and run up it' },
  dog:     { name: 'Attack Dog',     desc: 'Hunts enemies, 75 health' },
  sentry:  { name: 'Sentry Gun',     desc: 'Immobile, 100 rounds, auto-targets enemies' },
  barrier: { name: 'Barrier',        desc: 'Auto-fits the hallway ahead, 300 health' },
  radar:   { name: 'Radar',          desc: '60s: every player and the way they face' },
  rats:    { name: 'Rat Swarm',      desc: '10 rats hunt together: 1000 total life, 80 dps' },
  clone:   { name: 'Clone',          desc: 'Half your health, stays at your side, attacks enemies' },
};
export const STREAK_UNITS = {
  dog:    { hp: 75, life: 70, speed: 10, bite: 20, biteEvery: 0.5, r: 0.45, h: 0.9 },
  sentry: { hp: 150, rounds: 100, rate: 9, dmg: 9, range: 40, turn: 4.5, r: 0.45, h: 1.15, life: 120 },
  barrier:{ hp: 300, life: 120, thick: 0.5, height: 3.2, maxSide: 9 },
  rats:   { hp: 1000, count: 10, dps: 80, speed: 6.5, life: 60, r: 1.0, h: 0.6 },
  clone:  { hp: 50, life: 120, offset: 0.8, range: 40, r: 0.45, h: 1.8 },
  uavTime: 30, radarTime: 60, offerTime: 12,
};
