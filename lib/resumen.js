/*
 * RESUMEN AUTOMATICO DE CADA ARCHIVO CARGADO (lo pidio Erick: "de que trata, ideas principales, objetivo y conclusiones").
 *   1) Se extrae el TEXTO del archivo sin librerias externas: PDF (flujos FlateDecode + operadores Tj/TJ; si el PDF usa fuentes
 *      CID sin texto legible, se dice), DOCX/XLSX/PPTX (ZIP + XML), TXT/MD/CSV/JSON. RVT/DWG/IFC/NWD no tienen texto: el resumen
 *      sale de los metadatos (nombre, campos de la nomenclatura, tamano, indice del visor si existe).
 *      Si el lector propio no saca texto de un PDF (fuentes CID, codificaciones raras), se recurre a pdf.js, el MISMO que ya usa el
 *      visor de marcas en el navegador (public/vendor/pdf.min.js), cargado en Node: sin dependencias nuevas.
 *   2) Si hay clave de IA (ANTHROPIC_API_KEY o IA_CLAVE en cde.env; modelo IA_MODELO), Claude redacta el resumen en JSON.
 *      Sin clave: un resumen "por texto" (primeras ideas, frases con objetivo/conclusion) para que algo haya siempre.
 *   3) Se guarda en versiones.resumen y se muestra en la ficha, en la columna Descripcion y en el informe de transmision.
 * Corre en segundo plano (cola de uno en uno) para no retrasar la carga. POST .../versiones/:vid/resumen lo rehace a mano.
 */
'use strict';
const zlib = require('zlib');
const { q, ahora, json, audita } = require('./bd');

const MAX_TEXTO = 60000;

// ---------- ZIP minimo (docx/xlsx/pptx): directorio central + inflateRaw ----------
function entradasZip(buf) {
  const out = [];
  let eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])); if (eocd < 0) return out;
  const n = buf.readUInt16LE(eocd + 10), cdOff = buf.readUInt32LE(eocd + 16);
  let p = cdOff;
  for (let i = 0; i < n && p + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const metodo = buf.readUInt16LE(p + 10), comp = buf.readUInt32LE(p + 20), nLen = buf.readUInt16LE(p + 28), eLen = buf.readUInt16LE(p + 30), cLen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const nombre = buf.toString('utf8', p + 46, p + 46 + nLen);
    out.push({ nombre, metodo, comp, off }); p += 46 + nLen + eLen + cLen;
  }
  return out;
}
function leeZip(buf, e) {
  const p = e.off; if (buf.readUInt32LE(p) !== 0x04034b50) return null;
  const nLen = buf.readUInt16LE(p + 26), eLen = buf.readUInt16LE(p + 28), ini = p + 30 + nLen + eLen, datos = buf.subarray(ini, ini + e.comp);
  try { return e.metodo === 8 ? zlib.inflateRawSync(datos) : e.metodo === 0 ? datos : null; } catch (err) { return null; }
}
const sinXml = (x) => String(x || '').replace(/<w:p[ >]/g, '\n<w:p ').replace(/<\/a:p>|<\/p>/g, '\n').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d)).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
function textoOffice(buf, ext) {
  const ents = entradasZip(buf), partes = [];
  const toma = (re) => ents.filter(e => re.test(e.nombre)).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true }));
  if (ext === 'docx') for (const e of toma(/^word\/(document|footnotes|endnotes)\.xml$/)) { const b = leeZip(buf, e); if (b) partes.push(sinXml(b.toString('utf8'))); }
  else if (ext === 'pptx') for (const e of toma(/^ppt\/slides\/slide\d+\.xml$/)) { const b = leeZip(buf, e); if (b) partes.push(sinXml(b.toString('utf8'))); }
  else if (ext === 'xlsx' || ext === 'xlsm') {
    const ss = toma(/^xl\/sharedStrings\.xml$/)[0]; let cadenas = [];
    if (ss) { const b = leeZip(buf, ss); if (b) cadenas = [...b.toString('utf8').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => sinXml(m[1])); }
    partes.push(cadenas.slice(0, 4000).join(' · '));
    for (const e of toma(/^xl\/worksheets\/sheet\d+\.xml$/).slice(0, 6)) { const b = leeZip(buf, e); if (!b) continue; const nums = [...b.toString('utf8').matchAll(/<v>([^<]{1,30})<\/v>/g)].slice(0, 300).map(m => m[1]); if (nums.length) partes.push('Valores: ' + nums.join(', ')); }
  }
  return partes.join('\n').slice(0, MAX_TEXTO);
}

// ---------- PDF: flujos inflados + operadores de texto ----------
function textoPdf(buf) {
  const s = buf.toString('latin1'); const partes = []; let total = 0, flujos = 0, ilegibles = 0;
  const re = /stream\r?\n/g; let m;
  while ((m = re.exec(s)) && total < MAX_TEXTO) {
    const ini = m.index + m[0].length, fin = s.indexOf('endstream', ini); if (fin < 0) break;
    const cab = s.slice(Math.max(0, m.index - 400), m.index);
    if (!/FlateDecode/.test(cab) || /\/Subtype\s*\/Image|\/XObject|\/FontFile|\/ObjStm|\/XRef/.test(cab)) { re.lastIndex = fin; continue; }
    let txt = ''; try { txt = zlib.inflateSync(buf.subarray(ini, fin)).toString('latin1'); } catch (e) { try { txt = zlib.inflateSync(buf.subarray(ini, fin - 2)).toString('latin1'); } catch (e2) { re.lastIndex = fin; continue; } }
    if (!/\b(Tj|TJ)\b/.test(txt)) { re.lastIndex = fin; continue; }
    flujos++;
    const trozos = [];
    for (const t of txt.matchAll(/\[((?:[^\]\\]|\\.)*)\]\s*TJ|\(((?:[^)\\]|\\.)*)\)\s*Tj|<([0-9A-Fa-f]+)>\s*Tj|\b(Td|TD|T\*|ET)\b/g)) {
      if (t[4] !== undefined) { trozos.push(' '); continue; }
      if (t[1] !== undefined) { const cad = [...t[1].matchAll(/\(((?:[^)\\]|\\.)*)\)|(-?\d+\.?\d*)/g)].map(x => x[1] !== undefined ? desPdf(x[1]) : (+x[2] < -200 ? ' ' : '')).join(''); trozos.push(cad); }
      else if (t[2] !== undefined) trozos.push(desPdf(t[2]));
      else if (t[3] !== undefined) { ilegibles++; }
    }
    const linea = trozos.join('').replace(/\s+/g, ' ').trim();
    if (linea) { partes.push(linea); total += linea.length; }
    re.lastIndex = fin;
  }
  let texto = partes.join('\n').slice(0, MAX_TEXTO);
  const legible = texto.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ ]/g, '').length / Math.max(1, texto.length);
  if (texto.length < 40 || legible < 0.5) return { texto: '', nota: flujos ? 'El PDF lleva el texto con fuentes codificadas (CID) o es un escaneo: no se pudo leer el contenido; el resumen sale del nombre y de la ficha.' : 'El PDF no tiene texto extraible (escaneo o solo graficos).' };
  return { texto, nota: ilegibles ? 'Parte del texto del PDF va en fuentes codificadas y no se pudo leer.' : '' };
}
function desPdf(s) { return s.replace(/\\\(/g, '(').replace(/\\\)/g, ')').replace(/\\n/g, ' ').replace(/\\r/g, '').replace(/\\t/g, ' ').replace(/\\(\d{3})/g, (m, o) => String.fromCharCode(parseInt(o, 8))).replace(/\\\\/g, '\\'); }

/** Texto plano de una version segun su extension. { texto, nota, tipo } */
function extraeTexto(buf, archivo) {
  const ext = String(archivo || '').split('.').pop().toLowerCase();
  if (['txt', 'md', 'csv', 'json', 'xml', 'html', 'htm', 'log', 'ifc'].includes(ext)) { let t = buf.toString('utf8').slice(0, MAX_TEXTO); if (ext === 'html' || ext === 'htm' || ext === 'xml') t = sinXml(t); if (ext === 'ifc') t = t.split('\n').filter(l => /^(FILE_DESCRIPTION|FILE_NAME|#\d+= ?IFCPROJECT|#\d+= ?IFCBUILDING\b|#\d+= ?IFCSITE)/.test(l)).join('\n').slice(0, 4000); return { texto: t, nota: '', tipo: 'texto' }; }
  if (['docx', 'pptx', 'xlsx', 'xlsm'].includes(ext)) { const t = textoOffice(buf, ext); return { texto: t, nota: t ? '' : 'No se pudo leer el contenido del archivo Office.', tipo: 'office' }; }
  if (ext === 'pdf') return Object.assign(textoPdf(buf), { tipo: 'pdf' });
  return { texto: '', nota: 'Archivo binario (' + ext.toUpperCase() + '): sin texto que leer; el resumen sale del nombre, los campos ISO 19650 y el indice del modelo si existe.', tipo: 'binario' };
}

/** Segundo intento para PDF: pdf.js (el del visor) corriendo en Node. Devuelve '' si tampoco hay texto (PDF escaneado, p. ej.). */
let PDFJS = null;
async function textoPdfJs(buf) {
  try {
    if (!PDFJS) { for (const k of ['DOMMatrix', 'Path2D', 'ImageData']) if (!globalThis[k]) globalThis[k] = class {}; PDFJS = require('../public/vendor/pdf.min.js'); PDFJS.GlobalWorkerOptions.workerSrc = require('path').resolve(__dirname, '../public/vendor/pdf.worker.min.js'); }
    const doc = await PDFJS.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise;
    let t = '';
    for (let i = 1; i <= doc.numPages && t.length < MAX_TEXTO; i++) { const pg = await doc.getPage(i); const c = await pg.getTextContent(); t += c.items.map(x => x.str).join(' ').replace(/\s+/g, ' ').trim() + '\n'; }
    try { await doc.destroy(); } catch (e) {}
    return t.replace(/[\x00-\x08]/g, '').trim();
  } catch (e) { return ''; }
}

// ---------- resumen "por texto" (sin IA) ----------
function resumenPorTexto(texto, ctx) {
  const frases = texto.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ0-9])/).map(f => f.trim()).filter(f => f.length > 40 && f.length < 400);
  const busca = (re, n) => frases.filter(f => re.test(f)).slice(0, n);
  const objetivo = busca(/\b(objetivo|finalidad|prop[oó]sito|tiene por objeto|el presente|se busca)\b/i, 2);
  const conclus = busca(/\b(conclusi[oó]n|se concluye|en conclusi[oó]n|recomendaci[oó]n|se recomienda|resultado)\b/i, 3);
  const ideas = frases.filter(f => !objetivo.includes(f) && !conclus.includes(f)).slice(0, 5);
  const titulo = (texto.split('\n').map(l => l.trim()).find(l => l.length > 12 && l.length < 140) || '');
  return { descripcion: (titulo ? titulo + '. ' : '') + (frases[0] || '').slice(0, 300), ideas: ideas.map(f => f.slice(0, 220)), objetivo: objetivo.join(' ').slice(0, 400) || (ctx.esModelo ? 'Modelo BIM: ' + ctx.descripcionTecnica : ''), conclusiones: conclus.join(' ').slice(0, 500) || '', fuente: 'texto' };
}

// ---------- IA (Claude) ----------
async function resumenIA(texto, ctx, env, fetchFn) {
  const clave = (env.ANTHROPIC_API_KEY || env.IA_CLAVE || '').trim(); if (!clave) return null;
  const modelo = (env.IA_MODELO || 'claude-sonnet-4-6').trim();
  const prompt = 'Eres el asistente documental del CDE de la Autoridad Nacional de Infraestructura (ANIN, Peru). Resume el archivo de un proyecto de infraestructura hospitalaria. Responde SOLO con un JSON con las claves: descripcion (2-3 frases: de que trata), ideas (lista de 3 a 6 ideas principales, frases cortas), objetivo (1-2 frases), conclusiones (2-4 frases; si el documento no tiene conclusiones, di que no las enuncia y resume su cierre). Escribe en espanol, sin inventar datos que no esten en el texto; si el texto es escaso, dilo.\n\nArchivo: ' + ctx.archivo + '\nTipo: ' + ctx.tipo + (ctx.campos ? '\nCampos ISO 19650 del nombre: ' + ctx.campos : '') + (ctx.descripcionTecnica ? '\nDatos tecnicos: ' + ctx.descripcionTecnica : '') + (ctx.nota ? '\nNota: ' + ctx.nota : '') + '\n\nTEXTO:\n' + (texto || '(sin texto extraible)').slice(0, 45000);
  const r = await (fetchFn || fetch)('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': clave, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: modelo, max_tokens: 900, messages: [{ role: 'user', content: prompt }] }) });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error('La IA respondio ' + r.status + ': ' + String((j && j.error && j.error.message) || '').slice(0, 200));
  const txt = ((j && j.content) || []).filter(x => x.type === 'text').map(x => x.text).join('\n');
  const m = /\{[\s\S]*\}/.exec(txt); if (!m) throw new Error('La IA no devolvio JSON.');
  const o = JSON.parse(m[0]);
  return { descripcion: String(o.descripcion || '').slice(0, 1200), ideas: (Array.isArray(o.ideas) ? o.ideas : [o.ideas]).filter(Boolean).map(x => String(x).slice(0, 300)).slice(0, 8), objetivo: String(o.objetivo || '').slice(0, 800), conclusiones: String(o.conclusiones || '').slice(0, 1200), fuente: 'ia', modelo };
}

function monta(app, ctx) {
  const { requiereSesion, requiereRol, almacen, express } = ctx, env = ctx.env || process.env;
  const J = express.json({ limit: '1mb' });
  const cola = []; let corriendo = false;
  const guarda = (vid, r) => q.corre('UPDATE versiones SET resumen = ? WHERE id = ?', JSON.stringify(Object.assign({ fecha: ahora() }, r)), vid);
  async function genera(pid, cid, vid) {
    const v = q.uno('SELECT v.*, c.nombre AS contenedor, c.tipo AS tipoc, c.campos FROM versiones v JOIN contenedores c ON c.id = v.contenedor_id WHERE v.id = ?', vid); if (!v) return null;
    guarda(vid, { estado: 'generando' });
    const extV = String(v.archivo || '').split('.').pop().toLowerCase(), esModelo3d = ['ifc', 'rvt', 'nwd', 'nwc', 'nwf', 'rfa', 'dwg', 'dgn'].includes(extV);
    let buf = null; try { if (!esModelo3d && almacen.existe(v.ruta_almacen) && v.tamano <= 80 * 1024 * 1024) buf = require('fs').readFileSync(almacen.rutaAbsoluta(v.ruta_almacen)); } catch (e) {}
    // un modelo no se resume por su texto (el IFC es codigo STEP): se describe con su cabecera y con lo que trae su indice
    let cabecera = '';
    if (extV === 'ifc') { try { const fd = require('fs').openSync(almacen.rutaAbsoluta(v.ruta_almacen), 'r'), b = Buffer.alloc(6000); require('fs').readSync(fd, b, 0, 6000, 0); require('fs').closeSync(fd); const h = b.toString('latin1'); const esq = (/FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/.exec(h) || [])[1] || ''; const fn = (/FILE_NAME\s*\(([\s\S]*?)\);/.exec(h) || [])[1] || '', cads = [...fn.matchAll(/'([^']*)'/g)].map(m => m[1]), app = cads.length >= 2 ? cads[cads.length - 2] : ''; /* originating_system: la penultima cadena */ cabecera = [esq, app ? 'exportado desde ' + app : ''].filter(Boolean).join(', '); } catch (e) {} }
    const ex = esModelo3d ? { texto: '', nota: '', tipo: 'modelo' } : buf ? extraeTexto(buf, v.archivo) : { texto: '', nota: 'Archivo demasiado grande o no disponible para leer.', tipo: 'binario' };
    if (ex.tipo === 'pdf' && !ex.texto) { const t = await textoPdfJs(buf); if (t) { ex.texto = t; ex.nota = ''; } }
    const idx = q.uno('SELECT resumen FROM indices_modelo WHERE version_id = ?', vid), res = idx ? json(idx.resumen, {}) : null;
    const campos = Object.entries(json(v.campos, {})).map(([k, x]) => k + '=' + x).join(', ');
    const lista = (x) => (Array.isArray(x) ? x : Object.entries(x || {}));   // [[nombre, n], ...]
    const tecnica = res && res.elementos ? 'modelo BIM con ' + Number(res.elementos).toLocaleString('es-PE') + ' elementos' + (res.niveles && lista(res.niveles).length ? ' en ' + lista(res.niveles).length + ' nivel(es) (' + lista(res.niveles).slice(0, 8).map(x => x[0]).join(', ') + ')' : '') + (res.categorias ? '; categorías principales: ' + lista(res.categorias).slice(0, 10).map(x => x[0] + ' (' + Number(x[1]).toLocaleString('es-PE') + ')').join(', ') : '') : '';
    const c = { archivo: v.archivo, tipo: v.tipoc, campos, nota: ex.nota, descripcionTecnica: tecnica, esModelo: v.tipoc === 'modelo' };
    let r = null, error = '';
    try { r = await resumenIA(ex.texto, c, env, ctx.fetch); } catch (e) { error = e.message; }
    if (!r) { r = ex.texto ? resumenPorTexto(ex.texto, c) : { descripcion: (c.esModelo || esModelo3d ? 'Modelo BIM ' : 'Archivo ') + v.archivo + (cabecera ? ' (' + cabecera + ')' : '') + (campos ? ' (' + campos + ')' : '') + (tecnica ? ': ' + tecnica : '') + '.', ideas: res && res.familias ? lista(res.familias).slice(0, 6).map(x => x[0] + ': ' + Number(x[1]).toLocaleString('es-PE') + ' elemento(s)') : [], objetivo: '', conclusiones: '', fuente: 'ficha' }; r.nota = ex.nota + (error ? ' IA no disponible: ' + error : ''); }
    else r.nota = ex.nota;
    r.estado = 'listo'; r.caracteres = ex.texto.length; guarda(vid, r);
    try { q.corre('UPDATE versiones SET texto = ? WHERE id = ?', String(ex.texto || '').slice(0, 400000), vid); } catch (e) {}   // v0.6.2: el texto queda para la busqueda en el contenido
    audita('sistema', 'version.resumen', pid, v.contenedor, { version: v.n, fuente: r.fuente, caracteres: ex.texto.length });
    return r;
  }
  async function bombea() { if (corriendo) return; corriendo = true; while (cola.length) { const x = cola.shift(); try { await genera(x.pid, x.cid, x.vid); } catch (e) { try { guarda(x.vid, { estado: 'error', nota: e.message }); } catch (e2) {} } } corriendo = false; }
  const encola = (pid, cid, vid) => { if (env.RESUMEN_AUTOMATICO === '0') return; cola.push({ pid, cid, vid }); setTimeout(bombea, 50); };
  app.get('/api/proyectos/:pid/versiones/:vid/resumen', requiereSesion, requiereRol('lector'), (req, res) => {
    const v = q.uno('SELECT v.resumen, v.n, v.archivo FROM versiones v JOIN contenedores c ON c.id = v.contenedor_id WHERE v.id = ? AND c.proyecto_id = ?', req.params.vid, req.pid); if (!v) return res.status(404).json({ error: 'no-existe' });
    res.json({ resumen: json(v.resumen, {}), n: v.n, archivo: v.archivo, ia: !!(env.ANTHROPIC_API_KEY || env.IA_CLAVE) });
  });
  app.post('/api/proyectos/:pid/versiones/:vid/resumen', requiereSesion, requiereRol('autor'), J, async (req, res) => {
    const v = q.uno('SELECT v.id, c.id AS cid FROM versiones v JOIN contenedores c ON c.id = v.contenedor_id WHERE v.id = ? AND c.proyecto_id = ?', req.params.vid, req.pid); if (!v) return res.status(404).json({ error: 'no-existe' });
    try { const r = await genera(req.pid, v.cid, v.id); res.json({ ok: true, resumen: r }); } catch (e) { res.status(500).json({ error: 'resumen', mensaje: e.message }); }
  });
  ctx.resumenes = { encola, genera };
  return ctx.resumenes;
}

module.exports = { monta, extraeTexto, textoPdfJs, resumenPorTexto, resumenIA, entradasZip, textoPdf };
