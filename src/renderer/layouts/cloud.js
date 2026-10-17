import { rng, hashSeed, packCircles, boundsOf, blobRadius } from './pack.js';

export function radiusFor(item, rand, scale = 1) {
  const base = 66 + 88 * Math.pow(rand(), 1.7);
  return (base + (item.type === 'video' ? 8 : 0)) * scale;
}

export default {
  id: 'cloud',
  name: 'Nuvem',
  icon: '<circle cx="8" cy="9" r="4"/><circle cx="16.5" cy="7.5" r="2.7"/><circle cx="15.5" cy="15.5" r="4.5"/><circle cx="6.5" cy="17" r="2.3"/>',
  compute(items, ctx) {
    const rand = rng(hashSeed('cloud') ^ ctx.seed);
    const radii = items.map((it) => radiusFor(it, rand));
    const stretch = Math.min(1.9, Math.max(1, ctx.width / Math.max(ctx.height, 1)));
    const spots = packCircles(radii, { gap: 16, stretch });
    const pos = new Map();
    items.forEach((it, i) => {
      const r = radii[i];
      pos.set(it.id, { x: spots[i].x, y: spots[i].y, w: r * 2, h: r * 2, radius: blobRadius(rand), z: Math.round(r) });
    });
    return { pos, labels: [], bounds: boundsOf(pos.values()) };
  },
};
