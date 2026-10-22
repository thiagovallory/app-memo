// Armazenamento da versão web (PWA) em IndexedDB. É um script clássico (não módulo) porque o
// service worker o carrega com importScripts e a página com <script>: os dois usam o mesmo código.
//
//   meta   : id -> { id, rel, name, ext, type, mime, folder, mtime, size }   (leve: lista a biblioteca)
//   blobs  : id -> Blob (o arquivo original)
//   thumbs : id -> Blob (miniatura JPEG gerada pela interface)
(function (root) {
  const NAME = 'memo';
  let dbPromise = null;

  const wrap = (req) => new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const done = (tx) => new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('transação cancelada'));
  });

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          db.createObjectStore('meta', { keyPath: 'id' });
          db.createObjectStore('blobs');
          db.createObjectStore('thumbs');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }).catch((err) => { dbPromise = null; throw err; });
    }
    return dbPromise;
  }

  async function putFile(meta, blob) {
    const db = await open();
    const tx = db.transaction(['meta', 'blobs', 'thumbs'], 'readwrite');
    tx.objectStore('meta').put(meta);
    tx.objectStore('blobs').put(blob, meta.id);
    tx.objectStore('thumbs').delete(meta.id); // arquivo novo: a miniatura antiga não vale mais
    await done(tx);
  }

  async function listMeta() {
    const db = await open();
    return wrap(db.transaction('meta').objectStore('meta').getAll());
  }

  async function listThumbIds() {
    const db = await open();
    return wrap(db.transaction('thumbs').objectStore('thumbs').getAllKeys());
  }

  async function getBlob(store, id) {
    const db = await open();
    return wrap(db.transaction(store).objectStore(store).get(id));
  }

  async function putThumb(id, blob) {
    const db = await open();
    const tx = db.transaction(['meta', 'thumbs'], 'readwrite');
    const meta = await wrap(tx.objectStore('meta').get(id));
    if (meta) tx.objectStore('thumbs').put(blob, id); // não guarda miniatura de arquivo que sumiu
    await done(tx);
    return !!meta;
  }

  async function clearAll() {
    const db = await open();
    const tx = db.transaction(['meta', 'blobs', 'thumbs'], 'readwrite');
    for (const s of ['meta', 'blobs', 'thumbs']) tx.objectStore(s).clear();
    await done(tx);
  }

  root.memoDb = { open, putFile, listMeta, listThumbIds, getBlob, putThumb, clearAll };
})(typeof self !== 'undefined' ? self : globalThis);
