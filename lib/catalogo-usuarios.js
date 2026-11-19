/*
 * CATALOGO DE USUARIOS: Empresa, Cargo y Disciplina / Especialidad con sus codigos. Con ellos se arma la «Funcion» de cada
 * usuario: EMPRESA-CARGO-DISCIPLINA (p. ej. A-ESP-DOC = Especialista en control documentario de ANIN).
 * Es la base; cada proyecto puede agregar los suyos (config.catalogoUsuarios) desde «Usuarios de proyecto».
 */
'use strict';
const BASE = {
  empresas: [
    {"nombre": "ANIN", "codigo": "A"},
    {"nombre": "CONTRATISTA", "codigo": "C"},
    {"nombre": "SUPERVISIÓN", "codigo": "S"},
    {"nombre": "SUBCONTRATISTA", "codigo": "SC"},
    {"nombre": "EXTERNO", "codigo": "E"}],
  cargos: [
    {"nombre": "ADMINISTRADOR", "codigo": "ADM"},
    {"nombre": "ANALISTA", "codigo": "ANL"},
    {"nombre": "ASISTENTE", "codigo": "AST"},
    {"nombre": "COORDINADOR", "codigo": "CRD"},
    {"nombre": "DIRECTOR", "codigo": "DIR"},
    {"nombre": "ESPECIALISTA", "codigo": "ESP"},
    {"nombre": "GERENTE", "codigo": "GTE"},
    {"nombre": "GESTOR", "codigo": "GST"},
    {"nombre": "JEFE", "codigo": "JEF"},
    {"nombre": "SUBDIRECTOR", "codigo": "SBD"},
    {"nombre": "SUPERVISOR", "codigo": "SUP"},
    {"nombre": "UNIDAD DESCONCENTRADA", "codigo": "UD"},
    {"nombre": "VISUALIZADOR", "codigo": "VIS"}],
  disciplinas: [
    {"nombre": "ADMINISTRATIVO", "codigo": "ADM"},
    {"nombre": "ADQUISICIONES", "codigo": "ADQ"},
    {"nombre": "AMBIENTAL", "codigo": "AMB"},
    {"nombre": "ANALISIS DE RIESGOS DE DESASTRES", "codigo": "ARD"},
    {"nombre": "ARQUEOLOGÍA", "codigo": "AQO"},
    {"nombre": "ARQUITECTURA", "codigo": "ARQ"},
    {"nombre": "BIM", "codigo": "BIM"},
    {"nombre": "CALIDAD", "codigo": "CAL"},
    {"nombre": "CIERRE COMERCIAL", "codigo": "CCO"},
    {"nombre": "COMUNICACIONES", "codigo": "COM"},
    {"nombre": "CONTRATOS", "codigo": "CTR"},
    {"nombre": "CONTROL DOCUMENTARIO", "codigo": "DOC"},
    {"nombre": "COSTOS Y PRESUPUESTO", "codigo": "CST"},
    {"nombre": "DISEÑO", "codigo": "DIS"},
    {"nombre": "DISEÑO DE INTERIORES", "codigo": "DIN"},
    {"nombre": "DRENAJE PLUVIAL", "codigo": "DRP"},
    {"nombre": "EFICIENCIA ENERGETICA", "codigo": "EEN"},
    {"nombre": "ELECTRICIDAD", "codigo": "ELE"},
    {"nombre": "EQUIPAMIENTO MÉDICO", "codigo": "EME"},
    {"nombre": "ESTRUCTURAS", "codigo": "EST"},
    {"nombre": "FORESTAL", "codigo": "FOR"},
    {"nombre": "GAS Y COMBUSTIBLES", "codigo": "GAS"},
    {"nombre": "GASES MEDICINALES", "codigo": "GME"},
    {"nombre": "GEODESIA", "codigo": "GDS"},
    {"nombre": "GEOLOGIA / GEOMORFOLOGIA", "codigo": "GEO"},
    {"nombre": "GEOTECNIA", "codigo": "GTC"},
    {"nombre": "GESTION DE CAMBIOS", "codigo": "GCM"},
    {"nombre": "GESTION DE RESIDUOS", "codigo": "RES"},
    {"nombre": "GESTION DE RIESGOS", "codigo": "GRI"},
    {"nombre": "GESTION DEL TALENTO HUMANO", "codigo": "GTH"},
    {"nombre": "GIS", "codigo": "GIS"},
    {"nombre": "HIDRÁULICA", "codigo": "HID"},
    {"nombre": "HIDROGEOLOGÍA", "codigo": "HGE"},
    {"nombre": "HIDROLOGIA", "codigo": "HDR"},
    {"nombre": "INVERSIÓN PÚBLICA", "codigo": "INV"},
    {"nombre": "LEGAL", "codigo": "LEG"},
    {"nombre": "LIBERACION DE AREAS E INTERFERENCIAS", "codigo": "LAI"},
    {"nombre": "MANTENIMIENTO", "codigo": "MAN"},
    {"nombre": "MECÁNICA", "codigo": "MEC"},
    {"nombre": "MOVIMIENTO DE TIERRAS", "codigo": "MVT"},
    {"nombre": "OBRAS CIVILES", "codigo": "CIV"},
    {"nombre": "OBRAS DE ARTE", "codigo": "OAR"},
    {"nombre": "OFICINA TECNICA", "codigo": "OFT"},
    {"nombre": "PAISAJISMO", "codigo": "PAI"},
    {"nombre": "PATRIMONIO CULTURAL", "codigo": "PAT"},
    {"nombre": "PAVIMENTOS", "codigo": "PAV"},
    {"nombre": "PLANEAMIENTO", "codigo": "PLA"},
    {"nombre": "PREDIAL", "codigo": "PDR"},
    {"nombre": "PRODUCCIÓN", "codigo": "PRD"},
    {"nombre": "PROYECTO GENERAL", "codigo": "PRY"},
    {"nombre": "PUENTES", "codigo": "PUE"},
    {"nombre": "SANEAMIENTO INTEGRAL", "codigo": "SAI"},
    {"nombre": "SANITARIA", "codigo": "SAN"},
    {"nombre": "SEGURIDAD Y EVACUACIÓN", "codigo": "SEG"},
    {"nombre": "SEGURIDAD Y SALUD EN EL TRABAJO", "codigo": "SST"},
    {"nombre": "SEÑALÉTICA Y SEGURIDAD VIAL", "codigo": "SNV"},
    {"nombre": "SEÑALETICA Y SEÑALIZACION", "codigo": "SEN"},
    {"nombre": "SISTEMAS CONTRA INCENDIOS", "codigo": "INC"},
    {"nombre": "SISTEMAS DE TI", "codigo": "ITC"},
    {"nombre": "SOCIAL", "codigo": "SOC"},
    {"nombre": "SOSTENIBILIDAD", "codigo": "SOS"},
    {"nombre": "SUELOS, CANTERAS, FUENTES DE AGUA", "codigo": "SCF"},
    {"nombre": "TOPOGRAFÍA", "codigo": "TOP"},
    {"nombre": "TRÁFICO", "codigo": "TRF"},
    {"nombre": "TRANSPORTE VERTICAL", "codigo": "TVE"},
    {"nombre": "URBANISMO", "codigo": "URB"},
    {"nombre": "VIAL", "codigo": "VIA"}]
};
const llano = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
const LISTAS = ['empresas', 'cargos', 'disciplinas'];
/** Catalogo vigente del proyecto: la base + lo que el proyecto agrego (sin repetir codigo). */
function deProyecto(config) {
  const extra = (config && config.catalogoUsuarios) || {}, out = {};
  for (const k of LISTAS) { const base = BASE[k].map(x => Object.assign({}, x)), mas = (Array.isArray(extra[k]) ? extra[k] : []).filter(x => x && x.nombre && x.codigo && !base.some(b => b.codigo === x.codigo)).map(x => ({ nombre: String(x.nombre), codigo: String(x.codigo), propio: true })); out[k] = base.concat(mas); }
  return out;
}
/** Agrega un elemento a una lista del proyecto. Devuelve { error } o { item }. */
function agrega(config, lista, nombre, codigo) {
  if (!LISTAS.includes(lista)) return { error: 'Lista no válida.' };
  const n = String(nombre || '').trim().toUpperCase().slice(0, 80), c = String(codigo || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 12);
  if (!n || !c) return { error: 'Faltan el nombre y el código (letras, números y _).' };
  const act = deProyecto(config)[lista];
  if (act.some(x => x.codigo === c)) return { error: 'Ya existe el código ' + c + ' (' + act.find(x => x.codigo === c).nombre + ').' };
  if (act.some(x => llano(x.nombre) === llano(n))) return { error: 'Ya existe «' + n + '».' };
  config.catalogoUsuarios = config.catalogoUsuarios || {}; config.catalogoUsuarios[lista] = (config.catalogoUsuarios[lista] || []).concat([{ nombre: n, codigo: c }]);
  return { item: { nombre: n, codigo: c, propio: true } };
}
/** Resuelve empresa / cargo / disciplina (por nombre o codigo) y arma la funcion. Lo que no este en el catalogo queda vacio. */
function resuelve(config, d) {
  const cat = deProyecto(config), busca = (L, v) => L.find(x => x.codigo === String(v || '').trim().toUpperCase()) || L.find(x => llano(x.nombre) === llano(v)) || null;
  const e = busca(cat.empresas, d.empresa), c = busca(cat.cargos, d.puesto), s = busca(cat.disciplinas, d.disciplina);
  return { empresa: e ? e.nombre : '', puesto: c ? c.nombre : '', disciplina: s ? s.nombre : '', funcion: e && c && s ? e.codigo + '-' + c.codigo + '-' + s.codigo : '' };
}
module.exports = { BASE, LISTAS, deProyecto, agrega, resuelve };
