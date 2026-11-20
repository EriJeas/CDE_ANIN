/*
 * PRUEBA DE PUNTA A PUNTA DEL CDE (sin Revit): arranca el servidor en modo local con una carpeta de datos temporal y
 * recorre todo el flujo como lo haria la web y el complemento:
 *   sesion → proyecto → validacion de nombres (bueno y malos) → subir version → estados ISO 19650 → revision por rondas →
 *   incidencia + BCF → llave de complemento → paquete de modelo (trozos en formato del visor + geometria .cdeg) →
 *   indice listo → tablero / elementos / elemento / geometria coinciden con lo enviado.
 * Uso: node pruebas/pruebas-arranque.js   (termina con codigo 0 si todo pasa)
 */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), zlib = require('zlib');
const DATOS = fs.mkdtempSync(path.join(os.tmpdir(), 'cde-prueba-'));
Object.assign(process.env, { DATOS_DIR: DATOS, MODO_ACCESO: 'local', ACCESO_CLAVE: 'prueba', ADMIN_EMAILS: 'admin@anin.gob.pe', SESSION_SECRET: 'secreto-de-prueba', PORT: '0' });
const { app } = require('../servidor');

let fallos = 0, n = 0;
const ok = (cond, msg) => { n++; if (cond) console.log('  ok  ' + msg); else { fallos++; console.log('  FALLA ' + msg); } };
const duerme = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const srv = app.listen(0); await new Promise(r => srv.on('listening', r));
  const B = 'http://127.0.0.1:' + srv.address().port;
  let galleta = '';
  const pide = async (ruta, o) => {
    o = o || {}; o.headers = Object.assign({ cookie: galleta }, o.headers || {});
    if (o.json !== undefined) { o.method = o.method || 'POST'; o.headers['content-type'] = 'application/json'; o.body = JSON.stringify(o.json); delete o.json; }
    const r = await fetch(B + ruta, o); const sc = r.headers.get('set-cookie'); if (sc) galleta = sc.split(';')[0];
    const ct = r.headers.get('content-type') || ''; const cuerpo = /json/.test(ct) ? await r.json() : Buffer.from(await r.arrayBuffer());
    return { status: r.status, j: cuerpo };
  };
  try {
    console.log('1. Sesion y proyecto');
    let r = await pide('/api/proyectos'); ok(r.status === 401, 'sin sesion → 401');
    r = await pide('/api/acceso/local', { json: { email: 'admin@anin.gob.pe', clave: 'mal' } }); ok(r.status === 401, 'clave mala → 401');
    r = await pide('/api/acceso/local', { json: { email: 'admin@anin.gob.pe', clave: 'prueba' } }); ok(r.status === 200 && r.j.admin, 'entra el administrador');
    r = await pide('/api/proyectos', { json: { codigo: 'SECHURA', nombre: 'Centro de Salud Sechura I-4' } }); ok(r.status === 200, 'crea proyecto'); const pid = r.j.id;
    r = await pide('/api/proyectos/' + pid); ok(r.j.rol === 'administrador' && r.j.config.nomenclatura.campos.length === 7, 'config por defecto: 7 campos');
    r = await pide('/api/proyectos/' + pid + '/miembros', { json: { email: 'bim@ghemet.com', rol: 'document-control', organizacion: 'GHEMET' } }); ok(r.status === 200, 'agrega autor del contratista');

    console.log('2. Nomenclatura');
    r = await pide('/api/proyectos/' + pid + '/valida-nombre', { json: { nombre: 'SECHURA-GHE-ZZ-XX-M3-A-0001-P01.rvt' } }); ok(r.j.ok && r.j.revision === 'P01' && r.j.tipo === 'modelo', 'nombre valido → base/revision/tipo');
    r = await pide('/api/proyectos/' + pid + '/valida-nombre', { json: { nombre: 'Modelo arquitectura final v3.rvt' } }); ok(!r.j.ok && r.j.errores.length >= 1, 'nombre libre → rechazado: ' + r.j.errores[0]);
    r = await pide('/api/proyectos/' + pid + '/valida-nombre', { json: { nombre: 'OTRO-GHE-ZZ-XX-M3-A-0001-P01.rvt' } }); ok(!r.j.ok && /Proyecto/.test(r.j.errores[0]), 'codigo de proyecto distinto → rechazado');
    r = await pide('/api/proyectos/' + pid + '/valida-nombre', { json: { nombre: 'SECHURA-GHE-ZZ-XX-M3-A-0001.rvt' } }); ok(!r.j.ok && /revision/.test(r.j.errores[0]), 'sin revision → rechazado');

    console.log('3. Versiones y estados');
    const sube = (nombre, cuerpo, q) => fetch(B + '/api/proyectos/' + pid + '/subir' + (q || ''), { method: 'POST', headers: { cookie: galleta, 'x-nombre': encodeURIComponent(nombre) }, body: cuerpo }).then(async x => ({ status: x.status, j: await x.json() }));
    r = await sube('Modelo final.rvt', Buffer.from('xx')); ok(r.status === 400 && r.j.error === 'nomenclatura', 'subir con nombre malo → no entra');
    r = await sube('SECHURA-GHE-ZZ-XX-M3-A-0001-P01.rvt', Buffer.from('contenido rvt de prueba'), '?carpeta=' + encodeURIComponent('01 Arquitectura')); ok(r.status === 200 && r.j.n === 1 && r.j.revision === 'P01' && r.j.estado === 'WIP', 'primera version → v1 P01 WIP'); const cid = r.j.contenedor, vid1 = r.j.version;
    r = await sube('SECHURA-GHE-ZZ-XX-M3-A-0001-P01.rvt', Buffer.from('otra vez')); ok(r.status === 409, 'misma revision otra vez → 409');
    r = await sube('SECHURA-GHE-ZZ-XX-M3-A-0001-P02.rvt', Buffer.from('contenido v2 mas largo')); ok(r.status === 200 && r.j.n === 2 && r.j.contenedor === cid, 'P02 → v2 del mismo contenedor'); const vid2 = r.j.version;
    r = await pide('/api/proyectos/' + pid + '/versiones/' + vid2 + '/descargar'); ok(r.status === 200 && r.j.toString() === 'contenido v2 mas largo', 'descarga devuelve lo subido');
    r = await pide('/api/proyectos/' + pid + '/contenedores/' + cid + '/estado', { json: { estado: 'PUBLICADO' } }); ok(r.status === 403, 'WIP → PUBLICADO directo → prohibido');
    r = await pide('/api/proyectos/' + pid + '/contenedores/' + cid + '/estado', { json: { estado: 'COMPARTIDO', idoneidad: 'S3' } }); ok(r.status === 200, 'WIP → COMPARTIDO (S3)');
    r = await pide('/api/proyectos/' + pid + '/contenedores/' + cid + '/revisiones', { json: { revisor: 'erick@anin.gob.pe' } }); ok(r.status === 200 && r.j.ronda === 1, 'abre ronda 1'); const rid = r.j.id;
    r = await pide('/api/proyectos/' + pid + '/contenedores/' + cid + '/estado', { json: { estado: 'PUBLICADO', idoneidad: 'A1' } }); ok(r.status === 409, 'publicar con revision abierta → 409');
    r = await pide('/api/proyectos/' + pid + '/revisiones/' + rid + '/cerrar', { json: { estado: 'devuelta', comentario: 'Faltan niveles' } }); ok(r.status === 200, 'ronda 1 devuelta');
    r = await pide('/api/proyectos/' + pid + '/contenedores/' + cid); ok(r.j.estado === 'WIP' && r.j.transiciones.length === 2, 'devuelto → vuelve a WIP con historial');
    r = await sube('SECHURA-GHE-ZZ-XX-M3-A-0001-P03.rvt', Buffer.from('v3')); ok(r.status === 200 && r.j.n === 3, 'P03 → v3'); const vid3 = r.j.version;
    r = await pide('/api/proyectos/' + pid + '/contenedores/' + cid + '/estado', { json: { estado: 'COMPARTIDO', idoneidad: 'S4' } });
    r = await pide('/api/proyectos/' + pid + '/contenedores/' + cid + '/revisiones', { json: {} }); ok(r.j.ronda === 2, 'ronda 2');
    const rid2 = r.j.id; r = await pide('/api/proyectos/' + pid + '/revisiones/' + rid2 + '/cerrar', { json: { estado: 'aprobada' } }); ok(r.status === 200 && r.j.estado === 'abierta' && r.j.etapa === 1, 'flujo por defecto de 2 etapas: la primera aprobada pasa a la segunda');
    r = await pide('/api/proyectos/' + pid + '/revisiones/' + rid2 + '/decidir', { json: { decision: 'aprobar' } }); ok(r.status === 200 && r.j.estado === 'aprobada', 'segunda etapa aprobada → ronda aprobada');
    r = await pide('/api/proyectos/' + pid + '/contenedores/' + cid); ok(r.j.estado === 'PUBLICADO' && r.j.versiones[0].idoneidad === 'A1', 'al aprobar la ronda el flujo publica solo (PUBLICADO, A1)');
    r = await pide('/api/proyectos/' + pid + '/contenedores/' + cid + '/estado', { json: { estado: 'PUBLICADO', idoneidad: 'A1' } }); ok(r.status === 403, 'publicar lo ya publicado → rechazado');
    r = await sube('SECHURA-GHE-ZZ-XX-M3-A-0001-P04.rvt', Buffer.from('v4')); ok(r.status === 409, 'publicado: P04 no entra (debe ser C..)');
    r = await sube('SECHURA-GHE-ZZ-XX-M3-A-0001-C01.rvt', Buffer.from('v4 contractual')); ok(r.status === 200 && r.j.revision === 'C01', 'publicado: C01 si entra');

    console.log('4. Incidencias y BCF');
    r = await pide('/api/proyectos/' + pid + '/incidencias', { json: { titulo: 'Puerta choca con viga', prioridad: 'alta', contractual: true, contenedor_id: cid, version_id: vid3, elementos: [{ uid: 'abc-123', e: 4001, modelo: 'A.rvt' }], camara: { pos: [1, 2, 3], dir: [0, 1, 0], up: [0, 0, 1], fov: 60 } } }); ok(r.status === 200 && r.j.numero === 1, 'incidencia #1');
    r = await pide('/api/proyectos/' + pid + '/incidencias/' + r.j.id + '/comentar', { json: { texto: 'Revisado', estado: 'en-curso' } }); ok(r.status === 200, 'comentario + estado');
    r = await pide('/api/proyectos/' + pid + '/incidencias'); ok(r.j.incidencias.length === 1 && r.j.incidencias[0].antiguedad_dias === 0 && r.j.incidencias[0].contractual === 1, 'lista con antiguedad y contractual');
    r = await pide('/api/proyectos/' + pid + '/incidencias.bcfzip'); ok(r.status === 200 && r.j.subarray(0, 2).toString('latin1') === 'PK' && r.j.toString('latin1').includes('markup.bcf') && r.j.toString('latin1').includes('Puerta choca'), 'BCF 2.1 es un ZIP con markup.bcf');

    console.log('5. Complemento: llave y paquete de modelo (formato del visor)');
    r = await pide('/api/proyectos/' + pid + '/llaves', { json: { nombre: 'Laptop prueba' } }); ok(r.status === 200 && r.j.llave.length === 48, 'crea llave'); const llave = r.j.llave;
    const conLlave = (ruta, o) => { o = o || {}; o.headers = Object.assign({ 'x-cde-llave': llave }, o.headers || {}); return fetch(B + ruta, o).then(async x => ({ status: x.status, j: await x.json() })); };
    r = await conLlave('/api/complemento/proyectos'); ok(r.status === 200 && r.j.proyectos[0].codigo === 'SECHURA', 'el complemento ve su proyecto');
    r = await fetch(B + '/api/proyectos/' + pid + '/subir?origen=complemento-revit', { method: 'POST', headers: { 'x-cde-llave': llave, 'x-nombre': encodeURIComponent('SECHURA-GHE-ZZ-XX-M3-S-0002-P01.rvt'), 'x-meta': encodeURIComponent('{"revit":"2024"}') }, body: Buffer.from('rvt estructuras') }).then(async x => ({ status: x.status, j: await x.json() })); ok(r.status === 200 && r.j.origen === undefined && r.j.n === 1, 'complemento sube version con llave'); const vidM = r.j.version;
    // paquete como lo arma Extractor.cs: 3 elementos, parametros canonicos + otros, geometria de 3 cubos
    const E = [[101, 'Muro basico [101]', 'A.rvt', 'Muros', 'Muro basico', 'Generico 200', 'Nivel 1', 1], [102, 'Muro basico [102]', 'A.rvt', 'Muros', 'Muro basico', 'Generico 200', 'Nivel 2', 1], [103, 'Puerta 0.90 [103]', 'A.rvt', 'Puertas', 'Puerta simple', 'Puerta 0.90', 'Nivel 1', 1]];
    const attrs = [[1, '● Modelo'], [2, '● Categoria'], [3, '● Familia'], [4, '● Tipo'], [5, '● Nivel'], [6, 'Cotas / Volumen'], [7, 'Identidad / UniqueId']];
    const vals = [[1, 'A.rvt'], [2, 'Muros'], [3, 'Puertas'], [4, 'Muro basico'], [5, 'Puerta simple'], [6, 'Generico 200'], [7, 'Puerta 0.90'], [8, 'Nivel 1'], [9, 'Nivel 2'], [10, '3.50 m³'], [11, 'uid-101'], [12, 'uid-102'], [13, 'uid-103']];
    const eavd = [[1, 1, 101, 1, 1], [2, 2, 101, 1], [2, 3, 103], [3, 4, 101, 1], [3, 5, 103], [4, 6, 101, 1], [4, 7, 103], [5, 8, 101, 2], [5, 9, 102], [6, 10, 101, 1], [7, 11, 101], [7, 12, 102], [7, 13, 103]];
    r = await conLlave('/api/modelos/' + pid + '/' + vidM + '/indice/inicio', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ modelos: ['A.rvt'], elementos: 3, parametros: 7, origen: 'complemento-revit' }) }); ok(r.status === 200 && r.j.subida, 'inicio de subida'); const sid = r.j.subida;
    r = await conLlave('/api/modelos/' + pid + '/' + vidM + '/indice/trozo/' + sid, { method: 'POST', body: zlib.gzipSync(JSON.stringify({ elem: E })) }); ok(r.status === 200 && r.j.n === 1, 'trozo 1 (elem, gzip)');
    r = await conLlave('/api/modelos/' + pid + '/' + vidM + '/indice/trozo/' + sid, { method: 'POST', body: JSON.stringify({ attrs, vals, eavd }) }); ok(r.status === 200 && r.j.n === 2, 'trozo 2 (attrs/vals/eavd, plano)');
    r = await conLlave('/api/modelos/' + pid + '/' + vidM + '/indice/trozo/' + sid, { method: 'POST', body: Buffer.from('no es json') }); ok(r.status === 400, 'trozo invalido → 400');
    r = await conLlave('/api/modelos/' + pid + '/' + vidM + '/geometria/' + sid, { method: 'POST', body: cdegDePrueba(E.map(x => x[0])) }); ok(r.status === 200, 'geometria .cdeg aceptada');
    r = await conLlave('/api/modelos/' + pid + '/' + vidM + '/indice/fin/' + sid, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); ok(r.status === 200 && r.j.estado === 'armando' && r.j.geometria, 'fin → armando');
    let est; for (let i = 0; i < 100; i++) { await duerme(100); est = (await pide('/api/modelos/' + pid + '/' + vidM + '/estado')).j; if (est.estado === 'listo' || est.estado === 'error') break; }
    ok(est.estado === 'listo', 'indice listo' + (est.error ? ' (' + est.error + ')' : '') + ' en ' + JSON.stringify(est.resumen).slice(0, 120));
    r = await pide('/api/modelos/' + pid + '/' + vidM + '/tablero'); ok(r.j.total === 3 && r.j.dims.cat.find(x => x[0] === 'Muros')[1] === 2 && r.j.dims.niv.find(x => x[0] === 'Nivel 1')[1] === 2, 'tablero (indice-modelos.js del visor): 3 elementos, Muros=2, Nivel 1=2');
    r = await pide('/api/modelos/' + pid + '/' + vidM + '/tablero?cat=Puertas'); ok(r.j.total === 1 && r.j.dims.niv.length === 1, 'filtro cat=Puertas → 1');
    r = await pide('/api/modelos/' + pid + '/' + vidM + '/parametros'); ok(Array.isArray(r.j) ? r.j.length === 7 : (r.j.parametros || r.j).length === 7, 'parametros: 7');
    r = await pide('/api/modelos/' + pid + '/' + vidM + '/elementos'); ok(r.j.n === 3 && r.j.diccionarios.cat.includes('Puertas'), 'elementos en columnas + diccionarios');
    r = await pide('/api/modelos/' + pid + '/' + vidM + '/elemento/103'); ok(r.j.elemento.cat === 'Puertas' && r.j.propiedades.find(p => p[0] === 'Identidad / UniqueId')[1] === 'uid-103', 'propiedades del elemento 103');
    r = await pide('/api/modelos/' + pid + '/' + vidM + '/geometria'); ok(r.status === 200 && r.j.subarray(0, 4).toString() === 'CDEG' && r.j.readUInt32LE(8) === 3, 'geometria devuelta: CDEG con 3 elementos');
    const cidM = (await pide('/api/proyectos/' + pid + '/contenedores')).j.contenedores.find(c => c.nombre === 'SECHURA-GHE-ZZ-XX-M3-S-0002').id;
    r = await pide('/api/proyectos/' + pid + '/contenedores/' + cidM); ok(r.j.versiones[0].indice && r.j.versiones[0].indice.estado === 'listo' && r.j.versiones[0].indice.geometria, 'la ficha del contenedor muestra indice listo con geometria');
    r = await pide('/api/modelos/' + pid + '/' + vidM + '/elementos-con?param=5&valores=' + encodeURIComponent('Nivel 1')); ok(r.j.e.length === 2 && r.j.e.includes(101) && r.j.e.includes(103), 'elementos-con (filtro por cualquier parametro): Nivel 1 → 101 y 103');
    r = await pide('/api/modelos/' + pid + '/' + vidM + '/elementos-con?param=6&vacio=1'); ok(r.j.e.length === 1 && r.j.e[0] === 103, 'elementos-con vacio=1: solo 103 no tiene Volumen');

    console.log('5b. Comparar versiones (por UniqueId, como el Visor BIM Federado)');
    // P02 del mismo modelo: 102 desaparece, 104 aparece, 101 cambia de volumen (y 3.50 = 3.5 no cuenta), "Editado por" cambia en todos (volatil)
    r = await fetch(B + '/api/proyectos/' + pid + '/subir?origen=complemento-revit', { method: 'POST', headers: { 'x-cde-llave': llave, 'x-nombre': encodeURIComponent('SECHURA-GHE-ZZ-XX-M3-S-0002-P02.rvt') }, body: Buffer.from('rvt estructuras v2') }).then(async x => ({ status: x.status, j: await x.json() })); ok(r.status === 200 && r.j.n === 2, 'P02 del mismo contenedor'); const vidM2 = r.j.version;
    const E2 = [[101, 'Muro basico [101]', 'A.rvt', 'Muros', 'Muro basico', 'Generico 200', 'Nivel 1', 1], [103, 'Puerta 0.90 [103]', 'A.rvt', 'Puertas', 'Puerta simple', 'Puerta 0.90', 'Nivel 1', 1], [104, 'Ventana [104]', 'A.rvt', 'Ventanas', 'Ventana fija', 'V-1', 'Nivel 2', 1], [105, 'Sala de espera [105]', 'A.rvt', 'Habitaciones', 'Habitación', 'Habitación', 'Nivel 1', 1]];
    const attrs2 = attrs.concat([[8, 'Identidad / Editado por'], [9, 'Identidad / Nombre'], [10, 'Identidad / Número'], [11, 'Cotas / Ancho'], [12, 'CGM_Subdepartamento']]), vals2 = vals.concat([[14, 'uid-104'], [15, '4.25 m³'], [16, 'erick'], [17, 'Ventanas'], [18, 'Ventana fija'], [19, 'V-1'], [20, '3.5 m³'], [21, 'Sala de espera'], [22, '105'], [23, '900 mm'], [24, 'Emergencia'], [25, 'Habitaciones'], [26, 'Habitación'], [27, 'uid-105']]);
    const eavd2 = [[1, 1, 101, 1, 1], [2, 2, 101], [2, 3, 103], [2, 17, 104], [3, 4, 101], [3, 5, 103], [3, 18, 104], [4, 6, 101], [4, 7, 103], [4, 19, 104], [2, 25, 105], [3, 26, 105], [4, 26, 105], [5, 8, 101, 2, 2], [5, 9, 104], [6, 15, 101], [7, 11, 101], [7, 13, 103], [7, 14, 104], [7, 27, 105], [8, 16, 101, 1, 1], [9, 21, 105], [10, 22, 105], [11, 23, 103], [12, 24, 105]];
    r = await conLlave('/api/modelos/' + pid + '/' + vidM2 + '/indice/inicio', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ modelos: ['A.rvt'], elementos: 4, parametros: 12 }) }); const sid2 = r.j.subida;
    await conLlave('/api/modelos/' + pid + '/' + vidM2 + '/indice/trozo/' + sid2, { method: 'POST', body: JSON.stringify({ elem: E2, attrs: attrs2, vals: vals2, eavd: eavd2 }) });
    await conLlave('/api/modelos/' + pid + '/' + vidM2 + '/geometria/' + sid2, { method: 'POST', body: cdegDePrueba(E2.map(x => x[0])) });
    await conLlave('/api/modelos/' + pid + '/' + vidM2 + '/indice/fin/' + sid2, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    for (let i = 0; i < 100; i++) { await duerme(100); est = (await pide('/api/modelos/' + pid + '/' + vidM2 + '/estado')).j; if (est.estado === 'listo' || est.estado === 'error') break; }
    ok(est.estado === 'listo', 'indice P02 listo');
    r = await pide('/api/modelos/' + pid + '/comparar?a=' + vidM + '&b=' + vidM2); ok(r.status === 200 && r.j.resumen.tot.nuevo === 2 && r.j.resumen.tot.eliminado === 1 && r.j.resumen.tot.modificado === 2 && r.j.resumen.tot.igual === 0, 'comparar: 2 nuevos (104, 105), 1 eliminado (102), 2 modificados (101 volumen, 103 ancho nuevo) ' + JSON.stringify(r.j.resumen && r.j.resumen.tot) + (r.j.mensaje || '') + (r.j.mensaje ? ' ' + r.j.mensaje : ''));
    const m101 = r.j.elementos.find(x => x.uid === 'uid-101'); ok(m101 && m101.e === 'modificado' && m101.c.length === 1 && m101.c[0].p === 'Cotas / Volumen' && m101.c[0].antes === '3.50 m³' && m101.c[0].ahora === '4.25 m³', '101: solo cambio Volumen (Editado por es volatil)');
    ok(r.j.elementos.find(x => x.uid === 'uid-102').e === 'eliminado' && r.j.elementos.find(x => x.uid === 'uid-104').e === 'nuevo' && r.j.resumen.porPar.some(p => p.p === 'Cotas / Volumen' && p.n === 1), 'estados por uid y parametros cambiados');
    r = await pide('/api/modelos/' + pid + '/comparar?a=' + vidM + '&b=' + vidM2 + '&formato=csv'); ok(r.status === 200 && r.j.toString('utf8').includes('uid-104') && r.j.toString('utf8').includes('Cotas / Ancho:  → 900 mm'), 'CSV de la comparacion');
    r = await pide('/api/modelos/' + pid + '/comparar?a=' + vidM + '&b=' + vidM); ok(r.status === 400, 'misma version → 400');
    console.log('5c. Ambientes, puertas y configuracion de Flujos hospitalarios');
    r = await pide('/api/modelos/' + pid + '/' + vidM2 + '/ambientes'); ok(r.status === 200 && r.j.ambientes.length === 1 && r.j.ambientes[0].nombre === 'Sala de espera' && r.j.ambientes[0].num === '105' && r.j.ambientes[0].subdep === 'Emergencia' && r.j.ambientes[0].nivel === 'Nivel 1', 'ambientes: Sala de espera 105 · Emergencia · Nivel 1 ' + JSON.stringify(r.j.ambientes));
    r = await pide('/api/modelos/' + pid + '/' + vidM2 + '/puertas'); ok(r.status === 200 && r.j.puertas.length === 1 && r.j.puertas[0].e === 103 && Math.abs(r.j.puertas[0].ancho - 0.9) < 1e-9 && /Ancho/.test(r.j.puertas[0].anchoDe), 'puertas: la 103 con ancho 0.90 m (de "900 mm") ' + JSON.stringify(r.j.puertas));
    r = await pide('/api/proyectos/' + pid + '/flujos-hospitalarios'); ok(r.status === 200 && r.j.config === null && r.j.puedeGuardar === true, 'config de flujos: vacia, el gestor puede guardar');
    r = await pide('/api/proyectos/' + pid + '/flujos-hospitalarios', { method: 'PUT', json: { config: { relaciones: [{ a: 'Emergencia', b: 'Centro quirúrgico', tipo: 'directa', maxM: 50 }, { a: '', b: 'x' }], clases: { sucio: 'residu|sucio' }, maxSalidaM: 45, anchoCamillaM: 1.2, salidasExtra: [103, 'x'] } } });
    ok(r.status === 200 && r.j.config.relaciones.length === 1 && r.j.config.maxSalidaM === 45 && r.j.config.salidasExtra.length === 1 && r.j.config.clases.sucio === 'residu|sucio', 'config guardada y saneada (relacion sin nombre fuera, salida no numerica fuera)');
    r = await pide('/api/proyectos/' + pid + '/flujos-hospitalarios', { method: 'PUT', json: { config: { clases: { sucio: '(' } } } }); ok(r.status === 400, 'regla invalida → 400');
    r = await pide('/api/proyectos/' + pid + '/flujos-hospitalarios'); ok(r.j.config && r.j.config.maxSalidaM === 45 && r.j.config.por, 'config persistida con quien la guardo');
    const CMP = require('../lib/comparar'); ok(CMP.mismoValor('3.50 m³', '3.5 m³') && CMP.mismoValor(' Nivel 1', 'Nivel 1') && !CMP.mismoValor('3.5', '3.6') && CMP.VOLATIL.test('Identidad / Editado por'), 'mismoValor: 3.50 = 3.5, espacios no cuentan, Editado por es volatil');
    r = await pide('/api/proyectos/' + pid + '/llaves/' + (await pide('/api/proyectos/' + pid + '/llaves')).j.llaves.find(l => l.nombre === 'Laptop prueba').id + '/revocar', { method: 'POST' });
    r = await conLlave('/api/complemento/proyectos'); ok(r.status === 401, 'llave revocada → 401');

    console.log('6. Auditoria y permisos');
    r = await pide('/api/proyectos/' + pid + '/auditoria'); ok(r.j.auditoria.length >= 15 && r.j.auditoria.some(a => a.accion === 'version.subir') && r.j.auditoria.some(a => a.accion === 'contenedor.estado'), 'auditoria registra subidas y estados (' + r.j.auditoria.length + ' filas)');
    galleta = ''; r = await pide('/api/acceso/local', { json: { email: 'bim@ghemet.com', clave: 'prueba' } });
    r = await pide('/api/proyectos/' + pid + '/llaves'); ok(r.status === 403, 'el autor no ve las llaves');
    r = await pide('/api/proyectos/' + pid + '/contenedores/' + cid + '/estado', { json: { estado: 'ARCHIVADO' } }); ok(r.status === 403, 'el autor no archiva');
    r = await pide('/api/proyectos/' + pid + '/auditoria'); ok(r.status === 403, 'el autor no ve la auditoria');

    console.log('7. Carpetas con permisos (plantilla ACC) y flujo con etapa en paralelo');
    galleta = ''; await pide('/api/acceso/local', { json: { email: 'admin@anin.gob.pe', clave: 'prueba' } });
    r = await pide('/api/proyectos', { json: { codigo: 'LACALETA', nombre: 'Hospital La Caleta', norma: 'default-iso19650', plantilla: 'acc', orgContr: 'GHEMET', orgSuper: 'SUPERV' } }); ok(r.status === 200, 'crea proyecto con plantilla ACC'); const ph = r.j.id;
    r = await pide('/api/proyectos/' + ph); ok(r.j.conCarpetas && r.j.config.carpetas.length > 20 && r.j.arbol.some(c => c.ruta === 'E3_DISEÑO PRELIMINAR/E3.01_COMPARTIDO (SHARED)/02. REVISIÓN DE PRESENTACIONES CONTRACTUALES/E3. Desarrollo de Ingeniería - Presentación 4.0 (P4.0)/E3.04.0.20 BIM') && r.j.flujos.length === 4, 'carpetas: ' + r.j.config.carpetas.length + ' (arbol ACC), flujos: ' + r.j.flujos.length);
    const WIP_G = 'E3_DISEÑO PRELIMINAR/E3.00_TRABAJO EN PROGRESO (WIP)/GHEMET', BIM = 'E3_DISEÑO PRELIMINAR/E3.01_COMPARTIDO (SHARED)/02. REVISIÓN DE PRESENTACIONES CONTRACTUALES/E3. Desarrollo de Ingeniería - Presentación 4.0 (P4.0)/E3.04.0.20 BIM', PUB = 'E3_DISEÑO PRELIMINAR/E3.02_PUBLICADO (PUBLISHED)';
    for (const [e, rol, org] of [['autor@ghemet.com', 'document-control', 'GHEMET'], ['rev@ghemet.com', 'revisor', 'GHEMET'], ['sup@superv.com', 'revisor', 'SUPERV'], ['sup2@superv.com', 'revisor', 'SUPERV'], ['esp@anin.gob.pe', 'revisor', 'ANIN'], ['gestor@anin.gob.pe', 'gestor', 'ANIN'], ['lector@anin.gob.pe', 'lector', 'ANIN']]) await pide('/api/proyectos/' + ph + '/miembros', { json: { email: e, rol, organizacion: org } });
    const entra = async (e) => { galleta = ''; await pide('/api/acceso/local', { json: { email: e, clave: 'prueba' } }); };
    const subeH = (nombre, carpeta) => fetch(B + '/api/proyectos/' + ph + '/subir?carpeta=' + encodeURIComponent(carpeta), { method: 'POST', headers: { cookie: galleta, 'x-nombre': encodeURIComponent(nombre) }, body: Buffer.from('x') }).then(async x => ({ status: x.status, j: await x.json() }));
    // carpetas: crear, renombrar, permisos, borrar
    r = await pide('/api/proyectos/' + ph + '/carpetas', { json: { padre: 'E3_DISEÑO PRELIMINAR/E3.01_COMPARTIDO (SHARED)/01. REVISIONES PREVIAS', nombre: 'Reunion 01' } }); ok(r.status === 200, 'el gestor crea una subcarpeta');
    r = await pide('/api/proyectos/' + ph + '/carpetas', { method: 'PUT', json: { ruta: r.j.ruta, nombre: 'Reunion 01 - arquitectura', permisos: [{ tipo: 'org', valor: 'GHEMET', nivel: 'ver' }] } }); ok(r.status === 200 && r.j.ruta.endsWith('Reunion 01 - arquitectura'), 'renombra y fija permisos propios');
    r = await pide('/api/proyectos/' + ph + '/carpetas/permisos?ruta=' + encodeURIComponent(r.j.ruta)); ok(r.j.propios && r.j.entradas.length === 1 && r.j.entradas[0].nivel === 'ver', 'la carpeta tiene permisos propios (ver para GHEMET)');
    r = await pide('/api/proyectos/' + ph + '/carpetas/permisos?ruta=' + encodeURIComponent(BIM)); ok(!r.j.propios && r.j.heredadasDe === 'E3_DISEÑO PRELIMINAR' && r.j.zonaEfectiva === 'compartido', 'E3.04.0.20 BIM hereda permisos de E3_DISEÑO PRELIMINAR y es zona compartido');
    r = await pide('/api/proyectos/' + ph + '/carpetas?ruta=' + encodeURIComponent('00_ADMIN_SUPERVISIÓN'), { method: 'DELETE' }); ok(r.status === 200, 'borra una carpeta vacia');
    await entra('autor@ghemet.com');
    r = await pide('/api/proyectos/' + ph); ok(r.j.carpetaWip === WIP_G && r.j.carpetasEscribibles.includes(BIM) && !r.j.carpetasEscribibles.includes('00_ADMIN_ENTIDAD') && !r.j.arbol.some(c => c.ruta.endsWith('(WIP)/SUPERV')), 'GHEMET: su WIP es su carpeta, escribe en compartido, no en ADMIN_ENTIDAD, y no ve el WIP de la Supervision');
    r = await pide('/api/proyectos/' + ph + '/carpetas', { json: { padre: '00_ADMIN_ENTIDAD', nombre: 'x' } }); ok(r.status === 403, 'GHEMET no crea carpetas en ADMIN_ENTIDAD');
    r = await pide('/api/proyectos/' + ph + '/carpetas', { json: { padre: '00_ADMIN_CONTRATISTA', nombre: 'Cartas' } }); ok(r.status === 200, 'GHEMET si crea subcarpetas donde tiene "editar"');
    r = await subeH('LACALETA-GHE-ZZ-XX-M3-A-0001-P01.rvt', '00_ADMIN_ENTIDAD'); ok(r.status === 403, 'GHEMET no sube a ADMIN_ENTIDAD');
    r = await subeH('LACALETA-GHE-ZZ-XX-M3-A-0001-P01.rvt', WIP_G); ok(r.status === 200 && r.j.estado === 'WIP', 'sube a su WIP → WIP'); const ch = r.j.contenedor;
    r = await subeH('LACALETA-GHE-ZZ-XX-DR-S-0002-P01.pdf', BIM); ok(r.status === 200 && r.j.estado === 'COMPARTIDO', 'sube directo a zona compartida → nace COMPARTIDO');
    await entra('sup@superv.com');
    r = await pide('/api/proyectos/' + ph + '/contenedores?carpeta=' + encodeURIComponent(WIP_G)); ok(r.j.contenedores.length === 0, 'la Supervision no ve el WIP de GHEMET');
    r = await pide('/api/proyectos/' + ph + '/contenedores?carpeta=' + encodeURIComponent('E3_DISEÑO PRELIMINAR') + '&sub=1'); ok(r.j.contenedores.length === 1, 'la Supervision si ve lo compartido');
    r = await pide('/api/proyectos/' + ph + '/versiones/' + r.j.contenedores[0].ultima.id + '/descargar'); ok(r.status === 200, 'y lo descarga (ver-descargar-subir)');
    await entra('lector@anin.gob.pe');
    r = await pide('/api/proyectos/' + ph + '/contenedores?carpeta=' + encodeURIComponent('E3_DISEÑO PRELIMINAR') + '&sub=1'); ok(r.j.contenedores.length === 1, 'un lector de ANIN ve lo compartido');
    // flujos: editar y crear uno con etapa en paralelo
    await entra('gestor@anin.gob.pe');
    r = await pide('/api/proyectos/' + ph + '/flujos'); ok(r.j.flujos.length === 4 && r.j.flujos.find(f => f.id === 'especialistas-paralelo').etapas[1].pasos.length === 2, 'flujos por defecto; el de especialistas tiene 2 pasos en paralelo');
    r = await pide('/api/proyectos/' + ph + '/flujos', { json: { nombre: 'Presentacion 4.0 - Levantamiento de observaciones', descripcion: 'Como en ACC pero con revision tecnica en paralelo', iniciadores: [{ tipo: 'org', valor: 'GHEMET' }], etapas: [{ nombre: 'Control documentario', pasos: [{ id: 'cd', nombre: 'Control documentario', tipo: 'uno', revisores: [{ tipo: 'org', valor: 'SUPERV' }], dias: 2 }] }, { nombre: 'Revision tecnica', pasos: [{ id: 'sup', nombre: 'Especialistas de la Supervision', tipo: 'todos', revisores: [{ tipo: 'org', valor: 'SUPERV' }], dias: 10 }, { id: 'anin', nombre: 'Especialista de ANIN', tipo: 'uno', revisores: [{ tipo: 'usuario', valor: 'esp@anin.gob.pe' }], dias: 10 }] }, { nombre: 'Aprobacion', pasos: [{ id: 'gp', nombre: 'Gerente de proyecto', tipo: 'uno', revisores: [{ tipo: 'rol', valor: 'gestor' }], dias: 3 }] }], alAprobar: { estado: 'PUBLICADO', idoneidad: 'A1', copiarA: PUB, iniciadorPuedeCambiar: true } } });
    ok(r.status === 200 && r.j.flujo.id.startsWith('presentacion-4-0') && r.j.flujo.etapas.length === 3, 'crea flujo de 3 etapas (la 2da con 2 pasos en paralelo, uno "todos")'); const fid = r.j.flujo.id;
    r = await pide('/api/proyectos/' + ph + '/flujos', { json: { nombre: 'Malo', etapas: [{ pasos: [{ nombre: 'x', revisores: [] }] }] } }); ok(r.status === 400, 'flujo sin revisores → rechazado');
    r = await pide('/api/proyectos/' + ph + '/flujos/' + fid, { method: 'PUT', json: { nombre: 'Presentacion 4.0 - Levantamiento de observaciones', iniciadores: [{ tipo: 'org', valor: 'GHEMET' }], etapas: [{ nombre: 'Control documentario', pasos: [{ id: 'cd', nombre: 'Control documentario', tipo: 'uno', revisores: [{ tipo: 'org', valor: 'SUPERV' }], dias: 2, devolverAlIniciador: true }] }, { nombre: 'Revision tecnica', pasos: [{ id: 'sup', nombre: 'Especialistas de la Supervision', tipo: 'todos', revisores: [{ tipo: 'org', valor: 'SUPERV' }], dias: 10 }, { id: 'anin', nombre: 'Especialista de ANIN', tipo: 'uno', revisores: [{ tipo: 'usuario', valor: 'esp@anin.gob.pe' }], dias: 10 }] }, { nombre: 'Aprobacion', pasos: [{ id: 'gp', nombre: 'Gerente de proyecto', tipo: 'uno', revisores: [{ tipo: 'rol', valor: 'gestor' }], dias: 3 }] }], alAprobar: { estado: 'PUBLICADO', idoneidad: 'A2', copiarA: PUB } } }); ok(r.status === 200 && r.j.flujo.alAprobar.idoneidad === 'A2', 'edita el flujo (idoneidad A2)');
    await entra('autor@ghemet.com');
    r = await pide('/api/proyectos/' + ph + '/contenedores/' + ch + '/estado', { json: { estado: 'COMPARTIDO' } }); ok(r.status === 400, 'WIP→COMPARTIDO desde zona WIP sin carpeta destino → pide carpeta');
    r = await pide('/api/proyectos/' + ph + '/contenedores/' + ch + '/estado', { json: { estado: 'COMPARTIDO', carpeta_destino: BIM, idoneidad: 'S3' } }); ok(r.status === 200 && r.j.carpeta === BIM, 'WIP→COMPARTIDO mueve a E3.04.0.20 BIM');
    r = await pide('/api/proyectos/' + ph + '/contenedores/' + ch + '/revisiones', { json: { flujo: 'coordinacion' } });
    r = await pide('/api/proyectos/' + ph + '/revisiones/' + r.j.id + '/anular', { json: { comentario: 'me equivoque de flujo' } }); ok(r.status === 200, 'el iniciador anula una ronda abierta');
    r = await pide('/api/proyectos/' + ph + '/contenedores/' + ch + '/revisiones', { json: { flujo: fid } }); ok(r.status === 200 && r.j.etapas.length === 3 && r.j.vence, 'inicia el flujo de 3 etapas con fecha limite de la etapa 1'); const rh = r.j.id;
    await entra('sup2@superv.com'); r = await pide('/api/proyectos/' + ph + '/revisiones/' + rh + '/decidir', { json: { decision: 'aprobar' } }); ok(r.status === 200 && r.j.etapa === 1, 'etapa 1 (control documentario, cualquiera de SUPERV) → etapa 2');
    await entra('esp@anin.gob.pe'); r = await pide('/api/proyectos/' + ph + '/revisiones'); const miR = r.j.revisiones.find(x => x.id === rh); ok(miR.puedoDecidir && miR.decidibles.includes('anin') && miR.siguienteAccionDe.length === 2, 'etapa 2 en paralelo: el especialista de ANIN tiene su paso pendiente y hay 2 pasos esperando');
    r = await pide('/api/proyectos/' + ph + '/revisiones/' + rh + '/decidir', { json: { decision: 'aprobar-con-comentarios', comentario: 'ok con observaciones' } }); ok(r.status === 200 && r.j.estado === 'abierta' && r.j.etapa === 1 && r.j.pendientes.length === 1, 'ANIN aprueba su paso; la etapa sigue abierta esperando a la Supervision');
    r = await pide('/api/proyectos/' + ph + '/revisiones/' + rh + '/decidir', { json: { decision: 'aprobar' } }); ok(r.status === 403, 'no puede decidir dos veces ni el paso ajeno');
    await entra('sup@superv.com'); r = await pide('/api/proyectos/' + ph + '/revisiones/' + rh + '/decidir', { json: { decision: 'aprobar' } }); ok(r.status === 200 && r.j.etapa === 1 && r.j.pendientes.length === 1, 'paso "todos": con 1 de 2 revisores de SUPERV aun no completa');
    await entra('sup2@superv.com'); r = await pide('/api/proyectos/' + ph + '/revisiones/' + rh + '/decidir', { json: { decision: 'aprobar' } }); ok(r.status === 200 && r.j.etapa === 2 && r.j.siguiente === 'Aprobacion', 'el segundo revisor completa "todos" → etapa 3');
    await entra('rev@ghemet.com'); r = await pide('/api/proyectos/' + ph + '/revisiones/' + rh + '/decidir', { json: { decision: 'aprobar' } }); ok(r.status === 403, 'etapa 3 (gestor) no la decide GHEMET');
    await entra('gestor@anin.gob.pe'); r = await pide('/api/proyectos/' + ph + '/revisiones/' + rh + '/decidir', { json: { decision: 'aprobar' } }); ok(r.status === 200 && r.j.estado === 'aprobada-con-comentarios' && r.j.contenedor.estado === 'PUBLICADO' && r.j.contenedor.carpeta_publicada === PUB, 'el gestor aprueba → PUBLICADO con copia en E3.02_PUBLICADO (y la ronda recuerda la aprobacion con comentarios)');
    r = await pide('/api/proyectos/' + ph + '/contenedores?carpeta=' + encodeURIComponent(PUB)); ok(r.j.contenedores.length === 1 && r.j.contenedores[0].copia === true, 'la carpeta PUBLICADO lista la copia');
    r = await pide('/api/proyectos/' + ph + '/contenedores/' + ch); ok(r.j.estado === 'PUBLICADO' && r.j.versiones[0].idoneidad === 'A2' && r.j.revisiones[0].pasos.length === 5 && r.j.revisiones[0].flujo.etapas.length === 3, 'ficha: A2, 5 decisiones, flujo guardado en la ronda');
    // devolver desde una etapa en paralelo
    await entra('autor@ghemet.com'); r = await subeH('LACALETA-GHE-ZZ-XX-DR-S-0002-P02.pdf', BIM); const ch2 = r.j.contenedor;
    r = await pide('/api/proyectos/' + ph + '/contenedores/' + ch2 + '/revisiones', { json: { flujo: fid } }); const rh2 = r.j.id;
    await entra('sup@superv.com'); await pide('/api/proyectos/' + ph + '/revisiones/' + rh2 + '/decidir', { json: { decision: 'aprobar' } });
    r = await pide('/api/proyectos/' + ph + '/revisiones/' + rh2 + '/decidir', { json: { decision: 'devolver', paso: 'sup', comentario: 'Falta memoria' } }); ok(r.status === 200 && r.j.estado === 'devuelta' && r.j.contenedor.estado === 'WIP', 'devolver en la etapa paralela cierra la ronda y el contenedor vuelve a WIP');
    r = await pide('/api/proyectos/' + ph + '/flujos/' + fid, { method: 'DELETE' }); ok(r.status === 403 || r.status === 200, 'borrar flujo: revisor sin permiso (' + r.status + ')');

    console.log('8. Incidencias con metadatos y enlace al modelo');
    await entra('autor@ghemet.com');
    r = await pide('/api/proyectos/' + ph + '/incidencias', { json: { titulo: 'Tuberia atraviesa viga', tipo: 'interferencia', disciplina: 'Instalaciones Sanitarias', etapa: 'P01', nivel: 'Nivel 2', ambiente: 'UPSS Emergencia', impacto: ['plazo', 'calidad', 'x'], origen: 'coordinacion-3d', responsable_org: 'GHEMET', referencia: 'Reporte de interferencias 03', contractual: true, contenedor_id: ch, elementos: [{ e: 101, uid: 'u1' }], camara: { pos: [1, 2, 3], dir: [0, 1, 0] } } });
    ok(r.status === 200 && r.j.codigo === 'INC-LACALETA-0001', 'codigo INC-LACALETA-0001');
    r = await pide('/api/proyectos/' + ph + '/incidencias?disciplina=' + encodeURIComponent('Instalaciones Sanitarias') + '&etapa=P01'); ok(r.j.incidencias.length === 1 && r.j.incidencias[0].impacto.length === 2 && r.j.catalogos.estados.length === 6, 'filtros por disciplina/etapa; impacto saneado; catalogos');
    r = await pide('/api/proyectos/' + ph + '/incidencias/' + r.j.incidencias[0].id); ok(r.j.contenedor && r.j.contenedor.nombre && !r.j.modelo_visible, 'ficha con contenedor y sin modelo visible (no hay geometria)');
    const iidh = r.j.id;
    r = await pide('/api/proyectos/' + ph + '/incidencias/' + iidh + '/comentar', { json: { estado: 'verificada' } }); ok(r.status === 200, 'el autor verifica');
    await entra('sup@superv.com'); r = await pide('/api/proyectos/' + ph + '/incidencias/' + iidh + '/comentar', { json: { texto: 'Corregido en P02', estado: 'respondida', asignado: 'autor@ghemet.com' } }); ok(r.status === 200, 'la Supervision responde y asigna');
    r = await pide('/api/proyectos/' + ph + '/incidencias/' + iidh); ok(r.j.estado === 'respondida' && r.j.respondido && r.j.asignado === 'autor@ghemet.com' && r.j.comentarios.length >= 2, 'historial y marcas de tiempo');
    r = await pide('/api/proyectos/' + ph + '/incidencias.bcfzip'); ok(r.status === 200 && r.j.toString('latin1').includes('<Stage>P01</Stage>') && r.j.toString('latin1').includes('Instalaciones Sanitarias'), 'BCF lleva etapa y disciplina');

    console.log('9. Correspondencia (tipo Aconex) y registros NEC');
    await entra('autor@ghemet.com');
    r = await pide('/api/proyectos/' + ph + '/correspondencia/tipos'); ok(r.j.tipos.length >= 10 && r.j.tipos.find(t => t.id === 'instruccion').puedoEmitir === false && r.j.tipos.find(t => t.id === 'rfi').puedoEmitir, 'tipos por defecto; GHEMET no emite instrucciones del GP pero si RFI');
    r = await pide('/api/proyectos/' + ph + '/correspondencia', { json: { tipo: 'instruccion', asunto: 'x', para: ['ANIN'] } }); ok(r.status === 403, 'GHEMET no puede crear una instruccion del GP');
    r = await pide('/api/proyectos/' + ph + '/correspondencia', { json: { tipo: 'rfi', asunto: 'Altura libre en sala de maquinas', cuerpo: 'Se consulta la altura libre minima.', para: [{ org: 'SUPERV' }], cc: ['esp@anin.gob.pe'], campos: { disciplina: 'Arquitectura' }, adjuntos: [{ tipo: 'version', id: vid1 }] } }); ok(r.status === 200 && r.j.estado === 'borrador', 'crea un RFI como borrador'); const m1 = r.j.id;
    r = await fetch(B + '/api/proyectos/' + ph + '/correspondencia/' + m1 + '/adjuntar', { method: 'POST', headers: { cookie: galleta, 'x-nombre': encodeURIComponent('croquis.pdf') }, body: Buffer.from('%PDF-1.4 croquis') }).then(async x => ({ status: x.status, j: await x.json() })); ok(r.status === 200 && r.j.adjunto.tamano === 16, 'adjunta un archivo suelto al borrador');
    await entra('sup@superv.com'); r = await pide('/api/proyectos/' + ph + '/correspondencia/' + m1); ok(r.status === 403, 'el borrador no lo ve el destinatario');
    await entra('autor@ghemet.com'); r = await pide('/api/proyectos/' + ph + '/correspondencia/' + m1 + '/enviar', { json: {} }); ok(r.status === 200 && r.j.numero === 'GHEMET-RFI-000001', 'enviar numera GHEMET-RFI-000001');
    r = await pide('/api/proyectos/' + ph + '/correspondencia?bandeja=enviados'); ok(r.j.correos.length === 1 && r.j.correos[0].estadoRespuesta === 'pendiente' && r.j.correos[0].vence, 'bandeja enviados: pendiente con fecha limite (7 dias del tipo)');
    r = await pide('/api/proyectos/' + ph + '/correspondencia/' + m1, { method: 'PUT', json: { asunto: 'otro' } }); ok(r.status === 409, 'lo enviado no se edita');
    await entra('sup@superv.com'); r = await pide('/api/proyectos/' + ph + '/correspondencia?bandeja=recibidos'); ok(r.j.correos.length === 1 && r.j.conteo.sinLeer === 1 && r.j.conteo.pendientesMios === 1, 'la Supervision lo recibe (por organizacion): 1 sin leer, 1 pendiente');
    r = await pide('/api/proyectos/' + ph + '/correspondencia/' + m1); ok(r.j.adjuntos.length === 2 && r.j.adjuntos[0].contenedor && r.j.puedoResponder && r.j.lecturas.length === 1, 'abrirlo marca lectura; adjuntos resueltos (version + archivo)');
    r = await pide('/api/proyectos/' + ph + '/correspondencia/' + m1 + '/adjunto/' + r.j.adjuntos[1].id); ok(r.status === 200 && r.j.toString() === '%PDF-1.4 croquis', 'descarga el archivo adjunto');
    r = await pide('/api/proyectos/' + ph + '/correspondencia', { json: { tipo: 'carta', asunto: 'RE: Altura libre', cuerpo: 'La altura libre minima es 2.70 m.', para: [{ org: 'GHEMET' }], responde_a: m1, enviar: true } }); ok(r.status === 200 && r.j.numero === 'SUPERV-CAR-000001', 'responde con una carta (SUPERV-CAR-000001)');
    r = await pide('/api/proyectos/' + ph + '/correspondencia/' + m1); ok(r.j.estadoRespuesta === 'respondido' && r.j.hilo.length === 2, 'el RFI pasa a respondido y el hilo tiene 2 correos');
    await entra('autor@ghemet.com'); r = await pide('/api/proyectos/' + ph + '/correspondencia/' + m1 + '/cerrar', { json: {} }); ok(r.status === 200, 'el emisor cierra el RFI');
    await entra('esp@anin.gob.pe'); r = await pide('/api/proyectos/' + ph + '/correspondencia?bandeja=recibidos'); ok(r.j.correos.length === 1 && r.j.correos[0].estadoRespuesta === 'cerrado', 'el CC lo ve cerrado');
    // alerta temprana desde un correo del tipo
    await entra('autor@ghemet.com');
    r = await pide('/api/proyectos/' + ph + '/correspondencia', { json: { tipo: 'alerta-temprana', asunto: 'Posible demora en entrega de equipos', cuerpo: 'El proveedor avisa 4 semanas de atraso.', para: ['ANIN'], campos: { asunto_riesgo: 'Plazo de terminacion', reunion: 'Si' }, enviar: true } }); ok(r.status === 200 && r.j.registro && r.j.registro.codigo === 'AT-001', 'un correo de alerta temprana abre AT-001 en el registro');
    r = await pide('/api/proyectos/' + ph + '/alertas-tempranas'); ok(r.j.alertas.length === 1 && r.j.alertas[0].estado === 'abierta' && r.j.alertas[0].correo_numero === 'GHEMET-AT-000001', 'registro de alertas tempranas con el numero del correo'); const atid = r.j.alertas[0].id;
    await entra('gestor@anin.gob.pe'); r = await pide('/api/proyectos/' + ph + '/alertas-tempranas/' + atid, { json: { estado: 'en-seguimiento', acciones: 'Reunion de alerta temprana el lunes; buscar proveedor alterno', responsable: 'autor@ghemet.com', fecha_reunion: '2026-11-16', nota: 'tratado en reunion' } }); ok(r.status === 200, 'el gestor actualiza la alerta (acciones, responsable, reunion)');
    // evento compensable: notificacion → respuesta del GP → cotizacion → aceptacion → implementado
    await entra('autor@ghemet.com');
    r = await pide('/api/proyectos/' + ph + '/correspondencia', { json: { tipo: 'notificacion-ec', asunto: 'Condiciones fisicas imprevistas en cimentacion', cuerpo: 'Se encontro roca a -1.20 m.', para: ['ANIN'], campos: { clausula: '60.1(12) Condiciones fisicas', alerta_temprana: 'AT-001' }, enviar: true } }); ok(r.status === 200 && r.j.registro.codigo === 'EC-001', 'una notificacion de evento compensable abre EC-001');
    r = await pide('/api/proyectos/' + ph + '/eventos-compensables'); const ec = r.j.eventos[0]; ok(ec.estado === 'notificado' && ec.plazo_respuesta && ec.alerta_codigo === 'AT-001' && ec.siguiente.some(s => s.accion === 'aceptar') && r.j.plazos.cotizacion_semanas === 3, 'registro EC: notificado, plazo de respuesta del GP (1 semana), vinculado a AT-001');
    r = await pide('/api/proyectos/' + ph + '/eventos-compensables/' + ec.id + '/avanzar', { json: { accion: 'aceptar' } }); ok(r.status === 403, 'la respuesta a la notificacion la da la Entidad, no GHEMET');
    await entra('gestor@anin.gob.pe'); r = await pide('/api/proyectos/' + ph + '/eventos-compensables/' + ec.id + '/avanzar', { json: { accion: 'aceptar', comentario: 'Es un evento compensable; presentar cotizacion.' } }); ok(r.status === 200 && r.j.estado === 'cotizacion-instruida' && /^ANIN-REC-/.test(r.j.correo), 'el GP acepta: estado cotizacion-instruida y correo ANIN-REC-000001');
    await entra('autor@ghemet.com'); r = await pide('/api/proyectos/' + ph + '/eventos-compensables/' + ec.id + '/avanzar', { json: { accion: 'cotizar', monto: 185000, dias: 12, comentario: 'Cotizacion adjunta.' } }); ok(r.status === 200 && r.j.estado === 'cotizacion-presentada' && /^GHEMET-COT-/.test(r.j.correo), 'GHEMET cotiza: cotizacion-presentada con correo GHEMET-COT');
    await entra('gestor@anin.gob.pe'); r = await pide('/api/proyectos/' + ph + '/eventos-compensables/' + ec.id + '/avanzar', { json: { accion: 'aceptar-cotizacion' } }); r = await pide('/api/proyectos/' + ph + '/eventos-compensables/' + ec.id + '/avanzar', { json: { accion: 'implementar' } }); ok(r.status === 200 && r.j.estado === 'implementado', 'aceptar cotizacion e implementar');
    r = await pide('/api/proyectos/' + ph + '/eventos-compensables'); ok(r.j.eventos[0].monto === 185000 && r.j.eventos[0].dias === 12 && r.j.eventos[0].historial.length === 5 && r.j.resumen.monto === 185000, 'el registro guarda monto, dias e historial de 5 pasos; resumen suma lo implementado');
    r = await pide('/api/proyectos/' + ph + '/correspondencia?bandeja=todos'); ok(r.j.correos.filter(c => c.registro_id === ec.id).length === 5, 'cada paso del evento dejo su correo (5 en el hilo del evento)');
    // linea de comunicacion (Aconex): todas las respuestas cuelgan del correo que abrio la linea y comparten su numero de referencia
    r = await pide('/api/proyectos/' + ph + '/correspondencia/' + ec.correo_id); const raizEc = r.j.numero;
    ok(r.j.hilo.length === 5 && r.j.hilo.map(h => h.nivel).join('') === '01234' && r.j.hilo[0].id === ec.correo_id && r.j.hilo[1].responde_a === ec.correo_id && r.j.referencia === raizEc && r.j.estadoRespuesta === 'respondido', 'la linea del evento: 5 correos encadenados (cada paso responde al anterior) y la notificacion queda respondida');
    r = await pide('/api/proyectos/' + ph + '/correspondencia/' + r.j.hilo[4].id); ok(r.j.referencia === raizEc && r.j.numero !== raizEc && r.j.respondeA && r.j.registro && r.j.registro.codigo === 'EC-001', 'el ultimo paso lleva el numero de referencia de la notificacion y enlaza el registro EC-001');
    r = await pide('/api/proyectos/' + ph + '/correspondencia?bandeja=todos&q=' + encodeURIComponent(raizEc)); ok(r.j.correos.length === 5 && r.j.correos.every(c => c.referencia === raizEc && c.enLinea === 5), 'buscar el numero de referencia trae la linea completa');
    r = await pide('/api/proyectos/' + ph + '/alertas-tempranas'); const atCorreo = r.j.alertas[0].correo_id, atHist = r.j.alertas[0].historial; ok(/^ANIN-FB-/.test(atHist[atHist.length - 1].correo || ''), 'la actualizacion de la alerta temprana salio como Retroalimentacion (ANIN-FB-…)');
    r = await pide('/api/proyectos/' + ph + '/correspondencia/' + atCorreo); ok(r.j.hilo.length === 2 && r.j.hilo[1].tipo === 'retroalimentacion' && r.j.hilo[1].nivel === 1 && r.j.estadoRespuesta === 'respondido' && r.j.referencia === 'GHEMET-AT-000001', 'y quedo en la linea de la alerta (misma referencia), que pasa a respondida');
    await entra('autor@ghemet.com'); r = await pide('/api/proyectos/' + ph + '/correspondencia/' + r.j.hilo[1].id); ok(r.status === 200 && /tratado en reunion/.test(r.j.cuerpo) && r.j.puedoResponder, 'quien notifico la alerta recibe la retroalimentacion y puede responderla');
    r = await pide('/api/proyectos/' + ph + '/correspondencia', { json: { tipo: 'rfi', asunto: 'Consulta para reenviar', para: ['ANIN'], enviar: true } }); const mF = r.j.id;
    await entra('gestor@anin.gob.pe'); r = await pide('/api/proyectos/' + ph + '/correspondencia', { json: { tipo: 'retroalimentacion', asunto: 'Fw: Consulta para reenviar', para: ['esp@anin.gob.pe'], responde_a: mF, reenvio: true, enviar: true } }); ok(r.status === 200 && /^ANIN-FB-/.test(r.j.numero), 'reenviar dentro de la linea con Retroalimentacion');
    r = await pide('/api/proyectos/' + ph + '/correspondencia/' + mF); ok(r.j.estadoRespuesta === 'pendiente' && r.j.hilo.length === 2 && r.j.hilo[1].reenvio === true, 'reenviar no cuenta como respuesta: el original sigue pendiente y el reenvio cuelga de el');
    r = await pide('/api/proyectos/' + ph + '/correspondencia/tipos', { method: 'PUT', json: { tipos: [{ id: 'carta', nombre: 'Carta', prefijo: 'CAR', respuesta: 'ninguna', dias: 0, emiten: ['*'] }, { nombre: 'Orden de cambio', prefijo: 'ODC', respuesta: 'aprobacion', dias: 10, emiten: ['ANIN'], campos: [{ id: 'monto', nombre: 'Monto', obligatorio: true }] }] } }); ok(r.status === 200 && r.j.tipos.length === 2 && r.j.tipos[1].id === 'orden-de-cambio', 'el gestor redefine los tipos de correo');
    r = await pide('/api/proyectos/' + ph + '/correspondencia', { json: { tipo: 'orden-de-cambio', asunto: 'ODC 1', para: ['GHEMET'], enviar: true } }); ok(r.status === 400 && /obligatorio/.test(r.j.mensaje), 'campo obligatorio del tipo: no se envia sin el');
    r = await pide('/api/proyectos/' + ph + '/correspondencia/tipos'); ok(r.j.tipos.some(t => t.id === 'retroalimentacion' && t.puedoEmitir), 'Retroalimentacion existe siempre, aunque el proyecto edite sus tipos');
    r = await pide('/api/proyectos/' + ph); ok(r.j.resumen.alertasAbiertas === 1 && r.j.resumen.eventosAbiertos === 0, 'el resumen del proyecto cuenta alertas y eventos abiertos');

    console.log('10. Plantilla por etapas (E1 > WIP / COM / PUB > partes), desplazar, desencadenador y ZIP');
    galleta = ''; await pide('/api/acceso/local', { json: { email: 'admin@anin.gob.pe', clave: 'prueba' } });
    r = await pide('/api/proyectos', { json: { codigo: 'SECHURA2', nombre: 'CS Sechura', norma: 'default-iso19650', plantilla: 'wcp', orgContr: 'GHEMET', orgSuper: 'SUPERV', conSuper: false, etapas: [{ codigo: 'E1', nombre: '' }, { codigo: 'E2', nombre: 'PREINVERSIÓN' }, { codigo: 'E3', nombre: 'DISEÑO' }, { codigo: 'E4' }, { codigo: 'E5' }, { codigo: 'E6' }], etapaActual: 'E3' } }); ok(r.status === 200, 'crea proyecto con la plantilla por etapas sin Supervision'); const pw = r.j.id;
    r = await pide('/api/proyectos/' + pw); const rutas = r.j.arbol.map(c => c.ruta);
    ok(r.j.config.carpetas.length === 54 && rutas[0] === 'E1' && rutas.indexOf('E1/WIP') < rutas.indexOf('E1/COM') && rutas.indexOf('E1/COM') < rutas.indexOf('E1/PUB') && rutas.indexOf('E1/PUB/PUB CLIENTE') < rutas.indexOf('E2_PREINVERSIÓN'), 'por etapas: 54 carpetas (6 x 9), la etapa manda y dentro WIP → COM → PUB (' + r.j.config.carpetas.length + ')');
    ok(rutas.includes('E3_DISEÑO/WIP/WIP CONTRATISTA') && rutas.includes('E1/COM/COM CLIENTE') && rutas.includes('E2_PREINVERSIÓN/PUB/PUB CLIENTE') && !rutas.some(x => /SUPERVISI/.test(x)) && JSON.stringify(r.j.config.partes) === JSON.stringify({ CLIENTE: 'ANIN', CONTRATISTA: 'GHEMET' }), 'etapas con nombre (E3_DISEÑO) y sin nombre (E1); sin SUPERVISIÓN; partes guardadas');
    r = await pide('/api/proyectos/' + pw + '/carpetas/permisos?ruta=' + encodeURIComponent('E3_DISEÑO/COM/COM CONTRATISTA')); ok(r.j.propios && r.j.zonaEfectiva === 'compartido' && r.j.entradas.some(e => e.valor === 'GHEMET' && e.nivel === 'ver-descargar-subir-editar'), 'COM CONTRATISTA: zona compartido, la edita GHEMET');
    for (const [e, rol, org] of [['autor@ghemet.com', 'document-control', 'GHEMET'], ['esp@anin.gob.pe', 'revisor', 'ANIN'], ['gestor@anin.gob.pe', 'gestor', 'ANIN']]) await pide('/api/proyectos/' + pw + '/miembros', { json: { email: e, rol, organizacion: org } });
    await entra('autor@ghemet.com');
    r = await pide('/api/proyectos/' + pw); ok(r.j.carpetaWip === 'E3_DISEÑO/WIP/WIP CONTRATISTA' && r.j.carpetasEscribibles.includes('E1/COM/COM CONTRATISTA') && !r.j.carpetasEscribibles.includes('E1/COM/COM CLIENTE') && !r.j.arbol.some(c => c.ruta === 'E1/WIP/WIP CLIENTE') && r.j.arbol.some(c => c.ruta === 'E1/PUB/PUB CLIENTE'), 'GHEMET: su WIP es E3_DISEÑO/WIP/WIP CONTRATISTA (etapa en curso), escribe en COM CONTRATISTA, no en COM CLIENTE, no ve WIP CLIENTE y si ve PUB (' + r.j.carpetaWip + ')');
    const subeW = (nombre, carpeta) => fetch(B + '/api/proyectos/' + pw + '/subir' + (carpeta ? '?carpeta=' + encodeURIComponent(carpeta) : ''), { method: 'POST', headers: { cookie: galleta, 'x-nombre': encodeURIComponent(nombre) }, body: Buffer.from('contenido ' + nombre) }).then(async x => ({ status: x.status, j: await x.json() }));
    r = await subeW('SECHURA2-GHE-ZZ-XX-DR-A-0001-P01.pdf', 'E3_DISEÑO/COM/COM CONTRATISTA'); ok(r.status === 200 && r.j.estado === 'COMPARTIDO' && !r.j.revisionAutomatica, 'sube a COM CONTRATISTA → nace COMPARTIDO (sin desencadenador)'); const cw = r.j.contenedor;
    r = await subeW('SECHURA2-GHE-ZZ-XX-DR-A-0002-P01.pdf', 'E3_DISEÑO/WIP/WIP CLIENTE'); ok(r.status === 403, 'GHEMET no sube a WIP CLIENTE');
    r = await subeW('SECHURA2-GHE-ZZ-XX-M3-A-0003-P01.rvt'); ok(r.status === 200 && r.j.carpeta === 'E3_DISEÑO/WIP/WIP CONTRATISTA' && r.j.estado === 'WIP', 'sin carpeta (complemento) → su WIP de la etapa en curso');
    r = await pide('/api/proyectos/' + pw + '/contenedores/' + cw + '/revisiones', { json: { flujo: 'coordinacion', comentario: 'ronda 1 desde COM' } }); ok(r.status === 200 && r.j.ronda === 1, 'el autor inicia la revision de un contenedor COM (' + (r.j.mensaje || '') + ')');
    await entra('gestor@anin.gob.pe');
    // desencadenador automatico
    r = await pide('/api/proyectos/' + pw + '/carpetas', { method: 'PUT', json: { ruta: 'E3_DISEÑO/COM/COM CONTRATISTA', disparador: { flujo: 'no-existe' } } }); ok(r.status === 400, 'desencadenador con flujo inexistente → 400');
    r = await pide('/api/proyectos/' + pw + '/carpetas', { method: 'PUT', json: { ruta: 'E3_DISEÑO/COM/COM CONTRATISTA', disparador: { flujo: 'coordinacion' } } }); ok(r.status === 200, 'el gestor pone un desencadenador en COM CONTRATISTA');
    r = await pide('/api/proyectos/' + pw); ok((r.j.config.carpetas.find(c => c.ruta === 'E3_DISEÑO/COM/COM CONTRATISTA') || {}).disparador.flujo === 'coordinacion', 'el desencadenador queda guardado en la carpeta');
    await entra('autor@ghemet.com');
    r = await subeW('SECHURA2-GHE-ZZ-XX-DR-A-0004-P01.pdf', 'E3_DISEÑO/COM/COM CONTRATISTA'); ok(r.status === 200 && r.j.revisionAutomatica && r.j.revisionAutomatica.ronda === 1, 'cargar en esa carpeta inicia la revision sola (' + JSON.stringify(r.j.revisionAutomatica) + ')'); const cw4 = r.j.contenedor;
    r = await pide('/api/proyectos/' + pw + '/revisiones'); ok(r.j.revisiones.some(x => x.contenedor_id === cw4 && x.estado === 'abierta' && /automaticamente/.test(x.comentario || '')), 'la ronda automatica aparece en Revisiones');
    r = await pide('/api/proyectos/' + pw + '/carpetas/mover', { json: { ruta: 'E3_DISEÑO/COM/COM CONTRATISTA', destino: 'E1/COM' } }); ok(r.status === 403, 'GHEMET no desplaza a una carpeta sin "editar" (E1/COM)');
    // descargar carpeta en ZIP
    r = await fetch(B + '/api/proyectos/' + pw + '/carpetas/descargar?ruta=' + encodeURIComponent('E3_DISEÑO'), { headers: { cookie: galleta } }); const zip = Buffer.from(await r.arrayBuffer());
    ok(r.status === 200 && zip.readUInt32LE(0) === 0x04034b50 && zip.includes(Buffer.from('COM/COM CONTRATISTA/SECHURA2-GHE-ZZ-XX-DR-A-0001-P01.pdf')) && zip.includes(Buffer.from('WIP/WIP CONTRATISTA/SECHURA2-GHE-ZZ-XX-M3-A-0003-P01.rvt')) && zip.readUInt32LE(zip.length - 22) === 0x06054b50 && zip.readUInt16LE(zip.length - 12) === 3, 'ZIP de E3_DISEÑO con 3 archivos y sus subcarpetas (' + r.status + ', ' + zip.length + ' bytes)');
    { // v0.19: el mismo codigo en otro formato es otro documento (como en Forma), con sus propias versiones
      const wipC = 'E3_DISEÑO/WIP/WIP CONTRATISTA';
      const a1 = await subeW('SECHURA2-GHE-ZZ-XX-DR-A-0009.pdf', wipC), a2 = await subeW('SECHURA2-GHE-ZZ-XX-DR-A-0009.docx', wipC), a3 = await subeW('SECHURA2-GHE-ZZ-XX-DR-A-0009.pdf', wipC);
      ok(a1.status === 200 && a2.status === 200 && a3.status === 200 && a1.j.contenedor !== a2.j.contenedor && a3.j.contenedor === a1.j.contenedor && a2.j.n === 1 && a3.j.n === 2, 'el .pdf y el .docx del mismo código son dos documentos; otra carga del .pdf es su versión 2');
    }
    { // v0.19.1: permisos por empresa («Empresa: …» en Agregar permisos) y la comprobación de Autodesk solo para administradores y gestores
      const rC = 'E1/WIP/WIP CLIENTE';
      await entra('gestor@anin.gob.pe'); const pr = (await pide('/api/proyectos/' + pw + '/carpetas/permisos?ruta=' + encodeURIComponent(rC))).j;
      const dg = (await pide('/api/forma/diagnostico')).status;
      await entra('autor@ghemet.com'); const da = (await pide('/api/forma/diagnostico')).status;
      ok(dg === 200 && da === 403, 'la comprobación de la aplicación de Autodesk la ve el gestor y no un usuario sin gestión (' + dg + '/' + da + ')');
      const antes = (await pide('/api/proyectos/' + pw)).j.arbol.some(c => c.ruta === rC);
      await entra('gestor@anin.gob.pe'); const put = (await pide('/api/proyectos/' + pw + '/carpetas', { method: 'PUT', json: { ruta: rC, permisos: pr.entradas.concat([{ tipo: 'org', valor: 'GHEMET', nivel: 'ver-descargar' }]) } })).status;
      await entra('autor@ghemet.com'); const despues = (await pide('/api/proyectos/' + pw)).j.arbol.some(c => c.ruta === rC);
      await entra('gestor@anin.gob.pe'); await pide('/api/proyectos/' + pw + '/carpetas', { method: 'PUT', json: { ruta: rC, permisos: pr.propios ? pr.entradas : [] } });
      await entra('autor@ghemet.com'); const otraVez = (await pide('/api/proyectos/' + pw)).j.arbol.some(c => c.ruta === rC);
      ok(!antes && put === 200 && despues && !otraVez, 'un permiso por empresa (GHEMET) abre la carpeta a sus usuarios y al quitarlo se vuelve a cerrar');
    }
    { // v0.20: foto de perfil solo para administradores y gestores; se guarda en la base (disco permanente), no en la carpeta del programa
      const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
      const subeF = (b) => fetch(B + '/api/perfil/foto', { method: 'POST', headers: { cookie: galleta, 'Content-Type': 'image/jpeg' }, body: b }).then(async x => ({ status: x.status, j: await x.json() }));
      await entra('autor@ghemet.com'); const pa = (await pide('/api/perfil')).j, sa = (await subeF(jpg)).status;
      ok(pa.puedeFoto === false && sa === 403, 'un usuario que no es gestor ni administrador no pone foto de perfil');
      await entra('gestor@anin.gob.pe'); const pg0 = (await pide('/api/perfil')).j, r1 = await subeF(jpg), r2 = await subeF(Buffer.from('esto no es una imagen'));
      const pg1 = (await pide('/api/perfil')).j, img = await fetch(B + '/api/perfil/foto/' + (pg1.foto || {}).clave, { headers: { cookie: galleta } }), byt = Buffer.from(await img.arrayBuffer());
      const fp = (await pide('/api/proyectos/' + pw + '/fotos')).j;
      ok(pg0.puedeFoto === true && r1.status === 200 && r2.status === 400 && img.status === 200 && img.headers.get('content-type') === 'image/jpeg' && byt.equals(jpg) && fp.fotos['gestor@anin.gob.pe'] && !JSON.stringify(pg1).includes('@'), 'el gestor pone su foto (solo JPG, PNG o WEBP), se sirve tal cual y aparece en las fotos del proyecto sin el correo en la dirección');
      const BDp = require('../lib/bd'); const enBase = BDp.q.uno("SELECT length(datos) AS n FROM perfiles_foto WHERE email = 'gestor@anin.gob.pe'");
      ok(enBase && enBase.n === jpg.length, 'la foto queda guardada dentro de la base de datos del CDE (en Render, en el disco permanente)');
      await pide('/api/perfil/foto', { method: 'DELETE' }); const pg2 = (await pide('/api/perfil')).j; ok(pg2.foto === null, 'el gestor puede quitar su foto');
    }
    { // v0.21: filosofía del CDE — una carpeta sin permisos la ven todos; solo la administración de permisos limita
      const CARp = require('../lib/carpetas'), L = [{ ruta: 'LIBRE' }, { ruta: 'LIBRE/SUB' }, { ruta: 'CERRADA', permisos: [{ tipo: 'org', valor: 'OTRA', nivel: 'ver' }] }, { ruta: 'CERRADA/SUB' }], u = { email: 'x@y.pe', rol: 'miembro', organizacion: 'GHEMET' };
      const a = CARp.permiso(L, u, 'LIBRE/SUB'), b = CARp.permiso(L, u, 'CERRADA/SUB'), t = CARp.arbol(L, u, {}).map(x => x.ruta);
      ok(a.leer && a.descargar && !a.subir && !b.leer && t.includes('LIBRE/SUB') && !t.includes('CERRADA'), 'una carpeta sin permisos la ven y descargan todos; la que tiene permisos solo quien está en ellos');
    }
    const { crcSigue } = require('../lib/zipflujo'); ok(crcSigue(0, Buffer.from('123456789')) === 0xCBF43926, 'CRC-32 del ZIP (vector de prueba 123456789)');
    // desplazar carpeta (gestor): los contenedores la siguen
    await entra('gestor@anin.gob.pe');
    r = await pide('/api/proyectos/' + pw + '/carpetas', { json: { padre: 'E3_DISEÑO/WIP/WIP CLIENTE', nombre: 'Borradores' } }); ok(r.status === 200, 'el gestor crea E3_DISEÑO/WIP/WIP CLIENTE/Borradores');
    r = await pide('/api/proyectos/' + pw + '/carpetas/mover', { json: { ruta: 'E3_DISEÑO/WIP/WIP CLIENTE', destino: 'E3_DISEÑO/WIP/WIP CLIENTE/Borradores' } }); ok(r.status === 400, 'no se desplaza dentro de si misma');
    r = await pide('/api/proyectos/' + pw + '/carpetas/mover', { json: { ruta: 'E3_DISEÑO/COM/COM CONTRATISTA', destino: 'E1/COM' } }); ok(r.status === 400 && /ya hay/.test(r.j.mensaje), 'no se desplaza si en el destino hay una carpeta con el mismo nombre');
    r = await pide('/api/proyectos/' + pw + '/carpetas', { json: { padre: 'E3_DISEÑO/COM', nombre: 'Lote A' } });
    r = await pide('/api/proyectos/' + pw + '/carpetas/mover', { json: { ruta: 'E3_DISEÑO/COM/COM CONTRATISTA', destino: 'E3_DISEÑO/COM/Lote A' } }); ok(r.status === 200 && r.j.ruta === 'E3_DISEÑO/COM/Lote A/COM CONTRATISTA', 'el gestor desplaza COM CONTRATISTA dentro de Lote A');
    r = await pide('/api/proyectos/' + pw + '/contenedores/' + cw); ok(r.j.carpeta === 'E3_DISEÑO/COM/Lote A/COM CONTRATISTA', 'el contenedor sigue a la carpeta desplazada');
    r = await pide('/api/proyectos/' + pw); ok((r.j.config.carpetas.find(c => c.ruta === 'E3_DISEÑO/COM/Lote A/COM CONTRATISTA') || {}).disparador, 'el desencadenador viaja con la carpeta');
    r = await pide('/api/proyectos/' + pw + '/carpetas/plantilla', { json: { plantilla: 'wcp', orgContr: 'GHEMET', conContr: false, conSuper: false, fusionar: false } }); ok(r.status === 200 && r.j.carpetas - r.j.conservadas.length === 42, 'administracion directa: E1..E6 con WIP CLIENTE, COM CLIENTE y PUB CLIENTE (42 carpetas)');
    r = await pide('/api/proyectos/' + pw); ok(r.j.carpetaWip === 'E3/WIP/WIP CLIENTE' && JSON.stringify(r.j.config.partes) === JSON.stringify({ CLIENTE: 'ANIN' }), 'el gestor (ANIN = CLIENTE) sube a E3/WIP/WIP CLIENTE (' + r.j.carpetaWip + ')');

    // ---------- 11. v0.5.3: desplazar a cualquier carpeta, compartir, suprimidos, marcas, configuracion de archivos, flujos de Forma ----------
    console.log('\n11. Gestion documental v0.5.3');
    galleta = ''; await pide('/api/acceso/local', { json: { email: 'admin@anin.gob.pe', clave: 'prueba' } });
    r = await pide('/api/proyectos', { json: { codigo: 'TALARA', nombre: 'Hospital Talara II', norma: 'default-iso19650', plantilla: 'wcp', orgContr: 'GHEMET', orgSuper: 'SUPERV', etapas: [{ codigo: 'E1', nombre: '' }, { codigo: 'E2', nombre: '' }, { codigo: 'E3', nombre: 'DISEÑO' }], etapaActual: 'E3' } }); const pg = r.j.id;
    for (const [e, rol, org] of [['autor@ghemet.com', 'document-control', 'GHEMET'], ['sup@superv.com', 'revisor', 'SUPERV'], ['gestor@anin.gob.pe', 'gestor', 'ANIN'], ['lector2@anin.gob.pe', 'lector', 'ANIN']]) await pide('/api/proyectos/' + pg + '/miembros', { json: { email: e, rol, organizacion: org } });
    const subeG = (nombre, carpeta) => fetch(B + '/api/proyectos/' + pg + '/subir' + (carpeta ? '?carpeta=' + encodeURIComponent(carpeta) : ''), { method: 'POST', headers: { cookie: galleta, 'x-nombre': encodeURIComponent(nombre) }, body: Buffer.from('contenido ' + nombre) }).then(async x => ({ status: x.status, j: await x.json() }));
    await entra('autor@ghemet.com');
    r = await subeG('TALARA-GHE-ZZ-XX-DR-A-0001-P01.pdf', 'E3_DISEÑO/COM/COM CONTRATISTA'); ok(r.status === 200 && r.j.estado === 'COMPARTIDO', 'sube un PDF a COM CONTRATISTA'); const cg1 = r.j.contenedor, vg1 = r.j.version;
    r = await subeG('TALARA-GHE-ZZ-XX-M3-A-0002-P01.rvt', 'E3_DISEÑO/COM/COM CONTRATISTA'); const cg2 = r.j.contenedor;
    r = await subeG('TALARA-GHE-ZZ-XX-SH-A-0003-P01.docx', 'E3_DISEÑO/WIP/WIP CONTRATISTA'); ok(r.status === 200 && r.j.estado === 'WIP', 'sube un DOCX a WIP CONTRATISTA'); const cg3 = r.j.contenedor;
    // crear revision con nombre, notas y lote; numero correlativo del proyecto
    r = await pide('/api/proyectos/' + pg + '/contenedores/' + cg1 + '/revisiones', { json: { flujo: 'coordinacion', nombre: 'ETAPA 3_PLANOS DE ARQUITECTURA', notas: 'Revisar cotas', lote: 'ltx' } }); ok(r.status === 200 && r.j.numero === 1, 'revision #1 con nombre y notas'); const rg1 = r.j.id;
    r = await pide('/api/proyectos/' + pg + '/contenedores/' + cg2 + '/revisiones', { json: { flujo: 'coordinacion', nombre: 'ETAPA 3_PLANOS DE ARQUITECTURA', lote: 'ltx' } }); ok(r.j.numero === 2, 'la segunda del lote es #2');
    r = await pide('/api/proyectos/' + pg + '/revisiones'); ok(r.j.revisiones.filter(x => x.lote === 'ltx' && x.nombre === 'ETAPA 3_PLANOS DE ARQUITECTURA').length === 2 && r.j.revisiones.find(x => x.id === rg1).notas === 'Revisar cotas', 'la bandeja trae numero, nombre, notas y lote');
    // desplazar a CUALQUIER carpeta aunque tenga revision abierta (lo que pidio Erick)
    r = await pide('/api/proyectos/' + pg + '/contenedores/' + cg1 + '/mover', { json: { carpeta: 'E3_DISEÑO/WIP/WIP CONTRATISTA' } }); ok(r.status === 200 && r.j.carpeta === 'E3_DISEÑO/WIP/WIP CONTRATISTA', 'desplaza un archivo CON revision abierta a una carpeta WIP');
    r = await pide('/api/proyectos/' + pg + '/contenedores/' + cg1); ok(r.j.carpeta === 'E3_DISEÑO/WIP/WIP CONTRATISTA' && r.j.estado === 'COMPARTIDO' && r.j.revisiones[0].estado === 'abierta', 'cambia de carpeta sin perder estado ni la ronda');
    r = await pide('/api/proyectos/' + pg + '/contenedores/' + cg1 + '/mover', { json: { carpeta: 'E3_DISEÑO/COM/COM CONTRATISTA' } }); ok(r.status === 200, 'y vuelve a COM CONTRATISTA');
    r = await pide('/api/proyectos/' + pg + '/contenedores/' + cg1 + '/mover', { json: { carpeta: 'E3_DISEÑO/PUB/PUB CLIENTE' } }); ok(r.status === 403, 'pero no a una carpeta donde GHEMET no carga (PUB CLIENTE)');
    // compartir: vinculo publico, con miembros (correo), con otro proyecto
    r = await pide('/api/proyectos/' + pg + '/contenedores/' + cg1 + '/compartir', { json: { modo: 'vinculo', dias: 7, nota: 'para el municipio' } }); ok(r.status === 200 && r.j.token && /^\/compartido\//.test(r.j.url), 'crea un vinculo publico con caducidad'); const tok = r.j.token;
    r = await fetch(B + '/compartido/' + tok); ok(r.status === 200 && (await r.text()) === 'contenido TALARA-GHE-ZZ-XX-DR-A-0001-P01.pdf', 'el vinculo descarga sin sesion');
    r = await fetch(B + '/compartido/nada'); ok(r.status === 404, 'un token inventado → 404');
    r = await pide('/api/proyectos/' + pg + '/contenedores/' + cg1 + '/compartir', { json: { modo: 'miembros', para: ['sup@superv.com', 'nadie@x.com'] } }); ok(r.status === 400 && /nadie@x.com/.test(r.j.mensaje), 'compartir con alguien que no es miembro → 400');
    r = await pide('/api/proyectos/' + pg + '/contenedores/' + cg1 + '/compartir', { json: { modo: 'miembros', para: ['sup@superv.com'], nota: 'Mira el plano' } }); ok(r.status === 200 && r.j.correo, 'compartir con miembros manda un correo de la correspondencia'); const mc = r.j.correo;
    await entra('sup@superv.com'); r = await pide('/api/proyectos/' + pg + '/correspondencia?bandeja=recibidos'); ok(r.j.correos.some(c => c.id === mc && /Se compartio contigo/.test(c.asunto)), 'la Supervision lo recibe en su bandeja');
    r = await pide('/api/proyectos/' + pg + '/contenedores/' + cg1); ok(r.j.compartidos.length === 2, 'la ficha lista lo compartido (vinculo + miembros)');
    await entra('gestor@anin.gob.pe'); r = await pide('/api/proyectos/' + pg + '/compartir/destinos'); const pdest = r.j.proyectos.find(x => x.id === pw); ok(pdest && pdest.carpetas.length > 0, 'destinos: proyectos donde soy miembro con sus carpetas de carga');
    r = await pide('/api/proyectos/' + pg + '/contenedores/' + cg1 + '/compartir', { json: { modo: 'proyecto', proyecto_destino: pw, carpeta_destino: pdest.carpetas[0] } }); ok(r.status === 400 && r.j.error === 'nomenclatura', 'copiar a otro proyecto respeta la nomenclatura del destino (TALARA ≠ SECHURA2)');
    // suprimir / restaurar archivos y carpetas (papelera)
    r = await pide('/api/proyectos/' + pg + '/contenedores/' + cg1, { method: 'DELETE' }); ok(r.status === 409, 'no se suprime un archivo con revision abierta');
    r = await pide('/api/proyectos/' + pg + '/contenedores/' + cg3, { method: 'DELETE' }); ok(r.status === 200, 'el gestor suprime el DOCX');
    r = await pide('/api/proyectos/' + pg + '/contenedores?carpeta=' + encodeURIComponent('E3_DISEÑO/WIP/WIP CONTRATISTA')); ok(!r.j.contenedores.some(c => c.id === cg3), 'el suprimido desaparece de la carpeta');
    r = await pide('/api/proyectos/' + pg + '/suprimidos'); ok(r.j.contenedores.length === 1 && r.j.contenedores[0].id === cg3, 'aparece en Elementos suprimidos');
    r = await pide('/api/proyectos/' + pg + '/suprimidos/restaurar', { json: { contenedores: [cg3] } }); ok(r.status === 200 && r.j.hechos.contenedores === 1, 'se restaura');
    r = await pide('/api/proyectos/' + pg + '/carpetas', { json: { padre: 'E3_DISEÑO/WIP/WIP CONTRATISTA', nombre: 'Viejo' } }); r = await pide('/api/proyectos/' + pg + '/contenedores/' + cg3 + '/mover', { json: { carpeta: 'E3_DISEÑO/WIP/WIP CONTRATISTA/Viejo' } });
    r = await pide('/api/proyectos/' + pg + '/carpetas/suprimir', { json: { ruta: 'E3_DISEÑO/WIP/WIP CONTRATISTA/Viejo' } }); ok(r.status === 200 && r.j.archivos === 1 && r.j.carpetas === 1, 'suprimir la carpeta Viejo se lleva su archivo'); const lote = r.j.lote;
    r = await pide('/api/proyectos/' + pg); ok(!r.j.config.carpetas.some(c => c.ruta.endsWith('/Viejo')) && r.j.config.suprimidas.length === 1, 'la carpeta sale del arbol y queda en suprimidas');
    r = await pide('/api/proyectos/' + pg + '/suprimidos/restaurar', { json: { lotes: [lote] } }); ok(r.status === 200 && r.j.hechos.carpetas === 1 && r.j.hechos.contenedores === 1, 'restaurar la carpeta devuelve carpeta y archivo');
    r = await pide('/api/proyectos/' + pg + '/contenedores/' + cg3); ok(!r.j.borrado && r.j.carpeta === 'E3_DISEÑO/WIP/WIP CONTRATISTA/Viejo', 'el archivo vuelve a su carpeta');
    // marcas de revision (PDF con posicion; privadas hasta publicar; duplicar)
    await entra('sup@superv.com');
    r = await pide('/api/proyectos/' + pg + '/versiones/' + vg1 + '/marcas', { json: { pagina: 2, x: 0.4, y: 0.6, texto: 'Falta cota', tipo: 'nota' } }); ok(r.status === 200 && r.j.marca.pagina === 2 && !r.j.marca.publicada, 'la Supervision pone una marca privada en la pagina 2'); const mk = r.j.marca.id;
    await entra('autor@ghemet.com'); r = await pide('/api/proyectos/' + pg + '/versiones/' + vg1 + '/marcas'); ok(r.j.esPdf && r.j.marcas.length === 0, 'el autor no ve la marca privada');
    await entra('sup@superv.com'); r = await pide('/api/proyectos/' + pg + '/marcas/' + mk, { method: 'PUT', json: { publicada: true, tipo: 'revision', texto: 'Falta cota en eje 3' } }); ok(r.status === 200 && r.j.marca.publicada === 1, 'la publica como marca de revision');
    await entra('autor@ghemet.com'); r = await pide('/api/proyectos/' + pg + '/versiones/' + vg1 + '/marcas'); ok(r.j.marcas.length === 1 && r.j.marcas[0].texto === 'Falta cota en eje 3', 'publicada: el autor la ve');
    r = await pide('/api/proyectos/' + pg + '/marcas/' + mk, { method: 'PUT', json: { texto: 'x' } }); ok(r.status === 403, 'pero no la edita (no es suya)');
    r = await pide('/api/proyectos/' + pg + '/marcas/' + mk + '/duplicar', { json: {} }); ok(r.status === 200 && r.j.marca.autor === 'autor@ghemet.com' && !r.j.marca.publicada, 'la duplica como suya (privada)');
    r = await pide('/api/proyectos/' + pg + '/contenedores?carpeta=' + encodeURIComponent('E3_DISEÑO/COM/COM CONTRATISTA')); ok(r.j.contenedores.find(c => c.id === cg1).n_marcas === 2, 'la columna Marcas de revision cuenta las visibles (publicada + mia)');
    r = await pide('/api/proyectos/' + pg + '/versiones/' + vg1 + '/marcas', { json: { texto: 'nota del rvt' } }); ok(r.status === 200 && r.j.marca.pagina === 0, 'en cualquier archivo cabe una marca sin posicion (nota de la version)');
    // configuracion de archivos: atributos, conformidad, avanzada
    await entra('gestor@anin.gob.pe');
    r = await pide('/api/proyectos/' + pg + '/archivos/configuracion', { method: 'PUT', json: { atributos: [{ nombre: 'Contrato', tipo: 'texto' }, { nombre: 'Especialidad', tipo: 'lista', valores: ['ARQ', 'EST', 'IISS'] }], avanzada: { diasVinculo: 15 } } }); ok(r.status === 200 && r.j.config.atributos.length === 2 && r.j.config.atributos[1].id === 'especialidad', 'define 2 atributos personalizados');
    await entra('autor@ghemet.com');
    r = await pide('/api/proyectos/' + pg + '/contenedores/' + cg2 + '/atributos', { method: 'PUT', json: { atributos: { contrato: 'OS 1348', especialidad: 'MEC' } } }); ok(r.status === 400, 'valor fuera de la lista → 400');
    r = await pide('/api/proyectos/' + pg + '/contenedores/' + cg2 + '/atributos', { method: 'PUT', json: { atributos: { contrato: 'OS 1348', especialidad: 'ARQ', descripcion: 'Modelo de arquitectura' } } }); ok(r.status === 200 && r.j.atributos.especialidad === 'ARQ', 'el autor rellena los atributos del RVT');
    r = await pide('/api/proyectos/' + pg + '/contenedores?q=0002'); ok(r.j.contenedores[0].descripcion === 'Modelo de arquitectura' && r.j.contenedores[0].atributos.contrato === 'OS 1348', 'la lista trae descripcion y atributos');
    await entra('gestor@anin.gob.pe');
    r = await pide('/api/proyectos/' + pg + '/archivos/configuracion', { method: 'PUT', json: { nomenclatura: { campos: [{ nombre: 'Proyecto', valores: ['TALARA'] }, { nombre: 'Originador', longitud: 3, caracteres: 'letras' }, { nombre: 'Zona', obligatorio: false }, { nombre: 'Nivel' }, { nombre: 'Tipo', valores: ['DR', 'M3', 'SH'] }, { nombre: 'Disciplina' }, { nombre: 'Numero', longitud: 4, caracteres: 'numeros' }] } } }); ok(r.status === 200, 'guarda la norma de conformidad (longitud fija, tipo de caracter, opcional)');
    r = await pide('/api/proyectos/' + pg + '/archivos/prueba-nombre', { json: { nombre: 'TALARA-GHE-XXX-XX-DR-A-0005-P01.pdf' } }); ok(r.j.ok, 'nombre con campo opcional XXX cumple');
    r = await pide('/api/proyectos/' + pg + '/archivos/prueba-nombre', { json: { nombre: 'TALARA-GH3-ZZ-XX-DR-A-05-P01.pdf' } }); ok(!r.j.ok && r.j.errores.length === 2, 'originador con digito y numero de 2 cifras → 2 errores: ' + r.j.errores.join(' | '));
    r = await pide('/api/proyectos/' + pg + '/archivos/configuracion', { method: 'PUT', json: { nomenclatura: { campos: [] } } }); r = await pide('/api/proyectos/' + pg); ok(r.j.config.normaPorDefecto === 'anin-docpg002' && r.j.config.normas.some(n => n.id === 'anin-docpg002' && n.campos.length === 8), 'quitar la norma propia deja la DOCPG002 de la ANIN como norma por defecto (8 campos)');
    r = await pide('/api/proyectos/' + pg + '/archivos/prueba-nombre', { json: { nombre: '100005-CCAB1-106-B01-PLA-MEC-E4-001.pdf' } }); ok(r.j.ok, 'DOCPG002: el ejemplo 1 de la libreria cumple');
    r = await pide('/api/proyectos/' + pg + '/archivos/prueba-nombre', { json: { nombre: '200013-CXYZ1-415-ZZZ-MBM-ARQ-E5-002.rvt' } }); ok(r.j.ok, 'DOCPG002: el ejemplo 2 (modelo BIM, todos los niveles) cumple');
    r = await pide('/api/proyectos/' + pg + '/archivos/prueba-nombre', { json: { nombre: '100005-CCAB1-999-B01-PLA-IME-E4-001.pdf' } }); ok(!r.j.ok && r.j.errores.length === 2, 'DOCPG002: activo 999 y disciplina IME no estan en las tablas → 2 errores');
    r = await pide('/api/proyectos/' + pg + '/archivos/prueba-nombre', { json: { nombre: 'TALARA-GHE-ZZ-XX-DR-A-0005-P01.pdf' } }); ok(!r.j.ok, 'DOCPG002: un nombre ISO 19650 UK de 7 campos no cumple');
    r = await pide('/api/proyectos/' + pg + '/carpetas', { method: 'PUT', json: { ruta: 'E3_DISEÑO/COM/COM CLIENTE', norma: 'libre' } }); ok(r.status === 200, 'TALARA/COM CLIENTE queda sin norma (para el puente de prueba)');
    // flujo de Forma: revisores clave y opcionales, estados propios con icono, accion al finalizar con atributos
    r = await pide('/api/proyectos/' + pg + '/flujos', { json: { nombre: 'Forma', etapas: [{ nombre: 'Tecnica', pasos: [{ id: 'tec', nombre: 'Revision tecnica', tipo: 'uno', revisores: [{ tipo: 'org', valor: 'SUPERV' }], opcionales: [{ tipo: 'rol', valor: 'lector' }], dias: 5 }] }], estados: [{ etiqueta: 'Aprobado con reservas', valor: 'aprobado', icono: 'alerta' }, { id: 'devuelta', etiqueta: 'Rechazado' }], alAprobar: { estado: 'COMPARTIDO', idoneidad: 'S4', cuando: 'aprobados', incluirMarcas: false, actualizarAtributos: { especialidad: 'EST' } } } });
    ok(r.status === 200 && r.j.flujo.estados.length === 4 && r.j.flujo.estados[3].id === 'aprobado-con-reservas' && r.j.flujo.estados[2].etiqueta === 'Rechazado' && r.j.flujo.etapas[0].pasos[0].opcionales.length === 1 && r.j.flujo.alAprobar.cuando === 'aprobados' && r.j.flujo.alAprobar.incluirMarcas === false, 'flujo con estado propio, opcionales y accion al finalizar');
    await entra('autor@ghemet.com'); r = await pide('/api/proyectos/' + pg + '/contenedores/' + cg2 + '/revisiones/'); // la ronda del lote sigue abierta: la anulo y abro con el flujo Forma
    r = await pide('/api/proyectos/' + pg + '/revisiones'); const rg2 = r.j.revisiones.find(x => x.contenedor_id === cg2 && x.estado === 'abierta'); await pide('/api/proyectos/' + pg + '/revisiones/' + rg2.id + '/anular', { json: { comentario: 'cambio de flujo' } });
    r = await pide('/api/proyectos/' + pg + '/contenedores/' + cg2 + '/revisiones', { json: { flujo: 'forma', nombre: 'Prueba Forma' } }); ok(r.status === 200 && r.j.numero === 3, 'abre #3 con el flujo Forma'); const rg3 = r.j.id;
    await entra('lector2@anin.gob.pe'); r = await pide('/api/proyectos/' + pg + '/revisiones'); const vis = r.j.revisiones.find(x => x.id === rg3); ok(vis.puedoDecidir && vis.soyOpcional, 'el lector (revisor opcional) puede opinar y sabe que es opcional');
    r = await pide('/api/proyectos/' + pg + '/revisiones/' + rg3 + '/decidir', { json: { decision: 'aprobado-con-reservas', comentario: 'ojo con el eje 3' } }); ok(r.status === 403, 'pero un lector no decide (rol minimo autor)');
    await entra('sup@superv.com'); r = await pide('/api/proyectos/' + pg + '/revisiones/' + rg3 + '/decidir', { json: { decision: 'aprobado-con-reservas', comentario: 'ok' } }); ok(r.status === 200 && r.j.estado === 'aprobada', 'la Supervision decide con el estado propio → ronda aprobada');
    r = await pide('/api/proyectos/' + pg + '/contenedores/' + cg2); ok(r.j.revisiones[0].pasos[0].estado === 'aprobado-con-reservas' && r.j.revisiones[0].pasos[0].etiqueta === 'Aprobado con reservas' && r.j.estado === 'COMPARTIDO' && r.j.versiones[0].idoneidad === 'S4' && r.j.atributos.especialidad === 'EST', 'queda el estado propio en la decision, S4 y el atributo actualizado al cerrar');

    // ---------- 12. v0.6: normas por carpeta (WIP libre), area de retencion, renombrar, copia movible, conjuntos, puente, transmisiones, incidencias, pagina de revision, resumen ----------
    console.log('\n12. Lo de Forma v0.6');
    galleta = ''; await pide('/api/acceso/local', { json: { email: 'admin@anin.gob.pe', clave: 'prueba' } });
    r = await pide('/api/proyectos', { json: { codigo: 'MANCORA', nombre: 'CS Mancora I-3', norma: 'default-iso19650', plantilla: 'wcp', orgContr: 'GHEMET', orgSuper: 'SUPERV', etapas: [{ codigo: 'E1', nombre: '' }, { codigo: 'E2', nombre: '' }, { codigo: 'E3', nombre: 'DISEÑO' }], etapaActual: 'E3' } }); const pm = r.j.id;
    for (const [e, rol, org] of [['autor@ghemet.com', 'document-control', 'GHEMET'], ['sup@superv.com', 'revisor', 'SUPERV'], ['gestor@anin.gob.pe', 'gestor', 'ANIN']]) await pide('/api/proyectos/' + pm + '/miembros', { json: { email: e, rol, organizacion: org } });
    const subeM = (nombre, carpeta, cuerpo) => fetch(B + '/api/proyectos/' + pm + '/subir' + (carpeta ? '?carpeta=' + encodeURIComponent(carpeta) : ''), { method: 'POST', headers: { cookie: galleta, 'x-nombre': encodeURIComponent(nombre) }, body: cuerpo || Buffer.from('contenido ' + nombre) }).then(async x => ({ status: x.status, j: await x.json() }));
    r = await pide('/api/proyectos/' + pm); ok(r.j.config.normas.length === 2 && r.j.config.normaPorDefecto === 'default-iso19650' && r.j.arbol.find(c => c.ruta === 'E3_DISEÑO/WIP/WIP CONTRATISTA').normaEfectiva === '' && r.j.arbol.find(c => c.ruta === 'E3_DISEÑO/COM/COM CONTRATISTA').normaEfectiva === 'default-iso19650', 'la config vieja migra a una norma; WIP sin norma (libre), COM con la norma por defecto');
    await entra('autor@ghemet.com');
    r = await subeM('Informe de avance semana 3.docx', 'E3_DISEÑO/WIP/WIP CONTRATISTA'); ok(r.status === 200 && r.j.libre && r.j.estado === 'WIP', 'en WIP entra un nombre libre (trabajo en curso)'); const cl = r.j.contenedor;
    r = await subeM('Informe de avance semana 3.docx', 'E3_DISEÑO/COM/COM CONTRATISTA'); ok(r.status === 400 && r.j.error === 'nomenclatura', 'en COM el mismo nombre se rechaza (norma de la carpeta)');
    r = await pide('/api/proyectos/' + pm + '/contenedores/' + cl + '/estado', { json: { estado: 'COMPARTIDO', carpeta_destino: 'E3_DISEÑO/COM/COM CONTRATISTA' } }); ok(r.status === 409 && /norma/.test(r.j.mensaje), 'no pasa a COMPARTIDO sin cumplir la norma');
    r = await pide('/api/proyectos/' + pm + '/contenedores/' + cl + '/renombrar', { json: { nombre: 'MANCORA-GHE-ZZ-XX-RP-A-0007-P01.docx', carpeta: 'E3_DISEÑO/COM/COM CONTRATISTA' } }); ok(r.status === 200 && r.j.nombre === 'MANCORA-GHE-ZZ-XX-RP-A-0007', 'Cambiar nombre a uno conforme');
    r = await pide('/api/proyectos/' + pm + '/contenedores/' + cl + '/estado', { json: { estado: 'COMPARTIDO', carpeta_destino: 'E3_DISEÑO/COM/COM CONTRATISTA' } }); ok(r.status === 200, 'ya conforme, pasa a COMPARTIDO en COM');
    // area de retencion
    await entra('gestor@anin.gob.pe'); r = await pide('/api/proyectos/' + pm + '/conformidad', { method: 'PUT', json: { areaRetencion: true } }); ok(r.status === 200 && r.j.conformidad.areaRetencion, 'el gestor activa el area de retencion');
    await entra('autor@ghemet.com'); r = await subeM('Plano sin norma.pdf', 'E3_DISEÑO/COM/COM CONTRATISTA'); ok(r.status === 200 && r.j.retenido && r.j.retencion === 'E3_DISEÑO/COM/COM CONTRATISTA', 'con retencion activa lo no conforme se carga retenido'); const cr = r.j.contenedor;
    r = await pide('/api/proyectos/' + pm + '/contenedores?carpeta=' + encodeURIComponent('E3_DISEÑO/COM/COM CONTRATISTA')); ok(!r.j.contenedores.some(c => c.id === cr), 'no aparece en la carpeta');
    r = await pide('/api/proyectos/' + pm + '/contenedores?retenidos=1'); ok(r.j.contenedores.some(c => c.id === cr && c.retencion), 'aparece en el area de retencion ' + JSON.stringify(r.j).slice(0,200));
    r = await pide('/api/proyectos/' + pm + '/contenedores/' + cr + '/renombrar', { json: { nombre: 'MANCORA-GHE-ZZ-XX-DR-A-0008-P01.pdf' } }); ok(r.status === 200 && r.j.salioDeRetencion && r.j.carpeta === 'E3_DISEÑO/COM/COM CONTRATISTA', 'al renombrar conforme sale de retencion a su carpeta');
    r = await pide('/api/proyectos/' + pm + '/valida-nombre', { json: { nombre: 'cualquier cosa.rvt', carpeta: 'E3_DISEÑO/WIP/WIP CONTRATISTA' } }); ok(r.j.ok && r.j.libre, 'valida-nombre con carpeta WIP → libre');
    r = await pide('/api/proyectos/' + pm + '/valida-nombre', { json: { nombre: 'Modelo de prueba sin norma.rvt' } }); ok(r.j.ok && r.j.libre, 'valida-nombre sin carpeta (complemento de Revit) → la WIP de su organizacion: libre');
    // normas: crear otra y asignarla a una carpeta; duplicados
    await entra('gestor@anin.gob.pe');
    r = await pide('/api/proyectos/' + pm + '/normas', { json: { nombre: 'ANIN_NOMENCLATURA_COM', descripcion: 'Norma aprobada', campos: [{ nombre: 'Codigo del proyecto', longitud: 6, caracteres: 'numeros' }, { nombre: 'Originador', longitud: 5 }, { nombre: 'Numero', longitud: 4, caracteres: 'numeros' }], atributos: { codigosEstado: [{ valor: 'S2', descripcion: 'Para informacion' }, { valor: 'S4', descripcion: 'Para aprobacion' }] } } }); ok(r.status === 200 && r.j.norma.id === 'anin-nomenclatura-com' && r.j.norma.atributos.codigosEstado.length === 2, 'crea una segunda norma con codigos de estado'); const nid = r.j.norma.id;
    r = await pide('/api/proyectos/' + pm + '/normas'); ok(r.j.normas.length === 3 && r.j.normas.some(n => /######-XXXXX-####-P##\.ext/.test(n.vista)), 'vista preliminar ' + r.j.normas[1].vista);
    r = await pide('/api/proyectos/' + pm + '/carpetas', { method: 'PUT', json: { ruta: 'E3_DISEÑO/COM/COM SUPERVISIÓN', norma: nid } }); ok(r.status === 200, 'asigna la norma a COM SUPERVISION');
    r = await pide('/api/proyectos/' + pm + '/valida-nombre', { json: { nombre: '100030-JYS01-0001-P01.pdf', carpeta: 'E3_DISEÑO/COM/COM SUPERVISIÓN' } }); ok(r.j.ok && r.j.norma.id === nid, 'en esa carpeta rige la norma nueva');
    r = await pide('/api/proyectos/' + pm + '/valida-nombre', { json: { nombre: '100030-JYS01-0001-P01.pdf', carpeta: 'E3_DISEÑO/COM/COM CONTRATISTA' } }); ok(!r.j.ok, 'y en COM CONTRATISTA sigue la norma por defecto');
    await entra('autor@ghemet.com'); r = await subeM('MANCORA-GHE-ZZ-XX-DR-A-0009-P01.pdf', 'E3_DISEÑO/WIP/WIP CONTRATISTA'); const cd2 = r.j.contenedor;
    r = await pide('/api/proyectos/' + pm + '/duplicados', { json: { carpetas: [], atributos: ['Numero'] } }); ok(r.status === 200 && Array.isArray(r.j.grupos), 'buscar duplicados responde (' + r.j.grupos.length + ' grupos)');
    // copia publicada movible: flujo con copiarA
    await entra('gestor@anin.gob.pe'); r = await pide('/api/proyectos/' + pm + '/flujos', { json: { nombre: 'Publica con copia', etapas: [{ pasos: [{ id: 'a', nombre: 'Aprobacion', tipo: 'uno', revisores: [{ tipo: 'rol', valor: 'gestor' }] }] }], alAprobar: { estado: 'PUBLICADO', idoneidad: 'A1', copiarA: 'E3_DISEÑO/PUB/PUB CLIENTE' } } }); const fpc = r.j.flujo.id;
    r = await pide('/api/proyectos/' + pm + '/contenedores/' + cl + '/revisiones', { json: { flujo: fpc } }); const rpc = r.j.id; r = await pide('/api/proyectos/' + pm + '/revisiones/' + rpc + '/decidir', { json: { decision: 'aprobar' } }); ok(r.status === 200 && r.j.contenedor.carpeta_publicada === 'E3_DISEÑO/PUB/PUB CLIENTE', 'aprobado por flujo: copia en PUB CLIENTE');
    r = await pide('/api/proyectos/' + pm + '/contenedores/' + cl + '/mover', { json: { carpeta: 'E3_DISEÑO/COM/COM CLIENTE', copia: true } }); ok(r.status === 200 && r.j.copia, 'la COPIA publicada se desplaza (a COM CLIENTE)');
    r = await pide('/api/proyectos/' + pm + '/contenedores/' + cl); ok(r.j.carpeta_publicada === 'E3_DISEÑO/COM/COM CLIENTE' && r.j.carpeta === 'E3_DISEÑO/COM/COM CONTRATISTA', 'la copia cambio de carpeta y el original no');
    // conjuntos
    r = await pide('/api/proyectos/' + pm + '/conjuntos', { json: { nombre: 'Entrega E3 - Arquitectura', descripcion: 'Planos y memoria', items: [{ contenedor_id: cl }, { contenedor_id: cd2 }] } }); ok(r.status === 200 && r.j.n === 2, 'crea un conjunto con 2 archivos ' + JSON.stringify(r.j)); const cj = r.j.id;
    r = await pide('/api/proyectos/' + pm + '/conjuntos/' + cj); ok(r.j.archivos.length === 2 && r.j.archivos[0].version, 'el conjunto trae sus archivos con version');
    r = await pide('/api/proyectos/' + pm + '/conjuntos/' + cj, { method: 'PUT', json: { quitar: [cd2] } }); ok(r.j.n === 1, 'quita uno del conjunto');
    // puente con sincronizacion hacia TALARA (pg)
    await pide('/api/proyectos/' + pg + '/miembros', { json: { email: 'gestor@anin.gob.pe', rol: 'gestor', organizacion: 'ANIN' } });
    r = await pide('/api/proyectos/' + pm + '/puentes', { json: { carpeta: 'E3_DISEÑO/COM/COM CONTRATISTA', proyecto_destino: pg, carpeta_destino: 'E3_DISEÑO/COM/COM CLIENTE', sincronizar: true, titulo: 'Mancora → Talara' } }); ok(r.status === 200 && r.j.puente.sincronizar && r.j.copiados === 2 && !r.j.errores.length, 'crea el puente con sincronizacion: copia inicial de ' + r.j.copiados + ' archivos a TALARA (sin norma alli)');
    r = await pide('/api/proyectos/' + pg + '/contenedores?carpeta=' + encodeURIComponent('E3_DISEÑO/COM/COM CLIENTE')); ok(r.j.contenedores.some(c => c.nombre === 'MANCORA-GHE-ZZ-XX-RP-A-0007' && c.ultima.origen === 'puente:MANCORA'), 'TALARA/COM CLIENTE tiene la copia con origen puente');
    await entra('autor@ghemet.com'); r = await subeM('MANCORA-GHE-ZZ-XX-DR-A-0010-P01.pdf', 'E3_DISEÑO/COM/COM CONTRATISTA'); await duerme(400);
    await entra('gestor@anin.gob.pe'); r = await pide('/api/proyectos/' + pg + '/contenedores?q=0010'); ok(r.j.contenedores.length === 1 && r.j.contenedores[0].carpeta === 'E3_DISEÑO/COM/COM CLIENTE', 'lo que se carga despues se sincroniza solo por el puente');
    r = await pide('/api/proyectos/' + pm + '/puentes'); ok(r.j.salientes.length === 1 && r.j.salientes[0].destinoProyecto.codigo === 'TALARA', 'el puente queda registrado');
    r = await pide('/api/proyectos/' + pg + '/puentes'); ok(r.j.entrantes.length === 1 && r.j.entrantes[0].origenProyecto.codigo === 'MANCORA', 'y TALARA lo ve como entrante');
    // transmisiones
    r = await pide('/api/proyectos/' + pm + '/transmisiones', { json: { titulo: 'ETAPA 3_ENTREGA ARQUITECTURA', destinatarios: ['sup@superv.com', { org: 'GHEMET' }], mensaje: 'Se transmite para revision', archivos: [{ contenedor_id: cl }, { contenedor_id: cd2 }], copiaCorreo: true, permitirAnadir: true } }); ok(r.status === 200 && r.j.numero === 1 && r.j.correo, 'crea el informe de transmision #1 con copia por correo'); const tr1 = r.j.id;
    r = await pide('/api/proyectos/' + pm + '/transmisiones'); ok(r.j.transmisiones.length === 1 && r.j.transmisiones[0].n === 2 && r.j.transmisiones[0].empresas.includes('GHEMET'), 'la lista trae archivos y empresas ' + JSON.stringify(r.j).slice(0,300));
    await entra('sup@superv.com'); r = await pide('/api/proyectos/' + pm + '/transmisiones/' + tr1); ok(r.status === 200 && r.j.archivos.length === 2 && r.j.archivos.every(a => a.puedoDescargar), 'el destinatario abre #1 y puede descargar todo');
    r = await fetch(B + '/api/proyectos/' + pm + '/transmisiones/' + tr1 + '/descargar', { headers: { cookie: galleta } }); const zt = Buffer.from(await r.arrayBuffer()); ok(r.status === 200 && zt.readUInt32LE(0) === 0x04034b50, 'descarga el ZIP del informe');
    r = await pide('/api/proyectos/' + pm + '/transmisiones/' + tr1 + '/destinatarios', { json: { destinatarios: ['gestor@anin.gob.pe'] } }); ok(r.status === 200 && r.j.anadidos === 1, 'el destinatario anade a otro (permitido)');
    // incidencias: posicion en PDF, suprimir con motivo, restaurar, duplicar, editar
    await entra('autor@ghemet.com'); const vcd2 = (await pide('/api/proyectos/' + pm + '/contenedores/' + cd2)).j.versiones[0].id;
    r = await pide('/api/proyectos/' + pm + '/incidencias', { json: { titulo: 'Cota faltante en eje 3', version_id: vcd2, posicion: { pagina: 2, x: 0.3, y: 0.7 }, inicio: '2026-11-10' } }); ok(r.status === 200, 'incidencia con pin en la pagina 2'); const inc1 = r.j.id;
    r = await pide('/api/proyectos/' + pm + '/versiones/' + vcd2 + '/incidencias'); ok(r.j.incidencias.length === 1 && r.j.incidencias[0].posicion.pagina === 2, 'los pines de la version se listan');
    r = await pide('/api/proyectos/' + pm + '/incidencias/' + inc1, { method: 'PUT', json: { prioridad: 'alta', posicion: { pagina: 3, x: 0.5, y: 0.5 } } }); ok(r.status === 200, 'edita prioridad y mueve el pin');
    r = await pide('/api/proyectos/' + pm + '/incidencias/' + inc1, { method: 'PUT', json: { tipo_revision: 'Avance', entregable: 'E3 - Presentación 4 (P4)', disciplina: 'Salud Publica/Sistema Sanitario/Drenaje Pluvial', etapa: 'RIBA 04' } });
    r = await pide('/api/proyectos/' + pm + '/incidencias/' + inc1); ok(r.j.tipo_revision === 'Avance' && r.j.entregable === 'E3 - Presentación 4 (P4)' && r.j.disciplina === 'Salud Publica/Sistema Sanitario/Drenaje Pluvial' && r.j.inicio === '2026-11-10', 'la incidencia guarda tipo de revisión, N.º entregable y una disciplina larga');
    r = await pide('/api/proyectos/' + pm + '/incidencias?entregable=' + encodeURIComponent('E3 - Presentación 4 (P4)')); ok(r.j.incidencias.length === 1, 'se filtra por N.º entregable');
    r = await pide('/api/proyectos/' + pm + '/incidencias/' + inc1 + '/duplicar', { json: {} }); ok(r.status === 200 && r.j.numero === 2, 'duplica → #2');
    r = await pide('/api/proyectos/' + pm + '/incidencias/' + inc1, { method: 'DELETE', json: { comentario: 'creada por error' } }); ok(r.status === 200, 'suprime con motivo');
    r = await pide('/api/proyectos/' + pm + '/incidencias'); ok(r.j.incidencias.length === 1, 'la suprimida no sale en la lista');
    r = await pide('/api/proyectos/' + pm + '/incidencias?suprimidas=1'); ok(r.j.incidencias.length === 1 && r.j.incidencias[0].borrado_motivo === 'creada por error', 'sale en Incidencias suprimidas con su motivo');
    r = await pide('/api/proyectos/' + pm + '/incidencias/' + inc1 + '/restaurar', { method: 'POST' }); ok(r.status === 200, 'se restaura');
    r = await pide('/api/proyectos/' + pm + '/incidencias', { json: { titulo: 'Sin fecha de inicio', tipo_revision: 'Final' } }); const incSin = r.j.id;
    r = await pide('/api/proyectos/' + pm + '/incidencias/' + incSin); const hoyL = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    ok(r.j.inicio === hoyL && r.j.tipo_revision === 'Final', 'sin fecha de inicio, la incidencia toma la de su creación ' + r.j.inicio);
    // pagina de revision: detalle, editar, comentar, omitir paso, volver paso
    await entra('gestor@anin.gob.pe'); r = await pide('/api/proyectos/' + pm + '/flujos', { json: { nombre: 'Dos pasos', etapas: [{ nombre: 'Control', pasos: [{ id: 'c', nombre: 'Control documentario', tipo: 'uno', revisores: [{ tipo: 'org', valor: 'SUPERV' }], dias: 2 }] }, { nombre: 'Aprobacion', pasos: [{ id: 'g', nombre: 'Gerente', tipo: 'uno', revisores: [{ tipo: 'rol', valor: 'gestor' }], dias: 3 }] }], alAprobar: { estado: 'COMPARTIDO', idoneidad: 'S4' } } }); const f2 = r.j.flujo.id;
    await entra('autor@ghemet.com'); r = await pide('/api/proyectos/' + pm + '/contenedores/' + cd2 + '/estado', { json: { estado: 'COMPARTIDO', carpeta_destino: 'E3_DISEÑO/COM/COM CONTRATISTA' } });
    r = await pide('/api/proyectos/' + pm + '/contenedores/' + cd2 + '/revisiones', { json: { flujo: f2, nombre: 'ETAPA 3_PLANO 0008', notas: 'ver cotas' } }); const rr = r.j.id;
    r = await pide('/api/proyectos/' + pm + '/revisiones/' + rr); ok(r.status === 200 && r.j.numero && r.j.candidatos.length === 2 && r.j.candidatos[0].pasos[0].clave.includes('sup@superv.com') && r.j.archivo && r.j.puedoEditar, 'la pagina de la revision trae candidatos por paso, archivo y permisos');
    r = await pide('/api/proyectos/' + pm + '/revisiones/' + rr, { method: 'PUT', json: { nombre: 'ETAPA 3_PLANO 0008 (v2)', vence: '2026-12-01' } }); ok(r.status === 200, 'el iniciador edita nombre y vencimiento');
    r = await pide('/api/proyectos/' + pm + '/revisiones/' + rr + '/comentar', { json: { texto: 'Ojo con el eje 3' } }); ok(r.status === 200, 'comentario en la revision');
    r = await pide('/api/proyectos/' + pm + '/revisiones/' + rr + '/omitir-paso', { json: {} }); ok(r.status === 403, 'omitir el paso no lo puede el autor');
    await entra('gestor@anin.gob.pe'); r = await pide('/api/proyectos/' + pm + '/revisiones/' + rr + '/omitir-paso', { json: { comentario: 'control hecho fuera' } }); ok(r.status === 200 && r.j.etapa === 1, 'el gestor omite el paso 1 → etapa 2');
    r = await pide('/api/proyectos/' + pm + '/revisiones/' + rr + '/volver-paso', { json: { comentario: 'mejor que lo vea control' } }); ok(r.status === 200 && r.j.etapa === 0, 'volver al paso anterior → etapa 1');
    r = await pide('/api/proyectos/' + pm + '/revisiones/' + rr); ok(r.j.paso === 0 && r.j.nombre === 'ETAPA 3_PLANO 0008 (v2)' && r.j.comentarios.length === 1 && r.j.pasos.some(x => x.nota), 'la pagina refleja el paso, el nombre nuevo, el comentario y la nota de vuelta');
    r = await pide('/api/proyectos/' + pm + '/desencadenadores'); ok(r.status === 200 && Array.isArray(r.j.desencadenadores), 'tabla de desencadenadores');
    // resumen automatico (sin clave de IA: por texto)
    await entra('autor@ghemet.com'); r = await subeM('Memoria de calculo.txt', 'E3_DISEÑO/WIP/WIP CONTRATISTA', Buffer.from('MEMORIA DE CALCULO ESTRUCTURAL. El presente documento tiene por objetivo verificar la capacidad de los porticos del bloque A frente a sismo. Se analizan cargas vivas, muertas y de sismo segun la norma E.030. Los desplazamientos quedan bajo el limite reglamentario. Se concluye que la estructura cumple y se recomienda mantener las secciones propuestas.'));
    const vtxt = r.j.version; await duerme(600); r = await pide('/api/proyectos/' + pm + '/versiones/' + vtxt + '/resumen'); ok(r.status === 200 && r.j.resumen.estado === 'listo' && r.j.resumen.fuente === 'texto' && /objetivo/i.test(r.j.resumen.objetivo) && /concluye/i.test(r.j.resumen.conclusiones), 'resumen automatico por texto: objetivo y conclusiones (' + r.j.resumen.fuente + ')');
    r = await pide('/api/proyectos/' + pm + '/contenedores?q=Memoria'); ok(r.j.contenedores[0].descripcion === '' && r.j.contenedores[0].ultima.resumen.descripcion.length > 20, 'la columna Descripcion ya no toma el resumen (queda en la ficha)');
    const RS = require('../lib/resumen'); const fakeFetch = async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: '{"descripcion":"Memoria estructural del bloque A.","ideas":["Analisis sismico E.030","Desplazamientos dentro del limite"],"objetivo":"Verificar porticos.","conclusiones":"La estructura cumple."}' }] }) });
    // v0.6: flujo con "Mas opciones": atributo con incremento automatico y aprobador que completa otro
    await entra('gestor@anin.gob.pe');
    r = await pide('/api/proyectos/' + pm + '/archivos/configuracion', { method: 'PUT', json: { atributos: [{ id: 'emision', nombre: 'Emisión', tipo: 'texto' }, { id: 'sello', nombre: 'Sello', tipo: 'texto' }] } }); ok(r.status === 200, 'atributos Emisión y Sello definidos');
    r = await pide('/api/proyectos/' + pm + '/flujos', { json: { nombre: 'Un paso con reglas', etapas: [{ nombre: 'Aprobador', pasos: [{ id: 'ap', nombre: 'Aprobacion', tipo: 'uno', revisores: [{ tipo: 'rol', valor: 'gestor' }] }] }], alAprobar: { estado: 'COMPARTIDO', idoneidad: 'S4', revisoresEditanAtributos: true, atributosEn: 'ambas', atributosReglas: { emision: { incremento: true }, sello: { requerido: true } } } } });
    ok(r.status === 200 && r.j.flujo.alAprobar.atributosReglas.emision.incremento && r.j.flujo.alAprobar.atributosReglas.sello.requerido && r.j.flujo.alAprobar.atributosEn === 'ambas', 'el flujo guarda las reglas de atributos (incremento / requerido) y donde actualizarlos');
    const flr = r.j.flujo.id;
    await entra('autor@ghemet.com'); r = await subeM('MANCORA-GHE-ZZ-XX-DR-A-0031-P01.txt', 'E3_DISEÑO/COM/COM CONTRATISTA', Buffer.from('plano')); ok(r.status === 200 && !r.j.retenido, 'archivo conforme cargado en COM');
    const cReg = r.j.contenedor; r = await pide('/api/proyectos/' + pm + '/contenedores/' + cReg + '/atributos', { method: 'PUT', json: { atributos: { emision: 'P01' } } }); ok(r.status === 200 && r.j.atributos.emision === 'P01', 'Emisión = P01 puesta a mano');
    r = await pide('/api/proyectos/' + pm + '/contenedores/' + cReg + '/revisiones', { json: { flujo: flr, nombre: 'Reglas' } }); ok(r.status === 200, 'revision con el flujo de reglas'); const rReg = r.j.id; await entra('gestor@anin.gob.pe');
    r = await pide('/api/proyectos/' + pm + '/revisiones/' + rReg + '/decidir', { json: { decision: 'aprobar', atributos: { sello: 'OK-2026' } } }); ok(r.status === 200 && r.j.estado === 'aprobada', 'el aprobador aprueba completando el atributo requerido');
    r = await pide('/api/proyectos/' + pm + '/contenedores/' + cReg); ok(r.j.atributos.emision === 'P02' && r.j.atributos.sello === 'OK-2026', 'al aprobar: Emisión P01 → P02 (incremento automatico) y Sello = lo que puso el aprobador');
    const ia = await RS.resumenIA('texto', { archivo: 'x.txt', tipo: 'documento' }, { IA_CLAVE: 'k', IA_MODELO: 'claude-prueba' }, fakeFetch); ok(ia.fuente === 'ia' && ia.ideas.length === 2 && ia.modelo === 'claude-prueba', 'con clave, el resumen lo redacta la IA (llamada simulada)');

    console.log('\n13. Buscar - Registro de documentos (como Aconex) v0.6.2');
    await entra('gestor@anin.gob.pe');
    r = await pide('/api/documentos/catalogos'); ok(r.status === 200 && r.j.proyectos.length >= 2 && r.j.tipo.some(x => x.valor === 'DR' && x.enUso) && r.j.columnas.length >= 25 && r.j.tiposFecha.length === 5, 'catalogos: proyectos, tipos (DR en uso), 25+ columnas, 5 tipos de fecha');
    r = await pide('/api/documentos/buscar', { json: { q: 'MANCORA-GHE-ZZ-XX-DR-A-0031', proyectos: [pm] } }); ok(r.status === 200 && r.j.total === 1 && r.j.filas[0].cid === cReg && r.j.filas[0].revision === 'P01' && r.j.filas[0].tipo.startsWith('DR') && r.j.filas[0].disciplina.startsWith('A') && r.j.filas[0].estatusRev === 'Aprobada' && r.j.filas[0].bloqueado === false, 'busqueda por numero: campos parseados por la norma (Tipo DR, Disciplina A), estatus de revision Aprobada, desbloqueado');
    r = await pide('/api/documentos/buscar', { json: { q: '', proyectos: [pm], filtros: { tipo: ['DR'], disciplina: ['A'] } } }); ok(r.status === 200 && r.j.total >= 1 && r.j.filas.every(f => f.proyecto_id === pm), 'filtros Tipo + Discipline acotados a un proyecto');
    r = await pide('/api/documentos/buscar', { json: { q: '', filtros: { estatusRev: ['aprobada'] } } }); ok(r.status === 200 && r.j.total >= 1 && r.j.filas.every(f => f.estatusRev === 'Aprobada'), 'filtro Estatus de revision');
    r = await pide('/api/documentos/buscar', { json: { q: '', fechas: [{ tipo: 'creacion', desde: '2099-01-01', hasta: '' }] } }); ok(r.status === 200 && r.j.total === 0, 'rango de fechas futuro: nada');
    r = await pide('/api/documentos/buscar', { json: { q: 'plano', contenido: true } }); ok(r.status === 200 && r.j.filas.some(f => f.cid === cReg && /plano/i.test(f.fragmento || '')), 'buscar en el CONTENIDO del archivo: encuentra "plano" dentro del .txt y devuelve el fragmento');
    const sinH = await pide('/api/documentos/buscar', { json: { q: '', proyectos: [pm] } }), conH = await pide('/api/documentos/buscar', { json: { q: '', proyectos: [pm], historial: true } }); ok(conH.j.total >= sinH.j.total && sinH.j.filas.every(f => f.version >= 1), 'Mostrar historial de documentos: una fila por version (>= que sin historial)');
    r = await pide('/api/documentos/buscar', { json: { q: '', porPagina: 10, pagina: 2, orden: 'numero', dir: 'desc' } }); ok(r.status === 200 && r.j.pagina === 2 && r.j.porPagina === 10 && r.j.paginas === Math.ceil(r.j.total / 10) && r.j.filas.length === r.j.total - 10 && r.j.filas.length > 0, 'paginacion 10 por pagina, pagina 2 trae el resto, orden desc');
    r = await pide('/api/documentos/busquedas', { json: { nombre: 'Planos aprobados', consulta: { q: '', filtros: { estatusRev: ['aprobada'] } } } }); ok(r.status === 200 && r.j.id, 'Guardar busqueda como…'); const bq = r.j.id;
    r = await pide('/api/documentos/busquedas'); ok(r.status === 200 && r.j.busquedas.some(b => b.id === bq && b.consulta.filtros.estatusRev[0] === 'aprobada'), 'lista de busquedas guardadas (del usuario)');
    r = await pide('/api/documentos/busquedas/' + bq, { method: 'DELETE' }); ok(r.status === 200, 'borrar busqueda guardada');
    r = await pide('/api/documentos/' + pm + '/' + cReg); ok(r.status === 200 && r.j.propiedades.numero === 'MANCORA-GHE-ZZ-XX-DR-A-0031' && r.j.historial.length >= 1 && r.j.historial[0].revision_estado === 'Aprobada' && r.j.relacionados.some(x => x.relacion === 'Revision') && Array.isArray(r.j.enviados) && Array.isArray(r.j.eventos) && typeof r.j.puedoDescargar === 'boolean', 'Propiedades del documento: historial con estado de revision, elementos relacionados (la revision), enviados, eventos');
    await entra('nadie@otra.com'); r = await pide('/api/documentos/' + pm + '/' + cReg); ok(r.status === 403 || r.status === 404, 'quien no es miembro no ve la ficha del documento');
    ok((await RS.textoPdfJs(Buffer.from('no es pdf'))) === '', 'pdf.js en Node: con basura devuelve vacio sin reventar');

    console.log('\n14. Rejilla de conformidad (Cargar archivos de Forma), estado segun la carpeta, revision desde carpeta compartida v0.6.3');
    await entra('gestor@anin.gob.pe');
    const COMg = 'E3_DISEÑO/COM/COM CONTRATISTA', WIPg = 'E3_DISEÑO/WIP/WIP CONTRATISTA';
    const subeG14 = (nombre, cuerpo, qs, meta) => fetch(B + '/api/proyectos/' + pg + '/subir' + (qs || ''), { method: 'POST', headers: Object.assign({ cookie: galleta, 'x-nombre': encodeURIComponent(nombre) }, meta ? { 'x-meta': encodeURIComponent(JSON.stringify(meta)) } : {}), body: cuerpo }).then(async x => ({ status: x.status, j: await x.json() }));
    r = await pide('/api/proyectos/' + pg + '/valida-nombres', { json: { carpeta: COMg, nombres: ['INFORME-000017-2026-DEO-SE-ETL (1).pdf', '100030-JYS01-000-XXX-PLN-CST-E2-000002.pdf'] } });
    ok(r.status === 200 && !r.j.libre && r.j.norma.id === 'anin-docpg002' && r.j.norma.campos.length === 8 && r.j.norma.campos[2].etiquetas['000'] && r.j.norma.campos[0].mascara === '######', 'valida-nombres: devuelve la norma DOCPG002 con sus 8 campos, etiquetas de las tablas y mascara');
    ok(r.j.filas[0].ok === false && r.j.filas[0].partes.length === 8 && r.j.filas[0].partes[0] === 'INFORME' && r.j.filas[0].partes[6] === '' && r.j.filas[0].erroresCampo[0] && r.j.filas[0].erroresCampo[7] && r.j.filas[1].ok === true && r.j.filas[1].erroresCampo.every(e => !e), 'reparte el nombre campo a campo (los que faltan, vacios) con el error de cada uno; el nombre conforme sale limpio');
    ok(r.j.atributos.codigosEstado.length >= 5 && !r.j.atributos.parteDesignada.requerido && !r.j.atributos.parteDesignada.pista && !r.j.atributos.contrato.requerido && !r.j.atributos.contrato.pista && r.j.norma.campos.filter(c => c.tipo === 'lista').length === 5, 'rejilla: codigos de estado; «Parte designada» y «Contrato» ya no se piden; Activo, Nivel, Tipo de documento, Disciplina y Etapa son listas de la libreria maestra');
    r = await pide('/api/proyectos/' + pg + '/valida-nombres', { json: { carpeta: WIPg, nombres: ['lo que sea.pdf'] } }); ok(r.status === 200 && r.j.libre === true && r.j.norma === null && r.j.filas[0].ok, 'en una carpeta WIP (libre) no hay rejilla');
    const PT = require('./portadas');
    r = await subeG14('100030-JYS01-000-XXX-PLN-CST-E2-000002.pdf', PT.pdf({ codigo: '100030-JYS01-000-XXX-PLN-CST-E2-000002', titulo: 'PLAN DE GESTIÓN BIM' }), '?carpeta=' + encodeURIComponent(COMg) + '&revision=R00&idoneidad=S3', { atributos: { parteDesignada: 'JYS01', contrato: '00123', inventado: 'x' } });
    ok(r.status === 200 && r.j.revision === 'R00' && r.j.estado === 'COMPARTIDO', 'carga con la revision indicada en la rejilla (R00) aunque el nombre no la lleve'); const cR = r.j.contenedor;
    r = await pide('/api/proyectos/' + pg + '/contenedores/' + cR); ok(r.j.atributos.parteDesignada === 'JYS01' && r.j.atributos.contrato === '00123' && r.j.atributos.inventado === undefined && r.j.versiones[0].idoneidad === 'S3', 'guarda parte designada y contrato (y no atributos inventados) y el codigo de estado');
    r = await subeG14('100030-JYS01-000-XXX-PLN-CST-E2-000002.pdf', PT.pdf({ codigo: '100030-JYS01-000-XXX-PLN-CST-E2-000002' }), '?carpeta=' + encodeURIComponent(COMg) + '&revision=R00'); ok(r.status === 422 && r.j.error === 'qa' && r.j.qa.checks.some(c => c.id === 'correlativa' && !c.ok), 'una version nueva no puede repetir la revision (la Validación QA exige R01)');
    r = await subeG14('100030-JYS01-000-XXX-PLN-CST-E2-000003.pdf', 'x', '?carpeta=' + encodeURIComponent(COMg) + '&revision=ZZ9'); ok(r.status === 400 && r.j.error === 'revision', 'revision con formato invalido: se rechaza');
    // de WIP (nombre libre) a compartido: renombrar contra la norma del destino + atributos + desplazar => queda COMPARTIDO y se puede revisar
    r = await subeG14('INFORME-000017-2026-DEO-SE-ETL (1).pdf', PT.pdf({ codigo: '100030-JYS01-000-XXX-INF-BIM-E2-000001', titulo: 'INFORME DEL MODELO BIM' }), '?carpeta=' + encodeURIComponent(WIPg)); ok(r.status === 200 && r.j.estado === 'WIP', 'en WIP entra con nombre libre'); const cW = r.j.contenedor;
    r = await pide('/api/proyectos/' + pg + '/contenedores/' + cW + '/mover', { json: { carpeta: COMg } }); ok(r.status === 409 && r.j.error === 'nomenclatura', 'no se desplaza a compartido con el nombre libre');
    r = await pide('/api/proyectos/' + pg + '/contenedores/' + cW + '/renombrar', { json: { nombre: '100030-JYS01-000-XXX-INF-BIM-E2-000001.pdf', carpeta: COMg } }); ok(r.status === 200, 'se renombra contra la norma de la carpeta de destino');
    r = await pide('/api/proyectos/' + pg + '/contenedores/' + cW + '/atributos', { method: 'PUT', json: { atributos: { parteDesignada: 'JYS01', contrato: '00123' }, revision: 'R00', idoneidad: 'S3' } }); ok(r.status === 200 && r.j.atributos.contrato === '00123', 'atributos + revision + codigo de estado de la ultima version');
    r = await pide('/api/proyectos/' + pg + '/contenedores/' + cW); ok(r.j.versiones[0].revision === 'R00' && r.j.versiones[0].idoneidad === 'S3' && /-R00\.pdf$/.test(r.j.versiones[0].archivo), 'la ultima version queda R00 / S3');
    r = await pide('/api/proyectos/' + pg + '/contenedores/' + cW + '/atributos', { method: 'PUT', json: { atributos: {}, revision: 'XX' } }); ok(r.status === 400, 'revision invalida por atributos: 400');
    r = await pide('/api/proyectos/' + pg + '/contenedores/' + cW + '/mover', { json: { carpeta: COMg } }); ok(r.status === 200 && r.j.estado === 'COMPARTIDO', 'al entrar a la carpeta compartida el archivo queda COMPARTIDO');
    r = await pide('/api/proyectos/' + pg + '/contenedores/' + cW + '/revisiones', { json: {} }); ok(r.status === 200 && r.j.ronda === 1, 'y se puede enviar a revision desde la carpeta');
    r = await pide('/api/proyectos/' + pg + '/contenedores/' + cW + '/mover', { json: { carpeta: WIPg } }); ok(r.status === 200 && r.j.estado === 'COMPARTIDO', 'con revision abierta el desplazamiento no cambia el estado');
    // un archivo que quedo WIP dentro de una carpeta compartida (datos anteriores) se puede revisar: pasa a COMPARTIDO al enviarlo
    require('../lib/bd').q.corre("UPDATE contenedores SET estado = 'WIP' WHERE id = ?", cR);
    r = await pide('/api/proyectos/' + pg + '/contenedores/' + cR + '/revisiones', { json: {} }); ok(r.status === 200, 'un WIP que esta en carpeta compartida se envia a revision');
    r = await pide('/api/proyectos/' + pg + '/contenedores/' + cR); ok(r.j.estado === 'COMPARTIDO', 'y queda COMPARTIDO');
    const ISO14 = require('../lib/iso19650'); ok(ISO14.errorCampo({ nombre: 'Etapa', valores: ['E1', 'E2'] }, 'E9') !== '' && ISO14.errorCampo({ nombre: 'Etapa', valores: ['E1', 'E2'] }, 'E2') === '' && ISO14.errorCampo({ nombre: 'N', obligatorio: false, longitud: 3 }, 'XXX') === '', 'errorCampo: lista, valor admitido y campo opcional con XXX');

    { // v0.24.0: Validación QA de portadas al entrar al compartido (cargar, desplazar, copiar, desplazar carpeta)
      console.log('\n14b. Validación QA de portadas (PDF y Word que entran al compartido)');
      const K = (n) => '100030-JYS01-000-XXX-' + n, sube = (nombre, cuerpo, carpeta) => subeG14(nombre, cuerpo, '?carpeta=' + encodeURIComponent(carpeta));
      const fallas = (x) => ((x.j.qa && x.j.qa.checks) || []).filter(c => !c.ok).map(c => c.id).join(',');
      let x = await sube(K('INF-ARQ-E2-000010') + '.pdf', PT.pdf({ codigo: K('INF-ARQ-E2-000010'), titulo: 'INFORME DE DIAGNÓSTICO DEL MODELO' }), COMg);
      ok(x.status === 200 && x.j.revision === 'R00' && x.j.qa && x.j.qa.ok, 'PDF con la portada de la plantilla: entra al compartido en R00 (' + x.status + ' ' + (x.j.mensaje || x.j.revision) + ')'); const cQ = x.j.contenedor;
      let f = await pide('/api/proyectos/' + pg + '/contenedores/' + cQ); ok(f.j.atributos.descripcion === 'INFORME DE DIAGNÓSTICO DEL MODELO' && f.j.versiones[0].revision === 'R00', 'el nombre de la portada queda como descripción del documento');
      x = await sube(K('INF-ARQ-E2-000010') + '.pdf', PT.pdf({ codigo: K('INF-ARQ-E2-000010'), rev: 'R01', emision: '05/02/2026', filas: [['R00', '22/01/2026'], ['R01', '05/02/2026']] }), COMg);
      ok(x.status === 200 && x.j.revision === 'R01' && x.j.n === 2, 'la versión siguiente entra en R01 (' + x.status + ' ' + (x.j.mensaje || '') + ')');
      x = await sube(K('INF-ARQ-E2-000010') + '.pdf', PT.pdf({ codigo: K('INF-ARQ-E2-000010'), rev: 'R03', emision: '01/03/2026', filas: [['R03', '01/03/2026']] }), COMg);
      ok(x.status === 422 && fallas(x) === 'correlativa', 'si la portada se salta la revisión que corresponde (R02), se rechaza (' + fallas(x) + ')');
      x = await sube(K('INF-ARQ-E2-000011') + '.pdf', PT.pdf({ codigo: K('INF-ARQ-E2-000011'), rev: 'R00', emision: '05/02/2026' }), COMg);
      f = await pide('/api/proyectos/' + pg + '/contenedores?carpeta=' + encodeURIComponent(COMg));
      ok(x.status === 422 && fallas(x) === 'coincide' && !f.j.contenedores.some(c => c.nombre === K('INF-ARQ-E2-000011')), 'emisión del cajetín distinta de la fecha del cuadro: no entra y no deja documento (' + fallas(x) + ')');
      x = await sube(K('INF-ARQ-E2-000014') + '.pdf', PT.pdf({ codigo: K('INF-ARQ-E2-000099') }), COMg); ok(x.status === 422 && fallas(x) === 'codigo', 'el código de la portada debe ser el del documento (' + fallas(x) + ')');
      x = await sube(K('MDE-ARQ-E2-000012') + '.docx', PT.docx({ codigo: K('MDE-ARQ-E2-000012'), titulo: 'MEMORIA DESCRIPTIVA DE ARQUITECTURA' }), COMg); ok(x.status === 200 && x.j.qa.ok && x.j.revision === 'R00', 'Word con la portada de la plantilla: entra (' + x.status + ' ' + (x.j.mensaje || '') + ')');
      x = await sube(K('MDE-ARQ-E2-000013') + '.docx', PT.docx({ codigo: K('MDE-ARQ-E2-000013'), sello: false }), COMg); ok(x.status === 422 && fallas(x) === 'sello', 'sin el sello «Revisión de documentos técnicos» no entra (' + fallas(x) + ')');
      x = await sube(K('INF-ARQ-E2-000019') + '.docx', PT.docx({ codigo: K('INF-ARQ-E2-000019'), logo: true, contrato: 'CONTRATO: NOMBRE DEL CONTRATO' }), COMg); ok(x.status === 422 && fallas(x) === 'llenado', 'cajetín con los textos de la plantilla (logo, contrato) no entra (' + fallas(x) + ')');
      x = await sube(K('INF-ARQ-E2-000020') + '.pdf', PT.pdf({ vacia: true }), COMg); ok(x.status === 422 && fallas(x) === 'lectura', 'un PDF sin texto (escaneado) no se puede validar: no entra');
      x = await sube(K('PLA-ARQ-E2-000015') + '.pdf', 'plano sin portada', COMg); ok(x.status === 200 && x.j.qa && x.j.qa.aplica === false && /Plano/.test(x.j.qa.motivo), 'los planos (PLA) no pasan por la QA de portada (tendrán la del membrete)');
      x = await sube(K('MTZ-ARQ-E2-000016') + '.xlsx', 'hoja', COMg); ok(x.status === 200 && x.j.qa && x.j.qa.aplica === false, 'un Excel no lleva portada: entra sin QA');
      x = await sube(K('INF-ARQ-E2-000021') + '.pdf', 'en WIP no se valida', WIPg); ok(x.status === 200 && x.j.estado === 'WIP' && !x.j.qa, 'en el WIP no se exige la QA');
      // desplazar de WIP al compartido: validación previa, la portada propone el nombre, y la QA vuelve a correr al desplazar
      x = await sube('memoria final.pdf', PT.pdf({ codigo: K('MDE-ARQ-E2-000017'), titulo: 'MEMORIA DE CÁLCULO ESTRUCTURAL' }), WIPg); const cM = x.j.contenedor;
      let v = await pide('/api/proyectos/' + pg + '/qa/contenedores', { json: { ids: [cM], carpeta: COMg } });
      ok(v.j.ok === true && v.j.resultados[0].renombrar === K('MDE-ARQ-E2-000017') + '.pdf', 'validación previa al desplazar: aprobada y propone como nombre el código de la portada (' + JSON.stringify(v.j.resultados.map(r => r.renombrar || r.motivo)) + ')');
      await pide('/api/proyectos/' + pg + '/contenedores/' + cM + '/renombrar', { json: { nombre: K('MDE-ARQ-E2-000017') + '.pdf', carpeta: COMg } });
      await pide('/api/proyectos/' + pg + '/contenedores/' + cM + '/atributos', { method: 'PUT', json: { atributos: {}, revision: 'R00' } });   // lo que hace la rejilla antes de desplazar
      x = await pide('/api/proyectos/' + pg + '/contenedores/' + cM + '/mover', { json: { carpeta: COMg } }); f = await pide('/api/proyectos/' + pg + '/contenedores/' + cM);
      ok(x.status === 200 && x.j.qa && x.j.qa.revision === 'R00' && f.j.estado === 'COMPARTIDO' && f.j.atributos.descripcion === 'MEMORIA DE CÁLCULO ESTRUCTURAL', 'desplazado al compartido con la QA aprobada: R00 y la descripción de la portada (' + x.status + ' ' + (x.j.mensaje || '') + ')');
      x = await sube(K('INF-ARQ-E2-000018') + '.pdf', PT.pdf({ codigo: K('INF-ARQ-E2-000018'), emision: '30/01/2026' }), WIPg); const cMal = x.j.contenedor;
      v = await pide('/api/proyectos/' + pg + '/qa/contenedores', { json: { ids: [cMal], carpeta: COMg } }); x = await pide('/api/proyectos/' + pg + '/contenedores/' + cMal + '/mover', { json: { carpeta: COMg } }); f = await pide('/api/proyectos/' + pg + '/contenedores/' + cMal);
      ok(v.j.ok === false && x.status === 422 && x.j.error === 'qa' && f.j.carpeta === WIPg && f.j.estado === 'WIP', 'si la portada no pasa, no se desplaza y se queda en el WIP (' + x.status + ')');
      // copiar al compartido: la copia nace en R00 y su nombre es el código de la portada
      x = await pide('/api/proyectos/' + pg + '/contenedores/' + cMal + '/copiar', { json: { carpeta: COMg, nombre: K('INF-ARQ-E2-000022') + '.pdf' } }); ok(x.status === 422 && x.j.error === 'qa' && fallas(x).includes('codigo'), 'copiar al compartido también exige la QA: la copia lleva otro nombre y la portada otro código (' + x.status + ' ' + fallas(x) + ')');
      // desplazar una CARPETA del WIP al compartido con un documento que no pasa la QA
      await pide('/api/proyectos/' + pg + '/carpetas', { json: { padre: WIPg, nombre: 'QA-LOTE' } });
      await pide('/api/proyectos/' + pg + '/contenedores/' + cMal + '/mover', { json: { carpeta: WIPg + '/QA-LOTE' } });
      x = await pide('/api/proyectos/' + pg + '/carpetas/mover', { json: { ruta: WIPg + '/QA-LOTE', destino: COMg } }); f = await pide('/api/proyectos/' + pg);
      ok(x.status === 422 && x.j.error === 'qa' && x.j.resultados.length === 1 && f.j.arbol.some(c => c.ruta === WIPg + '/QA-LOTE'), 'una carpeta del WIP con un documento que no pasa la QA no se desplaza al compartido (' + x.status + ')');
      const QAm = require('../lib/qa'); ok(QAm.revisionEsperada([], true) === 'R00' && QAm.revisionEsperada(['R00', 'R01'], false) === 'R02' && QAm.revisionEsperada(['P01', 'P02'], false) === 'R02' && QAm.revisionEsperada(['P01'], true) === 'R00', 'revisión que corresponde: R00 la primera vez, luego la siguiente');
    }

    { // v0.24.1: QA gráfica (cajas sobre la portada), sello pegado como imagen y nombre del documento solo con el título del recuadro
      console.log('\n14d. Validación QA gráfica: cajas en la portada, sello como imagen y título sin «PROYECTO:»');
      const K = (n) => '100030-JYS01-000-XXX-' + n, sube = (nombre, cuerpo, carpeta) => subeG14(nombre, cuerpo, '?carpeta=' + encodeURIComponent(carpeta)), fx = typeof firma === 'function' ? firma : (b) => b;
      const QAm = require('../lib/qa');
      let q = await QAm.validaArchivo(PT.pdf({ codigo: K('PLN-ARQ-E2-000060'), titulo: 'PLAN DE GESTIÓN DE DISEÑO', proyecto: 'PROYECTO: “MEJORAMIENTO DE LA COBERTURA DE LOS SERVICIOS DE SALUD”' }), 'x.pdf', { codigo: K('PLN-ARQ-E2-000060') });
      ok(q.ok && q.datos.titulo === 'PLAN DE GESTIÓN DE DISEÑO', 'el nombre del documento es solo el título del recuadro: el bloque «PROYECTO: …» de debajo no entra (' + q.datos.titulo + ')');
      q = await QAm.validaArchivo(PT.pdf({ codigo: K('INF-ARQ-E2-000061'), sello: false, selloImagen: {} }), 'x.pdf', { codigo: K('INF-ARQ-E2-000061') });
      const cS = q.zonas && q.zonas.cajas.find(z => z.id === 'sello');
      ok(q.ok && q.checks.find(c => c.id === 'sello').ok && cS && !cS.esperada && Math.round(cS.w) === 150, 'el sello pegado como imagen bajo el cajetín se reconoce (ubicación, forma, fondo claro y marco)');
      q = await QAm.validaArchivo(PT.pdf({ codigo: K('INF-ARQ-E2-000062'), sello: false, selloImagen: { marco: false } }), 'x.pdf', { codigo: K('INF-ARQ-E2-000062') });
      ok(!q.ok && q.checks.find(c => c.id === 'sello' && !c.ok) && q.zonas.cajas.find(z => z.id === 'sello').esperada, 'una imagen sin marco en ese lugar no es el sello: falta, y se marca dónde debería ir');
      q = await QAm.validaArchivo(PT.pdf({ codigo: K('INF-ARQ-E2-000063') }), 'x.pdf', { codigo: K('INF-ARQ-E2-000063') });
      ok(q.zonas && q.zonas.pagina.w === 612 && ['cajetin', 'revision', 'emision', 'codigo', 'titulo', 'direccion', 'cuadro', 'sello'].every(id => q.zonas.cajas.some(z => z.id === id && z.w > 0 && z.h > 0)), 'la QA devuelve la caja de cada comprobación sobre la portada (cajetín, revisión, emisión, código, nombre, dirección, cuadro y sello)');
      let x = await sube(K('INF-ARQ-E2-000064') + '.pdf', fx(PT.pdf({ codigo: K('INF-ARQ-E2-000064'), sello: false, selloImagen: {} })), COMg);
      ok(x.status === 200 && x.j.qa && x.j.qa.ok, 'un PDF con el sello como imagen entra al compartido (' + x.status + ' ' + (x.j.mensaje || '') + ')');
      x = await sube(K('INF-ARQ-E2-000065') + '.pdf', PT.pdf({ codigo: K('INF-ARQ-E2-000066') }), COMg);
      ok(x.status === 422 && x.j.qa.tipo === 'pdf' && x.j.qa.zonas.cajas.some(z => z.id === 'codigo'), 'si no pasa, la respuesta trae las cajas para dibujar la portada con lo que está mal');
      x = await sube('memoria con sello imagen.pdf', PT.pdf({ codigo: K('MDE-ARQ-E2-000067'), sello: false, selloImagen: {} }), WIPg);
      const v = await pide('/api/proyectos/' + pg + '/qa/contenedores', { json: { ids: [x.j.contenedor], carpeta: COMg } });
      ok(v.j.resultados[0].version && v.j.resultados[0].qa.zonas && v.j.resultados[0].qa.checks.find(c => c.id === 'sello').ok, 'la validación previa al desplazar dice qué versión dibujar y trae sus cajas');
    }

    { // v0.24.2: el código de proyecto del nombre y de la portada debe ser el del proyecto; la portada da nombre, revisión y descripción
      console.log('\n14e. Código del proyecto y lectura previa de la portada al cargar al compartido');
      const K = (n) => '100030-JYS01-000-XXX-' + n, fx = typeof firma === 'function' ? firma : (b) => b;
      const BDp = require('../lib/bd'), codAntes = BDp.q.uno('SELECT codigo FROM proyectos WHERE id = ?', pg).codigo; BDp.q.corre('UPDATE proyectos SET codigo = ? WHERE id = ?', '100030', pg);   // el proyecto de prueba pasa a tener código de 6 dígitos
      const ajeno = '100099-JYS01-000-XXX-INF-ARQ-E2-000070.pdf';
      let v = await pide('/api/proyectos/' + pg + '/valida-nombres', { json: { carpeta: COMg, nombres: [ajeno, K('INF-ARQ-E2-000070') + '.pdf'] } });
      ok(v.j.filas[0].ok === false && /100030/.test(v.j.filas[0].erroresCampo[0] || '') && v.j.filas[1].ok === true, 'la rejilla marca el código de proyecto de otro proyecto (100099 en el proyecto 100030)');
      let x = await subeG14(ajeno, fx(PT.pdf({ codigo: '100099-JYS01-000-XXX-INF-ARQ-E2-000070' })), '?carpeta=' + encodeURIComponent(COMg));
      ok(x.status === 400 && x.j.error === 'nomenclatura' && /100099.*100030/.test(x.j.mensaje), 'la carga rechaza un nombre con el código de otro proyecto (' + x.status + ' ' + (x.j.mensaje || '') + ')');
      const lee = async (nombre, cuerpo) => { const r = await fetch(B + '/api/proyectos/' + pg + '/qa/leer?carpeta=' + encodeURIComponent(COMg), { method: 'POST', headers: { cookie: galleta, 'x-nombre': encodeURIComponent(nombre), 'content-type': 'application/octet-stream' }, body: cuerpo }); return { status: r.status, j: await r.json().catch(() => ({})) }; };
      let L = await lee('Plan de gestion de diseño.pdf', fx(PT.pdf({ codigo: K('PLN-ARQ-E2-000071'), titulo: 'PLAN DE GESTIÓN DE DISEÑO', proyecto: 'PROYECTO: “MEJORAMIENTO DEL HOSPITAL”' })));
      ok(L.status === 200 && L.j.aplica && !L.j.conforme && L.j.qa.ok && L.j.sugerido === K('PLN-ARQ-E2-000071') + '.pdf' && L.j.qa.datos.titulo === 'PLAN DE GESTIÓN DE DISEÑO' && L.j.qa.datos.esperada === 'R00' && L.j.token, 'lectura previa: de la portada salen el nombre (código), la revisión que corresponde (R00) y la descripción');
      x = await fetch(B + '/api/proyectos/' + pg + '/subir?carpeta=' + encodeURIComponent(COMg), { method: 'POST', headers: { cookie: galleta, 'x-nombre': encodeURIComponent(L.j.sugerido), 'x-qa-pre': L.j.token, 'content-type': 'application/octet-stream' } }).then(async r => ({ status: r.status, j: await r.json() }));
      let f = x.j.contenedor ? await pide('/api/proyectos/' + pg + '/contenedores/' + x.j.contenedor) : { j: {} };
      ok(x.status === 200 && x.j.revision === 'R00' && f.j.atributos && f.j.atributos.descripcion === 'PLAN DE GESTIÓN DE DISEÑO' && f.j.versiones[0].tamano > 1000, 'la carga usa el archivo de la lectura previa (no se sube dos veces): entra en R00 con la descripción de la portada (' + x.status + ' ' + (x.j.mensaje || '') + ')');
      L = await lee('otro proyecto.pdf', fx(PT.pdf({ codigo: '100099-JYS01-000-XXX-INF-ARQ-E2-000072' })));
      const cP = L.j.qa && L.j.qa.checks.find(c => c.id === 'proyecto');
      ok(L.status === 200 && L.j.qa.ok === false && cP && !cP.ok && /100099.*100030/.test(cP.detalle) && L.j.qa.zonas.cajas.some(z => z.id === 'proyecto'), 'una portada de otro proyecto no pasa la QA («Código del proyecto»: 100099 ≠ 100030) y se marca en la portada');
      L = await lee('planilla.xlsx', Buffer.from('x')); ok(L.status === 200 && L.j.aplica === false && L.j.token, 'lo que no lleva QA (p. ej. una hoja de cálculo) vuelve a la rejilla de siempre');
      x = await subeG14('memoria otro proyecto.pdf', PT.pdf({ codigo: '100099-JYS01-000-XXX-MDE-ARQ-E2-000073' }), '?carpeta=' + encodeURIComponent(WIPg));
      v = await pide('/api/proyectos/' + pg + '/qa/contenedores', { json: { ids: [x.j.contenedor], carpeta: COMg } });
      ok(v.j.resultados[0].qa.checks.some(c => c.id === 'proyecto' && !c.ok), 'al desplazar del WIP, una portada de otro proyecto tampoco pasa');
      x = await pide('/api/proyectos/' + pg + '/contenedores/' + x.j.contenedor + '/renombrar', { json: { nombre: '100099-JYS01-000-XXX-MDE-ARQ-E2-000073.pdf', carpeta: COMg } });
      ok(x.status === 400 && /100030/.test(x.j.mensaje || ''), 'y no se puede renombrar con el código de otro proyecto para una carpeta con norma');
      BDp.q.corre('UPDATE proyectos SET codigo = ? WHERE id = ?', codAntes, pg);
      { const QAm = require('../lib/qa'); let q = await QAm.validaArchivo(PT.pdf({ codigo: K('INF-ARQ-E2-000074'), pagina: 'Página 1 de 1' }), 'x.pdf', { codigo: K('INF-ARQ-E2-000074') });
        ok(q.ok && q.checks.find(c => c.id === 'paginas').ok && q.zonas.cajas.some(z => z.id === 'paginas'), '«Página 1 de 1» sin dos puntos también vale, y el total coincide con las páginas del archivo');
        q = await QAm.validaArchivo(PT.pdf({ codigo: K('INF-ARQ-E2-000074'), pagina: 'Página: 1 de 78' }), 'x.pdf', { codigo: K('INF-ARQ-E2-000074') });
        ok(!q.ok && q.checks.filter(c => !c.ok).map(c => c.id).join() === 'paginas' && /78.*1 página/.test(q.checks.find(c => c.id === 'paginas').detalle), 'si la portada dice «1 de 78» y el archivo tiene 1 página, no pasa (' + q.checks.find(c => c.id === 'paginas').detalle + ')'); }
    }

    { // v0.24.3: ficha de análisis del documento (contenido de principio a fin)
      console.log('\n14f. Ficha de análisis: encabezados, fechas, códigos, citas y comentarios en todo el documento');
      const AN = require('../lib/analisis'), cab = (rev, emi, k, n) => 'PRESIDENCIA DEL CONSEJO DE MINISTROS Revisión: ' + rev + '\nEmisión: ' + emi + '\nPágina: ' + k + ' de ' + n;
      const P = (k, texto, c) => ({ n: k, texto: (c || '') + '\n' + texto, cab: c || '', notas: 0 }), COD = '100030-JYS01-000-XXX-INF-ARQ-E2-000080';
      const base = { total: 4, portada: { revision: 'R01', emision: '05/02/2026', filas: [{ rev: 'R00', fecha: '22/01/2026' }, { rev: 'R01', fecha: '05/02/2026' }] }, codigo: COD, proyecto: '100030', existe: (c) => c === '100030-JYS01-000-XXX-PLN-ARQ-E2-000001' };
      let r = AN.comprueba(Object.assign({}, base, { paginas: [P(1, 'portada ' + COD, cab('R01', '05/02/2026', 1, 4)), P(2, 'ver 100030-JYS01-000-XXX-PLN-ARQ-E2-000001 del 10/01/2026', cab('R01', '05/02/2026', 2, 4)), P(3, 'texto', cab('R01', '05/02/2026', 3, 4)), P(4, 'cierre', cab('R01', '05/02/2026', 4, 4))] }));
      ok(r.cuenta.mal === 0 && r.cuenta.aviso === 0 && r.referencias.length === 1 && r.referencias[0].enCde && r.fechas.total >= 3, 'un documento coherente: encabezados, numeración, fechas y citas conformes');
      r = AN.comprueba(Object.assign({}, base, { paginas: [P(1, 'portada', cab('R01', '05/02/2026', 1, 4)), P(2, 'plazo 31/02/2026 y entrega 20/03/2026; ver 100030-JYS01-000-XXX-PLN-ARQ-E2-000099 y 100099-JYS01-000-XXX-PLN-ARQ-E2-000001', cab('R00', '05/02/2026', 2, 4)), P(3, 'valor por definir', cab('R01', '22/01/2026', 3, 9)), Object.assign(P(4, '', ''), { notas: 2 })] }));
      const t = (x) => r.hallazgos.find(h => h.titulo.startsWith(x)) || { paginas: [] };
      ok(t('Revisión del encabezado').nivel === 'mal' && t('Revisión del encabezado').paginas.join() === '2' && t('Fecha de emisión del encabezado').paginas.join() === '3' && t('Numeración').nivel === 'mal', 'detecta la página con otra revisión, la de otra fecha de emisión y el total de páginas que no cuadra, y dice en qué página');
      ok(t('Fechas que no existen').nivel === 'mal' && t('Fechas posteriores').nivel === 'aviso' && /20\/03\/2026/.test(t('Fechas posteriores').detalle), 'detecta una fecha imposible (31/02) y una fecha posterior a la emisión');
      ok(t('Cita documentos de otro proyecto').nivel === 'aviso' && t('Documentos citados').nivel === 'aviso' && /000099/.test(t('Documentos citados').detalle), 'detecta un código de otro proyecto y un documento citado que no está en el CDE');
      ok(t('Texto sin terminar').paginas.join() === '3' && t('El PDF trae comentarios').paginas.join() === '4' && t('Páginas sin texto').paginas.join() === '4', 'detecta «por definir», comentarios que quedaron en el PDF y páginas sin texto');
      r = AN.comprueba({ paginas: [P(1, 'x', '')], total: 1, portada: { filas: [{ rev: 'R00', fecha: '10/03/2026' }, { rev: 'R01', fecha: '01/03/2026' }] }, word: { cambios: 3, comentarios: 2 } });
      ok(r.hallazgos.some(h => h.nivel === 'mal' && /orden de fecha/.test(h.titulo)) && r.hallazgos.some(h => h.nivel === 'mal' && /control de cambios/.test(h.titulo)), 'detecta el cuadro de revisiones con fechas desordenadas y un Word con control de cambios o comentarios');
      ok(AN.fechasDe('el 12 de marzo de 2026 y 3-4-2026').filter(f => f.valida).length === 2, 'lee fechas con barra, guion y en texto («12 de marzo de 2026»)');
      // en el CDE: la ficha se genera sola al cargar
      const x = await subeG14('100030-JYS01-000-XXX-INF-ARQ-E2-000081.pdf', PT.pdf({ codigo: '100030-JYS01-000-XXX-INF-ARQ-E2-000081' }), '?carpeta=' + encodeURIComponent(WIPg));
      let f = null; for (let i = 0; i < 20; i++) { await duerme(300); f = await pide('/api/proyectos/' + pg + '/versiones/' + x.j.version + '/resumen'); if (f.j.resumen.estado === 'listo') break; }
      ok(f.j.resumen.estado === 'listo' && f.j.resumen.analisis && f.j.resumen.analisis.tipo === 'pdf' && f.j.resumen.analisis.paginas.total === 1 && Array.isArray(f.j.resumen.analisis.hallazgos) && !f.j.resumen.analisis.textoPorPagina, 'al cargar un PDF, su ficha trae la verificación automática del contenido');
      const RS2 = require('../lib/resumen'); let visto = '';
      const ia = await RS2.resumenIA('[pág. 1]\ntexto', { archivo: 'x.pdf', tipo: 'documento', analisis: { portada: { revision: 'R00' }, hallazgos: [{ nivel: 'aviso', titulo: 'T', detalle: 'D' }] } }, { IA_CLAVE: 'k' }, async (u, o) => { visto = JSON.parse(o.body).messages[0].content; return { ok: true, json: async () => ({ content: [{ type: 'text', text: '{"descripcion":"d","objetivo":"o","alcance":"a","ideas":["i"],"conclusiones":"c","inconsistencias":[{"texto":"El área dice 500 m2 en 3.1 y 650 m2 en 5.2","paginas":[4,9]}],"fechas_clave":[{"fecha":"10/03/2026","que":"entrega"}],"pendientes":["definir"]}' }] }) }; });
      ok(ia.alcance === 'a' && ia.inconsistencias[0].paginas.join() === '4,9' && ia.fechasClave[0].que === 'entrega' && ia.pendientes.length === 1 && /inconsistencias/.test(visto) && /T — D/.test(visto), 'con IA, la ficha suma alcance, inconsistencias con sus páginas, fechas clave y pendientes (y la IA recibe las comprobaciones como contexto)');
    }

    // ───────────── 15. Plantilla por zonas y flujo de revisión en paralelo (DC · especialistas · GP)
    console.log('\n15. Plantilla por zonas y flujo paralelo');
    galleta = ''; await pide('/api/acceso/local', { json: { email: 'admin@anin.gob.pe', clave: 'prueba' } });
    r = await pide('/api/proyectos', { json: { codigo: 'ZONAS', nombre: 'Hospital por zonas', norma: 'default-iso19650', plantilla: 'zonas', orgContr: 'GHEMET', orgSuper: 'SUPERV', etapaActual: 'E2' } }); ok(r.status === 200, 'crea proyecto con la plantilla por zonas'); const pz = r.j.id;
    r = await pide('/api/proyectos/' + pz); const rz = r.j.arbol.map(c => c.ruta);
    ok(r.j.config.carpetas.length === 35 && rz.includes('WIP/ETAPA 1/CONTRATISTA') && rz.includes('WIP/ETAPA 4/SUPERVISION') && rz.includes('COM/ETAPA 3/CONTRATISTA') && rz.includes('COM/ETAPA 2/SUPERVISION') && rz.includes('PUB/ETAPA 1/PUB CLIENTE') && !rz.some(x => /^(WIP|COM)\/.*CLIENTE/.test(x)), 'por zonas: 35 carpetas, WIP y COM › ETAPA n › CONTRATISTA / SUPERVISION, PUB › ETAPA n › PUB CLIENTE (' + r.j.config.carpetas.length + ')');
    ok(rz.indexOf('WIP') < rz.indexOf('COM') && rz.indexOf('COM') < rz.indexOf('PUB'), 'el orden es WIP → COM → PUB');
    r = await pide('/api/proyectos/' + pz + '/carpetas/permisos?ruta=' + encodeURIComponent('COM/ETAPA 2/CONTRATISTA')); ok(r.j.zonaEfectiva === 'compartido' && r.j.entradas.some(e => e.valor === 'GHEMET' && e.nivel === 'ver-descargar-subir-editar'), 'COM/ETAPA 2/CONTRATISTA: zona compartido y la edita el contratista');
    r = await pide('/api/proyectos/' + pz + '/carpetas/permisos?ruta=' + encodeURIComponent('PUB/ETAPA 2/PUB CLIENTE')); ok(r.j.zonaEfectiva === 'publicado', 'PUB/ETAPA 2/PUB CLIENTE: zona publicado');
    r = await pide('/api/proyectos/' + pz + '/flujos'); const fpar = (r.j.flujos || r.j).find(f => f.id === 'paralelo-dc-especialistas-gp');
    ok(fpar && fpar.etapas.length === 3 && fpar.etapas[0].modo === 'consenso' && fpar.etapas[0].alVencer === 'avanzar' && fpar.etapas[0].pasos.length === 2 && fpar.etapas[1].pasos.every(x => x.recomienda) && fpar.etapas[1].pasos[1].decide.length === 1 && fpar.etapas[0].pasos[1].revisores[0].org === 'SUPERV', 'el proyecto nace con el flujo paralelo: paso 1 por consenso (2 DC), paso 2 con recomendaciones y decisión del KP1, paso 3 GP');
    const MZ = [['autor@ghemet.com', 'document-control', 'GHEMET', ''], ['dc@anin.gob.pe', 'revisor', 'ANIN', 'DC'], ['dc@superv.com', 'revisor', 'SUPERV', 'DC'], ['esp1@anin.gob.pe', 'revisor', 'ANIN', 'ESPECIALISTA'], ['esp2@anin.gob.pe', 'revisor', 'ANIN', 'ESPECIALISTA'], ['esp@superv.com', 'revisor', 'SUPERV', 'ESPECIALISTA'], ['kp1@superv.com', 'revisor', 'SUPERV', 'KP1'], ['gp@anin.gob.pe', 'gestor', 'ANIN', 'GP']];
    for (const [e, rol, org, cargo] of MZ) { r = await pide('/api/proyectos/' + pz + '/miembros', { json: { email: e, rol, organizacion: org, cargo } }); if (r.status !== 200) ok(false, 'agrega ' + e + ' ' + JSON.stringify(r.j)); }
    r = await pide('/api/proyectos/' + pz + '/miembros'); ok((r.j.miembros || r.j).find(m => m.email === 'kp1@superv.com').cargo === 'KP1', 'los miembros guardan su cargo (DC, ESPECIALISTA, KP1, GP)');
    const entraZ = async (e) => { galleta = ''; await pide('/api/acceso/local', { json: { email: e, clave: 'prueba' } }); };
    const subeZ = (nombre) => fetch(B + '/api/proyectos/' + pz + '/subir?carpeta=' + encodeURIComponent('COM/ETAPA 2/CONTRATISTA'), { method: 'POST', headers: { cookie: galleta, 'x-nombre': encodeURIComponent(nombre) }, body: Buffer.from('contenido ' + nombre) }).then(async x => ({ status: x.status, j: await x.json() }));
    const decideZ = (rid, cuerpo) => pide('/api/proyectos/' + pz + '/revisiones/' + rid + '/decidir', { json: cuerpo });
    const miaZ = async (rid) => (await pide('/api/proyectos/' + pz + '/revisiones')).j.revisiones.find(x => x.id === rid);
    const abreZ = async (n) => { await entraZ('autor@ghemet.com'); let x = await subeZ('ZONAS-GHE-ZZ-XX-DR-A-' + n + '-P01.pdf'); if (x.status !== 200) throw new Error('sube ' + JSON.stringify(x.j)); const cid = x.j.contenedor; x = await pide('/api/proyectos/' + pz + '/contenedores/' + cid + '/revisiones', { json: { flujo: 'paralelo-dc-especialistas-gp' } }); if (x.status !== 200) throw new Error('abre ' + JSON.stringify(x.j)); return { cid, rid: x.j.id }; };
    await entraZ('autor@ghemet.com'); r = await pide('/api/proyectos/' + pz); ok(r.j.carpetaWip === 'WIP/ETAPA 2/CONTRATISTA', 'el WIP del contratista es WIP/ETAPA 2/CONTRATISTA (etapa en curso) (' + r.j.carpetaWip + ')');

    // A) los dos DC aceptan → paso 2; recomendaciones; KP1; GP
    let z = await abreZ('1001');
    await entraZ('dc@anin.gob.pe'); let mz = await miaZ(z.rid); ok(mz.puedoDecidir && mz.acciones.some(a => a.paso === 'dc-anin' && a.accion === 'decidir') && mz.flujo.etapas[0].etiquetas.devuelta === 'QA Rejected', 'paso 1: el DC de ANIN tiene su revisión de calidad pendiente (QA Accepted / QA Rejected)');
    r = await decideZ(z.rid, { decision: 'aprobar' }); ok(r.status === 200 && r.j.estado === 'abierta' && r.j.etapa === 0, 'el DC que termina primero sin comentarios espera al otro');
    await entraZ('esp1@anin.gob.pe'); r = await decideZ(z.rid, { decision: 'aprobar' }); ok(r.status === 403, 'un especialista no decide en el paso 1');
    await entraZ('dc@superv.com'); r = await decideZ(z.rid, { decision: 'aprobar' }); ok(r.status === 200 && r.j.etapa === 1 && r.j.estado === 'abierta', 'QA Accepted de los dos DC → pasa a los especialistas');
    await entraZ('esp1@anin.gob.pe'); mz = await miaZ(z.rid); ok(mz.acciones.some(a => a.paso === 'esp-gp' && a.accion === 'recomendar'), 'paso 2: al especialista del GP le toca recomendar');
    r = await decideZ(z.rid, { decision: 'aprobar', comentario: 'sin observaciones' }); ok(r.status === 200 && r.j.etapa === 1, 'el especialista 1 recomienda Aceptar');
    mz = await miaZ(z.rid); ok(!mz.puedoDecidir, 'y deja de tenerlo pendiente');
    await entraZ('gp@anin.gob.pe'); r = await decideZ(z.rid, { decision: 'aprobar' }); ok(r.status === 403, 'el GP no decide mientras los especialistas no cierran');
    await entraZ('esp2@anin.gob.pe'); r = await decideZ(z.rid, { decision: 'devolver', comentario: 'falta detalle' }); ok(r.status === 200 && r.j.estado === 'abierta' && r.j.etapa === 1, 'el especialista 2 recomienda Rechazar: la revisión NO se cierra (solo recomienda)');
    await entraZ('kp1@superv.com'); mz = await miaZ(z.rid); ok(!mz.acciones.some(a => a.accion === 'decidir-equipo'), 'el KP1 aún no decide: su equipo no terminó');
    await entraZ('esp@superv.com'); r = await decideZ(z.rid, { decision: 'aprobar' }); ok(r.status === 200 && r.j.etapa === 1 && r.j.revisado, 'el especialista de Supervisión envía su revisión (sin recomendar: decide el KP1)');
    await entraZ('kp1@superv.com'); mz = await miaZ(z.rid); const pk = mz.etapaActual.pasos.find(x => x.id === 'esp-super');
    ok(mz.acciones.some(a => a.paso === 'esp-super' && a.accion === 'decidir-equipo') && pk.revisados === 1 && pk.aFavor === 0, 'ahora el KP1 tiene el panel Acepta / Rechaza por todo el equipo de Supervisión (1 especialista revisó)');
    r = await decideZ(z.rid, { decision: 'aprobar', paso: 'esp-super' }); ok(r.status === 200 && r.j.etapa === 2, 'el KP1 acepta → paso 3 (Gerente de Proyecto)');
    await entraZ('gp@anin.gob.pe'); mz = await miaZ(z.rid); const pg2 = mz.resumen.find(e => e.etapa === 1).pasos.find(x => x.id === 'esp-gp');
    ok(mz.acciones.some(a => a.paso === 'gp') && pg2.aFavor === 1 && pg2.enContra === 1 && mz.resumen.find(e => e.etapa === 1).pasos.find(x => x.id === 'esp-super').resultado === 'aprobada', 'el GP recibe las recomendaciones de su equipo (1 Aceptar, 1 Rechazar) y el estado de Supervisión');
    r = await decideZ(z.rid, { decision: 'devolver', comentario: 'corregir detalle' }); ok(r.status === 200 && r.j.estado === 'devuelta', 'el GP rechaza: ese es el estado que recibe el contratista');
    await entraZ('autor@ghemet.com'); r = await pide('/api/proyectos/' + pz + '/correspondencia?q=REV-'); ok((r.j.correos || []).some(c => /RECHAZADO|Rechazado|rechaz/i.test(c.asunto)), 'el contratista recibe el aviso con el estado de la revisión');

    r = await pide('/api/proyectos/' + pz + '/contenedores?sub=1'); { const cz = r.j.contenedores.find(x => x.id === z.cid); ok(cz.estado_revision === 'rechazado' && !cz.aprobado_por, 'la lista de archivos trae el estado de la revision: Rechazado'); }
    // A2) un administrador solo, sin nadie con cargo en el paso 2, puede recorrer el flujo (no se atasca)
    await entraZ('admin@anin.gob.pe');
    for (const e of ['esp1@anin.gob.pe', 'esp2@anin.gob.pe', 'esp@superv.com', 'kp1@superv.com']) await pide('/api/proyectos/' + pz + '/miembros', { json: { email: e, rol: 'revisor', organizacion: e.includes('superv') ? 'SUPERV' : 'ANIN', cargo: '' } });
    z = await abreZ('1010');
    await entraZ('dc@anin.gob.pe'); await decideZ(z.rid, { decision: 'aprobar' }); await entraZ('dc@superv.com'); await decideZ(z.rid, { decision: 'aprobar' });
    await entraZ('admin@anin.gob.pe'); mz = await miaZ(z.rid);
    ok(mz.acciones.some(a => a.paso === 'esp-gp' && a.accion === 'recomendar') && mz.acciones.some(a => a.paso === 'esp-super' && a.accion === 'decidir-equipo'), 'sin especialistas ni KP1 asignados, el administrador puede recomendar por el equipo del GP y decidir por la Supervisión ' + JSON.stringify([mz.paso, mz.acciones, mz.etapaActual && mz.etapaActual.pasos.map(x => [x.id, x.candidatos, x.recomendado, x.completo])]));
    r = await decideZ(z.rid, { decision: 'aprobar', paso: 'esp-gp' }); ok(r.status === 200 && r.j.estado === 'abierta', 'el administrador recomienda por el equipo del GP');
    r = await decideZ(z.rid, { decision: 'devolver', paso: 'esp-super', comentario: 'Supervisión rechaza' }); ok(r.status === 200 && r.j.etapa === 2 && r.j.estado === 'abierta', 'la Supervisión rechaza: NO cierra la revisión, pasa al GP con ese estado');
    await entraZ('gp@anin.gob.pe'); mz = await miaZ(z.rid); ok(mz.resumen.find(e => e.etapa === 1).pasos.find(x => x.id === 'esp-super').resultado === 'devuelta' && mz.puedoDecidir, 'el GP ve que la Supervisión rechazó y decide');
    r = await decideZ(z.rid, { decision: 'aprobar' }); ok(r.status === 200 && r.j.estado === 'aprobada', 'el GP acepta de todos modos: ese es el estado de la revisión');
    r = await pide('/api/proyectos/' + pz + '/contenedores?sub=1'); { const cz = r.j.contenedores.find(x => x.id === z.cid && !x.copia); ok(cz.estado_revision === 'aceptado' && cz.aprobado_por === 'gp@anin.gob.pe', 'aceptada: estado Aceptado y «Aprobado por» = quien aprobo el flujo (' + cz.aprobado_por + ')'); }
    { const zz = await abreZ('1011'); r = await pide('/api/proyectos/' + pz + '/contenedores?sub=1'); ok(r.j.contenedores.find(x => x.id === zz.cid).estado_revision === 'en-revision', 'con el flujo en curso: En revision'); }
    for (const [e, org, cargo] of [['esp1@anin.gob.pe', 'ANIN', 'ESPECIALISTA'], ['esp2@anin.gob.pe', 'ANIN', 'ESPECIALISTA'], ['esp@superv.com', 'SUPERV', 'ESPECIALISTA'], ['kp1@superv.com', 'SUPERV', 'KP1']]) { await entraZ('admin@anin.gob.pe'); await pide('/api/proyectos/' + pz + '/miembros', { json: { email: e, rol: 'revisor', organizacion: org, cargo } }); }

    // B) un DC rechaza, el otro procede con ese rechazo → QA Rejected firmado por ambos
    z = await abreZ('1002');
    await entraZ('dc@anin.gob.pe'); r = await decideZ(z.rid, { decision: 'devolver', comentario: 'cajetín incompleto', notificar: true }); ok(r.status === 200 && r.j.estado === 'abierta' && r.j.etapa === 0, 'QA Rejected de un solo DC no devuelve el documento');
    await entraZ('dc@superv.com'); mz = await miaZ(z.rid); ok(mz.etapaActual.consenso === 'rechazo-en-espera' && mz.puedoDecidir, 'el otro DC ve que hay un rechazo en espera');
    r = await pide('/api/proyectos/' + pz + '/correspondencia?q=REV-'); ok((r.j.correos || []).some(c => /quiere rechazar por calidad/.test(c.asunto)), 'y recibió la notificación del primer DC');
    r = await decideZ(z.rid, { adhiere: true }); ok(r.status === 200 && r.j.estado === 'devuelta', 'procede con el rechazo usando solo la revisión del primero → devuelta');
    mz = await miaZ(z.rid); ok(mz.pasos.filter(x => x.etapa === 0 && x.decision === 'devuelta').length === 2 && mz.pasos.some(x => x.clase === 'adhesion'), 'el rechazo lleva la validación de los dos DC');

    // C) uno acepta y otro rechaza → decide el GP
    z = await abreZ('1003');
    await entraZ('dc@anin.gob.pe'); await decideZ(z.rid, { decision: 'aprobar' });
    await entraZ('dc@superv.com'); r = await decideZ(z.rid, { decision: 'devolver', comentario: 'escala errada' }); ok(r.status === 200 && r.j.estado === 'abierta' && r.j.etapa === 0, 'uno QA Accepted y otro QA Rejected: queda en conflicto');
    await entraZ('gp@anin.gob.pe'); mz = await miaZ(z.rid); ok(mz.etapaActual.consenso === 'conflicto' && mz.acciones.some(a => a.accion === 'arbitrar'), 'se notifica al GP, que debe decidir');
    r = await decideZ(z.rid, { decision: 'aprobar', comentario: 'pasa a especialistas' }); ok(r.status === 200 && r.j.etapa === 1 && r.j.estado === 'abierta', 'el GP decide pasar al paso 2');
    z = await abreZ('1004');
    await entraZ('dc@anin.gob.pe'); await decideZ(z.rid, { decision: 'devolver', comentario: 'sin firma' });
    await entraZ('dc@superv.com'); await decideZ(z.rid, { decision: 'aprobar' });
    await entraZ('gp@anin.gob.pe'); r = await decideZ(z.rid, { decision: 'devolver' }); ok(r.status === 200 && r.j.estado === 'devuelta', 'o el GP decide rechazar');

    // D) plazos: 2 días
    const BDz = require('../lib/bd'), ayer = new Date(Date.now() - 864e5).toISOString();
    z = await abreZ('1005');
    await entraZ('dc@anin.gob.pe'); await decideZ(z.rid, { decision: 'aprobar' });
    BDz.q.corre('UPDATE revisiones SET vence = ? WHERE id = ?', ayer, z.rid);
    mz = await miaZ(z.rid); ok(mz.paso === 1 && mz.estado === 'abierta' && mz.pasos.some(x => x.etapa === 0 && x.clase === 'auto'), 'vencidos los 2 días sin rechazo, pasa sola a los especialistas con QA Accepted de ambos DC');
    z = await abreZ('1006');
    await entraZ('dc@superv.com'); await decideZ(z.rid, { decision: 'devolver', comentario: 'formato' });
    BDz.q.corre('UPDATE revisiones SET vence = ? WHERE id = ?', ayer, z.rid);
    mz = await miaZ(z.rid); ok(mz.estado === 'devuelta', 'vencido el plazo con un rechazo por calidad, las observaciones del primer DC van al contratista');
    z = await abreZ('1007');
    BDz.q.corre('UPDATE revisiones SET vence = ? WHERE id = ?', ayer, z.rid);
    mz = await miaZ(z.rid); ok(mz.paso === 1 && mz.estado === 'abierta', 'vencido el plazo sin que nadie revise: pasa a los especialistas');
    // E) la revision lleva su linea de correspondencia: envio → QA Accepted (GP) → estado final con reporte de incidencias → ronda 2 por el mismo hilo
    await entraZ('autor@ghemet.com'); r = await subeZ('ZONAS-GHE-ZZ-XX-DR-A-1020-P01.pdf'); const cE = r.j.contenedor;
    r = await pide('/api/proyectos/' + pz + '/contenedores/' + cE + '/revisiones', { json: { flujo: 'paralelo-dc-especialistas-gp', nombre: 'Planos 1020', correspondencia: { crear: true } } });
    ok(r.status === 200 && r.j.correo && /GHEMET-TRA-/.test(r.j.correo.numero), 'al crear la revisión se emite la correspondencia de envío (' + (r.j.correo || {}).numero + ')'); const rE = r.j.id, mE = r.j.correo.id;
    const hiloE = async () => (await pide('/api/proyectos/' + pz + '/correspondencia/' + mE)).j;
    r = await hiloE(); ok(/paralelo/i.test(r.cuerpo) && r.adjuntos.some(a => a.tipo === 'version') && r.para.some(d => d.email === 'dc@anin.gob.pe') && r.para.some(d => d.email === 'gp@anin.gob.pe'), 'el correo indica el flujo usado, adjunta la versión y va a los revisores del flujo');
    await entraZ('dc@anin.gob.pe'); await decideZ(rE, { decision: 'aprobar' }); await entraZ('dc@superv.com'); await decideZ(rE, { decision: 'aprobar' });
    await entraZ('autor@ghemet.com'); r = await pide('/api/proyectos/' + pz + '/correspondencia?hilo=' + mE + '&bandeja=todos'); let lE = r.j.correos;
    ok(lE.length === 2 && lE.some(c => /QA Accepted/.test(c.asunto) && c.de_email === 'gp@anin.gob.pe'), 'con QA Accepted, el GP responde la correspondencia con la validación (' + lE.map(c => c.numero).join(', ') + ')');
    await entraZ('esp1@anin.gob.pe'); await decideZ(rE, { decision: 'aprobar' }); await entraZ('esp2@anin.gob.pe'); await decideZ(rE, { decision: 'aprobar' }); await entraZ('esp@superv.com'); await decideZ(rE, { decision: 'aprobar' }); await entraZ('kp1@superv.com'); await decideZ(rE, { decision: 'aprobar' });
    await entraZ('gp@anin.gob.pe'); r = await decideZ(rE, { decision: 'devolver', comentario: 'Corregir cotas' }); ok(r.j.estado === 'devuelta', 'el GP rechaza');
    await entraZ('autor@ghemet.com'); r = await pide('/api/proyectos/' + pz + '/correspondencia?hilo=' + mE + '&bandeja=todos'); lE = r.j.correos; const finE = lE.find(c => /estado de revisión: RECHAZADO/.test(c.asunto));
    ok(lE.length === 3 && finE, 'el estado final va por la misma línea de correspondencia');
    r = await pide('/api/proyectos/' + pz + '/correspondencia/' + finE.id); const repE = r.j.adjuntos.find(a => a.tipo === 'archivo' && /Reporte-incidencias/.test(a.nombre));
    ok(repE && r.j.adjuntos.some(a => a.tipo === 'version'), 'y adjunta por defecto el reporte de incidencias y el documento');
    { const x = await fetch(B + '/api/proyectos/' + pz + '/correspondencia/' + finE.id + '/adjunto/' + repE.id, { headers: { cookie: galleta } }); const t = await x.text(); ok(x.status === 200 && /Reporte de incidencias/.test(t) && /ZONAS-GHE-ZZ-XX-DR-A-1020/.test(t), 'el reporte se descarga y trae el documento y la revisión'); }
    r = await subeZ('ZONAS-GHE-ZZ-XX-DR-A-1020-P02.pdf'); r = await pide('/api/proyectos/' + pz + '/contenedores/' + cE + '/revisiones', { json: { flujo: 'paralelo-dc-especialistas-gp', nombre: 'Planos 1020' } });
    ok(r.status === 200 && r.j.ronda === 2 && r.j.correo && r.j.correo.id === mE, 'la ronda 2 sigue la misma línea (' + JSON.stringify(r.j.mensaje || r.j.correo) + ')');
    r = await pide('/api/proyectos/' + pz + '/correspondencia?hilo=' + mE + '&bandeja=todos'); ok(r.j.correos.length === 4 && r.j.correos.some(c => /levantamiento de observaciones/.test(c.asunto) && c.de_email === 'autor@ghemet.com'), 'y envía el levantamiento de observaciones por el hilo');
    r = await pide('/api/proyectos/' + pz + '/correspondencia/' + mE); ok((r.j.hilo || []).length === 4 || r.status === 200, 'la línea de comunicación reúne los 4 correos');

    // aplicar la plantilla por zonas a un proyecto que ya tiene archivos: no deja huerfanos
    galleta = ''; await pide('/api/acceso/local', { json: { email: 'admin@anin.gob.pe', clave: 'prueba' } });
    r = await pide('/api/proyectos/' + pw + '/carpetas/plantilla', { json: { plantilla: 'zonas', orgContr: 'GHEMET', orgSuper: 'SUPERV' } });
    ok(r.status === 200 && r.j.conservadas.includes('E3_DISEÑO/WIP/WIP CONTRATISTA') && r.j.conservadas.includes('E3_DISEÑO') && !r.j.conservadas.includes('E1/WIP'), 'al cambiar a la plantilla por zonas se conservan solo las carpetas anteriores que tienen archivos (' + r.j.conservadas.join(' · ') + ')');
    r = await pide('/api/proyectos/' + pw); ok(r.j.arbol.some(c => c.ruta === 'WIP/ETAPA 1/CONTRATISTA') && r.j.arbol.some(c => c.ruta === 'E3_DISEÑO/WIP/WIP CONTRATISTA') && r.j.config.flujos.some(f => f.id === 'paralelo-dc-especialistas-gp'), 'el arbol nuevo convive con las carpetas con archivos y el proyecto recibe el flujo paralelo');
    // ───────────── 16. Portada «Direcciones ejecutoras» y grupos de usuarios
    console.log('\n16. Direcciones ejecutoras y usuarios por grupo');
    galleta = ''; await pide('/api/acceso/local', { json: { email: 'admin@anin.gob.pe', clave: 'prueba' } });
    r = await pide('/api/proyectos', { json: { codigo: 'IRENSUR', nombre: 'Hospital Iren Sur - Arequipa', norma: 'default-iso19650', plantilla: 'zonas' } }); const pI = r.j.id;
    r = await pide('/api/estructura'); const seo = r.j.direcciones.find(d => d.id === 'DEO').subs.find(x => x.id === 'SEO');
    ok(r.status === 200 && r.j.direcciones.length === 2 && seo.proyectos.find(h => h.nombre === 'Hospital Iren Sur').cde.some(x => x.id === pI) && r.j.sinUbicar.some(x => x.id === pz), 'el mapa Dirección › Subdirección › Proyecto ubica el proyecto por su nombre y lista los que faltan ubicar');
    r = await pide('/api/proyectos/' + pz + '/ubicacion', { method: 'PUT', json: { direccion: 'DEO', sub: 'SES', proyecto: 'Paquete 11' } }); ok(r.status === 200 && r.j.ubicacion.subNombre === 'Subdirección de Estudios', 'un proyecto se ubica a mano en su Dirección y Subdirección');
    r = await pide('/api/proyectos/' + pz); ok(r.j.ubicacion && r.j.ubicacion.direccion === 'DEO' && r.j.ubicacion.proyecto === 'Paquete 11', 'el proyecto trae su ubicación (para la portada 3 y el panel lateral)');
    r = await pide('/api/proyectos/' + pz + '/miembros', { json: { email: 'dc@anin.gob.pe', rol: 'revisor', organizacion: 'ANIN', grupo: 'cliente-transversal' } });
    r = await pide('/api/proyectos/' + pz + '/miembros'); { const m = r.j.miembros.find(x => x.email === 'dc@anin.gob.pe'); ok(m.grupo === 'cliente-transversal' && m.cargo === 'DC', 'el usuario guarda su grupo (Cliente · Transversal) y conserva su cargo'); }
    // ───────────── 17. Registro de usuarios con el formato estándar y permisos por función
    console.log('\n17. Usuarios: formato estándar, catálogo y permisos por función');
    r = await pide('/api/proyectos/' + pz + '/catalogo-usuarios'); ok(r.j.empresas.length === 5 && !r.j.empresas.some(x => /SALUD/.test(x.nombre)) && r.j.cargos.length === 13 && r.j.disciplinas.length === 67 && r.j.cargos.some(x => x.codigo === 'ESP'), 'catálogo base: 5 empresas (sin «Contratista Salud»), 13 cargos y 67 disciplinas con su código');
    r = await pide('/api/proyectos/' + pz + '/miembros', { json: { email: 'prodriguez@anin.gob.pe', nombre: 'Patricia Azucena Rodriguez Torres', empresa: 'ANIN', puesto: 'ESPECIALISTA', disciplina: 'CONTROL DOCUMENTARIO', rol: 'revisor' } });
    r = await pide('/api/proyectos/' + pz + '/miembros'); { const m = r.j.miembros.find(x => x.email === 'prodriguez@anin.gob.pe'); ok(m.funcion === 'A-ESP-DOC' && m.nombre === 'Patricia Azucena Rodriguez Torres' && m.organizacion === 'ANIN' && m.cargo === 'DC' && m.grupo === 'cliente-equipo', 'el usuario queda con su función A-ESP-DOC y de ella salen la organización, el grupo y su papel en las revisiones (' + [m.funcion, m.organizacion, m.cargo, m.grupo].join(' · ') + ')'); }
    r = await pide('/api/proyectos/' + pz + '/miembros', { json: { email: 'res@ghemet.com', nombre: 'Residente', empresa: 'CONTRATISTA', puesto: 'RESIDENTE', disciplina: 'PROYECTO GENERAL', rol: 'document-control' } }); ok(r.status === 400 && /cargo «RESIDENTE»/.test(r.j.mensaje), 'un cargo que no está en el catálogo se rechaza con aviso');
    r = await pide('/api/proyectos/' + pz + '/catalogo-usuarios', { json: { lista: 'cargos', nombre: 'Residente', codigo: 'res' } }); ok(r.status === 200 && r.j.item.codigo === 'RES' && r.j.catalogo.cargos.length === 14, 'el catálogo admite cargos nuevos (RESIDENTE · RES)');
    r = await pide('/api/proyectos/' + pz + '/catalogo-usuarios', { json: { lista: 'cargos', nombre: 'Otro', codigo: 'ESP' } }); ok(r.status === 400, 'no deja repetir un código');
    r = await pide('/api/proyectos/' + pz + '/miembros', { json: { email: 'res@ghemet.com', nombre: 'Residente', empresa: 'CONTRATISTA', puesto: 'RESIDENTE', disciplina: 'PROYECTO GENERAL', rol: 'document-control' } });
    r = await pide('/api/proyectos/' + pz + '/miembros'); { const m = r.j.miembros.find(x => x.email === 'res@ghemet.com'); ok(m.funcion === 'C-RES-PRY' && m.organizacion === 'GHEMET' && m.grupo === 'contratista', 'con el cargo nuevo: función C-RES-PRY, organización del contratista del proyecto (' + m.organizacion + ')'); }
    r = await pide('/api/proyectos/' + pz + '/carpetas', { method: 'PUT', json: { ruta: 'PUB/ETAPA 3', permisos: [{ tipo: 'funcion', valor: 'C-RES-PRY', nivel: 'ver-descargar-subir' }] } }); ok(r.status === 200, 'se dan permisos de carpeta por función');
    await entraZ('res@ghemet.com'); r = await pide('/api/proyectos/' + pz + '/carpetas/permisos?ruta=' + encodeURIComponent('PUB/ETAPA 3')); ok(r.status === 200 && r.j.miPermiso.subir, 'quien tiene esa función recibe el permiso');
    await entraZ('autor@ghemet.com'); r = await pide('/api/proyectos/' + pz); ok(!(r.j.arbol.find(c => c.ruta === 'PUB/ETAPA 3') || {}).subir, 'y quien no la tiene, no');
    await entraZ('admin@anin.gob.pe');
    await pide('/api/proyectos/' + pz + '/miembros', { json: { email: 'jefe@superv.com', nombre: 'Jefe de Supervisión', empresa: 'SUPERVISIÓN', puesto: 'JEFE', disciplina: 'PROYECTO GENERAL', rol: 'revisor' } });
    await pide('/api/proyectos/' + pz + '/miembros', { json: { email: 'asesor@otro.com', nombre: 'Asesor', empresa: 'EXTERNO', puesto: 'ESPECIALISTA', disciplina: 'LEGAL', rol: 'lector' } });
    r = await pide('/api/proyectos/' + pz + '/miembros'); ok(r.j.miembros.find(m => m.email === 'jefe@superv.com').grupo === 'supervision' && r.j.miembros.find(m => m.email === 'asesor@otro.com').grupo === 'externo', 'los usuarios de Supervisión y los Externos tienen su propio grupo');
    // ───────────── 18. Niveles de acceso: Miembro · Document Control · Revisor · Revisor DC
    console.log('\n18. Niveles de acceso');
    galleta = ''; await pide('/api/acceso/local', { json: { email: 'admin@anin.gob.pe', clave: 'prueba' } });
    r = await pide('/api/proyectos', { json: { codigo: 'NIVELES', nombre: 'Niveles de acceso', norma: 'default-iso19650', plantilla: 'zonas', orgContr: 'GHEMET', orgSuper: 'SUPERV' } }); const pn = r.j.id;
    for (const [e, rol, org] of [['mi@ghemet.com', 'miembro', 'GHEMET'], ['dc@ghemet.com', 'document-control', 'GHEMET'], ['rv@anin.gob.pe', 'revisor', 'ANIN'], ['rvdc@anin.gob.pe', 'revisor-dc', 'ANIN'], ['viejo@ghemet.com', 'autor', 'GHEMET']]) await pide('/api/proyectos/' + pn + '/miembros', { json: { email: e, rol, organizacion: org } });
    r = await pide('/api/proyectos/' + pn + '/miembros'); ok(r.j.miembros.find(m => m.email === 'viejo@ghemet.com').rol === 'miembro', 'el nivel «autor» ya no existe: queda como miembro');
    const entraN = async (e) => { galleta = ''; await pide('/api/acceso/local', { json: { email: e, clave: 'prueba' } }); };
    const subeN = (carpeta, nombre) => fetch(B + '/api/proyectos/' + pn + '/subir?carpeta=' + encodeURIComponent(carpeta), { method: 'POST', headers: { cookie: galleta, 'x-nombre': encodeURIComponent(nombre) }, body: Buffer.from('x ' + nombre) }).then(async x => ({ status: x.status, j: await x.json() }));
    const creaN = (padre, nombre) => pide('/api/proyectos/' + pn + '/carpetas', { json: { padre, nombre } });
    const WN = 'WIP/ETAPA 1/CONTRATISTA', CN = 'COM/ETAPA 1/CONTRATISTA';
    await entraN('mi@ghemet.com');
    r = await subeN(WN, 'borrador-estructuras.pdf'); ok(r.status === 200, 'Miembro: carga en su WIP'); const cMi = r.j.contenedor;
    r = await creaN(WN, 'Borradores'); ok(r.status === 200, 'Miembro: crea carpetas en WIP');
    r = await creaN(CN, 'Entregas'); ok(r.status === 403, 'Miembro: no crea carpetas en compartido');
    r = await subeN(CN, 'NIVELES-GHE-ZZ-XX-DR-A-0001-P01.pdf'); ok(r.status === 403, 'Miembro: no carga directo a compartido');
    r = await pide('/api/proyectos/' + pn + '/contenedores/' + cMi + '/mover', { json: { carpeta: CN } }); ok(r.status === 403, 'Miembro: no pasa documentos de WIP a compartido (' + r.status + ')');
    await entraN('dc@ghemet.com');
    r = await subeN(WN, 'NIVELES-GHE-ZZ-XX-DR-A-0002-P01.pdf'); const cDc = r.j.contenedor;
    r = await pide('/api/proyectos/' + pn + '/contenedores/' + cDc + '/mover', { json: { carpeta: CN } }); ok(r.status === 200, 'Document Control: pasa documentos de WIP a compartido ' + JSON.stringify(r.j).slice(0, 120));
    r = await pide('/api/proyectos/' + pn + '/contenedores/' + cDc); ok(r.j.estado === 'COMPARTIDO' && r.j.carpeta === CN, 'y el documento queda COMPARTIDO en la carpeta COM');
    r = await creaN(CN, 'Entregas'); ok(r.status === 200, 'Document Control: crea carpetas en compartido'); r = await creaN(WN, 'Trabajo DC'); ok(r.status === 200, 'y en WIP');
    await entraN('rv@anin.gob.pe');
    r = await pide('/api/proyectos/' + pn); { const w = r.j.arbol.find(c => c.ruta === WN) || {}; ok(w.leer && !w.subir && !w.editar, 'Revisor: en WIP solo lectura'); }
    r = await creaN(CN, 'Rev'); ok(r.status === 403, 'Revisor: no crea carpetas en compartido'); r = await creaN(WN, 'Rev'); ok(r.status === 403, 'ni en WIP');
    r = await pide('/api/proyectos/' + pn + '/incidencias', { json: { titulo: 'Cota faltante', descripcion: 'eje 3', contenedor_id: cDc } }); ok(r.status === 200, 'Revisor: registra observaciones sobre un documento compartido');
    r = await pide('/api/proyectos/' + pn + '/contenedores/' + cDc + '/estado', { json: { estado: 'WIP' } }); ok(r.status === 403, 'Revisor: no devuelve documentos de compartido a WIP (' + r.status + ')');
    await entraN('rvdc@anin.gob.pe');
    r = await creaN(CN, 'Revisiones DC'); ok(r.status === 200, 'Revisor DC: crea carpetas en compartido'); r = await creaN(WN, 'x'); ok(r.status === 403, 'pero no en WIP');
    r = await pide('/api/proyectos/' + pn + '/contenedores/' + cDc + '/estado', { json: { estado: 'WIP' } }); ok(r.status === 403, 'Revisor DC: tampoco devuelve documentos a WIP');
    // ───────────── 19. Descripción al cargar, eliminar carpetas, miembros para los flujos
    console.log('\n19. Descripción, eliminar carpetas y selector de miembros');
    await entraN('admin@anin.gob.pe');
    r = await creaN(WN, 'E1_NO VA'); r = await creaN(WN + '/E1_NO VA', 'COM CLIENTE'); const NV0 = WN + '/E1_NO VA', NV = NV0 + '/COM CLIENTE';
    r = await fetch(B + '/api/proyectos/' + pn + '/subir?carpeta=' + encodeURIComponent(NV), { method: 'POST', headers: { cookie: galleta, 'x-nombre': encodeURIComponent('nota-suelta.txt'), 'x-meta': encodeURIComponent(JSON.stringify({ atributos: { descripcion: 'Acta de reunión de coordinación BIM' } })) }, body: Buffer.from('texto del acta') }).then(async x => ({ status: x.status, j: await x.json() }));
    ok(r.status === 200, 'carga con descripción (' + r.status + ')');
    r = await pide('/api/proyectos/' + pn + '/contenedores?carpeta=' + encodeURIComponent(NV)); ok(r.j.contenedores.length === 1 && r.j.contenedores[0].descripcion === 'Acta de reunión de coordinación BIM', 'la columna Descripción muestra lo que escribió quien cargó');
    r = await pide('/api/proyectos/' + pn + '/carpetas/suprimir', { json: { ruta: NV0 } }); ok(r.status === 200 && r.j.carpetas === 2 && r.j.archivos === 1, 'la carpeta se elimina con sus subcarpetas y archivos ' + JSON.stringify(r.j));
    r = await pide('/api/proyectos/' + pn); ok(!r.j.arbol.some(c => c.ruta.startsWith(NV0)), 'y ya no aparece en el árbol');
    r = await pide('/api/proyectos/' + pn + '/carpetas/suprimir', { json: { ruta: NV0 } }); ok(r.status === 404, 'eliminar una carpeta que ya no existe da 404');
    r = await pide('/api/proyectos/' + pn + '/flujos'); ok(r.j.miembros.length >= 5 && r.j.miembros.every(m => 'nombre' in m && 'funcion' in m && 'empresa' in m), 'el editor de flujos recibe los usuarios del proyecto con nombre, empresa y función');
    // ───────────── 20. Búsqueda de documentos: nombre o descripción en un solo campo, filtro Formato, Carpeta
    console.log('\n20. Búsqueda de documentos');
    const subeD = (nombre, desc) => fetch(B + '/api/proyectos/' + pn + '/subir?carpeta=' + encodeURIComponent(WN), { method: 'POST', headers: Object.assign({ cookie: galleta, 'x-nombre': encodeURIComponent(nombre) }, desc ? { 'x-meta': encodeURIComponent(JSON.stringify({ atributos: { descripcion: desc } })) } : {}), body: Buffer.from('contenido ' + nombre) }).then(x => x.status);
    ok(await subeD('INF-ESTRUCTURAS-001.pdf', 'Memoria estructural del bloque A') === 200 && await subeD('MOD-ARQ-001.rvt', 'Modelo de arquitectura') === 200 && await subeD('ACTA-COORD-001.docx', 'Acta de coordinación BIM') === 200 && await subeD('PLANO-ESPECIAL.xyz', '') === 200, 'se cargan un PDF, un RVT, un DOCX y un formato raro');
    const buscaD = (filtros) => pide('/api/documentos/buscar', { json: { proyectos: [pn], filtros, porPagina: 500 } }).then(r => r.j.filas.map(x => x.numero).sort());
    let L = await buscaD({ nombre: 'memoria bloque' }); ok(L.length === 1 && L[0] === 'INF-ESTRUCTURAS-001', 'por descripción: «memoria bloque» encuentra el informe ' + JSON.stringify(L));
    L = await buscaD({ nombre: 'mod-arq' }); ok(L.length === 1 && L[0] === 'MOD-ARQ-001', 'por nombre: «mod-arq» encuentra el modelo ' + JSON.stringify(L));
    L = await buscaD({ formato: ['revit'] }); ok(L.length === 1 && L[0] === 'MOD-ARQ-001', 'Formato Revit: solo el RVT');
    L = await buscaD({ formato: ['word', 'pdf'] }); ok(L.includes('ACTA-COORD-001') && L.includes('INF-ESTRUCTURAS-001') && !L.includes('MOD-ARQ-001') && !L.includes('PLANO-ESPECIAL'), 'Formato Word + PDF: los DOCX y PDF, sin el RVT ni el raro');
    L = await buscaD({ formato: ['xyz'] }); ok(L.length === 1 && L[0] === 'PLANO-ESPECIAL', 'una extensión desconocida forma su propio formato');
    L = await buscaD({ formato: ['revit'], estadoCde: ['COMPARTIDO'] }); ok(L.length === 0, 'Carpeta COM + Revit: nada (el modelo está en WIP)');
    r = await pide('/api/documentos/catalogos'); const fr = r.j.formato.find(x => x.valor === 'revit'), fx = r.j.formato.find(x => x.valor === 'xyz');
    ok(fr && fr.enUso && /Revit - \.rvt/.test(fr.texto) && /documento/.test(fr.texto) && fx && fx.enUso, 'el catálogo de formatos marca los que están en uso, con su cantidad');
    r = await pide('/api/documentos/buscar', { json: { proyectos: [pn], filtros: { formato: ['revit'] } } }); ok(r.j.filas[0].formato === 'Revit (.rvt)' && r.j.filas[0].titulo === 'Modelo de arquitectura', 'la columna Formato dice «Revit (.rvt)» y el Título muestra la descripción escrita al cargar');
    // ───────────── 21. El CDE lee modelos por su cuenta: IFC (web-ifc), RVT (rvt-rs), NWD sin lector libre
    console.log('\n21. Lector de modelos (IFC / RVT / NWD)');
    const subeArch = (nombre, cuerpo) => fetch(B + '/api/proyectos/' + pn + '/subir?carpeta=' + encodeURIComponent(WN), { method: 'POST', headers: { cookie: galleta, 'x-nombre': encodeURIComponent(nombre) }, body: cuerpo }).then(async x => ({ status: x.status, j: await x.json() }));
    const espera = async (vid, ms) => { const t0 = Date.now(); let st; do { await new Promise(r => setTimeout(r, 400)); st = (await pide('/api/modelos/' + pn + '/' + vid + '/estado')).j; } while (['en-cola', 'convirtiendo', 'armando', 'recibiendo'].includes(st.estado) && Date.now() - t0 < ms); return st; };
    r = await subeArch('MODELO-ESTRUCTURAS-001.ifc', fs.readFileSync(path.join(__dirname, 'muestras', 'ejemplo.ifc'))); ok(r.status === 200, 'se carga un IFC al WIP (' + r.status + ')');
    const vIfc = r.j.version_id || r.j.version || (r.j.contenedor && r.j.contenedor.version_id);
    let st = await espera(vIfc, 90000); ok(st.estado === 'listo' && st.geometria, 'el CDE lo lee solo: índice listo y con geometría ' + JSON.stringify({ estado: st.estado, error: st.error }));
    r = await pide('/api/modelos/' + pn + '/' + vIfc + '/elementos'); ok(r.status === 200 && r.j.columnas && r.j.columnas.e.length === 116, 'los 116 elementos del IFC están en el índice (' + (r.j.columnas ? r.j.columnas.e.length : r.status) + ')');
    const dc = r.j.diccionarios || {}, cats = (dc.cat || []);
    ok(cats.includes('Structural Columns') && (dc.niv || []).includes('Level 1'), 'con categoría y nivel leídos del IFC ' + JSON.stringify(cats).slice(0, 120));
    const g = await fetch(B + '/api/modelos/' + pn + '/' + vIfc + '/geometria', { headers: { cookie: galleta } }); const gb = Buffer.from(await g.arrayBuffer());
    ok(g.status === 200 && gb.slice(0, 4).toString('latin1') === 'CDEG' && gb.readUInt32LE(8) === 116, 'la geometría .cdeg trae los 116 elementos');
    r = await pide('/api/modelos/' + pn + '/' + vIfc + '/tablero'); ok(r.status === 200, 'el tablero del visor responde sobre el modelo IFC (' + r.status + ')');
    r = await subeArch('FEDERADO-001.nwd', Buffer.from('no es un nwd real')); const vNwd = r.j.version_id || r.j.version;
    st = (await pide('/api/modelos/' + pn + '/' + vNwd + '/estado')).j; ok(st.estado === 'no-legible' && /Navisworks/.test(st.error || ''), 'un NWD queda «sin lector libre» con la explicación');
    const RVT = require('../lib/lector-rvt');
    if (RVT.disponible()) {
      r = await subeArch('MODELO-MINIMO-2023.rvt', fs.readFileSync(path.join(__dirname, 'muestras', 'minimo-2023.rvt'))); const vRvt = r.j.version_id || r.j.version;
      st = await espera(vRvt, 90000); ok(st.estado === 'error' && /complemento de Revit/.test(st.error || ''), 'un RVT del que el lector libre no saca elementos avisa y sugiere el complemento ' + JSON.stringify(st.error || '').slice(0, 160));
    } else console.log('  (sin lector RVT en esta máquina: se omite la prueba del RVT)');
    r = await pide('/api/modelos/' + pn + '/lista'); const mIfc = (r.j.modelos || []).find(m => m.vid === vIfc), mNwd = (r.j.modelos || []).find(m => m.vid === vNwd);
    ok(r.status === 200 && mIfc && mIfc.carpeta === WN && mIfc.indice.estado === 'listo' && mIfc.indice.elementos === 116 && mNwd && mNwd.indice.estado === 'no-legible', 'el visor lista los modelos de cualquier carpeta (aquí WIP), con su estado');
        r = await pide('/api/modelos/' + pn + '/' + vIfc + '/procesar', { method: 'POST' }); ok(r.status === 200, 'se puede volver a procesar a mano (' + r.status + ')'); st = await espera(vIfc, 90000); ok(st.estado === 'listo', 'y vuelve a quedar listo');

    console.log('13. Proyecto nuevo desde la web: nomenclatura DOCPG002 (libreria maestra de la ANIN)');
    galleta = ''; await pide('/api/acceso/local', { json: { email: 'admin@anin.gob.pe', clave: 'prueba' } });
    r = await pide('/api/proyectos', { json: { codigo: '100017', nombre: 'Hospital La Esperanza', plantilla: 'zonas', orgContr: 'GHEMET', orgSuper: 'SUPERV' } }); const pd = r.j.id;
    r = await pide('/api/proyectos/' + pd); const cfgD = r.j.config;
    ok(cfgD.normaPorDefecto === 'anin-docpg002' && cfgD.nomenclatura.campos.map(c => c.nombre).join('|') === 'Codigo de proyecto|Originador|Activo|Nivel|Tipo de documento|Disciplina|Etapa|Numero secuencial' && cfgD.nomenclatura.conRevision === false, 'un proyecto creado con plantilla nace con la norma DOCPG002 (Proyecto-Originador-Activo-Nivel-TipoDoc-Disciplina-Etapa-Secuencial) ' + cfgD.normaPorDefecto);
    ok(cfgD.normas.some(x => x.id === 'default-iso19650'), 'la regla ISO 19650 sigue disponible para elegirla en Conformidad');
    const subeDoc = (carpeta, nombre, rev) => fetch(B + '/api/proyectos/' + pd + '/subir?carpeta=' + encodeURIComponent(carpeta) + (rev ? '&revision=' + rev : ''), { method: 'POST', headers: { cookie: galleta, 'x-nombre': encodeURIComponent(nombre) }, body: Buffer.from('contenido ' + nombre) }).then(async x => ({ status: x.status, j: await x.json().catch(() => ({})) }));
    r = await subeDoc('COM/ETAPA 1/CONTRATISTA', '100017-GHE01-000-XXX-PLA-ARQ-E1-001.pdf', 'R00'); ok(r.status === 200, 'en COM entra un nombre DOCPG002 con sus listas (' + r.status + ' ' + JSON.stringify(r.j).slice(0, 120) + ')');
    r = await subeDoc('COM/ETAPA 1/CONTRATISTA', '100017-GHE-ZZ-XX-DR-A-0001-P01.pdf'); ok(r.status === 400 && r.j.error === 'nomenclatura', 'en COM no entra un nombre con la regla ISO 19650 de antes (' + r.status + ')');
    r = await subeDoc('COM/ETAPA 1/CONTRATISTA', '100017-GHE01-999-XXX-PLA-ARQ-E1-002.pdf', 'R00'); ok(r.status === 400, 'un activo que no esta en la libreria maestra se rechaza (' + r.status + ')');
    r = await subeDoc('WIP/ETAPA 1/CONTRATISTA', 'ACTA DE REUNION 15.10.26.pdf'); ok(r.status === 200, 'el WIP sigue libre (' + r.status + ')');
    r = await pide('/api/proyectos/' + pd + '/conformidad', { method: 'PUT', json: { normaPorDefecto: 'default-iso19650' } }); r = await pide('/api/proyectos/' + pd); ok(r.j.config.normaPorDefecto === 'default-iso19650' && r.j.config.nomenclatura.campos[2].nombre === 'Volumen', 'el gestor puede volver a la regla ISO 19650 desde Conformidad');

    console.log('14. Seguimiento de obra: planos del CDE, tareas, fotos, partes diarios y presupuesto');
    const O = '/api/proyectos/' + pd + '/obra';
    r = await subeDoc('WIP/ETAPA 1/CONTRATISTA', 'PLANO-A-101.pdf'); const cPlano = r.j.contenedor && r.j.contenedor.id || r.j.contenedor; ok(r.status === 200 && cPlano, 'se carga un PDF al WIP para usarlo como plano');
    r = await pide(O + '/planos?disponibles=1'); ok(r.status === 200 && r.j.planos.length === 0 && r.j.disponibles.some(d => d.id === cPlano), 'el PDF del CDE aparece como plano disponible (' + (r.j.disponibles || []).length + ')');
    r = await pide(O + '/planos', { json: { contenedores: [cPlano, 'no-existe'], coleccion: 'Paquete 11', carpeta: 'Arquitectura' } }); ok(r.j.agregados === 1, 'se registra en una colección y carpeta de obra, sin duplicar el archivo');
    { // v0.21: lo registrado en Seguimiento de obra lo ven todos los usuarios del proyecto, aunque no lean la carpeta del CDE donde está el PDF
      await pide('/api/proyectos/' + pd + '/miembros', { json: { email: 'obra.sup@superv.com', rol: 'lector', organizacion: 'SUPERV' } });
      galleta = ''; await pide('/api/acceso/local', { json: { email: 'obra.sup@superv.com', clave: 'prueba' } });
      const vP = (await pide(O + '/planos')).j, plano = (vP.planos || []).find(x => x.id === cPlano);
      const pdf = plano ? await fetch(B + O + '/pdf/' + plano.version_id, { headers: { cookie: galleta } }) : { status: 0, headers: new Map() }, cde = plano ? await fetch(B + '/api/proyectos/' + pd + '/versiones/' + plano.version_id + '/descargar', { headers: { cookie: galleta } }) : { status: 0 };
      const otro = await fetch(B + O + '/pdf/no-existe', { headers: { cookie: galleta } });
      ok(plano && pdf.status === 200 && pdf.headers.get('content-type') === 'application/pdf' && cde.status === 403 && otro.status === 404, 'un usuario de otra empresa ve y abre en Seguimiento de obra el plano que registró otro, sin ganar permiso sobre la carpeta del CDE (' + [!!plano, pdf.status, cde.status, otro.status].join('/') + ')');
      galleta = ''; await pide('/api/acceso/local', { json: { email: 'admin@anin.gob.pe', clave: 'prueba' } });
    }
    r = await pide(O + '/tareas', { json: { titulo: 'CORREGIR EN OBRA', estado: 'p1', categoria: 'Arquitectura', plano_id: cPlano, x: 0.4, y: 1.7, horas: '2,5', costo: 120 } }); const tO = r.j.id; ok(r.status === 200 && r.j.numero === 1, 'tarea #1 creada sobre el plano');
    r = await pide(O + '/tareas/' + tO, { method: 'PUT', json: { estado: 'completado', fin: '15/11/2026', checklist: [{ texto: 'Picar', hecho: true }, { texto: '' }], etiquetas: 'muro, acabado' } }); ok(r.j.cambios === 4, 'se edita estado, fecha, checklist y etiquetas (' + r.j.cambios + ')');
    r = await pide(O + '/tareas/' + tO + '/mensaje', { json: { texto: 'Listo para comprobar' } });
    r = await fetch(B + O + '/tareas/' + tO + '/foto', { method: 'POST', headers: { cookie: galleta, 'x-nombre': encodeURIComponent('avance 1.jpg') }, body: Buffer.from([255, 216, 255, 224, 1, 2, 3]) }).then(async x => ({ status: x.status, j: await x.json() })); const fO = r.j.id; ok(r.status === 200 && fO, 'foto adjunta a la tarea');
    r = await fetch(B + O + '/fotos', { method: 'POST', headers: { cookie: galleta, 'x-nombre': 'malo.exe' }, body: Buffer.from('x') }); ok(r.status === 400, 'no se admite un archivo que no es foto ni video (' + r.status + ')');
    r = await pide(O + '/tareas/' + tO); ok(r.j.estado === 'completado' && r.j.y === 1 && r.j.horas === 2.5 && r.j.fin === '2026-11-15' && r.j.checklist.length === 1 && r.j.fotos.length === 1 && r.j.actividad.some(a => a.tipo === 'mensaje') && r.j.actividad.some(a => /Estado cambiado a Completado/.test(a.texto)) && r.j.planoDoc.id === cPlano, 'la tarea guarda sus datos, su posición acotada a la hoja y la actividad (' + r.j.actividad.length + ' entradas)');
    r = await fetch(B + O + '/fotos/' + fO + '/archivo', { headers: { cookie: galleta } }); ok(r.status === 200 && r.headers.get('content-type') === 'image/jpeg' && (await r.arrayBuffer()).byteLength === 7, 'la foto se sirve desde el almacén del CDE');
    r = await pide(O + '/tareas/importar', { json: { filas: [{ titulo: 'Resanar junta', estado: 'Prioridad 3', categoria: 'Acabados' }, { titulo: '' }] } }); ok(r.j.creadas === 1 && r.j.omitidas === 1, 'importar tareas crea las filas con título');
    r = await pide(O + '/tareas?plano=' + cPlano); ok(r.j.tareas.length === 1 && r.j.tareas[0].fotos === 1 && r.j.config.categorias.includes('Acabados'), 'las tareas se filtran por plano y la categoría nueva queda en la lista');
    r = await pide(O + '/partes', { json: { fecha: '2026-11-15', actividades: [{ actividad: 'Tarrajeo sala 702', avance: 250, notas: 'ok' }] } }); const pO = r.j.id;
    r = await pide(O + '/partes/' + pO + '/enviar', { json: { firma: 'no-es-firma' } }); ok(r.status === 400, 'un parte no se envía sin firma');
    r = await pide(O + '/partes/' + pO + '/enviar', { json: { firma: 'data:image/png;base64,iVBORw0KGgo=', firmante: 'Residente' } }); ok(r.status === 200, 'el parte se envía firmado');
    r = await pide(O + '/partes/' + pO, { method: 'PUT', json: { notas: 'cambio' } }); ok(r.status === 409, 'y ya no se puede modificar (' + r.status + ')');
    r = await pide(O + '/partes/' + pO); ok(r.j.estado === 'enviado' && r.j.actividades[0].avance === 100 && r.j.firmante === 'Residente', 'el avance queda acotado a 100 %');
    r = await pide(O + '/presupuesto', { method: 'PUT', json: { partidas: [{ codigo: '01.01', descripcion: 'Concreto', presupuesto: 40250, ejecutado: 1000 }, {}] } }); ok(r.j.partidas === 1, 'presupuesto: se guardan las partidas con contenido');
    r = await pide(O + '/presupuesto'); ok(r.j.partidas[0].presupuesto === 40250 && r.j.tareas.some(t => t.categoria === 'Arquitectura' && t.costo === 120 && t.horas === 2.5), 'y se ve junto al coste y las horas de las tareas');
    r = await pide(O + '/resumen'); ok(r.j.planos === 1 && r.j.tareas === 2 && r.j.abiertas === 1 && r.j.fotos === 1 && r.j.partes === 1, 'resumen del módulo ' + JSON.stringify(r.j));

    console.log('15. Seguimiento de obra: especificaciones, marcas y escala, recorrido 360, consultas, órdenes de cambio y planos desde la nube');
    r = await subeDoc('WIP/ETAPA 1/CONTRATISTA', 'ESPECIFICACIONES-ARQ.pdf'); const cEsp = r.j.contenedor && r.j.contenedor.id || r.j.contenedor;
    r = await pide(O + '/planos', { json: { contenedores: [cEsp], tipo: 'espec', seccion: '09 30 00', coleccion: 'Especificaciones técnicas' } });
    r = await pide(O + '/planos?tipo=espec'); const r2 = await pide(O + '/planos'); ok(r.j.planos.length === 1 && r.j.planos[0].seccion === '09 30 00' && r2.j.planos.length === 1 && r2.j.planos[0].id === cPlano, 'las especificaciones se listan aparte de los planos, con su sección');
    r = await pide(O + '/planos/' + cPlano + '/marcas', { json: { tipo: 'distancia', pagina: 1, puntos: [[0.1, 0.1], [0.5, 0.1]], color: '#2563eb' } }); const mO = r.j.id; ok(r.status === 200 && mO, 'se guarda una medición sobre el plano');
    r = await pide(O + '/planos/' + cPlano + '/marcas', { json: { tipo: 'virus', puntos: [[0, 0], [1, 1]] } }); ok(r.status === 400, 'no se admite un tipo de marca desconocido');
    r = await pide(O + '/planos/' + cPlano + '/escala', { method: 'PUT', json: { mPorPt: 0.03528, texto: '1:100' } }); r = await pide(O + '/planos/' + cPlano + '/marcas'); ok(r.j.marcas.length === 1 && r.j.marcas[0].mia && r.j.escala.texto === '1:100', 'las marcas y la escala del plano se recuperan');
    r = await pide(O + '/marcas/' + mO, { method: 'DELETE' }); ok(r.status === 200, 'quien hizo la marca la puede borrar');
    const sube360 = (q2) => fetch(B + O + '/recorrido?' + q2, { method: 'POST', headers: { cookie: galleta, 'x-nombre': 'toma.jpg' }, body: Buffer.from([255, 216, 255, 1]) }).then(async x => ({ status: x.status, j: await x.json() }));
    r = await sube360('visita=2026-10-21&plano=' + cPlano + '&x=0.3&y=0.4&codigo=OXA-034-N1-E01&nombre=' + encodeURIComponent('Sala de Máquinas')); const t3 = r.j.id; ok(r.status === 200 && t3, 'toma 360 de una visita, ubicada en el plano');
    r = await sube360('visita=04/11/2026&plano=' + cPlano + '&x=0.31&y=0.41&codigo=OXA-034-N1-E01');
    r = await pide(O + '/recorrido'); ok(r.j.visitas.length === 2 && r.j.visitas[0].fecha === '2026-11-04' && r.j.tomas.length === 2 && r.j.tomas.every(t => t.codigo === 'OXA-034-N1-E01'), 'el recorrido agrupa las tomas por visita (' + r.j.visitas.map(v => v.fecha).join(', ') + ')');
    r = await pide(O + '/fotos'); ok(r.j.fotos.filter(f => f.es360).length === 2, 'las tomas quedan marcadas como fotos 360 en la galería');
    r = await sube360('visita=2026-11-12&plano=' + cPlano + '&codigo=OXA-034-N1-E01'); const tH = r.j.id; ok(r.j.heredada === true, 'una toma sin punto marcado cae donde estaba ese ambiente en la visita anterior');
    r = await sube360('visita=2026-11-12&plano=' + cPlano + '&tipo=aerea&plana=1&codigo=DRON-01'); const tA = r.j.id; r = await pide(O + '/recorrido'); const tomaH = r.j.tomas.find(t => t.id === tH), tomaA = r.j.tomas.find(t => t.id === tA);
    ok(tomaH && Math.abs(tomaH.x - 0.31) < 1e-9 && tomaH.tipo === 'piso' && tomaA && tomaA.tipo === 'aerea' && tomaA.es360 === 0 && tomaA.x === null, 'las vistas aéreas de dron se guardan aparte, como foto extendida y sin punto inventado');
    r = await pide(O + '/recorrido/' + tA, { method: 'PUT', json: { tipo: 'piso', x: 0.2, y: 0.2 } }); await pide(O + '/recorrido/' + tH, { method: 'DELETE' }); await pide(O + '/recorrido/' + tA, { method: 'DELETE' });
    r = await pide(O + '/recorrido/' + t3, { method: 'PUT', json: { nombre: 'Sala de máquinas 1', x: 0.9 } }); r = await pide(O + '/recorrido/' + t3, { method: 'DELETE' }); r = await pide(O + '/recorrido'); ok(r.j.tomas.length === 1, 'una toma se mueve, se renombra y se suprime');
    r = await pide(O + '/registros/rfi', { json: { titulo: 'Altura de dintel en eje B', pregunta: '¿Se mantiene 2.10 m?', para: 'admin@anin.gob.pe', plano_id: cPlano, impactoPlazo: true } }); const rf = r.j.id; ok(r.j.numero === 1, 'consulta (RFI) #1 creada en borrador');
    r = await pide(O + '/registro/' + rf, { method: 'PUT', json: { estado: 'respondida' } }); ok(r.status === 400, 'no se responde sin respuesta');
    r = await pide(O + '/registro/' + rf, { method: 'PUT', json: { estado: 'abierta' } }); r = await pide(O + '/registro/' + rf, { method: 'PUT', json: { estado: 'respondida', respuesta: 'Sí, 2.10 m.' } }); ok(r.j.estado === 'respondida', 'la consulta se envía y se responde');
    r = await pide(O + '/registro/' + rf, { method: 'PUT', json: { estado: 'cerrada' } }); r = await pide(O + '/registro/' + rf, { method: 'PUT', json: { titulo: 'otro' } }); ok(r.status === 409, 'cerrada ya no se modifica');
    r = await pide(O + '/registro/' + rf); ok(r.j.estado === 'cerrada' && r.j.datos.respondidaPor === 'admin@anin.gob.pe' && r.j.plano.id === cPlano && r.j.actividad.length >= 4, 'la consulta guarda quién respondió, su plano y la actividad');
    r = await pide(O + '/registros/cambio', { json: { titulo: 'Refuerzo de dintel', partidas: [{ descripcion: 'Acero', monto: 1200.5 }, { descripcion: 'Mano de obra', monto: 800 }], dias: 3, rfi_id: rf } }); const oc = r.j.id;
    r = await pide(O + '/registro/' + oc, { method: 'PUT', json: { estado: 'solicitada' } }); r = await pide(O + '/registro/' + oc, { method: 'PUT', json: { estado: 'aprobada', motivoDecision: 'Procede' } }); ok(r.j.estado === 'aprobada', 'orden de cambio: solicitada y aprobada por el gestor');
    r = await pide(O + '/registros/cambio'); ok(r.j.registros[0].datos.monto === 2000.5 && r.j.registros[0].datos.decididaPor === 'admin@anin.gob.pe', 'el monto es la suma de sus partidas (' + r.j.registros[0].datos.monto + ')');
    r = await pide(O + '/presupuesto'); ok(r.j.cambios.length === 1 && r.j.cambios[0].monto === 2000.5, 'la orden aprobada aparece junto al presupuesto');
    r = await pide(O + '/registros/virus'); ok(r.status === 404, 'no existe otro tipo de registro');
    // planos desde la nube: un servidor local hace de servicio de archivos (solo en pruebas)
    process.env.OBRA_NUBE_PRUEBA = '1'; let pdfNube = Buffer.from('%PDF-1.4 plano version uno');
    const nube = require('http').createServer((q2, s2) => { if (q2.url.startsWith('/redir')) { s2.writeHead(302, { location: '/archivo/A-201.pdf' }); return s2.end(); } if (q2.url.startsWith('/html')) { s2.writeHead(200); return s2.end('<html>vista previa</html>'); } s2.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="' + (q2.url.startsWith('/otro') ? 'B-305 Corte.pdf' : 'A-201 Planta.pdf') + '"' }); s2.end(pdfNube); });
    await new Promise(ok2 => nube.listen(0, '127.0.0.1', ok2)); const UN = 'http://127.0.0.1:' + nube.address().port;
    r = await pide(O + '/nube', { json: { url: UN + '/redir', coleccion: 'Paquete 11', carpeta: 'Nube' } }); const cN = r.j.contenedor; ok(r.status === 200 && r.j.nombre === 'A-201 Planta.pdf' && cN, 'un enlace compartido se baja al CDE y queda como plano (' + r.status + ' ' + (r.j.mensaje || r.j.carpetaCde) + ')');
    r = await pide(O + '/planos'); ok(r.j.planos.some(x => x.id === cN && x.carpeta === 'Nube' && x.n === 1), 'el plano de la nube está en Seguimiento de obra, versión 1');
    r = await pide(O + '/nube/sincronizar', { json: {} }); ok(r.j.actualizados === 0 && r.j.errores === 0, 'sincronizar sin cambios no crea versiones');
    pdfNube = Buffer.from('%PDF-1.4 plano version dos'); r = await pide(O + '/nube/sincronizar', { json: {} }); const r3 = await pide(O + '/planos'); ok(r.j.actualizados === 1 && r3.j.planos.find(x => x.id === cN).n === 2, 'si el archivo cambió en la nube, entra como versión nueva del mismo documento');
    r = await pide(O + '/nube', { json: { url: UN + '/html' } }); ok(r.status === 400 && /PDF/.test(r.j.mensaje), 'un enlace que no entrega un PDF se rechaza');
    { // v0.21.1: quien trae el plano elige la carpeta del CDE
      let rr = await pide(O + '/nube', { json: { url: UN + '/otro', coleccion: 'Paquete 11', carpeta: 'Nube', carpetaCde: 'WIP/ETAPA 2/SUPERVISION' } });
      const cB = rr.j.contenedor, cont = cB ? (await pide('/api/proyectos/' + pd + '/contenedores/' + cB)).j : {};
      const mala = await pide(O + '/nube', { json: { url: UN + '/otro', carpetaCde: 'NO/EXISTE' } });
      ok(rr.status === 200 && rr.j.carpetaCde === 'WIP/ETAPA 2/SUPERVISION' && cont.carpeta === 'WIP/ETAPA 2/SUPERVISION' && mala.status === 400, 'el plano de la nube se carga en la carpeta del CDE que se elige (' + rr.status + ' ' + (rr.j.mensaje || rr.j.carpetaCde) + ')');
      if (cB) { await pide(O + '/planos/' + cB, { method: 'DELETE' }); const en = (await pide(O + '/nube')).j.enlaces.find(x => x.contenedor_id === cB); if (en) await pide(O + '/nube/' + en.id, { method: 'DELETE' }); }   // no altera los conteos de las pruebas que siguen
    }
    { // v0.21.2: OneDrive personal con enlaces nuevos (1drv.ms/b/c/…): la API anterior responde 401 aunque el vínculo sea de «Cualquier persona»
      const NUBE = require('../lib/obra-nube'), NOM = '100010-HVCSA001-000-01-DR-AR-000002[AB].pdf', b64d = (id) => Buffer.from(id.slice(2).replace(/_/g, '/').replace(/-/g, '+'), 'base64').toString();
      let UM = '', fichaCaida = false;
      const msS = require('http').createServer((q2, s2) => {
        const url = new URL(q2.url, 'http://x');
        if (url.pathname.startsWith('/1drv/')) { s2.writeHead(301, { location: '/?redeem=' + Buffer.from('https://1drv.ms' + url.pathname.slice(5)).toString('base64').replace(/=+$/, '') }); return s2.end(); }
        if (q2.method === 'POST' && url.pathname === '/v1.0/token') { let b = ''; q2.on('data', c => b += c); q2.on('end', () => { const j = JSON.parse(b || '{}'); if (fichaCaida || !j.appId) { s2.writeHead(503); return s2.end(); } s2.writeHead(200, { 'content-type': 'application/json' }); s2.end(JSON.stringify({ token: 'ficha-visitante' })); }); return; }
        if (/^\/v1\.0\/shares\/[^/]+\/root\/content$/.test(url.pathname)) { s2.writeHead(401, { 'content-type': 'application/json' }); return s2.end('{"error":{"code":"unauthenticated"}}'); }
        const m = /^\/(?:v1\.0|_api\/v2\.0)\/shares\/([^/]+)\/driveItem$/.exec(url.pathname);
        if (m) {
          if (q2.headers.authorization !== 'Badger ficha-visitante' || q2.headers.prefer !== 'autoredeem') { s2.writeHead(401); return s2.end(); }
          s2.writeHead(200, { 'content-type': 'application/json' });
          return s2.end(JSON.stringify(/carpeta/.test(b64d(m[1])) ? { name: 'Planos', folder: { childCount: 3 } } : { name: NOM, file: { mimeType: 'application/pdf' }, '@content.downloadUrl': UM + '/descarga/abc?tempauth=t' }));
        }
        if (url.pathname.startsWith('/descarga/')) { if (q2.headers.authorization) { s2.writeHead(400); return s2.end('la ficha no debe reenviarse'); } s2.writeHead(200, { 'content-type': 'application/pdf' }); return s2.end(Buffer.from('%PDF-1.7 plano compartido en OneDrive')); }
        s2.writeHead(404); s2.end();
      });
      await new Promise(ok2 => msS.listen(0, '127.0.0.1', ok2)); UM = 'http://127.0.0.1:' + msS.address().port; process.env.OBRA_NUBE_PRUEBA_MS = UM;
      const enlace = UM + '/1drv/b/c/8484218bc4425bde/IQDeW0LEiyGEIICEKZkBAAAAAZW4kLRuC2eZcJN1dl8zoos?e=Yhfjhf';
      const viejo = await fetch(UM + '/v1.0/shares/u!' + Buffer.from(enlace).toString('base64').replace(/=+$/, '') + '/root/content');
      ok(viejo.status === 401, 'reproduce a OneDrive: la API de enlaces compartidos que usaba el CDE responde 401 al enlace nuevo (' + viejo.status + ')');
      const a = await NUBE.descarga(enlace).catch(e => ({ error: e.message }));
      ok(a.nombre === NOM && a.datos && a.datos.slice(0, 5).toString() === '%PDF-', 'el enlace nuevo de OneDrive se baja con la ficha de visitante, con su nombre real (' + (a.nombre || a.error) + ')');
      const eC = await NUBE.descarga(UM + '/1drv/b/c/8484218bc4425bde/carpeta-Planos').then(() => null, e => e);
      ok(eC && /carpeta/.test(eC.message), 'un enlace de carpeta de OneDrive se rechaza con un mensaje claro');
      let rr = await pide(O + '/nube', { json: { url: enlace, coleccion: 'Hospital La Caleta', carpeta: 'Arquitectura', carpetaCde: 'WIP/ETAPA 2/SUPERVISION' } });
      ok(rr.status === 200 && rr.j.nombre === NOM && rr.j.carpetaCde === 'WIP/ETAPA 2/SUPERVISION', 'desde Seguimiento de obra → Desde la nube, el PDF de OneDrive entra al CDE en la carpeta elegida (' + rr.status + ' ' + (rr.j.mensaje || rr.j.nombre) + ')');
      const cO = rr.j.contenedor; if (cO) { await pide(O + '/planos/' + cO, { method: 'DELETE' }); const en = (await pide(O + '/nube')).j.enlaces.find(x => x.contenedor_id === cO); if (en) await pide(O + '/nube/' + en.id, { method: 'DELETE' }); }
      fichaCaida = true; const otroEnlace = UM + '/1drv/b/c/8484218bc4425bde/OTRO?e=x';
      const eF = await NUBE.descarga(otroEnlace).then(() => null, e => e);   // la ficha guardada sigue valiendo: no depende del servicio de fichas
      ok(eF === null, 'la ficha de visitante se reutiliza mientras OneDrive la acepte');
      NUBE.olvidaFicha(); const eS = await NUBE.descarga(otroEnlace).then(() => null, e => e);
      ok(eS && /sin iniciar sesión/.test(eS.message) && /Detalle técnico: .*503.*api anterior 401/.test(eS.message), 'si OneDrive no entrega la ficha, el mensaje dice qué paso falló (' + (eS && eS.message.split('Detalle técnico: ')[1]) + ')');
      delete process.env.OBRA_NUBE_PRUEBA_MS; msS.close();
    }
    delete process.env.OBRA_NUBE_PRUEBA; r = await pide(O + '/nube', { json: { url: UN + '/redir' } }); ok(r.status === 400, 'fuera de pruebas, una dirección local se rechaza (' + r.status + ')');
    r = await pide(O + '/nube', { json: { url: 'https://ejemplo.com/a.pdf' } }); ok(r.status === 400 && /Dropbox/.test(r.j.mensaje), 'y un dominio que no es Dropbox, OneDrive ni Box también');
    nube.close();
    r = await pide(O + '/resumen'); ok(r.j.especs === 1 && r.j.tomas === 1 && r.j.planos === 2, 'resumen con los submódulos nuevos ' + JSON.stringify(r.j));

    console.log('23. Seguimiento de obra: planificación (tablas importadas y planes de corto plazo)');
    {
      const acts = [{ id: '', nombre: 'Estructuras', resumen: true, nivel: 1, ini: '2026-01-05', fin: '2026-02-06', pct: 20 }, { id: 'A100', nombre: 'Excavación', ini: '2026-01-05', fin: '2026-01-16', pct: 50, nivel: 2, critica: true, holgura: 0, pred: [] }, { id: 'A110', nombre: 'Cimentación', ini: '2026-01-19', fin: '2026-02-06', pct: 0, nivel: 2, holgura: 16, pred: [{ id: 'A100', tipo: 'FS', lag: '' }, { id: '', tipo: 'XX' }] }, { id: 'X', nombre: 'Sin fechas' }];
      r = await pide(O + '/planes', { json: { tipo: 'tabla', nombre: 'Cronograma contractual', formato: 'xer', archivo: 'obra.xer', tareas: acts } }); const tP = r.j.id; ok(r.status === 200 && r.j.actividades === 2, 'se importa una tabla de planificación; la actividad sin fechas se descarta');
      r = await pide(O + '/planes', { json: { tipo: 'tabla', nombre: 'Vacía', tareas: [] } }); ok(r.status === 400, 'una tabla sin actividades con fecha se rechaza');
      r = await pide(O + '/planes/' + tP); ok(r.j.tareas.length === 3 && r.j.inicio === '2026-01-05' && r.j.fin === '2026-02-06' && r.j.criticas === 1 && r.j.tareas[2].pred.length === 1 && r.j.formatoTxt === 'Primavera P6 (XER)' && r.j.avance > 0, 'guarda actividades, vínculos válidos, rango, críticas y avance ponderado (' + r.j.avance + ' %)');
      r = await pide(O + '/planes', { json: { tipo: 'plan', nombre: 'Plan de 3 semanas', tabla_id: tP, tareas: [] } }); const pP = r.j.id; ok(r.status === 200, 'se crea un plan de corto plazo vacío, conectado a la tabla');
      r = await pide(O + '/planes/' + pP, { method: 'PUT', json: { tareas: [{ id: 'A010', nombre: 'Vaciado de losa', ini: '2026-11-16', fin: '2026-11-18', pct: 150, responsable: 'Cuadrilla 2' }] } }); r = await pide(O + '/planes/' + pP); ok(r.j.actividades === 1 && r.j.tareas[0].pct === 100 && r.j.tabla && r.j.tabla.id === tP, 'el plan guarda sus actividades (avance acotado a 100) y su tabla');
      r = await pide(O + '/planes'); ok(r.j.planes.length === 2 && !('datos' in r.j.planes[0]) && r.j.planes.some(x => x.tipo === 'plan' && x.tabla_id === tP), 'la lista trae tablas y planes sin el detalle de actividades');
      r = await fetch(B + '/api/proyectos/' + pd + '/subir?carpeta=' + encodeURIComponent('WIP/ETAPA 1/CONTRATISTA'), { method: 'POST', headers: { cookie: galleta, 'x-nombre': encodeURIComponent('CRONOGRAMA-OBRA.xer') }, body: Buffer.from('ERMHDR\t19.12') });
      r = await pide(O + '/planes?disponibles=1'); ok((r.j.disponibles || []).some(x => x.archivo === 'CRONOGRAMA-OBRA.xer'), 'un .xer cargado en Documentos se ofrece para importarlo');
      r = await pide(O + '/planes/' + tP, { method: 'DELETE' }); r = await pide(O + '/planes/' + pP); ok(r.j.tabla_id === '' && r.j.tabla === null, 'al suprimir la tabla, el plan queda sin conectar');
      r = await pide(O + '/resumen'); ok(r.j.planes === 1, 'el resumen cuenta las planificaciones');
    }
    console.log('22. Conector Autodesk Forma: conectar la cuenta, enlazar una carpeta, traer versiones y sincronizar');
    {
      // un servidor local hace de Autodesk (solo en pruebas)
      let fichas = 0, versionesA = 2, fallaB = true, retornoValido = 'no-registrado'; const pedidos = [];
      const MDX = { sdb: null, pedidos: [], lmv: 0 };
      const ISS = { estado1: 'open', upd1: '2026-11-03T10:00:00Z', coment1: [{ id: 'c1', body: 'Se revisará en la próxima entrega', createdBy: 'U2', createdAt: '2026-11-03T09:00:00Z' }], region: '' };
      const V = (item, n, nombre) => ({ type: 'versions', id: 'urn:v:' + item + '?version=' + n, attributes: { displayName: nombre, versionNumber: n, storageSize: 20 + n, lastModifiedUserName: 'Contratista BIM', lastModifiedTime: '2026-11-0' + n + 'T10:00:00Z' }, relationships: { item: { data: { id: 'urn:i:' + item } }, storage: { data: { id: 'urn:adsk.objects:os.object:wip.dm.prod/' + item + '-v' + n + '.pdf' } } } });
      const falsa = require('http').createServer((q2, s2) => {
        const u = new URL(q2.url, 'http://x'), ruta = decodeURIComponent(u.pathname), J2 = (o, st) => { s2.writeHead(st || 200, { 'content-type': 'application/json' }); s2.end(JSON.stringify(o)); }; pedidos.push(q2.method + ' ' + ruta);
        if (ruta === '/authentication/v2/token') { let c = ''; q2.on('data', d => c += d); q2.on('end', () => { const b = new URLSearchParams(c); fichas++; if (b.get('grant_type') === 'authorization_code' && b.get('code') !== 'codigo-bueno') return J2({ error_description: 'codigo invalido' }, 400); if (b.get('grant_type') === 'refresh_token' && !/^R\d+$/.test(b.get('refresh_token'))) return J2({ error_description: 'refresco invalido' }, 400); J2({ access_token: 'A' + fichas, refresh_token: 'R' + fichas, expires_in: 3600 }); }); return; }
        if (ruta === '/authentication/v2/authorize') { const ok3 = u.searchParams.get('redirect_uri') === retornoValido && u.searchParams.get('client_id') === 'id-prueba'; s2.writeHead(302, { location: ok3 ? '/idmgr/login?lang=es' : '/request-error' }); return s2.end(); }
        if (ruta === '/idmgr/login' || ruta === '/request-error') { s2.writeHead(200, { 'content-type': 'text/html' }); return s2.end(ruta === '/request-error' ? '<h1>Error de solicitud</h1>' : '<form>login</form>'); }
        if (ruta === '/userinfo') return J2({ email: 'gestor.bim@autodesk.example', name: 'Gestor BIM' });
        if (ruta.startsWith('/modelderivative/v2/viewers/')) { MDX.lmv++; if (/no-existe/.test(ruta)) { s2.writeHead(404); return s2.end(); } s2.writeHead(200, { 'content-type': 'application/javascript' }); return s2.end('/*lmv ' + ruta.split('/').pop() + '*/ var X = 1;'); }
        if (!/^Bearer A\d+$/.test(q2.headers.authorization || '') && !ruta.startsWith('/s3/')) return J2({}, 401);
        if (ruta.startsWith('/modelderivative/v2/designdata/')) {
          const resto = ruta.slice('/modelderivative/v2/designdata/'.length), urnM = resto.split('/')[0]; MDX.pedidos.push(resto); MDX.urn = urnM;
          if (resto === urnM + '/manifest') return J2({ status: 'success', progress: 'complete', derivatives: [{ outputType: 'svf2', status: 'success', children: [{ role: 'Autodesk.CloudPlatform.PropertyDatabase', urn: 'urn:adsk.viewing:fs.file:' + urnM + '/output/properties/model.sdb', status: 'success' }] }] });
          if (resto === urnM + '/metadata') return J2({ data: { type: 'metadata', metadata: [{ name: '{3D}', role: '3d', guid: 'g3d', isMasterView: true }] } });
          if (resto.endsWith('/signedcookies')) return J2({}, 404);
          if (resto.startsWith(urnM + '/manifest/') && MDX.sdb) { s2.writeHead(200, { 'content-length': MDX.sdb.length }); return s2.end(MDX.sdb); }
          return J2({}, 404);
        }
        if (ruta === '/project/v1/hubs') return J2({ data: [{ id: 'b.hub1', attributes: { name: 'ANIN' } }] });
        if (ruta === '/project/v1/hubs/b.hub1') return J2({ data: { id: 'b.hub1', attributes: { name: 'ANIN', region: 'US' } } });
        if (ruta.startsWith('/construction/')) ISS.region = q2.headers['x-ads-region'] || '';
        if (ruta === '/construction/issues/v1/projects/p1/issues') {
          const LD = (urn, v, hoja) => [{ type: 'TwoDRasterPushpin', urn, createdAtVersion: v, details: { viewable: { name: hoja, is3D: false }, position: {} } }];
          const L = [{ id: 'iss-1', displayId: 1, title: 'Falta cota en eje 3', description: 'Indicar la cota entre ejes 3 y 4', status: ISS.estado1, issueTypeId: 't1', issueSubtypeId: 'st1', assignedTo: 'U2', assignedToType: 'user', dueDate: '2026-11-20', startDate: '2026-11-01', createdBy: 'U1', createdAt: '2026-11-02T10:00:00Z', updatedAt: ISS.upd1, rootCauseId: 'rc1',
              customAttributes: [{ attributeDefinitionId: 'ad1', value: 'o1', type: 'list' }, { attributeDefinitionId: 'ad2', value: 'o2', type: 'list' }, { attributeDefinitionId: 'ad3', value: 'o3', type: 'list' }, { attributeDefinitionId: 'ad4', value: 'E3 - Presentación 4 (P4)', type: 'text' }, { attributeDefinitionId: 'ad5', value: 'o5', type: 'list' }, { attributeDefinitionId: 'ad6', value: null, type: 'text' }], commentCount: ISS.coment1.length, attachmentCount: 1, linkedDocuments: LD('urn:i:A', 1, 'Planta N1') },
            { id: 'iss-2', displayId: 2, title: 'Choque de viga con ducto', status: 'closed', issueTypeId: 't2', assignedTo: 'C1', assignedToType: 'company', createdBy: 'U1', createdAt: '2026-11-04T15:00:00Z', updatedAt: '2026-11-05T10:00:00Z', closedAt: '2026-11-05T10:00:00Z', closedBy: 'U2', commentCount: 0, attachmentCount: 0, linkedDocuments: LD('urn:i:D', 1, 'Detalle') },
            { id: 'iss-3', displayId: 3, title: 'De otro documento', status: 'open', linkedDocuments: LD('urn:i:Z', 1, 'X') },
            { id: 'iss-4', displayId: 4, title: 'Borrador', status: 'draft', linkedDocuments: LD('urn:i:A', 1, 'Planta N1') },
            { id: 'iss-5', displayId: 5, title: 'Borrada', status: 'open', deleted: true, linkedDocuments: LD('urn:i:A', 1, 'Planta N1') }];
          const off = +u.searchParams.get('offset') || 0; return J2({ pagination: { limit: 100, offset: off, totalResults: L.length }, results: L.slice(off, off + 100) });
        }
        if (ruta === '/construction/issues/v1/projects/p1/issue-types') return J2({ pagination: { totalResults: 2 }, results: [{ id: 't1', title: 'Diseño', subtypes: [{ id: 'st1', title: 'Arquitectura' }] }, { id: 't2', title: 'Coordinación', subtypes: [] }] });
        if (ruta === '/construction/admin/v1/projects/p1/users') return J2({ pagination: { totalResults: 2 }, results: [{ autodeskId: 'U1', name: 'Ana Contratista', email: 'ana.bim@contratista.example', companyId: 'C1', companyName: 'GHEMET-Diseño', roles: [{ id: 'R1', name: 'BIM Manager' }] }, { autodeskId: 'U2', name: 'Gestor BIM', email: 'gestor.bim@anin.example' }] });
        if (ruta === '/construction/issues/v1/projects/p1/issue-attribute-definitions') return J2({ pagination: { totalResults: 6 }, results: [
          { id: 'ad1', title: 'Disciplina', dataType: 'list', metadata: { list: { options: [{ id: 'o1', value: 'Salud Publica/Sistema Sanitario/Drenaje Pluvial' }] } } }, { id: 'ad2', title: 'RIBA', dataType: 'list', metadata: { list: { options: [{ id: 'o2', value: 'RIBA 04' }] } } },
          { id: 'ad3', title: 'Tipo de revisión', dataType: 'list', metadata: { list: { options: [{ id: 'o3', value: 'Avance' }] } } }, { id: 'ad4', title: 'N° entregable', dataType: 'text' },
          { id: 'ad5', title: 'Criticidad', dataType: 'list', metadata: { list: { options: [{ id: 'o5', value: 'Grave' }] } } }, { id: 'ad6', title: 'Vacío', dataType: 'text' }] });
        if (ruta === '/construction/issues/v1/projects/p1/issue-root-cause-categories') return J2({ pagination: { totalResults: 1 }, results: [{ id: 'rcc1', title: 'Causas principales', rootCauses: [{ id: 'rc1', title: 'Deficiencias informativas' }] }] });
        if (ruta === '/construction/issues/v1/projects/p1/issues/iss-1/comments') return J2({ pagination: { totalResults: ISS.coment1.length }, results: ISS.coment1 });
        if (ruta === '/construction/issues/v1/projects/p1/issues/iss-2/comments') return J2({ pagination: { totalResults: 0 }, results: [] });
        if (ruta === '/construction/issues/v1/projects/p1/attachments/iss-1/items') return J2({ attachments: [{ attachmentId: 'a1', name: 'foto obra.jpg', storageUrn: 'urn:adsk.objects:os.object:wip.dm.prod/foto-obra.jpg', fileSize: 25 }] });
        if (ruta === '/construction/issues/v1/projects/p1/attachments/iss-2/items') return J2({ attachments: [] });
        if (ruta === '/project/v1/hubs/b.hub1/projects') return J2({ data: [{ id: 'b.p1', attributes: { name: '_DEO-100017-SECHURA' } }] });
        if (ruta === '/project/v1/hubs/b.hub1/projects/b.p1/topFolders') return J2({ data: [{ type: 'folders', id: 'urn:f:raiz', attributes: { displayName: 'Project Files' } }] });
        if (ruta === '/data/v1/projects/b.p1/folders/urn:f:raiz/contents') {
          if (u.searchParams.get('pagina') === '2') return J2({ data: [{ type: 'items', id: 'urn:i:B', attributes: { displayName: 'B-Memoria.pdf' } }], included: [V('B', 1, 'B-Memoria.pdf')] });
          return J2({ data: [{ type: 'items', id: 'urn:i:A', attributes: { displayName: 'A-Planta.pdf' } }, { type: 'folders', id: 'urn:f:sub', attributes: { displayName: 'Sub: A/B' } }], included: [V('A', versionesA, 'A-Planta.pdf')], links: { next: { href: 'http://127.0.0.1:' + falsa.address().port + '/data/v1/projects/b.p1/folders/urn%3Af%3Araiz/contents?pagina=2' } } });
        }
        if (ruta === '/data/v1/projects/b.p1/folders/urn:f:modelos/contents') return J2({ data: [{ type: 'items', id: 'urn:i:M', attributes: { displayName: 'H-Federado.nwd' } }], included: [V('M', 1, 'H-Federado.nwd')] });
        if (ruta === '/data/v1/projects/b.p1/folders/urn:f:sub/contents') return J2({ data: [{ type: 'items', id: 'urn:i:D', attributes: { displayName: 'D-Detalle.pdf' } }], included: [V('D', 1, 'D-Detalle.pdf')] });
        let m = /^\/data\/v1\/projects\/b\.p1\/items\/urn:i:(\w)\/versions$/.exec(ruta);
        if (m) { const n = m[1] === 'A' ? versionesA : 1, nom = { A: 'A-Planta.pdf', B: 'B-Memoria.pdf', D: 'D-Detalle.pdf', M: 'H-Federado.nwd' }[m[1]]; return J2({ data: Array.from({ length: n }, (_, i) => V(m[1], n - i, nom)) }); }
        m = /^\/oss\/v2\/buckets\/wip\.dm\.prod\/objects\/(.+)\/signeds3download$/.exec(ruta); if (m) return J2({ url: 'http://127.0.0.1:' + falsa.address().port + '/s3/' + m[1] });
        m = /^\/s3\/(.+)$/.exec(ruta); if (m) { if (m[1].startsWith('B-') && fallaB) { s2.writeHead(500); return s2.end(); } s2.writeHead(200); return s2.end('contenido de ' + m[1]); }
        J2({}, 404);
      });
      await new Promise(ok2 => falsa.listen(0, '127.0.0.1', ok2));
      const F = '/api/proyectos/' + pd + '/forma';
      r = await pide('/api/forma/estado'); ok(r.status === 200 && r.j.configurado === false && r.j.conectado === false && /\/api\/forma\/vuelta$/.test(r.j.retorno), 'sin credenciales de Autodesk el conector se declara sin configurar y dice su dirección de retorno');
      Object.assign(process.env, { FORMA_APS_PRUEBA: 'http://127.0.0.1:' + falsa.address().port, APS_CLIENT_ID: 'id-prueba', APS_CLIENT_SECRET: 'secreto-prueba' });
      r = await pide('/api/forma/hubs'); ok(r.status === 409 && r.j.error === 'forma-sin-conexion', 'sin conectar la cuenta no se navega Forma');
      let rr = await fetch(B + '/api/forma/conectar?pid=' + pd, { headers: { cookie: galleta }, redirect: 'manual' });
      ok(rr.status === 302 && /forma=error/.test(rr.headers.get('location')) && /direcci%C3%B3n%20de%20retorno/.test(rr.headers.get('location')), 'si la app de Autodesk no tiene registrada la dirección de retorno, el CDE lo dice en vez de mandar a la página de error de Autodesk');
      r = await pide('/api/forma/diagnostico'); ok(r.j.credenciales === true && r.j.retornoOk === false && r.j.app === 'ueba' && /variables de entorno (de Windows|del servidor|del servicio en Render)/.test(r.j.origen) && !JSON.stringify(r.j).includes('secreto-prueba'), 'el diagnóstico dice qué app usa, de dónde salen las claves y qué falla, sin mostrar el secreto ' + JSON.stringify(r.j));
      retornoValido = r.j.retorno;
      r = await pide('/api/forma/diagnostico'); ok(r.j.retornoOk === true, 'con la dirección registrada, el diagnóstico la da por buena');
      rr = await fetch(B + '/api/forma/conectar?pid=' + pd, { headers: { cookie: galleta }, redirect: 'manual' }); const ida = new URL(rr.headers.get('location')), gF = (rr.headers.get('set-cookie') || '').split(';')[0];
      ok(rr.status === 302 && ida.pathname === '/authentication/v2/authorize' && ida.searchParams.get('scope') === 'data:read account:read' && ida.searchParams.get('client_id') === 'id-prueba' && /^cde_forma=/.test(gF), 'conectar lleva a Autodesk pidiendo solo lectura');
      rr = await fetch(B + '/api/forma/vuelta?code=codigo-bueno&state=otro', { headers: { cookie: galleta + '; ' + gF }, redirect: 'manual' }); ok(rr.status === 302 && /forma=error/.test(rr.headers.get('location')), 'una vuelta con otro estado se rechaza');
      rr = await fetch(B + '/api/forma/vuelta?code=codigo-bueno&state=' + ida.searchParams.get('state'), { headers: { cookie: galleta + '; ' + gF }, redirect: 'manual' }); ok(rr.status === 302 && /forma=conectado#\/p\//.test(rr.headers.get('location')), 'la vuelta correcta deja la cuenta conectada y regresa a Integración con otros CDE');
      r = await pide('/api/forma/estado'); ok(r.j.conectado && r.j.cuenta.correo === 'gestor.bim@autodesk.example', 'el estado muestra la cuenta de Autodesk conectada');
      const fila = require('../lib/bd').q.uno('SELECT refresco FROM forma_cuentas'); ok(fila && !/^R\d+$/.test(fila.refresco) && fila.refresco.length > 30, 'el permiso de renovación se guarda cifrado');
      r = await pide('/api/forma/hubs'); const r2 = await pide('/api/forma/hubs/b.hub1/proyectos'), r3 = await pide('/api/forma/proyectos/b.p1/contenido?hub=b.hub1'), r4 = await pide('/api/forma/proyectos/b.p1/contenido?carpeta=' + encodeURIComponent('urn:f:raiz'));
      ok(r.j[0].nombre === 'ANIN' && r2.j[0].nombre === '_DEO-100017-SECHURA' && r3.j[0].tipo === 'carpeta' && r4.j.length === 3 && r4.j[0].tipo === 'carpeta', 'se navegan cuentas, proyectos y carpetas de Forma (con paginación)');
      const cuerpo = { hub: 'b.hub1', hubNombre: 'ANIN', proyecto: 'b.p1', proyectoNombre: '_DEO-100017-SECHURA', carpeta: 'urn:f:raiz', carpetaNombre: 'Project Files', carpetaCde: 'WIP/ETAPA 1/CONTRATISTA', subcarpetas: true, versiones: 'todas' };
      r = await pide(F + '/enlaces', { json: Object.assign({}, cuerpo, { carpetaCde: 'NO/EXISTE' }) }); ok(r.status === 400, 'no se enlaza con una carpeta del CDE que no existe');
      r = await pide(F + '/enlaces', { json: cuerpo }); const eF = r.j.id; ok(r.status === 200 && eF, 'se crea el enlace carpeta de Forma → carpeta del CDE');
      const espera = async () => { for (let i = 0; i < 100; i++) { const x = (await pide(F + '/enlaces')).j.enlaces.find(z => z.id === eF); if (x && (!x.trabajo || x.trabajo.estado !== 'corriendo') && x.ultimo) return x; await duerme(100); } return null; };
      let en = await espera(); ok(en && en.resumen.nuevos === 3 && en.resumen.errores === 1 && en.traidos === 3 && en.conError === 1, 'primera sincronización: 3 versiones traídas y 1 con error ' + JSON.stringify(en && en.resumen));
      r = await pide(F + '/enlaces/' + eF + '/items'); const itA = r.j.items.filter(x => x.item === 'urn:i:A' && x.estado === 'traido'), itD = r.j.items.find(x => x.item === 'urn:i:D'), itB = r.j.items.find(x => x.item === 'urn:i:B');
      ok(itA.length === 2 && itA[0].contenedor_id === itA[1].contenedor_id && itA.map(x => x.n_cde).sort().join() === '1,2', 'las dos versiones de Forma quedan como V1 y V2 del mismo documento');
      ok(itD && itD.estado === 'traido' && itD.ruta === 'Sub_ A_B' && itB.estado === 'error' && /500/.test(itB.detalle), 'la subcarpeta se crea con un nombre válido y el archivo que falló queda anotado con su motivo');
      r = await pide('/api/proyectos/' + pd + '/contenedores/' + itA[0].contenedor_id); const vA = (r.j.versiones || []).slice().sort((a, b) => a.n - b.n);
      ok(r.status === 200 && vA.length === 2 && vA[0].origen === 'forma' && vA[0].subido_por === 'admin@anin.gob.pe' && (r.j.carpeta || (r.j.contenedor || {}).carpeta) === 'WIP/ETAPA 1/CONTRATISTA', 'el documento está en la carpeta elegida, con origen Forma ' + JSON.stringify({ c: r.j.carpeta, o: vA[0] && vA[0].origen }));
      r = await pide('/api/proyectos/' + pd + '/carpetas'); ok(JSON.stringify(r.j).includes('WIP/ETAPA 1/CONTRATISTA/Sub_ A_B'), 'la subcarpeta de Forma existe en el árbol del CDE');
      r = await pide(F + '/enlaces/' + eF + '/sincronizar', { json: {} }); en = await espera(); await duerme(150); en = await espera(); ok(en.resumen.nuevos === 0 && en.traidos === 3, 'volver a sincronizar sin cambios no duplica nada');
      versionesA = 3; fallaB = false; r = await pide(F + '/enlaces/' + eF + '/sincronizar', { json: { reintentar: true } }); await duerme(150); en = await espera();
      ok(en.resumen.nuevos === 2 && en.resumen.errores === 0 && en.traidos === 5 && en.conError === 0, 'una versión nueva en Forma entra como versión nueva, y el que falló entra al reintentar ' + JSON.stringify(en.resumen));
      r = await pide('/api/proyectos/' + pd + '/contenedores/' + itA[0].contenedor_id); ok((r.j.versiones || []).length === 3, 'el documento ya tiene 3 versiones');
      r = await pide(F + '/enlaces', { json: cuerpo }); ok(r.status === 409, 'no se repite el mismo enlace');
      // carpeta con norma (COM): lo que no cumple queda pendiente SIN descargarse; con el nombre de la rejilla entra
      const descargasAntes = pedidos.filter(x => x.includes('/s3/')).length;
      r = await pide(F + '/enlaces', { json: Object.assign({}, cuerpo, { carpetaCde: 'COM/ETAPA 1/CONTRATISTA', subcarpetas: false }) }); const eC = r.j.id; ok(r.status === 200 && eC, 'se enlaza Forma con una carpeta de COM (con norma)');
      const esperaC = async () => { for (let i = 0; i < 100; i++) { const x = (await pide(F + '/enlaces')).j.enlaces.find(z => z.id === eC); if (x && (!x.trabajo || x.trabajo.estado !== 'corriendo') && x.ultimo) return x; await duerme(100); } return null; };
      let enC = await esperaC(); ok(enC && enC.pendientes === 2 && enC.traidos === 0 && enC.conError === 0 && enC.resumen.pendientes === 2 && enC.resumen.sinCambios === 0, 'en COM los 2 archivos que no cumplen quedan pendientes de nomenclatura, no como error ni «sin cambios» ' + JSON.stringify(enC && enC.resumen));
      ok(pedidos.filter(x => x.includes('/s3/')).length === descargasAntes, 'lo que no cumple la nomenclatura no se descarga de Forma');
      r = await pide(F + '/enlaces/' + eC + '/pendientes'); const pA = r.j.pendientes.find(x => x.nombre === 'A-Planta.pdf');
      ok(r.j.pendientes.length === 2 && pA && pA.carpeta === 'COM/ETAPA 1/CONTRATISTA', 'la lista de pendientes trae cada documento con su carpeta de destino');
      r = await pide(F + '/enlaces/' + eC + '/nombres', { json: { asignaciones: [{ item: pA.item, nombre: '100017-GHE-ZZ-XX-DR-A-0002-P01.pdf', atributos: { descripcion: 'Planta general' } }, { item: r.j.pendientes.find(x => x !== pA).item, nombre: 'mal-nombre.pdf' }] } });
      ok(r.j.aceptados === 1 && r.j.rechazados.length === 1, 'la rejilla manda los nombres: el conforme se acepta y el que no cumple se rechaza ' + r.status + ' ' + JSON.stringify(r.j).slice(0, 300));
      await duerme(150); enC = await esperaC(); r = await pide(F + '/enlaces/' + eC + '/items'); const tA = r.j.items.filter(x => x.item === pA.item && x.estado === 'traido');
      const oA = r.j.items.filter(x => x.item === pA.item && x.estado === 'omitido');
      ok(tA.length === 1 && tA[0].n_forma === 3 && oA.length === 2 && tA.every(x => x.nombre_cde === '100017-GHE-ZZ-XX-DR-A-0002-P01.pdf') && enC.pendientes === 1, 'con el nombre de la rejilla entra la versión vigente de Forma (V3), las anteriores quedan omitidas con su motivo y queda 1 pendiente ' + JSON.stringify({ n: tA.length, p: enC.pendientes, otros: r.j.items.filter(x => x.item === pA.item && x.estado !== 'traido').map(x => x.n_forma + ':' + x.estado + ':' + x.detalle) }));
      r = await pide('/api/proyectos/' + pd + '/contenedores/' + tA[0].contenedor_id); const vU = (r.j.versiones || []).slice().sort((a, b) => b.n - a.n)[0];
      ok(r.status === 200 && (r.j.nombre || (r.j.contenedor || {}).nombre) === '100017-GHE-ZZ-XX-DR-A-0002' && vU && ((r.j.atributos || (r.j.contenedor || {}).atributos || {}).descripcion === 'Planta general'), 'el documento queda en COM con el nombre de la rejilla y la descripción que se escribió ' + JSON.stringify({ n: r.j.nombre, a: r.j.atributos }).slice(0, 200));
      r = await pide(F + '/enlaces/' + eC, { method: 'DELETE' });
      // incidencias de Forma de los documentos traídos (con sus comentarios y adjuntos)
      r = await pide(F + '/enlaces/' + eF + '/incidencias'); const fI = r.j.incidencias;
      ok(fI.length === 2 && fI[0].display_id === 1 && fI[1].display_id === 2 && fI[0].documento && fI[0].adjuntos === 1, 'se traen las incidencias de Forma de los documentos del enlace (no las de otros documentos, borradores ni borradas) ' + JSON.stringify(fI.map(x => x.display_id + ':' + x.documento)));
      ok(ISS.region === 'US', 'las incidencias se piden a la región del hub de Forma (x-ads-region)');
      const cA1 = require('../lib/bd').q.uno("SELECT contenedor_id, n_cde FROM forma_items WHERE enlace_id = ? AND item = 'urn:i:A' AND n_forma = 1 AND estado = 'traido'", eF);
      r = await pide('/api/proyectos/' + pd + '/incidencias'); const i1 = r.j.incidencias.find(x => x.referencia === 'Autodesk Forma #1'), i2 = r.j.incidencias.find(x => x.referencia === 'Autodesk Forma #2');
      ok(i1 && i1.origen === 'autodesk-forma' && i1.estado === 'abierta' && i1.titulo === 'Falta cota en eje 3' && i1.autor === 'ana.bim@contratista.example' && i1.asignado === 'gestor.bim@anin.example' && i1.vencimiento === '2026-11-20' && i1.inicio === '2026-11-01' && i1.contenedor_id === cA1.contenedor_id, 'la incidencia entra al CDE con su título, autor, asignado, fechas y el documento del CDE ' + JSON.stringify(i1 && { e: i1.estado, a: i1.autor, s: i1.asignado }));
      const vA1 = require('../lib/bd').q.uno('SELECT id FROM versiones WHERE contenedor_id = ? AND n = ?', cA1.contenedor_id, cA1.n_cde);
      ok(i1.version_id === vA1.id && i2 && i2.estado === 'cerrada' && i2.tipo === 'interferencia' && i2.cerrado, 'queda en la versión del documento donde se creó; las cerradas entran cerradas y el tipo «Coordinación» como interferencia');
      ok(i1.disciplina === 'Salud Publica/Sistema Sanitario/Drenaje Pluvial' && i1.etapa === 'RIBA 04' && i1.tipo_revision === 'Avance' && i1.entregable === 'E3 - Presentación 4 (P4)', 'los campos de Forma Disciplina, RIBA (= etapa), Tipo de revisión y N.º entregable llenan los de la incidencia ' + JSON.stringify({ d: i1.disciplina, e: i1.etapa, r: i1.tipo_revision, n: i1.entregable }));
      ok(i2.asignado === 'GHEMET-Diseño' && i2.inicio === '2026-11-04', 'una incidencia asignada a una empresa en Forma lleva el nombre de la empresa y, sin fecha de inicio, la de su creación ' + JSON.stringify({ a: i2.asignado, i: i2.inicio }));
      r = await pide('/api/proyectos/' + pd + '/incidencias/' + i1.id); ok(r.j.comentarios.length === 2 && /Creada en Autodesk Forma \(#1 · Diseño › Arquitectura\)/.test(r.j.comentarios[0].texto) && r.j.comentarios[1].texto === 'Se revisará en la próxima entrega' && r.j.comentarios[1].autor === 'gestor.bim@anin.example', 'sus comentarios de Forma entran a la actividad de la incidencia');
      r = await pide('/api/proyectos/' + pd + '/forma/incidencias/' + i1.id); ok(r.j.displayId === 1 && r.j.extra.hoja === 'Planta N1' && r.j.extra.tipo === 'Diseño › Arquitectura' && r.j.adjuntos.length === 1 && r.j.adjuntos[0].hay && r.j.extra.causa === 'Causas principales › Deficiencias informativas' && r.j.extra.campos.some(c => c.titulo === 'Criticidad' && c.valor === 'Grave') && !r.j.extra.campos.some(c => c.titulo === 'Vacío'), 'la ficha muestra lo que viene de Forma (hoja, tipo) y el adjunto copiado');
      let ra2 = await fetch(B + '/api/proyectos/' + pd + '/forma/incidencias/' + i1.id + '/adjuntos/0', { headers: { cookie: galleta } }); ok(ra2.status === 200 && (await ra2.text()) === 'contenido de foto-obra.jpg', 'el adjunto de la incidencia se descarga desde el CDE');
      ISS.estado1 = 'in_review'; ISS.upd1 = '2026-11-06T10:00:00Z'; ISS.coment1.push({ id: 'c2', body: 'Cota agregada en la V3', createdBy: 'U1', createdAt: '2026-11-06T09:00:00Z' });
      r = await pide(F + '/enlaces/' + eF + '/sincronizar', { json: {} }); en = await espera();
      r = await pide('/api/proyectos/' + pd + '/incidencias/' + i1.id); const fi1 = await pide('/api/proyectos/' + pd + '/forma/incidencias/' + i1.id);
      ok(r.j.estado === 'respondida' && r.j.comentarios.length === 4 && r.j.comentarios.some(c => /Estado en Forma: En revisión/.test(c.texto)) && r.j.comentarios[3].texto === 'Cota agregada en la V3' && fi1.j.adjuntos.length === 1 && en.resumen.incidencias.actualizadas === 1 && en.resumen.incidencias.comentarios === 1, 'al resincronizar se actualiza el estado, entran los comentarios nuevos y no se repiten adjuntos ' + JSON.stringify(en.resumen.incidencias));
      r = await pide('/api/proyectos/' + pd + '/incidencias'); ok(r.j.incidencias.filter(x => x.origen === 'autodesk-forma').length === 2, 'resincronizar no duplica las incidencias');
      r = await pide(F + '/enlaces/' + eF, { method: 'PUT', json: { incidencias: false } }); r = await pide(F + '/enlaces/' + eF + '/sincronizar', { json: {} }); en = await espera(); ok(en.incidencias === false && !en.resumen.incidencias, 'el enlace puede dejar de traer incidencias');
      r = await pide(F + '/enlaces/' + eF, { method: 'PUT', json: { incidencias: true } });
      // v0.13.3 — los modelos de Forma (NWD, sin lector libre) en el visor del CDE: indice desde la base de propiedades de la
      // traduccion que Autodesk ya tiene y geometria leida en el navegador (aqui, un modelo falso del visor de Autodesk)
      {
        const { DatabaseSync } = require('node:sqlite'), rutaSdb = require('path').join(require('os').tmpdir(), 'cde-prueba-' + Date.now() + '.sdb'), sdb = new DatabaseSync(rutaSdb);
        sdb.exec('CREATE TABLE _objects_attr (id INTEGER PRIMARY KEY, name TEXT, category TEXT, data_type INTEGER, data_type_context TEXT, description TEXT, display_name TEXT, flags INTEGER, display_precision INTEGER); CREATE TABLE _objects_val (id INTEGER PRIMARY KEY, value BLOB); CREATE TABLE _objects_eav (id INTEGER PRIMARY KEY, entity_id INTEGER, attribute_id INTEGER, value_id INTEGER);');
        [[1, 'parent', '__parent__'], [2, 'name', '__name__'], [3, 'Category', '__category__'], [4, 'Familia', 'Elemento'], [5, 'Área', 'Cotas'], [6, 'Type', 'Item'], [7, 'Icon', 'Item']].forEach(([i, n, g]) => sdb.prepare('INSERT INTO _objects_attr (id, name, category, display_name, flags) VALUES (?,?,?,?,0)').run(i, n, g, n));
        const vals = new Map(), val = (v) => { const k = String(v); if (!vals.has(k)) { vals.set(k, vals.size + 1); sdb.prepare('INSERT INTO _objects_val VALUES (?,?)').run(vals.get(k), v); } return vals.get(k); };
        const pon = (e, a, v) => sdb.prepare('INSERT INTO _objects_eav (entity_id, attribute_id, value_id) VALUES (?,?,?)').run(e, a, val(v));
        pon(1, 2, 'H-Federado.nwd'); pon(2, 1, 1); pon(2, 2, 'Nivel 1');
        pon(3, 1, 2); pon(3, 2, 'Muro básico'); pon(3, 3, 'Revit Walls'); pon(3, 4, 'Muro básico'); pon(3, 5, '12.5 m²');
        for (const [e, pa] of [[4, 3], [5, 3], [7, 6]]) { pon(e, 1, pa); pon(e, 2, 'Solid'); pon(e, 6, 'Solid'); }
        pon(6, 1, 2); pon(6, 2, 'Puerta simple'); pon(6, 3, 'Revit Doors'); pon(6, 4, 'Puerta simple');
        for (const [e, ic] of [[1, 'File'], [2, 'Layer'], [3, 'Composite Object'], [4, 'Geometry'], [5, 'Geometry'], [6, 'Composite Object'], [7, 'Geometry']]) pon(e, 7, ic);   // Item / Icon de Navisworks
        sdb.close(); MDX.sdb = require('fs').readFileSync(rutaSdb); require('fs').unlinkSync(rutaSdb);
        r = await pide(F + '/enlaces', { json: Object.assign({}, cuerpo, { carpeta: 'urn:f:modelos', carpetaNombre: 'Modelos', subcarpetas: false }) }); const eM = r.j.id;
        let enM = null; for (let i = 0; i < 100 && !enM; i++) { const x = (await pide(F + '/enlaces')).j.enlaces.find(z => z.id === eM); if (x && (!x.trabajo || x.trabajo.estado !== 'corriendo') && x.ultimo) enM = x; else await duerme(100); }
        ok(enM && enM.traidos === 1 && enM.modelos === 1 && enM.enVisor === 0, 'el enlace con un NWD dice que trajo 1 modelo y que aún no está en el visor del CDE ' + JSON.stringify(enM && { t: enM.traidos, m: enM.modelos, v: enM.enVisor }));
        r = await pide(F + '/modelos?enlace=' + eM); const mM = r.j.modelos[0];
        ok(r.j.modelos.length === 1 && mM.archivo === 'H-Federado.nwd' && !mM.enVisor && mM.vigente, 'la lista de modelos de Forma trae el NWD con su estado en el visor ' + JSON.stringify(mM));
        let estM = null; for (let i = 0; i < 50; i++) { estM = (await pide('/api/modelos/' + pd + '/' + mM.vid + '/estado')).j; if (estM.estado === 'no-legible') break; await duerme(100); }
        ok(estM.estado === 'no-legible', 'el NWD sigue sin lector libre en el CDE (antes de pasarlo con la traducción de Forma) ' + JSON.stringify(estM).slice(0, 160));
        const vPdf = require('../lib/bd').q.uno("SELECT v.id FROM forma_items fi JOIN versiones v ON v.contenedor_id = fi.contenedor_id AND v.n = fi.n_cde WHERE fi.enlace_id = ? AND fi.estado = 'traido' LIMIT 1", eF);
        r = await pide(F + '/modelos/' + vPdf.id + '/preparar', { json: {} }); ok(r.status === 409 && r.j.error === 'no-modelo', 'un PDF traído de Forma no se pasa al visor');
        r = await pide(F + '/modelos/no-existe/preparar', { json: {} }); ok(r.status === 404, 'una versión que no existe no se prepara');
        r = await pide('/api/forma/token-visor'); ok(r.status === 200 && /^A\d+$/.test(r.j.access_token) && r.j.expires_in > 0, 'el navegador recibe el acceso de Autodesk del usuario (solo lectura) para abrir la traducción');
        let rt = await fetch(B + '/api/forma/token-visor'); ok(rt.status === 401, 'sin sesión no se entrega el acceso de Autodesk');
        r = await pide(F + '/modelos/' + mM.vid + '/preparar', { json: {} });
        ok(r.status === 200 && r.j.urn === Buffer.from('urn:v:M?version=1').toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_') && r.j.region === 'US' && r.j.version === 1, 'preparar da la traducción del archivo en Autodesk (urn de la versión de Forma) y su región ' + JSON.stringify(r.j).slice(0, 200));
        let tM = null; for (let i = 0; i < 100; i++) { tM = (await pide(F + '/modelos/' + mM.vid + '/estado')).j.trabajo; if (tM && (tM.indice.estado !== 'leyendo')) break; await duerme(100); }
        ok(tM && tM.indice.estado === 'listo' && tM.indice.resumen.elementos === 2 && MDX.pedidos.some(x => /\/manifest\/.*model\.sdb$/.test(x)), 'el servidor arma el índice con la base de propiedades de la traducción de Autodesk (extractor del visor, en un hilo): 2 elementos ' + JSON.stringify(tM).slice(0, 300));
        r = await pide(F + '/modelos/' + mM.vid + '/elementos-indice'); ok(JSON.stringify(r.j.e) === '[3,6]' && Array.isArray(r.j.acero) && r.j.acero.length === 0, 'el índice dice cuáles nodos son elementos (los sólidos 4, 5 y 7 son partes) ' + JSON.stringify(r.j));
        // el modelo del visor de Autodesk (falso): piezas 0 y 1 del muro (en pies, con desplazamiento), 2 de la puerta por el proxy de render (SVF2), 3 lineas, 4 sin malla
        const C = require('../public/js/modulos/cdeg.js');
        class M4 { constructor() { this.elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; } }
        const tri = (dx) => ({ vb: new Float32Array([0, 0, 0, 9, 9, 1, 0, 0, 1, 0, 9, 9, 0, 1, 0, 9, 9, 9]), vbstride: 6, ib: new Uint16Array([0, 1, 2]) });
        const GEO = { 0: tri(), 1: { vb: new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0, 2, 2, 0]), vbstride: 3, ib: new Uint16Array([0, 1, 2, 1, 3, 2]) }, 3: { vb: new Float32Array([0, 0, 0, 1, 1, 1]), vbstride: 3, isLines: true, ib: new Uint16Array([0, 1]) } };
        const modeloF = { getFragmentList: () => ({ getCount: () => 5, fragments: { fragId2dbId: new Int32Array([4, 5, 7, 99, 7]) }, getGeometry: (f) => GEO[f] || null,
            getWorldMatrix: (f, m) => { if (f === 0) m.elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1]; }, getMaterial: (f) => f === 1 ? { color: { r: 0.5, g: 0.8, b: 1 }, transparent: true, opacity: 0.4 } : { color: { r: 1, g: 0, b: 0 } } }),
          getUnitScale: () => 0.3048, getUpVector: () => [0, 0, 1], getData: () => ({ globalOffset: { x: 100, y: 200, z: 0 } }) };
        const visorF = { impl: { getRenderProxy: (m, f) => f === 2 ? { geometry: { attributes: { position: { array: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), itemSize: 3 }, index: { array: new Uint32Array([0, 1, 2]) } } }, matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 10, 1] } } : null } };
        const Lc = C.prepara(modeloF, { visor: visorF, Matriz: M4 }); C.leeTramo(Lc, 0, 2); C.leeTramo(Lc, 2, 5); const L0 = C.cierra(Lc);
        ok(L0.elems.map(x => x.e).join() === '4,5,7' && L0.sinMalla === 1 && L0.lineas === 1, 'se leen las mallas por tramos, con la receta del visor (lista de fragmentos y, si no, el proxy de render); líneas y piezas sin malla se cuentan aparte');
        const padF = new Map([[4, 3], [5, 3], [7, 6], [3, 2], [6, 2], [2, 1], [1, 0]]), ids = new Set(r.j.e);
        const LA = C.agrupa(L0, (d) => ids.has(d), (d) => padF.get(d));
        ok(LA.elems.map(x => x.e + ':' + x.piezas.length).join() === '3:2,6:1' && LA.sinElemento === 0, 'las piezas se juntan en su elemento del índice (el muro con sus 2 sólidos, la puerta con 1)');
        const out = C.escribe(LA, { modelo: 'H-Federado.nwd', herramienta: 'prueba' }), buf = Buffer.concat(out.partes.map(x => Buffer.from(x)));
        const dvh = (o) => buf.readUInt32LE(o), Lm = dvh(32), meta = JSON.parse(buf.slice(36, 36 + Lm).toString()); let off = 36 + Lm; off += (4 - off % 4) % 4;
        const tb = (i, k) => buf.readUInt32LE(off + i * 24 + k * 4), pos0 = off + 24 * 2, idx0 = pos0 + 12 * dvh(12), tr0 = idx0 + 4 * dvh(16);
        const P = (v) => [0, 1, 2].map(k => +buf.readFloatLE(pos0 + (v * 3 + k) * 4).toFixed(4));
        ok(buf.toString('latin1', 0, 4) === 'CDEG' && dvh(4) === 2 && dvh(8) === 2 && dvh(12) === 10 && dvh(16) === 12 && meta.unidades === 'm' && meta.ejeArriba === 'Z' && JSON.stringify(meta.origen.map(v => +v.toFixed(3))) === '[30.48,60.96,0]', 'el .cdeg sale en formato 2: 2 elementos, 10 vértices, 4 triángulos, en metros con Z arriba y el desplazamiento de Autodesk como origen ' + JSON.stringify({ h: [dvh(8), dvh(12), dvh(16)], o: meta.origen }));
        ok(tb(0, 0) === 3 && tb(0, 1) === 0 && tb(0, 2) === 7 && tb(0, 3) === 0 && tb(0, 4) === 9 && tb(1, 0) === 6 && tb(1, 1) === 7 && tb(1, 2) === 3 && tb(1, 3) === 9 && tb(1, 4) === 3, 'la tabla de elementos lleva el id del índice y sus tramos de vértices e índices');
        ok(JSON.stringify(P(0)) === '[0.3048,0.6096,0.9144]' && JSON.stringify(P(7)) === '[0,0,3.048]' && buf.readUInt32LE(idx0 + 3 * 4) === 3 + 1 - 1 + 0 && [3, 4, 5, 4, 6, 5].every((v, k) => buf.readUInt32LE(idx0 + (3 + k) * 4) === v), 'las posiciones llevan la matriz de cada pieza y la escala a metros; los índices quedan relativos al primer vértice del elemento');
        ok(buf.readUInt32LE(tr0) === 6 && buf.readUInt32LE(tr0 + 4) === 0 && buf[off + 23] === 255, 'la pieza translúcida (vidrio) va al final del elemento y se marca como tal (icTr)');
        const LY = C.cierra(Object.assign(C.prepara(Object.assign({}, modeloF, { getUpVector: () => [0, 1, 0], getData: () => ({}) }), { visor: visorF, Matriz: M4 }), {})); 
        const Ly = C.prepara(Object.assign({}, modeloF, { getUpVector: () => [0, 1, 0], getData: () => ({}) }), { visor: visorF, Matriz: M4 }); C.leeTramo(Ly, 0, 1); const oy = C.escribe(C.cierra(Ly), {}), by = Buffer.concat(oy.partes.map(x => Buffer.from(x))); let oY = 36 + by.readUInt32LE(32); oY += (4 - oY % 4) % 4; oY += 24;
        ok(LY.elems.length === 0 && [0, 1, 2].map(k => +by.readFloatLE(oY + k * 4).toFixed(4)).join() === '0.3048,-0.9144,0.6096', 'un modelo con Y arriba se gira a Z arriba (como el resto del CDE)');
        // modelos grandes (federados): censo, plan con presupuesto (criterio del complemento de Navisworks) y armado por trozos
        {
          const Lc2 = C.censa(modeloF, { visor: visorF, Matriz: M4 }); C.censaTramo(Lc2, 0, 5);   // sin cajas del visor: mide cada pieza
          ok(Lc2.nMalla === 3 && Lc2.triEntrada === 4 && Lc2.lineas === 1 && Lc2.sinMalla === 1 && Math.abs(Lc2.caja[0] - 0.3048) < 1e-4 && Math.abs(Lc2.caja[2 * 6 + 5] - 3.048) < 1e-4, 'el censo cuenta piezas y triángulos y mide la caja de cada pieza en metros (sin tocar el resto)');
          const G2 = C.elementosDe(Lc2, (d) => ids.has(d), (d) => padF.get(d)), pl2 = C.planifica(Lc2, null, {}, G2);
          const W2 = C.escritor(); C.arma(Lc2, pl2, G2.elems, W2, 0, 99); const o2 = C.cierraEscritor(W2, Lc2.origen, { modelo: 'x' });
          const b2 = Buffer.concat(o2.partes.map(x => Buffer.from(x.buffer ? new Uint8Array(x.buffer, x.byteOffset, x.byteLength) : x)));
          ok(pl2.cifras.nTalCual === 3 && o2.nElem === 2 && o2.nVert === 10 && o2.nIdx === 12 && (() => { const x0 = (36 + b2.readUInt32LE(32) + 3) & ~3, y0 = (36 + buf.readUInt32LE(32) + 3) & ~3, cuerpo = buf.length - y0; return b2.slice(x0, x0 + cuerpo).equals(buf.slice(y0)) && b2.toString('latin1', x0 + cuerpo, x0 + cuerpo + 4) === 'ARIS'; })(), 'un modelo que cabe en el presupuesto sale idéntico por el camino nuevo (por trozos) que por el anterior, más sus aristas precalculadas al final');
          // v0.13.7 — un federado de mentira con el criterio del complemento de Navisworks: una esfera densa (5 m), 1.500 tornillos de
          // 1 cm, 30 tubos, acero de refuerzo, un vidrio de dos caras muy dividido, una letra «O» fina muy teselada y una malla repetida
          const esf = (cx, cy, cz, r, n) => { const P = [], I = []; for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) { const th = Math.PI * i / n, ph = 2 * Math.PI * j / n; P.push(cx + r * Math.sin(th) * Math.cos(ph), cy + r * Math.sin(th) * Math.sin(ph), cz + r * Math.cos(th)); } for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const a = i * (n + 1) + j; I.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2); } return { vb: new Float32Array(P), vbstride: 3, ib: new Uint32Array(I) }; };
          const tub = (y, z, Lg, r, n) => { const P = [], I = []; for (let k = 0; k <= 1; k++) for (let j = 0; j < n; j++) { const a = 2 * Math.PI * j / n; P.push(k * Lg, y + r * Math.cos(a), z + r * Math.sin(a)); } for (let j = 0; j < n; j++) { const b = (j + 1) % n; I.push(j, b, n + j, b, n + b, n + j); } return { vb: new Float32Array(P), vbstride: 3, ib: new Uint32Array(I) }; };
          // vidrio de 2 x 1,5 m en 40 x 30 cuadros, con sus dos caras (normales opuestas) sobre los mismos vertices
          const vid = (x0, n1, n2) => { const P = [], I = []; for (let i = 0; i <= n1; i++) for (let j = 0; j <= n2; j++) P.push(x0 + 2 * i / n1, 0, 1.5 * j / n2); for (let i = 0; i < n1; i++) for (let j = 0; j < n2; j++) { const a = i * (n2 + 1) + j, b = a + n2 + 1; I.push(a, b, a + 1, a + 1, b, b + 1, a, a + 1, b, a + 1, b + 1, b); } return { vb: new Float32Array(P), vbstride: 3, ib: new Uint32Array(I) }; };
          // letra «O»: un toro de 30 cm de radio y trazo de 2 cm, con 360 x 24 caras por vuelta
          const toro = (cx, R0, r0, n1, n2) => { const P = [], I = []; for (let i = 0; i < n1; i++) for (let j = 0; j < n2; j++) { const u = 2 * Math.PI * i / n1, v = 2 * Math.PI * j / n2; P.push(cx + (R0 + r0 * Math.cos(v)) * Math.cos(u), 10 + (R0 + r0 * Math.cos(v)) * Math.sin(u), r0 * Math.sin(v)); } for (let i = 0; i < n1; i++) for (let j = 0; j < n2; j++) { const a = i * n2 + j, b = ((i + 1) % n1) * n2 + j, c = i * n2 + (j + 1) % n2, d = ((i + 1) % n1) * n2 + (j + 1) % n2; I.push(a, b, c, c, b, d); } return { vb: new Float32Array(P), vbstride: 3, ib: new Uint32Array(I) }; };
          const gF = [], dF = [], mF = [], pF = new Map([[2, 1], [10, 2], [20, 2], [30, 2], [40, 2], [50, 2], [60, 2], [70, 2]]), mI = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
          const pon = (g, db, pa, M) => { gF.push(g); dF.push(db); pF.set(db, pa); mF.push(M || mI); };
          pon(esf(0, 0, 0, 5, 160), 100, 10);
          for (let k = 0; k < 1500; k++) pon(esf(10 + (k % 50) * 0.1, (k / 50 | 0) * 0.1, 0, 0.005, 6), 1000 + k, 20);
          for (let k = 0; k < 30; k++) pon(tub(20 + k, 0, 6, 0.05, 24), 5000 + k, 30);
          for (let k = 0; k < 60; k++) pon(tub(80, k * 0.2, 4, 0.01, 12), 7000 + k, 40);
          pon(vid(-20, 40, 30), 8000, 50);
          pon(toro(-30, 0.3, 0.02, 360, 24), 8100, 60);
          const aparato = esf(0, 0, 0, 0.25, 40);   // la misma malla en dos lugares (como un aparato sanitario repetido)
          pon(aparato, 8200, 70, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 40, 0, 0, 1]); pon(aparato, 8201, 70, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 45, 3, 0, 1]);
          const cajaDe = (f, Bx) => { const g = gF[f], M = mF[f], a = [1e9, 1e9, 1e9], b = [-1e9, -1e9, -1e9]; for (let i = 0; i < g.vb.length; i += 3) for (let j = 0; j < 3; j++) { const v = g.vb[i + j] + M[12 + j]; a[j] = Math.min(a[j], v); b[j] = Math.max(b[j], v); } Bx.min = { x: a[0], y: a[1], z: a[2] }; Bx.max = { x: b[0], y: b[1], z: b[2] }; };
          class B3 { constructor() { this.min = {}; this.max = {}; } }
          const mFed = { getFragmentList: () => ({ getCount: () => gF.length, fragments: { fragId2dbId: new Int32Array(dF) }, getGeometry: (f) => gF[f], getWorldMatrix: (f, m) => { m.elements = mF[f].slice(); }, getWorldBounds: (f, Bx) => cajaDe(f, Bx), getMaterial: (f) => dF[f] === 8000 ? { color: { r: 0.6, g: 0.8, b: 0.9 }, transparent: true, opacity: 0.3 } : { color: { r: 0.6, g: 0.6, b: 0.6 } } }), getUnitScale: () => 1, getUpVector: () => [0, 0, 1], getData: () => ({}) };
          const L3 = C.censa(mFed, { Matriz: M4, Caja: B3 }); C.censaTramo(L3, 0, 900); C.censaTramo(L3, 900, gF.length);
          const G3 = C.elementosDe(L3, (d) => [10, 20, 30, 40, 50, 60, 70].includes(d), (d) => pF.get(d)), ac = new Set([40]);
          const pl3 = C.planifica(L3, (f) => ac.has(G3.deFid[f]), { tope: 20000, topeSeguro: 10000000 }), K3 = pl3.cifras;
          const lista3 = C.ordena(L3, pl3, G3.elems), W3 = C.escritor(); C.arma(L3, pl3, lista3, W3, 0, 3); C.arma(L3, pl3, lista3, W3, 3, 99); const o3 = C.cierraEscritor(W3, [0, 0, 0], {});
          const b3 = Buffer.concat(o3.partes.map(x => Buffer.from(x.buffer ? new Uint8Array(x.buffer, x.byteOffset, x.byteLength) : x)));
          let lm3 = 36 + b3.readUInt32LE(32); lm3 += (4 - lm3 % 4) % 4; const f3 = []; for (let k = 0; k < o3.nElem; k++) f3.push([0, 1, 2, 3, 4].map(j => b3.readUInt32LE(lm3 + k * 24 + j * 4)));
          const p3 = lm3 + 24 * o3.nElem, i3 = p3 + 12 * o3.nVert; let fuera = 0; for (const [, , vc, io, ic] of f3) for (let q = 0; q < ic; q++) if (b3.readUInt32LE(i3 + (io + q) * 4) >= vc) fuera++;
          const verts = (e) => { const x = f3.find(z => z[0] === e), out = []; for (let q = 0; q < x[2]; q++) out.push([0, 1, 2].map(j => b3.readFloatLE(p3 + (x[1] + q) * 12 + j * 4))); return out; };
          const tris = (e) => f3.find(z => z[0] === e)[4] / 3;
          const vE = verts(10), errE = Math.max(...vE.map(([x, y, z]) => Math.abs(Math.hypot(x, y, z) - 5)));
          ok(L3.triEntrada > 60000 && K3.nAcero === 60 && K3.pasaDelTope && tris(10) < 51200 / 3 && errE <= 0.011, 'un federado que pasa del tope se aligera como el complemento de Navisworks: el acero va sin geometría y la esfera pesada pierde triángulos sin moverse más de 1 cm de su superficie ' + JSON.stringify({ e: L3.triEntrada, esfera: tris(10), err: +errE.toFixed(4), a: K3.nAcero }));
          ok(f3.map(x => x[0]).sort((a, b) => a - b).join() === '10,20,30,50,60,70' && tris(20) === 1500 * 72 && fuera === 0, 'lo liviano (los 1.500 tornillos de 72 triángulos) queda tal cual: nada se omite ni se cambia por su caja, y los índices quedan dentro de cada elemento');
          const vV = verts(50); let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, yM = 0; for (const [x, y, z] of vV) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); yM = Math.max(yM, Math.abs(y)); }
          let areaV = 0; { const x = f3.find(z => z[0] === 50); for (let q = 0; q < x[4]; q += 3) { const [a, b, c] = [0, 1, 2].map(k => verts(50)[b3.readUInt32LE(i3 + (x[3] + q + k) * 4)]); const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]; areaV += Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2; } }
          ok(Math.abs(x0 + 20) < 1e-3 && Math.abs(x1 + 18) < 1e-3 && Math.abs(z0) < 1e-3 && Math.abs(z1 - 1.5) < 1e-3 && yM < 1e-3 && Math.abs(areaV - 6) < 0.01, 'el vidrio de dos caras no se rompe en triángulos: conserva sus esquinas, su plano y sus dos caras enteras (' + tris(50) + ' de 4.800 triángulos, área ' + areaV.toFixed(3) + ' m² de 6)');
          const vO = verts(60), errO = Math.max(...vO.map(([x, y, z]) => Math.abs(Math.hypot(Math.hypot(x + 30, y - 10) - 0.3, z) - 0.02))), hueco = Math.min(...vO.map(([x, y]) => Math.hypot(x + 30, y - 10)));
          ok(tris(60) < 17280 && errO <= 0.011 && hueco > 0.25, 'la letra «O» fina se aligera sin deformarse: ningún punto se aleja más de 1 cm de su trazo y el hueco sigue abierto (' + tris(60) + ' de 17.280 triángulos, ' + (errO * 100).toFixed(2) + ' cm)');
          const vA = verts(70); let a40 = 0, a45 = 0; for (const [x, y, z] of vA) { if (Math.abs(Math.hypot(x - 40, y, z) - 0.25) < 0.011) a40++; if (Math.abs(Math.hypot(x - 45, y - 3, z) - 0.25) < 0.011) a45++; }
          ok(W3.reusadas === 1 && a40 > 20 && a40 === a45 && a40 + a45 === vA.length && tris(70) < 2 * 3200, 'una malla repetida se aligera una sola vez y se coloca en cada lugar con su matriz ' + JSON.stringify({ reusadas: W3.reusadas, a40, a45, tri: tris(70) }));
          const pl4 = C.planifica(L3, (f) => ac.has(G3.deFid[f]), { tope: 20000, topeSeguro: o3.nIdx / 3 - 1500 * 72 + 12 }), W4 = C.escritor(), lista4 = C.ordena(L3, pl4, G3.elems); C.mide(L3, pl4, lista4, W4, 0, 99); C.elige(pl4, lista4, W4); C.arma(L3, pl4, lista4, W4, 0, 99); const o4 = C.cierraEscritor(W4, [0, 0, 0], {});
          const k20 = W4.tabla.findIndex((x, k) => k % 6 === 0 && x === 20) / 6;
          ok(W4.enCaja === 1 && o4.nElem === 6 && W4.triEnCaja === 1500 * 72 && k20 >= 0 && W4.tabla[k20 * 6 + 4] === 36 && o4.nIdx / 3 <= pl4.op.topeSeguro, 'si el resultado pasara del límite del navegador, lo que no cabe (los 1.500 tornillos, 108.000 triángulos) va como su caja y todo lo demás completo: se ve y se filtra, nada se omite ni se deforma ' + JSON.stringify({ enCaja: W4.enCaja, elementos: o4.nElem, tri: o4.nIdx / 3, tope: pl4.op.topeSeguro }));
          // v0.13.8: las aristas precalculadas viajan en el .cdeg (seccion ARIS del complemento de Navisworks), como las lee el visor
          let oa = i3 + o3.nIdx * 4 + o3.nElem * 4 + o3.nVert * 3; oa += (4 - oa % 4) % 4;
          const tagA = b3.toString('latin1', oa, oa + 4), nPA = b3.readUInt32LE(oa + 4), tabA = [], relA = oa + 8 + o3.nElem * 8;
          for (let k = 0; k < o3.nElem; k++) tabA.push([b3.readUInt32LE(oa + 8 + k * 8), b3.readUInt32LE(oa + 12 + k * 8)]);
          const arE = (e) => tabA[f3.findIndex(z => z[0] === e)][1];
          let maxRel = 0; for (let k = 0; k < o3.nElem; k++) { const [a0, n] = tabA[k]; for (let q = a0 * 2; q < (a0 + n) * 2; q++) maxRel = Math.max(maxRel, b3.readUInt32LE(relA + q * 4) - f3[k][2] + 1); }
          ok(tagA === 'ARIS' && nPA === o3.nAristas && relA + nPA * 8 === b3.length && arE(50) === 140 && maxRel <= 0, 'el .cdeg lleva las aristas de cada elemento (sección ARIS, como el complemento): del vidrio de dos caras solo su contorno (140, no las de dentro de la lámina) y cada par dentro de su elemento ' + JSON.stringify({ tagA, nPA, vidrio: arE(50), letra: arE(60) }));
          const ca = C.aristasDe(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1]), [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7], 8);
          ok(ca.length / 2 === 12, 'una caja tiene sus 12 aristas (las diagonales de cada cara no se dibujan)');
          // v0.13.10: los dibujos en lineas (arbol CAD 3D con el color de cada linea) van en la seccion LINS; las auxiliares no
          const vbL = new Float32Array(4 * 4), u8L = new Uint8Array(vbL.buffer); [[0, 0, 0], [0, 0, 5], [0, 0, 5], [2, 0, 7]].forEach((p, k) => { vbL.set(p, k * 4); u8L.set([30, 140, 40, 255], k * 16 + 12); });
          const gL = [{ vb: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0]), vbstride: 3, ib: new Uint32Array([0, 1, 2]) }, { isLines: true, vb: vbL, vbstride: 4, vblayout: { position: { offset: 0 }, color: { offset: 3 } }, ib: new Uint16Array([0, 1, 2, 3]) }, { isLines: true, vb: new Float32Array([0, 0, 0, 9, 0, 0]), vbstride: 3, ib: new Uint16Array([0, 1]) }];
          const dL = [500, 510, 520], pL = new Map([[500, 50], [510, 51], [520, 52]]);
          const mL = { getFragmentList: () => ({ getCount: () => 3, fragments: { fragId2dbId: new Int32Array(dL) }, getGeometry: (f) => gL[f], getWorldMatrix: (f, m) => { m.elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }, getMaterial: (f) => ({ color: { r: 0.5, g: 0.5, b: 0.5 } }) }), getUnitScale: () => 1, getUpVector: () => [0, 0, 1], getData: () => ({}) };
          const LL = C.censa(mL, { Matriz: M4 }); C.censaTramo(LL, 0, 3);
          const GL = C.elementosDe(LL, (d) => [50, 51, 52].includes(d), (d) => pL.get(d)), plL = C.planifica(LL, null, {}), WL = C.escritor(); C.arma(LL, plL, GL.elems, WL, 0, 9);
          const LNL = C.armaLineas(LL, GL.lineas, WL, new Set([52])), oL = C.cierraEscritor(WL, [0, 0, 0], {});
          const bL = Buffer.concat(oL.partes.map(x => Buffer.from(x.buffer ? new Uint8Array(x.buffer, x.byteOffset, x.byteLength) : x)));
          let lmL = 36 + bL.readUInt32LE(32); lmL += (4 - lmL % 4) % 4; let ol = lmL + 24 * oL.nElem + 12 * oL.nVert + 4 * oL.nIdx + 4 * oL.nElem + 3 * oL.nVert; ol += (4 - ol % 4) % 4;
          const tagL = bL.toString('latin1', ol, ol + 4), nFL = bL.readUInt32LE(ol + 4), nSL = bL.readUInt32LE(ol + 8), eL = bL.readUInt32LE(ol + 12), segPos = ol + 12 + nFL * 16, colPos = segPos + nSL * 24;
          const zL1 = bL.readFloatLE(segPos + 20), col0 = [bL[colPos], bL[colPos + 1], bL[colPos + 2]].join();
          let ol2 = colPos + nSL * 3; ol2 += (4 - ol2 % 4) % 4;
          ok(tagL === 'LINS' && nFL === 1 && nSL === 2 && eL === 51 && Math.abs(zL1 - 5) < 1e-6 && col0 === '30,140,40' && LNL.aux === 1 && bL.toString('latin1', ol2, ol2 + 4) === 'ARIS' && GL.elems.length === 1, 'los dibujos en líneas (el árbol) van en la sección LINS con el color propio de cada línea; las del eje (auxiliar) no; y después siguen las aristas ' + JSON.stringify({ tagL, nFL, nSL, eL, col0, aux: LNL.aux }));
          // v0.13.12: asi trae el visor de Autodesk las lineas del BM de 100020: el color dentro del vb y descrito solo en
          // attributes.color, sin arreglo propio (antes: "Cannot read properties of undefined (reading 'length')")
          const lineasDe = (gs) => { const ms = { getFragmentList: () => ({ getCount: () => gs.length, fragments: { fragId2dbId: new Int32Array(gs.map((g, k) => 700 + k)) }, getGeometry: (f) => gs[f], getWorldMatrix: (f, m) => { m.elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }, getMaterial: () => ({ color: { r: 0.2, g: 0.6, b: 0.2 } }) }), getUnitScale: () => 1, getUpVector: () => [0, 0, 1], getData: () => ({}) };
            const Lx = C.censa(ms, { Matriz: M4 }); C.censaTramo(Lx, 0, gs.length); const Gx = C.elementosDe(Lx, (d) => d === 90, () => 90), Wx = C.escritor();
            const r = C.armaLineas(Lx, Gx.lineas, Wx, new Set()); return { nS: r.nS, col: Array.from(r.tc[0] || []).join() }; };
          const vbA = new Float32Array(2 * 4), u8A = new Uint8Array(vbA.buffer); vbA.set([0, 0, 0], 0); vbA.set([0, 0, 3], 4); u8A.set([110, 70, 30, 255], 12); u8A.set([110, 70, 30, 255], 28);
          let rA = null, eA = ''; try { rA = lineasDe([{ isLines: true, vb: vbA, vbstride: 4, ib: new Uint16Array([0, 1]), attributes: { position: { offset: 0, itemSize: 3, bytesPerItem: 4 }, color: { offset: 3, itemSize: 4, bytesPerItem: 1, normalized: true }, index: { array: new Uint16Array([0, 1]) } } }]); } catch (e) { eA = e.message; }
          ok(rA && rA.nS === 1 && rA.col === '110,70,30', 'líneas con el color dentro del vb y descrito solo en attributes.color (como el BM de 100020): se dibujan con su color, sin el error "reading length" ' + JSON.stringify(rA || eA));
          let rB = null, eB = ''; try { rB = lineasDe([{ isLines: true, vb: new Float32Array([0, 0, 0, 0, 0, 3]), vbstride: 3, ib: new Uint16Array([0, 1]), attributes: { position: { offset: 0, itemSize: 3 }, color: { itemSize: 4, get array() { throw new Error('ilegible'); } } } }]); } catch (e) { eB = e.message; }
          ok(rB && rB.nS === 1 && rB.col === '51,153,51', 'si el color de una línea no se puede leer, la línea igual se dibuja con el color de su material y el armado no se detiene ' + JSON.stringify(rB || eB));
          // v0.13.9: de lo que mas se ve a lo que menos (silueta), medir antes de decidir y saltar lo que no cabe; cajas orientadas
          const Ls = { caja: new Float32Array([0, 0, 0, 10, 0.05, 0.05,   0, 0, 0, 3, 0.1, 2.4,   0, 0, 0, 0.1, 0.1, 0.1]) }, pls = { modo: new Uint8Array([1, 1, 1]) };
          const ords = C.ordena(Ls, pls, [{ e: 1, fids: [0] }, { e: 2, fids: [1] }, { e: 3, fids: [2] }]).map(x => x.e);
          ok(ords.join() === '2,1,3', 'primero lo que más se ve: un panel del cerco de 3 x 2,4 m va antes que un tubo de 10 m y 5 cm, y la unión de 10 cm al final ' + ords.join());
          const Wd = { costo: new Float64Array([100, 5000, 50, 50]) }, dd = C.elige({ op: { topeSeguro: 300 }, modo: new Uint8Array([1, 1, 1, 1]) }, [0, 1, 2, 3].map(f => ({ e: f, fids: [f] })), Wd);
          ok([...dd].join() === '1,2,1,1', 'con el costo ya medido: si uno no cabe va como caja y los siguientes que sí caben van completos ' + [...dd].join());
          const tubo = []; for (let k = 0; k <= 20; k++) for (let j = 0; j < 12; j++) { const t = k / 20 * 7, a = 2 * Math.PI * j / 12; tubo.push(t + 0.05 * Math.cos(a) * 0.707, t - 0.05 * Math.cos(a) * 0.707, 0.05 * Math.sin(a)); }
          const ob = C.cajaOrientada([new Float32Array(tubo)]), dist = (i, j) => Math.hypot(ob[i * 3] - ob[j * 3], ob[i * 3 + 1] - ob[j * 3 + 1], ob[i * 3 + 2] - ob[j * 3 + 2]);
          const lados = [dist(0, 1), dist(0, 3), dist(0, 4)].sort((a, b) => b - a), vol = (P) => { let v = 0; const I = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]; for (let t = 0; t < 36; t += 3) { const [a, b, c] = [I[t], I[t + 1], I[t + 2]].map(k => [P[k * 3], P[k * 3 + 1], P[k * 3 + 2]]); v += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]); } return v / 6; };
          const vAA = vol([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1]);
          ok(Math.abs(lados[0] - 9.9) < 0.05 && lados[1] < 0.11 && lados[2] < 0.11 && Math.sign(vol(ob)) === Math.sign(vAA) && Math.abs(vol(ob)) < 0.11, 'un tubo en diagonal como caja queda como una barra delgada orientada (9,9 m x 10 cm x 10 cm, no una losa de 7 x 7 m), con las caras hacia afuera ' + JSON.stringify(lados.map(x => +x.toFixed(3))));
          const pl6 = C.planifica(L3, (f) => ac.has(G3.deFid[f]), { tope: 20000, topeSeguro: 15000 }), W6 = C.escritor(), lista6 = C.ordena(L3, pl6, G3.elems);
          C.mide(L3, pl6, lista6, W6, 0, 99); const d6 = C.elige(pl6, lista6, W6); C.arma(L3, pl6, lista6, W6, 0, 99); const o6 = C.cierraEscritor(W6, [0, 0, 0], {});
          let med6 = 0; for (let k = 0; k < d6.length; k++) med6 += d6[k] === 1 ? W6.costo[k] : d6[k] === 2 ? 12 : 0;
          ok(o6.nElem === 6 && o6.nIdx / 3 <= 15000 && o6.nIdx / 3 === med6 && W6.enCaja === [...d6].filter(x => x === 2).length && W6.enCaja >= 1, 'medido, elegido y escrito: todos los elementos están, no se pasa del límite y lo escrito es exactamente lo medido ' + JSON.stringify({ elementos: o6.nElem, tri: o6.nIdx / 3, medido: med6, enCaja: W6.enCaja }));
          const pl5 = C.planifica(L3, null, { tope: 1e9 }); ok(!pl5.cifras.pasaDelTope && pl5.cifras.nAligeradas === 1, 'si el modelo cabe en el tope, solo se aligera lo que pasa de 20.000 triángulos por pieza (la esfera), como el complemento');
        }
        {   // v0.13.7 — la regla de elemento de Navisworks en el índice de un NWD de Forma (lib/arbol-navisworks.js)
          const A = require('../lib/arbol-navisworks'), X = require('../compartido-visor/extractor-modelos'), { DatabaseSync } = require('node:sqlite');
          const rutaI = require('path').join(require('os').tmpdir(), 'cde-arbol-' + Date.now() + '.sqlite');
          const crea = (conIconos) => { const ixx = new X.Indice(rutaI); ixx.db.exec('COMMIT'); const db = ixx.db;
            const at = [[1, 'Item', 'Icon'], [2, 'Componente', 'Categoría'], [3, 'Componente', 'Familia'], [4, 'Componente', 'Tipo'], [5, 'Componente', 'Nivel'], [6, 'Nivel', 'Categoría'], [7, 'Tipo', 'Categoría'], [8, 'Tipo', 'Nombre'], [9, 'Item', 'Source File']];
            for (const [i, g, n] of at) if (conIconos || i !== 1) db.prepare('INSERT INTO attr VALUES (?,?,?,?)').run(i, n + ' [' + g + ']', g, n);
            const V = new Map(), val = (v) => { if (!V.has(v)) { V.set(v, V.size + 1); db.prepare('INSERT INTO val VALUES (?,?)').run(V.get(v), v); } return V.get(v); };
            const pon = (e, a, v) => { if (a === 1 && !conIconos) return; db.prepare('INSERT OR IGNORE INTO eav VALUES (?,?,?)').run(a, e, val(v)); };
            const el = (e, nombre, clase, anc, cat, fam, tip) => db.prepare('INSERT INTO elem VALUES (?,?,?,?,?,?,?,?,?)').run(e, nombre, 'AR.rvt', cat || '(sin categoria)', fam || '(sin familia)', tip || '(sin tipo)', '(sin nivel)', clase, anc);
            // el arbol de un NWC de Revit en Navisworks: archivo > nivel > categoria > familia > TIPO (coleccion con la pestana Tipo) > instancias > geometrias
            for (const [e, n, ic] of [[1, 'H.nwd', 'File'], [2, 'AR.nwc', 'File'], [3, 'Primer Nivel', 'Layer'], [4, 'Suelos', 'Collection'], [5, 'Suelo', 'Collection'], [12, 'Muros', 'Collection'], [13, 'Muro básico', 'Collection'], [17, 'Eje', 'Collection']]) { el(e, n, 0, 0); pon(e, 1, ic); }
            el(6, 'PIS_01', 1, 0, 'Suelos', 'Suelo', 'Suelo'); pon(6, 1, 'Collection'); pon(6, 7, 'Suelos'); pon(6, 8, 'PIS_01');
            el(14, 'TAB_13', 1, 0, 'Muros', 'Muro básico', 'Muro básico'); pon(14, 1, 'Collection'); pon(14, 7, 'Muros'); pon(14, 8, 'TAB_13');
            for (const e of [7, 8]) { el(e, 'Suelo', 2, 6, 'Suelos', 'Suelo', 'Suelo'); pon(e, 1, 'Composite Object'); pon(e, 2, 'Suelos'); pon(e, 3, 'Suelo'); pon(e, 4, 'PIS_01'); pon(e, 5, 'Primer Nivel'); pon(e, 6, 'Niveles'); pon(e, 9, 'AR.rvt'); }
            for (const e of [9, 10, 11]) { el(e, 'MAT//X', 2, 6, 'Suelos', 'Suelo', 'Suelo'); pon(e, 1, 'Geometry'); }
            el(15, 'Muro básico', 2, 14, 'Muros', 'Muro básico', 'Muro básico'); pon(15, 1, 'Composite Object'); pon(15, 2, 'Muros'); pon(15, 3, 'Muro básico'); pon(15, 4, 'TAB_13'); pon(15, 6, 'Niveles');
            el(16, 'Sólido', 2, 14, 'Muros', 'Muro básico', 'Muro básico'); pon(16, 1, 'Geometry');
            el(18, 'Eje', 1, 0, 'Eje', '(sin familia)', '(sin tipo)'); pon(18, 1, 'Composite Object'); pon(18, 2, 'Eje');
            el(19, 'Sólido', 2, 18, 'Eje', '(sin familia)', '(sin tipo)'); pon(19, 1, 'Geometry');
            db.close(); };
          const padre = new Int32Array(20); for (const [h, p] of [[2, 1], [3, 2], [4, 3], [5, 4], [6, 5], [7, 6], [8, 6], [9, 7], [10, 7], [11, 8], [12, 3], [13, 12], [14, 13], [15, 14], [16, 15], [17, 3], [18, 17], [19, 18]]) padre[h] = p;
          crea(true); let db = new DatabaseSync(rutaI); const r1 = A.reclasifica(db, padre);
          const fila = (e) => db.prepare('SELECT clase, anc, cat, fam, tip, niv, modelo FROM elem WHERE e = ?').get(e), els = db.prepare('SELECT e FROM elem WHERE clase = 1 ORDER BY e').all().map(x => Number(x.e));
          ok(r1.aplicado && els.join() === '7,8,15,18' && r1.elementos === 4 && r1.antes === 3 && r1.promovidos === 3 && r1.degradados === 2, 'en un NWD de Revit, el TIPO (colección de Navisworks) deja de ser elemento y cada instancia (el «primer objeto») pasa a serlo, como en el complemento de Navisworks ' + JSON.stringify({ els, r: { e: r1.elementos, a: r1.antes, p: r1.promovidos, d: r1.degradados } }));
          const f7 = fila(7), f9 = fila(9), f6 = fila(6), f19 = fila(19), f18 = fila(18);
          ok(f7.cat === 'Suelos' && f7.fam === 'Suelo' && f7.tip === 'PIS_01' && f7.niv === 'Primer Nivel' && f7.anc === 0 && f9.clase === 2 && f9.anc === 7 && f9.tip === 'PIS_01' && f6.clase === 0, 'la instancia se clasifica con el extractor (Suelos · Suelo · PIS_01 · Primer Nivel, no «Niveles» de la pestaña del nivel) y sus geometrías son sus partes ' + JSON.stringify({ f7, f9 }));
          ok(f18.clase === 1 && f18.cat === 'Eje' && f19.anc === 18, 'lo que ya era elemento (un objeto compuesto bajo una colección) queda igual');
          const r2 = A.reclasifica(db, padre); db.close(); ok(r2.ya && r2.elementos === 4, 'el índice queda marcado: una segunda vez no hace nada');
          crea(true); db = new DatabaseSync(rutaI); const mal = padre.slice(); for (const h of [9, 10, 11, 16, 19]) mal[h] = 3; let eMal = null; try { A.reclasifica(db, mal); } catch (e) { eMal = e; }
          const intacto = db.prepare('SELECT COUNT(*) AS n FROM elem WHERE clase = 1').get().n; db.close();
          ok(eMal && /no corresponde/.test(eMal.message) && intacto === 3, 'si el árbol del navegador no corresponde al índice (las partes no cuelgan de su elemento), no se toca nada');
          crea(false); db = new DatabaseSync(rutaI); const r3 = A.reclasifica(db, padre); db.close(); ok(!r3.aplicado && r3.motivo === 'sin-iconos' && r3.elementos === 3, 'un modelo que no es de Navisworks (sin «Item / Icon») queda como estaba');
          // v0.13.8: solo cuenta lo que tiene geometria solida; el eje (la linea de centro de un modelo MEP) es solo una linea
          const malla = new Uint8Array(20); for (const e of [9, 10, 11, 16]) malla[e] = 1;
          crea(true); db = new DatabaseSync(rutaI); const r4 = A.reclasifica(db, padre, null, malla);
          const els4 = db.prepare('SELECT e FROM elem WHERE clase = 1 ORDER BY e').all().map(x => Number(x.e)), f18b = db.prepare('SELECT clase, anc FROM elem WHERE e = 18').get(), f19b = db.prepare('SELECT clase, anc FROM elem WHERE e = 19').get(); db.close();
          ok(r4.aplicado && els4.join() === '7,8,15' && r4.sinMalla === 1 && f18b.clase === 0 && f19b.clase === 0 && f19b.anc === 0, 'el eje que solo es una línea (sin geometría sólida) deja de contar como elemento, y su pieza tampoco; los muros y losas siguen ' + JSON.stringify({ els4, sinMalla: r4.sinMalla }));
          // v0.13.10: unas lineas tambien hacen elemento si no son auxiliares (un arbol CAD 3D si; el eje no)
          crea(true); db = new DatabaseSync(rutaI);
          for (const [e, nom, ic, cat, clase] of [[20, 'Vegetación', 'Collection', '(sin categoria)', 0], [21, 'Árbol RPC', 'Composite Object', 'Vegetación', 0], [22, 'Línea', 'Geometry', 'Vegetación', 0]]) {
            db.prepare('INSERT INTO elem VALUES (?,?,?,?,?,?,?,?,?)').run(e, nom, 'AR.rvt', cat, '(sin familia)', '(sin tipo)', '(sin nivel)', clase, 0);
            const vi = db.prepare('SELECT id FROM val WHERE v = ?').get(ic).id; db.prepare('INSERT INTO eav VALUES (1, ?, ?)').run(e, vi); }
          const padre5 = new Int32Array(23); padre5.set(padre); padre5[20] = 3; padre5[21] = 20; padre5[22] = 21;
          const malla5 = new Uint8Array(23); for (const e of [9, 10, 11, 16]) malla5[e] = 1; malla5[19] = 2; malla5[22] = 2;
          const r5 = A.reclasifica(db, padre5, null, malla5), els5 = db.prepare('SELECT e FROM elem WHERE clase = 1 ORDER BY e').all().map(x => Number(x.e)), f22 = db.prepare('SELECT clase, anc FROM elem WHERE e = 22').get(); db.close();
          ok(els5.join() === '7,8,15,21' && r5.deLineas === 1 && r5.sinMalla === 1 && f22.clase === 2 && f22.anc === 21, 'un árbol dibujado solo con líneas (vegetación) es elemento; el eje, que también es solo una línea, no (líneas auxiliares, como en el complemento) ' + JSON.stringify({ els5, deLineas: r5.deLineas }));
          ok(A.lineaAuxiliar('Eje') && A.lineaAuxiliar('Rejillas de ejes') && A.lineaAuxiliar('') && A.lineaAuxiliar('Líneas') && !A.lineaAuxiliar('Vegetación') && !A.lineaAuxiliar('Señalización'), 'las categorías auxiliares son las del complemento de Navisworks (ejes, rejillas, líneas de centro, analíticas, contornos)');
          const bufA = Buffer.alloc(8 + 20 * 5); bufA.write('CDA2', 0, 'latin1'); bufA.writeUInt32LE(20, 4); for (let k = 0; k < 20; k++) bufA.writeInt32LE(padre[k], 8 + k * 4); for (let k = 0; k < 20; k++) bufA[8 + 80 + k] = malla[k];
          const la = A.leeArbol(bufA), lv = A.leeArbol(Buffer.from(padre.buffer)); let lmal = null; try { A.leeArbol(bufA.subarray(0, 50)); } catch (e) { lmal = e; }
          ok(la.padre[19] === 18 && la.malla[16] === 1 && la.malla[19] === 0 && lv.padre[7] === 6 && lv.malla === null && lmal, 'el árbol del navegador se lee con su geometría (formato CDA2), también sin ella (v0.13.7), y uno cortado se rechaza');
          try { require('fs').unlinkSync(rutaI); } catch (e) {}
        }
        const geoInfo = { elementos: out.nElem, triangulos: out.nIdx / 3, avisos: ['1 pieza(s) sin malla en la traducción'] };
        let rg = await fetch(B + F + '/modelos/' + mM.vid + '/geometria', { method: 'POST', headers: { cookie: galleta, 'content-type': 'application/octet-stream', 'x-cde-geometria': encodeURIComponent(JSON.stringify(geoInfo)) }, body: Buffer.from('XXXX' + 'basura') }); ok(rg.status === 400, 'una geometría sin la firma CDEG se rechaza');
        rg = await fetch(B + F + '/modelos/' + mM.vid + '/geometria', { method: 'POST', headers: { cookie: galleta, 'content-type': 'application/octet-stream', 'x-cde-geometria': encodeURIComponent(JSON.stringify(geoInfo)) }, body: buf }); const jg = await rg.json();
        ok(rg.status === 200 && jg.bytes === buf.length && jg.trabajo.instalado, 'la geometría llega al CDE y, con el índice listo, el modelo queda instalado ' + JSON.stringify(jg).slice(0, 200));
        r = await pide('/api/modelos/' + pd + '/' + mM.vid + '/estado'); ok(r.j.estado === 'listo' && r.j.geometria, 'el NWD de Forma ya está LISTO para el visor del CDE, con geometría ' + JSON.stringify(r.j).slice(0, 200));
        r = await pide('/api/modelos/' + pd + '/' + mM.vid + '/elementos'); ok(JSON.stringify(r.j.columnas.e) === '[3,6]' && r.j.columnas.nombre.join() === 'Muro básico,Puerta simple', 'el visor del CDE lista los elementos del modelo (los mismos ids que la geometría)');
        r = await pide('/api/modelos/' + pd + '/' + mM.vid + '/elemento/3'); ok(r.j.propiedades.some(([n, v]) => n === 'Área' && v === '12.5 m²') && r.j.propiedades.some(([n, v]) => n === 'Familia' && v === 'Muro básico'), 'al hacer clic en el muro se ven sus parámetros de la base de propiedades de Autodesk ' + JSON.stringify(r.j.propiedades));
        rt = await fetch(B + '/api/modelos/' + pd + '/' + mM.vid + '/geometria', { headers: { cookie: galleta } }); const bg = Buffer.from(await rt.arrayBuffer()); ok(rt.status === 200 && bg.equals(buf), 'el visor del CDE baja la geometría tal cual se armó');
        r = await pide('/api/modelos/' + pd + '/lista'); const enLista = r.j.modelos.find(x => x.vid === mM.vid); ok(enLista && enLista.indice.estado === 'listo' && enLista.indice.geometria && enLista.indice.elementos === 2, 'el modelo aparece listo en la lista del visor del CDE ' + JSON.stringify(enLista && enLista.indice));
        ok(enLista.origen === 'forma', 'la lista del visor dice que el modelo vino de Forma (así el visor lo prepara solo al abrirlo)');
        rt = await fetch(B + '/forma-paso.html?pid=' + pd + '&vid=' + mM.vid); const hp = await rt.text(); rt = await fetch(B + '/js/forma-paso.js'); const jp = await rt.text();
        ok(/forma-paso\.js/.test(hp) && /cdeg\.js/.test(hp) && /cdePaso/.test(jp) && /elementos-indice/.test(jp), 'la página que prepara un modelo de Forma (para incrustar en el visor y en el portal) se sirve con sus scripts');
        const fIx = require('../lib/bd').q.uno('SELECT resumen, error FROM indices_modelo WHERE version_id = ?', mM.vid), rsM = JSON.parse(fIx.resumen);
        ok(rsM.origen === 'Traducción de Autodesk Forma' && rsM.elementosConGeometria === 2 && /sin malla/.test(fIx.error), 'el resumen dice de dónde salió el modelo y guarda los avisos (piezas sin malla)');
        r = await pide(F + '/modelos?enlace=' + eM); ok(r.j.modelos[0].enVisor === true, 'la lista de modelos de Forma lo marca «En el visor»');
        r = await pide(F + '/enlaces'); ok(r.j.enlaces.find(z => z.id === eM).enVisor === 1, 'la fila del enlace cuenta 1 modelo en el visor');
        {   // v0.13.6: los ids del visor de Autodesk (SVF2) no son los de la base de propiedades (SVF): se comprueban con los nombres
          const p0 = MDX.pedidos.length; r = await pide(F + '/modelos/' + mM.vid + '/preparar', { json: {} });
          let tI = null; for (let i = 0; i < 100; i++) { tI = (await pide(F + '/modelos/' + mM.vid + '/estado')).j.trabajo; if (tI && tI.indice.estado !== 'leyendo') break; await duerme(50); }
          ok(tI && tI.indice.estado === 'listo' && MDX.pedidos.length === p0 && /ya tenía/.test(tI.indice.texto), 'rehacer un modelo ya instalado desde Forma reutiliza su índice (una copia, sin volver a pedir la base de propiedades a Autodesk) ' + JSON.stringify(tI && tI.indice).slice(0, 160));
          r = await pide(F + '/modelos/' + mM.vid + '/valida-ids', { json: { pares: [[3, 'Muro básico'], [6, 'Puerta simple [123456]'], [4, 'Solid'], [7, 'Solid']] } });
          const rMal = await pide(F + '/modelos/' + mM.vid + '/valida-ids', { json: { pares: [[3, 'Puerta simple'], [6, 'Muro básico'], [4, 'Nivel 1'], [99, 'Solid']] } });
          ok(r.j.total === 4 && r.j.coinciden === 4 && rMal.j.coinciden === 0 && rMal.j.ejemplos.length === 4, 'la comprobación de ids compara los nombres de una muestra con el índice (con o sin el sufijo [id] del visor) y detecta ids cruzados');
          // v0.13.7: el navegador entrega el árbol entero y el CDE ordena el índice como Navisworks (en un hilo)
          const arb = new Int32Array(8); for (const [h, p] of [[2, 1], [3, 2], [4, 3], [5, 3], [6, 2], [7, 6]]) arb[h] = p;
          const cabA = Buffer.alloc(8); cabA.write('CDA2', 0, 'latin1'); cabA.writeUInt32LE(8, 4); const mA = Buffer.from([0, 0, 0, 0, 1, 1, 0, 1]);
          const ra = await fetch(B + F + '/modelos/' + mM.vid + '/arbol', { method: 'POST', headers: { cookie: galleta, 'content-type': 'application/octet-stream' }, body: Buffer.concat([cabA, Buffer.from(arb.buffer), mA]) });
          let tA = null; for (let i = 0; i < 100; i++) { tA = (await pide(F + '/modelos/' + mM.vid + '/estado')).j.trabajo; if (tA && tA.arbol && tA.arbol.estado !== 'va') break; await duerme(50); }
          ok(ra.status === 200 && tA.arbol.estado === 'listo' && tA.arbol.r.aplicado && tA.arbol.r.elementos === 2 && tA.arbol.r.promovidos === 0 && tA.arbol.r.conMalla === 3 && tA.indice.resumen.arbol === 'navisworks-3', 'el árbol del navegador llega al CDE y el índice se ordena como Navisworks (el muro y la puerta, objetos compuestos bajo la capa, siguen siendo los elementos) ' + JSON.stringify(tA && tA.arbol).slice(0, 220));
          const rb = await fetch(B + F + '/modelos/' + mM.vid + '/arbol', { method: 'POST', headers: { cookie: galleta, 'content-type': 'application/octet-stream' }, body: Buffer.from('abc') });
          const bitA = require('fs').readFileSync(require('path').join(process.env.DATOS_DIR, 'forma-visor.log'), 'utf8').trim().split('\n').map(x => JSON.parse(x)).filter(x => x.vid === mM.vid);
          ok(rb.status === 400 && bitA.some(x => x.evento === 'arbol' && x.r && x.r.aplicado) && bitA.some(x => x.evento === 'arbol-recibido' && x.bytes === 8 + 8 * 5), 'un árbol incompleto se rechaza y la bitácora guarda cómo quedó el índice');
          await pide(F + '/modelos/' + mM.vid + '/cancelar', { json: { borrar: true } });
        }
        // rehacer y cancelar: el modelo instalado se queda
        r = await pide(F + '/modelos/' + mM.vid + '/preparar', { json: {} }); r = await pide(F + '/modelos/' + mM.vid + '/cancelar', { json: {} }); const tras = (await pide(F + '/modelos/' + mM.vid + '/estado')).j;
        ok(r.j.ok && tras.trabajo === null && tras.enVisor === true, 'cancelar un «Rehacer» no quita el modelo ya instalado');
        rg = await fetch(B + F + '/modelos/' + mM.vid + '/geometria', { method: 'POST', headers: { cookie: galleta, 'content-type': 'application/octet-stream' }, body: buf }); ok(rg.status === 409, 'sin preparar, la geometría no se acepta');
        {   // si el navegador falla despues del indice, el siguiente intento no vuelve a esperarlo (en un federado son 16 minutos)
          const pedidos0 = MDX.pedidos.length;
          r = await pide(F + '/modelos/' + mM.vid + '/preparar', { json: { rehacer: true } });
          for (let i = 0; i < 100; i++) { const t = (await pide(F + '/modelos/' + mM.vid + '/estado')).j.trabajo; if (t && t.indice.estado !== 'leyendo') break; await duerme(100); }
          await pide(F + '/modelos/' + mM.vid + '/cancelar', { json: { motivo: 'Array buffer allocation failed', paso: 'escribir', datos: { triangulos: 694116430 } } });
          const dirI = require('path').join(process.env.DATOS_DIR, 'indices'), conserva = require('fs').existsSync(require('path').join(dirI, mM.vid + '.forma.sqlite')) && require('fs').existsSync(require('path').join(dirI, mM.vid + '.forma.json'));
          const pedidos1 = MDX.pedidos.length; r = await pide(F + '/modelos/' + mM.vid + '/preparar', { json: {} });
          ok(conserva && r.j.trabajo.indice.estado === 'listo' && MDX.pedidos.length === pedidos1 && pedidos1 > pedidos0, 'el índice terminado se conserva al cancelar y el siguiente intento lo reutiliza al instante (sin volver a pedir la base de propiedades)');
          const bit = require('fs').readFileSync(require('path').join(process.env.DATOS_DIR, 'forma-visor.log'), 'utf8').trim().split('\n').map(x => JSON.parse(x)).filter(x => x.vid === mM.vid);
          const cancelo = bit.find(x => x.evento === 'cancelar' && x.motivo === 'Array buffer allocation failed'), audE = require('../lib/bd').q.uno("SELECT detalle FROM auditoria WHERE accion = 'forma.modelo.error' ORDER BY rowid DESC LIMIT 1");
          ok(cancelo && cancelo.paso === 'escribir' && cancelo.datos.triangulos === 694116430 && bit.some(x => x.evento === 'indice-reutilizado') && bit.some(x => x.evento === 'instalado') && audE && /allocation/.test(audE.detalle), 'la bitácora (DATOS/forma-visor.log) guarda cada paso y el error del navegador con su paso y sus cifras; el error también va a la auditoría');
          await pide(F + '/modelos/' + mM.vid + '/cancelar', { json: { borrar: true } });
          ok(!require('fs').existsSync(require('path').join(dirI, mM.vid + '.forma.sqlite')) && !require('fs').existsSync(require('path').join(dirI, mM.vid + '.forma.json')), 'cancelar con «borrar» quita el índice guardado');
        }
        // la biblioteca del visor de Autodesk, servida por el CDE (cache en disco; a los hilos se les antepone el arreglo de WebSocket)
        const antes = MDX.lmv; let rl = await fetch(B + '/lmv/7.*/viewer3D.min.js'); const tl = await rl.text();
        let rw = await fetch(B + '/lmv/7.*/lmvworker.min.js'); const tw = await rw.text(); await duerme(150);
        ok(rl.status === 200 && /^\/\*lmv viewer3D\.min\.js/.test(tl) && /javascript/.test(rl.headers.get('content-type')) && rw.status === 200 && tw.startsWith('/*CDE-WS*/') && /lmv lmvworker/.test(tw), 'el CDE sirve la biblioteca del visor de Autodesk, y a sus hilos les antepone el arreglo de WebSocket');
        rl = await fetch(B + '/lmv/7.*/viewer3D.min.js'); await rl.text(); ok(MDX.lmv === antes + 2, 'la segunda vez sale del caché del CDE (no se vuelve a pedir a Autodesk)');
        rl = await fetch(B + '/lmv/9.1/x.js'); const rl2 = await fetch(B + '/lmv/7.*/..%2F..%2Fsecreto'); const rl3 = await fetch(B + '/lmv/7.*/no-existe.js');
        ok(rl.status === 400 && rl2.status === 400 && rl3.status === 404, 'la ruta de la biblioteca solo acepta versiones 7.x, rechaza rutas con «..» y pasa los 404 de Autodesk');
        r = await pide(F + '/enlaces/' + eM, { method: 'DELETE' });
      }
      r = await pide(F + '/enlaces/' + eF, { method: 'PUT', json: { automatico: true } }); r = await pide(F + '/enlaces'); ok(r.j.enlaces[0].automatico === true, 'el enlace se puede dejar en sincronización automática');
      r = await pide(F + '/enlaces/' + eF, { method: 'DELETE' }); r = await pide(F + '/enlaces'); const r5 = await pide('/api/proyectos/' + pd + '/contenedores/' + itA[0].contenedor_id); ok(r.j.enlaces.length === 0 && r5.status === 200, 'quitar el enlace no borra lo ya traído');
      r = await pide('/api/forma/desconectar', { json: {} }); r = await pide('/api/forma/hubs'); ok(r.status === 409, 'al desconectar la cuenta se deja de poder leer Forma');
      r = await fetch(B + '/api/forma/webhook', { method: 'POST', body: '{}' }); ok(r.status === 503, 'el aviso de Autodesk se rechaza si no hay secreto para comprobar la firma');
      delete process.env.FORMA_APS_PRUEBA; delete process.env.APS_CLIENT_ID; delete process.env.APS_CLIENT_SECRET; falsa.close();
    }

    console.log('24. Conector Oracle Aconex: conectar, traer documentos del registro, correo y registro cruzado con el CDE, importar Excel');
    {
      const pedidos = []; let fichasA = 0;
      const jwt = (o) => 'e30.' + Buffer.from(JSON.stringify(o)).toString('base64url') + '.firma';
      const DOC = (id, num, rev, tit, arch) => '<Document DocumentId="' + id + '"><DocumentNumber>' + num + '</DocumentNumber><Revision>' + rev + '</Revision><Title>' + tit + '</Title><Filename>' + arch + '</Filename><FileSize>' + (arch ? 30 : 0) + '</FileSize><DocumentStatus>For Construction</DocumentStatus><DocumentType>Plano</DocumentType><Discipline>Arquitectura</Discipline><DateModified>2026-11-0' + (id % 9 || 1) + 'T10:00:00.000Z</DateModified></Document>';
      const MAIL = (id, no, asunto, tipo, de, org, f) => '<Mail MailId="' + id + '"><MailNo>' + no + '</MailNo><Subject>' + asunto + '</Subject><CorrespondenceType>' + tipo + '</CorrespondenceType><FromUserDetails><Name>' + de + '</Name><OrganizationName>' + org + '</OrganizationName></FromUserDetails><ToUsers><Recipient><Name>Erick Torres</Name><OrganizationName>ANIN</OrganizationName></Recipient></ToUsers><SentDate>' + f + 'T10:00:00.000Z</SentDate><ResponseDate>2026-11-09T00:00:00.000Z</ResponseDate><Status>Open</Status><AllAttachmentCount>1</AllAttachmentCount></Mail>';
      const oracle = require('http').createServer((q2, s2) => {
        const u = new URL(q2.url, 'http://x'), ruta = decodeURIComponent(u.pathname), X = (t, st) => { s2.writeHead(st || 200, { 'content-type': 'application/xml' }); s2.end(t); }, J2 = (o, st) => { s2.writeHead(st || 200, { 'content-type': 'application/json' }); s2.end(JSON.stringify(o)); };
        pedidos.push(q2.method + ' ' + ruta + u.search);
        if (ruta === '/auth/token') { let c = ''; q2.on('data', d => c += d); q2.on('end', () => { const b = new URLSearchParams(c); fichasA++; if ((q2.headers.authorization || '') !== 'Basic ' + Buffer.from('acx-id-prueba:acx-secreto').toString('base64')) return J2({ error: 'invalid_client' }, 401);
          if (b.get('grant_type') === 'authorization_code') return b.get('code') === 'codigo-acx' ? J2({ access_token: jwt({ user_name: 'erick.acx', name: 'Erick Aconex', user_id: '77' }), refresh_token: 'RA' + fichasA, expires_in: 3600 }) : J2({ error: 'invalid_grant' }, 400);
          return J2({ access_token: jwt({ user_name: 'erick.acx' }), refresh_token: 'RA' + fichasA, expires_in: 3600 }); }); return; }
        if (!/^Bearer e30\./.test(q2.headers.authorization || '')) return X('<Error><ErrorDescription>sin ficha</ErrorDescription></Error>', 401);
        if (ruta === '/api/projects') return X('<ProjectResults><SearchResults><Project><ProjectId>111</ProjectId><ProjectName>Hospital La Esperanza (ECC)</ProjectName><ProjectShortName>HLE</ProjectShortName></Project><Project><ProjectId>222</ProjectId><ProjectName>Centro de Salud Sechura</ProjectName></Project></SearchResults></ProjectResults>');
        if (ruta === '/api/projects/111/register') {
          const hist = u.searchParams.get('show_document_history') === 'true', filtro = u.searchParams.get('search_query') || '', pag = u.searchParams.get('page_number') || '1';
          if (filtro) return X('<RegisterSearch TotalResults="1" TotalPages="1" CurrentPage="1"><SearchResults>' + DOC(2001, 'ACX-MEM-01', 'A', 'Memoria descriptiva', 'memoria.pdf') + '</SearchResults></RegisterSearch>');
          if (pag === '2') return X('<RegisterSearch TotalResults="3" TotalPages="2" CurrentPage="2"><SearchResults>' + DOC(3001, 'ACX-PH-01', 'A', 'Marcador', '') + '</SearchResults></RegisterSearch>');
          return X('<RegisterSearch TotalResults="3" TotalPages="2" CurrentPage="1"><SearchResults>' + (hist ? DOC(1000, '100017-ANI-ZZ-XX-DR-A-0101', 'R00', 'Planta general', 'planta.pdf') : '') + DOC(1001, '100017-ANI-ZZ-XX-DR-A-0101', 'R01', 'Planta general', 'planta.pdf') + DOC(2001, 'ACX-MEM-01', 'A', 'Memoria descriptiva', 'memoria.pdf') + '</SearchResults></RegisterSearch>');
        }
        let m = /^\/api\/projects\/111\/register\/(\d+)$/.exec(ruta); if (m) { s2.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="x.pdf"' }); return s2.end('contenido del documento ' + m[1]); }
        if (ruta === '/api/projects/111/mail') {
          if (q2.headers.accept !== 'application/vnd.aconex.mail.v2+xml') return X('<Error/>', 406);
          const bx = u.searchParams.get('mail_box');
          return X('<MailSearch TotalResults="2" TotalPages="1" CurrentPage="1"><SearchResults>' + (bx === 'inbox' ? MAIL(9001, 'GHE-RFI-000001', 'Consulta sobre espesor de losa', '(ECC) RFI', 'Juan Perez', 'GHEMET', '2026-11-02') + MAIL(9002, 'GHE-AT-000002', 'Alerta temprana: lluvias', '(ECC) Alerta temprana', 'Ana Ruiz', 'GHEMET', '2026-11-03')
            : MAIL(9003, 'ANIN-TRANS-000003', 'Remisión de observaciones', 'Transmittal', 'Erick Torres', 'ANIN', '2026-11-04') + MAIL(9002, 'GHE-AT-000002', 'Alerta temprana: lluvias', '(ECC) Alerta temprana', 'Ana Ruiz', 'GHEMET', '2026-11-03')) + '</SearchResults></MailSearch>');
        }
        if (ruta === '/api/projects/111/mail/9001') return X('<Mail MailId="9001"><MailData><![CDATA[<p>Estimado:</p><p>Se solicita aclarar el espesor de la losa del nivel 2.</p>]]></MailData><ResponseRequired><ResponseRequiredDate>2026-11-10T00:00:00.000Z</ResponseRequiredDate></ResponseRequired><Attachments><RegisteredDocumentAttachment AttachmentId="5001"><FileName>croquis.pdf</FileName><FileSize>1200</FileSize></RegisteredDocumentAttachment></Attachments></Mail>');
        X('<Error/>', 404);
      });
      await new Promise(ok2 => oracle.listen(0, '127.0.0.1', ok2));
      const A = '/api/proyectos/' + pd + '/aconex';
      r = await pide('/api/aconex/estado'); ok(r.status === 200 && r.j.configurado === false && /\/api\/aconex\/vuelta$/.test(r.j.retorno), 'sin credenciales de Oracle el conector de Aconex se declara sin configurar y dice su dirección de retorno');
      Object.assign(process.env, { ACONEX_PRUEBA: 'http://127.0.0.1:' + oracle.address().port, ACONEX_CLIENT_ID: 'acx-id-prueba', ACONEX_CLIENT_SECRET: 'acx-secreto' });
      r = await pide('/api/aconex/proyectos'); ok(r.status === 409 && r.j.error === 'aconex-sin-conexion', 'sin conectar la cuenta no se lee Aconex');
      r = await pide('/api/aconex/diagnostico'); ok(r.j.credenciales === true && r.j.app === 'ueba' && !JSON.stringify(r.j).includes('acx-secreto'), 'el diagnóstico confirma que Oracle reconoce la aplicación sin mostrar el secreto');
      process.env.ACONEX_CLIENT_SECRET = 'otro'; r = await pide('/api/aconex/diagnostico'); ok(r.j.credenciales === false, 'con un secreto equivocado el diagnóstico lo dice'); process.env.ACONEX_CLIENT_SECRET = 'acx-secreto';
      let ra = await fetch(B + '/api/aconex/conectar?pid=' + pd, { headers: { cookie: galleta }, redirect: 'manual' }); const idaA = new URL(ra.headers.get('location')), gA = (ra.headers.get('set-cookie') || '').split(';')[0];
      ok(ra.status === 302 && idaA.pathname === '/auth/authorize' && idaA.searchParams.get('client_id') === 'acx-id-prueba' && /\/api\/aconex\/vuelta$/.test(idaA.searchParams.get('redirect_uri')) && /^cde_aconex=/.test(gA), 'conectar lleva al Lobby de Oracle con la aplicación y la dirección de retorno');
      ra = await fetch(B + '/api/aconex/vuelta?code=codigo-acx&state=otro', { headers: { cookie: galleta + '; ' + gA }, redirect: 'manual' }); ok(/aconex=error/.test(ra.headers.get('location')), 'una vuelta con otro estado se rechaza');
      ra = await fetch(B + '/api/aconex/vuelta?code=codigo-acx&state=' + idaA.searchParams.get('state'), { headers: { cookie: galleta + '; ' + gA }, redirect: 'manual' }); ok(/aconex=conectado#\/p\//.test(ra.headers.get('location')), 'la vuelta de Oracle conecta la cuenta y regresa al proyecto');
      r = await pide('/api/aconex/estado'); ok(r.j.conectado && r.j.cuenta.usuario === 'erick.acx' && r.j.cuenta.nombre === 'Erick Aconex' && r.j.cuenta.venceRenovacion, 'el estado muestra la cuenta de Aconex y hasta cuándo dura la renovación');
      const filaA = require('../lib/bd').q.uno('SELECT refresco FROM aconex_cuentas'); ok(filaA && !/^RA\d+$/.test(filaA.refresco) && filaA.refresco.length > 30, 'el permiso de renovación de Oracle se guarda cifrado');
      r = await pide('/api/aconex/proyectos'); ok(r.j.length === 2 && r.j[0].nombre === 'Centro de Salud Sechura' && r.j[1].id === '111', 'se listan los proyectos de Aconex de la cuenta');
      r = await pide('/api/aconex/proyectos/111/documentos?filtro=' + encodeURIComponent('doctype:Memoria')); ok(r.j.total === 1 && r.j.documentos[0].numero === 'ACX-MEM-01', 'la vista previa muestra lo que trae un filtro de búsqueda de Aconex');
      const esperaA = async (eid) => { for (let i = 0; i < 100; i++) { const x = (await pide(A + '/enlaces')).j.enlaces.find(z => z.id === eid); if (x && (!x.trabajo || x.trabajo.estado !== 'corriendo') && x.ultimo) return x; await duerme(100); } return null; };
      r = await pide(A + '/enlaces', { json: { acxProyecto: '111', acxNombre: 'Hospital La Esperanza (ECC)', carpetaCde: 'WIP/ETAPA 1/CONTRATISTA', versiones: 'todas' } }); const eA = r.j.id; ok(r.status === 200 && eA, 'se enlaza el registro de Aconex con una carpeta del CDE');
      let enA = await esperaA(eA); ok(enA && enA.documentos === 2 && enA.traidos === 3 && enA.resumen.nuevos === 3 && enA.conError === 0, 'se traen los documentos de Aconex con todas sus revisiones (y la 2.ª página del registro) ' + JSON.stringify(enA && enA.resumen));
      r = await pide(A + '/enlaces/' + eA + '/items'); const iD1 = r.j.items.filter(x => x.item === '100017-ANI-ZZ-XX-DR-A-0101' && x.estado === 'traido'), iD3 = r.j.items.find(x => x.item === 'ACX-PH-01');
      ok(iD1.length === 2 && iD1[0].contenedor_id === iD1[1].contenedor_id && iD3 && iD3.estado === 'omitido', 'las dos revisiones quedan como versiones de un mismo documento y el marcador sin archivo se omite con su motivo');
      r = await pide('/api/proyectos/' + pd + '/contenedores/' + iD1[0].contenedor_id); const cD1 = r.j.contenedor || r.j, vD1 = (r.j.versiones || []).slice().sort((a, b) => a.n - b.n);
      ok(cD1.nombre === '100017-ANI-ZZ-XX-DR-A-0101' && vD1.length === 2 && vD1[0].revision === 'R00' && vD1[1].revision === 'R01' && vD1[1].origen === 'aconex' && ((r.j.atributos || cD1.atributos || {}).descripcion === 'Planta general'), 'entra con el Nº de documento de Aconex, sus revisiones R00/R01 y el título como descripción ' + JSON.stringify({ n: cD1.nombre, v: vD1.map(v => v.revision + ':' + v.origen) }));
      r = await pide(A + '/enlaces/' + eA + '/sincronizar', { json: {} }); enA = await esperaA(eA); ok(enA.resumen.nuevos === 0 && enA.resumen.sinCambios === 3, 'al volver a sincronizar no se repite nada ' + JSON.stringify(enA.resumen));
      const bajadasAntes = pedidos.filter(x => /\/register\/2001$/.test(x)).length;
      r = await pide(A + '/enlaces', { json: { acxProyecto: '111', acxNombre: 'Hospital La Esperanza (ECC)', filtro: 'doctype:Memoria', carpetaCde: 'COM/ETAPA 1/CONTRATISTA' } }); const eB = r.j.id;
      let enB = await esperaA(eB); ok(enB && enB.pendientes === 1 && enB.traidos === 0 && enB.conError === 0 && enB.resumen.pendientes === 1, 'en una carpeta con norma lo que no cumple queda «sin nomenclatura» ' + JSON.stringify(enB && enB.resumen));
      ok(pedidos.filter(x => /\/register\/2001$/.test(x)).length === bajadasAntes, 'lo que no cumple la nomenclatura no se descarga de Aconex');
      r = await pide(A + '/enlaces/' + eB + '/pendientes'); ok(r.j.pendientes.length === 1 && r.j.pendientes[0].nombre === 'ACX-MEM-01.pdf' && r.j.pendientes[0].carpeta === 'COM/ETAPA 1/CONTRATISTA', 'la lista de pendientes trae el nombre propuesto (Nº de documento) y su carpeta');
      r = await pide(A + '/enlaces/' + eB + '/nombres', { json: { asignaciones: [{ item: 'ACX-MEM-01', nombre: '100017-ANI-ZZ-XX-DR-A-0102-P01.pdf' }] } }); ok(r.j.aceptados === 1, 'la rejilla asigna un nombre conforme');
      await duerme(100); enB = await esperaA(eB); r = await pide(A + '/enlaces/' + eB + '/items'); const iB = r.j.items.find(x => x.estado === 'traido');
      ok(enB.pendientes === 0 && iB && iB.nombre_cde === '100017-ANI-ZZ-XX-DR-A-0102-P01.pdf', 'con el nombre asignado el documento entra en la carpeta con norma');
      r = await pide(A + '/correo/traer', { json: { acxProyecto: '111', acxNombre: 'Hospital La Esperanza (ECC)' } }); ok(r.status === 200 && r.j.entrada === 2 && r.j.enviados === 2, 'se trae el correo de Aconex (entrada y enviados) ' + JSON.stringify(r.j));
      r = await pide(A + '/correo'); const rfi = r.j.correos.find(x => x.numero === 'GHE-RFI-000001'), at = r.j.correos.find(x => x.numero === 'GHE-AT-000002');
      ok(r.j.correos.length === 3 && rfi && rfi.tipo === '(ECC) RFI' && rfi.de === 'Juan Perez' && rfi.org === 'GHEMET' && /Erick Torres \(ANIN\)/.test(rfi.para) && rfi.fecha === '2026-11-02' && rfi.vence === '2026-11-09' && at.buzon === 'ambos', 'el registro de correo guarda número, tipo, remitente, destinatarios, fechas y bandeja');
      r = await pide(A + '/correo/' + rfi.id); ok(/espesor de la losa del nivel 2/.test(r.j.cuerpo) && r.j.vence === '2026-11-10' && r.j.anexos.length === 1 && r.j.anexos[0].nombre === 'croquis.pdf', 'al abrir un correo se lee su cuerpo, la fecha de respuesta requerida y sus adjuntos ' + JSON.stringify({ c: r.j.cuerpo, a: r.j.anexos }).slice(0, 200));
      const pidCorreo = pedidos.filter(x => /\/mail\/9001$/.test(x)).length; await pide(A + '/correo/' + rfi.id); ok(pedidos.filter(x => /\/mail\/9001$/.test(x)).length === pidCorreo, 'el cuerpo leído queda guardado (no se vuelve a pedir)');
      r = await pide(A + '/registro/leer', { json: { acxProyecto: '111', acxNombre: 'Hospital La Esperanza (ECC)' } }); ok(r.j.documentos === 3, 'se lee el registro de documentos de Aconex');
      r = await pide(A + '/registro'); const rD3 = r.j.registro.find(x => x.numero === 'ACX-PH-01'), rD2 = r.j.registro.find(x => x.numero === 'ACX-MEM-01');
      ok(r.j.registro.length === 3 && r.j.enCde === 2 && !rD3.enCde && rD2.enCde, 'el registro cruzado dice qué documentos de Aconex ya están en el CDE y cuáles faltan ' + JSON.stringify({ n: r.j.registro.length, en: r.j.enCde }));
      r = await pide(A + '/importar', { json: { tipo: 'correo', archivo: 'Bandeja.xlsx', filas: [{ numero: 'GHE-RFI-000001', asunto: 'Consulta sobre espesor de losa', tipo: '(ECC) RFI', de: 'Juan Perez', org: 'GHEMET', fecha: '2026-11-02', vence: '2026-11-09', estado: 'Cerrado' }, { numero: 'GHE-NOT-000010', asunto: 'Notificación de compensación', tipo: '(ECC) Notificación', fecha: '2026-11-05' }, { nada: 1 }] } });
      ok(r.j.importados === 2, 'se importa un informe de correo exportado de Aconex en Excel');
      r = await pide(A + '/correo'); ok(r.j.correos.length === 4 && r.j.correos.find(x => x.numero === 'GHE-RFI-000001').estado === 'Cerrado', 'lo importado del Excel actualiza lo que ya estaba y agrega lo nuevo');
      r = await pide(A + '/importar', { json: { tipo: 'documentos', archivo: 'Registro.xlsx', filas: [{ numero: 'ACX-NUEVO-77', revision: 'B', titulo: 'Especificaciones', estado: 'Aprobado' }] } }); const rr2 = await pide(A + '/registro');
      ok(r.j.importados === 1 && rr2.j.registro.length === 4 && !rr2.j.registro.find(x => x.numero === 'ACX-NUEVO-77').enCde, 'se importa un registro de documentos en Excel y se cruza con el CDE');
      r = await pide(A + '/enlaces/' + eB, { method: 'DELETE' }); r = await pide(A + '/enlaces/' + eA, { method: 'DELETE' }); r = await pide(A + '/enlaces'); ok(r.j.enlaces.length === 0 && r.j.cuentas.correos === 4, 'al quitar los enlaces lo traído se queda en el CDE');
      r = await pide('/api/aconex/desconectar', { json: {} }); r = await pide('/api/aconex/proyectos'); ok(r.status === 409, 'al desconectar la cuenta se deja de poder leer Aconex');
      delete process.env.ACONEX_PRUEBA; delete process.env.ACONEX_CLIENT_ID; delete process.env.ACONEX_CLIENT_SECRET; oracle.close();
    }
  } catch (e) { fallos++; console.log('  EXCEPCION ' + (e.stack || e)); }
  finally {
    srv.close(); try { require('../compartido-visor/indice-modelos'); } catch (e) {}
    console.log('\n' + (n - fallos) + ' de ' + n + ' comprobaciones correctas' + (fallos ? ' — ' + fallos + ' FALLAN' : '') + '. Datos de prueba en ' + DATOS);
    process.exit(fallos ? 1 : 0);
  }
})();

/** Un .cdeg de prueba: por elemento, un cubo de 1 m desplazado. */
function cdegDePrueba(ids) {
  const meta = Buffer.from(JSON.stringify({ modelo: 'A.rvt', unidades: 'm', ejeArriba: 'Z', herramienta: 'prueba' }));
  const cab = Buffer.alloc(36); cab.write('CDEG', 0, 'latin1'); cab.writeUInt32LE(1, 4); cab.writeUInt32LE(ids.length, 8); cab.writeUInt32LE(8 * ids.length, 12); cab.writeUInt32LE(36 * ids.length, 16); cab.writeFloatLE(0, 20); cab.writeFloatLE(0, 24); cab.writeFloatLE(0, 28); cab.writeUInt32LE(meta.length, 32);
  let pad = (4 - (36 + meta.length) % 4) % 4;
  const tabla = Buffer.alloc(24 * ids.length), pos = Buffer.alloc(8 * 12 * ids.length), idx = Buffer.alloc(36 * 4 * ids.length);
  const cubo = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], caras = [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0];
  ids.forEach((e, i) => {
    tabla.writeUInt32LE(e, i * 24); tabla.writeUInt32LE(8 * i, i * 24 + 4); tabla.writeUInt32LE(8, i * 24 + 8); tabla.writeUInt32LE(36 * i, i * 24 + 12); tabla.writeUInt32LE(36, i * 24 + 16); tabla.writeUInt8(200, i * 24 + 20); tabla.writeUInt8(100 + i * 40, i * 24 + 21); tabla.writeUInt8(80, i * 24 + 22); tabla.writeUInt8(255, i * 24 + 23);
    cubo.forEach((p, k) => { pos.writeFloatLE(p[0] + i * 2, (i * 8 + k) * 12); pos.writeFloatLE(p[1], (i * 8 + k) * 12 + 4); pos.writeFloatLE(p[2], (i * 8 + k) * 12 + 8); });
    caras.forEach((c, k) => idx.writeUInt32LE(c, (i * 36 + k) * 4));
  });
  return Buffer.concat([cab, meta, Buffer.alloc(pad), tabla, pos, idx]);
}
