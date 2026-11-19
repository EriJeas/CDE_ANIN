/*
 * Suprimir una version incompleta de un modelo (v0.9.14): una publicacion cancelada desde un complemento deja la version sin
 * indice. Solo el gestor la suprime; nunca la ultima, nunca una con indice listo, nunca un archivo que no sea modelo.
 * Uso: node pruebas/prueba-suprimir-version.js
 */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const DATOS = fs.mkdtempSync(path.join(os.tmpdir(), 'cde-supv-'));
Object.assign(process.env, { DATOS_DIR: DATOS, MODO_ACCESO: 'local', ACCESO_CLAVE: 'prueba', ADMIN_EMAILS: 'admin@anin.gob.pe', SESSION_SECRET: 'secreto-de-prueba', PORT: '0' });
const { app } = require('../servidor');
const { q } = require('../lib/bd');
let fallos = 0, n = 0;
const ok = (c, m) => { n++; if (c) console.log('  ok  ' + m); else { fallos++; console.log('  FALLA ' + m); } };
(async () => {
  const srv = app.listen(0); await new Promise(r => srv.on('listening', r));
  const B = 'http://localhost:' + srv.address().port; let galleta = '';
  const pide = async (ruta, o) => {
    o = o || {}; o.headers = Object.assign({ cookie: galleta }, o.headers || {});
    if (o.json !== undefined) { o.method = o.method || 'POST'; o.headers['content-type'] = 'application/json'; o.body = JSON.stringify(o.json); delete o.json; }
    const r = await fetch(B + ruta, o); const sc = r.headers.get('set-cookie'); if (sc) galleta = sc.split(';')[0];
    return { status: r.status, j: await r.json().catch(() => ({})) };
  };
  try {
    await pide('/api/acceso/local', { json: { email: 'admin@anin.gob.pe', clave: 'prueba' } });
    let r = await pide('/api/proyectos', { json: { codigo: 'SECHURA', nombre: 'Centro de Salud Sechura I-4' } }); const pid = r.j.id;
    r = await pide('/api/proyectos/' + pid + '/llaves', { json: { nombre: 'Navisworks' } }); const llave = r.j.llave;
    const sube = (nombre, cuerpo) => fetch(B + '/api/proyectos/' + pid + '/subir?origen=complemento-navisworks', { method: 'POST', headers: { 'x-cde-llave': llave, 'x-nombre': encodeURIComponent(nombre) }, body: Buffer.from(cuerpo) }).then(x => x.json());
    const v1 = await sube('SECHURA-GHE-ZZ-XX-M3-A-0009-P01.nwd', 'nwd uno'), v2 = await sube('SECHURA-GHE-ZZ-XX-M3-A-0009-P02.nwd', 'nwd dos'), v3 = await sube('SECHURA-GHE-ZZ-XX-M3-A-0009-P03.nwd', 'nwd tres');
    ok(v1.version && v2.version && v3.version && v3.n === 3, 'tres versiones del federado (P01, P02, P03)');
    const cid = q.uno('SELECT contenedor_id FROM versiones WHERE id = ?', v1.version).contenedor_id;
    const carpeta = (vid) => path.join(DATOS, 'archivos', pid, cid, vid);
    ok(fs.existsSync(carpeta(v1.version)), 'el archivo de P01 esta en el almacen');
    // P02 con indice listo (version completa)
    q.corre("INSERT INTO indices_modelo (version_id, estado, fecha) VALUES (?, 'listo', '2026-11-13')", v2.version);
    r = await pide('/api/proyectos/' + pid + '/versiones/' + v3.version, { method: 'DELETE' }); ok(r.status === 409 && r.j.error === 'ultima', 'la ultima version no se suprime');
    r = await pide('/api/proyectos/' + pid + '/versiones/' + v2.version, { method: 'DELETE' }); ok(r.status === 409 && r.j.error === 'completa', 'una version con indice listo se conserva');
    r = await pide('/api/proyectos/' + pid + '/versiones/' + v1.version, { method: 'DELETE' }); ok(r.status === 200 && r.j.ok && r.j.liberado === 7, 'P01 sin indice se suprime: ' + JSON.stringify(r.j));
    ok(!q.uno('SELECT 1 FROM versiones WHERE id = ?', v1.version) && !fs.existsSync(carpeta(v1.version)), 'ya no esta ni en la base ni en el almacen');
    ok(q.uno("SELECT 1 FROM auditoria WHERE accion = 'version.suprimir' AND proyecto_id = ?", pid), 'queda en la auditoria');
    r = await pide('/api/proyectos/' + pid + '/contenedores/' + cid); ok(r.status === 200 && r.j.versiones.map(v => v.n).join(',') === '3,2', 'la ficha muestra P03 y P02');
    // un lector no puede
    await pide('/api/proyectos/' + pid + '/miembros', { json: { email: 'lector@anin.gob.pe', rol: 'lector' } });
    const g0 = galleta; galleta = ''; await pide('/api/acceso/local', { json: { email: 'lector@anin.gob.pe', clave: 'prueba' } });
    r = await pide('/api/proyectos/' + pid + '/versiones/' + v2.version, { method: 'DELETE' }); ok(r.status === 403 || r.status === 401, 'un lector no suprime versiones (' + r.status + ')');
    galleta = g0;
  } catch (e) { fallos++; console.log('  FALLA ' + (e.stack || e)); }
  srv.close(); console.log('\n' + (n - fallos) + ' de ' + n + ' comprobaciones correctas.'); process.exit(fallos ? 1 : 0);
})();
