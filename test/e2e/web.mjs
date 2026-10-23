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
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true });
const page = await ctx.newPage();
await page.addInitScript(() => { try { localStorage.setItem('fx', 'full'); } catch {} }); // sem a medição automática de efeitos
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

let failed = 0;
const ok = (cond, msg) => { console.log(cond ? 'ok  ' : 'FAIL', msg); if (!cond) failed++; };
// diálogo do app: texto = preenche e confirma; true = confirma; false = cancela
const dlg = async (answer = true) => {
  await page.waitForSelector('.dlg');
  if (typeof answer === 'string') await page.fill('.dlg input', answer);
  await page.click(answer === false ? '.dlg .ghost' : '.dlg .pill:not(.ghost)');
  await page.waitForSelector('.dlg', { state: 'detached' });
};
const statusText = () => page.locator('#status').innerText();
const waitStatus = (re) => page.waitForFunction((src) => new RegExp(src).test(document.getElementById('status').textContent), re.source, { timeout: 15000 });
const menu = async (act) => { await page.click('#menu'); await page.click(`[data-act="${act}"]`); };
// importa pelo menu e responde a pergunta de pasta
const importVia = async (list, folder) => {
  await page.click('#menu');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-act="import"]')]);
  await chooser.setFiles(list);
  await dlg(folder);
};
const metas = () => page.evaluate(() => memoDb.listMeta());
// espera até a condição (assíncrona, avaliada aqui no Node) ficar verdadeira
const until = async (fn, ms = 8000) => { for (const t = Date.now(); Date.now() - t < ms;) { if (await fn()) return true; await page.waitForTimeout(100); } return false; };
const eachTile = () => page.evaluate(() => document.querySelectorAll('.tile').length);

await page.goto(url);
await page.waitForSelector('#empty:not([hidden])', { timeout: 15000 });
ok((await page.locator('#empty h2').innerText()) === 'Nenhuma foto ainda', 'primeira visita mostra o convite para importar');
ok(await page.evaluate(() => !!navigator.serviceWorker.controller), 'o service worker controla a página');

const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#reset')]);
await chooser.setFiles(files);
await dlg('Viagem');
await page.waitForFunction(() => document.querySelectorAll('.tile').length >= 5, null, { timeout: 20000 });
const status = await page.locator('#status').innerText();
ok(/\d+ memórias/.test(status) && /1 ignorados/.test(status), `importou e ignorou o .txt (${status})`);

ok(true, 'sem pasta de origem (iPad), o app pergunta em qual pasta colocar (diálogo próprio)');
ok((await page.evaluate(() => memoDb.listMeta())).every((m) => m.folder === 'Viagem' && m.rel.startsWith('Viagem/')), 'os arquivos entram na pasta digitada');
ok((await page.locator('#chips').innerText()).includes('Viagem'), 'a pasta aparece nos filtros do topo');

// importar de novo: os mesmos arquivos são reconhecidos como repetidos, e arquivos novos entram
const before = (await metas()).length;
await importVia(files.slice(0, 3), 'Viagem');
await waitStatus(/já estavam/);
ok((await metas()).length === before, `importar os mesmos arquivos não duplica (${(await statusText()).split('·').slice(1).join('·').trim()})`);

const novas = [{ name: 'natal1.png', mimeType: 'image/png', buffer: png(900, 900, [250, 20, 20]) }, { name: 'natal2.png', mimeType: 'image/png', buffer: png(900, 900, [20, 250, 20]) }];
await importVia(novas, 'Natal');
await waitStatus(/2 novas/);
ok((await metas()).length === before + 2, 'uma segunda importação acrescenta fotos');
ok((await page.locator('#chips').innerText()).includes('Natal'), 'a nova pasta aparece nos filtros');

await importVia([{ name: 'foto0.png', mimeType: 'image/png', buffer: png(901, 901, [1, 2, 3]) }], 'Viagem');
await waitStatus(/1 nova/);
ok((await metas()).some((m) => m.rel === 'Viagem/foto0 (2).png'), 'mesmo nome com conteúdo diferente entra como "foto0 (2)", sem sobrescrever');

// cancelar a pergunta de pasta não importa nada
const n0 = (await metas()).length;
await page.click('#menu');
const [c2] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-act="import"]')]);
await c2.setFiles([{ name: 'cancelada.png', mimeType: 'image/png', buffer: png(900, 900, [9, 9, 9]) }]);
await dlg(false);
ok((await metas()).length === n0, 'cancelar a pergunta de pasta não importa');

// arrastar para a janela
await page.evaluate(() => {
  const dt = new DataTransfer();
  dt.items.add(new File([new Uint8Array(2000).fill(5)], 'arrastada.png', { type: 'image/png' }));
  document.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
});
await dlg('Arrastadas');
ok(await until(async () => (await metas()).some((m) => m.rel === 'Arrastadas/arrastada.png')), 'arrastar arquivos para a janela importa');

// foto grande: é reduzida na importação (maior lado 2560 px), com miniatura pronta e o tamanho original guardado
const grande = png(3200, 2400, [40, 90, 200]);
await importVia([{ name: 'grande.png', mimeType: 'image/png', buffer: grande }], 'Grandes');
ok(await until(async () => (await metas()).some((m) => m.rel === 'Grandes/grande.png')), 'importa foto grande');
const gm = (await metas()).find((m) => m.rel === 'Grandes/grande.png');
const dims = await page.evaluate(async (id) => { const b = await memoDb.getBlob('blobs', id); const bmp = await createImageBitmap(b); return { w: bmp.width, h: bmp.height, type: b.type }; }, gm.id);
ok(dims.type === 'image/jpeg' && Math.max(dims.w, dims.h) === 2560, `foto de 3200 px é guardada com 2560 px em JPEG (${dims.w}x${dims.h})`);
ok(gm.origSize === grande.length && gm.opt === 1, 'guarda o tamanho original para reconhecer repetidos');
ok((await page.evaluate(() => memoDb.listThumbIds())).includes(gm.id), 'a miniatura já nasce na importação');
await importVia([{ name: 'grande.png', mimeType: 'image/png', buffer: grande }], 'Grandes');
await waitStatus(/já estava/);
ok((await metas()).filter((m) => m.rel.startsWith('Grandes/')).length === 1, 'importar a mesma foto grande de novo é reconhecido como repetida');

// otimizar o que entrou sem otimização (ex.: versões antigas do app): grava direto no banco, sem passar pela importação
await page.evaluate(async (bytes) => {
  const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' });
  await memoDb.putFile({ id: 'antiga1', rel: 'Antigas/velha.png', name: 'velha', ext: 'png', type: 'image', folder: 'Antigas', mtime: 1, size: blob.size }, blob);
}, [...png(3000, 2000, [200, 100, 50])]);
await page.click('#menu');
await page.click('[data-act="reload"]');
ok(await until(async () => (await page.evaluate(() => window.memo.manage ? true : false))), 'API de organizar disponível');

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
// efeitos reduzidos (iPads antigos): liga e desliga pelo menu e persiste
await page.click('[data-act="fx"]');
ok(await page.evaluate(() => document.body.classList.contains('lite') && localStorage.getItem('fx') === 'lite'), 'menu liga os efeitos reduzidos');
await page.click('#menu');
ok((await page.locator('[data-act="fx"]').innerText()).includes('reduzidos'), 'o item do menu mostra o estado atual');
await page.click('[data-act="fx"]');
ok(await page.evaluate(() => !document.body.classList.contains('lite') && localStorage.getItem('fx') === 'full'), 'menu volta aos efeitos completos');

// visualizador: o toque/clique não faz os botões "aparecerem e sumirem"
await page.click('#layouts button[data-id="grid"]');
await page.waitForTimeout(1200);
await page.locator('.tile').first().click();
await page.waitForSelector('#viewer:not([hidden])');
await page.waitForTimeout(500);
const idle = () => page.evaluate(() => document.getElementById('viewer').classList.contains('idle'));
ok(!(await idle()), 'visualizador abre com os botões visíveis');
await page.waitForFunction(() => document.getElementById('viewer').classList.contains('idle'), null, { timeout: 8000 });
await page.mouse.move(640, 400);
await page.mouse.down(); await page.mouse.up();
await page.waitForTimeout(250);
const afterClick = await idle();
await page.waitForTimeout(900);
ok(!afterClick && !(await idle()), 'clique com o mouse na foto mostra os botões e eles não somem logo em seguida');
// toque (iPad): mostra quando escondidos e esconde quando visíveis, sem piscar
await page.touchscreen.tap(640, 400);
await page.waitForTimeout(250);
const t1 = await idle();
await page.waitForTimeout(700);
ok(t1 === true && (await idle()) === true, 'toque na foto com os botões visíveis os esconde (e eles não voltam sozinhos)');
await page.touchscreen.tap(640, 400);
await page.waitForTimeout(250);
const t2 = await idle();
await page.waitForTimeout(700);
ok(t2 === false && (await idle()) === false, 'toque na foto com os botões escondidos os mostra (e eles ficam)');
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

// modo exposição: o menu some e só volta segurando o logo por 2 s
await page.click('#menu');
await page.click('[data-act="expo"]');
await dlg(true);
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

// organizar: pastas e fotos
await menu('manage');
await page.waitForSelector('#manage:not([hidden])');
ok((await page.locator('#manage .m-row').count()) === 5, 'Organizar lista as pastas (Viagem, Natal, Arrastadas, Grandes, Antigas)');
const rowOf = (name) => page.locator('#manage .m-row', { has: page.locator('b', { hasText: new RegExp(`^${name}$`) }) });
await rowOf('Natal').getByText('Renomear').click();
await dlg('Festas/Natal');
ok(await until(async () => (await metas()).filter((m) => m.folder === 'Festas/Natal').length === 2), 'renomear pasta move as fotos (subpasta Festas/Natal)');
const thumbsAfter = await page.evaluate(async () => { const m = (await memoDb.listMeta()).find((x) => x.folder === 'Festas/Natal'); return !!(await memoDb.getBlob('blobs', m.id)); });
ok(thumbsAfter, 'o arquivo continua acessível depois de mudar de pasta');

ok(await page.locator('#manage .m-store').isVisible(), 'Organizar mostra o armazenamento');
const otim = page.locator('#manage .m-store .pill');
ok(await otim.count() === 1 && /Otimizar 1 foto/.test(await otim.innerText()), 'oferece otimizar as fotos que ainda não foram');
await otim.click();
await dlg(true);   // confirma
await page.waitForSelector('.dlg');
ok((await page.locator('.dlg-card h3').innerText()) === 'Pronto', 'otimizar termina com um resumo');
await dlg(true);
const velha = (await metas()).find((m) => m.rel === 'Antigas/velha.png');
ok(velha.opt === 1 && velha.origSize > 0 && (await page.evaluate(() => memoDb.listThumbIds())).includes('antiga1'), 'otimizar marca a foto, guarda o tamanho original e cria a miniatura');
ok((await page.locator('#manage .m-store .pill').count()) === 0, 'depois de otimizar, o botão some');

await page.click('#manage .seg button[data-tab="photos"]');
await page.selectOption('#manage select', 'Festas/Natal');
await page.locator('#manage .m-cell').first().click();
await page.locator('#manage .m-cell').nth(1).click();
ok((await page.locator('#manage .m-count').innerText()).startsWith('2'), 'selecionar fotos mostra a contagem');
await page.click('#manage [data-do="move"]');
await dlg('Viagem');
ok(await until(async () => (await metas()).filter((m) => m.rel.startsWith('Viagem/natal')).length === 2), 'mover fotos selecionadas para outra pasta');

await page.selectOption('#manage select', 'Arrastadas');
await page.locator('#manage .m-cell').first().click();
await page.click('#manage [data-do="delete"]');
await dlg(false);
ok((await metas()).some((m) => m.folder === 'Arrastadas'), 'cancelar a exclusão não apaga');
await page.click('#manage [data-do="delete"]');
await dlg(true);
ok(await until(async () => (await metas()).every((m) => m.folder !== 'Arrastadas')), 'excluir fotos selecionadas');

await page.click('#manage .seg button[data-tab="folders"]');
const nViagem = (await metas()).filter((m) => m.folder === 'Viagem' || m.folder.startsWith('Viagem/')).length;
await rowOf('Viagem').getByText('Excluir').click();
await dlg(true);
ok(nViagem > 0 && (await until(async () => (await metas()).every((m) => !m.folder.startsWith('Viagem')))), `excluir pasta apaga o que há nela (${nViagem} itens)`);
await page.click('#manage .m-close');
ok(await page.locator('#manage').isHidden(), 'fechar a tela Organizar');

await page.click('#menu');
await page.click('[data-act="clear"]');
await dlg(true);
await page.waitForSelector('#empty:not([hidden])');
await page.waitForFunction(() => document.querySelectorAll('.tile').length === 0, null, { timeout: 5000 }).catch(() => {}); // as bolhas saem com uma animação
ok((await page.evaluate(() => memoDb.listMeta())).length === 0 && (await eachTile()) === 0, 'apagar tudo limpa o banco e a tela');

ok(errors.length === 0, `sem erros de JavaScript${errors.length ? ': ' + errors.join(' | ') : ''}`);
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
