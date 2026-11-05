import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, LEVELS, MODES } from '../js/sim.js';
import { W, H, COUNTDOWN_TICKS } from '../js/constants.js';

const bots = (n, kind = 'hard') => Array.from({ length: n }, (_, i) => ({ id: 'b' + i, name: 'Bot ' + i, color: i, kind }));

function playRound(g, maxTicks = 30 * 600) {
  g.startRound();
  let end = null;
  for (let t = 0; t < maxTicks && !end; t++) {
    const fr = g.tick();
    end = fr.ev.find((e) => e.k === 'end');
  }
  return end;
}

test('every level can be played to the end by bots', () => {
  for (const key of Object.keys(LEVELS)) {
    const g = new Game(bots(4, 'easy'), 'shuffle');
    g.startRound(key);
    let end = null;
    for (let t = 0; t < 30 * 600 && !end; t++) end = g.tick().ev.find((e) => e.k === 'end');
    assert.ok(end, `round on ${key} never ended`);
  }
});

test('modes only use known levels', () => {
  for (const m of Object.values(MODES)) for (const l of m.levels) assert.ok(LEVELS[l]);
});

test('a winner gets exactly one point and draws give none', () => {
  const g = new Game(bots(3, 'easy'), 'classic');
  for (let r = 0; r < 5; r++) {
    const before = g.players.reduce((s, p) => s + p.wins, 0);
    const end = playRound(g);
    const after = g.players.reduce((s, p) => s + p.wins, 0);
    assert.equal(after - before, end.w >= 0 ? 1 : 0);
  }
});

test('double tap makes a U-turn rather than suicide', () => {
  const g = new Game([{ id: 'a', name: 'A', color: 0, kind: 'human' }, { id: 'b', name: 'B', color: 1, kind: 'human' }], 'classic');
  g.startRound('classic');
  for (let t = 0; t < COUNTDOWN_TICKS; t++) g.tick();
  const p = g.players[0];
  Object.assign(p, { x: 650, y: 400, dx: 1, dy: 0 });
  Object.assign(g.players[1], { x: 100, y: 100, dx: 1, dy: 0 });
  g.grid.fill(0);
  g.tick();
  g.queueTurn(0, 1);
  g.queueTurn(0, 1);
  for (let t = 0; t < 5; t++) g.tick();
  assert.ok(p.alive, 'player died from a quick double tap');
  assert.equal(p.dx, -1);
});

test('head-on collision kills both players', () => {
  const g = new Game([{ id: 'a', name: 'A', color: 0, kind: 'human' }, { id: 'b', name: 'B', color: 1, kind: 'human' }], 'classic');
  g.startRound('classic');
  for (let t = 0; t < COUNTDOWN_TICKS; t++) g.tick();
  g.grid.fill(0);
  Object.assign(g.players[0], { x: 600, y: 400, dx: 1, dy: 0 });
  Object.assign(g.players[1], { x: 610, y: 400, dx: -1, dy: 0 });
  let end = null;
  for (let t = 0; t < 10 && !end; t++) end = g.tick().ev.find((e) => e.k === 'end');
  assert.ok(end);
  assert.equal(end.w, -1);
  assert.deepEqual(end.wins, [0, 0]);
});

test('bonuses never overlap and stay inside the board', () => {
  const g = new Game(bots(8), 'shuffle');
  for (const key of Object.keys(LEVELS)) {
    g.startRound(key);
    const list = [...g.bonuses.values()];
    for (const b of list) {
      assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= W && b.y + b.h <= H);
      for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) assert.equal(g.grid[y * W + x], b.id);
    }
  }
});

test('dropping a player mid-round ends it for the other', () => {
  const g = new Game([{ id: 'a', name: 'A', color: 0, kind: 'human' }, { id: 'b', name: 'B', color: 1, kind: 'hard' }], 'classic');
  g.startRound();
  for (let t = 0; t < COUNTDOWN_TICKS + 5; t++) g.tick();
  g.dropPlayer('a');
  const fr = g.tick();
  const end = fr.ev.find((e) => e.k === 'end');
  assert.ok(end);
  assert.equal(end.w, 1);
});

test('the speed multiplier scales distance, including fractional speeds', () => {
  const humans = [0, 1].map((i) => ({ id: 'h' + i, name: 'H' + i, color: i, kind: 'human' }));
  for (const mul of [0.25, 0.5, 1, 1.5, 2.5]) {
    const g = new Game(humans, 'classic', { speedMul: mul });
    g.startRound();
    for (const [i, p] of g.players.entries()) Object.assign(p, { x: 400, y: 200 + 300 * i, dx: 1, dy: 0 });
    for (let t = 0; t < COUNTDOWN_TICKS; t++) g.tick();
    const ticks = 20;
    for (let t = 0; t < ticks; t++) g.tick();
    assert.equal(g.players[0].x - 400, Math.floor(4.5 * mul * ticks + 1e-9), `speed ${mul}`);
  }
});

test('a hard bot detours to grab a nearby god-mode pickup', () => {
  let grabbed = 0;
  for (let trial = 0; trial < 10; trial++) {
    const g = new Game([
      { id: 'cpu', name: 'Bot', color: 0, kind: 'hard' },
      { id: 'h', name: 'Human', color: 1, kind: 'human' },
    ], 'classic');
    g.startRound();
    for (let t = 0; t < COUNTDOWN_TICKS; t++) g.tick();
    g.grid.fill(0);
    const [bot, human] = g.players;
    Object.assign(bot, { x: 300, y: 400, dx: 1, dy: 0, run: null, ai: {} });
    Object.assign(human, { x: 1000, y: 700, dx: -1, dy: 0, run: null });
    // A god-mode pickup up and to the right of the bot: off its path, so it has to turn to get it.
    const b = { id: 999, type: 'god', v: '', x: 380, y: 330, w: 14, h: 18 };
    g.bonuses.set(b.id, b);
    for (let y = b.y; y < b.y + b.h; y++) g.grid.fill(b.id, y * W + b.x, y * W + b.x + b.w);
    for (let t = 0; t < 60; t++) {
      if (g.tick().ev.some((e) => e.k === 'take' && e.type === 'god')) { grabbed++; break; }
    }
  }
  assert.ok(grabbed >= 9, `grabbed the pickup in ${grabbed}/10 trials`);
});
