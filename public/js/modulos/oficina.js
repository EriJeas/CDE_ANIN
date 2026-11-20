/* DOCUMENTOS DE OFFICE EN PÁGINAS, para poner marcas de revisión e incidencias como en un PDF.
 * Lee con lo que el CDE ya tiene: el lector de ZIP y de hojas de SheetJS (vendor/xlsx.full.min.js), fichaZip()/fichaDecodifica()
 * de buscador.js y el convertidor de Word del visualizador (docWordHtml de ver-doc.js). Aquí solo se arma cada PÁGINA con un tamaño
 * fijo, para que una chincheta (página, x, y) caiga siempre en el mismo sitio:
 *   Word (.docx)              → hojas A4 (el texto se reparte en páginas como al imprimir)
 *   Excel (.xlsx .xls .csv…)  → una página por cada 40 filas de cada hoja, con letras de columna y números de fila
 *   PowerPoint (.pptx)        → una página por diapositiva, con cada cuadro de texto, imagen y tabla en su posición
 *   Texto (.txt .md)          → hojas A4 de 54 líneas */
(function () {
  const N = CDE.N, esc = N.esc;
  const extDe = (n) => (String(n || '').split('.').pop() || '').toLowerCase();
  const RX = /^(docx|xlsx|xlsm|xlsb|xls|csv|ods|pptx|txt|md)$/;
  N.esOficina = (nombre) => RX.test(extDe(nombre));
  const A4 = { w: 794, h: 1123, m: 76 };

  /** Lo del visualizador que se reutiliza (se carga una sola vez). */
  async function lectores(conWord) {
    await N.carga('vendor/xlsx.full.min.js', 'XLSX');
    if (!conWord) return;
    if (typeof window.$ !== 'function') window.$ = (id) => document.getElementById(id);   // buscador.js lo pide al cargar (sus botones no existen aquí)
    if (typeof window.esc !== 'function') window.esc = esc;
    await N.carga('js/visor-origen/buscador.js?v=067', 'fichaZip');
    await N.carga('js/ver-doc.js?v=210', 'docWordHtml');
  }
  const xml = (bytes) => new DOMParser().parseFromString(new TextDecoder('utf-8').decode(bytes), 'application/xml');
  const hijos = (el, local) => el ? [...el.children].filter(c => c.localName === local) : [];
  const hijo = (el, local) => hijos(el, local)[0] || null;
  const busca = (el, local) => { if (!el) return null; for (const n of el.getElementsByTagName('*')) if (n.localName === local) return n; return null; };
  const at = (el, local) => { if (!el) return ''; for (const a of el.attributes) if (a.localName === local) return a.value; return ''; };

  // ─────────── Word: el HTML del visualizador, repartido en hojas A4 ───────────
  async function word(buf) {
    await lectores(true);
    const w = window.docWordHtml(buf), util = A4.h - 2 * A4.m;
    const med = document.createElement('div'); med.className = 'ofpag ofword'; med.style.cssText = 'position:absolute;left:-20000px;top:0;visibility:hidden;width:' + A4.w + 'px;padding:' + A4.m + 'px;box-sizing:border-box;height:auto';
    med.innerHTML = w.html; document.body.appendChild(med);
    await Promise.all([...med.querySelectorAll('img')].map(i => i.decode ? i.decode().catch(() => {}) : null));
    const paginas = []; let actual = [], usado = 0;
    const cierra = () => { if (actual.length) paginas.push(actual); actual = []; usado = 0; };
    const kids = [...med.children], alto = (i) => (i + 1 < kids.length ? kids[i + 1].offsetTop : med.scrollHeight - A4.m) - kids[i].offsetTop;
    kids.forEach((el, i) => {
      if (el.matches('hr.docsalto')) return cierra();
      const h = alto(i);
      if (el.tagName === 'TABLE' && h > util - usado && h > 120) {   // una tabla larga se parte por filas, repitiendo nada: cada trozo es una tabla
        const filas = [...el.rows]; let trozo = [], ht = 0;
        filas.forEach((tr, k) => { const hr = (k + 1 < filas.length ? filas[k + 1].offsetTop : el.offsetHeight) - tr.offsetTop;
          if (usado + ht + hr > util && (trozo.length || actual.length)) { if (trozo.length) actual.push('<table class="doctbl">' + trozo.join('') + '</table>'); cierra(); trozo = []; ht = 0; }
          trozo.push(tr.outerHTML); ht += hr; });
        if (trozo.length) { actual.push('<table class="doctbl">' + trozo.join('') + '</table>'); usado += ht; }
        return;
      }
      if (usado + h > util && actual.length) cierra();
      actual.push(el.outerHTML); usado += h;
    });
    cierra(); med.remove();
    if (!paginas.length) paginas.push(['<p class="pista">(documento sin texto)</p>']);
    return { tipo: 'word', resumen: w.palabras.toLocaleString('es-PE') + ' palabras', paginas: paginas.map((p, i) => ({ etiqueta: 'Página ' + (i + 1), w: A4.w, h: A4.h, html: '<div class="ofword" style="padding:' + A4.m + 'px">' + p.join('') + '</div>' })) };
  }

  // ─────────── Excel / CSV: bloques de 40 filas de cada hoja, como una hoja impresa ───────────
  async function hoja(buf, ext) {
    await lectores(false);
    const wb = ext === 'csv' ? XLSX.read(new TextDecoder('utf-8').decode(buf), { type: 'string' }) : XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true });
    const FILAS = 40, MAXC = 40, AF = 22, CAB = 24, NUMW = 42, TIT = 30, paginas = [];
    for (const nom of wb.SheetNames) {
      const ws = wb.Sheets[nom]; if (!ws || !ws['!ref']) continue;
      const r = XLSX.utils.decode_range(ws['!ref']), c1 = Math.min(r.e.c, r.s.c + MAXC - 1), cols = [];
      for (let c = r.s.c; c <= c1; c++) { const d = (ws['!cols'] || [])[c] || {}; cols.push(Math.max(36, Math.min(420, d.wpx || (d.wch ? d.wch * 7 + 10 : 0) || 84))); }
      const ancho = NUMW + cols.reduce((s, x) => s + x, 0), merges = ws['!merges'] || [];
      for (let f0 = r.s.r; f0 <= r.e.r; f0 += FILAS) {
        const f1 = Math.min(r.e.r, f0 + FILAS - 1), oculta = new Set(), span = {};
        for (const m of merges) { if (m.s.r > f1 || m.e.r < f0) continue; const a = Math.max(m.s.r, f0); span[a + ',' + m.s.c] = [Math.min(m.e.r, f1) - a + 1, Math.min(m.e.c, c1) - m.s.c + 1]; for (let rr = a; rr <= Math.min(m.e.r, f1); rr++) for (let cc = m.s.c; cc <= Math.min(m.e.c, c1); cc++) if (rr !== a || cc !== m.s.c) oculta.add(rr + ',' + cc); }
        let h = '<div class="ofxl"><div class="ofxtit">' + esc(nom) + ' <span>filas ' + (f0 + 1) + '–' + (f1 + 1) + (c1 < r.e.c ? ' · primeras ' + MAXC + ' columnas' : '') + '</span></div><table><colgroup><col style="width:' + NUMW + 'px">' + cols.map(w => '<col style="width:' + w + 'px">').join('') + '</colgroup><tr class="ofxc"><th></th>';
        for (let c = r.s.c; c <= c1; c++) h += '<th>' + XLSX.utils.encode_col(c) + '</th>';
        h += '</tr>';
        for (let rr = f0; rr <= f1; rr++) { h += '<tr><th>' + (rr + 1) + '</th>';
          for (let c = r.s.c; c <= c1; c++) { const k = rr + ',' + c; if (oculta.has(k)) continue; const cel = ws[XLSX.utils.encode_cell({ r: rr, c })], sp = span[k];
            const txt = cel ? XLSX.utils.format_cell(cel) : '', num = cel && (cel.t === 'n' || cel.t === 'd');
            h += '<td' + (sp ? (sp[0] > 1 ? ' rowspan="' + sp[0] + '"' : '') + (sp[1] > 1 ? ' colspan="' + sp[1] + '"' : '') : '') + (num ? ' class="n"' : '') + '>' + esc(txt) + '</td>'; }
          h += '</tr>'; }
        h += '</table></div>';
        paginas.push({ etiqueta: nom + ' · filas ' + (f0 + 1) + '–' + (f1 + 1), w: Math.max(ancho, 420), h: TIT + CAB + (f1 - f0 + 1) * AF + 2, html: h });
      }
    }
    if (!paginas.length) throw new Error('la hoja de cálculo está vacía');
    return { tipo: 'hoja', resumen: wb.SheetNames.length + ' hoja(s)', paginas };
  }

  // ─────────── PowerPoint: cada diapositiva con sus cuadros en su sitio ───────────
  async function diapos(buf) {
    await lectores(false);
    const z = XLSX.CFB.read(new Uint8Array(buf), { type: 'array' }), arch = new Map();
    z.FullPaths.forEach((p, i) => { const e = z.FileIndex[i]; if (e && e.content && e.content.length) arch.set(p.replace(/^[^/]*\//, ''), e.content); });
    const lee = (ruta) => arch.has(ruta) ? xml(arch.get(ruta)) : null;
    const rels = (ruta) => { const d = ruta.lastIndexOf('/'), rr = ruta.slice(0, d) + '/_rels/' + ruta.slice(d + 1) + '.rels', x = lee(rr), out = {}; if (!x) return out;
      for (const r of x.getElementsByTagName('Relationship')) { let t = r.getAttribute('Target') || ''; if (!/^\//.test(t)) { const base = ruta.slice(0, d).split('/'); for (const s of t.split('/')) { if (s === '..') base.pop(); else if (s !== '.') base.push(s); } t = base.join('/'); } else t = t.slice(1); out[r.getAttribute('Id')] = t; }
      return out; };
    const pres = lee('ppt/presentation.xml'); if (!pres) throw new Error('no parece un .pptx válido');
    const sz = busca(pres, 'sldSz'), CX = +at(sz, 'cx') || 12192000, CY = +at(sz, 'cy') || 6858000, ANCHO = 960, F = ANCHO / CX, ALTO = Math.round(CY * F);
    const px = (emu) => Math.round(+emu * F * 10) / 10, pt = (v) => (+v / 100) * (96 / 72) * F * 9525;   // tamaño de letra: centésimas de punto → px a la escala de la diapositiva
    // colores del tema (accent1…, dk1, lt1…)
    const tema = {}, rp = rels('ppt/presentation.xml'), temaRuta = Object.values(rp).find(t => /theme\/theme\d+\.xml$/.test(t));
    const tx = temaRuta && lee(temaRuta); if (tx) { const cs = busca(tx, 'clrScheme'); if (cs) for (const c of cs.children) { const s = busca(c, 'srgbClr'), y = busca(c, 'sysClr'); tema[c.localName] = '#' + (s ? at(s, 'val') : y ? at(y, 'lastClr') : '000000'); } }
    const ALIAS = { tx1: 'dk1', bg1: 'lt1', tx2: 'dk2', bg2: 'lt2' };
    const color = (el) => { if (!el) return ''; const s = hijo(el, 'srgbClr'), k = hijo(el, 'schemeClr'), y = hijo(el, 'sysClr'); if (s) return '#' + at(s, 'val'); if (y) return '#' + (at(y, 'lastClr') || '000000'); if (k) { const v = at(k, 'val'); return tema[ALIAS[v] || v] || ''; } return ''; };
    const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml' };
    const urls = new Map(), imagen = (ruta) => { if (!arch.has(ruta)) return ''; if (!urls.has(ruta)) { const m = MIME[extDe(ruta)]; urls.set(ruta, m ? URL.createObjectURL(new Blob([arch.get(ruta)], { type: m })) : ''); } return urls.get(ruta); };
    const xfrmDe = (sp) => { const pr = hijo(sp, 'spPr') || hijo(sp, 'grpSpPr'), x = pr ? hijo(pr, 'xfrm') : (hijo(sp, 'xfrm') || null); if (!x) return null; const o = hijo(x, 'off'), e = hijo(x, 'ext'); if (!o || !e) return null; return { x: +at(o, 'x'), y: +at(o, 'y'), w: +at(e, 'cx'), h: +at(e, 'cy'), rot: +(at(x, 'rot') || 0) / 60000 }; };
    const phDe = (sp) => { const nv = hijo(sp, 'nvSpPr') || hijo(sp, 'nvPicPr') || hijo(sp, 'nvGraphicFramePr'), p = nv && busca(nv, 'ph'); return p ? { tipo: at(p, 'type') || 'body', idx: at(p, 'idx') } : null; };
    const buscaPh = (arbol, ph) => { if (!arbol || !ph) return null; for (const sp of arbol.getElementsByTagName('*')) { if (sp.localName !== 'sp') continue; const q = phDe(sp); if (!q) continue; if ((ph.idx && q.idx === ph.idx) || (!ph.idx && q.tipo === ph.tipo) || (q.tipo === ph.tipo && /title|ctrTitle/.test(q.tipo))) return sp; } return null; };
    const fondo = (doc, r) => { const bg = doc && busca(doc, 'bg'); if (!bg) return ''; const sf = busca(bg, 'solidFill'); if (sf) return 'background:' + color(sf); const bl = busca(bg, 'blip'); if (bl && r[at(bl, 'embed')]) return 'background:url(' + imagen(r[at(bl, 'embed')]) + ') center/cover'; return ''; };
    function texto(sp, ph, capas) {
      const body = hijo(sp, 'txBody'); if (!body) return '';
      const bp = hijo(body, 'bodyPr'), anc = at(bp, 'anchor'), def = ph && /title|ctrTitle/.test(ph.tipo) ? 3600 : ph && ph.tipo === 'subTitle' ? 2400 : ph ? 2000 : 1800;
      let tamH = 0; for (const c of capas) { const b = c && hijo(c, 'txBody'), d = b && busca(b, 'defRPr'); if (d && at(d, 'sz')) { tamH = +at(d, 'sz'); break; } }
      const ps = hijos(body, 'p').map(p => { const pp = hijo(p, 'pPr'), al = at(pp, 'algn'), bu = pp && hijo(pp, 'buChar');
        const runs = [...p.children].filter(r => r.localName === 'r' || r.localName === 'fld' || r.localName === 'br').map(r => { if (r.localName === 'br') return '<br>'; const t = hijo(r, 't'), pr = hijo(r, 'rPr'); if (!t) return '';
          const tam = +at(pr, 'sz') || tamH || def, col = color(pr && hijo(pr, 'solidFill')), st = 'font-size:' + pt(tam).toFixed(1) + 'px' + (at(pr, 'b') === '1' ? ';font-weight:700' : '') + (at(pr, 'i') === '1' ? ';font-style:italic' : '') + (at(pr, 'u') && at(pr, 'u') !== 'none' ? ';text-decoration:underline' : '') + (col ? ';color:' + col : '');
          return '<span style="' + st + '">' + esc(t.textContent) + '</span>'; }).join('');
        const tamP = (() => { const r1 = busca(p, 'rPr'), e = busca(p, 'endParaRPr'); return +at(r1, 'sz') || +at(e, 'sz') || tamH || def; })();
        return '<p style="text-align:' + ({ ctr: 'center', r: 'right', just: 'justify' }[al] || 'left') + ';font-size:' + pt(tamP).toFixed(1) + 'px">' + (bu && runs ? '<span class="ofbu">' + esc(at(bu, 'char') || '•') + '</span>' : '') + (runs || '&nbsp;') + '</p>'; }).join('');
      return '<div class="oftx" style="justify-content:' + ({ ctr: 'center', b: 'flex-end' }[anc] || (ph && /title|ctrTitle/.test(ph.tipo) ? 'center' : 'flex-start')) + '">' + ps + '</div>';
    }
    function formas(arbol, r, capas, offset, soloNoPh) {
      if (!arbol) return '';
      let h = '';
      for (const sp of arbol.children) {
        const k = sp.localName; if (!/^(sp|pic|graphicFrame|grpSp|cxnSp)$/.test(k)) continue;
        const ph = phDe(sp); if (soloNoPh && ph) continue;
        let xf = xfrmDe(sp); if (!xf && ph) for (const c of capas) { const s2 = buscaPh(c, ph); const x2 = s2 && xfrmDe(s2); if (x2) { xf = x2; break; } }
        if (!xf) continue; const g = offset ? offset(xf) : xf;
        const caja = 'left:' + px(g.x) + 'px;top:' + px(g.y) + 'px;width:' + px(g.w) + 'px;height:' + px(g.h) + 'px' + (g.rot ? ';transform:rotate(' + g.rot + 'deg)' : '');
        if (k === 'grpSp') { const gp = hijo(sp, 'grpSpPr'), x = gp && hijo(gp, 'xfrm'), co = x && hijo(x, 'chOff'), ce = x && hijo(x, 'chExt'); if (!co || !ce) continue; const cx0 = +at(co, 'x'), cy0 = +at(co, 'y'), sx = (+at(ce, 'cx') ? g.w / +at(ce, 'cx') : 1), sy = (+at(ce, 'cy') ? g.h / +at(ce, 'cy') : 1);
          h += formas(sp, r, [], (c) => ({ x: g.x + (c.x - cx0) * sx, y: g.y + (c.y - cy0) * sy, w: c.w * sx, h: c.h * sy, rot: c.rot }), false); continue; }
        if (k === 'pic') { const bl = busca(sp, 'blip'), src = bl && r[at(bl, 'embed')] ? imagen(r[at(bl, 'embed')]) : ''; h += src ? '<img class="ofsh" style="' + caja + ';object-fit:fill" src="' + src + '" alt="">' : '<div class="ofsh ofvacio" style="' + caja + '">[imagen]</div>'; continue; }
        if (k === 'graphicFrame') { const tb = busca(sp, 'tbl');
          if (tb) { h += '<div class="ofsh" style="' + caja + ';height:auto"><table class="oftbl">' + hijos(tb, 'tr').map(tr => '<tr>' + hijos(tr, 'tc').map(tc => '<td>' + texto(tc, null, []) + '</td>').join('') + '</tr>').join('') + '</table></div>'; }
          else h += '<div class="ofsh ofvacio" style="' + caja + '">' + (busca(sp, 'chart') ? 'Gráfico' : 'Objeto') + '</div>';
          continue; }
        const pr = hijo(sp, 'spPr'), relleno = pr && hijo(pr, 'solidFill'), ln = pr && hijo(pr, 'ln'), lf = ln && hijo(ln, 'solidFill'), geo = pr && hijo(pr, 'prstGeom'), forma = at(geo, 'prst'), bl = pr && busca(pr, 'blip');
        const st = caja + (relleno ? ';background:' + color(relleno) : '') + (bl && r[at(bl, 'embed')] ? ';background:url(' + imagen(r[at(bl, 'embed')]) + ') center/cover' : '') + (lf ? ';border:' + Math.max(1, px(+at(ln, 'w') || 9525)) + 'px solid ' + color(lf) : '') + (forma === 'ellipse' ? ';border-radius:50%' : forma === 'roundRect' ? ';border-radius:8%' : '');
        const cap = ph ? capas.map(c => buscaPh(c, ph)) : [];
        h += '<div class="ofsh" style="' + st + '">' + texto(sp, ph, cap) + '</div>';
      }
      return h;
    }
    const rid = (el) => { for (const x of el.attributes) if (x.localName === 'id' && x.namespaceURI && /relationships/.test(x.namespaceURI)) return x.value; return ''; };   // r:id (no el id numérico)
    const ids = hijos(busca(pres, 'sldIdLst'), 'sldId').map(s => rp[rid(s)]).filter(Boolean), paginas = [];
    for (const [i, ruta] of ids.entries()) {
      const sl = lee(ruta); if (!sl) continue; const r = rels(ruta), lyR = Object.values(r).find(t => /slideLayouts\//.test(t)), ly = lyR && lee(lyR), rly = lyR ? rels(lyR) : {}, msR = lyR && Object.values(rly).find(t => /slideMasters\//.test(t)), ms = msR && lee(msR), rms = msR ? rels(msR) : {};
      const arbol = (d) => d && busca(d, 'spTree'), conMaestro = at(busca(sl, 'sld') || sl.documentElement, 'showMasterSp') !== '0';
      const bg = fondo(sl, r) || fondo(ly, rly) || fondo(ms, rms) || 'background:#fff';
      const html = '<div class="ofppt" style="width:' + ANCHO + 'px;height:' + ALTO + 'px;' + bg + '">' + (conMaestro ? formas(arbol(ms), rms, [], null, true) + formas(arbol(ly), rly, [], null, true) : '') + formas(arbol(sl), r, [arbol(ly), arbol(ms)], null, false) + '</div>';
      paginas.push({ etiqueta: 'Diapositiva ' + (i + 1), w: ANCHO, h: ALTO, html });
    }
    if (!paginas.length) throw new Error('la presentación no trae diapositivas');
    return { tipo: 'diapos', resumen: paginas.length + ' diapositiva(s)', paginas };
  }

  // ─────────── Texto: hojas A4 de 54 líneas ───────────
  function textoPlano(buf) {
    const t = new TextDecoder('utf-8').decode(buf).replace(/\r\n?/g, '\n'), L = t.split('\n'), paginas = [];
    for (let i = 0; i < L.length; i += 54) paginas.push({ etiqueta: 'Página ' + (paginas.length + 1), w: A4.w, h: A4.h, html: '<pre class="oftxt" style="padding:' + A4.m + 'px">' + esc(L.slice(i, i + 54).join('\n')) + '</pre>' });
    return { tipo: 'texto', resumen: L.length.toLocaleString('es-PE') + ' líneas', paginas: paginas.length ? paginas : [{ etiqueta: 'Página 1', w: A4.w, h: A4.h, html: '' }] };
  }

  /** Abre un archivo de Office y lo devuelve en páginas de tamaño fijo: { tipo, resumen, paginas: [{ etiqueta, w, h, html }] }. */
  N.abreOficina = async function (buf, nombre) {
    const e = extDe(nombre);
    if (e === 'docx') return word(buf);
    if (/^(xlsx|xlsm|xlsb|xls|csv|ods)$/.test(e)) return hoja(buf, e);
    if (e === 'pptx') return diapos(buf);
    if (e === 'txt' || e === 'md') return textoPlano(buf);
    throw new Error('Este formato no se puede mostrar por páginas.');
  };
  /** Pinta una página en su contenedor, escalada al ancho pedido. Devuelve el elemento que hace de lienzo (para las chinchetas). */
  N.pintaPaginaOficina = function (cont, pag, ancho) {
    const s = ancho / pag.w;
    cont.style.width = Math.round(pag.w * s) + 'px'; cont.style.height = Math.round(pag.h * s) + 'px';
    cont.innerHTML = '<div class="ofpag" style="width:' + pag.w + 'px;height:' + pag.h + 'px;transform:scale(' + s + ')">' + pag.html + '</div>';
    return cont;
  };
})();
