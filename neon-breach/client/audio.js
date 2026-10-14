// Procedural audio: every sound is synthesised, so the game ships with no audio assets.
// Buses: master -> { sfx, ui, music }.

let ctx = null, buses = null, noiseBuf = null, rainNode = null, musicTimer = null;
const vol = { master: 0.8, sfx: 1, ui: 0.8, music: 0.35 };

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  const master = ctx.createGain(), sfx = ctx.createGain(), ui = ctx.createGain(), music = ctx.createGain();
  const comp = ctx.createDynamicsCompressor();
  sfx.connect(master); ui.connect(master); music.connect(master); master.connect(comp); comp.connect(ctx.destination);
  buses = { master, sfx, ui, music };
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  setVolumes(vol);
}

export function setVolumes(v) {
  Object.assign(vol, v);
  if (!buses) return;
  buses.master.gain.value = vol.master; buses.sfx.gain.value = vol.sfx; buses.ui.gain.value = vol.ui; buses.music.gain.value = vol.music;
}

function env(g, t, a, peak, d) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}

function noise(bus, t, dur, peak, type, f0, f1, pan = 0) {
  const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = ctx.createGain(); env(g, t, 0.004, peak, dur);
  src.connect(f); f.connect(g);
  if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(buses[bus]); } else g.connect(buses[bus]);
  src.start(t, Math.random()); src.stop(t + dur + 0.05);
}

function tone(bus, t, f0, f1, dur, peak, type = 'sine', pan = 0) {
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = ctx.createGain(); env(g, t, 0.005, peak, dur);
  o.connect(g);
  if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(buses[bus]); } else g.connect(buses[bus]);
  o.start(t); o.stop(t + dur + 0.05);
}

const GUN = {
  pistol:  (t, v, p) => { noise('sfx', t, 0.16, 0.5 * v, 'bandpass', 2600, 500, p); tone('sfx', t, 190, 60, 0.12, 0.5 * v, 'triangle', p); },
  smg:     (t, v, p) => { noise('sfx', t, 0.1, 0.42 * v, 'bandpass', 3000, 700, p); tone('sfx', t, 210, 80, 0.07, 0.35 * v, 'square', p); },
  rifle:   (t, v, p) => { noise('sfx', t, 0.18, 0.55 * v, 'bandpass', 2200, 400, p); tone('sfx', t, 150, 45, 0.15, 0.55 * v, 'sawtooth', p); },
  shotgun: (t, v, p) => { noise('sfx', t, 0.38, 0.9 * v, 'lowpass', 3500, 200, p); tone('sfx', t, 110, 35, 0.3, 0.8 * v, 'triangle', p); },
  sniper:  (t, v, p) => { noise('sfx', t, 0.6, 0.9 * v, 'bandpass', 1800, 150, p); tone('sfx', t, 90, 28, 0.5, 0.9 * v, 'sawtooth', p); },
  revolver:(t, v, p) => { noise('sfx', t, 0.3, 0.8 * v, 'bandpass', 2000, 200, p); tone('sfx', t, 120, 35, 0.25, 0.8 * v, 'sawtooth', p); },
  deagle:  (t, v, p) => { noise('sfx', t, 0.42, 1.0 * v, 'bandpass', 1900, 160, p); tone('sfx', t, 95, 28, 0.35, 0.95 * v, 'sawtooth', p); },
  mp5:     (t, v, p) => { noise('sfx', t, 0.09, 0.4 * v, 'bandpass', 3300, 800, p); tone('sfx', t, 240, 90, 0.06, 0.32 * v, 'square', p); },
  p90:     (t, v, p) => { noise('sfx', t, 0.07, 0.36 * v, 'bandpass', 4200, 1200, p); tone('sfx', t, 330, 140, 0.05, 0.3 * v, 'square', p); },
  aug:     (t, v, p) => { noise('sfx', t, 0.16, 0.5 * v, 'bandpass', 2600, 500, p); tone('sfx', t, 180, 55, 0.13, 0.5 * v, 'sawtooth', p); },
  m4:      (t, v, p) => { noise('sfx', t, 0.17, 0.55 * v, 'bandpass', 2000, 380, p); tone('sfx', t, 140, 42, 0.14, 0.55 * v, 'sawtooth', p); },
  mossberg:(t, v, p) => { noise('sfx', t, 0.42, 0.95 * v, 'lowpass', 3200, 180, p); tone('sfx', t, 100, 32, 0.32, 0.85 * v, 'triangle', p); },
  spas:    (t, v, p) => { noise('sfx', t, 0.34, 0.9 * v, 'lowpass', 3800, 220, p); tone('sfx', t, 125, 38, 0.26, 0.8 * v, 'triangle', p); },
  launcher:(t, v, p) => { noise('sfx', t, 0.7, 0.8 * v, 'highpass', 3000, 300, p); tone('sfx', t, 70, 30, 0.5, 0.9 * v, 'sawtooth', p); },
  golden:  (t, v, p) => { noise('sfx', t, 0.4, 0.8 * v, 'bandpass', 2400, 250, p); tone('sfx', t, 880, 440, 0.35, 0.3 * v, 'sine', p); tone('sfx', t, 130, 40, 0.3, 0.7 * v, 'sawtooth', p); },
};

const SOUNDS = {
  reload:  (t, v) => { tone('sfx', t, 900, 500, 0.04, 0.25 * v, 'square'); tone('sfx', t + 0.55, 500, 900, 0.05, 0.3 * v, 'square'); },
  empty:   (t, v) => tone('sfx', t, 300, 200, 0.05, 0.25 * v, 'square'),
  hit:     (t) => tone('ui', t, 1400, 1000, 0.06, 0.35, 'triangle'),
  headshot:(t) => { tone('ui', t, 2200, 1800, 0.12, 0.4, 'triangle'); tone('ui', t, 1100, 900, 0.12, 0.25, 'sine'); },
  kill:    (t) => { tone('ui', t, 700, 1400, 0.16, 0.4, 'triangle'); tone('ui', t + 0.1, 1050, 2100, 0.2, 0.35, 'triangle'); },
  hurt:    (t) => { noise('sfx', t, 0.12, 0.5, 'lowpass', 900, 200); tone('sfx', t, 140, 70, 0.14, 0.4, 'sine'); },
  die:     (t) => { tone('sfx', t, 260, 40, 0.8, 0.5, 'sawtooth'); noise('sfx', t, 0.5, 0.3, 'lowpass', 800, 100); },
  pickup:  (t) => { tone('ui', t, 600, 900, 0.1, 0.3, 'sine'); tone('ui', t + 0.08, 900, 1300, 0.12, 0.3, 'sine'); },
  weapon:  (t) => { tone('ui', t, 300, 600, 0.12, 0.35, 'square'); tone('ui', t + 0.08, 600, 1200, 0.15, 0.3, 'triangle'); },
  jump:    (t, v) => noise('sfx', t, 0.08, 0.12 * v, 'highpass', 400, 800),
  land:    (t, v) => { noise('sfx', t, 0.12, 0.25 * v, 'lowpass', 500, 100); },
  step:    (t, v) => noise('sfx', t, 0.06, 0.1 * v, 'lowpass', 600, 200),
  mine:    (t, v) => { tone('sfx', t, 1200, 1200, 0.05, 0.25 * v, 'square'); tone('sfx', t + 0.1, 1600, 1600, 0.05, 0.25 * v, 'square'); },
  beep:    (t, v) => tone('sfx', t, 1500, 1500, 0.04, 0.12 * v, 'square'),
  boom:    (t, v) => { noise('sfx', t, 1.0, 1.0 * v, 'lowpass', 1800, 60); tone('sfx', t, 80, 25, 0.8, 1.0 * v, 'sine'); },
  flag:    (t) => { tone('ui', t, 500, 700, 0.12, 0.35, 'triangle'); tone('ui', t + 0.12, 700, 1000, 0.18, 0.35, 'triangle'); },
  capture: (t) => { [523, 659, 784, 1046].forEach((f, i) => tone('ui', t + i * 0.1, f, f, 0.25, 0.35, 'triangle')); },
  lost:    (t) => { tone('ui', t, 400, 250, 0.35, 0.4, 'sawtooth'); },
  tick:    (t) => tone('ui', t, 1000, 1000, 0.03, 0.2, 'square'),
  callout: (t) => { tone('ui', t, 760, 760, 0.07, 0.3, 'triangle'); tone('ui', t + 0.08, 1140, 1140, 0.12, 0.3, 'triangle'); },
  vote:    (t) => tone('ui', t, 520, 780, 0.08, 0.25, 'triangle'),
  start:   (t) => { [392, 523, 659].forEach((f, i) => tone('ui', t + i * 0.12, f, f, 0.3, 0.3, 'triangle')); },
  win:     (t) => { [523, 659, 784, 1046, 1318].forEach((f, i) => tone('ui', t + i * 0.12, f, f, 0.4, 0.35, 'triangle')); },
  melee:   (t, v) => noise('sfx', t, 0.16, 0.3 * (v == null ? 1 : v), 'bandpass', 700, 2400),
  meleehit:(t, v) => { noise('sfx', t, 0.1, 0.5 * (v == null ? 1 : v), 'lowpass', 900, 150); tone('sfx', t, 160, 60, 0.1, 0.5 * (v == null ? 1 : v), 'triangle'); },
  throw:   (t, v) => noise('sfx', t, 0.22, 0.35 * (v == null ? 1 : v), 'bandpass', 1200, 3200),
  tink:    (t, v) => tone('sfx', t, 2400, 1800, 0.08, 0.25 * (v == null ? 1 : v), 'triangle'),
  laser:   (t, v) => { tone('sfx', t, 600, 1800, 0.12, 0.25 * (v == null ? 1 : v), 'square'); tone('sfx', t + 0.15, 1800, 1800, 0.05, 0.2 * (v == null ? 1 : v), 'square'); },
  click:   (t) => tone('ui', t, 800, 600, 0.03, 0.18, 'square'),
};

/** Play a named sound. opts: {vol (0..1), pan (-1..1)} */
export function play(name, opts = {}) {
  if (!ctx || !buses) return;
  const t = ctx.currentTime, v = opts.vol == null ? 1 : opts.vol, p = opts.pan || 0;
  if (name.startsWith('gun:')) { const g = GUN[name.slice(4)]; if (g) g(t, v, p); return; }
  const s = SOUNDS[name]; if (s) s(t, v, p);
}

/** Rain ambience on/off. */
export function setRain(on) {
  if (!ctx) return;
  if (on && !rainNode) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 3200; f.Q.value = 0.4;
    const g = ctx.createGain(); g.gain.value = 0.12;
    src.connect(f); f.connect(g); g.connect(buses.sfx); src.start();
    rainNode = { src, g };
  } else if (!on && rainNode) { try { rainNode.src.stop(); } catch (e) { /* already stopped */ } rainNode = null; }
}

/** Gentle generative music: a slow minor arpeggio over a drone. mode: 'menu' | 'match' */
export function setMusic(mode) {
  if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
  if (!ctx || !mode) return;
  const root = mode === 'menu' ? 110 : 98;
  const scale = [0, 3, 7, 10, 12, 15, 19];
  let step = 0;
  const bar = () => {
    const t = ctx.currentTime + 0.05;
    const n = scale[(step * (mode === 'menu' ? 2 : 3) + (step >> 2)) % scale.length];
    const f = root * Math.pow(2, n / 12);
    tone('music', t, f * 2, f * 2, 1.2, 0.12, 'triangle');
    if (step % 4 === 0) tone('music', t, root / 2, root / 2, 2.4, 0.18, 'sine');
    if (mode === 'match' && step % 2 === 0) noise('music', t, 0.08, 0.05, 'highpass', 6000, 6000);
    step++;
  };
  bar(); musicTimer = setInterval(bar, mode === 'menu' ? 700 : 480);
}

export function audioCtx() { return ctx; }
