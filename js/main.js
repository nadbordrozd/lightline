import { TICK_MS, COLORS, DEFAULT_SLOTS, MATCH_WINS, TRAIL_STYLES, DEFAULT_LOOK, keyLabel, playerPalette } from './constants.js';
import { Game, MODES, LEVELS } from './sim.js';
import { Renderer, bonusSprite } from './render.js';
import { BONUS_TYPES } from './art.js';
import { sfx } from './audio.js';
import { music } from './music.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const store = {
  get(k, d) {
    try { const v = localStorage.getItem('lightline.' + k); return v == null ? d : JSON.parse(v); } catch { return d; }
  },
  set(k, v) {
    try { localStorage.setItem('lightline.' + k, JSON.stringify(v)); } catch {}
  },
};
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const app = $('#app');
export const renderer = new Renderer($('#stage'));
let session = null;

// ------------------------------------------------------------------ screens & toast
export function showScreen(name) {
  app.dataset.screen = name;
  const inMatch = session && !session.demo && (name === 'game' || name === 'pause');
  music.want(inMatch ? 'game' : 'menu');
  music.duck(name === 'pause');
}
export function screen() {
  return app.dataset.screen;
}
let toastTimer = 0;
export function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
export const colorVars = (ci) => {
  const p = playerPalette(ci);
  return `--h:${p.hue};--s:${p.sat}%;--l:${p.light}%`;
};

// ------------------------------------------------------------------ line speed
// The line speed setting, as a fraction of the standard speed (1 = 100%). It applies to new games
// and, from the pause menu, to the game in progress. Online, only the host's setting counts.
export const SPEED_MIN = 0.25;
export const SPEED_MAX = 2.5;
export const SPEED_DEFAULT = 1;
const clampSpeed = (v) => Math.min(SPEED_MAX, Math.max(SPEED_MIN, Math.round((+v || SPEED_DEFAULT) * 20) / 20));
let speedMul = clampSpeed(store.get('lineSpeed', SPEED_DEFAULT));
export const getSpeed = () => speedMul;
function setSpeed(v) {
  speedMul = clampSpeed(v);
  store.set('lineSpeed', speedMul);
  if (session?.game && !session.demo) session.game.speedMul = speedMul;
  syncSpeedControls();
}
function syncSpeedControls() {
  for (const el of $$('.speed-ctl')) {
    const input = $('input', el);
    if (+input.value !== speedMul) input.value = speedMul;
    $('.speed-val', el).textContent = Math.round(speedMul * 100) + '%';
    $('.speed-reset', el).disabled = speedMul === SPEED_DEFAULT;
  }
}
for (const el of $$('.speed-ctl')) {
  el.innerHTML = `
    <input type="range" min="${SPEED_MIN}" max="${SPEED_MAX}" step="0.05" aria-label="Line speed">
    <span class="speed-val"></span>
    <button class="btn btn-small speed-reset" title="Back to the standard speed (100%)">Reset</button>`;
  $('input', el).oninput = (e) => setSpeed(e.target.value);
  $('.speed-reset', el).onclick = () => setSpeed(SPEED_DEFAULT);
}
syncSpeedControls();

// ------------------------------------------------------------------ look (trail width)
// Both take effect from the next round, including in the demo behind the menu. Online, the
// host's choice is sent to everyone with each round.
const LOOK_OPTIONS = {
  trails: { label: 'Trails', values: TRAIL_STYLES, names: { thin: 'Thin', bold: 'Bold' } },
};
const look = {};
for (const [k, o] of Object.entries(LOOK_OPTIONS)) {
  const v = store.get(k, DEFAULT_LOOK[k]);
  look[k] = o.values.includes(v) ? v : DEFAULT_LOOK[k];
}
export const getLook = () => ({ ...look });
function setLook(k, v) {
  look[k] = v;
  store.set(k, v);
  if (session?.game) session.game.look = getLook();
  syncLookControls();
}
function syncLookControls() {
  for (const b of $$('.look-ctl [data-look]')) b.classList.toggle('sel', look[b.dataset.look] === b.dataset.v);
}
for (const el of $$('.look-ctl')) {
  el.innerHTML = Object.entries(LOOK_OPTIONS)
    .map(([k, o]) => `<div class="look-row"><span>${o.label}</span><div class="seg">${o.values.map((v) => `<button data-look="${k}" data-v="${v}">${o.names[v]}</button>`).join('')}</div></div>`)
    .join('');
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-look]');
    if (b) setLook(b.dataset.look, b.dataset.v);
  });
}
syncLookControls();

// ------------------------------------------------------------------ main loop
// The simulation is stepped from a Web Worker timer, because browsers throttle main-thread
// timers (and pause requestAnimationFrame) in background tabs. Rendering uses requestAnimationFrame.
function startTicker(onTick) {
  const src = 'let t=0;onmessage=e=>{clearInterval(t);if(e.data>0)t=setInterval(()=>postMessage(0),e.data)}';
  try {
    const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    w.onmessage = onTick;
    w.postMessage(8);
  } catch {
    setInterval(onTick, 8);
  }
}
let acc = 0;
let lastTick = performance.now();
startTicker(() => {
  const now = performance.now();
  const dt = now - lastTick;
  lastTick = now;
  if (!session || !session.ticking || session.paused) {
    acc = 0;
    return;
  }
  acc = Math.min(acc + dt, TICK_MS * 6);
  while (acc >= TICK_MS && session?.ticking && !session.paused) {
    acc -= TICK_MS;
    session.step();
  }
});
requestAnimationFrame(function raf(now) {
  renderer.frame(now);
  requestAnimationFrame(raf);
});

export function setSession(s) {
  session?.destroy();
  session = s;
  if (s && !s.demo) music.restart('game'); // every match starts the game track from the top
}
export function getSession() {
  return session;
}

// ------------------------------------------------------------------ HUD
class Hud {
  constructor() {
    this.board = $('#scoreboard');
    this.round = $('#hud-round');
    this.banner = $('#banner');
    this.cd = $('#countdown');
  }

  startRound(info, s) {
    this.cd.innerHTML = '';
    this.lastCd = null;
    if (s.demo) {
      this.hideBanner();
      return;
    }
    this.players = info.players;
    this.board.innerHTML = info.players
      .map((p, i) => `<div class="chip${s.isMine(p) ? ' mine' : ''}" data-i="${i}" style="${colorVars(p.color)}"><i></i><span class="n">${esc(p.name)}</span><b>${p.wins}</b></div>`)
      .join('');
    const lvl = LEVELS[info.level];
    this.round.textContent = `Round ${info.round} · ${lvl.name}` + (info.target ? ` · first to ${info.target}` : '');
    this.showBanner(
      `<div class="kicker">Round ${info.round}</div><div class="title">${esc(lvl.name)}</div><div class="sub">${esc(lvl.desc)}</div>`,
      'intro',
    );
  }

  frame(fr, s) {
    if (s.demo) return;
    if (fr.ph === 'countdown' && fr.cd !== this.lastCd && fr.cd > 0) {
      this.lastCd = fr.cd;
      this.cd.innerHTML = `<span>${fr.cd}</span>`;
      sfx.count();
    }
    if (fr.go) {
      this.cd.innerHTML = '<span class="go">GO</span>';
      this.hideBanner();
      sfx.go();
    }
    for (const e of fr.ev) {
      switch (e.k) {
        case 'die':
          this.board.querySelector(`[data-i="${e.p}"]`)?.classList.add('dead');
          sfx.death();
          break;
        case 'take':
          ({ slow: sfx.slow, god: sfx.god, teleport: sfx.teleport, switch: sfx.swap, wall: sfx.wall, bomb: sfx.bomb }[e.type] ?? sfx.pickup)();
          break;
        case 'end':
          this.roundOver(e, s);
          break;
      }
    }
  }

  roundOver(e, s) {
    e.wins.forEach((w, i) => {
      const chip = this.board.querySelector(`[data-i="${i}"]`);
      if (!chip) return;
      const b = chip.querySelector('b');
      if (b.textContent !== String(w)) {
        b.textContent = w;
        chip.classList.add('bump');
      }
    });
    const p = e.w >= 0 ? this.players[e.w] : null;
    const title = p ? `${esc(p.name)} wins` : 'Draw';
    const style = p ? `style="--c:${playerPalette(p.color).core}"` : '';
    if (e.champ >= 0 && p) {
      // That was the deciding round: say so, then bring up the winner screen.
      sfx.champion();
      this.showBanner(`<div class="kicker">Round ${s.roundNo ?? ''} over</div><div class="title" ${style}>${title}</div><div class="sub">…and takes the match</div>`);
      const standings = this.players.map((pl, i) => ({ ...pl, wins: e.wins[i] ?? pl.wins }));
      s.later(() => showWinner(standings, e.champ, s), 2400);
      return;
    }
    if (p) sfx.win();
    else sfx.draw();
    this.showBanner(
      `<div class="kicker">Round ${s.roundNo ?? ''} over</div><div class="title" ${style}>${title}</div>${s.nextHint()}`,
    );
  }

  showBanner(html, cls = '') {
    this.banner.className = 'banner show ' + cls;
    this.banner.innerHTML = html;
  }

  hideBanner() {
    this.banner.className = 'banner';
  }

  hide() {
    this.hideBanner();
    this.cd.innerHTML = '';
  }
}
export const hud = new Hud();

// ------------------------------------------------------------------ sessions
export class Session {
  constructor() {
    this.ticking = false;
    this.paused = false;
    this.demo = false;
    this.keymap = new Map();
    this.timers = [];
  }
  later(fn, ms) {
    this.timers.push(setTimeout(fn, ms));
  }
  isMine() {
    return false;
  }
  nextHint() {
    return '';
  }
  onRound(info) {
    this.roundNo = info.round;
    renderer.setPlayers(info.players);
    renderer.startRound(info);
    hud.startRound(info, this);
  }
  onFrame(fr) {
    renderer.applyFrame(fr, performance.now());
    hud.frame(fr, this);
  }
  key(code) {
    const m = this.keymap.get(code);
    if (m) this.turn(m.i, m.d);
    return !!m;
  }
  turn() {}
  next() {}
  pauseButtons() {
    return [];
  }
  winnerButtons() {
    return [['Main menu', () => toMenu()]];
  }
  winnerNote() {
    return '';
  }
  destroy() {
    this.ticking = false;
    this.timers.forEach(clearTimeout);
  }
}

// A game simulated in this browser: local hot-seat play and the attract-mode demo behind the menus.
class LocalSession extends Session {
  constructor(slots, mode, { demo = false } = {}) {
    super();
    this.demo = demo;
    this.slots = slots;
    this.mode = mode;
    const roster = slots.map((s, i) => ({ id: 's' + i, name: COLORS[s.color].name, color: s.color, kind: s.kind }));
    this.game = new Game(roster, mode, { look, ...(demo ? { speedMul: SPEED_DEFAULT, target: 0 } : { speedMul }) });
    slots.forEach((s, i) => {
      if (s.kind !== 'human') return;
      this.keymap.set(s.keys[0], { i, d: -1 });
      this.keymap.set(s.keys[1], { i, d: 1 });
    });
    this.newRound();
  }
  isMine(p) {
    return p.kind === 'human';
  }
  newRound() {
    this.onRound(this.game.startRound());
    this.ticking = true;
  }
  turn(i, d) {
    this.game.queueTurn(i, d);
  }
  step() {
    const fr = this.game.tick();
    this.onFrame(fr);
    if (this.game.phase === 'over') {
      this.ticking = false;
      if (this.demo) this.later(() => this.newRound(), 2200);
    }
  }
  next() {
    if (this.game.phase === 'over' && this.game.champion < 0) this.newRound();
  }
  nextHint() {
    return '<div class="sub">Press <kbd>Space</kbd> for the next round</div><div class="actions"><button class="btn btn-primary" data-action="next">Next round</button></div>';
  }
  pauseButtons() {
    return [
      ['Resume', () => resumeGame()],
      ['Restart match', () => startLocal(this.slots, this.mode)],
      ['Back to setup', () => { setSession(null); openLocalSetup(); }],
      ['Quit to menu', () => toMenu()],
    ];
  }
  winnerButtons() {
    return [
      ['Main menu', () => toMenu()],
      ['Play again', () => startLocal(this.slots, this.mode)],
      ['Change setup', () => { setSession(null); openLocalSetup(); }],
    ];
  }
}

export function startDemo() {
  const kinds = ['hard', 'easy', 'hard', 'easy', 'hard'];
  const slots = kinds.map((kind, i) => ({ color: [4, 6, 1, 3, 0][i], kind, keys: [] }));
  setSession(new LocalSession(slots, 'shuffle', { demo: true }));
}

export function toMenu() {
  hud.hide();
  startDemo();
  showScreen('menu');
}

// ------------------------------------------------------------------ match winner
let winnerAt = 0;
function showWinner(players, champ, s) {
  if (session !== s) return;
  const c = players[champ];
  $('#winner-panel').style.cssText = `--c:${playerPalette(c.color).core};` + colorVars(c.color);
  $('#winner-name').textContent = c.name;
  $('#winner-sub').textContent = `wins the match · first to ${c.wins}`;
  const top = Math.max(1, c.wins);
  const ranked = players.map((p, i) => ({ ...p, i })).sort((a, b) => b.wins - a.wins || a.i - b.i);
  $('#winner-table').innerHTML = ranked
    .map((p) => `<li class="${p.i === champ ? 'champ' : ''}" style="${colorVars(p.color)}"><i></i><span class="n">${esc(p.name)}</span><span class="bar"><span style="width:${(100 * p.wins) / top}%"></span></span><b>${p.wins}</b></li>`)
    .join('');
  const note = s.winnerNote();
  $('#winner-note').textContent = note;
  $('#winner-note').hidden = !note;
  const box = $('#winner-buttons');
  box.innerHTML = '';
  s.winnerButtons().forEach(([label, fn], i) => {
    const b = document.createElement('button');
    b.className = 'btn' + (i === 0 ? ' btn-primary' : '');
    b.textContent = label;
    b.onclick = fn;
    box.appendChild(b);
  });
  hud.hide();
  showScreen('winner');
  // People are often still hammering Space from the last round, so ignore keys for a moment.
  winnerAt = performance.now();
  setTimeout(() => { if (screen() === 'winner') box.firstChild?.focus(); }, 1200);
}

// ------------------------------------------------------------------ pause
export function openPause() {
  if (!session || session.demo) return;
  if (session instanceof LocalSession) session.paused = true;
  $('#pause-title').textContent = session instanceof LocalSession ? 'Paused' : 'Menu';
  $('#pause-speed').hidden = !session.game; // guests can't change the host's speed
  const box = $('#pause-buttons');
  box.innerHTML = '';
  session.pauseButtons().forEach(([label, fn], i) => {
    const b = document.createElement('button');
    b.className = 'btn' + (i === 0 ? ' btn-primary' : '');
    b.textContent = label;
    b.onclick = fn;
    box.appendChild(b);
  });
  showScreen('pause');
  box.firstChild?.focus();
}
export function resumeGame() {
  if (session) session.paused = false;
  showScreen('game');
}

// ------------------------------------------------------------------ local setup
const KINDS = [['off', 'Off'], ['human', 'Player'], ['easy', 'Easy bot'], ['hard', 'Hard bot']];
let slots = loadSlots();
let localMode = MODES[store.get('mode')] ? store.get('mode') : 'shuffle';
let listening = null; // { slot, k, el } while rebinding a key

function loadSlots() {
  const saved = store.get('slots', null);
  if (!Array.isArray(saved) || saved.length !== DEFAULT_SLOTS.length) return structuredClone(DEFAULT_SLOTS);
  return saved.map((s, i) => ({
    color: DEFAULT_SLOTS[i].color,
    kind: KINDS.some(([k]) => k === s.kind) ? s.kind : 'off',
    keys: Array.isArray(s.keys) && s.keys.length === 2 ? s.keys : DEFAULT_SLOTS[i].keys,
  }));
}

function openLocalSetup() {
  renderLocalSetup();
  showScreen('local');
}

function renderLocalSetup() {
  const grid = $('#player-grid');
  grid.innerHTML = '';
  slots.forEach((s, i) => {
    const c = COLORS[s.color];
    const card = document.createElement('div');
    card.className = 'pcard' + (s.kind !== 'off' ? ' on' : '');
    card.style.cssText = colorVars(s.color);
    const keys = s.kind === 'human'
      ? `<button class="key" data-k="0" title="Turn left">${esc(keyLabel(s.keys[0]))}</button><span>left · right</span><button class="key" data-k="1" title="Turn right">${esc(keyLabel(s.keys[1]))}</button>`
      : s.kind === 'off'
        ? '<span>not playing</span>'
        : '<span class="bot-label">computer controlled</span>';
    card.innerHTML = `
      <div class="pcard-head"><span class="dot"></span><span class="pname">${c.name.toUpperCase()}</span></div>
      <div class="seg">${KINDS.map(([k, l]) => `<button data-kind="${k}" class="${s.kind === k ? 'sel' : ''}">${l}</button>`).join('')}</div>
      <div class="pkeys">${keys}</div>`;
    card.querySelectorAll('[data-kind]').forEach((b) => {
      b.onclick = () => {
        s.kind = b.dataset.kind;
        saveSetup();
        renderLocalSetup();
      };
    });
    card.querySelectorAll('.key').forEach((b) => {
      b.onclick = () => {
        if (listening) listening.el.classList.remove('listening');
        listening = { slot: i, k: +b.dataset.k, el: b };
        b.classList.add('listening');
        b.textContent = 'press…';
      };
    });
    grid.appendChild(card);
  });
  renderModes($('#local-modes'), localMode, (m) => {
    localMode = m;
    saveSetup();
    renderLocalSetup();
  });
  const n = slots.filter((s) => s.kind !== 'off').length;
  const humans = slots.filter((s) => s.kind === 'human').length;
  const start = $('#btn-local-start');
  start.disabled = n < 2;
  start.textContent = n < 2 ? 'Start' : `Start · ${n} players`;
  const st = $('#local-status');
  st.textContent = n < 2 ? 'Pick at least two players (bots count).' : humans === 0 ? 'Bots only: sit back and watch.' : '';
}

export function renderModes(el, selected, onPick, readonly = false) {
  el.innerHTML = '';
  for (const [key, m] of Object.entries(MODES)) {
    const b = document.createElement('button');
    b.className = 'mode' + (key === selected ? ' sel' : '');
    b.disabled = readonly;
    const tags = key === 'shuffle' ? `<div class="tags">${m.levels.map((l) => `<span>${LEVELS[l].name}</span>`).join('')}</div>` : '';
    b.innerHTML = `<div class="mname">${m.name.toUpperCase()}</div><div class="mdesc">${esc(m.desc)}</div>${tags}`;
    if (!readonly) b.onclick = () => onPick(key);
    el.appendChild(b);
  }
}

function saveSetup() {
  store.set('slots', slots);
  store.set('mode', localMode);
}

function rebind(code) {
  const { slot, k } = listening;
  listening = null;
  if (code !== 'Escape') {
    const s = slots[slot];
    const old = s.keys[k];
    // If another control already uses this key, give it the key we're replacing.
    for (const o of slots) {
      for (let j = 0; j < 2; j++) if (o.keys[j] === code && !(o === s && j === k)) o.keys[j] = old;
    }
    s.keys[k] = code;
    saveSetup();
  }
  renderLocalSetup();
}

function startLocal(useSlots = slots, mode = localMode) {
  const active = useSlots.filter((s) => s.kind !== 'off').map((s) => ({ ...s, keys: [...s.keys] }));
  if (active.length < 2) return;
  sfx.unlock();
  setSession(new LocalSession(active, mode));
  showScreen('game');
}

// ------------------------------------------------------------------ help
function renderHelp() {
  $('#help-levels').innerHTML = MODES.shuffle.levels.map((l) => `<li><b>${LEVELS[l].name.toUpperCase()}</b><span>${esc(LEVELS[l].desc)}</span></li>`).join('');
  const list = $('#help-bonuses');
  list.innerHTML = '';
  for (const [type, t] of Object.entries(BONUS_TYPES)) {
    const li = document.createElement('li');
    const icon = document.createElement('div');
    icon.className = 'icon';
    const sp = bonusSprite(type, type === 'wall' ? 'h' : '');
    const c = document.createElement('canvas');
    c.width = sp.canvas.width;
    c.height = sp.canvas.height;
    c.getContext('2d').drawImage(sp.canvas, 0, 0);
    c.style.width = `${sp.w * 2.4}px`;
    icon.appendChild(c);
    li.appendChild(icon);
    li.insertAdjacentHTML('beforeend', `<div><b style="color:hsl(${t.hue} 100% 70%)">${t.name}</b><span>${esc(t.desc)}</span></div>`);
    list.appendChild(li);
  }
}

// ------------------------------------------------------------------ input
const GAME_KEYS = new Set(['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageDown', 'PageUp', 'Tab']);
window.addEventListener('keydown', (e) => {
  if (listening) {
    e.preventDefault();
    rebind(e.code);
    return;
  }
  const scr = screen();
  if (e.target instanceof HTMLInputElement) return;
  if (scr === 'winner') {
    if (performance.now() - winnerAt < 1200) e.preventDefault();
    else if (e.code === 'Escape') $('#winner-buttons button')?.click();
    return;
  }
  if (scr === 'game') {
    if (e.repeat && GAME_KEYS.has(e.code)) {
      e.preventDefault();
      return;
    }
    if (e.code === 'Escape') {
      openPause();
      return;
    }
    if (!e.repeat && session?.key(e.code)) {
      e.preventDefault();
      return;
    }
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      session?.next();
      return;
    }
    if (GAME_KEYS.has(e.code)) e.preventDefault();
  } else if (scr === 'pause' && e.code === 'Escape') {
    session?.pauseButtons()[0]?.[1]();
  } else if (e.code === 'Escape' && ['local', 'help', 'about', 'online'].includes(scr)) {
    showScreen('menu');
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && session instanceof LocalSession && !session.demo && screen() === 'game') openPause();
});

// ------------------------------------------------------------------ wiring
$$('[data-go]').forEach((b) => {
  b.addEventListener('click', () => {
    sfx.unlock();
    const go = b.dataset.go;
    if (go === 'local') openLocalSetup();
    else if (go === 'help') showScreen('help');
    else if (go === 'about') showScreen('about');
    else if (go === 'online') openOnline();
    else showScreen(go);
  });
});
$('#btn-local-start').onclick = () => startLocal();
$('#btn-pause').onclick = () => openPause();
$('#banner').addEventListener('click', (e) => {
  if (e.target.closest('[data-action="next"]')) session?.next();
});
const SLASH = '<path d="M3 3l18 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>';
const paintAudio = () => {
  for (const b of $$('.btn-sound')) {
    b.classList.toggle('off', sfx.isMuted());
    b.innerHTML = sfx.isMuted()
      ? '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" stroke-width="2"/></svg>'
      : '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
  }
  for (const b of $$('.btn-music')) {
    b.classList.toggle('off', music.isMuted());
    b.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18"><path d="M9 17V5l11-2v12" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="6.5" cy="17.5" r="2.8" fill="currentColor"/><circle cx="17.5" cy="15.5" r="2.8" fill="currentColor"/>${music.isMuted() ? SLASH : ''}</svg>`;
  }
};
$$('.btn-sound').forEach((b) => { b.onclick = () => { sfx.setMuted(!sfx.isMuted()); paintAudio(); }; });
$$('.btn-music').forEach((b) => { b.onclick = () => { music.setMuted(!music.isMuted()); paintAudio(); }; });
paintAudio();

// Online play is loaded on demand so local play never needs the network.
async function openOnline(code) {
  const mod = await import('./online.js');
  mod.openOnline(code);
}

renderHelp();
toMenu();
const roomParam = new URLSearchParams(location.search).get('room');
if (roomParam) {
  history.replaceState(null, '', location.pathname);
  openOnline(roomParam);
}
