import { rng, hashSeed, boundsOf } from './pack.js';

const CELL = 190;
const GAP = 16;

export default {
  id: 'grid',
  name: 'Mosaico',
  fit: 'width',
  icon: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  compute(items, ctx) {
    const rand = rng(hashSeed('grid') ^ ctx.seed);
    const cols = Math.max(3, Math.floor((ctx.width - 80) / (CELL + GAP)));
    const used = [];
    const free = (r, c, s) => {
      if (c + s > cols) return false;
      for (let i = 0; i < s; i++) for (let j = 0; j < s; j++) if (used[(r + i) * cols + c + j]) return false;
      return true;
    };
    const take = (r, c, s) => {
      for (let i = 0; i < s; i++) for (let j = 0; j < s; j++) used[(r + i) * cols + c + j] = true;
    };

    const pos = new Map();
    let cursor = 0;
    for (const it of items) {
      const size = rand() < 0.13 && cols >= 4 ? 2 : 1;
      let spot = cursor;
      while (!free(Math.floor(spot / cols), spot % cols, size)) spot++;
      const r = Math.floor(spot / cols);
      const c = spot % cols;
      take(r, c, size);
      while (used[cursor]) cursor++;
      const w = size * CELL + (size - 1) * GAP;
      pos.set(it.id, {
        x: c * (CELL + GAP) + w / 2,
        y: r * (CELL + GAP) + w / 2,
        w,
        h: w,
        radius: '26px',
        z: size,
      });
    }
    const b = boundsOf(pos.values());
    const dx = (b.minX + b.maxX) / 2;
    const dy = (b.minY + b.maxY) / 2;
    for (const p of pos.values()) { p.x -= dx; p.y -= dy; }
    return { pos, labels: [], bounds: boundsOf(pos.values()) };
  },
};
