/* CDE ANIN — utilidades comunes de la web: llamadas a la API, ventanas flotantes (se mueven y se agrandan), formato. */
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Memoria corta de las lecturas que casi no cambian y que pide cada pantalla (la ficha del proyecto con su árbol de carpetas, la
  // lista de proyectos, los catálogos). En un servidor lejano cada viaje cuesta: sin esto, cada clic volvía a pedir la ficha entera.
  // Cualquier escritura (POST/PUT/DELETE, por api, fetch o XMLHttpRequest) la vacía, así que lo que uno cambia se ve en el acto.
  const MEMO = new Map(), MEMO_MS = 45000, MEMORIZABLE = /^\/api\/(proyectos(\/[^/?#]+)?|estructura|documentos\/catalogos)$/;
  const olvida = () => MEMO.clear(), escribe = (m) => !/^(GET|HEAD)$/i.test(String(m || 'GET'));
  const fetchOrig = window.fetch.bind(window);
  window.fetch = function (i, o) { const m = (o && o.method) || (i && typeof i === 'object' && i.method) || 'GET'; if (!escribe(m)) return fetchOrig(i, o); olvida(); return fetchOrig(i, o).finally(olvida); };
  const xhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m) { if (escribe(m)) { olvida(); this.addEventListener('loadend', olvida); } return xhrOpen.apply(this, arguments); };
  async function api(ruta, opciones) {
    const o = Object.assign({ headers: {} }, opciones || {});
    if (o.json !== undefined) { o.method = o.method || 'POST'; o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(o.json); delete o.json; }
    const lee = !escribe(o.method) && MEMORIZABLE.test(ruta) && !o.fresco; delete o.fresco;
    if (lee) { const m = MEMO.get(ruta); if (m && Date.now() - m.t < MEMO_MS) return JSON.parse(m.texto); }
    const r = await fetch(ruta, o);
    let texto = '', j = null; try { texto = await r.text(); j = texto ? JSON.parse(texto) : null; } catch (e) { j = null; }
    if (r.status === 401 && !/\/api\/acceso\//.test(ruta)) { location.hash = '#/acceso'; throw new Error('Inicia sesion.'); }
    if (!r.ok) { const e = new Error((j && (j.mensaje || j.error)) || ('HTTP ' + r.status)); e.datos = j; e.status = r.status; throw e; }
    if (lee && j) MEMO.set(ruta, { t: Date.now(), texto });
    return j;
  }
  const fecha = (s) => { if (!s) return ''; const d = new Date(s); return isNaN(d) ? String(s) : d.toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' }); };
  const tam = (n) => n >= 1073741824 ? (n / 1073741824).toFixed(2) + ' GB' : n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : (n || 0) + ' B';
  const num = (n) => Number(n || 0).toLocaleString('es-PE');

  /** Ventana flotante: se arrastra por la cabecera y se agranda por la esquina (CSS resize). Devuelve el cuerpo. */
  function ventanaClasica(titulo, html, opciones) {
    const o = opciones || {}, cont = document.getElementById('ventanas') || document.body;
    const v = document.createElement('div'); v.className = 'ventana';
    // En el portal las ventanas nacen centradas (escalonadas si hay varias) y las de tamaño de diálogo atenúan el fondo; siguen moviéndose y agrandándose.
    const portal = !!window.CDE_PORTAL, an = Math.min(o.ancho || 520, window.innerWidth - 24), al = Math.min(o.alto || 380, window.innerHeight - 24), nv = document.querySelectorAll('.ventana').length;
    if (portal && (o.ancho || 520) <= 980 && (o.alto || 380) <= 760) v.classList.add('dlg');
    v.style.left = (o.x != null ? o.x : portal ? Math.max(12, Math.round((window.innerWidth - an) / 2) + (nv * 22) % 110) : 120 + (cont.children.length * 24) % 200) + 'px'; v.style.top = (o.y != null ? o.y : portal ? Math.max(12, Math.round((window.innerHeight - al) / 2.4) + (nv * 22) % 110) : 90 + (cont.children.length * 24) % 200) + 'px';
    v.style.width = (portal ? an : (o.ancho || 520)) + 'px'; v.style.height = (portal ? al : (o.alto || 380)) + 'px';
    v.innerHTML = '<div class="vcab"><b>' + esc(titulo) + '</b><button title="Agrandar" aria-label="Agrandar" data-max>▢</button><button title="Cerrar" aria-label="Cerrar" data-cerrar>✕</button></div><div class="vcuerpo"></div>';
    v.querySelector('.vcuerpo').innerHTML = html || '';
    cont.appendChild(v);
    const cab = v.querySelector('.vcab'); let arr = null;
    cab.addEventListener('mousedown', (e) => { if (e.target.tagName === 'BUTTON') return; arr = { x: e.clientX - v.offsetLeft, y: e.clientY - v.offsetTop }; v.style.zIndex = 60 + cont.children.length; e.preventDefault(); });
    window.addEventListener('mousemove', (e) => { if (!arr) return; v.style.left = Math.max(0, e.clientX - arr.x) + 'px'; v.style.top = Math.max(0, e.clientY - arr.y) + 'px'; });
    window.addEventListener('mouseup', () => { arr = null; });
    v.querySelector('[data-cerrar]').onclick = () => { v.remove(); if (o.alCerrar) o.alCerrar(); };
    v.querySelector('[data-max]').onclick = () => { if (v.dataset.max) { Object.assign(v.style, JSON.parse(v.dataset.max)); delete v.dataset.max; } else { v.dataset.max = JSON.stringify({ left: v.style.left, top: v.style.top, width: v.style.width, height: v.style.height }); Object.assign(v.style, { left: '12px', top: '60px', width: 'calc(100vw - 24px)', height: 'calc(100vh - 72px)' }); } };
    return v.querySelector('.vcuerpo');
  }

  // ---- v0.14.0 · Portal: las ventanas se integran al CDE en vez de flotar ----
  // Segun el tamano que pide quien la abre: «dialogo» (pequena: centrada, con velo), «panel» (mediana: acoplada a la derecha, se
  // ensancha por su borde) u «hoja» (grande: ocupa el area de trabajo, como una pagina mas). Con «Separar» vuelve a ser una ventana
  // flotante que se mueve y se agranda a gusto. El visor conserva las suyas (ventanaClasica).
  const ICV = {
    volver: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>', cerrar: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    separar: '<svg viewBox="0 0 24 24"><rect x="8" y="4" width="12" height="12" rx="1.5"/><path d="M16 16v2.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 18.5v-9A1.5 1.5 0 0 1 5.5 8H8"/></svg>',
    acoplar: '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="1.5"/><path d="M14 5v14"/></svg>',
    ancho: '<svg viewBox="0 0 24 24"><path d="M9 5H5v4M15 19h4v-4M5 5l6 6M19 19l-6-6"/></svg>'
  };
  let zV = 100;
  const sube = () => ++zV;
  function velo() {
    const cont = document.getElementById('ventanas'); if (!cont) return;
    const ds = [...cont.querySelectorAll('.ventana.v-dialogo')]; let ve = document.getElementById('vvelo');
    if (!ds.length) { if (ve) ve.remove(); return; }
    if (!ve) { ve = document.createElement('div'); ve.id = 'vvelo'; cont.appendChild(ve); }
    ve.style.zIndex = Math.max(...ds.map(d => Number(d.style.zIndex) || 100)) - 1;
  }
  let vigia = null;
  function ventana(titulo, html, opciones) {
    if (!window.CDE_PORTAL) return ventanaClasica(titulo, html, opciones);
    const o = opciones || {}, cont = document.getElementById('ventanas') || document.body, an = o.ancho || 520, al = o.alto || 380;
    const nace = o.modo || (an <= 560 && al <= 440 ? 'dialogo' : an <= 780 ? 'panel' : 'hoja');
    const v = document.createElement('div'); v.className = 'ventana v-' + nace; v.dataset.nace = nace; v.style.zIndex = sube();
    v.style.setProperty('--v-an', an + 'px'); v.style.setProperty('--v-al', al + 'px');
    v.innerHTML = '<div class="vborde" title="Arrastra para ensanchar"></div><div class="vcab"><button class="vvolver" title="Volver" aria-label="Volver" data-cerrar>' + ICV.volver + '</button><b>' + esc(titulo) + '</b>' +
      '<button title="Ampliar al área de trabajo" aria-label="Ampliar" data-ancho>' + ICV.ancho + '</button><button title="Separar en una ventana flotante" aria-label="Separar" data-libre>' + ICV.separar + '</button><button title="Cerrar" aria-label="Cerrar" data-cerrar>' + ICV.cerrar + '</button></div><div class="vcuerpo"></div>';
    v.querySelector('.vcuerpo').innerHTML = html || '';
    cont.appendChild(v);
    if (!vigia && cont.id === 'ventanas') { vigia = new MutationObserver(velo); vigia.observe(cont, { childList: true }); }
    velo();
    const cab = v.querySelector('.vcab'), libre = () => v.classList.contains('v-libre'), suelta = () => libre() || v.classList.contains('v-dialogo');
    const coloca = () => { const w = Math.min(an, innerWidth - 24), h = Math.min(al, innerHeight - 24); Object.assign(v.style, { left: Math.max(12, Math.round((innerWidth - w) / 2)) + 'px', top: Math.max(12, Math.round((innerHeight - h) / 2.6)) + 'px', width: w + 'px', height: h + 'px' }); };
    const limpia = () => { ['left', 'top', 'width', 'height'].forEach(k => { v.style[k] = ''; }); };
    let arr = null, anc = null;
    cab.addEventListener('mousedown', (e) => { if (e.target.closest('button') || !suelta()) return; const r = v.getBoundingClientRect(); v.style.left = r.left + 'px'; v.style.top = r.top + 'px'; v.style.transform = 'none'; arr = { x: e.clientX - r.left, y: e.clientY - r.top }; v.style.zIndex = sube(); velo(); e.preventDefault(); });
    v.addEventListener('mousedown', () => { if (!v.classList.contains('v-dialogo') && Number(v.style.zIndex) < zV) v.style.zIndex = sube(); }, true);
    v.querySelector('.vborde').addEventListener('mousedown', (e) => { if (!v.classList.contains('v-panel') || libre()) return; anc = { x: e.clientX, w: v.offsetWidth }; e.preventDefault(); });
    const mueve = (e) => { if (arr) { v.style.left = Math.max(0, Math.min(innerWidth - 80, e.clientX - arr.x)) + 'px'; v.style.top = Math.max(0, Math.min(innerHeight - 40, e.clientY - arr.y)) + 'px'; } if (anc) v.style.width = Math.max(380, Math.min(innerWidth - 80, anc.w + (anc.x - e.clientX))) + 'px'; };
    const fin = () => { arr = null; anc = null; };
    window.addEventListener('mousemove', mueve); window.addEventListener('mouseup', fin);
    const cierra = () => { v.remove(); };
    // se cierre como se cierre (boton, Escape, o quien la abrio con .remove()), se sueltan sus oyentes
    const alIrse = new MutationObserver(() => { if (v.isConnected) return; alIrse.disconnect(); window.removeEventListener('mousemove', mueve); window.removeEventListener('mouseup', fin); });
    alIrse.observe(cont, { childList: true });
    v.querySelectorAll('[data-cerrar]').forEach(b => { b.onclick = () => { cierra(); if (o.alCerrar) o.alCerrar(); }; });
    v.querySelector('[data-ancho]').onclick = () => { if (libre()) return; limpia(); const h = v.classList.toggle('v-hoja'); v.classList.toggle('v-panel', !h); };
    v.querySelector('[data-libre]').onclick = (e) => {
      const b = e.currentTarget, sep = !libre(); limpia(); v.classList.remove('v-hoja', 'v-panel', 'v-libre');
      if (sep) { v.classList.add('v-libre'); coloca(); } else v.classList.add('v-' + nace);
      b.innerHTML = sep ? ICV.acoplar : ICV.separar; b.title = sep ? 'Volver a integrarla en el CDE' : 'Separar en una ventana flotante'; b.setAttribute('aria-label', sep ? 'Integrar' : 'Separar');
    };
    return v.querySelector('.vcuerpo');
  }
  // Al pasar a otro modulo se cierran las hojas y paneles abiertos (taparian la pagina nueva); dentro del mismo modulo se quedan.
  const moduloDe = (h) => { const p = String(h || '').replace(/^#/, '').split('/'); const m = p[3] || ''; return (p[2] || '') + '|' + (['', 'carpeta', 'c', 'archivos'].includes(m) ? 'docs' : m); };
  let modAct = moduloDe(location.hash);
  window.addEventListener('hashchange', () => { const m = moduloDe(location.hash); if (m === modAct) return; modAct = m; if (!window.CDE_PORTAL) return; document.querySelectorAll('#ventanas .ventana[data-nace]:not(.v-libre)').forEach(v => { const b = v.querySelector('[data-cerrar]'); if (b) b.click(); }); });
  /** Barras horizontales DINAMICAS: items [[k, n]]; alClic(k) filtra. */
  function barras(items, activo, alClic, total) {
    const max = Math.max(1, ...items.map(x => x[1])), t = total || items.reduce((s, x) => s + x[1], 0);
    return items.map(([k, n]) => '<div class="barra' + (activo === k ? ' activa' : '') + '" data-k="' + esc(k) + '"><div class="k" title="' + esc(k) + '">' + esc(k || '(vacio)') + '</div><div class="b"><i style="width:' + Math.round(100 * n / max) + '%"></i></div><div class="v">' + num(n) + '</div></div>').join('') + '<div class="pista">' + num(t) + ' en total · clic en una barra para filtrar</div>';
  }
  window.CDE = { esc, api, fecha, tam, num, ventana, barras, sube, olvida };
})();
