/*
 * NORMAS DE NOMENCLATURA POR CARPETA (Archivos → Configuracion → Conformidad, como en Autodesk Forma/Docs):
 *   - un proyecto tiene VARIAS normas (config.normas[]): nombre, descripcion, campos (longitud fija, tipo de caracter,
 *     obligatorio, valores o regex), si exige codigo de revision y sus "atributos relacionados" (la lista de codigos de estado
 *     que admite, la revision, la parte designada y el contrato);
 *   - cada CARPETA puede fijar su norma (carpeta.norma = id), 'libre' (sin norma) o heredar la del padre; la raiz usa
 *     config.normaPorDefecto. Las carpetas de zona WIP sin norma propia son LIBRES (es trabajo en curso: lo pidio Erick);
 *   - AREA DE RETENCION (config.conformidad.areaRetencion): si esta activada, un archivo que no cumple la norma de su carpeta
 *     NO se rechaza: se carga "retenido" (contenedores.retencion = carpeta de destino) y aparece en la pestana Area de
 *     retencion hasta que se renombre; si esta desactivada, se rechaza (lo de antes);
 *   - al pasar a COMPARTIDO/PUBLICADO o desplazar a una carpeta con norma, el nombre debe cumplirla.
 * La config vieja (config.nomenclatura: una sola regla) se migra a normas[0] la primera vez.
 */
'use strict';
const ISO = require('./iso19650');
const CAR = require('./carpetas');

const slug = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'norma';

function normalizaCampos(lista) {
  return (Array.isArray(lista) ? lista : []).slice(0, 20).map(c => ({
    nombre: String((c && c.nombre) || '').trim().slice(0, 40), descripcion: String((c && c.descripcion) || '').slice(0, 200), tipo: c && c.tipo === 'lista' ? 'lista' : 'texto',
    valores: Array.isArray(c && c.valores) ? c.valores.map(v => String(v).trim()).filter(Boolean).slice(0, 500) : [], regex: String((c && c.regex) || '').slice(0, 200),
    longitud: Math.max(0, Math.min(40, parseInt(c && c.longitud, 10) || 0)), caracteres: ['alfanumerico', 'letras', 'numeros', 'cualquiera'].includes(c && c.caracteres) ? c.caracteres : 'alfanumerico', obligatorio: !(c && c.obligatorio === false)
  })).filter(c => c.nombre);
}
/** Una norma saneada. { norma } o { error }. */
function normalizaNorma(n, existentes, quien) {
  if (!n || typeof n !== 'object') return { error: 'Norma vacia.' };
  const nombre = String(n.nombre || '').trim().slice(0, 120); if (!nombre) return { error: 'La norma necesita un nombre.' };
  const campos = normalizaCampos(n.campos); if (campos.length < 2) return { error: 'La norma necesita al menos 2 campos.' };
  let id = String(n.id || '').trim() || slug(nombre); if (!/^[a-z0-9-]{1,40}$/.test(id)) id = slug(id);
  if (Array.isArray(existentes) && existentes.some(x => x.id === id && x.id !== n.id)) id = id + '-' + Date.now().toString(36).slice(-4);
  const a = n.atributos || {};
  const codigos = (Array.isArray(a.codigosEstado) ? a.codigosEstado : []).map(c => ({ valor: String((c && c.valor) || '').trim().toUpperCase().slice(0, 6), descripcion: String((c && c.descripcion) || '').slice(0, 120) })).filter(c => c.valor).slice(0, 40);
  return { norma: { id, nombre, descripcion: String(n.descripcion || '').slice(0, 500), campos, conRevision: n.conRevision !== false, separador: '-',
    atributos: { codigosEstado: codigos, revision: String(a.revision || 'P##').slice(0, 20), parteDesignada: String(a.parteDesignada || 'Originador').slice(0, 40), contrato: String(a.contrato || '').slice(0, 80) },
    creado: n.creado || new Date().toISOString(), por: String(n.por || quien || '').slice(0, 120), actualizado: new Date().toISOString() } };
}
/** config.normas, migrando config.nomenclatura (una sola regla) la primera vez. Devuelve true si cambio la config. */
function migra(cfg) {
  let cambio = false;
  if (!Array.isArray(cfg.normas)) {
    cfg.normas = [];
    if (cfg.nomenclatura && Array.isArray(cfg.nomenclatura.campos) && cfg.nomenclatura.campos.length) {
      const n = normalizaNorma({ id: 'default-iso19650', nombre: 'Default ISO 19650', descripcion: 'Norma inicial del proyecto', campos: cfg.nomenclatura.campos, conRevision: cfg.nomenclatura.conRevision !== false, atributos: { codigosEstado: [{ valor: 'S0', descripcion: 'Trabajo en progreso' }, { valor: 'S1', descripcion: 'Para coordinacion' }, { valor: 'S2', descripcion: 'Para informacion' }, { valor: 'S3', descripcion: 'Avance para revision y comentarios' }, { valor: 'S4', descripcion: 'Para aprobacion' }, { valor: 'A1', descripcion: 'Aprobado' }] } }, [], 'sistema');
      if (n.norma) { cfg.normas.push(n.norma); cfg.normaPorDefecto = n.norma.id; }
    }
    cambio = true;
  }
  if (!cfg.conformidad || typeof cfg.conformidad !== 'object') { cfg.conformidad = { areaRetencion: false, wipLibre: true }; cambio = true; }
  // DOCPG002 (libreria maestra de la ANIN): disponible en todos los proyectos; por defecto en los que aun no tienen norma propia
  const D = require('./docpg002');
  if (!cfg.normas.some(n => n.id === D.ID)) { const n = normalizaNorma(D.norma('sistema'), cfg.normas); if (n.norma) { n.norma.sectores = D.norma().sectores; n.norma.fuente = 'DOCPG002 V03 (OGP - ANIN)'; cfg.normas.push(n.norma); cambio = true; } }
  if (!cfg.normaPorDefecto || !cfg.normas.some(n => n.id === cfg.normaPorDefecto)) { cfg.normaPorDefecto = D.ID; cambio = true; }
  return cambio;
}
const normaPorId = (cfg, id) => (cfg.normas || []).find(n => n.id === id) || null;
/** La norma que rige una carpeta: la propia, la heredada del ancestro mas cercano con norma, o la del proyecto; 'libre' corta la herencia.
 *  Carpetas de zona WIP sin norma propia: libres (config.conformidad.wipLibre, por defecto si). Devuelve { norma, origen } o { norma: null, origen: 'libre'|'sin-carpetas' }. */
function normaDe(cfg, ruta) {
  const carpetas = cfg.carpetas || [];
  if (!carpetas.length) { const n = normaPorId(cfg, cfg.normaPorDefecto) || (cfg.normas || [])[0] || null; return { norma: n, origen: n ? 'proyecto' : 'sin-norma' }; }
  let r = CAR.limpia(ruta);
  while (r) {
    const d = CAR.def(carpetas, r);
    if (d && d.norma) { if (d.norma === 'libre') return { norma: null, origen: 'libre:' + r }; const n = normaPorId(cfg, d.norma); if (n) return { norma: n, origen: r }; }
    r = CAR.padreDe(r);
  }
  const zona = CAR.zonaDe(carpetas, ruta);
  if (zona === 'wip' && (!cfg.conformidad || cfg.conformidad.wipLibre !== false)) return { norma: null, origen: 'wip-libre' };
  const n = normaPorId(cfg, cfg.normaPorDefecto) || (cfg.normas || [])[0] || null;
  return { norma: n, origen: n ? 'proyecto' : 'sin-norma' };
}
/** Valida un nombre de archivo contra la norma de la carpeta. Si la carpeta es libre: ok=true, libre=true (se leen base/revision/ext igual). */
function valida(cfg, carpeta, nombreArchivo) {
  const { norma, origen } = normaDe(cfg, carpeta);
  if (!norma) { const r = ISO.valida(nombreArchivo, {}); const p = ISO.partes(nombreArchivo); return { ok: !!p.ext, libre: true, origen, errores: p.ext ? [] : ['El archivo no tiene extension.'], base: p.base, revision: p.revision, extension: p.ext, campos: {}, conforme: r.ok, norma: null }; }
  const r = ISO.valida(nombreArchivo, { nomenclatura: { campos: norma.campos, conRevision: norma.conRevision } });
  return Object.assign(r, { libre: false, origen, conforme: r.ok, norma: { id: norma.id, nombre: norma.nombre } });
}
/** Vista preliminar de la convencion: ######-XXXXX-###-XXX-E1-###### (como la de Forma). */
function vistaPreliminar(norma) {
  return (norma.campos || []).map(c => { const n = c.longitud || (c.valores && c.valores.length ? Math.max(...c.valores.map(v => v.length)) : 4); const ch = c.caracteres === 'numeros' ? '#' : c.caracteres === 'letras' ? 'A' : 'X'; return c.valores && c.valores.length === 1 ? c.valores[0] : ch.repeat(Math.min(12, Math.max(1, n))); }).join('-') + (norma.conRevision !== false ? '-P##' : '') + '.ext';
}
/** Duplicados: contenedores que comparten los atributos elegidos (campos del nombre) dentro de unas carpetas. Pura. */
function duplicados(contenedores, carpetas, atributos) {
  const dentro = (c) => !carpetas.length || carpetas.some(r => r === '' || c.carpeta === r || c.carpeta.startsWith(r + '/'));
  const clave = (c) => atributos.map(a => a === 'nombre' ? c.nombre : a === 'archivo' ? (c.ultima && c.ultima.archivo) || '' : a === 'sha256' ? (c.ultima && c.ultima.sha256) || '' : String((c.campos || {})[a] || '')).join('|');
  const m = new Map();
  for (const c of contenedores) { if (!dentro(c)) continue; const k = clave(c); if (!k.replace(/\|/g, '')) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(c); }
  return [...m.entries()].filter(([, l]) => l.length > 1).map(([k, l]) => ({ clave: k, contenedores: l.map(c => ({ id: c.id, nombre: c.nombre, carpeta: c.carpeta, estado: c.estado, version: c.ultima ? c.ultima.n : 0, archivo: c.ultima ? c.ultima.archivo : '' })) }));
}

/** Mantiene config.nomenclatura (la regla unica de antes) igual a la norma por defecto, para lo que aun la lee (sin carpetas, copia a otro proyecto). */
function sincronizaLegado(cfg) {
  const n = normaPorId(cfg, cfg.normaPorDefecto) || (cfg.normas || [])[0] || null;
  if (n) cfg.nomenclatura = { separador: '-', conRevision: n.conRevision !== false, campos: n.campos }; else delete cfg.nomenclatura;
}
/**
 * v0.24.2 · El campo «Código de proyecto» del nombre debe ser el código del proyecto en el CDE (p. ej. 100022): la norma solo pide
 * 6 dígitos, así que un 100031 pasaba. Devuelve { i (índice del campo), valor, codigo, mensaje } si no coincide; null si está bien o
 * no aplica (carpeta sin norma, norma sin ese campo o proyecto con un código que no es de 6 dígitos).
 */
function codigoProyectoMal(cfg, carpeta, nombreArchivo, codigo) {
  codigo = String(codigo || '').trim(); if (!/^\d{6}$/.test(codigo)) return null;
  const { norma } = normaDe(cfg, carpeta); if (!norma) return null;
  const i = (norma.campos || []).findIndex(c => /^c[oó]digo\s+(de|del)\s+proyecto$/i.test(String(c.nombre || '').trim())); if (i < 0) return null;
  const valor = String(ISO.partes(nombreArchivo).campos[i] || '');
  return valor && valor !== codigo ? { i, valor, codigo, mensaje: 'El código de proyecto del nombre (' + valor + ') no es el de este proyecto (' + codigo + ').' } : null;
}
/**
 * v0.25.1 · Un código (sin extensión) repartido campo a campo según la norma de la carpeta: { norma, ok, campos:[{ nombre, valor, etiqueta,
 * error, admitidos? }] }. «etiqueta» es el significado del valor en la DOCPG002 (INF = Informe); «admitidos» trae la lista de la norma
 * cuando el valor no está en ella (para mostrarla). codigoProyecto: el del proyecto, para marcar el primer campo si es de otro.
 */
function detalleCodigo(cfg, carpeta, codigo, codigoProyecto) {
  const { norma } = normaDe(cfg, carpeta); if (!norma || !codigo) return null;
  const D = require('./docpg002'), tablaDe = { 'Activo': 'activos', 'Nivel': 'niveles', 'Tipo de documento': 'tiposDocumento', 'Disciplina': 'disciplinas', 'Etapa': 'etapas' };
  const n = norma.campos.length; let pr = String(codigo).split('-'); if (pr.length > n) pr = pr.slice(0, n - 1).concat(pr.slice(n - 1).join('-')); while (pr.length < n) pr.push('');
  const campos = norma.campos.map((def, i) => {
    const v = pr[i], tabla = norma.id === D.ID && tablaDe[def.nombre] ? D.TABLAS[tablaDe[def.nombre]] : null, et = tabla ? (tabla.find(x => x[0] === v) || [])[1] || '' : '';
    let error = v === '' && def.obligatorio !== false ? 'falta' : ISO.errorCampo(def, v);
    if (error) error = error.replace(/^Campo "[^"]*":\s*/, '').replace(/^"[^"]*"\s*/, '').replace(/^no esta entre los admitidos \(.*\)\.$/, 'no está entre los ' + ((def.valores || []).length) + ' valores admitidos por la norma').replace(/^debe tener (\d+) caracteres\.$/, 'debe tener $1 caracteres (tiene ' + v.length + ')').replace(/^no cumple el formato .*$/, def.nombre === 'Originador' ? 'debe ser 3 letras + 2 números (ABC01) o 4 letras + 1 número (ANIN1)' : 'no tiene el formato de la norma').replace(/^falta$/, 'falta este campo');
    const o = { nombre: def.nombre, valor: v, etiqueta: et, error: error || '' };
    if (error && Array.isArray(def.valores) && def.valores.length) o.admitidos = (tabla || def.valores.map(x => [x, ''])).map(x => x[0] + (x[1] ? ' · ' + x[1] : '')).slice(0, 600);
    return o;
  });
  const cpm = codigoProyectoMal(cfg, carpeta, codigo + '.x', codigoProyecto); if (cpm && !campos[cpm.i].error) campos[cpm.i].error = 'es de otro proyecto (este es el ' + cpm.codigo + ')';
  return { norma: norma.nombre, ok: campos.every(c => !c.error), campos };
}
module.exports = { detalleCodigo, sincronizaLegado, normalizaNorma, normalizaCampos, migra, normaDe, valida, codigoProyectoMal, vistaPreliminar, duplicados, slug };
