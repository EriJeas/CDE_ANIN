/* DOCUMENTOS DE TEXTO EN EL VISUALIZADOR (Word, PowerPoint, texto plano).
 * El archivo se abre con lo que el visor ya tiene: fichaZip() (el lector de ZIP de SheetJS), fichaDecodifica(), fichaXmlTexto() y
 * fichaTextoPptx() de buscador.js. Aqui solo se PINTA: el Word, respetando titulos, negritas, cursivas, listas, tablas e imagenes
 * de su document.xml; el PowerPoint, una tarjeta por diapositiva; el texto, tal cual. Buscador con ‹ › y zoom. */
'use strict';
const DOC = { zoom: 1, hits: [], i: -1 };
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const docHijos = (el, local) => [...el.children].filter(c => c.localName === local);
const docHijo = (el, local) => docHijos(el, local)[0] || null;
const docAttr = (el, local) => { if (!el) return ''; for (const a of el.attributes) if (a.localName === local) return a.value; return ''; };

/** Word: document.xml -> HTML (parrafos con su estilo, tablas, imagenes incrustadas). Lo usan este visualizador y la ventana de marcas e incidencias. */
async function docAbreWord(buf, nombre) {
  const w = docWordHtml(buf);
  docPinta('<div class="docpapel">' + w.html + '</div>', nombre + ' · ' + w.palabras.toLocaleString('es-PE') + ' palabras');
}
function docWordHtml(buf) {
  const zip = fichaZip(buf), de = (ruta) => zip.find(a => a.ruta === ruta);
  const doc = de('word/document.xml'); if (!doc) throw new Error('no parece un .docx valido');
  const xml = new DOMParser().parseFromString(fichaDecodifica(doc.datos), 'application/xml');
  // relaciones (imagenes) y estilos (cuales son titulos)
  const rels = {}; const rl = de('word/_rels/document.xml.rels');
  if (rl) for (const r of new DOMParser().parseFromString(fichaDecodifica(rl.datos), 'application/xml').getElementsByTagName('Relationship')) rels[r.getAttribute('Id')] = r.getAttribute('Target');
  const nivelDe = {}, listaDe = {}; const st = de('word/styles.xml');
  if (st) for (const s of new DOMParser().parseFromString(fichaDecodifica(st.datos), 'application/xml').getElementsByTagNameNS(W_NS, 'style')) { const id = docAttr(s, 'styleId'), nom = docAttr(docHijo(s, 'name'), 'val') || id, ol = docHijo(docHijo(s, 'pPr') || s, 'outlineLvl'); if (docHijo(s, 'pPr') && docHijo(docHijo(s, 'pPr'), 'numPr') || /^list\s*(bullet|number|paragraph\s*\d)|^lista con|^vi[ñn]eta/i.test(nom)) listaDe[id] = true; const m = /^(heading|t[ií]tulo|titulo)\s*(\d)/i.exec(nom); if (ol && docAttr(ol, 'val') !== '') nivelDe[id] = +docAttr(ol, 'val') + 1; else if (m) nivelDe[id] = +m[2]; else if (/^(title|t[ií]tulo)$/i.test(nom)) nivelDe[id] = 1; }
  const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml' };
  const imagen = (rid) => { const t = rels[rid]; if (!t) return ''; const a = de('word/' + t.replace(/^\/?(word\/)?/, '')); const e = (t.split('.').pop() || '').toLowerCase(); if (!a || !MIME[e]) return '<span class="docsinimg">[imagen ' + esc(e.toUpperCase()) + ']</span>'; return '<img src="' + URL.createObjectURL(new Blob([a.datos], { type: MIME[e] })) + '" alt="">'; };
  const corrida = (r) => {
    const pr = docHijo(r, 'rPr'), on = (n) => { const x = pr && docHijo(pr, n); return !!x && docAttr(x, 'val') !== '0' && docAttr(x, 'val') !== 'false' && docAttr(x, 'val') !== 'none'; };
    let h = '';
    for (const c of r.children) {
      if (c.localName === 't') h += esc(c.textContent); else if (c.localName === 'tab') h += '&emsp;'; else if (c.localName === 'br' || c.localName === 'cr') h += docAttr(c, 'type') === 'page' ? '<hr class="docsalto">' : '<br>';
      else if (c.localName === 'drawing' || c.localName === 'pict') { for (const b of c.getElementsByTagName('*')) if (b.localName === 'blip' || b.localName === 'imagedata') { const rid = docAttr(b, 'embed') || docAttr(b, 'id'); if (rid) h += imagen(rid); } }
    }
    if (!h) return '';
    if (on('b')) h = '<b>' + h + '</b>'; if (on('i')) h = '<i>' + h + '</i>'; if (on('u')) h = '<u>' + h + '</u>'; if (on('strike')) h = '<s>' + h + '</s>';
    const col = pr && docHijo(pr, 'color'), cv = col ? docAttr(col, 'val') : ''; if (/^[0-9a-f]{6}$/i.test(cv) && !/^(000000|ffffff)$/i.test(cv)) h = '<span style="color:#' + cv + '">' + h + '</span>';
    const va = pr && docHijo(pr, 'vertAlign'); if (va) h = docAttr(va, 'val') === 'superscript' ? '<sup>' + h + '</sup>' : docAttr(va, 'val') === 'subscript' ? '<sub>' + h + '</sub>' : h;
    return h;
  };
  const parrafo = (p) => {
    const pr = docHijo(p, 'pPr'), est = pr ? docAttr(docHijo(pr, 'pStyle'), 'val') : '', niv = nivelDe[est] || 0, lista = !!(pr && docHijo(pr, 'numPr')) || !!listaDe[est], jc = pr ? docAttr(docHijo(pr, 'jc'), 'val') : '';
    let h = ''; const anda = (n) => { for (const c of n.children) { if (c.localName === 'r') h += corrida(c); else if (c.localName === 'hyperlink' || c.localName === 'ins' || c.localName === 'smartTag' || c.localName === 'sdt' || c.localName === 'sdtContent') anda(c); } }; anda(p);
    const al = jc === 'center' ? ' style="text-align:center"' : jc === 'right' || jc === 'end' ? ' style="text-align:right"' : jc === 'both' ? ' style="text-align:justify"' : '';
    if (niv) return '<h' + Math.min(6, niv) + al + '>' + (h || '&nbsp;') + '</h' + Math.min(6, niv) + '>';
    if (lista) { const np = pr && docHijo(pr, 'numPr'), lv = np ? +(docAttr(docHijo(np, 'ilvl'), 'val') || 0) : 0; return '<p class="doclista" style="margin-left:' + (22 + lv * 22) + 'px">' + (h || '&nbsp;') + '</p>'; }
    return '<p' + al + '>' + (h || '&nbsp;') + '</p>';
  };
  const tabla = (t) => '<table class="doctbl">' + docHijos(t, 'tr').map(tr => '<tr>' + docHijos(tr, 'tc').map(tc => { const pr = docHijo(tc, 'tcPr'), gs = pr ? docAttr(docHijo(pr, 'gridSpan'), 'val') : '', vm = pr && docHijo(pr, 'vMerge'), sh = pr ? docAttr(docHijo(pr, 'shd'), 'fill') : ''; if (vm && docAttr(vm, 'val') !== 'restart') return '<td class="docvm"' + (gs ? ' colspan="' + gs + '"' : '') + '></td>'; return '<td' + (gs ? ' colspan="' + gs + '"' : '') + (/^[0-9a-f]{6}$/i.test(sh) && !/^ffffff$/i.test(sh) ? ' style="background:#' + sh + '"' : '') + '>' + cuerpo(tc) + '</td>'; }).join('') + '</tr>').join('') + '</table>';
  const cuerpo = (n) => [...n.children].map(c => c.localName === 'p' ? parrafo(c) : c.localName === 'tbl' ? tabla(c) : c.localName === 'sdt' ? cuerpo(docHijo(c, 'sdtContent') || c) : '').join('');
  const body = xml.getElementsByTagNameNS(W_NS, 'body')[0]; if (!body) throw new Error('el documento no trae cuerpo');
  const html = cuerpo(body), palabras = (body.textContent || '').split(/\s+/).filter(Boolean).length;
  return { html, palabras };
}
/** PowerPoint (o cualquier lista de { rotulo, texto } de los lectores del visor): una tarjeta por diapositiva. */
function docAbrePartes(partes, nombre, que) {
  if (!partes.length) throw new Error('no trae ' + que + 's con texto');
  docPinta(partes.map(p => '<div class="docpapel docdiapo"><div class="docrot">' + esc(p.rotulo) + '</div>' + (p.texto ? esc(p.texto).split(/\n+/).map((l, i) => i === 0 ? '<h3>' + l + '</h3>' : '<p>' + l + '</p>').join('') : '<p class="hint">(sin texto: solo imágenes o gráficos)</p>') + '</div>').join(''), nombre + ' · ' + partes.length + ' ' + que + (partes.length === 1 ? '' : 's'));
}
function docAbreTexto(txt, nombre) { docPinta('<div class="docpapel"><pre class="docpre">' + esc(txt.length > 2000000 ? txt.slice(0, 2000000) + '\n\n… (se muestran los primeros 2 MB)' : txt) + '</pre></div>', nombre + ' · ' + txt.split('\n').length.toLocaleString('es-PE') + ' líneas'); }

function docPinta(html, titulo) {
  const H = document.getElementById('docHoja'); H.innerHTML = html; document.getElementById('docTitulo').textContent = titulo; DOC.zoom = 1; H.style.zoom = 1;
  const B = document.getElementById('docBuscar'), C = document.getElementById('docCuenta');
  const limpia = () => { H.querySelectorAll('mark.dochit').forEach(m => { m.replaceWith(document.createTextNode(m.textContent)); }); H.normalize(); DOC.hits = []; DOC.i = -1; };
  const ir = (d) => { if (!DOC.hits.length) return; DOC.i = (DOC.i + d + DOC.hits.length) % DOC.hits.length; DOC.hits.forEach((m, k) => m.classList.toggle('on', k === DOC.i)); DOC.hits[DOC.i].scrollIntoView({ block: 'center' }); C.textContent = (DOC.i + 1) + ' de ' + DOC.hits.length; };
  const busca = () => {
    limpia(); const q = sinTildes(B.value.trim()); if (q.length < 2) { C.textContent = ''; return; }
    const tw = document.createTreeWalker(H, NodeFilter.SHOW_TEXT), nodos = []; while (tw.nextNode()) nodos.push(tw.currentNode);
    for (const n of nodos) { const t = n.nodeValue, s = sinTildes(t); let i = s.indexOf(q); if (i < 0 || s.length !== t.length) continue; const frag = document.createDocumentFragment(); let ult = 0; while (i >= 0 && DOC.hits.length < 2000) { frag.appendChild(document.createTextNode(t.slice(ult, i))); const m = document.createElement('mark'); m.className = 'dochit'; m.textContent = t.slice(i, i + q.length); frag.appendChild(m); DOC.hits.push(m); ult = i + q.length; i = s.indexOf(q, ult); } frag.appendChild(document.createTextNode(t.slice(ult))); n.replaceWith(frag); }
    C.textContent = DOC.hits.length ? '' : 'sin coincidencias'; if (DOC.hits.length) ir(1);
  };
  let tm = null; B.oninput = () => { clearTimeout(tm); tm = setTimeout(busca, 250); }; B.onkeydown = (e) => { if (e.key === 'Enter') ir(e.shiftKey ? -1 : 1); };
  document.getElementById('docSig').onclick = () => ir(1); document.getElementById('docAnt').onclick = () => ir(-1);
  document.getElementById('docMas').onclick = () => { DOC.zoom = Math.min(2.5, DOC.zoom * 1.15); H.style.zoom = DOC.zoom; }; document.getElementById('docMenos').onclick = () => { DOC.zoom = Math.max(0.5, DOC.zoom / 1.15); H.style.zoom = DOC.zoom; };
}
