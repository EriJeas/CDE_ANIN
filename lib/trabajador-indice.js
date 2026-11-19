/*
 * ARMA EL INDICE SQLITE DE UN MODELO EN UN HILO APARTE (worker_threads), con la clase Indice del visor
 * (compartido-visor/extractor-modelos.js, sin cambios). SQLite en Node es sincrono: si esto corriera en el hilo principal,
 * el CDE dejaria de responder mientras arma un indice de millones de pares (la misma leccion del visor, v1.377).
 *
 * Entrada (workerData): { dirTrozos, rutaIndice, meta }. Los trozos son N.json.gz con el formato de exporta-indice.js
 * del visor (lo produce el complemento de Revit del CDE y, cuando se use, el propio visor).
 * Salida (postMessage): { ok, nodos, pares, resumen } | { ok: false, error }.
 */
'use strict';
const { parentPort, workerData } = require('worker_threads');
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const X = require('../compartido-visor/extractor-modelos'), I = require('../compartido-visor/indice-modelos');

(function main() {
  const { dirTrozos, rutaIndice, meta } = workerData;
  let ix = null;
  try {
    const archivos = fs.readdirSync(dirTrozos).filter(f => /^\d+\.json\.gz$/.test(f)).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    if (!archivos.length) throw new Error('no hay trozos que armar');
    const nueva = rutaIndice + '.nuevo';
    ix = new X.Indice(nueva);
    let pares = 0, elem = 0;
    for (const f of archivos) {
      const t = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dirTrozos, f))).toString('utf8'));
      const r = ix.trozoVisor(t); pares += r.pares; elem += r.elem;
      parentPort.postMessage({ avance: f, pares, elem });
    }
    const fin = ix.cierra(Object.assign({ origen: 'visor' }, meta || {}));   // origen 'visor': las consultas usan las reglas del visor (tableroV)
    ix = null;
    I.cierra(rutaIndice);
    // en Windows el reemplazo falla (EPERM / EBUSY) si alguien acaba de consultar el indice anterior: se reintenta unos segundos
    for (let intento = 0; ; intento++) {
      try { try { fs.unlinkSync(rutaIndice); } catch (e) { if (e.code !== 'ENOENT') throw e; } fs.renameSync(nueva, rutaIndice); break; }
      catch (e) { if (intento >= 40 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250); }
    }
    const resumen = I.resumenVisor(rutaIndice);
    I.cierra(rutaIndice);
    parentPort.postMessage({ ok: true, nodos: fin.nodos, pares: fin.pares, resumen });
  } catch (e) {
    if (ix) ix.abandona();
    parentPort.postMessage({ ok: false, error: e.message || String(e) });
  }
})();
