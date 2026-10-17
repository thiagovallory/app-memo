// Para criar um novo layout: adicione um arquivo nesta pasta exportando
// { id, name, icon (conteúdo SVG 24x24), fit?: 'width', compute(items, ctx) } e registre abaixo.
// compute devolve { pos: Map(id -> {x, y, w, h, radius, z}), labels: [{text, count, x, y, size}], bounds }.
import cloud from './cloud.js';
import grid from './grid.js';
import folders from './folders.js';

export const layouts = [cloud, folders, grid];
export const layoutById = (id) => layouts.find((l) => l.id === id) || layouts[0];
