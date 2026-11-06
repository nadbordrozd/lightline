// The game simulation. Pure logic, no DOM: the same code runs locally and on an online host.
// Each tick() returns a compact "frame" describing what changed; renderers (local or remote) draw from frames only.
import {
  W, H, TICK_HZ, BASE_SPEED, CELLS_PER_LEVEL, MAX_SPEED, GOD_TICKS, SWAP_GRACE_TICKS, COUNTDOWN_TICKS, BONUS_SCALE, MATCH_WINS, DEFAULT_LOOK,
} from './constants.js';
import { artFor } from './art.js';
import { rot, freeRay, cpuThink, cpuChooseStart } from './ai.js';

export const LEVELS = {
  classic: { name: 'Classic', desc: 'Pure light cycles. No bonuses.', counts: {} },
  enhanced: { name: 'Enhanced', desc: 'A bit of everything.', counts: { speed: 10, slow: 5, wall: 15, god: 3, bomb: 20, teleport: 8, switch: 1 } },
  speedy: { name: 'Speedy', desc: 'Speed-ups everywhere. Hold on.', counts: { speed: 380, slow: 3 } },
  switcheroo: { name: 'Switcheroo', desc: 'Expect to swap places. A lot.', counts: { switch: 40 } },
  wally: { name: 'Wally', desc: 'Walls to drop and invincibility to grab.', counts: { speed: 1, wall: 150, god: 20 } },
  turbo: { name: 'Turbo', desc: 'Everything, doubled.', counts: { speed: 15, slow: 7, wall: 20, god: 5, bomb: 40, teleport: 13, switch: 2 } },
};

export const MODES = {
  classic: { name: 'Classic', desc: 'No bonuses. Just you, your line and everyone else’s.', levels: ['classic'] },
  enhanced: { name: 'Enhanced', desc: 'Bonuses scattered around the arena.', levels: ['enhanced'] },
  shuffle: { name: 'Shuffle', desc: 'A different arena every round.', levels: ['enhanced', 'speedy', 'switcheroo', 'classic', 'wally', 'turbo'] },
};

const rndInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const isCpu = (p) => p.kind === 'easy' || p.kind === 'hard';

export class Game {
  // roster: [{ id, name, color, kind: 'human' | 'easy' | 'hard', owner? }]
  // speedMul is the line speed setting: it scales how far every line moves per tick (1 = 100%).
  constructor(roster, mode = 'shuffle', { speedMul = 1, target = MATCH_WINS, look = DEFAULT_LOOK } = {}) {
    this.mode = MODES[mode] ? mode : 'shuffle';
    this.speedMul = speedMul;
    this.target = target; // wins needed to take the match (0 = endless)
    this.champion = -1; // index of the match winner once someone reaches the target
    this.look = { ...look }; // trail style; read at the start of each round
    this.trails = DEFAULT_LOOK.trails;
    this.grid = new Int16Array(W * H); // 0 empty, -1 trail/wall, >0 bonus id
    this.players = [];
    this.bonuses = new Map();
    this.round = 0;
    this.phase = 'idle'; // idle | countdown | running | over
    this.tickNo = 0;
    this.pending = [];
    this.lastLevel = null;
    this.setRoster(roster);
  }

  // Replace the roster between rounds, keeping scores of players who stay.
  setRoster(roster) {
    const old = new Map(this.players.map((p) => [p.id, p]));
    this.players = roster.map((r, i) => ({
      ...r,
      index: i,
      wins: old.get(r.id)?.wins ?? 0,
      alive: false, x: 0, y: 0, dx: 1, dy: 0, speed: BASE_SPEED, acc: 0, god: 0, queue: [], ai: {}, run: null,
    }));
  }

  startRound(levelKey) {
    const pool = MODES[this.mode].levels;
    let key = levelKey;
    if (!key) {
      const options = pool.length > 1 ? pool.filter((k) => k !== this.lastLevel) : pool;
      key = options[Math.floor(Math.random() * options.length)];
    }
    this.level = key;
    this.lastLevel = key;
    this.trails = this.look.trails ?? DEFAULT_LOOK.trails;
    this.round++;
    this.grid.fill(0);
    this.bonuses.clear();
    this.nextBonusId = 1;
    this.phase = 'countdown';
    this.countdown = COUNTDOWN_TICKS;
    this.pending = [];

    const spawns = [];
    for (const p of this.players) {
      let x, y, tries = 0;
      do {
        x = rndInt(W / 4, (3 * W) / 4);
        y = rndInt(H / 4, (3 * H) / 4);
      } while (++tries < 300 && spawns.some((s) => Math.hypot(s.x - x, s.y - y) < 110));
      spawns.push({ x, y });
      const [dx, dy] = [[1, 0], [-1, 0], [0, 1], [0, -1]][rndInt(0, 3)];
      Object.assign(p, { x, y, dx, dy, alive: true, speed: BASE_SPEED, acc: 0, god: 0, queue: [], ai: {}, run: null });
      this.grid[y * W + x] = -1;
    }

    for (const [type, count] of Object.entries(LEVELS[key].counts)) {
      for (let i = 0; i < count; i++) this.placeBonus(type, spawns);
    }
    return this.roundInfo();
  }

  roundInfo() {
    return {
      round: this.round,
      level: this.level,
      mode: this.mode,
      target: this.target,
      trails: this.trails,
      players: this.players.map((p) => ({ id: p.id, name: p.name, color: p.color, kind: p.kind, owner: p.owner, li: p.li, wins: p.wins })),
      bonuses: [...this.bonuses.values()].map((b) => [b.id, b.type, b.x, b.y, b.v]),
      h: this.heads(),
    };
  }

  // How many cells a player moves per tick (fractional; the remainder carries over to the next tick).
  cellsPerTick(p) {
    return p.speed * CELLS_PER_LEVEL * this.speedMul;
  }

  heads() {
    return this.players.map((p) => [p.x, p.y, p.dx, p.dy, p.speed, p.alive ? 1 : 0, p.god]);
  }

  placeBonus(type, spawns) {
    const v = type === 'wall' ? (Math.random() < 0.5 ? 'h' : 'v') : '';
    const art = artFor(type, v);
    const w = art[0].length * BONUS_SCALE;
    const h = art.length * BONUS_SCALE;
    for (let t = 0; t < 40; t++) {
      const x = rndInt(20, W - 20 - w);
      const y = rndInt(20, H - 20 - h);
      if (spawns.some((s) => s.x > x - 45 && s.x < x + w + 45 && s.y > y - 45 && s.y < y + h + 45)) continue;
      if (!this.areaEmpty(x - 2, y - 2, w + 4, h + 4)) continue;
      const b = { id: this.nextBonusId++, type, v, x, y, w, h };
      for (let yy = y; yy < y + h; yy++) this.grid.fill(b.id, yy * W + x, yy * W + x + w);
      this.bonuses.set(b.id, b);
      return;
    }
  }

  areaEmpty(x, y, w, h) {
    if (x < 0 || y < 0 || x + w > W || y + h > H) return false;
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) if (this.grid[yy * W + xx] !== 0) return false;
    }
    return true;
  }

  turn(p, d) {
    [p.dx, p.dy] = rot(p.dx, p.dy, d);
  }

  // Human input. Turns are queued and applied one per tick, so a quick double tap
  // makes a tight U-turn instead of reversing straight into your own trail.
  queueTurn(i, d) {
    const p = this.players[i];
    if (!p || !p.alive || isCpu(p) || this.phase === 'over') return;
    if (p.queue.length < 3) p.queue.push(d < 0 ? -1 : 1);
  }

  // A player left (online). They crash where they are.
  dropPlayer(id) {
    const p = this.players.find((q) => q.id === id);
    if (!p) return;
    p.gone = true;
    if (p.alive && (this.phase === 'running' || this.phase === 'countdown')) {
      p.alive = false;
      this.pending.push({ k: 'die', p: p.index, x: p.x, y: p.y, quit: 1 });
    }
  }

  tick() {
    const fr = { n: this.tickNo++, ph: this.phase, cd: 0, runs: [], ev: this.pending, h: null };
    this.pending = [];
    if (this.phase === 'countdown') {
      for (const p of this.players) {
        if (!p.alive) continue;
        if (isCpu(p)) {
          if (this.countdown === 1) cpuChooseStart(this, p);
        } else {
          while (p.queue.length) this.turn(p, p.queue.shift());
        }
      }
      this.countdown--;
      fr.cd = Math.ceil(this.countdown / TICK_HZ);
      if (this.countdown <= 0) {
        this.phase = 'running';
        fr.go = 1;
      }
      this.checkEnd(fr);
    } else if (this.phase === 'running') {
      this.runTick(fr);
      this.checkEnd(fr);
    }
    fr.ph = this.phase;
    fr.h = this.heads();
    return fr;
  }

  runTick(fr) {
    const alive = this.players.filter((p) => p.alive);
    let maxSteps = 0;
    for (const p of alive) {
      if (isCpu(p)) cpuThink(this, p);
      else if (p.queue.length) this.turn(p, p.queue.shift());
      this.openRun(p);
      // Fractional speeds carry over between ticks, so a 1.5x line moves 4 then 5 cells, and so on.
      p.acc += this.cellsPerTick(p);
      p.steps = Math.floor(p.acc);
      p.acc -= p.steps;
      maxSteps = Math.max(maxSteps, p.steps);
    }

    // Everyone advances one cell at a time, interleaved, so fast and slow players are treated fairly
    // and head-on collisions kill both players instead of whoever happened to be processed first.
    for (let s = 0; s < maxSteps; s++) {
      const targets = [];
      for (const p of alive) {
        if (!p.alive || p.steps <= s) continue;
        const nx = p.x + p.dx;
        const ny = p.y + p.dy;
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) {
          if (p.god > 0) {
            this.closeRun(p, fr);
            p.dx = -p.dx;
            p.dy = -p.dy;
            this.openRun(p);
          } else this.kill(p, fr);
          continue;
        }
        const c = ny * W + nx;
        if (p.god <= 0 && this.grid[c] < 0) {
          this.kill(p, fr);
          continue;
        }
        targets.push({ p, nx, ny, c, clash: false });
      }
      if (targets.length > 1) {
        const seen = new Map();
        for (const t of targets) {
          const o = seen.get(t.c);
          if (o) o.clash = t.clash = true;
          else seen.set(t.c, t);
        }
      }
      const picks = [];
      for (const t of targets) {
        const p = t.p;
        if (t.clash && p.god <= 0) {
          this.kill(p, fr);
          continue;
        }
        const v = this.grid[t.c];
        if (v > 0) {
          const b = this.bonuses.get(v);
          if (b) {
            this.removeBonus(b);
            picks.push([p, b]);
          }
        }
        p.x = t.nx;
        p.y = t.ny;
        this.grid[t.c] = -1;
        p.run[2] = p.x;
        p.run[3] = p.y;
      }
      for (const [p, b] of picks) if (p.alive) this.applyBonus(p, b, fr);
    }

    for (const p of alive) {
      if (p.alive) this.closeRun(p, fr);
      if (p.god > 0) p.god--;
    }
  }

  openRun(p) {
    p.run = [p.x, p.y, p.x, p.y];
  }

  closeRun(p, fr) {
    const r = p.run;
    p.run = null;
    if (!r || (r[0] === r[2] && r[1] === r[3])) return;
    const hue = p.god > 0 ? (this.tickNo * 9 + p.index * 45) % 360 : -1;
    fr.runs.push([p.index, r[0], r[1], r[2], r[3], hue]);
  }

  kill(p, fr) {
    this.closeRun(p, fr);
    p.alive = false;
    fr.ev.push({ k: 'die', p: p.index, x: p.x, y: p.y });
  }

  checkEnd(fr) {
    if (this.phase !== 'running' && this.phase !== 'countdown') return;
    const alive = this.players.filter((p) => p.alive);
    const multi = this.players.length >= 2;
    if (alive.length > (multi ? 1 : 0)) return;
    this.phase = 'over';
    const winner = multi && alive.length === 1 ? alive[0] : null;
    if (winner) winner.wins++;
    if (winner && this.target > 0 && winner.wins >= this.target) this.champion = winner.index;
    fr.ev.push({ k: 'end', w: winner ? winner.index : -1, wins: this.players.map((p) => p.wins), champ: this.champion });
  }

  removeBonus(b) {
    this.bonuses.delete(b.id);
    for (let yy = b.y; yy < b.y + b.h; yy++) {
      for (let xx = b.x; xx < b.x + b.w; xx++) {
        const c = yy * W + xx;
        if (this.grid[c] === b.id) this.grid[c] = 0;
      }
    }
  }

  destroyBonusesIn(x, y, w, h, fr) {
    for (const b of [...this.bonuses.values()]) {
      if (b.x < x + w && b.x + b.w > x && b.y < y + h && b.y + b.h > y) {
        this.removeBonus(b);
        fr.ev.push({ k: 'gone', id: b.id });
      }
    }
  }

  applyBonus(p, b, fr) {
    fr.ev.push({ k: 'take', id: b.id, p: p.index, type: b.type, x: b.x + b.w / 2, y: b.y + b.h / 2 });
    switch (b.type) {
      case 'speed': p.speed = Math.min(MAX_SPEED, p.speed + 1); break;
      case 'slow': p.speed = Math.max(1, p.speed - 1); break;
      case 'god': p.god = Math.min(p.god + GOD_TICKS, 2 * GOD_TICKS); break;
      case 'teleport': this.teleport(p, fr); break;
      case 'bomb': this.bomb(p, fr); break;
      case 'wall': this.wall(p, fr); break;
      case 'switch': this.swap(fr); break;
    }
  }

  teleport(p, fr) {
    for (let t = 0; t < 400; t++) {
      const x = rndInt(40, W - 41);
      const y = rndInt(40, H - 41);
      if (!this.areaEmpty(x - 4, y - 4, 9, 9)) continue;
      if (freeRay(this, x, y, p.dx, p.dy, 90) < 90) continue;
      this.closeRun(p, fr);
      fr.ev.push({ k: 'tele', p: p.index, fx: p.x, fy: p.y, tx: x, ty: y });
      p.x = x;
      p.y = y;
      this.grid[y * W + x] = -1;
      this.openRun(p);
      return;
    }
  }

  bomb(p, fr) {
    const r = 38; // radius of the hole a bomb clears
    const cx = p.x;
    const cy = p.y;
    this.destroyBonusesIn(cx - r, cy - r, 2 * r + 1, 2 * r + 1, fr);
    for (let y = Math.max(0, cy - r); y <= Math.min(H - 1, cy + r); y++) {
      for (let x = Math.max(0, cx - r); x <= Math.min(W - 1, cx + r); x++) {
        const c = y * W + x;
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r && this.grid[c] < 0) this.grid[c] = 0;
      }
    }
    this.grid[cy * W + cx] = -1;
    fr.ev.push({ k: 'bomb', p: p.index, x: cx, y: cy, r });
  }

  wall(p, fr) {
    const R = 72; // half-length of a dropped wall
    const px = Math.abs(p.dy);
    const py = Math.abs(p.dx);
    const x0 = Math.max(0, p.x - R * px);
    const y0 = Math.max(0, p.y - R * py);
    const x1 = Math.min(W - 1, p.x + R * px);
    const y1 = Math.min(H - 1, p.y + R * py);
    this.destroyBonusesIn(x0, y0, x1 - x0 + 1, y1 - y0 + 1, fr);
    for (let x = x0, y = y0; x <= x1 && y <= y1; x += px, y += py) this.grid[y * W + x] = -1;
    fr.ev.push({ k: 'wall', p: p.index, x0, y0, x1, y1 });
  }

  swap(fr) {
    const alive = this.players.filter((q) => q.alive);
    const n = alive.length;
    if (n < 2) return;
    const pos = alive.map((q) => [q.x, q.y]);
    const moves = [];
    alive.forEach((q, k) => {
      const [tx, ty] = pos[(k + 1) % n];
      this.closeRun(q, fr);
      moves.push([q.index, q.x, q.y, tx, ty]);
      q.x = tx;
      q.y = ty;
      q.god = Math.max(q.god, SWAP_GRACE_TICKS);
      this.openRun(q);
    });
    fr.ev.push({ k: 'swap', m: moves });
  }
}
