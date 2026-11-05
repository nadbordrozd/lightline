// Background music: one track behind the menus, another during a match.
// Each track has two <audio> voices so that when it reaches the end the next pass can start
// underneath it and the loop crossfades instead of cutting. Everything goes through Web Audio
// gain nodes (element.volume is read-only on iOS). Browsers only allow sound after the player
// has clicked or pressed a key, so nothing starts until then.
import { audioCtx } from './audio.js';

const SRC = { menu: 'music/nocturnal-neon.mp3', game: 'music/neon-overdrive.mp3' };
const LEVEL = { menu: 0.5, game: 0.42 };
const FADE = 1.2; // seconds to fade from one track to the other
const LOOP_XF = 4; // seconds of overlap when a track loops
const DUCK = 0.35; // music level while the pause menu is open

let ctx = null;
let out = null;
let muted = false;
try { muted = localStorage.getItem('lightline.musicMuted') === '1'; } catch {}
let want = null; // track that should be playing: 'menu' | 'game' | null
let ducked = false;
const fresh = new Set(); // tracks to restart from the top next time they fade in
const tracks = {};

function ramp(param, to, secs) {
  const t = ctx.currentTime;
  param.cancelScheduledValues(t);
  param.setValueAtTime(param.value, t);
  param.linearRampToValueAtTime(to, t + secs);
}

class Track {
  constructor(name) {
    this.name = name;
    this.on = false;
    this.cur = 0;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(out);
    this.voices = [0, 1].map(() => {
      const el = new Audio(SRC[name]);
      el.preload = name === 'menu' ? 'auto' : 'metadata';
      const g = ctx.createGain();
      g.gain.value = 0;
      ctx.createMediaElementSource(el).connect(g).connect(this.gain);
      el.addEventListener('ended', () => {
        if (this.on && this.voices[this.cur].el === el) this.loop(0.05);
      });
      return { el, g, stopAt: 0 };
    });
  }

  play(v) {
    v.stopAt = 0;
    v.el.play().catch(() => {});
  }

  fadeIn() {
    const v = this.voices[this.cur];
    if (fresh.delete(this.name)) {
      for (const o of this.voices) o.el.pause();
      v.el.currentTime = 0;
    }
    this.on = true;
    if (v.g.gain.value < 1) ramp(v.g.gain, 1, 0.05);
    if (v.el.paused) this.play(v);
    ramp(this.gain.gain, LEVEL[this.name], FADE);
  }

  fadeOut() {
    if (!this.on) return;
    this.on = false;
    ramp(this.gain.gain, 0, FADE);
    setTimeout(() => {
      if (!this.on) for (const v of this.voices) v.el.pause();
    }, FADE * 1000 + 100);
  }

  // Start the next pass on the idle voice and crossfade over to it.
  loop(secs) {
    const a = this.voices[this.cur];
    this.cur ^= 1;
    const b = this.voices[this.cur];
    b.el.currentTime = 0;
    this.play(b);
    ramp(a.g.gain, 0, secs);
    ramp(b.g.gain, 1, secs);
    a.stopAt = performance.now() + secs * 1000 + 100;
  }

  poll() {
    const now = performance.now();
    for (const v of this.voices) {
      if (v.stopAt && now >= v.stopAt) {
        v.stopAt = 0;
        v.el.pause();
      }
    }
    if (!this.on) return;
    const { el } = this.voices[this.cur];
    if (!el.paused && el.duration > LOOP_XF * 3 && el.currentTime >= el.duration - LOOP_XF) this.loop(LOOP_XF);
  }
}

function apply() {
  if (!ctx || ctx.state !== 'running') return;
  if (!out) {
    out = ctx.createGain();
    out.connect(ctx.destination);
    for (const name of Object.keys(SRC)) tracks[name] = new Track(name);
    setInterval(() => Object.values(tracks).forEach((t) => t.poll()), 200);
  }
  ramp(out.gain, ducked ? DUCK : 1, 0.4);
  const active = muted || document.hidden ? null : want;
  for (const t of Object.values(tracks)) {
    if (t.name === active) t.fadeIn();
    else t.fadeOut();
  }
}

function unlock() {
  if (!ctx) ctx = audioCtx();
  if (!ctx) return;
  if (ctx.state !== 'running') ctx.resume().then(apply, () => {});
  else if (!out) apply();
}
for (const ev of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(ev, unlock, true);
document.addEventListener('visibilitychange', apply);

export const music = {
  // Which track should play. Switching crossfades; asking for the current one does nothing.
  want(name) {
    if (name === want) return;
    want = name;
    apply();
  },
  // The given track starts from the beginning the next time it comes in.
  restart(name) {
    fresh.add(name);
    if (want === name && tracks[name]?.on) {
      tracks[name].on = false;
      apply();
    }
  },
  duck(on) {
    if (on === ducked) return;
    ducked = on;
    apply();
  },
  isMuted: () => muted,
  setMuted(m) {
    muted = m;
    try { localStorage.setItem('lightline.musicMuted', m ? '1' : '0'); } catch {}
    unlock();
    apply();
  },
};
