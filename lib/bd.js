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
  UNIQUE (proyecto_id, nombre));
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

module.exports = { abre, q, ahora, id, json, audita, abreJson, get db() { return DB; } };
