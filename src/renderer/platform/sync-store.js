// Pasta de destino da sincronização (Capacitor): lista, baixa, renomeia e apaga arquivos em `dir`.
// Os downloads vão para "<nome>.part" e só viram "<nome>" quando terminam, então uma queda de
// rede nunca deixa uma foto pela metade na galeria.
export function createSyncStore(fs, directory, dir) {
  const at = (name) => `${dir}/${name}`;
  return {
    async list() {
      const out = new Map();
      try {
        for (const f of (await fs.readdir({ path: dir, directory })).files) if (f.type === 'file') out.set(f.name, f.size);
      } catch { /* pasta ainda não existe */ }
      return out;
    },
    async download(url, name) {
      await fs.downloadFile({ url, path: at(name), directory, recursive: true });
    },
    async rename(from, to) {
      try { await fs.deleteFile({ path: at(to), directory }); } catch { /* não existia */ }
      await fs.rename({ from: at(from), to: at(to), directory, toDirectory: directory });
    },
    async remove(name) {
      await fs.deleteFile({ path: at(name), directory });
    },
  };
}
