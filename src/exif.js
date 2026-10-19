// Lê a orientação EXIF (1-8) do começo de um JPEG; devolve 1 quando não há (ou não é JPEG).
function jpegOrientation(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return 1;
  let o = 2;
  while (o + 4 <= buf.length) {
    if (buf[o] !== 0xff) return 1;
    const marker = buf[o + 1];
    if (marker === 0xd9 || marker === 0xda) return 1; // fim da imagem / início dos dados
    const len = buf.readUInt16BE(o + 2);
    if (marker === 0xe1 && buf.toString('latin1', o + 4, o + 10) === 'Exif\0\0') {
      const t = o + 10; // início do cabeçalho TIFF
      if (t + 8 > buf.length) return 1;
      const le = buf.toString('latin1', t, t + 2) === 'II';
      const u16 = (p) => (le ? buf.readUInt16LE(p) : buf.readUInt16BE(p));
      const u32 = (p) => (le ? buf.readUInt32LE(p) : buf.readUInt32BE(p));
      const ifd = t + u32(t + 4);
      if (ifd + 2 > buf.length) return 1;
      const n = u16(ifd);
      for (let i = 0; i < n; i++) {
        const e = ifd + 2 + i * 12;
        if (e + 12 > buf.length) return 1;
        if (u16(e) === 0x0112) {
          const v = u16(e + 8);
          return v >= 1 && v <= 8 ? v : 1;
        }
      }
      return 1;
    }
    o += 2 + len;
  }
  return 1;
}

module.exports = { jpegOrientation };
