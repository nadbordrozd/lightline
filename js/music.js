// Background music. The menus have one track, which loops; matches take turns between the game
// tracks, and when one ends the next one fades in. Each track has two <audio> voices so that a
// track that loops can start its next pass underneath the end of the last one and crossfade
// instead of cutting. Everything goes through Web Audio gain nodes (element.volume is read-only
// on iOS). Browsers only allow sound after the player has clicked or pressed a key, so nothing
// starts until then.
import { audioCtx } from './audio.js';

const FILES = {
  nocturnal: 'music/nocturnal-neon.mp3',
  overdrive: 'music/neon-overdrive.mp3',
  velocity: 'music/neon-velocity.mp3',
};
const SLOTS = { menu: ['nocturnal'], game: ['overdrive', 'velocity'] };
const LEVEL = { nocturnal: 0.5, overdrive: 0.42, velocity: 0.42 };
const FADE = 1.2; // seconds to fade from one track to another
const LOOP_XF = 4; // seconds of overlap when a track loops or hands over to the next
const DUCK = 0.35; // music level while the pause menu is open

let ctx = null;
let out = null;
let muted = false;
try { muted = localStorage.getItem('lightline.musicMuted') === '1'; } catch {}
let want = null; // slot that should be playing: 'menu' | 'game' | null
let ducked = false;
const pick = { menu: 0, game: Math.floor(Math.random() * SLOTS.game.length) }; // current track of each slot
const fresh = new Set(); // tracks to restart from the top next time they fade in
const tracks = {};

const current = (slot) => SLOTS[slot][pick[slot]];

function ramp(param, to, secs) {
  const t = ctx.currentTime;
  param.cancelScheduledValues(t);
  param.setValueAtTime(param.value, t);
  param.linearRampToValueAtTime(to, t + secs);
}

class Track {
  constructor(name, slot) {
    this.name = name;
    this.slot = slot;
    this.on = false;
    this.cur = 0;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(out);
    this.voices = [0, 1].map(() => {
      const el = new Audio(FILES[name]);
      el.preload = slot === 'menu' ? 'auto' : 'metadata';
      const g = ctx.createGain();
      g.gain.value = 0;
      ctx.createMediaElementSource(el).connect(g).connect(this.gain);
      el.addEventListener('ended', () => {
        if (this.on && this.voices[this.cur].el === el) this.finish(0.05);
      });
      return { el, g, stopAt: 0 };
    });
  }

  play(v) {
    v.stopAt = 0;
    v.el.play().catch(() => {});
  }

  fadeIn(secs) {
    const v = this.voices[this.cur];
    if (fresh.delete(this.name)) {
      for (const o of this.voices) o.el.pause();
      v.el.currentTime = 0;
    }
    this.on = true;
    if (v.g.gain.value < 1) ramp(v.g.gain, 1, 0.05);
    if (v.el.paused) this.play(v);
    ramp(this.gain.gain, LEVEL[this.name], secs);
  }

  fadeOut(secs) {
    if (!this.on) return;
    this.on = false;
    ramp(this.gain.gain, 0, secs);
    setTimeout(() => {
      if (!this.on) for (const v of this.voices) v.el.pause();
    }, secs * 1000 + 100);
  }

  // The end is near: loop if this is the slot's only track, otherwise hand over to the next one.
  finish(secs) {
    if (SLOTS[this.slot].length === 1) this.loop(secs);
    else advance(this.slot, secs);
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
    if (!el.paused && el.duration > LOOP_XF * 3 && el.currentTime >= el.duration - LOOP_XF) this.finish(LOOP_XF);
  }
}

// Move a slot on to its next track, which starts from the top.
function advance(slot, secs = FADE) {
  pick[slot] = (pick[slot] + 1) % SLOTS[slot].length;
  fresh.add(current(slot));
  apply(secs);
}

function apply(secs = FADE) {
  if (!ctx || ctx.state !== 'running') return;
  if (!out) {
    out = ctx.createGain();
    out.connect(ctx.destination);
    for (const [slot, names] of Object.entries(SLOTS)) for (const name of names) tracks[name] = new Track(name, slot);
    setInterval(() => Object.values(tracks).forEach((t) => t.poll()), 200);
  }
  ramp(out.gain, ducked ? DUCK : 1, 0.4);
  const active = muted || document.hidden || !want ? null : current(want);
  for (const t of Object.values(tracks)) {
    if (t.name === active) t.fadeIn(secs);
    else t.fadeOut(secs);
  }
}

function unlock() {
  if (!ctx) ctx = audioCtx();
  if (!ctx) return;
  if (ctx.state !== 'running') ctx.resume().then(() => apply(), () => {});
  else if (!out) apply();
}
for (const ev of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(ev, unlock, true);
document.addEventListener('visibilitychange', () => apply());

export const music = {
  // Which slot should play ('menu' or 'game'). Switching crossfades; asking for the current one does nothing.
  want(slot) {
    if (slot === want) return;
    want = slot;
    apply();
  },
  // Move the slot on to its next track, from the top (each new match gets the other game track).
  restart(slot) {
    advance(slot);
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
