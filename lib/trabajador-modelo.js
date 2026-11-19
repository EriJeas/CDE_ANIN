/*
 * CONVIERTE UN MODELO CARGADO AL CDE (IFC o RVT) AL PAQUETE DEL CDE, EN UN HILO APARTE (worker_threads): leer un modelo
 * de cientos de MB toma su tiempo y el CDE debe seguir respondiendo mientras tanto.
 *
 * Entrada (workerData): { ruta, ext, modelo, dirSalida }.
 * Salida (postMessage): { avance: { fase, n, total } } ... y al final { ok, resumen } | { ok: false, error }.
 * Lo que deja en dirSalida: N.json.gz (trozos del indice) y geometria.cdeg, listos para lib/modelos.js (arma).
 */
'use strict';
const { parentPort, workerData } = require('worker_threads');
const fs = require('fs'), path = require('path');
const IFC = require('./lector-ifc'), RVT = require('./lector-rvt');

(async function main() {
  const { ruta, ext, modelo, dirSalida } = workerData;
  const avisa = (fase, n, total) => parentPort.postMessage({ avance: { fase, n: n || 0, total: total || 0 } });
  try {
    fs.mkdirSync(dirSalida, { recursive: true });
    let rutaIfc = ruta, revit = '', herramienta = 'CDE · lector IFC (web-ifc)';
    if (ext === 'rvt') {
      avisa('rvt', 0, 0);
      const r = await RVT.aIfc(ruta, path.join(dirSalida, 'desde-rvt.ifc'), avisa);
      if (!r.ok) throw new Error(r.error);
      rutaIfc = r.ifc; revit = r.revit || ''; herramienta = 'CDE · lector RVT libre (rvt-rs) + lector IFC (web-ifc)';
    }
    const res = await IFC.convierte(rutaIfc, { modelo, dirSalida, alAvanzar: avisa, herramienta, traducir: ext === 'rvt' });   // rvt-rs entrega los nombres de sistema en ingles
    if (ext === 'rvt') { try { fs.unlinkSync(rutaIfc); } catch (e) {} }
    if (!res.elementos) {
      throw new Error(ext === 'rvt'
        ? 'El lector libre abrió el archivo' + (revit ? ' (Revit ' + revit + ')' : '') + ' pero no recuperó elementos con geometría: esta versión de Revit o este modelo aún no los entrega completos. Publícalo con el complemento de Revit o carga su IFC.'
        : 'El IFC no trae elementos con geometría.');
    }
    parentPort.postMessage({ ok: true, resumen: Object.assign({}, res, { revit, geometria: !!res.geometria }) });
  } catch (e) {
    parentPort.postMessage({ ok: false, error: e.message || String(e) });
  }
})();
