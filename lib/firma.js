/*
 * Firma digital de PDF (v0.25.0) — verificación en el servidor, sin librerías externas.
 *
 * Lee las firmas PAdES / PKCS#7 de un PDF (las que ponen ReFirma PDF de RENIEC, Firma Perú, Adobe y cualquier firmador estándar):
 *   1. /ByteRange y /Contents de cada firma (lo firmado son los bytes del PDF menos el hueco de /Contents).
 *   2. El CMS SignedData de /Contents: algoritmo de resumen, atributos firmados (messageDigest, signingTime), certificados y la firma.
 *   3. Comprueba que el resumen de los bytes firmados sea el messageDigest (el documento no cambió) y que la firma de los atributos
 *      sea válida con la clave pública del certificado del firmante (crypto.verify de Node).
 *   4. Certificado del firmante: nombre, DNI (serialNumber), emisor, vigencia en la fecha de la firma; cadena con los certificados
 *      que trae la firma y, si el CDE tiene raíces de confianza cargadas (RENIEC / ECERNEP), que la cadena llegue a una de ellas.
 *   5. Que no haya cambios después de la última firma (la firma cubre el archivo hasta el final).
 * Y compara el firmante con el «ELAB. POR» de la portada (quien elaboró el documento es quien firma).
 */
'use strict';
const crypto = require('crypto'), fs = require('fs'), path = require('path');

// ───────── ASN.1 DER / BER ─────────
function tlv(b, o) {
  const start = o; if (o >= b.length) throw new Error('ASN.1 truncado');
  const t = b[o++], cls = t >> 6, cons = !!(t & 0x20); let tag = t & 0x1f;
  if (tag === 0x1f) { tag = 0; let c; do { c = b[o++]; tag = tag * 128 + (c & 0x7f); } while (c & 0x80); }
  let len = b[o++];
  if (len === 0x80) {   // longitud indefinida (BER): hijos hasta 00 00
    if (!cons) throw new Error('ASN.1: longitud indefinida en un tipo simple');
    const kids = []; let p = o;
    while (!(b[p] === 0 && b[p + 1] === 0)) { if (p >= b.length) throw new Error('ASN.1 truncado'); const k = tlv(b, p); kids.push(k); p = k.end; }
    return nodo(b, { cls, cons, tag, start, vs: o, ve: p, end: p + 2, kids, indef: true });
  }
  if (len & 0x80) { const n = len & 0x7f; if (n > 4) throw new Error('ASN.1: longitud no admitida'); len = 0; for (let i = 0; i < n; i++) len = len * 256 + b[o++]; }
  const end = o + len; if (end > b.length) throw new Error('ASN.1 truncado');
  const r = { cls, cons, tag, start, vs: o, ve: end, end };
  if (cons) { r.kids = []; let p = o; while (p < end) { const k = tlv(b, p); r.kids.push(k); p = k.end; } }
  return nodo(b, r);
}
function nodo(b, r) { Object.defineProperty(r, 'raw', { get: () => b.subarray(r.start, r.end) }); Object.defineProperty(r, 'val', { get: () => b.subarray(r.vs, r.ve) }); return r; }
const esUniv = (n, tag) => n && n.cls === 0 && n.tag === tag;
const esCtx = (n, tag) => n && n.cls === 2 && n.tag === tag;
function oid(n) {
  const v = n.val; if (!v.length) return '';
  const out = [Math.floor(v[0] / 40), v[0] % 40]; let x = 0;
  for (let i = 1; i < v.length; i++) { x = x * 128 + (v[i] & 0x7f); if (!(v[i] & 0x80)) { out.push(x); x = 0; } }
  return out.join('.');
}
function octetos(n) { return n.cons ? Buffer.concat((n.kids || []).map(octetos)) : Buffer.from(n.val); }
function tiempo(n) {
  const s = n.val.toString('latin1');
  if (n.tag === 23) { const m = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?Z$/.exec(s); if (!m) return null; const a = +m[1]; return new Date(Date.UTC(a < 50 ? 2000 + a : 1900 + a, +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0))); }
  if (n.tag === 24) { const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(?:[.,](\d+))?Z?$/.exec(s); if (!m) return null; return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0), m[7] ? Math.round(+('0.' + m[7]) * 1000) : 0)); }
  return null;
}
const entero = (n) => { let v = n.val; while (v.length > 1 && v[0] === 0) v = v.subarray(1); return v.toString('hex').toUpperCase(); };

// ───────── algoritmos ─────────
const RESUMEN = { '1.3.14.3.2.26': 'sha1', '2.16.840.1.101.3.4.2.1': 'sha256', '2.16.840.1.101.3.4.2.2': 'sha384', '2.16.840.1.101.3.4.2.3': 'sha512', '2.16.840.1.101.3.4.2.4': 'sha224' };
const FIRMA = {
  '1.2.840.113549.1.1.1': { k: 'rsa' }, '1.2.840.113549.1.1.5': { k: 'rsa', h: 'sha1' }, '1.2.840.113549.1.1.11': { k: 'rsa', h: 'sha256' }, '1.2.840.113549.1.1.12': { k: 'rsa', h: 'sha384' }, '1.2.840.113549.1.1.13': { k: 'rsa', h: 'sha512' }, '1.2.840.113549.1.1.14': { k: 'rsa', h: 'sha224' },
  '1.2.840.113549.1.1.10': { k: 'pss' }, '1.2.840.10045.2.1': { k: 'ec' }, '1.2.840.10045.4.1': { k: 'ec', h: 'sha1' }, '1.2.840.10045.4.3.2': { k: 'ec', h: 'sha256' }, '1.2.840.10045.4.3.3': { k: 'ec', h: 'sha384' }, '1.2.840.10045.4.3.4': { k: 'ec', h: 'sha512' }
};
const A = { contentType: '1.2.840.113549.1.9.3', messageDigest: '1.2.840.113549.1.9.4', signingTime: '1.2.840.113549.1.9.5', timeStamp: '1.2.840.113549.1.9.16.2.14', signedData: '1.2.840.113549.1.7.2', tstInfo: '1.2.840.113549.1.9.16.1.4' };

// ───────── certificados ─────────
function campos(dn) {   // "C=PE\nO=…\nCN=…" → { C, O, CN, … } (los repetidos, unidos)
  const o = {}; for (const l of String(dn || '').split('\n')) { const i = l.indexOf('='); if (i > 0) { const k = l.slice(0, i).trim(), v = l.slice(i + 1).trim(); o[k] = o[k] ? o[k] + ', ' + v : v; } }
  return o;
}
function persona(cert) {
  const s = campos(cert.subject), i = campos(cert.issuer);
  const cn = s.CN || '', gn = s.GN || s.givenName || s.G || '', sn = s.SN || s.surname || '';
  const nombre = (gn || sn) ? (gn + ' ' + sn).trim() : cn.replace(/\s+(FIR|FAU|AUT)\s+\S+.*$/i, '').replace(/\s*\bDNI\s*:?\s*\d{8}\b.*$/i, '').trim();
  const dni = ((/(\d{8})/.exec(s.serialNumber || s.SERIALNUMBER || '') || /\bF(?:IR|AU)\s+(\d{8,11})\b/i.exec(cn) || /\bDNI\s*:?\s*(\d{8})\b/i.exec(cn) || [])[1]) || '';
  return { nombre: nombre || cn, cn, dni, organizacion: s.O || '', emisor: i.CN || i.O || cert.issuer.replace(/\n/g, ', '), serie: cert.serialNumber, desde: new Date(cert.validFrom).toISOString(), hasta: new Date(cert.validTo).toISOString(), huella: cert.fingerprint256 };
}
const nombreCert = (c) => { const s = campos(c.subject); return s.CN || s.O || c.subject.replace(/\n/g, ', '); };
/** Certificados raíz de confianza: archivos .cer / .crt / .pem de la carpeta (DER o PEM, uno o varios por archivo). */
function cargaRaices(dir) {
  const out = []; if (!dir || !fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir)) {
    if (!/\.(cer|crt|pem|der)$/i.test(f)) continue;
    try { out.push(...certsDeArchivo(fs.readFileSync(path.join(dir, f))).map(c => Object.assign(c, { archivo: f }))); } catch (e) {}
  }
  return out;
}
function certsDeArchivo(buf) {
  const t = buf.toString('latin1');
  if (/-----BEGIN CERTIFICATE-----/.test(t)) return (t.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || []).map(p => new crypto.X509Certificate(p));
  return [new crypto.X509Certificate(buf)];
}
/** Cadena desde el certificado del firmante con los certificados que trae la firma (y las raíces cargadas). */
function cadenaDe(cert, otros, raices) {
  const cad = [cert], pool = otros.concat(raices || []); let act = cert;
  for (let i = 0; i < 8; i++) {
    if (act.checkIssued(act)) break;   // autofirmado: es una raíz
    const em = pool.find(x => x !== act && act.checkIssued(x) && (() => { try { return act.verify(x.publicKey); } catch (e) { return false; } })());
    if (!em) break; cad.push(em); act = em;
  }
  const ult = cad[cad.length - 1], autofirmada = ult.checkIssued(ult) && (() => { try { return ult.verify(ult.publicKey); } catch (e) { return false; } })();
  const confiable = (raices || []).length ? cad.some(c => raices.some(r => r.fingerprint256 === c.fingerprint256)) : null;
  const out = { nombres: cad.map(nombreCert), completa: autofirmada, confiable }; Object.defineProperty(out, 'certs', { value: cad, enumerable: false }); return out;
}

// ───────── lectura del PDF desde el disco (v0.25.5) ─────────
/**
 * Un PDF grande no se carga entero: este lector ofrece lo que usan las funciones de firma (length, indexOf, lastIndexOf, toString por tramos)
 * leyendo trozos del archivo. Las funciones aceptan un Buffer (como antes) o este lector.
 */
const TROZO = 8 * 1024 * 1024;
class ArchivoPdf {
  constructor(ruta) { this.fd = fs.openSync(ruta, 'r'); this.length = fs.fstatSync(this.fd).size; }
  lee(a, b) { a = Math.max(0, a); b = Math.min(this.length, b); const n = Math.max(0, b - a), u = Buffer.alloc(n); if (n) fs.readSync(this.fd, u, 0, n, a); return u; }
  byte(i) { return i < 0 || i >= this.length ? undefined : this.lee(i, i + 1)[0]; }
  toString(cod, a, b) { return this.lee(a || 0, b === undefined ? this.length : b).toString(cod); }
  indexOf(txt, desde) { const ag = Buffer.from(txt, 'latin1'); for (let p = Math.max(0, desde || 0); p < this.length; p += TROZO - ag.length) { const k = this.lee(p, p + TROZO).indexOf(ag); if (k >= 0) return p + k; if (p + TROZO >= this.length) break; } return -1; }
  lastIndexOf(txt, desde) { const ag = Buffer.from(txt, 'latin1'); let fin = Math.min(this.length, (desde === undefined ? this.length : desde) + ag.length); while (fin > 0) { const ini = Math.max(0, fin - TROZO), k = this.lee(ini, fin).lastIndexOf(ag); if (k >= 0) return ini + k; if (!ini) break; fin = ini + ag.length - 1; } return -1; }
  resume(h, a, n) { for (let p = a; p < a + n; p += TROZO) h.update(this.lee(p, Math.min(a + n, p + TROZO))); return h; }
  cierra() { try { fs.closeSync(this.fd); } catch (e) {} }
}
const byteDe = (buf, i) => (buf.byte ? buf.byte(i) : buf[i]);
const resumeDe = (h, buf, a, n) => (buf.resume ? buf.resume(h, a, n) : h.update(buf.subarray(a, a + n)));
const tramos = (buf, a, b, c, d) => (buf.lee ? Buffer.concat([buf.lee(a, a + b), buf.lee(c, c + d)]) : Buffer.concat([buf.subarray(a, a + b), buf.subarray(c, c + d)]));
/** ¿El archivo «largo» empieza con todos los bytes del archivo «corto» (y es más largo)? Por trozos: una versión firmada es la original + la firma. */
function empiezaIgual(rutaLargo, rutaCorto) {
  const L = new ArchivoPdf(rutaLargo), C = new ArchivoPdf(rutaCorto);
  try { if (L.length <= C.length) return false; for (let p = 0; p < C.length; p += TROZO) if (!L.lee(p, Math.min(C.length, p + TROZO)).equals(C.lee(p, p + TROZO))) return false; return true; }
  finally { L.cierra(); C.cierra(); }
}

// ───────── firmas del PDF ─────────
/** Firmas del PDF: [{ byteRange:[a,b,c,d], contenido: Buffer CMS, dicc: texto del diccionario }] en el orden del archivo. */
function firmasDelPdf(buf) {
  // v0.25.5: se busca /ByteRange en los bytes, sin pasar el PDF entero a texto (en uno de 238 MB eso duplicaba la memoria)
  const out = [], rx = /^\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/; let pos = 0, k;
  while ((k = buf.indexOf('/ByteRange', pos, 'latin1')) >= 0) {
    pos = k + 10; const m = rx.exec(buf.toString('latin1', k, Math.min(buf.length, k + 120))); if (!m) continue;
    const br = m.slice(1, 5).map(Number), [a, b, c, d] = br;
    if (a !== 0 || b <= 0 || c <= b || c + d > buf.length || byteDe(buf, b) !== 0x3c || byteDe(buf, c - 1) !== 0x3e) { out.push({ byteRange: br, error: 'El /ByteRange de la firma no apunta a un /Contents válido.' }); continue; }
    const hex = buf.toString('latin1', b + 1, c - 1).replace(/\s+/g, '');
    const ab = buf.lastIndexOf('<<', b - 1, 'latin1'), ini = Math.max(0, ab - 1200), dicc = buf.toString('latin1', ini, Math.min(buf.length, c + 1500));
    out.push({ byteRange: br, contenido: Buffer.from(hex.length % 2 ? hex + '0' : hex, 'hex'), dicc, inicio: k });   // el relleno de ceros del final no se lee: el CMS es el primer elemento
  }
  // un /ByteRange puede repetirse en el texto del objeto y en una versión anterior: uno por posición de /Contents
  const vistos = new Set(); return out.filter(f => { const k = f.byteRange.join(','); if (vistos.has(k)) return false; vistos.add(k); return true; });
}
const valorPdf = (dicc, clave) => { const m = new RegExp('/' + clave + '\\s*(\\((?:\\\\.|[^\\\\)])*\\)|<[0-9A-Fa-f\\s]*>|/[^\\s/<>\\[\\]()]+)').exec(dicc || ''); if (!m) return ''; let v = m[1]; if (v[0] === '/') return v.slice(1); if (v[0] === '<') { const h = Buffer.from(v.slice(1, -1).replace(/\s/g, ''), 'hex'); return h[0] === 0xfe && h[1] === 0xff ? h.subarray(2).swap16().toString('utf16le') : h.toString('latin1'); } v = v.slice(1, -1).replace(/\\([nrtbf()\\])/g, (x, c) => ({ n: '\n', r: '\r', t: '\t', b: '', f: '', '(': '(', ')': ')', '\\': '\\' })[c]); const bb = Buffer.from(v, 'latin1'); return bb[0] === 0xfe && bb[1] === 0xff ? bb.subarray(2).swap16().toString('utf16le') : v; };
const fechaPdf = (s) => { const m = /D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Z+\-])?(\d{2})?'?(\d{2})?/.exec(s || ''); if (!m) return ''; const z = m[7] === '+' || m[7] === '-' ? (m[7] === '+' ? -1 : 1) * ((+m[8] || 0) * 60 + (+m[9] || 0)) : 0; return new Date(Date.UTC(+m[1], (+m[2] || 1) - 1, +m[3] || 1, +m[4] || 0, +m[5] || 0, +m[6] || 0) + z * 60000).toISOString(); };

/** Verifica una firma (CMS SignedData sobre los bytes del ByteRange). */
function verificaFirma(buf, f, raices) {
  const r = { byteRange: f.byteRange, subFiltro: valorPdf(f.dicc, 'SubFilter'), motivo: valorPdf(f.dicc, 'Reason'), nombrePdf: valorPdf(f.dicc, 'Name'), fechaPdf: fechaPdf(valorPdf(f.dicc, 'M')), errores: [], ok: false };
  if (f.error) { r.errores.push(f.error); return r; }
  const [a, b, c, d] = f.byteRange; r.cubreHasta = c + d;
  if (/RFC3161/i.test(r.subFiltro)) { r.selloDeDocumento = true; }
  let ci; try { ci = tlv(f.contenido, 0); } catch (e) { r.errores.push('El contenido de la firma no es un PKCS#7/CMS legible (' + e.message + ').'); return r; }
  try {
    if (!esUniv(ci.kids[0], 6) || oid(ci.kids[0]) !== A.signedData) throw new Error('no es SignedData');
    const sd = ci.kids[1].kids[0], k = sd.kids; let i = 1;
    const algs = k[i++]; const encap = k[i++]; let certs = []; if (esCtx(k[i], 0)) { certs = (k[i].kids || []).filter(x => esUniv(x, 16)); i++; } if (esCtx(k[i], 1)) i++;
    const sis = k[i]; if (!sis || !esUniv(sis, 17) || !sis.kids.length) throw new Error('sin SignerInfo');
    const X = certs.map(x => { try { return new crypto.X509Certificate(Buffer.from(x.raw)); } catch (e) { return null; } }).filter(Boolean);
    const si = sis.kids[0].kids; let j = 1; const sid = si[j++], oD = oid(si[j++].kids[0]), dAlg = RESUMEN[oD] || (FIRMA[oD] && FIRMA[oD].h);   // hay firmadores que ponen aquí el algoritmo de firma (p. ej. sha1WithRSA)
    let attrs = null; if (esCtx(si[j], 0)) attrs = si[j++];
    const sAlgN = si[j++], sAlg = FIRMA[oid(sAlgN.kids[0])], firma = octetos(si[j++]); const noFirm = esCtx(si[j], 1) ? si[j] : null;
    if (!dAlg) throw new Error('algoritmo de resumen no admitido'); if (!sAlg) throw new Error('algoritmo de firma no admitido (' + oid(sAlgN.kids[0]) + ')');
    r.algoritmo = dAlg.toUpperCase() + ' con ' + ({ rsa: 'RSA', pss: 'RSA-PSS', ec: 'ECDSA' })[sAlg.k];
    // certificado del firmante: por emisor + número de serie, o por identificador de clave
    let cert = null;
    if (esUniv(sid, 16)) { const serie = entero(sid.kids[1]); cert = X.find(x => x.serialNumber.toUpperCase().replace(/^0+/, '') === serie.replace(/^0+/, '')) || null; }
    else if (esCtx(sid, 0)) { const ski = Buffer.from(sid.val).toString('hex'); cert = X.find(x => { try { const der = x.raw, sk = crypto.createHash('sha1').update(spkiBits(der)).digest('hex'); return sk === ski; } catch (e) { return false; } }) || null; }
    if (!cert && X.length === 1) cert = X[0];
    if (!cert) throw new Error('la firma no trae el certificado del firmante');
    r.firmante = persona(cert);
    // 1) el documento no cambió: resumen de los bytes firmados
    const h = resumeDe(resumeDe(crypto.createHash(dAlg), buf, a, b), buf, c, d).digest();
    let datosFirmados, md = null, hora = null;
    if (attrs) {
      for (const at of attrs.kids) { const o = oid(at.kids[0]), v = at.kids[1].kids[0]; if (o === A.messageDigest) md = octetos(v); if (o === A.signingTime) hora = tiempo(v); }
      if (!md) throw new Error('los atributos firmados no traen el resumen del documento (messageDigest)');
      r.integra = md.equals(h);
      datosFirmados = Buffer.from(attrs.raw); datosFirmados[0] = 0x31;   // se firma el SET OF de los atributos (DER)
      if (attrs.indef) throw new Error('atributos firmados en BER indefinido: no admitido');
    } else {   // adbe.pkcs7.detached sin atributos: se firma directamente el contenido
      r.integra = true; datosFirmados = tramos(buf, a, b, c, d);
    }
    if (!r.integra) r.errores.push('El documento cambió después de firmarse: el resumen de los bytes firmados no coincide con el de la firma.');
    // 2) la firma es de la clave del certificado
    const hashF = sAlg.h || dAlg; let okF = false;
    try {
      const opc = { key: cert.publicKey };
      if (sAlg.k === 'pss') { const sal = pssSal(sAlgN); opc.padding = crypto.constants.RSA_PKCS1_PSS_PADDING; opc.saltLength = sal.sal; okF = crypto.verify(sal.hash || hashF, datosFirmados, opc, firma); }
      else okF = crypto.verify(hashF, datosFirmados, opc, firma);
    } catch (e) { okF = false; }
    r.firmaValida = okF; if (!okF) r.errores.push('La firma no corresponde a la clave del certificado del firmante.');
    // 3) sello de tiempo (si lo trae) y fecha de la firma
    if (noFirm) for (const at of noFirm.kids) if (oid(at.kids[0]) === A.timeStamp) { try { r.selloTiempo = horaSello(at.kids[1].kids[0]); } catch (e) { r.selloTiempo = 'ilegible'; } }
    const cuando = (r.selloTiempo && r.selloTiempo !== 'ilegible' && new Date(r.selloTiempo)) || hora || (r.fechaPdf ? new Date(r.fechaPdf) : null);
    r.fecha = cuando ? cuando.toISOString() : ''; r.fechaFuente = r.selloTiempo && r.selloTiempo !== 'ilegible' ? 'sello de tiempo' : hora ? 'hora de la firma' : r.fechaPdf ? 'hora del PDF' : '';
    const ref = cuando || new Date();
    r.vigente = ref >= new Date(cert.validFrom) && ref <= new Date(cert.validTo);
    if (!r.vigente) r.errores.push('El certificado no estaba vigente al firmar (válido del ' + r.firmante.desde.slice(0, 10) + ' al ' + r.firmante.hasta.slice(0, 10) + ').');
    // 4) cadena del certificado
    r.cadena = cadenaDe(cert, X.filter(x => x !== cert), raices); Object.defineProperty(r, '_cadenaCerts', { value: r.cadena.certs, enumerable: false });
    if (r.cadena.confiable === false) r.errores.push('El certificado no proviene de una entidad de certificación de confianza del CDE (cadena: ' + r.cadena.nombres.join(' → ') + ').');
    r.ok = !!(r.integra && r.firmaValida && r.vigente && r.cadena.confiable !== false);
  } catch (e) { r.errores.push('No se pudo leer la firma: ' + e.message + '.'); }
  return r;
}
function spkiBits(der) {   // BIT STRING de la clave pública (para el identificador de clave del firmante)
  const cert = tlv(der, 0), tbs = cert.kids[0].kids; let i = esCtx(tbs[0], 0) ? 1 : 0; const spki = tbs[i + 5]; return octetos({ cons: false, val: spki.kids[1].val.subarray(1) });
}
function pssSal(algN) { const out = { sal: 20, hash: null }; const p = algN.kids[1]; if (!p || !p.kids) return out; for (const k of p.kids) { if (esCtx(k, 0)) out.hash = RESUMEN[oid(k.kids[0].kids[0])] || null; if (esCtx(k, 2)) out.sal = parseInt(entero(k.kids[0]), 16); } return out; }
function horaSello(tok) {   // TimeStampToken → TSTInfo.genTime
  const sd = tok.kids[1].kids[0], encap = sd.kids[2], cont = encap.kids[1] && encap.kids[1].kids[0]; const tst = tlv(octetos(cont), 0);
  const g = tst.kids.find(x => esUniv(x, 24)); return g ? tiempo(g).toISOString() : '';
}

/**
 * Verifica todas las firmas de un PDF. opts.raices: certificados raíz de confianza (X509Certificate[]).
 * → { firmado, firmas:[…], cubreTodo, modificadoDespues, ok }
 */
function verificaPdf(buf, opts) {
  const raices = (opts && opts.raices) || [];
  const fs_ = firmasDelPdf(buf);
  if (!fs_.length) return { firmado: false, firmas: [], ok: false, cubreTodo: false };
  const firmas = fs_.map(f => verificaFirma(buf, f, raices));
  // fin real del archivo (sin saltos de línea finales): lo que no cubre ninguna firma es un cambio posterior
  let fin = buf.length; const cola = buf.lee ? buf.lee(Math.max(0, fin - 4096), fin) : null, at = (i) => (cola ? cola[i - (buf.length - cola.length)] : buf[i]);
  while (fin > 0 && (!cola || fin > buf.length - cola.length) && (at(fin - 1) === 0x0a || at(fin - 1) === 0x0d || at(fin - 1) === 0x20 || at(fin - 1) === 0x00)) fin--;
  const cubre = Math.max(...firmas.map(x => x.cubreHasta || 0)), cubreTodo = cubre >= fin;
  return { firmado: true, firmas, cubreTodo, modificadoDespues: !cubreTodo, ok: firmas.every(x => x.ok || x.selloDeDocumento) && cubreTodo };
}

// ───────── ¿firmó quien elaboró? ─────────
const TITULOS = new Set(['ING', 'ARQ', 'ABOG', 'ABG', 'LIC', 'DR', 'DRA', 'MG', 'MSC', 'MBA', 'SR', 'SRA', 'SRTA', 'ECON', 'BACH', 'TEC', 'CPC', 'PHD', 'ESP', 'Y', 'DE', 'DEL', 'LA', 'LOS', 'LAS']);
const fichas = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9Ñ]+/g, ' ').trim().split(' ').filter(Boolean);
/**
 * ¿El nombre de «ELAB. POR» (p. ej. «S. Campoverde», «Ing. Sandra Campoverde R.») es la persona del certificado?
 * Cada palabra completa debe estar en el nombre del certificado y cada inicial debe ser la inicial de uno de sus nombres o apellidos.
 */
function coincideNombre(elab, firmante) {
  const e = fichas(elab).filter(t => !TITULOS.has(t)), certT = fichas([firmante && firmante.nombre, firmante && firmante.cn].join(' ')).filter(t => !/^\d+$/.test(t) && !['FIR', 'FAU', 'AUT', 'HARD', 'SOFT'].includes(t));
  if (!e.length) return { ok: false, motivo: 'La portada no dice quién elaboró el documento (columna «ELAB. POR» del cuadro de revisiones).' };
  const usados = new Set(); let palabras = 0;
  for (const t of e.filter(t => t.length > 1)) { const k = certT.findIndex((c, i) => !usados.has(i) && c === t); if (k < 0) return { ok: false, motivo: '«' + t + '» no está en el nombre del certificado.' }; usados.add(k); palabras++; }
  for (const t of e.filter(t => t.length === 1)) { const k = certT.findIndex((c, i) => !usados.has(i) && c[0] === t); if (k < 0) return { ok: false, motivo: 'La inicial «' + t + '.» no corresponde a ningún nombre del certificado.' }; usados.add(k); }
  if (!palabras) return { ok: false, motivo: '«ELAB. POR» solo tiene iniciales: hace falta al menos un apellido para identificar al firmante.' };
  return { ok: true };
}

/**
 * Resultado para el CDE: ¿el PDF está firmado, íntegro y por quien lo elaboró? Devuelve { ok, checks[], firmante, firma } con el mismo
 * formato de comprobaciones que la Validación QA (para mostrarlas igual).
 */
function evalua(buf, elabPor, opts) {
  const v = verificaPdf(buf, opts), checks = [], pon = (id, titulo, ok, detalle, aviso) => checks.push({ id, titulo, ok: !!ok, detalle: detalle || '', aviso: !!aviso });
  if (!v.firmado) { pon('firmado', 'Firma digital', false, 'El PDF no está firmado digitalmente. Fírmalo con ReFirma (lo firma quien aparece en «ELAB. POR»: ' + (elabPor || '—') + ').'); return { ok: false, sinFirma: true, checks, verificacion: v }; }
  const personas = v.firmas.filter(f => !f.selloDeDocumento);
  const quien = personas.map(f => Object.assign({ f }, f.firmante ? coincideNombre(elabPor, f.firmante) : { ok: false, motivo: 'sin certificado legible' }));
  const suya = quien.find(x => x.ok && x.f.ok) || quien.find(x => x.ok) || null, f = suya ? suya.f : personas[personas.length - 1] || v.firmas[0];
  pon('firmado', 'Firma digital', true, personas.length + ' firma(s) en el PDF' + (personas.length ? ': ' + personas.map(x => x.firmante ? x.firmante.nombre : '¿?').join(' · ') : ''));
  const rotas = v.firmas.filter(x => !x.integra || !x.firmaValida);
  pon('integra', 'Firma válida y documento sin cambios', !rotas.length, rotas.length ? rotas.map(x => x.errores[0] || 'Firma no válida.').join(' ') : 'El resumen del documento coincide con el firmado (' + (f.algoritmo || '') + ').');
  pon('cubre', 'Sin cambios después de firmar', v.cubreTodo, v.cubreTodo ? 'La firma cubre el documento hasta el final.' : 'El PDF tiene cambios agregados después de la última firma: vuelve a firmarlo.');
  if (f && f.firmante) {
    pon('vigencia', 'Certificado vigente al firmar', f.vigente, (f.vigente ? '' : 'No vigente: ') + 'válido del ' + f.firmante.desde.slice(0, 10) + ' al ' + f.firmante.hasta.slice(0, 10) + (f.fecha ? ' · firmado el ' + f.fecha.slice(0, 16).replace('T', ' ') + ' (UTC, ' + f.fechaFuente + ')' : ''));
    const cad = f.cadena || { nombres: [], confiable: null };
    pon('cadena', 'Entidad de certificación', cad.confiable !== false, (cad.nombres || []).join(' → ') + (cad.confiable === true ? ' · raíz de confianza del CDE' : cad.confiable === false ? ' · no llega a ninguna raíz de confianza del CDE' : ' · aún no hay raíces de confianza cargadas en el CDE: la cadena se informa, no se comprueba'), cad.confiable === null);
  }
  const okQuien = !!suya;
  pon('firmante', 'Firma de quien elaboró el documento', okQuien, okQuien ? (suya.f.firmante.nombre + (suya.f.firmante.dni ? ' (DNI ' + suya.f.firmante.dni + ')' : '') + ' = ELAB. POR «' + elabPor + '»') : 'En «ELAB. POR» dice «' + (elabPor || '—') + '», pero ' + (personas.length ? 'firmó ' + personas.map(x => x.firmante ? x.firmante.nombre : '¿?').join(' y ') : 'no hay firma de persona') + '. ' + ((quien[0] && quien[0].motivo) || ''));
  const ok = checks.every(c => c.ok);
  return { ok, checks, firmante: suya ? suya.f.firmante : (f && f.firmante) || null, firma: f ? { fecha: f.fecha, fechaFuente: f.fechaFuente, algoritmo: f.algoritmo, subFiltro: f.subFiltro, motivo: f.motivo, selloTiempo: f.selloTiempo || '', cadena: f.cadena } : null, verificacion: v };
}
/** Resumen para guardar en la versión. */
function resumen(ev) { return { ok: ev.ok, firmante: ev.firmante ? { nombre: ev.firmante.nombre, dni: ev.firmante.dni, emisor: ev.firmante.emisor, serie: ev.firmante.serie, desde: ev.firmante.desde, hasta: ev.firmante.hasta } : null, fecha: ev.firma && ev.firma.fecha, algoritmo: ev.firma && ev.firma.algoritmo, cadena: ev.firma && ev.firma.cadena, checks: ev.checks.map(c => ({ id: c.id, ok: c.ok, aviso: c.aviso || undefined })), verificado: new Date().toISOString() }; }
/** «nombre[R].pdf» (salida de ReFirma PDF) → «nombre.pdf». */
const sinMarcaReFirma = (n) => String(n || '').replace(/\s*\[R\](?=\.pdf$)/i, '');

/** Como evalua, pero desde la ruta del PDF: lo lee por trozos (v0.25.5). */
function evaluaArchivo(ruta, elabPor, opts) { const A = new ArchivoPdf(ruta); try { return evalua(A, elabPor, opts); } finally { A.cierra(); } }
function verificaArchivo(ruta, opts) { const A = new ArchivoPdf(ruta); try { return verificaPdf(A, opts); } finally { A.cierra(); } }
module.exports = { evaluaArchivo, verificaArchivo, empiezaIgual, ArchivoPdf, verificaPdf, evalua, resumen, coincideNombre, cargaRaices, certsDeArchivo, firmasDelPdf, sinMarcaReFirma, _tlv: tlv, _oid: oid };
