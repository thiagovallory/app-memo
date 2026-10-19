import { rng } from './layouts/pack.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const MORPH_MS = 800;
const easeOut = (p) => 1 - (1 - p) ** 3;

/**
 * Bolhas de sabão: um grupo de fotos/vídeos flutua pela tela, balançando e se esbarrando.
 * Quando uma bolha sai por qualquer lado, entra outra por baixo ou pelas laterais,
 * então todo o acervo vai passando.
 */
export class Bubbles {
  constructor({ host, create }) {
    this.host = host;
    this.create = create;       // (item, diâmetro) => elemento .tile
    this.bubbles = [];
    this.items = [];
    this.running = false;
    this.paused = false;
    this.rand = rng((Math.random() * 1e9) | 0);
  }

  get active() { return this.running; }

  configure(items, { width, height }) {
    this.items = items;
    this.W = width;
    this.H = height;
    this.scale = clamp(Math.min(width, height) / 800, 0.8, 1.7);
    const meanR = 62 * this.scale;
    const cap = clamp(Math.round((width * height * 0.36) / (Math.PI * meanR * meanR)), 3, 70);
    this.count = Math.min(items.length, cap);
    // com poucas fotos, bolhas maiores
    this.grow = clamp(Math.sqrt(cap / Math.max(1, this.count)), 1, 1.8);
  }

  /**
   * Começa a animação. `seeds` são tiles já na tela ({ el, item, x, y, w }, centro e diâmetro em px):
   * eles viram bolhas no lugar onde estão, em vez de sumir e reaparecer.
   */
  start(items, dims, seeds = []) {
    this.stop();
    this.running = true;
    this.configure(items, dims);

    // sorteio: as bolhas que ficam se espalham pela tela toda, não só no centro
    for (let i = seeds.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [seeds[i], seeds[j]] = [seeds[j], seeds[i]];
    }
    seeds.forEach((seed, i) => (i < this.count ? this.adopt(seed) : this.fadeOut(seed.el)));

    this.shuffle();
    while (this.bubbles.length < this.count) this.spawn(this.next(), true);

    this.last = performance.now();
    this.t = 0;
    this.frame = requestAnimationFrame((now) => this.tick(now));
  }

  /** Muda o conjunto de fotos (filtro/busca) sem recomeçar: as que continuam seguem flutuando. */
  update(items, dims) {
    this.configure(items, dims);
    const ids = new Set(items.map((it) => it.id));
    const keep = [];
    for (const b of this.bubbles) {
      if (ids.has(b.item.id) && keep.length < this.count) keep.push(b);
      else this.fadeOut(b.el);
    }
    this.bubbles = keep;
    this.shuffle();
    while (this.bubbles.length < this.count) this.spawn(this.next(), true);
    if (!this.running) { this.running = true; this.last = performance.now(); this.frame = requestAnimationFrame((n) => this.tick(n)); }
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.frame);
    for (const b of this.bubbles) b.el.remove();
    this.bubbles = [];
  }

  /** Para a animação mantendo os elementos: devolve onde cada bolha está ({ el, item, x, y, w }). */
  release() {
    this.running = false;
    cancelAnimationFrame(this.frame);
    const out = this.bubbles.map((b) => ({ el: b.el, item: b.item, x: b.x, y: b.y, w: 2 * b.r * (b.s || 1) }));
    this.bubbles = [];
    return out;
  }

  pause(on) {
    this.paused = on;
    if (!on) this.last = performance.now();
  }

  fadeOut(el) {
    el.classList.add('leave');
    setTimeout(() => el.remove(), 500);
  }

  shuffle() {
    const order = this.items.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    // o que já está na tela vai para o fim da fila
    const shown = new Set(this.bubbles.map((b) => b.item.id));
    this.order = [...order.filter((i) => !shown.has(this.items[i].id)), ...order.filter((i) => shown.has(this.items[i].id))];
    this.cursor = 0;
  }

  /** Próximo item da fila que ainda não está numa bolha (só repete se não houver outro). */
  next() {
    const shown = new Set(this.bubbles.map((b) => b.item.id));
    for (let n = 0; n < this.items.length; n++) {
      if (this.cursor >= this.order.length) this.shuffle();
      const item = this.items[this.order[this.cursor++]];
      if (!shown.has(item.id)) return item;
    }
    return this.items[this.order[Math.max(0, this.cursor - 1)]];
  }

  radius() {
    return (40 + 56 * Math.pow(this.rand(), 1.5)) * this.scale * this.grow;
  }

  bubbleFor(item, el, x, y, r, vx, vy) {
    const rand = this.rand;
    return {
      item, el, x, y, r, vx, vy, s: 1,
      ph: rand() * 6.28, sf: 0.25 + rand() * 0.4, sw: 6 + rand() * 12,
      ix: 0, iy: 0,
    };
  }

  velocity(r) {
    return -(14 + 26 * this.rand()) * (1.25 - r / (200 * this.scale));
  }

  adopt({ el, item, x, y, w }) {
    const r = clamp(w / 2, 34 * this.scale, 118 * this.scale * this.grow);
    const b = this.bubbleFor(item, el, x, y, r, (this.rand() - 0.5) * 70, this.velocity(r));
    b.s = w / 2 / r;
    b.morph = { from: b.s, t0: performance.now() };
    el.classList.remove('enter', 'leave');
    el.classList.add('bubble');
    el.style.transitionDelay = '';
    el.style.width = el.style.height = `${r * 2}px`;
    el.style.borderRadius = '50%';
    el.style.transform = `translate3d(${x - r}px, ${y - r}px, 0) scale(${b.s})`;
    this.bubbles.push(b);
  }

  spawn(item, initial) {
    const rand = this.rand;
    const r = this.radius();
    const vy = this.velocity(r);
    let vx = (rand() - 0.5) * 70;
    // parte das bolhas nasce pelas laterais, andando para dentro da tela
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
    el.style.transform = `translate3d(${x - r}px, ${y - r}px, 0)`;
    if (initial) el.style.transitionDelay = `${rand() * 0.5}s`;
    this.host.append(el);
    this.bubbles.push(this.bubbleFor(item, el, x, y, r, vx, vy));
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
        const min = a.r * a.s + c.r * c.s + 4;
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
      if (b.morph) {
        const p = Math.min(1, (performance.now() - b.morph.t0) / MORPH_MS);
        b.s = 1 + (b.morph.from - 1) * (1 - easeOut(p));
        if (p >= 1) b.morph = null;
      }
      b.el.style.transform = `translate3d(${b.x - b.r}px, ${b.y - b.r}px, 0)${b.s !== 1 ? ` scale(${b.s})` : ''}`;
    }
  }
}
