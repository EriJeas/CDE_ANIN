/*
 * BASE DE DATOS DEL CDE (metadatos): proyectos, contenedores de informacion (ISO 19650), versiones, transiciones de estado,
 * revisiones por rondas, incidencias, llaves de complementos y auditoria. SQLite con node:sqlite (lo mismo que ya usa el
 * visor para sus indices): un archivo, sin servidor aparte, respaldable copiando el archivo. Los ARCHIVOS (RVT, PDF, DWG...)
 * no van aqui: van al almacen (lib/almacen.js); aqui solo su ficha.
 *
 * Si la entidad luego quiere PostgreSQL, todo el SQL esta en este archivo: es el unico que cambia.
 */
'use strict';
const path = require('path'), fs = require('fs'), crypto = require('crypto');

let DB = null;

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS proyectos (
  id TEXT PRIMARY KEY, codigo TEXT UNIQUE, nombre TEXT NOT NULL, descripcion TEXT DEFAULT '',
  hub_forma TEXT DEFAULT '', proyecto_forma TEXT DEFAULT '',
  config TEXT DEFAULT '{}',            -- JSON: reglas de nomenclatura, codigos de estado/idoneidad habilitados, carpetas
  creado TEXT NOT NULL, creado_por TEXT NOT NULL, activo INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS miembros (
  proyecto_id TEXT NOT NULL, email TEXT NOT NULL, rol TEXT NOT NULL,   -- administrador | gestor | revisor | autor | lector
  organizacion TEXT DEFAULT '', agregado TEXT NOT NULL, por TEXT NOT NULL,
  PRIMARY KEY (proyecto_id, email));
CREATE TABLE IF NOT EXISTS contenedores (
  id TEXT PRIMARY KEY, proyecto_id TEXT NOT NULL, nombre TEXT NOT NULL,         -- nombre base sin revision ni extension
  tipo TEXT NOT NULL,                       -- modelo | plano | documento | otro
  carpeta TEXT DEFAULT '',                  -- ruta logica dentro del proyecto (p.ej. "01 Arquitectura")
  estado TEXT NOT NULL,                     -- WIP | COMPARTIDO | PUBLICADO | ARCHIVADO
  campos TEXT DEFAULT '{}',                 -- JSON: los campos leidos del nombre (originador, volumen, nivel, tipo, disciplina, numero)
  version_actual INTEGER DEFAULT 0, creado TEXT NOT NULL, creado_por TEXT NOT NULL, actualizado TEXT NOT NULL,
  ext TEXT DEFAULT '',                      -- formato del documento (pdf, docx, rvt...): el mismo codigo en otro formato es otro documento, como en Forma
  UNIQUE (proyecto_id, nombre, ext));
CREATE INDEX IF NOT EXISTS ix_cont_proy ON contenedores (proyecto_id, estado);
CREATE TABLE IF NOT EXISTS versiones (
  id TEXT PRIMARY KEY, contenedor_id TEXT NOT NULL, n INTEGER NOT NULL,
  archivo TEXT NOT NULL, extension TEXT NOT NULL, tamano INTEGER DEFAULT 0, sha256 TEXT DEFAULT '',
  revision TEXT DEFAULT '', idoneidad TEXT DEFAULT '',   -- P01, C01... / S0..S7, A1.., B1.., CR
  estado_al_subir TEXT NOT NULL, origen TEXT NOT NULL,   -- web | complemento-revit | complemento-navisworks | forma | ifc
  ruta_almacen TEXT NOT NULL, meta TEXT DEFAULT '{}',    -- JSON: lo que mande el complemento (version de Revit, vista, coordenadas...)
  subido_por TEXT NOT NULL, fecha TEXT NOT NULL,
  UNIQUE (contenedor_id, n));
CREATE TABLE IF NOT EXISTS transiciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT, contenedor_id TEXT NOT NULL, version_id TEXT, de TEXT NOT NULL, a TEXT NOT NULL,
  por TEXT NOT NULL, fecha TEXT NOT NULL, comentario TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS revisiones (
  id TEXT PRIMARY KEY, contenedor_id TEXT NOT NULL, version_id TEXT NOT NULL, ronda INTEGER NOT NULL,
  estado TEXT NOT NULL,                     -- abierta | aprobada | aprobada-con-comentarios | devuelta
  revisor TEXT DEFAULT '', solicitada_por TEXT NOT NULL, abierta TEXT NOT NULL, cerrada TEXT DEFAULT '', plazo TEXT DEFAULT '',
  comentario TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS incidencias (
  id TEXT PRIMARY KEY, proyecto_id TEXT NOT NULL, numero INTEGER NOT NULL, titulo TEXT NOT NULL, descripcion TEXT DEFAULT '',
  estado TEXT NOT NULL,                     -- abierta | en-curso | respondida | cerrada
  tipo TEXT DEFAULT 'observacion', prioridad TEXT DEFAULT 'media', contractual INTEGER DEFAULT 0,
  autor TEXT NOT NULL, asignado TEXT DEFAULT '', creado TEXT NOT NULL, vencimiento TEXT DEFAULT '', cerrado TEXT DEFAULT '',
  contenedor_id TEXT DEFAULT '', version_id TEXT DEFAULT '',
  elementos TEXT DEFAULT '[]',              -- JSON: [{ modelo, uid (UniqueId Revit), ifcGuid, e (id en el indice) }]
  camara TEXT DEFAULT '{}',                 -- JSON: { pos:[x,y,z], dir:[x,y,z], up:[x,y,z], fov } en metros
  captura TEXT DEFAULT '',                  -- ruta del PNG en el almacen
  UNIQUE (proyecto_id, numero));
CREATE TABLE IF NOT EXISTS comentarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT, incidencia_id TEXT NOT NULL, autor TEXT NOT NULL, fecha TEXT NOT NULL, texto TEXT NOT NULL,
  estado_nuevo TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS llaves (
  id TEXT PRIMARY KEY, nombre TEXT NOT NULL, huella TEXT NOT NULL, proyecto_id TEXT DEFAULT '',
  creada TEXT NOT NULL, por TEXT NOT NULL, uso TEXT DEFAULT '', revocada INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS indices_modelo (
  version_id TEXT PRIMARY KEY, estado TEXT NOT NULL,   -- recibiendo | armando | listo | error
  trozos INTEGER DEFAULT 0, bytes INTEGER DEFAULT 0, ruta_sqlite TEXT DEFAULT '', ruta_geometria TEXT DEFAULT '',
  resumen TEXT DEFAULT '{}', error TEXT DEFAULT '', fecha TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS auditoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT, fecha TEXT NOT NULL, quien TEXT NOT NULL, accion TEXT NOT NULL,
  proyecto_id TEXT DEFAULT '', objeto TEXT DEFAULT '', detalle TEXT DEFAULT '');
CREATE INDEX IF NOT EXISTS ix_aud ON auditoria (proyecto_id, fecha);
`;

function abre(rutaDatos) {
  if (DB) return DB;
  const { DatabaseSync } = require('node:sqlite');
  fs.mkdirSync(rutaDatos, { recursive: true });
  DB = new DatabaseSync(path.join(rutaDatos, 'cde.sqlite'));
  DB.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;');
  DB.exec(ESQUEMA);
  migra();
  return DB;
}

/** Columnas agregadas despues de la v0.1 (se crean si faltan; una base vieja sigue sirviendo). */
const COLUMNAS_NUEVAS = {
  miembros: [['cargo', "TEXT DEFAULT ''"], ['grupo', "TEXT DEFAULT ''"], ['nombre', "TEXT DEFAULT ''"], ['empresa', "TEXT DEFAULT ''"], ['puesto', "TEXT DEFAULT ''"], ['disciplina', "TEXT DEFAULT ''"], ['funcion', "TEXT DEFAULT ''"]],   // v0.6.6: funcion en el proyecto (DC, ESPECIALISTA, KP1, GP): con ella se arman los revisores de los flujos
  contenedores: [['carpeta_publicada', "TEXT DEFAULT ''"], ['carpeta_compartida', "TEXT DEFAULT ''"], ['carpeta_origen', "TEXT DEFAULT ''"],
    ['atributos', "TEXT DEFAULT '{}'"], ['borrado', "TEXT DEFAULT ''"], ['borrado_por', "TEXT DEFAULT ''"], ['borrado_lote', "TEXT DEFAULT ''"], ['retencion', "TEXT DEFAULT ''"]],   // retencion: carpeta a la que iba un archivo no conforme (area de retencion)   // v0.5.3: atributos personalizados y "elementos suprimidos" (papelera)
  revisiones: [['correo_id', "TEXT DEFAULT ''"], ['flujo_id', "TEXT DEFAULT ''"], ['paso', 'INTEGER DEFAULT 0'], ['pasos', "TEXT DEFAULT '[]'"], ['idoneidad', "TEXT DEFAULT ''"], ['vence', "TEXT DEFAULT ''"], ['destino', "TEXT DEFAULT ''"], ['flujo_def', "TEXT DEFAULT '{}'"],
    ['numero', 'INTEGER DEFAULT 0'], ['nombre', "TEXT DEFAULT ''"], ['notas', "TEXT DEFAULT ''"], ['lote', "TEXT DEFAULT ''"]],   // v0.5.3: #numero por proyecto, nombre de la revision, notas, lote (varios archivos enviados juntos)
  incidencias: [['codigo', "TEXT DEFAULT ''"], ['disciplina', "TEXT DEFAULT ''"], ['etapa', "TEXT DEFAULT ''"], ['nivel', "TEXT DEFAULT ''"], ['ambiente', "TEXT DEFAULT ''"],
    ['impacto', "TEXT DEFAULT '[]'"], ['origen', "TEXT DEFAULT ''"], ['responsable_org', "TEXT DEFAULT ''"], ['referencia', "TEXT DEFAULT ''"], ['verificado_por', "TEXT DEFAULT ''"], ['respondido', "TEXT DEFAULT ''"], ['revision_id', "TEXT DEFAULT ''"],
    ['borrado', "TEXT DEFAULT ''"], ['borrado_por', "TEXT DEFAULT ''"], ['borrado_motivo', "TEXT DEFAULT ''"], ['posicion', "TEXT DEFAULT '{}'"], ['inicio', "TEXT DEFAULT ''"], ['tipo_revision', "TEXT DEFAULT ''"], ['entregable', "TEXT DEFAULT ''"]],   // v0.13.2: tipo de revision y N.o entregable   // v0.6: incidencias suprimidas, pin sobre el PDF { version_id, pagina, x, y }, fecha de inicio
  versiones: [['resumen', "TEXT DEFAULT '{}'"], ['texto', "TEXT DEFAULT ''"]]   // v0.6.2: texto extraido (para 'Buscar en el contenido del archivo', como Aconex)   // v0.6: resumen automatico { descripcion, ideas, objetivo, conclusiones, fuente, modelo, fecha, estado }
};
function migra() {
  try { DB.exec("UPDATE miembros SET rol = 'miembro' WHERE rol = 'autor'"); } catch (e) {}   /* v0.9.2: el nivel «autor» pasa a ser «miembro» */
  for (const [tabla, cols] of Object.entries(COLUMNAS_NUEVAS)) {
    const hay = new Set(DB.prepare('PRAGMA table_info(' + tabla + ')').all().map(r => r.name));
    for (const [c, def] of cols) if (!hay.has(c)) DB.exec('ALTER TABLE ' + tabla + ' ADD COLUMN ' + c + ' ' + def);
  }
  migraFormatos();
}
/** v0.19: un documento se identifica por su codigo Y su formato (el .pdf y el .docx del mismo codigo son dos documentos, como en Forma).
 *  SQLite no cambia una restriccion UNIQUE en el sitio: se rehace la tabla con las mismas filas. A los documentos que ya existian se
 *  les asigna como formato la extension de su ultima version. */
function migraFormatos() {
  const t = DB.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'contenedores'").get(); if (!t || !t.sql) return;
  if (/UNIQUE\s*\(\s*proyecto_id\s*,\s*nombre\s*,\s*ext\s*\)/i.test(t.sql)) return;
  const cols = DB.prepare('PRAGMA table_info(contenedores)').all().map(c => c.name), conExt = cols.includes('ext');
  let sql = t.sql.replace(/^CREATE TABLE\s+"?contenedores"?/i, 'CREATE TABLE contenedores_v19');
  sql = sql.replace(/UNIQUE\s*\(\s*proyecto_id\s*,\s*nombre\s*\)/i, (conExt ? '' : "ext TEXT DEFAULT '',\n  ") + 'UNIQUE (proyecto_id, nombre, ext)');
  if (!/UNIQUE \(proyecto_id, nombre, ext\)/.test(sql)) { console.error('[bd] no se pudo preparar la migracion de formatos'); return; }
  const indices = DB.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'contenedores' AND sql IS NOT NULL").all().map(r => r.sql), lista = cols.join(', ');
  DB.exec('PRAGMA foreign_keys=OFF'); DB.exec('BEGIN');
  try {
    DB.exec('DROP TABLE IF EXISTS contenedores_v19'); DB.exec(sql);
    DB.exec('INSERT INTO contenedores_v19 (' + lista + (conExt ? '' : ', ext') + ') SELECT ' + lista + (conExt ? '' : ", COALESCE((SELECT LOWER(v.extension) FROM versiones v WHERE v.contenedor_id = contenedores.id ORDER BY v.n DESC LIMIT 1), '')") + ' FROM contenedores');
    const antes = DB.prepare('SELECT COUNT(*) AS n FROM contenedores').get().n, despues = DB.prepare('SELECT COUNT(*) AS n FROM contenedores_v19').get().n;
    if (antes !== despues) throw new Error('filas distintas (' + antes + ' / ' + despues + ')');
    DB.exec('DROP TABLE contenedores'); DB.exec('ALTER TABLE contenedores_v19 RENAME TO contenedores');
    for (const i of indices) DB.exec(i);
    DB.exec('COMMIT'); console.log('[bd] documentos identificados por codigo y formato (' + despues + ' documentos)');
    separaFormatos();
  } catch (e) { try { DB.exec('ROLLBACK'); } catch (e2) {} console.error('[bd] migracion de formatos no aplicada:', e.message); }
  DB.exec('PRAGMA foreign_keys=ON');
}
/** Documentos que, antes de v0.19, juntaron versiones de distinto formato (el .docx como V1 y el .pdf como V2): cada formato pasa a
 *  ser un documento con sus versiones, numeradas de nuevo. Lo traido por un conector (Forma, Aconex, OneDrive/SharePoint) recibe otra
 *  vez la revision correlativa que le habria tocado. No se toca un documento si alguna version movida tiene revision, incidencia,
 *  marca o envio a otro proyecto asociados (se anota para revisarlo a mano). */
function separaFormatos() {
  const ISO = require('./iso19650'), CON = new Set(['forma', 'aconex', 'microsoft', 'onedrive', 'sharepoint']), ref = ['revisiones', 'incidencias', 'marcas', 'compartidos'];
  const hay = new Set(DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name)), cols = (t) => hay.has(t) ? DB.prepare('PRAGMA table_info(' + t + ')').all().map(c => c.name) : [];
  const mixtos = DB.prepare("SELECT contenedor_id FROM versiones GROUP BY contenedor_id HAVING COUNT(DISTINCT LOWER(extension)) > 1").all().map(r => r.contenedor_id);
  let separados = 0;
  for (const cid of mixtos) {
    const c = DB.prepare('SELECT * FROM contenedores WHERE id = ?').get(cid); if (!c) continue;
    const vs = DB.prepare('SELECT id, n, extension, revision, origen FROM versiones WHERE contenedor_id = ? ORDER BY n').all(cid), propio = String(c.ext || '').toLowerCase();
    const grupos = new Map(); for (const v of vs) { const e = String(v.extension || '').toLowerCase(); if (!grupos.has(e)) grupos.set(e, []); grupos.get(e).push(v); }
    const otros = [...grupos.keys()].filter(e => e !== propio), mover = otros.flatMap(e => grupos.get(e)).map(v => v.id);
    const usada = ref.some(t => cols(t).includes('version_id') && mover.some(id => DB.prepare('SELECT 1 FROM ' + t + ' WHERE version_id = ? LIMIT 1').get(id)));
    if (usada || otros.some(e => DB.prepare('SELECT 1 FROM contenedores WHERE proyecto_id = ? AND nombre = ? AND ext = ?').get(c.proyecto_id, c.nombre, e))) { console.error('[bd] ' + c.nombre + ': tiene formatos mezclados pero se deja como esta (revisar a mano)'); continue; }
    DB.exec('BEGIN');
    try {
      const renumera = (dest, lista, estado) => { let prev = '';
        lista.forEach((v, i) => { const auto = CON.has(String(v.origen || '').toLowerCase()), rev = auto ? ISO.siguienteRevision(prev, estado) : v.revision; prev = rev;
          DB.prepare('UPDATE versiones SET contenedor_id = ?, n = ?, revision = ? WHERE id = ?').run(dest, i + 1, rev, v.id);
          if (hay.has('forma_items')) DB.prepare('UPDATE forma_items SET contenedor_id = ?, n_cde = ? WHERE contenedor_id = ? AND n_cde = ?').run(dest, i + 1, cid, v.n);
          if (cols('transiciones').includes('version_id')) DB.prepare('UPDATE transiciones SET contenedor_id = ? WHERE version_id = ?').run(dest, v.id); });
        DB.prepare('UPDATE contenedores SET version_actual = ? WHERE id = ?').run(lista.length, dest); };
      const ccols = cols('contenedores').filter(k => k !== 'id' && k !== 'ext' && k !== 'version_actual');
      for (const e of otros) { const nid = 'c' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
        DB.prepare('INSERT INTO contenedores (id, ext, version_actual, ' + ccols.join(', ') + ') SELECT ?, ?, 0, ' + ccols.join(', ') + ' FROM contenedores WHERE id = ?').run(nid, e, cid);
        renumera(nid, grupos.get(e), c.estado); }
      renumera(cid, grupos.get(propio) || [], c.estado);
      DB.exec('COMMIT'); separados++;
    } catch (e) { try { DB.exec('ROLLBACK'); } catch (e2) {} console.error('[bd] ' + c.nombre + ': no se pudieron separar los formatos:', e.message); }
  }
  if (separados) console.log('[bd] ' + separados + ' documento(s) con formatos mezclados separados en un documento por formato');
}
/** Formato (extension en minusculas, sin punto) de un nombre de archivo. */
const extDe = (nombre) => { const m = /\.([A-Za-z0-9]{1,10})$/.exec(String(nombre || '').trim()); return m ? m[1].toLowerCase() : ''; };
/** El documento de un proyecto por su codigo y su formato. Uno sin formato registrado (de antes de v0.19) vale para cualquiera. */
function contenedorPorNombre(pid, base, ext, conSuprimidos) {
  const e = String(ext || '').toLowerCase().replace(/^\./, '');
  return DB.prepare("SELECT * FROM contenedores WHERE proyecto_id = ? AND nombre = ? AND (ext = ? OR ext = '')" + (conSuprimidos ? '' : " AND borrado = ''") + ' ORDER BY (ext = ?) DESC, borrado ASC LIMIT 1').get(pid, base, e, e) || null;
}
const ahora = () => new Date().toISOString();
const id = (p) => (p || '') + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
const json = (v, d) => { try { return v == null || v === '' ? d : JSON.parse(v); } catch (e) { return d; } };

const q = {
  uno: (sql, ...a) => DB.prepare(sql).get(...a) || null,
  todos: (sql, ...a) => DB.prepare(sql).all(...a),
  corre: (sql, ...a) => DB.prepare(sql).run(...a)
};

function audita(quien, accion, proyecto_id, objeto, detalle) {
  try { q.corre('INSERT INTO auditoria (fecha, quien, accion, proyecto_id, objeto, detalle) VALUES (?,?,?,?,?,?)', ahora(), String(quien || ''), accion, String(proyecto_id || ''), String(objeto || ''), typeof detalle === 'string' ? detalle : JSON.stringify(detalle || {})); } catch (e) {}
}

/** Fila -> objeto plano con los JSON ya abiertos. */
function abreJson(fila, campos) { if (!fila) return null; for (const c of campos) fila[c] = json(fila[c], Array.isArray(fila[c]) ? [] : {}); return fila; }

module.exports = { abre, q, ahora, id, json, audita, abreJson, extDe, contenedorPorNombre, get db() { return DB; } };
