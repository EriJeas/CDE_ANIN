/* FICHA DE ANÁLISIS · IMÁGENES DE LOS HALLAZGOS (v0.25.2): cada observación de la verificación automática muestra el recorte de la página
 * del PDF donde está, con el recuadro marcado (rojo = error, ámbar = por revisar). Al hacer clic se abre la página completa en una ventana
 * movible y agrandable, con «anterior / siguiente» entre los lugares marcados. El PDF se dibuja en el navegador (pdf.js) y se baja una
 * sola vez por ficha, solo cuando hay que dibujar algo.
 * Uso: N.fichaImagenes(el, { pid, vid }) después de pintar N.fichaHtml(r) dentro de «el». */
(function () {
  const N = CDE.N, { esc, ventana } = N;
  const docs = new Map();   // vid → Promise<PDFDocumentProxy>
  const doc = async (pid, vid) => {
    if (!docs.has(vid)) docs.set(vid, (async () => {
      await N.carga('vendor/pdf.min.js', 'pdfjsLib'); pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
      const r = await fetch('/api/proyectos/' + pid + '/versiones/' + vid + '/descargar'); if (!r.ok) throw new Error('No se pudo traer el PDF (' + r.status + ')');
      return pdfjsLib.getDocument({ data: new Uint8Array(await r.arrayBuffer()) }).promise;
    })().catch(e => { docs.delete(vid); throw e; }));
    return docs.get(vid);
  };
  const COLOR = { mal: ['#d32f2f', 'rgba(211,47,47,.16)'], aviso: ['#c68400', 'rgba(198,132,0,.18)'] };
  /** Dibuja en un canvas la zona { x, y, w, h } (puntos) de la página, a «ancho» píxeles, y marca encima los recuadros. */
  async function dibuja(pdf, m, zona, anchoPx, marcas, nivel) {
    const pg = await pdf.getPage(m.pagina), v1 = pg.getViewport({ scale: 1 }), k = v1.width / (m.ancho || v1.width);   // por si el PDF y el análisis difieren en unidades
    const dpr = Math.min(2, window.devicePixelRatio || 1), s = Math.min(4, anchoPx / zona.w) * dpr;
    const vp = pg.getViewport({ scale: s * k, offsetX: -zona.x * s, offsetY: -zona.y * s });
    const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(zona.w * s)); cv.height = Math.max(1, Math.round(zona.h * s)); cv.style.width = Math.round(zona.w * s / dpr) + 'px';
    const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
    await pg.render({ canvasContext: g, viewport: vp }).promise;
    const [borde, relleno] = COLOR[nivel] || COLOR.aviso;
    for (const x of marcas) { const px = (x.x - zona.x) * s, py = (x.y - zona.y) * s, pw = x.w * s, ph = x.h * s, pad = 3 * dpr; g.fillStyle = relleno; g.fillRect(px - pad, py - pad, pw + 2 * pad, ph + 2 * pad); g.lineWidth = 2.2 * dpr; g.strokeStyle = borde; if (x.zona) g.setLineDash([8 * dpr, 5 * dpr]); g.strokeRect(px - pad, py - pad, pw + 2 * pad, ph + 2 * pad); g.setLineDash([]); }
    return cv;
  }
  /** Zona del recorte alrededor de una marca: la línea con aire a los lados; una zona (página / cabecera) se muestra entera. */
  const recorte = (m) => {
    if (m.zona) return { x: 0, y: 0, w: m.ancho, h: Math.min(m.alto, Math.max(m.h, m.alto * 0.35)) };
    const w = Math.min(m.ancho, Math.max(320, m.w + 140)), h = Math.min(m.alto, Math.max(70, m.h + 70));
    const x = Math.max(0, Math.min(m.ancho - w, m.x + m.w / 2 - w / 2)), y = Math.max(0, Math.min(m.alto - h, m.y + m.h / 2 - h / 2));
    return { x, y, w, h };
  };
  /** Ventana con la página completa y el recuadro, navegando entre las marcas del hallazgo. */
  function abre(pid, vid, h, i) {
    const v = ventana('Dónde está · ' + h.titulo, '<div class="fi-vent"><div class="fi-bar"><button class="mini" data-m="-">‹ Anterior</button><span class="fi-pos"></span><button class="mini" data-m="+">Siguiente ›</button><span class="crece"></span><span class="pista">' + esc(h.detalle).slice(0, 160) + '</span></div><div class="fi-hoja"></div></div>', { ancho: Math.min(980, innerWidth - 40), alto: Math.min(880, innerHeight - 40) });
    const hoja = v.querySelector('.fi-hoja'), pos = v.querySelector('.fi-pos'); let k = i;
    const pinta = async () => {
      const m = h.marcas[k], misma = h.marcas.filter(x => x.pagina === m.pagina);
      pos.textContent = 'Lugar ' + (k + 1) + ' de ' + h.marcas.length + ' · pág. ' + m.pagina;
      hoja.innerHTML = '<div class="pista" style="padding:20px">Dibujando la página ' + m.pagina + '…</div>';
      try { const pdf = await doc(pid, vid), cv = await dibuja(pdf, m, { x: 0, y: 0, w: m.ancho, h: m.alto }, Math.max(360, hoja.clientWidth - 30), misma, h.nivel); hoja.innerHTML = ''; hoja.appendChild(cv); const y = (m.y / m.alto) * cv.clientHeight; hoja.scrollTop = Math.max(0, y - hoja.clientHeight / 2); }
      catch (e) { hoja.innerHTML = '<div class="aviso rojo">' + esc(e.message) + '</div>'; }
    };
    v.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { k = (k + (b.dataset.m === '+' ? 1 : -1) + h.marcas.length) % h.marcas.length; pinta(); });
    setTimeout(pinta, 30);
  }
  N.fichaImagenes = (el, o) => {
    if (!el || !o || !o.vid) return; const r = o.resumen || {}, H = ((r.analisis || {}).hallazgos) || [];
    const cajas = [...el.querySelectorAll('.fa-imgs[data-hi]')]; if (!cajas.length) return;
    const obs = 'IntersectionObserver' in window ? new IntersectionObserver((es) => es.forEach(e => { if (e.isIntersecting) { obs.unobserve(e.target); llena(e.target); } }), { rootMargin: '200px' }) : null;
    async function llena(c) {
      const h = H[+c.dataset.hi]; if (!h || !h.marcas) return;
      const vistas = h.marcas.slice(0, 3);
      c.innerHTML = vistas.map((m, i) => '<button class="fi-min" data-i="' + i + '" title="Ver la página ' + m.pagina + ' completa"><span class="fi-cv"><span class="pista">Dibujando…</span></span><span class="fi-pg">pág. ' + m.pagina + '</span></button>').join('') + (h.marcas.length > 3 ? '<button class="fi-mas" data-i="3">+' + (h.marcas.length - 3) + ' lugar' + (h.marcas.length - 3 === 1 ? '' : 'es') + ' más</button>' : '');
      c.querySelectorAll('[data-i]').forEach(b => b.onclick = (e) => { e.preventDefault(); abre(o.pid, o.vid, h, +b.dataset.i); });
      try {
        const pdf = await doc(o.pid, o.vid);
        for (let i = 0; i < vistas.length; i++) { const m = vistas[i], z = recorte(m), cv = await dibuja(pdf, m, z, m.zona ? 170 : 300, h.marcas.filter(x => x.pagina === m.pagina), h.nivel); const dst = c.querySelector('[data-i="' + i + '"] .fi-cv'); if (dst) { dst.innerHTML = ''; dst.appendChild(cv); } }
      } catch (e) { c.innerHTML = '<span class="pista">No se pudo dibujar el PDF: ' + esc(e.message) + '</span>'; }
    }
    cajas.forEach(c => obs ? obs.observe(c) : llena(c));
  };
})();
