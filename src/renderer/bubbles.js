import { rng, hashSeed } from './layouts/pack.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/**
 * Bolhas de sabão: um grupo de fotos/vídeos sobe lentamente pela tela, balançando e se esbarrando.
 * Quando uma bolha sai por qualquer lado, entra outra por baixo ou pelas laterais, então todo o acervo vai passando.
 */
export class Bubbles {
  constructor({ host, create }) {
    this.host = host;
    this.create = create;       // (item, diâmetro) => elemento .tile
    this.bubbles = [];
    this.items = [];
    this.running = false;
    this.paused = false;
  }

  get active() { return this.running; }

  start(items, { width, height }) {
    this.stop();
    this.items = items;
    this.W = width;
    this.H = height;
    this.running = true;
    if (!items.length) return;

    const scale = clamp(Math.min(width, height) / 800, 0.8, 1.7);
    const meanR = 62 * scale;
    const cap = clamp(Math.round((width * height * 0.36) / (Math.PI * meanR * meanR)), 3, 70);
    this.count = Math.min(items.length, cap);
    // com poucas fotos, bolhas maiores
    this.grow = clamp(Math.sqrt(cap / this.count), 1, 1.8);
    this.scale = scale;

    this.rand = rng((Math.random() * 1e9) | 0);
    this.shuffle();
    for (let i = 0; i < this.count; i++) this.spawn(this.next(), true);

    this.last = performance.now();
    this.t = 0;
    this.frame = requestAnimationFrame((now) => this.tick(now));
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.frame);
    for (const b of this.bubbles) b.el.remove();
    this.bubbles = [];
  }

  pause(on) {
    this.paused = on;
    if (!on) this.last = performance.now();
  }

  shuffle() {
    const order = this.items.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    this.order = order;
    this.cursor = 0;
  }

  next() {
    if (this.cursor >= this.order.length) this.shuffle();
    return this.items[this.order[this.cursor++]];
  }

  spawn(item, initial) {
    const rand = this.rand;
    const r = (40 + 56 * Math.pow(rand(), 1.5)) * this.scale * this.grow;
    const vy = -(14 + 26 * rand()) * (1.25 - r / (200 * this.scale));
    let vx = (rand() - 0.5) * 70;
    // metade das bolhas nasce pelas laterais, andando para dentro da tela
    const side = !initial && rand() < 0.4;
    if (side) vx = (rand() < 0.5 ? 1 : -1) * (18 + rand() * 34);

    let x = 0, y = 0;
    for (let tries = 0; tries < 40; tries++) {
      if (initial) {
        x = r + rand() * Math.max(1, this.W - 2 * r);
        y = r + rand() * Math.max(1, this.H - 2 * r);
      } else if (side) {
        x = vx > 0 ? -r - rand() * 60 : this.W + r + rand() * 60;
        y = rand() * this.H;
      } else {
        x = r + rand() * Math.max(1, this.W - 2 * r);
        y = this.H + r + rand() * 140;
      }
      if (this.bubbles.every((b) => Math.hypot(b.x - x, b.y - y) > b.r + r + 8)) break;
    }
    const el = this.create(item, r * 2);
    el.classList.add('bubble');
    if (initial) el.style.transitionDelay = `${rand() * 0.6}s`;
    this.host.append(el);
    this.bubbles.push({
      item, el, x, y, r, vx, vy,
      ph: rand() * 6.28, sf: 0.25 + rand() * 0.4, sw: 6 + rand() * 12,
      ix: 0, iy: 0,
    });
  }

  /** Empurra de leve as bolhas perto do dedo/mouse. */
  nudge(x, y, dx, dy) {
    for (const b of this.bubbles) {
      const reach = b.r + 90;
      const d = Math.hypot(b.x - x, b.y - y);
      if (d > reach) continue;
      const k = 1 - d / reach;
      b.ix = clamp(b.ix + dx * 9 * k, -420, 420);
      b.iy = clamp(b.iy + dy * 9 * k, -420, 420);
    }
  }

  tick(now) {
    if (!this.running) return;
    this.frame = requestAnimationFrame((n) => this.tick(n));
    if (this.paused) return;
    const dt = clamp((now - this.last) / 1000, 0, 0.05);
    this.last = now;
    this.t += dt;
    const list = this.bubbles;
    const damp = Math.exp(-dt * 1.6);

    for (const b of list) {
      b.ix *= damp; b.iy *= damp;
      b.x += (b.vx + Math.sin(this.t * b.sf + b.ph) * b.sw + b.ix) * dt;
      b.y += (b.vy + b.iy) * dt;
    }

    // esbarrões macios: afastam as bolhas que se sobrepõem
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], c = list[j];
        const dx = c.x - a.x, dy = c.y - a.y;
        const min = a.r + c.r + 4;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min || d2 === 0) continue;
        const d = Math.sqrt(d2);
        const push = (min - d) / 2;
        const nx = dx / d, ny = dy / d;
        a.x -= nx * push; a.y -= ny * push;
        c.x += nx * push; c.y += ny * push;
      }
    }

    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i];
      const out = b.y < -b.r - 30 || b.x < -b.r - 120 || b.x > this.W + b.r + 120 || b.y > this.H + b.r + 400;
      if (out) {
        b.el.remove();
        list.splice(i, 1);
        this.spawn(this.next(), false);
        continue;
      }
      b.el.style.transform = `translate3d(${b.x - b.r}px, ${b.y - b.r}px, 0)`;
    }
  }
}
