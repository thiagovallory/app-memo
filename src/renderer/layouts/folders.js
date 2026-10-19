import { rng, hashSeed, packCircles, boundsOf, blobRadius } from './pack.js';
import { radiusFor } from './cloud.js';

const MAX_SHOWN = 500; // acima disso o empacotamento fica lento (segundos): mostra uma amostra de cada pasta

// mantém a ordem dos itens e dá a cada pasta uma cota proporcional ao seu tamanho
function sample(items) {
  if (items.length <= MAX_SHOWN) return items;
  const totals = new Map();
  for (const it of items) totals.set(it.folder || '', (totals.get(it.folder || '') || 0) + 1);
  const quota = new Map([...totals].map(([f, n]) => [f, Math.max(3, Math.round(MAX_SHOWN * n / items.length))]));
  return items.filter((it) => {
    const f = it.folder || '';
    const left = quota.get(f);
    quota.set(f, left - 1);
    return left > 0;
  });
}

export default {
  id: 'folders',
  name: 'Pastas',
  icon: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  compute(items, ctx) {
    const rand = rng(hashSeed('folders') ^ ctx.seed);
    const shown = sample(items);
    const totals = new Map();
    for (const it of items) totals.set(it.folder || '', (totals.get(it.folder || '') || 0) + 1);
    const groups = new Map();
    for (const it of shown) {
      const key = it.folder || '';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(it);
    }
    const clusters = [...groups.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([folder, list]) => {
        const radii = list.map((it) => radiusFor(it, rand, 0.78));
        const spots = packCircles(radii, { gap: 12 });
        let reach = 0;
        spots.forEach((s, i) => { reach = Math.max(reach, Math.hypot(s.x, s.y) + radii[i]); });
        return { folder, list, radii, spots, reach };
      });

    const LABEL_SPACE = 110;
    const centers = packCircles(clusters.map((c) => c.reach + LABEL_SPACE), { gap: 40, stretch: 1.4 });

    const pos = new Map();
    const labels = [];
    clusters.forEach((c, ci) => {
      const { x: cx, y: cy } = centers[ci];
      c.list.forEach((it, i) => {
        const r = c.radii[i];
        pos.set(it.id, { x: cx + c.spots[i].x, y: cy + c.spots[i].y, w: r * 2, h: r * 2, radius: blobRadius(rand, 0.4), z: Math.round(r) });
      });
      const name = c.folder ? c.folder.split('/').pop() : 'Soltas';
      labels.push({ folder: c.folder, text: name, count: totals.get(c.folder), x: cx, y: cy - c.reach - 46, size: Math.min(86, 40 + c.list.length * 0.9) });
    });

    const b = boundsOf([...pos.values(), ...labels.map((l) => ({ x: l.x, y: l.y, w: 260, h: l.size * 2 }))]);
    return { pos, labels, bounds: b, shown };
  },
};
