// Procedural audio, designed to sit closer to a AAA shooter mix than a chiptune: layered gunshots (crack + body + sub thump +
// reverberant tail), metallic reload foley, convolution reverb on a send bus, a soft-clip "punch" stage on weapons, and a
// cyberpunk score: synthwave / dark-electro with four-on-the-floor kick, rolling bass, arps and lead stabs (menu 130 bpm, match 170 bpm).
// Buses: master -> { sfx, ui, music } ; sfx and music also feed a shared reverb.

let ctx = null, buses = null, noiseBuf = null, rainNodes = null, musicTimer = null, reverb = null, gunBus = null, musicMode = null;
const vol = { master: 0.8, sfx: 1, ui: 0.8, music: 0.35 };

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC({ latencyHint: 'interactive' });
  const master = ctx.createGain(), sfx = ctx.createGain(), ui = ctx.createGain(), music = ctx.createGain();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.knee.value = 18; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.22;
  sfx.connect(master); ui.connect(master); music.connect(master); master.connect(comp); comp.connect(ctx.destination);
  buses = { master, sfx, ui, music };
  // 4 s of noise, pink-ish (smoother than white) so filtered noise sounds less hissy
  const len = ctx.sampleRate * 4;
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0); let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.28 * 0.5 + w * 0.5; }
  // reverb: synthetic stereo impulse response (early reflections + dense decaying tail, darkening over time)
  const irLen = Math.floor(ctx.sampleRate * 2.4), ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const ch = ir.getChannelData(c); let lp = 0;
    for (let i = 0; i < irLen; i++) {
      const tt = i / irLen, k = 0.15 + 0.8 * tt;                          // low-pass gets stronger over time
      lp += (Math.random() * 2 - 1 - lp) * (1 - k);
      ch[i] = lp * Math.pow(1 - tt, 2.6) * (i < 400 ? 0.2 : 1);
    }
    for (const e of [0.011, 0.023, 0.037, 0.052]) ch[Math.floor(e * ctx.sampleRate) + c * 40] += (c ? -0.5 : 0.5) * (1 - e * 8);
  }
  reverb = ctx.createConvolver(); reverb.buffer = ir;
  const wet = ctx.createGain(); wet.gain.value = 0.32; reverb.connect(wet); wet.connect(master);
  buses.revIn = ctx.createGain(); buses.revIn.connect(reverb);
  // weapon "punch" stage: soft saturation then a gentle high shelf for bite
  const shaper = ctx.createWaveShaper(), curve = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 2.2) / Math.tanh(2.2); }
  shaper.curve = curve; shaper.oversample = '2x';
  gunBus = ctx.createGain(); gunBus.gain.value = 0.9; gunBus.connect(shaper); shaper.connect(sfx);
  setVolumes(vol);
  loadSamples();
}

export function setVolumes(v) {
  Object.assign(vol, v);
  if (!buses) return;
  buses.master.gain.value = vol.master; buses.sfx.gain.value = vol.sfx; buses.ui.gain.value = vol.ui; buses.music.gain.value = vol.music;
}

/** Route a node to a bus with optional pan and reverb send. */
function out(node, bus, pan = 0, send = 0) {
  let n = node;
  if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); n.connect(p); n = p; }
  n.connect(bus === 'gun' ? gunBus : buses[bus]);
  if (send > 0 && buses.revIn) { const s = ctx.createGain(); s.gain.value = send; n.connect(s); s.connect(buses.revIn); }
}

function adsr(g, t, a, peak, d, hold = 0) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(Math.max(0.0002, peak), t + a);
  if (hold) g.gain.setValueAtTime(Math.max(0.0002, peak), t + a + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + d);
}

/** Filtered noise burst. o: {q, a (attack), send, curveHold} */
function noise(bus, t, dur, peak, type, f0, f1, pan = 0, o = {}) {
  const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = o.q || 0.7;
  f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = ctx.createGain(); adsr(g, t, o.a || 0.002, peak, dur);
  src.connect(f); f.connect(g); out(g, bus, pan, o.send || 0);
  src.start(t, Math.random() * 3); src.stop(t + dur + (o.a || 0.002) + 0.05);
}

/** Oscillator note. o: {a, send, detune, hold, lp (low-pass cutoff)} */
function tone(bus, t, f0, f1, dur, peak, type = 'sine', pan = 0, o = {}) {
  const osc = ctx.createOscillator(); osc.type = type; osc.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + (o.slide || dur));
  if (o.detune) osc.detune.value = o.detune;
  const g = ctx.createGain(); adsr(g, t, o.a || 0.004, peak, dur, o.hold || 0);
  let n = osc; if (o.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; osc.connect(f); n = f; }
  n.connect(g); out(g, bus, pan, o.send || 0);
  osc.start(t); osc.stop(t + (o.a || 0.004) + (o.hold || 0) + dur + 0.05);
}

// ------------------------------------------------------------------ weapons
// crack: bright transient; body: mid "blast"; thump: sub; tail: reverberant decay length; bright: crack cutoff
const GP = {
  pistol:   { crack: 0.7, body: 0.55, thump: 0.5, tail: 0.5, bright: 5200, bodyF: 1400, tf: 150, len: 0.09 },
  smg:      { crack: 0.6, body: 0.5, thump: 0.4, tail: 0.35, bright: 5600, bodyF: 1700, tf: 170, len: 0.07 },
  rifle:    { crack: 0.85, body: 0.8, thump: 0.8, tail: 0.9, bright: 4200, bodyF: 1000, tf: 110, len: 0.12 },
  shotgun:  { crack: 0.8, body: 1.0, thump: 1.1, tail: 0.9, bright: 3200, bodyF: 700, tf: 85, len: 0.2 },
  sniper:   { crack: 1.0, body: 0.95, thump: 1.2, tail: 1.8, bright: 3600, bodyF: 800, tf: 70, len: 0.22 },
  revolver: { crack: 0.9, body: 0.95, thump: 1.0, tail: 1.1, bright: 3800, bodyF: 800, tf: 95, len: 0.16 },
  deagle:   { crack: 1.0, body: 1.0, thump: 1.1, tail: 1.2, bright: 4000, bodyF: 850, tf: 85, len: 0.18 },
  mp5:      { crack: 0.55, body: 0.5, thump: 0.4, tail: 0.35, bright: 5000, bodyF: 1600, tf: 180, len: 0.07 },
  p90:      { crack: 0.45, body: 0.4, thump: 0.3, tail: 0.3, bright: 6600, bodyF: 2200, tf: 220, len: 0.06 },
  aug:      { crack: 0.8, body: 0.7, thump: 0.7, tail: 0.8, bright: 4600, bodyF: 1100, tf: 120, len: 0.11 },
  m4:       { crack: 0.85, body: 0.75, thump: 0.75, tail: 0.85, bright: 4400, bodyF: 1050, tf: 115, len: 0.11 },
  mossberg: { crack: 0.85, body: 1.05, thump: 1.15, tail: 1.0, bright: 3000, bodyF: 650, tf: 80, len: 0.22 },
  spas:     { crack: 0.8, body: 1.0, thump: 1.1, tail: 0.9, bright: 3300, bodyF: 720, tf: 85, len: 0.2 },
};
function shot(t, v, p, c, extra = {}) {
  const pk = v * (extra.gain || 1);
  noise('gun', t, 0.03 + c.len * 0.15, 0.9 * c.crack * pk, 'highpass', c.bright, c.bright * 0.5, p, { q: 0.5, a: 0.0008, send: 0.1 });     // supersonic crack
  noise('gun', t, c.len, 0.85 * c.body * pk, 'bandpass', c.bodyF * 1.8, c.bodyF * 0.35, p, { q: 0.9, a: 0.0015, send: 0.25 });             // blast body
  tone('gun', t, c.tf * 1.9, c.tf * 0.42, 0.12 + c.thump * 0.1, 0.9 * c.thump * pk, 'sine', p, { a: 0.001, slide: 0.12 });                // chest thump
  tone('gun', t, c.tf * 0.7, c.tf * 0.3, 0.2 + c.thump * 0.12, 0.45 * c.thump * pk, 'triangle', p, { a: 0.003, lp: 400 });                // sub
  noise('sfx', t + 0.02, 0.25 + c.tail * 0.5, 0.35 * c.tail * pk, 'lowpass', 1800, 140, p, { q: 0.4, a: 0.01, send: 0.9 });                // room tail
  if (extra.mech) extra.mech(t + (extra.mechDelay || 0.11), pk, p);
}
const clack = (t, v, p, f = 2600) => { noise('sfx', t, 0.025, 0.28 * v, 'bandpass', f, f * 0.6, p, { q: 3, a: 0.0005 }); tone('sfx', t, f * 0.5, f * 0.3, 0.03, 0.12 * v, 'triangle', p, { a: 0.0005 }); };
const GUN = {
  pistol: (t, v, p) => shot(t, v, p, GP.pistol), smg: (t, v, p) => shot(t, v, p, GP.smg), rifle: (t, v, p) => shot(t, v, p, GP.rifle),
  mp5: (t, v, p) => shot(t, v, p, GP.mp5), p90: (t, v, p) => shot(t, v, p, GP.p90), aug: (t, v, p) => shot(t, v, p, GP.aug), m4: (t, v, p) => shot(t, v, p, GP.m4),
  revolver: (t, v, p) => shot(t, v, p, GP.revolver), deagle: (t, v, p) => shot(t, v, p, GP.deagle),
  shotgun: (t, v, p) => shot(t, v, p, GP.shotgun, { mech: (tt, pk, pp) => { clack(tt, pk, pp, 1800); clack(tt + 0.09, pk, pp, 2400); }, mechDelay: 0.16 }),
  mossberg: (t, v, p) => shot(t, v, p, GP.mossberg, { mech: (tt, pk, pp) => { noise('sfx', tt, 0.09, 0.3 * pk, 'bandpass', 1200, 700, pp, { q: 2 }); clack(tt + 0.07, pk, pp, 1500); clack(tt + 0.17, pk, pp, 2200); }, mechDelay: 0.22 }),
  spas: (t, v, p) => shot(t, v, p, GP.spas, { mech: (tt, pk, pp) => { clack(tt, pk, pp, 1700); clack(tt + 0.1, pk, pp, 2300); }, mechDelay: 0.18 }),
  sniper: (t, v, p) => shot(t, v, p, GP.sniper, { mech: (tt, pk, pp) => { clack(tt, pk, pp, 1400); clack(tt + 0.12, pk, pp, 2000); clack(tt + 0.5, pk, pp, 1600); clack(tt + 0.62, pk, pp, 2600); }, mechDelay: 0.35 }),
  launcher: (t, v, p) => {
    noise('sfx', t, 0.5, 0.6 * v, 'bandpass', 5000, 600, p, { q: 0.6, a: 0.01, send: 0.4 });                  // backblast whoosh
    noise('gun', t, 0.12, 0.8 * v, 'lowpass', 3000, 300, p, { a: 0.001 });
    tone('gun', t, 110, 36, 0.5, 0.9 * v, 'sine', p, { a: 0.002 });
    noise('sfx', t + 0.05, 1.3, 0.3 * v, 'lowpass', 1500, 120, p, { a: 0.05, send: 1 });
  },
  golden: (t, v, p) => {
    shot(t, v, p, GP.deagle, { gain: 1.05 });
    for (const [f, d] of [[1760, 0.9], [2637, 0.6], [3520, 0.4]]) tone('sfx', t + 0.01, f, f * 0.995, 0.7, 0.07 * v * d, 'sine', p, { send: 0.6 });   // ringing shimmer
  },
};

// ------------------------------------------------------------------ everything else
const mV = (v) => (v == null ? 1 : v);
const SOUNDS = {
  // magazine out, mag in, bolt/charging handle
  reload: (t, v, p) => {
    noise('sfx', t + 0.05, 0.05, 0.3 * v, 'bandpass', 900, 400, 0, { q: 2 }); tone('sfx', t + 0.05, 220, 120, 0.06, 0.18 * v, 'triangle');   // release + mag slides out
    clack(t + 0.12, v, 0, 3200);
    noise('sfx', t + 0.58, 0.07, 0.35 * v, 'lowpass', 900, 250, 0, { a: 0.001 }); tone('sfx', t + 0.58, 150, 70, 0.08, 0.4 * v, 'sine');     // mag seated
    clack(t + 0.6, v, 0, 2200);
    noise('sfx', t + 0.9, 0.12, 0.3 * v, 'bandpass', 2400, 900, 0, { q: 1.5 }); clack(t + 0.98, v, 0, 2900); clack(t + 1.06, v * 0.8, 0, 1900);   // charging handle
  },
  // reload cues, fired by the first-person reload animation (client/reload.js) at the moment each action happens
  magout: (t, v) => { noise('sfx', t, 0.04, 0.3 * v, 'bandpass', 900, 400, 0, { q: 2 }); tone('sfx', t, 240, 120, 0.06, 0.18 * v, 'triangle'); noise('sfx', t + 0.05, 0.09, 0.14 * v, 'bandpass', 1600, 700, 0, { q: 1.2, a: 0.01 }); },
  magin: (t, v) => { noise('sfx', t, 0.06, 0.4 * v, 'lowpass', 900, 250, 0, { a: 0.001 }); tone('sfx', t, 150, 70, 0.08, 0.42 * v, 'sine'); clack(t + 0.015, v, 0, 2300); },
  rack: (t, v) => { noise('sfx', t, 0.1, 0.3 * v, 'bandpass', 2400, 900, 0, { q: 1.5 }); clack(t + 0.07, v, 0, 2900); clack(t + 0.14, v * 0.8, 0, 1900); },
  cyl: (t, v) => { clack(t, v, 0, 1400); noise('sfx', t + 0.03, 0.07, 0.2 * v, 'bandpass', 1800, 900, 0, { q: 2 }); },
  eject: (t, v) => { clack(t, v, 0, 2800); for (let i = 0; i < 4; i++) tone('sfx', t + 0.06 + i * 0.05 + Math.random() * 0.03, 3600 + Math.random() * 1500, 3200, 0.1, 0.09 * v, 'sine', 0, { a: 0.0005, send: 0.3 }); },
  loader: (t, v) => { noise('sfx', t, 0.06, 0.28 * v, 'bandpass', 2200, 800, 0, { q: 2 }); clack(t + 0.02, v, 0, 2000); clack(t + 0.06, 0.7 * v, 0, 2600); },
  cylclose: (t, v) => { noise('sfx', t, 0.05, 0.3 * v, 'lowpass', 1300, 300, 0, { a: 0.001 }); clack(t + 0.02, v, 0, 1500); tone('sfx', t, 190, 90, 0.07, 0.3 * v, 'sine'); },
  shell: (t, v) => { tone('sfx', t, 1100, 700, 0.06, 0.16 * v, 'triangle', 0, { a: 0.001 }); clack(t + 0.01, 0.7 * v, 0, 1700); noise('sfx', t, 0.05, 0.1 * v, 'bandpass', 900, 500, 0, { q: 2 }); },
  pump: (t, v) => { noise('sfx', t, 0.1, 0.3 * v, 'bandpass', 1200, 700, 0, { q: 2 }); clack(t + 0.07, v, 0, 1500); clack(t + 0.2, v, 0, 2200); tone('sfx', t + 0.2, 160, 80, 0.07, 0.25 * v, 'sine'); },
  boltup: (t, v) => { clack(t, v, 0, 1200); noise('sfx', t + 0.02, 0.05, 0.14 * v, 'bandpass', 2000, 900, 0, { q: 2 }); },
  boltback: (t, v) => { noise('sfx', t, 0.14, 0.24 * v, 'bandpass', 1500, 600, 0, { q: 1.5, a: 0.03 }); clack(t + 0.14, v, 0, 1800); },
  boltfwd: (t, v) => { noise('sfx', t, 0.12, 0.24 * v, 'bandpass', 1500, 600, 0, { q: 1.5, a: 0.03 }); clack(t + 0.12, v, 0, 2000); tone('sfx', t + 0.12, 140, 70, 0.07, 0.3 * v, 'sine'); },
  bolt: (t, v) => { clack(t, v, 0, 1500); clack(t + 0.05, 0.7 * v, 0, 2400); },
  rocketin: (t, v) => { noise('sfx', t, 0.4, 0.22 * v, 'bandpass', 800, 400, 0, { q: 1, a: 0.12 }); tone('sfx', t + 0.38, 120, 60, 0.12, 0.4 * v, 'sine'); clack(t + 0.38, v, 0, 1200); },
  rocketlock: (t, v) => { clack(t, v, 0, 1300); clack(t + 0.06, 0.8 * v, 0, 2100); tone('sfx', t + 0.1, 1500, 1500, 0.05, 0.08 * v, 'sine'); },
  // other players dying: a short grunt, then the body hitting the floor
  dieo: (t, v, p) => { const f = 0.9 + Math.random() * 0.3; noise('sfx', t, 0.32, 0.4 * v, 'bandpass', 650 * f, 280, p, { q: 2.5, a: 0.03 }); tone('sfx', t, 150 * f, 70, 0.3, 0.3 * v, 'sawtooth', p, { a: 0.02, lp: 700 }); noise('sfx', t + 0.05, 0.2, 0.12 * v, 'highpass', 2500, 1500, p, { a: 0.04 }); },
  thud: (t, v, p) => { tone('sfx', t, 80, 36, 0.28, 0.6 * v, 'sine', p, { a: 0.002 }); noise('sfx', t, 0.16, 0.38 * v, 'lowpass', 650, 120, p, { a: 0.002, send: 0.3 }); noise('sfx', t + 0.01, 0.06, 0.15 * v, 'bandpass', 2200, 900, p, { q: 1.5 }); },
  empty: (t, v) => { clack(t, 0.8 * v, 0, 1800); tone('sfx', t, 260, 140, 0.04, 0.12 * v, 'triangle'); },
  hit: (t) => { tone('ui', t, 1800, 900, 0.05, 0.3, 'triangle', 0, { a: 0.001 }); noise('ui', t, 0.04, 0.3, 'bandpass', 3200, 1200, 0, { q: 2, a: 0.0005 }); tone('ui', t, 220, 110, 0.06, 0.3, 'sine', 0, { a: 0.001 }); },
  headshot: (t) => { tone('ui', t, 2400, 2000, 0.25, 0.25, 'sine', 0, { a: 0.001, send: 0.4 }); tone('ui', t, 3600, 3400, 0.18, 0.12, 'sine', 0, { a: 0.001 }); noise('ui', t, 0.06, 0.4, 'bandpass', 4200, 1800, 0, { q: 2, a: 0.0005 }); tone('ui', t, 200, 90, 0.1, 0.4, 'sine', 0, { a: 0.001 }); },
  kill: (t) => { tone('ui', t, 140, 55, 0.3, 0.55, 'sine', 0, { a: 0.001 }); noise('ui', t, 0.05, 0.4, 'bandpass', 3000, 1000, 0, { q: 2, a: 0.0005 }); tone('ui', t + 0.04, 1500, 1500, 0.35, 0.18, 'sine', 0, { send: 0.5 }); tone('ui', t + 0.1, 2250, 2250, 0.4, 0.14, 'sine', 0, { send: 0.5 }); },
  hurt: (t, v) => { noise('sfx', t, 0.18, 0.5, 'lowpass', 1200, 200, 0, { a: 0.002 }); tone('sfx', t, 110, 50, 0.2, 0.55, 'sine'); noise('sfx', t, 0.08, 0.25, 'bandpass', 2500, 900, 0, { q: 1.5, a: 0.001 }); },
  die: (t) => { tone('sfx', t, 90, 34, 1.2, 0.7, 'sine', 0, { send: 0.5 }); noise('sfx', t, 0.9, 0.4, 'lowpass', 900, 80, 0, { a: 0.02, send: 0.8 }); noise('sfx', t + 0.15, 0.25, 0.25, 'bandpass', 1800, 400, 0, { q: 1 }); },
  pickup: (t) => { tone('ui', t, 880, 880, 0.18, 0.22, 'sine', 0, { send: 0.4 }); tone('ui', t + 0.07, 1320, 1320, 0.28, 0.2, 'sine', 0, { send: 0.4 }); noise('ui', t, 0.05, 0.15, 'bandpass', 4000, 2000, 0, { q: 2 }); },
  weapon: (t, v, p) => { clack(t, 1.1, 0, 2000); clack(t + 0.06, 0.9, 0, 3000); tone('ui', t, 200, 120, 0.1, 0.3, 'triangle'); tone('ui', t + 0.1, 1175, 1175, 0.3, 0.14, 'sine', 0, { send: 0.4 }); },
  jump: (t, v) => { noise('sfx', t, 0.1, 0.12 * v, 'bandpass', 700, 1400, 0, { q: 0.6, a: 0.02 }); },
  land: (t, v) => { tone('sfx', t, 90, 40, 0.18, 0.55 * v, 'sine', 0, { a: 0.002 }); noise('sfx', t, 0.14, 0.3 * v, 'lowpass', 900, 150, 0, { a: 0.002 }); noise('sfx', t + 0.01, 0.07, 0.12 * v, 'bandpass', 2500, 1200, 0, { q: 1 }); },
  step: (t, v) => {
    const j = 0.85 + Math.random() * 0.3;
    tone('sfx', t, 95 * j, 45, 0.07, 0.22 * v, 'sine', 0, { a: 0.001 }); noise('sfx', t, 0.07, 0.16 * v, 'lowpass', 1100 * j, 300, 0, { a: 0.001 }); noise('sfx', t + 0.015, 0.05, 0.05 * v, 'bandpass', 3000 * j, 1500, 0, { q: 1 });
  },
  mine: (t, v) => { clack(t, v, 0, 1500); tone('sfx', t + 0.1, 1200, 1200, 0.07, 0.15 * v, 'sine'); tone('sfx', t + 0.2, 1600, 1600, 0.07, 0.15 * v, 'sine'); },
  beep: (t, v) => tone('sfx', t, 1500, 1500, 0.05, 0.1 * v, 'sine', 0, { a: 0.002 }),
  boom: (t, v, p) => {
    tone('gun', t, 120, 28, 1.6, 1.0 * v, 'sine', p, { a: 0.003, slide: 1.4, send: 0.5 });                       // sub drop
    noise('gun', t, 0.35, 1.0 * v, 'lowpass', 4000, 300, p, { a: 0.001, send: 0.5 });                              // blast
    noise('sfx', t + 0.05, 2.2, 0.55 * v, 'lowpass', 1400, 60, p, { a: 0.06, send: 1, q: 0.5 });                     // rumble + room
    for (let i = 0; i < 7; i++) noise('sfx', t + 0.2 + Math.random() * 1.0, 0.05, 0.12 * v, 'bandpass', 1500 + Math.random() * 3500, 800, p, { q: 2, send: 0.4 });   // debris
  },
  flag: (t) => { tone('ui', t, 392, 392, 0.4, 0.2, 'triangle', 0, { send: 0.5, lp: 2000 }); tone('ui', t + 0.1, 587, 587, 0.5, 0.2, 'triangle', 0, { send: 0.5, lp: 2000 }); },
  capture: (t) => { [392, 523, 659, 784].forEach((f, i) => { tone('ui', t + i * 0.1, f, f, 0.8, 0.18, 'sawtooth', 0, { send: 0.7, lp: 1800, a: 0.02 }); tone('ui', t + i * 0.1, f / 2, f / 2, 0.8, 0.15, 'sine'); }); tone('ui', t, 70, 40, 0.6, 0.5, 'sine'); },
  lost: (t) => { tone('ui', t, 220, 165, 1.0, 0.25, 'sawtooth', 0, { lp: 700, send: 0.7, a: 0.05 }); tone('ui', t, 55, 45, 1.2, 0.5, 'sine'); },
  tick: (t) => { noise('ui', t, 0.025, 0.25, 'bandpass', 3500, 2500, 0, { q: 3, a: 0.0005 }); tone('ui', t, 900, 600, 0.03, 0.12, 'sine'); },
  callout: (t) => { tone('ui', t, 880, 880, 0.12, 0.2, 'sine', 0, { send: 0.3 }); tone('ui', t + 0.09, 1320, 1320, 0.2, 0.2, 'sine', 0, { send: 0.3 }); },
  camalert: (t) => { for (let i = 0; i < 3; i++) { tone('ui', t + i * 0.16, 1500, 1500, 0.09, 0.16, 'square', 0, { lp: 3200, send: 0.3 }); tone('ui', t + i * 0.16 + 0.08, 1000, 1000, 0.07, 0.12, 'square', 0, { lp: 2600 }); } },
  vote: (t) => { tone('ui', t, 660, 660, 0.12, 0.18, 'sine', 0, { send: 0.3 }); },
  start: (t) => { tone('ui', t, 55, 38, 1.4, 0.7, 'sine', 0, { send: 0.4 }); noise('ui', t, 0.9, 0.3, 'bandpass', 600, 4000, 0, { a: 0.3, q: 0.5, send: 0.6 }); [196, 294, 392].forEach(f => tone('ui', t + 0.05, f, f, 1.1, 0.12, 'sawtooth', 0, { lp: 1200, a: 0.05, send: 0.6 })); },
  win: (t) => { [262, 330, 392, 523, 659].forEach((f, i) => tone('ui', t + i * 0.13, f, f, 1.4, 0.16, 'sawtooth', 0, { lp: 1600, a: 0.03, send: 0.8 })); tone('ui', t, 65, 40, 1.8, 0.6, 'sine'); noise('ui', t, 0.2, 0.3, 'lowpass', 3000, 200, 0, { send: 0.5 }); },
  melee: (t, v) => noise('sfx', t, 0.2, 0.32 * mV(v), 'bandpass', 600, 2800, 0, { q: 1, a: 0.04 }),
  meleehit: (t, v) => { noise('sfx', t, 0.1, 0.5 * mV(v), 'lowpass', 1000, 150, 0, { a: 0.001 }); tone('sfx', t, 130, 55, 0.14, 0.6 * mV(v), 'sine', 0, { a: 0.001 }); noise('sfx', t, 0.05, 0.25 * mV(v), 'bandpass', 3000, 1500, 0, { q: 2 }); },
  throw: (t, v) => noise('sfx', t, 0.25, 0.3 * mV(v), 'bandpass', 900, 3600, 0, { q: 1.2, a: 0.06 }),
  tink: (t, v) => { tone('sfx', t, 3200, 3000, 0.25, 0.18 * mV(v), 'sine', 0, { a: 0.0005, send: 0.4 }); tone('sfx', t, 4800, 4600, 0.15, 0.08 * mV(v), 'sine', 0, { a: 0.0005 }); },
  laser: (t, v) => { clack(t, v, 0, 1800); tone('sfx', t + 0.1, 900, 1800, 0.25, 0.1 * mV(v), 'sine', 0, { a: 0.02 }); tone('sfx', t + 0.4, 1800, 1800, 0.06, 0.1 * mV(v), 'sine'); },
  click: (t) => { noise('ui', t, 0.02, 0.18, 'bandpass', 3000, 2000, 0, { q: 3, a: 0.0005 }); tone('ui', t, 700, 500, 0.03, 0.08, 'sine'); },
};

// ------------------------------------------------------------------ optional recorded samples
// Drop licensed / royalty-free audio files into client/sounds/ and list them in client/sounds/manifest.json:
//   { "gun:m4": ["m4_1.ogg", "m4_2.ogg"], "reload": "reload.wav", "boom": "explosion.ogg" }
// Any sound with an entry plays the recording (random variant, slight pitch jitter) instead of the synthesised one.
const samples = new Map();
async function loadSamples() {
  try {
    const r = await fetch('sounds/manifest.json', { cache: 'no-cache' }); if (!r.ok) return;
    const man = await r.json();
    for (const [name, spec] of Object.entries(man)) {
      const files = (Array.isArray(spec) ? spec : [spec]).filter(f => typeof f === 'string' && /^[\w .\-/]+$/.test(f) && !f.includes('..'));
      const bufs = [];
      for (const f of files) { try { const rr = await fetch('sounds/' + f); if (!rr.ok) continue; bufs.push(await ctx.decodeAudioData(await rr.arrayBuffer())); } catch { /* skip bad file */ } }
      if (bufs.length) samples.set(name, bufs);
    }
  } catch { /* no manifest: everything stays synthesised */ }
}
function playSample(name, v, p) {
  const bufs = samples.get(name); if (!bufs) return false;
  const src = ctx.createBufferSource(); src.buffer = bufs[Math.floor(Math.random() * bufs.length)];
  src.playbackRate.value = 0.97 + Math.random() * 0.06;
  const g = ctx.createGain(); g.gain.value = v; src.connect(g);
  const ui = ['hit', 'headshot', 'kill', 'pickup', 'weapon', 'flag', 'capture', 'lost', 'tick', 'callout', 'camalert', 'vote', 'start', 'win', 'click'].includes(name);
  out(g, ui ? 'ui' : 'sfx', p, ui ? 0 : 0.25);
  src.start(); return true;
}

/** True when a recorded sample overrides this sound name. */
export const hasSample = (name) => samples.has(name);

/** Play a named sound. opts: {vol (0..1), pan (-1..1)} */
export function play(name, opts = {}) {
  if (!ctx || !buses) return;
  const t = ctx.currentTime, v = opts.vol == null ? 1 : opts.vol, p = opts.pan || 0;
  if (samples.size && playSample(name, v, p)) return;
  if (name.startsWith('gun:')) { const g = GUN[name.slice(4)]; if (g) g(t, v, p); return; }
  const s = SOUNDS[name]; if (s) s(t, v, p);
}

/** Rain ambience on/off (two layers: broadband hiss + low rumble). */
export function setRain(on) {
  if (!ctx) return;
  if (on && !rainNodes) {
    const mk = (type, f, q, gain) => { const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true; const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = ctx.createGain(); g.gain.value = gain; src.connect(fl); fl.connect(g); g.connect(buses.sfx); src.start(0, Math.random() * 3); return src; };
    rainNodes = [mk('bandpass', 4200, 0.35, 0.07), mk('lowpass', 500, 0.5, 0.1)];
  } else if (!on && rainNodes) { for (const s of rainNodes) { try { s.stop(); } catch (e) { /* already stopped */ } } rainNodes = null; }
}

// ------------------------------------------------------------------ music
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
/** A string-section pad chord: detuned saws through a slow low-pass, with a soft octave and a bowed bass. */
function pad(t, notes, dur, gain, bright = 1400) {
  for (const m of notes) {
    const f = mtof(m);
    for (const det of [-9, 0, 9]) tone('music', t, f, f, dur, gain * 0.22, 'sawtooth', (Math.random() - 0.5) * 0.6, { a: Math.min(1.6, dur * 0.35), detune: det, lp: bright, send: 0.7, hold: dur * 0.35 });
    tone('music', t, f * 2, f * 2, dur * 0.8, gain * 0.05, 'sine', 0, { a: 0.8, send: 0.6 });
  }
  const bassF = mtof(notes[0] - 12);
  tone('music', t, bassF, bassF, dur, gain * 0.55, 'sawtooth', 0, { a: 0.5, lp: 260, hold: dur * 0.4 });
  tone('music', t, bassF / 2, bassF / 2, dur, gain * 0.5, 'sine', 0, { a: 0.5, hold: dur * 0.4 });
}
const timpani = (t, f, g) => { tone('music', t, f * 1.5, f, 0.5, 0.9 * g, 'sine', 0, { a: 0.002, slide: 0.12, send: 0.5 }); noise('music', t, 0.08, 0.5 * g, 'lowpass', 900, 200, 0, { a: 0.001, send: 0.4 }); noise('music', t, 0.9, 0.12 * g, 'lowpass', 300, 80, 0, { a: 0.02, send: 0.8 }); };
const brass = (t, m, dur, g) => { const f = mtof(m); for (const det of [-6, 6]) tone('music', t, f, f, dur, g * 0.12, 'sawtooth', 0, { a: 0.18, detune: det, lp: 1100, send: 0.6, hold: dur * 0.3 }); };

// Cyberpunk score: driving synthwave / dark-electro. C minor, chords as [root, third, fifth, seventh] MIDI notes.
const PROG = [[48, 51, 55, 58], [44, 48, 51, 55], [46, 50, 53, 56], [43, 46, 50, 53]];        // Cm7  Abmaj7  Bb  Gm7
const PROG2 = [[48, 51, 55, 58], [44, 48, 51, 55], [51, 55, 58, 62], [46, 50, 53, 58]];       // Cm7  Abmaj7  Ebmaj7  Bb
const kick = (t, g = 1) => { tone('music', t, 150, 45, 0.28, 1.0 * g, 'sine', 0, { a: 0.001, slide: 0.09 }); noise('music', t, 0.02, 0.35 * g, 'highpass', 2500, 2500, 0, { a: 0.0005 }); };
const clap = (t, g = 1) => { for (const o of [0, 0.011, 0.022]) noise('music', t + o, 0.09, 0.3 * g, 'bandpass', 1500, 1500, 0, { a: 0.001, q: 0.9, send: 0.25 }); noise('music', t, 0.28, 0.1 * g, 'bandpass', 1800, 1200, 0, { a: 0.002, q: 0.7, send: 0.6 }); };
const hat = (t, g, open) => noise('music', t, open ? 0.2 : 0.03, g, 'highpass', 8000, 8000, 0, { a: 0.0005 });
/** Rolling 16th-note bass: saw + sub through a low-pass that pumps with each note. */
const bassNote = (t, m, len, g) => { const f = mtof(m); tone('music', t, f, f, len, 0.24 * g, 'sawtooth', 0, { a: 0.003, lp: 700, send: 0.05 }); tone('music', t, f, f, len, 0.3 * g, 'sine', 0, { a: 0.004 }); };
/** Detuned saw stab / lead. */
const lead = (t, m, len, g, lp = 3200) => { const f = mtof(m); for (const det of [-12, 0, 12]) tone('music', t, f, f, len, 0.06 * g, 'sawtooth', det / 40, { a: 0.006, detune: det, lp, send: 0.45, hold: len * 0.3 }); };

/** mode: 'menu' (130 bpm, moody but moving) | 'match' (170 bpm, full-throttle) */
export function setMusic(mode) {
  if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
  musicMode = mode;
  if (!ctx || !mode) return;
  const menu = mode === 'menu', bpm = menu ? 130 : 170, beat = 60 / bpm, barLen = beat * 4, s16 = beat / 4;
  const prog = menu ? PROG : PROG2;
  const ARP = [0, 2, 1, 3, 2, 1, 3, 2, 0, 3, 1, 2, 3, 1, 2, 3];                         // chord-tone order for the 16th arp
  const RHY = [1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0];                         // syncopated bass accents
  let bar = 0, next = ctx.currentTime + 0.1;
  const schedule = () => {
    while (next < ctx.currentTime + 1.2) {
      const t = next, ch = prog[Math.floor(bar / 2) % prog.length], phrase = bar % 8;
      // pad underneath, one chord every two bars
      if (bar % 2 === 0) pad(t, ch.slice(0, 3).map(m => m + 12), barLen * 2.05, menu ? 0.5 : 0.35, menu ? 1500 : 1900);
      // bass: 16th rolling pulse, octave jumps on the syncopated hits
      for (let i = 0; i < 16; i++) {
        if (menu && i % 2) continue;
        const m = ch[0] - 12 + (RHY[i] && i % 8 ? 12 : 0) + (i === 14 && bar % 2 ? 3 : 0);
        bassNote(t + i * s16, m, s16 * 0.9, menu ? 0.8 : (i % 4 === 0 ? 1 : 0.75));
      }
      // drums
      for (let b = 0; b < 4; b++) {
        if (!menu || b % 2 === 0) kick(t + b * beat, menu ? 0.7 : 1);
        if (b % 2 === 1) clap(t + b * beat, menu ? 0.7 : 1);
        hat(t + b * beat + beat / 2, menu ? 0.05 : 0.09, true);
      }
      if (!menu) for (let i = 0; i < 16; i++) if (i % 2) hat(t + i * s16, 0.03 + (i % 4 === 3 ? 0.02 : 0), false);
      // arpeggio: bright square-ish pluck, filter opens across the phrase
      for (let i = 0; i < 16; i++) {
        if (menu && i % 2) continue;
        const m = ch[ARP[i]] + 24 + (i >= 8 && ARP[i] === 0 ? 12 : 0), f = mtof(m);
        tone('music', t + i * s16, f, f, s16 * 1.6, menu ? 0.035 : 0.05, 'square', (i % 4 - 1.5) * 0.25, { a: 0.003, lp: 1500 + phrase * 260, send: 0.5 });
      }
      // hook: detuned lead stabs on the second half of every phrase
      if (!menu && phrase >= 4) { const hook = [0, 7, 10, 12, 10, 7, 3, 7]; hook.forEach((h, i) => { if (RHY[i * 2] || i % 4 === 0) lead(t + i * beat / 2, ch[0] + 24 + h - (h > 11 ? 12 : 0), beat * 0.45, 1); }); }
      if (menu && bar % 2 === 0) lead(t + beat * 2.5, ch[2] + 24, beat * 1.4, 0.8, 2200);
      // riser + snare roll into the next phrase
      if (phrase === 7) {
        noise('music', t + beat * 2, beat * 2, 0.2, 'bandpass', 400, 7000, 0, { a: beat * 1.9, q: 0.6, send: 0.5 });
        if (!menu) for (let i = 0; i < 8; i++) clap(t + beat * 3 + i * beat / 8, 0.25 + i * 0.05);
      }
      next += barLen; bar++;
    }
  };
  schedule(); musicTimer = setInterval(schedule, 250);
}

export function audioCtx() { return ctx; }
