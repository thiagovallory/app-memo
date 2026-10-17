// Para criar um novo layout: adicione um arquivo nesta pasta exportando
// { id, name, icon (conteúdo SVG 24x24), fit?: 'width', compute(items, ctx) } e registre abaixo.
// compute devolve { pos: Map(id -> {x, y, w, h, radius, z}), labels: [{text, count, x, y, size}], bounds, shown? }
// (`shown` = itens realmente posicionados, quando o layout mostra só uma parte).
// ctx: { width, height, insetTop, seed }. Layouts com `live: true` (ex.: bolhas) são animados em ../bubbles.js.
import cloud from './cloud.js';
import bubbles from './bubbles.js';
import grid from './grid.js';
import folders from './folders.js';

export const layouts = [cloud, bubbles, folders, grid];
export const layoutById = (id) => layouts.find((l) => l.id === id) || layouts[0];
