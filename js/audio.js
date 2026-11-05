// Tiny synthesised sound effects (no audio files).
let ctx = null;
let master = null;
let noiseBuf = null;
let muted = false;
try { muted = localStorage.getItem('lightline.muted') === '1'; } catch {}

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.32;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, dur, { type = 'sine', vol = 0.3, to = null, delay = 0 } = {}) {
  const c = ac();
  if (!c || muted) return;
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur, { vol = 0.3, from = 3000, to = 200 } = {}) {
  const c = ac();
  if (!c || muted) return;
  const t = c.currentTime;
  const s = c.createBufferSource();
  s.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(from, t);
  f.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(master);
  s.start(t);
  s.stop(t + dur);
}

let lastDeath = 0;
export const sfx = {
  unlock: () => ac(),
  isMuted: () => muted,
  setMuted(m) {
    muted = m;
    try { localStorage.setItem('lightline.muted', m ? '1' : '0'); } catch {}
    if (master) master.gain.value = m ? 0 : 0.32;
  },
  count: () => tone(523, 0.12, { type: 'square', vol: 0.12 }),
  go: () => tone(1046, 0.35, { type: 'square', vol: 0.14 }),
  pickup: () => tone(620, 0.14, { type: 'triangle', vol: 0.22, to: 1400 }),
  slow: () => tone(500, 0.2, { type: 'triangle', vol: 0.2, to: 200 }),
  god: () => { tone(400, 0.5, { type: 'sawtooth', vol: 0.08, to: 1600 }); tone(600, 0.5, { type: 'triangle', vol: 0.12, to: 2400 }); },
  teleport: () => tone(240, 0.28, { type: 'sine', vol: 0.25, to: 1800 }),
  swap: () => { tone(900, 0.2, { type: 'triangle', vol: 0.18, to: 300 }); tone(300, 0.2, { type: 'triangle', vol: 0.18, to: 900, delay: 0.08 }); },
  wall: () => tone(140, 0.18, { type: 'square', vol: 0.15, to: 90 }),
  bomb: () => { noise(0.8, { vol: 0.5, from: 1200, to: 60 }); tone(110, 0.6, { type: 'sine', vol: 0.4, to: 30 }); },
  death() {
    const now = performance.now();
    if (now - lastDeath < 60) return;
    lastDeath = now;
    noise(0.45, { vol: 0.35, from: 4000, to: 150 });
    tone(220, 0.4, { type: 'sawtooth', vol: 0.1, to: 40 });
  },
  win: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.22, { type: 'triangle', vol: 0.18, delay: i * 0.09 })),
  draw: () => [392, 330, 262].forEach((f, i) => tone(f, 0.25, { type: 'triangle', vol: 0.16, delay: i * 0.1 })),
  click: () => tone(1400, 0.04, { type: 'square', vol: 0.05 }),
};
