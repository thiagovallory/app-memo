import { rng, hashSeed, packCircles, boundsOf, blobRadius } from './pack.js';

const FILL = 0.6;       // fração da tela coberta pelas bolhas
const MIN_MEAN_R = 44;  // raio médio mínimo (px): abaixo disso passa a sortear o que mostrar
const MAX_SCALE = 2.4;

export function radiusFor(item, rand, scale = 1) {
  const base = 66 + 88 * Math.pow(rand(), 1.7);
  return (base + (item.type === 'video' ? 8 : 0)) * scale;
}

// estatística da distribuição de raios, para estimar quantas bolhas cabem
const sample = (() => {
  const rand = rng(12345);
  let sum = 0, sumSq = 0;
  const n = 2000;
  for (let i = 0; i < n; i++) { const r = radiusFor({}, rand); sum += r; sumSq += r * r; }
  return { mean: sum / n, meanSq: sumSq / n };
})();

/** Quantas bolhas cabem numa área com o tamanho mínimo aceitável. */
export function capacityFor(width, height, insetTop = 0) {
  const area = Math.max(1, width - 40) * Math.max(1, height - insetTop - 40);
  const sMin = MIN_MEAN_R / sample.mean;
  return Math.max(8, Math.floor((area * FILL) / (Math.PI * sample.meanSq * sMin * sMin)));
}

export default {
  id: 'cloud',
  name: 'Nuvem',
  icon: '<circle cx="8" cy="9" r="4"/><circle cx="16.5" cy="7.5" r="2.7"/><circle cx="15.5" cy="15.5" r="4.5"/><circle cx="6.5" cy="17" r="2.3"/>',
  compute(items, ctx) {
    const rand = rng(hashSeed('cloud') ^ ctx.seed);
    const w = Math.max(1, ctx.width - 40);
    const h = Math.max(1, ctx.height - (ctx.insetTop || 0) - 40);

    // muitas fotos: mostra só as que cabem (a ordem já vem embaralhada ou ordenada)
    const shown = items.slice(0, capacityFor(ctx.width, ctx.height, ctx.insetTop));
    const base = shown.map((it) => radiusFor(it, rand));

    // com poucas fotos as bolhas crescem; com muitas encolhem, até preencher a tela
    const covered = base.reduce((a, r) => a + Math.PI * r * r, 0) || 1;
    const sMin = MIN_MEAN_R / sample.mean;
    const scale = Math.min(MAX_SCALE, Math.max(sMin, Math.sqrt((w * h * FILL) / covered)));
    const radii = base.map((r) => r * scale);

    const stretch = Math.min(2.5, Math.max(0.5, w / h));
    const spots = packCircles(radii, { gap: 12, stretch, squareness: 5 });
    const pos = new Map();
    shown.forEach((it, i) => {
      const r = radii[i];
      pos.set(it.id, { x: spots[i].x, y: spots[i].y, w: r * 2, h: r * 2, radius: blobRadius(rand), z: Math.round(r) });
    });
    return { pos, labels: [], bounds: boundsOf(pos.values()), shown };
  },
};
