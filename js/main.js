import { TICK_MS, COLORS, DEFAULT_SLOTS, keyLabel, playerPalette } from './constants.js';
import { Game, MODES, LEVELS } from './sim.js';
import { Renderer, bonusSprite } from './render.js';
import { BONUS_TYPES } from './art.js';
import { sfx } from './audio.js';

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
    this.round.textContent = `Round ${info.round} · ${lvl.name}`;
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
    this.game = new Game(roster, mode);
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
    if (this.game.phase === 'over') this.newRound();
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

// ------------------------------------------------------------------ pause
export function openPause() {
  if (!session || session.demo) return;
  if (session instanceof LocalSession) session.paused = true;
  $('#pause-title').textContent = session instanceof LocalSession ? 'Paused' : 'Menu';
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
    c.style.width = `${sp.w * 1.6}px`;
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
  } else if (e.code === 'Escape' && ['local', 'help', 'online'].includes(scr)) {
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
    else if (go === 'online') openOnline();
    else showScreen(go);
  });
});
$('#btn-local-start').onclick = () => startLocal();
$('#btn-pause').onclick = () => openPause();
$('#banner').addEventListener('click', (e) => {
  if (e.target.closest('[data-action="next"]')) session?.next();
});
const soundBtn = $('#btn-sound');
const paintSound = () => {
  soundBtn.innerHTML = sfx.isMuted()
    ? '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" stroke-width="2"/></svg>'
    : '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
};
soundBtn.onclick = () => {
  sfx.setMuted(!sfx.isMuted());
  paintSound();
};
paintSound();

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
