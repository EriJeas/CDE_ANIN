/*
 * HILO APARTE: reordena el indice de un NWD/NWC traido de Forma con la regla de elemento de Navisworks (arbol-navisworks.js),
 * con el arbol que entrego el navegador. Va en un hilo porque toca millones de filas de SQLite (sincrono en Node).
 * workerData: { ruta (indice .sqlite), rutaArbol (arbol del navegador: ver leeArbol) }
 * mensajes al servidor: { avance: texto } · { ok: true, r } · { ok: false, error, comprobacion }
 */
'use strict';
const { parentPort, workerData: W } = require('worker_threads');
const fs = require('fs');
const A = require('./arbol-navisworks');

(() => {
  let db = null;
  try {
    const { padre, malla } = A.leeArbol(fs.readFileSync(W.rutaArbol));
    const { DatabaseSync } = require('node:sqlite');
    db = new DatabaseSync(W.ruta);
    db.exec('PRAGMA cache_size=-65536; PRAGMA temp_store=FILE; PRAGMA synchronous=NORMAL;');
    const r = A.reclasifica(db, padre, (texto) => parentPort.postMessage({ avance: String(texto || '').slice(0, 200) }), malla);
    db.close(); db = null;
    try { require('../compartido-visor/indice-modelos').cierra(W.ruta); } catch (e) {}
    parentPort.postMessage({ ok: true, r });
  } catch (e) {
    try { db && db.close(); } catch (x) {}
    parentPort.postMessage({ ok: false, error: String((e && e.message) || e).slice(0, 1500), comprobacion: (e && e.comprobacion) || null });
  } finally { try { fs.unlinkSync(W.rutaArbol); } catch (e) {} }
})();
