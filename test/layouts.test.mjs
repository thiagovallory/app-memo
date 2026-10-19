import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { layouts } from '../src/renderer/layouts/index.js';
import folders from '../src/renderer/layouts/folders.js';

const require = createRequire(import.meta.url);
const { jpegOrientation } = require('../src/exif.js');

const mk = (n) => Array.from({ length: n }, (_, i) => ({
  id: `i${i}`, type: i % 7 ? 'image' : 'video', folder: `f${i % 9}`, rel: `f${i % 9}/${i}`,
}));
const ctx = { width: 1920, height: 1080, insetTop: 120, seed: 1 };

for (const layout of layouts.filter((l) => !l.live)) {
  test(`${layout.id}: posiciona 0, 1 e muitos itens com limites finitos`, () => {
    for (const n of [0, 1, 40, 800]) {
      const res = layout.compute(mk(n), ctx);
      const shown = res.shown || mk(n);
      assert.equal(res.pos.size, shown.length);
      for (const it of shown) assert.ok(res.pos.has(it.id));
      for (const v of Object.values(res.bounds)) assert.ok(Number.isFinite(v));
    }
  });
}

test('folders: limita a amostra e mantém a contagem real nos rótulos', () => {
  const items = mk(3000);
  const res = folders.compute(items, ctx);
  assert.ok(res.shown.length < items.length);
  assert.equal(res.labels.reduce((a, l) => a + l.count, 0), items.length);
});

function jpegWith(orientation, little = true) {
  const tiff = Buffer.alloc(8 + 2 + 12 + 4);
  tiff.write(little ? 'II' : 'MM', 0, 'latin1');
  const w16 = (v, o) => (little ? tiff.writeUInt16LE(v, o) : tiff.writeUInt16BE(v, o));
  const w32 = (v, o) => (little ? tiff.writeUInt32LE(v, o) : tiff.writeUInt32BE(v, o));
  w16(42, 2); w32(8, 4); w16(1, 8);
  w16(0x0112, 10); w16(3, 12); w32(1, 14); w16(orientation, 18);
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const head = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0, 0]);
  head.writeUInt16BE(body.length + 2, 4);
  return Buffer.concat([head, body, Buffer.from([0xff, 0xd9])]);
}

test('jpegOrientation lê EXIF em little e big endian', () => {
  assert.equal(jpegOrientation(jpegWith(6)), 6);
  assert.equal(jpegOrientation(jpegWith(8, false)), 8);
  assert.equal(jpegOrientation(jpegWith(1)), 1);
});

test('jpegOrientation tolera lixo e arquivos sem EXIF', () => {
  assert.equal(jpegOrientation(Buffer.alloc(0)), 1);
  assert.equal(jpegOrientation(Buffer.from('not a jpeg')), 1);
  assert.equal(jpegOrientation(Buffer.from([0xff, 0xd8, 0xff, 0xd9])), 1);
  assert.equal(jpegOrientation(jpegWith(6).subarray(0, 14)), 1);
});
