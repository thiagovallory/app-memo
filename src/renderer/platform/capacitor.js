// Ponte do app no iPad (Capacitor): oferece a mesma API que o preload.js oferece no Electron.
// As fotos ficam em Documents/ (visível no app Arquivos do iPad) e as miniaturas em Cache/.
import { hashSeed } from '../layouts/pack.js';
import { createSyncStore } from './sync-store.js';

const cap = window.Capacitor;

if (cap?.isNativePlatform?.() && !window.memo) {
  const fs = cap.Plugins.Filesystem;
  const DOCS = 'DOCUMENTS';
  const CACHE = 'CACHE';
  const THUMBS = 'memo-thumbs';

  // mesmas extensões do main.js
  const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'heic']);
  const VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv']);

  const files = new Map();   // id -> { uri, mtime, size }
  const thumbs = new Set();  // nomes dos arquivos de miniatura já gerados
  let thumbsUri = '';

  // 64 bits (duas sementes): com milhares de fotos, 32 bits colidiriam
  const idFor = (rel) => hashSeed(rel).toString(36) + hashSeed([...rel].reverse().join('')).toString(36);
  const thumbName = (id, f) => `${id}-${f.size}-${Math.round(f.mtime)}.jpg`;
  const src = (uri) => cap.convertFileSrc(uri);

  async function walk(dir, items) {
    let res;
    try { res = await fs.readdir({ path: dir, directory: DOCS }); } catch { return; }
    for (const e of res.files) {
      if (e.name.startsWith('.')) continue;
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.type === 'directory') { await walk(rel, items); continue; }
      const dot = e.name.lastIndexOf('.');
      const ext = dot > 0 ? e.name.slice(dot + 1).toLowerCase() : '';
      const type = IMAGE_EXT.has(ext) ? 'image' : VIDEO_EXT.has(ext) ? 'video' : null;
      if (!type) continue;
      const id = idFor(rel);
      files.set(id, { uri: e.uri, mtime: e.mtime || 0, size: e.size || 0 });
      items.push({
        id, type, name: e.name.slice(0, dot), ext, rel,
        folder: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '', mtime: e.mtime || 0,
      });
    }
  }

  async function loadThumbs() {
    thumbs.clear();
    try { await fs.mkdir({ path: THUMBS, directory: CACHE, recursive: true }); } catch { /* já existe */ }
    thumbsUri = (await fs.getUri({ path: THUMBS, directory: CACHE })).uri;
    try { for (const t of (await fs.readdir({ path: THUMBS, directory: CACHE })).files) thumbs.add(t.name); } catch { /* vazio */ }
  }

  // remove do cache as miniaturas de fotos que não existem mais
  async function pruneThumbs() {
    const keep = new Set([...files].map(([id, f]) => thumbName(id, f)));
    for (const name of [...thumbs]) {
      if (keep.has(name)) continue;
      thumbs.delete(name);
      try { await fs.deleteFile({ path: `${THUMBS}/${name}`, directory: CACHE }); } catch { /* ignore */ }
    }
  }

  const toBase64 = (bytes) => {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };

  const keepAwake = () => {
    cap.Plugins.KeepAwake?.keepAwake?.().catch?.(() => {});
    cap.Plugins.StatusBar?.hide?.().catch?.(() => {});
  };
  keepAwake();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) keepAwake(); });

  window.memo = {
    // no iPad não há seletor de pasta, tela cheia nem "sair": a interface esconde esses controles
    noFullscreen: true,
    reloadOnShow: true, // fotos copiadas pelo app Arquivos aparecem ao voltar para o app
    hint: 'Abra o app Arquivos, entre em "No iPad › Memo" e copie suas fotos e vídeos para lá (subpastas viram categorias).',

    async loadLibrary() {
      files.clear();
      const items = [];
      await walk('', items);
      await loadThumbs();
      pruneThumbs().catch(() => {});
      return { folder: 'Memo', items, hint: this.hint };
    },
    fileUrl: (id) => src(files.get(id)?.uri ?? ''),
    thumbUrl(id) {
      const f = files.get(id);
      if (!f) return '';
      const name = thumbName(id, f);
      return thumbs.has(name) ? src(`${thumbsUri}/${name}`) : src(f.uri);
    },
    async saveThumb(id, data) {
      const f = files.get(id);
      if (!f || !data?.length) return false;
      const name = thumbName(id, f);
      await fs.writeFile({ path: `${THUMBS}/${name}`, directory: CACHE, data: toBase64(data), recursive: true });
      thumbs.add(name);
      return true;
    },
    onFullscreen() {},
    syncStore: (dir) => createSyncStore(fs, DOCS, dir),
  };
}
