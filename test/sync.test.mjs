import test from 'node:test';
import assert from 'node:assert/strict';
import { syncFolder, safeName, SyncError } from '../src/renderer/sync.js';

function fakeStore(initial = {}, { failOn = [] } = {}) {
  const files = new Map(Object.entries(initial));
  return {
    files,
    async list() { return new Map(files); },
    async download(url, name) {
      if (failOn.some((f) => url.includes(f))) throw new Error('rede caiu');
      files.set(name, url.length);
    },
    async rename(from, to) { files.set(to, files.get(from)); files.delete(from); },
    async remove(name) { files.delete(name); },
  };
}
const src = (list) => ({ list: async () => list });

test('baixa só o que falta e não deixa .part para trás', async () => {
  const store = fakeStore({ 'a.jpg': 1 });
  const r = await syncFolder({ source: src([{ name: 'a.jpg', url: 'u/a' }, { name: 'b.jpg', url: 'u/b' }]), store });
  assert.deepEqual([r.total, r.added, r.removed, r.failed.length], [2, 1, 0, 0]);
  assert.deepEqual([...store.files.keys()].sort(), ['a.jpg', 'b.jpg']);
});

test('baixa de novo quando o tamanho mudou', async () => {
  const store = fakeStore({ 'a.jpg': 5 });
  const r = await syncFolder({ source: src([{ name: 'a.jpg', url: 'u/a', size: 9 }]), store });
  assert.equal(r.added, 1);
});

test('falha num arquivo não para os outros e limpa o .part', async () => {
  const store = fakeStore({}, { failOn: ['bad'] });
  const r = await syncFolder({ source: src([{ name: 'a.jpg', url: 'u/a' }, { name: 'b.jpg', url: 'u/bad' }, { name: 'c.jpg', url: 'u/c' }]), store });
  assert.equal(r.added, 2);
  assert.equal(r.failed.length, 1);
  assert.equal(r.failed[0].name, 'b.jpg');
  assert.ok(![...store.files.keys()].some((n) => n.endsWith('.part')));
});

test('erro ao listar a fonte não mexe em nada', async () => {
  const store = fakeStore({ 'a.jpg': 1 });
  const source = { list: async () => { throw new Error('offline'); } };
  await assert.rejects(syncFolder({ source, store, mirror: true }), SyncError);
  assert.deepEqual([...store.files.keys()], ['a.jpg']);
});

test('mirror apaga o que saiu da fonte, mas nunca com a fonte vazia', async () => {
  const store = fakeStore({ 'a.jpg': 1, 'old.jpg': 1 });
  const r = await syncFolder({ source: src([{ name: 'a.jpg', url: 'u/a' }]), store, mirror: true });
  assert.equal(r.removed, 1);
  assert.deepEqual([...store.files.keys()], ['a.jpg']);

  const r2 = await syncFolder({ source: src([]), store, mirror: true });
  assert.equal(r2.removed, 0);
  assert.deepEqual([...store.files.keys()], ['a.jpg']);
});

test('sem mirror, mantém o que saiu da fonte', async () => {
  const store = fakeStore({ 'old.jpg': 1 });
  await syncFolder({ source: src([{ name: 'a.jpg', url: 'u/a' }]), store });
  assert.ok(store.files.has('old.jpg'));
});

test('nomes repetidos e perigosos viram nomes seguros e únicos', async () => {
  const store = fakeStore();
  await syncFolder({ source: src([{ name: 'x.jpg', url: 'u/1' }, { name: 'X.jpg', url: 'u/2' }, { name: '../../etc/passwd', url: 'u/3' }]), store });
  const names = [...store.files.keys()];
  assert.equal(names.length, 3);
  assert.ok(names.every((n) => !n.includes('/') && !n.startsWith('.')));
  assert.equal(safeName('..'), 'arquivo');
});

test('limpa .part de uma sincronização interrompida', async () => {
  const store = fakeStore({ 'a.jpg.part': 3 });
  await syncFolder({ source: src([]), store });
  assert.equal(store.files.size, 0);
});
