import { TICK_MS, COLORS, DEFAULT_SLOTS, MATCH_WINS, TRAIL_STYLES, DEFAULT_LOOK, DEFAULT_CATCHUP, keyLabel, playerPalette } from './constants.js';
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
  const inMatch = session && !session.demo && ['game', 'pause', 'help'].includes(name);
  music.want(inMatch ? 'game' : 'menu');
  music.duck(inMatch && name !== 'game');
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

// ------------------------------------------------------------------ who steers with which keys
// A control is { name, color, keys: [left, right] } for one player steered from this computer.
const cap = (code, cls = '') => `<kbd class="cap${cls ? ' ' + cls : ''}">${esc(keyLabel(code))}</kbd>`;
// Compact: dot, name and both keys in a row (the round intro).
const ctlChip = (c) => `<span class="ctl" style="${colorVars(c.color)}"><i></i><span class="n">${esc(c.name)}</span>${cap(c.keys[0])}${cap(c.keys[1])}</span>`;
// Large, with captions (the help page and the online lobby).
export const ctlRow = (c) =>
  `<div class="ctl-row" style="${colorVars(c.color)}"><i></i><span class="n">${esc(c.name)}</span>` +
  `<span class="pair">${cap(c.keys[0], 'big')}<small>turn left</small></span>` +
  `<span class="pair">${cap(c.keys[1], 'big')}<small>turn right</small></span></div>`;

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

// ------------------------------------------------------------------ catch-up speeds
// The slowest and fastest speeds in Catch-up mode. Like the line speed, they apply to new games
// and, from the pause menu, from the next round of the game in progress. Online, the host's count.
const CATCHUP_MIN = 0.25;
const CATCHUP_MAX = 3;
const clampCu = (v, d) => Math.min(CATCHUP_MAX, Math.max(CATCHUP_MIN, Math.round((+v || d) * 20) / 20));
const savedCu = store.get('catchup', DEFAULT_CATCHUP);
const catchup = { lo: clampCu(savedCu?.lo, DEFAULT_CATCHUP.lo), hi: clampCu(savedCu?.hi, DEFAULT_CATCHUP.hi) };
export const getCatchup = () => ({ ...catchup });
function setCatchup(k, v) {
  catchup[k] = clampCu(v, DEFAULT_CATCHUP[k]);
  store.set('catchup', catchup);
  if (session?.game && !session.demo) session.game.catchup = getCatchup();
  syncCatchupControls();
}
function syncCatchupControls() {
  for (const el of $$('.catchup-ctl')) {
    for (const k of ['lo', 'hi']) {
      const input = $(`input[data-cu="${k}"]`, el);
      if (+input.value !== catchup[k]) input.value = catchup[k];
      $(`[data-cu-val="${k}"]`, el).textContent = Math.round(catchup[k] * 100) + '%';
    }
    $('.speed-reset', el).disabled = catchup.lo === DEFAULT_CATCHUP.lo && catchup.hi === DEFAULT_CATCHUP.hi;
  }
}
for (const el of $$('.catchup-ctl')) {
  const row = (k, label) => `
    <div class="cu-row"><span>${label}</span>
      <input type="range" data-cu="${k}" min="${CATCHUP_MIN}" max="${CATCHUP_MAX}" step="0.05" aria-label="Speed with ${label.toLowerCase()}">
      <b data-cu-val="${k}"></b></div>`;
  el.innerHTML = `
    <h3>Catch-up speeds</h3>
    ${row('lo', 'No wins')}
    ${row('hi', `${MATCH_WINS - 1} wins`)}
    <div class="cu-foot"><span class="hint">Of the line speed. Everyone in between gets an even step per win.</span>
      <button class="btn btn-small speed-reset" title="Back to ${DEFAULT_CATCHUP.lo * 100}% and ${DEFAULT_CATCHUP.hi * 100}%">Reset</button></div>`;
  el.addEventListener('input', (e) => { if (e.target.dataset.cu) setCatchup(e.target.dataset.cu, e.target.value); });
  $('.speed-reset', el).onclick = () => { setCatchup('lo', DEFAULT_CATCHUP.lo); setCatchup('hi', DEFAULT_CATCHUP.hi); };
}
syncCatchupControls();
// Catch-up settings only show while that mode is picked.
export function showCatchupControls(el, mode) {
  el.hidden = !MODES[mode]?.catchup;
}

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
      .map((p, i) => `<div class="chip${s.isMine(p) ? ' mine' : ''}" data-i="${i}" style="${colorVars(p.color)}"><i></i><span class="n">${esc(p.name)}</span>${info.catchup ? `<small class="spd" title="Speed this round">${Math.round((p.mul ?? 1) * 100)}%</small>` : ''}<b>${p.wins}</b></div>`)
      .join('');
    const lvl = LEVELS[info.level];
    this.round.textContent = `Round ${info.round} · ${lvl.name}` + (info.target ? ` · first to ${info.target}` : '');
    const ctl = s.controls();
    const keys = ctl.length
      ? `<div class="keys-reminder"><div class="kicker">${ctl.length > 1 ? 'Keys' : 'Your keys'}</div><div class="ctls">${ctl.map(ctlChip).join('')}</div></div>`
      : '';
    this.showBanner(
      `<div class="kicker">Round ${info.round}</div><div class="title">${esc(lvl.name)}</div><div class="sub">${esc(lvl.desc)}</div>${keys}`,
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
  // The players steered from this computer and their keys, read off the key map. Online, that's
  // only this player's own (or their couch's), never everyone else's.
  controls() {
    const by = new Map();
    for (const [code, { i, d }] of this.keymap) {
      if (!by.has(i)) by.set(i, { i, keys: [] });
      by.get(i).keys[d < 0 ? 0 : 1] = code;
    }
    return [...by.values()]
      .sort((a, b) => a.i - b.i)
      .map((c) => ({ ...c, name: this.players?.[c.i]?.name ?? '', color: this.players?.[c.i]?.color ?? 0 }));
  }
  nextHint() {
    return '';
  }
  onRound(info) {
    this.roundNo = info.round;
    this.players = info.players;
    renderer.setPlayers(info.players);
    renderer.keyLabels = [];
    for (const c of this.controls()) renderer.keyLabels[c.i] = `${keyLabel(c.keys[0])}   ${keyLabel(c.keys[1])}`;
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
    this.game = new Game(roster, mode, { look, catchup, ...(demo ? { speedMul: SPEED_DEFAULT, target: 0 } : { speedMul }) });
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
  if (session.game) showCatchupControls($('#pause-speed .catchup-ctl'), session.game.mode);
  const box = $('#pause-buttons');
  box.innerHTML = '';
  const buttons = session.pauseButtons();
  buttons.splice(1, 0, ['How to play', () => openHelp()]);
  buttons.forEach(([label, fn], i) => {
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
// Bumped when the default setup changed (to one player against an easy bot), so returning players see it too.
const SLOTS_KEY = 'slots.v2';
const KINDS = [['off', 'Off'], ['human', 'Player'], ['easy', 'Easy bot'], ['hard', 'Hard bot']];
let slots = loadSlots();
let localMode = MODES[store.get('mode')] ? store.get('mode') : 'shuffle';
let listening = null; // { slot, k, el } while rebinding a key

function loadSlots() {
  const saved = store.get(SLOTS_KEY, null);
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
    card.className = 'pcard' + (s.kind !== 'off' ? ' on' : '') + (s.kind === 'human' ? ' human' : '');
    card.style.cssText = colorVars(s.color);
    const keys = s.kind === 'human'
      ? [0, 1].map((k) => `<div class="pair"><button class="key cap big" data-k="${k}" title="Click to change">${esc(keyLabel(s.keys[k]))}</button><small>turn ${k ? 'right' : 'left'}</small></div>`).join('')
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
  showCatchupControls($('#screen-local .catchup-ctl'), localMode);
  const n = slots.filter((s) => s.kind !== 'off').length;
  const humans = slots.filter((s) => s.kind === 'human').length;
  const start = $('#btn-local-start');
  start.disabled = n < 2;
  start.textContent = n < 2 ? 'Start' : `Start · ${n} players`;
  const st = $('#local-status');
  st.textContent = n < 2 ? 'Pick at least two players (bots count).' : humans === 0 ? 'Bots only: sit back and watch.' : '';
  // Nudge solo players towards multiplayer, which is what the game is really for.
  const call = $('#local-callout');
  call.classList.toggle('solo', humans <= 1);
  call.innerHTML = humans <= 1
    ? '<b>Lightline is best with friends.</b> Switch another colour to <b>Player</b> to share this keyboard (up to 8 can play), or <button class="link" data-online>play online</button>.'
    : `<b>${humans} players on one keyboard.</b> Check your keys below: they're shown again before every round.`;
  $('[data-online]', call)?.addEventListener('click', () => openOnline());
}

export function renderModes(el, selected, onPick, readonly = false) {
  el.innerHTML = '';
  for (const [key, m] of Object.entries(MODES)) {
    const b = document.createElement('button');
    b.className = 'mode' + (key === selected ? ' sel' : '');
    b.disabled = readonly;
    const tags = m.levels.length > 1 ? `<div class="tags">${m.levels.map((l) => `<span>${LEVELS[l].name}</span>`).join('')}</div>` : '';
    b.innerHTML = `<div class="mname">${m.name.toUpperCase()}</div><div class="mdesc">${esc(m.desc)}</div>${tags}`;
    if (!readonly) b.onclick = () => onPick(key);
    el.appendChild(b);
  }
}

function saveSetup() {
  store.set(SLOTS_KEY, slots);
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
// Opened from the main menu it's just the rules. Opened during a match (the ? button or the pause
// menu) it pauses a local game and starts with who steers with which keys.
let helpFrom = 'menu';
export function openHelp() {
  const from = screen();
  const s = session && !session.demo && (from === 'game' || from === 'pause') ? session : null;
  helpFrom = s ? from : 'menu';
  if (s instanceof LocalSession) s.paused = true;
  const box = $('#help-controls');
  box.hidden = !s;
  if (s) {
    const ctl = s.controls();
    $('#help-controls-title').textContent = ctl.length > 1 ? 'Who steers with which keys' : 'Your keys';
    $('#help-controls-list').innerHTML = ctl.length
      ? ctl.map(ctlRow).join('')
      : '<p class="hint">Nobody on this computer is steering in this match.</p>';
    $('#help-controls-note').textContent = s instanceof LocalSession
      ? 'The game is paused until you go back.'
      : 'Online games can’t be paused: the match keeps running while you read this.';
  }
  showScreen('help');
  $('#screen-help').scrollTop = 0;
}
function closeHelp() {
  if (helpFrom === 'game') resumeGame();
  else if (helpFrom === 'pause') openPause();
  else showScreen('menu');
}

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
  } else if (scr === 'help' && e.code === 'Escape') {
    closeHelp();
  } else if (e.code === 'Escape' && ['local', 'about', 'online'].includes(scr)) {
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
    else if (go === 'help') openHelp();
    else if (go === 'about') showScreen('about');
    else if (go === 'online') openOnline();
    else showScreen(go);
  });
});
$('#btn-local-start').onclick = () => startLocal();
$('#btn-pause').onclick = () => openPause();
$('#btn-help').onclick = () => openHelp();
$('#help-back').onclick = () => closeHelp();
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
