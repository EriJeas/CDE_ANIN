/*
 * Regenera compartido-visor/clasificadores-visor.js y vuelve a copiar indice-modelos.js y extractor-modelos.js
 * desde una copia local del visor. Uso:  node herramientas/actualiza-clasificadores.js <carpeta del visor>
 */
'use strict';
const fs = require('fs'), path = require('path');
const V = process.argv[2];
if (!V || !fs.existsSync(path.join(V, 'public', 'js', 'app.js'))) { console.error('Indica la carpeta del visor (la que tiene server.js y public/js/app.js).'); process.exit(1); }
const RF = require(path.join(V, 'reporte-forma.js'));
const AQUI = path.join(__dirname, '..', 'compartido-visor');
const src = fs.readFileSync(path.join(V, 'public/js/app.js'), 'utf8'), srcL = fs.readFileSync(path.join(V, 'public/js/llenado.js'), 'utf8');
const DE_APP = ['RX_ARCHIVO', 'esNombreDeArchivo', 'CATEGORIA_BASURA', 'TIPO_GENERICO', 'sinTildes', 'esTipoGenerico', 'normValue', 'posCategoriaDeclarada', 'capasHastaCategoria', 'clasificaAnclado', 'CANON', 'INV_RELLENO', 'validaNombre19650'];
const DE_LLEN = ['LLEN_HUECOS', 'llenHueco'];
const partes = {}, faltan = [];
for (const n of DE_APP) { const d = RF.declaracion(src, n); if (d) partes[n] = d; else faltan.push(n); }
for (const n of DE_LLEN) { const d = RF.declaracion(srcL, n); if (d) partes[n] = d; else faltan.push(n); }
if (faltan.length) { console.error('No se encontraron en el visor:', faltan.join(', ')); process.exit(1); }
const ver = JSON.parse(fs.readFileSync(path.join(V, 'package.json'), 'utf8')).version;
let out = '/*\n * CLASIFICADORES DEL VISOR BIM — copia literal, generada automaticamente desde el visor (public/js/app.js y\n * public/js/llenado.js, visor v' + ver + ', ' + new Date().toISOString().slice(0, 10) + ') con la funcion declaracion() de reporte-forma.js del propio visor.\n * NO EDITAR A MANO: para actualizar, correr  node herramientas/actualiza-clasificadores.js <ruta del visor>\n * Cada declaracion es un texto independiente (como las usa el visor en extractor-modelos.js via vm): el CDE las\n * ejecuta en su propio contexto para que las cifras de Modelo/Categoria/Familia/Tipo/Nivel sean EXACTAMENTE las del visor.\n */\n"use strict";\nmodule.exports = {\n  visor: ' + JSON.stringify(ver) + ',\n  generado: ' + JSON.stringify(new Date().toISOString()) + ',\n  declaraciones: {\n';
const ks = Object.keys(partes);
ks.forEach((k, i) => { out += '    ' + JSON.stringify(k) + ': ' + JSON.stringify(partes[k]) + (i < ks.length - 1 ? ',' : '') + '\n'; });
out += '  }\n};\n';
fs.writeFileSync(path.join(AQUI, 'clasificadores-visor.js'), out);
for (const f of ['indice-modelos.js', 'extractor-modelos.js']) fs.copyFileSync(path.join(V, f), path.join(AQUI, f));
console.log('Listo: ' + ks.length + ' declaraciones del visor v' + ver + '; indice-modelos.js y extractor-modelos.js copiados.');
