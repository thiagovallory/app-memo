// Utilidades compartilhadas pelos layouts: aleatório com semente e empacotamento de círculos em espiral.

export function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Posiciona círculos (raios dados) o mais perto possível do centro, seguindo uma espiral.
 * `stretch` > 1 achata a espiral em elipse (telas largas). Retorna [{x, y}] na mesma ordem.
 */
export function packCircles(radii, { gap = 14, stretch = 1 } = {}) {
  const placed = [];
  const out = new Array(radii.length);
  const maxR = radii.reduce((m, r) => Math.max(m, r), 0);
  const cell = (maxR + gap) * 2;
  const grid = new Map();
  const key = (cx, cy) => cx * 73856093 ^ cy * 19349663;
  const pitch = 10;
  let startR = 0;

  const fits = (x, y, r) => {
    const gx = Math.floor(x / cell);
    const gy = Math.floor(y / cell);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const bucket = grid.get(key(gx + i, gy + j));
        if (!bucket) continue;
        for (const p of bucket) {
          const dx = p.x - x;
          const dy = p.y - y;
          const min = p.r + r + gap;
          if (dx * dx + dy * dy < min * min) return false;
        }
      }
    }
    return true;
  };

  const add = (x, y, r) => {
    const k = key(Math.floor(x / cell), Math.floor(y / cell));
    const p = { x, y, r };
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(p);
    placed.push(p);
  };

  radii.forEach((r, i) => {
    if (i === 0) {
      add(0, 0, r);
      out[i] = { x: 0, y: 0 };
      return;
    }
    let theta = (startR * 2 * Math.PI) / pitch;
    for (let guard = 0; guard < 400000; guard++) {
      const rad = (pitch / (2 * Math.PI)) * theta;
      const x = rad * Math.cos(theta) * stretch;
      const y = rad * Math.sin(theta);
      if (fits(x, y, r)) {
        add(x, y, r);
        out[i] = { x, y };
        startR = Math.max(0, rad * 0.7);
        return;
      }
      theta += Math.max(0.02, 9 / Math.max(rad, 20));
    }
    out[i] = { x: 0, y: 0 };
  });

  return out;
}

export function boundsOf(rects) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x - r.w / 2);
    minY = Math.min(minY, r.y - r.h / 2);
    maxX = Math.max(maxX, r.x + r.w / 2);
    maxY = Math.max(maxY, r.y + r.h / 2);
  }
  if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

const BLOBS = [
  '58% 42% 61% 39% / 47% 56% 44% 53%',
  '46% 54% 38% 62% / 55% 41% 59% 45%',
  '63% 37% 54% 46% / 40% 62% 38% 60%',
  '50% 50% 50% 50%',
  '41% 59% 52% 48% / 58% 44% 56% 42%',
];

export function blobRadius(rand, organic = 0.55) {
  return rand() < organic ? BLOBS[Math.floor(rand() * BLOBS.length)] : '50%';
}
