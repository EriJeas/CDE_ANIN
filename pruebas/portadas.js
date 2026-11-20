/*
 * Portadas de prueba para la Validación QA (sin LibreOffice ni archivos pesados): un PDF con el texto de la plantilla ANIN
 * colocado como en la portada real, y un Word (.docx) con sus tablas y párrafos. Solo para las pruebas automáticas.
 */
'use strict';
const zlib = require('zlib');

const BASE = { contrato: 'CONTRATO: N° 027-2025-ANIN - EXPEDIENTE TÉCNICO HOSPITAL', region: 'REGIÓN: HUÁNUCO', rev: 'R00', emision: '22/01/2026', filas: [['R00', '22/01/2026']], sello: true, direccion: 'DIRECCIÓN DE ESTUDIOS Y OBRAS', titulo: 'INFORME DE PRUEBA', codigo: '' };

/** Líneas de la portada: [x, y, texto, tamaño]. */
function lineas(o) {
  const L = [];
  if (o.vacia) return L;
  L.push([150, 740, 'PRESIDENCIA DEL CONSEJO DE MINISTROS', 9], [440, 740, 'Revisión: ' + o.rev, 10], [150, 726, 'AUTORIDAD NACIONAL DE INFRAESTRUCTURA', 10]);
  L.push([150, 705, o.contrato, 9], [440, 705, 'Emisión: ' + o.emision, 10], [150, 684, o.region, 9], [440, 684, o.pagina || 'Página: 1 de 1', 10]);
  L.push([150, 520, o.titulo, 16], [150, o.proyecto ? 484 : 498, o.codigo, 12], [180, 460, o.direccion, 14]);
  if (o.proyecto) L.push([150, 504, o.proyecto, 11]);   // el «PROYECTO: …» que va bajo el título (no es el nombre del documento)
  if (o.sello) L.push([330, 430, 'REVISIÓN DE DOCUMENTOS TÉCNICOS', 9], [330, 416, 'A- ACEPTADO', 9], [330, 402, 'B- RECHAZADO', 9], [340, 380, 'FIRMA', 8], [450, 380, 'FECHA', 8]);
  [[60, 'REV N°'], [100, 'FECHA'], [200, 'DESCRIPCIÓN'], [340, 'ELAB. POR'], [410, 'REV. POR'], [480, 'APROB. POR']].forEach(([x, t]) => L.push([x, 330, t, 8]));
  o.filas.forEach(([r, f, e], i) => { const y = 312 - i * 16; L.push([60, y, r, 8], [100, y, f, 8], [200, y, 'Emitido para Revisión y Comentarios', 8], [340, y, e || 'S. Campoverde', 8], [410, y, 'M. Wong', 8], [480, y, 'D. Swai', 8]); });
  L.push([340, 250, 'CARGO:', 8], [340, 234, 'FIRMAS:', 8]);
  return L;
}

/** PDF de una página con el texto de la portada (Helvetica, WinAnsi). */
function pdf(op) {
  const o = Object.assign({}, BASE, op || {});
  const esc = (t) => Buffer.from(String(t), 'latin1').toString('latin1').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const flujo = lineas(o).map(([x, y, t, s]) => 'BT /F1 ' + s + ' Tf 1 0 0 1 ' + x + ' ' + y + ' Tm (' + esc(t) + ') Tj ET').join('\n');
  // o.selloImagen: el sello pegado como IMAGEN bajo el cajetín (como lo hacen muchos contratistas); { marco: false } = una imagen sin marco
  const img = o.selloImagen ? imagenSello(o.selloImagen.marco !== false) : null, dib = img ? '\nq 150 0 0 96 60 560 cm /Im1 Do Q' : '';
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >>' + (img ? ' /XObject << /Im1 6 0 R >>' : '') + ' >> >>',
    '<< /Length ' + Buffer.byteLength(flujo + dib, 'latin1') + ' >>\nstream\n' + flujo + dib + '\nendstream', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'];
  if (img) objs.push('<< /Type /XObject /Subtype /Image /Width 150 /Height 96 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ' + img.length + ' >>\nstream\n' + img.toString('latin1') + '\nendstream');
  let s = '%PDF-1.4\n', offs = [];
  objs.forEach((b, i) => { offs.push(Buffer.byteLength(s, 'latin1')); s += (i + 1) + ' 0 obj\n' + b + '\nendobj\n'; });
  const xref = Buffer.byteLength(s, 'latin1');
  s += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + offs.map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('') + 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  return Buffer.from(s, 'latin1');
}

/** Píxeles de un sello: fondo blanco, marco azul y algunas líneas de «texto». */
function imagenSello(marco) {
  const W = 150, H = 96, b = Buffer.alloc(W * H * 3, 255);
  const pinta = (x, y, r, g, bl) => { const o = (y * W + x) * 3; b[o] = r; b[o + 1] = g; b[o + 2] = bl; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (marco && (x < 3 || y < 3 || x >= W - 3 || y >= H - 3)) pinta(x, y, 31, 56, 100);
    else if ((y >= 30 && y < 34 && x > 20 && x < 130) || (y >= 46 && y < 49 && x > 30 && x < 90) || (y >= 58 && y < 61 && x > 30 && x < 95) || (y >= 82 && y < 83 && x > 10 && x < 140)) pinta(x, y, 40, 40, 60);
  }
  return b;
}
// ── Word (.docx) mínimo: ZIP sin compresión con [Content_Types].xml, _rels/.rels y word/document.xml ──
const X = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const P = (t) => '<w:p><w:r><w:t xml:space="preserve">' + X(t) + '</w:t></w:r></w:p>';
const TC = (t) => '<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>' + (Array.isArray(t) ? t.map(P).join('') : P(t)) + '</w:tc>';
const TR = (cs) => '<w:tr>' + cs.map(TC).join('') + '</w:tr>';
const TBL = (filas) => '<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/></w:tblPr>' + filas.map(TR).join('') + '</w:tbl>';
function documentoXml(o) {
  const cuerpo = TBL([[o.logo ? ['LOGO', 'CONTRATISTA'] : '', ['PRESIDENCIA DEL CONSEJO DE MINISTROS', '“AUTORIDAD NACIONAL DE INFRAESTRUCTURA”'], 'Revisión: ' + o.rev], [o.contrato, 'Emisión: ' + o.emision], [o.region, 'Página: 1 de 1']]) +
    P(o.titulo) + P(o.codigo) + P(o.direccion) +
    (o.sello ? TBL([[['REVISIÓN DE DOCUMENTOS TÉCNICOS', 'A- ACEPTADO', 'B- RECHAZADO', 'FIRMA        FECHA']]]) + '<w:p/>' : '') +
    TBL([['REV N°', 'FECHA', 'DESCRIPCIÓN', 'ELAB. POR', 'REV. POR', 'APROB. POR']].concat(o.filas.map(([r, f, e]) => [r, f, 'Emitido para Revisión y Comentarios', e || 'S. Campoverde', 'M. Wong', 'D. Swai'])).concat([['', '', 'CARGO:', '', '', ''], ['', '', 'FIRMAS:', '', '', '']])) +
    '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' + P('1. INTRODUCCIÓN') + P('Texto del documento después de la portada.');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + cuerpo + '</w:body></w:document>';
}
function zip(archivos) {
  const locales = [], central = []; let off = 0;
  for (const [nombre, texto] of archivos) {
    const datos = Buffer.from(texto, 'utf8'), n = Buffer.from(nombre, 'utf8'), crc = zlib.crc32(datos);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(datos.length, 18); lh.writeUInt32LE(datos.length, 22); lh.writeUInt16LE(n.length, 26);
    locales.push(lh, n, datos);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(datos.length, 20); ch.writeUInt32LE(datos.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(off, 42);
    central.push(ch, n); off += 30 + n.length + datos.length;
  }
  const cd = Buffer.concat(central), fin = Buffer.alloc(22); fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(archivos.length, 8); fin.writeUInt16LE(archivos.length, 10); fin.writeUInt32LE(cd.length, 12); fin.writeUInt32LE(off, 16);
  return Buffer.concat(locales.concat([cd, fin]));
}
function docx(op) {
  const o = Object.assign({}, BASE, op || {});
  return zip([['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
    ['word/document.xml', documentoXml(o)]]);
}

module.exports = { pdf, docx };
