// Ponte da versão web (PWA no Safari/Chrome): mesma API do preload.js do Electron.
// As fotos e vídeos são importados pelo seletor de arquivos e ficam no IndexedDB do navegador (web-db.js);
// o service worker (sw.js) os serve em "_memo/file/<id>" e "_memo/thumb/<id>".
import { hashSeed } from '../layouts/pack.js';

const db = globalThis.memoDb;

if (!window.memo && !window.Capacitor?.isNativePlatform?.() && db && 'serviceWorker' in navigator && window.isSecureContext) {
  // mesmas extensões do main.js
  const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'heic']);
  const VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv']);

  const versions = new Map(); // id -> mtime (muda a URL quando o arquivo é substituído)
  const thumbs = new Set();   // ids que já têm miniatura

  // 64 bits (duas sementes): com milhares de fotos, 32 bits colidiriam
  const idFor = (rel) => hashSeed(rel).toString(36) + hashSeed([...rel].reverse().join('')).toString(36);

  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  // O service worker precisa estar controlando a página para servir as fotos. Na primeira visita ele ainda
  // não controla: espera ficar pronto e recarrega uma vez.
  async function ready() {
    await navigator.serviceWorker.register('sw.js');
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      if (sessionStorage.getItem('memo-sw-reload')) throw new Error('o service worker não assumiu o controle da página');
      sessionStorage.setItem('memo-sw-reload', '1');
      location.reload();
      await new Promise(() => {}); // a página está recarregando
    }
    sessionStorage.removeItem('memo-sw-reload');
  }

  // tela sempre ligada (Wake Lock: iOS 16.4 ou mais novo); precisa ser pedida de novo ao voltar para o app
  let wake = null;
  async function keepAwake() {
    try { wake = await navigator.wakeLock?.request('screen'); } catch { /* sem suporte ou negado */ }
  }
  keepAwake();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) keepAwake(); });

  function pick({ directory }) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      if (directory) input.webkitdirectory = true;
      else input.accept = 'image/*,video/*';
      input.addEventListener('change', () => resolve([...input.files]), { once: true });
      input.addEventListener('cancel', () => resolve([]), { once: true });
      input.click(); // precisa rodar dentro do toque do usuário
    });
  }

  const startup = ready();

  window.memo = {
    noFullscreen: standalone || !document.documentElement.requestFullscreen,
    hint: 'Toque em Importar para escolher fotos e vídeos do iPad. Ficam guardados no app e funcionam sem internet.',

    async loadLibrary() {
      await startup;
      const metas = await db.listMeta();
      versions.clear();
      for (const m of metas) versions.set(m.id, m.mtime);
      thumbs.clear();
      for (const id of await db.listThumbIds()) thumbs.add(id);
      const items = metas.map(({ id, type, name, ext, rel, folder, mtime }) => ({ id, type, name, ext, rel, folder, mtime }));
      return { folder: 'Memo', items, hint: this.hint };
    },

    fileUrl: (id) => `_memo/file/${encodeURIComponent(id)}?v=${versions.get(id) ?? 0}`,
    thumbUrl(id) {
      const kind = thumbs.has(id) ? 'thumb' : 'file';
      return `_memo/${kind}/${encodeURIComponent(id)}?v=${versions.get(id) ?? 0}`;
    },
    async saveThumb(id, data) {
      if (!versions.has(id) || !data?.length) return false;
      const ok = await db.putThumb(id, new Blob([data], { type: 'image/jpeg' }));
      if (ok) thumbs.add(id);
      return ok;
    },

    /**
     * Abre o seletor de arquivos (ou de pasta) e guarda o que for foto ou vídeo.
     * Devolve { added, skipped, failed: [{ name, error }] }, ou null se nada foi escolhido.
     */
    async importFiles({ directory = false, onProgress } = {}) {
      const files = await pick({ directory });
      if (!files.length) return null;
      await startup;
      navigator.storage?.persist?.().catch(() => {}); // pede para o navegador não apagar as fotos

      const result = { added: 0, skipped: 0, failed: [] };
      let n = 0;
      for (const file of files) {
        onProgress?.({ done: n++, total: files.length });
        const rel = (file.webkitRelativePath || file.name).split('/').filter(Boolean).join('/');
        const dot = file.name.lastIndexOf('.');
        const ext = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : '';
        const type = IMAGE_EXT.has(ext) ? 'image' : VIDEO_EXT.has(ext) ? 'video' : null;
        if (!type) { result.skipped++; continue; }
        try {
          await db.putFile({
            id: idFor(rel), rel, name: file.name.slice(0, dot), ext, type,
            folder: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '',
            mtime: file.lastModified || Date.now(), size: file.size,
          }, file);
          result.added++;
        } catch (err) {
          result.failed.push({ name: file.name, error: String(err?.name === 'QuotaExceededError' ? 'sem espaço no iPad' : err?.message || err) });
          if (err?.name === 'QuotaExceededError') break;
        }
      }
      onProgress?.({ done: files.length, total: files.length });
      return result;
    },

    async clearAll() {
      await db.clearAll();
    },
  };
}
