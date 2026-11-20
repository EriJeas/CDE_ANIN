/*
 * Firmas de prueba para las pruebas automáticas (v0.25.0): arma en memoria una entidad de certificación de prueba, certificados
 * de persona como los de RENIEC («APELLIDOS NOMBRES FIR DNI hard») y firma PDF en PAdES (actualización incremental con
 * /ByteRange y un CMS SignedData con atributos firmados), como lo hacen ReFirma PDF y los firmadores estándar.
 * Las claves se generan al correr las pruebas: no hay claves guardadas en el repositorio. Solo para pruebas.
 */
'use strict';
const crypto = require('crypto');

// ───────── DER ─────────
const largo = (n) => { if (n < 128) return Buffer.from([n]); const b = []; while (n) { b.unshift(n & 255); n = Math.floor(n / 256); } return Buffer.from([0x80 | b.length, ...b]); };
const T = (tag, ...p) => { const v = Buffer.concat(p.flat().map(x => Buffer.isBuffer(x) ? x : Buffer.from(x))); return Buffer.concat([Buffer.from([tag]), largo(v.length), v]); };
const SEQ = (...p) => T(0x30, ...p);
const SET = (...p) => T(0x31, ...p.flat().sort(Buffer.compare));   // DER: SET OF ordenado
const OID = (s) => { const n = s.split('.').map(Number), out = [n[0] * 40 + n[1]]; for (const x of n.slice(2)) { const b = [x & 0x7f]; let y = Math.floor(x / 128); while (y) { b.unshift((y & 0x7f) | 0x80); y = Math.floor(y / 128); } out.push(...b); } return T(6, Buffer.from(out)); };
const INT = (v) => { let b = Buffer.isBuffer(v) ? v : Buffer.from((typeof v === 'number' ? v.toString(16) : v).padStart(2, '0').replace(/^(.(..)*)$/, '0$1'), 'hex'); while (b.length > 1 && b[0] === 0 && !(b[1] & 0x80)) b = b.subarray(1); if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]); return T(2, b); };
const NULL = Buffer.from([5, 0]), BOOL = (v) => Buffer.from([1, 1, v ? 0xff : 0]);
const OCT = (b) => T(4, b), UTF8 = (s) => T(0x0c, Buffer.from(s, 'utf8')), PRN = (s) => T(0x13, Buffer.from(s, 'latin1'));
const BIT = (b, sinUsar) => T(3, Buffer.from([sinUsar || 0]), b);
const UTC = (d) => T(0x17, Buffer.from(d.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z', 'latin1'));
const CTX = (n, ...p) => T(0xa0 | n, ...p);
const ATT = { CN: '2.5.4.3', C: '2.5.4.6', O: '2.5.4.10', OU: '2.5.4.11', SN: '2.5.4.4', GN: '2.5.4.42', serialNumber: '2.5.4.5' };
const nombre = (o) => SEQ(...Object.entries(o).map(([k, v]) => SET(SEQ(OID(ATT[k]), k === 'C' || k === 'serialNumber' ? PRN(v) : UTF8(v)))));
const bitsClave = (spki) => { const p = (b, o) => { let l = b[o + 1], h = 2; if (l & 0x80) { const n = l & 0x7f; l = 0; for (let i = 0; i < n; i++) l = l * 256 + b[o + 2 + i]; h = 2 + n; } return { v: o + h, e: o + h + l }; }; const s = p(spki, 0); const a = p(spki, s.v); const bs = p(spki, a.e); return spki.subarray(bs.v + 1, bs.e); };

/**
 * Certificado X.509 v3 firmado por el emisor (o autofirmado). o: { sujeto:{…}, emisor:{ nombre, clave, ski } | null, ca, desde, hasta, serie }.
 * → { der, pem, clave (privada), nombreDer, serie, ski }
 */
function certificado(o) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const spki = publicKey.export({ type: 'spki', format: 'der' }), ski = crypto.createHash('sha1').update(bitsClave(spki)).digest();
  const serie = o.serie || crypto.randomBytes(8).toString('hex'), suj = nombre(o.sujeto), em = o.emisor ? o.emisor.nombreDer : suj, claveEm = o.emisor ? o.emisor.clave : privateKey;
  const usos = o.ca ? [0x06, 1] : [0xc0, 6];   // CA: keyCertSign + cRLSign · persona: digitalSignature + nonRepudiation
  const ext = [SEQ(OID('2.5.29.19'), BOOL(true), OCT(SEQ(o.ca ? BOOL(true) : Buffer.alloc(0)))), SEQ(OID('2.5.29.15'), BOOL(true), OCT(BIT(Buffer.from([usos[0]]), usos[1]))), SEQ(OID('2.5.29.14'), OCT(OCT(ski))), SEQ(OID('2.5.29.35'), OCT(SEQ(T(0x80, o.emisor ? o.emisor.ski : ski))))];
  const alg = SEQ(OID('1.2.840.113549.1.1.11'), NULL);
  const tbs = SEQ(CTX(0, INT(2)), INT(serie), alg, em, SEQ(UTC(o.desde || new Date(Date.now() - 86400e3)), UTC(o.hasta || new Date(Date.now() + 365 * 86400e3))), suj, spki, CTX(3, SEQ(...ext)));
  const der = SEQ(tbs, alg, BIT(crypto.sign('sha256', tbs, claveEm)));
  return { der, pem: '-----BEGIN CERTIFICATE-----\n' + der.toString('base64').replace(/(.{64})/g, '$1\n').replace(/\n$/, '') + '\n-----END CERTIFICATE-----\n', clave: privateKey, nombreDer: suj, serie, ski };
}

/** Entidad de certificación de prueba (raíz + intermedia) y personas firmantes. */
function pki() {
  const raiz = certificado({ sujeto: { C: 'PE', O: 'ENTIDAD DE PRUEBA', CN: 'RAIZ DE PRUEBA CDE' }, ca: true, desde: new Date(Date.now() - 400 * 86400e3), hasta: new Date(Date.now() + 3650 * 86400e3) });
  const inter = certificado({ sujeto: { C: 'PE', O: 'ENTIDAD DE PRUEBA', CN: 'CA CLASE 1 DE PRUEBA' }, ca: true, emisor: raiz });
  const persona = (ap, nom, dni, op) => certificado(Object.assign({ sujeto: { C: 'PE', O: 'PERSONA NATURAL', serialNumber: 'PNOPE-' + dni, SN: ap, GN: nom, CN: ap + ' ' + nom + ' FIR ' + dni + ' hard' }, emisor: inter }, op || {}));
  const impostora = certificado({ sujeto: { C: 'PE', O: 'ENTIDAD FALSA', CN: 'RAIZ FALSA' }, ca: true });
  return {
    raiz, inter, impostora,
    sandra: persona('CAMPOVERDE RUIZ', 'SANDRA', '40000001'),
    marco: persona('WONG LI', 'MARCO', '40000002'),
    vencido: persona('CAMPOVERDE RUIZ', 'SANDRA', '40000001', { desde: new Date(Date.now() - 800 * 86400e3), hasta: new Date(Date.now() - 400 * 86400e3) }),
    falsa: certificado({ sujeto: { C: 'PE', O: 'PERSONA NATURAL', SN: 'CAMPOVERDE RUIZ', GN: 'SANDRA', CN: 'CAMPOVERDE RUIZ SANDRA FIR 40000001 hard' }, emisor: impostora }),
    persona
  };
}

/**
 * Firma un PDF (actualización incremental). quien: certificado de pki(); cadena: certificados que viajan en la firma.
 * op: { cadena:[…], motivo, sinAtributos, hueco (bytes del /Contents) }
 */
function firmaPdf(pdf, quien, op) {
  op = op || {};
  const t = pdf.toString('latin1');
  const sx = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(t); if (!sx) throw new Error('PDF sin startxref');
  const root = +(/\/Root\s+(\d+)\s+0\s+R/g.exec(t.slice(t.lastIndexOf('trailer'))) || [])[1];
  const size = +(/\/Size\s+(\d+)/.exec(t.slice(t.lastIndexOf('trailer'))) || [])[1];
  const obj = (n) => { const rx = new RegExp('(?:^|\\n)' + n + ' 0 obj\\s*([\\s\\S]*?)\\s*endobj', 'g'); let m, u = null; while ((m = rx.exec(t))) u = m[1]; return u; };
  const pagN = (() => { const rx = /(?:^|\n)(\d+) 0 obj\s*<<(?:(?!endobj)[\s\S])*?\/Type\s*\/Page\b(?!s)/g; const m = rx.exec(t); return m ? +m[1] : 0; })();
  const cat = obj(root), pag = obj(pagN), nS = size, nW = size + 1, campo = 'Firma' + (((t.match(/\/FT\s*\/Sig/g) || []).length) + 1);
  const previos = (/\/Fields\s*\[([^\]]*)\]/.exec(cat || '') || [])[1] || '';
  const catN = cat.replace(/\/AcroForm\s*<<[\s\S]*?>>\s*(?=>>\s*$)/, '').replace(/>>\s*$/, '/AcroForm << /Fields [' + previos + ' ' + nW + ' 0 R] /SigFlags 3 >> >>');
  const anot = (/\/Annots\s*\[([^\]]*)\]/.exec(pag || '') || [])[1];
  const pagNuevo = anot !== undefined ? pag.replace(/\/Annots\s*\[[^\]]*\]/, '/Annots [' + anot + ' ' + nW + ' 0 R]') : pag.replace(/>>\s*$/, '/Annots [' + nW + ' 0 R] >>');
  const hueco = op.hueco || 12000, ahora = new Date(), fM = 'D:' + ahora.toISOString().replace(/[-:T]/g, '').slice(0, 14) + "Z";
  const sig = '<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /ByteRange [0 ********** ********** **********] /Contents <' + '0'.repeat(hueco * 2) + '> /Reason (' + (op.motivo || 'Soy el autor del documento') + ') /M (' + fM + ') >>';
  const wid = '<< /Type /Annot /Subtype /Widget /FT /Sig /Rect [0 0 0 0] /F 132 /T (' + campo + ') /V ' + nS + ' 0 R /P ' + pagN + ' 0 R >>';
  let s = t.endsWith('\n') ? '' : '\n'; const base = pdf.length + s.length, offs = {};
  const pon = (n, cuerpo) => { offs[n] = base + Buffer.byteLength(s, 'latin1'); s += n + ' 0 obj\n' + cuerpo + '\nendobj\n'; };
  pon(root, catN); pon(pagN, pagNuevo); pon(nS, sig); pon(nW, wid);
  const xref = base + Buffer.byteLength(s, 'latin1'), nums = Object.keys(offs).map(Number).sort((a, b) => a - b);
  s += 'xref\n' + nums.map(n => n + ' 1\n' + String(offs[n]).padStart(10, '0') + ' 00000 n \n').join('') + 'trailer\n<< /Size ' + (size + 2) + ' /Root ' + root + ' 0 R /Prev ' + sx[1] + ' >>\nstartxref\n' + xref + '\n%%EOF\n';
  let out = Buffer.concat([pdf, Buffer.from((t.endsWith('\n') ? '' : '\n') + s.slice(t.endsWith('\n') ? 0 : 1), 'latin1')]);
  const o = out.toString('latin1'), iC = o.lastIndexOf('/Contents <') + 10, cC = iC + hueco * 2 + 2, br = [0, iC, cC, out.length - cC];
  const iB = o.lastIndexOf('/ByteRange [0 **********'), txt = '/ByteRange [' + br.join(' ') + ']';
  out.write(txt.padEnd('/ByteRange [0 ********** ********** **********]'.length, ' '), iB, 'latin1');
  const firmados = Buffer.concat([out.subarray(0, iC), out.subarray(cC)]), cms = cmsDe(firmados, quien, op);
  if (cms.length > hueco) throw new Error('hueco chico');
  out.write(cms.toString('hex').padEnd(hueco * 2, '0'), iC + 1, 'latin1');
  return out;
}
function cmsDe(datos, quien, op) {
  const h = crypto.createHash('sha256').update(datos).digest(), sha = SEQ(OID('2.16.840.1.101.3.4.2.1'), NULL), emisorDer = quien.emisorDer || emisorDe(quien.der);
  let signerInfo;
  if (op.sinAtributos) {
    signerInfo = SEQ(INT(1), SEQ(emisorDer, INT(quien.serie)), sha, SEQ(OID('1.2.840.113549.1.1.1'), NULL), OCT(crypto.sign('sha256', datos, quien.clave)));
  } else {
    const at = [SEQ(OID('1.2.840.113549.1.9.3'), SET(OID('1.2.840.113549.1.7.1'))), SEQ(OID('1.2.840.113549.1.9.5'), SET(UTC(op.hora || new Date()))), SEQ(OID('1.2.840.113549.1.9.4'), SET(OCT(op.resumenFalso ? crypto.randomBytes(32) : h)))];
    const set = SET(...at), firma = crypto.sign('sha256', set, op.claveFalsa || quien.clave);
    signerInfo = SEQ(INT(1), SEQ(emisorDer, INT(quien.serie)), sha, Buffer.concat([Buffer.from([0xa0]), set.subarray(1)]), SEQ(OID('1.2.840.113549.1.1.1'), NULL), OCT(firma));
  }
  const certs = [quien.der].concat((op.cadena || []).map(c => c.der));
  const sd = SEQ(INT(1), SET(sha), SEQ(OID('1.2.840.113549.1.7.1')), CTX(0, ...certs), SET(signerInfo));
  return SEQ(OID('1.2.840.113549.1.7.2'), CTX(0, sd));
}
function emisorDe(der) {   // Name del emisor dentro del certificado (para issuerAndSerialNumber)
  const F = require('../lib/firma'); const c = F._tlv(der, 0), tbs = c.kids[0].kids, i = tbs[0].cls === 2 ? 1 : 0; return Buffer.from(tbs[i + 2].raw);
}
/** Agrega una actualización incremental SIN firmar (simula que alguien cambió el PDF después de firmarlo). */
function cambiaDespues(pdf) {
  const t = pdf.toString('latin1'), sx = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(t), size = +(/\/Size\s+(\d+)/.exec(t.slice(t.lastIndexOf('trailer'))) || [])[1], root = +(/\/Root\s+(\d+)/.exec(t.slice(t.lastIndexOf('trailer'))) || [])[1];
  const add = size + ' 0 obj\n<< /Type /Annot /Subtype /Text /Rect [10 10 30 30] /Contents (agregado despues de firmar) >>\nendobj\n', off = pdf.length;
  const x = off + Buffer.byteLength(add, 'latin1');
  return Buffer.concat([pdf, Buffer.from(add + 'xref\n' + size + ' 1\n' + String(off).padStart(10, '0') + ' 00000 n \ntrailer\n<< /Size ' + (size + 1) + ' /Root ' + root + ' 0 R /Prev ' + sx[1] + ' >>\nstartxref\n' + x + '\n%%EOF\n', 'latin1')]);
}

module.exports = { pki, firmaPdf, cambiaDespues, certificado };
