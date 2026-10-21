const PART = '.part';

export class SyncError extends Error {}

// nome seguro para gravar no disco: sem separadores, sem ponto inicial, sem controle
export function safeName(name) {
  const clean = String(name).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '').trim().slice(0, 120);
  return clean || 'arquivo';
}

// nomes repetidos ganham "-2", "-3"... antes da extensão
function uniqueNames(entries) {
  const seen = new Set();
  return entries.map((e) => {
    let name = safeName(e.name);
    const dot = name.lastIndexOf('.');
    const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
    for (let n = 2; seen.has(name.toLowerCase()); n++) name = `${stem}-${n}${ext}`;
    seen.add(name.toLowerCase());
    return { ...e, name };
  });
}

/**
 * Deixa a pasta (`store`) com o que a fonte remota (`source`) lista.
 *
 *  - source.list() -> [{ name, url, size? }]
 *  - store: list() -> Map(nome -> tamanho), download(url, nome), rename(de, para), remove(nome)
 *
 * Só baixa o que falta (ou mudou de tamanho). Erro ao listar não mexe em nada; erro num arquivo não
 * para os outros. Com `mirror`, apaga o que saiu da fonte, mas nunca quando a fonte vem vazia
 * (um álbum que "sumiu" não pode esvaziar o tablet).
 */
export async function syncFolder({ source, store, mirror = false, concurrency = 3, onProgress }) {
  let remote;
  try { remote = uniqueNames(await source.list()); } catch (err) { throw new SyncError(`não consegui ler a fonte: ${err?.message || err}`); }
  const local = await store.list();

  for (const name of local.keys()) if (name.endsWith(PART)) await store.remove(name).catch(() => {});

  const todo = remote.filter((r) => !local.has(r.name) || (r.size != null && local.get(r.name) !== r.size));
  const result = { total: remote.length, added: 0, removed: 0, failed: [] };
  let done = 0;

  const queue = [...todo];
  const worker = async () => {
    for (let r = queue.shift(); r; r = queue.shift()) {
      try {
        await store.download(r.url, r.name + PART);
        await store.rename(r.name + PART, r.name);
        result.added++;
      } catch (err) {
        await store.remove(r.name + PART).catch(() => {});
        result.failed.push({ name: r.name, error: String(err?.message || err) });
      }
      onProgress?.({ done: ++done, of: todo.length });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, todo.length)) }, worker));

  if (mirror && remote.length) {
    const keep = new Set(remote.map((r) => r.name));
    for (const name of local.keys()) {
      if (name.endsWith(PART) || keep.has(name)) continue;
      try { await store.remove(name); result.removed++; } catch (err) { result.failed.push({ name, error: String(err?.message || err) }); }
    }
  }
  return result;
}
