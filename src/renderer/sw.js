// Service worker do PWA: (1) serve as fotos e vídeos guardados no IndexedDB em "_memo/file/<id>" e
// "_memo/thumb/<id>" (com suporte a Range, que o Safari exige para vídeo) e (2) deixa o app abrir sem internet.
importScripts('platform/web-db.js');

const CACHE = 'memo-shell-v4';
const SHELL = [
  './', 'index.html', 'style.css', 'app.js', 'bubbles.js', 'viewer.js', 'keyboard.js',
  'layouts/index.js', 'layouts/cloud.js', 'layouts/bubbles.js', 'layouts/folders.js', 'layouts/grid.js', 'layouts/pack.js',
  'platform/capacitor.js', 'platform/web.js', 'platform/web-db.js', 'platform/folder-name.js', 'platform/drop.js', 'platform/image-prep.js', 'dialog.js', 'manage.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

const MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  bmp: 'image/bmp', heic: 'image/heic', mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', ogv: 'video/ogg',
};

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const m = /\/_memo\/(file|thumb)\/([^/?#]+)$/.exec(url.pathname);
  if (m) event.respondWith(serveMedia(req, m[1], decodeURIComponent(m[2])));
  else event.respondWith(serveShell(req));
});

async function serveMedia(req, kind, id) {
  let blob = null;
  let ext = '';
  try {
    if (kind === 'thumb') blob = await memoDb.getBlob('thumbs', id);
    if (!blob) {
      blob = await memoDb.getBlob('blobs', id);
      ext = blob?.type ? '' : (await memoDb.listMeta()).find((x) => x.id === id)?.ext || '';
    }
  } catch { /* cai no 404 abaixo */ }
  if (!blob) return new Response('not found', { status: 404 });

  const type = blob.type || MIME[ext] || 'application/octet-stream';
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') || '');
  if (!range) return new Response(blob, { headers: { ...headers, 'Content-Length': String(blob.size) } });

  let start = range[1] ? Number(range[1]) : 0;
  let end = range[2] ? Number(range[2]) : blob.size - 1;
  if (!range[1] && range[2]) { start = Math.max(0, blob.size - Number(range[2])); end = blob.size - 1; } // "últimos N bytes"
  end = Math.min(end, blob.size - 1);
  if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${blob.size}` } });
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${blob.size}`, 'Content-Length': String(end - start + 1) },
  });
}

// arquivos do app: usa o cache e atualiza em segundo plano; sem internet, serve o que está no cache
async function serveShell(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req, { ignoreSearch: true });
  const fresh = fetch(req).then((res) => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  });
  if (hit) { fresh.catch(() => {}); return hit; }
  try { return await fresh; } catch {
    if (req.mode === 'navigate') return (await cache.match('index.html')) || Response.error();
    return Response.error();
  }
}
