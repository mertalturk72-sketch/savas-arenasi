// Dosyasız ses: tüm efektler WebAudio ile sentezleniyor.

let ctx = null;
let master = null;
let enabled = true;

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.35;
  master.connect(ctx.destination);
  return ctx;
}

export function unlockAudio() {
  const c = ensure();
  if (c && c.state === 'suspended') c.resume();
}

export function setVolume(v) { if (master) master.gain.value = v; }
export function setEnabled(v) { enabled = v; }

function noiseBuffer(c, dur) {
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

// 3B his: kaynak uzaklığına göre ses seviyesi ve hafif kanal kaydırması
function place(node, pan, dist, maxDist) {
  const c = ensure();
  const g = c.createGain();
  const att = Math.max(0, 1 - dist / maxDist);
  g.gain.value = att * att;
  if (c.createStereoPanner) {
    const p = c.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    node.connect(p); p.connect(g);
  } else {
    node.connect(g);
  }
  g.connect(master);
  return g;
}

export function sfxShot(weapon, pan = 0, dist = 0) {
  const c = ensure();
  if (!c || !enabled) return;
  const now = c.currentTime;

  const cfg = {
    rifle: { dur: 0.13, f0: 900, f1: 120, gain: 0.55, lp: 2600 },
    lmg: { dur: 0.11, f0: 700, f1: 110, gain: 0.5, lp: 2200 },
    shotgun: { dur: 0.26, f0: 500, f1: 60, gain: 0.9, lp: 1500 },
    sniper: { dur: 0.34, f0: 1400, f1: 90, gain: 1.0, lp: 3400 },
  }[weapon] || { dur: 0.13, f0: 900, f1: 120, gain: 0.55, lp: 2600 };

  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, cfg.dur);
  const filt = c.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.setValueAtTime(cfg.lp, now);
  filt.frequency.exponentialRampToValueAtTime(220, now + cfg.dur);

  const env = c.createGain();
  env.gain.setValueAtTime(cfg.gain, now);
  env.gain.exponentialRampToValueAtTime(0.001, now + cfg.dur);

  src.connect(filt); filt.connect(env);
  place(env, pan, dist, 1400);
  src.start(now); src.stop(now + cfg.dur + 0.02);

  // Alçak "gövde" vuruşu
  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(cfg.f0 * 0.25, now);
  osc.frequency.exponentialRampToValueAtTime(cfg.f1 * 0.5, now + cfg.dur * 0.8);
  const oe = c.createGain();
  oe.gain.setValueAtTime(cfg.gain * 0.5, now);
  oe.gain.exponentialRampToValueAtTime(0.001, now + cfg.dur);
  osc.connect(oe);
  place(oe, pan, dist, 1400);
  osc.start(now); osc.stop(now + cfg.dur + 0.02);
}

export function sfxHit() {
  const c = ensure(); if (!c || !enabled) return;
  const now = c.currentTime;
  const osc = c.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(1500, now);
  osc.frequency.exponentialRampToValueAtTime(900, now + 0.06);
  const g = c.createGain();
  g.gain.setValueAtTime(0.16, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
  osc.connect(g); g.connect(master);
  osc.start(now); osc.stop(now + 0.08);
}

export function sfxHurt() {
  const c = ensure(); if (!c || !enabled) return;
  const now = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, 0.18);
  const f = c.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.value = 320; f.Q.value = 1.2;
  const g = c.createGain();
  g.gain.setValueAtTime(0.4, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(now); src.stop(now + 0.2);
}

export function sfxDeath() {
  const c = ensure(); if (!c || !enabled) return;
  const now = c.currentTime;
  const osc = c.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(320, now);
  osc.frequency.exponentialRampToValueAtTime(48, now + 0.75);
  const g = c.createGain();
  g.gain.setValueAtTime(0.3, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
  osc.connect(g); g.connect(master);
  osc.start(now); osc.stop(now + 0.85);
}

export function sfxPickup() {
  const c = ensure(); if (!c || !enabled) return;
  const now = c.currentTime;
  [660, 990].forEach((f, i) => {
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.value = f;
    const g = c.createGain();
    g.gain.setValueAtTime(0, now + i * 0.07);
    g.gain.linearRampToValueAtTime(0.2, now + i * 0.07 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.07 + 0.16);
    o.connect(g); g.connect(master);
    o.start(now + i * 0.07); o.stop(now + i * 0.07 + 0.18);
  });
}

export function sfxReload() {
  const c = ensure(); if (!c || !enabled) return;
  const now = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, 0.05);
  const f = c.createBiquadFilter();
  f.type = 'highpass'; f.frequency.value = 1800;
  const g = c.createGain();
  g.gain.setValueAtTime(0.22, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(now); src.stop(now + 0.06);
}

export function sfxUi() {
  const c = ensure(); if (!c || !enabled) return;
  const now = c.currentTime;
  const o = c.createOscillator();
  o.type = 'sine'; o.frequency.value = 880;
  const g = c.createGain();
  g.gain.setValueAtTime(0.10, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
  o.connect(g); g.connect(master);
  o.start(now); o.stop(now + 0.1);
}

export function sfxAlarm() {
  const c = ensure(); if (!c || !enabled) return;
  const now = c.currentTime;
  const o = c.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(180, now);
  o.frequency.linearRampToValueAtTime(300, now + 0.35);
  const g = c.createGain();
  g.gain.setValueAtTime(0.14, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
  o.connect(g); g.connect(master);
  o.start(now); o.stop(now + 0.62);
}
