// Layered canvas renderer.
//  bg     static grid, drawn once
//  glow   low-res copy of the trails, blurred by CSS (cheap neon halo)
//  bonus  bonus sprites, redrawn only when one disappears
//  trail  crisp trails, drawn incrementally: only the new segments of each tick
//  fx     heads, particles and other short-lived effects, cleared every frame
import { W, H, TICK_MS, BONUS_SCALE, playerPalette } from './constants.js';
import { BONUS_TYPES, artFor } from './art.js';

const RES = 2; // backing pixels per arena cell
// Line widths in cells for each trail style: blurred glow, coloured line, white-hot centre.
const TRAIL_WIDTHS = { bold: { glow: 6, core: 1.9, hot: 0.7 }, thin: { glow: 3, core: 1, hot: 0.35 } };
const GLOW_RES = 0.5;
const MAX_PARTICLES = 900;
const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function makeLayer(parent, cls, res, opts) {
  const c = document.createElement('canvas');
  c.className = 'layer layer-' + cls;
  c.width = Math.round(W * res);
  c.height = Math.round(H * res);
  parent.appendChild(c);
  const ctx = c.getContext('2d', opts);
  ctx.setTransform(res, 0, 0, res, 0, 0);
  ctx.lineCap = 'square';
  ctx.lineJoin = 'miter';
  return ctx;
}

function wipe(ctx) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function bonusSprite(type, variant = '') {
  const key = type + variant;
  if (bonusSprite.cache.has(key)) return bonusSprite.cache.get(key);
  const art = artFor(type, variant);
  const S = BONUS_SCALE;
  const pad = 5;
  const lw = art[0].length * S;
  const lh = art.length * S;
  const c = document.createElement('canvas');
  c.width = (lw + 2 * pad) * RES;
  c.height = (lh + 2 * pad) * RES;
  const g = c.getContext('2d');
  g.scale(RES, RES);
  g.translate(pad, pad);
  const hue = BONUS_TYPES[type].hue;
  g.fillStyle = `hsla(${hue},100%,50%,0.10)`;
  g.beginPath();
  g.roundRect(-2, -2, lw + 4, lh + 4, 2.5);
  g.fill();
  const cells = (inset, light) => {
    for (let r = 0; r < art.length; r++) {
      for (let q = 0; q < art[r].length; q++) {
        const v = +art[r][q];
        if (!v) continue;
        g.fillStyle = `hsla(${hue},100%,${light}%,${v / 9})`;
        g.fillRect(q * S + inset, r * S + inset, S - 2 * inset, S - 2 * inset);
      }
    }
  };
  g.shadowColor = `hsl(${hue},100%,60%)`;
  g.shadowBlur = 4 * RES;
  cells(0, 58);
  g.shadowBlur = 0;
  cells(0.22 * S, 84); // white-hot centres
  const sprite = { canvas: c, pad, w: lw + 2 * pad, h: lh + 2 * pad };
  bonusSprite.cache.set(key, sprite);
  return sprite;
}
bonusSprite.cache = new Map();

export class Renderer {
  constructor(stage) {
    this.stage = stage;
    const layers = stage.querySelector('.layers');
    this.bg = makeLayer(layers, 'bg', RES, { alpha: false });
    this.glow = makeLayer(layers, 'glow', GLOW_RES);
    this.bon = makeLayer(layers, 'bonus', RES);
    this.trail = makeLayer(layers, 'trail', RES);
    this.fx = makeLayer(layers, 'fx', RES);
    this.pal = [];
    this.names = [];
    this.heads = [];
    this.phase = 'idle';
    this.lastFrameAt = 0;
    this.lastNow = 0;
    this.particles = [];
    this.bonuses = new Map();
    this.shake = 0;
    this.shaking = false;
    this.drawBackground();
  }

  drawBackground() {
    const g = this.bg;
    const grd = g.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, W * 0.72);
    grd.addColorStop(0, '#0c1230');
    grd.addColorStop(0.6, '#070a1c');
    grd.addColorStop(1, '#020309');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    g.lineWidth = 0.6;
    g.strokeStyle = 'rgba(90,140,255,0.07)';
    g.beginPath();
    for (let x = 50; x < W; x += 50) { g.moveTo(x, 0); g.lineTo(x, H); }
    for (let y = 50; y < H; y += 50) { g.moveTo(0, y); g.lineTo(W, y); }
    g.stroke();
    g.fillStyle = 'rgba(130,180,255,0.22)';
    for (let x = 50; x < W; x += 50) for (let y = 50; y < H; y += 50) g.fillRect(x - 0.9, y - 0.9, 1.8, 1.8);
    g.strokeStyle = 'rgba(110,170,255,0.45)';
    g.lineWidth = 2;
    g.strokeRect(1, 1, W - 2, H - 2);
  }

  setPlayers(players) {
    this.pal = players.map((p) => playerPalette(p.color));
    this.names = players.map((p) => p.name);
    this.headSprites = this.pal.map((pal) => {
      const size = 40;
      const c = document.createElement('canvas');
      c.width = c.height = size * RES;
      const g = c.getContext('2d');
      g.scale(RES, RES);
      const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      grd.addColorStop(0, 'rgba(255,255,255,0.95)');
      grd.addColorStop(0.12, pal.hot);
      grd.addColorStop(0.3, pal.glow);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, size, size);
      return c;
    });
  }

  startRound(info) {
    wipe(this.trail);
    wipe(this.glow);
    wipe(this.bon);
    this.particles.length = 0;
    this.bonuses.clear();
    this.tw = TRAIL_WIDTHS[info.trails] ?? TRAIL_WIDTHS.bold;
    for (const [id, type, x, y, v] of info.bonuses) {
      const art = artFor(type, v);
      const b = { id, type, v, x, y, w: art[0].length * BONUS_SCALE, h: art.length * BONUS_SCALE };
      this.bonuses.set(id, b);
      this.drawBonus(b);
    }
    this.heads = info.h;
    this.phase = 'countdown';
    this.lastFrameAt = performance.now();
  }

  drawBonus(b) {
    const s = bonusSprite(b.type, b.v);
    this.bon.drawImage(s.canvas, b.x - s.pad, b.y - s.pad, s.w, s.h);
  }

  removeBonus(id) {
    const b = this.bonuses.get(id);
    if (!b) return null;
    this.bonuses.delete(id);
    const pad = 5;
    const x = b.x - pad, y = b.y - pad, w = b.w + 2 * pad, h = b.h + 2 * pad;
    const g = this.bon;
    g.clearRect(x, y, w, h);
    g.save();
    g.beginPath();
    g.rect(x, y, w, h);
    g.clip();
    for (const o of this.bonuses.values()) {
      if (o.x - pad < x + w && o.x + o.w + pad > x && o.y - pad < y + h && o.y + o.h + pad > y) this.drawBonus(o);
    }
    g.restore();
    return b;
  }

  styleFor(pi, hue) {
    if (hue >= 0) return { core: `hsl(${hue},100%,62%)`, hot: `hsl(${hue},100%,86%)`, glow: `hsla(${hue},100%,60%,0.8)` };
    return this.pal[pi] ?? this.pal[0];
  }

  drawLine(ctx, x0, y0, x1, y1, width, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x0 + 0.5, y0 + 0.5);
    ctx.lineTo(x1 + 0.5, y1 + 0.5);
    ctx.stroke();
  }

  drawRun(pi, x0, y0, x1, y1, hue) {
    const st = this.styleFor(pi, hue);
    const tw = this.tw;
    this.drawLine(this.glow, x0, y0, x1, y1, tw.glow, st.glow);
    this.drawLine(this.trail, x0, y0, x1, y1, tw.core, st.core);
    this.drawLine(this.trail, x0, y0, x1, y1, tw.hot, st.hot);
  }

  // Apply one simulation frame (local or received from the host).
  applyFrame(fr, now) {
    for (const r of fr.runs) this.drawRun(r[0], r[1], r[2], r[3], r[4], r[5]);
    for (const e of fr.ev) this.applyEvent(e);
    this.heads = fr.h;
    this.phase = fr.ph;
    this.lastFrameAt = now;
  }

  applyEvent(e) {
    switch (e.k) {
      case 'take': {
        this.removeBonus(e.id);
        const t = BONUS_TYPES[e.type];
        const col = `hsl(${t.hue},100%,65%)`;
        this.ring(e.x, e.y, 4, 34, 0.5, col, 2);
        this.sparks(e.x, e.y, 14, col, 160, 0.5);
        this.text(e.x, e.y - 12, t.pop, col);
        break;
      }
      case 'gone': {
        const b = this.removeBonus(e.id);
        if (b) this.sparks(b.x + b.w / 2, b.y + b.h / 2, 8, `hsl(${BONUS_TYPES[b.type].hue},100%,65%)`, 90, 0.4);
        break;
      }
      case 'bomb': {
        for (const [ctx, extra] of [[this.trail, 0.6], [this.glow, 3.5]]) {
          ctx.save();
          ctx.globalCompositeOperation = 'destination-out';
          ctx.beginPath();
          ctx.arc(e.x + 0.5, e.y + 0.5, e.r + extra, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        this.ring(e.x, e.y, 4, e.r * 3, 0.6, 'hsl(35,100%,65%)', 3);
        this.ring(e.x, e.y, 2, e.r * 1.3, 0.35, '#fff', 2);
        this.sparks(e.x, e.y, 46, 'hsl(30,100%,62%)', 340, 0.8);
        this.flash('hsla(30,100%,60%,1)', 0.25);
        this.kick(7);
        break;
      }
      case 'wall': {
        const st = this.styleFor(e.p, -1);
        this.drawRun(e.p, e.x0, e.y0, e.x1, e.y1, -1);
        this.particles.push({ kind: 'line', x0: e.x0, y0: e.y0, x1: e.x1, y1: e.y1, col: '#fff', w: 4, life: 0.35, max: 0.35 });
        this.particles.push({ kind: 'line', x0: e.x0, y0: e.y0, x1: e.x1, y1: e.y1, col: st.core, w: 9, life: 0.5, max: 0.5 });
        break;
      }
      case 'tele': {
        const st = this.styleFor(e.p, -1);
        this.ring(e.fx, e.fy, 30, 2, 0.4, st.core, 2);
        this.ring(e.tx, e.ty, 2, 40, 0.5, st.core, 2);
        this.sparks(e.tx, e.ty, 18, st.hot, 200, 0.5);
        this.particles.push({ kind: 'line', x0: e.fx, y0: e.fy, x1: e.tx, y1: e.ty, col: st.glow, w: 1.2, life: 0.4, max: 0.4 });
        break;
      }
      case 'swap': {
        for (const [pi, fx, fy, tx, ty] of e.m) {
          const st = this.styleFor(pi, -1);
          this.particles.push({ kind: 'line', x0: fx, y0: fy, x1: tx, y1: ty, col: st.core, w: 1.5, life: 0.6, max: 0.6 });
          this.ring(tx, ty, 2, 30, 0.5, st.core, 2);
        }
        this.flash('hsla(226,100%,70%,1)', 0.18);
        break;
      }
      case 'die': {
        const st = this.styleFor(e.p, -1);
        this.sparks(e.x, e.y, 54, st.core, 300, 0.9);
        this.sparks(e.x, e.y, 16, '#fff', 200, 0.5);
        this.ring(e.x, e.y, 3, 46, 0.55, st.core, 2.5);
        this.kick(5);
        break;
      }
      case 'end': {
        if (e.w >= 0 && this.heads[e.w]) {
          const [x, y] = this.heads[e.w];
          const st = this.styleFor(e.w, -1);
          this.ring(x, y, 4, 80, 0.9, st.core, 3);
          this.ring(x, y, 4, 140, 1.2, st.hot, 1.5);
        }
        break;
      }
    }
  }

  // --- effects -------------------------------------------------------------
  addParticle(p) {
    if (this.particles.length < MAX_PARTICLES) this.particles.push(p);
  }

  sparks(x, y, n, col, speed, life) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.25 + Math.random() * 0.75);
      const l = life * (0.5 + Math.random() * 0.5);
      this.addParticle({ kind: 'spark', x: x + 0.5, y: y + 0.5, vx: Math.cos(a) * v, vy: Math.sin(a) * v, col, life: l, max: l, w: 0.8 + Math.random() * 1.2 });
    }
  }

  ring(x, y, r0, r1, life, col, w) {
    this.addParticle({ kind: 'ring', x: x + 0.5, y: y + 0.5, r0, r1, col, w, life, max: life });
  }

  text(x, y, str, col) {
    this.addParticle({ kind: 'text', x, y, str, col, life: 0.9, max: 0.9 });
  }

  flash(col, life) {
    this.addParticle({ kind: 'flash', col, life, max: life });
  }

  kick(amount) {
    if (!reducedMotion) this.shake = Math.max(this.shake, amount);
  }

  // --- per-frame drawing -----------------------------------------------------
  frame(now) {
    const dt = Math.min(0.05, Math.max(0, (now - (this.lastNow || now)) / 1000));
    this.lastNow = now;
    const f = this.fx;
    wipe(f);
    this.drawHeads(now);
    this.drawParticles(dt);
    if (this.shake > 0.2) {
      const s = this.shake;
      this.stage.style.transform = `translate(${(Math.random() - 0.5) * s}px,${(Math.random() - 0.5) * s}px)`;
      this.shake *= Math.pow(0.86, dt * 60);
      this.shaking = true;
    } else if (this.shaking) {
      this.stage.style.transform = '';
      this.shaking = false;
      this.shake = 0;
    }
  }

  drawHeads(now) {
    const f = this.fx;
    const running = this.phase === 'running';
    const a = running ? clamp((now - this.lastFrameAt) / TICK_MS, 0, 1) : 0;
    const pulse = 0.5 + 0.5 * Math.sin(now / 130);
    for (let i = 0; i < this.heads.length; i++) {
      const h = this.heads[i];
      if (!h || !h[5]) continue;
      const [x, y, dx, dy, sp, , god] = h;
      const st = god > 0 ? this.styleFor(i, (now / 3 + i * 45) % 360) : this.styleFor(i, -1);
      const ix = x + dx * sp * a;
      const iy = y + dy * sp * a;
      if (a > 0) {
        this.drawLine(f, x, y, ix, iy, this.tw.core, st.core);
        this.drawLine(f, x, y, ix, iy, this.tw.hot, st.hot);
      }
      const cx = ix + 0.5, cy = iy + 0.5;
      const hs = this.headSprites?.[i];
      if (hs) {
        f.globalCompositeOperation = 'lighter';
        const r = 16 + (running ? 0 : pulse * 6);
        f.drawImage(hs, cx - r, cy - r, 2 * r, 2 * r);
        f.globalCompositeOperation = 'source-over';
      }
      if (god > 0) {
        f.strokeStyle = st.core;
        f.lineWidth = 1.4;
        f.beginPath();
        f.arc(cx, cy, 7 + pulse * 2, 0, Math.PI * 2);
        f.stroke();
      }
      if (this.phase === 'countdown') {
        f.fillStyle = st.core;
        for (let k = 0; k < 3; k++) {
          const d = 12 + k * 9 + pulse * 3;
          f.globalAlpha = 0.85 - k * 0.25;
          const px = cx + dx * d, py = cy + dy * d;
          f.beginPath();
          f.moveTo(px + dx * 4, py + dy * 4);
          f.lineTo(px - dx * 2 + dy * 4, py - dy * 2 - dx * 4);
          f.lineTo(px - dx * 2 - dy * 4, py - dy * 2 + dx * 4);
          f.closePath();
          f.fill();
        }
        f.globalAlpha = 1;
        f.font = '600 13px Rajdhani, sans-serif';
        f.textAlign = 'center';
        f.fillStyle = st.hot;
        f.fillText(this.names[i] ?? '', cx - dx * 18, cy - dy * 18 + (dx ? -10 : 4));
      }
    }
  }

  drawParticles(dt) {
    const f = this.fx;
    const ps = this.particles;
    f.globalCompositeOperation = 'lighter';
    let j = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      ps[j++] = p;
      const t = p.life / p.max;
      switch (p.kind) {
        case 'spark': {
          const drag = Math.pow(0.04, dt);
          p.vx *= drag;
          p.vy *= drag;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          f.globalAlpha = t;
          f.strokeStyle = p.col;
          f.lineWidth = p.w;
          f.beginPath();
          f.moveTo(p.x, p.y);
          f.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035);
          f.stroke();
          break;
        }
        case 'ring': {
          const e = 1 - t;
          const r = p.r0 + (p.r1 - p.r0) * (1 - (1 - e) * (1 - e));
          f.globalAlpha = t;
          f.strokeStyle = p.col;
          f.lineWidth = p.w * t + 0.3;
          f.beginPath();
          f.arc(p.x, p.y, Math.max(0.1, r), 0, Math.PI * 2);
          f.stroke();
          break;
        }
        case 'line':
          f.globalAlpha = t;
          this.drawLine(f, p.x0, p.y0, p.x1, p.y1, p.w * t + 0.3, p.col);
          break;
        case 'text':
          f.globalAlpha = Math.min(1, t * 2);
          f.globalCompositeOperation = 'source-over';
          f.font = '700 12px Orbitron, sans-serif';
          f.textAlign = 'center';
          f.fillStyle = p.col;
          f.fillText(p.str, p.x, p.y - (1 - t) * 22);
          f.globalCompositeOperation = 'lighter';
          break;
        case 'flash':
          f.globalAlpha = t * 0.35;
          f.fillStyle = p.col;
          f.fillRect(0, 0, W, H);
          break;
      }
    }
    ps.length = j;
    f.globalAlpha = 1;
    f.globalCompositeOperation = 'source-over';
  }
}
