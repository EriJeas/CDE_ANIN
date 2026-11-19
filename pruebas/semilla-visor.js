/*
 * SEMILLA PARA PROBAR EL VISOR A MANO (no es la prueba automatica): levanta el servidor en un directorio de datos
 * nuevo (puerto 8711), crea el proyecto LACALETA y publica un modelo de prueba con DOS versiones (indice + geometria):
 * una retícula de columnas, muros y puertas en dos niveles; la segunda version mueve, borra, agrega y cambia parametros.
 * Si se le pasa una carpeta con dos PDF (A.pdf, B.pdf) tambien sube un plano con dos revisiones.
 *   node pruebas/semilla-visor.js [carpeta-pdfs]
 * Entra con gestor@anin.gob.pe / prueba. Deja el servidor corriendo.
 */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), zlib = require('zlib');
const DATOS = fs.mkdtempSync(path.join(os.tmpdir(), 'cde-semilla-'));
Object.assign(process.env, { DATOS_DIR: DATOS, MODO_ACCESO: 'local', ACCESO_CLAVE: 'prueba', ADMIN_EMAILS: 'gestor@anin.gob.pe', SESSION_SECRET: 'secreto-semilla', PORT: '8711' });
const { app } = require('../servidor');
const duerme = (ms) => new Promise(r => setTimeout(r, ms));

/** Un .cdeg con cajas: [{ e, x, y, z, sx, sy, sz, color: [r,g,b], alfa }] en coordenadas Revit (Z arriba), metros. */
function cdeg(cajas, modelo) {
  const meta = Buffer.from(JSON.stringify({ modelo, unidades: 'm', ejeArriba: 'Z', herramienta: 'semilla' }));
  const n = cajas.length, cab = Buffer.alloc(36); cab.write('CDEG', 0, 'latin1'); cab.writeUInt32LE(1, 4); cab.writeUInt32LE(n, 8); cab.writeUInt32LE(8 * n, 12); cab.writeUInt32LE(36 * n, 16); cab.writeUInt32LE(meta.length, 32);
  const pad = (4 - (36 + meta.length) % 4) % 4, tabla = Buffer.alloc(24 * n), pos = Buffer.alloc(8 * 12 * n), idx = Buffer.alloc(36 * 4 * n);
  const cubo = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], caras = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
  cajas.forEach((c, i) => {
    tabla.writeUInt32LE(c.e, i * 24); tabla.writeUInt32LE(8 * i, i * 24 + 4); tabla.writeUInt32LE(8, i * 24 + 8); tabla.writeUInt32LE(36 * i, i * 24 + 12); tabla.writeUInt32LE(36, i * 24 + 16);
    tabla.writeUInt8(c.color[0], i * 24 + 20); tabla.writeUInt8(c.color[1], i * 24 + 21); tabla.writeUInt8(c.color[2], i * 24 + 22); tabla.writeUInt8(c.alfa == null ? 255 : c.alfa, i * 24 + 23);
    cubo.forEach((p, k) => { pos.writeFloatLE(c.x + p[0] * c.sx, (i * 8 + k) * 12); pos.writeFloatLE(c.y + p[1] * c.sy, (i * 8 + k) * 12 + 4); pos.writeFloatLE(c.z + p[2] * c.sz, (i * 8 + k) * 12 + 8); });
    caras.forEach((f, k) => idx.writeUInt32LE(f, (i * 36 + k) * 4));
  });
  return Buffer.concat([cab, meta, Buffer.alloc(pad), tabla, pos, idx]);
}
/** El modelo de prueba: columnas 0.4x0.4, muros, puertas, losas; dos niveles. version 1 o 2. */
function modelo(version) {
  const E = [], cajas = [], props = [];   // props: [e, nombre, valor]
  const MODELO = 'LACALETA-ADK-ZZ-XX-M3-A-0001.rvt';
  // ids ESTABLES entre versiones (como los UniqueId de Revit): por etiqueta, no por orden de creacion
  const ids = new Map(); const idDe = (k) => { let h = 0; for (const ch of k) h = (h * 31 + ch.charCodeAt(0)) % 7919; let e = 1000 + h; while ([...ids.values()].includes(e)) e++; ids.set(k, e); return e; };
  const pon = (e, nombre, valor) => props.push([e, nombre, valor]);
  const elemento = (nombre, cat, fam, tip, niv, caja, extra) => {
    const e = idDe(nombre + '|' + niv + '|' + (extra && extra.k || (caja.x + ',' + caja.y))); E.push([e, nombre + ' [' + e + ']', MODELO, cat, fam, tip, niv, 1]);
    cajas.push(Object.assign({ e }, caja)); pon(e, 'Identidad / UniqueId', 'uid-' + e); pon(e, 'Identidad / Editado por', version === 1 ? 'arquitecto' : 'erick');
    pon(e, 'Cotas / Volumen', (caja.sx * caja.sy * caja.sz).toFixed(2) + ' m³'); pon(e, 'CGM_Ambiente', extra && extra.ambiente || '');
    pon(e, 'Datos de identidad / Marca', nombre.replace(/\s+/g, '-').toUpperCase() + '-' + (e - 1000)); if (extra && extra.fase) pon(e, 'Fases / Fase de creación', extra.fase);
    // parametros de obra para los modulos portados del Visor BIM Federado (Filtro con sectores, Sectores por fecha, COBie/Uniclass)
    const sec = 1 + ((caja.x > 10) ? 1 : 0), dia = 1 + ((e * 7) % 28);
    pon(e, 'CGM_Sector', 'Sector ' + sec); pon(e, 'Zona', caja.y > 6 ? 'Zona B' : 'Zona A'); pon(e, 'Fecha de vaciado', '2026-0' + (3 + (sec - 1) + (niv === 'Nivel 2' ? 1 : 0)) + '-' + String(dia).padStart(2, '0'));
    if (!/Puerta/.test(nombre)) { pon(e, 'Código de partida', '02.0' + (1 + (e % 3)) + '.01'); pon(e, 'Nombre de partida', ['CONCRETO EN MUROS', 'ENCOFRADO', 'ACERO DE REFUERZO'][e % 3]); }
    if (e % 2 === 0) pon(e, 'COBie.Component.Name', 'C-' + e); if (e % 3 === 0) pon(e, 'COBie.Type.Category', 'Ss_25_10'); if (e % 4 === 0) pon(e, 'Uniclass Ss', 'Ss_25_10_30');
    return e;
  };
  for (const [ni, niv, z] of [[0, 'Nivel 1', 0], [1, 'Nivel 2', 3.5]]) {
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
      if (version === 2 && ni === 1 && i === 3 && j === 2) continue;   // columna eliminada en v2
      const mov = version === 2 && ni === 0 && i === 1 && j === 1 ? 0.3 : 0;   // columna movida 30 cm en v2
      elemento('Columna 40x40', 'Pilares estructurales', 'Pilar rectangular', '40x40', niv, { x: i * 6 + mov, y: j * 5, z, sx: 0.4, sy: 0.4, sz: 3.3, color: [190, 190, 195] }, { ambiente: 'Circulación', k: 'col' + i + j });
    }
    for (let i = 0; i < 3; i++) elemento('Muro básico 200', 'Muros', 'Muro básico', 'Genérico 200 mm', niv, { x: i * 6 + 0.4, y: 0, z, sx: 5.6, sy: 0.2, sz: version === 2 && ni === 0 && i === 2 ? 2.8 : 3.3, color: [222, 214, 196] }, { ambiente: i === 0 ? 'Consultorio 1' : i === 1 ? 'Consultorio 2' : 'Tópico' });
    for (let j = 0; j < 2; j++) elemento('Muro básico 200', 'Muros', 'Muro básico', 'Genérico 200 mm', niv, { x: 0, y: j * 5 + 0.4, z, sx: 0.2, sy: 4.6, sz: 3.3, color: [222, 214, 196] });
    elemento('Puerta 0.90', 'Puertas', 'Puerta simple', '0.90 x 2.10', niv, { x: 2, y: 0.02, z, sx: 0.9, sy: 0.16, sz: 2.1, color: [160, 110, 60] }, { ambiente: 'Consultorio 1', k: 'pext' + ni });
    // tabique entre los consultorios y el corredor (y = 5) con una puerta por ambiente; y los AMBIENTES (habitaciones, con su volumen)
    elemento('Tabique 100', 'Muros', 'Muro básico', 'Tabique 100 mm', niv, { x: 0.4, y: 5, z, sx: 17.6, sy: 0.1, sz: 3.3, color: [222, 214, 196] }, { k: 'tab' + ni });
    for (const [i, nom, upss] of [[0, 'Consultorio 1', 'Consulta externa'], [1, 'Consultorio 2', 'Consulta externa'], [2, 'Tópico', 'Emergencia']]) {
      const pe = elemento('Puerta 0.90', 'Puertas', 'Puerta simple', '0.90 x 2.10', niv, { x: i * 6 + 3, y: 4.92, z, sx: 0.9, sy: 0.26, sz: 2.1, color: [160, 110, 60] }, { k: 'pint' + ni + i }); pon(pe, 'Cotas / Ancho', '0.90 m');
      const r = elemento(ni === 1 && i === 2 ? 'Cuarto sucio' : nom, 'Habitaciones', 'Habitación', 'Habitación', niv, { x: i * 6 + 0.4, y: 0.2, z, sx: 5.6, sy: 4.8, sz: 3.0, color: [200, 200, 230] }, { k: 'amb' + ni + i });
      pon(r, 'Identidad / Nombre', ni === 1 && i === 2 ? 'Cuarto sucio' : nom); pon(r, 'Identidad / Número', (ni + 1) * 100 + i + 1); pon(r, 'Cotas / Área', '26.88 m²'); pon(r, 'Restricciones / Nivel', niv); pon(r, 'CGM_Subdepartamento', ni === 1 && i === 2 ? 'Hospitalización' : upss);
    }
    const co = elemento('Corredor', 'Habitaciones', 'Habitación', 'Habitación', niv, { x: 0.4, y: 5.1, z, sx: 17.6, sy: 4.7, sz: 3.0, color: [230, 230, 200] }, { k: 'cor' + ni }); pon(co, 'Identidad / Nombre', 'Corredor'); pon(co, 'Identidad / Número', (ni + 1) * 100 + 9); pon(co, 'Cotas / Área', '82.72 m²'); pon(co, 'Restricciones / Nivel', niv);
    const es = elemento('Escalera', 'Habitaciones', 'Habitación', 'Habitación', niv, { x: 18.3, y: 5.1, z, sx: 2.5, sy: 3, sz: 3.3, color: [200, 230, 200] }, { k: 'esc' + ni }); pon(es, 'Identidad / Nombre', 'Escalera'); pon(es, 'Identidad / Número', (ni + 1) * 100 + 8); pon(es, 'Cotas / Área', '7.50 m²'); pon(es, 'Restricciones / Nivel', niv);
    if (ni === 0) { const al = elemento('Almacén central de residuos', 'Habitaciones', 'Habitación', 'Habitación', niv, { x: 18.3, y: 0.2, z, sx: 2.5, sy: 4.5, sz: 3.0, color: [230, 200, 200] }, { k: 'res' }); pon(al, 'Identidad / Nombre', 'Almacén central de residuos'); pon(al, 'Identidad / Número', '110'); pon(al, 'Cotas / Área', '11.25 m²'); pon(al, 'Restricciones / Nivel', niv);
      const pr = elemento('Puerta 1.20', 'Puertas', 'Puerta doble', '1.20 x 2.10', niv, { x: 18.2, y: 2, z, sx: 0.3, sy: 1.2, sz: 2.1, color: [160, 110, 60] }, { k: 'pres' }); pon(pr, 'Cotas / Ancho', '1.20 m'); }
    elemento('Ventana 1.20', 'Ventanas', 'Ventana fija', '1.20 x 1.00', niv, { x: 8, y: 0.02, z: z + 1.0, sx: 1.2, sy: 0.16, sz: 1.0, color: [150, 200, 230], alfa: 90 }, { ambiente: 'Consultorio 2' });
    if (version === 2 && ni === 1) elemento('Ventana 1.20', 'Ventanas', 'Ventana fija', '1.20 x 1.00', niv, { x: 14, y: 0.02, z: z + 1.0, sx: 1.2, sy: 0.16, sz: 1.0, color: [150, 200, 230], alfa: 90 }, { ambiente: 'Tópico' });   // nueva en v2
    elemento('Losa 20', 'Suelos', 'Suelo', 'Losa 200 mm', niv, { x: -0.5, y: -0.5, z: z - 0.2, sx: 19.5, sy: 11.5, sz: 0.2, color: [200, 200, 200] });
  }
  // una viga que choca con un muro (para las interferencias)
  elemento('Viga 30x50', 'Armazón estructural', 'Viga rectangular', '30x50', 'Nivel 2', { x: 0.4, y: -0.05, z: 2.95, sx: 17.6, sy: 0.3, sz: 0.5, color: [170, 170, 180] });
  if (version === 2) { const e = E.find(x => /Puerta/.test(x[1]) && x[6] === 'Nivel 1')[0]; const p = props.find(x => x[0] === e && x[1] === 'CGM_Ambiente'); p[2] = 'Admisión'; }   // parametro cambiado en v2
  // al formato de trozo del visor: attrs, vals, eavd
  const attrs = new Map(), vals = new Map(), eav = [];
  const aid = (n) => { if (!attrs.has(n)) attrs.set(n, attrs.size + 1); return attrs.get(n); }, vid = (v) => { if (!vals.has(v)) vals.set(v, vals.size + 1); return vals.get(v); };
  const canon = { '● Modelo': 2, '● Categoria': 3, '● Familia': 4, '● Tipo': 5, '● Nivel': 6 };
  for (const r of E) for (const [n, k] of Object.entries(canon)) eav.push([aid(n), r[0], vid(r[k])]);
  for (const [e, n, v] of props) if (v !== '') eav.push([aid(n), e, vid(v)]);
  const porA = new Map(); for (const [a, e, v] of eav) { const k = a + ':' + v; if (!porA.has(k)) porA.set(k, [a, v, []]); porA.get(k)[2].push(e); }
  const eavd = [...porA.values()].sort((x, y) => x[0] - y[0]).map(([a, v, es]) => { es.sort((p, q) => p - q); const d = []; let prev = 0; for (const e of es) { d.push(e - prev); prev = e; } return [a, v].concat(d); });
  return { E, trozo: { elem: E, attrs: [...attrs].map(([n, i]) => [i, n]), vals: [...vals].map(([v, i]) => [i, v]), eavd }, geo: cdeg(cajas, MODELO), MODELO };
}

(async () => {
  const srv = app.listen(8711); await new Promise(r => srv.on('listening', r));
  const B = 'http://127.0.0.1:8711'; let galleta = '';
  const pide = async (ruta, o) => { o = o || {}; o.headers = Object.assign({ cookie: galleta }, o.headers || {}); if (o.json !== undefined) { o.method = o.method || 'POST'; o.headers['content-type'] = 'application/json'; o.body = JSON.stringify(o.json); delete o.json; } const r = await fetch(B + ruta, o); const sc = r.headers.get('set-cookie'); if (sc) galleta = sc.split(';')[0]; return { status: r.status, j: await r.json().catch(() => null) }; };
  await pide('/api/acceso/local', { json: { email: 'gestor@anin.gob.pe', clave: 'prueba' } });
  let r = await pide('/api/proyectos', { json: { codigo: 'LACALETA', nombre: 'Hospital La Caleta', plantilla: 'acc', orgContr: 'ADK', orgSuper: 'SUPERVISION' } }); const pid = r.j.id;
  await pide('/api/proyectos/' + pid + '/miembros', { json: { email: 'gestor@anin.gob.pe', rol: 'gestor', organizacion: 'ADK' } });
  r = await pide('/api/proyectos/' + pid + '/llaves', { json: { nombre: 'semilla' } }); const llave = r.j.llave;
  const conLlave = (ruta, o) => { o = o || {}; o.headers = Object.assign({ 'x-cde-llave': llave }, o.headers || {}); return fetch(B + ruta, o).then(async x => ({ status: x.status, j: await x.json().catch(() => null) })); };
  const WIP = 'E3_DISEÑO PRELIMINAR/E3.00_TRABAJO EN PROGRESO (WIP)/ADK';
  const vids = [];
  for (const v of [1, 2]) {
    const M = modelo(v);
    r = await fetch(B + '/api/proyectos/' + pid + '/subir?origen=complemento-revit&organizacion=ADK&carpeta=' + encodeURIComponent(WIP), { method: 'POST', headers: { 'x-cde-llave': llave, 'x-nombre': encodeURIComponent('LACALETA-ADK-ZZ-XX-M3-A-0001-P0' + v + '.rvt') }, body: Buffer.from('rvt ' + v) }).then(x => x.json());
    if (!r.version) { console.log('subida fallo', JSON.stringify(r)); process.exit(1); } const vid = r.version; vids.push(vid);
    r = await conLlave('/api/modelos/' + pid + '/' + vid + '/indice/inicio', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ modelos: [M.MODELO], elementos: M.E.length, parametros: M.trozo.attrs.length }) }); const sid = r.j.subida;
    await conLlave('/api/modelos/' + pid + '/' + vid + '/indice/trozo/' + sid, { method: 'POST', body: zlib.gzipSync(JSON.stringify(M.trozo)) });
    await conLlave('/api/modelos/' + pid + '/' + vid + '/geometria/' + sid, { method: 'POST', body: M.geo });
    await conLlave('/api/modelos/' + pid + '/' + vid + '/indice/fin/' + sid, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    let est; for (let i = 0; i < 200; i++) { await duerme(100); est = (await pide('/api/modelos/' + pid + '/' + vid + '/estado')).j; if (est.estado === 'listo' || est.estado === 'error') break; }
    console.log('version ' + v + ': ' + est.estado + ' (' + M.E.length + ' elementos)');
  }
  const dirPdf = process.argv[2];
  if (dirPdf && fs.existsSync(path.join(dirPdf, 'A.pdf'))) {
    for (const [n, f] of [['P01', 'A.pdf'], ['P02', 'B.pdf']]) {
      r = await fetch(B + '/api/proyectos/' + pid + '/subir?carpeta=' + encodeURIComponent(WIP), { method: 'POST', headers: { cookie: galleta, 'x-nombre': encodeURIComponent('LACALETA-ADK-01-01-DR-A-0101-' + n + '.pdf') }, body: fs.readFileSync(path.join(dirPdf, f)) }).then(x => x.json());
      console.log('plano ' + n + ': ' + (r.version ? 'ok' : JSON.stringify(r)));
    }
  }
  const viga = modelo(2).E.find(x => /Viga/.test(x[1]))[0];
  const inc = await pide('/api/proyectos/' + pid + '/incidencias', { json: { titulo: 'Viga choca con muro del Nivel 2', tipo: 'interferencia', prioridad: 'alta', version_id: vids[1], elementos: [{ e: viga, modelo: 'LACALETA-ADK-ZZ-XX-M3-A-0001.rvt' }], camara: { pos: [25, -20, 12], dir: [-0.6, 0.6, -0.4], up: [0, 0, 1], fov: 50 } } });
  console.log('incidencia ' + (inc.j && inc.j.codigo));
  console.log('\nServidor en ' + B + '  ·  proyecto ' + pid + '  ·  visor: ' + B + '/visor.html?pid=' + pid + '&vid=' + vids[1] + '\n(entra con gestor@anin.gob.pe / prueba; datos en ' + DATOS + ')');
})();
