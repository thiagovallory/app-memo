// Reúne o que foi arrastado para a janela (arquivos soltos e pastas, em qualquer profundidade)
// como [{ file, rel }], onde `rel` é o caminho relativo ("Viagem/Praia/foto.jpg").
// Os itens do DataTransfer só valem enquanto o evento roda: por isso são lidos antes do primeiro await.
export async function collectDropped(dataTransfer) {
  const roots = [...dataTransfer.items]
    .filter((item) => item.kind === 'file')
    .map((item) => ({ entry: item.webkitGetAsEntry?.() || null, file: item.getAsFile?.() || null }));

  const out = [];
  const read = (reader) => new Promise((resolve, reject) => reader.readEntries(resolve, reject));

  async function walk(entry, parent) {
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      out.push({ file, rel: parent ? `${parent}/${file.name}` : file.name });
    } else if (entry.isDirectory) {
      const here = parent ? `${parent}/${entry.name}` : entry.name;
      const reader = entry.createReader();
      for (let batch = await read(reader); batch.length; batch = await read(reader)) {
        for (const child of batch) await walk(child, here);
      }
    }
  }

  for (const { entry, file } of roots) {
    try {
      if (entry) await walk(entry, '');
      else if (file) out.push({ file, rel: file.name });
    } catch { /* um item ilegível não impede os outros */ }
  }
  return out;
}
