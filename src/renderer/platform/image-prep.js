// Prepara uma foto para ser guardada no app: decodifica uma vez, reduz o que for grande demais e gera a miniatura.
// Fotos de câmera (12 MP ou mais, vários MB) deixam o iPad antigo lento e enchem o armazenamento do Safari;
// para uma tela de parede, 2560 px no maior lado ainda ficam nítidos.
export const MAX_SIDE = 2560;
export const THUMB_SIDE = 640;     // menor lado da miniatura (as bolhas são recortadas em círculo)
const REENCODE_BYTES = 3 * 1024 * 1024;

// GIF e WebP podem ser animados: o canvas guardaria só o primeiro quadro, então ficam como estão
export const keepsOriginal = (ext) => ext === 'gif' || ext === 'webp';

function toJpeg(img, width, height, quality) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#111'; // fundo para PNG com transparência
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  return new Promise((resolve) => canvas.toBlob((blob) => { canvas.width = canvas.height = 0; resolve(blob); }, 'image/jpeg', quality));
}

/**
 * Devolve { blob, thumb }: `blob` é a foto a guardar (reduzida só se for grande e a versão nova for menor)
 * e `thumb` a miniatura JPEG (null se a foto já for pequena). Lança erro se o navegador não abrir a imagem.
 */
export async function prepareImage(file, ext) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) throw new Error('imagem vazia');

    let blob = file;
    const long = Math.max(w, h);
    if (!keepsOriginal(ext) && (long > MAX_SIDE || file.size > REENCODE_BYTES)) {
      const k = Math.min(1, MAX_SIDE / long);
      const smaller = await toJpeg(img, Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)), 0.86);
      // o que pesa no iPad é o tamanho em pixels: acima de MAX_SIDE sempre reduz; abaixo, só troca se o arquivo diminuir
      if (smaller && (long > MAX_SIDE || smaller.size < file.size)) blob = smaller;
    }

    const kThumb = THUMB_SIDE / Math.min(w, h);
    const thumb = kThumb < 1 ? await toJpeg(img, Math.round(w * kThumb), Math.round(h * kThumb), 0.8) : null;
    return { blob, thumb };
  } finally {
    URL.revokeObjectURL(url);
  }
}
