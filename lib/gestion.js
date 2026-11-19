/*
 * GESTION DOCUMENTAL "DE FORMA" (v0.5.3): lo que Autodesk Docs/Forma hace alrededor de cada archivo y que no es ni el
 * contenedor ni el flujo:
 *   - COMPARTIR: con miembros (un correo de la correspondencia con la version adjunta), con cualquier usuario mediante un
 *     vinculo con caducidad (sin sesion: /compartido/<token>) o con OTRO PROYECTO (copia la version como contenedor nuevo).
 *   - ELEMENTOS SUPRIMIDOS: la papelera. Suprimir un archivo lo marca (borrado) y deja de verse en todas partes; suprimir una
 *     carpeta guarda su definicion (y la de sus hijas) en config.suprimidas y marca sus archivos con el mismo lote, para
 *     restaurarlo todo junto. Vaciar la papelera (administrador) borra de verdad.
 *   - MARCAS DE REVISION: pines/notas sobre una VERSION (en un PDF con pagina y posicion; en cualquier otro archivo como nota de
 *     la version). Privadas del autor hasta que las publica ("Marca de revision"); editar, duplicar, borrar.
 *   - ATRIBUTOS PERSONALIZADOS: los define el proyecto (config.atributos) y cada archivo guarda sus valores (contenedores.atributos).
 * Se monta ANTES que cde.js porque crea tablas que cde.js consulta (marcas, compartidos).
 */
'use strict';
const crypto = require('crypto'), path = require('path');
const { q, ahora, id, json, audita, abreJson } = require('./bd');
const CAR = require('./carpetas');
const ISO = require('./iso19650');

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS compartidos (
  id TEXT PRIMARY KEY, proyecto_id TEXT NOT NULL, contenedor_id TEXT NOT NULL, version_id TEXT NOT NULL,
  modo TEXT NOT NULL,                      -- miembros | vinculo | proyecto
  para TEXT DEFAULT '[]', nota TEXT DEFAULT '', token TEXT DEFAULT '', correo_id TEXT DEFAULT '', proyecto_destino TEXT DEFAULT '', contenedor_destino TEXT DEFAULT '',
  por TEXT NOT NULL, creado TEXT NOT NULL, caduca TEXT DEFAULT '', revocado TEXT DEFAULT '', descargas INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS ix_comp_token ON compartidos (token);
CREATE TABLE IF NOT EXISTS marcas (
  id TEXT PRIMARY KEY, proyecto_id TEXT NOT NULL, contenedor_id TEXT NOT NULL, version_id TEXT NOT NULL,
  pagina INTEGER DEFAULT 0, x REAL DEFAULT 0, y REAL DEFAULT 0,      -- posicion relativa (0..1) en la pagina; 0/0/0 = nota sin posicion (archivos que no son PDF)
  tipo TEXT DEFAULT 'nota',                -- nota | revision (la de "Marca de revision": lo que ve el flujo)
  texto TEXT DEFAULT '', color TEXT DEFAULT '', publicada INTEGER DEFAULT 0,
  autor TEXT NOT NULL, creado TEXT NOT NULL, actualizado TEXT NOT NULL, borrada TEXT DEFAULT '');
CREATE INDEX IF NOT EXISTS ix_marcas_v ON marcas (version_id, borrada);
`;

const ATRIBUTO_TIPOS = ['texto', 'lista', 'numero', 'fecha'];
/** Normaliza config.atributos (Archivos → Configuracion → Atributos). */
function normalizaAtributos(lista) {
  const out = [];
  for (const a of (Array.isArray(lista) ? lista : []).slice(0, 60)) {
    if (!a || typeof a !== 'object') continue;
    const nombre = String(a.nombre || '').trim().slice(0, 60); if (!nombre) continue;
    let aid = String(a.id || nombre).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'atr';
    if (out.some(x => x.id === aid)) aid = aid + '-' + (out.length + 1);
    out.push({ id: aid, nombre, tipo: ATRIBUTO_TIPOS.includes(a.tipo) ? a.tipo : 'texto', descripcion: String(a.descripcion || '').slice(0, 300), valores: Array.isArray(a.valores) ? a.valores.map(v => String(v).trim().slice(0, 80)).filter(Boolean).slice(0, 200) : [], obligatorio: !!a.obligatorio });
  }
  return out;
}

function monta(app, ctx) {
  const { requiereSesion, requiereRol, almacen, express, db, esAdminGlobal } = ctx;
  db.exec(ESQUEMA);
  const J = express.json({ limit: '2mb' });
  const proyecto = (pid) => abreJson(q.uno('SELECT * FROM proyectos WHERE id = ?', pid), ['config']);
  function yo(req, p) {
    const m = q.uno('SELECT rol, organizacion FROM miembros WHERE proyecto_id = ? AND email = ?', p.id, String(req.quien || '').toLowerCase());
    const admin = !!req.admin || (esAdminGlobal && esAdminGlobal(req.quien));
    return { email: String(req.quien || '').toLowerCase(), rol: admin ? 'administrador' : (m ? m.rol : (req.rol || '')), organizacion: (m && m.organizacion) || (admin ? 'ANIN' : ''), admin };
  }
  const gestor = (u) => u.admin || ['gestor', 'administrador'].includes(u.rol);
  const permisoEn = (p, u, ruta) => CAR.permiso(p.config.carpetas, u, ruta);
  const guardaConfig = (p) => q.corre('UPDATE proyectos SET config = ? WHERE id = ?', JSON.stringify(p.config), p.id);
  const contDe = (pid, cid) => abreJson(q.uno('SELECT * FROM contenedores WHERE id = ? AND proyecto_id = ?', cid, pid), ['campos', 'atributos']);
  const puedeLeer = (p, u, c) => permisoEn(p, u, c.carpeta).leer || (c.carpeta_publicada && permisoEn(p, u, c.carpeta_publicada).leer);
  const puedeEditar = (p, u, c) => gestor(u) || permisoEn(p, u, c.carpeta).editar;

  // ======================= COMPARTIR =======================
  /** Miembros visibles para cualquier lector (para elegir destinatarios al compartir o revisores): correo, rol y organizacion. */
  app.get('/api/proyectos/:pid/miembros', requiereSesion, requiereRol('lector'), (req, res) => res.json({ miembros: q.todos('SELECT email, rol, organizacion, cargo, grupo, nombre, empresa, puesto, disciplina, funcion FROM miembros WHERE proyecto_id = ? ORDER BY organizacion, email', req.pid) }));
  app.post('/api/proyectos/:pid/contenedores/:cid/compartir', requiereSesion, requiereRol('lector'), J, (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p), b = req.body || {}, c = contDe(req.pid, req.params.cid);
    if (!c || c.borrado) return res.status(404).json({ error: 'no-existe' });
    if (!puedeLeer(p, u, c)) return res.status(403).json({ error: 'sin-permiso', mensaje: 'No tienes acceso a este archivo.' });
    const v = b.version_id ? q.uno('SELECT * FROM versiones WHERE id = ? AND contenedor_id = ?', String(b.version_id), c.id) : q.uno('SELECT * FROM versiones WHERE contenedor_id = ? ORDER BY n DESC LIMIT 1', c.id);
    if (!v) return res.status(409).json({ error: 'version', mensaje: 'El archivo no tiene versiones.' });
    const modo = String(b.modo || 'vinculo'), nota = String(b.nota || '').slice(0, 2000), fecha = ahora(), sid = id('sh');
    if (modo === 'miembros') {
      // un correo de la correspondencia (tipo Notificacion) con la version adjunta: queda registro de a quien se compartio
      const para = (Array.isArray(b.para) ? b.para : []).map(x => String(x || '').trim().toLowerCase()).filter(Boolean).slice(0, 100);
      if (!para.length) return res.status(400).json({ error: 'datos', mensaje: 'Elige al menos un miembro.' });
      const miembros = new Set(q.todos('SELECT email FROM miembros WHERE proyecto_id = ?', req.pid).map(m => m.email));
      const malos = para.filter(e => !miembros.has(e)); if (malos.length) return res.status(400).json({ error: 'datos', mensaje: 'No son miembros del proyecto: ' + malos.join(', ') });
      const mid = id('m'), dest = para.map(e => ({ email: e, org: (q.uno('SELECT organizacion FROM miembros WHERE proyecto_id = ? AND email = ?', req.pid, e) || {}).organizacion || '' }));
      const numero = 'COMP-' + String((q.uno("SELECT COUNT(*) AS n FROM correos WHERE proyecto_id = ? AND tipo = 'notificacion'", req.pid).n || 0) + 1).padStart(6, '0');
      q.corre('INSERT INTO correos (id, proyecto_id, numero, tipo, asunto, cuerpo, de_email, de_org, para, cc, respuesta, vence, estado, hilo_id, responde_a, adjuntos, campos, creado, enviado, actualizado) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        mid, req.pid, numero, 'notificacion', 'Se compartio contigo: ' + c.nombre + ' (V' + v.n + (v.revision ? ' ' + v.revision : '') + ')', nota || 'Archivo compartido desde el CDE.', u.email, u.organizacion, JSON.stringify(dest), '[]', 'ninguna', '', 'enviado', mid, '', JSON.stringify([{ tipo: 'version', id: v.id }]), '{}', fecha, fecha, fecha);
      q.corre('INSERT INTO compartidos (id, proyecto_id, contenedor_id, version_id, modo, para, nota, correo_id, por, creado) VALUES (?,?,?,?,?,?,?,?,?,?)', sid, req.pid, c.id, v.id, 'miembros', JSON.stringify(para), nota, mid, u.email, fecha);
      audita(u.email, 'contenedor.compartir', req.pid, c.nombre, { modo, para, version: v.n });
      return res.json({ ok: true, id: sid, correo: mid, para });
    }
    if (modo === 'vinculo') {
      const av = p.config.avanzada || {}, pm = permisoEn(p, u, c.carpeta);
      if (!(gestor(u) || pm.editar || (av.vinculosPublicosVer && pm.descargar))) return res.status(403).json({ error: 'sin-permiso', mensaje: av.vinculosPublicosVer ? 'Para compartir por vinculo hace falta permiso de descarga.' : 'Para compartir por vinculo hace falta permiso de edicion (Avanzada permite abrirlo a Ver + Descargar).' });
      const dias = Math.max(1, Math.min(365, parseInt(b.dias, 10) || av.diasVinculo || 30)), token = crypto.randomBytes(18).toString('base64url');
      const t = new Date(); t.setUTCDate(t.getUTCDate() + dias);
      q.corre('INSERT INTO compartidos (id, proyecto_id, contenedor_id, version_id, modo, nota, token, por, creado, caduca) VALUES (?,?,?,?,?,?,?,?,?,?)', sid, req.pid, c.id, v.id, 'vinculo', nota, token, u.email, fecha, t.toISOString());
      audita(u.email, 'contenedor.compartir', req.pid, c.nombre, { modo, version: v.n, dias });
      return res.json({ ok: true, id: sid, token, url: '/compartido/' + token, caduca: t.toISOString() });
    }
    if (modo === 'proyecto') {
      const pd = proyecto(String(b.proyecto_destino || '')); if (!pd || pd.id === p.id) return res.status(400).json({ error: 'datos', mensaje: 'Elige otro proyecto.' });
      const ud = yo(req, pd); if (!ud.rol && !ud.admin) return res.status(403).json({ error: 'sin-permiso', mensaje: 'No eres miembro del proyecto de destino.' });
      const carpeta = CAR.limpia(b.carpeta_destino || '');
      const conCarpetas = Array.isArray(pd.config.carpetas) && pd.config.carpetas.length > 0;
      if (conCarpetas && (!carpeta || !CAR.def(pd.config.carpetas, carpeta))) return res.status(400).json({ error: 'datos', mensaje: 'Elige la carpeta de destino en el otro proyecto.' });
      if (conCarpetas && !CAR.permiso(pd.config.carpetas, ud, carpeta).subir) return res.status(403).json({ error: 'sin-permiso', mensaje: 'No puedes cargar en esa carpeta del proyecto de destino.' });
      if (!almacen.existe(v.ruta_almacen)) return res.status(404).json({ error: 'archivo', mensaje: 'El archivo de la version no esta en el almacen.' });
      const val = ISO.valida(v.archivo, pd.config); if (!val.ok) return res.status(400).json({ error: 'nomenclatura', mensaje: 'El nombre no cumple la nomenclatura del proyecto de destino.', errores: val.errores });
      let cd = q.uno('SELECT * FROM contenedores WHERE proyecto_id = ? AND nombre = ?', pd.id, val.base);
      const zona = conCarpetas ? CAR.zonaDe(pd.config.carpetas, carpeta) : '', estadoIni = zona === 'compartido' ? 'COMPARTIDO' : zona === 'publicado' ? 'PUBLICADO' : 'WIP';
      if (cd && cd.borrado) return res.status(409).json({ error: 'suprimido', mensaje: 'En el proyecto de destino ese archivo esta suprimido.' });
      if (!cd) { cd = { id: id('c'), nombre: val.base }; q.corre('INSERT INTO contenedores (id, proyecto_id, nombre, tipo, carpeta, estado, campos, version_actual, creado, creado_por, actualizado, carpeta_compartida, atributos) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', cd.id, pd.id, val.base, c.tipo, carpeta, estadoIni, JSON.stringify(val.campos), 0, fecha, u.email, fecha, estadoIni === 'COMPARTIDO' ? carpeta : '', JSON.stringify(c.atributos || {})); cd.version_actual = 0; cd.estado = estadoIni; }
      else if (q.uno("SELECT 1 FROM revisiones WHERE contenedor_id = ? AND estado = 'abierta'", cd.id)) return res.status(409).json({ error: 'revision-abierta', mensaje: 'En el destino ese archivo tiene una revision abierta.' });
      const n = (cd.version_actual || 0) + 1, vid = id('v');
      almacen.guarda(pd.id, cd.id, vid, v.archivo, almacen.flujo(v.ruta_almacen)).then(g => {
        q.corre('INSERT INTO versiones (id, contenedor_id, n, archivo, extension, tamano, sha256, revision, idoneidad, estado_al_subir, origen, ruta_almacen, meta, subido_por, fecha) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          vid, cd.id, n, v.archivo, v.extension, g.tamano, g.sha256, v.revision, v.idoneidad, cd.estado, 'compartido-de:' + p.codigo, g.ruta, JSON.stringify(Object.assign({}, json(v.meta, {}), { compartidoDe: { proyecto: p.codigo, contenedor: c.id, version: v.id } })), u.email, fecha);
        q.corre('UPDATE contenedores SET version_actual = ?, actualizado = ? WHERE id = ?', n, fecha, cd.id);
        q.corre('INSERT INTO compartidos (id, proyecto_id, contenedor_id, version_id, modo, nota, proyecto_destino, contenedor_destino, por, creado) VALUES (?,?,?,?,?,?,?,?,?,?)', sid, req.pid, c.id, v.id, 'proyecto', nota, pd.id, cd.id, u.email, fecha);
        audita(u.email, 'contenedor.compartir', req.pid, c.nombre, { modo, version: v.n, a: pd.codigo, carpeta });
        res.json({ ok: true, id: sid, proyecto: pd.id, contenedor: cd.id, version: vid, n });
      }).catch(e => res.status(500).json({ error: 'almacen', mensaje: e.message }));
      return;
    }
    res.status(400).json({ error: 'modo', mensaje: 'Modo no valido (miembros | vinculo | proyecto).' });
  });
  app.get('/api/proyectos/:pid/contenedores/:cid/compartidos', requiereSesion, requiereRol('lector'), (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p), c = contDe(req.pid, req.params.cid); if (!c) return res.status(404).json({ error: 'no-existe' });
    if (!puedeLeer(p, u, c)) return res.status(403).json({ error: 'sin-permiso' });
    res.json({ compartidos: q.todos("SELECT * FROM compartidos WHERE contenedor_id = ? AND revocado = '' ORDER BY creado DESC", c.id).map(x => abreJson(x, ['para'])) });
  });
  app.delete('/api/proyectos/:pid/compartidos/:sid', requiereSesion, requiereRol('lector'), (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p), s = q.uno('SELECT * FROM compartidos WHERE id = ? AND proyecto_id = ?', req.params.sid, req.pid); if (!s) return res.status(404).json({ error: 'no-existe' });
    if (!(s.por === u.email || gestor(u))) return res.status(403).json({ error: 'sin-permiso' });
    q.corre('UPDATE compartidos SET revocado = ? WHERE id = ?', ahora(), s.id); audita(u.email, 'compartido.revocar', req.pid, s.contenedor_id, { modo: s.modo }); res.json({ ok: true });
  });
  /** Vinculo para "cualquier usuario": sin sesion, hasta que caduque o se revoque. ?ver=1 lo abre en el navegador (PDF) en vez de descargar. */
  app.get('/compartido/:token', (req, res) => {
    const s = q.uno("SELECT * FROM compartidos WHERE token = ? AND modo = 'vinculo'", String(req.params.token || '').slice(0, 80));
    if (!s || s.revocado) return res.status(404).send('<p style="font-family:sans-serif">Este vinculo no existe o fue revocado.</p>');
    if (s.caduca && s.caduca < ahora()) return res.status(410).send('<p style="font-family:sans-serif">Este vinculo caduco.</p>');
    const v = q.uno('SELECT * FROM versiones WHERE id = ?', s.version_id); if (!v || !almacen.existe(v.ruta_almacen)) return res.status(404).send('<p style="font-family:sans-serif">El archivo ya no esta disponible.</p>');
    q.corre('UPDATE compartidos SET descargas = descargas + 1 WHERE id = ?', s.id);
    audita('vinculo:' + s.token.slice(0, 6), 'compartido.descargar', s.proyecto_id, s.contenedor_id, { version: v.n });
    res.setHeader('Content-Disposition', (req.query.ver ? 'inline' : 'attachment') + '; filename*=UTF-8\'\'' + encodeURIComponent(v.archivo)); res.setHeader('Content-Length', v.tamano);
    if (/\.pdf$/i.test(v.archivo)) res.setHeader('Content-Type', 'application/pdf');
    almacen.flujo(v.ruta_almacen).pipe(res);
  });
  /** Para "compartir con otro proyecto": los proyectos donde soy miembro y sus carpetas donde puedo cargar. */
  app.get('/api/proyectos/:pid/compartir/destinos', requiereSesion, requiereRol('lector'), (req, res) => {
    const lista = q.todos('SELECT p.id, p.codigo, p.nombre, p.config FROM proyectos p JOIN miembros m ON m.proyecto_id = p.id WHERE m.email = ? AND p.activo = 1 AND p.id <> ? ORDER BY p.codigo', String(req.quien || '').toLowerCase(), req.pid).map(x => abreJson(x, ['config']));
    const out = lista.map(p => { const u = yo(req, p); return { id: p.id, codigo: p.codigo, nombre: p.nombre, carpetas: CAR.arbol(p.config.carpetas, u, {}).filter(c => c.subir && !c.paso).map(c => c.ruta) }; });
    res.json({ proyectos: out });
  });

  // ======================= ELEMENTOS SUPRIMIDOS =======================
  app.delete('/api/proyectos/:pid/contenedores/:cid', requiereSesion, requiereRol('autor'), (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p), c = contDe(req.pid, req.params.cid); if (!c || c.borrado) return res.status(404).json({ error: 'no-existe' });
    if (!puedeEditar(p, u, c)) return res.status(403).json({ error: 'sin-permiso', mensaje: 'Hace falta permiso de edicion sobre la carpeta del archivo.' });
    if (q.uno("SELECT 1 FROM revisiones WHERE contenedor_id = ? AND estado = 'abierta'", c.id)) return res.status(409).json({ error: 'revision-abierta', mensaje: 'Tiene una revision abierta: anulala o espera la decision antes de suprimir.' });
    q.corre("UPDATE contenedores SET borrado = ?, borrado_por = ?, borrado_lote = '' WHERE id = ?", ahora(), u.email, c.id);
    audita(u.email, 'contenedor.suprimir', req.pid, c.nombre, { carpeta: c.carpeta }); res.json({ ok: true });
  });
  /** Suprimir una VERSION INCOMPLETA de un modelo (v0.9.14): una publicacion cancelada desde un complemento deja la version con
   *  su archivo pero sin indice (y un federado pesa cientos de MB por version). Solo el gestor; nunca la ultima version; solo
   *  modelos (RVT, IFC, NWD, NWC, NWF) cuyo indice no quedo listo, y que ninguna revision, transicion, incidencia o marca cite.
   *  Se borra del almacen con su indice a medias y queda en la auditoria. Las versiones completas no se tocan (historial ISO 19650). */
  app.delete('/api/proyectos/:pid/versiones/:vid', requiereSesion, requiereRol('gestor'), (req, res) => {
    const v = q.uno('SELECT v.*, c.proyecto_id, c.version_actual, c.nombre AS cnombre, c.borrado FROM versiones v JOIN contenedores c ON c.id = v.contenedor_id WHERE v.id = ?', req.params.vid);
    if (!v || v.proyecto_id !== req.pid || v.borrado) return res.status(404).json({ error: 'no-existe', mensaje: 'La version no existe.' });
    if (v.n === v.version_actual) return res.status(409).json({ error: 'ultima', mensaje: 'Es la ultima version del archivo: no se suprime.' });
    if (!/\.(rvt|ifc|nwd|nwc|nwf)$/i.test(v.archivo || '')) return res.status(409).json({ error: 'no-modelo', mensaje: 'Solo se suprimen versiones de modelos que quedaron sin indice.' });
    const ix = q.uno('SELECT * FROM indices_modelo WHERE version_id = ?', v.id);
    if (ix && (ix.estado === 'listo' || ix.estado === 'recibiendo' || ix.estado === 'armando')) return res.status(409).json({ error: 'completa', mensaje: ix.estado === 'listo' ? 'La version tiene su indice listo: es una version completa y se conserva.' : 'La version se esta procesando.' });
    const citas = q.uno('SELECT (SELECT COUNT(*) FROM revisiones WHERE version_id = ?) + (SELECT COUNT(*) FROM transiciones WHERE version_id = ?) + (SELECT COUNT(*) FROM incidencias WHERE version_id = ?) + (SELECT COUNT(*) FROM marcas WHERE version_id = ? AND borrada = \'\') AS n', v.id, v.id, v.id, v.id).n;
    if (citas) return res.status(409).json({ error: 'citada', mensaje: 'Una revision, transicion, incidencia o marca cita esta version: se conserva.' });
    const fs = require('fs'), dirIx = path.join(ctx.datosDir || '', 'indices');
    if (ix) { for (const r of [ix.ruta_sqlite, ix.ruta_geometria, ix.ruta_geometria ? ix.ruta_geometria + '.gz' : '']) if (r) try { fs.rmSync(r, { force: true }); } catch (e) {} }
    try { fs.rmSync(path.join(dirIx, v.id + '.trozos'), { recursive: true, force: true }); fs.rmSync(path.join(dirIx, v.id + '.cdeg'), { force: true }); fs.rmSync(path.join(dirIx, v.id + '.sqlite.nuevo'), { force: true }); } catch (e) {}
    almacen.borraCarpeta(req.pid, v.contenedor_id, v.id);
    q.corre('DELETE FROM indices_modelo WHERE version_id = ?', v.id); q.corre('DELETE FROM versiones WHERE id = ?', v.id);
    audita(req.quien, 'version.suprimir', req.pid, v.cnombre, { version: v.n, revision: v.revision, archivo: v.archivo, tamano: v.tamano, motivo: 'sin indice' });
    res.json({ ok: true, liberado: v.tamano || 0 });
  });
  /** Suprimir una carpeta con todo su contenido (como Docs): la definicion se guarda para poder restaurarla con sus archivos. */
  app.post('/api/proyectos/:pid/carpetas/suprimir', requiereSesion, requiereRol('autor'), J, (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p), ruta = CAR.limpia((req.body || {}).ruta);
    // una carpeta que ya no esta en la estructura pero aun tiene archivos (o copias publicadas) tambien se puede suprimir
    const dentro = "(carpeta = ? OR carpeta LIKE ? OR carpeta_publicada = ? OR carpeta_publicada LIKE ?)", aDentro = [ruta, ruta + '/%', ruta, ruta + '/%'];
    if (!ruta || (!CAR.def(p.config.carpetas, ruta) && !q.uno("SELECT 1 FROM contenedores WHERE proyecto_id = ? AND borrado = '' AND " + dentro, req.pid, ...aDentro))) return res.status(404).json({ error: 'no-existe', mensaje: 'La carpeta ya no existe.' });
    if (!(gestor(u) || permisoEn(p, u, ruta).editar)) return res.status(403).json({ error: 'sin-permiso', mensaje: 'Hace falta permiso de edicion sobre la carpeta.' });
    if (q.uno("SELECT 1 FROM revisiones r JOIN contenedores c ON c.id = r.contenedor_id WHERE c.proyecto_id = ? AND r.estado = 'abierta' AND c.borrado = '' AND (c.carpeta = ? OR c.carpeta LIKE ?)", req.pid, ruta, ruta + '/%')) return res.status(409).json({ error: 'revision-abierta', mensaje: 'Dentro hay archivos con revision abierta.' });
    const lote = id('lt'), fecha = ahora();
    const defs = CAR.normaliza(p.config.carpetas).filter(c => c.ruta === ruta || c.ruta.startsWith(ruta + '/'));
    const n = q.corre("UPDATE contenedores SET borrado = ?, borrado_por = ?, borrado_lote = ? WHERE proyecto_id = ? AND borrado = '' AND (carpeta = ? OR carpeta LIKE ?)", fecha, u.email, lote, req.pid, ruta, ruta + '/%').changes;
    // copias publicadas que vivian en esta carpeta (el archivo esta en otra): se retira la copia y se guarda para restaurarla
    const copias = q.todos("SELECT id, carpeta_publicada AS ruta FROM contenedores WHERE proyecto_id = ? AND borrado = '' AND (carpeta_publicada = ? OR carpeta_publicada LIKE ?)", req.pid, ruta, ruta + '/%');
    for (const x of copias) q.corre("UPDATE contenedores SET carpeta_publicada = '' WHERE id = ?", x.id);
    if (defs.length) p.config.carpetas = CAR.borra(p.config.carpetas, ruta).carpetas;
    p.config.suprimidas = (Array.isArray(p.config.suprimidas) ? p.config.suprimidas : []).concat([{ lote, ruta, carpetas: defs, archivos: n, copias, por: u.email, fecha }]).slice(-200);
    guardaConfig(p); audita(u.email, 'carpeta.suprimir', req.pid, ruta, { lote, carpetas: defs.length, archivos: n });
    res.json({ ok: true, lote, carpetas: defs.length, archivos: n });
  });
  app.get('/api/proyectos/:pid/suprimidos', requiereSesion, requiereRol('lector'), (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p);
    const conts = q.todos("SELECT id, nombre, tipo, carpeta, estado, borrado, borrado_por, borrado_lote, version_actual FROM contenedores WHERE proyecto_id = ? AND borrado <> '' ORDER BY borrado DESC", req.pid).filter(c => gestor(u) || CAR.permiso(p.config.carpetas, u, c.carpeta).leer || !CAR.def(p.config.carpetas, c.carpeta));
    for (const c of conts) { const v = q.uno('SELECT n, revision, tamano, subido_por FROM versiones WHERE contenedor_id = ? ORDER BY n DESC LIMIT 1', c.id); c.ultima = v; }
    const carpetas = (p.config.suprimidas || []).map(s => ({ lote: s.lote, ruta: s.ruta, carpetas: s.carpetas.length, archivos: s.archivos, por: s.por, fecha: s.fecha })).reverse();
    res.json({ contenedores: conts, carpetas, puedoVaciar: gestor(u) });
  });
  app.post('/api/proyectos/:pid/suprimidos/restaurar', requiereSesion, requiereRol('autor'), J, (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p), b = req.body || {}, hechos = { contenedores: 0, carpetas: 0 }, errores = [];
    for (const lote of (Array.isArray(b.lotes) ? b.lotes : [])) {
      const i = (p.config.suprimidas || []).findIndex(s => s.lote === lote); if (i < 0) { errores.push('Lote ' + lote + ' no existe.'); continue; }
      const s = p.config.suprimidas[i];
      if (!(gestor(u) || (s.por === u.email))) { errores.push(s.ruta + ': solo quien la suprimio o el gestor.'); continue; }
      const lista = CAR.normaliza(p.config.carpetas), padre = CAR.padreDe(s.ruta);
      if (padre && !CAR.def(lista, padre)) { errores.push(s.ruta + ': la carpeta padre ya no existe; restaura primero esa.'); continue; }
      for (const d of s.carpetas) if (!lista.some(x => x.ruta === d.ruta)) lista.push(d);
      for (const x of (s.copias || [])) q.corre("UPDATE contenedores SET carpeta_publicada = ? WHERE id = ? AND proyecto_id = ? AND carpeta_publicada = ''", x.ruta, x.id, req.pid);
      p.config.carpetas = CAR.normaliza(lista); p.config.suprimidas.splice(i, 1);
      hechos.contenedores += q.corre("UPDATE contenedores SET borrado = '', borrado_por = '', borrado_lote = '' WHERE proyecto_id = ? AND borrado_lote = ?", req.pid, lote).changes; hechos.carpetas += s.carpetas.length;
      audita(u.email, 'carpeta.restaurar', req.pid, s.ruta, { lote });
    }
    for (const cid of (Array.isArray(b.contenedores) ? b.contenedores : [])) {
      const c = contDe(req.pid, String(cid)); if (!c || !c.borrado) continue;
      if (!(gestor(u) || c.borrado_por === u.email || permisoEn(p, u, c.carpeta).editar)) { errores.push(c.nombre + ': sin permiso.'); continue; }
      q.corre("UPDATE contenedores SET borrado = '', borrado_por = '', borrado_lote = '' WHERE id = ?", c.id); hechos.contenedores++; audita(u.email, 'contenedor.restaurar', req.pid, c.nombre, {});
    }
    guardaConfig(p);
    res.json({ ok: !errores.length, hechos, errores });
  });
  /** Vaciar la papelera (gestor): borra de verdad archivos, versiones, marcas y las definiciones de carpetas suprimidas. */
  app.post('/api/proyectos/:pid/suprimidos/vaciar', requiereSesion, requiereRol('gestor'), J, (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p), b = req.body || {};
    const conts = q.todos("SELECT id, nombre FROM contenedores WHERE proyecto_id = ? AND borrado <> ''" + (Array.isArray(b.contenedores) && b.contenedores.length ? ' AND id IN (' + b.contenedores.map(() => '?').join(',') + ')' : ''), req.pid, ...(Array.isArray(b.contenedores) ? b.contenedores.map(String) : []));
    for (const c of conts) {
      for (const v of q.todos('SELECT id FROM versiones WHERE contenedor_id = ?', c.id)) { almacen.borraCarpeta(req.pid, c.id, v.id); q.corre('DELETE FROM indices_modelo WHERE version_id = ?', v.id); }
      for (const t of ['versiones', 'transiciones', 'revisiones', 'marcas', 'compartidos']) q.corre('DELETE FROM ' + t + ' WHERE contenedor_id = ?', c.id);
      q.corre('DELETE FROM contenedores WHERE id = ?', c.id);
    }
    if (!(Array.isArray(b.contenedores) && b.contenedores.length)) p.config.suprimidas = [];
    guardaConfig(p); audita(u.email, 'suprimidos.vaciar', req.pid, '', { archivos: conts.length });
    res.json({ ok: true, borrados: conts.length });
  });

  // ======================= MARCAS DE REVISION =======================
  const marcaVisible = (m, u) => m.publicada || m.autor === u.email;
  function versionDe(req, res) {
    const p = proyecto(req.pid), u = yo(req, p);
    const v = q.uno('SELECT v.*, c.carpeta, c.carpeta_publicada, c.borrado FROM versiones v JOIN contenedores c ON c.id = v.contenedor_id WHERE v.id = ? AND c.proyecto_id = ?', req.params.vid, req.pid);
    if (!v || v.borrado) { res.status(404).json({ error: 'no-existe' }); return null; }
    if (!puedeLeer(p, u, v)) { res.status(403).json({ error: 'sin-permiso' }); return null; }
    return { p, u, v };
  }
  app.get('/api/proyectos/:pid/versiones/:vid/marcas', requiereSesion, requiereRol('lector'), (req, res) => {
    const x = versionDe(req, res); if (!x) return;
    const lista = q.todos("SELECT * FROM marcas WHERE version_id = ? AND borrada = '' ORDER BY pagina, creado", x.v.id).filter(m => marcaVisible(m, x.u));
    res.json({ marcas: lista, esPdf: /\.pdf$/i.test(x.v.archivo), archivo: x.v.archivo, n: x.v.n, puedoCrear: x.u.admin || (ISO.RANGO_ROL[x.u.rol] || 0) >= 1 });
  });
  app.post('/api/proyectos/:pid/versiones/:vid/marcas', requiereSesion, requiereRol('autor'), J, (req, res) => {
    const x = versionDe(req, res); if (!x) return; const b = req.body || {}, fecha = ahora(), mid = id('mk');
    const texto = String(b.texto || '').slice(0, 4000);
    q.corre('INSERT INTO marcas (id, proyecto_id, contenedor_id, version_id, pagina, x, y, tipo, texto, color, publicada, autor, creado, actualizado) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      mid, req.pid, x.v.contenedor_id, x.v.id, Math.max(0, parseInt(b.pagina, 10) || 0), Math.min(1, Math.max(0, +b.x || 0)), Math.min(1, Math.max(0, +b.y || 0)), b.tipo === 'revision' ? 'revision' : 'nota', texto, String(b.color || '').slice(0, 12), b.publicada ? 1 : 0, x.u.email, fecha, fecha);
    audita(x.u.email, 'marca.crear', req.pid, x.v.contenedor_id, { version: x.v.n, pagina: b.pagina });
    res.json({ ok: true, marca: q.uno('SELECT * FROM marcas WHERE id = ?', mid) });
  });
  app.put('/api/proyectos/:pid/marcas/:mid', requiereSesion, requiereRol('autor'), J, (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p), m = q.uno("SELECT * FROM marcas WHERE id = ? AND proyecto_id = ? AND borrada = ''", req.params.mid, req.pid); if (!m) return res.status(404).json({ error: 'no-existe' });
    if (!(m.autor === u.email || gestor(u))) return res.status(403).json({ error: 'sin-permiso', mensaje: 'Solo quien la hizo (o el gestor) edita una marca.' });
    const b = req.body || {}, sets = [], vals = [];
    if (b.texto !== undefined) { sets.push('texto = ?'); vals.push(String(b.texto).slice(0, 4000)); }
    if (b.x !== undefined) { sets.push('x = ?'); vals.push(Math.min(1, Math.max(0, +b.x || 0))); }
    if (b.y !== undefined) { sets.push('y = ?'); vals.push(Math.min(1, Math.max(0, +b.y || 0))); }
    if (b.pagina !== undefined) { sets.push('pagina = ?'); vals.push(Math.max(0, parseInt(b.pagina, 10) || 0)); }
    if (b.color !== undefined) { sets.push('color = ?'); vals.push(String(b.color).slice(0, 12)); }
    if (b.tipo !== undefined) { sets.push('tipo = ?'); vals.push(b.tipo === 'revision' ? 'revision' : 'nota'); }
    if (b.publicada !== undefined) { sets.push('publicada = ?'); vals.push(b.publicada ? 1 : 0); }
    if (!sets.length) return res.json({ ok: true, marca: m });
    sets.push('actualizado = ?'); vals.push(ahora()); vals.push(m.id);
    q.corre('UPDATE marcas SET ' + sets.join(', ') + ' WHERE id = ?', ...vals);
    audita(u.email, 'marca.editar', req.pid, m.contenedor_id, { campos: Object.keys(b) });
    res.json({ ok: true, marca: q.uno('SELECT * FROM marcas WHERE id = ?', m.id) });
  });
  app.post('/api/proyectos/:pid/marcas/:mid/duplicar', requiereSesion, requiereRol('autor'), J, (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p), m = q.uno("SELECT * FROM marcas WHERE id = ? AND proyecto_id = ? AND borrada = ''", req.params.mid, req.pid); if (!m || !marcaVisible(m, u)) return res.status(404).json({ error: 'no-existe' });
    const fecha = ahora(), mid = id('mk'), b = req.body || {};
    q.corre('INSERT INTO marcas (id, proyecto_id, contenedor_id, version_id, pagina, x, y, tipo, texto, color, publicada, autor, creado, actualizado) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      mid, req.pid, m.contenedor_id, m.version_id, b.pagina !== undefined ? Math.max(0, parseInt(b.pagina, 10) || 0) : m.pagina, Math.min(1, m.x + 0.03), Math.min(1, m.y + 0.03), m.tipo, m.texto, m.color, 0, u.email, fecha, fecha);
    res.json({ ok: true, marca: q.uno('SELECT * FROM marcas WHERE id = ?', mid) });
  });
  app.delete('/api/proyectos/:pid/marcas/:mid', requiereSesion, requiereRol('autor'), (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p), m = q.uno("SELECT * FROM marcas WHERE id = ? AND proyecto_id = ? AND borrada = ''", req.params.mid, req.pid); if (!m) return res.status(404).json({ error: 'no-existe' });
    if (!(m.autor === u.email || gestor(u))) return res.status(403).json({ error: 'sin-permiso' });
    q.corre('UPDATE marcas SET borrada = ? WHERE id = ?', ahora(), m.id); audita(u.email, 'marca.borrar', req.pid, m.contenedor_id, {}); res.json({ ok: true });
  });

  // ======================= ATRIBUTOS PERSONALIZADOS =======================
  app.put('/api/proyectos/:pid/contenedores/:cid/atributos', requiereSesion, requiereRol('autor'), J, (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p), c = contDe(req.pid, req.params.cid); if (!c || c.borrado) return res.status(404).json({ error: 'no-existe' });
    if (!(permisoEn(p, u, c.carpeta).subir || puedeEditar(p, u, c))) return res.status(403).json({ error: 'sin-permiso', mensaje: 'Hace falta permiso de carga o edicion sobre la carpeta.' });
    const defs = normalizaAtributos(p.config.atributos), b = (req.body || {}).atributos || {}, out = Object.assign({}, c.atributos || {});
    for (const d of defs) { if (b[d.id] === undefined) continue; const v = String(b[d.id] == null ? '' : b[d.id]).trim().slice(0, 500); if (d.tipo === 'lista' && v && d.valores.length && !d.valores.includes(v)) return res.status(400).json({ error: 'datos', mensaje: d.nombre + ': "' + v + '" no esta entre los valores admitidos.' }); if (d.tipo === 'numero' && v && isNaN(+v)) return res.status(400).json({ error: 'datos', mensaje: d.nombre + ' debe ser un numero.' }); if (d.obligatorio && !v) return res.status(400).json({ error: 'datos', mensaje: d.nombre + ' es obligatorio.' }); out[d.id] = v; }
    if (b.descripcion !== undefined) out.descripcion = String(b.descripcion || '').slice(0, 500);
    // atributos relacionados con la norma (rejilla de conformidad): parte designada y contrato
    for (const k of ['parteDesignada', 'contrato']) if (b[k] !== undefined) out[k] = String(b[k] == null ? '' : b[k]).trim().slice(0, 80);
    // revision y codigo de estado de la ULTIMA version (lo que la rejilla pide al desplazar de WIP a compartido/publicado)
    const rb = req.body || {};
    if (rb.revision !== undefined || rb.idoneidad !== undefined) {
      const v = q.uno('SELECT id, n, revision, extension FROM versiones WHERE contenedor_id = ? ORDER BY n DESC LIMIT 1', c.id);
      if (v) {
        if (rb.revision !== undefined && String(rb.revision).toUpperCase() !== v.revision) {
          const rev = String(rb.revision || '').toUpperCase().slice(0, 8);
          if (!ISO.RX_REVISION.test(rev)) return res.status(400).json({ error: 'revision', mensaje: 'La revision "' + rev + '" no es valida (P01, R00, C01, M01...).' });
          if (q.uno("SELECT 1 FROM revisiones WHERE contenedor_id = ? AND estado = 'abierta'", c.id)) return res.status(409).json({ error: 'revision-abierta', mensaje: 'Tiene una revision abierta: no se cambia el codigo de revision.' });
          if (q.uno('SELECT 1 FROM versiones WHERE contenedor_id = ? AND revision = ? AND id <> ?', c.id, rev, v.id)) return res.status(409).json({ error: 'revision', mensaje: 'Otra version de este archivo ya lleva la revision ' + rev + '.' });
          q.corre('UPDATE versiones SET revision = ?, archivo = ? WHERE id = ?', rev, c.nombre + '-' + rev + '.' + v.extension, v.id);
        }
        if (rb.idoneidad !== undefined && String(rb.idoneidad).trim()) q.corre('UPDATE versiones SET idoneidad = ? WHERE id = ?', String(rb.idoneidad).toUpperCase().slice(0, 4), v.id);
      }
    }
    q.corre('UPDATE contenedores SET atributos = ?, actualizado = ? WHERE id = ?', JSON.stringify(out), ahora(), c.id);
    audita(u.email, 'contenedor.atributos', req.pid, c.nombre, { claves: Object.keys(b) }); res.json({ ok: true, atributos: out });
  });
  /** Configuracion de Archivos (gestor): atributos, nomenclatura (conformidad), etiqueta de revision, paquetes, avanzada. Guarda solo las claves que lleguen. */
  app.put('/api/proyectos/:pid/archivos/configuracion', requiereSesion, requiereRol('gestor'), J, (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p), b = req.body || {}, cambios = [];
    if (b.atributos !== undefined) { p.config.atributos = normalizaAtributos(b.atributos); cambios.push('atributos'); }
    if (b.nomenclatura !== undefined) {
      const n = b.nomenclatura && typeof b.nomenclatura === 'object' ? b.nomenclatura : {};
      const campos = (Array.isArray(n.campos) ? n.campos : []).slice(0, 20).map(c => ({ nombre: String(c.nombre || '').trim().slice(0, 40), descripcion: String(c.descripcion || '').slice(0, 200), tipo: c.tipo === 'lista' ? 'lista' : 'texto', valores: Array.isArray(c.valores) ? c.valores.map(v => String(v).trim()).filter(Boolean).slice(0, 500) : [], regex: String(c.regex || '').slice(0, 200), longitud: Math.max(0, Math.min(40, parseInt(c.longitud, 10) || 0)), caracteres: ['alfanumerico', 'letras', 'numeros', 'cualquiera'].includes(c.caracteres) ? c.caracteres : 'alfanumerico', obligatorio: c.obligatorio !== false })).filter(c => c.nombre);
      if (campos.length && campos.length < 2) return res.status(400).json({ error: 'datos', mensaje: 'La norma de nomenclatura necesita al menos 2 campos (o ninguno para usar la regla por defecto).' });
      // v0.6: la norma "por defecto" vive en config.normas; esta ruta la crea/edita (compatibilidad con la pestana antigua)
      const NOM = require('./nomenclatura'); NOM.migra(p.config);
      if (campos.length) { const idn = p.config.normaPorDefecto || 'default-iso19650', i = (p.config.normas || []).findIndex(x => x.id === idn); const nn = NOM.normalizaNorma({ id: idn, nombre: i >= 0 ? p.config.normas[i].nombre : 'Default ISO 19650', descripcion: i >= 0 ? p.config.normas[i].descripcion : '', campos, conRevision: n.conRevision !== false, atributos: i >= 0 ? p.config.normas[i].atributos : {} }, [], u.email); if (nn.error) return res.status(400).json({ error: 'datos', mensaje: nn.error }); if (i >= 0) p.config.normas[i] = nn.norma; else p.config.normas.push(nn.norma); p.config.normaPorDefecto = nn.norma.id; }
      else { p.config.normas = (p.config.normas || []).filter(x => x.id !== p.config.normaPorDefecto); p.config.normaPorDefecto = (p.config.normas[0] || {}).id || ''; }
      NOM.sincronizaLegado(p.config); cambios.push('nomenclatura');
    }
    if (b.etiquetaRevision !== undefined) { p.config.etiquetaRevision = { formato: String((b.etiquetaRevision || {}).formato || 'P##').slice(0, 20), descripcion: String((b.etiquetaRevision || {}).descripcion || '').slice(0, 300) }; cambios.push('etiquetaRevision'); }
    if (b.paquetes !== undefined) { p.config.paquetes = { administradores: (Array.isArray((b.paquetes || {}).administradores) ? b.paquetes.administradores : []).map(e => String(e).trim().toLowerCase()).filter(Boolean).slice(0, 50) }; cambios.push('paquetes'); }
    if (b.avanzada !== undefined) { const a = b.avanzada || {}; p.config.avanzada = { versionesMaximas: Math.max(0, Math.min(999, parseInt(a.versionesMaximas, 10) || 0)), bloquearSubidaConRevision: a.bloquearSubidaConRevision !== false, exigirDescripcion: !!a.exigirDescripcion, diasVinculo: Math.max(1, Math.min(365, parseInt(a.diasVinculo, 10) || 30)), vinculosPublicosVer: !!a.vinculosPublicosVer, mostrarRuta: a.mostrarRuta !== false, cargarEditaAtributos: a.cargarEditaAtributos !== false, marcasPorDefecto: a.marcasPorDefecto !== false, marcasSoloActual: a.marcasSoloActual !== false, marcasEstadosBloqueo: (Array.isArray(a.marcasEstadosBloqueo) ? a.marcasEstadosBloqueo : []).map(String).slice(0, 12) }; cambios.push('avanzada'); }
    if (b.plantillasRotulo !== undefined) { p.config.plantillasRotulo = (Array.isArray(b.plantillasRotulo) ? b.plantillasRotulo : []).slice(0, 40).map(t => ({ id: String(t.id || 'pl' + Date.now().toString(36)).slice(0, 30), nombre: String(t.nombre || '').slice(0, 120), descripcion: String(t.descripcion || '').slice(0, 300), papel: String(t.papel || '').slice(0, 10), ejemplo: String(t.ejemplo || '').slice(0, 300), actualizado: String(t.actualizado || new Date().toISOString()).slice(0, 30), campos: (Array.isArray(t.campos) ? t.campos : []).slice(0, 30).map(c => ({ atributo: String(c.atributo || '').slice(0, 60), x: Math.min(1, Math.max(0, +c.x || 0)), y: Math.min(1, Math.max(0, +c.y || 0)), w: Math.min(1, Math.max(0, +c.w || 0)), h: Math.min(1, Math.max(0, +c.h || 0)) })) })).filter(t => t.nombre); cambios.push('plantillasRotulo'); }
    guardaConfig(p); audita(u.email, 'archivos.configuracion', req.pid, '', { cambios }); res.json({ ok: true, cambios, config: { atributos: p.config.atributos, nomenclatura: p.config.nomenclatura, etiquetaRevision: p.config.etiquetaRevision, paquetes: p.config.paquetes, avanzada: p.config.avanzada, plantillasRotulo: p.config.plantillasRotulo } });
  });
  /** Probar un nombre contra la norma (para el editor de Conformidad). */
  app.post('/api/proyectos/:pid/archivos/prueba-nombre', requiereSesion, requiereRol('lector'), J, (req, res) => {
    const p = proyecto(req.pid), b = req.body || {}; const cfg = b.nomenclatura ? { nomenclatura: b.nomenclatura } : p.config;
    res.json(ISO.valida(String(b.nombre || ''), cfg));
  });
}

module.exports = { monta, normalizaAtributos, ATRIBUTO_TIPOS };
