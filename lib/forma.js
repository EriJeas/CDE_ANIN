/*
 * LO QUE FALTABA DE AUTODESK FORMA (v0.6), contrastado fotograma a fotograma con el video de Erick:
 *   - CONFORMIDAD: varias normas de nomenclatura (crear/editar/borrar), norma por carpeta, area de retencion, buscar duplicados.
 *   - CAMBIAR NOMBRE de un archivo (y "cambiar nombre por lotes" al enviar a revision): el nombre nuevo debe cumplir la norma.
 *   - CONJUNTOS (pestana Conjuntos de Archivos): grupos con nombre de versiones concretas.
 *   - PUENTE: compartir una carpeta con OTRO PROYECTO con sincronizacion automatica (lo nuevo que se cargue se copia solo).
 *   - INFORMES DE TRANSMISION como registro propio (#numero, titulo, destinatarios, mensaje, archivos, descarga ZIP, copia por correo).
 *   - INCIDENCIAS: suprimir con motivo / restaurar, pines sobre el PDF, fecha de inicio, configuracion de tipos/estados.
 *   - REVISION #N: su pagina (pasos, iniciar como clave/opcional, omitir paso, volver al paso anterior, vencimiento, candidatos,
 *     archivos con comentarios, referencias) y lista exportable.
 *   - DESENCADENADORES: tabla + crear desde Configuracion.
 * Se monta DESPUES de cde.js (usa ctx.cdeInterno).
 */
'use strict';
const { q, ahora, id, json, audita, abreJson } = require('./bd');
const CAR = require('./carpetas');
const ISO = require('./iso19650');
const NOM = require('./nomenclatura');
const FL = require('./flujos');

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS conjuntos (
  id TEXT PRIMARY KEY, proyecto_id TEXT NOT NULL, nombre TEXT NOT NULL, descripcion TEXT DEFAULT '', items TEXT DEFAULT '[]',
  por TEXT NOT NULL, creado TEXT NOT NULL, actualizado TEXT NOT NULL, borrado TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS transmisiones (
  id TEXT PRIMARY KEY, proyecto_id TEXT NOT NULL, numero INTEGER NOT NULL, titulo TEXT NOT NULL, mensaje TEXT DEFAULT '',
  destinatarios TEXT DEFAULT '[]', permitir_anadir INTEGER DEFAULT 0, archivos TEXT DEFAULT '[]', grupo_atributos TEXT DEFAULT '',
  por TEXT NOT NULL, org TEXT DEFAULT '', creado TEXT NOT NULL, correo_id TEXT DEFAULT '', estado TEXT DEFAULT 'enviado', UNIQUE (proyecto_id, numero));
CREATE TABLE IF NOT EXISTS revision_comentarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT, revision_id TEXT NOT NULL, contenedor_id TEXT DEFAULT '', autor TEXT NOT NULL, fecha TEXT NOT NULL, texto TEXT NOT NULL);
`;

function monta(app, ctx) {
  const { requiereSesion, requiereRol, almacen, express, db } = ctx;
  db.exec(ESQUEMA);
  const I = ctx.cdeInterno; const J = express.json({ limit: '2mb' });
  const proyecto = I.proyecto, yo = I.yo, permisoEn = I.permisoEn, guardaConfig = I.guardaConfig;
  const gestor = (u) => u.admin || ['gestor', 'administrador'].includes(u.rol);
  const contDe = (pid, cid) => abreJson(q.uno("SELECT * FROM contenedores WHERE id = ? AND proyecto_id = ? AND borrado = ''", cid, pid), ['campos', 'atributos']);
  const puedeLeer = (p, u, c) => permisoEn(p, u, c.carpeta).leer || (c.carpeta_publicada && permisoEn(p, u, c.carpeta_publicada).leer) || (c.retencion && permisoEn(p, u, c.retencion).subir);
  const ultimaDe = (cid) => q.uno('SELECT * FROM versiones WHERE contenedor_id = ? ORDER BY n DESC LIMIT 1', cid);

  // ======================= CONFORMIDAD: normas, carpeta, retencion, duplicados =======================
  app.get('/api/proyectos/:pid/normas', requiereSesion, requiereRol('lector'), (req, res) => {
    const p = proyecto(req.pid);
    res.json({ normas: (p.config.normas || []).map(n => Object.assign({}, n, { vista: NOM.vistaPreliminar(n), carpetas: (p.config.carpetas || []).filter(c => c.norma === n.id).map(c => c.ruta) })), porDefecto: p.config.normaPorDefecto || '', conformidad: p.config.conformidad || {}, carpetasLibres: (p.config.carpetas || []).filter(c => c.norma === 'libre').map(c => c.ruta) });
  });
  app.post('/api/proyectos/:pid/normas', requiereSesion, requiereRol('gestor'), J, (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p), b = Object.assign({}, req.body || {}); delete b.id;
    const n = NOM.normalizaNorma(b, p.config.normas, u.email); if (n.error) return res.status(400).json({ error: 'norma', mensaje: n.error });
    p.config.normas = (p.config.normas || []).concat([n.norma]); if (!p.config.normaPorDefecto || b.porDefecto) p.config.normaPorDefecto = n.norma.id;
    NOM.sincronizaLegado(p.config); guardaConfig(p); audita(u.email, 'norma.crear', req.pid, n.norma.id, { nombre: n.norma.nombre }); res.json({ ok: true, norma: n.norma });
  });
  app.put('/api/proyectos/:pid/normas/:nid', requiereSesion, requiereRol('gestor'), J, (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p), i = (p.config.normas || []).findIndex(n => n.id === req.params.nid); if (i < 0) return res.status(404).json({ error: 'no-existe' });
    const n = NOM.normalizaNorma(Object.assign({}, req.body || {}, { id: req.params.nid, creado: p.config.normas[i].creado, por: p.config.normas[i].por }), p.config.normas.filter(x => x.id !== req.params.nid), u.email); if (n.error) return res.status(400).json({ error: 'norma', mensaje: n.error });
    p.config.normas[i] = n.norma; if ((req.body || {}).porDefecto) p.config.normaPorDefecto = n.norma.id;
    NOM.sincronizaLegado(p.config); guardaConfig(p); audita(u.email, 'norma.editar', req.pid, n.norma.id, {}); res.json({ ok: true, norma: n.norma });
  });
  app.delete('/api/proyectos/:pid/normas/:nid', requiereSesion, requiereRol('gestor'), (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p), lista = p.config.normas || []; if (!lista.some(n => n.id === req.params.nid)) return res.status(404).json({ error: 'no-existe' });
    p.config.normas = lista.filter(n => n.id !== req.params.nid); p.config.carpetas = CAR.normaliza((p.config.carpetas || []).map(c => c.norma === req.params.nid ? Object.assign({}, c, { norma: undefined }) : c));
    if (p.config.normaPorDefecto === req.params.nid) p.config.normaPorDefecto = (p.config.normas[0] || {}).id || '';
    NOM.sincronizaLegado(p.config); guardaConfig(p); audita(u.email, 'norma.borrar', req.pid, req.params.nid, {}); res.json({ ok: true });
  });
  app.put('/api/proyectos/:pid/conformidad', requiereSesion, requiereRol('gestor'), J, (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p), b = req.body || {};
    p.config.conformidad = Object.assign({}, p.config.conformidad || {}, b.areaRetencion !== undefined ? { areaRetencion: !!b.areaRetencion } : {}, b.wipLibre !== undefined ? { wipLibre: !!b.wipLibre } : {});
    if (b.normaPorDefecto !== undefined) { if (b.normaPorDefecto && !(p.config.normas || []).some(n => n.id === b.normaPorDefecto)) return res.status(400).json({ error: 'norma' }); p.config.normaPorDefecto = b.normaPorDefecto; }
    NOM.sincronizaLegado(p.config); guardaConfig(p); audita(u.email, 'conformidad.editar', req.pid, '', b); res.json({ ok: true, conformidad: p.config.conformidad, normaPorDefecto: p.config.normaPorDefecto });
  });
  app.post('/api/proyectos/:pid/duplicados', requiereSesion, requiereRol('lector'), J, (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p), b = req.body || {};
    const carpetas = (Array.isArray(b.carpetas) ? b.carpetas : []).map(CAR.limpia), atributos = (Array.isArray(b.atributos) && b.atributos.length ? b.atributos : ['nombre']).map(String).slice(0, 6);
    const lista = q.todos("SELECT * FROM contenedores WHERE proyecto_id = ? AND borrado = ''", req.pid).map(c => abreJson(c, ['campos'])).filter(c => permisoEn(p, u, c.carpeta).leer);
    for (const c of lista) c.ultima = q.uno('SELECT n, archivo, sha256 FROM versiones WHERE contenedor_id = ? ORDER BY n DESC LIMIT 1', c.id);
    res.json({ grupos: NOM.duplicados(lista, carpetas, atributos), revisados: lista.length });
  });
  /** Comprobar varios archivos contra la norma de una carpeta (lo usa "Enviar para revision" para avisar y "cambiar nombre por lotes"). */
  app.post('/api/proyectos/:pid/conformidad/comprobar', requiereSesion, requiereRol('lector'), J, (req, res) => {
    const p = proyecto(req.pid), b = req.body || {}, carpeta = CAR.limpia(b.carpeta || ''), out = [];
    for (const cid of (Array.isArray(b.contenedores) ? b.contenedores : []).slice(0, 500)) { const c = contDe(req.pid, String(cid)); if (!c) continue; const v = ultimaDe(c.id); const val = v ? NOM.valida(p.config, carpeta, v.archivo) : { ok: true }; out.push({ id: c.id, nombre: c.nombre, archivo: v ? v.archivo : '', ok: val.ok, libre: !!val.libre, errores: val.errores || [], norma: val.norma || null }); }
    res.json({ archivos: out, norma: NOM.normaDe(p.config, carpeta).norma });
  });

  // ======================= CAMBIAR NOMBRE =======================
  app.post('/api/proyectos/:pid/contenedores/:cid/renombrar', requiereSesion, requiereRol('autor'), J, (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p), c = contDe(req.pid, req.params.cid); if (!c) return res.status(404).json({ error: 'no-existe' });
    if (!(gestor(u) || permisoEn(p, u, c.retencion || c.carpeta).editar || (c.retencion && permisoEn(p, u, c.retencion).subir))) return res.status(403).json({ error: 'sin-permiso', mensaje: 'Hace falta permiso de edicion sobre la carpeta.' });
    if (q.uno("SELECT 1 FROM revisiones WHERE contenedor_id = ? AND estado = 'abierta'", c.id) && !(req.body || {}).enRevision) return res.status(409).json({ error: 'revision-abierta', mensaje: 'Tiene una revision abierta.' });
    const v = ultimaDe(c.id); if (!v) return res.status(409).json({ error: 'version', mensaje: 'Sin versiones.' });
    let nuevo = String((req.body || {}).nombre || '').trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 200); if (!nuevo) return res.status(400).json({ error: 'datos', mensaje: 'Indica el nombre nuevo.' });
    if (!/\.[A-Za-z0-9]{1,8}$/.test(nuevo)) nuevo += '.' + v.extension;
    const carpetaNorma = CAR.limpia((req.body || {}).carpeta || c.retencion || c.carpeta);
    const val = NOM.valida(p.config, carpetaNorma, nuevo); if (!val.ok) return res.status(400).json({ error: 'nomenclatura', mensaje: 'El nombre nuevo no cumple la norma' + (val.norma ? ' «' + val.norma.nombre + '»' : '') + '.', errores: val.errores });
    if (val.base !== c.nombre && q.uno('SELECT 1 FROM contenedores WHERE proyecto_id = ? AND nombre = ?', req.pid, val.base)) return res.status(409).json({ error: 'existe', mensaje: 'Ya hay un archivo con ese nombre en el proyecto.' });
    const antes = c.nombre, fecha = ahora();
    // cada version conserva su revision y extension; cambia la base
    for (const vv of q.todos('SELECT id, revision, extension FROM versiones WHERE contenedor_id = ?', c.id)) q.corre('UPDATE versiones SET archivo = ? WHERE id = ?', val.base + (vv.revision ? '-' + vv.revision : '') + '.' + vv.extension, vv.id);
    const sale = c.retencion && val.ok && !val.libre;   // estaba retenido y ahora cumple: entra a su carpeta
    q.corre("UPDATE contenedores SET nombre = ?, campos = ?, carpeta = CASE WHEN ? THEN retencion ELSE carpeta END, retencion = CASE WHEN ? THEN '' ELSE retencion END, actualizado = ? WHERE id = ?", val.base, JSON.stringify(val.campos), sale ? 1 : 0, sale ? 1 : 0, fecha, c.id);
    q.corre('INSERT INTO transiciones (contenedor_id, version_id, de, a, por, fecha, comentario) VALUES (?,?,?,?,?,?,?)', c.id, v.id, c.estado, c.estado, u.email, fecha, 'Renombrado [' + antes + ' → ' + val.base + ']' + (sale ? ' [sale del area de retencion a ' + c.retencion + ']' : ''));
    audita(u.email, 'contenedor.renombrar', req.pid, val.base, { de: antes, retenido: !!c.retencion });
    res.json({ ok: true, nombre: val.base, archivo: val.base + (v.revision ? '-' + v.revision : '') + '.' + v.extension, carpeta: sale ? c.retencion : c.carpeta, salioDeRetencion: !!sale });
  });

  // ======================= CONJUNTOS =======================
  const abreConj = (c) => abreJson(c, ['items']);
  app.get('/api/proyectos/:pid/conjuntos', requiereSesion, requiereRol('lector'), (req, res) => {
    const lista = q.todos("SELECT * FROM conjuntos WHERE proyecto_id = ? AND borrado = '' ORDER BY actualizado DESC", req.pid).map(abreConj);
    res.json({ conjuntos: lista.map(c => Object.assign(c, { n: c.items.length })) });
  });
  app.get('/api/proyectos/:pid/conjuntos/:sid', requiereSesion, requiereRol('lector'), (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p), c = abreConj(q.uno("SELECT * FROM conjuntos WHERE id = ? AND proyecto_id = ? AND borrado = ''", req.params.sid, req.pid)); if (!c) return res.status(404).json({ error: 'no-existe' });
    c.archivos = c.items.map(it => { const k = contDe(req.pid, it.contenedor_id); if (!k || !puedeLeer(p, u, k)) return null; const v = it.version_id ? q.uno('SELECT * FROM versiones WHERE id = ?', it.version_id) : ultimaDe(k.id); return { contenedor_id: k.id, nombre: k.nombre, carpeta: k.carpeta, estado: k.estado, tipo: k.tipo, version: v ? { id: v.id, n: v.n, revision: v.revision, idoneidad: v.idoneidad, archivo: v.archivo, tamano: v.tamano, fecha: v.fecha } : null, ultima: (ultimaDe(k.id) || {}).n }; }).filter(Boolean);
    res.json(c);
  });
  app.post('/api/proyectos/:pid/conjuntos', requiereSesion, requiereRol('autor'), J, (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p), b = req.body || {}, nombre = String(b.nombre || '').trim().slice(0, 160); if (!nombre) return res.status(400).json({ error: 'datos', mensaje: 'Falta el nombre.' });
    const items = (Array.isArray(b.items) ? b.items : []).map(it => ({ contenedor_id: String(it.contenedor_id || it.id || ''), version_id: String(it.version_id || '') })).filter(it => it.contenedor_id && contDe(req.pid, it.contenedor_id)).slice(0, 2000);
    const sid = id('cj'), fecha = ahora();
    q.corre('INSERT INTO conjuntos (id, proyecto_id, nombre, descripcion, items, por, creado, actualizado) VALUES (?,?,?,?,?,?,?,?)', sid, req.pid, nombre, String(b.descripcion || '').slice(0, 1000), JSON.stringify(items), u.email, fecha, fecha);
    audita(u.email, 'conjunto.crear', req.pid, nombre, { n: items.length }); res.json({ ok: true, id: sid, n: items.length });
  });
  app.put('/api/proyectos/:pid/conjuntos/:sid', requiereSesion, requiereRol('autor'), J, (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p), c = abreConj(q.uno("SELECT * FROM conjuntos WHERE id = ? AND proyecto_id = ? AND borrado = ''", req.params.sid, req.pid)); if (!c) return res.status(404).json({ error: 'no-existe' });
    if (!(c.por === u.email || gestor(u))) return res.status(403).json({ error: 'sin-permiso' });
    const b = req.body || {}; let items = c.items;
    if (Array.isArray(b.items)) items = b.items.map(it => ({ contenedor_id: String(it.contenedor_id || it.id || ''), version_id: String(it.version_id || '') })).filter(it => it.contenedor_id).slice(0, 2000);
    if (Array.isArray(b.agregar)) for (const it of b.agregar) { const cid = String(it.contenedor_id || it.id || ''); if (cid && !items.some(x => x.contenedor_id === cid) && contDe(req.pid, cid)) items.push({ contenedor_id: cid, version_id: String(it.version_id || '') }); }
    if (Array.isArray(b.quitar)) items = items.filter(x => !b.quitar.includes(x.contenedor_id));
    q.corre('UPDATE conjuntos SET nombre = ?, descripcion = ?, items = ?, actualizado = ? WHERE id = ?', b.nombre !== undefined ? String(b.nombre).trim().slice(0, 160) || c.nombre : c.nombre, b.descripcion !== undefined ? String(b.descripcion).slice(0, 1000) : c.descripcion, JSON.stringify(items), ahora(), c.id);
    audita(u.email, 'conjunto.editar', req.pid, c.nombre, { n: items.length }); res.json({ ok: true, n: items.length });
  });
  app.delete('/api/proyectos/:pid/conjuntos/:sid', requiereSesion, requiereRol('autor'), (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p), c = q.uno("SELECT * FROM conjuntos WHERE id = ? AND proyecto_id = ? AND borrado = ''", req.params.sid, req.pid); if (!c) return res.status(404).json({ error: 'no-existe' });
    if (!(c.por === u.email || gestor(u))) return res.status(403).json({ error: 'sin-permiso' });
    q.corre('UPDATE conjuntos SET borrado = ? WHERE id = ?', ahora(), c.id); audita(u.email, 'conjunto.borrar', req.pid, c.nombre, {}); res.json({ ok: true });
  });

  // ======================= PUENTE (compartir carpetas con otro proyecto, con sincronizacion) =======================
  const puentesDe = (p) => Array.isArray(p.config.puentes) ? p.config.puentes : [];
  /** Copia una version a otro proyecto/carpeta (lo usa compartir carpeta y la sincronizacion del puente). Devuelve { ok, contenedor, version } o { error }. */
  async function copiaA(p, u, c, v, pd, carpeta, nota) {
    const ud = yo({ quien: u.email, admin: u.admin }, pd); if (!ud.rol && !ud.admin) return { error: 'No eres miembro del proyecto de destino.' };
    const conC = Array.isArray(pd.config.carpetas) && pd.config.carpetas.length > 0;
    if (conC && (!carpeta || !CAR.def(pd.config.carpetas, carpeta))) return { error: 'La carpeta de destino no existe en ' + pd.codigo + '.' };
    if (conC && !CAR.permiso(pd.config.carpetas, ud, carpeta).subir) return { error: 'Sin permiso de carga en ' + pd.codigo + '/' + carpeta + '.' };
    if (!almacen.existe(v.ruta_almacen)) return { error: 'El archivo no esta en el almacen.' };
    const val = conC ? NOM.valida(pd.config, carpeta, v.archivo) : ISO.valida(v.archivo, pd.config); if (!val.ok) return { error: v.archivo + ': no cumple la norma del destino (' + (val.errores || []).join(' ') + ')' };
    let cd = q.uno('SELECT * FROM contenedores WHERE proyecto_id = ? AND nombre = ?', pd.id, val.base); const fecha = ahora();
    if (cd && cd.borrado) return { error: 'En el destino ese archivo esta suprimido.' };
    if (cd && q.uno('SELECT 1 FROM versiones WHERE contenedor_id = ? AND sha256 = ?', cd.id, v.sha256)) return { ok: true, contenedor: cd.id, version: null, repetido: true };
    const zona = conC ? CAR.zonaDe(pd.config.carpetas, carpeta) : '', estadoIni = zona === 'compartido' ? 'COMPARTIDO' : zona === 'publicado' ? 'PUBLICADO' : 'WIP';
    if (!cd) { cd = { id: id('c'), version_actual: 0, estado: estadoIni }; q.corre('INSERT INTO contenedores (id, proyecto_id, nombre, tipo, carpeta, estado, campos, version_actual, creado, creado_por, actualizado, carpeta_compartida, atributos) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', cd.id, pd.id, val.base, c.tipo, carpeta, estadoIni, JSON.stringify(val.campos), 0, fecha, u.email, fecha, estadoIni === 'COMPARTIDO' ? carpeta : '', JSON.stringify(c.atributos || {})); }
    else if (q.uno("SELECT 1 FROM revisiones WHERE contenedor_id = ? AND estado = 'abierta'", cd.id)) return { error: 'En el destino ' + val.base + ' tiene una revision abierta.' };
    const n = (cd.version_actual || 0) + 1, vid = id('v'), g = await almacen.guarda(pd.id, cd.id, vid, v.archivo, almacen.flujo(v.ruta_almacen));
    q.corre('INSERT INTO versiones (id, contenedor_id, n, archivo, extension, tamano, sha256, revision, idoneidad, estado_al_subir, origen, ruta_almacen, meta, subido_por, fecha, resumen) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', vid, cd.id, n, v.archivo, v.extension, g.tamano, g.sha256, v.revision, v.idoneidad, cd.estado, 'puente:' + p.codigo, g.ruta, JSON.stringify(Object.assign({}, json(v.meta, {}), { compartidoDe: { proyecto: p.codigo, contenedor: c.id, version: v.id, nota } })), u.email, fecha, v.resumen || '{}');
    q.corre('UPDATE contenedores SET version_actual = ?, actualizado = ? WHERE id = ?', n, fecha, cd.id);
    return { ok: true, contenedor: cd.id, version: vid, n };
  }
  app.get('/api/proyectos/:pid/puentes', requiereSesion, requiereRol('lector'), (req, res) => {
    const p = proyecto(req.pid);
    const entrantes = q.todos('SELECT id, codigo, nombre, config FROM proyectos WHERE id <> ? AND activo = 1', req.pid).map(x => abreJson(x, ['config'])).flatMap(x => (x.config.puentes || []).filter(b => b.destino.proyecto === req.pid).map(b => Object.assign({}, b, { origenProyecto: { id: x.id, codigo: x.codigo, nombre: x.nombre } })));
    const salientes = puentesDe(p).map(b => { const d = q.uno('SELECT id, codigo, nombre FROM proyectos WHERE id = ?', b.destino.proyecto); return Object.assign({}, b, { destinoProyecto: d }); });
    res.json({ salientes, entrantes });
  });
  app.post('/api/proyectos/:pid/puentes', requiereSesion, requiereRol('autor'), J, async (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p), b = req.body || {};
    const origen = CAR.limpia(b.carpeta || ''), pd = proyecto(String(b.proyecto_destino || '')), destino = CAR.limpia(b.carpeta_destino || '');
    if (!pd || pd.id === p.id) return res.status(400).json({ error: 'datos', mensaje: 'Elige otro proyecto.' });
    if (origen && !CAR.def(p.config.carpetas, origen)) return res.status(404).json({ error: 'no-existe', mensaje: 'La carpeta de origen no existe.' });
    if (!permisoEn(p, u, origen).leer && !gestor(u)) return res.status(403).json({ error: 'sin-permiso' });
    const ud = yo(req, pd); if (!(ud.rol || ud.admin)) return res.status(403).json({ error: 'sin-permiso', mensaje: 'No eres miembro del proyecto de destino.' });
    if (destino && !CAR.def(pd.config.carpetas, destino)) return res.status(404).json({ error: 'no-existe', mensaje: 'La carpeta de destino no existe en ' + pd.codigo + '.' });
    const pu = { id: id('pu'), titulo: String(b.titulo || (CAR.nombreDe(origen) || p.codigo) + ' → ' + pd.codigo).slice(0, 160), origen: { carpeta: origen }, destino: { proyecto: pd.id, carpeta: destino }, subcarpetas: b.subcarpetas !== false, sincronizar: !!b.sincronizar, por: u.email, creado: ahora(), copiados: 0, ultimo: '' };
    // copia inicial de lo que ya hay (ultima version de cada archivo)
    const errores = []; let n = 0;
    const lista = q.todos("SELECT * FROM contenedores WHERE proyecto_id = ? AND borrado = '' AND retencion = '' AND (? = '' OR carpeta = ? OR carpeta LIKE ?)", req.pid, origen, origen, origen + '/%').map(c => abreJson(c, ['campos', 'atributos'])).filter(c => pu.subcarpetas || c.carpeta === origen).filter(c => permisoEn(p, u, c.carpeta).descargar);
    for (const c of lista) {
      const v = ultimaDe(c.id); if (!v) continue;
      const rel = c.carpeta.slice(origen.length).replace(/^\//, ''), carpetaD = destino + (rel ? (destino ? '/' : '') + rel : '');
      if (pu.subcarpetas && rel && !CAR.def(pd.config.carpetas, carpetaD)) { const r = CAR.crea(pd.config.carpetas, CAR.padreDe(carpetaD) || '', CAR.nombreDe(carpetaD), { permisos: null }); if (!r.error) { pd.config.carpetas = r.carpetas; guardaConfig(pd); } }
      try { const r = await copiaA(p, u, c, v, pd, CAR.def(pd.config.carpetas, carpetaD) ? carpetaD : destino, pu.titulo); if (r.error) errores.push(c.nombre + ': ' + r.error); else if (!r.repetido) n++; } catch (e) { errores.push(c.nombre + ': ' + e.message); }
    }
    pu.copiados = n; pu.ultimo = ahora();
    if (pu.sincronizar) { p.config.puentes = puentesDe(p).concat([pu]); guardaConfig(p); }
    audita(u.email, 'puente.crear', req.pid, pu.titulo, { destino: pd.codigo, carpeta: destino, copiados: n, sincronizar: pu.sincronizar });
    res.json({ ok: !errores.length, puente: pu, copiados: n, errores });
  });
  app.delete('/api/proyectos/:pid/puentes/:bid', requiereSesion, requiereRol('autor'), (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p), pu = puentesDe(p).find(b => b.id === req.params.bid); if (!pu) return res.status(404).json({ error: 'no-existe' });
    if (!(pu.por === u.email || gestor(u))) return res.status(403).json({ error: 'sin-permiso' });
    p.config.puentes = puentesDe(p).filter(b => b.id !== pu.id); guardaConfig(p); audita(u.email, 'puente.quitar', req.pid, pu.titulo, {}); res.json({ ok: true });
  });
  /** Sincronizacion: cuando se carga una version en una carpeta con puente, se copia sola al destino (lo llama cde.js tras subir). */
  async function sincroniza(pid, cid, vid, quienEmail) {
    const p = proyecto(pid); if (!p || !puentesDe(p).length) return;
    const c = contDe(pid, cid), v = q.uno('SELECT * FROM versiones WHERE id = ?', vid); if (!c || !v || c.retencion) return;
    for (const pu of puentesDe(p)) {
      if (!pu.sincronizar) continue; const o = pu.origen.carpeta;
      if (!(o === '' || c.carpeta === o || (pu.subcarpetas && c.carpeta.startsWith(o + '/')))) continue;
      const pd = proyecto(pu.destino.proyecto); if (!pd) continue;
      const rel = c.carpeta.slice(o.length).replace(/^\//, ''), carpetaD = pu.destino.carpeta + (rel ? (pu.destino.carpeta ? '/' : '') + rel : '');
      try { const r = await copiaA(p, { email: pu.por, admin: false }, c, v, pd, CAR.def(pd.config.carpetas, carpetaD) ? carpetaD : pu.destino.carpeta, pu.titulo); if (r.ok && !r.repetido) { pu.copiados = (pu.copiados || 0) + 1; pu.ultimo = ahora(); p.config.puentes = puentesDe(p).map(x => x.id === pu.id ? pu : x); guardaConfig(p); audita(quienEmail, 'puente.sincronizar', pid, c.nombre, { destino: pd.codigo, carpeta: carpetaD }); } else if (r.error) audita(quienEmail, 'puente.error', pid, c.nombre, { error: r.error }); } catch (e) { audita(quienEmail, 'puente.error', pid, c.nombre, { error: e.message }); }
    }
  }
  ctx.puentes = { sincroniza, copiaA };

  // ======================= INFORMES DE TRANSMISION =======================
  const abreTr = (t) => abreJson(t, ['destinatarios', 'archivos']);
  const normDest = (lista, pid) => (Array.isArray(lista) ? lista : []).map(d => typeof d === 'string' ? { email: d.trim().toLowerCase() } : { email: String(d.email || '').trim().toLowerCase(), org: String(d.org || '').toUpperCase() }).filter(d => d.email || d.org).slice(0, 200);
  app.get('/api/proyectos/:pid/transmisiones', requiereSesion, requiereRol('lector'), (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p), qq = String((req.query || {}).q || '').toLowerCase();
    let lista = q.todos('SELECT * FROM transmisiones WHERE proyecto_id = ? ORDER BY numero DESC LIMIT 2000', req.pid).map(abreTr);
    if (qq) lista = lista.filter(t => (t.titulo + ' ' + t.numero).toLowerCase().includes(qq));
    const orgDe = {}; for (const m of I.miembrosDe(req.pid)) orgDe[m.email] = m.organizacion;
    res.json({ transmisiones: lista.map(t => ({ id: t.id, numero: t.numero, titulo: t.titulo, por: t.por, org: t.org, creado: t.creado, estado: t.estado, destinatarios: t.destinatarios, empresas: [...new Set(t.destinatarios.map(d => d.org || orgDe[d.email] || '').filter(Boolean))], n: t.archivos.length, correo_id: t.correo_id })) });
  });
  app.get('/api/proyectos/:pid/transmisiones/:tid', requiereSesion, requiereRol('lector'), (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p), t = abreTr(q.uno('SELECT * FROM transmisiones WHERE id = ? AND proyecto_id = ?', req.params.tid, req.pid)); if (!t) return res.status(404).json({ error: 'no-existe' });
    t.archivos = t.archivos.map(a => { const v = q.uno('SELECT * FROM versiones WHERE id = ?', a.version_id); if (!v) return null; const c = abreJson(q.uno('SELECT * FROM contenedores WHERE id = ?', v.contenedor_id), ['campos', 'atributos']); const rv = q.uno("SELECT estado, numero FROM revisiones WHERE version_id = ? ORDER BY ronda DESC LIMIT 1", v.id); const res0 = json(v.resumen, {}); return { contenedor_id: c.id, nombre: c.nombre, archivo: v.archivo, carpeta: c.carpeta, version_id: v.id, n: v.n, revision: v.revision, idoneidad: v.idoneidad, tamano: v.tamano, fecha: v.fecha, subido_por: v.subido_por, descripcion: (c.atributos || {}).descripcion || res0.descripcion || '', estadoRevision: rv ? rv.estado + ' (#' + rv.numero + ')' : '', puedoDescargar: puedeLeer(p, u, c) || t.destinatarios.some(d => d.email === u.email || (d.org && d.org === u.organizacion)) }; }).filter(Boolean);
    res.json(t);
  });
  app.post('/api/proyectos/:pid/transmisiones', requiereSesion, requiereRol('autor'), J, (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p), b = req.body || {}, titulo = String(b.titulo || '').trim().slice(0, 300); if (!titulo) return res.status(400).json({ error: 'datos', mensaje: 'Falta el titulo.' });
    const admins = ((p.config.paquetes || {}).administradores || []); if (admins.length && !admins.includes(u.email) && !gestor(u)) return res.status(403).json({ error: 'sin-permiso', mensaje: 'Solo los administradores de paquetes crean informes de transmision.' });
    const dest = normDest(b.destinatarios, req.pid); if (!dest.length) return res.status(400).json({ error: 'datos', mensaje: 'Indica al menos un destinatario.' });
    const archivos = []; for (const a of (Array.isArray(b.archivos) ? b.archivos : []).slice(0, 1000)) { const cid = String(a.contenedor_id || a.id || ''), c = cid ? contDe(req.pid, cid) : null; if (!c || !puedeLeer(p, u, c)) continue; const v = a.version_id ? q.uno('SELECT id FROM versiones WHERE id = ? AND contenedor_id = ?', String(a.version_id), c.id) : ultimaDe(c.id); if (v) archivos.push({ contenedor_id: c.id, version_id: v.id }); }
    if (!archivos.length) return res.status(400).json({ error: 'datos', mensaje: 'Elige al menos un archivo con version.' });
    const numero = (q.uno('SELECT MAX(numero) AS m FROM transmisiones WHERE proyecto_id = ?', req.pid).m || 0) + 1, tid = id('tr'), fecha = ahora();
    let correo = '';
    if (b.copiaCorreo) {   // copia en la correspondencia (tipo transmittal si existe) con las versiones adjuntas
      const mid = id('m'); const paraCorreo = dest.map(d => ({ email: d.email || '', org: d.org || ((I.miembrosDe(req.pid).find(m => m.email === d.email) || {}).organizacion || '') }));
      q.corre('INSERT INTO correos (id, proyecto_id, numero, tipo, asunto, cuerpo, de_email, de_org, para, cc, respuesta, vence, estado, hilo_id, responde_a, adjuntos, campos, creado, enviado, actualizado) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', mid, req.pid, u.organizacion + '-TRA-' + String(numero).padStart(6, '0'), 'transmittal', 'Informe de transmision #' + numero + ' · ' + titulo, String(b.mensaje || ''), u.email, u.organizacion, JSON.stringify(paraCorreo), '[]', 'informacion', '', 'enviado', mid, '', JSON.stringify(archivos.map(a => ({ tipo: 'version', id: a.version_id }))), '{}', fecha, fecha, fecha);
      correo = mid;
    }
    q.corre('INSERT INTO transmisiones (id, proyecto_id, numero, titulo, mensaje, destinatarios, permitir_anadir, archivos, grupo_atributos, por, org, creado, correo_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', tid, req.pid, numero, titulo, String(b.mensaje || '').slice(0, 8000), JSON.stringify(dest), b.permitirAnadir ? 1 : 0, JSON.stringify(archivos), String(b.grupoAtributos || '').slice(0, 60), u.email, u.organizacion, fecha, correo);
    audita(u.email, 'transmision.crear', req.pid, '#' + numero, { titulo, archivos: archivos.length, destinatarios: dest.length }); res.json({ ok: true, id: tid, numero, correo });
  });
  app.post('/api/proyectos/:pid/transmisiones/:tid/destinatarios', requiereSesion, requiereRol('lector'), J, (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p), t = abreTr(q.uno('SELECT * FROM transmisiones WHERE id = ? AND proyecto_id = ?', req.params.tid, req.pid)); if (!t) return res.status(404).json({ error: 'no-existe' });
    const soyDest = t.destinatarios.some(d => d.email === u.email); if (!(t.por === u.email || gestor(u) || (t.permitir_anadir && soyDest))) return res.status(403).json({ error: 'sin-permiso', mensaje: 'Este informe no permite que los destinatarios anadan a otros.' });
    const nuevos = normDest((req.body || {}).destinatarios, req.pid).filter(d => !t.destinatarios.some(x => x.email === d.email && (x.org || '') === (d.org || '')));
    q.corre('UPDATE transmisiones SET destinatarios = ? WHERE id = ?', JSON.stringify(t.destinatarios.concat(nuevos)), t.id); res.json({ ok: true, anadidos: nuevos.length });
  });
  app.get('/api/proyectos/:pid/transmisiones/:tid/descargar', requiereSesion, requiereRol('lector'), async (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p), t = abreTr(q.uno('SELECT * FROM transmisiones WHERE id = ? AND proyecto_id = ?', req.params.tid, req.pid)); if (!t) return res.status(404).json({ error: 'no-existe' });
    const esDest = t.destinatarios.some(d => d.email === u.email || (d.org && d.org === u.organizacion)) || t.por === u.email || gestor(u);
    const entradas = [];
    for (const a of t.archivos) { const v = q.uno('SELECT v.*, c.carpeta FROM versiones v JOIN contenedores c ON c.id = v.contenedor_id WHERE v.id = ?', a.version_id); if (!v || !almacen.existe(v.ruta_almacen)) continue; if (!(esDest || permisoEn(p, u, v.carpeta).descargar)) continue; entradas.push({ nombre: (v.carpeta ? v.carpeta + '/' : '') + v.archivo, ruta: almacen.rutaAbsoluta(v.ruta_almacen), tamano: v.tamano }); }
    if (!entradas.length) return res.status(404).json({ error: 'vacio', mensaje: 'Nada que descargar.' });
    audita(u.email, 'transmision.descargar', req.pid, '#' + t.numero, { archivos: entradas.length });
    res.setHeader('Content-Type', 'application/zip'); res.setHeader('Content-Disposition', 'attachment; filename*=UTF-8\'\'' + encodeURIComponent('transmision-' + t.numero + '.zip'));
    try { await require('./zipflujo').escribe(res, entradas); } catch (e) { res.destroy(e); }
  });

  // ======================= INCIDENCIAS: suprimir / restaurar / posicion / configuracion =======================
  app.delete('/api/proyectos/:pid/incidencias/:iid', requiereSesion, requiereRol('autor'), J, (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p), i = q.uno("SELECT * FROM incidencias WHERE id = ? AND proyecto_id = ? AND borrado = ''", req.params.iid, req.pid); if (!i) return res.status(404).json({ error: 'no-existe' });
    if (!(i.autor === u.email || gestor(u))) return res.status(403).json({ error: 'sin-permiso', mensaje: 'Solo quien la creo o el gestor suprime una incidencia.' });
    const motivo = String((req.body || {}).comentario || '').slice(0, 1000);
    q.corre('UPDATE incidencias SET borrado = ?, borrado_por = ?, borrado_motivo = ? WHERE id = ?', ahora(), u.email, motivo, i.id);
    q.corre('INSERT INTO comentarios (incidencia_id, autor, fecha, texto, estado_nuevo) VALUES (?,?,?,?,?)', i.id, u.email, ahora(), 'Suprimida' + (motivo ? ': ' + motivo : ''), '');
    audita(u.email, 'incidencia.suprimir', req.pid, i.codigo, { motivo }); res.json({ ok: true });
  });
  app.post('/api/proyectos/:pid/incidencias/:iid/restaurar', requiereSesion, requiereRol('autor'), (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p), i = q.uno("SELECT * FROM incidencias WHERE id = ? AND proyecto_id = ? AND borrado <> ''", req.params.iid, req.pid); if (!i) return res.status(404).json({ error: 'no-existe' });
    if (!(i.borrado_por === u.email || i.autor === u.email || gestor(u))) return res.status(403).json({ error: 'sin-permiso' });
    q.corre("UPDATE incidencias SET borrado = '', borrado_por = '', borrado_motivo = '' WHERE id = ?", i.id); q.corre('INSERT INTO comentarios (incidencia_id, autor, fecha, texto, estado_nuevo) VALUES (?,?,?,?,?)', i.id, u.email, ahora(), 'Restaurada', '');
    audita(u.email, 'incidencia.restaurar', req.pid, i.codigo, {}); res.json({ ok: true });
  });
  app.put('/api/proyectos/:pid/incidencias/:iid', requiereSesion, requiereRol('autor'), J, (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p), i = q.uno("SELECT * FROM incidencias WHERE id = ? AND proyecto_id = ? AND borrado = ''", req.params.iid, req.pid); if (!i) return res.status(404).json({ error: 'no-existe' });
    if (!(i.autor === u.email || i.asignado === u.email || gestor(u) || u.rol === 'revisor' || u.rol === 'revisor-dc')) return res.status(403).json({ error: 'sin-permiso' });
    const b = req.body || {}, sets = [], vals = [];
    for (const [k, max] of [['titulo', 300], ['descripcion', 8000], ['tipo', 40], ['prioridad', 20], ['disciplina', 120], ['etapa', 60], ['nivel', 80], ['ambiente', 120], ['responsable_org', 40], ['referencia', 300], ['asignado', 160], ['vencimiento', 10], ['inicio', 10], ['tipo_revision', 80], ['entregable', 120]]) if (b[k] !== undefined) { sets.push(k + ' = ?'); vals.push(String(b[k] || '').slice(0, max)); }
    if (b.posicion !== undefined) { sets.push('posicion = ?'); vals.push(JSON.stringify(b.posicion && typeof b.posicion === 'object' ? { version_id: String(b.posicion.version_id || i.version_id), pagina: Math.max(0, parseInt(b.posicion.pagina, 10) || 0), x: Math.min(1, Math.max(0, +b.posicion.x || 0)), y: Math.min(1, Math.max(0, +b.posicion.y || 0)) } : {})); }
    if (Array.isArray(b.impacto)) { sets.push('impacto = ?'); vals.push(JSON.stringify(b.impacto.map(String).slice(0, 10))); }
    if (b.contractual !== undefined) { sets.push('contractual = ?'); vals.push(b.contractual ? 1 : 0); }
    if (!sets.length) return res.json({ ok: true }); vals.push(i.id);
    q.corre('UPDATE incidencias SET ' + sets.join(', ') + ' WHERE id = ?', ...vals); audita(u.email, 'incidencia.editar', req.pid, i.codigo, { campos: Object.keys(b) }); res.json({ ok: true });
  });
  app.post('/api/proyectos/:pid/incidencias/:iid/duplicar', requiereSesion, requiereRol('autor'), J, (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p), i = q.uno("SELECT * FROM incidencias WHERE id = ? AND proyecto_id = ? AND borrado = ''", req.params.iid, req.pid); if (!i) return res.status(404).json({ error: 'no-existe' });
    const numero = (q.uno('SELECT MAX(numero) AS m FROM incidencias WHERE proyecto_id = ?', req.pid).m || 0) + 1, nid = id('i'), codigo = 'INC-' + p.codigo + '-' + String(numero).padStart(4, '0'), fecha = ahora();
    q.corre('INSERT INTO incidencias (id, proyecto_id, numero, codigo, titulo, descripcion, estado, tipo, prioridad, contractual, autor, asignado, creado, vencimiento, contenedor_id, version_id, elementos, camara, captura, disciplina, etapa, nivel, ambiente, impacto, origen, responsable_org, referencia, posicion, inicio, tipo_revision, entregable) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      nid, req.pid, numero, codigo, i.titulo + ' (copia)', i.descripcion, 'abierta', i.tipo, i.prioridad, i.contractual, u.email, i.asignado, fecha, i.vencimiento, i.contenedor_id, i.version_id, i.elementos, i.camara, '', i.disciplina, i.etapa, i.nivel, i.ambiente, i.impacto, i.origen, i.responsable_org, i.referencia, i.posicion, i.inicio, i.tipo_revision || '', i.entregable || '');
    q.corre('INSERT INTO comentarios (incidencia_id, autor, fecha, texto, estado_nuevo) VALUES (?,?,?,?,?)', nid, u.email, fecha, 'Duplicada de ' + i.codigo, 'abierta');
    audita(u.email, 'incidencia.duplicar', req.pid, codigo, { de: i.codigo }); res.json({ ok: true, id: nid, numero, codigo });
  });
  /** Pines de incidencias de una version (para el visor de PDF). */
  app.get('/api/proyectos/:pid/versiones/:vid/incidencias', requiereSesion, requiereRol('lector'), (req, res) => {
    const lista = q.todos("SELECT id, numero, codigo, titulo, estado, tipo, prioridad, asignado, autor, creado, vencimiento, posicion, version_id FROM incidencias WHERE proyecto_id = ? AND borrado = '' AND (version_id = ? OR posicion LIKE ?) ORDER BY numero DESC", req.pid, req.params.vid, '%' + req.params.vid + '%').map(i => abreJson(i, ['posicion']));
    res.json({ incidencias: lista });
  });
  app.put('/api/proyectos/:pid/incidencias-configuracion', requiereSesion, requiereRol('gestor'), J, (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p), b = req.body || {};
    if (Array.isArray(b.disciplinas)) p.config.disciplinas = b.disciplinas.map(x => String(x).trim()).filter(Boolean).slice(0, 60);
    if (Array.isArray(b.etapas)) p.config.etapas = b.etapas.map(x => String(x).trim()).filter(Boolean).slice(0, 60);
    if (Array.isArray(b.tiposRevision)) p.config.tiposRevision = b.tiposRevision.map(x => String(x).trim().slice(0, 80)).filter(Boolean).slice(0, 60);
    if (Array.isArray(b.entregables)) p.config.entregables = b.entregables.map(x => String(x).trim().slice(0, 120)).filter(Boolean).slice(0, 100);
    if (Array.isArray(b.tiposIncidencia)) p.config.tiposIncidencia = b.tiposIncidencia.map(x => ({ id: String(x.id || x.nombre || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40), nombre: String(x.nombre || x.id || '').slice(0, 60), color: String(x.color || '').slice(0, 12) })).filter(x => x.id).slice(0, 40);
    if (b.camposIncidencia && typeof b.camposIncidencia === 'object') p.config.camposIncidencia = b.camposIncidencia;
    guardaConfig(p); audita(u.email, 'incidencias.configuracion', req.pid, '', { claves: Object.keys(b) }); res.json({ ok: true });
  });

  // ======================= REVISION #N: su pagina =======================
  function revisionDe(req, res) {
    const p = proyecto(req.pid), u = yo(req, p), r = abreJson(q.uno("SELECT r.*, c.nombre AS contenedor, c.carpeta, c.estado AS estado_contenedor, c.tipo, c.campos, c.atributos FROM revisiones r JOIN contenedores c ON c.id = r.contenedor_id WHERE r.id = ? AND c.proyecto_id = ?", req.params.rid, req.pid), ['pasos', 'flujo_def', 'campos', 'atributos']);
    if (!r) { res.status(404).json({ error: 'no-existe' }); return null; }
    return { p, u, r };
  }
  app.get('/api/proyectos/:pid/revisiones/:rid', requiereSesion, requiereRol('lector'), (req, res) => {
    const x = revisionDe(req, res); if (!x) return; const { p, u, r } = x, miembros = I.miembrosDe(req.pid);
    const fl = r.flujo_def && r.flujo_def.etapas ? r.flujo_def : I.flujoDe(p, r.flujo_id);
    I.decoraRevision(p, u, r, miembros);
    const orgDe = {}; for (const m of miembros) orgDe[m.email] = m;
    r.candidatos = fl ? fl.etapas.map((e, i) => ({ etapa: i, nombre: e.nombre, pasos: e.pasos.map(ps => ({ id: ps.id, nombre: ps.nombre, tipo: ps.tipo, dias: ps.dias, clave: FL.candidatos(ps, miembros), opcionales: FL.candidatos({ revisores: ps.opcionales || [] }, miembros) })) })) : [];
    const v = q.uno('SELECT * FROM versiones WHERE id = ?', r.version_id) || ultimaDe(r.contenedor_id);
    r.archivo = v ? { version_id: v.id, n: v.n, archivo: v.archivo, revision: v.revision, idoneidad: v.idoneidad, tamano: v.tamano, resumen: json(v.resumen, {}), marcas: q.uno("SELECT COUNT(*) AS n FROM marcas WHERE version_id = ? AND borrada = '' AND publicada = 1", v.id).n } : null;
    r.comentarios = q.todos('SELECT * FROM revision_comentarios WHERE revision_id = ? ORDER BY id', r.id);
    r.lote = r.lote || ''; r.hermanas = r.lote ? q.todos("SELECT r.id, r.numero, r.estado, c.nombre AS contenedor FROM revisiones r JOIN contenedores c ON c.id = r.contenedor_id WHERE r.lote = ? AND r.id <> ? AND c.proyecto_id = ?", r.lote, r.id, req.pid) : [];
    r.referencias = q.todos("SELECT id, numero, codigo, titulo, estado FROM incidencias WHERE revision_id = ? AND borrado = ''", r.id);
    r.puedoEditar = r.estado === 'abierta' && (r.solicitada_por === u.email || gestor(u));
    r.puedoOmitir = r.estado === 'abierta' && gestor(u);
    res.json(r);
  });
  app.put('/api/proyectos/:pid/revisiones/:rid', requiereSesion, requiereRol('autor'), J, (req, res) => {
    const x = revisionDe(req, res); if (!x) return; const { u, r } = x, b = req.body || {};
    if (!(r.estado === 'abierta' && (r.solicitada_por === u.email || gestor(u)))) return res.status(403).json({ error: 'sin-permiso', mensaje: 'Edita la revision quien la inicio o el gestor.' });
    const sets = [], vals = [];
    if (b.nombre !== undefined) { sets.push('nombre = ?'); vals.push(String(b.nombre).trim().slice(0, 200)); }
    if (b.notas !== undefined) { sets.push('notas = ?'); vals.push(String(b.notas).slice(0, 4000)); }
    if (b.vence !== undefined) { const d = String(b.vence).slice(0, 10); sets.push('vence = ?'); vals.push(d ? d + 'T23:59:59.000Z' : ''); }
    if (b.destino !== undefined) { const d = CAR.limpia(b.destino); if (d && !CAR.def(x.p.config.carpetas, d)) return res.status(400).json({ error: 'carpeta' }); sets.push('destino = ?'); vals.push(d); }
    if (!sets.length) return res.json({ ok: true }); vals.push(r.id);
    q.corre('UPDATE revisiones SET ' + sets.join(', ') + ' WHERE id = ?', ...vals); audita(u.email, 'revision.editar', req.pid, '#' + r.numero, { campos: Object.keys(b) }); res.json({ ok: true });
  });
  app.post('/api/proyectos/:pid/revisiones/:rid/comentar', requiereSesion, requiereRol('lector'), J, (req, res) => {
    const x = revisionDe(req, res); if (!x) return; const texto = String((req.body || {}).texto || '').trim().slice(0, 4000); if (!texto) return res.status(400).json({ error: 'datos' });
    q.corre('INSERT INTO revision_comentarios (revision_id, contenedor_id, autor, fecha, texto) VALUES (?,?,?,?,?)', x.r.id, x.r.contenedor_id, x.u.email, ahora(), texto); res.json({ ok: true });
  });
  /** Omitir el paso actual (gestor): la ronda pasa a la etapa siguiente; si era la ultima, queda aprobada por omision. */
  app.post('/api/proyectos/:pid/revisiones/:rid/omitir-paso', requiereSesion, requiereRol('gestor'), J, (req, res) => {
    const x = revisionDe(req, res); if (!x) return; const { p, u, r } = x; if (r.estado !== 'abierta') return res.status(409).json({ error: 'cerrada' });
    const fl = r.flujo_def && r.flujo_def.etapas ? r.flujo_def : I.flujoDe(p, r.flujo_id), fecha = ahora(), motivo = String((req.body || {}).comentario || '').slice(0, 2000);
    for (const ps of fl.etapas[r.paso].pasos) r.pasos.push({ etapa: r.paso, paso: ps.id, nombre: ps.nombre, decision: 'aprobada', estado: 'omitido', etiqueta: 'Paso omitido', por: u.email, fecha, comentario: motivo, omitido: true });
    const sig = r.paso + 1;
    if (sig < fl.etapas.length) { q.corre('UPDATE revisiones SET paso = ?, pasos = ?, vence = ? WHERE id = ?', sig, JSON.stringify(r.pasos), FL.venceEtapa(fl.etapas[sig], fecha), r.id); audita(u.email, 'revision.omitir', req.pid, '#' + r.numero, { etapa: r.paso }); return res.json({ ok: true, etapa: sig }); }
    const c = q.uno('SELECT * FROM contenedores WHERE id = ?', r.contenedor_id);
    q.corre("UPDATE revisiones SET estado = 'aprobada', revisor = ?, cerrada = ?, pasos = ?, paso = ?, idoneidad = ? WHERE id = ?", u.email, fecha, JSON.stringify(r.pasos), sig, fl.alAprobar.idoneidad || '', r.id);
    let t = null; if (fl.alAprobar.estado === 'PUBLICADO' && c.estado !== 'PUBLICADO') t = I.transita(p, u, c, 'PUBLICADO', { porFlujo: true, idoneidad: fl.alAprobar.idoneidad, copiarA: r.destino || fl.alAprobar.copiarA, comentario: 'Aprobado por omision del ultimo paso (#' + r.numero + ')', por: u.email });
    audita(u.email, 'revision.omitir', req.pid, '#' + r.numero, { final: true }); res.json({ ok: true, estado: 'aprobada', contenedor: t });
  });
  /** Volver al paso anterior (gestor o iniciador): se descartan las decisiones de la etapa actual y se reabre la anterior. */
  app.post('/api/proyectos/:pid/revisiones/:rid/volver-paso', requiereSesion, requiereRol('autor'), J, (req, res) => {
    const x = revisionDe(req, res); if (!x) return; const { p, u, r } = x; if (r.estado !== 'abierta') return res.status(409).json({ error: 'cerrada' });
    if (!(r.solicitada_por === u.email || gestor(u))) return res.status(403).json({ error: 'sin-permiso' });
    if (!(r.paso > 0)) return res.status(409).json({ error: 'primero', mensaje: 'Ya esta en el primer paso.' });
    const fl = r.flujo_def && r.flujo_def.etapas ? r.flujo_def : I.flujoDe(p, r.flujo_id), ant = r.paso - 1, fecha = ahora();
    const pasos = r.pasos.filter(d => d.etapa < ant).concat([{ etapa: r.paso, paso: '', nombre: 'Devuelto al paso anterior', decision: 'nota', estado: 'volver', etiqueta: 'Vuelve al paso ' + (ant + 1), por: u.email, fecha, comentario: String((req.body || {}).comentario || '').slice(0, 2000), nota: true }]);
    q.corre('UPDATE revisiones SET paso = ?, pasos = ?, vence = ? WHERE id = ?', ant, JSON.stringify(pasos), FL.venceEtapa(fl.etapas[ant], fecha), r.id);
    audita(u.email, 'revision.volver', req.pid, '#' + r.numero, { a: ant }); res.json({ ok: true, etapa: ant });
  });
  /** Desencadenadores: tabla para Configuracion (los define cada carpeta) y crear uno eligiendo carpeta + flujo. */
  app.get('/api/proyectos/:pid/desencadenadores', requiereSesion, requiereRol('lector'), (req, res) => {
    const p = proyecto(req.pid), flujos = I.flujosDe(p);
    const lista = (p.config.carpetas || []).filter(c => c.disparador && c.disparador.flujo).map((c, i) => { const f = flujos.find(x => x.id === c.disparador.flujo); const aud = q.uno("SELECT quien, fecha FROM auditoria WHERE proyecto_id = ? AND accion = 'carpeta.editar' AND objeto = ? ORDER BY id DESC LIMIT 1", req.pid, c.ruta); return { id: i + 1, nombre: 'Al cargar en ' + CAR.nombreDe(c.ruta), carpeta: c.ruta, flujo: f ? f.nombre : c.disparador.flujo, flujoId: c.disparador.flujo, correcto: !!(f && f.activo !== false), por: aud ? aud.quien : '', actualizado: aud ? aud.fecha : '' }; });
    res.json({ desencadenadores: lista });
  });

  return { sincroniza, copiaA };
}

module.exports = { monta };
