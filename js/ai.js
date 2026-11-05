import { W, H, BASE_SPEED } from './constants.js';

// Rotate a direction 90 degrees. d < 0 = left (counter-clockwise on screen), d > 0 = right.
export function rot(dx, dy, d) {
  return d < 0 ? [dy, -dx] : [-dy, dx];
}

// How many cells can be travelled from (x, y) in direction (dx, dy) before hitting something (capped at max).
export function freeRay(g, x, y, dx, dy, max) {
  const grid = g.grid;
  for (let n = 0; n < max; n++) {
    x += dx;
    y += dy;
    if (x < 0 || x >= W || y < 0 || y >= H || grid[y * W + x] < 0) return n;
  }
  return max;
}

// Bounded flood fill: how much open space is reachable from (sx, sy), up to limit cells.
let seen = null;
let stamp = 0;
const queue = new Int32Array(1 << 14);
function openArea(g, sx, sy, limit) {
  if (sx < 0 || sx >= W || sy < 0 || sy >= H) return 0;
  const grid = g.grid;
  const start = sy * W + sx;
  if (grid[start] < 0) return 0;
  if (!seen) seen = new Uint32Array(W * H);
  stamp++;
  let head = 0;
  let tail = 0;
  seen[start] = stamp;
  queue[tail++] = start;
  const cap = queue.length;
  while (head < tail && head < limit) {
    const c = queue[head++];
    const x = c % W;
    if (x > 0 && seen[c - 1] !== stamp && grid[c - 1] >= 0 && tail < cap) { seen[c - 1] = stamp; queue[tail++] = c - 1; }
    if (x < W - 1 && seen[c + 1] !== stamp && grid[c + 1] >= 0 && tail < cap) { seen[c + 1] = stamp; queue[tail++] = c + 1; }
    if (c >= W && seen[c - W] !== stamp && grid[c - W] >= 0 && tail < cap) { seen[c - W] = stamp; queue[tail++] = c - W; }
    if (c < W * (H - 1) && seen[c + W] !== stamp && grid[c + W] >= 0 && tail < cap) { seen[c + W] = stamp; queue[tail++] = c + W; }
  }
  return head;
}

const rnd = (a, b) => a + Math.random() * (b - a);

// Called once per tick for each computer player, before it moves.
export function cpuThink(g, p) {
  if (p.god > 20) return; // invincible: just cruise (but start paying attention before it wears off)
  const v = Math.max(1, Math.ceil(g.cellsPerTick(p))); // cells it will move this tick
  if (p.kind === 'easy') easyThink(g, p, v);
  else hardThink(g, p, v);
}

// ------------------------------------------------------------------ easy
// A sloppy driver. It wobbles at random (sometimes in a quick zigzag), picks a way out by glancing at
// which side looks longer rather than by thinking, and can't turn the same way twice in quick
// succession, so it struggles to hairpin out of tight corridors and dead ends.
const EASY = {
  wobble: [8, 40], // ticks between random wobbles
  zigzag: 0.3, // chance a wobble is followed by a turn back the other way
  hairpin: 0.2, // chance that, after a turn, it can't turn the same way again on the next tick
  glance: 0.2, // noise when judging which way has more room
};

function easyThink(g, p, v) {
  const ai = p.ai;
  if (ai.next === undefined) {
    ai.next = rnd(30, 90);
    ai.t = 0;
    ai.lastD = 0;
    ai.lockUntil = -1;
    ai.zig = 0;
  }
  ai.t++;
  const can = (d) => !(d === ai.lastD && ai.t <= ai.lockUntil);
  const turn = (d) => {
    g.turn(p, d);
    ai.lastD = d;
    ai.lockUntil = Math.random() < EASY.hairpin ? ai.t + 1 : ai.t;
  };
  const room = (d, max) => {
    const [dx, dy] = rot(p.dx, p.dy, d);
    return freeRay(g, p.x, p.y, dx, dy, max);
  };

  if (ai.zig && --ai.zig.t <= 0) {
    const d = ai.zig.d;
    ai.zig = 0;
    if (room(d, v * 2 + 3) > v * 2 + 2) turn(d);
  } else if (--ai.next <= 0) {
    ai.next = rnd(...EASY.wobble);
    const first = Math.random() < 0.5 ? -1 : 1;
    for (const d of [first, -first]) {
      if (can(d) && room(d, v * 2 + 3) > v * 2 + 2) {
        turn(d);
        if (Math.random() < EASY.zigzag) ai.zig = { d: -d, t: Math.round(rnd(2, 6)) };
        break;
      }
    }
  }

  const look = v * 3;
  const ahead = freeRay(g, p.x, p.y, p.dx, p.dy, look + 1);
  if (ahead > look) return;
  ai.zig = 0;
  let best = { d: 0, s: ahead };
  for (const d of [-1, 1]) {
    if (!can(d)) continue;
    const s = room(d, 600) * rnd(1 - EASY.glance, 1 + EASY.glance);
    if (s > best.s) best = { d, s };
  }
  if (best.d) turn(best.d);
}

// ------------------------------------------------------------------ hard
// Looks ahead and steers towards whichever side has more room. When it can do so without giving up
// space, it also detours for useful pickups nearby and tries to cut across the path of the nearest
// opponent (some bots are more aggressive than others).
const HARD = {
  pickups: true, // detour for useful pickups
  hunt: true, // try to cut opponents off
  area: 8000, // flood-fill budget when checking that a voluntary turn is safe
  ratio: 0.97, // a voluntary turn must keep at least this share of the room going straight would
};

function hardThink(g, p, v) {
  const ai = p.ai;
  if (ai.t === undefined) {
    ai.t = 0;
    ai.plan = Math.floor(Math.random() * 4); // spread planning across ticks
    ai.greed = rnd(0.5, 1); // how far it will go for a pickup
    ai.aggr = Math.random(); // how keen it is to cut others off
    ai.target = null;
  }
  ai.t++;

  const look = v * 3 + 4;
  const ahead = freeRay(g, p.x, p.y, p.dx, p.dy, look + 1);
  if (ahead <= look) {
    avoid(g, p, ahead);
    return;
  }

  if (--ai.plan <= 0) {
    ai.plan = 4;
    if (!ai.target) chooseTarget(g, p, v);
  }
  if (ai.target) steer(g, p, v);
}

// About to hit something: turn to whichever side leads to the most open space.
function avoid(g, p, ahead) {
  let best = null;
  for (const d of [0, -1, 1]) {
    const [dx, dy] = d ? rot(p.dx, p.dy, d) : [p.dx, p.dy];
    const r = d ? freeRay(g, p.x, p.y, dx, dy, 600) : ahead;
    const area = r > 0 ? openArea(g, p.x + dx, p.y + dy, 5000) : 0;
    const score = area * 1000 + r + Math.random() * 0.5;
    if (!best || score > best.score) best = { d, score };
  }
  if (best.d) g.turn(p, best.d);
}

// How much a pickup is worth a detour (0 = not at all).
function pickupValue(type, p) {
  switch (type) {
    case 'god': return 3;
    case 'bomb': return 2;
    case 'wall': return 1.5;
    case 'slow': return p.speed > BASE_SPEED ? 1.5 : 0;
    case 'speed': return p.speed < BASE_SPEED ? 1 : 0;
    default: return 0; // teleport and switcheroo are too random to chase
  }
}

function chooseTarget(g, p, v) {
  const ai = p.ai;
  ai.target = null;
  const reach = 120 + 160 * ai.greed;
  let best = null;
  for (const b of HARD.pickups ? g.bonuses.values() : []) {
    const val = pickupValue(b.type, p);
    if (!val) continue;
    const ox = b.x + b.w / 2 - p.x;
    const oy = b.y + b.h / 2 - p.y;
    const dist = Math.abs(ox) + Math.abs(oy);
    if (dist > reach || ox * p.dx + oy * p.dy < -20) continue; // too far, or behind us
    const score = val * (reach - dist);
    if (!best || score > best.score) best = { score, b };
  }
  if (best) {
    const { b } = best;
    ai.target = { kind: 'bonus', id: b.id, x0: b.x, y0: b.y, x1: b.x + b.w - 1, y1: b.y + b.h - 1, until: ai.t + 150 };
    return;
  }

  // No pickup worth having: maybe try to cut in front of the nearest opponent.
  if (!HARD.hunt || ai.aggr < 0.35 || Math.random() > ai.aggr * 0.5) return;
  let prey = null;
  for (const q of g.players) {
    if (q === p || !q.alive) continue;
    const dist = Math.abs(q.x - p.x) + Math.abs(q.y - p.y);
    if (dist > 50 && dist < 240 && (!prey || dist < prey.dist)) prey = { q, dist };
  }
  if (!prey) return;
  const { q, dist } = prey;
  const lead = Math.min(140, Math.max(40, dist * 0.7));
  const tx = Math.min(W - 6, Math.max(5, Math.round(q.x + q.dx * lead)));
  const ty = Math.min(H - 6, Math.max(5, Math.round(q.y + q.dy * lead)));
  const r = Math.max(3, v);
  ai.target = { kind: 'hunt', prey: q, x0: tx - r, y0: ty - r, x1: tx + r, y1: ty + r, until: ai.t + 40 };
}

// Range of (x - p.x) * ax + (y - p.y) * ay over the target box, i.e. where the box lies along an axis.
function span(t, p, ax, ay) {
  const a = (t.x0 - p.x) * ax + (t.y0 - p.y) * ay;
  const b = (t.x1 - p.x) * ax + (t.y1 - p.y) * ay;
  return a < b ? [a, b] : [b, a];
}

// Head for the target box Manhattan-style: drive on until level with it, then turn towards it.
// Returns true while it is handling the target (so nothing else should steer this tick).
function steer(g, p, v) {
  const ai = p.ai;
  const t = ai.target;
  const gone = t.kind === 'bonus'
    ? !g.bonuses.has(t.id)
    : !t.prey.alive || Math.abs(t.prey.x - p.x) + Math.abs(t.prey.y - p.y) < 40; // too close for comfort
  if (ai.t > t.until || gone) {
    ai.target = null;
    return false;
  }
  const [f0, f1] = span(t, p, p.dx, p.dy);
  const [rx, ry] = rot(p.dx, p.dy, 1);
  const [l0, l1] = span(t, p, rx, ry);
  const drop = () => {
    ai.target = null;
    return false;
  };

  if (l0 <= 0 && l1 >= 0) {
    if (f1 <= 0) return drop(); // straight behind: not worth a U-turn
    return freeRay(g, p.x, p.y, p.dx, p.dy, f0 + 1) >= f0 ? true : drop(); // dead ahead: keep going
  }
  const d = l0 > 0 ? 1 : -1;
  const sideDist = d > 0 ? l0 : -l1;
  if (f0 <= 0 && f1 >= 0) return tryTurn(g, p, v, d, sideDist) || drop(); // level with it: turn in
  if (f1 < 0) return drop(); // overshot it: doubling back is rarely worth it
  return true; // still ahead: keep going straight
}

// Turn if the new direction is clear for `dist` cells and doesn't lead into a pocket.
function tryTurn(g, p, v, d, dist) {
  const [dx, dy] = rot(p.dx, p.dy, d);
  const need = v * 3 + 4;
  const ray = freeRay(g, p.x, p.y, dx, dy, Math.max(need, dist) + 1);
  if (ray < need || ray < dist) return false;
  const area = openArea(g, p.x + dx, p.y + dy, HARD.area);
  if (area < HARD.ratio * openArea(g, p.x + p.dx, p.y + p.dy, HARD.area)) return false;
  g.turn(p, d);
  return true;
}

// Pick the most open starting direction (computer players, at the end of the countdown).
export function cpuChooseStart(g, p) {
  let best = null;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const score = freeRay(g, p.x, p.y, dx, dy, 700) + Math.random() * 40;
    if (!best || score > best.score) best = { dx, dy, score };
  }
  p.dx = best.dx;
  p.dy = best.dy;
}
