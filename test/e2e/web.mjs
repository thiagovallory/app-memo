// Teste de ponta a ponta da versão web (PWA) num Chromium de verdade: importa arquivos pelo seletor,
// confere o service worker (arquivo, miniatura, Range de vídeo), a persistência e o modo offline.
//
//   npm run test:web           (usa o Chromium do Playwright; ou CHROME_PATH=/caminho/do/chrome)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../src/renderer');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

// PNG liso (RGB) de w x h, sem dependências
function png(w, h, [r, g, b]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [r, g, b]).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(0);
const url = `http://localhost:${server.address().port}/`;

const colors = [[200, 60, 60], [60, 200, 60], [60, 60, 200], [200, 200, 60], [60, 200, 200], [200, 60, 200]];
const files = [
  ...colors.map((c, i) => ({ name: `foto${i}.png`, mimeType: 'image/png', buffer: png(900, 900, c) })),
  { name: 'praia.png', mimeType: 'image/png', buffer: png(900, 900, [30, 120, 220]) },
  { name: 'clip.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(5000, 7) }, // não precisa tocar: só testamos o Range
  { name: 'notas.txt', mimeType: 'text/plain', buffer: Buffer.from('ignorar') },
];

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

// um único tratador de diálogos: o prompt de pasta recebe "Viagem"; os confirm são aceitos
const dialogs = [];
page.on('dialog', (d) => { dialogs.push(d.type()); return d.type() === 'prompt' ? d.accept('Viagem') : d.accept(); });

let failed = 0;
const ok = (cond, msg) => { console.log(cond ? 'ok  ' : 'FAIL', msg); if (!cond) failed++; };
const eachTile = () => page.evaluate(() => document.querySelectorAll('.tile').length);

await page.goto(url);
await page.waitForSelector('#empty:not([hidden])', { timeout: 15000 });
ok((await page.locator('#empty h2').innerText()) === 'Nenhuma foto ainda', 'primeira visita mostra o convite para importar');
ok(await page.evaluate(() => !!navigator.serviceWorker.controller), 'o service worker controla a página');

const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#reset')]);
await chooser.setFiles(files);
await page.waitForFunction(() => document.querySelectorAll('.tile').length >= 5, null, { timeout: 20000 });
const status = await page.locator('#status').innerText();
ok(/\d+ memórias/.test(status) && /1 ignorados/.test(status), `importou e ignorou o .txt (${status})`);

ok(dialogs[0] === 'prompt', 'sem pasta de origem (iPad), o app pergunta em qual pasta colocar');
ok((await page.evaluate(() => memoDb.listMeta())).every((m) => m.folder === 'Viagem' && m.rel.startsWith('Viagem/')), 'os arquivos entram na pasta digitada');
ok((await page.locator('#chips').innerText()).includes('Viagem'), 'a pasta aparece nos filtros do topo');

const thumbs = async () => (await page.evaluate(() => memoDb.listThumbIds())).length;
for (let i = 0; i < 60 && (await thumbs()) < 6; i++) await page.waitForTimeout(500);
ok((await thumbs()) >= 6, 'miniaturas geradas pela interface e guardadas');

const meta = await page.evaluate(() => memoDb.listMeta());
const vid = meta.find((m) => m.type === 'video');
const img = meta.find((m) => m.ext === 'png');
const r = await page.evaluate(async ({ vid, img }) => {
  const get = async (u, h) => { const x = await fetch(u, { headers: h }); return { s: x.status, t: x.headers.get('content-type'), cr: x.headers.get('content-range'), n: (await x.arrayBuffer()).byteLength }; };
  return {
    file: await get(`_memo/file/${img.id}`), thumb: await get(`_memo/thumb/${img.id}`),
    range: await get(`_memo/file/${vid.id}`, { Range: 'bytes=0-99' }), tail: await get(`_memo/file/${vid.id}`, { Range: 'bytes=-50' }),
    bad: await get(`_memo/file/${vid.id}`, { Range: 'bytes=9000-9999' }), none: await get('_memo/file/nao-existe'),
  };
}, { vid, img });
ok(r.file.s === 200 && r.file.t === 'image/png', 'serve a foto original');
ok(r.thumb.s === 200 && r.thumb.t === 'image/jpeg' && r.thumb.n !== r.file.n, 'serve a miniatura JPEG');
ok(r.range.s === 206 && r.range.n === 100 && /^bytes 0-99\/5000$/.test(r.range.cr), 'Range de vídeo responde 206');
ok(r.tail.s === 206 && r.tail.n === 50, 'Range "últimos N bytes"');
ok(r.bad.s === 416, 'Range fora do arquivo responde 416');
ok(r.none.s === 404, 'id inexistente responde 404');

await page.reload();
await page.waitForFunction(() => document.querySelectorAll('.tile').length >= 5, null, { timeout: 15000 });
ok(true, 'as fotos continuam depois de recarregar');

await ctx.setOffline(true);
await page.reload();
await page.waitForFunction(() => document.querySelectorAll('.tile').length >= 5, null, { timeout: 15000 });
const loaded = await page.evaluate(() => [...document.querySelectorAll('.tile img')].filter((i) => i.complete && i.naturalWidth > 0).length);
ok(loaded >= 5, `offline: o app abre e as imagens carregam (${loaded})`);
await ctx.setOffline(false);

await page.click('#menu');
ok(await page.locator('[data-act="import"]').isVisible() && !(await page.locator('[data-act="folder"]').isVisible()), 'menu mostra importar e esconde "Trocar pasta"');
// modo exposição: o menu some e só volta segurando o logo por 2 s
await page.click('[data-act="expo"]');
await page.waitForTimeout(200);
ok(!(await page.locator('#menu').isVisible()), 'modo exposição esconde o menu ⋯');
await page.reload();
await page.waitForFunction(() => document.querySelectorAll('.tile').length >= 5, null, { timeout: 15000 });
ok(!(await page.locator('#menu').isVisible()), 'o modo exposição continua depois de recarregar');
const logo = await page.locator('.brand').boundingBox();
await page.mouse.move(logo.x + 10, logo.y + 10);
await page.mouse.down();
await page.waitForTimeout(800);
ok(!(await page.locator('#menu').isVisible()), 'toque curto no logo não sai do modo exposição');
await page.waitForTimeout(1500);
await page.mouse.up();
ok(await page.locator('#menu').isVisible(), 'segurar o logo por 2 s volta o menu');

await page.click('#menu');
await page.click('[data-act="clear"]');
await page.waitForSelector('#empty:not([hidden])');
await page.waitForFunction(() => document.querySelectorAll('.tile').length === 0, null, { timeout: 5000 }).catch(() => {}); // as bolhas saem com uma animação
ok((await page.evaluate(() => memoDb.listMeta())).length === 0 && (await eachTile()) === 0, 'apagar tudo limpa o banco e a tela');

ok(errors.length === 0, `sem erros de JavaScript${errors.length ? ': ' + errors.join(' | ') : ''}`);
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
