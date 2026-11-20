/* VALIDACIÓN QA GRÁFICA (v0.24.1): la portada del documento con cada comprobación marcada encima, en verde lo que cumple y en rojo lo que
 * no, numerado igual que la lista de la derecha. En un PDF se dibuja la primera página real (pdf.js) y las cajas salen de las posiciones
 * que leyó el servidor; donde falta algo (p. ej. el sello) se marca con línea discontinua el lugar donde lo pone la plantilla ANIN.
 * En un Word (el navegador no lo dibuja) se muestra un esquema de la plantilla con lo que se leyó en cada parte.
 * Uso: N.qaDetalle(qa, nombre, fuente) · fuente: { archivo: File|Blob } o { url } (o nada → esquema). */
(function () {
  const N = CDE.N, { esc, ventana } = N;
  const ORDEN = ['lectura', 'cajetin', 'llenado', 'revision', 'emision', 'paginas', 'codigo', 'proyecto', 'titulo', 'direccion', 'cuadro', 'coincide', 'correlativa', 'sello'];
  const CORTO = { lectura: 'Lectura de la portada', cajetin: 'Cajetín de la plantilla', llenado: 'Contrato, región y logo', revision: 'Revisión', emision: 'Emisión', paginas: 'Páginas del documento', codigo: 'Código del documento', proyecto: 'Código del proyecto', titulo: 'Descripción del documento', direccion: 'Dirección', cuadro: 'Cuadro de revisiones', coincide: 'Revisión y fecha = última fila', correlativa: 'Revisión que corresponde', sello: 'Sello de revisión ANIN' };

  N.qaDetalle = (qa, nombre, fuente) => {
    qa = qa || {}; const d = qa.datos || {}, checks = (qa.checks || []).slice().sort((a, b) => ORDEN.indexOf(a.id) - ORDEN.indexOf(b.id)), malas = checks.filter(c => !c.ok).length;
    checks.forEach((c, i) => { c.n = i + 1; });
    const est = (c) => !c.ok ? 'mal' : c.aviso ? 'aviso' : 'ok';
    const lista = checks.map(c => '<li class="qg-it ' + est(c) + '" data-id="' + esc(c.id) + '"><span class="qg-n">' + c.n + '</span><span class="qg-t"><b>' + (c.ok ? '✓ ' : '✗ ') + esc(CORTO[c.id] || c.titulo) + '</b>' + (!c.ok || c.aviso ? '<small>' + esc(c.detalle) + '</small>' : '<small class="qg-ok">' + esc(String(c.detalle || '').slice(0, 90)) + '</small>') + '</span></li>').join('');
    const dato = (k, v) => v ? '<tr><td>' + k + '</td><td>' + esc(v) + '</td></tr>' : '';
    const v = ventana('Validación QA · ' + (nombre || qa.archivo || ''), '<div class="qg">' +
      '<div class="qg-cab ' + (qa.ok ? 'ok' : 'mal') + '"><b>' + (qa.ok ? '✓ La portada cumple la plantilla ANIN' : '✗ ' + malas + ' observación' + (malas === 1 ? '' : 'es') + ' en la portada') + '</b><span class="crece"></span>' +
        '<span class="qg-ley"><i class="ok"></i>Cumple <i class="mal"></i>No cumple <i class="esp"></i>Falta (aquí debería ir)</span>' +
        '<button class="mini" data-z="-">−</button><button class="mini" data-z="0">Ajustar</button><button class="mini" data-z="+">+</button></div>' +
      '<div class="qg-cuerpo"><div class="qg-hoja"><div class="qg-pag" id="qgPag"><div class="pista" style="padding:30px">Dibujando la portada…</div></div></div>' +
        '<div class="qg-lado"><ol class="qg-lista">' + lista + '</ol>' +
        '<details class="qg-datos"><summary>Lo que se leyó</summary><table class="chica"><tbody>' + dato('Revisión (cajetín)', d.revision) + dato('Emisión (cajetín)', d.emision) + dato('Páginas', d.paginas ? 'portada: ' + (d.paginasPortada || '—') + ' · archivo: ' + d.paginas : '') + dato('Última fila del cuadro', d.ultimaFila ? d.ultimaFila.rev + ' · ' + d.ultimaFila.fecha : '') + dato('Revisión que corresponde', d.esperada) + dato('Código del documento', d.codigo) + dato('Código en la portada', d.codigoPortada) + dato('Nombre (descripción)', d.titulo) + dato('Elaborado por (última fila)', d.elabPor) + dato('Contrato', d.contrato) + dato('Región', d.region) + '</tbody></table></details></div></div></div>',
      { ancho: 1180, alto: 820 });
    const pag = v.querySelector('#qgPag'), hoja = v.querySelector('.qg-hoja'); let escala = 1, base = 1, ancho = 0, dibuja = null;
    const marca = (id, on) => { v.querySelectorAll('.qg-caja').forEach(b => b.classList.toggle('apagada', on && b.dataset.id !== id)); v.querySelectorAll('.qg-caja[data-id="' + id + '"]').forEach(b => b.classList.toggle('viva', on)); v.querySelectorAll('.qg-it').forEach(li => li.classList.toggle('viva', on && li.dataset.id === id)); };
    v.querySelectorAll('.qg-it').forEach(li => { li.onmouseenter = () => marca(li.dataset.id, true); li.onmouseleave = () => marca(li.dataset.id, false); li.onclick = () => { const b = v.querySelector('.qg-caja[data-id="' + li.dataset.id + '"]'); if (b) b.scrollIntoView({ block: 'center', behavior: 'smooth' }); }; });
    const cajas = (cont, Z, s) => {   // Z: { pagina:{w,h}, cajas:[…] } en puntos; s: px por punto
      const vistos = new Map();
      for (const z of Z.cajas || []) {
        const c = checks.find(x => x.id === z.id); if (!c) continue;
        const b = document.createElement('div'), k = [z.x, z.y, z.w, z.h].map(Math.round).join(','), rep = vistos.get(k) || 0; vistos.set(k, rep + 1);
        b.className = 'qg-caja ' + (z.esperada ? 'esp' : est(c)); b.dataset.id = c.id; b.title = c.n + '. ' + (CORTO[c.id] || c.titulo) + (c.detalle ? ' — ' + c.detalle : '');
        Object.assign(b.style, { left: (z.x * s) + 'px', top: (z.y * s) + 'px', width: Math.max(10, z.w * s) + 'px', height: Math.max(10, z.h * s) + 'px' });
        b.innerHTML = '<span class="qg-n" style="left:' + (-9 + rep * 22) + 'px">' + c.n + '</span>' + (z.esperada ? '<span class="qg-falta">Falta: ' + esc(CORTO[c.id] || '') + '</span>' : '');
        b.onmouseenter = () => marca(c.id, true); b.onmouseleave = () => marca(c.id, false);
        b.onclick = () => { const li = v.querySelector('.qg-it[data-id="' + c.id + '"]'); if (li) { li.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); li.classList.add('pulso'); setTimeout(() => li.classList.remove('pulso'), 900); } };
        cont.appendChild(b);
      }
      // lo que no tiene caja (p. ej. «Lectura») se ve igual en la lista
    };
    // ── PDF: la página real ──
    const pdf = async () => {
      let datos = null;
      if (fuente && fuente.archivo) datos = new Uint8Array(await fuente.archivo.arrayBuffer());
      else if (fuente && fuente.url) { const r = await fetch(fuente.url); if (!r.ok) throw new Error('No se pudo traer el PDF (' + r.status + ')'); datos = new Uint8Array(await r.arrayBuffer()); }
      if (!datos) throw new Error('sin archivo');
      await N.carga('vendor/pdf.min.js', 'pdfjsLib'); pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
      const doc = await pdfjsLib.getDocument({ data: datos }).promise, pg = await doc.getPage(1), vp1 = pg.getViewport({ scale: 1 });
      const Z = qa.zonas && qa.zonas.pagina ? qa.zonas : { pagina: { w: vp1.width, h: vp1.height }, cajas: [] };
      dibuja = async () => {
        const s = (ancho || (hoja.clientWidth - 28)) / Z.pagina.w * escala, vp = pg.getViewport({ scale: s * (vp1.width / Z.pagina.w) });
        const cv = document.createElement('canvas'), dpr = Math.min(2, window.devicePixelRatio || 1); cv.width = Math.round(vp.width * dpr); cv.height = Math.round(vp.height * dpr); cv.style.width = vp.width + 'px'; cv.style.height = vp.height + 'px';
        await pg.render({ canvasContext: cv.getContext('2d'), viewport: pg.getViewport({ scale: s * (vp1.width / Z.pagina.w) * dpr }) }).promise;
        pag.innerHTML = ''; pag.style.width = vp.width + 'px'; pag.style.height = vp.height + 'px'; pag.appendChild(cv); cajas(pag, Z, s);
      };
      await dibuja();
    };
    // ── Word (o sin archivo): esquema de la plantilla ANIN con lo que se leyó ──
    const esquema = () => {
      const st = (id) => { const c = checks.find(x => x.id === id); return c ? (!c.ok ? 'mal' : c.aviso ? 'aviso' : 'ok') : 'na'; }, nn = (id) => { const c = checks.find(x => x.id === id); return c ? '<span class="qg-n">' + c.n + '</span>' : ''; };
      const z = (id, html, extra) => '<div class="qg-z ' + st(id) + ' ' + (extra || '') + '" data-id="' + id + '" title="' + esc((checks.find(x => x.id === id) || {}).detalle || '') + '">' + nn(id) + html + '</div>';
      const filas = (d.filas || []).slice(-4);
      dibuja = () => {
        const w = Math.round((ancho || (hoja.clientWidth - 28)) * escala);
        pag.style.width = w + 'px'; pag.style.height = Math.round(w * 1.414) + 'px'; pag.style.fontSize = Math.max(8, w / 60) + 'px';
        pag.innerHTML = '<div class="qg-esq">' +
          z('cajetin', '<div class="qg-cj"><div class="qg-logo">' + z('llenado', 'Logo del contratista', 'mini') + '</div><div class="qg-cc"><b>PRESIDENCIA DEL CONSEJO DE MINISTROS</b><b>“AUTORIDAD NACIONAL DE INFRAESTRUCTURA”</b>' + z('llenado', 'CONTRATO: ' + esc(d.contrato || '—'), 'mini') + z('llenado', 'REGIÓN: ' + esc(d.region || '—'), 'mini') + '</div><div class="qg-cr">' + z('revision', 'Revisión: ' + esc(d.revision || '—'), 'mini') + z('emision', 'Emisión: ' + esc(d.emision || '—'), 'mini') + '<span>Página: 1 de …</span></div></div>') +
          '<div class="qg-fila2">' + z('sello', st('sello') === 'mal' ? 'Falta el sello «Revisión de documentos técnicos»' : 'Sello «Revisión de documentos técnicos»', 'sello' + (st('sello') === 'mal' ? ' esp' : '')) + '<div class="qg-anin">ANIN</div></div>' +
          z('titulo', esc(d.titulo || '— sin nombre —'), 'tit') + z('codigo', esc(d.codigoPortada || '— sin código —'), 'cod') + z('direccion', 'DIRECCIÓN DE ESTUDIOS Y OBRAS', 'dir') +
          z('cuadro', '<table><tr><th>REV N°</th><th>FECHA</th><th>DESCRIPCIÓN</th><th>ELAB. POR</th><th>REV. POR</th><th>APROB. POR</th></tr>' + (filas.length ? filas.map((f, i) => '<tr class="' + (i === filas.length - 1 ? 'qg-uf ' + st('coincide') : '') + '"><td>' + esc(f.rev) + '</td><td>' + esc(f.fecha) + '</td><td>…</td><td>' + (i === filas.length - 1 ? esc(d.elabPor || '') : '') + '</td><td></td><td></td></tr>').join('') : '<tr><td colspan="6">— sin filas —</td></tr>') + '</table>', 'cuadro') +
          '<div class="pista qg-nota">Vista esquemática: el Word no se dibuja en el navegador; cada parte muestra lo que se leyó de la portada.</div></div>';
        pag.querySelectorAll('.qg-z').forEach(b => { b.classList.add('qg-caja'); b.onmouseenter = () => marca(b.dataset.id, true); b.onmouseleave = () => marca(b.dataset.id, false); });
      };
      dibuja();
    };
    v.querySelectorAll('[data-z]').forEach(b => b.onclick = () => { const k = b.dataset.z; escala = k === '0' ? 1 : Math.max(0.5, Math.min(3, escala * (k === '+' ? 1.25 : 0.8))); if (dibuja) dibuja(); });
    setTimeout(async () => {
      ancho = Math.max(320, hoja.clientWidth - 28);
      const esPdf = qa.tipo === 'pdf' || /\.pdf$/i.test(nombre || '');
      if (esPdf && fuente && (fuente.archivo || fuente.url)) { try { await pdf(); return; } catch (e) { pag.innerHTML = '<div class="aviso ambar">No se pudo dibujar el PDF (' + esc(e.message) + '): se muestra el esquema.</div>'; } }
      esquema();
    }, 30);
  };
})();
