/*
 * Arma el mapa de partes de una geometría (.cdeg) fuera del hilo del servidor (v0.27.0): lee el nivel (y el archivo) de cada
 * elemento del índice y reparte los elementos en partes (lib/partes.js). El .cdeg se lee por trozos; nada se carga entero.
 */
'use strict';
const { parentPort, workerData: W } = require('worker_threads');
const P = require('./partes');
const { recorre } = require('../compartido-visor/recorre');
try {
  const grupo = new Map();
  if (W.indice) {
    const { DatabaseSync } = require('node:sqlite'), db = new DatabaseSync(W.indice, { readOnly: true });
    try {
      const modelos = new Set(), filas = [];
      for (const r of recorre(db, 'SELECT e, modelo, niv FROM elem WHERE clase = 1')) { const m = String(r.modelo || '').trim(), n = String(r.niv || '').trim(); modelos.add(m); filas.push([Number(r.e), m, n]); }
      const varios = modelos.size > 1;   // un federado: cada archivo y, dentro, cada nivel
      for (const [e, m, n] of filas) grupo.set(e, (varios && m ? m + ' · ' : '') + (n && n !== '(sin nivel)' ? n : '(sin nivel)'));
    } finally { db.close(); }
  }
  const r = P.arma(W.geometria, (e) => grupo.get(e) || '', { maxTri: W.maxTri });
  P.guarda(W.geometria, r);
  parentPort.postMessage({ ok: true, partes: r.mapa.partes.length });
} catch (e) { parentPort.postMessage({ ok: false, error: e.message }); }
