// Ponte da versão web (PWA no Safari/Chrome): mesma API do preload.js do Electron.
// As fotos e vídeos são importados pelo seletor de arquivos (ou arrastados para a janela) e ficam no
// IndexedDB do navegador (web-db.js); o service worker (sw.js) os serve em "_memo/file/<id>" e "_memo/thumb/<id>".
import { hashSeed } from '../layouts/pack.js';
import { cleanFolder } from './folder-name.js';
import { collectDropped } from './drop.js';
import { prepareImage, keepsOriginal } from './image-prep.js';

const db = globalThis.memoDb;

if (!window.memo && !window.Capacitor?.isNativePlatform?.() && db && 'serviceWorker' in navigator && window.isSecureContext) {
  // mesmas extensões do main.js
  const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'heic']);
  const VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv']);

  const versions = new Map(); // id -> mtime (muda a URL quando o arquivo é substituído)
  const thumbs = new Set();   // ids que já têm miniatura

  // 64 bits (duas sementes): com milhares de fotos, 32 bits colidiriam
  const idFor = (rel) => hashSeed(rel).toString(36) + hashSeed([...rel].reverse().join('')).toString(36);
  // o id nasce do caminho na importação e fica fixo ao mover; se já estiver em uso, tenta variações
  const uniqueId = (rel, used) => {
    let id = idFor(rel);
    for (let n = 2; used.has(id); n++) id = idFor(`${rel}#${n}`);
    used.add(id);
    return id;
  };
  const splitName = (rel) => {
    const base = rel.slice(rel.lastIndexOf('/') + 1);
    const dot = base.lastIndexOf('.');
    return dot > 0 ? { stem: base.slice(0, dot), ext: base.slice(dot + 1).toLowerCase() } : { stem: base, ext: '' };
  };

  // "foto.jpg" -> "foto (2).jpg" -> "foto (3).jpg" até não existir (sem diferenciar maiúsculas)
  function uniqueRel(rel, taken) {
    if (!taken.has(rel.toLowerCase())) return rel;
    const cut = rel.lastIndexOf('.') > rel.lastIndexOf('/') + 1 ? rel.lastIndexOf('.') : rel.length;
    for (let n = 2; ; n++) {
      const next = `${rel.slice(0, cut)} (${n})${rel.slice(cut)}`;
      if (!taken.has(next.toLowerCase())) return next;
    }
  }

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
  async function keepAwake() {
    try { await navigator.wakeLock?.request('screen'); } catch { /* sem suporte ou negado */ }
  }
  keepAwake();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) keepAwake(); });

  // Os <input type=file> ficam no documento (o iOS pode descartar um input solto antes do "change") e o valor
  // é zerado a cada uso: sem isso, escolher os mesmos arquivos de novo não dispara "change".
  const inputs = {};
  let pending = null;
  function inputFor(directory) {
    const key = directory ? 'dir' : 'files';
    if (!inputs[key]) {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.hidden = true;
      if (directory) input.webkitdirectory = true;
      else input.accept = 'image/*,video/*';
      input.addEventListener('change', () => pending?.(input.files ? [...input.files] : []));
      input.addEventListener('cancel', () => pending?.([]));
      document.body.append(input);
      inputs[key] = input;
    }
    return inputs[key];
  }
  function pick({ directory }) {
    pending?.([]); // um seletor anterior que nunca respondeu (o iOS nem sempre avisa o cancelamento)
    return new Promise((resolve) => {
      const input = inputFor(directory);
      pending = (files) => { pending = null; resolve(files.map((file) => ({ file, rel: file.webkitRelativePath || file.name }))); };
      input.value = '';
      input.click(); // precisa rodar dentro do toque do usuário
    });
  }

  const startup = ready();

  // arrastar fotos e pastas para a janela (computador): avisa a interface, que cuida do resto
  document.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
  document.addEventListener('drop', async (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    const entries = await collectDropped(e.dataTransfer);
    if (entries.length) document.dispatchEvent(new CustomEvent('memo:drop', { detail: entries }));
  });

  // muda arquivos de pasta (ou de nome, se já existir um igual lá): só atualiza os dados, sem copiar as fotos
  async function relocate(items, folderFor) {
    const all = await db.listMeta();
    const leaving = new Set(items.map((m) => m.id));
    const taken = new Set(all.filter((m) => !leaving.has(m.id)).map((m) => m.rel.toLowerCase()));
    const changed = [];
    for (const m of items) {
      const folder = cleanFolder(folderFor(m));
      const base = m.rel.slice(m.rel.lastIndexOf('/') + 1);
      const rel = uniqueRel(folder ? `${folder}/${base}` : base, taken);
      taken.add(rel.toLowerCase());
      if (rel === m.rel) continue;
      changed.push({ ...m, rel, folder: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '' });
    }
    if (changed.length) await db.updateMeta(changed);
    return changed.length;
  }
  const inFolder = (m, folder) => m.folder === folder || m.folder.startsWith(folder + '/');

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
      const items = metas.map(({ id, type, name, ext, rel, folder, mtime, size, opt }) => ({ id, type, name, ext, rel, folder, mtime, size, opt }));
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
     * Guarda fotos e vídeos. Os arquivos vêm do seletor (ou de `entries`, [{ file, rel }], quando foram
     * arrastados para a janela). Quando não trazem pasta (iPad), `askFolder(quantidade)` pergunta em qual pasta
     * colocá-los (texto vazio = "Soltas"; null cancela).
     *
     * Um arquivo com o mesmo nome e tamanho de um que já está na pasta é tratado como repetido e ignorado;
     * com o mesmo nome mas conteúdo diferente, entra como "nome (2)". Nada é sobrescrito sem aviso.
     * Devolve { added, duplicates, skipped, failed: [{ name, error }] }, ou null se nada foi escolhido.
     */
    async importFiles({ directory = false, entries = null, onProgress, askFolder } = {}) {
      const picked = entries || (await pick({ directory }));
      if (!picked.length) return null;
      let prefix = '';
      if (askFolder && !picked.some((e) => e.rel.includes('/'))) {
        const answer = await askFolder(picked.length);
        if (answer === null || answer === undefined) return null;
        prefix = cleanFolder(answer);
      }
      await startup;
      navigator.storage?.persist?.().catch(() => {}); // pede para o navegador não apagar as fotos

      const existing = await db.listMeta();
      const taken = new Set(existing.map((m) => m.rel.toLowerCase()));
      const usedIds = new Set(existing.map((m) => m.id));
      const sizes = new Map(existing.map((m) => [m.rel.toLowerCase(), m.origSize ?? m.size])); // tamanho do arquivo original

      const result = { added: 0, duplicates: 0, skipped: 0, failed: [] };
      let n = 0;
      let streak = 0; // falhas seguidas: com o armazenamento cheio, para em vez de tentar o resto
      for (const { file, rel: given } of picked) {
        onProgress?.({ done: n++, total: picked.length });
        const { stem, ext } = splitName(file.name);
        const type = IMAGE_EXT.has(ext) ? 'image' : VIDEO_EXT.has(ext) ? 'video' : null;
        if (!type) { result.skipped++; continue; }

        let rel = (prefix && !given.includes('/') ? `${prefix}/${given}` : given).split('/').filter(Boolean).join('/');
        if (sizes.get(rel.toLowerCase()) === file.size) { result.duplicates++; continue; }
        rel = uniqueRel(rel, taken);
        try {
          // fotos: reduz o que for grande e já gera a miniatura (um único decode); se o navegador não abrir, guarda como veio
          let blob = file;
          let thumb = null;
          let opt = 0; // 1 = otimizada; 2 = o navegador não abriu a imagem (fica como veio e não é oferecida de novo)
          if (type === 'image') {
            try { ({ blob, thumb } = await prepareImage(file, ext)); opt = 1; } catch { opt = 2; }
          }
          await db.putFile({
            id: uniqueId(rel, usedIds), rel, name: rel.slice(rel.lastIndexOf('/') + 1).replace(/\.[^.]*$/, '') || stem, ext, type,
            folder: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '',
            mtime: file.lastModified || Date.now(), size: blob.size, origSize: file.size, opt,
          }, blob, thumb);
          taken.add(rel.toLowerCase());
          sizes.set(rel.toLowerCase(), file.size);
          result.added++;
          streak = 0;
        } catch (err) {
          const quota = err?.name === 'QuotaExceededError' || /quota|space|espaço/i.test(String(err?.message));
          result.failed.push({ name: file.name, error: quota ? 'sem espaço no armazenamento do navegador' : String(err?.message || err), quota });
          if (quota || ++streak >= 3) break;
        }
      }
      onProgress?.({ done: picked.length, total: picked.length });
      return result;
    },

    // organizar o que foi importado (só existe aqui: nas outras versões os arquivos são os seus originais)
    manage: {
      // reduz as fotos que entraram antes (ou sem otimizar) e gera as miniaturas que faltam
      async optimize({ onProgress } = {}) {
        await startup;
        const todo = (await db.listMeta()).filter((m) => m.type === 'image' && !m.opt && !keepsOriginal(m.ext));
        const result = { done: 0, failed: 0, saved: 0, total: todo.length };
        let n = 0;
        for (const m of todo) {
          onProgress?.({ done: n++, total: todo.length });
          try {
            const original = await db.getBlob('blobs', m.id);
            const { blob, thumb } = await prepareImage(original, m.ext);
            await db.putFile({ ...m, opt: 1, origSize: m.origSize ?? m.size, size: blob.size }, blob, thumb);
            result.saved += Math.max(0, m.size - blob.size);
            result.done++;
          } catch {
            result.failed++;
            await db.putFile({ ...m, opt: 2 }, await db.getBlob('blobs', m.id), null).catch(() => {});
          }
        }
        onProgress?.({ done: todo.length, total: todo.length });
        return result;
      },
      // espaço usado e disponível, quando o navegador informa (Safari 17 ou mais novo)
      async storage() {
        try {
          const { usage, quota } = await navigator.storage.estimate();
          return usage && quota ? { usage, quota } : null;
        } catch { return null; }
      },
      async moveItems(ids, folder) {
        const want = new Set(ids);
        const items = (await db.listMeta()).filter((m) => want.has(m.id));
        return relocate(items, () => folder);
      },
      async renameFolder(from, to) {
        const items = (await db.listMeta()).filter((m) => inFolder(m, from));
        return relocate(items, (m) => (to ? to + m.folder.slice(from.length) : m.folder.slice(from.length + 1)));
      },
      async deleteItems(ids) {
        await db.deleteFiles(ids);
        return ids.length;
      },
      async deleteFolder(folder) {
        const ids = (await db.listMeta()).filter((m) => inFolder(m, folder)).map((m) => m.id);
        await db.deleteFiles(ids);
        return ids.length;
      },
    },

    async clearAll() {
      await db.clearAll();
    },
  };
}
