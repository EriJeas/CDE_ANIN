/*
 * PUENTE: en el visor, extractor-modelos.js e indice-modelos.js leen las funciones puras de clasificacion directamente
 * del app.js del visor (reporte-forma.js → fuentesComunes / fuentesDeArchivo). El CDE no tiene ese app.js: aqui las
 * mismas dos funciones devuelven el texto desde clasificadores-visor.js (la copia literal generada desde el visor).
 * Asi extractor-modelos.js e indice-modelos.js son COPIAS SIN CAMBIOS del visor.
 */
'use strict';
const CL = require('./clasificadores-visor');

function junta(nombres, de) {
  const partes = [], faltan = [];
  for (const n of nombres) { const d = CL.declaraciones[n]; if (d) partes.push(d); else faltan.push(n); }
  if (faltan.length) throw new Error('faltan en clasificadores-visor.js (' + de + '): ' + faltan.join(', ') + ' — corre herramientas/actualiza-clasificadores.js');
  return partes.join('\n');
}
function fuentesComunes(nombres) { return junta(nombres, 'app.js'); }
function fuentesDeArchivo(archivo, nombres) { return junta(nombres, archivo); }

module.exports = { fuentesComunes, fuentesDeArchivo, versionVisor: CL.visor, generado: CL.generado };
