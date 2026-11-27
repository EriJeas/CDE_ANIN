/*
 * EL HILO DE CONSULTAS AL ÍNDICE (v0.32.1). Las consultas pesadas al índice de un modelo (tablero, valores de un parámetro, inventario, tablas de
 * planificación…) recorren cientos de miles de filas. Hechas en el hilo del servidor lo dejaban sin responder (y sin memoria) con un federado
 * grande: Render lo daba por caído y lo reiniciaba (HTTP 502). Aquí corren aparte, de a una, con su propio tope de memoria: si una no cabe,
 * falla esa consulta, no el servidor.
 */
const { parentPort } = require('worker_threads');
const I = require('../compartido-visor/indice-modelos'), TP = require('./tabla-plan');
parentPort.on('message', (m) => {
  if (m.cierra) { try { I.cierra(m.cierra); } catch (e) {} return; }
  try { const r = m.op === 'tabla-plan' ? TP.calcula(I.abre(m.ruta), m.args[0]) : I[m.op](m.ruta, ...m.args); parentPort.postMessage({ id: m.id, ok: true, r }); }
  catch (e) { parentPort.postMessage({ id: m.id, ok: false, error: String((e && e.message) || e), datos: !!(e && e.datos) }); }
});
