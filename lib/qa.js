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
    const pos = L.map(l => ({ y: l.y, h: l.h, items: l.items.map(it => ({ s: it.s, x: it.x, y: it.y, w: it.w, h: it.h })) }));   // posiciones: columnas (ELAB. POR) y cajas de la QA gráfica
    const vw = pg.view || [0, 0, 612, 792];
    let imagenes = []; try { imagenes = await imagenesPdf(pg); } catch (e) { imagenes = []; }
    return { lineas, paginas: doc.numPages, pos, pagina: { x0: vw[0], y0: vw[1], w: vw[2] - vw[0], h: vw[3] - vw[1] }, imagenes };
  } finally { try { await doc.destroy(); } catch (e) {} }
}
/** Imágenes dibujadas en la página (posición y tamaño en puntos PDF): para hallar el sello cuando viene pegado como imagen. */
async function imagenesPdf(pg) {
  const O = pdfjs().OPS, ol = await pg.getOperatorList(), out = [], pila = []; let m = [1, 0, 0, 1, 0, 0];
  const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
  const IMG = new Set([O.paintImageXObject, O.paintInlineImageXObject, O.paintImageMaskXObject, O.paintImageXObjectRepeat, O.paintInlineImageXObjectGroup].filter(x => x !== undefined));
  for (let i = 0; i < ol.fnArray.length && out.length < 60; i++) {
    const f = ol.fnArray[i], a = ol.argsArray[i];
    if (f === O.save) pila.push(m.slice()); else if (f === O.restore) m = pila.pop() || [1, 0, 0, 1, 0, 0];
    else if (f === O.transform) m = mul(m, a);
    else if (f === O.paintFormXObjectBegin) { pila.push(m.slice()); if (a && a[0] && a[0].length === 6) m = mul(m, a[0]); } else if (f === O.paintFormXObjectEnd) m = pila.pop() || m;
    else if (IMG.has(f)) { const xs = [m[4], m[0] + m[4], m[2] + m[4], m[0] + m[2] + m[4]], ys = [m[5], m[1] + m[5], m[3] + m[5], m[1] + m[3] + m[5]]; const x = Math.min(...xs), y = Math.min(...ys), w = Math.max(...xs) - x, h = Math.max(...ys) - y; if (w > 8 && h > 8) out.push(Object.assign({ x, y, w, h }, w >= 60 && w <= 420 && f === O.paintImageXObject ? pixeles(pg, a && a[0]) : {})); }
  }
  return out;
}
/** ¿Cómo es la imagen? fracción de píxeles claros y si tiene marco (una línea oscura en al menos 3 de sus 4 bordes): así es un sello. */
function pixeles(pg, id) {
  try {
    const im = (String(id).startsWith('g_') ? pg.commonObjs : pg.objs).get(id); if (!im || !im.data || !im.width) return {};
    const W = im.width, H = im.height, ch = im.data.length / (W * H); if (ch < 1 || W * H > 4e6) return {};
    const lum = (x, y) => { const o = (y * W + x) * ch; return ch >= 3 ? 0.3 * im.data[o] + 0.59 * im.data[o + 1] + 0.11 * im.data[o + 2] : (im.kind === 1 ? 255 : im.data[o]); };
    let claros = 0, n = 0; for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) { n++; if (lum(x, y) > 200) claros++; }
    const banda = (horiz, desde, hasta) => { for (let k = desde; k !== hasta; k += desde < hasta ? 1 : -1) { let osc = 0, t = 0; const L = horiz ? W : H; for (let j = 0; j < L; j += 2) { t++; if ((horiz ? lum(j, k) : lum(k, j)) < 200) osc++; } if (osc / t >= 0.6) return true; } return false; };
    const bH = Math.max(2, Math.round(H * 0.06)), bW = Math.max(2, Math.round(W * 0.06));
    const lados = [banda(true, 0, bH), banda(true, H - 1, H - 1 - bH), banda(false, 0, bW), banda(false, W - 1, W - 1 - bW)].filter(Boolean).length;
    return { claros: claros / n, marco: lados >= 3 };
  } catch (e) { return {}; }
}
const desXml = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d)).replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCharCode(parseInt(h, 16)));
/** Líneas de la portada de un Word: párrafos, filas de tabla (celdas en orden) y cuadros de texto, hasta el primer salto de página. */
function lineasXmlWord(xml, filasTabla) {
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
    if (tag === 'w:tr') { if (!cierra) filas.push({ celdas: [], celda: null }); else { const f = filas.pop(); if (f) { const t = f.celdas.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim(); if (t) lineas.push(t); if (filasTabla) filasTabla.push(f.celdas.map(c => String(c || '').replace(/\s+/g, ' ').trim())); } } continue; }
    if (tag === 'w:tc') { const f = filas[filas.length - 1]; if (!f) continue; if (!cierra) f.celda = []; else { f.celdas.push((f.celda || []).join(' ')); f.celda = null; } continue; }
  }
  return lineas;
}
function lineasDocx(buf) {
  const ents = entradasZip(buf), lee = (n) => { const e = ents.find(z => z.nombre === n); const b = e && leeZip(buf, e); return b ? b.toString('utf8') : ''; };
  const doc = lee('word/document.xml'); if (!doc) return { lineas: [], paginas: 0 };
  const filasTabla = [];
  const cab = ents.filter(e => /^word\/header\d*\.xml$/.test(e.nombre)).sort((a, b) => a.nombre.localeCompare(b.nombre)).map(e => lineasXmlWord(lee(e.nombre), filasTabla)).flat();
  const todas = cab.concat(lineasXmlWord(doc, filasTabla)).filter((t, i, a) => i === 0 || t !== a[i - 1]);   // un cuadro de texto puede venir dos veces (versión nueva y la de compatibilidad)
  return { lineas: todas, paginas: 0, filasTabla };
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
const SELLO_RX = [/REVISI[OÓ]N\s+DE\s+DOCUMENTOS\s+T[EÉ]CNICOS/ig, /\b[A-C]\s*-\s*(ACEPTADO|RECHAZADO)\b/ig, /\bACEPTADO\b/ig, /\bRECHAZADO\b/ig, /\bFIRMA\b/ig, /\bFECHA\b/ig];
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
  // v0.24.1: el nombre es SOLO el título del recuadro (p. ej. «PLAN DE GESTIÓN DE DISEÑO»); el bloque «PROYECTO: …» que suele ir debajo
  // es el nombre del proyecto y no entra. Se arma por bloques de líneas: la línea del código o «PROYECTO:» cortan el bloque.
  const esCaj = (n) => /PRESIDENCIA DEL CONSEJO|^AUTORIDAD NACIONAL DE INFRAESTRUCTURA$|\bCONTRATO\s*:|\bREGION\s*:|\bREVISION\s*:|\bEMISION\s*:|\bPAGINA\s*:|\bLOGO\b|^CONTRATISTA$|NUMERO DE DOCUMENTO ACONEX|^TITULO DE DOCUMENTO$/.test(n);
  const esSello = (n) => /REVISION DE DOCUMENTOS TECNICOS|\b(ACEPTADO|RECHAZADO)\b|^(FIRMA|FECHA)(\s+(FIRMA|FECHA))?$/.test(n);
  const bloques = []; let blq = null;
  for (const x of zona) {
    if (esCaj(x.n) || esSello(x.n)) continue;
    const t = quita(x.t);
    if (!t) { blq = null; continue; }
    if (/^PROYECTO\s*:/.test(x.n)) { blq = { proyecto: true, t: [t], i: [x] }; bloques.push(blq); continue; }
    if (!blq) { blq = { proyecto: false, t: [], i: [] }; bloques.push(blq); }
    blq.t.push(t); blq.i.push(x);
  }
  const bT = bloques.filter(b => !b.proyecto && b.t.length);   // el título puede quedar partido por la línea del código
  datos._lineasTitulo = bT.flatMap(b => b.i.map(x => x.t));
  const tit = bT.map(b => b.t.join(' ')).join(' ').replace(/^(T[IÍ]TULO|NOMBRE)( DEL DOCUMENTO)?\s*:\s*/i, '').replace(/\s+/g, ' ').trim();
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
  datos._faltaSello = faltaS.length;
  pon('sello', 'Sello «Revisión de documentos técnicos» de ANIN', !faltaS.length, faltaS.length ? 'Falta el sello en la portada' + (faltaS.length < sello.length ? ' (falta: ' + faltaS.join(', ') + ')' : '') + ': A- Aceptado / B- Rechazado / Firma / Fecha.' : 'A- Aceptado · B- Rechazado · Firma · Fecha');
  return { ok: checks.every(c => c.ok), checks, datos };
}

/**
 * v0.24.1 · QA gráfica: cajas de cada comprobación sobre la portada del PDF, en puntos y con el origen ARRIBA a la izquierda de la página
 * (como la dibuja el navegador). { pagina:{w,h}, cajas:[{ id, x, y, w, h, esperada? }], selloImagen? }.
 * «esperada»: lo que falta, marcado donde la plantilla ANIN lo pone.
 */
function zonasPdf(pt, r) {
  if (!Array.isArray(pt.pos) || !pt.pagina) return null;
  const pg = pt.pagina, P = pt.pos, d = r.datos || {}, cajas = [];
  const aCaja = (its, pad) => { its = its.filter(Boolean); if (!its.length) return null; pad = pad == null ? 3 : pad; let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const it of its) { x0 = Math.min(x0, it.x); x1 = Math.max(x1, it.x + (it.w || 0)); y0 = Math.min(y0, it.y - (it.h || 8) * 0.28); y1 = Math.max(y1, it.y + (it.h || 8) * 0.95); } return { x: x0 - pg.x0 - pad, y: pg.y0 + pg.h - y1 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad }; };
  const texto = (l) => norm(l.items.map(i => i.s).join(' '));
  const lineas = (rx) => P.filter(l => rx.test(texto(l)));
  const de = (ls) => ls.flatMap(l => l.items);
  const pon = (id, c, extra) => { if (c) cajas.push(Object.assign({ id }, c, extra || {})); };
  // cajetín superior y sus datos
  const lCaj = lineas(/PRESIDENCIA DEL CONSEJO|AUTORIDAD NACIONAL DE INFRAESTRUCTURA|\bCONTRATO\s*:|\bREGION\s*:|\bREVISION\s*:|\bEMISION\s*:|\bPAGINA\s*:/);
  const yCaj = lCaj.length ? Math.min(...lCaj.map(l => l.y)) : null;
  const debajo = (l, rx) => P.filter(o => o !== l && o.y < l.y && l.y - o.y < 26 && o.items.some(i => rx.test(norm(i.s))));
  const conValor = (rxEt, rxIni, rxVal) => {   // la etiqueta y su valor (que pdf.js suele partir en varios textos, a la derecha o en la línea de abajo)
    const l = lineas(rxEt)[0]; if (!l) return [];
    const ini = l.items.find(i => rxIni.test(norm(i.s))); const x0 = ini ? ini.x - 2 : l.items[0].x;
    const mismos = l.items.filter(i => i.x >= x0 && i.x < x0 + 160);
    if (rxVal.test(norm(mismos.map(i => i.s).join('')))) return mismos;
    const abajo = P.filter(o => o !== l && o.y < l.y && l.y - o.y < 28).map(o => o.items.filter(i => i.x >= x0 - 25 && i.x < x0 + 160)).find(its => its.length && rxVal.test(norm(its.map(i => i.s).join(''))));
    return mismos.concat(abajo || []);
  };
  const itRev = conValor(/\bREVISION\s*:/, /^REVISI/, /R\s?\d{2}/), itEmi = conValor(/\bEMISION\s*:/, /^EMISI/, /\d{1,2}\s*[\/.-]\s*\d{1,2}\s*[\/.-]\s*\d{4}/);
  const lCajTodo = lCaj.concat(lCaj.flatMap(l => debajo(l, /./).filter(o => yCaj !== null && o.y >= yCaj - 26)));
  const cajCaj = aCaja(de(lCajTodo), 6);
  pon('cajetin', cajCaj);
  const lCon = lineas(/\bCONTRATO\s*:/), lReg = lineas(/\bREGION\s*:/);
  const contrato = lCon.length && lReg.length ? P.filter(l => l.y <= lCon[0].y && l.y >= lReg[0].y) : lCon.concat(lReg);
  pon('llenado', aCaja(de(contrato).filter(i => !/\b(REVISION|EMISION|PAGINA)\s*:|^\d{1,2}\s*[\/.-]|\bR\d{2}\b|\bDE\s+\d+$/.test(norm(i.s)))));
  const cRev = aCaja(itRev), cEmi = aCaja(itEmi);
  pon('revision', cRev); pon('emision', cEmi);
  // código, nombre y dirección
  const cods = [d.codigoPortada, d.codigo].filter(Boolean).map(c => String(c).replace(/\s+/g, ''));
  const lCod = P.filter(l => cods.some(c => texto(l).replace(/\s+/g, '').includes(norm(c))));
  pon('codigo', aCaja(de(lCod)));
  const tit = new Set((d._lineasTitulo || []).map(norm));
  const lTit = P.filter(l => tit.has(texto(l)) || l.items.some(i => tit.has(norm(i.s))));
  pon('titulo', aCaja(de(lTit)));
  pon('direccion', aCaja(de(lineas(/^DIRECCION\s+(DE|GENERAL)\b/))));
  // cuadro de revisiones (de los títulos a la última fila)
  const lCab = lineas(/\bREV\.?\s*N/).filter(l => /\bFECHA\b/.test(texto(l)))[0];
  if (lCab) {
    const filas = P.filter(l => l.y < lCab.y && /^R\s?\d{2}\b/.test(norm((l.items.slice().sort((a, b) => a.x - b.x)[0] || {}).s || '')));
    pon('cuadro', aCaja(de([lCab].concat(filas)), 5));
    const uf = filas.length ? filas[filas.length - 1] : null, cUf = uf ? aCaja(de([uf])) : null;
    pon('coincide', cUf); pon('coincide', cRev); pon('coincide', cEmi);
  }
  pon('correlativa', cRev);
  // sello: por su texto; si no, una imagen con forma de sello bajo el cajetín; si no, donde debería ir
  const lSello = lineas(/REVISION DE DOCUMENTOS TECNICOS|\b(ACEPTADO|RECHAZADO)\b|^(FIRMA|FECHA)(\s+(FIRMA|FECHA))?$/);
  const zona = (() => {   // donde va el sello en la plantilla: bajo el cajetín, a la izquierda, antes del nombre del documento
    const top = cajCaj ? cajCaj.y + cajCaj.h + 4 : pg.h * 0.2, cT = aCaja(de(lTit.length ? lTit : lCod)), bot = cT ? cT.y - 4 : top + 170;
    const x = cajCaj ? cajCaj.x : pg.w * 0.12, w = cajCaj ? Math.max(170, cajCaj.w * 0.32) : 200;
    return { x, y: top, w, h: Math.max(90, Math.min(220, bot - top)) };
  })();
  let selloImagen = null;
  if (!(d._faltaSello < 4) && Array.isArray(pt.imagenes)) {
    for (const im of pt.imagenes) {
      const c = { x: im.x - pg.x0, y: pg.y0 + pg.h - (im.y + im.h), w: im.w, h: im.h }, ar = im.w / im.h;
      const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
      if (ar >= 1.15 && ar <= 2.3 && im.w >= 90 && im.w <= 340 && im.claros >= 0.6 && im.marco && cx < pg.w * 0.5 && cy > zona.y - 30 && cy < zona.y + zona.h + 40 && (!cajCaj || c.y >= cajCaj.y + cajCaj.h - 6)) { selloImagen = c; break; }
    }
  }
  if (d._faltaSello < 4 && lSello.length) pon('sello', aCaja(de(lSello), 6));
  else if (selloImagen) pon('sello', selloImagen);
  else pon('sello', zona, { esperada: true });
  return { pagina: { w: pg.w, h: pg.h }, cajas, selloImagen: !!selloImagen };
}

/**
 * v0.25.0 · «ELAB. POR» de la fila del cuadro de revisiones que corresponde a la revisión de la portada (la última fila si no se
 * distingue): quien elaboró el documento y, por eso, quien debe firmarlo digitalmente. En el PDF se lee por columnas (posición de
 * cada texto respecto a los títulos del cuadro); en el Word, por la celda de la misma columna que «ELAB. POR».
 */
function elabPorDe(pt, fila) {
  const esFila = (t) => /^R\s?(\d{2})\b/.exec(norm(t));
  const pick = (cands) => { if (!cands.length) return ''; const m = fila && cands.find(c => c.rev === fila.rev); return ((m || cands[cands.length - 1]).t || '').replace(/\s+/g, ' ').trim(); };
  if (Array.isArray(pt.filasTabla) && pt.filasTabla.length) {   // Word
    const iCab = pt.filasTabla.findIndex(f => f.some(c => /^ELAB\b/.test(norm(c))));
    if (iCab < 0) return '';
    const j = pt.filasTabla[iCab].findIndex(c => /^ELAB\b/.test(norm(c))), cands = [];
    for (const f of pt.filasTabla.slice(iCab + 1)) { const m = esFila(f[0] || ''); if (m && f[j] != null) cands.push({ rev: 'R' + m[1], t: f[j] }); }
    return pick(cands);
  }
  if (!Array.isArray(pt.pos) || !pt.pos.length) return '';   // PDF
  const P = pt.pos, cen = (it) => it.x + (it.w || 0) / 2;
  const iE = P.findIndex(l => l.items.some(it => /^ELAB\b/.test(norm(it.s))));
  if (iE < 0) return '';
  const yE = P[iE].y, cerca = P.filter(l => Math.abs(l.y - yE) <= Math.max(12, (P[iE].h || 8) * 1.8)), cols = [];
  const etiquetas = [['rev', /^REV\.?\s*N/], ['fecha', /^FECHA\b/], ['desc', /^DESCRIPCION\b/], ['elab', /^ELAB\b/], ['revpor', /^REV\.?(\s*POR)?$/], ['aprob', /^APROB\b/], ['cargo', /^CARGO\b/], ['firmas', /^FIRMAS?\b/]];
  for (const l of cerca) for (const it of l.items) { const n = norm(it.s); const e = etiquetas.find(([, rx]) => rx.test(n)); if (e && !cols.some(c => c.id === e[0])) cols.push({ id: e[0], c: cen(it) }); }
  if (!cols.some(c => c.id === 'elab')) return '';
  // los textos de una celda se juntan en segmentos (p. ej. «Enzo» + «Martijena»); cada nombre va a la fila más cercana en altura
  // (en muchas portadas el nombre queda arriba en su celda y no a la altura del «R00» de la fila)
  const segmentos = (its) => { const o = its.slice().sort((a, b) => a.x - b.x), out = []; for (const it of o) { const u = out[out.length - 1]; if (u && it.x - (u.x + u.w) < Math.max(2.5, (it.h || 8) * 0.55)) { u.s += ' ' + it.s; u.w = it.x + (it.w || 0) - u.x; } else out.push({ s: it.s, x: it.x, w: it.w || 0, h: it.h }); } return out; };
  const cands = [], enElab = [];
  for (const l of P.filter(l => l.y < yE - 3).sort((a, b) => b.y - a.y)) {
    const t = l.items.map(it => it.s).join(' '); if (/^(CARGO|FIRMAS?)\b/.test(norm(t))) break;
    const sg = segmentos(l.items), m = sg[0] && esFila(sg[0].s);
    if (m) cands.push({ rev: 'R' + m[1], y: l.y, t: '' });
    for (const g of sg) { const c = g.x + g.w / 2; let mejor = null; for (const k of cols) if (!mejor || Math.abs(k.c - c) < Math.abs(mejor.c - c)) mejor = k; if (mejor && mejor.id === 'elab' && !esFila(g.s)) enElab.push({ y: l.y, s: g.s }); }
  }
  for (const e of enElab) { let f = null; for (const c of cands) if (!f || Math.abs(c.y - e.y) < Math.abs(f.y - e.y)) f = c; if (f && Math.abs(f.y - e.y) < 24) f.t += ' ' + e.s; }
  return pick(cands);
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
    try { r.datos.elabPor = elabPorDe(pt, r.datos.ultimaFila); } catch (e) { r.datos.elabPor = ''; }   // quien firma (v0.25.0)
    try { r.zonas = zonasPdf(pt, r); } catch (e) { r.zonas = null; }   // v0.24.1: QA gráfica (cajas sobre la portada)
    if (r.zonas && r.zonas.selloImagen) { const c = r.checks.find(x => x.id === 'sello'); if (c && !c.ok) { c.ok = true; c.detalle = 'Sello pegado como imagen bajo el cajetín (se reconoce por su ubicación, forma y marco).'; r.ok = r.checks.every(x => x.ok); } }
    delete r.datos._lineasTitulo; delete r.datos._faltaSello;
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

module.exports = { aplica, validaArchivo, validaLineas, leePortada, revisionEsperada, norm, elabPorDe };
