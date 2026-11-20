/*
 * VALIDACIÓN QA DE PORTADAS (documentos PDF y Word que entran al compartido).
 *
 * Lee la PRIMERA PÁGINA del documento y comprueba que su portada tenga el formato de la plantilla ANIN para contratistas
 * («PLANTILLA CONTRATISTAS 2026 ANIN») y el sello «Revisión de documentos técnicos» («CUADRO DE REVISIÓN ANIN»):
 *   1. Cajetín superior: Presidencia del Consejo de Ministros · «Autoridad Nacional de Infraestructura» · Contrato · Región ·
 *      Revisión · Emisión · Página.
 *   2. Cajetín llenado: contrato y región con su dato (no el texto de la plantilla) y el logo del contratista en vez del texto «LOGO CONTRATISTA».
 *   3. Revisión del cajetín (R00, R01…) y 4. fecha de emisión.
 *   5. Código de la portada = código del documento (su nombre en el CDE).
 *   6. Nombre del documento en la portada: es la descripción del documento en el CDE.
 *   7. Dirección («DIRECCIÓN DE ESTUDIOS Y OBRAS» o la del proyecto).
 *   8. Cuadro de revisiones (REV N° · FECHA · DESCRIPCIÓN · ELAB. POR · REV. POR · APROB. POR · CARGO · FIRMAS) con al menos una fila.
 *   9. Revisión y emisión del cajetín = REV N° y FECHA de la última fila del cuadro.
 *  10. La revisión es la que corresponde en el CDE: R00 la primera vez que el documento entra al compartido; luego R01, R02…
 *  11. Sello «REVISIÓN DE DOCUMENTOS TÉCNICOS» (A- Aceptado / B- Rechazado / Firma / Fecha).
 *
 * PDF: pdf.js (el mismo del visor de marcas, cargado en Node). Word (.docx): su XML, hasta el primer salto de página, con las tablas
 * fila por fila y los cuadros de texto. Se aplica a documentos PDF y Word; los planos (tipo PLA) tendrán su propia validación con el
 * membrete de planos, y los demás archivos (modelos, hojas de cálculo, imágenes…) no llevan portada.
 */
'use strict';
const fs = require('fs'), path = require('path');
const { entradasZip, leeZip } = require('./resumen');

const TOPE = 250 * 1024 * 1024;
const PLANOS = new Set(['PLA', 'DR']);   // planos: PLA (DOCPG002 ANIN) y DR (ISO 19650): tendrán su propia QA con el membrete de planos
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[“”"«»]/g, '').replace(/[ \s]+/g, ' ').trim();
const fecha = (d, m, a) => String(+d).padStart(2, '0') + '/' + String(+m).padStart(2, '0') + '/' + a;
const RX_FECHA = /(\d{1,2})\s*[\/.-]\s*(\d{1,2})\s*[\/.-]\s*(\d{4})/;

/** ¿Este archivo pasa por la Validación QA de portada? tipoDoc: el campo «Tipo de documento» de su nombre (PLA, INF, MDE…). */
function aplica(nombre, tipoDoc) {
  const ext = (String(nombre || '').split('.').pop() || '').toLowerCase();
  if (!['pdf', 'docx', 'docm', 'doc'].includes(ext)) return { aplica: false, motivo: 'La Validación QA de portada es para documentos PDF y Word.' };
  let t = String(tipoDoc || '').toUpperCase();
  if (!t) { const ps = String(nombre).replace(/\.[^.]+$/, '').split('-'); if (ps.length >= 7 && /^[A-Z][A-Z0-9]{1,2}$/i.test(ps[4])) t = ps[4].toUpperCase(); }
  if (PLANOS.has(t)) return { aplica: false, motivo: 'Plano: su Validación QA será con el membrete de planos (pendiente de configurar).' };
  return { aplica: true, tipoDoc: t };
}

// ───────── lectura de la primera página ─────────
let PDFJS = null;
function pdfjs() {
  if (!PDFJS) { for (const k of ['DOMMatrix', 'Path2D', 'ImageData']) if (!globalThis[k]) globalThis[k] = class {}; PDFJS = require('../public/vendor/pdf.min.js'); PDFJS.GlobalWorkerOptions.workerSrc = path.resolve(__dirname, '../public/vendor/pdf.worker.min.js'); }
  return PDFJS;
}
/** Líneas de texto de la página 1 de un PDF, de arriba abajo (los textos a la misma altura forman una línea, de izquierda a derecha). */
async function lineasPdf(buf) {
  const doc = await pdfjs().getDocument({ data: new Uint8Array(buf), isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise;
  try {
    const pg = await doc.getPage(1), tc = await pg.getTextContent();
    const its = tc.items.filter(it => it.str && it.str.trim()).map(it => ({ s: it.str, x: it.transform[4], y: it.transform[5], w: it.width || 0, h: Math.abs(it.transform[3]) || it.height || 10 }));
    its.sort((a, b) => b.y - a.y || a.x - b.x);
    const L = [];
    for (const it of its) { const l = L.find(x => Math.abs(x.y - it.y) <= Math.max(1.5, Math.min(x.h, it.h) * 0.45)); if (l) l.items.push(it); else L.push({ y: it.y, h: it.h, items: [it] }); }
    L.sort((a, b) => b.y - a.y);
    const lineas = L.map(l => { l.items.sort((a, b) => a.x - b.x); let t = '', fin = null; for (const it of l.items) { if (fin !== null && it.x - fin > Math.max(1, it.h * 0.18) && !/\s$/.test(t)) t += ' '; t += it.s; fin = it.x + it.w; } return t.replace(/\s+/g, ' ').trim(); }).filter(Boolean);
    return { lineas, paginas: doc.numPages };
  } finally { try { await doc.destroy(); } catch (e) {} }
}
const desXml = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d)).replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCharCode(parseInt(h, 16)));
/** Líneas de la portada de un Word: párrafos, filas de tabla (celdas en orden) y cuadros de texto, hasta el primer salto de página. */
function lineasXmlWord(xml) {
  let x = xml.replace(/<mc:Fallback\b[^>]*>[\s\S]*?<\/mc:Fallback>/g, '');   // los cuadros de texto vienen dos veces (Choice + Fallback)
  const cortes = [/<w:br\b[^>]*w:type="page"[^>]*\/>/, /<w:lastRenderedPageBreak\/>/, /<w:pageBreakBefore(?:\s[^>]*)?\/>/].map(rx => { const m = rx.exec(x); return m ? m.index : -1; }).filter(i => i > 400);
  const sp = /<w:pPr>(?:(?!<\/w:pPr>)[\s\S])*?<w:sectPr\b/.exec(x); if (sp && sp.index > 400) cortes.push(sp.index);
  if (cortes.length) x = x.slice(0, Math.min(...cortes));
  const lineas = [], pila = [], filas = [];
  const rx = /<(\/?)(w:p|w:tr|w:tc|w:tbl)(?=[\s>\/])[^>]*?(\/?)>|<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:(tab|br|cr)\b[^>]*\/>/g; let m;
  while ((m = rx.exec(x))) {
    if (m[4] !== undefined) { if (pila.length) pila[pila.length - 1].t += desXml(m[4]); continue; }
    if (m[5]) { if (pila.length) pila[pila.length - 1].t += ' '; continue; }
    const cierra = m[1] === '/', tag = m[2], solo = m[3] === '/';
    if (tag === 'w:p') { if (solo) continue; if (!cierra) pila.push({ t: '' }); else { const p = pila.pop(); if (!p) continue; const t = p.t.replace(/\s+/g, ' ').trim(); if (!t) continue; const f = filas[filas.length - 1]; if (f && f.celda) f.celda.push(t); else lineas.push(t); } continue; }
    if (tag === 'w:tr') { if (!cierra) filas.push({ celdas: [], celda: null }); else { const f = filas.pop(); if (f) { const t = f.celdas.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim(); if (t) lineas.push(t); } } continue; }
    if (tag === 'w:tc') { const f = filas[filas.length - 1]; if (!f) continue; if (!cierra) f.celda = []; else { f.celdas.push((f.celda || []).join(' ')); f.celda = null; } continue; }
  }
  return lineas;
}
function lineasDocx(buf) {
  const ents = entradasZip(buf), lee = (n) => { const e = ents.find(z => z.nombre === n); const b = e && leeZip(buf, e); return b ? b.toString('utf8') : ''; };
  const doc = lee('word/document.xml'); if (!doc) return { lineas: [], paginas: 0 };
  const cab = ents.filter(e => /^word\/header\d*\.xml$/.test(e.nombre)).sort((a, b) => a.nombre.localeCompare(b.nombre)).map(e => lineasXmlWord(lee(e.nombre))).flat();
  const todas = cab.concat(lineasXmlWord(doc)).filter((t, i, a) => i === 0 || t !== a[i - 1]);   // un cuadro de texto puede venir dos veces (versión nueva y la de compatibilidad)
  return { lineas: todas, paginas: 0 };
}
/** Lee la portada (página 1) de un PDF o un Word. */
async function leePortada(buf, nombre) {
  const ext = (String(nombre || '').split('.').pop() || '').toLowerCase();
  if (ext === 'pdf') return Object.assign({ tipo: 'pdf' }, await lineasPdf(buf));
  if (ext === 'docx' || ext === 'docm') return Object.assign({ tipo: 'word' }, lineasDocx(buf));
  return { tipo: ext, lineas: [], paginas: 0, sinLector: true };
}

// ───────── comprobaciones ─────────
const CODIGO_RX = /\b[A-Z0-9]{2,10}(?:\s?-\s?[A-Z0-9]{1,10}){4,10}\b/g;
const FIRMA_RX = [/Firmado digitalmente por:?[^\n]*/ig, /\bMotivo:\s*[^\n]*/ig, /\bFecha:\s*\d[^\n]*/ig, /Soy el autor del documento/ig, /Doy V[°º]\s*B[°º]/ig];   // sello visible de ReFirma / Firma Perú
const SELLO_RX = [/REVISI[OÓ]N\s+DE\s+DOCUMENTOS\s+T[EÉ]CNICOS/ig, /\b[AB]\s*-\s*(ACEPTADO|RECHAZADO)\b/ig, /\bACEPTADO\b/ig, /\bRECHAZADO\b/ig, /\bFIRMA\b/ig, /\bFECHA\b/ig];
/**
 * Valida la portada. ctx: { codigo (el del documento; null = aún no tiene nombre conforme), esperada (R00, R01…), direccion (nombre),
 * conformeCon(codigo) → true si ese código sirve como nombre en la carpeta de destino }.
 */
function validaLineas(lineas, ctx) {
  const L = lineas.map(t => ({ t, n: norm(t) })), todo = L.map(x => x.n).join(' \n '), checks = [], datos = { esperada: ctx.esperada || '', codigo: ctx.codigo || '' };
  const pon = (id, titulo, ok, detalle) => checks.push({ id, titulo, ok: !!ok, detalle: detalle || '' });
  if (!L.length) { pon('lectura', 'Lectura de la portada', false, 'No se encontró texto en la primera página (¿PDF escaneado o imagen?). Exporta el documento desde Word a PDF para que su texto se pueda leer.'); return { ok: false, checks, datos }; }
  const idx = (f, desde) => { for (let i = desde || 0; i < L.length; i++) if (f(L[i].n)) return i; return -1; };
  const iPag = idx(n => /\bPAGINA\s*:?\s*\d+\s*(DE|\/)\s*\d+/.test(n)), iReg = idx(n => /\bREGION\s*:/.test(n));
  const iCab = idx(n => /\bREV\.?\s*N/.test(n) && /\bFECHA\b/.test(n) && /DESCRIPCION/.test(n));
  const iDir = idx(n => /^DIRECCION DE\b/.test(n) || /^DIRECCION\s+(DE|GENERAL)\b/.test(n));
  // 1. cajetín superior
  const piezas = [['PRESIDENCIA DEL CONSEJO DE MINISTROS', /PRESIDENCIA DEL CONSEJO DE MINISTROS/], ['«AUTORIDAD NACIONAL DE INFRAESTRUCTURA»', /AUTORIDAD NACIONAL DE INFRAESTRUCTURA/], ['CONTRATO:', /\bCONTRATO\s*:/], ['REGIÓN:', /\bREGION\s*:/], ['Revisión:', /\bREVISION\s*:/], ['Emisión:', /\bEMISION\s*:/], ['Página:', /\bPAGINA\s*:/]];
  const faltan = piezas.filter(([, r]) => !r.test(todo)).map(([t]) => t);
  pon('cajetin', 'Cajetín superior de la plantilla ANIN', !faltan.length, faltan.length ? 'Falta: ' + faltan.join(', ') + '.' : 'Presidencia del Consejo de Ministros, Autoridad Nacional de Infraestructura, Contrato, Región, Revisión, Emisión y Página.');
  // 2. cajetín llenado
  const contrato = ((/\bCONTRATO\s*:\s*(.{0,160}?)(?=\s+EMISION\b|\s+REGION\b|\s+PAGINA\b|\s+REVISION\b|\s\n|$)/.exec(todo) || [])[1] || '').trim();
  const region = ((/\bREGION\s*:\s*(.{0,100}?)(?=\s+PAGINA\b|\s+EMISION\b|\s+REVISION\b|\s\n|$)/.exec(todo) || [])[1] || '').trim();
  datos.contrato = contrato; datos.region = region;
  const malLl = [];
  if (!contrato || contrato.length < 3 || /^NOMBRE DEL CONTRATO$/.test(contrato)) malLl.push('el nombre del contrato');
  if (!region || region.length < 3 || /^NOMBRE DE LA REGION$/.test(region)) malLl.push('la región');
  if (/\bLOGO\s+CONTRATISTA\b/.test(todo) || (/(^|\n )LOGO\b/.test(todo) && /(^|\n )CONTRATISTA\b/.test(todo))) malLl.push('el logo del contratista (aún dice «LOGO CONTRATISTA»)');
  pon('llenado', 'Cajetín llenado (contrato, región y logo del contratista)', !malLl.length, malLl.length ? 'Completa ' + malLl.join(', ') + '.' : 'Contrato: ' + contrato + ' · Región: ' + region);
  // 3. y 4. revisión y emisión del cajetín
  const mr = /\bREVISION\s*:\s*(R)\s?(\d{2})\b/.exec(todo) || /\bREVISION\s*:?\s*(R)\s?(\d{2})\b/.exec(todo);
  datos.revision = mr ? 'R' + mr[2] : '';
  pon('revision', 'Revisión en el cajetín', !!mr, mr ? datos.revision : 'No se encontró «Revisión: R00» (formato R00, R01…).');
  const me = /\bEMISION\s*:?[\s\S]{0,90}?(\d{1,2})\s*[\/.-]\s*(\d{1,2})\s*[\/.-]\s*(\d{4})/.exec(todo);
  datos.emision = me ? fecha(me[1], me[2], me[3]) : '';
  pon('emision', 'Fecha de emisión en el cajetín', !!me, me ? datos.emision : 'No se encontró «Emisión: dd/mm/aaaa».');
  // 5. código
  const sinEsp = todo.replace(/\s+/g, ''), desde = Math.max(iPag, iReg), hasta = iDir > desde ? iDir : (iCab > desde ? iCab : L.length);
  const zona = L.slice(desde + 1, hasta), cods = [], zonaN = (zona.length ? zona : L).map(x => x.n).join(' ');
  for (const k of zonaN.matchAll(CODIGO_RX)) { const c = k[0].replace(/\s+/g, ''); if (!RX_FECHA.test(c)) cods.push(c); }
  const esperado = String(ctx.codigo || '').toUpperCase().replace(/\s+/g, '');
  datos.codigoPortada = (esperado && cods.find(c => c === esperado)) || cods[0] || '';
  const plantillaCod = /NUMERO DE DOCUMENTO ACONEX/.test(todo);
  if (esperado) {
    const okC = sinEsp.includes(esperado) && !plantillaCod;
    pon('codigo', 'Código del documento en la portada', okC, okC ? esperado : plantillaCod ? 'La portada aún dice «NÚMERO DE DOCUMENTO ACONEX»: escribe el código del documento.' : 'La portada no tiene el código del documento (' + esperado + ')' + (datos.codigoPortada ? '; tiene ' + datos.codigoPortada : '') + '.');
  } else {
    const okC = !!datos.codigoPortada && !plantillaCod && (!ctx.conformeCon || ctx.conformeCon(datos.codigoPortada));
    pon('codigo', 'Código del documento en la portada', okC, okC ? datos.codigoPortada + ' (será el nombre del documento en el compartido)' : plantillaCod ? 'La portada aún dice «NÚMERO DE DOCUMENTO ACONEX»: escribe el código del documento.' : datos.codigoPortada ? 'El código de la portada (' + datos.codigoPortada + ') no cumple la norma de nomenclatura de la carpeta de destino.' : 'No se encontró el código del documento en la portada.');
  }
  // 6. nombre del documento (la descripción)
  const quita = (t) => { let s = String(t); for (const c of [ctx.codigo, datos.codigoPortada].filter(Boolean)) { const rx = new RegExp(String(c).split('').map(ch => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*'), 'ig'); s = s.replace(rx, ' '); } for (const r of SELLO_RX.concat(FIRMA_RX)) s = s.replace(r, ' '); return s.replace(/\s+/g, ' ').replace(/^[\s:–—-]+|[\s:–—-]+$/g, '').trim(); };
  const tit = quita(zona.filter(x => !/PRESIDENCIA DEL CONSEJO|^AUTORIDAD NACIONAL DE INFRAESTRUCTURA$|\bCONTRATO\s*:|\bREGION\s*:|\bREVISION\s*:|\bEMISION\s*:|\bPAGINA\s*:|\bLOGO\b|^CONTRATISTA$|NUMERO DE DOCUMENTO ACONEX|^TITULO DE DOCUMENTO$/.test(x.n)).map(x => x.t).join(' ')).replace(/^(T[IÍ]TULO|NOMBRE)( DEL DOCUMENTO)?\s*:\s*/i, '').replace(/\s+/g, ' ').trim();
  const plantillaTit = /(^|\n )TITULO DE DOCUMENTO( \n|$)/.test(todo);
  datos.titulo = tit.slice(0, 300);
  pon('titulo', 'Nombre del documento en la portada', tit.length >= 4 && !plantillaTit, tit.length >= 4 && !plantillaTit ? '«' + datos.titulo + '» (será la descripción del documento)' : plantillaTit ? 'La portada aún dice «TÍTULO DE DOCUMENTO»: escribe el nombre del documento.' : 'No se encontró el nombre del documento junto a su código.');
  // 7. dirección
  const dirEsp = norm(ctx.direccion || 'Dirección de Estudios y Obras'), lDir = iDir >= 0 ? L[iDir].n : '';
  const okDir = iDir >= 0 && (lDir.includes(dirEsp) || dirEsp.includes(lDir));
  pon('direccion', 'Dirección', okDir, okDir ? L[iDir].t : iDir >= 0 ? 'La portada dice «' + L[iDir].t + '»; corresponde «' + (ctx.direccion || 'DIRECCIÓN DE ESTUDIOS Y OBRAS') + '».' : 'Falta la línea «' + (ctx.direccion || 'DIRECCIÓN DE ESTUDIOS Y OBRAS').toUpperCase() + '».');
  // 8. cuadro de revisiones
  const cols = [['REV N°', /\bREV\.?\s*N/], ['FECHA', /\bFECHA\b/], ['DESCRIPCIÓN', /DESCRIPCION/], ['ELAB. POR', /ELAB\.?\s*POR/], ['REV. POR', /\bREV\.\s*POR|\bREV\s+POR/], ['APROB. POR', /APROB\.?\s*POR/], ['CARGO', /\bCARGO\b/], ['FIRMAS', /\bFIRMAS\b/]];
  const zCuadro = iCab >= 0 ? L.slice(iCab).map(x => x.n).join(' \n ') : todo, faltaC = cols.filter(([, r]) => !r.test(zCuadro)).map(([t]) => t);
  const filas = [];
  for (let i = iCab >= 0 ? iCab + 1 : 0; i < L.length; i++) { const n = L[i].n; if (/^CARGO\b/.test(n)) break; const f = /^(R)\s?(\d{2})\b[\s\S]*?(\d{1,2})\s*[\/.-]\s*(\d{1,2})\s*[\/.-]\s*(\d{4})/.exec(n); if (f) filas.push({ rev: 'R' + f[2], fecha: fecha(f[3], f[4], f[5]) }); }
  datos.filas = filas; datos.ultimaFila = filas[filas.length - 1] || null;
  pon('cuadro', 'Cuadro de revisiones', !faltaC.length && filas.length > 0, faltaC.length ? 'Falta en el cuadro: ' + faltaC.join(', ') + '.' : !filas.length ? 'El cuadro no tiene ninguna fila con REV N° (R00…) y FECHA.' : filas.length + ' fila(s): ' + filas.map(f => f.rev + ' ' + f.fecha).join(' · '));
  // 9. cajetín = última fila del cuadro
  const uf = datos.ultimaFila, coRev = uf && datos.revision && uf.rev === datos.revision, coFec = uf && datos.emision && uf.fecha === datos.emision;
  pon('coincide', 'Revisión y emisión iguales a la última fila del cuadro', coRev && coFec, !uf ? 'Sin filas en el cuadro de revisiones para comparar.' : (coRev ? '' : 'Revisión del cajetín ' + (datos.revision || '—') + ' ≠ REV N° ' + uf.rev + '. ') + (coFec ? '' : 'Emisión ' + (datos.emision || '—') + ' ≠ FECHA ' + uf.fecha + '.') || (uf.rev + ' · ' + uf.fecha));
  // 10. revisión que corresponde en el CDE
  if (ctx.esperada) {
    const okE = datos.revision === ctx.esperada;
    pon('correlativa', 'Revisión que corresponde en el CDE', okE, okE ? ctx.esperada + (ctx.esperada === 'R00' ? ' (primera vez en el compartido)' : '') : 'Corresponde ' + ctx.esperada + (ctx.esperada === 'R00' ? ' porque es la primera vez que el documento entra al compartido' : ' (la siguiente a la última revisión del documento en el CDE)') + '; la portada dice ' + (datos.revision || '—') + '.');
  }
  // 11. sello «Revisión de documentos técnicos»
  const sello = [['REVISIÓN DE DOCUMENTOS TÉCNICOS', /REVISION DE DOCUMENTOS TECNICOS/], ['ACEPTADO', /\bACEPTADO\b/], ['RECHAZADO', /\bRECHAZADO\b/], ['FIRMA', /\bFIRMA\b/]], faltaS = sello.filter(([, r]) => !r.test(todo)).map(([t]) => t);
  pon('sello', 'Sello «Revisión de documentos técnicos» de ANIN', !faltaS.length, faltaS.length ? 'Falta el sello en la portada' + (faltaS.length < sello.length ? ' (falta: ' + faltaS.join(', ') + ')' : '') + ': A- Aceptado / B- Rechazado / Firma / Fecha.' : 'A- Aceptado · B- Rechazado · Firma · Fecha');
  return { ok: checks.every(c => c.ok), checks, datos };
}

/** Valida la portada de un archivo (ruta en disco o Buffer). Devuelve { ok, aplica, archivo, tipo, checks, datos }. */
async function validaArchivo(origen, nombre, ctx) {
  const base = { aplica: true, archivo: nombre, fecha: new Date().toISOString() };
  let buf = origen;
  try {
    if (typeof origen === 'string') { const st = fs.statSync(origen); if (st.size > TOPE) return Object.assign(base, { ok: false, checks: [{ id: 'lectura', titulo: 'Lectura de la portada', ok: false, detalle: 'El archivo supera los 250 MB: divídelo o reduce su tamaño para validarlo.' }], datos: {} }); buf = fs.readFileSync(origen); }
    const pt = await leePortada(buf, nombre);
    if (pt.sinLector) return Object.assign(base, { ok: false, tipo: pt.tipo, checks: [{ id: 'lectura', titulo: 'Lectura de la portada', ok: false, detalle: 'El formato .' + pt.tipo + ' no se puede leer: guarda el documento como .docx o PDF.' }], datos: {} });
    const r = validaLineas(pt.lineas, ctx || {});
    return Object.assign(base, { tipo: pt.tipo, paginas: pt.paginas, lineas: pt.lineas.length }, r);
  } catch (e) {
    return Object.assign(base, { ok: false, checks: [{ id: 'lectura', titulo: 'Lectura de la portada', ok: false, detalle: 'No se pudo leer el documento (' + String(e.message || e).slice(0, 160) + '). Si está protegido o dañado, vuelve a exportarlo.' }], datos: {} });
  }
}

/** Revisión que corresponde: la siguiente a la mayor R## del documento; si no tiene ninguna, R00 al entrar por primera vez
 *  (o, en un documento que ya estaba en el compartido con otra numeración, el número de entregas que ya tiene). */
function revisionEsperada(revisiones, primeraEntrada) {
  let max = -1; for (const r of revisiones || []) { const m = /^R(\d{2})$/i.exec(String(r || '')); if (m) max = Math.max(max, +m[1]); }
  if (max >= 0) return 'R' + String(max + 1).padStart(2, '0');
  return 'R' + String(primeraEntrada ? 0 : (revisiones || []).length).padStart(2, '0');
}

module.exports = { aplica, validaArchivo, validaLineas, leePortada, revisionEsperada, norm };
