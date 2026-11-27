/*
 * El índice entero de un modelo para el navegador (lo que piden Filtro con sectores, Tablero y COBie): { byParam, total, params, vals, omitidos }.
 * v0.30.1 · en un hilo aparte: recorrer un federado entero tarda y no puede hacerse en el hilo del servidor. Se escribe al disco parámetro a
 * parámetro (nunca entero en memoria) y el servidor lo entrega leyendo ese archivo.
 */
const { parentPort, workerData } = require('worker_threads');
const fs = require('fs'), path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { recorre, recorreSt } = require('../compartido-visor/recorre');
try {
  const { ruta, copia } = workerData, TOPE = Number(workerData.tope) || 3000;
  // v0.30.0: la respuesta se ESCRIBE AL DISCO parámetro a parámetro (nunca entera en memoria: en un federado pesaba cientos de MB y tumbaba
  // el servidor) y se entrega leyendo ese archivo. El orden de las claves del JSON cambia (byParam primero); el contenido es el mismo.
  const db = new DatabaseSync(ruta, { readOnly: true });
  const params = [], vals = [], valIdx = new Map();
  const iVal = (t) => { let k = valIdx.get(t); if (k == null) { k = vals.length; vals.push(t); valIdx.set(t, k); } return k; };
  try { const dir = path.dirname(ruta), base = path.basename(ruta) + '.props.'; for (const n of fs.readdirSync(dir)) if (n.startsWith(base)) try { fs.unlinkSync(path.join(dir, n)); } catch (e) {} } catch (e) {}
  const tmp = copia + '.tmp', fd = fs.openSync(tmp, 'w'); let primero = true;
  const escribeParam = (nombre, m) => { params.push(nombre); fs.writeSync(fd, (primero ? '' : ',') + JSON.stringify([params.length - 1, [...m.entries()].map(([t, es]) => [iVal(t), es])])); primero = false; };
  let total = 0, omitidos = [];
  try {
    fs.writeSync(fd, '{"byParam":[');
    // canonicas (de elem), con el prefijo "● " que usan los modulos del visor
    const CAN = { modelo: 'Modelo', cat: 'Categoria', fam: 'Familia', tip: 'Tipo', niv: 'Nivel' }, canon = {};
    for (const k of Object.keys(CAN)) canon[k] = new Map();
    for (const r of recorre(db, 'SELECT e, modelo, cat, fam, tip, niv FROM elem WHERE clase = 1')) {
      total++;
      for (const k of Object.keys(CAN)) { const t = String(r[k] || ''); if (!t) continue; let a = canon[k].get(t); if (!a) { a = []; canon[k].set(t, a); } a.push(Number(r.e)); }
    }
    for (const k of ['modelo', 'cat', 'fam', 'tip', 'niv']) { escribeParam('● ' + CAN[k], canon[k]); canon[k] = null; }
    const attrs = db.prepare('SELECT a.id, a.nombre, COUNT(DISTINCT eav.v) AS nv FROM attr a JOIN eav ON eav.a = a.id GROUP BY a.id ORDER BY a.nombre COLLATE NOCASE').all();
    const porVal = db.prepare('SELECT val.v AS v, eav.e AS e FROM eav JOIN val ON val.id = eav.v WHERE eav.a = ? ORDER BY eav.v');
    for (const a of attrs) {
      if (Number(a.nv) > TOPE || /^●/.test(String(a.nombre))) continue;   // las canonicas ya van arriba (de la tabla elem)
      const m = new Map();
      for (const r of recorreSt(porVal, Number(a.id))) { const t = String(r.v == null ? '' : r.v); let l = m.get(t); if (!l) { l = []; m.set(t, l); } l.push(Number(r.e)); }
      if (!m.size) continue;
      escribeParam(String(a.nombre), m);
    }
    omitidos = attrs.filter(a => Number(a.nv) > TOPE).map(a => a.nombre);
    fs.writeSync(fd, '],"total":' + total + ',"params":' + JSON.stringify(params) + ',"vals":' + JSON.stringify(vals) + ',"omitidos":' + JSON.stringify(omitidos) + '}');
  } catch (e) { try { fs.closeSync(fd); fs.unlinkSync(tmp); } catch (x) {} throw e; }
  fs.closeSync(fd); fs.renameSync(tmp, copia);
  try { db.close(); } catch (e) {}
  parentPort.postMessage({ ok: true, total });
} catch (e) { parentPort.postMessage({ ok: false, error: String((e && e.message) || e) }); }
