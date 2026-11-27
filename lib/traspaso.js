/*
 * TRASPASO DE ARCHIVOS GRANDES SIN ACUMULAR MEMORIA (v0.30.1).
 *
 * Los conectores bajaban un archivo de la otra nube y lo pasaban a /subir encadenando dos fetch (descarga -> subida local). Esa cadena
 * NO frena la descarga cuando el disco escribe más despacio que la red: lo que el disco aún no escribió se queda en memoria. Medido con
 * Node 22.13: 0,6 GB hacia un disco de 40 MB/s ocuparon 732 MB (un servidor de 512 MB se cae: HTTP 502). Con estos dos tramos, 116 MB:
 *   1) baja()  : la respuesta de la otra nube -> archivo temporal, con pipeline (la contrapresión de los flujos de Node);
 *   2) sube()  : el archivo temporal -> el propio servidor, con http.request y pipe.
 */
const fs = require('fs'), path = require('path'), http = require('http'), crypto = require('crypto');
const { Readable } = require('stream'), { pipeline } = require('stream/promises');

/** Guarda el cuerpo de una respuesta de fetch en un archivo temporal de `dir`. Devuelve su ruta. */
async function baja(respuesta, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, 'baja-' + Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex') + '.tmp');
  try { await pipeline(Readable.fromWeb(respuesta.body), fs.createWriteStream(tmp)); } catch (e) { try { fs.unlinkSync(tmp); } catch (x) {} throw e; }
  return tmp;
}
/** Envía un archivo al servidor local (POST). Devuelve { ok, status, j }. */
function sube(puerto, ruta, cabeceras, archivo) {
  return new Promise((ok, mal) => {
    const tam = fs.statSync(archivo).size;
    const rq = http.request({ host: '127.0.0.1', port: puerto, method: 'POST', path: ruta, headers: Object.assign({ 'content-length': tam }, cabeceras) }, (rs) => {
      let s = ''; rs.setEncoding('utf8'); rs.on('data', (d) => { if (s.length < 2e6) s += d; }); rs.on('error', mal);
      rs.on('end', () => { let j = {}; try { j = JSON.parse(s); } catch (e) {} ok({ ok: rs.statusCode >= 200 && rs.statusCode < 300, status: rs.statusCode, j }); });
    });
    rq.on('error', mal);
    const f = fs.createReadStream(archivo); f.on('error', (e) => { rq.destroy(e); mal(e); }); f.pipe(rq);
  });
}
/** Borra los temporales que hayan quedado de una ejecución interrumpida. */
function limpia(dir) { try { for (const n of fs.readdirSync(dir)) if (/^baja-.*\.tmp$/.test(n)) try { fs.unlinkSync(path.join(dir, n)); } catch (e) {} } catch (e) {} }

module.exports = { baja, sube, limpia };
