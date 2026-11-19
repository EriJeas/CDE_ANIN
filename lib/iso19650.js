/*
 * ISO 19650 EN EL CDE: estados del contenedor, codigos de estado (idoneidad) y de revision, transiciones permitidas y
 * validacion del NOMBRE del contenedor al subir. La regla de nombre por defecto es la MISMA que ya usa el visor para su
 * KPI "nomenclatura conforme" (validaNombre19650, en compartido-visor/clasificadores-visor.js); cada proyecto puede
 * ademas definir sus campos (orden y valores admitidos) en su configuracion, y entonces se valida campo por campo.
 */
'use strict';
const vm = require('vm');
const RF = require('../compartido-visor/reporte-forma');

const ESTADOS = ['WIP', 'COMPARTIDO', 'PUBLICADO', 'ARCHIVADO'];
/** De que estado a que estado se puede pasar, y que rol minimo hace falta. */
const TRANSICIONES = {
  'WIP>COMPARTIDO': 'autor',           // solo quien «comparte»: Document Control, gestor o administrador (ver COMPARTE)
  'COMPARTIDO>WIP': 'gestor',          // a mano solo el gestor; los revisores devuelven por el flujo de revision, no moviendo el archivo
  'COMPARTIDO>PUBLICADO': 'gestor',    // tras aprobacion: solo el gestor de informacion de la entidad
  'PUBLICADO>ARCHIVADO': 'gestor',
  'COMPARTIDO>ARCHIVADO': 'gestor',
  'WIP>ARCHIVADO': 'gestor'
};
// Niveles de acceso al CDE. «Miembro» y «Document Control» comparten escalon (antes «autor»); «Revisor» y «Revisor DC», el suyo.
//  - miembro: produce en WIP (carga, crea carpetas en WIP); NO pasa documentos a compartido.
//  - document-control: lo del miembro + pasa de WIP a compartido y crea carpetas en compartido.
//  - revisor: solo lectura en WIP; marcas de revision e incidencias sobre lo compartido; no crea carpetas.
//  - revisor-dc: lo del revisor + crea carpetas en compartido.
const RANGO_ROL = { lector: 0, autor: 1, miembro: 1, 'document-control': 1, revisor: 2, 'revisor-dc': 2, gestor: 3, administrador: 4 };
const ROLES = ['lector', 'miembro', 'document-control', 'revisor', 'revisor-dc', 'gestor', 'administrador'];
/** Familia del nivel: lo que en flujos y permisos se pide como «autor» lo cumplen miembro y document-control; «revisor», los dos revisores. */
const familia = (rol) => rol === 'miembro' || rol === 'document-control' ? 'autor' : rol === 'revisor-dc' ? 'revisor' : String(rol || '');
const COMPARTE = ['document-control', 'gestor', 'administrador'];
/** ¿Puede este nivel crear una carpeta dentro de una zona? Fuera de zona ('') decide el permiso de la carpeta, salvo para los revisores, que no crean. */
function puedeCrearCarpeta(rol, zona) {
  if (rol === 'gestor' || rol === 'administrador') return true;
  if (rol === 'miembro' || rol === 'autor') return zona === 'wip' || !zona;
  if (rol === 'document-control') return zona === 'wip' || zona === 'compartido' || !zona;
  if (rol === 'revisor-dc') return zona === 'compartido';
  return false;
}

/** Codigos de estado (idoneidad) ISO 19650-2 anexo nacional tipico; S = compartido, A = publicado, B = parcial, CR = en revision. */
const IDONEIDAD = {
  WIP: ['S0'],
  COMPARTIDO: ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'CR'],
  PUBLICADO: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6'],
  ARCHIVADO: []
};
/** Revision: P01, P02... mientras es WIP/compartido; C01, C02... una vez publicado (contractual). */
const RX_REVISION = /^(P|R|C|M)(\d{2})(\.\d{2})?$/i;   // P## (ISO 19650 UK) · R## / C## / M## (DOCPG002 ANIN)

let validaVisor = null;
function validaNombreVisor(nombre) {
  if (!validaVisor) {
    const C = { String, RegExp }; vm.createContext(C);
    vm.runInContext(RF.fuentesComunes(['validaNombre19650']), C);
    validaVisor = C.validaNombre19650;
  }
  return !!validaVisor(nombre);
}

/** Separa nombre base, revision y extension: "ANIN-GHEMET-ZZ-XX-M3-A-0001-P03.rvt" -> { base, revision: "P03", ext: "rvt" }. Pura. */
function partes(nombreArchivo) {
  const s = String(nombreArchivo || '').trim();
  const m = /^(.*?)(?:\.([A-Za-z0-9]{1,8}))?$/.exec(s) || [];
  let base = m[1] || '', ext = (m[2] || '').toLowerCase(), revision = '';
  const campos = base.split('-');
  if (campos.length > 1 && RX_REVISION.test(campos[campos.length - 1])) { revision = campos.pop().toUpperCase(); base = campos.join('-'); }
  return { base, revision, ext, campos: base.split('-') };
}

/** Configuracion de nomenclatura de un proyecto (Archivos → Configuracion → Conformidad):
 *  { campos: [{ nombre, descripcion?, tipo?: 'texto'|'lista', valores?: [...], regex?: '...', longitud?: n, caracteres?: 'alfanumerico'|'letras'|'numeros'|'cualquiera', obligatorio?: true }], conRevision: true }. */
/** Lo que le falta a UN campo del nombre para cumplir su definicion ('' si cumple). Pura; la usan valida() y la rejilla de carga. */
function errorCampo(def, v) {
  v = String(v == null ? '' : v);
  // Conformidad (Forma): un campo no obligatorio admite vacio o solo X (XXX); longitud fija; tipo de caracter
  if (def.obligatorio === false && (v === '' || /^X+$/i.test(v))) return '';
  if (def.longitud && v.length !== Number(def.longitud)) return 'Campo "' + def.nombre + '": "' + v + '" debe tener ' + def.longitud + ' caracteres.';
  const tc = def.caracteres || 'alfanumerico', rxTc = tc === 'letras' ? /^[A-Za-z]+$/ : tc === 'numeros' ? /^[0-9]+$/ : tc === 'cualquiera' ? /^[^-]+$/ : /^[A-Za-z0-9]+$/;
  if (Array.isArray(def.valores) && def.valores.length && !def.valores.includes(v)) return 'Campo "' + def.nombre + '": "' + v + '" no esta entre los admitidos (' + def.valores.slice(0, 12).join(', ') + (def.valores.length > 12 ? '...' : '') + ').';
  if (def.regex) { try { if (!new RegExp(def.regex).test(v)) return 'Campo "' + def.nombre + '": "' + v + '" no cumple el formato ' + def.regex + '.'; } catch (e) {} return ''; }
  if (!rxTc.test(v) || (!def.longitud && v.length > 40)) return 'Campo "' + def.nombre + '": "' + v + '" ' + (tc === 'letras' ? 'solo admite letras' : tc === 'numeros' ? 'solo admite numeros' : tc === 'cualquiera' ? 'no puede estar vacio' : 'solo admite letras y numeros') + '.';
  return '';
}
function valida(nombreArchivo, config) {
  const p = partes(nombreArchivo), errores = [], c = (config && config.nomenclatura) || null;
  if (!p.ext) errores.push('El archivo no tiene extension.');
  if (c && Array.isArray(c.campos) && c.campos.length) {
    if (p.campos.length !== c.campos.length) errores.push('Se esperaban ' + c.campos.length + ' campos separados por "-" (' + c.campos.map(x => x.nombre).join('-') + ') y hay ' + p.campos.length + '.');
    else c.campos.forEach((def, i) => { const e = errorCampo(def, p.campos[i]); if (e) errores.push(e); });
    if (c.conRevision !== false && !p.revision) errores.push('Falta el codigo de revision al final (P01, P02... o C01...).');
  } else {
    // regla por defecto: la del visor (6+ campos alfanumericos, el primero empieza con digito)
    if (!validaNombreVisor(p.base + (p.revision ? '-' + p.revision : '') + (p.ext ? '.' + p.ext : ''))) errores.push('El nombre no cumple la nomenclatura ISO 19650 del proyecto (al menos 6 campos alfanumericos separados por "-", el primero empieza con digito).');
  }
  const campos = {};
  if (c && Array.isArray(c.campos)) c.campos.forEach((def, i) => { campos[def.nombre] = p.campos[i] || ''; });
  return { ok: !errores.length, errores, base: p.base, revision: p.revision, extension: p.ext, campos };
}

/** Tipo de contenedor por extension (misma tabla que leTipoDe del visor, resumida). Pura. */
function tipoPorExtension(ext) {
  const e = String(ext || '').toLowerCase();
  if (/^(rvt|rfa|nwd|nwc|nwf|ifc|ifczip|cde)$/.test(e)) return 'modelo';
  if (/^(dwg|dgn|dxf|pdf)$/.test(e)) return 'plano';
  if (/^(docx|doc|xlsx|xlsm|xls|csv|pptx|txt|md|xer|mpp)$/.test(e)) return 'documento';
  return 'otro';
}

function puedeTransitar(de, a, rol) {
  const k = de + '>' + a, min = TRANSICIONES[k];
  if (!min) return { ok: false, motivo: 'De ' + de + ' no se pasa a ' + a + '.' };
  if (k === 'WIP>COMPARTIDO' && !COMPARTE.includes(rol)) return { ok: false, motivo: 'Pasar un documento de WIP a compartido corresponde a Document Control (o al gestor del proyecto).' };
  if ((RANGO_ROL[rol] || 0) < RANGO_ROL[min]) return { ok: false, motivo: 'Hace falta el rol ' + min + ' (tienes ' + rol + ').' };
  return { ok: true };
}

/** La revision siguiente: P01 -> P02; al publicar, P.. -> C01 (o C01 -> C02). Pura. */
function siguienteRevision(actual, estadoDestino) {
  const m = RX_REVISION.exec(String(actual || ''));
  const pub = estadoDestino === 'PUBLICADO';
  if (!m) return pub ? 'C01' : 'P01';
  const letra = m[1].toUpperCase(), n = parseInt(m[2], 10);
  if (pub) return letra === 'C' ? 'C' + String(n + 1).padStart(2, '0') : 'C01';
  return letra + String(n + 1).padStart(2, '0');
}

module.exports = { ROLES, familia, COMPARTE, puedeCrearCarpeta, ESTADOS, TRANSICIONES, RANGO_ROL, IDONEIDAD, RX_REVISION, partes, valida, errorCampo, tipoPorExtension, puedeTransitar, siguienteRevision, validaNombreVisor };
