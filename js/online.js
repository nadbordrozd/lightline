// Online play. One browser hosts: it runs the simulation and streams frames to guests,
// who only send their key presses. See net.js for the transport.
import {
  $, store, esc, getSpeed, showScreen, screen, toast, colorVars, renderModes, setSession, Session, resumeGame, toMenu, startDemo,
} from './main.js';
import { Game, MODES } from './sim.js';
import { MAX_PLAYERS, ONLINE_KEYS, ONLINE_COLOR_ORDER, keyLabel } from './constants.js';
import { HostNet, GuestNet, normCode, errText } from './net.js';
import { sfx } from './audio.js';

const app = $('#app');
const MAX_LOCALS = ONLINE_KEYS.length;
const NEXT_ROUND_MS = 5000;
const TIMEOUT_MS = 12000;
let room = null; // HostRoom | GuestRoom
let busy = false;

const cleanName = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 14) || 'Player';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v | 0));
const keysText = (li) => `${keyLabel(ONLINE_KEYS[li][0])} / ${keyLabel(ONLINE_KEYS[li][1])}`;

function setStatus(msg, error = false) {
  const el = $('#online-status');
  el.textContent = msg;
  el.classList.toggle('error', error);
}

export function openOnline(code) {
  if (room) {
    showScreen('lobby');
    return;
  }
  const name = $('#online-name');
  name.value = store.get('name', '');
  if (code) $('#join-code').value = normCode(code);
  setStatus('');
  showScreen('online');
  (code && !name.value ? name : code ? $('#btn-join') : name).focus();
}

function readName() {
  const name = cleanName($('#online-name').value);
  store.set('name', name);
  return name;
}

async function hostRoom() {
  if (busy) return;
  busy = true;
  const name = readName();
  setStatus('Creating a room…');
  const net = new HostNet();
  try {
    await net.open();
  } catch (e) {
    net.close();
    setStatus(errText(e), true);
    return;
  } finally {
    busy = false;
  }
  setStatus('');
  room = new HostRoom(net, name);
  room.push();
  showScreen('lobby');
}

async function joinRoom() {
  if (busy) return;
  const code = normCode($('#join-code').value);
  if (code.length !== 4) {
    setStatus('Enter the 4-character room code.', true);
    $('#join-code').focus();
    return;
  }
  busy = true;
  const name = readName();
  setStatus(`Connecting to room ${code}…`);
  const net = new GuestNet();
  try {
    await net.join(code);
  } catch (e) {
    net.close();
    setStatus(errText(e), true);
    return;
  } finally {
    busy = false;
  }
  setStatus('Connected. Waiting for the host…');
  room = new GuestRoom(net, code, name);
}

// ------------------------------------------------------------------ host side
class HostRoom {
  constructor(net, name) {
    this.isHost = true;
    this.net = net;
    this.code = net.code;
    this.mode = MODES[store.get('onlineMode')] ? store.get('onlineMode') : 'shuffle';
    this.members = [{ peer: 'host', name, locals: clamp(store.get('onlineLocals', 1), 1, MAX_LOCALS), last: Date.now() }];
    this.cpus = [];
    this.cpuSeq = 0;
    this.colorOf = new Map();
    this.session = null;
    net.onMsg = (peer, m) => this.onMsg(peer, m);
    net.onLeave = (peer) => this.onLeave(peer);
    net.onError = (e) => toast(errText(e));
    this.hb = setInterval(() => this.heartbeat(), 2000);
  }

  get me() {
    return 'host';
  }

  get myLocals() {
    return this.members[0].locals;
  }

  roster() {
    const out = [];
    for (const m of this.members) {
      for (let li = 0; li < m.locals && out.length < MAX_PLAYERS; li++) {
        out.push({ id: `${m.peer}:${li}`, owner: m.peer, li, name: m.locals > 1 ? `${m.name} ${li + 1}` : m.name, kind: 'human' });
      }
    }
    const counts = { easy: 0, hard: 0 };
    for (const c of this.cpus) {
      if (out.length >= MAX_PLAYERS) break;
      counts[c.kind]++;
      out.push({ id: `cpu:${c.id}`, owner: 'cpu', cpu: c.id, name: `${c.kind === 'hard' ? 'Hard' : 'Easy'} bot ${counts[c.kind]}`, kind: c.kind });
    }
    // Colours stick to players for the whole session; newcomers get the first free one.
    const used = new Set();
    for (const p of out) {
      const c = this.colorOf.get(p.id);
      if (c !== undefined && !used.has(c)) {
        used.add(c);
        p.color = c;
      }
    }
    for (const p of out) {
      if (p.color !== undefined) continue;
      p.color = ONLINE_COLOR_ORDER.find((ci) => !used.has(ci));
      used.add(p.color);
      this.colorOf.set(p.id, p.color);
    }
    return out;
  }

  state() {
    return {
      t: 'lobby',
      code: this.code,
      mode: this.mode,
      inGame: !!this.session,
      roster: this.roster().map(({ id, owner, li, cpu, name, color, kind }) => ({ id, owner, li, cpu, name, color, kind })),
    };
  }

  push() {
    const st = this.state();
    this.net.broadcast(st);
    if (!this.session) renderLobby(st, this);
  }

  onMsg(peer, m) {
    const mem = this.members.find((x) => x.peer === peer);
    if (mem) mem.last = Date.now();
    switch (m.t) {
      case 'hello': {
        if (mem) break;
        const free = MAX_PLAYERS - this.roster().filter((p) => p.owner !== 'cpu').length;
        if (free <= 0) {
          this.net.send(peer, { t: 'full' });
          setTimeout(() => this.net.kick(peer), 500);
          break;
        }
        const name = cleanName(m.name);
        this.members.push({ peer, name, locals: clamp(m.locals, 1, Math.min(MAX_LOCALS, free)), last: Date.now() });
        this.net.send(peer, { t: 'welcome', peer });
        toast(`${name} joined`);
        sfx.click();
        this.push();
        break;
      }
      case 'locals':
        if (mem) {
          mem.locals = clamp(m.n, 1, MAX_LOCALS);
          this.push();
        }
        break;
      case 'turn':
        if (mem && this.session) this.session.remoteTurn(peer, m.li, m.d);
        break;
    }
  }

  onLeave(peer) {
    const i = this.members.findIndex((x) => x.peer === peer);
    if (i <= 0) return;
    const [m] = this.members.splice(i, 1);
    toast(`${m.name} left`);
    this.session?.dropOwner(peer);
    this.push();
  }

  heartbeat() {
    this.net.broadcast({ t: 'ping' });
    const now = Date.now();
    for (const m of this.members.slice(1)) {
      if (now - m.last > TIMEOUT_MS) {
        this.net.kick(m.peer);
        this.onLeave(m.peer);
      }
    }
  }

  changeLocals(delta) {
    const me = this.members[0];
    const n = clamp(me.locals + delta, 1, MAX_LOCALS);
    if (delta > 0 && this.roster().length >= MAX_PLAYERS) return;
    me.locals = n;
    store.set('onlineLocals', n);
    this.push();
  }

  addCpu(kind) {
    if (this.roster().length >= MAX_PLAYERS) return toast('The room is full (8 players).');
    this.cpus.push({ id: ++this.cpuSeq, kind });
    this.push();
  }

  removeCpu(id) {
    this.cpus = this.cpus.filter((c) => c.id !== id);
    this.push();
  }

  setMode(mode) {
    this.mode = mode;
    store.set('onlineMode', mode);
    this.push();
  }

  start() {
    if (this.roster().length < 2) return;
    sfx.unlock();
    this.session = new HostSession(this);
    setSession(this.session);
    showScreen('game');
    this.push();
  }

  endMatch() {
    this.session = null;
    startDemo();
    showScreen('lobby');
    this.push();
  }

  leave() {
    clearInterval(this.hb);
    this.net.broadcast({ t: 'bye' });
    const net = this.net;
    setTimeout(() => net.close(), 300);
    room = null;
    toMenu();
  }
}

class HostSession extends Session {
  constructor(hostRoom) {
    super();
    this.room = hostRoom;
    this.game = new Game(hostRoom.roster(), hostRoom.mode, { speedMul: getSpeed() });
    this.newRound();
  }

  isMine(p) {
    return p.owner === 'host';
  }

  newRound() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    const roster = this.room.roster();
    if (roster.length < 2) {
      toast('Not enough players left. Back to the lobby.');
      this.room.endMatch();
      return;
    }
    this.game.setRoster(roster);
    const info = this.game.startRound();
    this.keymap.clear();
    this.game.players.forEach((p, i) => {
      if (p.owner !== 'host') return;
      const [l, r] = ONLINE_KEYS[p.li];
      this.keymap.set(l, { i, d: -1 });
      this.keymap.set(r, { i, d: 1 });
    });
    this.room.net.broadcast({ t: 'round', info });
    this.onRound(info);
    this.ticking = true;
  }

  turn(i, d) {
    this.game.queueTurn(i, d);
  }

  remoteTurn(peer, li, d) {
    const i = this.game.players.findIndex((p) => p.owner === peer && p.li === li);
    if (i >= 0) this.game.queueTurn(i, d);
  }

  dropOwner(peer) {
    for (const p of this.game.players) if (p.owner === peer) this.game.dropPlayer(p.id);
  }

  step() {
    const fr = this.game.tick();
    this.room.net.broadcast({ t: 'f', f: fr });
    this.onFrame(fr);
    if (this.game.phase === 'over') {
      this.ticking = false;
      this.later(() => this.newRound(), NEXT_ROUND_MS);
    }
  }

  next() {
    if (this.game.phase === 'over') this.newRound();
  }

  nextHint() {
    return '<div class="sub">Next round in a few seconds · <kbd>Space</kbd> to start it now</div>';
  }

  pauseButtons() {
    return [
      ['Back to game', () => resumeGame()],
      ['End match', () => this.room.endMatch()],
      ['Leave room', () => this.room.leave()],
    ];
  }
}

// ------------------------------------------------------------------ guest side
class GuestRoom {
  constructor(net, code, name) {
    this.isHost = false;
    this.net = net;
    this.code = code;
    this.name = name;
    this.myLocals = clamp(store.get('onlineLocals', 1), 1, MAX_LOCALS);
    this.me = null;
    this.session = null;
    this.last = Date.now();
    net.onMsg = (m) => this.onMsg(m);
    net.onClose = (reason) => this.lost(reason);
    this.hb = setInterval(() => {
      net.send({ t: 'ping' });
      if (Date.now() - this.last > TIMEOUT_MS) this.lost('Lost the connection to the host.');
    }, 2000);
    net.send({ t: 'hello', name, locals: this.myLocals });
  }

  onMsg(m) {
    this.last = Date.now();
    switch (m.t) {
      case 'welcome':
        this.me = m.peer;
        break;
      case 'full':
        this.lost('That room is full.');
        break;
      case 'lobby':
        this.lobby = m;
        if (!m.inGame && this.session) {
          this.session = null;
          startDemo();
          showScreen('lobby');
        }
        if (!this.session) {
          renderLobby(m, this);
          if (screen() === 'online') showScreen('lobby');
        }
        break;
      case 'round':
        if (!this.session) {
          this.session = new GuestSession(this);
          setSession(this.session);
          showScreen('game');
        }
        this.session.round(m.info);
        break;
      case 'f':
        this.session?.frame(m.f);
        break;
      case 'bye':
        this.lost('The host closed the room.');
        break;
    }
  }

  changeLocals(delta) {
    const n = clamp(this.myLocals + delta, 1, MAX_LOCALS);
    if (delta > 0 && this.lobby && this.lobby.roster.length >= MAX_PLAYERS) return;
    this.myLocals = n;
    store.set('onlineLocals', n);
    this.net.send({ t: 'locals', n });
  }

  close() {
    clearInterval(this.hb);
    this.net.close();
    room = null;
  }

  leave() {
    this.close();
    toMenu();
  }

  lost(reason) {
    if (room !== this) return;
    this.close();
    toMenu();
    toast(reason, 6000);
  }
}

class GuestSession extends Session {
  constructor(guestRoom) {
    super();
    this.room = guestRoom;
    this.players = [];
  }

  isMine(p) {
    return p.owner === this.room.me;
  }

  round(info) {
    this.players = info.players;
    this.keymap.clear();
    info.players.forEach((p, i) => {
      if (p.owner !== this.room.me) return;
      const [l, r] = ONLINE_KEYS[p.li];
      this.keymap.set(l, { i, d: -1 });
      this.keymap.set(r, { i, d: 1 });
    });
    this.onRound(info);
  }

  frame(f) {
    this.onFrame(f);
  }

  turn(i, d) {
    const p = this.players[i];
    if (p) this.room.net.send({ t: 'turn', li: p.li, d });
  }

  nextHint() {
    return '<div class="sub">Next round in a few seconds…</div>';
  }

  pauseButtons() {
    return [
      ['Back to game', () => resumeGame()],
      ['Leave room', () => this.room.leave()],
    ];
  }
}

// ------------------------------------------------------------------ lobby UI
function renderLobby(st, r) {
  app.classList.toggle('is-host', r.isHost);
  $('#lobby-code').textContent = st.code;
  $('#lobby-count').textContent = `${st.roster.length}/${MAX_PLAYERS}`;
  $('#lobby-roster').innerHTML = st.roster
    .map((p) => {
      const tags = [];
      if (p.owner === r.me) tags.push(`<span class="tag you">you · ${esc(keysText(p.li))}</span>`);
      if (p.owner === 'host') tags.push('<span class="tag">host</span>');
      if (p.owner === 'cpu') tags.push('<span class="tag">bot</span>');
      const rm = r.isHost && p.owner === 'cpu' ? `<button class="x" data-rm="${p.cpu}" title="Remove bot">×</button>` : '';
      return `<li style="${colorVars(p.color)}"><i></i><span class="n">${esc(p.name)}</span>${tags.join('')}${rm}</li>`;
    })
    .join('');
  const n = r.myLocals;
  $('#locals-n').textContent = n;
  $('#locals-minus').disabled = n <= 1;
  $('#locals-plus').disabled = n >= MAX_LOCALS || st.roster.length >= MAX_PLAYERS;
  $('#locals-keys').innerHTML = Array.from({ length: n }, (_, li) => `<div>Player ${li + 1}: <kbd>${esc(keyLabel(ONLINE_KEYS[li][0]))}</kbd> <kbd>${esc(keyLabel(ONLINE_KEYS[li][1]))}</kbd></div>`).join('');
  renderModes($('#lobby-modes'), st.mode, (m) => r.setMode?.(m), !r.isHost);
  const status = $('#lobby-status');
  if (r.isHost) {
    $('#btn-lobby-start').disabled = st.roster.length < 2;
    status.textContent = st.roster.length < 2 ? 'Share the code or link with friends, or add a bot.' : '';
  } else {
    status.textContent = st.inGame ? 'A match is on. You’ll join at the start of the next round.' : 'Waiting for the host to start the match…';
  }
}

function inviteLink() {
  return `${location.origin}${location.pathname}?room=${room?.code ?? ''}`;
}

$('#btn-host').onclick = () => hostRoom();
$('#btn-join').onclick = () => joinRoom();
$('#join-code').addEventListener('input', (e) => {
  e.target.value = normCode(e.target.value);
});
$('#join-code').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinRoom();
});
$('#locals-minus').onclick = () => room?.changeLocals(-1);
$('#locals-plus').onclick = () => room?.changeLocals(1);
$('#btn-lobby-start').onclick = () => room?.isHost && room.start();
$('#btn-leave').onclick = () => room?.leave();
document.querySelectorAll('[data-cpu]').forEach((b) => {
  b.onclick = () => room?.isHost && room.addCpu(b.dataset.cpu);
});
$('#lobby-roster').addEventListener('click', (e) => {
  const b = e.target.closest('[data-rm]');
  if (b && room?.isHost) room.removeCpu(+b.dataset.rm);
});
$('#btn-copy-link').onclick = async () => {
  const link = inviteLink();
  try {
    await navigator.clipboard.writeText(link);
    toast('Invite link copied');
  } catch {
    window.prompt('Copy this invite link:', link);
  }
};
window.addEventListener('pagehide', () => {
  if (room?.isHost) room.net.broadcast({ t: 'bye' });
});
