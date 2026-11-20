/*
 * Análisis del contenido de un documento para su ficha (v0.24.3). Aprovecha la lectura que ya hace la Validación QA y va más allá de la
 * portada: recorre TODAS las páginas del PDF y comprueba, sin IA y de forma reproducible:
 *   · Encabezado de cada página: la Revisión y la Emisión del cajetín deben ser las de la portada, y «Página k de N» debe ser correlativa.
 *   · Fechas: fechas imposibles (31/02), fechas posteriores a la emisión del documento, y el cuadro de revisiones en orden.
 *   · Códigos: el código del documento escrito distinto en alguna página; códigos de otros proyectos; documentos citados que no están en el CDE.
 *   · Páginas sin texto (escaneadas: no se pueden buscar ni analizar) y texto sin terminar («por definir», «XXX», «pendiente»).
 * Cada hallazgo dice en qué páginas está. Lo que requiere entender el texto (objetivo, de qué trata, ideas, contradicciones) lo redacta la
 * IA en lib/resumen.js, que recibe estos hallazgos como contexto.
 */
'use strict';
const path = require('path');
const QA = require('./qa');
let PDFJS = null;
const pdfjs = () => { if (!PDFJS) { for (const k of ['DOMMatrix', 'Path2D', 'ImageData']) if (!globalThis[k]) globalThis[k] = class {}; PDFJS = require('../public/vendor/pdf.min.js'); PDFJS.GlobalWorkerOptions.workerSrc = path.resolve(__dirname, '../public/vendor/pdf.worker.min.js'); } return PDFJS; };
const MAX_PAG = 600;
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

/** Páginas del PDF: [{ n, texto, cab (texto del quinto superior de la página, donde va el cajetín) }]. */
async function paginasPdf(buf) {
  const doc = await pdfjs().getDocument({ data: new Uint8Array(buf), isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise, out = [];
  for (let i = 1; i <= Math.min(doc.numPages, MAX_PAG); i++) {
    const pg = await doc.getPage(i), vw = pg.view || [0, 0, 612, 792], h = vw[3] - vw[1], tc = await pg.getTextContent();
    const its = tc.items.filter(x => x.str && x.str.trim()).map(x => ({ s: x.str, x: x.transform[4], y: x.transform[5], w: x.width || 0, h: x.height || Math.abs(x.transform[3]) || 8 }));
    // líneas por altura; dentro de la línea, los trozos pegados se unen sin espacio (pdf.js parte «103» en «10» + «3»)
    const lineas = (l) => { const L = []; for (const it of l.slice().sort((a, b) => b.y - a.y)) { const u = L[L.length - 1]; if (u && Math.abs(u.y - it.y) <= Math.max(2, it.h * 0.45)) u.i.push(it); else L.push({ y: it.y, i: [it] }); }
      return L.map(u => { u.i.sort((a, b) => a.x - b.x); let t = '', fin = null; for (const it of u.i) { if (fin !== null && it.x - fin > Math.max(1, it.h * 0.18) && !/\s$/.test(t)) t += ' '; t += it.s; fin = it.x + it.w; }
        const hh = Math.max(...u.i.map(x => x.h)), x0 = Math.min(...u.i.map(x => x.x)), x1 = Math.max(...u.i.map(x => x.x + x.w));
        return { t: t.replace(/\s+/g, ' ').trim(), x: x0 - vw[0], y: vw[1] + h - (u.y + hh * 0.95), w: x1 - x0, h: hh * 1.25, its: u.i.map(x => ({ s: x.s, x: x.x - vw[0], w: x.w })) }; }).filter(x => x.t); };
    const une = (L) => L.map(x => x.t).join('\n');
    let notas = 0, notasRects = []; try { const an = (await pg.getAnnotations()).filter(a => ['Text', 'FreeText', 'Highlight', 'StrikeOut', 'Underline', 'Squiggly', 'Caret', 'Ink'].includes(a.subtype)); notas = an.length; notasRects = an.filter(a => Array.isArray(a.rect)).map(a => ({ x: a.rect[0] - vw[0], y: vw[1] + h - a.rect[3], w: Math.max(8, a.rect[2] - a.rect[0]), h: Math.max(8, a.rect[3] - a.rect[1]) })); } catch (e) {}
    const L = lineas(its), Lc = lineas(its.filter(it => it.y - vw[1] > h * 0.8));
    out.push({ n: i, texto: une(L), cab: une(Lc), lineas: L, notas, notasRects, ancho: Math.round(vw[2] - vw[0]), alto: Math.round(h) });
    try { pg.cleanup(); } catch (e) {}
  }
  const total = doc.numPages; try { await doc.destroy(); } catch (e) {}
  return { paginas: out, total };
}

const MESES = { ENERO: 1, FEBRERO: 2, MARZO: 3, ABRIL: 4, MAYO: 5, JUNIO: 6, JULIO: 7, AGOSTO: 8, SEPTIEMBRE: 9, SETIEMBRE: 9, OCTUBRE: 10, NOVIEMBRE: 11, DICIEMBRE: 12 };
const dias = (a, m) => new Date(Date.UTC(a, m, 0)).getUTCDate();
/** Fechas de un texto: [{ txt, d, m, a, valida, t (ms UTC) }] — dd/mm/aaaa, dd-mm-aaaa, dd.mm.aaaa y «12 de marzo de 2026». */
function fechasDe(texto) {
  const out = [], pon = (txt, d, m, a) => { d = +d; m = +m; a = +a; if (a < 100) a += 2000; if (a < 1990 || a > 2100) return; const valida = m >= 1 && m <= 12 && d >= 1 && d <= dias(a, m); out.push({ txt: txt.replace(/\s+/g, ' '), d, m, a, valida, t: valida ? Date.UTC(a, m - 1, d) : 0 }); };
  let m; const r1 = /(?<![\d\/.-])(\d{1,2})\s?([\/.-])\s?(\d{1,2})\s?\2\s?(\d{4})(?![\d\/-])/g; while ((m = r1.exec(texto))) pon(m[0], m[1], m[3], m[4]);
  const r2 = /\b(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|sep?tiembre|octubre|noviembre|diciembre)\s+(?:de|del)\s+(\d{4})\b/gi; while ((m = r2.exec(texto))) pon(m[0], m[1], MESES[norm(m[2])], m[3]);
  return out;
}
const fmt = (t) => { const d = new Date(t); return String(d.getUTCDate()).padStart(2, '0') + '/' + String(d.getUTCMonth() + 1).padStart(2, '0') + '/' + d.getUTCFullYear(); };
const RX_COD = /\b(\d{6})\s?-\s?([A-Z0-9]{3,6})\s?-\s?([A-Z0-9]{2,4})\s?-\s?([A-Z0-9]{2,4})\s?-\s?([A-Z]{2,4})\s?-\s?([A-Z0-9]{2,4})\s?-\s?([A-Z0-9]{1,3})\s?-\s?(\d{3,6})\b/g;
/** Lista de páginas compacta: 3, 5-9, 12 (máx. n tramos). */
function tramos(nums, max) {
  const a = [...new Set(nums)].sort((x, y) => x - y), out = []; let i = 0;
  while (i < a.length) { let j = i; while (j + 1 < a.length && a[j + 1] === a[j] + 1) j++; out.push(i === j ? '' + a[i] : a[i] + '-' + a[j]); i = j + 1; }
  return out.length > (max || 8) ? out.slice(0, max || 8).join(', ') + '… (' + a.length + ' páginas)' : out.join(', ');
}

/**
 * Comprueba el contenido. o: { paginas:[{n,texto,cab}], total, portada (datos de la QA: revision, emision, codigoPortada, filas, titulo…),
 * codigo (el del documento en el CDE), proyecto (código del proyecto), existe(codigo) → ¿ese documento está en el CDE? }
 * → { hallazgos:[{ nivel:'mal'|'aviso'|'ok', tema, titulo, detalle, paginas:[n…] }], fechas:{…}, referencias:[…], paginas:{…}, cubierto }
 */
function comprueba(o) {
  const P = o.paginas || [], pt = o.portada || {}, H = [], total = o.total || P.length;
  const pon = (nivel, tema, titulo, detalle, paginas, busca) => H.push({ nivel, tema, titulo, detalle: detalle || '', paginas: (paginas || []).slice(0, 60), busca });
  const rev = pt.revision || '', emi = pt.emision || '', cod = String(o.codigo || pt.codigoPortada || '').toUpperCase();
  // ── 1. encabezado de cada página ──
  const conCab = P.filter(p => /\bREVISION\s*:|\bPAGINA\s*:?\s*\d/.test(norm(p.cab)));
  if (P.length > 1) {
    const sinCab = P.filter(p => p.n > 1 && p.texto && !conCab.includes(p)).map(p => p.n);
    if (conCab.length <= 1) pon('aviso', 'encabezado', 'Las páginas interiores no llevan el cajetín', 'Solo la portada trae el encabezado de la plantilla (Revisión, Emisión, Página). No se puede comprobar la revisión página por página.');
    else {
      const revMal = [], emiMal = [], numMal = [], totMal = [];
      for (const p of conCab) {
        const c = norm(p.cab), r = (/\bREVISION\s*:\s*(R\s?\d{2})\b/.exec(c) || [])[1], e = (/\bEMISION\s*:\s*(\d{1,2}\s?[\/.-]\s?\d{1,2}\s?[\/.-]\s?\d{4})/.exec(c) || [])[1], pg = /\bPAGINA\s*:?\s*(\d+)\s*(?:DE|\/)\s*(\d+)/.exec(c);
        if (rev && r && r.replace(/\s/g, '') !== rev) revMal.push(p.n);
        if (emi && e && e.replace(/\s/g, '').replace(/[.-]/g, '/').split('/').map((x, i) => i < 2 ? x.padStart(2, '0') : x).join('/') !== emi) emiMal.push(p.n);
        if (pg) { if (+pg[1] !== p.n) numMal.push(p.n); if (+pg[2] !== total) totMal.push(p.n); }
      }
      pon(revMal.length ? 'mal' : 'ok', 'encabezado', 'Revisión del encabezado en todas las páginas', revMal.length ? 'La portada dice ' + rev + ', pero ' + revMal.length + ' página(s) llevan otra revisión en su encabezado.' : rev + ' en las ' + conCab.length + ' páginas con encabezado.', revMal, { rx: /\bREVISION\s*:/, mas: 3 });
      pon(emiMal.length ? 'mal' : 'ok', 'encabezado', 'Fecha de emisión del encabezado en todas las páginas', emiMal.length ? 'La portada dice ' + emi + ', pero ' + emiMal.length + ' página(s) llevan otra fecha de emisión.' : emi + ' en las páginas con encabezado.', emiMal, { rx: /\bEMISION\s*:/, mas: 3 });
      pon(numMal.length || totMal.length ? 'mal' : 'ok', 'paginas', 'Numeración de páginas', numMal.length || totMal.length ? (numMal.length ? numMal.length + ' página(s) con un número que no es su posición en el archivo. ' : '') + (totMal.length ? totMal.length + ' página(s) dicen un total distinto de las ' + total + ' que tiene el archivo.' : '') : '«Página k de ' + total + '» correlativa en las páginas con encabezado.', numMal.concat(totMal), { rx: /\bPAGINA\b/, mas: 4 });
      if (sinCab.length) pon('aviso', 'encabezado', 'Páginas sin el encabezado de la plantilla', sinCab.length + ' página(s) con texto no llevan el cajetín (pueden ser anexos, planos o separadores).', sinCab, { zona: 'cabecera' });
    }
  }
  // ── 2. páginas sin texto ──
  const vacias = P.filter(p => p.texto.replace(/\s/g, '').length < 20).map(p => p.n);
  if (vacias.length) pon('aviso', 'paginas', 'Páginas sin texto legible', vacias.length + ' de ' + total + ' página(s) son imagen (escaneadas) o están en blanco: su contenido no se puede buscar ni analizar.', vacias, { zona: 'pagina' });
  // ── 3. fechas ──
  const tEmi = (() => { const f = fechasDe(emi)[0]; return f && f.valida ? f.t : 0; })(), todas = [];
  for (const p of P) for (const f of fechasDe(p.texto)) todas.push(Object.assign(f, { pag: p.n }));
  const invalidas = todas.filter(f => !f.valida), validas = todas.filter(f => f.valida);
  if (invalidas.length) pon('mal', 'fechas', 'Fechas que no existen', [...new Set(invalidas.map(f => f.txt))].slice(0, 8).join(' · '), invalidas.map(f => f.pag), { porPagina: invalidas });
  const post = tEmi ? validas.filter(f => f.t > tEmi) : [];
  if (tEmi) pon(post.length ? 'aviso' : 'ok', 'fechas', 'Fechas posteriores a la emisión del documento', post.length ? 'El documento se emitió el ' + emi + ' y cita ' + [...new Set(post.map(f => f.txt))].length + ' fecha(s) posteriores: ' + [...new Set(post.map(f => f.txt))].slice(0, 8).join(' · ') + '. Revisa si son plazos o hitos futuros (válido) o un error.' : 'Ninguna de las ' + validas.length + ' fechas del documento es posterior a su emisión (' + emi + ').', post.map(f => f.pag), { porPagina: post });
  if (tEmi && tEmi > Date.now() + 86400e3) pon('mal', 'fechas', 'Emisión con fecha futura', 'La portada dice que se emitió el ' + emi + ', que todavía no llega.', [1], { rx: /\bEMISION\s*:/, mas: 3 });
  const filas = (pt.filas || []).map(f => ({ rev: f.rev, f: fechasDe(f.fecha || '')[0] })).filter(x => x.f && x.f.valida);
  if (filas.length > 1) { const des = filas.filter((x, i) => i > 0 && x.f.t < filas[i - 1].f.t).map(x => x.rev); pon(des.length ? 'mal' : 'ok', 'fechas', 'Cuadro de revisiones en orden de fecha', des.length ? 'La(s) revisión(es) ' + des.join(', ') + ' tienen fecha anterior a la revisión previa.' : filas.map(x => x.rev + ' ' + fmt(x.f.t)).join(' → '), des.length ? [1] : [], { textos: des }); }
  // ── 4. códigos ──
  const cods = new Map();   // código → páginas
  for (const p of P) { RX_COD.lastIndex = 0; let m; const t = p.texto.toUpperCase(); while ((m = RX_COD.exec(t))) { const c = m.slice(1, 9).join('-'); if (!cods.has(c)) cods.set(c, []); cods.get(c).push(p.n); } }
  const otros = [...cods.keys()].filter(c => c !== cod);
  if (cod) {
    const enCab = new Set(); for (const p of conCab) { RX_COD.lastIndex = 0; let m; const t = p.cab.toUpperCase(); while ((m = RX_COD.exec(t))) enCab.add(m.slice(1, 9).join('-')); }
    const parecidos = otros.filter(c => { const a = c.split('-'), b = cod.split('-'); return a.length === b.length && a.filter((x, i) => x !== b[i]).length === 1 && (enCab.has(c) || otros.length <= 2); });   // en una lista de entregables no es un error
    if (parecidos.length) pon('aviso', 'codigos', 'El código del documento aparece escrito distinto', 'El documento es ' + cod + ' y dentro aparece ' + parecidos.slice(0, 4).join(', ') + ' (difiere en un solo campo): puede ser otro documento de la serie o un error de tipeo.', parecidos.flatMap(c => cods.get(c)), { textos: parecidos });
    const fuera = P.filter(p => conCab.includes(p) && p.n > 1 && !p.texto.toUpperCase().replace(/\s?-\s?/g, '-').includes(cod)).map(p => p.n);
    if (cods.has(cod) && cods.get(cod).length > 3 && fuera.length) pon('aviso', 'codigos', 'Páginas sin el código del documento', 'El código ' + cod + ' se repite en el documento, pero falta en ' + fuera.length + ' página(s).', fuera, { zona: 'cabecera' });
  }
  const proy = String(o.proyecto || '');
  if (/^\d{6}$/.test(proy)) { const aj = otros.filter(c => c.slice(0, 6) !== proy); if (aj.length) pon('aviso', 'codigos', 'Cita documentos de otro proyecto', 'Este proyecto es el ' + proy + ' y el documento cita: ' + aj.slice(0, 6).join(', ') + (aj.length > 6 ? '…' : '') + '. Puede ser texto copiado de otro proyecto.', aj.flatMap(c => cods.get(c)), { textos: aj }); }
  const referencias = otros.filter(c => !/^\d{6}$/.test(proy) || c.slice(0, 6) === proy).slice(0, 60).map(c => ({ codigo: c, paginas: [...new Set(cods.get(c))].slice(0, 20), enCde: typeof o.existe === 'function' ? !!o.existe(c) : null }));
  const faltan = referencias.filter(r => r.enCde === false);
  if (referencias.length && typeof o.existe === 'function') pon(faltan.length ? 'aviso' : 'ok', 'referencias', 'Documentos citados', faltan.length ? faltan.length + ' de ' + referencias.length + ' documento(s) citados no están en el CDE: ' + faltan.slice(0, 6).map(r => r.codigo).join(', ') + (faltan.length > 6 ? '…' : '') + '.' : 'Los ' + referencias.length + ' documento(s) citados están en el CDE.', faltan.flatMap(r => r.paginas), { textos: faltan.map(r => r.codigo) });
  // ── 5. comentarios y marcas de revisión que quedaron en el archivo ──
  const conNotas = P.filter(p => p.notas > 0);
  if (conNotas.length) pon('aviso', 'contenido', 'El PDF trae comentarios o marcas de revisión', conNotas.reduce((n, p) => n + p.notas, 0) + ' nota(s), resaltado(s) o tachado(s) en ' + conNotas.length + ' página(s): un documento emitido no debería llevarlos.', conNotas.map(p => p.n), { notas: true });
  if (o.word && (o.word.cambios || o.word.comentarios)) pon('mal', 'contenido', 'El Word tiene control de cambios o comentarios', [o.word.cambios ? o.word.cambios + ' cambio(s) sin aceptar' : '', o.word.comentarios ? o.word.comentarios + ' comentario(s)' : ''].filter(Boolean).join(' y ') + ': acepta los cambios y quita los comentarios antes de emitirlo.');
  // ── 6. texto sin terminar ──
  const RX_PEND = /\b(POR DEFINIR|POR COMPLETAR|PENDIENTE DE (?:DEFINIR|COMPLETAR|CONFIRMAR)|LOREM IPSUM|ERROR! NO SE ENCUENTRA[A-Z ]{0,40}|REFERENCE SOURCE NOT FOUND|MARCADOR NO DEFINIDO)\b/g, vistos = new Set(), pend = [];
  for (const p of P) { if (p.n === 1) continue; const m = norm(p.texto).match(RX_PEND); if (m) { pend.push(p.n); m.forEach(x => vistos.add(x.trim().toLowerCase())); } }
  if (pend.length) pon('aviso', 'contenido', 'Texto sin terminar o referencias rotas', 'Se encontró «' + [...vistos].slice(0, 5).join('», «') + '» en ' + pend.length + ' página(s).', pend, { rx: new RegExp(RX_PEND.source) });
  // ── 7. estructura: índice ↔ cuerpo, secciones vacías, secciones que el documento debería enunciar ──
  let est = null; try { est = P.length > 1 ? estructura(P) : null; } catch (e) { est = null; }
  if (est && est.secciones.length >= 3) {
    if (est.indice >= 3) {
      pon(est.difs.length ? 'mal' : 'ok', 'estructura', 'Páginas del índice', est.difs.length ? est.difs.length + ' sección(es) no están en la página que dice el índice: ' + est.difs.slice(0, 5).map(d => d.num + ' (índice ' + d.indice + ', está en ' + d.real + ')').join(' · ') + (est.difs.length > 5 ? '…' : '') + '. Actualiza el índice.' : 'Las ' + est.indice + ' entradas del índice apuntan a la página correcta.', est.difs.map(d => d.real), { textos: est.difs.map(d => d.num + ' ' + d.titulo), inicio: true });
      if (est.faltan.length) pon('aviso', 'estructura', 'Secciones del índice que no se encontraron en el cuerpo', est.faltan.slice(0, 6).map(f => f.num + ' ' + f.titulo).join(' · ') + (est.faltan.length > 6 ? '…' : ''), est.paginasIndice, { textos: est.faltan.map(f => f.num + ' ' + f.titulo), inicio: true });
    } else pon('aviso', 'estructura', 'Documento sin índice', 'Tiene ' + est.secciones.length + ' secciones numeradas, pero no se encontró un índice con sus páginas.');
    if (est.vacias.length) pon('aviso', 'estructura', 'Secciones sin contenido', est.vacias.slice(0, 6).map(v => v.num + ' ' + v.titulo).join(' · ') + (est.vacias.length > 6 ? '…' : '') + ': tienen título pero no texto (puede ser solo una figura o tabla).', est.vacias.map(v => v.pagina), { textos: est.vacias.map(v => v.num + ' ' + v.titulo), inicio: true });
    if (!est.objetivo) pon('aviso', 'estructura', 'El documento no enuncia su objetivo', 'No hay una sección «Objetivo».');
    if (!est.conclusiones.length) pon('aviso', 'estructura', 'El documento no tiene conclusiones', 'No hay una sección de conclusiones ni de recomendaciones.');
  }
  // ── dónde está cada hallazgo: recuadros en la página (puntos PDF, origen arriba a la izquierda) para dibujarlos sobre el PDF ──
  const sinEsp = (t) => norm(t).replace(/[\s"“”«»]/g, '');
  const caja = (pg, l, its) => { if (!its || !its.length) return { pagina: pg.n, x: l.x, y: l.y, w: l.w, h: l.h, ancho: pg.ancho, alto: pg.alto }; const x0 = Math.min(...its.map(i => i.x)), x1 = Math.max(...its.map(i => i.x + i.w)); return { pagina: pg.n, x: x0, y: l.y, w: x1 - x0, h: l.h, ancho: pg.ancho, alto: pg.alto }; };
  const tramo = (l, prueba) => { const I = l.its || []; for (let n = 1; n <= I.length; n++) for (let a = 0; a + n <= I.length; a++) { if (prueba(I.slice(a, a + n))) return [a, a + n]; } return null; };
  const dondeEn = (pg, b, pag) => {
    if (b.zona === 'cabecera') return [{ pagina: pg.n, x: 0, y: 0, w: pg.ancho, h: pg.alto * 0.2, ancho: pg.ancho, alto: pg.alto, zona: true }];
    if (b.zona === 'pagina') return [{ pagina: pg.n, x: 0, y: 0, w: pg.ancho, h: pg.alto, ancho: pg.ancho, alto: pg.alto, zona: true }];
    if (b.notas) return (pg.notasRects || []).map(r => Object.assign({ pagina: pg.n, ancho: pg.ancho, alto: pg.alto }, r));
    if (!Array.isArray(pg.lineas)) return [];
    const L = b.rx && b.mas ? pg.lineas.filter(l => l.y < pg.alto * 0.22) : pg.lineas, out = [];
    const textos = b.porPagina ? b.porPagina.filter(f => f.pag === pag).map(f => f.txt) : (b.textos || []);
    for (const l of L) {
      if (b.rx) { if (!b.rx.test(norm(l.t))) continue; const r = tramo(l, (its) => b.rx.test(norm(its.map(i => i.s).join(' ')))); const its = r ? (l.its || []).slice(r[0], Math.min((l.its || []).length, r[1] + (b.mas || 0))) : null; out.push(caja(pg, l, its)); }
      else for (const t of textos) { const tn = sinEsp(t); if (!tn) continue; const ln = sinEsp(l.t); const al = (x) => x.replace(/[^A-Z0-9Ñ]/g, ''); if (b.inicio ? !al(ln).startsWith(al(tn).slice(0, Math.min(al(tn).length, 24))) : !ln.includes(tn)) continue; const r = b.inicio ? null : tramo(l, (its) => sinEsp(its.map(i => i.s).join('')).includes(tn)); out.push(caja(pg, l, r ? (l.its || []).slice(r[0], r[1]) : null)); }
      if (out.length >= 8) break;
    }
    return out;
  };
  for (const h of H) {
    const b = h.busca; delete h.busca; if (!b || h.nivel === 'ok') continue;
    const marcas = []; for (const n of [...new Set(h.paginas)].slice(0, 16)) { const pg = P.find(x => x.n === n); if (pg && pg.ancho) marcas.push(...dondeEn(pg, b, n)); if (marcas.length >= 24) break; }
    if (marcas.length) h.marcas = marcas.slice(0, 24).map(m => ({ pagina: m.pagina, x: Math.round(m.x * 10) / 10, y: Math.round(m.y * 10) / 10, w: Math.round(m.w * 10) / 10, h: Math.round(m.h * 10) / 10, ancho: m.ancho, alto: m.alto, zona: m.zona || undefined }));
  }
  const orden = { mal: 0, aviso: 1, ok: 2 }; H.sort((a, b) => orden[a.nivel] - orden[b.nivel]);
  return {
    v: 2, hallazgos: H, referencias, estructura: est && est.secciones.length >= 3 ? est : null,
    fechas: { emision: emi, total: validas.length, primera: validas.length ? fmt(Math.min(...validas.map(f => f.t))) : '', ultima: validas.length ? fmt(Math.max(...validas.map(f => f.t))) : '', posteriores: post.length, invalidas: invalidas.length },
    paginas: { total, analizadas: P.length, conEncabezado: conCab.length, sinTexto: vacias.length },
    cuenta: { mal: H.filter(h => h.nivel === 'mal').length, aviso: H.filter(h => h.nivel === 'aviso').length, ok: H.filter(h => h.nivel === 'ok').length }
  };
}

const RX_CAJ = /PRESIDENCIA DEL CONSEJO|AUTORIDAD NACIONAL DE INFRAESTRUCTURA|^\s*(CONTRATO|REGI[OÓ]N|Revisi[oó]n|Emisi[oó]n|P[aá]gina)\s*:?\s|^P[aá]gina\s*:?\s*\d/i;
const RX_TIT = /^(\d{1,2}(?:\.\d{1,2}){0,3})\.?\s+([A-ZÁÉÍÓÚÑ¿“"(].{2,110})$/;
/**
 * Estructura del documento leída de sus propios títulos numerados (sin IA): índice, secciones con su página y su texto, y de ahí el
 * objetivo, el alcance, la introducción y las conclusiones tal como el documento los enuncia. También compara el índice con el cuerpo.
 */
function estructura(P) {
  // el cajetín de arriba se repite en muchas páginas: solo esas líneas se quitan (un título que cae arriba de su página no)
  const frec = new Map(); for (const p of P) for (const t of new Set(String(p.cab || '').split('\n').map(x => x.trim()).filter(Boolean))) frec.set(t, (frec.get(t) || 0) + 1);
  const repite = (t) => (frec.get(t) || 0) >= Math.max(2, Math.ceil(P.length * 0.3));
  const L = []; for (const p of P) { const ls = p.texto.split('\n'); for (const t of ls) { if (RX_CAJ.test(t) || repite(t.trim())) continue;   // sin el cajetín que se repite arriba de cada página
      L.push({ t: t.trim(), p: p.n }); } }
  const esIndice = (t) => /(\.{5,}|…{3,}|(?:\. ){5,})\s*\d{1,4}\s*$/.test(t);
  const pagInd = new Set(); { const c = {}; for (const x of L) if (esIndice(x.t)) c[x.p] = (c[x.p] || 0) + 1; for (const k in c) if (c[k] >= 4) pagInd.add(+k); }
  // índice: número de sección → página anunciada
  const indice = []; for (const x of L) { if (!pagInd.has(x.p)) continue; const m = /^(\d{1,2}(?:\.\d{1,2}){0,3})\.?\s+(.+?)\s*(?:\.{3,}|…+|(?:\. ){3,})[\s.…]*(\d{1,4})\s*$/.exec(x.t); if (m) indice.push({ num: m[1], titulo: m[2].trim(), pagina: +m[3] }); }
  // títulos del cuerpo: numerados, fuera del índice, sin forma de frase, y en orden creciente respecto del anterior de su nivel
  const tit = []; const clave = (n) => n.split('.').map(Number);
  for (let i = 0; i < L.length; i++) {
    const x = L[i]; if (pagInd.has(x.p) || esIndice(x.t)) continue; const m = RX_TIT.exec(x.t); if (!m) continue;
    const txt = m[2].trim(); if (/[:;,]$|: /.test(txt) || /\.\s*$/.test(txt) && txt.split(' ').length > 15 || txt.split(' ').length > 18) continue;
    const k = clave(m[1]); if (k[0] === 0 || k[0] > 40) continue;
    const ant = tit[tit.length - 1];
    if (ant) { const a = clave(ant.num); const sigue = (k.length > a.length && k.slice(0, a.length).join('.') === a.join('.') && k[a.length] <= 2) || (k.length <= a.length && k.slice(0, -1).join('.') === a.slice(0, k.length - 1).join('.') && k[k.length - 1] - a[k.length - 1] >= 1 && k[k.length - 1] - a[k.length - 1] <= 2) || (k.length === 1 && k[0] - a[0] >= 1 && k[0] - a[0] <= 2); if (!sigue) continue; }
    else if (!(k.length === 1 && k[0] === 1)) continue;
    tit.push({ num: m[1], titulo: txt, pagina: x.p, i, nivel: k.length });
  }
  for (let j = 0; j < tit.length; j++) { const fin = j + 1 < tit.length ? tit[j + 1].i : L.length; tit[j].texto = L.slice(tit[j].i + 1, fin).map(x => x.t).filter(t => t && !esIndice(t)).join(' ').replace(/\s+/g, ' ').trim(); }
  const N = (t) => norm(t), busca = (rx, no) => tit.filter(t => rx.test(N(t.titulo)) && !(no && no.test(N(t.titulo))));
  const cuerpoDe = (t, max) => { let s = t.texto; if (s.length < 40) { const hijos = tit.filter(h => h.num.startsWith(t.num + '.')); s = hijos.map(h => h.texto).join(' '); } return s.slice(0, max || 700).replace(/\s+\S*$/, '') + (s.length > (max || 700) ? '…' : ''); };
  const obj = busca(/^OBJETIVOS?( GENERAL(ES)?)?( DEL (DOCUMENTO|PLAN|INFORME|PROYECTO|ESTUDIO))?$/)[0] || busca(/OBJETIVO GENERAL/)[0] || busca(/^OBJETIVOS?\b/)[0];
  const alc = busca(/^ALCANCES?\b/)[0], intro = busca(/^(INTRODUCCION|PRESENTACION|GENERALIDADES|ANTECEDENTES|RESUMEN EJECUTIVO)\b/)[0];
  const con = busca(/CONCLUSI|RECOMENDACI/);
  // índice ↔ cuerpo
  const difs = [], faltan = [];
  for (const e of indice) { const t = tit.find(x => x.num === e.num); if (!t) { if (e.num.split('.').length <= 2) faltan.push(e); } else if (t.pagina !== e.pagina) difs.push({ num: e.num, titulo: t.titulo, indice: e.pagina, real: t.pagina }); }
  const vacias = tit.filter((t, j) => t.texto.length < 15 && !(tit[j + 1] && tit[j + 1].num.startsWith(t.num + '.')));
  return {
    secciones: tit.map(t => ({ num: t.num, titulo: t.titulo, pagina: t.pagina, nivel: t.nivel, caracteres: t.texto.length })), indice: indice.length, paginasIndice: [...pagInd],
    objetivo: obj ? { texto: cuerpoDe(obj, 700), pagina: obj.pagina, seccion: obj.num + ' ' + obj.titulo } : null,
    alcance: alc ? { texto: cuerpoDe(alc, 600), pagina: alc.pagina, seccion: alc.num + ' ' + alc.titulo } : null,
    introduccion: intro ? { texto: cuerpoDe(intro, 600), pagina: intro.pagina, seccion: intro.num + ' ' + intro.titulo } : null,
    conclusiones: con.slice(0, 4).map(t => ({ texto: cuerpoDe(t, 500), pagina: t.pagina, seccion: t.num + ' ' + t.titulo })).filter(x => x.texto),
    difs, faltan: faltan.slice(0, 20), vacias: vacias.map(t => ({ num: t.num, titulo: t.titulo, pagina: t.pagina }))
  };
}

/** Análisis de un archivo (hoy, PDF; de un Word solo la portada y las fechas del texto). o: { codigo, proyecto, existe, texto } */
async function analiza(buf, archivo, o) {
  o = o || {}; const ext = String(archivo || '').split('.').pop().toLowerCase();
  let portada = {}; try { const qa = await QA.validaArchivo(buf, archivo, {}); portada = qa.datos || {}; } catch (e) {}
  if (ext === 'pdf') {
    const { paginas, total } = await paginasPdf(buf);
    return Object.assign(comprueba({ paginas, total, portada, codigo: o.codigo, proyecto: o.proyecto, existe: o.existe }), { tipo: 'pdf', portada: { titulo: portada.titulo || '', revision: portada.revision || '', emision: portada.emision || '', codigo: portada.codigoPortada || '', elabPor: portada.elabPor || '' }, textoPorPagina: paginas.map(p => '[pág. ' + p.n + ']\n' + p.texto).join('\n\n') });
  }
  let word = null;
  if (ext === 'docx') { try { const R = require('./resumen'), ents = R.entradasZip(buf), lee = (n) => { const e = ents.find(x => x.nombre === n); return e ? R.leeZip(buf, e).toString('utf8') : ''; }; const d = lee('word/document.xml'), c = lee('word/comments.xml'); word = { cambios: (d.match(/<w:(ins|del) /g) || []).length, comentarios: (c.match(/<w:comment /g) || []).length }; } catch (e) {} }
  if (o.texto) return Object.assign(comprueba({ word, paginas: [{ n: 1, texto: o.texto, cab: '' }], total: 1, portada, codigo: o.codigo, proyecto: o.proyecto, existe: o.existe }), { tipo: ext, sinPaginas: true, portada: { titulo: portada.titulo || '', revision: portada.revision || '', emision: portada.emision || '', codigo: portada.codigoPortada || '', elabPor: portada.elabPor || '' } });
  return null;
}

module.exports = { analiza, comprueba, estructura, fechasDe, paginasPdf, tramos };
