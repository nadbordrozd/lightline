import { W, H } from './constants.js';

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

// Called once per tick for computer players. 'easy' is the old "drunk" CPU (random wobbles),
// 'hard' looks ahead and prefers whichever side has more room.
export function cpuThink(g, p) {
  if (p.god > 0) return; // invincible: just cruise
  const easy = p.kind === 'easy';

  if (easy) {
    p.ai.next = (p.ai.next ?? 100) - 1;
    if (p.ai.next <= 0) {
      p.ai.next = 10 + Math.random() * 40;
      const first = Math.random() < 0.5 ? -1 : 1;
      for (const d of [first, -first]) {
        const [dx, dy] = rot(p.dx, p.dy, d);
        const need = p.speed * 2 + 2;
        if (freeRay(g, p.x, p.y, dx, dy, need + 1) > need) {
          g.turn(p, d);
          break;
        }
      }
    }
  }

  const look = p.speed * 3 + (easy ? 0 : 4);
  const ahead = freeRay(g, p.x, p.y, p.dx, p.dy, look + 1);
  if (ahead > look) return;

  let best = null;
  for (const d of [0, -1, 1]) {
    const [dx, dy] = d ? rot(p.dx, p.dy, d) : [p.dx, p.dy];
    const r = d ? freeRay(g, p.x, p.y, dx, dy, 600) : ahead;
    const area = !easy && r > 0 ? openArea(g, p.x + dx, p.y + dy, 5000) : 0;
    const score = area * 1000 + r + Math.random() * 0.5;
    if (!best || score > best.score) best = { d, score };
  }
  if (best.d) g.turn(p, best.d);
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
