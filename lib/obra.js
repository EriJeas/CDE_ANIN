/*
 * SEGUIMIENTO DE OBRA (v0.10.0): la gestion en campo sobre los documentos del CDE.
 *
 *  - PLANOS: no se suben aparte. Son los PDF que ya estan en Documentos de proyecto; aqui se registran en una coleccion y una
 *    carpeta de obra (p. ej. «Paquete 11 › Arquitectura»). Siempre se abre la version vigente del documento.
 *  - TAREAS: numeradas por proyecto, con estado (Prioridad 1, 2, 3 · Completado · Comprobado), categoria, responsable, ubicacion,
 *    fechas, mano de obra (horas), coste, etiquetas, observadores, checklist, tareas relacionadas y su posicion sobre un plano
 *    (x, y relativos a la hoja). Cada cambio queda en la actividad de la tarea, junto con mensajes y fotos.
 *  - FOTOS: de una tarea o sueltas; se guardan en el almacen del CDE.
 *  - PARTES DIARIOS: fecha, clima, personal, actividades con % de avance y notas, fotos y firma; al enviarlos quedan cerrados.
 *  - PRESUPUESTO: partidas (codigo, descripcion, presupuesto, ejecutado) y, al lado, el coste y las horas registrados en las tareas.
 *  - Lo demas de la obra ya vive en otros modulos del CDE y aqui solo se enlaza: especificaciones y archivos (Documentos),
 *    consultas (Comunicaciones contractuales), entregas (Revision contractual) y cambios (Alertas tempranas y Eventos compensables).
 *  Permisos: leer = lector; crear y editar = miembro / autor; borrar y configurar = gestor (o quien creo el elemento).
 */
'use strict';
const { q, json, id, ahora, audita } = require('./bd');
const { RANGO_ROL } = require('./iso19650');
const CAR = require('./carpetas');

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS obra_config (proyecto_id TEXT PRIMARY KEY, datos TEXT DEFAULT '{}');
CREATE TABLE IF NOT EXISTS obra_planos (
  proyecto_id TEXT NOT NULL, contenedor_id TEXT NOT NULL, coleccion TEXT DEFAULT '', carpeta TEXT DEFAULT '', orden INTEGER DEFAULT 0,
  agregado TEXT NOT NULL, por TEXT NOT NULL, PRIMARY KEY (proyecto_id, contenedor_id));
CREATE TABLE IF NOT EXISTS obra_tareas (
  id TEXT PRIMARY KEY, proyecto_id TEXT NOT NULL, numero INTEGER NOT NULL, titulo TEXT DEFAULT '', estado TEXT NOT NULL DEFAULT 'p2',
  categoria TEXT DEFAULT '', responsable TEXT DEFAULT '', plano_id TEXT DEFAULT '', pagina INTEGER DEFAULT 1, x REAL, y REAL,
  ubicacion TEXT DEFAULT '', inicio TEXT DEFAULT '', fin TEXT DEFAULT '', horas REAL DEFAULT 0, costo REAL DEFAULT 0,
  etiquetas TEXT DEFAULT '[]', observadores TEXT DEFAULT '[]', checklist TEXT DEFAULT '[]', relacionadas TEXT DEFAULT '[]',
  creada TEXT NOT NULL, creada_por TEXT NOT NULL, actualizada TEXT NOT NULL, borrada TEXT DEFAULT '');
CREATE INDEX IF NOT EXISTS ix_obra_tareas ON obra_tareas (proyecto_id, borrada);
CREATE TABLE IF NOT EXISTS obra_actividad (
  id TEXT PRIMARY KEY, proyecto_id TEXT NOT NULL, tarea_id TEXT NOT NULL, autor TEXT NOT NULL, fecha TEXT NOT NULL,
  tipo TEXT NOT NULL, texto TEXT DEFAULT '', foto_id TEXT DEFAULT '');
CREATE INDEX IF NOT EXISTS ix_obra_act ON obra_actividad (tarea_id);
CREATE TABLE IF NOT EXISTS obra_fotos (
  id TEXT PRIMARY KEY, proyecto_id TEXT NOT NULL, tarea_id TEXT DEFAULT '', parte_id TEXT DEFAULT '', autor TEXT NOT NULL, fecha TEXT NOT NULL,
  nombre TEXT NOT NULL, ruta TEXT NOT NULL, tamano INTEGER DEFAULT 0, mime TEXT DEFAULT '', nota TEXT DEFAULT '', borrada TEXT DEFAULT '');
CREATE INDEX IF NOT EXISTS ix_obra_fotos ON obra_fotos (proyecto_id, borrada);
CREATE TABLE IF NOT EXISTS obra_partes (
  id TEXT PRIMARY KEY, proyecto_id TEXT NOT NULL, numero INTEGER NOT NULL, fecha TEXT NOT NULL, titulo TEXT DEFAULT '', estado TEXT NOT NULL DEFAULT 'borrador',
  clima TEXT DEFAULT '', personal TEXT DEFAULT '', actividades TEXT DEFAULT '[]', notas TEXT DEFAULT '', firma TEXT DEFAULT '', firmante TEXT DEFAULT '',
  enviado TEXT DEFAULT '', autor TEXT NOT NULL, creado TEXT NOT NULL, actualizado TEXT NOT NULL, borrado TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS obra_presupuesto (
  id TEXT PRIMARY KEY, proyecto_id TEXT NOT NULL, orden INTEGER DEFAULT 0, codigo TEXT DEFAULT '', descripcion TEXT DEFAULT '',
  grupo TEXT DEFAULT '', presupuesto REAL DEFAULT 0, ejecutado REAL DEFAULT 0);`;

const ESQUEMA2 = `
CREATE TABLE IF NOT EXISTS obra_marcas (
  id TEXT PRIMARY KEY, proyecto_id TEXT NOT NULL, plano_id TEXT NOT NULL, pagina INTEGER DEFAULT 1, tipo TEXT NOT NULL, datos TEXT DEFAULT '{}',
  autor TEXT NOT NULL, fecha TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_obra_marcas ON obra_marcas (proyecto_id, plano_id);
CREATE TABLE IF NOT EXISTS obra_tomas (
  id TEXT PRIMARY KEY, proyecto_id TEXT NOT NULL, foto_id TEXT NOT NULL, visita TEXT NOT NULL, plano_id TEXT DEFAULT '', x REAL, y REAL,
  codigo TEXT DEFAULT '', nombre TEXT DEFAULT '', autor TEXT NOT NULL, fecha TEXT NOT NULL, borrada TEXT DEFAULT '');
CREATE INDEX IF NOT EXISTS ix_obra_tomas ON obra_tomas (proyecto_id, borrada);
CREATE TABLE IF NOT EXISTS obra_registros (
  id TEXT PRIMARY KEY, proyecto_id TEXT NOT NULL, tipo TEXT NOT NULL, numero INTEGER NOT NULL, titulo TEXT DEFAULT '', estado TEXT NOT NULL,
  datos TEXT DEFAULT '{}', creado TEXT NOT NULL, creado_por TEXT NOT NULL, actualizado TEXT NOT NULL, borrado TEXT DEFAULT '');
CREATE INDEX IF NOT EXISTS ix_obra_reg ON obra_registros (proyecto_id, tipo, borrado);
CREATE TABLE IF NOT EXISTS obra_nube (
  id TEXT PRIMARY KEY, proyecto_id TEXT NOT NULL, url TEXT NOT NULL, proveedor TEXT DEFAULT '', contenedor_id TEXT DEFAULT '', nombre TEXT DEFAULT '',
  sha256 TEXT DEFAULT '', sincronizado TEXT DEFAULT '', error TEXT DEFAULT '', coleccion TEXT DEFAULT '', carpeta TEXT DEFAULT '', por TEXT NOT NULL, creado TEXT NOT NULL);`;
const ESQUEMA3 = `
CREATE TABLE IF NOT EXISTS obra_planes (
  id TEXT PRIMARY KEY, proyecto_id TEXT NOT NULL, tipo TEXT NOT NULL, nombre TEXT NOT NULL, formato TEXT DEFAULT '', archivo TEXT DEFAULT '', tabla_id TEXT DEFAULT '',
  datos TEXT NOT NULL DEFAULT '[]', actividades INTEGER DEFAULT 0, inicio TEXT DEFAULT '', fin TEXT DEFAULT '', avance REAL DEFAULT 0, criticas INTEGER DEFAULT 0,
  creado TEXT NOT NULL, por TEXT NOT NULL, actualizado TEXT NOT NULL, borrado TEXT DEFAULT '');
CREATE INDEX IF NOT EXISTS ix_obra_planes ON obra_planes (proyecto_id, borrado);
`;
const COLUMNAS = [['obra_planos', 'tipo', "TEXT DEFAULT 'plano'"], ['obra_planos', 'seccion', "TEXT DEFAULT ''"], ['obra_fotos', 'es360', 'INTEGER DEFAULT 0'], ['obra_tomas', 'tipo', "TEXT DEFAULT 'piso'"], ['obra_fotos', 'ambiente', "TEXT DEFAULT ''"]];

/** Consultas (RFI) y ordenes de cambio: estados, quien puede pasar a cada uno y campos de cada tipo. */
const REGISTROS = {
  rfi: { nombre: 'Consulta', estados: [['borrador', 'Borrador'], ['abierta', 'Abierta'], ['respondida', 'Respondida'], ['cerrada', 'Cerrada']], inicial: 'borrador',
    campos: { pregunta: 6000, para: 160, vence: 'dia', plano_id: 80, tarea_id: 80, disciplina: 80, impactoCosto: 'bool', impactoPlazo: 'bool', respuesta: 6000 } },
  cambio: { nombre: 'Orden de cambio', estados: [['borrador', 'Borrador'], ['solicitada', 'Solicitada'], ['pendiente', 'Pendiente'], ['aprobada', 'Aprobada'], ['rechazada', 'Rechazada']], inicial: 'borrador',
    campos: { descripcion: 6000, motivo: 300, monto: 'num', dias: 'num', vence: 'dia', rfi_id: 80, tarea_id: 80, partidas: 'partidas' } }
};

const ESTADOS = [['p1', 'Prioridad 1'], ['p2', 'Prioridad 2'], ['p3', 'Prioridad 3'], ['completado', 'Completado'], ['comprobado', 'Comprobado']];
const ETQ_ESTADO = Object.fromEntries(ESTADOS);
const CONFIG0 = () => ({ categorias: ['Arquitectura', 'Estructuras', 'Instalaciones sanitarias', 'Instalaciones eléctricas', 'Instalaciones mecánicas', 'Equipamiento', 'Seguridad', 'Calidad'], ubicaciones: [], moneda: 'S/' });
const txt = (v, n) => String(v == null ? '' : v).trim().slice(0, n || 300);
const numero = (v) => { const n = Number(String(v == null ? '' : v).replace(',', '.')); return isFinite(n) && n >= 0 ? n : 0; };
const dia = (v) => { const s = String(v || '').trim(); if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10); const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s); return m ? (m[3].length === 2 ? '20' + m[3] : m[3]) + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0') : ''; };
const lista = (v, n) => (Array.isArray(v) ? v : String(v || '').split(/[,;]/)).map(x => txt(x, 80)).filter(Boolean).slice(0, n || 30);
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic', mp4: 'video/mp4', mov: 'video/quicktime' };

function monta(app, ctx) {
  const { requiereSesion, requiereRol, express, almacen } = ctx;
  const DB = require('./bd').db; DB.exec(ESQUEMA); DB.exec(ESQUEMA2); DB.exec(ESQUEMA3);
  for (const [t, c, d] of COLUMNAS) { if (!DB.prepare('PRAGMA table_info(' + t + ')').all().some(x => x.name === c)) DB.exec('ALTER TABLE ' + t + ' ADD COLUMN ' + c + ' ' + d); }
  const I = ctx.cdeInterno;   // permisos por carpeta del CDE: un plano solo lo ve quien puede leer su carpeta
  const J = express.json({ limit: '4mb' }), CRUDO = express.raw({ type: () => true, limit: '60mb' });
  const P = '/api/proyectos/:pid/obra';
  const puede = (req, min) => (RANGO_ROL[req.rol] || 0) >= RANGO_ROL[min];
  const config = (pid) => Object.assign(CONFIG0(), json((q.uno('SELECT datos FROM obra_config WHERE proyecto_id = ?', pid) || {}).datos, {}));
  const guardaConfig = (pid, c) => q.corre('INSERT INTO obra_config (proyecto_id, datos) VALUES (?,?) ON CONFLICT(proyecto_id) DO UPDATE SET datos = excluded.datos', pid, JSON.stringify(c));
  const anota = (pid, tid, autor, tipo, texto, foto) => q.corre('INSERT INTO obra_actividad (id, proyecto_id, tarea_id, autor, fecha, tipo, texto, foto_id) VALUES (?,?,?,?,?,?,?,?)', id('oa'), pid, tid, autor, ahora(), tipo, txt(texto, 4000), foto || '');

  // ───────── planos: los PDF del CDE registrados para la obra
  const SQL_PLANO = `SELECT c.id, c.nombre, c.carpeta AS carpeta_cde, c.estado, v.id AS version_id, v.n, v.revision, v.archivo, v.tamano, v.fecha
    FROM contenedores c JOIN versiones v ON v.contenedor_id = c.id AND v.n = c.version_actual WHERE c.proyecto_id = ? AND c.borrado = '' AND lower(v.extension) IN ('pdf', '.pdf')`;
  const planoDe = (pid, cid) => q.uno(SQL_PLANO + ' AND c.id = ?', pid, cid);
  const legibles = (req, docs) => { const p = I.proyecto(req.pid), u = I.yo(req, p); return docs.filter(d => I.permisoEn(p, u, d.carpeta_cde).leer); };
  app.get(P + '/planos', requiereSesion, requiereRol('lector'), (req, res) => {
    const tipo = req.query.tipo === 'espec' ? 'espec' : 'plano';
    const todos = q.todos('SELECT * FROM obra_planos WHERE proyecto_id = ? ORDER BY coleccion, carpeta, seccion, orden, agregado', req.pid), reg = todos.filter(r => (r.tipo || 'plano') === tipo);
    // lo que alguien registra en Seguimiento de obra lo ven todos los usuarios del proyecto, aunque el PDF viva en una carpeta del CDE que no todos leen
    const docs = new Map(q.todos(SQL_PLANO, req.pid).map(d => [d.id, d]));
    const nT = new Map(q.todos("SELECT plano_id, COUNT(*) AS n, SUM(CASE WHEN estado IN ('p1','p2','p3') THEN 1 ELSE 0 END) AS abiertas FROM obra_tareas WHERE proyecto_id = ? AND borrada = '' AND plano_id <> '' GROUP BY plano_id", req.pid).map(x => [x.plano_id, x]));
    const planos = reg.filter(r => docs.has(r.contenedor_id)).map(r => Object.assign({}, docs.get(r.contenedor_id), { coleccion: r.coleccion, carpeta: r.carpeta, seccion: r.seccion || '', tipo: r.tipo || 'plano', escala: (config(req.pid).escalas || {})[r.contenedor_id] || null, tareas: (nT.get(r.contenedor_id) || {}).n || 0, abiertas: (nT.get(r.contenedor_id) || {}).abiertas || 0 }));
    const usados = new Set(todos.map(r => r.contenedor_id));
    res.json({ planos, disponibles: req.query.disponibles === '1' ? [...docs.values()].filter(d => !usados.has(d.id)) : undefined });
  });
  app.post(P + '/planos', requiereSesion, requiereRol('autor'), J, (req, res) => {
    const b = req.body || {}, tipo = b.tipo === 'espec' ? 'espec' : 'plano', col = txt(b.coleccion, 80) || (tipo === 'espec' ? 'Especificaciones' : 'General'), car = txt(b.carpeta, 80), sec = txt(b.seccion, 40); let n = 0;
    for (const cid of (Array.isArray(b.contenedores) ? b.contenedores : []).slice(0, 500)) {
      if (!planoDe(req.pid, String(cid))) continue;
      q.corre('INSERT INTO obra_planos (proyecto_id, contenedor_id, coleccion, carpeta, orden, agregado, por, tipo, seccion) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(proyecto_id, contenedor_id) DO UPDATE SET coleccion = excluded.coleccion, carpeta = excluded.carpeta, tipo = excluded.tipo, seccion = excluded.seccion', req.pid, String(cid), col, car, n, ahora(), req.quien, tipo, sec); n++;
    }
    if (n) audita(req.quien, 'obra.planos', req.pid, col + (car ? ' / ' + car : ''), { planos: n });
    res.json({ ok: true, agregados: n });
  });
  app.delete(P + '/planos/:cid', requiereSesion, requiereRol('autor'), (req, res) => {
    q.corre('DELETE FROM obra_planos WHERE proyecto_id = ? AND contenedor_id = ?', req.pid, req.params.cid); res.json({ ok: true });   // las tareas conservan su posicion por si el plano vuelve
  });

  // ───────── configuracion: categorias, ubicaciones y moneda
  /** El PDF de un plano o especificación registrado en Seguimiento de obra (cualquiera de sus versiones), para todos los usuarios del proyecto. */
  app.get(P + '/pdf/:vid', requiereSesion, requiereRol('lector'), (req, res) => {
    const v = q.uno("SELECT v.id, v.n, v.archivo, v.tamano, v.ruta_almacen, v.contenedor_id FROM versiones v JOIN obra_planos o ON o.contenedor_id = v.contenedor_id AND o.proyecto_id = ? JOIN contenedores c ON c.id = v.contenedor_id AND c.proyecto_id = ? AND c.borrado = '' WHERE v.id = ?", req.pid, req.pid, String(req.params.vid));
    if (!v || !almacen.existe(v.ruta_almacen)) return res.status(404).json({ error: 'no-existe', mensaje: 'Ese archivo no está registrado en Seguimiento de obra.' });
    res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', 'inline; filename*=UTF-8\'\'' + encodeURIComponent(v.archivo)); if (v.tamano) res.setHeader('Content-Length', v.tamano);
    almacen.flujo(v.ruta_almacen).pipe(res);
  });
  app.get(P + '/config', requiereSesion, requiereRol('lector'), (req, res) => res.json({ config: config(req.pid), estados: ESTADOS }));
  app.put(P + '/config', requiereSesion, requiereRol('autor'), J, (req, res) => {
    const b = req.body || {}, c = config(req.pid);
    if (b.categorias !== undefined) c.categorias = lista(b.categorias, 60);
    if (b.ubicaciones !== undefined) c.ubicaciones = lista(b.ubicaciones, 200);
    if (b.moneda !== undefined) c.moneda = txt(b.moneda, 6) || 'S/';
    guardaConfig(req.pid, c); res.json({ ok: true, config: c });
  });

  // ───────── tareas
  const abreT = (t) => t && Object.assign(t, { etiquetas: json(t.etiquetas, []), observadores: json(t.observadores, []), checklist: json(t.checklist, []), relacionadas: json(t.relacionadas, []), estadoTxt: ETQ_ESTADO[t.estado] || t.estado });
  const tareaDe = (pid, tid) => abreT(q.uno("SELECT * FROM obra_tareas WHERE proyecto_id = ? AND id = ? AND borrada = ''", pid, tid));
  const sigNumero = (pid, tabla) => ((q.uno('SELECT MAX(numero) AS n FROM ' + tabla + ' WHERE proyecto_id = ?', pid) || {}).n || 0) + 1;
  /** Normaliza lo que llega del formulario o de una fila importada. */
  function campos(pid, b, base) {
    const o = {};
    if (b.titulo !== undefined) o.titulo = txt(b.titulo, 300);
    if (b.estado !== undefined) { const e = String(b.estado).trim().toLowerCase(), hit = ESTADOS.find(x => x[0] === e || x[1].toLowerCase() === e) || (/^\d$/.test(e) && ESTADOS[Number(e) - 1 > 2 ? 1 : Number(e) - 1]); o.estado = hit ? hit[0] : (base ? base.estado : 'p2'); }
    if (b.categoria !== undefined) o.categoria = txt(b.categoria, 80);
    if (b.responsable !== undefined) o.responsable = txt(b.responsable, 160).toLowerCase();
    if (b.ubicacion !== undefined) o.ubicacion = txt(b.ubicacion, 160);
    if (b.inicio !== undefined) o.inicio = dia(b.inicio);
    if (b.fin !== undefined) o.fin = dia(b.fin);
    if (b.horas !== undefined) o.horas = numero(b.horas);
    if (b.costo !== undefined) o.costo = numero(b.costo);
    if (b.etiquetas !== undefined) o.etiquetas = JSON.stringify(lista(b.etiquetas, 20));
    if (b.observadores !== undefined) o.observadores = JSON.stringify(lista(b.observadores, 40).map(x => x.toLowerCase()));
    if (b.checklist !== undefined) o.checklist = JSON.stringify((Array.isArray(b.checklist) ? b.checklist : []).slice(0, 100).map(x => ({ texto: txt(x.texto, 300), hecho: !!x.hecho })).filter(x => x.texto));
    if (b.relacionadas !== undefined) o.relacionadas = JSON.stringify(lista(b.relacionadas, 30).filter(x => !base || x !== base.id));
    if (b.plano_id !== undefined) { o.plano_id = b.plano_id && planoDe(pid, String(b.plano_id)) ? String(b.plano_id) : ''; o.pagina = Math.max(1, parseInt(b.pagina, 10) || 1); const x = Number(b.x), y = Number(b.y); o.x = isFinite(x) ? Math.min(1, Math.max(0, x)) : null; o.y = isFinite(y) ? Math.min(1, Math.max(0, y)) : null; }
    return o;
  }
  function creaTarea(pid, quien, b) {
    const c = campos(pid, b, null), t = { id: id('ot'), numero: sigNumero(pid, 'obra_tareas'), titulo: '', estado: 'p2', categoria: '', responsable: quien, plano_id: '', pagina: 1, x: null, y: null, ubicacion: '', inicio: '', fin: '', horas: 0, costo: 0, etiquetas: '[]', observadores: '[]', checklist: '[]', relacionadas: '[]' };
    Object.assign(t, c); if (b.responsable === undefined) t.responsable = quien;
    q.corre('INSERT INTO obra_tareas (id, proyecto_id, numero, titulo, estado, categoria, responsable, plano_id, pagina, x, y, ubicacion, inicio, fin, horas, costo, etiquetas, observadores, checklist, relacionadas, creada, creada_por, actualizada) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      t.id, pid, t.numero, t.titulo, t.estado, t.categoria, t.responsable, t.plano_id, t.pagina, t.x, t.y, t.ubicacion, t.inicio, t.fin, t.horas, t.costo, t.etiquetas, t.observadores, t.checklist, t.relacionadas, ahora(), quien, ahora());
    if (t.categoria) { const cf = config(pid); if (!cf.categorias.includes(t.categoria)) { cf.categorias.push(t.categoria); guardaConfig(pid, cf); } }
    return t;
  }
  app.get(P + '/tareas', requiereSesion, requiereRol('lector'), (req, res) => {
    const f = req.query || {}, w = ['proyecto_id = ?', "borrada = ''"], a = [req.pid];
    if (f.plano) { w.push('plano_id = ?'); a.push(String(f.plano)); }
    if (f.categoria) { w.push('categoria = ?'); a.push(String(f.categoria)); }
    let L = q.todos('SELECT * FROM obra_tareas WHERE ' + w.join(' AND ') + ' ORDER BY numero DESC', ...a).map(abreT);
    if (f.vista === 'mias') L = L.filter(t => t.responsable === req.quien);
    if (f.vista === 'observadas') L = L.filter(t => t.observadores.includes(req.quien));
    const fotos = new Map(q.todos("SELECT tarea_id, COUNT(*) AS n FROM obra_fotos WHERE proyecto_id = ? AND borrada = '' AND tarea_id <> '' GROUP BY tarea_id", req.pid).map(x => [x.tarea_id, x.n]));
    const nombres = new Map(q.todos('SELECT c.id, c.nombre FROM contenedores c WHERE c.proyecto_id = ?', req.pid).map(x => [x.id, x.nombre]));
    L.forEach(t => { t.fotos = fotos.get(t.id) || 0; t.plano = t.plano_id ? nombres.get(t.plano_id) || '' : ''; });
    res.json({ tareas: L, estados: ESTADOS, config: config(req.pid) });
  });
  app.post(P + '/tareas', requiereSesion, requiereRol('autor'), J, (req, res) => {
    const t = creaTarea(req.pid, req.quien, req.body || {}); anota(req.pid, t.id, req.quien, 'cambio', 'Tarea creada' + (t.plano_id ? ' sobre el plano' : ''));
    audita(req.quien, 'obra.tarea', req.pid, '#' + t.numero + ' ' + t.titulo, {}); res.json({ ok: true, id: t.id, numero: t.numero });
  });
  app.post(P + '/tareas/importar', requiereSesion, requiereRol('autor'), J, (req, res) => {
    const filas = (Array.isArray((req.body || {}).filas) ? req.body.filas : []).slice(0, 1000); let n = 0;
    for (const f of filas) { if (!txt(f.titulo)) continue; const t = creaTarea(req.pid, req.quien, f); anota(req.pid, t.id, req.quien, 'cambio', 'Tarea importada'); n++; }
    if (n) audita(req.quien, 'obra.tareas.importar', req.pid, n + ' tareas', {});
    res.json({ ok: true, creadas: n, omitidas: filas.length - n });
  });
  app.get(P + '/tareas/:tid', requiereSesion, requiereRol('lector'), (req, res) => {
    const t = tareaDe(req.pid, req.params.tid); if (!t) return res.status(404).json({ error: 'no-existe', mensaje: 'La tarea no existe.' });
    t.actividad = q.todos('SELECT id, autor, fecha, tipo, texto, foto_id FROM obra_actividad WHERE tarea_id = ? ORDER BY fecha', t.id);
    t.fotos = q.todos("SELECT id, nombre, autor, fecha, mime, es360 FROM obra_fotos WHERE tarea_id = ? AND borrada = '' ORDER BY fecha", t.id);
    t.planoDoc = t.plano_id ? planoDe(req.pid, t.plano_id) : null;
    t.relacionadasDet = t.relacionadas.length ? q.todos("SELECT id, numero, titulo, estado FROM obra_tareas WHERE proyecto_id = ? AND borrada = '' AND id IN (" + t.relacionadas.map(() => '?').join(',') + ')', req.pid, ...t.relacionadas) : [];
    t.puedoEditar = puede(req, 'autor'); t.puedoBorrar = puede(req, 'gestor') || t.creada_por === req.quien;
    res.json(t);
  });
  const ROTULO = { titulo: 'Título', estado: 'Estado', categoria: 'Categoría', responsable: 'Responsable', ubicacion: 'Ubicación', inicio: 'La nueva fecha de inicio es', fin: 'La nueva fecha de finalización es', horas: 'Mano de obra', costo: 'Coste', etiquetas: 'Etiquetas', observadores: 'Observadores' };
  app.put(P + '/tareas/:tid', requiereSesion, requiereRol('autor'), J, (req, res) => {
    const t = q.uno("SELECT * FROM obra_tareas WHERE proyecto_id = ? AND id = ? AND borrada = ''", req.pid, req.params.tid); if (!t) return res.status(404).json({ error: 'no-existe' });
    const c = campos(req.pid, req.body || {}, t), claves = Object.keys(c).filter(k => String(c[k] == null ? '' : c[k]) !== String(t[k] == null ? '' : t[k]));
    if (!claves.length) return res.json({ ok: true, cambios: 0 });
    q.corre('UPDATE obra_tareas SET ' + claves.map(k => k + ' = ?').join(', ') + ', actualizada = ? WHERE id = ?', ...claves.map(k => c[k]), ahora(), t.id);
    for (const k of claves) {
      if (k === 'pagina' || k === 'x' || k === 'y') continue;
      const v = k === 'estado' ? ETQ_ESTADO[c.estado] : k === 'horas' ? c.horas + ' horas' : k === 'costo' ? String(c.costo) : (k === 'etiquetas' || k === 'observadores') ? json(c[k], []).join(', ') : c[k];
      anota(req.pid, t.id, req.quien, 'cambio', k === 'plano_id' ? (c.plano_id ? 'Posición en el plano actualizada' : 'Se quitó del plano') : k === 'checklist' ? 'Checklist actualizado' : k === 'relacionadas' ? 'Tareas relacionadas actualizadas' : k === 'inicio' || k === 'fin' ? ROTULO[k] + ' ' + (v || '(sin fecha)') : ROTULO[k] + ' cambiado a ' + (v || '(vacío)'));
    }
    if (c.categoria) { const cf = config(req.pid); if (!cf.categorias.includes(c.categoria)) { cf.categorias.push(c.categoria); guardaConfig(req.pid, cf); } }
    res.json({ ok: true, cambios: claves.length });
  });
  app.delete(P + '/tareas/:tid', requiereSesion, requiereRol('autor'), (req, res) => {
    const t = tareaDe(req.pid, req.params.tid); if (!t) return res.status(404).json({ error: 'no-existe' });
    if (!(puede(req, 'gestor') || t.creada_por === req.quien)) return res.status(403).json({ error: 'sin-permiso', mensaje: 'Solo quien creó la tarea o un gestor puede suprimirla.' });
    q.corre('UPDATE obra_tareas SET borrada = ? WHERE id = ?', ahora(), t.id); audita(req.quien, 'obra.tarea.suprimir', req.pid, '#' + t.numero, {}); res.json({ ok: true });
  });
  app.post(P + '/tareas/:tid/mensaje', requiereSesion, requiereRol('lector'), J, (req, res) => {
    const t = tareaDe(req.pid, req.params.tid), m = txt((req.body || {}).texto, 4000); if (!t || !m) return res.status(400).json({ error: 'datos' });
    anota(req.pid, t.id, req.quien, 'mensaje', m); q.corre('UPDATE obra_tareas SET actualizada = ? WHERE id = ?', ahora(), t.id); res.json({ ok: true });
  });

  // ───────── fotos (de una tarea, de un parte o sueltas)
  async function guardaFoto(req, extra) {
    const nombre = txt(decodeURIComponent(String(req.headers['x-nombre'] || 'foto.jpg')), 180), ext = (nombre.split('.').pop() || '').toLowerCase();
    if (!MIME[ext]) { const e = new Error('Solo se admiten fotos (JPG, PNG, WEBP, GIF, HEIC) y video (MP4, MOV).'); e.status = 400; throw e; }
    if (!Buffer.isBuffer(req.body) || !req.body.length) { const e = new Error('El archivo llegó vacío.'); e.status = 400; throw e; }
    const fid = id('of'), g = await almacen.guarda(req.pid, 'obra-fotos', fid, nombre, req.body);
    q.corre('INSERT INTO obra_fotos (id, proyecto_id, tarea_id, parte_id, autor, fecha, nombre, ruta, tamano, mime, nota, es360) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', fid, req.pid, extra.tarea || '', extra.parte || '', req.quien, ahora(), nombre, g.ruta, g.tamano, MIME[ext], '', extra.es360 || req.query.es360 === '1' ? 1 : 0);
    const amb = txt(extra.ambiente || req.query.ambiente, 160); if (amb) q.corre('UPDATE obra_fotos SET ambiente = ? WHERE id = ?', amb, fid);   // subcarpeta de la galeria
    return { id: fid, nombre };
  }
  const conError = (fn) => (req, res) => fn(req, res).catch(e => res.status(e.status || 500).json({ error: 'foto', mensaje: e.message }));
  app.post(P + '/tareas/:tid/foto', requiereSesion, requiereRol('autor'), CRUDO, conError(async (req, res) => {
    const t = tareaDe(req.pid, req.params.tid); if (!t) return res.status(404).json({ error: 'no-existe' });
    const f = await guardaFoto(req, { tarea: t.id, ambiente: t.ubicacion }); anota(req.pid, t.id, req.quien, 'foto', f.nombre, f.id); q.corre('UPDATE obra_tareas SET actualizada = ? WHERE id = ?', ahora(), t.id); res.json({ ok: true, id: f.id });
  }));
  app.post(P + '/fotos', requiereSesion, requiereRol('autor'), CRUDO, conError(async (req, res) => {
    const parte = txt(req.query.parte, 60), f = await guardaFoto(req, { parte: parte && (q.uno('SELECT id FROM obra_partes WHERE proyecto_id = ? AND id = ?', req.pid, parte) || q.uno('SELECT id FROM obra_registros WHERE proyecto_id = ? AND id = ?', req.pid, parte)) ? parte : '' }); res.json({ ok: true, id: f.id });
  }));
  app.get(P + '/fotos', requiereSesion, requiereRol('lector'), (req, res) => {
    const L = q.todos("SELECT f.id, f.nombre, f.autor, f.fecha, f.mime, f.tamano, f.es360, f.tarea_id, f.parte_id, CASE WHEN COALESCE(f.ambiente, '') <> '' THEN f.ambiente ELSE COALESCE(t.ubicacion, '') END AS ambiente, t.numero AS tarea_numero, t.titulo AS tarea_titulo, t.estado AS tarea_estado FROM obra_fotos f LEFT JOIN obra_tareas t ON t.id = f.tarea_id WHERE f.proyecto_id = ? AND f.borrada = '' ORDER BY f.fecha DESC LIMIT 2000", req.pid);
    res.json({ fotos: req.query.vista === 'mias' ? L.filter(f => f.autor === req.quien) : L });
  });
  // fotos que ya estan en el CDE se adjuntan a una tarea: la suelta se enlaza; la que ya es de otra tarea se repite (mismo archivo)
  app.post(P + '/tareas/:tid/foto-cde', requiereSesion, requiereRol('autor'), J, (req, res) => {
    const t = tareaDe(req.pid, req.params.tid); if (!t) return res.status(404).json({ error: 'no-existe' });
    let n = 0; for (const fid of (Array.isArray((req.body || {}).fotos) ? req.body.fotos : []).slice(0, 100)) {
      const f = q.uno("SELECT * FROM obra_fotos WHERE proyecto_id = ? AND id = ? AND borrada = ''", req.pid, String(fid)); if (!f || f.tarea_id === t.id) continue;
      const amb = f.ambiente || t.ubicacion || ''; let nid = f.id;
      if (!f.tarea_id && !f.parte_id) q.corre('UPDATE obra_fotos SET tarea_id = ?, ambiente = ? WHERE id = ?', t.id, amb, f.id);
      else { nid = id('of'); q.corre('INSERT INTO obra_fotos (id, proyecto_id, tarea_id, parte_id, autor, fecha, nombre, ruta, tamano, mime, nota, es360, ambiente) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', nid, req.pid, t.id, '', f.autor, f.fecha, f.nombre, f.ruta, f.tamano, f.mime, f.nota || '', f.es360 || 0, amb); }
      anota(req.pid, t.id, req.quien, 'foto', f.nombre, nid); n++; }
    if (n) q.corre('UPDATE obra_tareas SET actualizada = ? WHERE id = ?', ahora(), t.id); res.json({ ok: true, adjuntadas: n });
  });
  app.put(P + '/fotos/:fid', requiereSesion, requiereRol('autor'), J, (req, res) => {
    const f = q.uno("SELECT * FROM obra_fotos WHERE proyecto_id = ? AND id = ? AND borrada = ''", req.pid, req.params.fid); if (!f) return res.status(404).json({ error: 'no-existe' });
    q.corre('UPDATE obra_fotos SET ambiente = ? WHERE id = ?', txt((req.body || {}).ambiente, 160), f.id); res.json({ ok: true });
  });
  app.get(P + '/fotos/:fid/archivo', requiereSesion, requiereRol('lector'), (req, res) => {
    const f = q.uno("SELECT * FROM obra_fotos WHERE proyecto_id = ? AND id = ? AND borrada = ''", req.pid, req.params.fid);
    if (!f || !almacen.existe(f.ruta)) return res.status(404).json({ error: 'no-existe' });
    res.setHeader('Content-Type', f.mime || 'application/octet-stream'); res.setHeader('Cache-Control', 'private, max-age=86400');
    if (req.query.descargar === '1') res.setHeader('Content-Disposition', 'attachment; filename*=UTF-8\'\'' + encodeURIComponent(f.nombre));
    almacen.flujo(f.ruta).pipe(res);
  });
  app.delete(P + '/fotos/:fid', requiereSesion, requiereRol('autor'), (req, res) => {
    const f = q.uno("SELECT * FROM obra_fotos WHERE proyecto_id = ? AND id = ? AND borrada = ''", req.pid, req.params.fid); if (!f) return res.status(404).json({ error: 'no-existe' });
    if (!(puede(req, 'gestor') || f.autor === req.quien)) return res.status(403).json({ error: 'sin-permiso', mensaje: 'Solo quien subió la foto o un gestor puede suprimirla.' });
    q.corre('UPDATE obra_fotos SET borrada = ? WHERE id = ?', ahora(), f.id); res.json({ ok: true });
  });

  // ───────── partes diarios
  const abreP = (p) => p && Object.assign(p, { actividades: json(p.actividades, []) });
  const parteDe = (pid, i) => abreP(q.uno("SELECT * FROM obra_partes WHERE proyecto_id = ? AND id = ? AND borrado = ''", pid, i));
  const actividades = (v) => (Array.isArray(v) ? v : []).slice(0, 200).map(a => ({ actividad: txt(a.actividad, 300), avance: Math.min(100, Math.max(0, Math.round(numero(a.avance)))), notas: txt(a.notas, 1000) })).filter(a => a.actividad);
  app.get(P + '/partes', requiereSesion, requiereRol('lector'), (req, res) => {
    const L = q.todos("SELECT id, numero, fecha, titulo, estado, autor, firmante, enviado, actividades FROM obra_partes WHERE proyecto_id = ? AND borrado = '' ORDER BY fecha DESC, numero DESC", req.pid).map(abreP);
    L.forEach(p => { p.nActividades = p.actividades.length; p.avance = p.actividades.length ? Math.round(p.actividades.reduce((s, a) => s + a.avance, 0) / p.actividades.length) : 0; delete p.actividades; });
    res.json({ partes: L });
  });
  app.post(P + '/partes', requiereSesion, requiereRol('autor'), J, (req, res) => {
    const b = req.body || {}, pi = id('op'), n = sigNumero(req.pid, 'obra_partes');
    q.corre('INSERT INTO obra_partes (id, proyecto_id, numero, fecha, titulo, clima, personal, actividades, notas, autor, creado, actualizado) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', pi, req.pid, n, dia(b.fecha) || ahora().slice(0, 10), txt(b.titulo, 200) || 'Parte diario', txt(b.clima, 120), txt(b.personal, 400), JSON.stringify(actividades(b.actividades)), txt(b.notas, 6000), req.quien, ahora(), ahora());
    res.json({ ok: true, id: pi, numero: n });
  });
  app.get(P + '/partes/:id', requiereSesion, requiereRol('lector'), (req, res) => {
    const p = parteDe(req.pid, req.params.id); if (!p) return res.status(404).json({ error: 'no-existe' });
    p.fotos = q.todos("SELECT id, nombre, autor, fecha FROM obra_fotos WHERE parte_id = ? AND borrada = '' ORDER BY fecha", p.id);
    p.puedoEditar = p.estado === 'borrador' && puede(req, 'autor'); res.json(p);
  });
  app.put(P + '/partes/:id', requiereSesion, requiereRol('autor'), J, (req, res) => {
    const p = parteDe(req.pid, req.params.id), b = req.body || {}; if (!p) return res.status(404).json({ error: 'no-existe' });
    if (p.estado !== 'borrador') return res.status(409).json({ error: 'enviado', mensaje: 'El parte ya fue enviado y no se puede modificar.' });
    q.corre('UPDATE obra_partes SET fecha = ?, titulo = ?, clima = ?, personal = ?, actividades = ?, notas = ?, actualizado = ? WHERE id = ?', dia(b.fecha) || p.fecha, txt(b.titulo, 200) || p.titulo, txt(b.clima, 120), txt(b.personal, 400), JSON.stringify(actividades(b.actividades)), txt(b.notas, 6000), ahora(), p.id);
    res.json({ ok: true });
  });
  app.post(P + '/partes/:id/enviar', requiereSesion, requiereRol('autor'), J, (req, res) => {
    const p = parteDe(req.pid, req.params.id), b = req.body || {}; if (!p) return res.status(404).json({ error: 'no-existe' });
    if (p.estado !== 'borrador') return res.status(409).json({ error: 'enviado', mensaje: 'El parte ya fue enviado.' });
    const firma = String(b.firma || ''); if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(firma) || firma.length > 400000) return res.status(400).json({ error: 'firma', mensaje: 'Falta la firma.' });
    q.corre("UPDATE obra_partes SET estado = 'enviado', firma = ?, firmante = ?, enviado = ?, actualizado = ? WHERE id = ?", firma, txt(b.firmante, 160) || req.nombre || req.quien, ahora(), ahora(), p.id);
    audita(req.quien, 'obra.parte.enviar', req.pid, 'Parte diario #' + p.numero + ' ' + p.fecha, {}); res.json({ ok: true });
  });
  app.delete(P + '/partes/:id', requiereSesion, requiereRol('autor'), (req, res) => {
    const p = parteDe(req.pid, req.params.id); if (!p) return res.status(404).json({ error: 'no-existe' });
    if (p.estado !== 'borrador' && !puede(req, 'gestor')) return res.status(403).json({ error: 'sin-permiso', mensaje: 'Un parte enviado solo lo suprime un gestor.' });
    q.corre('UPDATE obra_partes SET borrado = ? WHERE id = ?', ahora(), p.id); res.json({ ok: true });
  });

  // ───────── presupuesto
  app.get(P + '/presupuesto', requiereSesion, requiereRol('lector'), (req, res) => {
    const partidas = q.todos('SELECT id, codigo, descripcion, grupo, presupuesto, ejecutado FROM obra_presupuesto WHERE proyecto_id = ? ORDER BY orden', req.pid);
    const porCat = q.todos("SELECT categoria, COUNT(*) AS tareas, SUM(costo) AS costo, SUM(horas) AS horas FROM obra_tareas WHERE proyecto_id = ? AND borrada = '' GROUP BY categoria ORDER BY categoria", req.pid);
    const cambios = q.todos("SELECT numero, titulo, estado, datos FROM obra_registros WHERE proyecto_id = ? AND tipo = 'cambio' AND borrado = '' AND estado IN ('solicitada','pendiente','aprobada') ORDER BY numero", req.pid).map(c => ({ numero: c.numero, titulo: c.titulo, estado: c.estado, monto: json(c.datos, {}).monto || 0 }));
    res.json({ partidas, tareas: porCat, cambios, moneda: config(req.pid).moneda, puedoEditar: puede(req, 'gestor') });
  });
  app.put(P + '/presupuesto', requiereSesion, requiereRol('gestor'), J, (req, res) => {
    const filas = (Array.isArray((req.body || {}).partidas) ? req.body.partidas : []).slice(0, 2000).map(f => ({ codigo: txt(f.codigo, 40), descripcion: txt(f.descripcion, 300), grupo: txt(f.grupo, 120), presupuesto: numero(f.presupuesto), ejecutado: numero(f.ejecutado) })).filter(f => f.codigo || f.descripcion);
    q.corre('DELETE FROM obra_presupuesto WHERE proyecto_id = ?', req.pid);
    filas.forEach((f, i) => q.corre('INSERT INTO obra_presupuesto (id, proyecto_id, orden, codigo, descripcion, grupo, presupuesto, ejecutado) VALUES (?,?,?,?,?,?,?,?)', id('ob'), req.pid, i, f.codigo, f.descripcion, f.grupo, f.presupuesto, f.ejecutado));
    audita(req.quien, 'obra.presupuesto', req.pid, filas.length + ' partidas', {}); res.json({ ok: true, partidas: filas.length });
  });

  // ───────── dibujos y mediciones sobre el plano, y escala de la hoja
  const TIPOS_MARCA = ['linea', 'flecha', 'rect', 'elipse', 'nube', 'lapiz', 'texto', 'distancia', 'area'];
  const puntos = (v) => (Array.isArray(v) ? v : []).slice(0, 2000).map(p => [Math.min(1.5, Math.max(-0.5, Number(p && p[0]) || 0)), Math.min(1.5, Math.max(-0.5, Number(p && p[1]) || 0))]);
  app.get(P + '/planos/:cid/marcas', requiereSesion, requiereRol('lector'), (req, res) => {
    const L = q.todos('SELECT id, pagina, tipo, datos, autor, fecha FROM obra_marcas WHERE proyecto_id = ? AND plano_id = ? ORDER BY fecha', req.pid, req.params.cid).map(m => Object.assign(m, { datos: json(m.datos, {}), mia: m.autor === req.quien }));
    res.json({ marcas: L, escala: (config(req.pid).escalas || {})[req.params.cid] || null, puedoBorrarTodo: puede(req, 'gestor') });
  });
  app.post(P + '/planos/:cid/marcas', requiereSesion, requiereRol('autor'), J, (req, res) => {
    const b = req.body || {}; if (!planoDe(req.pid, req.params.cid) || !TIPOS_MARCA.includes(b.tipo)) return res.status(400).json({ error: 'datos', mensaje: 'Marca no válida.' });
    const pts = puntos(b.puntos); if (pts.length < (b.tipo === 'texto' ? 1 : 2)) return res.status(400).json({ error: 'datos', mensaje: 'Faltan puntos.' });
    const mid = id('om'), d = { puntos: pts, color: /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : '#d92d20', texto: txt(b.texto, 300), grosor: Math.min(8, Math.max(1, Number(b.grosor) || 2)) };
    q.corre('INSERT INTO obra_marcas (id, proyecto_id, plano_id, pagina, tipo, datos, autor, fecha) VALUES (?,?,?,?,?,?,?,?)', mid, req.pid, req.params.cid, Math.max(1, parseInt(b.pagina, 10) || 1), b.tipo, JSON.stringify(d), req.quien, ahora());
    res.json({ ok: true, id: mid });
  });
  app.delete(P + '/marcas/:mid', requiereSesion, requiereRol('autor'), (req, res) => {
    const m = q.uno('SELECT * FROM obra_marcas WHERE proyecto_id = ? AND id = ?', req.pid, req.params.mid); if (!m) return res.status(404).json({ error: 'no-existe' });
    if (!(puede(req, 'gestor') || m.autor === req.quien)) return res.status(403).json({ error: 'sin-permiso', mensaje: 'Solo quien hizo la marca o un gestor puede borrarla.' });
    q.corre('DELETE FROM obra_marcas WHERE id = ?', m.id); res.json({ ok: true });
  });
  /** Escala del documento: metros reales por cada punto del PDF (1 pt = 1/72 pulgada). Se fija con «1:N» o calibrando una distancia conocida. */
  app.put(P + '/planos/:cid/escala', requiereSesion, requiereRol('autor'), J, (req, res) => {
    const b = req.body || {}, m = Number(b.mPorPt), c = config(req.pid); if (!planoDe(req.pid, req.params.cid)) return res.status(404).json({ error: 'no-existe' });
    c.escalas = c.escalas || {}; if (isFinite(m) && m > 0) c.escalas[req.params.cid] = { mPorPt: m, texto: txt(b.texto, 40) }; else delete c.escalas[req.params.cid];
    guardaConfig(req.pid, c); res.json({ ok: true, escala: c.escalas[req.params.cid] || null });
  });

  // ───────── recorrido 360: tomas esfericas por visita, ubicadas sobre el plano de cada nivel
  app.get(P + '/recorrido', requiereSesion, requiereRol('lector'), (req, res) => {
    const tomas = q.todos("SELECT t.id, t.foto_id, t.visita, t.plano_id, t.x, t.y, t.codigo, t.nombre, t.autor, t.fecha, COALESCE(t.tipo, 'piso') AS tipo, f.es360 FROM obra_tomas t JOIN obra_fotos f ON f.id = t.foto_id AND f.borrada = '' WHERE t.proyecto_id = ? AND t.borrada = '' ORDER BY t.visita DESC, t.codigo, t.fecha", req.pid);
    const visitas = [...new Set(tomas.map(t => t.visita))].map(v => ({ fecha: v, tomas: tomas.filter(t => t.visita === v).length }));
    res.json({ tomas, visitas, puedoEditar: puede(req, 'autor') });
  });
  app.post(P + '/recorrido', requiereSesion, requiereRol('autor'), CRUDO, conError(async (req, res) => {
    const f = req.query || {}, visita = dia(f.visita) || ahora().slice(0, 10), plano = f.plano && planoDe(req.pid, String(f.plano)) ? String(f.plano) : '';
    const tipo = f.tipo === 'aerea' ? 'aerea' : 'piso', codigo = txt(f.codigo, 60), tid = id('o3');
    let x = f.x === undefined || f.x === '' ? NaN : Number(f.x), y = f.y === undefined || f.y === '' ? NaN : Number(f.y), heredada = false;
    // sin punto marcado: si ese ambiente ya se tomo en otra visita sobre el mismo plano, la toma nueva cae en el mismo sitio
    if (!(isFinite(x) && isFinite(y)) && codigo && plano) { const a = q.uno("SELECT x, y FROM obra_tomas WHERE proyecto_id = ? AND plano_id = ? AND codigo = ? AND borrada = '' AND x IS NOT NULL ORDER BY visita DESC, fecha DESC LIMIT 1", req.pid, plano, codigo); if (a) { x = a.x; y = a.y; heredada = true; } }
    const foto = await guardaFoto(req, { es360: f.plana === '1' ? 0 : 1 });
    q.corre('INSERT INTO obra_tomas (id, proyecto_id, foto_id, visita, plano_id, x, y, codigo, nombre, autor, fecha, tipo) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', tid, req.pid, foto.id, visita, plano, isFinite(x) ? Math.min(1, Math.max(0, x)) : null, isFinite(y) ? Math.min(1, Math.max(0, y)) : null, codigo, txt(f.nombre, 160), req.quien, ahora(), tipo);
    res.json({ ok: true, id: tid, foto: foto.id, heredada });
  }));
  app.put(P + '/recorrido/:tid', requiereSesion, requiereRol('autor'), J, (req, res) => {
    const t = q.uno("SELECT * FROM obra_tomas WHERE proyecto_id = ? AND id = ? AND borrada = ''", req.pid, req.params.tid), b = req.body || {}; if (!t) return res.status(404).json({ error: 'no-existe' });
    const x = b.x === undefined ? t.x : Math.min(1, Math.max(0, Number(b.x) || 0)), y = b.y === undefined ? t.y : Math.min(1, Math.max(0, Number(b.y) || 0));
    q.corre('UPDATE obra_tomas SET tipo = ?, codigo = ?, nombre = ?, visita = ?, x = ?, y = ?, plano_id = ? WHERE id = ?', b.tipo === 'aerea' || b.tipo === 'piso' ? b.tipo : (t.tipo || 'piso'), b.codigo === undefined ? t.codigo : txt(b.codigo, 60), b.nombre === undefined ? t.nombre : txt(b.nombre, 160), dia(b.visita) || t.visita, x, y, b.plano_id !== undefined && planoDe(req.pid, String(b.plano_id)) ? String(b.plano_id) : t.plano_id, t.id);
    res.json({ ok: true });
  });
  app.delete(P + '/recorrido/:tid', requiereSesion, requiereRol('autor'), (req, res) => {
    const t = q.uno("SELECT * FROM obra_tomas WHERE proyecto_id = ? AND id = ? AND borrada = ''", req.pid, req.params.tid); if (!t) return res.status(404).json({ error: 'no-existe' });
    if (!(puede(req, 'gestor') || t.autor === req.quien)) return res.status(403).json({ error: 'sin-permiso', mensaje: 'Solo quien subió la toma o un gestor puede suprimirla.' });
    q.corre('UPDATE obra_tomas SET borrada = ? WHERE id = ?', ahora(), t.id); q.corre('UPDATE obra_fotos SET borrada = ? WHERE id = ?', ahora(), t.foto_id); res.json({ ok: true });
  });

  // ───────── consultas (RFI) y ordenes de cambio
  const abreR = (r) => r && Object.assign(r, { datos: json(r.datos, {}), estadoTxt: (REGISTROS[r.tipo].estados.find(e => e[0] === r.estado) || [0, r.estado])[1] });
  const regDe = (pid, rid) => abreR(q.uno("SELECT * FROM obra_registros WHERE proyecto_id = ? AND id = ? AND borrado = ''", pid, rid));
  function datosReg(tipo, b, base) {
    const d = Object.assign({}, base || {}), C = REGISTROS[tipo].campos;
    for (const k of Object.keys(C)) { if (b[k] === undefined) continue; const t = C[k];
      d[k] = t === 'dia' ? dia(b[k]) : t === 'num' ? numero(b[k]) : t === 'bool' ? !!b[k] : t === 'partidas' ? (Array.isArray(b[k]) ? b[k] : []).slice(0, 200).map(x => ({ descripcion: txt(x.descripcion, 300), monto: numero(x.monto) })).filter(x => x.descripcion) : txt(b[k], t); }
    if (tipo === 'cambio' && Array.isArray(d.partidas) && d.partidas.length) d.monto = d.partidas.reduce((s, x) => s + x.monto, 0);
    return d;
  }
  const tipoReg = (req, res) => { const t = String(req.params.tipo); if (!REGISTROS[t]) { res.status(404).json({ error: 'no-existe' }); return null; } return t; };
  app.get(P + '/registros/:tipo', requiereSesion, requiereRol('lector'), (req, res) => {
    const tipo = tipoReg(req, res); if (!tipo) return;
    const L = q.todos("SELECT * FROM obra_registros WHERE proyecto_id = ? AND tipo = ? AND borrado = '' ORDER BY numero DESC", req.pid, tipo).map(abreR);
    res.json({ registros: L, estados: REGISTROS[tipo].estados, moneda: config(req.pid).moneda, puedoEditar: puede(req, 'autor'), puedoGestionar: puede(req, 'gestor') });
  });
  app.post(P + '/registros/:tipo', requiereSesion, requiereRol('autor'), J, (req, res) => {
    const tipo = tipoReg(req, res); if (!tipo) return; const b = req.body || {}, rid = id('or'), n = ((q.uno('SELECT MAX(numero) AS n FROM obra_registros WHERE proyecto_id = ? AND tipo = ?', req.pid, tipo) || {}).n || 0) + 1;
    q.corre('INSERT INTO obra_registros (id, proyecto_id, tipo, numero, titulo, estado, datos, creado, creado_por, actualizado) VALUES (?,?,?,?,?,?,?,?,?,?)', rid, req.pid, tipo, n, txt(b.titulo, 300), REGISTROS[tipo].inicial, JSON.stringify(datosReg(tipo, b)), ahora(), req.quien, ahora());
    anota(req.pid, rid, req.quien, 'cambio', REGISTROS[tipo].nombre + ' creada'); audita(req.quien, 'obra.' + tipo, req.pid, '#' + n + ' ' + txt(b.titulo, 300), {});
    res.json({ ok: true, id: rid, numero: n });
  });
  app.get(P + '/registro/:rid', requiereSesion, requiereRol('lector'), (req, res) => {
    const r = regDe(req.pid, req.params.rid); if (!r) return res.status(404).json({ error: 'no-existe' });
    r.actividad = q.todos('SELECT id, autor, fecha, tipo, texto, foto_id FROM obra_actividad WHERE tarea_id = ? ORDER BY fecha', r.id);
    r.fotos = q.todos("SELECT id, nombre, autor, fecha, mime FROM obra_fotos WHERE parte_id = ? AND borrada = '' ORDER BY fecha", r.id);
    r.estados = REGISTROS[r.tipo].estados; r.moneda = config(req.pid).moneda;
    r.plano = r.datos.plano_id ? planoDe(req.pid, r.datos.plano_id) : null;
    r.tarea = r.datos.tarea_id ? q.uno("SELECT id, numero, titulo, estado FROM obra_tareas WHERE proyecto_id = ? AND id = ? AND borrada = ''", req.pid, r.datos.tarea_id) : null;
    r.rfi = r.datos.rfi_id ? q.uno("SELECT id, numero, titulo, estado FROM obra_registros WHERE proyecto_id = ? AND id = ? AND borrado = ''", req.pid, r.datos.rfi_id) : null;
    const cerrado = r.tipo === 'rfi' ? r.estado === 'cerrada' : (r.estado === 'aprobada' || r.estado === 'rechazada');
    r.puedoEditar = puede(req, 'autor') && !cerrado && (r.tipo === 'rfi' || r.estado === 'borrador' || puede(req, 'gestor'));
    r.puedoResponder = r.tipo === 'rfi' && r.estado === 'abierta' && puede(req, 'autor') && (puede(req, 'gestor') || !r.datos.para || r.datos.para === req.quien);
    r.puedoDecidir = r.tipo === 'cambio' && puede(req, 'gestor') && (r.estado === 'solicitada' || r.estado === 'pendiente');
    r.puedoBorrar = puede(req, 'gestor') || (r.creado_por === req.quien && r.estado === 'borrador'); r.soyAutor = r.creado_por === req.quien;
    res.json(r);
  });
  app.put(P + '/registro/:rid', requiereSesion, requiereRol('autor'), J, (req, res) => {
    const r = regDe(req.pid, req.params.rid), b = req.body || {}; if (!r) return res.status(404).json({ error: 'no-existe' });
    const gestor = puede(req, 'gestor'), cerrado = r.tipo === 'rfi' ? r.estado === 'cerrada' : (r.estado === 'aprobada' || r.estado === 'rechazada');
    if (cerrado) return res.status(409).json({ error: 'cerrado', mensaje: 'Ya está ' + r.estadoTxt.toLowerCase() + ' y no se puede modificar.' });
    let estado = r.estado; const d = datosReg(r.tipo, b, r.datos), notas = [];
    if (b.estado !== undefined && b.estado !== r.estado) {
      const e = String(b.estado); if (!REGISTROS[r.tipo].estados.some(x => x[0] === e)) return res.status(400).json({ error: 'estado' });
      if (r.tipo === 'rfi') {
        if (e === 'abierta' && !(r.titulo || b.titulo) ) return res.status(400).json({ error: 'datos', mensaje: 'La consulta necesita un asunto.' });
        if (e === 'abierta' && !d.pregunta) return res.status(400).json({ error: 'datos', mensaje: 'Escribe la consulta antes de enviarla.' });
        if (e === 'respondida') { if (!d.respuesta) return res.status(400).json({ error: 'datos', mensaje: 'Escribe la respuesta.' }); if (!(gestor || !d.para || d.para === req.quien)) return res.status(403).json({ error: 'sin-permiso', mensaje: 'Responde la persona a quien se dirigió la consulta, o un gestor.' }); d.respondidaPor = req.quien; d.respondidaFecha = ahora(); }
        if (e === 'cerrada' && !(gestor || r.creado_por === req.quien)) return res.status(403).json({ error: 'sin-permiso', mensaje: 'Cierra la consulta quien la emitió, o un gestor.' });
        if (e === 'borrador') return res.status(400).json({ error: 'estado', mensaje: 'Una consulta enviada no vuelve a borrador.' });
      } else {
        if ((e === 'aprobada' || e === 'rechazada' || e === 'pendiente') && !gestor) return res.status(403).json({ error: 'sin-permiso', mensaje: 'Solo un gestor del proyecto pasa la orden a ' + e + '.' });
        if (e === 'solicitada' && !(r.titulo || b.titulo)) return res.status(400).json({ error: 'datos', mensaje: 'La orden de cambio necesita un nombre.' });
        if (e === 'aprobada' || e === 'rechazada') { d.decididaPor = req.quien; d.decididaFecha = ahora(); d.motivoDecision = txt(b.motivoDecision, 1000); }
        if (e === 'borrador' && !gestor) return res.status(400).json({ error: 'estado', mensaje: 'Una orden solicitada no vuelve a borrador.' });
      }
      estado = e; notas.push('Estado cambiado a ' + (REGISTROS[r.tipo].estados.find(x => x[0] === e) || [0, e])[1]);
    } else if (r.tipo === 'cambio' && r.estado !== 'borrador' && !gestor) return res.status(403).json({ error: 'sin-permiso', mensaje: 'Una orden ya solicitada solo la modifica un gestor.' });
    const titulo = b.titulo === undefined ? r.titulo : txt(b.titulo, 300);
    if (titulo !== r.titulo) notas.push('Título cambiado a ' + titulo);
    if (r.tipo === 'cambio' && d.monto !== r.datos.monto) notas.push('Monto cambiado a ' + d.monto);
    if (r.tipo === 'rfi' && d.para !== r.datos.para) notas.push('Dirigida a ' + (d.para || '(nadie)'));
    q.corre('UPDATE obra_registros SET titulo = ?, estado = ?, datos = ?, actualizado = ? WHERE id = ?', titulo, estado, JSON.stringify(d), ahora(), r.id);
    notas.forEach(n => anota(req.pid, r.id, req.quien, 'cambio', n));
    if (estado !== r.estado) audita(req.quien, 'obra.' + r.tipo + '.estado', req.pid, '#' + r.numero + ' → ' + estado, {});
    res.json({ ok: true, estado });
  });
  app.post(P + '/registro/:rid/mensaje', requiereSesion, requiereRol('lector'), J, (req, res) => {
    const r = regDe(req.pid, req.params.rid), m = txt((req.body || {}).texto, 4000); if (!r || !m) return res.status(400).json({ error: 'datos' });
    anota(req.pid, r.id, req.quien, 'mensaje', m); q.corre('UPDATE obra_registros SET actualizado = ? WHERE id = ?', ahora(), r.id); res.json({ ok: true });
  });
  app.delete(P + '/registro/:rid', requiereSesion, requiereRol('autor'), (req, res) => {
    const r = regDe(req.pid, req.params.rid); if (!r) return res.status(404).json({ error: 'no-existe' });
    if (!(puede(req, 'gestor') || (r.creado_por === req.quien && r.estado === 'borrador'))) return res.status(403).json({ error: 'sin-permiso', mensaje: 'Solo se suprime un borrador propio; lo demás, un gestor.' });
    q.corre('UPDATE obra_registros SET borrado = ? WHERE id = ?', ahora(), r.id); res.json({ ok: true });
  });

  // ───────── planos desde la nube: enlaces compartidos de Dropbox, OneDrive / SharePoint y Box que se bajan al CDE y se vuelven a comprobar
  const NUBE = require('./obra-nube');
  // La carga entra por la misma puerta que los complementos (llave interna), a nombre de la organización de quien la pide: la carpeta WIP se elige con esa misma identidad.
  const destino = (req) => { const p = I.proyecto(req.pid), propia = String((I.yo(req, p) || {}).organizacion || '').toUpperCase();
    for (const org of [...new Set([propia].concat(Object.values(p.config.partes || {}).map(x => String(x).toUpperCase()), ['CONTRATISTA', 'SUPERVISION']).filter(Boolean))]) { const c = I.carpetaWipDe(p, { email: 'complemento:nube', rol: 'document-control', organizacion: org, admin: false }); if (c) return { carpeta: c, org }; }
    return { carpeta: '', org: propia }; };
  const orgDe = (req) => destino(req).org, WIP = (req) => destino(req).carpeta;
  async function traeDeNube(req, fila, carpetaCde, comoUsuario) {
    const a = await NUBE.descarga(fila.url), sha = require('crypto').createHash('sha256').update(a.datos).digest('hex');
    if (fila.sha256 === sha && fila.contenedor_id && planoDe(req.pid, fila.contenedor_id)) return { igual: true, nombre: fila.nombre };
    const nombre = fila.nombre || a.nombre;
    const r = await fetch('http://127.0.0.1:' + (req.socket.localPort || ctx.puerto) + '/api/proyectos/' + req.pid + '/subir?origen=web&organizacion=' + encodeURIComponent(orgDe(req)) + '&carpeta=' + encodeURIComponent(carpetaCde), { method: 'POST', headers: Object.assign({ 'x-cde-llave': ctx.llaveInterna, 'x-nombre': encodeURIComponent(nombre), 'x-meta': encodeURIComponent(JSON.stringify({ nube: { proveedor: a.proveedor, enlace: fila.url, por: req.quien } })) }, comoUsuario ? { 'x-cde-por': req.quien } : {}), body: a.datos });   // en la carpeta que elige la persona se carga a su nombre, con sus permisos
    const j = await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(j.mensaje || j.error || 'El CDE no aceptó el archivo (' + r.status + ')'); e.status = 400; throw e; }
    const cid = (j.contenedor && j.contenedor.id) || j.contenedor || j.contenedor_id; return { igual: false, nombre, sha, cid, proveedor: a.proveedor, version: j.version || j.n };
  }
  app.get(P + '/nube', requiereSesion, requiereRol('lector'), (req, res) => res.json({ enlaces: q.todos('SELECT id, url, proveedor, contenedor_id, nombre, sincronizado, error, coleccion, carpeta, por FROM obra_nube WHERE proyecto_id = ? ORDER BY creado DESC', req.pid), carpetaCde: WIP(req) }));
  app.post(P + '/nube', requiereSesion, requiereRol('autor'), J, async (req, res) => {
    const b = req.body || {}, url = txt(b.url, 2000), fila = { url, nombre: '', sha256: '', contenedor_id: '' };
    try {
      // la carpeta del CDE la elige quien trae el plano; si no elige, va a la carpeta WIP de su empresa
      const p = I.proyecto(req.pid), u = I.yo(req, p), elegida = b.carpetaCde !== undefined && b.carpetaCde !== null && String(b.carpetaCde).trim() !== '' ? CAR.limpia(b.carpetaCde) : '';
      if (elegida && !CAR.def(p.config.carpetas, elegida)) return res.status(400).json({ error: 'carpeta', mensaje: 'La carpeta «' + elegida + '» no existe en el proyecto.' });
      if (elegida && !(u.admin || u.rol === 'gestor' || u.rol === 'administrador' || I.permisoEn(p, u, elegida).subir)) return res.status(403).json({ error: 'sin-permiso', mensaje: 'No tienes permiso de carga en «' + elegida + '». Elige otra carpeta.' });
      const car = elegida || WIP(req); if (!car) return res.status(400).json({ error: 'carpeta', mensaje: 'Elige la carpeta del CDE donde se cargará el plano (botón «Elegir carpeta…»).' });
      const r = await traeDeNube(req, fila, car, !!elegida), nid = id('on'), col = txt(b.coleccion, 80) || 'General', carO = txt(b.carpeta, 80);
      q.corre('INSERT INTO obra_nube (id, proyecto_id, url, proveedor, contenedor_id, nombre, sha256, sincronizado, coleccion, carpeta, por, creado) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', nid, req.pid, url, r.proveedor, r.cid, r.nombre, r.sha, ahora(), col, carO, req.quien, ahora());
      if (planoDe(req.pid, r.cid)) q.corre("INSERT INTO obra_planos (proyecto_id, contenedor_id, coleccion, carpeta, orden, agregado, por, tipo, seccion) VALUES (?,?,?,?,0,?,?,'plano','') ON CONFLICT(proyecto_id, contenedor_id) DO NOTHING", req.pid, r.cid, col, carO, ahora(), req.quien);
      audita(req.quien, 'obra.nube', req.pid, r.nombre, { proveedor: r.proveedor }); res.json({ ok: true, id: nid, nombre: r.nombre, proveedor: r.proveedor, contenedor: r.cid, carpetaCde: car });
    } catch (e) { res.status(e.status || 502).json({ error: 'nube', mensaje: e.message }); }
  });
  app.post(P + '/nube/sincronizar', requiereSesion, requiereRol('autor'), J, async (req, res) => {
    const L = q.todos('SELECT * FROM obra_nube WHERE proyecto_id = ?', req.pid), car = WIP(req), out = [];
    for (const f of L) {
      try { const c = q.uno('SELECT carpeta FROM contenedores WHERE id = ?', f.contenedor_id), r = await traeDeNube(req, f, (c && c.carpeta) || car);
        if (r.igual) q.corre("UPDATE obra_nube SET sincronizado = ?, error = '' WHERE id = ?", ahora(), f.id); else q.corre("UPDATE obra_nube SET sincronizado = ?, error = '', sha256 = ?, contenedor_id = ? WHERE id = ?", ahora(), r.sha, r.cid, f.id);
        out.push({ id: f.id, nombre: f.nombre, actualizado: !r.igual });
      } catch (e) { q.corre('UPDATE obra_nube SET error = ? WHERE id = ?', txt(e.message, 300), f.id); out.push({ id: f.id, nombre: f.nombre, error: e.message }); }
    }
    res.json({ ok: true, resultados: out, actualizados: out.filter(x => x.actualizado).length, errores: out.filter(x => x.error).length });
  });
  app.delete(P + '/nube/:nid', requiereSesion, requiereRol('autor'), (req, res) => { q.corre('DELETE FROM obra_nube WHERE proyecto_id = ? AND id = ?', req.pid, req.params.nid); res.json({ ok: true }); });

  // ───────── resumen del modulo (cabecera y tarjetas de enlace con el resto del CDE)
  // ───────── planificacion: tablas importadas de Primavera P6 / Microsoft Project (largo plazo) y planes propios (corto plazo)
  const JG = express.json({ limit: '60mb' });
  const FORMATOS_PLAN = { xer: 'Primavera P6 (XER)', p6xml: 'Primavera P6 (XML)', mspxml: 'Microsoft Project (XML)', mpx: 'Microsoft Project (MPX)', excel: 'Excel', plan: '' };
  /** Deja cada actividad con lo que el CDE guarda, y calcula el resumen de la planificacion. */
  function actividadesPlan(lista) {
    const A = (Array.isArray(lista) ? lista : []).slice(0, 40000).map((t, i) => ({
      id: txt(t.id, 80) || String(i + 1), nombre: txt(t.nombre, 400), ini: dia(t.ini), fin: dia(t.fin), pct: Math.min(100, Math.max(0, Number(t.pct) || 0)), nivel: Math.min(20, Math.max(1, parseInt(t.nivel, 10) || 1)),
      resumen: !!t.resumen, wbs: txt(t.wbs, 120), critica: !!t.critica, holgura: t.holgura == null || t.holgura === '' || !isFinite(Number(t.holgura)) ? null : Number(t.holgura), responsable: txt(t.responsable, 160), tarea_id: txt(t.tarea_id, 60),
      pred: (Array.isArray(t.pred) ? t.pred : []).slice(0, 60).map(v => ({ id: txt(v.id, 80), tipo: /^(FS|SS|FF|SF)$/.test(v.tipo) ? v.tipo : 'FS', lag: txt(v.lag, 12) })).filter(v => v.id)
    })).filter(t => t.nombre && (t.resumen || (t.ini && t.fin)));
    const H = A.filter(t => !t.resumen && t.ini && t.fin), ini = H.reduce((m, t) => !m || t.ini < m ? t.ini : m, ''), fin = H.reduce((m, t) => t.fin > m ? t.fin : m, '');
    let dur = 0, av = 0; H.forEach(t => { const d = Math.max(1, (Date.parse(t.fin) - Date.parse(t.ini)) / 864e5 + 1); dur += d; av += d * t.pct; });
    return { A, n: H.length, ini, fin, avance: dur ? Math.round(av / dur * 10) / 10 : 0, criticas: H.filter(t => t.critica).length };
  }
  const SQL_PLAN = 'SELECT id, tipo, nombre, formato, archivo, tabla_id, actividades, inicio, fin, avance, criticas, creado, por, actualizado FROM obra_planes';
  app.get(P + '/planes', requiereSesion, requiereRol('lector'), (req, res) => {
    const L = q.todos(SQL_PLAN + " WHERE proyecto_id = ? AND borrado = '' ORDER BY creado DESC", req.pid).map(x => Object.assign(x, { formatoTxt: x.formato in FORMATOS_PLAN ? FORMATOS_PLAN[x.formato] : x.formato }));
    // cronogramas que ya estan en el CDE y se pueden importar sin volver a subirlos
    const disponibles = req.query.disponibles === '1' ? q.todos("SELECT c.id, c.nombre, c.carpeta, v.id AS version_id, v.n, v.archivo, v.extension, v.tamano, v.fecha FROM contenedores c JOIN versiones v ON v.contenedor_id = c.id AND v.n = c.version_actual WHERE c.proyecto_id = ? AND c.borrado = '' AND lower(v.extension) IN ('xer','xml','mpx') ORDER BY v.fecha DESC LIMIT 300", req.pid).filter(d => !I.proyecto(req.pid).config.carpetas || !d.carpeta || I.permisoEn(I.proyecto(req.pid), I.yo(req, I.proyecto(req.pid)), d.carpeta).leer) : undefined;
    res.json({ planes: L, disponibles, puedoEditar: puede(req, 'autor'), puedoGestionar: puede(req, 'gestor') });
  });
  app.post(P + '/planes', requiereSesion, requiereRol('autor'), JG, (req, res) => {
    const b = req.body || {}, tipo = b.tipo === 'plan' ? 'plan' : 'tabla', nombre = txt(b.nombre, 200); if (!nombre) return res.status(400).json({ error: 'datos', mensaje: 'Ponle un nombre a la planificación.' });
    const a = actividadesPlan(b.tareas); if (tipo === 'tabla' && !a.n) return res.status(400).json({ error: 'datos', mensaje: 'El archivo no trae actividades con fecha de inicio y de fin.' });
    const tabla = b.tabla_id && q.uno("SELECT id FROM obra_planes WHERE proyecto_id = ? AND id = ? AND tipo = 'tabla' AND borrado = ''", req.pid, String(b.tabla_id)) ? String(b.tabla_id) : '';
    const pl = id('op');
    q.corre('INSERT INTO obra_planes (id, proyecto_id, tipo, nombre, formato, archivo, tabla_id, datos, actividades, inicio, fin, avance, criticas, creado, por, actualizado) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', pl, req.pid, tipo, nombre, tipo === 'plan' ? 'plan' : (FORMATOS_PLAN[b.formato] !== undefined ? b.formato : ''), txt(b.archivo, 300), tabla, JSON.stringify(a.A), a.n, a.ini, a.fin, a.avance, a.criticas, ahora(), req.quien, ahora());
    audita(req.quien, 'obra.plan', req.pid, nombre, { tipo, actividades: a.n }); res.json({ ok: true, id: pl, actividades: a.n });
  });
  const planDe = (pid, pl) => q.uno("SELECT * FROM obra_planes WHERE proyecto_id = ? AND id = ? AND borrado = ''", pid, pl);
  app.get(P + '/planes/:pl', requiereSesion, requiereRol('lector'), (req, res) => {
    const x = planDe(req.pid, req.params.pl); if (!x) return res.status(404).json({ error: 'no-existe' });
    x.tareas = json(x.datos, []); delete x.datos; x.formatoTxt = x.formato in FORMATOS_PLAN ? FORMATOS_PLAN[x.formato] : x.formato;
    x.tabla = x.tabla_id ? q.uno("SELECT id, nombre FROM obra_planes WHERE id = ? AND borrado = ''", x.tabla_id) : null;
    x.planes = x.tipo === 'tabla' ? q.todos(SQL_PLAN + " WHERE proyecto_id = ? AND tabla_id = ? AND borrado = ''", req.pid, x.id) : [];
    x.puedoEditar = puede(req, 'autor'); x.puedoBorrar = puede(req, 'gestor') || x.por === req.quien; res.json(x);
  });
  app.put(P + '/planes/:pl', requiereSesion, requiereRol('autor'), JG, (req, res) => {
    const x = planDe(req.pid, req.params.pl), b = req.body || {}; if (!x) return res.status(404).json({ error: 'no-existe' });
    const nombre = b.nombre === undefined ? x.nombre : (txt(b.nombre, 200) || x.nombre);
    const tabla = b.tabla_id === undefined ? x.tabla_id : (b.tabla_id && x.tipo === 'plan' && q.uno("SELECT id FROM obra_planes WHERE proyecto_id = ? AND id = ? AND tipo = 'tabla' AND borrado = ''", req.pid, String(b.tabla_id)) ? String(b.tabla_id) : '');
    if (b.tareas !== undefined) { const a = actividadesPlan(b.tareas); q.corre('UPDATE obra_planes SET datos = ?, actividades = ?, inicio = ?, fin = ?, avance = ?, criticas = ? WHERE id = ?', JSON.stringify(a.A), a.n, a.ini, a.fin, a.avance, a.criticas, x.id); }
    q.corre('UPDATE obra_planes SET nombre = ?, tabla_id = ?, actualizado = ? WHERE id = ?', nombre, tabla, ahora(), x.id); res.json({ ok: true });
  });
  app.delete(P + '/planes/:pl', requiereSesion, requiereRol('autor'), (req, res) => {
    const x = planDe(req.pid, req.params.pl); if (!x) return res.status(404).json({ error: 'no-existe' });
    if (!(puede(req, 'gestor') || x.por === req.quien)) return res.status(403).json({ error: 'sin-permiso', mensaje: 'Solo quien la creó o un gestor puede suprimirla.' });
    q.corre('UPDATE obra_planes SET borrado = ? WHERE id = ?', ahora(), x.id); q.corre("UPDATE obra_planes SET tabla_id = '' WHERE tabla_id = ?", x.id); res.json({ ok: true });
  });

  app.get(P + '/resumen', requiereSesion, requiereRol('lector'), (req, res) => {
    const n = (sql, ...a) => (q.uno(sql, ...a) || {}).n || 0;
    res.json({
      planos: n("SELECT COUNT(*) AS n FROM obra_planos WHERE proyecto_id = ? AND COALESCE(tipo, 'plano') = 'plano'", req.pid),
      tareas: n("SELECT COUNT(*) AS n FROM obra_tareas WHERE proyecto_id = ? AND borrada = ''", req.pid),
      abiertas: n("SELECT COUNT(*) AS n FROM obra_tareas WHERE proyecto_id = ? AND borrada = '' AND estado IN ('p1','p2','p3')", req.pid),
      mias: n("SELECT COUNT(*) AS n FROM obra_tareas WHERE proyecto_id = ? AND borrada = '' AND estado IN ('p1','p2','p3') AND responsable = ?", req.pid, req.quien),
      fotos: n("SELECT COUNT(*) AS n FROM obra_fotos WHERE proyecto_id = ? AND borrada = ''", req.pid),
      partes: n("SELECT COUNT(*) AS n FROM obra_partes WHERE proyecto_id = ? AND borrado = ''", req.pid),
      especs: n("SELECT COUNT(*) AS n FROM obra_planos WHERE proyecto_id = ? AND tipo = 'espec'", req.pid),
      tomas: n("SELECT COUNT(*) AS n FROM obra_tomas WHERE proyecto_id = ? AND borrada = ''", req.pid),
      rfis: n("SELECT COUNT(*) AS n FROM obra_registros WHERE proyecto_id = ? AND tipo = 'rfi' AND borrado = '' AND estado IN ('abierta','respondida')", req.pid),
      cambios: n("SELECT COUNT(*) AS n FROM obra_registros WHERE proyecto_id = ? AND tipo = 'cambio' AND borrado = '' AND estado IN ('solicitada','pendiente')", req.pid),
      planes: n("SELECT COUNT(*) AS n FROM obra_planes WHERE proyecto_id = ? AND borrado = ''", req.pid),
      puedoEditar: puede(req, 'autor'), puedoGestionar: puede(req, 'gestor')
    });
  });
}

module.exports = { monta, ESTADOS, REGISTROS };
