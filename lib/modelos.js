/*
 * MODELOS EN EL CDE: recibir el paquete de un modelo (indice de parametros + geometria liviana), armar su indice SQLite
 * con la clase Indice del visor y responder las consultas (tablero, parametros, llenado, valores, inventario) con
 * indice-modelos.js del visor, sin cambios. El protocolo de subida es el MISMO que usa el visor con su portal
 * (inicio -> trozos -> fin), para que el complemento de Revit, el complemento de Navisworks y el propio visor hablen igual.
 *
 *   POST /api/modelos/:pid/:vid/indice/inicio        { modelos: [..], elementos, parametros, pares, meta }
 *   POST /api/modelos/:pid/:vid/indice/trozo/:sid    cuerpo: un trozo JSON (gzip o plano) con el formato de exporta-indice.js
 *   POST /api/modelos/:pid/:vid/geometria/:sid       cuerpo: geometria.cdeg (docs/FORMATO-PAQUETE.md), en flujo
 *   POST /api/modelos/:pid/:vid/indice/fin/:sid      { resumen? }  -> arma el indice en un hilo aparte
 *   GET  /api/modelos/:pid/:vid/estado
 *   GET  /api/modelos/:pid/:vid/(tablero|parametros|llenado|valores|inventario)
 *   GET  /api/modelos/:pid/:vid/geometria            -> el .cdeg para el visor liviano del CDE
 */
'use strict';
const { recorre, recorreSt } = require('../compartido-visor/recorre');   // v0.25.6: recorrido sin «statement has been finalized» (Node 22.13)
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const { Worker } = require('worker_threads');
const { q, ahora, id, audita } = require('./bd');
const I = require('../compartido-visor/indice-modelos');
const PT = require('./partes');   // v0.27.0: geometría por partes

const SUBIDAS = new Map();   // sid -> { pid, vid, dir, n, bytes, t, geometria, quien }
const TRABAJOS = new Map();  // vid -> { avance }

function monta(app, ctx) {
  const { requiereLlave, requiereSesion, requiereRol, rolEn, express } = ctx;
  const DIR = path.join(ctx.datosDir, 'indices'); fs.mkdirSync(DIR, { recursive: true });
  const rutaIndice = (vid) => path.join(DIR, saneo(vid) + '.sqlite');
  const dirTrozos = (vid) => path.join(DIR, saneo(vid) + '.trozos');

  /** Entra con llave de complemento O con sesion (rol minimo). */
  const llaveOSesion = (min) => (req, res, next) => {
    if (req.get('x-cde-llave')) return requiereLlave(req, res, next);
    requiereSesion(req, res, () => requiereRol(min)(req, res, next));
  };
  const versionDe = (req, res) => {
    const v = q.uno('SELECT v.*, c.proyecto_id, c.nombre AS contenedor FROM versiones v JOIN contenedores c ON c.id = v.contenedor_id WHERE v.id = ? AND c.proyecto_id = ?', String(req.params.vid || ''), String(req.params.pid || ''));
    if (!v) res.status(404).json({ error: 'no-existe', mensaje: 'Esa version no existe en este proyecto.' });
    return v;
  };

  /** Arma el indice de una subida completa (trozos + geometria): lo usan el fin de la subida (complemento) y los lectores
   *  IFC / RVT del propio CDE. s: { pid, vid, dir, n, bytes, geometria, quien, meta }. Devuelve la ruta de la geometria. */
  function arma(s) {
    const dirFinal = dirTrozos(s.vid);
    let rutaGeo = '';
    // v0.25.6: s.rearma = los trozos ya están en su sitio (falló solo el armado del índice): no se vuelve a leer el modelo
    if (s.rearma) rutaGeo = s.geometria || '';
    else { rmrf(dirFinal); fs.renameSync(s.dir, dirFinal); try { fs.writeFileSync(path.join(dirFinal, 'meta.json'), JSON.stringify(s.meta)); } catch (e) {} }
    if (s.geometria && !s.rearma) { rutaGeo = path.join(DIR, saneo(s.vid) + '.cdeg'); try { fs.renameSync(path.join(dirFinal, 'geometria.cdeg'), rutaGeo); } catch (e) { rutaGeo = ''; } }
    q.corre('UPDATE indices_modelo SET estado = ?, trozos = ?, bytes = ?, ruta_geometria = ?, fecha = ? WHERE version_id = ?', 'armando', s.n, s.bytes, rutaGeo, ahora(), s.vid);
    audita(s.quien, 'modelo.paquete', s.pid, s.vid, { trozos: s.n, bytes: s.bytes, geometria: !!rutaGeo, meta: s.meta });
    const meta = { modelos: s.meta.modelos.join(' | ').slice(0, 2000), herramienta: s.meta.herramienta, origen_paquete: s.meta.origen_paquete, version_cde: s.vid };
    try { I.cierra(rutaIndice(s.vid)); } catch (e) {}   // en Windows no se puede reemplazar un indice que el servidor tiene abierto (lo estaba consultando el visor)
    const w = new Worker(path.join(__dirname, 'trabajador-indice.js'), { workerData: { dirTrozos: dirFinal, rutaIndice: rutaIndice(s.vid), meta } });
    TRABAJOS.set(s.vid, { avance: null });
    w.on('message', (m) => {
      if (m.avance) { TRABAJOS.set(s.vid, { avance: m }); return; }
      TRABAJOS.delete(s.vid);
      if (m.ok) {
        q.corre('UPDATE indices_modelo SET estado = ?, ruta_sqlite = ?, resumen = ?, fecha = ? WHERE version_id = ?', 'listo', rutaIndice(s.vid), JSON.stringify(Object.assign({ nodos: m.nodos, pares: m.pares }, m.resumen || {})), ahora(), s.vid);
        rmrf(dirFinal);   // los trozos ya estan en el indice
        // el resumen de la ficha de un modelo leido por el CDE se escribe con lo que trae el indice (elementos, niveles, categorias)
        if (ctx.resumenes && /^lector/.test(String((s.meta || {}).origen_paquete || ''))) { const v = q.uno('SELECT contenedor_id FROM versiones WHERE id = ?', s.vid); if (v) try { ctx.resumenes.encola(s.pid, v.contenedor_id, s.vid); } catch (e) {} }
      } else { q.corre('UPDATE indices_modelo SET estado = ?, error = ?, fecha = ? WHERE version_id = ?', 'error', String(m.error).slice(0, 2000), ahora(), s.vid); if (s.rearma) rmrf(dirFinal); }   // si ni rearmando sale, la próxima vez se lee el modelo de nuevo
    });
    w.on('error', (e) => { TRABAJOS.delete(s.vid); q.corre('UPDATE indices_modelo SET estado = ?, error = ?, fecha = ? WHERE version_id = ?', 'error', String(e.message || e).slice(0, 2000), ahora(), s.vid); });
    return rutaGeo;
  }

  // ---------- LECTORES PROPIOS (sin Autodesk): IFC siempre; RVT con el lector libre rvt-rs; NWD no tiene lector libre ----------
  const FORMATO = { ifc: 'ifc', ifczip: '', rvt: 'rvt', nwd: 'nwd', nwc: 'nwd', nwf: 'nwd' };
  const NO_NWD = 'Navisworks (NWD / NWC / NWF) es un formato cerrado sin lector libre: solo lo abren Navisworks Manage / Simulate o el servicio de pago de Autodesk. Carga al CDE los modelos de origen (IFC o RVT) para verlos en el visor.';
  const COLA = []; let convirtiendo = null;
  const pon = (vid, estado, error) => q.corre('INSERT INTO indices_modelo (version_id, estado, error, fecha) VALUES (?,?,?,?) ON CONFLICT(version_id) DO UPDATE SET estado = excluded.estado, error = excluded.error, fecha = excluded.fecha', vid, estado, String(error || '').slice(0, 2000), ahora());
  /** ¿El CDE lee este archivo por su cuenta? 'ifc' | 'rvt' | 'nwd' (no legible) | ''. */
  const formatoDe = (archivo) => FORMATO[String(path.extname(String(archivo || '')).slice(1)).toLowerCase()] || '';
  /** Pone en cola la conversion de una version (IFC / RVT). Devuelve el estado inicial. */
  function procesa(pid, vid, quien) {
    const v = q.uno('SELECT v.*, c.proyecto_id FROM versiones v JOIN contenedores c ON c.id = v.contenedor_id WHERE v.id = ? AND c.proyecto_id = ?', vid, pid);
    if (!v) return { estado: 'no-existe' };
    const f = formatoDe(v.archivo);
    if (f === 'nwd') { pon(vid, 'no-legible', NO_NWD); return { estado: 'no-legible', mensaje: NO_NWD }; }
    if (f !== 'ifc' && f !== 'rvt') return { estado: 'no-modelo', mensaje: 'El visor lee modelos IFC y RVT.' };
    if (f === 'rvt' && !require('./lector-rvt').disponible()) { const m = require('./lector-rvt').QUE_FALTA; pon(vid, 'no-legible', m); return { estado: 'no-legible', mensaje: m }; }
    if (convirtiendo === vid || COLA.some(x => x.vid === vid)) return { estado: 'convirtiendo' };
    if (TRABAJOS.has(vid)) return { estado: 'armando' };
    // v0.25.6: si el modelo ya se leyó y lo que falló fue armar el índice, se rearma con lo leído (un minuto) en vez de leer el modelo otra vez
    try {
      const i = q.uno('SELECT * FROM indices_modelo WHERE version_id = ?', vid), dF = dirTrozos(vid);
      if (i && i.estado === 'error' && i.trozos > 0 && fs.existsSync(dF)) {
        const tz = fs.readdirSync(dF).filter(x => /^\d+\.json\.gz$/.test(x)); let meta = null; try { meta = JSON.parse(fs.readFileSync(path.join(dF, 'meta.json'), 'utf8')); } catch (e) {}
        if (!meta && f === 'ifc') meta = { modelos: [v.archivo], origen_paquete: 'lector-ifc', herramienta: 'Lector IFC del CDE (IFC)' };
        const geo = i.ruta_geometria && fs.existsSync(i.ruta_geometria) ? i.ruta_geometria : '';
        if (meta && Array.isArray(meta.modelos) && tz.length === i.trozos && geo) {
          arma({ pid, vid, n: tz.length, bytes: i.bytes, geometria: geo, quien, meta, rearma: true });
          audita(quien || 'sistema', 'modelo.rearma', pid, vid, { trozos: tz.length });
          return { estado: 'armando' };
        }
      }
    } catch (e) {}
    pon(vid, 'en-cola', ''); COLA.push({ pid, vid, quien, ruta: ctx.almacen.rutaAbsoluta(v.ruta_almacen), ext: f, modelo: v.archivo });
    siguiente(); return { estado: 'en-cola' };
  }
  function siguiente() {
    if (convirtiendo || !COLA.length) return;
    const t = COLA.shift(); convirtiendo = t.vid;
    const dir = dirTrozos(t.vid) + '.lector'; rmrf(dir);
    pon(t.vid, 'convirtiendo', ''); TRABAJOS.set(t.vid, { avance: { fase: t.ext === 'rvt' ? 'rvt' : 'abriendo', n: 0, total: 0 } });
    const termina = (ok, error, resumen) => {
      convirtiendo = null; TRABAJOS.delete(t.vid);
      if (ok) {
        const trozos = fs.readdirSync(dir).filter(f => /^\d+\.json\.gz$/.test(f));
        const bytes = trozos.reduce((b, f) => b + fs.statSync(path.join(dir, f)).size, 0);
        const geo = path.join(dir, 'geometria.cdeg');
        arma({ pid: t.pid, vid: t.vid, dir, n: trozos.length, bytes, geometria: fs.existsSync(geo) ? geo : '', quien: t.quien,
          meta: { modelos: [t.modelo], elementos: resumen.elementos, parametros: resumen.parametros, pares: resumen.pares, origen_paquete: t.ext === 'rvt' ? 'lector-rvt' : 'lector-ifc', herramienta: resumen.revit ? 'Lector RVT libre (Revit ' + resumen.revit + ')' : 'Lector IFC del CDE (' + (resumen.esquema || 'IFC') + ')' } });
        if (resumen.avisos && resumen.avisos.length) q.corre('UPDATE indices_modelo SET error = ? WHERE version_id = ?', resumen.avisos.join(' ').slice(0, 2000), t.vid);
        audita(t.quien || 'sistema', 'modelo.lector', t.pid, t.vid, { formato: t.ext, elementos: resumen.elementos, triangulos: resumen.triangulos, avisos: resumen.avisos });
      } else { rmrf(dir); pon(t.vid, 'error', error); audita(t.quien || 'sistema', 'modelo.lector.error', t.pid, t.vid, { formato: t.ext, error: String(error).slice(0, 500) }); }
      setImmediate(siguiente);
    };
    let w;
    try { w = new Worker(path.join(__dirname, 'trabajador-modelo.js'), { workerData: { ruta: t.ruta, ext: t.ext, modelo: t.modelo, dirSalida: dir }, resourceLimits: { maxOldGenerationSizeMb: 6144 } }); } catch (e) { return termina(false, e.message); }
    w.on('message', (m) => { if (m.avance) { TRABAJOS.set(t.vid, { avance: m.avance }); return; } termina(!!m.ok, m.error, m.resumen); });
    w.on('error', (e) => termina(false, 'El lector se detuvo: ' + (e.message || e)));
    w.on('exit', (code) => { if (convirtiendo === t.vid) termina(false, 'El lector terminó sin respuesta (código ' + code + ').'); });
  }
  // lo que quedo a medias si el servidor se reinicio mientras convertia
  try { q.corre("UPDATE indices_modelo SET estado = 'error', error = 'La lectura se interrumpió (se reinició el servidor): vuelve a procesar el modelo.' WHERE estado IN ('convirtiendo', 'en-cola')"); } catch (e) {}
  /** Instala un modelo armado fuera del protocolo de subida (p. ej. traido de Autodesk Forma): un indice SQLite ya hecho
   *  (con la clase Indice del visor) y su geometria .cdeg. s: { pid, vid, indice, geometria, resumen, meta, quien }.
   *  Los archivos deben estar en el mismo disco que los indices (se mueven, no se copian). */
  function instala(s) {
    const ri = rutaIndice(s.vid), rg = path.join(DIR, saneo(s.vid) + '.cdeg');
    try { I.cierra(ri); } catch (e) {}   // en Windows no se reemplaza un indice abierto
    try { fs.unlinkSync(ri); } catch (e) {} fs.renameSync(s.indice, ri);
    let rutaGeo = ''; if (s.geometria) { try { fs.unlinkSync(rg); } catch (e) {} fs.renameSync(s.geometria, rg); rutaGeo = rg; }
    q.corre('INSERT INTO indices_modelo (version_id, estado, trozos, bytes, ruta_sqlite, ruta_geometria, resumen, error, fecha) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(version_id) DO UPDATE SET estado = excluded.estado, trozos = excluded.trozos, bytes = excluded.bytes, ruta_sqlite = excluded.ruta_sqlite, ruta_geometria = excluded.ruta_geometria, resumen = excluded.resumen, error = excluded.error, fecha = excluded.fecha',
      s.vid, 'listo', 0, rutaGeo ? fs.statSync(rutaGeo).size : 0, ri, rutaGeo, JSON.stringify(s.resumen || {}), String(s.aviso || '').slice(0, 2000), ahora());
    audita(s.quien || 'sistema', 'modelo.instalado', s.pid, s.vid, Object.assign({ geometria: !!rutaGeo }, s.meta || {}));
    if (ctx.resumenes) { const v = q.uno('SELECT contenedor_id FROM versiones WHERE id = ?', s.vid); if (v) try { ctx.resumenes.encola(s.pid, v.contenedor_id, s.vid); } catch (e) {} }
    return { indice: ri, geometria: rutaGeo };
  }
  ctx.modelos = { procesa, formatoDe, instala, dirIndices: DIR };
  /** Los modelos del proyecto en CUALQUIER carpeta (WIP, compartido, publicado), con lo que el CDE sabe de cada version:
   *  lo que lista el visor. Solo lo que el usuario puede leer. */
  app.get('/api/modelos/:pid/lista', requiereSesion, requiereRol('lector'), (req, res) => {
    const I2 = ctx.cdeInterno, p = I2 && I2.proyecto(req.params.pid), u = p && I2.yo(req, p);
    const filas = q.todos("SELECT c.id AS cid, c.nombre AS contenedor, c.carpeta, c.carpeta_publicada, c.estado, c.retencion, v.id AS vid, v.n, v.revision, v.archivo, v.fecha, v.origen, i.estado AS ie, i.ruta_geometria AS geo, i.resumen AS ir, i.error AS ierr FROM contenedores c JOIN versiones v ON v.contenedor_id = c.id LEFT JOIN indices_modelo i ON i.version_id = v.id WHERE c.proyecto_id = ? AND c.borrado = '' ORDER BY c.carpeta, c.nombre, v.n DESC", req.params.pid);
    const out = [];
    for (const f of filas) {
      if (!formatoDe(f.archivo) && !f.ie) continue;
      if (p && u && I2.permisoEn) { const pe = (r) => r && I2.permisoEn(p, u, r).leer; if (!(pe(f.carpeta) || pe(f.carpeta_publicada) || (f.retencion && I2.permisoEn(p, u, f.retencion).subir))) continue; }
      let rs = {}; try { rs = JSON.parse(f.ir || '{}'); } catch (e) {}
      const t = TRABAJOS.get(f.vid);
      out.push({ vid: f.vid, cid: f.cid, contenedor: f.contenedor, carpeta: f.carpeta || f.retencion || '', estado: f.estado, n: f.n, revision: f.revision, archivo: f.archivo, fecha: f.fecha, formato: formatoDe(f.archivo), origen: f.origen || '',
        indice: f.ie ? { estado: f.ie, geometria: !!f.geo, elementos: rs.elementos || 0, error: f.ierr || '', avance: t && t.avance } : null });
    }
    res.json({ modelos: out });
  });
  app.post('/api/modelos/:pid/:vid/procesar', llaveOSesion('autor'), (req, res) => {
    const v = versionDe(req, res); if (!v) return;
    const r = procesa(v.proyecto_id, v.id, req.quien);
    if (r.estado === 'no-modelo') return res.status(400).json({ error: 'formato', mensaje: r.mensaje });
    res.json(r);
  });

  app.post('/api/modelos/:pid/:vid/indice/inicio', llaveOSesion('autor'), express.json({ limit: '256kb' }), (req, res) => {
    const v = versionDe(req, res); if (!v) return;
    for (const [sid, s] of SUBIDAS) if (s.vid === v.id) { rmrf(s.dir); SUBIDAS.delete(sid); }   // una subida a la vez por version
    const sid = id('su'), dir = dirTrozos(v.id) + '.' + sid;
    rmrf(dir); fs.mkdirSync(dir, { recursive: true });
    const b = req.body || {};
    SUBIDAS.set(sid, { pid: v.proyecto_id, vid: v.id, dir, n: 0, bytes: 0, t: Date.now(), geometria: '', quien: req.quien,
      meta: { modelos: Array.isArray(b.modelos) ? b.modelos.slice(0, 50).map(String) : [], elementos: Number(b.elementos) || 0, parametros: Number(b.parametros) || 0, pares: Number(b.pares) || 0, origen_paquete: String(b.origen || ''), herramienta: String(b.herramienta || '').slice(0, 120) } });
    q.corre('INSERT OR REPLACE INTO indices_modelo (version_id, estado, fecha) VALUES (?,?,?)', v.id, 'recibiendo', ahora());
    res.json({ subida: sid });
  });

  app.post('/api/modelos/:pid/:vid/indice/trozo/:sid', llaveOSesion('autor'), express.raw({ type: () => true, limit: '96mb' }), (req, res) => {
    const s = SUBIDAS.get(String(req.params.sid || ''));
    if (!s || s.vid !== String(req.params.vid)) return res.status(404).json({ error: 'subida', mensaje: 'La subida ya no existe (¿se reinicio el servidor?): vuelve a empezar.' });
    let b = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!b.length) return res.status(400).json({ error: 'vacio', mensaje: 'Trozo vacio.' });
    if (!(b[0] === 0x1f && b[1] === 0x8b)) b = zlib.gzipSync(b);
    try { JSON.parse(zlib.gunzipSync(b).toString('utf8')); } catch (e) { return res.status(400).json({ error: 'formato', mensaje: 'El trozo no es un JSON valido (comprimido o plano).' }); }
    s.n++; s.bytes += b.length; s.t = Date.now();
    fs.writeFileSync(path.join(s.dir, s.n + '.json.gz'), b);
    res.json({ ok: true, n: s.n, bytes: s.bytes });
  });

  // la geometria llega en FLUJO (puede pesar cientos de MB): no pasa por memoria
  app.post('/api/modelos/:pid/:vid/geometria/:sid', llaveOSesion('autor'), (req, res) => {
    const s = SUBIDAS.get(String(req.params.sid || ''));
    if (!s || s.vid !== String(req.params.vid)) return res.status(404).json({ error: 'subida', mensaje: 'La subida ya no existe: vuelve a empezar.' });
    const destino = path.join(s.dir, 'geometria.cdeg'), w = fs.createWriteStream(destino);
    let bytes = 0, primero = null;
    req.on('data', (c) => { bytes += c.length; if (!primero) primero = c.subarray(0, 4).toString('latin1'); });
    req.on('error', () => { try { w.destroy(); } catch (e) {} });
    w.on('finish', () => {
      if (primero !== 'CDEG') { try { fs.unlinkSync(destino); } catch (e) {} return res.status(400).json({ error: 'formato', mensaje: 'La geometria no empieza con la firma CDEG (ver docs/FORMATO-PAQUETE.md).' }); }
      s.geometria = destino; s.t = Date.now(); res.json({ ok: true, bytes });
    });
    w.on('error', (e) => res.status(500).json({ error: 'disco', mensaje: e.message }));
    req.pipe(w);
  });

  app.post('/api/modelos/:pid/:vid/indice/fin/:sid', llaveOSesion('autor'), express.json({ limit: '4mb' }), (req, res) => {
    const s = SUBIDAS.get(String(req.params.sid || ''));
    if (!s || s.vid !== String(req.params.vid)) return res.status(404).json({ error: 'subida', mensaje: 'La subida ya no existe: vuelve a empezar.' });
    SUBIDAS.delete(req.params.sid);
    if (!s.n) { rmrf(s.dir); return res.status(400).json({ error: 'sin-trozos', mensaje: 'No llego ningun trozo del indice.' }); }
    const rutaGeo = arma(s);
    res.json({ estado: 'armando', trozos: s.n, bytes: s.bytes, geometria: !!rutaGeo });
  });

  app.get('/api/modelos/:pid/:vid/estado', llaveOSesion('lector'), (req, res) => {
    const v = versionDe(req, res); if (!v) return;
    const i = q.uno('SELECT * FROM indices_modelo WHERE version_id = ?', v.id);
    if (!i) return res.json({ estado: 'sin-indice' });
    const t = TRABAJOS.get(v.id);
    res.json({ estado: i.estado, trozos: i.trozos, bytes: i.bytes, geometria: !!i.ruta_geometria, resumen: JSON.parse(i.resumen || '{}'), error: i.error, fecha: i.fecha, avance: t && t.avance });
  });

  // consultas: las del visor (indice-modelos.js), con los mismos filtros (modelo, cat, fam, tip, niv, ambito)
  const conIndice = (op, args) => (req, res) => {
    const v = versionDe(req, res); if (!v) return;
    const i = q.uno('SELECT * FROM indices_modelo WHERE version_id = ? AND estado = ?', v.id, 'listo');
    if (!i || !fs.existsSync(i.ruta_sqlite)) return res.status(409).json({ error: 'sin-indice', mensaje: 'Esta version aun no tiene indice listo.' });
    try { res.json(I[op](i.ruta_sqlite, ...args(req))); } catch (e) { res.status(500).json({ error: 'indice', mensaje: e.message }); }
  };
  const filtros = (req) => I.filtrosLimpios(req.query || {});
  app.get('/api/modelos/:pid/:vid/tablero', requiereSesion, requiereRol('lector'), conIndice('tablero', (r) => [filtros(r)]));
  app.get('/api/modelos/:pid/:vid/parametros', requiereSesion, requiereRol('lector'), conIndice('parametros', () => []));
  app.get('/api/modelos/:pid/:vid/llenado', requiereSesion, requiereRol('lector'), conIndice('llenado', (r) => [filtros(r), r.query.conCero === '1']));
  app.get('/api/modelos/:pid/:vid/valores', requiereSesion, requiereRol('lector'), conIndice('valores', (r) => [filtros(r), Number(r.query.param) || 0, r.query.conCero === '1', 3000]));
  app.get('/api/modelos/:pid/:vid/inventario', requiereSesion, requiereRol('lector'), conIndice('inventario', (r) => [filtros(r), { cats: r.query.cats, cols: r.query.cols, q: r.query.q }]));

  /**
   * v0.6.2 — EL INDICE ENTERO EN EL NAVEGADOR, como el `props` / IV del Visor BIM Federado (modelos-local.js / exporta-indice.js):
   * los modulos portados de ese visor (Filtro con sectores, Metricas BIM, COBie/Uniclass, Modelos/Planos) leen `props.byParam`
   * (parametro -> valor -> [elementos]) y `props.params`. Se entrega tal cual sale del indice SQLite del visor (tablas attr/val/eav)
   * mas las canonicas "● Categoria / Familia / Tipo / Nivel / Modelo" de la tabla elem. Un parametro con mas de 3000 valores
   * distintos (longitudes, areas...) se omite igual que en el visor; esas cantidades se piden aparte (/cantidades).
   * Formato: { total, params: [nombre...], vals: [texto...], byParam: [[iParam, [[iVal, [e...]], ...]], ...] }
   */
  app.get('/api/modelos/:pid/:vid/props', requiereSesion, requiereRol('lector'), (req, res) => {
    const v = versionDe(req, res); if (!v) return;
    const i = q.uno('SELECT * FROM indices_modelo WHERE version_id = ? AND estado = ?', v.id, 'listo');
    if (!i || !fs.existsSync(i.ruta_sqlite)) return res.status(409).json({ error: 'sin-indice', mensaje: 'Esta version aun no tiene indice listo.' });
    try {
      const db = I.abre(i.ruta_sqlite), TOPE = Number(req.query.tope) || 3000;
      const params = [], vals = [], valIdx = new Map(), byParam = [];
      const iVal = (t) => { let k = valIdx.get(t); if (k == null) { k = vals.length; vals.push(t); valIdx.set(t, k); } return k; };
      // canonicas (de elem), con el prefijo "● " que usan los modulos del visor
      const CAN = { modelo: 'Modelo', cat: 'Categoria', fam: 'Familia', tip: 'Tipo', niv: 'Nivel' }, canon = {};
      for (const k of Object.keys(CAN)) canon[k] = new Map();
      let total = 0;
      for (const r of recorre(db, 'SELECT e, modelo, cat, fam, tip, niv FROM elem WHERE clase = 1')) {
        total++;
        for (const k of Object.keys(CAN)) { const t = String(r[k] || ''); if (!t) continue; let a = canon[k].get(t); if (!a) { a = []; canon[k].set(t, a); } a.push(Number(r.e)); }
      }
      for (const k of ['modelo', 'cat', 'fam', 'tip', 'niv']) { params.push('● ' + CAN[k]); byParam.push([params.length - 1, [...canon[k].entries()].map(([t, es]) => [iVal(t), es])]); }
      const attrs = db.prepare('SELECT a.id, a.nombre, COUNT(DISTINCT eav.v) AS nv FROM attr a JOIN eav ON eav.a = a.id GROUP BY a.id ORDER BY a.nombre COLLATE NOCASE').all();
      const porVal = db.prepare('SELECT val.v AS v, eav.e AS e FROM eav JOIN val ON val.id = eav.v WHERE eav.a = ? ORDER BY eav.v');
      for (const a of attrs) {
        if (Number(a.nv) > TOPE || /^\u25cf/.test(String(a.nombre))) continue;   // las canonicas ya van arriba (de la tabla elem)
        const m = new Map();
        for (const r of recorreSt(porVal, Number(a.id))) { const t = String(r.v == null ? '' : r.v); let l = m.get(t); if (!l) { l = []; m.set(t, l); } l.push(Number(r.e)); }
        if (!m.size) continue;
        params.push(String(a.nombre)); byParam.push([params.length - 1, [...m.entries()].map(([t, es]) => [iVal(t), es])]);
      }
      res.json({ total, params, vals, byParam, omitidos: attrs.filter(a => Number(a.nv) > TOPE).map(a => a.nombre) });
    } catch (e) { res.status(500).json({ error: 'indice', mensaje: e.message }); }
  });
  /** Cantidades (area / longitud / volumen) de unos elementos, leidas de sus parametros (como pideCantidades del visor, que se lo pedia al modelo). */
  app.post('/api/modelos/:pid/:vid/cantidades', requiereSesion, requiereRol('lector'), require('express').json({ limit: '4mb' }), (req, res) => {
    const v = versionDe(req, res); if (!v) return;
    const i = q.uno('SELECT * FROM indices_modelo WHERE version_id = ? AND estado = ?', v.id, 'listo');
    if (!i || !fs.existsSync(i.ruta_sqlite)) return res.status(409).json({ error: 'sin-indice' });
    try {
      const db = I.abre(i.ruta_sqlite), es = (Array.isArray((req.body || {}).e) ? req.body.e : []).map(Number).filter(Number.isFinite).slice(0, 60000);
      const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s*\[.*$/, '').trim();
      const RX = { area: /^(area|superficie)$/, vol: /^(volumen|volume)$/, largo: /^(longitud|length|largo)$/ };
      const casilla = {}; for (const a of db.prepare('SELECT id, nombre FROM attr').all()) { const n = norm(a.nombre); for (const [k, rx] of Object.entries(RX)) if (rx.test(n)) casilla[a.id] = k; }
      const ids = Object.keys(casilla).map(Number), out = {};
      if (ids.length && es.length) {
        const aNum = (x) => { const m = String(x == null ? '' : x).trim().match(/^-?\d[\d.,]*/); if (!m) return null; let t = m[0].replace(/[.,]+$/, ''); const ic = t.lastIndexOf(','), ip = t.lastIndexOf('.'); if (ic >= 0 && ip >= 0) t = ic > ip ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, ''); else if (ic >= 0) t = (t.length - ic - 1) === 3 ? t.replace(',', '') : t.replace(',', '.'); const n = parseFloat(t); return isFinite(n) ? n : null; };
        for (let k = 0; k < es.length; k += 900) { const lote = es.slice(k, k + 900); const st2 = db.prepare('SELECT eav.e AS e, eav.a AS a, val.v AS v FROM eav JOIN val ON val.id = eav.v WHERE eav.a IN (' + ids.map(() => '?').join(',') + ') AND eav.e IN (' + lote.map(() => '?').join(',') + ')'); for (const r of st2.all(...ids, ...lote)) { const n = aNum(r.v); if (n == null) continue; const o = out[r.e] || (out[r.e] = { area: 0, largo: 0, vol: 0 }); o[casilla[r.a]] = n; } }
      }
      res.json({ cantidades: out });
    } catch (e) { res.status(500).json({ error: 'indice', mensaje: e.message }); }
  });
  /** Indice de PLANOS del proyecto para Modelos/Planos (lo que en el visor armaba "Buscar en todo el proyecto > Rehacer indice" sobre Forma): los PDF del CDE con nombre, descripcion, carpeta y version. */
  app.get('/api/proyectos/:pid/planos-indice', requiereSesion, requiereRol('lector'), (req, res) => {
    const filas = q.todos("SELECT c.id AS cid, c.nombre, c.carpeta, c.atributos, v.id AS vid, v.n, v.archivo, v.revision, v.fecha, v.resumen FROM contenedores c JOIN versiones v ON v.contenedor_id = c.id WHERE c.proyecto_id = ? AND c.borrado = '' AND v.n = (SELECT MAX(n) FROM versiones WHERE contenedor_id = c.id) ORDER BY c.carpeta, c.nombre", req.pid)
      .filter(r => /\.pdf$/i.test(r.archivo || '')).map(r => { let at = {}, rs = {}; try { at = JSON.parse(r.atributos || '{}'); } catch (e) {} try { rs = JSON.parse(r.resumen || '{}'); } catch (e) {}
        return { id: r.vid, cid: r.cid, name: r.archivo, nombre: r.nombre, desc: at.descripcion || rs.descripcion || '', ruta: r.carpeta || '', version: r.n, vers: r.n, ext: 'pdf', revision: r.revision, fecha: r.fecha }; });
    res.json({ project: req.pid, cuando: new Date().toISOString(), motor: 'servidor', completo: true, filas, carpetas: new Set(filas.map(f => f.ruta)).size });
  });

  /** Propio del CDE (no esta en el visor): la clasificacion de TODOS los elementos, en columnas, para que el visor liviano
   *  coloree y aisle sin pedir nada mas: { e: [...], modelo: [...], cat: [...], fam: [...], tip: [...], niv: [...] } con
   *  diccionarios (los textos repetidos van una vez). Lee la tabla elem del indice del visor tal cual. */
  app.get('/api/modelos/:pid/:vid/elementos', requiereSesion, requiereRol('lector'), (req, res) => {
    const v = versionDe(req, res); if (!v) return;
    const i = q.uno('SELECT * FROM indices_modelo WHERE version_id = ? AND estado = ?', v.id, 'listo');
    if (!i || !fs.existsSync(i.ruta_sqlite)) return res.status(409).json({ error: 'sin-indice', mensaje: 'Esta version aun no tiene indice listo.' });
    try {
      const db = I.abre(i.ruta_sqlite), dic = {}, out = { e: [], modelo: [], cat: [], fam: [], tip: [], niv: [], nombre: [] };
      const idDe = (col, t) => { const m = dic[col] || (dic[col] = new Map()); let k = m.get(t); if (k == null) { k = m.size; m.set(t, k); } return k; };
      for (const r of recorre(db, 'SELECT e, nombre, modelo, cat, fam, tip, niv FROM elem WHERE clase = 1 ORDER BY e')) {
        out.e.push(Number(r.e)); out.nombre.push(String(r.nombre || ''));
        for (const c of ['modelo', 'cat', 'fam', 'tip', 'niv']) out[c].push(idDe(c, String(r[c] || '')));
      }
      const dics = {}; for (const c of Object.keys(dic)) dics[c] = [...dic[c].keys()];
      res.json({ n: out.e.length, columnas: out, diccionarios: dics });
    } catch (e) { res.status(500).json({ error: 'indice', mensaje: e.message }); }
  });
  /** Las propiedades de UN elemento (lo que muestra el panel al hacer clic). */
  app.get('/api/modelos/:pid/:vid/elemento/:e', requiereSesion, requiereRol('lector'), (req, res) => {
    const v = versionDe(req, res); if (!v) return;
    const i = q.uno('SELECT * FROM indices_modelo WHERE version_id = ? AND estado = ?', v.id, 'listo');
    if (!i || !fs.existsSync(i.ruta_sqlite)) return res.status(409).json({ error: 'sin-indice' });
    try {
      const db = I.abre(i.ruta_sqlite), e = Number(req.params.e) || 0;
      const el = db.prepare('SELECT * FROM elem WHERE e = ?').get(e);
      const props = db.prepare('SELECT attr.nombre AS n, val.v AS v FROM eav JOIN attr ON attr.id = eav.a JOIN val ON val.id = eav.v WHERE eav.e = ? ORDER BY attr.nombre').all(e).map(r => [String(r.n), String(r.v == null ? '' : r.v)]);
      res.json({ elemento: el, propiedades: props });
    } catch (e) { res.status(500).json({ error: 'indice', mensaje: e.message }); }
  });

  /** v0.4 (visor como el Visor BIM Federado): los elementos que tienen ALGUNO de los valores pedidos en un parametro
   *  (o ninguno, con vacio=1) para los filtros "+ Añadir filtro" sobre cualquier parametro del proyecto: { e: [...] }. */
  app.get('/api/modelos/:pid/:vid/elementos-con', requiereSesion, requiereRol('lector'), (req, res) => {
    const v = versionDe(req, res); if (!v) return;
    const i = q.uno('SELECT * FROM indices_modelo WHERE version_id = ? AND estado = ?', v.id, 'listo');
    if (!i || !fs.existsSync(i.ruta_sqlite)) return res.status(409).json({ error: 'sin-indice' });
    try {
      const db = I.abre(i.ruta_sqlite), a = Number(req.query.param) || 0;
      const vals = String(req.query.valores || '').split('\u0001').filter(x => x !== '').slice(0, 500);
      let rows;
      if (req.query.vacio === '1') rows = db.prepare('SELECT el.e AS e FROM elem el WHERE el.clase = 1 AND NOT EXISTS (SELECT 1 FROM eav WHERE eav.e = el.e AND eav.a = ?)').all(a);
      else if (!vals.length) rows = db.prepare('SELECT DISTINCT eav.e AS e FROM eav JOIN elem el ON el.e = eav.e WHERE eav.a = ? AND el.clase = 1').all(a);
      else rows = db.prepare('SELECT DISTINCT eav.e AS e FROM eav JOIN val ON val.id = eav.v JOIN elem el ON el.e = eav.e WHERE eav.a = ? AND el.clase = 1 AND val.v IN (' + vals.map(() => '?').join(',') + ')').all(a, ...vals);
      res.json({ e: rows.map(r => Number(r.e)) });
    } catch (e) { res.status(500).json({ error: 'indice', mensaje: e.message }); }
  });

  /** v0.5 (Niveles / Ambientes y Flujos hospitalarios, como el visor): los AMBIENTES del indice (Habitaciones, Rooms,
   *  Spaces) con sus datos: numero, nombre, nivel, area, CGM_Area Inicial / Normativa, CGM_Subdepartamento (UPSS), codigo.
   *  Las expresiones son las de buildRooms() del visor; aqui el nombre del parametro va sin su grupo ("Cotas / Área" -> "Área"). */
  const RX_AMB = { cat: /^(revit\s+)?(rooms?|habitaci[oó]n(es)?|ambientes?|spaces?|espacios?|mep\s*spaces?|ifcspace)$/i,
    num: /^(number|n[uú]mero|numero|room\s*number|n[uú]m\.?)$/i, name: /^(name|nombre|room\s*name|long\s*name)$/i,
    level: /^(level|nivel|reference\s*level|nivel\s*de\s*referencia|schedule\s*level|planta|storey)$/i, area: /^([aá]rea|area)$/i,
    areaIni: /^CGM_?\s*Area\s*Inicial$/i, areaNorma: /^CGM_?\s*Area\s*Normativa$/i, subdep: /^CGM_?\s*Subdepartamento$/i, cod: /(^|[_\s])C[OÓ]DIGO[\s_]*(DE[\s_]*)?AMBIENTE$/i, dep: /^(department|departamento)$/i };
  const RX_PUERTA = { cat: /^(revit\s+)?(puertas?|doors?)$/i, ancho: /^(ancho|width|anchura|ancho de hoja|ancho de paso|ancho libre|clear width|rough width|ancho en bruto)$/i };
  const corto = (n) => { const i = String(n).lastIndexOf(' / '); return i >= 0 ? String(n).slice(i + 3).trim() : String(n).trim(); };
  /** Un valor con unidad ("0.90 m", "900 mm", "90 cm", "2' 11\"") a metros, o 0. Pura. */
  function metrosDe(v) {
    const s = String(v == null ? '' : v).trim().replace(',', '.');
    const m = /^(-?\d+(?:\.\d+)?)\s*(mm|cm|m|ft|in|'|")?/i.exec(s); if (!m) return 0;
    const n = parseFloat(m[1]), u = (m[2] || '').toLowerCase();
    if (!(n > 0)) return 0;
    if (u === 'mm') return n / 1000; if (u === 'cm') return n / 100; if (u === 'ft' || u === "'") return n * 0.3048; if (u === 'in' || u === '"') return n * 0.0254;
    return n >= 50 ? n / 1000 : n >= 8 ? n / 100 : n;   // sin unidad: 900 -> mm, 90 -> cm, 0.9 -> m
  }
  function elementosDeCategoria(db, rx) {
    const out = []; for (const r of recorre(db, 'SELECT e, nombre, cat, niv FROM elem WHERE clase = 1')) if (rx.test(String(r.cat || '').trim())) out.push({ e: Number(r.e), nombre: String(r.nombre || ''), cat: String(r.cat || ''), niv: String(r.niv || '') });
    return out;
  }
  /** Los valores de los parametros cuyo nombre corto cumple alguna de las expresiones, por elemento: Map e -> { clave: valor }. */
  function paramsPorRegex(db, es, rxs) {
    const attrs = db.prepare('SELECT id, nombre FROM attr').all().map(a => { const c = corto(a.nombre); for (const k in rxs) if (rxs[k].test(c)) return { id: Number(a.id), k, nombre: String(a.nombre) }; return null; }).filter(Boolean);
    const set = new Set(es), out = new Map(); if (!attrs.length) return out;
    for (const a of attrs) for (const r of recorre(db, 'SELECT eav.e AS e, val.v AS v FROM eav JOIN val ON val.id = eav.v WHERE eav.a = ?', a.id)) {
      const e = Number(r.e); if (!set.has(e)) continue;
      let o = out.get(e); if (!o) { o = {}; out.set(e, o); }
      if (o[a.k] === undefined || o[a.k] === '') { o[a.k] = String(r.v || ''); o[a.k + '_de'] = a.nombre; }
    }
    return out;
  }
  app.get('/api/modelos/:pid/:vid/ambientes', requiereSesion, requiereRol('lector'), (req, res) => {
    const v = versionDe(req, res); if (!v) return;
    const i = q.uno('SELECT * FROM indices_modelo WHERE version_id = ? AND estado = ?', v.id, 'listo');
    if (!i || !fs.existsSync(i.ruta_sqlite)) return res.status(409).json({ error: 'sin-indice' });
    try {
      const db = I.abre(i.ruta_sqlite), L = elementosDeCategoria(db, RX_AMB.cat);
      const P = paramsPorRegex(db, L.map(x => x.e), { num: RX_AMB.num, name: RX_AMB.name, level: RX_AMB.level, area: RX_AMB.area, areaIni: RX_AMB.areaIni, areaNorma: RX_AMB.areaNorma, subdep: RX_AMB.subdep, cod: RX_AMB.cod, dep: RX_AMB.dep });
      const ambientes = L.map(x => { const p = P.get(x.e) || {}; const nombre = (p.name || x.nombre.replace(/\s*\[\d+\]\s*$/, '') || ('Ambiente ' + x.e)).trim(); return { e: x.e, nombre, num: p.num || '', nivel: p.level || x.niv || '', area: p.area || '', areaIni: p.areaIni || '', areaNorma: p.areaNorma || '', subdep: p.subdep || p.dep || '', cod: (p.cod || '').trim(), cat: x.cat }; });
      ambientes.sort((a, b) => a.nivel.localeCompare(b.nivel, 'es') || a.num.localeCompare(b.num, 'es', { numeric: true }) || a.nombre.localeCompare(b.nombre, 'es'));
      res.json({ ambientes });
    } catch (e) { res.status(500).json({ error: 'indice', mensaje: e.message }); }
  });
  /** v0.5: las PUERTAS del indice con su ancho en metros (del parametro Ancho / Width si lo tiene; si no, 0 y el visor usa su caja). */
  app.get('/api/modelos/:pid/:vid/puertas', requiereSesion, requiereRol('lector'), (req, res) => {
    const v = versionDe(req, res); if (!v) return;
    const i = q.uno('SELECT * FROM indices_modelo WHERE version_id = ? AND estado = ?', v.id, 'listo');
    if (!i || !fs.existsSync(i.ruta_sqlite)) return res.status(409).json({ error: 'sin-indice' });
    try {
      const db = I.abre(i.ruta_sqlite), L = elementosDeCategoria(db, RX_PUERTA.cat), P = paramsPorRegex(db, L.map(x => x.e), { ancho: RX_PUERTA.ancho });
      res.json({ puertas: L.map(x => { const p = P.get(x.e) || {}; const m = metrosDe(p.ancho); return { e: x.e, nombre: x.nombre, niv: x.niv, ancho: m, anchoDe: m ? 'parámetro «' + corto(p.ancho_de) + '»' : '' }; }) });
    } catch (e) { res.status(500).json({ error: 'indice', mensaje: e.message }); }
  });
  /** v0.5: la configuracion de Flujos hospitalarios del proyecto (relaciones exigidas, reglas de clases, maximo a la salida,
   *  ancho de camilla, salidas marcadas a mano): la lee cualquiera, la guarda el gestor; va en config.flujosHospitalarios. */
  app.get('/api/proyectos/:pid/flujos-hospitalarios', requiereSesion, requiereRol('lector'), (req, res) => {
    const p = q.uno('SELECT config FROM proyectos WHERE id = ?', req.pid); let cfg = {}; try { cfg = JSON.parse(p.config || '{}'); } catch (e) {}
    res.json({ config: cfg.flujosHospitalarios || null, puedeGuardar: ['gestor', 'administrador'].includes(req.rol) });
  });
  app.put('/api/proyectos/:pid/flujos-hospitalarios', requiereSesion, requiereRol('gestor'), express.json({ limit: '1mb' }), (req, res) => {
    const c = req.body && req.body.config; if (!c || typeof c !== 'object') return res.status(400).json({ error: 'datos' });
    const limpio = { relaciones: Array.isArray(c.relaciones) ? c.relaciones.slice(0, 200).map(r => ({ a: String(r.a || '').slice(0, 80), b: String(r.b || '').slice(0, 80), tipo: ['directa', 'cercana', 'indirecta'].includes(r.tipo) ? r.tipo : 'cercana', maxM: Math.max(0, Number(r.maxM) || 0), nota: String(r.nota || '').slice(0, 200), mismoNivel: !!r.mismoNivel })).filter(r => r.a && r.b) : [],
      clases: {}, maxSalidaM: Math.max(0, Number(c.maxSalidaM) || 0), anchoCamillaM: Math.max(0, Number(c.anchoCamillaM) || 0), salidasExcluidas: (Array.isArray(c.salidasExcluidas) ? c.salidasExcluidas : []).map(Number).filter(Boolean).slice(0, 500), salidasExtra: (Array.isArray(c.salidasExtra) ? c.salidasExtra : []).map(Number).filter(Boolean).slice(0, 500), por: String(req.quien || ''), cuando: new Date().toISOString() };
    if (c.clases && typeof c.clases === 'object') for (const k of Object.keys(c.clases).slice(0, 20)) { const t = String(c.clases[k] || '').slice(0, 500); try { new RegExp(t, 'i'); } catch (e) { return res.status(400).json({ error: 'regla', mensaje: 'La regla de «' + k + '» no es una expresión válida.' }); } if (t) limpio.clases[k] = t; }
    const p = q.uno('SELECT config FROM proyectos WHERE id = ?', req.pid); let cfg = {}; try { cfg = JSON.parse(p.config || '{}'); } catch (e) {}
    cfg.flujosHospitalarios = limpio; q.corre('UPDATE proyectos SET config = ? WHERE id = ?', JSON.stringify(cfg), req.pid);
    audita(req.quien, 'flujos.config', req.pid, '', { relaciones: limpio.relaciones.length }); res.json({ ok: true, config: limpio });
  });

  /** v0.4: comparar dos versiones (a = antigua, b = nueva) del mismo contenedor por UniqueId (lib/comparar.js). */
  app.get('/api/modelos/:pid/comparar', requiereSesion, requiereRol('lector'), (req, res) => {
    const pid = String(req.params.pid || ''), ver = (vid) => q.uno('SELECT v.*, c.proyecto_id, c.nombre AS contenedor FROM versiones v JOIN contenedores c ON c.id = v.contenedor_id WHERE v.id = ? AND c.proyecto_id = ?', String(vid || ''), pid);
    const a = ver(req.query.a), b = ver(req.query.b);
    if (!a || !b) return res.status(404).json({ error: 'no-existe', mensaje: 'Elige dos versiones de este proyecto.' });
    if (a.id === b.id) return res.status(400).json({ error: 'misma', mensaje: 'Elige dos versiones distintas.' });
    const ia = q.uno('SELECT * FROM indices_modelo WHERE version_id = ? AND estado = ?', a.id, 'listo'), ib = q.uno('SELECT * FROM indices_modelo WHERE version_id = ? AND estado = ?', b.id, 'listo');
    if (!ia || !ib || !fs.existsSync(ia.ruta_sqlite) || !fs.existsSync(ib.ruta_sqlite)) return res.status(409).json({ error: 'sin-indice', mensaje: 'Las dos versiones necesitan su indice listo.' });
    try {
      const r = require('./comparar').comparaConCache(ia.ruta_sqlite, ib.ruta_sqlite, a.id);
      const cab = (v) => ({ id: v.id, n: v.n, revision: v.revision, archivo: v.archivo, fecha: v.fecha, contenedor: v.contenedor, contenedor_id: v.contenedor_id });
      if (req.query.formato === 'csv') {
        const F = require('./comparar').filas(r, { conIguales: req.query.iguales === '1' });
        const csv = '﻿' + F.map(f => f.map(c => '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"').join(';')).join('\r\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', 'attachment; filename="comparacion-' + saneo(b.contenedor) + '-v' + a.n + '-v' + b.n + '.csv"'); return res.send(csv);
      }
      audita(req.quien, 'modelo.comparar', pid, b.contenedor_id, { a: a.n, b: b.n, mismo: a.contenedor_id === b.contenedor_id });
      res.json(Object.assign({ a: cab(a), b: cab(b), mismoContenedor: a.contenedor_id === b.contenedor_id }, r));
    } catch (e) { res.status(500).json({ error: 'comparar', mensaje: e.message }); }
  });

  app.get('/api/modelos/:pid/:vid/geometria', requiereSesion, requiereRol('lector'), (req, res) => {
    const v = versionDe(req, res); if (!v) return;
    const i = q.uno('SELECT ruta_geometria FROM indices_modelo WHERE version_id = ?', v.id);
    if (!i || !i.ruta_geometria || !fs.existsSync(i.ruta_geometria)) return res.status(404).json({ error: 'sin-geometria', mensaje: 'Esta version no trae geometria liviana.' });
    res.setHeader('Content-Type', 'application/octet-stream'); res.setHeader('Cache-Control', 'no-store');   // un modelo se puede volver a procesar: el navegador no debe guardar la geometria anterior
    // v0.27.0 · ?partes=0,3,5: solo esas partes del modelo, con todo su detalle, compuestas en flujo desde el .cdeg completo
    if (req.query.partes !== undefined) {
      const mapa = PT.leeMapa(i.ruta_geometria); if (!mapa) return res.status(409).json({ error: 'sin-partes', mensaje: 'El modelo aún no está dividido en partes.' });
      const sel = String(req.query.partes).split(',').map(Number).filter(k => Number.isInteger(k) && k >= 0 && k < mapa.partes.length);
      if (!sel.length) return res.status(400).json({ error: 'partes', mensaje: 'Indica al menos una parte del modelo.' });
      const gz = /\bgzip\b/.test(String(req.headers['accept-encoding'] || '')) ? zlib.createGzip({ level: 1 }) : null;
      if (gz) { res.setHeader('Content-Encoding', 'gzip'); res.setHeader('Vary', 'Accept-Encoding'); gz.pipe(res); }
      const sale = gz || res; res.on('close', () => { if (gz) gz.destroy(); });
      PT.compone(i.ruta_geometria, mapa, sel, sale).then(() => sale.end(), (e) => { console.error('[partes]', e.message); try { res.destroy(); } catch (x) {} });
      return;
    }
    // v0.9.15: comprimida (un federado pesa cientos de MB; los indices y colores se comprimen bien). Se guarda la copia .gz junto a la
    // geometria la primera vez y se reusa mientras sea mas nueva; el navegador la descomprime solo (Content-Encoding).
    if (/\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) {
      const gz = i.ruta_geometria + '.gz';
      let fresca = false; try { fresca = fs.statSync(gz).mtimeMs >= fs.statSync(i.ruta_geometria).mtimeMs; } catch (e) {}
      res.setHeader('Content-Encoding', 'gzip'); res.setHeader('Vary', 'Accept-Encoding');
      if (fresca) return fs.createReadStream(gz).pipe(res);
      const tmp = gz + '.' + process.pid + '.tmp', comp = zlib.createGzip({ level: 4 }), archivo = fs.createWriteStream(tmp);
      comp.on('data', (b) => archivo.write(b)); comp.on('end', () => archivo.end(() => { try { fs.renameSync(tmp, gz); } catch (e) { try { fs.rmSync(tmp, { force: true }); } catch (e2) {} } }));
      fs.createReadStream(i.ruta_geometria).pipe(comp).pipe(res);
      return;
    }
    fs.createReadStream(i.ruta_geometria).pipe(res);
  });

  /**
   * v0.27.0 · PARTES DEL MODELO. Un modelo con más triángulos que CDE_PARTES_MIN (3 millones) se sirve por partes (niveles y sus
   * sectores): el visor carga las que el usuario elige, completas. El mapa se arma una vez, en un hilo aparte.
   */
  const PARTES_MIN = Number(process.env.CDE_PARTES_MIN) || 3000000, PARTES_MAX = Number(process.env.CDE_PARTES_TRI) || 2000000, DIVIDIENDO = new Map();
  app.get('/api/modelos/:pid/:vid/partes', requiereSesion, requiereRol('lector'), (req, res) => {
    const v = versionDe(req, res); if (!v) return;
    const i = q.uno('SELECT ruta_geometria, ruta_sqlite, estado FROM indices_modelo WHERE version_id = ?', v.id);
    if (!i || !i.ruta_geometria || !fs.existsSync(i.ruta_geometria)) return res.json({ aplica: false });
    let tri = 0; try { const fd = fs.openSync(i.ruta_geometria, 'r'); try { tri = PT.cabecera(fd).nIdx / 3; } finally { fs.closeSync(fd); } } catch (e) { return res.json({ aplica: false }); }
    if (tri <= PARTES_MIN) return res.json({ aplica: false, triangulos: tri });
    const mapa = PT.leeMapa(i.ruta_geometria);
    if (mapa) return res.json({ aplica: true, estado: 'listo', total: mapa.total, partes: mapa.partes.map(p => ({ n: p.n, grupo: p.grupo, etiqueta: p.etiqueta, elementos: p.elementos, triangulos: p.triangulos, caja: p.caja })) });
    const d = DIVIDIENDO.get(v.id);
    if (d && d.error) { DIVIDIENDO.delete(v.id); return res.json({ aplica: true, estado: 'error', error: d.error }); }
    if (!d) {
      const t = { desde: Date.now(), error: '' }; DIVIDIENDO.set(v.id, t);
      let w; try { w = new Worker(path.join(__dirname, 'trabajador-partes.js'), { workerData: { geometria: i.ruta_geometria, indice: i.ruta_sqlite && fs.existsSync(i.ruta_sqlite) ? i.ruta_sqlite : '', maxTri: PARTES_MAX } }); } catch (e) { DIVIDIENDO.delete(v.id); return res.json({ aplica: true, estado: 'error', error: e.message }); }
      w.on('message', (m) => { if (m.ok) { DIVIDIENDO.delete(v.id); audita('sistema', 'modelo.partes', req.pid, v.id, { partes: m.partes, triangulos: tri }); } else t.error = m.error || 'no se pudo dividir'; });
      w.on('error', (e) => { t.error = e.message; });
    }
    res.json({ aplica: true, estado: 'dividiendo', triangulos: tri });
  });

  // limpieza de subidas abandonadas (30 min)
  setInterval(() => { for (const [sid, s] of SUBIDAS) if (Date.now() - s.t > 30 * 60000) { rmrf(s.dir); SUBIDAS.delete(sid); } }, 60000).unref();
}

const saneo = (s) => String(s || '').replace(/[^A-Za-z0-9_-]/g, '_');
const rmrf = (d) => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} };

module.exports = { monta };
