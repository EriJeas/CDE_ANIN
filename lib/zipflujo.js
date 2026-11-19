/*
 * ZIP AL VUELO (metodo "store", sin comprimir: RVT, PDF, DWG ya vienen comprimidos o casi no ganan) para "Descargar
 * archivos de origen" de una carpeta. Lee cada archivo dos veces del disco (una para su CRC-32, otra para enviarlo), asi
 * nunca tiene un archivo entero en memoria. Nombres en UTF-8 (bit 11). Limite del formato clasico: 4 GB por archivo y en total.
 */
'use strict';
const fs = require('fs'), zlib = require('zlib');

const TABLA = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
/** CRC-32 incremental (el de zlib si la version de Node lo trae). Pura. */
function crcSigue(crc, buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf, crc);
  let c = (crc ^ 0xFFFFFFFF) >>> 0; for (let i = 0; i < buf.length; i++) c = TABLA[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0;
}
function crcArchivo(ruta) {
  return new Promise((ok, mal) => { let c = 0; fs.createReadStream(ruta).on('data', (b) => { c = crcSigue(c, b); }).on('error', mal).on('end', () => ok(c >>> 0)); });
}
const escribe1 = (dest, buf) => new Promise((ok) => { if (dest.write(buf)) ok(); else dest.once('drain', ok); });
function vuelca(dest, ruta) {
  return new Promise((ok, mal) => { const r = fs.createReadStream(ruta); r.on('error', mal); r.on('end', ok); r.on('data', (b) => { if (!dest.write(b)) { r.pause(); dest.once('drain', () => r.resume()); } }); });
}
function fechaDos(d) { return { t: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), f: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() }; }

/** Escribe en `dest` (un flujo: la respuesta HTTP) un ZIP con las entradas [{ nombre, ruta }]. */
async function escribe(dest, entradas) {
  const dir = [], vistos = new Set(); let off = 0;
  for (const e of entradas) {
    let nombre = String(e.nombre).replace(/\\/g, '/').replace(/^\/+/, '');
    if (vistos.has(nombre)) { const i = nombre.lastIndexOf('.'); let k = 2; let alt; do { alt = i > 0 ? nombre.slice(0, i) + ' (' + k + ')' + nombre.slice(i) : nombre + ' (' + k + ')'; k++; } while (vistos.has(alt)); nombre = alt; }
    vistos.add(nombre);
    const st = fs.statSync(e.ruta), crc = await crcArchivo(e.ruta), n = Buffer.from(nombre, 'utf8'), { t, f } = fechaDos(st.mtime);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(0, 8); h.writeUInt16LE(t, 10); h.writeUInt16LE(f, 12); h.writeUInt32LE(crc, 14); h.writeUInt32LE(st.size, 18); h.writeUInt32LE(st.size, 22); h.writeUInt16LE(n.length, 26); h.writeUInt16LE(0, 28);
    await escribe1(dest, Buffer.concat([h, n])); await vuelca(dest, e.ruta);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(0, 10); c.writeUInt16LE(t, 12); c.writeUInt16LE(f, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(st.size, 20); c.writeUInt32LE(st.size, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
    dir.push(Buffer.concat([c, n])); off += 30 + n.length + st.size;
  }
  const cd = Buffer.concat(dir), fin = Buffer.alloc(22); fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(dir.length, 8); fin.writeUInt16LE(dir.length, 10); fin.writeUInt32LE(cd.length, 12); fin.writeUInt32LE(off, 16);
  await escribe1(dest, Buffer.concat([cd, fin])); dest.end();
}

module.exports = { escribe, crcSigue };
