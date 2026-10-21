import test from 'node:test';
import assert from 'node:assert/strict';

// Filesystem simulado em memória (a API real do plugin só existe no iPad)
const tree = new Map(); // "DIR:caminho" -> { type, size, mtime, data }
const put = (dir, path, o = {}) => tree.set(`${dir}:${path}`, { type: 'file', size: 10, mtime: 1000, ...o });
put('DOCUMENTS', 'a.jpg');
put('DOCUMENTS', 'video.MOV');
put('DOCUMENTS', 'notas.txt');
put('DOCUMENTS', '.oculto.jpg');
put('DOCUMENTS', 'Viagem/b.heic', { size: 20 });
tree.set('DOCUMENTS:Viagem', { type: 'directory' });
put('CACHE', 'memo-thumbs/velha-1-1.jpg');

const fs = {
  async readdir({ path, directory }) {
    const prefix = `${directory}:${path ? path + '/' : ''}`;
    const files = [];
    for (const [k, v] of tree) {
      if (!k.startsWith(prefix)) continue;
      const rest = k.slice(prefix.length);
      if (!rest || rest.includes('/')) continue;
      files.push({ name: rest, type: v.type, size: v.size ?? 0, mtime: v.mtime ?? 0, uri: `file:///${k.replace(':', '/')}` });
    }
    return { files };
  },
  async mkdir() {},
  async getUri({ path, directory }) { return { uri: `file:///${directory}/${path}` }; },
  async writeFile({ path, directory, data }) { put(directory, path, { data }); },
  async deleteFile({ path, directory }) { tree.delete(`${directory}:${path}`); },
};

globalThis.window = {
  Capacitor: { isNativePlatform: () => true, convertFileSrc: (u) => `capacitor://localhost/_f_/${u}`, Plugins: { Filesystem: fs } },
};
globalThis.document = { hidden: false, addEventListener() {} };
await import('../src/renderer/platform/capacitor.js');
const api = globalThis.window.memo;

test('lista fotos e vídeos de Documents, com subpastas, ignorando ocultos e outros formatos', async () => {
  const lib = await api.loadLibrary();
  const rels = lib.items.map((i) => i.rel).sort();
  assert.deepEqual(rels, ['Viagem/b.heic', 'a.jpg', 'video.MOV']);
  const heic = lib.items.find((i) => i.ext === 'heic');
  assert.equal(heic.folder, 'Viagem');
  assert.equal(heic.type, 'image');
  assert.equal(lib.items.find((i) => i.ext === 'mov').type, 'video');
  assert.equal(new Set(lib.items.map((i) => i.id)).size, 3);
  assert.ok(lib.hint);
});

test('miniatura: usa o original até existir, depois a miniatura salva', async () => {
  const { items } = await api.loadLibrary();
  const a = items.find((i) => i.rel === 'a.jpg');
  assert.match(api.thumbUrl(a.id), /DOCUMENTS\/a\.jpg$/);
  assert.equal(await api.saveThumb(a.id, new Uint8Array([0xff, 0xd8, 1, 2, 3])), true);
  assert.match(api.thumbUrl(a.id), /memo-thumbs\/.+\.jpg$/);
  assert.equal(api.fileUrl(a.id).endsWith('DOCUMENTS/a.jpg'), true);
});

test('recarregar remove do cache miniaturas de fotos que não existem mais', async () => {
  await api.loadLibrary();
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(!tree.has('CACHE:memo-thumbs/velha-1-1.jpg'));
});

test('id desconhecido não quebra', async () => {
  assert.equal(api.thumbUrl('nao-existe'), '');
  assert.equal(await api.saveThumb('nao-existe', new Uint8Array([1])), false);
});
